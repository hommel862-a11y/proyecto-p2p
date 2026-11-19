import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  F360_LEDGER_ENTRY_TYPES,
  type Finance360AuditLogEntry,
  type Finance360AuditSummary,
  type Finance360EntityCounts,
  type Finance360LedgerEntryType,
  type Finance360SaveSnapshotResult,
  type Finance360SnapshotPayload,
  type Finance360StoredSnapshot,
} from '../../shared/types';

export const FINANCE_360_WORKSPACE_ID = 'FINANCE_360' as const;

const VALID_ENTRY_TYPES = new Set<string>(Object.values(F360_LEDGER_ENTRY_TYPES));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringOrDefault(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  return fallback;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toNullableFiniteNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toTimestampMs(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readRecordArray(
  obj: Record<string, unknown>,
  key: string,
  required: boolean,
): readonly Record<string, unknown>[] {
  const raw = obj[key];
  if (raw === undefined || raw === null) {
    if (required) {
      throw new Error(`finance360_repository: "${key}" must be an array`);
    }
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error(`finance360_repository: "${key}" must be an array`);
  }
  return raw.filter(isPlainObject);
}

function resolveLedgerEntryType(
  rawType: unknown,
  fallback: Finance360LedgerEntryType,
): Finance360LedgerEntryType {
  if (typeof rawType === 'string' && VALID_ENTRY_TYPES.has(rawType.toUpperCase())) {
    return rawType.toUpperCase() as Finance360LedgerEntryType;
  }
  return fallback;
}

function extractTriMonetary(item: Record<string, unknown>): {
  amountOriginal: number;
  currency: string;
  bcvRate: number | null;
  parallelRate: number | null;
  eurUsdRate: number | null;
  amountUsd: number;
  amountVes: number;
} {
  const tri = isPlainObject(item['triMonetary']) ? item['triMonetary'] : {};
  const amountOriginal = toFiniteNumber(
    tri['amount_original'] ?? item['amountOriginal'] ?? item['amount_original'],
    0,
  );
  const currency = toStringOrDefault(tri['currency'] ?? item['currency'], 'USD').toUpperCase();
  const bcvRate = toNullableFiniteNumber(tri['bcv_rate'] ?? item['bcvRate'] ?? item['bcv_rate']);
  const parallelRate = toNullableFiniteNumber(
    tri['parallel_rate'] ?? item['parallelRate'] ?? item['parallel_rate'],
  );
  const eurUsdRate = toNullableFiniteNumber(
    tri['eur_usd_rate'] ?? item['eurUsdRate'] ?? item['eur_usd_rate'],
  );
  const amountUsd = toFiniteNumber(
    tri['amount_usd'] ?? item['amountUsd'] ?? item['amount_usd'],
    0,
  );
  const amountVes = toFiniteNumber(
    tri['amount_ves'] ?? item['amountVes'] ?? item['amount_ves'],
    0,
  );
  return {
    amountOriginal,
    currency,
    bcvRate,
    parallelRate,
    eurUsdRate,
    amountUsd,
    amountVes,
  };
}

/**
 * Local-first SQLite repository for Finanzas 360 (`FINANCE_360` silo).
 * Atomically persists the canonical JSON state snapshot alongside normalized
 * relational index tables and writes institutional audit trail entries.
 */
export class Finance360Repository {
  constructor(private readonly db: DatabaseSync) {}

  getSnapshot(): Finance360StoredSnapshot | null {
    const row = this.db
      .prepare(
        `SELECT workspace_id, schema_version, snapshot_json, checksum, version, updated_at
         FROM f360_snapshots
         WHERE workspace_id = ?
         LIMIT 1`,
      )
      .get(FINANCE_360_WORKSPACE_ID) as Record<string, unknown> | undefined;

    if (!row) return null;

    let parsedSnapshot: Finance360SnapshotPayload;
    try {
      parsedSnapshot = JSON.parse(String(row['snapshot_json'])) as Finance360SnapshotPayload;
    } catch {
      throw new Error('finance360_repository: stored snapshot JSON is corrupted');
    }

    return {
      workspaceId: FINANCE_360_WORKSPACE_ID,
      version: Number(row['version'] ?? 1),
      schemaVersion: Number(row['schema_version'] ?? 2),
      checksum: String(row['checksum'] ?? ''),
      updatedAt: Number(row['updated_at'] ?? 0),
      snapshot: parsedSnapshot,
    };
  }

  saveSnapshot(snapshot: Finance360SnapshotPayload): Finance360SaveSnapshotResult {
    if (!isPlainObject(snapshot)) {
      throw new Error('finance360_repository: snapshot payload must be an object');
    }

    const rawRecord = snapshot as unknown as Record<string, unknown>;
    if (
      rawRecord['workspaceId'] !== undefined &&
      rawRecord['workspaceId'] !== FINANCE_360_WORKSPACE_ID
    ) {
      throw new Error(
        `finance360_repository: workspaceId must be ${FINANCE_360_WORKSPACE_ID}`,
      );
    }

    const assets = readRecordArray(rawRecord, 'assets', true);
    const liabilities = readRecordArray(rawRecord, 'liabilities', true);
    const incomes = readRecordArray(rawRecord, 'incomes', true);
    const expenses = readRecordArray(rawRecord, 'expenses', true);
    const explicitLedgerEntries = readRecordArray(rawRecord, 'ledgerEntries', false);
    const casheaPlans = readRecordArray(rawRecord, 'casheaPlans', true);
    const providers = readRecordArray(rawRecord, 'providers', true);
    const inventory = readRecordArray(rawRecord, 'inventory', true);
    const quotes = readRecordArray(rawRecord, 'quotes', true);
    const goals = readRecordArray(rawRecord, 'goals', false);
    const recurringRules = readRecordArray(rawRecord, 'recurringRules', false);
    const casheaMerchantSales = readRecordArray(rawRecord, 'casheaMerchantSales', false);

    const schemaVersion = Math.max(1, Math.round(toFiniteNumber(rawRecord['version'], 2)));
    const serialized = JSON.stringify(snapshot);
    const checksum = crypto.createHash('sha256').update(serialized).digest('hex');
    const now = Date.now();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `INSERT INTO f360_snapshots (
            workspace_id, schema_version, snapshot_json, checksum, version, updated_at
          ) VALUES (?, ?, ?, ?, 1, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            schema_version = excluded.schema_version,
            snapshot_json = excluded.snapshot_json,
            checksum = excluded.checksum,
            version = f360_snapshots.version + 1,
            updated_at = excluded.updated_at`,
        )
        .run(FINANCE_360_WORKSPACE_ID, schemaVersion, serialized, checksum, now);

      const snapMeta = this.db
        .prepare(`SELECT version FROM f360_snapshots WHERE workspace_id = ? LIMIT 1`)
        .get(FINANCE_360_WORKSPACE_ID) as { version: number };
      const nextVersion = Number(snapMeta.version);

      // Clear normalized relational tables for FINANCE_360 before re-indexing atomically
      const tablesToClear = [
        'f360_ledger_entries',
        'f360_liabilities',
        'f360_cashea_plans',
        'f360_quotes',
        'f360_providers',
        'f360_inventory_items',
        'f360_goals',
        'f360_recurring_rules',
        'f360_cashea_merchant_sales',
        'f360_vaults',
      ];
      for (const table of tablesToClear) {
        this.db
          .prepare(`DELETE FROM ${table} WHERE workspace_id = ?`)
          .run(FINANCE_360_WORKSPACE_ID);
      }

      // 1. Vaults
      const insertVault = this.db.prepare(
        `INSERT INTO f360_vaults (
          id, workspace_id, name, channel, scope, currency, vault_kind,
          balance, opening_balance, bank_code, account_number_masked,
          is_fixed_asset, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const vault of assets) {
        const id = toStringOrDefault(vault['id'], `vault-${crypto.randomUUID()}`);
        insertVault.run(
          id,
          FINANCE_360_WORKSPACE_ID,
          toStringOrDefault(vault['name'], 'Bóveda'),
          toStringOrDefault(vault['channel'], 'other'),
          toStringOrDefault(vault['scope'], 'personal'),
          toStringOrDefault(vault['currency'], 'USD').toUpperCase(),
          toStringOrDefault(vault['vaultKind'] ?? vault['vault_kind'], 'liquid'),
          toFiniteNumber(vault['balance'], 0),
          toFiniteNumber(vault['openingBalance'] ?? vault['opening_balance'], 0),
          typeof vault['bankCode'] === 'string'
            ? vault['bankCode'].trim()
            : typeof vault['bank_code'] === 'string'
              ? vault['bank_code'].trim()
              : '',
          typeof vault['accountNumberMasked'] === 'string'
            ? vault['accountNumberMasked'].trim()
            : typeof vault['account_number_masked'] === 'string'
              ? vault['account_number_masked'].trim()
              : '',
          vault['isFixedAsset'] === true || vault['is_fixed_asset'] === true ? 1 : 0,
          nextVersion,
          toTimestampMs(vault['updatedAt'] ?? vault['updated_at'], now),
        );
      }

      // 2. Ledger Entries (incomes + expenses + explicit double-entry ledger entries)
      const insertLedger = this.db.prepare(
        `INSERT INTO f360_ledger_entries (
          id, workspace_id, entry_type, entry_group_id, title, scope, category, channel,
          vault_id, liability_id, goal_id, quote_id, amount_original, currency,
          bcv_rate, parallel_rate, eur_usd_rate, amount_usd, amount_ves,
          entry_date, reference_number, notes, drawer_allocation, metadata_json,
          version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      const seenLedgerIds = new Set<string>();
      const combinedLedgerItems: Array<{
        item: Record<string, unknown>;
        defaultType: Finance360LedgerEntryType;
      }> = [
        ...incomes.map((item) => ({ item, defaultType: F360_LEDGER_ENTRY_TYPES.INCOME })),
        ...expenses.map((item) => ({ item, defaultType: F360_LEDGER_ENTRY_TYPES.EXPENSE })),
        ...explicitLedgerEntries.map((item) => ({
          item,
          defaultType: F360_LEDGER_ENTRY_TYPES.EXPENSE,
        })),
      ];

      let ledgerEntriesCount = 0;
      for (const { item, defaultType } of combinedLedgerItems) {
        const id = toStringOrDefault(item['id'], `entry-${crypto.randomUUID()}`);
        if (seenLedgerIds.has(id)) {
          continue;
        }
        seenLedgerIds.add(id);

        const entryType = resolveLedgerEntryType(
          item['entryType'] ?? item['entry_type'],
          defaultType,
        );
        const tri = extractTriMonetary(item);
        const entryDate = toStringOrDefault(
          item['date'] ?? item['entryDate'] ?? item['entry_date'],
          new Date(now).toISOString().slice(0, 10),
        );

        insertLedger.run(
          id,
          FINANCE_360_WORKSPACE_ID,
          entryType,
          toNullableString(item['entryGroupId'] ?? item['entry_group_id']),
          toStringOrDefault(item['title'], 'Movimiento'),
          toStringOrDefault(item['scope'], 'personal'),
          toStringOrDefault(item['category'], 'other'),
          toStringOrDefault(item['channel'], 'other'),
          toNullableString(item['vaultId'] ?? item['vault_id']),
          toNullableString(item['liabilityId'] ?? item['liability_id']),
          toNullableString(item['goalId'] ?? item['goal_id']),
          toNullableString(item['quoteId'] ?? item['quote_id']),
          tri.amountOriginal,
          tri.currency,
          tri.bcvRate,
          tri.parallelRate,
          tri.eurUsdRate,
          tri.amountUsd,
          tri.amountVes,
          entryDate,
          toNullableString(item['referenceNumber'] ?? item['reference_number']),
          toNullableString(item['notes']),
          toNullableString(item['drawerAllocation'] ?? item['drawer_allocation']),
          JSON.stringify(item['metadata'] ?? item['p2pBridgeMetadata'] ?? {}),
          nextVersion,
          toTimestampMs(item['createdAt'] ?? item['created_at'], now),
        );
        ledgerEntriesCount++;
      }

      // 3. Liabilities
      const insertLiability = this.db.prepare(
        `INSERT INTO f360_liabilities (
          id, workspace_id, title, creditor, scope, category, amount_usd, amount_ves,
          bcv_rate, due_date, status, amount_paid, remaining_amount,
          cashea_plan_id, provider_id, notes, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const liab of liabilities) {
        const tri = extractTriMonetary(liab);
        insertLiability.run(
          toStringOrDefault(liab['id'], `liab-${crypto.randomUUID()}`),
          FINANCE_360_WORKSPACE_ID,
          toStringOrDefault(liab['title'], 'Compromiso'),
          toStringOrDefault(liab['creditor'], 'Acreedor'),
          toStringOrDefault(liab['scope'], 'personal'),
          toStringOrDefault(liab['category'], 'other'),
          tri.amountUsd,
          tri.amountVes,
          tri.bcvRate,
          toStringOrDefault(
            liab['dueDate'] ?? liab['due_date'],
            new Date(now).toISOString().slice(0, 10),
          ),
          toStringOrDefault(liab['status'], 'pending'),
          toFiniteNumber(liab['amountPaid'] ?? liab['amount_paid'], 0),
          toFiniteNumber(liab['remainingAmount'] ?? liab['remaining_amount'], tri.amountUsd),
          toNullableString(liab['casheaPlanId'] ?? liab['cashea_plan_id']),
          toNullableString(liab['providerId'] ?? liab['provider_id']),
          toNullableString(liab['notes']),
          nextVersion,
          toTimestampMs(liab['updatedAt'] ?? liab['updated_at'], now),
        );
      }

      // 4. Cashea Plans
      const insertCasheaPlan = this.db.prepare(
        `INSERT INTO f360_cashea_plans (
          id, workspace_id, product_name, store_name, credit_line, club_level,
          total_price_usd, initial_pct, initial_payment_usd, installments_count,
          installment_amount_usd, start_date, status, installments_json, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const plan of casheaPlans) {
        insertCasheaPlan.run(
          toStringOrDefault(plan['id'], `cashea-${crypto.randomUUID()}`),
          FINANCE_360_WORKSPACE_ID,
          toStringOrDefault(plan['productName'] ?? plan['product_name'], 'Compra Cashea'),
          toStringOrDefault(plan['storeName'] ?? plan['store_name'], ''),
          toStringOrDefault(plan['creditLine'] ?? plan['credit_line'], 'principal'),
          Math.max(1, Math.min(6, Math.round(toFiniteNumber(plan['clubLevel'] ?? plan['club_level'], 1)))),
          toFiniteNumber(plan['totalPriceUsd'] ?? plan['total_price_usd'], 0),
          toFiniteNumber(plan['initialPercentage'] ?? plan['initialPct'] ?? plan['initial_pct'], 60),
          toFiniteNumber(plan['initialPaymentUsd'] ?? plan['initial_payment_usd'], 0),
          Math.max(1, Math.round(toFiniteNumber(plan['numberOfInstallments'] ?? plan['installmentsCount'] ?? plan['installments_count'], 3))),
          toFiniteNumber(plan['installmentAmountUsd'] ?? plan['installment_amount_usd'], 0),
          toStringOrDefault(
            plan['startDate'] ?? plan['start_date'],
            new Date(now).toISOString().slice(0, 10),
          ),
          toStringOrDefault(plan['status'], 'active'),
          JSON.stringify(Array.isArray(plan['installments']) ? plan['installments'] : []),
          nextVersion,
          toTimestampMs(plan['updatedAt'] ?? plan['createdAt'], now),
        );
      }

      // 5. Quotes
      const insertQuote = this.db.prepare(
        `INSERT INTO f360_quotes (
          id, workspace_id, quote_number, client_name, client_doc, quote_type,
          labor_type, line_items_json, totals_json, status, bcv_rate_applied,
          version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const quote of quotes) {
        const totalsPayload = {
          totalPriceUsd: toFiniteNumber(quote['totalPriceUsd'], 0),
          totalPriceVes: toFiniteNumber(quote['totalPriceVes'], 0),
          subtotalCostUsd: toFiniteNumber(quote['subtotalCostUsd'], 0),
          minimumAdvanceUsd: toFiniteNumber(quote['minimumAdvanceUsd'], 0),
        };
        insertQuote.run(
          toStringOrDefault(quote['id'], `quote-${crypto.randomUUID()}`),
          FINANCE_360_WORKSPACE_ID,
          toStringOrDefault(quote['quoteNumber'] ?? quote['quote_number'], `Q-${Date.now()}`),
          toStringOrDefault(quote['clientName'] ?? quote['client_name'], 'Cliente'),
          toNullableString(quote['clientDoc'] ?? quote['client_doc']),
          toStringOrDefault(quote['type'] ?? quote['quoteType'] ?? quote['quote_type'], 'custom_universal'),
          toStringOrDefault(quote['laborType'] ?? quote['labor_type'], 'project_fixed'),
          JSON.stringify(
            Array.isArray(quote['lineItems'])
              ? quote['lineItems']
              : Array.isArray(quote['materials'])
                ? quote['materials']
                : [],
          ),
          JSON.stringify(isPlainObject(quote['totals']) ? quote['totals'] : totalsPayload),
          toStringOrDefault(quote['status'], 'draft'),
          toFiniteNumber(quote['bcvRateApplied'] ?? quote['bcv_rate_applied'], 0),
          nextVersion,
          toTimestampMs(quote['updatedAt'] ?? quote['createdAt'], now),
        );
      }

      // 6. Providers
      const insertProvider = this.db.prepare(
        `INSERT INTO f360_providers (
          id, workspace_id, name, category, phone, bank_details,
          outstanding_debt_usd, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const provider of providers) {
        insertProvider.run(
          toStringOrDefault(provider['id'], `prov-${crypto.randomUUID()}`),
          FINANCE_360_WORKSPACE_ID,
          toStringOrDefault(provider['name'], 'Proveedor'),
          toStringOrDefault(provider['category'], 'general'),
          typeof provider['phone'] === 'string' ? provider['phone'].trim() : '',
          typeof provider['bankDetails'] === 'string'
            ? provider['bankDetails'].trim()
            : typeof provider['bank_details'] === 'string'
              ? provider['bank_details'].trim()
              : '',
          toFiniteNumber(provider['outstandingDebtUsd'] ?? provider['outstanding_debt_usd'], 0),
          nextVersion,
          toTimestampMs(provider['updatedAt'] ?? provider['createdAt'], now),
        );
      }

      // 7. Inventory Items
      const insertInventory = this.db.prepare(
        `INSERT INTO f360_inventory_items (
          id, workspace_id, name, sku, category, current_stock, minimum_stock,
          optimal_stock, unit_cost_usd, selling_price_usd, status, last_movement_at,
          version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of inventory) {
        insertInventory.run(
          toStringOrDefault(item['id'], `inv-${crypto.randomUUID()}`),
          FINANCE_360_WORKSPACE_ID,
          toStringOrDefault(item['name'], 'Artículo'),
          toNullableString(item['sku']),
          toStringOrDefault(item['category'], 'general'),
          toFiniteNumber(item['currentStock'] ?? item['current_stock'], 0),
          toFiniteNumber(item['minimumStock'] ?? item['minimum_stock'], 0),
          toFiniteNumber(item['optimalStock'] ?? item['optimal_stock'], 0),
          toFiniteNumber(item['unitCostUsd'] ?? item['unit_cost_usd'], 0),
          toFiniteNumber(item['sellingPriceUsd'] ?? item['selling_price_usd'], 0),
          toStringOrDefault(item['status'], 'optimal'),
          toNullableString(item['lastMovementAt'] ?? item['last_movement_at']),
          nextVersion,
          toTimestampMs(item['updatedAt'] ?? item['updated_at'], now),
        );
      }

      // 8. Goals
      const insertGoal = this.db.prepare(
        `INSERT INTO f360_goals (
          id, workspace_id, title, target_amount_usd, current_amount_usd,
          scope, deadline, category, vault_id, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const goal of goals) {
        insertGoal.run(
          toStringOrDefault(goal['id'], `goal-${crypto.randomUUID()}`),
          FINANCE_360_WORKSPACE_ID,
          toStringOrDefault(goal['title'], 'Meta'),
          toFiniteNumber(goal['targetAmountUsd'] ?? goal['target_amount_usd'], 0),
          toFiniteNumber(goal['currentAmountUsd'] ?? goal['current_amount_usd'], 0),
          toStringOrDefault(goal['scope'], 'personal'),
          toNullableString(goal['deadline']),
          toStringOrDefault(goal['category'], 'savings'),
          toNullableString(goal['vaultId'] ?? goal['vault_id']),
          nextVersion,
          toTimestampMs(goal['updatedAt'] ?? goal['createdAt'], now),
        );
      }

      // 9. Recurring Rules
      const insertRule = this.db.prepare(
        `INSERT INTO f360_recurring_rules (
          id, workspace_id, title, entry_type, scope, category, channel, vault_id,
          amount_original, currency, cadence, next_run_date, last_run_date,
          is_active, metadata_json, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const rule of recurringRules) {
        insertRule.run(
          toStringOrDefault(rule['id'], `rec-${crypto.randomUUID()}`),
          FINANCE_360_WORKSPACE_ID,
          toStringOrDefault(rule['title'], 'Regla recurrente'),
          toStringOrDefault(rule['entryType'] ?? rule['entry_type'], 'EXPENSE').toUpperCase(),
          toStringOrDefault(rule['scope'], 'personal'),
          toStringOrDefault(rule['category'], 'other'),
          toStringOrDefault(rule['channel'], 'other'),
          toNullableString(rule['vaultId'] ?? rule['vault_id']),
          toFiniteNumber(rule['amountOriginal'] ?? rule['amount_original'] ?? rule['amount'], 0),
          toStringOrDefault(rule['currency'], 'USD').toUpperCase(),
          toStringOrDefault(rule['cadence'], 'monthly'),
          toStringOrDefault(
            rule['nextRunDate'] ?? rule['next_run_date'],
            new Date(now).toISOString().slice(0, 10),
          ),
          toNullableString(rule['lastRunDate'] ?? rule['last_run_date']),
          rule['isActive'] === false || rule['is_active'] === false ? 0 : 1,
          JSON.stringify(rule['metadata'] ?? {}),
          nextVersion,
          toTimestampMs(rule['updatedAt'] ?? rule['createdAt'], now),
        );
      }

      // 10. Cashea Merchant Sales (Ally Mode)
      const insertMerchantSale = this.db.prepare(
        `INSERT INTO f360_cashea_merchant_sales (
          id, workspace_id, sale_date, concept, sale_amount_usd, replacement_cost_usd,
          bcv_rate, parallel_rate, initial_pct, installments_count,
          mdr_commission_pct, advance_fee_pct, uses_weekly_advance,
          net_profit_usd, status, metadata_json, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const sale of casheaMerchantSales) {
        insertMerchantSale.run(
          toStringOrDefault(sale['id'], `cms-${crypto.randomUUID()}`),
          FINANCE_360_WORKSPACE_ID,
          toStringOrDefault(
            sale['saleDate'] ?? sale['sale_date'],
            new Date(now).toISOString().slice(0, 10),
          ),
          toStringOrDefault(sale['concept'], 'Venta Aliado Cashea'),
          toFiniteNumber(sale['saleAmountUsd'] ?? sale['sale_amount_usd'], 0),
          toFiniteNumber(sale['replacementCostUsd'] ?? sale['replacement_cost_usd'], 0),
          toFiniteNumber(sale['bcvRate'] ?? sale['bcv_rate'], 0),
          toFiniteNumber(sale['parallelRate'] ?? sale['parallel_rate'], 0),
          toFiniteNumber(sale['initialPct'] ?? sale['initial_pct'], 40),
          Math.max(1, Math.round(toFiniteNumber(sale['installmentsCount'] ?? sale['installments_count'], 3))),
          toFiniteNumber(sale['mdrCommissionPct'] ?? sale['mdr_commission_pct'], 4),
          toFiniteNumber(sale['advanceFeePct'] ?? sale['advance_fee_pct'], 0),
          sale['usesWeeklyAdvance'] === true || sale['uses_weekly_advance'] === true ? 1 : 0,
          toFiniteNumber(sale['netProfitUsd'] ?? sale['net_profit_usd'], 0),
          toStringOrDefault(sale['status'], 'pending'),
          JSON.stringify(sale['metadata'] ?? {}),
          nextVersion,
          toTimestampMs(sale['updatedAt'] ?? sale['createdAt'], now),
        );
      }

      const counts: Finance360EntityCounts = {
        vaults: assets.length,
        ledgerEntries: ledgerEntriesCount,
        liabilities: liabilities.length,
        casheaPlans: casheaPlans.length,
        quotes: quotes.length,
        providers: providers.length,
        inventoryItems: inventory.length,
        goals: goals.length,
        recurringRules: recurringRules.length,
        casheaMerchantSales: casheaMerchantSales.length,
      };

      // Audit log tracking inside the same atomic transaction
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, timestamp, category, action, details, severity, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `f360-audit-${crypto.randomUUID()}`,
          new Date(now).toISOString(),
          FINANCE_360_WORKSPACE_ID,
          'SNAPSHOT_SAVED',
          JSON.stringify({
            workspaceId: FINANCE_360_WORKSPACE_ID,
            version: nextVersion,
            checksum,
            counts,
          }),
          'info',
          now,
        );

      this.db.exec('COMMIT');

      return {
        ok: true,
        workspaceId: FINANCE_360_WORKSPACE_ID,
        version: nextVersion,
        checksum,
        updatedAt: now,
        counts,
      };
    } catch (err: unknown) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore secondary rollback error
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`finance360_repository: failed to persist snapshot (${message})`, {
        cause: err,
      });
    }
  }

  listAuditSummary(limit = 20): Finance360AuditSummary {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const snapRow = this.db
      .prepare(
        `SELECT version, checksum, updated_at
         FROM f360_snapshots
         WHERE workspace_id = ?
         LIMIT 1`,
      )
      .get(FINANCE_360_WORKSPACE_ID) as Record<string, unknown> | undefined;

    const countTable = (table: string): number => {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS cnt FROM ${table} WHERE workspace_id = ?`)
        .get(FINANCE_360_WORKSPACE_ID) as { cnt: number };
      return Number(row?.cnt ?? 0);
    };

    const counts: Finance360EntityCounts = {
      vaults: countTable('f360_vaults'),
      ledgerEntries: countTable('f360_ledger_entries'),
      liabilities: countTable('f360_liabilities'),
      casheaPlans: countTable('f360_cashea_plans'),
      quotes: countTable('f360_quotes'),
      providers: countTable('f360_providers'),
      inventoryItems: countTable('f360_inventory_items'),
      goals: countTable('f360_goals'),
      recurringRules: countTable('f360_recurring_rules'),
      casheaMerchantSales: countTable('f360_cashea_merchant_sales'),
    };

    const auditRows = this.db
      .prepare(
        `SELECT id, timestamp, category, action, details, severity, created_at
         FROM audit_logs
         WHERE category = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(FINANCE_360_WORKSPACE_ID, safeLimit) as Array<Record<string, unknown>>;

    const recentAuditLogs: Finance360AuditLogEntry[] = auditRows.map((row) => ({
      id: String(row['id']),
      timestamp: String(row['timestamp']),
      category: String(row['category']),
      action: String(row['action']),
      details: row['details'] != null ? String(row['details']) : undefined,
      severity: String(row['severity'] ?? 'info'),
      createdAt: Number(row['created_at'] ?? 0),
    }));

    return {
      workspaceId: FINANCE_360_WORKSPACE_ID,
      snapshotVersion: snapRow ? Number(snapRow['version'] ?? 0) : 0,
      updatedAt: snapRow ? Number(snapRow['updated_at'] ?? 0) : null,
      checksum: snapRow ? String(snapRow['checksum'] ?? '') : null,
      counts,
      recentAuditLogs,
    };
  }
}
