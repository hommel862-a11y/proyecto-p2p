import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  TreasuryAccountSnapshotDto,
  TreasurySnapshotDto,
} from '../../../electron/shared/types';
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

/**
 * Mirrors the global SUDEBAN daily transaction cap in @p2p/core. Only used to fill the
 * snapshot when an account somehow has no velocity record, which cannot happen while
 * `accountVelocities()` and `usages()` both derive from `accounts()`.
 */
const FALLBACK_MAX_DAILY_TRANSACTIONS = 15;

/** Per-account slice of the treasury projection announced to the main process. */
export type TreasurySnapshotAccount = TreasuryAccountSnapshotDto;

/**
 * Serializable projection of the real treasury state, derived from the same signals the
 * dashboard renders. It is the payload of the `p2p:treasury-announce` channel and lets the
 * main process audit bank limits instead of hardcoded literals.
 *
 * The shape is inherited from the IPC contract (`TreasurySnapshotDto`) rather than
 * redeclared, so the renderer cannot drift from what the main process validates; only the
 * account array is widened to a readonly view because the renderer never mutates it either.
 */
export interface TreasurySnapshot extends Omit<TreasurySnapshotDto, 'accounts'> {
  accounts: ReadonlyArray<TreasurySnapshotAccount>;
}

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

  /**
   * Build the plain-object treasury projection consumed by the Electron main process.
   *
   * Combines the summary, the per-account daily usage, the velocity health and the rotation
   * pick into a single serializable value: no class instances, no circular references, safe
   * to structured-clone across the process boundary. Every figure comes from the same signals
   * the dashboard already renders, so the main process and the UI can never disagree.
   */
  buildTreasurySnapshot(): TreasurySnapshot {
    const summary = this.treasurySummary();
    const usages = this.usages();
    const velocityByAccountId = new Map(
      this.accountVelocities().map((velocity) => [velocity.accountId, velocity] as const),
    );

    const accounts: TreasurySnapshotAccount[] = usages.map((usage) => {
      const account = usage.account;
      const velocity = velocityByAccountId.get(account.id);
      return {
        id: account.id,
        bankName: account.bankName,
        bankCode: account.bankCode,
        rail: account.rail,
        // Left undefined when the stored account predates the status field: absent means
        // ACTIVE, exactly as in @p2p/core.
        status: account.status,
        dailyLimitVes: account.dailyLimitVes,
        monthlyLimitVes: account.monthlyLimitVes,
        remainingLimitVes: usage.remainingLimitVes,
        isOverLimit: usage.isOverLimit,
        isNearLimit: usage.isNearLimit,
        todayTransactionCount: velocity?.todayTransactionCount ?? 0,
        maxDailyTransactions:
          velocity?.maxDailyTransactions ??
          account.maxDailyTransactions ??
          FALLBACK_MAX_DAILY_TRANSACTIONS,
        velocityHealth: velocity?.velocityHealth ?? 'OPTIMAL',
        isAtThreshold: velocity?.isAtThreshold ?? false,
      };
    });

    // Only ACTIVE accounts with an explicit cap contribute headroom: a DISABLED account is
    // not a rotation target, and dailyLimitVes === 0 means "unlimited" in @p2p/core.
    const totalDailyLimitVes = accounts
      .filter((a) => a.status !== 'DISABLED' && a.dailyLimitVes > 0)
      .reduce((sum, a) => sum + a.dailyLimitVes, 0);

    return {
      accounts,
      totalBalanceVes: summary.totalBalanceVes,
      totalSpentTodayVes: summary.totalSpentTodayVes,
      totalReceivedTodayVes: summary.totalReceivedTodayVes,
      totalDailyLimitVes,
      nearLimitCount: summary.nearLimitCount,
      overLimitCount: summary.overLimitCount,
      disabledCount: accounts.filter((a) => a.status === 'DISABLED').length,
      saturatedCount: accounts.filter((a) => a.velocityHealth === 'SATURATED').length,
      rotationRecommendationId: this.rotationRecommendation()?.id ?? null,
      generatedAt: Date.now(),
    };
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
