import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinanceDriveSyncService } from './finance-drive-sync.service';

describe('FinanceDriveSyncService', () => {
  let service: FinanceDriveSyncService;
  let mockFinance: any;
  let mockToast: any;

  beforeEach(() => {
    mockFinance = {
      state: vi.fn().mockReturnValue({
        version: 1,
        expenses: [
          {
            id: 'exp-1',
            date: '2026-10-15',
            title: 'Gasolina',
            scope: 'personal',
            category: 'transport',
            triMonetary: { amount_usd: 15, amount_ves: 900 },
            channel: 'cash',
            notes: 'Test note',
          },
        ],
        incomes: [],
        liabilities: [],
        quotes: [],
        assets: [],
      }),
      totalAssetsUsd: vi.fn().mockReturnValue(1000),
      totalLiabilitiesUsd: vi.fn().mockReturnValue(200),
      netWorthUsd: vi.fn().mockReturnValue(800),
      currentBcvRate: vi.fn().mockReturnValue(60),
    };

    mockToast = {
      success: vi.fn(),
      error: vi.fn(),
    };

    service = new FinanceDriveSyncService(mockFinance, mockToast);
  });

  it('should generate proper hierarchical folder paths by date and category', () => {
    const fixedDate = new Date('2026-10-15T12:00:00Z');
    const path = service.getFolderHierarchy('receipts', fixedDate);
    expect(path).toContain('/Finanzas_360/2026/10_Octubre/Recibos_Efectivo/');
  });

  it('should generate complete JSON backup with metadata', () => {
    const jsonStr = service.generateMasterLedgerJson();
    const parsed = JSON.parse(jsonStr);
    expect(parsed.metadata.app).toBe('HOMEL 360 Suite');
    expect(parsed.metadata.netWorthUsd).toBe(800);
    expect(parsed.ledger.expenses.length).toBe(1);
  });

  it('should export clean CSV for expenses', () => {
    const csv = service.exportLedgerAsCsv('expenses');
    expect(csv).toContain('ID,Fecha,Titulo,Ambito,Categoria');
    expect(csv).toContain('exp-1,2026-10-15,"Gasolina",personal,transport,15.00,900.00,cash,"Test note"');
  });

  it('should execute cloud sync simulation and update status', async () => {
    const syncPromise = service.triggerCloudSync();
    expect(service.syncStatus()).toBe('syncing');

    const result = await syncPromise;
    expect(result.success).toBe(true);
    expect(result.filesCount).toBe(1);
    expect(service.syncStatus()).toBe('synced');
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('should call McpService gdriveSyncDbBackup when mcp service is provided', async () => {
    const mockMcp = {
      gdriveSyncDbBackup: vi.fn().mockResolvedValue({ success: true }),
    };
    const mcpService = new FinanceDriveSyncService(mockFinance, mockToast, mockMcp as any);
    const result = await mcpService.triggerCloudSync();
    expect(result.success).toBe(true);
    expect(mockMcp.gdriveSyncDbBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        backupType: 'ledger_json',
      }),
    );
  });
});
