import { Injectable, computed, inject, signal, Optional, type WritableSignal } from '@angular/core';
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
  type TriMonetaryAmount,
  computeTriMonetaryAmount,
} from './models/finance-360.models';

export interface UnifiedMovementItem {
  id: string;
  type: 'income' | 'expense';
  title: string;
  scope: FinanceScope;
  category: string;
  categoryLabel: string;
  channel: string;
  vaultId?: string;
  vaultName: string;
  amountUsd: number;
  amountVes: number;
  bcvRateApplied: number;
  triMonetary: TriMonetaryAmount;
  date: string;
  createdAt: string;
  notes?: string;
}

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
  private readonly storage: IndexedDbStorageService;
  private readonly accountsService: AccountsService;
  private readonly cotizaveService: CotizaveService;

  /** Active Chameleon Mode filter: 'all' | 'personal' | 'business' */
  readonly scope = signal<FinanceScope>('all');

  /** Reactive in-memory state of the Finance 360 ledger */
  readonly state: WritableSignal<Finance360LedgerState>;

  constructor(
    @Optional() storage?: IndexedDbStorageService,
    @Optional() accountsService?: AccountsService,
    @Optional() cotizaveService?: CotizaveService,
  ) {
    this.storage = storage ?? (inject(IndexedDbStorageService, { optional: true }) as IndexedDbStorageService);
    this.accountsService = accountsService ?? (inject(AccountsService, { optional: true }) as AccountsService);
    this.cotizaveService = cotizaveService ?? (inject(CotizaveService, { optional: true }) as CotizaveService);
    this.state = signal<Finance360LedgerState>(this.loadInitialState());
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
    liquidUsd: number;
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
        liquidUsd: liquidAssets,
      };
    }

    const coverageRatio = liquidAssets / due14DaysUsd;
    if (coverageRatio >= 2.0) {
      return {
        status: 'optimal',
        label: `LIQUIDEZ EXCELENTE (Cubre ${Math.round(coverageRatio * 10) / 10}x tus compromisos a 14 días)`,
        ratio: Math.min(100, Math.round(coverageRatio * 50)),
        due14DaysUsd,
        liquidUsd: liquidAssets,
      };
    } else if (coverageRatio >= 1.0) {
      return {
        status: 'warning',
        label: `LIQUIDEZ AJUSTADA (Cubre ${Math.round(coverageRatio * 100)}% de los próximos 14 días)`,
        ratio: Math.round(coverageRatio * 50),
        due14DaysUsd,
        liquidUsd: liquidAssets,
      };
    } else {
      return {
        status: 'critical',
        label: `ALERTA DE DÉFICIT (Faltan $${Math.round((due14DaysUsd - liquidAssets) * 100) / 100} para cubrir compromisos)`,
        ratio: Math.max(10, Math.round(coverageRatio * 50)),
        due14DaysUsd,
        liquidUsd: liquidAssets,
      };
    }
  });

  /**
   * VES FX Erosion & Devaluation Exposure Telemetry
   */
  readonly vesExposureTelemetry = computed<{
    vesBalanceTotal: number;
    vesEquivalentUsd: number;
    totalVesInUsd: number;
    exposurePct: number;
    exposurePercent: number;
    rateGapPct: number;
    rateGapPercent: number;
    erosionLoss5PctUsd: number;
    purchasingPowerLostOn5PctJumpUsd: number;
    isHighExposure: boolean;
  }>(() => {
    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const totalUsd = this.totalAssetsUsd();
    const vesVaults = this.assets().filter((a) => a.currency === 'VES');
    const vesBalanceTotal = vesVaults.reduce((s, v) => s + v.balance, 0);
    const vesEquivalentUsd = bcv > 0 ? Math.round((vesBalanceTotal / bcv) * 100) / 100 : 0;
    const exposurePct = totalUsd > 0 ? Math.round((vesEquivalentUsd / totalUsd) * 1000) / 10 : 0;
    const rateGapPct = bcv > 0 ? Math.round(((par - bcv) / bcv) * 1000) / 10 : 0;
    const erosionLoss5PctUsd = Math.round(vesEquivalentUsd * 0.0476 * 100) / 100;

    return {
      vesBalanceTotal,
      vesEquivalentUsd,
      totalVesInUsd: vesEquivalentUsd,
      exposurePct,
      exposurePercent: exposurePct,
      rateGapPct,
      rateGapPercent: rateGapPct,
      erosionLoss5PctUsd,
      purchasingPowerLostOn5PctJumpUsd: erosionLoss5PctUsd,
      isHighExposure: exposurePct > 25,
    };
  });

  /**
   * Chronological Unified Movements Feed (Incomes + Expenses sorted by newest first)
   */
  readonly unifiedMovements = computed<UnifiedMovementItem[]>(() => {
    const vaultMap = new Map(this.state().assets.map((v) => [v.id, v.name]));
    const catLabels: Record<string, string> = {
      salary: '💼 Sueldo / Salario',
      p2p_profit: '⚡ Ganancia Mesa P2P',
      business_sale: '🏢 Venta Comercial',
      quote_advance: '📝 Anticipo Presupuesto',
      freelance: '💻 Honorarios',
      investment: '📈 Inversión',
      groceries: '🛒 Comida y Mercado',
      housing: '🏠 Vivienda y Alquiler',
      transport: '⛽ Gasolina / Transporte',
      services: '💡 Servicios Públicos',
      health: '💊 Salud y Medicina',
      cashea_installment: '⚡ Cuota Cashea',
      provider_merchandise: '📦 Proveedor / Mercancía',
      payroll: '👥 Nómina de Personal',
      maintenance: '🔧 Mantenimiento / Taller',
      equipment_capex: '🏗️ Equipos / CAPEX',
      other: '📌 General',
    };

    const incItems: UnifiedMovementItem[] = this.incomes().map((inc) => ({
      id: inc.id,
      type: 'income' as const,
      title: inc.title,
      scope: inc.scope,
      category: inc.category,
      categoryLabel: catLabels[inc.category] || inc.category,
      channel: inc.channel,
      vaultId: inc.vaultId,
      vaultName: inc.vaultId ? vaultMap.get(inc.vaultId) || 'Cuenta Externa' : 'Flujo Directo',
      amountUsd: inc.triMonetary.amount_usd,
      amountVes: inc.triMonetary.amount_ves,
      bcvRateApplied: inc.triMonetary.bcv_rate,
      triMonetary: inc.triMonetary,
      date: inc.date,
      createdAt: inc.createdAt,
      notes: inc.notes,
    }));

    const expItems: UnifiedMovementItem[] = this.expenses().map((exp) => ({
      id: exp.id,
      type: 'expense' as const,
      title: exp.title,
      scope: exp.scope,
      category: exp.category,
      categoryLabel: catLabels[exp.category] || exp.category,
      channel: exp.channel,
      vaultId: exp.vaultId,
      vaultName: exp.vaultId ? vaultMap.get(exp.vaultId) || 'Cuenta Externa' : 'Flujo Directo',
      amountUsd: exp.triMonetary.amount_usd,
      amountVes: exp.triMonetary.amount_ves,
      bcvRateApplied: exp.triMonetary.bcv_rate,
      triMonetary: exp.triMonetary,
      date: exp.date,
      createdAt: exp.createdAt,
      notes: exp.notes,
    }));

    return [...incItems, ...expItems].sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
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

    // If attached to a liability, credit the payment without duplicating expense
    if (newEntry.liabilityId) {
      this.payLiability(newEntry.liabilityId, newEntry.triMonetary.amount_usd, undefined, false);
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

  payLiability(
    id: string,
    amountPaidUsd: number,
    debitVaultId?: string,
    recordLedgerExpense: boolean = true,
  ): void {
    const target = this.state().liabilities.find((l) => l.id === id);
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

    let nextExpenses = this.state().expenses;
    if (recordLedgerExpense && target && amountPaidUsd > 0) {
      const bcv = this.currentBcvRate();
      const par = this.currentParallelRate();
      const vault = debitVaultId
        ? this.state().assets.find((v) => v.id === debitVaultId)
        : undefined;
      const expenseEntry: ExpenseEntry = {
        id: `exp-liab-${Date.now()}`,
        title: `Liquidación Pasivo: ${target.title}`,
        scope: target.scope === 'all' ? 'personal' : target.scope,
        category:
          target.category === 'cashea'
            ? 'cashea_installment'
            : target.category === 'provider'
              ? 'provider_merchandise'
              : target.category === 'tax'
                ? 'taxes'
                : 'services',
        channel: vault?.channel ?? 'bs_bank',
        vaultId: debitVaultId,
        liabilityId: target.id,
        triMonetary: computeTriMonetaryAmount(amountPaidUsd, 'USD', bcv, par),
        date: new Date().toISOString().split('T')[0],
        notes: `Acreedor: ${target.creditor}`,
        createdAt: new Date().toISOString(),
      };
      nextExpenses = [expenseEntry, ...nextExpenses];
    }

    this.updateState({ liabilities: updated, expenses: nextExpenses });
  }

  /**
   * Transfers funds between two vaults, converting currencies automatically via BCV rate.
   */
  transferBetweenVaults(
    fromVaultId: string,
    toVaultId: string,
    amountInSourceCurrency: number,
  ): { success: boolean; creditedAmount: number; targetCurrency: CurrencyCode } {
    if (!fromVaultId || !toVaultId || fromVaultId === toVaultId || amountInSourceCurrency <= 0) {
      return { success: false, creditedAmount: 0, targetCurrency: 'USD' };
    }

    const assets = this.state().assets;
    const fromVault = assets.find((v) => v.id === fromVaultId);
    const toVault = assets.find((v) => v.id === toVaultId);
    if (!fromVault || !toVault) {
      return { success: false, creditedAmount: 0, targetCurrency: 'USD' };
    }

    const bcv = this.currentBcvRate();
    const amountUsd =
      fromVault.currency === 'VES'
        ? bcv > 0
          ? amountInSourceCurrency / bcv
          : 0
        : amountInSourceCurrency;

    const creditedAmount =
      toVault.currency === 'VES'
        ? Math.round(amountUsd * bcv * 100) / 100
        : Math.round(amountUsd * 100) / 100;

    const updatedAssets = assets.map((v) => {
      if (v.id === fromVaultId) {
        return {
          ...v,
          balance: Math.max(0, Math.round((v.balance - amountInSourceCurrency) * 100) / 100),
          updatedAt: new Date().toISOString(),
        };
      }
      if (v.id === toVaultId) {
        return {
          ...v,
          balance: Math.round((v.balance + creditedAmount) * 100) / 100,
          updatedAt: new Date().toISOString(),
        };
      }
      return v;
    });

    this.updateState({ assets: updatedAssets });
    return {
      success: true,
      creditedAmount,
      targetCurrency: toVault.currency,
    };
  }

  /**
   * Deletes an income or expense entry and reverses its vault impact if applicable.
   */
  deleteMovement(id: string, type: 'income' | 'expense'): void {
    if (type === 'income') {
      const target = this.state().incomes.find((i) => i.id === id);
      if (target?.vaultId) {
        this.debitVault(target.vaultId, target.triMonetary.amount_usd);
      }
      this.updateState({
        incomes: this.state().incomes.filter((i) => i.id !== id),
      });
    } else {
      const target = this.state().expenses.find((e) => e.id === id);
      if (target?.vaultId) {
        this.creditVault(target.vaultId, target.triMonetary.amount_usd);
      }
      this.updateState({
        expenses: this.state().expenses.filter((e) => e.id !== id),
      });
    }
  }

  /**
   * Settles a commercial Pyme sale and records the 3-drawer firewall allocation.
   */
  settlePymeSaleWithDrawers(params: {
    title: string;
    totalUsd: number;
    vaultId?: string;
    drawer1Usd: number;
    drawer2Usd: number;
    drawer3Usd: number;
  }): IncomeEntry {
    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const tri = computeTriMonetaryAmount(params.totalUsd, 'USD', bcv, par);
    const today = new Date().toISOString().split('T')[0];

    return this.addIncome({
      title: params.title || 'Venta Comercial (3 Gavetas)',
      scope: 'business',
      category: 'business_sale',
      channel: 'cash',
      vaultId: params.vaultId || 'vault-pyme-caja',
      triMonetary: tri,
      date: today,
      notes: `Cortafuegos 3 Gavetas: Reposición $${params.drawer1Usd.toFixed(2)} | Operativa $${params.drawer2Usd.toFixed(2)} | Utilidad Libre $${params.drawer3Usd.toFixed(2)}`,
    });
  }

  /**
   * Seeds realistic institutional demo data for visual inspection and stress testing.
   */
  seedDemoPortfolio(): void {
    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const now = Date.now();
    const dayMs = 86400000;
    const fmtDate = (daysAgo: number) => new Date(now - daysAgo * dayMs).toISOString().split('T')[0];

    const demoIncomes: IncomeEntry[] = [
      {
        id: `inc-demo-1`,
        title: 'Anticipo 50% Pintura General Corolla',
        scope: 'business',
        category: 'quote_advance',
        channel: 'zelle',
        vaultId: 'vault-pyme-caja',
        triMonetary: computeTriMonetaryAmount(420, 'USD', bcv, par),
        date: fmtDate(1),
        createdAt: new Date(now - dayMs).toISOString(),
        notes: 'Gaveta 1: $231 | Gaveta 2: $105 | Utilidad: $84',
      },
      {
        id: `inc-demo-2`,
        title: 'Honorarios Consultoría & Gestión',
        scope: 'personal',
        category: 'salary',
        channel: 'zelle',
        vaultId: 'vault-zelle-pers',
        triMonetary: computeTriMonetaryAmount(650, 'USD', bcv, par),
        date: fmtDate(3),
        createdAt: new Date(now - 3 * dayMs).toISOString(),
      },
      {
        id: `inc-demo-3`,
        title: 'Entrega Obra Remodelación Drywall',
        scope: 'business',
        category: 'business_sale',
        channel: 'cash',
        vaultId: 'vault-cash-usd',
        triMonetary: computeTriMonetaryAmount(380, 'USD', bcv, par),
        date: fmtDate(5),
        createdAt: new Date(now - 5 * dayMs).toISOString(),
      },
    ];

    const demoExpenses: ExpenseEntry[] = [
      {
        id: `exp-demo-1`,
        title: 'Compra Barniz Automotriz 2K & Lijas',
        scope: 'business',
        category: 'provider_merchandise',
        channel: 'zelle',
        vaultId: 'vault-pyme-caja',
        triMonetary: computeTriMonetaryAmount(145, 'USD', bcv, par),
        date: fmtDate(0),
        createdAt: new Date(now - 3600000).toISOString(),
      },
      {
        id: `exp-demo-2`,
        title: 'Mercado Semanal Familiar',
        scope: 'personal',
        category: 'groceries',
        channel: 'bs_bank',
        vaultId: 'vault-banesco-pers',
        triMonetary: computeTriMonetaryAmount(85, 'USD', bcv, par),
        date: fmtDate(1),
        createdAt: new Date(now - dayMs).toISOString(),
      },
      {
        id: `exp-demo-3`,
        title: 'Adelanto Nómina Técnico Pintor',
        scope: 'business',
        category: 'payroll',
        channel: 'cash',
        vaultId: 'vault-pyme-caja',
        triMonetary: computeTriMonetaryAmount(110, 'USD', bcv, par),
        date: fmtDate(2),
        createdAt: new Date(now - 2 * dayMs).toISOString(),
      },
      {
        id: `exp-demo-4`,
        title: 'Gasolina, Peajes y Logística',
        scope: 'personal',
        category: 'transport',
        channel: 'cash',
        vaultId: 'vault-cash-usd',
        triMonetary: computeTriMonetaryAmount(35, 'USD', bcv, par),
        date: fmtDate(4),
        createdAt: new Date(now - 4 * dayMs).toISOString(),
      },
      {
        id: `exp-demo-5`,
        title: 'Internet Fibra & Electricidad Taller',
        scope: 'business',
        category: 'services',
        channel: 'bs_bank',
        vaultId: 'vault-banesco-pers',
        triMonetary: computeTriMonetaryAmount(55, 'USD', bcv, par),
        date: fmtDate(6),
        createdAt: new Date(now - 6 * dayMs).toISOString(),
      },
    ];

    const schedule = this.calculateCasheaSchedule(240, 3, 3, new Date(now - 10 * dayMs));
    const demoPlan: CasheaPlan = {
      id: 'cashea-demo-1',
      productName: 'Compresor Neumático 50L + Pistola HVLP',
      storeName: 'Ferretería EPA',
      totalPriceUsd: 240,
      initialPaymentUsd: schedule.initialPaymentUsd,
      initialPercentage: schedule.initialPercentage,
      numberOfInstallments: 3,
      installmentAmountUsd: schedule.installmentAmountUsd,
      installmentFrequencyDays: 14,
      startDate: fmtDate(10),
      installments: schedule.installments,
      status: 'active',
      createdAt: new Date(now - 10 * dayMs).toISOString(),
    };

    const demoLiabilities: LiabilityItem[] = schedule.installments.map((inst) => ({
      id: `liab-cashea-cashea-demo-1-${inst.number}`,
      title: `Cuota Cashea #${inst.number} - Compresor 50L`,
      creditor: 'Cashea (Ferretería EPA)',
      scope: 'business',
      category: 'cashea',
      triMonetary: computeTriMonetaryAmount(inst.amountUsd, 'USD', bcv, par),
      dueDate: inst.dueDate,
      status: 'pending',
      amountPaid: 0,
      remainingAmount: inst.amountUsd,
      casheaPlanId: 'cashea-demo-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    this.updateState({
      incomes: [...demoIncomes, ...this.state().incomes.filter((i) => !i.id.startsWith('inc-demo-'))],
      expenses: [...demoExpenses, ...this.state().expenses.filter((e) => !e.id.startsWith('exp-demo-'))],
      casheaPlans: [demoPlan, ...this.state().casheaPlans.filter((p) => p.id !== 'cashea-demo-1')],
      liabilities: [
        ...demoLiabilities,
        ...this.state().liabilities.filter((l) => !l.id.startsWith('liab-cashea-cashea-demo-1-')),
      ],
    });
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
    debitVaultId?: string,
  ): void {
    let paidAmountUsd = 0;
    let planTitle = 'Compra Cashea';
    const bcv = bcvRateApplied ?? this.currentBcvRate();
    const par = this.currentParallelRate();

    const plans = this.state().casheaPlans.map((plan) => {
      if (plan.id !== planId) return plan;
      planTitle = plan.productName;
      const updatedInstallments = plan.installments.map((inst) => {
        if (inst.number !== installmentNumber) return inst;
        paidAmountUsd = inst.amountUsd;
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

    if (debitVaultId && paidAmountUsd > 0) {
      this.debitVault(debitVaultId, paidAmountUsd);
    }

    let nextExpenses = this.state().expenses;
    if (paidAmountUsd > 0) {
      const vault = debitVaultId
        ? this.state().assets.find((v) => v.id === debitVaultId)
        : undefined;
      const exp: ExpenseEntry = {
        id: `exp-cashea-${planId}-${installmentNumber}-${Date.now()}`,
        title: `Cuota Cashea #${installmentNumber} - ${planTitle}`,
        scope: 'personal',
        category: 'cashea_installment',
        channel: vault?.channel ?? 'bs_bank',
        vaultId: debitVaultId,
        liabilityId,
        triMonetary: computeTriMonetaryAmount(paidAmountUsd, 'USD', bcv, par),
        date: new Date().toISOString().split('T')[0],
        referenceNumber: paymentRef,
        notes: paymentRef ? `Ref: ${paymentRef}` : 'Cuota quincenal Cashea liquidada',
        createdAt: new Date().toISOString(),
      };
      nextExpenses = [exp, ...nextExpenses];
    }

    this.updateState({ casheaPlans: plans, liabilities, expenses: nextExpenses });
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

  payProviderWithVault(providerId: string, amountUsd: number, debitVaultId?: string): void {
    const prov = this.state().providers.find((p) => p.id === providerId);
    if (!prov || amountUsd <= 0) return;

    const updatedDebt = Math.max(0, Math.round((prov.outstandingDebtUsd - amountUsd) * 100) / 100);
    this.updateProvider(providerId, { outstandingDebtUsd: updatedDebt });

    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const vault = debitVaultId
      ? this.state().assets.find((v) => v.id === debitVaultId)
      : undefined;

    this.addExpense({
      title: `Pago a Proveedor: ${prov.name}`,
      scope: 'business',
      category: 'provider_merchandise',
      channel: vault?.channel ?? 'zelle',
      vaultId: debitVaultId,
      triMonetary: computeTriMonetaryAmount(amountUsd, 'USD', bcv, par),
      date: new Date().toISOString().split('T')[0],
      notes: `Rubro: ${prov.category} · Saldo restante: $${updatedDebt.toFixed(2)} USD`,
    });
  }

  /**
   * Simulates the impact of a future BCV exchange rate on VES vaults and BCV-indexed liabilities.
   */
  simulateBcvRateImpact(simulatedBcvRate: number): {
    currentBcv: number;
    simulatedBcv: number;
    devaluationPct: number;
    vesBalanceTotal: number;
    currentVesInUsd: number;
    simulatedVesInUsd: number;
    purchasingPowerDeltaUsd: number;
    projectedNetWorthUsd: number;
    projectedNetWorthVes: number;
  } {
    const currentBcv = Math.max(1, this.currentBcvRate());
    const simBcv = Math.max(1, simulatedBcvRate);
    const vesVaults = this.assets().filter((a) => a.currency === 'VES');
    const vesBalanceTotal = vesVaults.reduce((s, v) => s + v.balance, 0);

    const currentVesInUsd = Math.round((vesBalanceTotal / currentBcv) * 100) / 100;
    const simulatedVesInUsd = Math.round((vesBalanceTotal / simBcv) * 100) / 100;
    const purchasingPowerDeltaUsd = Math.round((simulatedVesInUsd - currentVesInUsd) * 100) / 100;
    const devaluationPct = Math.round(((simBcv - currentBcv) / currentBcv) * 1000) / 10;

    const projectedNetWorthUsd = Math.round((this.netWorthUsd() + purchasingPowerDeltaUsd) * 100) / 100;
    const projectedNetWorthVes = Math.round(projectedNetWorthUsd * simBcv * 100) / 100;

    return {
      currentBcv,
      simulatedBcv: simBcv,
      devaluationPct,
      vesBalanceTotal,
      currentVesInUsd,
      simulatedVesInUsd,
      purchasingPowerDeltaUsd,
      projectedNetWorthUsd,
      projectedNetWorthVes,
    };
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

  /**
   * Computes the real-time accumulated balance across the 3 Pyme Drawers
   * based on business incomes and categorized business expenses.
   */
  readonly pymeDrawersTelemetry = computed(() => {
    const state = this.state();
    const bcv = this.currentBcvRate();
    const pymeVault = state.assets.find((a) => a.id === 'vault-pyme-caja');
    const baseCajaUsd = pymeVault ? pymeVault.balanceUsdEquivalent : 0;

    const bizIncomesUsd = state.incomes
      .filter((i) => i.scope === 'business')
      .reduce((acc, i) => acc + i.triMonetary.amount_usd, 0);

    const merchExpensesUsd = state.expenses
      .filter((e) => e.scope === 'business' && e.category === 'provider_merchandise')
      .reduce((acc, e) => acc + e.triMonetary.amount_usd, 0);

    const opsExpensesUsd = state.expenses
      .filter(
        (e) =>
          e.scope === 'business' &&
          (e.category === 'payroll' ||
            e.category === 'services' ||
            e.category === 'rent' ||
            e.category === 'utilities' ||
            e.category === 'maintenance'),
      )
      .reduce((acc, e) => acc + e.triMonetary.amount_usd, 0);

    const capexExpensesUsd = state.expenses
      .filter((e) => e.scope === 'business' && e.category === 'equipment_capex')
      .reduce((acc, e) => acc + e.triMonetary.amount_usd, 0);

    // BaseCaja + Inflows allocated 50% / 30% / 20% minus each drawer's outflows
    const poolBase = Math.max(baseCajaUsd, bizIncomesUsd > 0 ? bizIncomesUsd : baseCajaUsd);
    const drawer1AvailableUsd = Math.max(0, Number((poolBase * 0.5 - merchExpensesUsd * 0.35).toFixed(2)));
    const drawer2AvailableUsd = Math.max(0, Number((poolBase * 0.3 - opsExpensesUsd * 0.35).toFixed(2)));
    const drawer3AvailableUsd = Math.max(0, Number((poolBase * 0.2 - capexExpensesUsd * 0.35).toFixed(2)));

    return {
      drawer1AvailableUsd,
      drawer1AvailableVes: Number((drawer1AvailableUsd * bcv).toFixed(2)),
      merchExpensesUsd: Number(merchExpensesUsd.toFixed(2)),
      drawer2AvailableUsd,
      drawer2AvailableVes: Number((drawer2AvailableUsd * bcv).toFixed(2)),
      opsExpensesUsd: Number(opsExpensesUsd.toFixed(2)),
      drawer3AvailableUsd,
      drawer3AvailableVes: Number((drawer3AvailableUsd * bcv).toFixed(2)),
      capexExpensesUsd: Number(capexExpensesUsd.toFixed(2)),
      pymeCajaBalanceUsd: Number(baseCajaUsd.toFixed(2)),
    };
  });

  /**
   * Restocks an inventory item and automatically records either a Vault Expense
   * or a Supplier Credit Liability so inventory and accounting stay 100% in sync.
   */
  restockInventoryWithAccounting(params: {
    itemId: string;
    quantityToAdd: number;
    paymentMode: 'vault' | 'provider_credit';
    vaultId?: string;
    providerId?: string;
  }): { success: boolean; totalCostUsd: number; newStock: number } {
    const item = this.state().inventory.find((i) => i.id === params.itemId);
    if (!item || params.quantityToAdd <= 0) {
      return { success: false, totalCostUsd: 0, newStock: 0 };
    }

    const totalCostUsd = Math.round(item.unitCostUsd * params.quantityToAdd * 100) / 100;
    const newStock = item.currentStock + params.quantityToAdd;
    this.updateInventoryItem(item.id, { currentStock: newStock });

    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const tri = computeTriMonetaryAmount(totalCostUsd, 'USD', bcv, par);
    const today = new Date().toISOString().split('T')[0];

    if (params.paymentMode === 'vault') {
      const targetVaultId = params.vaultId || 'vault-pyme-caja';
      const vault = this.state().assets.find((v) => v.id === targetVaultId);
      this.addExpense({
        title: `Reposición Stock (+${params.quantityToAdd} u.): ${item.name}`,
        scope: 'business',
        category: 'provider_merchandise',
        channel: vault?.channel ?? 'zelle',
        vaultId: targetVaultId,
        drawerAllocation: 'drawer_merchandise',
        triMonetary: tri,
        date: today,
        notes: `Costo unitario: $${item.unitCostUsd} USD · Stock resultante: ${newStock} u.`,
      });
    } else {
      const providers = this.state().providers;
      const prov =
        providers.find((p) => p.id === params.providerId) || providers[0];
      if (prov) {
        this.updateProvider(prov.id, {
          outstandingDebtUsd: Math.round((prov.outstandingDebtUsd + totalCostUsd) * 100) / 100,
        });
      }
      const dueIn14Days = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
      this.addLiability({
        title: `Factura Reposición (+${params.quantityToAdd} u.): ${item.name}`,
        creditor: prov ? prov.name : 'Proveedor de Insumos Pyme',
        scope: 'business',
        category: 'provider',
        triMonetary: tri,
        dueDate: dueIn14Days,
        status: 'pending',
        amountPaid: 0,
        remainingAmount: totalCostUsd,
        providerId: prov?.id,
      });
    }

    return { success: true, totalCostUsd, newStock };
  }

  /**
   * Restores a complete Master Ledger state from an imported JSON backup.
   */
  restoreLedgerState(importedLedger: Finance360LedgerState): boolean {
    if (!importedLedger || !Array.isArray(importedLedger.assets)) {
      return false;
    }
    this.updateState({
      assets: importedLedger.assets,
      liabilities: importedLedger.liabilities ?? [],
      incomes: importedLedger.incomes ?? [],
      expenses: importedLedger.expenses ?? [],
      casheaPlans: importedLedger.casheaPlans ?? [],
      providers: importedLedger.providers ?? [],
      inventory: importedLedger.inventory ?? [],
      quotes: importedLedger.quotes ?? [],
    });
    return true;
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
