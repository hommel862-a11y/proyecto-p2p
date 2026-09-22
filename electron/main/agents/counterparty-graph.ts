/**
 * Semantic Counterparty Reputation & Anti-Triangulation Graph.
 * Persists and resolves counterparty profiles, behavioral records,
 * titular matches, and federated ZK threat hashes directly to SQLite and Engram WAL.
 */

import type { P2PDatabaseService } from '../db/database';
import {
  type Counterparty,
  type CounterpartyReputation,
  type AntiTriangulationAssessment,
  assessCounterpartyRisk,
  verifyTitularMatch,
} from '../vendor/p2p-core/counterparty';
import { generateBlindHash } from '../vendor/p2p-core/zk-market-mesh';

export interface CounterpartyProfileRecord {
  id: string;
  alias: string;
  realName: string;
  documentId: string;
  phone?: string;
  bankAccountsJson?: string;
  reputation: CounterpartyReputation;
  riskScore: number; // 0 (safest) to 100 (blocked)
  successfulTradesCount: number;
  triangulationIncidentsCount: number;
  totalVolumeUsdt: number;
  notes?: string;
  lastTradeTimestamp?: number;
  createdAt: number;
  updatedAt: number;
}

export class CounterpartyReputationGraph {
  constructor(private db: P2PDatabaseService) {
    this.ensureSchema();
  }

  private ensureSchema(): void {
    const rawDb = (this.db as unknown as { db: { exec: (sql: string) => void } }).db;
    if (rawDb && typeof rawDb.exec === 'function') {
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS counterparty_profiles (
          id TEXT PRIMARY KEY,
          alias TEXT NOT NULL,
          real_name TEXT NOT NULL,
          document_id TEXT NOT NULL,
          phone TEXT,
          bank_accounts_json TEXT,
          reputation TEXT NOT NULL DEFAULT 'NORMAL' CHECK (reputation IN ('TRUSTED', 'VERIFIED', 'NORMAL', 'SUSPICIOUS', 'BLOCKED')),
          risk_score REAL NOT NULL DEFAULT 10.0,
          successful_trades_count INTEGER NOT NULL DEFAULT 0,
          triangulation_incidents_count INTEGER NOT NULL DEFAULT 0,
          total_volume_usdt REAL NOT NULL DEFAULT 0.0,
          notes TEXT,
          last_trade_timestamp INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_cparty_alias ON counterparty_profiles(alias);
        CREATE INDEX IF NOT EXISTS idx_cparty_doc ON counterparty_profiles(document_id);
        CREATE INDEX IF NOT EXISTS idx_cparty_rep ON counterparty_profiles(reputation);
      `);
    }
  }

  /**
   * Evaluates counterparty risk against known history and bank titular match.
   */
  assessRisk(params: {
    alias: string;
    realName: string;
    documentId?: string;
    bankPayerName?: string;
  }): AntiTriangulationAssessment & {
    riskScore: number;
    reputation: CounterpartyReputation;
    profile: CounterpartyProfileRecord | null;
  } {
    const profile = this.getProfileByAliasOrDoc(params.alias, params.documentId);

    // Map to core domain model (or create ephemeral for unknown counterparty)
    const domainCparty: Counterparty = profile
      ? {
          id: profile.id,
          alias: profile.alias,
          realName: profile.realName,
          documentId: profile.documentId,
          phone: profile.phone,
          reputation: profile.reputation,
          notes: profile.notes,
          createdAt: new Date(profile.createdAt).toISOString(),
        }
      : {
          id: 'TEMP',
          alias: params.alias,
          realName: params.realName,
          documentId: params.documentId ?? '',
          reputation: 'NORMAL',
          createdAt: new Date().toISOString(),
        };

    const baseAssessment = assessCounterpartyRisk(domainCparty, params.bankPayerName);

    // Dynamic risk score calculation
    let calculatedScore = profile?.riskScore ?? 25; // default 25 for unknown counterparties

    if (baseAssessment.isThirdPartyPayment) {
      calculatedScore = 95;
    } else if (profile?.reputation === 'TRUSTED') {
      calculatedScore = Math.max(5, calculatedScore - 15);
    } else if (profile?.reputation === 'SUSPICIOUS') {
      calculatedScore = Math.max(75, calculatedScore);
    } else if (profile?.reputation === 'BLOCKED') {
      calculatedScore = 100;
    }

    return {
      ...baseAssessment,
      riskScore: calculatedScore,
      reputation: profile?.reputation ?? 'NORMAL',
      profile,
    };
  }

  /**
   * Records a completed trade with a counterparty, adjusting trust and Engram observation.
   */
  recordTrade(params: {
    alias: string;
    realName: string;
    documentId: string;
    volumeUsdt: number;
    bankPayerName: string;
    hadTriangulationAttempt: boolean;
  }): void {
    const now = Date.now();
    let profile = this.getProfileByAliasOrDoc(params.alias, params.documentId);

    const isTitularMatch = verifyTitularMatch(params.realName, params.bankPayerName);
    const hadIncident = params.hadTriangulationAttempt || !isTitularMatch;

    if (!profile) {
      profile = {
        id: `CP-${Date.now().toString(36).toUpperCase()}`,
        alias: params.alias,
        realName: params.realName,
        documentId: params.documentId,
        reputation: hadIncident ? 'SUSPICIOUS' : 'VERIFIED',
        riskScore: hadIncident ? 80 : 15,
        successfulTradesCount: hadIncident ? 0 : 1,
        triangulationIncidentsCount: hadIncident ? 1 : 0,
        totalVolumeUsdt: params.volumeUsdt,
        notes: hadIncident
          ? 'Alerta de titular no coincidente en primer intercambio.'
          : 'Primer intercambio exitoso.',
        lastTradeTimestamp: now,
        createdAt: now,
        updatedAt: now,
      };
      this.upsertProfile(profile);
    } else {
      const successfulTrades = hadIncident
        ? profile.successfulTradesCount
        : profile.successfulTradesCount + 1;
      const incidents = hadIncident
        ? profile.triangulationIncidentsCount + 1
        : profile.triangulationIncidentsCount;
      const totalVolume = profile.totalVolumeUsdt + params.volumeUsdt;

      let newReputation = profile.reputation;
      let newScore = profile.riskScore;

      if (incidents >= 2) {
        newReputation = 'BLOCKED';
        newScore = 100;
      } else if (incidents === 1) {
        newReputation = 'SUSPICIOUS';
        newScore = Math.max(75, newScore + 30);
      } else if (successfulTrades >= 5 && incidents === 0) {
        newReputation = 'TRUSTED';
        newScore = Math.max(5, newScore - 5);
      }

      profile = {
        ...profile,
        reputation: newReputation,
        riskScore: newScore,
        successfulTradesCount: successfulTrades,
        triangulationIncidentsCount: incidents,
        totalVolumeUsdt: totalVolume,
        lastTradeTimestamp: now,
        updatedAt: now,
      };
      this.upsertProfile(profile);
    }

    // Persist behavioral observation into Engram
    const blindHash = generateBlindHash(params.documentId || params.alias);
    this.db.saveEngramObservation({
      topicKey: `counterparty/${params.alias.toLowerCase()}`,
      type: hadIncident ? 'decision' : 'pattern',
      scope: 'project',
      what: hadIncident
        ? `Incidente de triangulación detectado con contraparte ${params.alias}. Titular recibido: ${params.bankPayerName}.`
        : `Intercambio exitoso de $${params.volumeUsdt} USDT con ${params.alias}. Titular verificado.`,
      why: hadIncident
        ? 'Discordancia entre nombre verificado en plataforma y titular bancario real.'
        : 'Cumplimiento estricto de titularidad bancaria y verificación KYC.',
      whereAffected: `Binance P2P / ${params.alias} (Hash: ${blindHash.slice(0, 10)}...)`,
      learned: hadIncident
        ? 'Suspender liberaciones automáticas y exigir prueba de titularidad documental con selfie.'
        : 'Contraparte confiable para ciclos de alta velocidad.',
      confidenceScore: 0.95,
      status: 'active',
    });
  }

  getProfileByAliasOrDoc(alias: string, documentId?: string): CounterpartyProfileRecord | null {
    const rawDb = (
      this.db as unknown as {
        db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } };
      }
    ).db;
    if (!rawDb) return null;

    if (documentId) {
      const stmt = rawDb.prepare(
        'SELECT * FROM counterparty_profiles WHERE document_id = ? OR alias = ?',
      );
      const row = stmt.get(documentId, alias) as Record<string, unknown> | undefined;
      return row ? this.mapRowToProfile(row) : null;
    }

    const stmt = rawDb.prepare('SELECT * FROM counterparty_profiles WHERE alias = ?');
    const row = stmt.get(alias) as Record<string, unknown> | undefined;
    return row ? this.mapRowToProfile(row) : null;
  }

  listProfiles(limit = 50): CounterpartyProfileRecord[] {
    const rawDb = (
      this.db as unknown as {
        db: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } };
      }
    ).db;
    if (!rawDb) return [];

    const stmt = rawDb.prepare(
      'SELECT * FROM counterparty_profiles ORDER BY updated_at DESC LIMIT ?',
    );
    const rows = stmt.all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToProfile(r));
  }

  private upsertProfile(profile: CounterpartyProfileRecord): void {
    const rawDb = (
      this.db as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db;
    if (!rawDb) return;

    const stmt = rawDb.prepare(`
      INSERT INTO counterparty_profiles (
        id, alias, real_name, document_id, phone, bank_accounts_json,
        reputation, risk_score, successful_trades_count, triangulation_incidents_count,
        total_volume_usdt, notes, last_trade_timestamp, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        alias = excluded.alias,
        real_name = excluded.real_name,
        document_id = excluded.document_id,
        phone = excluded.phone,
        reputation = excluded.reputation,
        risk_score = excluded.risk_score,
        successful_trades_count = excluded.successful_trades_count,
        triangulation_incidents_count = excluded.triangulation_incidents_count,
        total_volume_usdt = excluded.total_volume_usdt,
        notes = excluded.notes,
        last_trade_timestamp = excluded.last_trade_timestamp,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      profile.id,
      profile.alias,
      profile.realName,
      profile.documentId,
      profile.phone ?? null,
      profile.bankAccountsJson ?? null,
      profile.reputation,
      profile.riskScore,
      profile.successfulTradesCount,
      profile.triangulationIncidentsCount,
      profile.totalVolumeUsdt,
      profile.notes ?? null,
      profile.lastTradeTimestamp ?? null,
      profile.createdAt,
      profile.updatedAt,
    );
  }

  private mapRowToProfile(row: Record<string, unknown>): CounterpartyProfileRecord {
    return {
      id: String(row['id']),
      alias: String(row['alias']),
      realName: String(row['real_name']),
      documentId: String(row['document_id']),
      phone: row['phone'] ? String(row['phone']) : undefined,
      bankAccountsJson: row['bank_accounts_json'] ? String(row['bank_accounts_json']) : undefined,
      reputation: row['reputation'] as CounterpartyReputation,
      riskScore: Number(row['risk_score']),
      successfulTradesCount: Number(row['successful_trades_count']),
      triangulationIncidentsCount: Number(row['triangulation_incidents_count']),
      totalVolumeUsdt: Number(row['total_volume_usdt']),
      notes: row['notes'] ? String(row['notes']) : undefined,
      lastTradeTimestamp: row['last_trade_timestamp']
        ? Number(row['last_trade_timestamp'])
        : undefined,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }
}
