import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AccountsService, type ElectronDbBridge } from './accounts.service';
import { StorageService } from './storage';
import { AuditLoggerService } from './audit-logger.service';
import type { BankAccount } from '@p2p/core';

describe('AccountsService (Desktop SQLite Bridge & LocalStorage Fallback)', () => {
  let service: AccountsService;
  let mockStorage: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let mockAudit: {
    log: ReturnType<typeof vi.fn>;
  };
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};
    mockStorage = {
      get: vi.fn((key: string) => store[key] ?? null),
      set: vi.fn((key: string, val: unknown) => {
        store[key] = val;
      }),
      remove: vi.fn((key: string) => {
        delete store[key];
      }),
    };

    mockAudit = {
      log: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AccountsService,
        { provide: StorageService, useValue: mockStorage },
        { provide: AuditLoggerService, useValue: mockAudit },
      ],
    });

    service = TestBed.inject(AccountsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with default Venezuelan banking accounts when storage is empty', () => {
    const accs = service.accounts();
    expect(accs.length).toBeGreaterThan(0);
    expect(accs.some((a) => a.bankCode === 'BANESCO')).toBe(true);
    expect(accs.some((a) => a.bankCode === 'MERCANTIL')).toBe(true);
  });

  it('synchronizes accounts from Electron SQLite when bridge returns stored accounts', async () => {
    const sqliteAccount: BankAccount = {
      id: 'sqlite-1',
      bankName: 'Banesco SQLite Custom',
      bankCode: 'BANESCO',
      rail: 'PAGO_MOVIL',
      accountNumberMasked: '0414-***9999',
      dailyLimitVes: 80000,
      initialBalanceVes: 80000,
      status: 'ACTIVE',
    };

    const mockBridge: ElectronDbBridge = {
      listBankAccounts: vi.fn().mockResolvedValue([sqliteAccount]),
      saveBankAccount: vi.fn().mockResolvedValue(true),
      getBankAccount: vi.fn().mockResolvedValue(sqliteAccount),
      deleteBankAccount: vi.fn().mockResolvedValue(true),
    };

    await service.initElectronSync(mockBridge);

    expect(service.accounts()).toHaveLength(1);
    expect(service.accounts()[0].id).toBe('sqlite-1');
    expect(service.accounts()[0].bankName).toBe('Banesco SQLite Custom');
  });

  it('seeds Electron SQLite with initial accounts when SQLite is empty on startup', async () => {
    const mockBridge: ElectronDbBridge = {
      listBankAccounts: vi.fn().mockResolvedValue([]),
      saveBankAccount: vi.fn().mockResolvedValue(true),
      getBankAccount: vi.fn().mockResolvedValue(null),
      deleteBankAccount: vi.fn().mockResolvedValue(true),
    };

    await service.initElectronSync(mockBridge);

    expect(mockBridge.saveBankAccount).toHaveBeenCalled();
  });

  it('forwards addAccount, updateAccount and deleteAccount to Electron bridge if present', () => {
    const mockBridge: ElectronDbBridge = {
      listBankAccounts: vi.fn().mockResolvedValue([]),
      saveBankAccount: vi.fn().mockResolvedValue(true),
      getBankAccount: vi.fn().mockResolvedValue(null),
      deleteBankAccount: vi.fn().mockResolvedValue(true),
    };

    // Mount bridge on window
    (window as unknown as { electron?: { db?: ElectronDbBridge } }).electron = {
      db: mockBridge,
    };

    const created = service.addAccount({
      bankName: 'Provincial Test',
      bankCode: 'PROVINCIAL',
      rail: 'TRANSFERENCIA',
      accountNumberMasked: '0108-***1111',
      dailyLimitVes: 100000,
      initialBalanceVes: 50000,
    });

    expect(mockBridge.saveBankAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: created.id,
        bankName: 'Provincial Test',
      }),
    );

    service.updateAccount({
      ...created,
      dailyLimitVes: 120000,
    });

    expect(mockBridge.saveBankAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: created.id,
        dailyLimitVes: 120000,
      }),
    );

    service.deleteAccount(created.id);
    expect(mockBridge.deleteBankAccount).toHaveBeenCalledWith(created.id);

    delete (window as unknown as { electron?: unknown }).electron;
  });
});
