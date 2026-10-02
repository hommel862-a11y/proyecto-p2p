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
  accounts: readonly TreasurySnapshotAccount[];
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
    id: 'mercantil-transf-1',
    bankName: 'Mercantil Transferencia',
    bankCode: 'MERCANTIL',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0105-***6543',
    dailyLimitVes: 250000,
    initialBalanceVes: 100000,
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
  {
    id: 'bdv-transf-1',
    bankName: 'BDV Transferencia',
    bankCode: 'BDV',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0102-***8765',
    dailyLimitVes: 250000,
    initialBalanceVes: 80000,
  },
  {
    id: 'provincial-pm-1',
    bankName: 'BBVA Provincial Pago Móvil',
    bankCode: 'PROVINCIAL',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0414-***9012',
    dailyLimitVes: 50000,
    initialBalanceVes: 35000,
  },
  {
    id: 'provincial-transf-1',
    bankName: 'BBVA Provincial Transferencia',
    bankCode: 'PROVINCIAL',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0108-***4321',
    dailyLimitVes: 250000,
    initialBalanceVes: 90000,
  },
  {
    id: 'bancamiga-pm-1',
    bankName: 'Bancamiga Pago Móvil',
    bankCode: 'BANCAMIGA',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0424-***3456',
    dailyLimitVes: 60000,
    initialBalanceVes: 40000,
  },
  {
    id: 'bancamiga-transf-1',
    bankName: 'Bancamiga Transferencia',
    bankCode: 'BANCAMIGA',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0172-***5678',
    dailyLimitVes: 300000,
    initialBalanceVes: 110000,
  },
  {
    id: 'bnc-pm-1',
    bankName: 'BNC Pago Móvil',
    bankCode: 'BNC',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0412-***7890',
    dailyLimitVes: 45000,
    initialBalanceVes: 30000,
  },
  {
    id: 'bnc-transf-1',
    bankName: 'BNC Transferencia',
    bankCode: 'BNC',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0191-***9876',
    dailyLimitVes: 250000,
    initialBalanceVes: 85000,
  },
  {
    id: 'bancaribe-pm-1',
    bankName: 'Bancaribe Pago Móvil',
    bankCode: 'BANCARIBE',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0414-***2345',
    dailyLimitVes: 40000,
    initialBalanceVes: 25000,
  },
  {
    id: 'bancaribe-transf-1',
    bankName: 'Bancaribe Transferencia',
    bankCode: 'BANCARIBE',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0114-***8765',
    dailyLimitVes: 250000,
    initialBalanceVes: 75000,
  },
  {
    id: 'banplus-pm-1',
    bankName: 'Banplus Pago Móvil',
    bankCode: 'BANPLUS',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0412-***6789',
    dailyLimitVes: 40000,
    initialBalanceVes: 25000,
  },
  {
    id: 'banplus-transf-1',
    bankName: 'Banplus Transferencia',
    bankCode: 'BANPLUS',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0174-***4321',
    dailyLimitVes: 250000,
    initialBalanceVes: 75000,
  },
];

export interface ElectronDbBridge {
  saveBankAccount(account: unknown): Promise<boolean>;
  getBankAccount(id: string): Promise<unknown>;
  listBankAccounts(filter?: { status?: string; bankCode?: string }): Promise<unknown[]>;
  deleteBankAccount(id: string): Promise<boolean>;
}

function getElectronDb(): ElectronDbBridge | undefined {
  if (typeof window !== 'undefined') {
    return (window as unknown as { electron?: { db?: ElectronDbBridge } }).electron?.db;
  }
  return undefined;
}

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly storage = inject(StorageService);
  private readonly audit = inject(AuditLoggerService);

  readonly accounts = signal<BankAccount[]>(this.loadAccounts());

  /** Monotonic bump: invalidates operation-derived computeds after ledger writes. */
  private readonly ledgerRevision = signal(0);

  constructor() {
    void this.initElectronSync();
  }

  /**
   * When running inside Electron, synchronize SQLite accounts with in-memory state.
   * If SQLite has accounts, adopt them strictly as the source of truth without
   * resurrecting accounts deleted by the operator.
   * If SQLite is empty, seed it with the initial accounts.
   */
  async initElectronSync(bridgeOverride?: ElectronDbBridge): Promise<void> {
    const electronDb = bridgeOverride ?? getElectronDb();
    if (!electronDb?.listBankAccounts) return;

    try {
      const records = (await electronDb.listBankAccounts()) as BankAccount[];
      if (Array.isArray(records) && records.length > 0) {
        this.saveAccounts(records);
      } else if (electronDb.saveBankAccount) {
        const current = this.accounts();
        for (const acc of current) {
          await electronDb.saveBankAccount(acc);
        }
      }
    } catch (err) {
      console.warn('[AccountsService] Failed to sync accounts with Electron SQLite:', err);
    }
  }

  /**
   * Asegura que todas las cuentas predeterminadas de los 8 bancos oficiales estén presentes.
   * Si faltan, las agrega y las persiste en Electron SQLite y en storage local sin pisar saldos existentes.
   */
  async restoreDefaultAccounts(): Promise<void> {
    const current = this.accounts();
    const existingIds = new Set(current.map((a) => a.id));
    const missingDefaults = DEFAULT_ACCOUNTS.filter((d) => !existingIds.has(d.id));

    if (missingDefaults.length === 0) return;

    const merged = [...current, ...missingDefaults];
    this.saveAccounts(merged);

    const electronDb = getElectronDb();
    if (electronDb?.saveBankAccount) {
      for (const acc of missingDefaults) {
        try {
          await electronDb.saveBankAccount(acc);
        } catch (err) {
          console.warn('[AccountsService] Error al guardar cuenta default en SQLite:', acc.id, err);
        }
      }
    }
  }

  /** Señal reactiva para solicitar la apertura del modal de liquidez desde cualquier componente (ej. Command Palette). */
  readonly liquidityModalRequest = signal<{ bankId?: string; timestamp: number } | null>(null);

  requestLiquidityModal(bankId?: string): void {
    this.liquidityModalRequest.set({ bankId, timestamp: Date.now() });
  }

  clearLiquidityModalRequest(): void {
    this.liquidityModalRequest.set(null);
  }

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
    const electronDb = getElectronDb();
    if (electronDb?.saveBankAccount) {
      void electronDb.saveBankAccount(created);
    }
    this.audit.log(
      'CONFIG_CHANGE',
      'Cuenta bancaria agregada',
      { id: created.id, name: created.bankName },
      'info',
    );
    void this.announceTreasuryToMain();
    return created;
  }

  updateAccount(updated: BankAccount): void {
    const next = this.accounts().map((a) => (a.id === updated.id ? updated : a));
    this.saveAccounts(next);
    const electronDb = getElectronDb();
    if (electronDb?.saveBankAccount) {
      void electronDb.saveBankAccount(updated);
    }
    this.audit.log(
      'CONFIG_CHANGE',
      'Cuenta bancaria actualizada',
      { id: updated.id, name: updated.bankName },
      'info',
    );
    void this.announceTreasuryToMain();
  }

  deleteAccount(id: string): void {
    const next = this.accounts().filter((a) => a.id !== id);
    this.saveAccounts(next);
    const electronDb = getElectronDb();
    if (electronDb?.deleteBankAccount) {
      void electronDb.deleteBankAccount(id);
    }
    this.audit.log('CONFIG_CHANGE', 'Cuenta bancaria eliminada', { id }, 'info');
    void this.announceTreasuryToMain();
  }

  /**
   * Inyecta liquidez en VES a una cuenta bancaria específica.
   * Incrementa el saldo inicial disponible, persiste en SQLite/LocalStorage,
   * registra auditoría institucional y notifica al proceso principal de Electron.
   */
  injectLiquidity(accountId: string, amountVes: number, referenceNote?: string): BankAccount {
    if (!Number.isFinite(amountVes) || amountVes <= 0) {
      throw new Error(`Monto de inyección inválido: ${amountVes}. Debe ser un número positivo.`);
    }
    const acc = this.accounts().find((a) => a.id === accountId);
    if (!acc) {
      throw new Error(`Cuenta bancaria con id ${accountId} no encontrada.`);
    }

    const previousInitialBalance = acc.initialBalanceVes;
    const updated: BankAccount = {
      ...acc,
      initialBalanceVes: Math.round((acc.initialBalanceVes + amountVes) * 100) / 100,
    };
    this.updateAccount(updated);
    this.audit.log(
      'CONFIG_CHANGE',
      `Inyección de liquidez: ${amountVes} VES a ${acc.bankName}`,
      {
        accountId,
        bankName: acc.bankName,
        bankCode: acc.bankCode,
        amountVes,
        previousInitialBalance,
        newInitialBalance: updated.initialBalanceVes,
        referenceNote: referenceNote ?? '',
      },
      'info',
    );
    return updated;
  }

  /**
   * Anuncia el snapshot de tesorería real al proceso principal de Electron vía `p2p:treasury-announce`.
   */
  async announceTreasuryToMain(): Promise<void> {
    // `&&` yields the literal `false` when window is undefined, so the type was
    // `false | { p2p?: ... }` and TS rejected `.announceTreasury` on `false`.
    // A ternary narrows to `undefined` instead. Runtime behaviour is identical:
    // both branches reach the same falsy guard on the next line.
    const bridge =
      typeof window !== 'undefined'
        ? (window as unknown as { p2p?: { announceTreasury?: (s: unknown) => Promise<boolean> } }).p2p
        : undefined;
    if (!bridge?.announceTreasury) return;
    try {
      const snapshot = this.buildTreasurySnapshot();
      await bridge.announceTreasury(snapshot);
    } catch (err: unknown) {
      console.warn('[AccountsService] Failed to announce treasury to Electron main:', err);
    }
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
