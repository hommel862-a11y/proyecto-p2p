import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FinanceDriveSyncService } from './finance-drive-sync.service';
import { Finance360Service } from '../finance-360.service';
import { ToastService } from '../toast.service';
import { McpService } from '../mcp.service';
import { StorageService } from '../storage';

describe('FinanceDriveSyncService', () => {
  let storageMap: Map<string, unknown>;
  let mockStorage: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let mockFinance: {
    state: ReturnType<typeof vi.fn>;
    totalAssetsUsd: ReturnType<typeof vi.fn>;
    totalLiabilitiesUsd: ReturnType<typeof vi.fn>;
    netWorthUsd: ReturnType<typeof vi.fn>;
    currentBcvRate: ReturnType<typeof vi.fn>;
    restoreLedgerState: ReturnType<typeof vi.fn>;
  };
  let mockToast: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };

  function createService(mcpProvider: unknown = null): FinanceDriveSyncService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        FinanceDriveSyncService,
        { provide: Finance360Service, useValue: mockFinance },
        { provide: ToastService, useValue: mockToast },
        { provide: McpService, useValue: mcpProvider },
        { provide: StorageService, useValue: mockStorage },
      ],
    });
    return TestBed.inject(FinanceDriveSyncService);
  }

  beforeEach(() => {
    storageMap = new Map<string, unknown>();
    mockStorage = {
      get: vi.fn((key: string) => (storageMap.has(key) ? storageMap.get(key) : null)),
      set: vi.fn((key: string, val: unknown) => {
        storageMap.set(key, val);
      }),
      remove: vi.fn((key: string) => {
        storageMap.delete(key);
      }),
    };

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
        incomes: [
          {
            id: 'inc-1',
            date: '2026-10-15',
            title: '+SUM(A1:A2)',
            scope: 'business',
            category: 'business_sale',
            triMonetary: { amount_usd: 100, amount_ves: 6000 },
            channel: 'zelle',
            notes: '@HYPERLINK("http://evil.test")',
          },
        ],
        liabilities: [
          {
            id: 'lia-1',
            dueDate: '2026-10-30',
            title: '-1+1',
            creditor: "  =CMD|' /C calc'!A0",
            scope: 'business',
            triMonetary: { amount_usd: 200, amount_ves: 12000 },
            status: 'pending',
            remainingAmount: 200,
          },
        ],
        quotes: [],
        assets: [],
      }),
      totalAssetsUsd: vi.fn().mockReturnValue(1000),
      totalLiabilitiesUsd: vi.fn().mockReturnValue(200),
      netWorthUsd: vi.fn().mockReturnValue(800),
      currentBcvRate: vi.fn().mockReturnValue(60),
      restoreLedgerState: vi.fn().mockReturnValue(true),
    };

    mockToast = {
      success: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should generate proper hierarchical folder paths by date and category', () => {
    const service = createService(null);
    const fixedDate = new Date('2026-10-15T12:00:00Z');
    const path = service.getFolderHierarchy('receipts', fixedDate);
    expect(path).toContain('/Finanzas_360/2026/10_Octubre/Recibos_Efectivo/');
  });

  it('should generate complete JSON backup with metadata', () => {
    const service = createService(null);
    const jsonStr = service.generateMasterLedgerJson();
    const parsed = JSON.parse(jsonStr);
    expect(parsed.metadata.app).toBe('HOMEL 360 Suite');
    expect(parsed.metadata.netWorthUsd).toBe(800);
    expect(parsed.ledger.expenses.length).toBe(1);
  });

  it('should sanitize CSV formula injection payloads and wrap cells per RFC 4180', () => {
    const service = createService(null);

    expect(service.sanitizeCsvCell('=1+1')).toBe('"\'=1+1"');
    expect(service.sanitizeCsvCell('  =SUM(A1:A5)')).toBe('"\'  =SUM(A1:A5)"');
    expect(service.sanitizeCsvCell('+CMD')).toBe('"\'+CMD"');
    expect(service.sanitizeCsvCell('-1+2')).toBe('"\'-1+2"');
    expect(service.sanitizeCsvCell('@SUM(1,2)')).toBe('"\'@SUM(1,2)"');
    expect(service.sanitizeCsvCell('\t=1+1')).toBe('"\'\t=1+1"');
    expect(service.sanitizeCsvCell('\r=1+1')).toBe('"\'\r=1+1"');
    expect(service.sanitizeCsvCell('Gasolina "Premium"')).toBe('"Gasolina ""Premium"""');

    const expensesCsv = service.exportLedgerAsCsv('expenses');
    expect(expensesCsv).toContain('ID,Fecha,Titulo,Ambito,Categoria');
    expect(expensesCsv).toContain(
      '"exp-1","2026-10-15","Gasolina","personal","transport","15.00","900.00","cash","Test note"',
    );

    const incomesCsv = service.exportLedgerAsCsv('incomes');
    expect(incomesCsv).toContain('"\'+SUM(A1:A2)"');
    expect(incomesCsv).toContain('"\'@HYPERLINK(""http://evil.test"")"');

    const liabilitiesCsv = service.exportLedgerAsCsv('liabilities');
    expect(liabilitiesCsv).toContain('"\'-1+1"');
    expect(liabilitiesCsv).toContain('"\'  =CMD|\' /C calc\'!A0"');
  });

  it('reports disconnected state honestly with toast.warn when MCP service is absent', async () => {
    const service = createService(null);
    const result = await service.triggerCloudSync();

    expect(result.success).toBe(false);
    expect(result.mode).toBe('disconnected');
    expect(result.filesCount).toBe(0);
    expect(service.syncStatus()).toBe('disconnected');
    expect(service.lastSyncTimestamp()).toBeNull();
    expect(mockToast.warn).toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('reports disconnected/simulated honestly when MCP returns SIMULATED or MOCK mode', async () => {
    const mockMcp = {
      gdriveSyncDbBackup: vi.fn().mockResolvedValue({
        success: true,
        result: {
          success: true,
          mode: 'SIMULATED',
          simulated: true,
        },
      }),
    };
    const mcpService = createService(mockMcp);

    const result = await mcpService.triggerCloudSync();

    expect(result.success).toBe(false);
    expect(result.mode).toBe('simulated');
    expect(mcpService.syncStatus()).toBe('disconnected');
    expect(mockToast.warn).toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('reports error state when MCP returns failure', async () => {
    const mockMcp = {
      gdriveSyncDbBackup: vi.fn().mockResolvedValue({
        success: false,
        error: 'OAuth token revoked',
      }),
    };
    const mcpService = createService(mockMcp);

    const result = await mcpService.triggerCloudSync();

    expect(result.success).toBe(false);
    expect(mcpService.syncStatus()).toBe('error');
    expect(mockToast.error).toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('reports synced live success and passes folderPath, undefined folderId (not Unix path), and encrypt=true', async () => {
    const mockMcp = {
      gdriveSyncDbBackup: vi.fn().mockResolvedValue({
        success: true,
        data: {
          mode: 'LIVE',
          fileId: '1DriveLiveFileId',
          webViewLink: 'https://drive.google.com/file/d/1DriveLiveFileId/view',
        },
      }),
    };
    const mcpService = createService(mockMcp);

    const result = await mcpService.triggerCloudSync();

    expect(result.success).toBe(true);
    expect(result.mode).toBe('live');
    expect(result.filesCount).toBe(3);
    expect(mcpService.syncStatus()).toBe('synced');
    expect(mcpService.lastSyncTimestamp()).not.toBeNull();
    expect(mockToast.success).toHaveBeenCalled();
    expect(mockMcp.gdriveSyncDbBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        backupType: 'ledger_json',
        folderPath: expect.stringContaining('/Finanzas_360/'),
        folderId: undefined,
        encrypt: true,
      }),
    );
  });

  it('passes configured Drive folder ID when set and rejects Unix path strings as folderId', async () => {
    storageMap.set('p2p.finance360.drive_folder_id', '1RealDriveFolderIdXYZ');
    const mockMcp = {
      gdriveSyncDbBackup: vi.fn().mockResolvedValue({
        success: true,
        result: {
          success: true,
          mode: 'LIVE',
          fileId: '1DriveLiveFileId2',
        },
      }),
    };
    const mcpService = createService(mockMcp);

    const result = await mcpService.triggerCloudSync();

    expect(result.success).toBe(true);
    expect(mockMcp.gdriveSyncDbBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: '1RealDriveFolderIdXYZ',
        folderPath: expect.stringContaining('/Finanzas_360/'),
        encrypt: true,
      }),
    );

    storageMap.set('p2p.finance360.drive_folder_id', '/Finanzas_360/invalid/unix/path');
    expect(mcpService.getConfiguredDriveFolderId()).toBeUndefined();
  });
});
