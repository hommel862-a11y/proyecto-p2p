import { Injectable, computed, inject, signal } from '@angular/core';
import { IndexedDbStorageService } from './indexed-db-storage.service';
import { AccountsService } from './accounts.service';
import { CotizaveService } from './cotizave.service';
import { computeLogSummary } from '@p2p/core';
import {
  type AssetVault,
  type LiabilityItem,
  type IncomeEntry,
  type ExpenseEntry,
  type CasheaPlan,
  type CasheaInstallment,
  type CasheaLevel,
  type PymeProvider,
  type PymeInventoryItem,
  type BudgetQuote,
  type Finance360LedgerState,
  type FinanceScope,
  type CurrencyCode,
  computeTriMonetaryAmount,
} from './models/finance-360.models';

export const FINANCE_360_STORAGE_KEY = 'p2p.finance360.ledger';
const CURRENT_LEDGER_VERSION = 1;

const DEFAULT_VAULTS: AssetVault[] = [
  {
    id: 'vault-zelle-pers',
    name: 'Zelle Personal',
    channel: 'zelle',
    scope: 'personal',
    currency: 'USD',
    balance: 500,
    balanceUsdEquivalent: 500,
    balanceVesEquivalent: 0,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'vault-cash-usd',
    name: 'Efectivo Divisas (Caja Fuerte)',
    channel: 'cash',
    scope: 'all',
    currency: 'USD',
    balance: 300,
    balanceUsdEquivalent: 300,
    balanceVesEquivalent: 0,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'vault-banesco-pers',
    name: 'Banesco Bs Personal',
    channel: 'bs_bank',
    scope: 'personal',
    currency: 'VES',
    bankCode: 'BANESCO',
    balance: 4500,
    balanceUsdEquivalent: 0,
    balanceVesEquivalent: 4500,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'vault-pyme-caja',
    name: 'Caja Operativa Pyme',
    channel: 'cash',
    scope: 'business',
    currency: 'USD',
    balance: 450,
    balanceUsdEquivalent: 450,
    balanceVesEquivalent: 0,
    updatedAt: new Date().toISOString(),
  },
];

@Injectable({ providedIn: 'root' })
export class Finance360Service {
  private readonly storage = inject(IndexedDbStorageService);
  private readonly accountsService = inject(AccountsService);
  private readonly cotizaveService = inject(CotizaveService);

  /** Active Chameleon Mode filter: 'all' | 'personal' | 'business' */
  readonly scope = signal<FinanceScope>('all');

  /** Reactive in-memory state of the Finance 360 ledger */
  readonly state = signal<Finance360LedgerState>(this.loadInitialState());

  constructor() {
    this.recomputeEquivalents();
  }

  // -------------------------------------------------------------
  // COMPUTED VIEWS & METRICS (PROGRESSIVE DISCLOSURE)
  // -------------------------------------------------------------

  readonly currentBcvRate = computed<number>(() => {
    const rates = this.cotizaveService.ratesByMarket();
    const oficial = rates['oficial'] ?? rates['bcv'];
    return oficial?.mid ?? oficial?.ask ?? 60.0;
  });

  readonly currentParallelRate = computed<number>(() => {
    const rates = this.cotizaveService.ratesByMarket();
    const par = rates['parallel'] ?? rates['binance'] ?? rates['enparalelovzla'];
    return par?.mid ?? par?.ask ?? this.currentBcvRate() * 1.15;
  });

  /** Filtered assets based on the active scope */
  readonly assets = computed<AssetVault[]>(() => {
    const currentScope = this.scope();
    const all = this.state().assets;
    if (currentScope === 'all') return all;
    return all.filter((a) => a.scope === 'all' || a.scope === currentScope);
  });

  /** Filtered liabilities based on the active scope */
  readonly liabilities = computed<LiabilityItem[]>(() => {
    const currentScope = this.scope();
    const all = this.state().liabilities;
    if (currentScope === 'all') return all;
    return all.filter((l) => l.scope === 'all' || l.scope === currentScope);
  });

  /** Filtered incomes based on the active scope */
  readonly incomes = computed<IncomeEntry[]>(() => {
    const currentScope = this.scope();
    const all = this.state().incomes;
    if (currentScope === 'all') return all;
    return all.filter((i) => i.scope === 'all' || i.scope === currentScope);
  });

  /** Filtered expenses based on the active scope */
  readonly expenses = computed<ExpenseEntry[]>(() => {
    const currentScope = this.scope();
    const all = this.state().expenses;
    if (currentScope === 'all') return all;
    return all.filter((e) => e.scope === 'all' || e.scope === currentScope);
  });

  /** Total Consolidated Assets in USD */
  readonly totalAssetsUsd = computed<number>(() => {
    const bcv = this.currentBcvRate();
    return this.assets().reduce((acc, vault) => {
      if (vault.currency === 'USD' || vault.currency === 'USDT') return acc + vault.balance;
      if (vault.currency === 'VES') return acc + (bcv > 0 ? vault.balance / bcv : 0);
      if (vault.currency === 'EUR') return acc + vault.balance * 1.08;
      return acc + vault.balance;
    }, 0);
  });

  /** Total Consolidated Liabilities in USD */
  readonly totalLiabilitiesUsd = computed<number>(() => {
    return this.liabilities().reduce((acc, item) => {
      if (item.status === 'paid') return acc;
      return acc + item.remainingAmount;
    }, 0);
  });

  /** Consolidated Net Worth in USD (Assets - Liabilities) */
  readonly netWorthUsd = computed<number>(() => {
    return Math.round((this.totalAssetsUsd() - this.totalLiabilitiesUsd()) * 100) / 100;
  });

  /** Consolidated Net Worth in VES */
  readonly netWorthVes = computed<number>(() => {
    return Math.round(this.netWorthUsd() * this.currentBcvRate() * 100) / 100;
  });

  /** High priority liabilities due in the next 7 days */
  readonly upcomingLiabilities7Days = computed<LiabilityItem[]>(() => {
    const now = new Date();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return this.liabilities()
      .filter((l) => l.status !== 'paid')
      .filter((l) => {
        const due = new Date(l.dueDate).getTime();
        const diff = due - now.getTime();
        return diff >= -86400000 && diff <= sevenDaysMs; // due or up to 1 day overdue
      })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  });

  /**
   * 14-Day Cashflow Health Semaphore
   * Computes available liquid assets vs. due commitments over the next 14 days.
   */
  readonly liquidityHealthStatus = computed<{
    status: 'optimal' | 'warning' | 'critical';
    label: string;
    ratio: number;
    due14DaysUsd: number;
  }>(() => {
    const now = new Date();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const due14DaysUsd = this.liabilities()
      .filter((l) => l.status !== 'paid')
      .filter((l) => {
        const due = new Date(l.dueDate).getTime();
        const diff = due - now.getTime();
        return diff >= 0 && diff <= fourteenDaysMs;
      })
      .reduce((sum, item) => sum + item.remainingAmount, 0);

    const liquidAssets = this.totalAssetsUsd();
    if (due14DaysUsd <= 0) {
      return {
        status: 'optimal',
        label: 'LIQUIDEZ BLINDADA (Sin compromisos inmediatos)',
        ratio: 100,
        due14DaysUsd: 0,
      };
    }

    const coverageRatio = liquidAssets / due14DaysUsd;
    if (coverageRatio >= 2.0) {
      return {
        status: 'optimal',
        label: `LIQUIDEZ EXCELENTE (Cubre ${Math.round(coverageRatio * 10) / 10}x tus compromisos a 14 días)`,
        ratio: Math.min(100, Math.round(coverageRatio * 50)),
        due14DaysUsd,
      };
    } else if (coverageRatio >= 1.0) {
      return {
        status: 'warning',
        label: `LIQUIDEZ AJUSTADA (Cubre ${Math.round(coverageRatio * 100)}% de los próximos 14 días)`,
        ratio: Math.round(coverageRatio * 50),
        due14DaysUsd,
      };
    } else {
      return {
        status: 'critical',
        label: `ALERTA DE DÉFICIT (Faltan $${Math.round((due14DaysUsd - liquidAssets) * 100) / 100} para cubrir compromisos)`,
        ratio: Math.max(10, Math.round(coverageRatio * 50)),
        due14DaysUsd,
      };
    }
  });

  // -------------------------------------------------------------
  // REGLA DE ORO DE AISLAMIENTO: PUENTE UNIDIRECCIONAL P2P
  // -------------------------------------------------------------

  /**
   * Imports strictly positive net realized profit from the P2P trading mesa
   * for today's date.
   *
   * Crucial Architecture:
   * - Never writes to or alters `p2p.operations` or bank limits.
   * - Only reads the pure aggregated summary of `AccountsService.todayOperations()`.
   * - If profit is <= 0, no income entry is generated.
   * - Prevents duplication on the same calendar day (upserts if already imported).
   */
  importDailyP2pProfit(
    targetScope: FinanceScope = 'personal',
    customBcvRate?: number,
  ): {
    success: boolean;
    reason?: string;
    profitVes: number;
    profitUsd: number;
    entryId?: string;
  } {
    const todayOps = this.accountsService.todayOperations();
    const summary = computeLogSummary(todayOps);

    if (summary.pnlVes <= 0 && summary.pnlUsdt <= 0) {
      return {
        success: false,
        reason: 'NO_POSITIVE_PROFIT',
        profitVes: summary.pnlVes,
        profitUsd: summary.pnlUsdt,
      };
    }

    const bcv = customBcvRate ?? this.currentBcvRate();
    const parallel = this.currentParallelRate();
    const dateStr = new Date().toISOString().split('T')[0];
    const entryId = `p2p-profit-${dateStr}`;

    const effectiveUsd =
      summary.pnlUsdt > 0
        ? summary.pnlUsdt
        : bcv > 0
          ? Math.round((summary.pnlVes / bcv) * 100) / 100
          : 0;

    const triMonetary = computeTriMonetaryAmount(
      effectiveUsd,
      'USD',
      bcv,
      parallel,
    );

    const p2pEntry: IncomeEntry = {
      id: entryId,
      title: `Ganancia Neta P2P (${dateStr})`,
      scope: targetScope,
      category: 'p2p_profit',
      channel: 'crypto',
      triMonetary,
      date: dateStr,
      referenceNumber: `P2P-OPS-${summary.operations}`,
      notes: `Importado limpiamente desde Mesa P2P. ${summary.operations} operaciones cerradas hoy.`,
      p2pBridgeMetadata: {
        operationsCount: summary.operations,
        realizedPnlVes: summary.pnlVes,
        realizedPnlUsdt: summary.pnlUsdt,
        importedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    };

    const currentState = this.state();
    const existingIndex = currentState.incomes.findIndex((i) => i.id === entryId);
    let updatedIncomes = [...currentState.incomes];

    if (existingIndex >= 0) {
      updatedIncomes[existingIndex] = p2pEntry;
    } else {
      updatedIncomes = [p2pEntry, ...updatedIncomes];
    }

    this.updateState({ incomes: updatedIncomes });

    return {
      success: true,
      profitVes: summary.pnlVes,
      profitUsd: effectiveUsd,
      entryId,
    };
  }

  // -------------------------------------------------------------
  // CRUD: PILARES CONTABLES
  // -------------------------------------------------------------

  addAssetVault(vault: Omit<AssetVault, 'id' | 'updatedAt'>): AssetVault {
    const id = `vault-${Date.now()}`;
    const newVault: AssetVault = {
      ...vault,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.updateState({ assets: [...this.state().assets, newVault] });
    return newVault;
  }

  updateAssetVault(id: string, patch: Partial<AssetVault>): void {
    const updated = this.state().assets.map((v) =>
      v.id === id ? { ...v, ...patch, updatedAt: new Date().toISOString() } : v,
    );
    this.updateState({ assets: updated });
  }

  deleteAssetVault(id: string): void {
    const filtered = this.state().assets.filter((v) => v.id !== id);
    this.updateState({ assets: filtered });
  }

  addIncome(entry: Omit<IncomeEntry, 'id' | 'createdAt'>): IncomeEntry {
    const id = `inc-${Date.now()}`;
    const newEntry: IncomeEntry = {
      ...entry,
      id,
      createdAt: new Date().toISOString(),
    };

    // If vault specified, credit the vault
    if (newEntry.vaultId) {
      this.creditVault(newEntry.vaultId, newEntry.triMonetary.amount_usd);
    }

    this.updateState({ incomes: [newEntry, ...this.state().incomes] });
    return newEntry;
  }

  addExpense(entry: Omit<ExpenseEntry, 'id' | 'createdAt'>): ExpenseEntry {
    const id = `exp-${Date.now()}`;
    const newEntry: ExpenseEntry = {
      ...entry,
      id,
      createdAt: new Date().toISOString(),
    };

    // If vault specified, debit the vault
    if (newEntry.vaultId) {
      this.debitVault(newEntry.vaultId, newEntry.triMonetary.amount_usd);
    }

    // If attached to a liability, credit the payment
    if (newEntry.liabilityId) {
      this.payLiability(newEntry.liabilityId, newEntry.triMonetary.amount_usd);
    }

    this.updateState({ expenses: [newEntry, ...this.state().expenses] });
    return newEntry;
  }

  addLiability(item: Omit<LiabilityItem, 'id' | 'createdAt' | 'updatedAt'>): LiabilityItem {
    const id = `liab-${Date.now()}`;
    const newItem: LiabilityItem = {
      ...item,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.updateState({ liabilities: [...this.state().liabilities, newItem] });
    return newItem;
  }

  payLiability(id: string, amountPaidUsd: number, debitVaultId?: string): void {
    const updated = this.state().liabilities.map((item) => {
      if (item.id !== id) return item;
      const newPaid = Math.round((item.amountPaid + amountPaidUsd) * 100) / 100;
      const remaining = Math.max(0, Math.round((item.triMonetary.amount_usd - newPaid) * 100) / 100);
      const status: LiabilityItem['status'] =
        remaining <= 0 ? 'paid' : newPaid > 0 ? 'partially_paid' : 'pending';

      return {
        ...item,
        amountPaid: newPaid,
        remainingAmount: remaining,
        status,
        updatedAt: new Date().toISOString(),
      };
    });

    if (debitVaultId) {
      this.debitVault(debitVaultId, amountPaidUsd);
    }

    this.updateState({ liabilities: updated });
  }

  // -------------------------------------------------------------
  // SUB-MÓDULO 1: CASHEA & FINANCIAMIENTOS
  // -------------------------------------------------------------

  /**
   * Generates a 14-day Cashea schedule based on user level and initial downpayment.
   */
  calculateCasheaSchedule(
    totalPriceUsd: number,
    level: CasheaLevel = 3,
    numberOfInstallments: number = 3,
    startDate: Date = new Date(),
  ): {
    initialPercentage: number;
    initialPaymentUsd: number;
    installmentAmountUsd: number;
    installments: CasheaInstallment[];
  } {
    const percentageByLevel: Record<CasheaLevel, number> = {
      1: 0.6,
      2: 0.5,
      3: 0.4,
      4: 0.3,
      5: 0.2,
    };

    const initialPercentage = percentageByLevel[level] ?? 0.4;
    const initialPaymentUsd = Math.round(totalPriceUsd * initialPercentage * 100) / 100;
    const financedAmount = Math.max(0, totalPriceUsd - initialPaymentUsd);
    const installmentAmountUsd =
      numberOfInstallments > 0
        ? Math.round((financedAmount / numberOfInstallments) * 100) / 100
        : 0;

    const installments: CasheaInstallment[] = [];
    for (let i = 1; i <= numberOfInstallments; i++) {
      const dueDate = new Date(startDate.getTime() + i * 14 * 24 * 60 * 60 * 1000);
      installments.push({
        number: i,
        dueDate: dueDate.toISOString().split('T')[0],
        amountUsd: installmentAmountUsd,
        status: 'pending',
      });
    }

    return {
      initialPercentage,
      initialPaymentUsd,
      installmentAmountUsd,
      installments,
    };
  }

  calculateCasheaBreakdown(
    totalPriceUsd: number,
    level: CasheaLevel = 3,
    numberOfInstallments: number = 3,
    startDate: Date = new Date(),
  ) {
    const schedule = this.calculateCasheaSchedule(totalPriceUsd, level, numberOfInstallments, startDate);
    const financedAmountUsd = Math.max(0, totalPriceUsd - schedule.initialPaymentUsd);
    return {
      ...schedule,
      initialPercent: Math.round(schedule.initialPercentage * 100),
      financedAmountUsd,
      installmentsCount: numberOfInstallments,
    };
  }

  addCasheaPlan(plan: Omit<CasheaPlan, 'id' | 'createdAt'>): CasheaPlan {
    const id = `cashea-${Date.now()}`;
    const newPlan: CasheaPlan = {
      ...plan,
      id,
      createdAt: new Date().toISOString(),
    };

    // Auto-create matching liability items for each installment
    const liabilitiesToAdd: LiabilityItem[] = newPlan.installments.map((inst) => {
      const tri = computeTriMonetaryAmount(
        inst.amountUsd,
        'USD',
        this.currentBcvRate(),
        this.currentParallelRate(),
      );
      return {
        id: `liab-cashea-${newPlan.id}-${inst.number}`,
        title: `Cuota Cashea #${inst.number} - ${newPlan.productName}`,
        creditor: `Cashea (${newPlan.storeName})`,
        scope: 'personal',
        category: 'cashea',
        triMonetary: tri,
        dueDate: inst.dueDate,
        status: 'pending',
        amountPaid: 0,
        remainingAmount: inst.amountUsd,
        casheaPlanId: newPlan.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });

    this.updateState({
      casheaPlans: [...this.state().casheaPlans, newPlan],
      liabilities: [...this.state().liabilities, ...liabilitiesToAdd],
    });

    return newPlan;
  }

  registerCasheaPlan(plan: Omit<CasheaPlan, 'id' | 'createdAt'>): CasheaPlan {
    return this.addCasheaPlan(plan);
  }

  markCasheaInstallmentPaid(
    planId: string,
    installmentNumber: number,
    paymentRef?: string,
    bcvRateApplied?: number,
  ): void {
    const plans = this.state().casheaPlans.map((plan) => {
      if (plan.id !== planId) return plan;
      const updatedInstallments = plan.installments.map((inst) => {
        if (inst.number !== installmentNumber) return inst;
        const bcv = bcvRateApplied ?? this.currentBcvRate();
        return {
          ...inst,
          status: 'paid' as const,
          paidAt: new Date().toISOString(),
          bcvRateApplied: bcv,
          paidVes: Math.round(inst.amountUsd * bcv * 100) / 100,
          paymentReference: paymentRef,
        };
      });

      const allPaid = updatedInstallments.every((i) => i.status === 'paid');
      return {
        ...plan,
        installments: updatedInstallments,
        status: allPaid ? ('completed' as const) : ('active' as const),
      };
    });

    // Mark liability as paid
    const liabilityId = `liab-cashea-${planId}-${installmentNumber}`;
    const liabilities = this.state().liabilities.map((l) =>
      l.id === liabilityId
        ? {
            ...l,
            status: 'paid' as const,
            amountPaid: l.triMonetary.amount_usd,
            remainingAmount: 0,
            updatedAt: new Date().toISOString(),
          }
        : l,
    );

    this.updateState({ casheaPlans: plans, liabilities });
  }

  // -------------------------------------------------------------
  // SUB-MÓDULO 2: PYME & PROVEEDORES
  // -------------------------------------------------------------

  addProvider(provider: Omit<PymeProvider, 'id' | 'createdAt'>): PymeProvider {
    const id = `prov-${Date.now()}`;
    const newProv: PymeProvider = {
      ...provider,
      id,
      createdAt: new Date().toISOString(),
    };
    this.updateState({ providers: [...this.state().providers, newProv] });
    return newProv;
  }

  updateProvider(id: string, partial: Partial<PymeProvider>): void {
    const updated = this.state().providers.map((p) => (p.id === id ? { ...p, ...partial } : p));
    this.updateState({ providers: updated });
  }

  addInventoryItem(item: Omit<PymeInventoryItem, 'id' | 'updatedAt' | 'status'>): PymeInventoryItem {
    const id = `inv-${Date.now()}`;
    const status: PymeInventoryItem['status'] =
      item.currentStock <= 0
        ? 'depleted'
        : item.currentStock <= item.minimumStock
          ? 'low'
          : 'optimal';

    const newItem: PymeInventoryItem = {
      ...item,
      id,
      status,
      updatedAt: new Date().toISOString(),
    };
    this.updateState({ inventory: [...this.state().inventory, newItem] });
    return newItem;
  }

  updateInventoryItem(id: string, partial: Partial<PymeInventoryItem>): void {
    const updated = this.state().inventory.map((item) => {
      if (item.id !== id) return item;
      const merged = { ...item, ...partial };
      const status: PymeInventoryItem['status'] =
        merged.currentStock <= 0
          ? 'depleted'
          : merged.currentStock <= merged.minimumStock
            ? 'low'
            : 'optimal';
      return { ...merged, status, updatedAt: new Date().toISOString() };
    });
    this.updateState({ inventory: updated });
  }

  // -------------------------------------------------------------
  // SUB-MÓDULO 3: PRESUPUESTOS (OBRAS & TALLER)
  // -------------------------------------------------------------

  addQuote(quote: Omit<BudgetQuote, 'id' | 'createdAt'>): BudgetQuote {
    const id = `quote-${Date.now()}`;
    const newQuote: BudgetQuote = {
      ...quote,
      id,
      createdAt: new Date().toISOString(),
    };
    this.updateState({ quotes: [newQuote, ...this.state().quotes] });
    return newQuote;
  }

  saveQuote(quote: Omit<BudgetQuote, 'id' | 'createdAt'>): BudgetQuote {
    return this.addQuote(quote);
  }

  updateQuoteStatus(id: string, status: BudgetQuote['status']): void {
    const updated = this.state().quotes.map((q) => (q.id === id ? { ...q, status } : q));
    this.updateState({ quotes: updated });
  }

  // -------------------------------------------------------------
  // INTERNAL STATE MANAGEMENT & VAULT BALANCES
  // -------------------------------------------------------------

  private creditVault(vaultId: string, amountUsd: number): void {
    const bcv = this.currentBcvRate();
    const updated = this.state().assets.map((v) => {
      if (v.id !== vaultId) return v;
      const delta = v.currency === 'VES' ? amountUsd * bcv : amountUsd;
      const newBal = Math.round((v.balance + delta) * 100) / 100;
      return {
        ...v,
        balance: newBal,
        updatedAt: new Date().toISOString(),
      };
    });
    this.updateState({ assets: updated });
  }

  private debitVault(vaultId: string, amountUsd: number): void {
    const bcv = this.currentBcvRate();
    const updated = this.state().assets.map((v) => {
      if (v.id !== vaultId) return v;
      const delta = v.currency === 'VES' ? amountUsd * bcv : amountUsd;
      const newBal = Math.round((v.balance - delta) * 100) / 100;
      return {
        ...v,
        balance: newBal,
        updatedAt: new Date().toISOString(),
      };
    });
    this.updateState({ assets: updated });
  }

  private updateState(patch: Partial<Finance360LedgerState>): void {
    const nextState: Finance360LedgerState = {
      ...this.state(),
      ...patch,
      lastUpdated: new Date().toISOString(),
    };
    this.state.set(nextState);
    this.storage.set(FINANCE_360_STORAGE_KEY, nextState);
    this.recomputeEquivalents();
  }

  private recomputeEquivalents(): void {
    const bcv = this.currentBcvRate();
    const assets = this.state().assets.map((a) => {
      let usd = a.balance;
      let ves = a.balance;
      if (a.currency === 'VES') {
        usd = bcv > 0 ? Math.round((a.balance / bcv) * 100) / 100 : 0;
        ves = a.balance;
      } else {
        ves = Math.round(a.balance * bcv * 100) / 100;
      }
      return {
        ...a,
        balanceUsdEquivalent: usd,
        balanceVesEquivalent: ves,
      };
    });

    if (JSON.stringify(assets) !== JSON.stringify(this.state().assets)) {
      this.state.update((s) => ({ ...s, assets }));
    }
  }

  private loadInitialState(): Finance360LedgerState {
    const saved = this.storage.get<Finance360LedgerState>(FINANCE_360_STORAGE_KEY);
    if (saved && saved.version === CURRENT_LEDGER_VERSION) {
      return saved;
    }

    const initial: Finance360LedgerState = {
      version: CURRENT_LEDGER_VERSION,
      assets: DEFAULT_VAULTS,
      liabilities: [],
      incomes: [],
      expenses: [],
      casheaPlans: [],
      providers: [],
      inventory: [],
      quotes: [],
      lastUpdated: new Date().toISOString(),
    };

    this.storage.set(FINANCE_360_STORAGE_KEY, initial);
    return initial;
  }
}
