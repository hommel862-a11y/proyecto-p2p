import { computeSha256 } from './backup-encryption';

/**
 * Standard salt domains to prevent dictionary pre-computation attacks
 * and ensure uniform blind hashing across federated P2P nodes.
 */
export const DEFAULT_ZK_SALT_DOMAIN = 'p2p-ve-mesh-salt-2026';

export type MeshThreatType =
  | 'THIRD_PARTY_FRAUD'
  | 'TRIANGULATION'
  | 'IDENTITY_THEFT'
  | 'CHARGEBACK'
  | 'UNRESPONSIVE_RELEASE';

export type MeshThreatSeverity = 'WARNING' | 'HIGH' | 'CRITICAL';

export interface BlindThreatRecord {
  /** Unique ID for the threat event */
  id: string;
  /** Blind SHA-256 hash: computeSha256(normalizedIdentifier + salt) */
  blindHash: string;
  /** Salt domain used for blind hashing */
  saltDomain: string;
  /** Category of malicious behavior */
  threatType: MeshThreatType;
  /** Severity rating */
  severity: MeshThreatSeverity;
  /** Non-PII contextual summary (e.g. 'Comprobante manipulado con fuente Helvetica') */
  sanitizedSummary: string;
  /** Pseudonymous ID of the reporting node */
  reporterNodeId: string;
  /** Unix timestamp of creation */
  timestamp: number;
  /** Number of distinct peer confirmations received */
  confirmations: number;
}

export interface MeshGossipPacket {
  protocolVersion: 'zk-mesh-v1';
  packetId: string;
  senderNodeId: string;
  sentAt: number;
  threats: BlindThreatRecord[];
}

export interface ThreatMatchResult {
  isMatch: boolean;
  threat: BlindThreatRecord | null;
  confidenceScore: number;
}

/**
 * Normalizes user identifiers (DNI/CI, RIF, Phone, Bank Account)
 * by removing symbols, spaces and converting to uppercase.
 */
export function normalizeIdentifier(raw: string): string {
  if (!raw) return '';
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Generates a blind Zero-Knowledge identifier hash using salt domain.
 * Cannot be reversed to reveal client DNI or account number.
 */
export function generateBlindHash(rawIdentifier: string, saltDomain: string = DEFAULT_ZK_SALT_DOMAIN): string {
  const normalized = normalizeIdentifier(rawIdentifier);
  if (!normalized) return '';
  return computeSha256(`${normalized}::${saltDomain}`);
}

/**
 * ZK Market Mesh Engine
 * Manages privacy-preserving threat intelligence federated across trusted OTC desks.
 */
export class ZkMarketMesh {
  private readonly localNodeId: string;
  private readonly defaultSalt: string;
  private readonly threatsByHash = new Map<string, BlindThreatRecord>();

  constructor(nodeId?: string, saltDomain: string = DEFAULT_ZK_SALT_DOMAIN) {
    this.localNodeId = nodeId || `node-${computeSha256(`mesh-node-${Date.now()}-${Math.random()}`).slice(0, 12)}`;
    this.defaultSalt = saltDomain;
  }

  getNodeId(): string {
    return this.localNodeId;
  }

  getThreatCount(): number {
    return this.threatsByHash.size;
  }

  /**
   * Registers a new local threat into the mesh, immediately blind-hashing the identifier.
   */
  reportThreat(params: {
    rawIdentifier: string;
    threatType: MeshThreatType;
    severity?: MeshThreatSeverity;
    sanitizedSummary: string;
    saltDomain?: string;
  }): BlindThreatRecord | null {
    const salt = params.saltDomain || this.defaultSalt;
    const blindHash = generateBlindHash(params.rawIdentifier, salt);
    if (!blindHash) return null;

    const existing = this.threatsByHash.get(blindHash);
    if (existing) {
      existing.confirmations += 1;
      if (params.severity === 'CRITICAL') existing.severity = 'CRITICAL';
      return existing;
    }

    const record: BlindThreatRecord = {
      id: `zk-th-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      blindHash,
      saltDomain: salt,
      threatType: params.threatType,
      severity: params.severity || 'HIGH',
      sanitizedSummary: params.sanitizedSummary,
      reporterNodeId: this.localNodeId,
      timestamp: Date.now(),
      confirmations: 1,
    };

    this.threatsByHash.set(blindHash, record);
    return record;
  }

  /**
   * Checks if an incoming client or counterparty is flagged in the federated blacklist.
   */
  queryIdentifier(rawIdentifier: string, saltDomain?: string): ThreatMatchResult {
    const salt = saltDomain || this.defaultSalt;
    const blindHash = generateBlindHash(rawIdentifier, salt);
    if (!blindHash) {
      return { isMatch: false, threat: null, confidenceScore: 0 };
    }

    const threat = this.threatsByHash.get(blindHash) || null;
    if (!threat) {
      return { isMatch: false, threat: null, confidenceScore: 0 };
    }

    // Confidence scales with confirmations and severity
    const baseWeight = threat.severity === 'CRITICAL' ? 80 : threat.severity === 'HIGH' ? 60 : 40;
    const confWeight = Math.min(threat.confirmations * 10, 20);
    const confidenceScore = Math.min(baseWeight + confWeight, 100);

    return {
      isMatch: true,
      threat,
      confidenceScore,
    };
  }

  /**
   * Ingests a gossip packet from another operator node.
   * Preserves zero-knowledge integrity and increases confirmation weight.
   */
  ingestGossipPacket(packet: MeshGossipPacket): { imported: number; updated: number; ignored: number } {
    if (packet.protocolVersion !== 'zk-mesh-v1' || !Array.isArray(packet.threats)) {
      return { imported: 0, updated: 0, ignored: 0 };
    }

    let imported = 0;
    let updated = 0;
    let ignored = 0;

    for (const remoteRecord of packet.threats) {
      if (!remoteRecord.blindHash || !remoteRecord.saltDomain) {
        ignored++;
        continue;
      }

      const existing = this.threatsByHash.get(remoteRecord.blindHash);
      if (existing) {
        // Increment confirmation if reported by a different node
        if (remoteRecord.reporterNodeId !== this.localNodeId) {
          existing.confirmations += 1;
          if (remoteRecord.severity === 'CRITICAL') {
            existing.severity = 'CRITICAL';
          }
          updated++;
        } else {
          ignored++;
        }
      } else {
        this.threatsByHash.set(remoteRecord.blindHash, {
          ...remoteRecord,
          confirmations: Math.max(1, remoteRecord.confirmations),
        });
        imported++;
      }
    }

    return { imported, updated, ignored };
  }

  /**
   * Creates an outbound gossip packet to broadcast to peer nodes.
   */
  createGossipPacket(sinceTimestamp: number = 0): MeshGossipPacket {
    const list = Array.from(this.threatsByHash.values()).filter((t) => t.timestamp >= sinceTimestamp);

    return {
      protocolVersion: 'zk-mesh-v1',
      packetId: `gossip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      senderNodeId: this.localNodeId,
      sentAt: Date.now(),
      threats: list,
    };
  }

  /**
   * Exports the entire federated blacklist for local backup or encrypted sync.
   */
  exportRecords(): BlindThreatRecord[] {
    return Array.from(this.threatsByHash.values());
  }

  /**
   * Bulk loads records from persistent store.
   */
  importRecords(records: BlindThreatRecord[]): void {
    if (!Array.isArray(records)) return;
    for (const r of records) {
      if (r && r.blindHash) {
        this.threatsByHash.set(r.blindHash, r);
      }
    }
  }

  clear(): void {
    this.threatsByHash.clear();
  }
}
