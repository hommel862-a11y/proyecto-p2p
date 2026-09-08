import { Injectable, computed, inject, signal } from '@angular/core';
import { StorageService } from './storage';
import { AuditLoggerService } from './audit-logger.service';
import {
  type BankAccount,
  type AccountUsage,
  type TreasurySummary,
  computeAccountUsage,
  computeTreasurySummary,
  getTodayOperations,
  computeVelocities,
  getRotationRecommendation,
  type AccountVelocityStatus,
  type Operation,
} from '@p2p/core';

const ACCOUNTS_STORAGE_KEY = 'p2p.bank-accounts';
const OPS_KEY = 'p2p.operations';

const DEFAULT_ACCOUNTS: BankAccount[] = [
  {
    id: 'banesco-pm-1',
    bankName: 'Banesco Pago Móvil',
    bankCode: 'BANESCO',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0414-***1234',
    dailyLimitVes: 50000,
    initialBalanceVes: 50000,
  },
  {
    id: 'banesco-transf-1',
    bankName: 'Banesco Transferencia',
    bankCode: 'BANESCO',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0134-***5678',
    dailyLimitVes: 300000,
    initialBalanceVes: 120000,
  },
  {
    id: 'mercantil-pm-1',
    bankName: 'Mercantil Pago Móvil',
    bankCode: 'MERCANTIL',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0412-***8765',
    dailyLimitVes: 40000,
    initialBalanceVes: 40000,
  },
  {
    id: 'bdv-pm-1',
    bankName: 'BDV Pago Móvil',
    bankCode: 'BDV',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0416-***4321',
    dailyLimitVes: 50000,
    initialBalanceVes: 30000,
  },
];

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly storage = inject(StorageService);
  private readonly audit = inject(AuditLoggerService);

  readonly accounts = signal<BankAccount[]>(this.loadAccounts());

  /** Monotonic bump: invalidates operation-derived computeds after ledger writes. */
  private readonly ledgerRevision = signal(0);

  readonly rawOperations = computed<Operation[]>(() => {
    // `ledgerRevision` is intentionally read to make this computed re-evaluate when
    // the operation ledger is written elsewhere (operation-log persists the same key).
    void this.ledgerRevision();
    return this.storage.get<Operation[]>(OPS_KEY) ?? [];
  });

  readonly todayOperations = computed<Operation[]>(() => {
    return getTodayOperations(this.rawOperations());
  });

  readonly usages = computed<AccountUsage[]>(() => {
    const accs = this.accounts();
    const ops = this.todayOperations();
    return accs.map((acc) => computeAccountUsage(acc, ops));
  });

  readonly treasurySummary = computed<TreasurySummary>(() => {
    return computeTreasurySummary(this.accounts(), this.todayOperations());
  });

  readonly nearLimitAccounts = computed<AccountUsage[]>(() => {
    return this.usages().filter((u) => u.isNearLimit);
  });

  readonly overLimitAccounts = computed<AccountUsage[]>(() => {
    return this.usages().filter((u) => u.isOverLimit);
  });

  /** Daily transaction velocity per account (SUDEBAN rotation awareness). */
  readonly accountVelocities = computed<AccountVelocityStatus[]>(() => {
    return computeVelocities(this.accounts(), this.todayOperations());
  });

  /** Accounts at or near their daily transaction threshold. */
  readonly velocityAlerts = computed<AccountVelocityStatus[]>(() => {
    return this.accountVelocities().filter((v) => v.isNearThreshold || v.isAtThreshold);
  });

  /** Best account to rotate to, prioritizing velocity health over remaining limit. */
  readonly rotationRecommendation = computed<BankAccount | null>(() => {
    return getRotationRecommendation(this.accounts(), this.todayOperations(), undefined);
  });

  getAccountById(id: string): BankAccount | undefined {
    return this.accounts().find((a) => a.id === id);
  }

  addAccount(account: Omit<BankAccount, 'id'>): BankAccount {
    const created: BankAccount = {
      ...account,
      id: crypto.randomUUID(),
    };
    const next = [...this.accounts(), created];
    this.saveAccounts(next);
    this.audit.log(
      'CONFIG_CHANGE',
      'Cuenta bancaria agregada',
      { id: created.id, name: created.bankName },
      'info',
    );
    return created;
  }

  updateAccount(updated: BankAccount): void {
    const next = this.accounts().map((a) => (a.id === updated.id ? updated : a));
    this.saveAccounts(next);
    this.audit.log(
      'CONFIG_CHANGE',
      'Cuenta bancaria actualizada',
      { id: updated.id, name: updated.bankName },
      'info',
    );
  }

  deleteAccount(id: string): void {
    const next = this.accounts().filter((a) => a.id !== id);
    this.saveAccounts(next);
    this.audit.log('CONFIG_CHANGE', 'Cuenta bancaria eliminada', { id }, 'info');
  }

  private saveAccounts(list: BankAccount[]): void {
    try {
      this.storage.set(ACCOUNTS_STORAGE_KEY, list);
    } catch {
      // Non-blocking in case storage is unavailable or quota exceeded
    }
    this.accounts.set(list);
  }

  private loadAccounts(): BankAccount[] {
    try {
      const stored = this.storage.get<BankAccount[]>(ACCOUNTS_STORAGE_KEY);
      if (Array.isArray(stored) && stored.length > 0) {
        return stored;
      }
      // Pre-seed default Venezuelan banking accounts
      this.storage.set(ACCOUNTS_STORAGE_KEY, DEFAULT_ACCOUNTS);
      return DEFAULT_ACCOUNTS;
    } catch {
      return DEFAULT_ACCOUNTS;
    }
  }

  /** Re-read the operation ledger so operation-derived signals (treasury, velocity, alerts) refresh. */
  refreshLedger(): void {
    this.ledgerRevision.update((n) => n + 1);
  }
}
