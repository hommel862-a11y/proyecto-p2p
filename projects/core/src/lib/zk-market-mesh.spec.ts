import { describe, it, expect, beforeEach } from 'vitest';
import {
  ZkMarketMesh,
  generateBlindHash,
  normalizeIdentifier,
  DEFAULT_ZK_SALT_DOMAIN,
} from './zk-market-mesh';

describe('ZkMarketMesh (Zero-Knowledge Federated Threat Intelligence)', () => {
  let mesh: ZkMarketMesh;

  beforeEach(() => {
    mesh = new ZkMarketMesh('node-alpha', DEFAULT_ZK_SALT_DOMAIN);
  });

  it('normalizes identifiers deterministically regardless of formatting', () => {
    expect(normalizeIdentifier(' v- 18.293.041 ')).toBe('V18293041');
    expect(normalizeIdentifier('+58-414-123-4567')).toBe('584141234567');
    expect(normalizeIdentifier('0102-0123-45-0000123456')).toBe('01020123450000123456');
    expect(normalizeIdentifier('')).toBe('');
  });

  it('generates blind SHA-256 hashes without revealing plaintext PII', () => {
    const hash1 = generateBlindHash('V-18293041');
    const hash2 = generateBlindHash('v18293041');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).not.toContain('18293041');

    // Different salt produces completely different hash
    const hashSalt2 = generateBlindHash('V-18293041', 'different-salt');
    expect(hashSalt2).not.toBe(hash1);
  });

  it('reports and queries threats locally with confidence scoring', () => {
    const report = mesh.reportThreat({
      rawIdentifier: 'V-20123456',
      threatType: 'TRIANGULATION',
      severity: 'HIGH',
      sanitizedSummary: 'Intento de triangulación con cuenta bancaria a nombre de un tercero',
    });

    expect(report).toBeDefined();
    expect(report?.confirmations).toBe(1);
    expect(mesh.getThreatCount()).toBe(1);

    const queryMatch = mesh.queryIdentifier('v-20.123.456');
    expect(queryMatch.isMatch).toBe(true);
    expect(queryMatch.threat?.threatType).toBe('TRIANGULATION');
    expect(queryMatch.confidenceScore).toBeGreaterThanOrEqual(70);

    const queryMiss = mesh.queryIdentifier('V-99999999');
    expect(queryMiss.isMatch).toBe(false);
    expect(queryMiss.threat).toBeNull();
    expect(queryMiss.confidenceScore).toBe(0);
  });

  it('federates intelligence via gossip packets across independent nodes', () => {
    const nodeA = new ZkMarketMesh('node-alpha');
    const nodeB = new ZkMarketMesh('node-beta');

    nodeA.reportThreat({
      rawIdentifier: '01020555444333222111',
      threatType: 'CHARGEBACK',
      severity: 'CRITICAL',
      sanitizedSummary: 'Cuenta mula reportada por fraude bancario',
    });

    const packet = nodeA.createGossipPacket();
    expect(packet.threats).toHaveLength(1);
    expect(packet.senderNodeId).toBe('node-alpha');

    // Ingest into Node B
    const result = nodeB.ingestGossipPacket(packet);
    expect(result.imported).toBe(1);
    expect(result.updated).toBe(0);
    expect(nodeB.getThreatCount()).toBe(1);

    // Node B can query the threat blindly
    const match = nodeB.queryIdentifier('0102-0555-44-4333222111');
    expect(match.isMatch).toBe(true);
    expect(match.threat?.threatType).toBe('CHARGEBACK');
    expect(match.confidenceScore).toBeGreaterThanOrEqual(80);

    // If Node B re-ingests same packet, it is updated/ignored properly
    const reIngest = nodeB.ingestGossipPacket(packet);
    expect(reIngest.updated).toBe(1);
  });

  it('exports and imports persistent records accurately', () => {
    mesh.reportThreat({
      rawIdentifier: 'V-11223344',
      threatType: 'THIRD_PARTY_FRAUD',
      sanitizedSummary: 'Tercero no autorizado',
    });

    const exported = mesh.exportRecords();
    expect(exported).toHaveLength(1);

    const freshMesh = new ZkMarketMesh('node-gamma');
    freshMesh.importRecords(exported);
    expect(freshMesh.getThreatCount()).toBe(1);
    expect(freshMesh.queryIdentifier('V-11223344').isMatch).toBe(true);
  });
});
