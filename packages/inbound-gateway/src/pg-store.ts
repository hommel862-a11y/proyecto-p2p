import { createHash, randomUUID } from 'node:crypto';
import { Pool, Client, type Notification } from 'pg';
import {
  normalizeBankReference,
  type ArmWorkspaceId,
  type ArmOutboxEventType,
  type ArmOutboxSseEvent,
} from '@p2p/core';
import type { F360SnapshotPayload, F360StoredSnapshot } from './types.js';
import { resolvePgConnectionConfig, formatPgSslHint, type PgSslOption } from './pg-config.js';

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
  existingDealId?: string | null;
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

export type OutboxListenerState = 'connecting' | 'listening' | 'reconnecting' | 'stopped';

export interface StartOutboxListenerOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  retryOnInitialFailure?: boolean;
  onStateChange?: (state: OutboxListenerState, error?: Error) => void;
}

interface OutboxListenerSession {
  stopped: boolean;
  client: PgListenerClientLike | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectScheduled: boolean;
  attempt: number;
  onEvent: (event: ArmOutboxSseEvent) => void;
  options: StartOutboxListenerOptions;
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

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRecordArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecordObject) : [];
}

function toPgString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return fallback;
}

function toPgNullableString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function toFinitePgNumber(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toNullablePgNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function mapF360SnapshotRow(row: PgQueryResultRow): F360StoredSnapshot {
  const snapshotRecord = parseJsonRecord(row['snapshot_json']) as unknown as F360SnapshotPayload;
  return {
    workspaceId: 'FINANCE_360',
    version: Number(row['version'] ?? 1),
    schemaVersion: Number(row['schema_version'] ?? 2),
    checksum: String(row['checksum'] ?? ''),
    updatedAt: toEpochMs(row['updated_at']),
    snapshot: snapshotRecord,
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
  private readonly sslConfig?: PgSslOption;
  private readonly connectionWarnings: string[];
  private readonly pool: PgPoolLike;
  private readonly createListenerClient: () => PgListenerClientLike;
  private listenerClient: PgListenerClientLike | null = null;
  private listenerConnected = false;
  private activeListenerSession: OutboxListenerSession | null = null;

  constructor(databaseUrl: string, deps?: PgArmStoreDeps) {
    if (!databaseUrl || !databaseUrl.trim()) {
      throw new Error('DATABASE_URL must be a non-empty PostgreSQL connection string');
    }
    const resolved = resolvePgConnectionConfig(databaseUrl);
    this.databaseUrl = resolved.connectionString;
    this.sslConfig = resolved.ssl;
    this.connectionWarnings = resolved.warnings;
    this.pool =
      deps?.pool ??
      (new Pool({
        connectionString: this.databaseUrl,
        ...(this.sslConfig !== undefined ? { ssl: this.sslConfig } : {}),
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }) as unknown as PgPoolLike);

    if (typeof this.pool.on === 'function') {
      this.pool.on('error', (err: Error) => {
        console.warn('[PgArmStore] Idle pool client error:', formatPgSslHint(err));
      });
    }

    this.createListenerClient =
      deps?.createListenerClient ??
      (() =>
        new Client({
          connectionString: this.databaseUrl,
          ...(this.sslConfig !== undefined ? { ssl: this.sslConfig } : {}),
        }) as unknown as PgListenerClientLike);
  }

  getConnectionWarnings(): string[] {
    return [...this.connectionWarnings];
  }

  isOutboxListenerConnected(): boolean {
    return this.listenerConnected;
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
      let existingDealId: string | null;
      try {
        const found = await this.withWorkspaceTx(input.workspaceId, async (client) => {
          const existingRes = await client.query(
            `
            SELECT id, deal_id FROM payment_receipts
            WHERE workspace_id = $1 AND bank_rail_id = $2 AND reference_code = $3
            LIMIT 1
            `,
            [input.workspaceId, input.bankRailId.trim(), normalizedReference],
          );
          const idVal = existingRes.rows[0]?.['id'];
          const dealVal = existingRes.rows[0]?.['deal_id'];
          return {
            receiptId: idVal != null ? String(idVal) : undefined,
            dealId: dealVal != null ? String(dealVal) : null,
          };
        });
        existingReceiptId = found.receiptId;
        existingDealId = found.dealId;
      } catch {
        existingReceiptId = undefined;
        existingDealId = null;
      }

      return {
        recorded: false,
        collision: true,
        normalizedReference,
        existingReceiptId,
        existingDealId,
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

  async getFinance360Snapshot(): Promise<F360StoredSnapshot | null> {
    return this.withWorkspaceTx('FINANCE_360', async (client) => {
      const res = await client.query(
        `
        SELECT workspace_id, schema_version, snapshot_json, checksum, version, updated_at
        FROM f360_snapshots
        WHERE workspace_id = $1
        LIMIT 1
        `,
        ['FINANCE_360'],
      );
      const row = res.rows[0];
      if (!row) return null;
      return mapF360SnapshotRow(row);
    });
  }

  async saveFinance360Snapshot(snapshot: F360SnapshotPayload): Promise<F360StoredSnapshot> {
    if (!isRecordObject(snapshot)) {
      throw new Error('Invalid Finance 360 snapshot payload');
    }
    const raw = snapshot as unknown as Record<string, unknown>;
    if (raw['workspaceId'] !== undefined && raw['workspaceId'] !== 'FINANCE_360') {
      throw new Error('Finance 360 snapshot must target workspace FINANCE_360');
    }

    const schemaVersion = Math.max(1, Math.round(toFinitePgNumber(raw['version'], 2)));
    const serialized = JSON.stringify(snapshot);
    const checksum = createHash('sha256').update(serialized).digest('hex');

    const assets = toRecordArray(raw['assets']);
    const liabilities = toRecordArray(raw['liabilities']);
    const incomes = toRecordArray(raw['incomes']);
    const expenses = toRecordArray(raw['expenses']);
    const explicitLedger = toRecordArray(raw['ledgerEntries']);
    const casheaPlans = toRecordArray(raw['casheaPlans']);
    const providers = toRecordArray(raw['providers']);
    const inventory = toRecordArray(raw['inventory']);
    const quotes = toRecordArray(raw['quotes']);
    const goals = toRecordArray(raw['goals']);
    const recurringRules = toRecordArray(raw['recurringRules']);
    const casheaMerchantSales = toRecordArray(raw['casheaMerchantSales']);
    const casheaProfile = isRecordObject(raw['casheaProfile']) ? raw['casheaProfile'] : null;

    return this.withWorkspaceTx('FINANCE_360', async (client) => {
      const snapRes = await client.query(
        `
        INSERT INTO f360_snapshots (workspace_id, schema_version, snapshot_json, checksum, version)
        VALUES ($1, $2, $3::jsonb, $4, 1)
        ON CONFLICT (workspace_id) DO UPDATE SET
          schema_version = EXCLUDED.schema_version,
          snapshot_json = EXCLUDED.snapshot_json,
          checksum = EXCLUDED.checksum,
          version = f360_snapshots.version + 1
        RETURNING workspace_id, schema_version, snapshot_json, checksum, version, updated_at
        `,
        ['FINANCE_360', schemaVersion, serialized, checksum],
      );

      const savedRow = snapRes.rows[0];
      if (!savedRow) {
        throw new Error('Failed to persist Finance 360 snapshot');
      }

      const nextVersion = Number(savedRow['version'] ?? 1);

      // Sync normalized relational tables atomically under FINANCE_360 RLS
      const clearTables = [
        'f360_ledger_entries',
        'f360_liabilities',
        'f360_cashea_installments',
        'f360_cashea_plans',
        'f360_cashea_merchant_sales',
        'f360_providers',
        'f360_inventory_items',
        'f360_quotes',
        'f360_goals',
        'f360_recurring_rules',
        'f360_vaults',
      ];
      for (const table of clearTables) {
        await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, ['FINANCE_360']);
      }

      for (const vault of assets) {
        await client.query(
          `
          INSERT INTO f360_vaults (
            id, workspace_id, name, channel, scope, currency, vault_kind,
            balance, opening_balance, bank_code, account_number_masked,
            is_fixed_asset, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `,
          [
            toPgString(vault['id'], randomUUID()),
            'FINANCE_360',
            toPgString(vault['name'], 'Bóveda'),
            toPgString(vault['channel'], 'other'),
            toPgString(vault['scope'], 'personal'),
            toPgString(vault['currency'], 'USD').toUpperCase(),
            toPgString(vault['vaultKind'] ?? vault['vault_kind'], 'liquid'),
            toFinitePgNumber(vault['balance'], 0),
            toFinitePgNumber(vault['openingBalance'] ?? vault['opening_balance'], 0),
            typeof vault['bankCode'] === 'string' ? vault['bankCode'].trim() : '',
            typeof vault['accountNumberMasked'] === 'string'
              ? vault['accountNumberMasked'].trim()
              : '',
            vault['isFixedAsset'] === true,
            nextVersion,
          ],
        );
      }

      const seenEntryIds = new Set<string>();
      const ledgerItems: Array<{ item: Record<string, unknown>; defaultType: string }> = [
        ...incomes.map((item) => ({ item, defaultType: 'INCOME' })),
        ...expenses.map((item) => ({ item, defaultType: 'EXPENSE' })),
        ...explicitLedger.map((item) => ({ item, defaultType: 'EXPENSE' })),
      ];

      const todayIso = new Date().toISOString().slice(0, 10);
      for (const { item, defaultType } of ledgerItems) {
        const id = toPgString(item['id'], randomUUID());
        if (seenEntryIds.has(id)) continue;
        seenEntryIds.add(id);

        const tri = isRecordObject(item['triMonetary']) ? item['triMonetary'] : {};
        const rawEntryType = toPgString(item['entryType'] ?? item['entry_type'], defaultType).toUpperCase();
        const entryType = [
          'INCOME',
          'EXPENSE',
          'TRANSFER_OUT',
          'TRANSFER_IN',
          'GOAL_RESERVE',
        ].includes(rawEntryType)
          ? rawEntryType
          : defaultType;

        await client.query(
          `
          INSERT INTO f360_ledger_entries (
            id, workspace_id, entry_type, entry_group_id, title, scope, category, channel,
            vault_id, liability_id, goal_id, quote_id, amount_original, currency,
            bcv_rate, parallel_rate, eur_usd_rate, amount_usd, amount_ves,
            entry_date, reference_number, notes, drawer_allocation, metadata, version
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19,
            $20, $21, $22, $23, $24::jsonb, $25
          )
          `,
          [
            id,
            'FINANCE_360',
            entryType,
            toPgNullableString(item['entryGroupId'] ?? item['entry_group_id']),
            toPgString(item['title'], 'Movimiento'),
            toPgString(item['scope'], 'personal'),
            toPgString(item['category'], 'other'),
            toPgString(item['channel'], 'other'),
            toPgNullableString(item['vaultId'] ?? item['vault_id']),
            toPgNullableString(item['liabilityId'] ?? item['liability_id']),
            toPgNullableString(item['goalId'] ?? item['goal_id']),
            toPgNullableString(item['quoteId'] ?? item['quote_id']),
            toFinitePgNumber(tri['amount_original'] ?? item['amountOriginal'], 0),
            toPgString(tri['currency'] ?? item['currency'], 'USD').toUpperCase(),
            toNullablePgNumber(tri['bcv_rate'] ?? item['bcvRate']),
            toNullablePgNumber(tri['parallel_rate'] ?? item['parallelRate']),
            toNullablePgNumber(tri['eur_usd_rate'] ?? item['eurUsdRate']),
            toFinitePgNumber(tri['amount_usd'] ?? item['amountUsd'], 0),
            toFinitePgNumber(tri['amount_ves'] ?? item['amountVes'], 0),
            toPgString(item['date'] ?? item['entryDate'] ?? item['entry_date'], todayIso),
            toPgNullableString(item['referenceNumber'] ?? item['reference_number']),
            toPgNullableString(item['notes']),
            toPgNullableString(item['drawerAllocation'] ?? item['drawer_allocation']),
            JSON.stringify(item['metadata'] ?? item['p2pBridgeMetadata'] ?? {}),
            nextVersion,
          ],
        );
      }

      for (const liab of liabilities) {
        const tri = isRecordObject(liab['triMonetary']) ? liab['triMonetary'] : {};
        await client.query(
          `
          INSERT INTO f360_liabilities (
            id, workspace_id, title, creditor, scope, category, amount_usd, amount_ves,
            bcv_rate, due_date, status, amount_paid, remaining_amount,
            cashea_plan_id, provider_id, notes, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          `,
          [
            toPgString(liab['id'], randomUUID()),
            'FINANCE_360',
            toPgString(liab['title'], 'Compromiso'),
            toPgString(liab['creditor'], 'Acreedor'),
            toPgString(liab['scope'], 'personal'),
            toPgString(liab['category'], 'other'),
            toFinitePgNumber(tri['amount_usd'] ?? liab['amountUsd'], 0),
            toFinitePgNumber(tri['amount_ves'] ?? liab['amountVes'], 0),
            toNullablePgNumber(tri['bcv_rate'] ?? liab['bcvRate']),
            toPgString(liab['dueDate'] ?? liab['due_date'], todayIso),
            toPgString(liab['status'], 'pending'),
            toFinitePgNumber(liab['amountPaid'] ?? liab['amount_paid'], 0),
            toFinitePgNumber(
              liab['remainingAmount'] ?? liab['remaining_amount'],
              toFinitePgNumber(tri['amount_usd'], 0),
            ),
            toPgNullableString(liab['casheaPlanId'] ?? liab['cashea_plan_id']),
            toPgNullableString(liab['providerId'] ?? liab['provider_id']),
            toPgNullableString(liab['notes']),
            nextVersion,
          ],
        );
      }

      if (casheaProfile) {
        await client.query(
          `
          INSERT INTO f360_cashea_profiles (
            workspace_id, club_level, principal_limit_usd, cotidiana_limit_usd,
            total_paid_usd, paid_installments_count, next_recalc_date,
            merchant_mode_enabled, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (workspace_id) DO UPDATE SET
            club_level = EXCLUDED.club_level,
            principal_limit_usd = EXCLUDED.principal_limit_usd,
            cotidiana_limit_usd = EXCLUDED.cotidiana_limit_usd,
            total_paid_usd = EXCLUDED.total_paid_usd,
            paid_installments_count = EXCLUDED.paid_installments_count,
            next_recalc_date = EXCLUDED.next_recalc_date,
            merchant_mode_enabled = EXCLUDED.merchant_mode_enabled,
            version = f360_cashea_profiles.version + 1
          `,
          [
            'FINANCE_360',
            Math.max(1, Math.min(6, Math.round(toFinitePgNumber(casheaProfile['clubLevel'], 1)))),
            toFinitePgNumber(casheaProfile['principalLimitUsd'], 0),
            toFinitePgNumber(casheaProfile['cotidianaLimitUsd'], 0),
            toFinitePgNumber(casheaProfile['totalPaidUsd'], 0),
            Math.max(0, Math.round(toFinitePgNumber(casheaProfile['paidInstallmentsCount'], 0))),
            toPgNullableString(casheaProfile['nextRecalcDate']),
            casheaProfile['merchantModeEnabled'] === true,
            nextVersion,
          ],
        );
      }

      for (const plan of casheaPlans) {
        const planId = toPgString(plan['id'], randomUUID());
        const creditLine = toPgString(plan['creditLine'] ?? plan['credit_line'], 'principal');
        const clubLevel = Math.max(
          1,
          Math.min(6, Math.round(toFinitePgNumber(plan['clubLevel'] ?? plan['club_level'], 1))),
        );
        const initialPct = toFinitePgNumber(plan['initialPercentage'] ?? plan['initialPct'], 60);
        const initialPaymentUsd = toFinitePgNumber(plan['initialPaymentUsd'], 0);

        await client.query(
          `
          INSERT INTO f360_cashea_plans (
            id, workspace_id, product_name, store_name, credit_line, club_level,
            total_price_usd, initial_pct, initial_payment_usd, installments_count,
            installment_amount_usd, installment_frequency_days, start_date, status, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          `,
          [
            planId,
            'FINANCE_360',
            toPgString(plan['productName'] ?? plan['product_name'], 'Compra Cashea'),
            toPgString(plan['storeName'] ?? plan['store_name'], ''),
            creditLine,
            clubLevel,
            toFinitePgNumber(plan['totalPriceUsd'], 0),
            initialPct,
            initialPaymentUsd,
            Math.max(1, Math.round(toFinitePgNumber(plan['numberOfInstallments'], 3))),
            toFinitePgNumber(plan['installmentAmountUsd'], 0),
            Math.max(1, Math.round(toFinitePgNumber(plan['installmentFrequencyDays'], 14))),
            toPgString(plan['startDate'] ?? plan['start_date'], todayIso),
            toPgString(plan['status'], 'active'),
            nextVersion,
          ],
        );

        const installments = toRecordArray(plan['installments']);
        for (const inst of installments) {
          await client.query(
            `
            INSERT INTO f360_cashea_installments (
              workspace_id, plan_id, installment_number, credit_line, club_level,
              initial_pct, initial_payment_usd, status, due_date, amount_usd,
              amount_paid_usd, paid_ves, bcv_rate_applied, reactivation_fee_usd, version
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            `,
            [
              'FINANCE_360',
              planId,
              Math.max(1, Math.round(toFinitePgNumber(inst['number'] ?? inst['installmentNumber'], 1))),
              creditLine,
              clubLevel,
              initialPct,
              initialPaymentUsd,
              toPgString(inst['status'], 'pending'),
              toPgString(inst['dueDate'] ?? inst['due_date'], todayIso),
              toFinitePgNumber(inst['amountUsd'], 0),
              toFinitePgNumber(inst['amountPaidUsd'], 0),
              toNullablePgNumber(inst['paidVes']),
              toNullablePgNumber(inst['bcvRateApplied']),
              toFinitePgNumber(inst['reactivationFeeUsd'], 0),
              nextVersion,
            ],
          );
        }
      }

      for (const sale of casheaMerchantSales) {
        await client.query(
          `
          INSERT INTO f360_cashea_merchant_sales (
            id, workspace_id, sale_date, concept, sale_amount_usd, replacement_cost_usd,
            bcv_rate, parallel_rate, initial_pct, installments_count,
            mdr_commission_pct, advance_fee_pct, uses_weekly_advance,
            net_profit_usd, status, metadata, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17)
          `,
          [
            toPgString(sale['id'], randomUUID()),
            'FINANCE_360',
            toPgString(sale['saleDate'] ?? sale['sale_date'], todayIso),
            toPgString(sale['concept'], 'Venta Aliado'),
            toFinitePgNumber(sale['saleAmountUsd'], 0),
            toFinitePgNumber(sale['replacementCostUsd'], 0),
            toFinitePgNumber(sale['bcvRate'], 0),
            toFinitePgNumber(sale['parallelRate'], 0),
            toFinitePgNumber(sale['initialPct'], 40),
            Math.max(1, Math.round(toFinitePgNumber(sale['installmentsCount'], 3))),
            toFinitePgNumber(sale['mdrCommissionPct'], 4),
            toFinitePgNumber(sale['advanceFeePct'], 0),
            sale['usesWeeklyAdvance'] === true,
            toFinitePgNumber(sale['netProfitUsd'], 0),
            toPgString(sale['status'], 'pending'),
            JSON.stringify(sale['metadata'] ?? {}),
            nextVersion,
          ],
        );
      }

      for (const provider of providers) {
        await client.query(
          `
          INSERT INTO f360_providers (
            id, workspace_id, name, category, phone, bank_details, outstanding_debt_usd, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            toPgString(provider['id'], randomUUID()),
            'FINANCE_360',
            toPgString(provider['name'], 'Proveedor'),
            toPgString(provider['category'], 'general'),
            typeof provider['phone'] === 'string' ? provider['phone'].trim() : '',
            typeof provider['bankDetails'] === 'string' ? provider['bankDetails'].trim() : '',
            toFinitePgNumber(provider['outstandingDebtUsd'], 0),
            nextVersion,
          ],
        );
      }

      for (const item of inventory) {
        await client.query(
          `
          INSERT INTO f360_inventory_items (
            id, workspace_id, name, sku, category, current_stock, minimum_stock,
            optimal_stock, unit_cost_usd, selling_price_usd, status, last_movement_at, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `,
          [
            toPgString(item['id'], randomUUID()),
            'FINANCE_360',
            toPgString(item['name'], 'Artículo'),
            toPgNullableString(item['sku']),
            toPgString(item['category'], 'general'),
            toFinitePgNumber(item['currentStock'], 0),
            toFinitePgNumber(item['minimumStock'], 0),
            toFinitePgNumber(item['optimalStock'], 0),
            toFinitePgNumber(item['unitCostUsd'], 0),
            toFinitePgNumber(item['sellingPriceUsd'], 0),
            toPgString(item['status'], 'optimal'),
            toPgNullableString(item['lastMovementAt'] ?? item['last_movement_at']),
            nextVersion,
          ],
        );
      }

      for (const quote of quotes) {
        await client.query(
          `
          INSERT INTO f360_quotes (
            id, workspace_id, quote_number, client_name, client_doc, quote_type,
            labor_type, line_items, totals, status, bcv_rate_applied, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)
          `,
          [
            toPgString(quote['id'], randomUUID()),
            'FINANCE_360',
            toPgString(quote['quoteNumber'] ?? quote['quote_number'], `Q-${Date.now()}`),
            toPgString(quote['clientName'] ?? quote['client_name'], 'Cliente'),
            toPgNullableString(quote['clientDoc'] ?? quote['client_doc']),
            toPgString(quote['type'] ?? quote['quoteType'], 'custom_universal'),
            toPgString(quote['laborType'] ?? quote['labor_type'], 'project_fixed'),
            JSON.stringify(Array.isArray(quote['lineItems']) ? quote['lineItems'] : []),
            JSON.stringify(
              isRecordObject(quote['totals'])
                ? quote['totals']
                : { totalPriceUsd: toFinitePgNumber(quote['totalPriceUsd'], 0) },
            ),
            toPgString(quote['status'], 'draft'),
            toFinitePgNumber(quote['bcvRateApplied'], 0),
            nextVersion,
          ],
        );
      }

      for (const goal of goals) {
        await client.query(
          `
          INSERT INTO f360_goals (
            id, workspace_id, title, target_amount_usd, current_amount_usd,
            scope, deadline, category, vault_id, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `,
          [
            toPgString(goal['id'], randomUUID()),
            'FINANCE_360',
            toPgString(goal['title'], 'Meta'),
            toFinitePgNumber(goal['targetAmountUsd'], 0),
            toFinitePgNumber(goal['currentAmountUsd'], 0),
            toPgString(goal['scope'], 'personal'),
            toPgNullableString(goal['deadline']),
            toPgString(goal['category'], 'savings'),
            toPgNullableString(goal['vaultId'] ?? goal['vault_id']),
            nextVersion,
          ],
        );
      }

      for (const rule of recurringRules) {
        await client.query(
          `
          INSERT INTO f360_recurring_rules (
            id, workspace_id, title, entry_type, scope, category, channel, vault_id,
            amount_original, currency, cadence, next_run_date, last_run_date,
            is_active, metadata, version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16)
          `,
          [
            toPgString(rule['id'], randomUUID()),
            'FINANCE_360',
            toPgString(rule['title'], 'Regla recurrente'),
            toPgString(rule['entryType'] ?? rule['entry_type'], 'EXPENSE').toUpperCase(),
            toPgString(rule['scope'], 'personal'),
            toPgString(rule['category'], 'other'),
            toPgString(rule['channel'], 'other'),
            toPgNullableString(rule['vaultId'] ?? rule['vault_id']),
            toFinitePgNumber(rule['amountOriginal'] ?? rule['amount'], 0),
            toPgString(rule['currency'], 'USD').toUpperCase(),
            toPgString(rule['cadence'], 'monthly'),
            toPgString(rule['nextRunDate'] ?? rule['next_run_date'], todayIso),
            toPgNullableString(rule['lastRunDate'] ?? rule['last_run_date']),
            rule['isActive'] !== false,
            JSON.stringify(rule['metadata'] ?? {}),
            nextVersion,
          ],
        );
      }

      return mapF360SnapshotRow(savedRow);
    });
  }

  async startOutboxListener(
    onEvent: (event: ArmOutboxSseEvent) => void,
    options: StartOutboxListenerOptions = {},
  ): Promise<OutboxListenerHandle> {
    if (this.activeListenerSession || this.listenerClient) {
      await this.stopActiveListener();
    }

    const session: OutboxListenerSession = {
      stopped: false,
      client: null,
      reconnectTimer: null,
      reconnectScheduled: false,
      attempt: 0,
      onEvent,
      options,
    };
    this.activeListenerSession = session;

    await this.connectOutboxSession(session, true);

    return {
      stop: async () => {
        if (this.activeListenerSession === session) {
          await this.stopActiveListener();
        }
      },
    };
  }

  async close(): Promise<void> {
    await this.stopActiveListener();
    await this.pool.end();
  }

  private notifyListenerState(
    session: OutboxListenerSession,
    state: OutboxListenerState,
    error?: Error,
  ): void {
    try {
      session.options.onStateChange?.(state, error);
    } catch {
      // Never let telemetry callbacks break listener lifecycle
    }
  }

  private async connectOutboxSession(
    session: OutboxListenerSession,
    isInitialAttempt: boolean,
  ): Promise<void> {
    if (session.stopped || this.activeListenerSession !== session) {
      return;
    }

    const client = this.createListenerClient();
    session.client = client;
    this.listenerClient = client;
    this.notifyListenerState(session, 'connecting');

    const handleDisconnect = (err?: Error) => {
      if (
        session.stopped ||
        this.activeListenerSession !== session ||
        session.client !== client
      ) {
        return;
      }
      session.client = null;
      if (this.listenerClient === client) {
        this.listenerClient = null;
      }
      this.listenerConnected = false;
      void client.end().catch(() => undefined);
      this.scheduleOutboxReconnect(session, err);
    };

    client.on('notification', (msg: Notification) => {
      if (session.stopped || msg.channel !== 'arm_outbox_channel' || !msg.payload) {
        return;
      }
      try {
        const parsed: unknown = JSON.parse(msg.payload);
        if (typeof parsed !== 'object' || parsed === null) return;
        const mapped = mapOutboxRow(parsed as PgQueryResultRow);
        session.onEvent(mapped);
      } catch (err: unknown) {
        console.warn(
          '[PgArmStore] Failed to parse arm_outbox_channel notification:',
          err instanceof Error ? err.message : String(err),
        );
      }
    });

    client.on('error', (err: Error) => {
      console.warn('[PgArmStore] Outbox listener client error:', formatPgSslHint(err));
      handleDisconnect(err);
    });

    const eventEmitter = client as unknown as {
      on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    };
    if (typeof eventEmitter.on === 'function') {
      eventEmitter.on('end', () => {
        handleDisconnect();
      });
    }

    try {
      await client.connect();
      if (session.stopped || this.activeListenerSession !== session) {
        await client.end().catch(() => undefined);
        return;
      }
      await client.query('LISTEN arm_outbox_channel');
      if (session.stopped || this.activeListenerSession !== session) {
        await client.end().catch(() => undefined);
        return;
      }
      session.attempt = 0;
      this.listenerConnected = true;
      this.notifyListenerState(session, 'listening');
    } catch (err: unknown) {
      const normalizedErr = err instanceof Error ? err : new Error(String(err));
      session.client = null;
      if (this.listenerClient === client) {
        this.listenerClient = null;
      }
      this.listenerConnected = false;
      await client.end().catch(() => undefined);

      if (session.stopped || this.activeListenerSession !== session) {
        return;
      }

      if (isInitialAttempt && !session.options.retryOnInitialFailure) {
        await this.stopActiveListener();
        throw err;
      }

      this.scheduleOutboxReconnect(session, normalizedErr);
    }
  }

  private scheduleOutboxReconnect(session: OutboxListenerSession, error?: Error): void {
    if (
      session.stopped ||
      session.reconnectScheduled ||
      this.activeListenerSession !== session
    ) {
      return;
    }

    session.reconnectScheduled = true;
    const baseDelayMs = Math.max(10, session.options.baseDelayMs ?? 1_000);
    const maxDelayMs = Math.max(baseDelayMs, session.options.maxDelayMs ?? 30_000);
    const jitterRatio = Math.max(0, session.options.jitterRatio ?? 0.2);
    const rawDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** session.attempt);
    const jitter = jitterRatio > 0 ? Math.round(rawDelay * jitterRatio * Math.random()) : 0;
    const delayMs = Math.min(maxDelayMs, rawDelay + jitter);
    session.attempt += 1;

    this.notifyListenerState(session, 'reconnecting', error);
    session.reconnectTimer = setTimeout(() => {
      session.reconnectTimer = null;
      session.reconnectScheduled = false;
      if (!session.stopped && this.activeListenerSession === session) {
        void this.connectOutboxSession(session, false);
      }
    }, delayMs);
    if (typeof session.reconnectTimer.unref === 'function') {
      session.reconnectTimer.unref();
    }
  }

  private async stopActiveListener(): Promise<void> {
    const session = this.activeListenerSession;
    this.activeListenerSession = null;
    const client = session?.client ?? this.listenerClient;
    this.listenerClient = null;
    this.listenerConnected = false;

    if (session) {
      session.stopped = true;
      session.client = null;
      session.reconnectScheduled = false;
      if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
      }
      this.notifyListenerState(session, 'stopped');
    }

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
