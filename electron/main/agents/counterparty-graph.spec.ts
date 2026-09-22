import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CounterpartyReputationGraph } from './counterparty-graph';
import type { P2PDatabaseService } from '../db/database';

describe('CounterpartyReputationGraph (Pilar 3: Grafo Semántico de Reputación)', () => {
  let graph: CounterpartyReputationGraph;
  let mockDb: any;
  let inMemoryProfiles: Map<string, any>;

  beforeEach(() => {
    inMemoryProfiles = new Map();

    mockDb = {
      saveEngramObservation: vi.fn().mockReturnValue(1),
      db: {
        exec: vi.fn(),
        prepare: vi.fn((sql: string) => {
          if (
            sql.includes('SELECT * FROM counterparty_profiles WHERE document_id = ? OR alias = ?')
          ) {
            return {
              get: vi.fn((doc: string, alias: string) => {
                for (const p of inMemoryProfiles.values()) {
                  if (p.document_id === doc || p.alias === alias) return p;
                }
                return undefined;
              }),
            };
          }
          if (sql.includes('SELECT * FROM counterparty_profiles WHERE alias = ?')) {
            return {
              get: vi.fn((alias: string) => {
                return inMemoryProfiles.get(alias);
              }),
            };
          }
          if (sql.includes('INSERT INTO counterparty_profiles')) {
            return {
              run: vi.fn(
                (
                  id,
                  alias,
                  realName,
                  doc,
                  phone,
                  bank,
                  rep,
                  score,
                  trades,
                  incidents,
                  vol,
                  notes,
                  last,
                  cr,
                  up,
                ) => {
                  const record = {
                    id,
                    alias,
                    real_name: realName,
                    document_id: doc,
                    phone,
                    bank_accounts_json: bank,
                    reputation: rep,
                    risk_score: score,
                    successful_trades_count: trades,
                    triangulation_incidents_count: incidents,
                    total_volume_usdt: vol,
                    notes,
                    last_trade_timestamp: last,
                    created_at: cr,
                    updated_at: up,
                  };
                  inMemoryProfiles.set(alias, record);
                },
              ),
            };
          }
          if (sql.includes('SELECT * FROM counterparty_profiles ORDER BY updated_at DESC')) {
            return {
              all: vi.fn(() => Array.from(inMemoryProfiles.values())),
            };
          }
          return { get: vi.fn(), all: vi.fn(), run: vi.fn() };
        }),
      },
    };

    graph = new CounterpartyReputationGraph(mockDb as unknown as P2PDatabaseService);
  });

  it('correctly assesses risk for an unknown counterparty with matching titular', () => {
    const result = graph.assessRisk({
      alias: 'UnknownTrader',
      realName: 'Carlos Mendoza',
      bankPayerName: 'Carlos Mendoza',
    });

    expect(result.isSafe).toBe(true);
    expect(result.isThirdPartyPayment).toBe(false);
    expect(result.riskScore).toBe(25);
  });

  it('detects third-party payment triangulation and flags CRITICAL risk', () => {
    const result = graph.assessRisk({
      alias: 'SuspiciousTrader',
      realName: 'Carlos Mendoza',
      bankPayerName: 'Maria Josefina Gomez',
    });

    expect(result.isSafe).toBe(false);
    expect(result.isThirdPartyPayment).toBe(true);
    expect(result.riskLevel).toBe('CRITICAL');
    expect(result.riskScore).toBe(95);
  });

  it('records successful trades and promotes counterparty to TRUSTED over time', () => {
    for (let i = 0; i < 5; i++) {
      graph.recordTrade({
        alias: 'TrustedTrader',
        realName: 'Carlos Mendoza',
        documentId: 'V-19842103',
        volumeUsdt: 1000,
        bankPayerName: 'Carlos Mendoza',
        hadTriangulationAttempt: false,
      });
    }

    const profile = graph.getProfileByAliasOrDoc('TrustedTrader');
    expect(profile).not.toBeNull();
    expect(profile?.successfulTradesCount).toBe(5);
    expect(profile?.reputation).toBe('TRUSTED');
    expect(profile?.riskScore).toBeLessThanOrEqual(10);
    expect(mockDb.saveEngramObservation).toHaveBeenCalled();
  });

  it('blocks counterparty after multiple triangulation incidents', () => {
    graph.recordTrade({
      alias: 'BadActor',
      realName: 'Pedro Infante',
      documentId: 'V-11223344',
      volumeUsdt: 500,
      bankPayerName: 'Tercero No Autorizado',
      hadTriangulationAttempt: true,
    });

    graph.recordTrade({
      alias: 'BadActor',
      realName: 'Pedro Infante',
      documentId: 'V-11223344',
      volumeUsdt: 500,
      bankPayerName: 'Otro Tercero',
      hadTriangulationAttempt: true,
    });

    const profile = graph.getProfileByAliasOrDoc('BadActor');
    expect(profile?.reputation).toBe('BLOCKED');
    expect(profile?.riskScore).toBe(100);
  });
});
