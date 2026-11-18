import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  PgArmStore,
  type PgClientLike,
  type PgQueryResult,
  type PgQueryResultRow,
} from '../pg-store.js';

interface RecordedQuery {
  text: string;
  values?: unknown[];
}

class FakePoolClient implements PgClientLike {
  readonly queries: RecordedQuery[] = [];
  released = false;
  private readonly responder: (text: string, values?: unknown[]) => PgQueryResult | Error;

  constructor(responder: (text: string, values?: unknown[]) => PgQueryResult | Error) {
    this.responder = responder;
  }

  async query(text: string, values?: unknown[]): Promise<PgQueryResult> {
    this.queries.push({ text, values });
    const out = this.responder(text, values);
    if (out instanceof Error) {
      throw out;
    }
    return out;
  }

  release(): void {
    this.released = true;
  }
}

class FakeListenerClient extends EventEmitter {
  readonly queries: RecordedQuery[] = [];
  connected = false;
  ended = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async query(text: string, values?: unknown[]): Promise<PgQueryResult> {
    this.queries.push({ text, values });
    return { rows: [] as PgQueryResultRow[], rowCount: 0 };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

describe('PgArmStore (PostgreSQL + RLS + pgvector)', () => {
  let listenerClient: FakeListenerClient;
  let lastPoolClient: FakePoolClient;

  beforeEach(() => {
    listenerClient = new FakeListenerClient();
  });

  it('executes withWorkspaceTx inside BEGIN/COMMIT with local app.current_workspace setting', async () => {
    const poolQueries: RecordedQuery[] = [];
    const mockPool = {
      connect: vi.fn(async () => {
        lastPoolClient = new FakePoolClient((text) => {
          if (text.includes('SELECT 42 AS answer')) {
            return { rows: [{ answer: 42 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        });
        return lastPoolClient;
      }),
      query: vi.fn(async (text: string, values?: unknown[]) => {
        poolQueries.push({ text, values });
        return { rows: [], rowCount: 0 };
      }),
      end: vi.fn(async () => undefined),
    };

    const store = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: mockPool,
      createListenerClient: () => listenerClient,
    });

    const result = await store.withWorkspaceTx('P2P_DESK', async (client) => {
      const res = await client.query('SELECT 42 AS answer');
      return res.rows[0]?.['answer'];
    });

    expect(result).toBe(42);
    expect(lastPoolClient.released).toBe(true);
    expect(lastPoolClient.queries.map((q) => q.text)).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_workspace', $1, true)",
      'SELECT 42 AS answer',
      'COMMIT',
    ]);
    expect(lastPoolClient.queries[1]?.values).toEqual(['P2P_DESK']);
    expect(poolQueries).toHaveLength(0);
  });

  it('rolls back transaction and releases client when withWorkspaceTx callback fails', async () => {
    const mockPool = {
      connect: vi.fn(async () => {
        lastPoolClient = new FakePoolClient(() => ({ rows: [], rowCount: 0 }));
        return lastPoolClient;
      }),
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(async () => undefined),
    };

    const store = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: mockPool,
      createListenerClient: () => listenerClient,
    });

    await expect(
      store.withWorkspaceTx('ARM_B2B', async () => {
        throw new Error('BOOM_TX');
      }),
    ).rejects.toThrow('BOOM_TX');

    expect(lastPoolClient.released).toBe(true);
    expect(lastPoolClient.queries.map((q) => q.text)).toEqual([
      'BEGIN',
      "SELECT set_config('app.current_workspace', $1, true)",
      'ROLLBACK',
    ]);
  });

  it('reports healthCheck connectivity, RLS status, and pgvector presence', async () => {
    const healthyPool = {
      connect: vi.fn(async () => new FakePoolClient(() => ({ rows: [], rowCount: 0 }))),
      query: vi.fn(async () => ({
        rows: [{ ping: 1, has_vector: true, rls_active: true }],
        rowCount: 1,
      })),
      end: vi.fn(async () => undefined),
    };

    const store = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: healthyPool,
      createListenerClient: () => listenerClient,
    });

    const okHealth = await store.healthCheck();
    expect(okHealth.connected).toBe(true);
    expect(okHealth.rlsActive).toBe(true);
    expect(okHealth.pgvectorInstalled).toBe(true);
    expect(okHealth.latencyMs).toBeGreaterThanOrEqual(0);

    const brokenPool = {
      ...healthyPool,
      query: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    };
    const brokenStore = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: brokenPool,
      createListenerClient: () => listenerClient,
    });
    const badHealth = await brokenStore.healthCheck();
    expect(badHealth.connected).toBe(false);
    expect(badHealth.rlsActive).toBe(false);
    expect(badHealth.error).toContain('ECONNREFUSED');
  });

  it('appends and replays outbox events with RLS isolation', async () => {
    const clients: FakePoolClient[] = [];
    const mockPool = {
      connect: vi.fn(async () => {
        const client = new FakePoolClient((text) => {
          if (text.includes('INSERT INTO outbox_events')) {
            return {
              rows: [
                {
                  id: '77',
                  workspace_id: 'FINANCE_360',
                  event_type: 'pipeline_transition',
                  aggregate_id: 'lead-360-1',
                  payload: { toStageSlug: 'calificado' },
                  ts_ms: '1740000001234',
                },
              ],
              rowCount: 1,
            };
          }
          if (text.includes('FROM outbox_events')) {
            return {
              rows: [
                {
                  id: '77',
                  workspace_id: 'FINANCE_360',
                  event_type: 'pipeline_transition',
                  aggregate_id: 'lead-360-1',
                  payload: { toStageSlug: 'calificado' },
                  created_at: new Date('2026-11-18T10:00:00.000Z'),
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        });
        clients.push(client);
        return client;
      }),
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(async () => undefined),
    };

    const store = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: mockPool,
      createListenerClient: () => listenerClient,
    });

    const appended = await store.appendOutboxEvent(
      'FINANCE_360',
      'pipeline_transition',
      'lead-360-1',
      { toStageSlug: 'calificado' },
    );

    expect(appended).toEqual({
      id: 77,
      workspaceId: 'FINANCE_360',
      eventType: 'pipeline_transition',
      aggregateId: 'lead-360-1',
      payload: { toStageSlug: 'calificado' },
      timestamp: 1740000001234,
    });

    const missed = await store.getOutboxEventsSince(70, 'FINANCE_360');
    expect(missed).toHaveLength(1);
    expect(missed[0]?.id).toBe(77);
    expect(missed[0]?.workspaceId).toBe('FINANCE_360');
    expect(clients[1]?.queries[1]?.values).toEqual(['FINANCE_360']);
  });

  it('catches SQLSTATE 23505 duplicate receipt violation and returns collision metadata cleanly', async () => {
    let insertCount = 0;
    const mockPool = {
      connect: vi.fn(async () => {
        return new FakePoolClient((text) => {
          if (text.includes('INSERT INTO payment_receipts')) {
            insertCount++;
            if (insertCount === 1) {
              return {
                rows: [
                  {
                    id: 'rcpt-uuid-1',
                    workspace_id: 'P2P_DESK',
                    bank_rail_id: 'rail-banesco-ves',
                    reference_code: '88990011',
                    amount_fiat: '15000.000000',
                    currency: 'VES',
                    deal_id: 'deal-101',
                    status: 'VERIFIED',
                    verified_at: new Date('2026-11-18T12:00:00.000Z'),
                  },
                ],
                rowCount: 1,
              };
            }
            const dupErr = Object.assign(new Error('duplicate key value violates unique constraint "uq_receipt_no_replay"'), {
              code: '23505',
            });
            return dupErr;
          }
          if (text.includes('FROM payment_receipts') && text.includes('SELECT id')) {
            return { rows: [{ id: 'rcpt-uuid-1', deal_id: 'deal-101' }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        });
      }),
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(async () => undefined),
    };

    const store = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: mockPool,
      createListenerClient: () => listenerClient,
    });

    const first = await store.recordPaymentReceipt({
      workspaceId: 'P2P_DESK',
      bankRailId: 'rail-banesco-ves',
      referenceCode: ' 8899-0011 ',
      amountFiat: 15000,
      dealId: 'deal-101',
    });

    expect(first.recorded).toBe(true);
    expect(first.collision).toBe(false);
    expect(first.normalizedReference).toBe('88990011');
    expect(first.receipt?.id).toBe('rcpt-uuid-1');

    const replay = await store.recordPaymentReceipt({
      workspaceId: 'P2P_DESK',
      bankRailId: 'rail-banesco-ves',
      referenceCode: '88990011',
      amountFiat: 15000,
      dealId: 'deal-102',
    });

    expect(replay.recorded).toBe(false);
    expect(replay.collision).toBe(true);
    expect(replay.normalizedReference).toBe('88990011');
    expect(replay.existingReceiptId).toBe('rcpt-uuid-1');
    expect(replay.existingDealId).toBe('deal-101');
  });

  it('upserts bank rails, lists rails by workspace, and records idempotent treasury settlements', async () => {
    const mockPool = {
      connect: vi.fn(async () => {
        return new FakePoolClient((text) => {
          if (text.includes('INSERT INTO bank_rails')) {
            return {
              rows: [
                {
                  id: 'rail-mercantil-1',
                  workspace_id: 'P2P_DESK',
                  bank_name: 'Mercantil',
                  bank_code: '0105',
                  rail_type: 'PAGO_MOVIL',
                  currency: 'VES',
                  holder_details_text: 'Mesa P2P CA',
                  account_number_masked: '****4421',
                  current_balance_fiat: '250000.500000',
                  max_daily_cap_fiat: '1000000.000000',
                  monthly_limit_fiat: '5000000.000000',
                  fee_pct: '0.300000',
                  max_burst_tx_15m: 6,
                  is_active: true,
                  version: 2,
                  created_at: new Date('2026-11-18T08:00:00.000Z'),
                  updated_at: new Date('2026-11-18T09:00:00.000Z'),
                },
              ],
              rowCount: 1,
            };
          }
          if (text.includes('FROM bank_rails')) {
            return {
              rows: [
                {
                  id: 'rail-mercantil-1',
                  workspace_id: 'P2P_DESK',
                  bank_name: 'Mercantil',
                  bank_code: '0105',
                  rail_type: 'PAGO_MOVIL',
                  currency: 'VES',
                  holder_details_text: 'Mesa P2P CA',
                  account_number_masked: '****4421',
                  current_balance_fiat: '250000.500000',
                  max_daily_cap_fiat: '1000000.000000',
                  monthly_limit_fiat: '5000000.000000',
                  fee_pct: '0.300000',
                  max_burst_tx_15m: 6,
                  is_active: true,
                  version: 2,
                  created_at: new Date('2026-11-18T08:00:00.000Z'),
                  updated_at: new Date('2026-11-18T09:00:00.000Z'),
                },
              ],
              rowCount: 1,
            };
          }
          if (text.includes('INSERT INTO treasury_settlements')) {
            return {
              rows: [
                {
                  id: 'settle-uuid-1',
                  workspace_id: 'P2P_DESK',
                  idempotency_key: 'settle-key-2026-01',
                  bank_rail_id: 'rail-mercantil-1',
                  deal_id: 'deal-500',
                  settlement_type: 'P2P_RELEASE',
                  crypto_amount_usdt: '1250.250000',
                  fiat_amount: '100020.000000',
                  fiat_currency: 'VES',
                  applied_rate: '80.000000',
                  realized_profit_usdt: '18.500000',
                  status: 'SETTLED',
                  settled_at: new Date('2026-11-18T11:00:00.000Z'),
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        });
      }),
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(async () => undefined),
    };

    const store = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: mockPool,
      createListenerClient: () => listenerClient,
    });

    const rail = await store.upsertBankRail({
      id: 'rail-mercantil-1',
      workspaceId: 'P2P_DESK',
      bankName: 'Mercantil',
      bankCode: '0105',
      currentBalanceFiat: 250000.5,
      maxDailyCapFiat: 1000000,
    });

    expect(rail.id).toBe('rail-mercantil-1');
    expect(rail.currentBalanceFiat).toBeCloseTo(250000.5);
    expect(rail.version).toBe(2);

    const listed = await store.listBankRails('P2P_DESK');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.bankName).toBe('Mercantil');

    const settlement = await store.recordTreasurySettlement({
      workspaceId: 'P2P_DESK',
      idempotencyKey: 'settle-key-2026-01',
      bankRailId: 'rail-mercantil-1',
      dealId: 'deal-500',
      cryptoAmountUsdt: 1250.25,
      fiatAmount: 100020,
      appliedRate: 80,
      realizedProfitUsdt: 18.5,
    });

    expect(settlement.recorded).toBe(true);
    expect(settlement.duplicate).toBe(false);
    expect(settlement.settlement?.cryptoAmountUsdt).toBeCloseTo(1250.25);
  });

  it('listens on arm_outbox_channel and maps pg_notify JSON payloads to ArmOutboxSseEvent', async () => {
    const mockPool = {
      connect: vi.fn(async () => new FakePoolClient(() => ({ rows: [], rowCount: 0 }))),
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(async () => undefined),
    };

    const store = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: mockPool,
      createListenerClient: () => listenerClient,
    });

    const received: unknown[] = [];
    const handle = await store.startOutboxListener((evt) => received.push(evt));

    expect(listenerClient.connected).toBe(true);
    expect(listenerClient.queries.map((q) => q.text)).toContain('LISTEN arm_outbox_channel');

    listenerClient.emit('notification', {
      channel: 'arm_outbox_channel',
      payload: JSON.stringify({
        id: 99,
        workspace_id: 'ARM_B2B',
        event_type: 'approval_requested',
        aggregate_id: 'app-99',
        payload: { priority: 'HIGH' },
        created_at: '2026-11-18T14:00:00.000Z',
      }),
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      id: 99,
      workspaceId: 'ARM_B2B',
      eventType: 'approval_requested',
      aggregateId: 'app-99',
      payload: { priority: 'HIGH' },
      timestamp: Date.parse('2026-11-18T14:00:00.000Z'),
    });

    await handle.stop();
    expect(listenerClient.ended).toBe(true);
  });

  it('rejects invalid workspaceId, queries all silos when workspaceId is omitted in getOutboxEventsSince, and detects duplicate treasury settlements', async () => {
    const mockClient = new FakePoolClient((text, values) => {
      if (text.includes('FROM outbox_events')) {
        const ws = values?.[1];
        if (ws === 'ARM_B2B') {
          return {
            rows: [
              {
                id: '15',
                workspace_id: 'ARM_B2B',
                event_type: 'agent_run',
                aggregate_id: 'lead-b2b',
                payload: {},
                created_at: new Date('2026-11-18T12:00:00.000Z'),
              },
            ],
            rowCount: 1,
          };
        }
        if (ws === 'P2P_DESK') {
          return {
            rows: [
              {
                id: '12',
                workspace_id: 'P2P_DESK',
                event_type: 'pipeline_transition',
                aggregate_id: 'lead-p2p',
                payload: {},
                created_at: new Date('2026-11-18T11:55:00.000Z'),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO treasury_settlements')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT * FROM treasury_settlements')) {
        return {
          rows: [
            {
              id: 'settle-existing-1',
              workspace_id: 'P2P_DESK',
              idempotency_key: 'dup-key-1',
              bank_rail_id: null,
              deal_id: 'deal-500',
              settlement_type: 'P2P_RELEASE',
              crypto_amount_usdt: '500.000000',
              fiat_amount: '40000.000000',
              fiat_currency: 'VES',
              applied_rate: '80.000000',
              realized_profit_usdt: '10.000000',
              status: 'SETTLED',
              settled_at: new Date('2026-11-18T11:00:00.000Z'),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const mockPool = {
      connect: vi.fn(async () => mockClient),
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(async () => undefined),
    };

    const store = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: mockPool,
      createListenerClient: () => listenerClient,
    });

    await expect(
      store.withWorkspaceTx('INVALID_SILO' as 'P2P_DESK', async () => 'nope'),
    ).rejects.toThrow('Invalid workspaceId');

    const allEvents = await store.getOutboxEventsSince(10);
    expect(allEvents.map((e) => e.id)).toEqual([12, 15]);
    expect(allEvents.map((e) => e.workspaceId)).toEqual(['P2P_DESK', 'ARM_B2B']);

    const dupSettlement = await store.recordTreasurySettlement({
      workspaceId: 'P2P_DESK',
      idempotencyKey: 'dup-key-1',
      cryptoAmountUsdt: 500,
      fiatAmount: 40000,
    });
    expect(dupSettlement.recorded).toBe(false);
    expect(dupSettlement.duplicate).toBe(true);
    expect(dupSettlement.settlement?.id).toBe('settle-existing-1');
  });
});
