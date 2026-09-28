import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryBankAccountRepository,
  WebStorageBankAccountRepository,
} from './accounts-repository';
import type { BankAccount } from './accounts';
import type { StoragePort } from './storage';

describe('BankAccountRepository (Hexagonal Architecture Ports & Adapters)', () => {
  const banescoAcc: BankAccount = {
    id: 'banes-01',
    bankName: 'Banesco Pago Móvil',
    bankCode: 'BANESCO',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0414-***1234',
    dailyLimitVes: 50000,
    initialBalanceVes: 50000,
    status: 'ACTIVE',
    maxDailyTransactions: 15,
  };

  const mercantilAcc: BankAccount = {
    id: 'mercantil-01',
    bankName: 'Mercantil Transferencia',
    bankCode: 'MERCANTIL',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0105-***9876',
    dailyLimitVes: 200000,
    initialBalanceVes: 100000,
    status: 'DISABLED',
    maxDailyTransactions: 20,
  };

  describe('InMemoryBankAccountRepository', () => {
    let repo: InMemoryBankAccountRepository;

    beforeEach(() => {
      repo = new InMemoryBankAccountRepository([banescoAcc, mercantilAcc]);
    });

    it('retrieves all accounts without filter', async () => {
      const all = await repo.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((a) => a.id)).toContain('banes-01');
      expect(all.map((a) => a.id)).toContain('mercantil-01');
    });

    it('filters accounts by bankCode', async () => {
      const banescoOnly = await repo.getAll({ bankCode: 'BANESCO' });
      expect(banescoOnly).toHaveLength(1);
      expect(banescoOnly[0].id).toBe('banes-01');
    });

    it('filters accounts by status', async () => {
      const activeOnly = await repo.getAll({ status: 'ACTIVE' });
      expect(activeOnly).toHaveLength(1);
      expect(activeOnly[0].id).toBe('banes-01');

      const disabledOnly = await repo.getAll({ status: 'DISABLED' });
      expect(disabledOnly).toHaveLength(1);
      expect(disabledOnly[0].id).toBe('mercantil-01');
    });

    it('retrieves account by id', async () => {
      const found = await repo.getById('banes-01');
      expect(found).not.toBeNull();
      expect(found?.bankName).toBe('Banesco Pago Móvil');

      const missing = await repo.getById('non-existent');
      expect(missing).toBeNull();
    });

    it('saves a new or existing account (upsert)', async () => {
      const updated: BankAccount = { ...banescoAcc, dailyLimitVes: 80000 };
      await repo.save(updated);

      const check = await repo.getById('banes-01');
      expect(check?.dailyLimitVes).toBe(80000);
    });

    it('deletes an account by id', async () => {
      const deleted = await repo.delete('banes-01');
      expect(deleted).toBe(true);

      const check = await repo.getById('banes-01');
      expect(check).toBeNull();

      const notFoundDelete = await repo.delete('banes-01');
      expect(notFoundDelete).toBe(false);
    });
  });

  describe('WebStorageBankAccountRepository', () => {
    let mockStorage: StoragePort;
    let store: Record<string, unknown>;
    let repo: WebStorageBankAccountRepository;

    beforeEach(() => {
      store = {};
      mockStorage = {
        get: <T>(key: string): T | null => (store[key] as T) ?? null,
        set: <T>(key: string, value: T): void => {
          store[key] = value;
        },
        remove: (key: string): void => {
          delete store[key];
        },
        exportAll: () => JSON.stringify(store),
        importAll: () => {},
      };
      repo = new WebStorageBankAccountRepository(mockStorage);
    });

    it('initializes empty and allows saveAll and getAll', async () => {
      expect(await repo.getAll()).toHaveLength(0);

      await repo.saveAll([banescoAcc, mercantilAcc]);
      const all = await repo.getAll();
      expect(all).toHaveLength(2);
    });

    it('handles save and delete operations with WebStorage backend', async () => {
      await repo.save(banescoAcc);
      expect(await repo.getById('banes-01')).toEqual(banescoAcc);

      const removed = await repo.delete('banes-01');
      expect(removed).toBe(true);
      expect(await repo.getById('banes-01')).toBeNull();
    });
  });
});
