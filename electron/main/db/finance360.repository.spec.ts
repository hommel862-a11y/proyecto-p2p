import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  ipcHandlers,
  browserWindowInstances,
  browserWindowOptionsHistory,
  printToPdfMock,
  loadUrlMock,
  isEncryptionAvailableMock,
  encryptStringMock,
  decryptStringMock,
  netFetchMock,
  MockBrowserWindow,
  isolatedUserDataDir,
} = vi.hoisted(() => {
  const osMod = require('node:os') as typeof import('node:os');
  const fsMod = require('node:fs') as typeof import('node:fs');
  const pathMod = require('node:path') as typeof import('node:path');
  const tempUserData = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'f360-ipc-spec-'));

  const browserWindowInstancesLocal: Array<{
    destroyed: boolean;
    destroy: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    webContents: { printToPDF: ReturnType<typeof vi.fn> };
  }> = [];
  const browserWindowOptionsHistoryLocal: Array<Record<string, unknown>> = [];
  const printToPdfMockLocal = vi.fn(async () => Buffer.from('%PDF-1.4-mock-bytes'));
  const loadUrlMockLocal = vi.fn(async () => undefined);

  class MockBrowserWindowClass {
    destroyed = false;
    readonly destroy = vi.fn(() => {
      this.destroyed = true;
    });
    readonly isDestroyed = vi.fn(() => this.destroyed);
    readonly loadURL = loadUrlMockLocal;
    readonly webContents = {
      printToPDF: printToPdfMockLocal,
    };

    constructor(options: Record<string, unknown>) {
      browserWindowOptionsHistoryLocal.push(options);
      browserWindowInstancesLocal.push(this);
    }
  }

  return {
    ipcHandlers: new Map<string, (event: unknown, params?: unknown) => unknown>(),
    browserWindowInstances: browserWindowInstancesLocal,
    browserWindowOptionsHistory: browserWindowOptionsHistoryLocal,
    printToPdfMock: printToPdfMockLocal,
    loadUrlMock: loadUrlMockLocal,
    isEncryptionAvailableMock: vi.fn(() => false),
    encryptStringMock: vi.fn((plain: string) => Buffer.from(`enc:${plain}`)),
    decryptStringMock: vi.fn((buf: Buffer) => buf.toString().replace(/^enc:/, '')),
    netFetchMock: vi.fn(),
    MockBrowserWindow: MockBrowserWindowClass,
    isolatedUserDataDir: tempUserData,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, params?: unknown) => unknown) => {
      ipcHandlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      ipcHandlers.delete(channel);
    },
  },
  app: { getVersion: () => '1.5.1', getPath: () => isolatedUserDataDir, isPackaged: false },
  net: { fetch: netFetchMock },
  safeStorage: {
    isEncryptionAvailable: () => isEncryptionAvailableMock(),
    encryptString: (plain: string) => encryptStringMock(plain),
    decryptString: (buf: Buffer) => decryptStringMock(buf),
  },
  desktopCapturer: { getSources: async () => [] },
  BrowserWindow: MockBrowserWindow,
}));

import { Finance360Repository } from './finance360.repository';
import { P2PDatabaseService } from './database';
import { registerIpcHandlers, getDbService } from '../ipc/handlers';
import type { Finance360SnapshotPayload } from '../../shared/types';

function createSampleSnapshot(
  overrides: Partial<Finance360SnapshotPayload> = {},
): Finance360SnapshotPayload {
  return {
    version: 2,
    assets: [
      {
        id: 'vault-banesco-ves',
        name: 'Banesco Operaciones',
        channel: 'bs_bank',
        scope: 'business',
        currency: 'VES',
        vaultKind: 'liquid',
        balance: 185000,
        openingBalance: 100000,
        bankCode: '0134',
        accountNumberMasked: '****4421',
        isFixedAsset: false,
        updatedAt: '2026-11-18T14:00:00-04:00',
      },
      {
        id: 'vault-zelle-usd',
        name: 'Zelle Tesorería',
        channel: 'zelle',
        scope: 'personal',
        currency: 'USD',
        vaultKind: 'reserve',
        balance: 2450.5,
        openingBalance: 2000,
        isFixedAsset: false,
        updatedAt: '2026-11-18T14:00:00-04:00',
      },
    ],
    liabilities: [
      {
        id: 'liab-cashea-1',
        title: 'Cuota 1/3 Cashea Laptop',
        creditor: 'Cashea',
        scope: 'personal',
        category: 'cashea',
        triMonetary: {
          amount_original: 120,
          currency: 'USD',
          bcv_rate: 45.2,
          parallel_rate: 52.5,
          amount_usd: 120,
          amount_ves: 5424,
        },
        dueDate: '2026-12-02',
        status: 'pending',
        amountPaid: 0,
        remainingAmount: 120,
        casheaPlanId: 'cashea-plan-1',
        notes: 'Línea Principal Nivel 6',
      },
    ],
    incomes: [
      {
        id: 'inc-1',
        title: 'Anticipo Presupuesto Q-2026-001',
        scope: 'business',
        category: 'quote_advance',
        channel: 'zelle',
        vaultId: 'vault-zelle-usd',
        quoteId: 'quote-1',
        triMonetary: {
          amount_original: 450.5,
          currency: 'USD',
          bcv_rate: 45.2,
          parallel_rate: 52.5,
          eur_usd_rate: 1.08,
          amount_usd: 450.5,
          amount_ves: 20362.6,
        },
        date: '2026-11-18',
        referenceNumber: 'ZLL-889900',
        notes: 'Anticipo 50% cliente corporativo',
        createdAt: '2026-11-18T13:30:00-04:00',
      },
    ],
    expenses: [
      {
        id: 'exp-1',
        title: 'Compra mercancía proveedor',
        scope: 'business',
        category: 'provider_merchandise',
        channel: 'bs_bank',
        vaultId: 'vault-banesco-ves',
        liabilityId: 'liab-cashea-1',
        triMonetary: {
          amount_original: 9040,
          currency: 'VES',
          bcv_rate: 45.2,
          parallel_rate: 52.5,
          amount_usd: 200,
          amount_ves: 9040,
        },
        date: '2026-11-18',
        referenceNumber: 'PM-776655',
        drawerAllocation: 'drawer_merchandise',
        createdAt: '2026-11-18T13:45:00-04:00',
      },
    ],
    ledgerEntries: [
      {
        id: 'xfer-out-1',
        entryType: 'TRANSFER_OUT',
        entryGroupId: 'grp-xfer-1',
        title: 'Transferencia hacia Zelle',
        scope: 'business',
        category: 'transfer',
        channel: 'bs_bank',
        vaultId: 'vault-banesco-ves',
        triMonetary: {
          amount_original: 4520,
          currency: 'VES',
          bcv_rate: 45.2,
          parallel_rate: 52.5,
          amount_usd: 100,
          amount_ves: 4520,
        },
        date: '2026-11-18',
        referenceNumber: 'XFER-1001',
      },
      {
        id: 'xfer-in-1',
        entryType: 'TRANSFER_IN',
        entryGroupId: 'grp-xfer-1',
        title: 'Transferencia desde Banesco',
        scope: 'personal',
        category: 'transfer',
        channel: 'zelle',
        vaultId: 'vault-zelle-usd',
        triMonetary: {
          amount_original: 100,
          currency: 'USD',
          bcv_rate: 45.2,
          parallel_rate: 52.5,
          amount_usd: 100,
          amount_ves: 4520,
        },
        date: '2026-11-18',
        referenceNumber: 'XFER-1001',
      },
    ],
    casheaPlans: [
      {
        id: 'cashea-plan-1',
        productName: 'Laptop Workstation',
        storeName: 'TechStore VE',
        creditLine: 'principal',
        clubLevel: 6,
        totalPriceUsd: 600,
        initialPercentage: 40,
        initialPaymentUsd: 240,
        numberOfInstallments: 3,
        installmentAmountUsd: 120,
        installmentFrequencyDays: 14,
        startDate: '2026-11-18',
        status: 'active',
        installments: [
          { number: 1, dueDate: '2026-12-02', amountUsd: 120, status: 'pending' },
          { number: 2, dueDate: '2026-12-16', amountUsd: 120, status: 'pending' },
          { number: 3, dueDate: '2026-12-30', amountUsd: 120, status: 'pending' },
        ],
      },
    ],
    providers: [
      {
        id: 'prov-1',
        name: 'Distribuidora Central C.A.',
        category: 'Insumos',
        phone: '+584141112233',
        bankDetails: 'Banesco 0134-****-0011',
        outstandingDebtUsd: 350,
      },
    ],
    inventory: [
      {
        id: 'inv-1',
        name: 'Pintura Automotriz Galón',
        sku: 'PNT-001',
        category: 'Insumos',
        currentStock: 14,
        minimumStock: 5,
        optimalStock: 20,
        unitCostUsd: 28,
        sellingPriceUsd: 45,
        status: 'optimal',
        lastMovementAt: '2026-09-01T10:00:00-04:00',
      },
    ],
    quotes: [
      {
        id: 'quote-1',
        quoteNumber: 'Q-2026-001',
        clientName: 'Inversiones Bolívar C.A.',
        clientDoc: 'J-40123456-7',
        type: 'automotive_bodywork',
        laborType: 'commission',
        lineItems: [{ id: 'li-1', category: 'material', name: 'Pintura', quantity: 2, unit: 'gal', unitCostUsd: 45 }],
        totalPriceUsd: 901,
        minimumAdvanceUsd: 450.5,
        bcvRateApplied: 45.2,
        status: 'approved',
      },
    ],
    goals: [
      {
        id: 'goal-1',
        title: 'Fondo de Emergencia 6M',
        targetAmountUsd: 5000,
        currentAmountUsd: 1250,
        scope: 'personal',
        deadline: '2027-06-01',
        category: 'emergency',
      },
    ],
    recurringRules: [
      {
        id: 'rec-1',
        title: 'Alquiler Galpón Pyme',
        entryType: 'EXPENSE',
        scope: 'business',
        category: 'rent',
        channel: 'zelle',
        vaultId: 'vault-zelle-usd',
        amountOriginal: 350,
        currency: 'USD',
        cadence: 'monthly',
        nextRunDate: '2026-12-01',
        isActive: true,
      },
    ],
    casheaProfile: {
      clubLevel: 6,
      principalLimitUsd: 1200,
      cotidianaLimitUsd: 350,
      totalPaidUsd: 2800,
      paidInstallmentsCount: 24,
      nextRecalcDate: '2027-01-15',
      merchantModeEnabled: true,
    },
    casheaMerchantSales: [
      {
        id: 'cms-1',
        saleDate: '2026-11-18',
        concept: 'Venta Aliado #104',
        saleAmountUsd: 250,
        replacementCostUsd: 145,
        bcvRate: 45.2,
        parallelRate: 52.5,
        initialPct: 40,
        installmentsCount: 3,
        mdrCommissionPct: 4,
        advanceFeePct: 2.5,
        usesWeeklyAdvance: true,
        netProfitUsd: 78.4,
        status: 'pending',
      },
    ],
    lastUpdated: '2026-11-18T14:05:00-04:00',
    ...overrides,
  };
}

describe('Finance360Repository (Electron SQLite Institutional Mirror)', () => {
  let db: DatabaseSync;
  let repo: Finance360Repository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    const schemaSql = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8');
    db.exec(schemaSql);
    repo = new Finance360Repository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns null when no snapshot has been persisted yet', () => {
    expect(repo.getSnapshot()).toBeNull();
    const summary = repo.listAuditSummary();
    expect(summary.workspaceId).toBe('FINANCE_360');
    expect(summary.snapshotVersion).toBe(0);
    expect(summary.counts.vaults).toBe(0);
    expect(summary.counts.ledgerEntries).toBe(0);
  });

  it('atomically saves full JSON snapshot, syncs all 10 relational tables under FINANCE_360, and logs audit trail', () => {
    const sample = createSampleSnapshot();
    const saved = repo.saveSnapshot(sample);

    expect(saved.ok).toBe(true);
    expect(saved.workspaceId).toBe('FINANCE_360');
    expect(saved.version).toBe(1);
    expect(saved.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.counts).toEqual({
      vaults: 2,
      ledgerEntries: 4,
      liabilities: 1,
      casheaPlans: 1,
      quotes: 1,
      providers: 1,
      inventoryItems: 1,
      goals: 1,
      recurringRules: 1,
      casheaMerchantSales: 1,
    });

    const loaded = repo.getSnapshot();
    expect(loaded).not.toBeNull();
    expect(loaded?.workspaceId).toBe('FINANCE_360');
    expect(loaded?.version).toBe(1);
    expect(loaded?.checksum).toBe(saved.checksum);
    expect(loaded?.snapshot.assets).toHaveLength(2);
    expect(loaded?.snapshot.casheaMerchantSales).toHaveLength(1);
    expect(loaded?.snapshot.recurringRules).toHaveLength(1);

    // Verify normalized relational tables directly in SQLite
    const ledgerTypes = (
      db
        .prepare('SELECT entry_type FROM f360_ledger_entries WHERE workspace_id = ? ORDER BY id ASC')
        .all('FINANCE_360') as Array<{ entry_type: string }>
    )
      .map((r) => r.entry_type)
      .sort();
    expect(ledgerTypes).toEqual(['EXPENSE', 'INCOME', 'TRANSFER_IN', 'TRANSFER_OUT']);

    const inventoryRow = db
      .prepare('SELECT last_movement_at, current_stock FROM f360_inventory_items WHERE id = ?')
      .get('inv-1') as { last_movement_at: string; current_stock: number };
    expect(inventoryRow.last_movement_at).toBe('2026-09-01T10:00:00-04:00');
    expect(inventoryRow.current_stock).toBe(14);

    // Second save increments version and updates counts cleanly
    const secondSave = repo.saveSnapshot(
      createSampleSnapshot({ goals: [], recurringRules: [] }),
    );
    expect(secondSave.version).toBe(2);
    expect(secondSave.counts.goals).toBe(0);
    expect(secondSave.counts.recurringRules).toBe(0);

    const summary = repo.listAuditSummary(10);
    expect(summary.snapshotVersion).toBe(2);
    expect(summary.counts.goals).toBe(0);
    expect(summary.recentAuditLogs.length).toBeGreaterThanOrEqual(2);
    expect(summary.recentAuditLogs[0].category).toBe('FINANCE_360');
    expect(summary.recentAuditLogs[0].action).toBe('SNAPSHOT_SAVED');
  });

  it('rolls back atomically on duplicate referenceNumber inside the same vault without corrupting prior snapshot', () => {
    const initial = createSampleSnapshot();
    const first = repo.saveSnapshot(initial);
    expect(first.version).toBe(1);

    const duplicateRefSnapshot = createSampleSnapshot({
      incomes: [
        ...initial.incomes,
        {
          id: 'inc-replay',
          title: 'Ingreso Duplicado',
          scope: 'business',
          category: 'business_sale',
          channel: 'zelle',
          vaultId: 'vault-zelle-usd',
          triMonetary: {
            amount_original: 100,
            currency: 'USD',
            bcv_rate: 45.2,
            parallel_rate: 52.5,
            amount_usd: 100,
            amount_ves: 4520,
          },
          date: '2026-11-18',
          referenceNumber: 'ZLL-889900',
        },
      ],
    });

    expect(() => repo.saveSnapshot(duplicateRefSnapshot)).toThrow(/finance360_repository/i);

    // Prior state must remain intact after rollback
    const afterFailure = repo.getSnapshot();
    expect(afterFailure?.version).toBe(1);
    expect(afterFailure?.snapshot.incomes).toHaveLength(1);
  });

  it('rejects non-FINANCE_360 workspace payloads and malformed inputs', () => {
    expect(() => repo.saveSnapshot(null as unknown as Finance360SnapshotPayload)).toThrow(
      /finance360_repository/i,
    );
    expect(() =>
      repo.saveSnapshot({
        ...createSampleSnapshot(),
        workspaceId: 'P2P_DESK',
      } as unknown as Finance360SnapshotPayload),
    ).toThrow(/FINANCE_360/);
  });

  it('wires into P2PDatabaseService via db.finance360 and db.getFinance360Repo()', () => {
    const service = new P2PDatabaseService(':memory:');
    try {
      expect(service.finance360).toBe(service.getFinance360Repo());
      const result = service.finance360.saveSnapshot(createSampleSnapshot());
      expect(result.ok).toBe(true);
      expect(service.finance360.getSnapshot()?.version).toBe(1);
    } finally {
      service.close();
    }
  });

  it('keeps schema.sql and database.ts fallback DDL identical for Finance 360 SQLite mirror tables', () => {
    const schemaSql = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8');
    const databaseTs = fs.readFileSync(path.resolve(__dirname, 'database.ts'), 'utf8');

    const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
    const startMarker = 'CREATE TABLE IF NOT EXISTS f360_snapshots';
    const endMarker =
      'CREATE INDEX IF NOT EXISTS idx_f360_merchant_sales_workspace_date ON f360_cashea_merchant_sales(workspace_id, sale_date DESC);';

    const schemaStart = schemaSql.indexOf(startMarker);
    const schemaEnd = schemaSql.indexOf(endMarker);
    const dbStart = databaseTs.indexOf(startMarker);
    const dbEnd = databaseTs.indexOf(endMarker);

    expect(schemaStart).toBeGreaterThan(-1);
    expect(schemaEnd).toBeGreaterThan(schemaStart);
    expect(dbStart).toBeGreaterThan(-1);
    expect(dbEnd).toBeGreaterThan(dbStart);

    const schemaSlice = schemaSql.slice(schemaStart, schemaEnd + endMarker.length);
    const dbSlice = databaseTs.slice(dbStart, dbEnd + endMarker.length);
    expect(normalize(dbSlice)).toBe(normalize(schemaSlice));
  });

  it('ships idempotent PostgreSQL 17 RLS migration 003_finance360_institutional_ledger.sql with all required tables and policies', () => {
    const migrationPath = path.resolve(
      __dirname,
      'migrations/003_finance360_institutional_ledger.sql',
    );
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain('NUMERIC(18, 6)');
    expect(sql).toContain('set_updated_at()');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('workspace_silo_isolation');
    expect(sql).toContain("current_setting(''app.current_workspace'', true)");
    expect(sql).toContain('UNIQUE (plan_id, installment_number)');
    expect(sql).toMatch(/reference_number IS NOT NULL AND reference_number <> ''/);

    const requiredTables = [
      'f360_snapshots',
      'f360_vaults',
      'f360_ledger_entries',
      'f360_liabilities',
      'f360_cashea_profiles',
      'f360_cashea_plans',
      'f360_cashea_installments',
      'f360_cashea_merchant_sales',
      'f360_pyme_drawers_ledger',
      'f360_providers',
      'f360_inventory_items',
      'f360_quotes',
      'f360_goals',
      'f360_recurring_rules',
      'f360_vault_reconciliations',
    ];
    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(sql).toContain(`'${table}'`);
    }
  });
});

describe('Finance 360 Electron IPC Handlers (f360:*)', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    browserWindowInstances.length = 0;
    browserWindowOptionsHistory.length = 0;
    printToPdfMock.mockReset();
    printToPdfMock.mockResolvedValue(Buffer.from('%PDF-1.4-mock-bytes'));
    loadUrlMock.mockReset();
    loadUrlMock.mockResolvedValue(undefined);
    netFetchMock.mockReset();
    isEncryptionAvailableMock.mockReturnValue(false);
    delete process.env['GEMINI_API_KEY'];
    registerIpcHandlers();
  });

  afterEach(() => {
    delete process.env['GEMINI_API_KEY'];
  });

  it('handles f360:save-snapshot and f360:get-snapshot through the SQLite repository', async () => {
    const saveHandler = ipcHandlers.get('f360:save-snapshot');
    const getHandler = ipcHandlers.get('f360:get-snapshot');
    expect(saveHandler).toBeDefined();
    expect(getHandler).toBeDefined();

    const saved = (await saveHandler!(null, createSampleSnapshot())) as {
      ok: boolean;
      workspaceId: string;
      version: number;
    };
    expect(saved.ok).toBe(true);
    expect(saved.workspaceId).toBe('FINANCE_360');
    expect(saved.version).toBeGreaterThanOrEqual(1);

    const loaded = (await getHandler!(null)) as {
      workspaceId: string;
      snapshot: Finance360SnapshotPayload;
    } | null;
    expect(loaded).not.toBeNull();
    expect(loaded?.workspaceId).toBe('FINANCE_360');
    expect(loaded?.snapshot.assets).toHaveLength(2);
  });

  it('proxies f360:ai-analyze in main process using x-goog-api-key header, no query string key, and model fallback', async () => {
    const aiHandler = ipcHandlers.get('f360:ai-analyze');
    expect(aiHandler).toBeDefined();

    // Fail-closed when no Gemini key is configured anywhere
    const db = getDbService();
    db.deleteConfigValue('ai_api_key_gemini');
    db.deleteConfigValue('gemini_api_key');
    const noKeyRes = (await aiHandler!(null, { prompt: 'Clasifica este recibo' })) as {
      ok: boolean;
      error?: string;
    };
    expect(noKeyRes.ok).toBe(false);
    expect(noKeyRes.error).toMatch(/GEMINI_API_KEY/i);
    expect(netFetchMock).not.toHaveBeenCalled();

    // Configure key in env and verify fallback gemini-2.5-flash -> gemini-2.0-flash
    process.env['GEMINI_API_KEY'] = 'gm-secret-main-key';
    netFetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'service unavailable',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '{"amount": 12.5, "currency": "USD"}' }],
              },
            },
          ],
        }),
      } as unknown as Response);

    const aiRes = (await aiHandler!(null, {
      prompt: 'Extrae el monto',
      inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' },
      temperature: 0.1,
      responseMimeType: 'application/json',
    })) as { ok: boolean; text: string; model: string; error?: string };

    expect(aiRes.ok).toBe(true);
    expect(aiRes.model).toBe('gemini-2.0-flash');
    expect(aiRes.text).toBe('{"amount": 12.5, "currency": "USD"}');
    expect(netFetchMock).toHaveBeenCalledTimes(2);

    const [firstUrl, firstInit] = netFetchMock.mock.calls[0] as [string, RequestInit];
    const [secondUrl, secondInit] = netFetchMock.mock.calls[1] as [string, RequestInit];
    expect(firstUrl).toContain('gemini-2.5-flash:generateContent');
    expect(secondUrl).toContain('gemini-2.0-flash:generateContent');
    expect(firstUrl).not.toContain('key=');
    expect(secondUrl).not.toContain('key=');
    expect((firstInit.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'gm-secret-main-key',
    );
    expect((secondInit.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'gm-secret-main-key',
    );
  });

  it('exports PDF via hidden sandboxed BrowserWindow with javascript disabled and destroys window even on error', async () => {
    const pdfHandler = ipcHandlers.get('f360:export-pdf');
    expect(pdfHandler).toBeDefined();

    // Reject empty/invalid html
    const invalidRes = (await pdfHandler!(null, { html: '   ' })) as {
      ok: boolean;
      error?: string;
    };
    expect(invalidRes.ok).toBe(false);
    expect(browserWindowInstances).toHaveLength(0);

    // Happy path
    const okRes = (await pdfHandler!(null, {
      html: '<html><body><h1>Presupuesto Q-2026-001</h1></body></html>',
      filename: 'presupuesto-q1.pdf',
    })) as { ok: boolean; base64?: string; filename?: string };

    expect(okRes.ok).toBe(true);
    expect(okRes.base64).toBe(Buffer.from('%PDF-1.4-mock-bytes').toString('base64'));
    expect(okRes.filename).toBe('presupuesto-q1.pdf');
    expect(browserWindowOptionsHistory).toHaveLength(1);
    const webPrefs = browserWindowOptionsHistory[0]['webPreferences'] as Record<string, unknown>;
    expect(browserWindowOptionsHistory[0]['show']).toBe(false);
    expect(webPrefs['javascript']).toBe(false);
    expect(webPrefs['nodeIntegration']).toBe(false);
    expect(webPrefs['contextIsolation']).toBe(true);
    expect(webPrefs['sandbox']).toBe(true);
    expect(loadUrlMock).toHaveBeenCalledWith(
      expect.stringMatching(/^data:text\/html;charset=utf-8,/),
    );
    expect(printToPdfMock).toHaveBeenCalledWith(
      expect.objectContaining({ printBackground: true, pageSize: 'Letter' }),
    );
    expect(browserWindowInstances[0].destroy).toHaveBeenCalledTimes(1);

    // Error path: window MUST still be destroyed in finally
    printToPdfMock.mockRejectedValueOnce(new Error('print spool failed'));
    const failRes = (await pdfHandler!(null, {
      html: '<html><body><p>Falla</p></body></html>',
    })) as { ok: boolean; error?: string };
    expect(failRes.ok).toBe(false);
    expect(failRes.error).toContain('print spool failed');
    expect(browserWindowInstances[1].destroy).toHaveBeenCalledTimes(1);
  });

  it('reads encrypted Gemini key from safeStorage secretStore when process.env.GEMINI_API_KEY is unset', async () => {
    isEncryptionAvailableMock.mockReturnValue(true);
    const db = getDbService();
    db.setConfigValue('ai_api_key_gemini', Buffer.from('enc:gm-vault-encrypted-key').toString('base64'));
    db.setConfigValue('ai_api_key_scheme_gemini', 'safeStorage:v1');
    delete process.env['GEMINI_API_KEY'];

    netFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'ok-from-safe-storage' }] } }],
      }),
    } as unknown as Response);

    const aiHandler = ipcHandlers.get('f360:ai-analyze');
    const res = (await aiHandler!(null, { prompt: 'Resume flujo' })) as {
      ok: boolean;
      text: string;
      model: string;
    };

    expect(res.ok).toBe(true);
    expect(res.text).toBe('ok-from-safe-storage');
    expect(res.model).toBe('gemini-2.5-flash');
    const [, init] = netFetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'gm-vault-encrypted-key',
    );
  });

  afterAll(() => {
    try {
      getDbService().close();
    } catch {
      // Ignore already closed db
    }
    try {
      if (fs.existsSync(isolatedUserDataDir)) {
        fs.rmSync(isolatedUserDataDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore temp cleanup failure on Windows handle lag
    }
    void os.tmpdir();
  });
});
