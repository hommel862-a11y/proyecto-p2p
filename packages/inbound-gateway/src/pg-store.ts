import { randomUUID } from 'node:crypto';
import { Pool, Client, type Notification } from 'pg';
import {
  normalizeBankReference,
  type ArmWorkspaceId,
  type ArmOutboxEventType,
  type ArmOutboxSseEvent,
} from '@p2p/core';

export const ARM_WORKSPACE_IDS = ['ARM_B2B', 'P2P_DESK', 'FINANCE_360'] as const;

export function isArmWorkspaceId(value: unknown): value is ArmWorkspaceId {
  return (
    value === 'ARM_B2B' ||
    value === 'P2P_DESK' ||
    value === 'FINANCE_360'
  );
}

export interface PgQueryResultRow {
  [column: string]: unknown;
}

export interface PgQueryResult<R extends PgQueryResultRow = PgQueryResultRow> {
  rows: R[];
  rowCount: number | null;
}

export interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  release(err?: Error | boolean): void;
}

export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  end(): Promise<void>;
  on?(event: 'error', listener: (err: Error) => void): unknown;
}

export interface PgListenerClientLike {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  end(): Promise<void>;
  on(event: 'notification', listener: (msg: Notification) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

export interface PgArmStoreDeps {
  pool?: PgPoolLike;
  createListenerClient?: () => PgListenerClientLike;
}

export interface PgHealthCheckResult {
  connected: boolean;
  latencyMs: number;
  rlsActive: boolean;
  pgvectorInstalled: boolean;
  error?: string;
}

export interface RecordPaymentReceiptInput {
  workspaceId: ArmWorkspaceId;
  bankRailId: string;
  referenceCode: string;
  amountFiat: number;
  currency?: string;
  dealId?: string;
  leadId?: string;
  senderName?: string;
  rawText?: string;
  channel?: string;
}

export interface PaymentReceiptRecord {
  id: string;
  workspaceId: ArmWorkspaceId;
  bankRailId: string;
  referenceCode: string;
  amountFiat: number;
  currency: string;
  dealId: string | null;
  status: string;
  verifiedAt: number;
}

export interface RecordPaymentReceiptResult {
  recorded: boolean;
  collision: boolean;
  normalizedReference: string;
  receipt?: PaymentReceiptRecord;
  existingReceiptId?: string;
}

export interface BankRailUpsertInput {
  id?: string;
  workspaceId: ArmWorkspaceId;
  bankName: string;
  bankCode?: string;
  railType?: string;
  currency?: string;
  holderDetailsText?: string;
  accountNumberMasked?: string;
  currentBalanceFiat?: number;
  maxDailyCapFiat?: number;
  monthlyLimitFiat?: number;
  feePct?: number;
  maxBurstTx15m?: number;
  isActive?: boolean;
}

export interface BankRailRecord {
  id: string;
  workspaceId: ArmWorkspaceId;
  bankName: string;
  bankCode: string;
  railType: string;
  currency: string;
  holderDetailsText: string;
  accountNumberMasked: string;
  currentBalanceFiat: number;
  maxDailyCapFiat: number;
  monthlyLimitFiat: number;
  feePct: number;
  maxBurstTx15m: number;
  isActive: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface TreasurySettlementInput {
  workspaceId: ArmWorkspaceId;
  idempotencyKey: string;
  bankRailId?: string;
  dealId?: string;
  leadId?: string;
  settlementType?: string;
  cryptoAmountUsdt: number;
  fiatAmount: number;
  fiatCurrency?: string;
  appliedRate?: number;
  realizedProfitUsdt?: number;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface TreasurySettlementRecord {
  id: string;
  workspaceId: ArmWorkspaceId;
  idempotencyKey: string;
  bankRailId: string | null;
  dealId: string | null;
  settlementType: string;
  cryptoAmountUsdt: number;
  fiatAmount: number;
  fiatCurrency: string;
  appliedRate: number;
  realizedProfitUsdt: number;
  status: string;
  settledAt: number;
}

export interface TreasurySettlementResult {
  recorded: boolean;
  duplicate: boolean;
  settlement?: TreasurySettlementRecord;
}

export interface OutboxListenerHandle {
  stop: () => Promise<void>;
}

function isPgUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}

function toEpochMs(value: unknown): number {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : Date.now();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.round(numeric);
  }
  return Date.now();
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}

function mapOutboxRow(row: PgQueryResultRow): ArmOutboxSseEvent {
  const rawWorkspace = row['workspace_id'] ?? row['workspaceId'];
  const workspaceId: ArmWorkspaceId = isArmWorkspaceId(rawWorkspace) ? rawWorkspace : 'P2P_DESK';
  const rawEventType = row['event_type'] ?? row['eventType'];
  const eventType = String(rawEventType || 'agent_run') as ArmOutboxEventType;
  const timestamp =
    row['ts_ms'] != null
      ? Math.round(Number(row['ts_ms']))
      : toEpochMs(row['created_at'] ?? row['timestamp']);

  return {
    id: Number(row['id']),
    workspaceId,
    eventType,
    aggregateId: String(row['aggregate_id'] ?? row['aggregateId'] ?? ''),
    payload: parseJsonRecord(row['payload']),
    timestamp,
  };
}

function mapPaymentReceiptRow(row: PgQueryResultRow): PaymentReceiptRecord {
  const rawWorkspace = row['workspace_id'];
  return {
    id: String(row['id']),
    workspaceId: isArmWorkspaceId(rawWorkspace) ? rawWorkspace : 'P2P_DESK',
    bankRailId: String(row['bank_rail_id']),
    referenceCode: String(row['reference_code']),
    amountFiat: Number(row['amount_fiat'] ?? 0),
    currency: String(row['currency'] ?? 'VES'),
    dealId: row['deal_id'] != null ? String(row['deal_id']) : null,
    status: String(row['status'] ?? 'VERIFIED'),
    verifiedAt: toEpochMs(row['verified_at']),
  };
}

function mapBankRailRow(row: PgQueryResultRow): BankRailRecord {
  const rawWorkspace = row['workspace_id'];
  return {
    id: String(row['id']),
    workspaceId: isArmWorkspaceId(rawWorkspace) ? rawWorkspace : 'P2P_DESK',
    bankName: String(row['bank_name'] ?? ''),
    bankCode: String(row['bank_code'] ?? ''),
    railType: String(row['rail_type'] ?? 'PAGO_MOVIL'),
    currency: String(row['currency'] ?? 'VES'),
    holderDetailsText: String(row['holder_details_text'] ?? ''),
    accountNumberMasked: String(row['account_number_masked'] ?? ''),
    currentBalanceFiat: Number(row['current_balance_fiat'] ?? 0),
    maxDailyCapFiat: Number(row['max_daily_cap_fiat'] ?? 0),
    monthlyLimitFiat: Number(row['monthly_limit_fiat'] ?? 0),
    feePct: Number(row['fee_pct'] ?? 0),
    maxBurstTx15m: Number(row['max_burst_tx_15m'] ?? 5),
    isActive: Boolean(row['is_active']),
    version: Number(row['version'] ?? 1),
    createdAt: toEpochMs(row['created_at']),
    updatedAt: toEpochMs(row['updated_at']),
  };
}

function mapTreasurySettlementRow(row: PgQueryResultRow): TreasurySettlementRecord {
  const rawWorkspace = row['workspace_id'];
  return {
    id: String(row['id']),
    workspaceId: isArmWorkspaceId(rawWorkspace) ? rawWorkspace : 'P2P_DESK',
    idempotencyKey: String(row['idempotency_key']),
    bankRailId: row['bank_rail_id'] != null ? String(row['bank_rail_id']) : null,
    dealId: row['deal_id'] != null ? String(row['deal_id']) : null,
    settlementType: String(row['settlement_type'] ?? 'P2P_RELEASE'),
    cryptoAmountUsdt: Number(row['crypto_amount_usdt'] ?? 0),
    fiatAmount: Number(row['fiat_amount'] ?? 0),
    fiatCurrency: String(row['fiat_currency'] ?? 'VES'),
    appliedRate: Number(row['applied_rate'] ?? 0),
    realizedProfitUsdt: Number(row['realized_profit_usdt'] ?? 0),
    status: String(row['status'] ?? 'SETTLED'),
    settledAt: toEpochMs(row['settled_at']),
  };
}

/**
 * PostgreSQL + pgvector persistence store for multi-workspace ARM/CRM operations.
 * Enforces strict silo isolation via transaction-local `app.current_workspace` RLS context.
 */
export class PgArmStore {
  private readonly databaseUrl: string;
  private readonly pool: PgPoolLike;
  private readonly createListenerClient: () => PgListenerClientLike;
  private listenerClient: PgListenerClientLike | null = null;

  constructor(databaseUrl: string, deps?: PgArmStoreDeps) {
    if (!databaseUrl || !databaseUrl.trim()) {
      throw new Error('DATABASE_URL must be a non-empty PostgreSQL connection string');
    }
    this.databaseUrl = databaseUrl.trim();
    this.pool =
      deps?.pool ??
      (new Pool({
        connectionString: this.databaseUrl,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }) as unknown as PgPoolLike);

    if (typeof this.pool.on === 'function') {
      this.pool.on('error', (err: Error) => {
        console.warn('[PgArmStore] Idle pool client error:', err.message);
      });
    }

    this.createListenerClient =
      deps?.createListenerClient ??
      (() => new Client({ connectionString: this.databaseUrl }) as unknown as PgListenerClientLike);
  }

  /**
   * Executes a callback inside a PostgreSQL transaction scoped to `workspaceId` via RLS.
   */
  async withWorkspaceTx<T>(
    workspaceId: ArmWorkspaceId,
    fn: (client: PgClientLike) => Promise<T>,
  ): Promise<T> {
    if (!isArmWorkspaceId(workspaceId)) {
      throw new Error(`Invalid workspaceId: ${String(workspaceId)}`);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_workspace', $1, true)", [workspaceId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve original transaction failure if rollback itself fails
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<PgHealthCheckResult> {
    const startedAt = Date.now();
    try {
      const res = await this.pool.query(`
        SELECT
          1 AS ping,
          EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector,
          COALESCE((
            SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname IN ('leads', 'outbox_events', 'payment_receipts', 'bank_rails')
          ), false) AS rls_active
      `);
      const row = res.rows[0];
      return {
        connected: true,
        latencyMs: Math.max(0, Date.now() - startedAt),
        rlsActive: Boolean(row?.['rls_active']),
        pgvectorInstalled: Boolean(row?.['has_vector']),
      };
    } catch (err: unknown) {
      return {
        connected: false,
        latencyMs: Math.max(0, Date.now() - startedAt),
        rlsActive: false,
        pgvectorInstalled: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async appendOutboxEvent(
    workspaceId: ArmWorkspaceId,
    eventType: ArmOutboxEventType,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<ArmOutboxSseEvent> {
    return this.withWorkspaceTx(workspaceId, async (client) => {
      const res = await client.query(
        `
        INSERT INTO outbox_events (workspace_id, event_type, aggregate_id, payload)
        VALUES ($1, $2, $3, $4::jsonb)
        RETURNING
          id,
          workspace_id,
          event_type,
          aggregate_id,
          payload,
          (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS ts_ms
        `,
        [workspaceId, eventType, aggregateId, JSON.stringify(payload ?? {})],
      );
      const row = res.rows[0];
      if (!row) {
        throw new Error('Failed to insert outbox event');
      }
      return mapOutboxRow(row);
    });
  }

  async getOutboxEventsSince(
    sinceId = 0,
    workspaceId?: ArmWorkspaceId,
  ): Promise<ArmOutboxSseEvent[]> {
    if (workspaceId) {
      return this.withWorkspaceTx(workspaceId, async (client) => {
        const res = await client.query(
          `
          SELECT id, workspace_id, event_type, aggregate_id, payload, created_at
          FROM outbox_events
          WHERE id > $1 AND workspace_id = $2
          ORDER BY id ASC
          LIMIT 500
          `,
          [sinceId, workspaceId],
        );
        return res.rows.map(mapOutboxRow);
      });
    }

    // Under FORCE ROW LEVEL SECURITY, iterate each silo inside a single pooled tx
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const collected: ArmOutboxSseEvent[] = [];
      for (const ws of ARM_WORKSPACE_IDS) {
        await client.query("SELECT set_config('app.current_workspace', $1, true)", [ws]);
        const res = await client.query(
          `
          SELECT id, workspace_id, event_type, aggregate_id, payload, created_at
          FROM outbox_events
          WHERE id > $1 AND workspace_id = $2
          ORDER BY id ASC
          LIMIT 500
          `,
          [sinceId, ws],
        );
        for (const row of res.rows) {
          collected.push(mapOutboxRow(row));
        }
      }
      await client.query('COMMIT');
      return collected.sort((a, b) => a.id - b.id);
    } catch (err: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async recordPaymentReceipt(
    input: RecordPaymentReceiptInput,
  ): Promise<RecordPaymentReceiptResult> {
    const normalizedReference = normalizeBankReference(input.referenceCode);
    if (!normalizedReference) {
      throw new Error('Invalid referenceCode: must contain alphanumeric characters');
    }

    try {
      const receipt = await this.withWorkspaceTx(input.workspaceId, async (client) => {
        const res = await client.query(
          `
          INSERT INTO payment_receipts (
            workspace_id, bank_rail_id, reference_code, amount_fiat,
            currency, deal_id, lead_id, sender_name, raw_text, channel, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'VERIFIED')
          RETURNING *
          `,
          [
            input.workspaceId,
            input.bankRailId.trim(),
            normalizedReference,
            input.amountFiat,
            (input.currency || 'VES').toUpperCase(),
            input.dealId?.trim() || null,
            input.leadId?.trim() || null,
            input.senderName?.trim() || null,
            input.rawText || null,
            (input.channel || 'MANUAL').toUpperCase(),
          ],
        );
        const row = res.rows[0];
        if (!row) {
          throw new Error('Failed to record payment receipt');
        }
        return mapPaymentReceiptRow(row);
      });

      return {
        recorded: true,
        collision: false,
        normalizedReference,
        receipt,
      };
    } catch (err: unknown) {
      if (!isPgUniqueViolation(err)) {
        throw err;
      }

      let existingReceiptId: string | undefined;
      try {
        existingReceiptId = await this.withWorkspaceTx(input.workspaceId, async (client) => {
          const existingRes = await client.query(
            `
            SELECT id FROM payment_receipts
            WHERE workspace_id = $1 AND bank_rail_id = $2 AND reference_code = $3
            LIMIT 1
            `,
            [input.workspaceId, input.bankRailId.trim(), normalizedReference],
          );
          const idVal = existingRes.rows[0]?.['id'];
          return idVal != null ? String(idVal) : undefined;
        });
      } catch {
        existingReceiptId = undefined;
      }

      return {
        recorded: false,
        collision: true,
        normalizedReference,
        existingReceiptId,
      };
    }
  }

  async upsertBankRail(input: BankRailUpsertInput): Promise<BankRailRecord> {
    const railId = input.id?.trim() || randomUUID();
    return this.withWorkspaceTx(input.workspaceId, async (client) => {
      const res = await client.query(
        `
        INSERT INTO bank_rails (
          id, workspace_id, bank_name, bank_code, rail_type, currency,
          holder_details_text, account_number_masked, current_balance_fiat,
          max_daily_cap_fiat, monthly_limit_fiat, fee_pct, max_burst_tx_15m, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          bank_name = EXCLUDED.bank_name,
          bank_code = EXCLUDED.bank_code,
          rail_type = EXCLUDED.rail_type,
          currency = EXCLUDED.currency,
          holder_details_text = EXCLUDED.holder_details_text,
          account_number_masked = EXCLUDED.account_number_masked,
          current_balance_fiat = EXCLUDED.current_balance_fiat,
          max_daily_cap_fiat = EXCLUDED.max_daily_cap_fiat,
          monthly_limit_fiat = EXCLUDED.monthly_limit_fiat,
          fee_pct = EXCLUDED.fee_pct,
          max_burst_tx_15m = EXCLUDED.max_burst_tx_15m,
          is_active = EXCLUDED.is_active,
          version = bank_rails.version + 1
        RETURNING *
        `,
        [
          railId,
          input.workspaceId,
          input.bankName.trim(),
          input.bankCode?.trim() ?? '',
          (input.railType || 'PAGO_MOVIL').toUpperCase(),
          (input.currency || 'VES').toUpperCase(),
          input.holderDetailsText ?? '',
          input.accountNumberMasked ?? '',
          input.currentBalanceFiat ?? 0,
          input.maxDailyCapFiat ?? 0,
          input.monthlyLimitFiat ?? 0,
          input.feePct ?? 0,
          input.maxBurstTx15m ?? 5,
          input.isActive ?? true,
        ],
      );
      const row = res.rows[0];
      if (!row) {
        throw new Error('Failed to upsert bank rail');
      }
      return mapBankRailRow(row);
    });
  }

  async listBankRails(workspaceId: ArmWorkspaceId): Promise<BankRailRecord[]> {
    return this.withWorkspaceTx(workspaceId, async (client) => {
      const res = await client.query(
        `
        SELECT * FROM bank_rails
        WHERE workspace_id = $1
        ORDER BY is_active DESC, updated_at DESC, bank_name ASC
        `,
        [workspaceId],
      );
      return res.rows.map(mapBankRailRow);
    });
  }

  async recordTreasurySettlement(
    input: TreasurySettlementInput,
  ): Promise<TreasurySettlementResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new Error('idempotencyKey is required for treasury settlements');
    }

    return this.withWorkspaceTx(input.workspaceId, async (client) => {
      const insertRes = await client.query(
        `
        INSERT INTO treasury_settlements (
          workspace_id, idempotency_key, bank_rail_id, deal_id, lead_id,
          settlement_type, crypto_amount_usdt, fiat_amount, fiat_currency,
          applied_rate, realized_profit_usdt, status, notes, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'SETTLED', $12, $13::jsonb)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING *
        `,
        [
          input.workspaceId,
          idempotencyKey,
          input.bankRailId?.trim() || null,
          input.dealId?.trim() || null,
          input.leadId?.trim() || null,
          (input.settlementType || 'P2P_RELEASE').toUpperCase(),
          input.cryptoAmountUsdt,
          input.fiatAmount,
          (input.fiatCurrency || 'VES').toUpperCase(),
          input.appliedRate ?? 0,
          input.realizedProfitUsdt ?? 0,
          input.notes || null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );

      if (insertRes.rows[0]) {
        return {
          recorded: true,
          duplicate: false,
          settlement: mapTreasurySettlementRow(insertRes.rows[0]),
        };
      }

      const existingRes = await client.query(
        `
        SELECT * FROM treasury_settlements
        WHERE workspace_id = $1 AND idempotency_key = $2
        LIMIT 1
        `,
        [input.workspaceId, idempotencyKey],
      );

      return {
        recorded: false,
        duplicate: true,
        settlement: existingRes.rows[0]
          ? mapTreasurySettlementRow(existingRes.rows[0])
          : undefined,
      };
    });
  }

  async startOutboxListener(
    onEvent: (event: ArmOutboxSseEvent) => void,
  ): Promise<OutboxListenerHandle> {
    if (this.listenerClient) {
      await this.stopActiveListener();
    }

    const client = this.createListenerClient();
    this.listenerClient = client;

    client.on('notification', (msg: Notification) => {
      if (msg.channel !== 'arm_outbox_channel' || !msg.payload) {
        return;
      }
      try {
        const parsed: unknown = JSON.parse(msg.payload);
        if (typeof parsed !== 'object' || parsed === null) return;
        const mapped = mapOutboxRow(parsed as PgQueryResultRow);
        onEvent(mapped);
      } catch (err: unknown) {
        console.warn(
          '[PgArmStore] Failed to parse arm_outbox_channel notification:',
          err instanceof Error ? err.message : String(err),
        );
      }
    });

    client.on('error', (err: Error) => {
      console.warn('[PgArmStore] Outbox listener client error:', err.message);
    });

    await client.connect();
    await client.query('LISTEN arm_outbox_channel');

    return {
      stop: async () => {
        if (this.listenerClient === client) {
          await this.stopActiveListener();
        }
      },
    };
  }

  async close(): Promise<void> {
    await this.stopActiveListener();
    await this.pool.end();
  }

  private async stopActiveListener(): Promise<void> {
    const client = this.listenerClient;
    this.listenerClient = null;
    if (!client) return;
    try {
      await client.query('UNLISTEN arm_outbox_channel');
    } catch {
      // Ignore if socket already closed
    }
    try {
      await client.end();
    } catch {
      // Ignore shutdown error
    }
  }
}
