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

  it('adopts SQLite accounts strictly without resurrecting missing default banks automatically', async () => {
    const singleAccount: BankAccount = {
      id: 'banesco-pm-1',
      bankName: 'Banesco Pago Móvil',
      bankCode: 'BANESCO',
      rail: 'PAGO_MOVIL',
      accountNumberMasked: '0414-***1234',
      dailyLimitVes: 50000,
      initialBalanceVes: 10000,
      status: 'ACTIVE',
    };

    const mockBridge: ElectronDbBridge = {
      listBankAccounts: vi.fn().mockResolvedValue([singleAccount]),
      saveBankAccount: vi.fn().mockResolvedValue(true),
      getBankAccount: vi.fn().mockResolvedValue(singleAccount),
      deleteBankAccount: vi.fn().mockResolvedValue(true),
    };

    await service.initElectronSync(mockBridge);

    // Debe contener únicamente la cuenta que existe en SQLite, sin resucitar las 15 restantes
    expect(service.accounts()).toHaveLength(1);
    expect(service.accounts()[0].id).toBe('banesco-pm-1');
    expect(mockBridge.saveBankAccount).not.toHaveBeenCalled();
  });

  it('restores missing default banks only upon explicit call to restoreDefaultAccounts()', async () => {
    const singleAccount: BankAccount = {
      id: 'banesco-pm-1',
      bankName: 'Banesco Pago Móvil',
      bankCode: 'BANESCO',
      rail: 'PAGO_MOVIL',
      accountNumberMasked: '0414-***1234',
      dailyLimitVes: 50000,
      initialBalanceVes: 10000,
      status: 'ACTIVE',
    };

    const mockBridge: ElectronDbBridge = {
      listBankAccounts: vi.fn().mockResolvedValue([singleAccount]),
      saveBankAccount: vi.fn().mockResolvedValue(true),
      getBankAccount: vi.fn().mockResolvedValue(singleAccount),
      deleteBankAccount: vi.fn().mockResolvedValue(true),
    };

    await service.initElectronSync(mockBridge);
    expect(service.accounts()).toHaveLength(1);

    (window as unknown as { electron?: { db?: ElectronDbBridge } }).electron = {
      db: mockBridge,
    };

    await service.restoreDefaultAccounts();

    expect(service.accounts().length).toBe(16);
    expect(service.accounts().some((a) => a.id === 'provincial-pm-1')).toBe(true);
    expect(mockBridge.saveBankAccount).toHaveBeenCalled();

    delete (window as unknown as { electron?: unknown }).electron;
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

  describe('injectLiquidity', () => {
    it('increases account initial balance, logs audit, and preserves existing usage math', () => {
      const target = service.accounts()[0];
      const initial = target.initialBalanceVes;
      const injected = 15000;

      const updated = service.injectLiquidity(target.id, injected, 'Fondeo matutino de prueba');

      expect(updated.initialBalanceVes).toBe(initial + injected);
      expect(service.accounts().find((a) => a.id === target.id)?.initialBalanceVes).toBe(
        initial + injected,
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        'CONFIG_CHANGE',
        expect.stringContaining(`Inyección de liquidez: ${injected} VES`),
        expect.objectContaining({
          accountId: target.id,
          amountVes: injected,
          referenceNote: 'Fondeo matutino de prueba',
        }),
        'info',
      );
    });

    it('rejects invalid, negative, or zero injection amounts', () => {
      const target = service.accounts()[0];
      expect(() => service.injectLiquidity(target.id, 0)).toThrow('Monto de inyección inválido');
      expect(() => service.injectLiquidity(target.id, -500)).toThrow('Monto de inyección inválido');
      expect(() => service.injectLiquidity(target.id, Number.NaN)).toThrow(
        'Monto de inyección inválido',
      );
    });

    it('throws when the targeted account does not exist', () => {
      expect(() => service.injectLiquidity('non-existent-id', 5000)).toThrow('no encontrada');
    });
  });
});

