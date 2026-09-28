/**
 * Bank Account Repository Port and Web/Memory Adapters (framework-agnostic).
 * Follows Hexagonal Architecture: domain logic and application services depend on
 * the port interface, while concrete adapters bridge to IndexedDB/WebStorage or SQLite.
 */

import { type BankAccount, type BankCode } from './accounts';
import { type StoragePort } from './storage';

export interface BankAccountFilter {
  bankCode?: BankCode;
  status?: 'ACTIVE' | 'DISABLED';
}

export interface BankAccountRepository {
  getAll(filter?: BankAccountFilter): Promise<BankAccount[]>;
  getById(id: string): Promise<BankAccount | null>;
  save(account: BankAccount): Promise<void>;
  saveAll(accounts: readonly BankAccount[]): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export class InMemoryBankAccountRepository implements BankAccountRepository {
  private readonly accounts = new Map<string, BankAccount>();

  constructor(initialAccounts: readonly BankAccount[] = []) {
    for (const acc of initialAccounts) {
      this.accounts.set(acc.id, { ...acc });
    }
  }

  async getAll(filter?: BankAccountFilter): Promise<BankAccount[]> {
    let list = Array.from(this.accounts.values());
    if (filter?.bankCode) {
      list = list.filter((a) => a.bankCode === filter.bankCode);
    }
    if (filter?.status) {
      list = list.filter((a) => (a.status ?? 'ACTIVE') === filter.status);
    }
    return list.map((a) => ({ ...a }));
  }

  async getById(id: string): Promise<BankAccount | null> {
    const acc = this.accounts.get(id);
    return acc ? { ...acc } : null;
  }

  async save(account: BankAccount): Promise<void> {
    this.accounts.set(account.id, { ...account });
  }

  async saveAll(accounts: readonly BankAccount[]): Promise<void> {
    for (const acc of accounts) {
      this.accounts.set(acc.id, { ...acc });
    }
  }

  async delete(id: string): Promise<boolean> {
    return this.accounts.delete(id);
  }
}

export class WebStorageBankAccountRepository implements BankAccountRepository {
  constructor(
    private readonly storage: StoragePort,
    private readonly storageKey: string = 'p2p.bank-accounts',
  ) {}

  async getAll(filter?: BankAccountFilter): Promise<BankAccount[]> {
    const accounts = this.storage.get<BankAccount[]>(this.storageKey) ?? [];
    let list = accounts;
    if (filter?.bankCode) {
      list = list.filter((a) => a.bankCode === filter.bankCode);
    }
    if (filter?.status) {
      list = list.filter((a) => (a.status ?? 'ACTIVE') === filter.status);
    }
    return list;
  }

  async getById(id: string): Promise<BankAccount | null> {
    const accounts = await this.getAll();
    return accounts.find((a) => a.id === id) ?? null;
  }

  async save(account: BankAccount): Promise<void> {
    const accounts = (this.storage.get<BankAccount[]>(this.storageKey) ?? []).filter(
      (a) => a.id !== account.id,
    );
    accounts.push(account);
    this.storage.set(this.storageKey, accounts);
  }

  async saveAll(accounts: readonly BankAccount[]): Promise<void> {
    this.storage.set(this.storageKey, [...accounts]);
  }

  async delete(id: string): Promise<boolean> {
    const existing = this.storage.get<BankAccount[]>(this.storageKey) ?? [];
    const filtered = existing.filter((a) => a.id !== id);
    if (filtered.length === existing.length) return false;
    this.storage.set(this.storageKey, filtered);
    return true;
  }
}
