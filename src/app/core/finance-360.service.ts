import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type WritableSignal,
} from '@angular/core';
import { IndexedDbStorageService } from './indexed-db-storage.service';
import { AccountsService } from './accounts.service';
import { AuditLoggerService, type AuditCategory, type AuditSeverity } from './audit-logger.service';
import { CotizaveService } from './cotizave.service';
import { computeLogSummary } from '@p2p/core';
import {
  CASHEA_CLUB_TIERS,
  addCalendarDays,
  addCalendarMonths,
  calendarDaysBetween,
  computeProratedQuoteLines,
  computeTriMonetaryAmount,
  generateFinanceId,
  getDrawerForExpenseCategory,
  parseCalendarDate,
  roundMoney,
  todayVetIso,
  type AssetVault,
  type BudgetQuote,
  type CasheaCreditLine,
  type CasheaInstallment,
  type CasheaInstallmentHealth,
  type CasheaLevel,
  type CasheaMerchantSale,
  type CasheaMerchantSaleInput,
  type CasheaMerchantSaleSimulation,
  type CasheaPlan,
  type CasheaUserProfile,
  type CurrencyCode,
  type ExpenseCategory,
  type ExpenseEntry,
  type Finance360LedgerState,
  type FinanceScope,
  type IncomeCategory,
  type IncomeEntry,
  type LiabilityItem,
  type PaymentChannel,
  type PymeBusinessProfile,
  type PymeInventoryItem,
  type PymeProvider,
  type RecurringRule,
  type TransferEntry,
  type TriMonetaryAmount,
  type VaultReconciliationRecord,
  type WealthGoal,
} from './models/finance-360.models';

export { computeProratedQuoteLines, getDrawerForExpenseCategory };

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

export interface VaultTransferResult {
  success: boolean;
  reason?: 'INVALID_INPUT' | 'VAULT_NOT_FOUND' | 'INSUFFICIENT_FUNDS' | 'MISSING_FX_RATE';
  creditedAmount: number;
  targetCurrency: CurrencyCode;
  transferId?: string;
  groupId?: string;
}

export interface LiabilityPaymentResult {
  success: boolean;
  appliedAmountUsd: number;
  remainingAmountUsd: number;
  reason?: 'NOT_FOUND' | 'ALREADY_PAID' | 'INVALID_AMOUNT';
}

export interface CasheaScheduleOptions {
  creditLine?: CasheaCreditLine;
  initialPercent?: number;
  firstDueDate?: string;
  startDate?: Date | string;
  frequencyDays?: number;
  zeroInitialCampaign?: boolean;
}

export interface CasheaScheduleBreakdown {
  level: CasheaLevel;
  tierName: string;
  creditLine: CasheaCreditLine;
  initialPercent: number;
  initialPercentage: number;
  initialFactor: number;
  initialPaymentUsd: number;
  financedAmountUsd: number;
  installmentAmountUsd: number;
  finalInstallmentAmountUsd: number;
  installmentsCount: number;
  frequencyDays: number;
  installments: CasheaInstallment[];
}

export interface CasheaPaymentResult {
  success: boolean;
  alreadyPaid: boolean;
  paidAmountUsd: number;
  expenseId?: string;
  reason?: 'NOT_FOUND' | 'ALREADY_PAID' | 'INVALID_AMOUNT';
}

export interface CasheaCollisionItem {
  date: string;
  existingLiabilities: LiabilityItem[];
  existingRecurringRules: RecurringRule[];
  totalExistingCommittedUsd: number;
  collisionCount: number;
  severity: 'none' | 'medium' | 'high';
}

export interface CasheaVsSavingsInput {
  productPriceUsd: number;
  level: CasheaLevel;
  installmentsCount: number;
  biweeklySavingsCapacityUsd: number;
  creditLine?: CasheaCreditLine;
  initialPercent?: number;
  expectedBiweeklyInflationPct?: number;
  bcvRate?: number;
  firstDueDate?: string;
  zeroInitialCampaign?: boolean;
}

export interface CasheaPathASavingsSummary {
  biweeklyPeriodsNeeded: number;
  daysUntilPurchase: number;
  projectedCashPriceUsd: number;
  debtRisk: 'none';
}

export interface CasheaPathBFinancedSummary {
  initialPaymentUsd: number;
  financedAmountUsd: number;
  installmentAmountUsd: number;
  installmentsCount: number;
  canAffordInstallment: boolean;
  biweeklySurplusAfterInstallmentUsd: number;
  collisionCount: number;
  totalCollisionExposureUsd: number;
}

export interface CasheaVsSavingsResult {
  pathA_savings: CasheaPathASavingsSummary;
  pathB_cashea: CasheaPathBFinancedSummary;
  recommendation: 'cashea_viable' | 'save_cash_recommended' | 'stretch_warning';
  rationale: string;
}

export interface DeductedInventoryItem {
  itemId: string;
  name: string;
  quantityDeducted: number;
  newStock: number;
}

export interface QuoteApprovalResult {
  success: boolean;
  alreadyApproved: boolean;
  reason?: 'QUOTE_NOT_FOUND' | 'ALREADY_APPROVED';
  advanceIncomeId?: string;
  receivableUsd: number;
  receivableVaultId?: string;
  payrollLiabilityId?: string;
  deductedInventory: DeductedInventoryItem[];
}

export interface SettleP2pProfitInput {
  netProfitUsdt: number;
  tradesCount: number;
  dateIso?: string;
  settlementId?: string;
  vaultId?: string;
  scope?: FinanceScope;
  realizedPnlVes?: number;
  bcvRateOverride?: number;
  parallelRateOverride?: number;
  title?: string;
  notes?: string;
}

export interface SettleP2pProfitResult {
  success: boolean;
  alreadySettled: boolean;
  reason?: 'NO_POSITIVE_PROFIT' | 'ALREADY_SETTLED';
  entryId?: string;
  profitUsd: number;
  profitVes: number;
  bcvRateApplied: number;
  parallelRateApplied: number;
  vaultId?: string;
}

export interface RecurringMaterializationResult {
  materializedCount: number;
  createdIds: string[];
}

export const FINANCE_360_STORAGE_KEY = 'p2p.finance360.ledger';
const CURRENT_LEDGER_VERSION = 2;
const VALID_CURRENCIES: ReadonlySet<CurrencyCode> = new Set(['USD', 'VES', 'USDT', 'EUR']);
const EUR_FALLBACK_RATE = 1.08;

function createDefaultCasheaProfile(): CasheaUserProfile {
  const today = todayVetIso();
  return {
    level: 1,
    principalLimitUsd: 0,
    principalUsedUsd: 0,
    cotidianaLimitUsd: 0,
    cotidianaUsedUsd: 0,
    cumulativeSpentUsd: 0,
    paidInstallmentsCount: 0,
    lastRecalculationDate: today,
    nextRecalculationDate: addCalendarDays(today, 90),
    clubPoints: 0,
    updatedAt: new Date().toISOString(),
  };
}

function createDefaultPymeProfile(): PymeBusinessProfile {
  return {
    businessName: 'Mi Negocio',
    defaultDrawer1Percent: 50,
    defaultDrawer2Percent: 30,
    defaultDrawer3Percent: 20,
    defaultIvaPercent: 16,
    defaultIgtfPercent: 3,
    casheaAllyModeEnabled: false,
    casheaAllyMdrPercent: 4,
    casheaAllyMonthlyMinimumUsd: 100,
    casheaAllyActivationFeeUsd: 0,
    updatedAt: new Date().toISOString(),
  };
}

function createEmptyLedgerState(): Finance360LedgerState {
  return {
    version: CURRENT_LEDGER_VERSION,
    assets: [],
    liabilities: [],
    incomes: [],
    expenses: [],
    casheaPlans: [],
    providers: [],
    inventory: [],
    quotes: [],
    goals: [],
    transfers: [],
    casheaProfile: createDefaultCasheaProfile(),
    casheaMerchantSales: [],
    recurringRules: [],
    pymeProfile: createDefaultPymeProfile(),
    vaultReconciliations: [],
    lastUpdated: new Date().toISOString(),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeRef(ref?: string): string {
  return (ref ?? '').trim().toLowerCase();
}

interface ElectronFinance360Bridge {
  getSnapshot?: () => Promise<unknown | null>;
  saveSnapshot?: (snapshot: unknown) => Promise<{ ok: boolean; updatedAt?: string }>;
}

@Injectable({ providedIn: 'root' })
export class Finance360Service {
  private readonly storage = inject(IndexedDbStorageService);
  private readonly accountsService = inject(AccountsService);
  private readonly cotizaveService = inject(CotizaveService);
  private readonly auditLogger = inject(AuditLoggerService, { optional: true });

  /** Active Chameleon Mode filter: 'all' | 'personal' | 'business' */
  readonly scope = signal<FinanceScope>('all');

  /** Reactive in-memory state of the Finance 360 ledger */
  readonly state: WritableSignal<Finance360LedgerState>;

  /** True once async IndexedDB + Electron SQLite hydration/migration completes */
  readonly hydrated = signal<boolean>(false);

  private hasLocalMutations = false;
  private readonly hydrationPromise: Promise<void>;

  constructor() {
    this.state = signal<Finance360LedgerState>(this.loadInitialState());
    this.hydrationPromise = this.hydrateFromPersistence();

    // Keep persisted vault equivalents reactively aligned with live Cotizave rates without deep JSON comparisons.
    effect(() => {
      const bcv = this.currentBcvRate();
      const eurUsd = this.currentEurUsdRate();
      const currentAssets = untracked(() => this.state().assets);
      const nextAssets = this.mapVaultEquivalents(currentAssets, bcv, eurUsd);
      if (nextAssets !== currentAssets) {
        untracked(() => {
          this.state.update((s) => ({ ...s, assets: nextAssets }));
        });
      }
    });
  }

  /** Resolves once async IndexedDB & Electron SQLite hydration/migration has finished. */
  whenHydrated(): Promise<void> {
    return this.hydrationPromise;
  }

  // -------------------------------------------------------------
  // LIVE FX RATES (ZERO INVENTED FALLBACKS)
  // -------------------------------------------------------------

  readonly currentBcvRate = computed<number>(() => {
    const rates = this.cotizaveService?.ratesByMarket?.() ?? {};
    const oficial = rates['oficial'] ?? rates['bcv'];
    const raw = oficial?.mid ?? oficial?.ask ?? 0;
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  });

  readonly isBcvRateLive = computed<boolean>(() => this.currentBcvRate() > 0);

  readonly currentParallelRate = computed<number>(() => {
    const rates = this.cotizaveService?.ratesByMarket?.() ?? {};
    const par = rates['parallel'] ?? rates['binance'] ?? rates['enparalelovzla'];
    const raw = par?.mid ?? par?.ask ?? 0;
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  });

  readonly isParallelRateLive = computed<boolean>(() => this.currentParallelRate() > 0);

  readonly currentEurUsdRate = computed<number>(() => {
    const rates = this.cotizaveService?.ratesByMarket?.() ?? {};
    const eur = rates['eur'] ?? rates['euro'] ?? rates['bcv_eur'] ?? rates['oficial_eur'];
    const rawEur = eur?.mid ?? eur?.ask ?? 0;
    if (!Number.isFinite(rawEur) || rawEur <= 0) return 0;

    const bcv = this.currentBcvRate();
    if (bcv > 0 && rawEur > 5) {
      return roundMoney(rawEur / bcv, 4);
    }
    if (rawEur > 0 && rawEur <= 5) {
      return roundMoney(rawEur, 4);
    }
    return 0;
  });

  readonly isEurRateLive = computed<boolean>(() => this.currentEurUsdRate() > 0);

  // -------------------------------------------------------------
  // COMPUTED VIEWS & METRICS (PROGRESSIVE DISCLOSURE)
  // -------------------------------------------------------------

  /** Filtered assets based on the active scope with instantaneously reactive USD/VES equivalents */
  readonly assets = computed<AssetVault[]>(() => {
    const currentScope = this.scope();
    const bcv = this.currentBcvRate();
    const eurUsd = this.currentEurUsdRate();
    const all = this.mapVaultEquivalents(this.state().assets, bcv, eurUsd);
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

  /** Filtered wealth goals based on the active scope */
  readonly goals = computed<WealthGoal[]>(() => {
    const currentScope = this.scope();
    const all = this.state().goals ?? [];
    if (currentScope === 'all') return all;
    return all.filter((g) => g.scope === 'all' || g.scope === currentScope);
  });

  readonly transfers = computed<TransferEntry[]>(() => this.state().transfers ?? []);

  readonly recurringRules = computed<RecurringRule[]>(() => {
    const currentScope = this.scope();
    const all = this.state().recurringRules ?? [];
    if (currentScope === 'all') return all;
    return all.filter((r) => r.scope === 'all' || r.scope === currentScope);
  });

  readonly casheaMerchantSales = computed<CasheaMerchantSale[]>(
    () => this.state().casheaMerchantSales ?? [],
  );

  readonly casheaProfile = computed<CasheaUserProfile>(
    () => this.state().casheaProfile ?? createDefaultCasheaProfile(),
  );

  readonly pymeProfile = computed<PymeBusinessProfile>(
    () => this.state().pymeProfile ?? createDefaultPymeProfile(),
  );

  /** Total Consolidated Assets in USD */
  readonly totalAssetsUsd = computed<number>(() => {
    return roundMoney(this.assets().reduce((acc, vault) => acc + vault.balanceUsdEquivalent, 0));
  });

  /** Immediately liquid assets in USD (excludes fixed assets and uncollected receivables) */
  readonly liquidAssetsUsd = computed<number>(() => {
    return roundMoney(
      this.assets()
        .filter((v) => !v.isFixedAsset && v.channel !== 'receivable')
        .reduce((acc, vault) => acc + vault.balanceUsdEquivalent, 0),
    );
  });

  /** Total earmarked goal reserves in USD */
  readonly earmarkedGoalsUsd = computed<number>(() => {
    return roundMoney(this.goals().reduce((acc, goal) => acc + goal.currentAmountUsd, 0));
  });

  /** Unallocated liquid assets after earmarked wealth goal reserves */
  readonly freeLiquidAssetsUsd = computed<number>(() => {
    return Math.max(0, roundMoney(this.liquidAssetsUsd() - this.earmarkedGoalsUsd()));
  });

  /** Total Consolidated Liabilities in USD */
  readonly totalLiabilitiesUsd = computed<number>(() => {
    return roundMoney(
      this.liabilities().reduce((acc, item) => {
        if (item.status === 'paid') return acc;
        return acc + item.remainingAmount;
      }, 0),
    );
  });

  /** Consolidated Net Worth in USD (Assets - Liabilities) */
  readonly netWorthUsd = computed<number>(() => {
    return roundMoney(this.totalAssetsUsd() - this.totalLiabilitiesUsd());
  });

  /** Consolidated Net Worth in VES */
  readonly netWorthVes = computed<number>(() => {
    const bcv = this.currentBcvRate();
    return bcv > 0 ? roundMoney(this.netWorthUsd() * bcv) : 0;
  });

  /** Strictly overdue unpaid liabilities under VET calendar */
  readonly overdueLiabilities = computed<LiabilityItem[]>(() => {
    const today = todayVetIso();
    return this.liabilities()
      .filter((l) => l.status !== 'paid')
      .filter((l) => l.status === 'overdue' || calendarDaysBetween(today, l.dueDate) < 0)
      .sort((a, b) => calendarDaysBetween(b.dueDate, a.dueDate));
  });

  /** High priority liabilities: overdue + due within the next 7 VET calendar days */
  readonly upcomingLiabilities7Days = computed<LiabilityItem[]>(() => {
    const today = todayVetIso();
    return this.liabilities()
      .filter((l) => l.status !== 'paid')
      .filter((l) => calendarDaysBetween(today, l.dueDate) <= 7)
      .sort((a, b) => calendarDaysBetween(b.dueDate, a.dueDate));
  });

  /** Commitments due within 14 VET calendar days (always including overdue items) */
  readonly upcomingLiabilities14Days = computed<LiabilityItem[]>(() => {
    const today = todayVetIso();
    return this.liabilities()
      .filter((l) => l.status !== 'paid')
      .filter((l) => calendarDaysBetween(today, l.dueDate) <= 14)
      .sort((a, b) => calendarDaysBetween(b.dueDate, a.dueDate));
  });

  /**
   * 14-Day Cashflow Health Semaphore.
   * Always includes overdue liabilities and forces `'critical'` when any overdue debt exists.
   */
  readonly liquidityHealthStatus = computed<{
    status: 'optimal' | 'warning' | 'critical';
    label: string;
    ratio: number;
    due14DaysUsd: number;
    liquidUsd: number;
    overdueUsd: number;
    overdueCount: number;
  }>(() => {
    const overdue = this.overdueLiabilities();
    const overdueUsd = roundMoney(overdue.reduce((sum, item) => sum + item.remainingAmount, 0));
    const overdueCount = overdue.length;

    const due14DaysUsd = roundMoney(
      this.upcomingLiabilities14Days().reduce((sum, item) => sum + item.remainingAmount, 0),
    );
    const liquidAssets = this.liquidAssetsUsd();

    if (overdueCount > 0) {
      const coverageRatio = due14DaysUsd > 0 ? liquidAssets / due14DaysUsd : 0;
      return {
        status: 'critical',
        label: `Mora activa (${overdueCount} pasivo${overdueCount > 1 ? 's' : ''} vencido${overdueCount > 1 ? 's' : ''} por $${overdueUsd.toFixed(2)} USD)`,
        ratio: Math.max(5, Math.min(45, Math.round(coverageRatio * 25))),
        due14DaysUsd,
        liquidUsd: liquidAssets,
        overdueUsd,
        overdueCount,
      };
    }

    if (due14DaysUsd <= 0) {
      return {
        status: 'optimal',
        label: 'Liquidez blindada (sin compromisos inmediatos a 14 días)',
        ratio: 100,
        due14DaysUsd: 0,
        liquidUsd: liquidAssets,
        overdueUsd: 0,
        overdueCount: 0,
      };
    }

    const coverageRatio = liquidAssets / due14DaysUsd;
    if (coverageRatio >= 2.0) {
      return {
        status: 'optimal',
        label: `Liquidez sólida (cubre ${roundMoney(coverageRatio, 1)}x los compromisos a 14 días)`,
        ratio: Math.min(100, Math.round(coverageRatio * 50)),
        due14DaysUsd,
        liquidUsd: liquidAssets,
        overdueUsd: 0,
        overdueCount: 0,
      };
    }

    if (coverageRatio >= 1.0) {
      return {
        status: 'warning',
        label: `Liquidez ajustada (cubre ${Math.round(coverageRatio * 100)}% de los próximos 14 días)`,
        ratio: Math.round(coverageRatio * 50),
        due14DaysUsd,
        liquidUsd: liquidAssets,
        overdueUsd: 0,
        overdueCount: 0,
      };
    }

    return {
      status: 'critical',
      label: `Déficit proyectado (faltan $${roundMoney(due14DaysUsd - liquidAssets).toFixed(2)} USD para cubrir compromisos)`,
      ratio: Math.max(10, Math.round(coverageRatio * 50)),
      due14DaysUsd,
      liquidUsd: liquidAssets,
      overdueUsd: 0,
      overdueCount: 0,
    };
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
    const vesBalanceTotal = roundMoney(vesVaults.reduce((s, v) => s + v.balance, 0));
    const vesEquivalentUsd = bcv > 0 ? roundMoney(vesBalanceTotal / bcv) : 0;
    const exposurePct = totalUsd > 0 ? roundMoney((vesEquivalentUsd / totalUsd) * 100, 1) : 0;
    const rateGapPct = bcv > 0 && par > 0 ? roundMoney(((par - bcv) / bcv) * 100, 1) : 0;
    const erosionLoss5PctUsd = roundMoney(vesEquivalentUsd * 0.0476);

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
   * Chronological Unified Movements Feed (Incomes + Expenses sorted newest first using VET calendar dates)
   */
  readonly unifiedMovements = computed<UnifiedMovementItem[]>(() => {
    const vaultMap = new Map(this.state().assets.map((v) => [v.id, v.name]));
    const catLabels: Record<string, string> = {
      salary: 'Sueldo / Salario',
      p2p_profit: 'Ganancia Mesa P2P',
      business_sale: 'Venta Comercial',
      quote_advance: 'Anticipo Presupuesto',
      freelance: 'Honorarios',
      investment: 'Inversión',
      groceries: 'Comida y Mercado',
      housing: 'Vivienda y Alquiler',
      transport: 'Gasolina / Transporte',
      services: 'Servicios Públicos',
      health: 'Salud y Medicina',
      education: 'Educación',
      personal_care: 'Cuidado Personal',
      entertainment: 'Entretenimiento',
      cashea_installment: 'Cuota Cashea',
      provider_merchandise: 'Proveedor / Mercancía',
      payroll: 'Nómina de Personal',
      rent: 'Alquiler Comercial',
      utilities: 'Servicios Locales',
      maintenance: 'Mantenimiento / Taller',
      equipment_capex: 'Equipos / CAPEX',
      marketing: 'Marketing y Publicidad',
      taxes: 'Impuestos y Tributos',
      other: 'General',
    };

    const incItems: UnifiedMovementItem[] = this.incomes().map((inc) => ({
      id: inc.id,
      type: 'income',
      title: inc.title,
      scope: inc.scope,
      category: inc.category,
      categoryLabel: catLabels[inc.category] ?? inc.category,
      channel: inc.channel,
      vaultId: inc.vaultId,
      vaultName: inc.vaultId ? (vaultMap.get(inc.vaultId) ?? 'Cuenta Externa') : 'Flujo Directo',
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
      type: 'expense',
      title: exp.title,
      scope: exp.scope,
      category: exp.category,
      categoryLabel: catLabels[exp.category] ?? exp.category,
      channel: exp.channel,
      vaultId: exp.vaultId,
      vaultName: exp.vaultId ? (vaultMap.get(exp.vaultId) ?? 'Cuenta Externa') : 'Flujo Directo',
      amountUsd: exp.triMonetary.amount_usd,
      amountVes: exp.triMonetary.amount_ves,
      bcvRateApplied: exp.triMonetary.bcv_rate,
      triMonetary: exp.triMonetary,
      date: exp.date,
      createdAt: exp.createdAt,
      notes: exp.notes,
    }));

    return [...incItems, ...expItems].sort((a, b) => {
      const dateDiff = parseCalendarDate(b.date).getTime() - parseCalendarDate(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  });

  // -------------------------------------------------------------
  // UNIDIRECTIONAL P2P PROFIT BRIDGES (STRICT ISOLATION)
  // -------------------------------------------------------------

  /**
   * Imports strictly positive net realized profit from the P2P trading mesa
   * for today's VET calendar date without writing to `p2p.operations`.
   */
  importDailyP2pProfit(
    targetScope: FinanceScope = 'personal',
    customBcvRate?: number,
    vaultId?: string,
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

    const bcv =
      typeof customBcvRate === 'number' && customBcvRate > 0
        ? customBcvRate
        : this.currentBcvRate();
    const parallel = this.currentParallelRate();
    const dateStr = todayVetIso();
    const entryId = `p2p-profit-${dateStr}`;

    const effectiveUsd =
      summary.pnlUsdt > 0
        ? roundMoney(summary.pnlUsdt)
        : bcv > 0
          ? roundMoney(summary.pnlVes / bcv)
          : 0;

    const triMonetary = computeTriMonetaryAmount(effectiveUsd, 'USD', bcv, parallel);
    const resolvedVaultId = this.resolveValidVaultId(vaultId);

    const p2pEntry: IncomeEntry = {
      id: entryId,
      title: `Ganancia Neta P2P (${dateStr})`,
      scope: targetScope,
      category: 'p2p_profit',
      channel: 'crypto',
      vaultId: resolvedVaultId,
      triMonetary,
      date: dateStr,
      referenceNumber: `P2P-OPS-${dateStr}-${summary.operations}`,
      notes: `Importado desde Mesa P2P. ${summary.operations} operaciones cerradas hoy.`,
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
    let updatedAssets = currentState.assets;
    let updatedIncomes = [...currentState.incomes];

    if (existingIndex >= 0) {
      const prev = updatedIncomes[existingIndex];
      if (prev.vaultId) {
        updatedAssets = this.applyVaultDelta(updatedAssets, prev.vaultId, prev.triMonetary, -1);
      }
      if (resolvedVaultId) {
        updatedAssets = this.applyVaultDelta(updatedAssets, resolvedVaultId, triMonetary, 1);
      }
      updatedIncomes[existingIndex] = p2pEntry;
    } else {
      if (resolvedVaultId) {
        updatedAssets = this.applyVaultDelta(updatedAssets, resolvedVaultId, triMonetary, 1);
      }
      updatedIncomes = [p2pEntry, ...updatedIncomes];
    }

    this.updateState({ assets: updatedAssets, incomes: updatedIncomes });

    return {
      success: true,
      profitVes: summary.pnlVes,
      profitUsd: effectiveUsd,
      entryId,
    };
  }

  /**
   * Unified idempotent VET-day P2P profit settlement bridge.
   * Freezes real live BCV & Parallel rates and credits the selected real vault when valid.
   */
  settleP2pProfitToFinance360(params: SettleP2pProfitInput): SettleP2pProfitResult {
    const netProfitUsdt = roundMoney(params.netProfitUsdt);
    const bcv =
      typeof params.bcvRateOverride === 'number' && params.bcvRateOverride > 0
        ? params.bcvRateOverride
        : this.currentBcvRate();
    const parallel =
      typeof params.parallelRateOverride === 'number' && params.parallelRateOverride > 0
        ? params.parallelRateOverride
        : this.currentParallelRate();

    if (!Number.isFinite(netProfitUsdt) || netProfitUsdt <= 0) {
      return {
        success: false,
        alreadySettled: false,
        reason: 'NO_POSITIVE_PROFIT',
        profitUsd: 0,
        profitVes: 0,
        bcvRateApplied: bcv,
        parallelRateApplied: parallel,
      };
    }

    const dateStr = params.dateIso?.trim() || todayVetIso();
    const settlementId = params.settlementId?.trim() || `SETTLE-P2P-${dateStr}`;
    const entryId = `p2p-settlement-${dateStr}`;
    const normalizedSettlement = normalizeRef(settlementId);

    const existing = this.state().incomes.find(
      (inc) =>
        inc.id === entryId ||
        (normalizedSettlement !== '' && normalizeRef(inc.referenceNumber) === normalizedSettlement),
    );

    if (existing) {
      return {
        success: false,
        alreadySettled: true,
        reason: 'ALREADY_SETTLED',
        entryId: existing.id,
        profitUsd: existing.triMonetary.amount_usd,
        profitVes: existing.triMonetary.amount_ves,
        bcvRateApplied: existing.triMonetary.bcv_rate,
        parallelRateApplied: existing.triMonetary.parallel_rate,
        vaultId: existing.vaultId,
      };
    }

    const resolvedVaultId = this.resolveValidVaultId(params.vaultId);
    const triMonetary = computeTriMonetaryAmount(
      netProfitUsdt,
      'USDT',
      bcv,
      parallel,
      this.currentEurUsdRate() || undefined,
    );

    const nowIso = new Date().toISOString();
    const newEntry: IncomeEntry = {
      id: entryId,
      title: params.title?.trim() || `Corte Diario P2P Desk (${dateStr})`,
      scope: params.scope ?? 'business',
      category: 'p2p_profit',
      channel: 'crypto',
      vaultId: resolvedVaultId,
      triMonetary,
      date: dateStr,
      referenceNumber: settlementId,
      notes:
        params.notes?.trim() ||
        `Liquidación P2P #${settlementId} (${params.tradesCount} operaciones cerradas).`,
      p2pBridgeMetadata: {
        operationsCount: params.tradesCount,
        realizedPnlVes: params.realizedPnlVes ?? triMonetary.amount_ves,
        realizedPnlUsdt: netProfitUsdt,
        importedAt: nowIso,
      },
      createdAt: nowIso,
    };

    const updatedAssets = resolvedVaultId
      ? this.applyVaultDelta(this.state().assets, resolvedVaultId, triMonetary, 1)
      : this.state().assets;

    this.updateState({
      assets: updatedAssets,
      incomes: [newEntry, ...this.state().incomes],
    });
    this.recordAudit('DATA_MUTATION', 'F360_P2P_SETTLEMENT', {
      settlementId,
      profitUsd: triMonetary.amount_usd,
      bcvRate: triMonetary.bcv_rate,
      vaultId: resolvedVaultId ?? null,
    });

    return {
      success: true,
      alreadySettled: false,
      entryId: newEntry.id,
      profitUsd: triMonetary.amount_usd,
      profitVes: triMonetary.amount_ves,
      bcvRateApplied: triMonetary.bcv_rate,
      parallelRateApplied: triMonetary.parallel_rate,
      vaultId: resolvedVaultId,
    };
  }

  // -------------------------------------------------------------
  // DUPLICATE REFERENCE GUARD
  // -------------------------------------------------------------

  isDuplicateReference(referenceNumber?: string, vaultId?: string): boolean {
    const ref = normalizeRef(referenceNumber);
    if (!ref) return false;

    const matchesScope = (entryVaultId?: string): boolean => {
      if (!vaultId) return true;
      return (entryVaultId ?? '') === vaultId;
    };

    const dupIncome = this.state().incomes.some(
      (i) => normalizeRef(i.referenceNumber) === ref && matchesScope(i.vaultId),
    );
    if (dupIncome) return true;

    return this.state().expenses.some(
      (e) => normalizeRef(e.referenceNumber) === ref && matchesScope(e.vaultId),
    );
  }

  // -------------------------------------------------------------
  // CRUD: PILARES CONTABLES
  // -------------------------------------------------------------

  addAssetVault(vault: Omit<AssetVault, 'id' | 'updatedAt'>): AssetVault {
    const id = generateFinanceId('vault');
    const cleanBalance = roundMoney(vault.balance);
    const newVault: AssetVault = {
      ...vault,
      id,
      balance: cleanBalance,
      openingBalance: vault.openingBalance !== undefined ? roundMoney(vault.openingBalance) : cleanBalance,
      vaultKind: vault.vaultKind ?? 'asset',
      updatedAt: new Date().toISOString(),
    };
    this.updateState({ assets: [...this.state().assets, newVault] });
    return this.state().assets.find((v) => v.id === id) ?? newVault;
  }

  updateAssetVault(id: string, patch: Partial<AssetVault>): void {
    const updated = this.state().assets.map((v) =>
      v.id === id
        ? {
            ...v,
            ...patch,
            balance: patch.balance !== undefined ? roundMoney(patch.balance) : v.balance,
            updatedAt: new Date().toISOString(),
          }
        : v,
    );
    this.updateState({ assets: updated });
  }

  deleteAssetVault(id: string): void {
    const filtered = this.state().assets.filter((v) => v.id !== id);
    this.updateState({ assets: filtered });
  }

  addIncome(
    entry: Omit<IncomeEntry, 'id' | 'createdAt'>,
    options?: { allowDuplicateRef?: boolean },
  ): IncomeEntry {
    const normalizedRef = normalizeRef(entry.referenceNumber);
    if (normalizedRef && !options?.allowDuplicateRef) {
      const existing = this.state().incomes.find(
        (i) =>
          normalizeRef(i.referenceNumber) === normalizedRef &&
          (entry.vaultId ? (i.vaultId ?? '') === entry.vaultId : true),
      );
      if (existing) {
        return existing;
      }
      if (this.isDuplicateReference(entry.referenceNumber, entry.vaultId)) {
        throw new Error(`DUPLICATE_REFERENCE: ${entry.referenceNumber}`);
      }
    }

    const id = generateFinanceId('inc');
    const resolvedVaultId = this.resolveValidVaultId(entry.vaultId);
    const newEntry: IncomeEntry = {
      ...entry,
      id,
      vaultId: resolvedVaultId ?? entry.vaultId,
      date: entry.date || todayVetIso(),
      createdAt: new Date().toISOString(),
    };

    const updatedAssets = resolvedVaultId
      ? this.applyVaultDelta(this.state().assets, resolvedVaultId, newEntry.triMonetary, 1)
      : this.state().assets;

    this.updateState({
      assets: updatedAssets,
      incomes: [newEntry, ...this.state().incomes],
    });
    return newEntry;
  }

  addExpense(
    entry: Omit<ExpenseEntry, 'id' | 'createdAt'>,
    options?: { allowDuplicateRef?: boolean },
  ): ExpenseEntry {
    const normalizedRef = normalizeRef(entry.referenceNumber);
    if (normalizedRef && !options?.allowDuplicateRef) {
      const existing = this.state().expenses.find(
        (e) =>
          normalizeRef(e.referenceNumber) === normalizedRef &&
          (entry.vaultId ? (e.vaultId ?? '') === entry.vaultId : true),
      );
      if (existing) {
        return existing;
      }
      if (this.isDuplicateReference(entry.referenceNumber, entry.vaultId)) {
        throw new Error(`DUPLICATE_REFERENCE: ${entry.referenceNumber}`);
      }
    }

    const id = generateFinanceId('exp');
    const resolvedVaultId = this.resolveValidVaultId(entry.vaultId);
    const newEntry: ExpenseEntry = {
      ...entry,
      id,
      vaultId: resolvedVaultId ?? entry.vaultId,
      date: entry.date || todayVetIso(),
      createdAt: new Date().toISOString(),
    };

    const updatedAssets = resolvedVaultId
      ? this.applyVaultDelta(this.state().assets, resolvedVaultId, newEntry.triMonetary, -1)
      : this.state().assets;

    this.updateState({
      assets: updatedAssets,
      expenses: [newEntry, ...this.state().expenses],
    });

    if (newEntry.liabilityId) {
      this.payLiability(newEntry.liabilityId, newEntry.triMonetary.amount_usd, undefined, false);
    }

    return newEntry;
  }

  addLiability(item: Omit<LiabilityItem, 'id' | 'createdAt' | 'updatedAt'>): LiabilityItem {
    const id = generateFinanceId('liab');
    const nowIso = new Date().toISOString();
    const newItem: LiabilityItem = {
      ...item,
      id,
      amountPaid: roundMoney(item.amountPaid),
      remainingAmount: roundMoney(item.remainingAmount),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.updateState({ liabilities: [...this.state().liabilities, newItem] });
    return newItem;
  }

  /**
   * Pays down a liability, clamping overpayments to remaining balance,
   * and bidirectionally synchronizing linked Cashea installments and Pyme providers.
   */
  payLiability(
    id: string,
    amountPaidUsd: number,
    debitVaultId?: string,
    recordLedgerExpense = true,
  ): LiabilityPaymentResult {
    const target = this.state().liabilities.find((l) => l.id === id);
    if (!target) {
      return { success: false, appliedAmountUsd: 0, remainingAmountUsd: 0, reason: 'NOT_FOUND' };
    }
    if (target.status === 'paid' || target.remainingAmount <= 0) {
      return {
        success: false,
        appliedAmountUsd: 0,
        remainingAmountUsd: 0,
        reason: 'ALREADY_PAID',
      };
    }
    if (!Number.isFinite(amountPaidUsd) || amountPaidUsd <= 0) {
      return {
        success: false,
        appliedAmountUsd: 0,
        remainingAmountUsd: target.remainingAmount,
        reason: 'INVALID_AMOUNT',
      };
    }

    const appliedAmount = roundMoney(Math.min(amountPaidUsd, target.remainingAmount));
    const newPaid = roundMoney(target.amountPaid + appliedAmount);
    const newRemaining = Math.max(0, roundMoney(target.triMonetary.amount_usd - newPaid));
    const newStatus: LiabilityItem['status'] =
      newRemaining <= 0 ? 'paid' : newPaid > 0 ? 'partially_paid' : 'pending';
    const nowIso = new Date().toISOString();
    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const eurUsd = this.currentEurUsdRate() || undefined;
    const paymentTri = computeTriMonetaryAmount(appliedAmount, 'USD', bcv, par, eurUsd);

    const updatedLiabilities = this.state().liabilities.map((item) =>
      item.id === id
        ? {
            ...item,
            amountPaid: newPaid,
            remainingAmount: newRemaining,
            status: newStatus,
            updatedAt: nowIso,
          }
        : item,
    );

    const resolvedVaultId = this.resolveValidVaultId(debitVaultId);
    const updatedAssets = resolvedVaultId
      ? this.applyVaultDelta(this.state().assets, resolvedVaultId, paymentTri, -1)
      : this.state().assets;

    let nextExpenses = this.state().expenses;
    if (recordLedgerExpense && appliedAmount > 0) {
      const vault = resolvedVaultId
        ? updatedAssets.find((v) => v.id === resolvedVaultId)
        : undefined;
      const expenseEntry: ExpenseEntry = {
        id: generateFinanceId('exp-liab'),
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
        vaultId: resolvedVaultId,
        liabilityId: target.id,
        casheaLine: target.casheaLine,
        drawerAllocation:
          target.category === 'provider'
            ? 'drawer_merchandise'
            : target.scope === 'business'
              ? 'drawer_operations'
              : undefined,
        triMonetary: paymentTri,
        date: todayVetIso(),
        notes: `Acreedor: ${target.creditor}`,
        createdAt: nowIso,
      };
      nextExpenses = [expenseEntry, ...nextExpenses];
    }

    // Bidirectional Cashea installment synchronization
    let updatedCasheaPlans = this.state().casheaPlans;
    let updatedCasheaProfile = this.state().casheaProfile ?? createDefaultCasheaProfile();
    if (target.casheaPlanId) {
      const instNum = Number(target.id.split('-').pop() ?? '0');
      let completedInstallmentNow = false;
      let casheaLine: CasheaCreditLine = target.casheaLine ?? 'principal';

      updatedCasheaPlans = updatedCasheaPlans.map((plan) => {
        if (plan.id !== target.casheaPlanId) return plan;
        casheaLine = plan.creditLine ?? casheaLine;
        const nextInstallments = plan.installments.map((inst) => {
          if (inst.number !== instNum) return inst;
          const prevPaid = inst.amountPaidUsd ?? (inst.status === 'paid' ? inst.amountUsd : 0);
          const nextInstPaid = roundMoney(Math.min(inst.amountUsd, prevPaid + appliedAmount));
          const isFullyPaid = newRemaining <= 0 || nextInstPaid >= inst.amountUsd;
          if (isFullyPaid && inst.status !== 'paid') {
            completedInstallmentNow = true;
          }
          return {
            ...inst,
            amountPaidUsd: nextInstPaid,
            status: isFullyPaid ? ('paid' as const) : inst.status,
            paidAt: isFullyPaid ? nowIso : inst.paidAt,
            bcvRateApplied: isFullyPaid ? bcv : inst.bcvRateApplied,
            paidVes: isFullyPaid && bcv > 0 ? roundMoney(inst.amountUsd * bcv) : inst.paidVes,
          };
        });

        const allPaid = nextInstallments.every((inst) => inst.status === 'paid');
        return {
          ...plan,
          installments: nextInstallments,
          status: allPaid ? ('completed' as const) : ('active' as const),
        };
      });

      updatedCasheaProfile = this.applyCasheaProfilePaymentDelta(
        updatedCasheaProfile,
        casheaLine,
        appliedAmount,
        completedInstallmentNow ? 1 : 0,
      );
    }

    // Bidirectional Provider CxP synchronization
    const updatedProviders = target.providerId
      ? this.syncProviderDebtFromLiabilities(
          this.state().providers,
          updatedLiabilities,
          target.providerId,
        )
      : this.state().providers;

    this.updateState({
      assets: updatedAssets,
      liabilities: updatedLiabilities,
      expenses: nextExpenses,
      casheaPlans: updatedCasheaPlans,
      casheaProfile: updatedCasheaProfile,
      providers: updatedProviders,
    });

    return {
      success: true,
      appliedAmountUsd: appliedAmount,
      remainingAmountUsd: newRemaining,
    };
  }

  /**
   * Double-entry transfer between two vaults with strict overdraft enforcement,
   * accurate USD/USDT/VES/EUR FX conversion, and paired TransferEntry audit log.
   */
  transferBetweenVaults(
    fromVaultId: string,
    toVaultId: string,
    amountInSourceCurrency: number,
    notes?: string,
  ): VaultTransferResult {
    if (
      !fromVaultId ||
      !toVaultId ||
      fromVaultId === toVaultId ||
      !Number.isFinite(amountInSourceCurrency) ||
      amountInSourceCurrency <= 0
    ) {
      return {
        success: false,
        reason: 'INVALID_INPUT',
        creditedAmount: 0,
        targetCurrency: 'USD',
      };
    }

    const assets = this.state().assets;
    const fromVault = assets.find((v) => v.id === fromVaultId);
    const toVault = assets.find((v) => v.id === toVaultId);
    if (!fromVault || !toVault) {
      return {
        success: false,
        reason: 'VAULT_NOT_FOUND',
        creditedAmount: 0,
        targetCurrency: toVault?.currency ?? 'USD',
      };
    }

    const cleanSourceAmount = roundMoney(amountInSourceCurrency);
    if (fromVault.vaultKind !== 'credit_line' && roundMoney(fromVault.balance) < cleanSourceAmount) {
      return {
        success: false,
        reason: 'INSUFFICIENT_FUNDS',
        creditedAmount: 0,
        targetCurrency: toVault.currency,
      };
    }

    const bcv = this.currentBcvRate();
    const liveEurUsd = this.currentEurUsdRate();
    const effectiveEurUsd = liveEurUsd > 0 ? liveEurUsd : EUR_FALLBACK_RATE;

    const sameCurrency =
      fromVault.currency === toVault.currency ||
      ((fromVault.currency === 'USD' || fromVault.currency === 'USDT') &&
        (toVault.currency === 'USD' || toVault.currency === 'USDT'));

    const involvesVes = fromVault.currency === 'VES' || toVault.currency === 'VES';
    if (!sameCurrency && involvesVes && bcv <= 0) {
      return {
        success: false,
        reason: 'MISSING_FX_RATE',
        creditedAmount: 0,
        targetCurrency: toVault.currency,
      };
    }

    let amountUsd = cleanSourceAmount;
    if (fromVault.currency === 'VES') {
      amountUsd = bcv > 0 ? cleanSourceAmount / bcv : 0;
    } else if (fromVault.currency === 'EUR') {
      amountUsd = cleanSourceAmount * effectiveEurUsd;
    }

    let creditedAmount: number;
    if (sameCurrency) {
      creditedAmount = cleanSourceAmount;
    } else if (toVault.currency === 'VES') {
      creditedAmount = roundMoney(amountUsd * bcv);
    } else if (toVault.currency === 'EUR') {
      creditedAmount = roundMoney(amountUsd / effectiveEurUsd);
    } else {
      creditedAmount = roundMoney(amountUsd);
    }

    const nowIso = new Date().toISOString();
    const transferId = generateFinanceId('trf');
    const groupId = generateFinanceId('trf-grp');

    const updatedAssets = assets.map((v) => {
      if (v.id === fromVaultId) {
        return {
          ...v,
          balance: roundMoney(v.balance - cleanSourceAmount),
          updatedAt: nowIso,
        };
      }
      if (v.id === toVaultId) {
        return {
          ...v,
          balance: roundMoney(v.balance + creditedAmount),
          updatedAt: nowIso,
        };
      }
      return v;
    });

    const transferEntry: TransferEntry = {
      id: transferId,
      groupId,
      fromVaultId,
      toVaultId,
      sourceCurrency: fromVault.currency,
      targetCurrency: toVault.currency,
      sourceAmount: cleanSourceAmount,
      creditedAmount,
      amountUsd: roundMoney(amountUsd),
      bcvRateApplied: bcv,
      eurUsdRateApplied:
        fromVault.currency === 'EUR' || toVault.currency === 'EUR' ? effectiveEurUsd : undefined,
      date: todayVetIso(),
      kind: 'vault_transfer',
      notes: notes?.trim() || undefined,
      createdAt: nowIso,
    };

    this.updateState({
      assets: updatedAssets,
      transfers: [transferEntry, ...(this.state().transfers ?? [])],
    });
    this.recordAudit('DATA_MUTATION', 'F360_VAULT_TRANSFER', {
      transferId,
      groupId,
      fromVaultId,
      toVaultId,
      sourceAmount: cleanSourceAmount,
      sourceCurrency: fromVault.currency,
      creditedAmount,
      targetCurrency: toVault.currency,
    });

    return {
      success: true,
      creditedAmount,
      targetCurrency: toVault.currency,
      transferId,
      groupId,
    };
  }

  /**
   * Deletes an income or expense entry and reverses its vault (at exact historical FX),
   * goal, liability, Cashea, and provider impacts atomically.
   */
  deleteMovement(id: string, type: 'income' | 'expense'): void {
    if (type === 'income') {
      const target = this.state().incomes.find((i) => i.id === id);
      if (!target) return;
      const updatedAssets = target.vaultId
        ? this.applyVaultDelta(this.state().assets, target.vaultId, target.triMonetary, -1)
        : this.state().assets;
      this.updateState({
        assets: updatedAssets,
        incomes: this.state().incomes.filter((i) => i.id !== id),
      });
      return;
    }

    const target = this.state().expenses.find((e) => e.id === id);
    if (!target) return;

    const updatedAssets = target.vaultId
      ? this.applyVaultDelta(this.state().assets, target.vaultId, target.triMonetary, 1)
      : this.state().assets;

    let updatedGoals = this.state().goals ?? [];
    if (target.goalId) {
      updatedGoals = updatedGoals.map((g) =>
        g.id === target.goalId
          ? {
              ...g,
              currentAmountUsd: Math.max(
                0,
                roundMoney(g.currentAmountUsd - target.triMonetary.amount_usd),
              ),
            }
          : g,
      );
    }

    let updatedLiabilities = this.state().liabilities;
    let updatedCasheaPlans = this.state().casheaPlans;
    let updatedProviders = this.state().providers;

    if (target.liabilityId) {
      const linkedLiability = this.state().liabilities.find((l) => l.id === target.liabilityId);
      const nowIso = new Date().toISOString();
      const today = todayVetIso();

      updatedLiabilities = updatedLiabilities.map((l) => {
        if (l.id !== target.liabilityId) return l;
        const restoredPaid = Math.max(0, roundMoney(l.amountPaid - target.triMonetary.amount_usd));
        const restoredRemaining = Math.max(
          0,
          roundMoney(l.triMonetary.amount_usd - restoredPaid),
        );
        const isPastDue = calendarDaysBetween(today, l.dueDate) < 0;
        const restoredStatus: LiabilityItem['status'] =
          restoredPaid > 0 ? 'partially_paid' : isPastDue ? 'overdue' : 'pending';
        return {
          ...l,
          amountPaid: restoredPaid,
          remainingAmount: restoredRemaining,
          status: restoredStatus,
          updatedAt: nowIso,
        };
      });

      if (linkedLiability?.casheaPlanId) {
        const instNum = Number(target.liabilityId.split('-').pop() ?? '0');
        updatedCasheaPlans = updatedCasheaPlans.map((plan) => {
          if (plan.id !== linkedLiability.casheaPlanId) return plan;
          return {
            ...plan,
            status: 'active',
            installments: plan.installments.map((inst) => {
              if (inst.number !== instNum) return inst;
              const prevPaid = inst.amountPaidUsd ?? (inst.status === 'paid' ? inst.amountUsd : 0);
              const nextPaid = Math.max(0, roundMoney(prevPaid - target.triMonetary.amount_usd));
              return {
                ...inst,
                amountPaidUsd: nextPaid,
                status: 'pending',
                paidAt: undefined,
                paidVes: undefined,
              };
            }),
          };
        });
      }

      if (linkedLiability?.providerId) {
        updatedProviders = this.syncProviderDebtFromLiabilities(
          updatedProviders,
          updatedLiabilities,
          linkedLiability.providerId,
        );
      }
    }

    this.updateState({
      assets: updatedAssets,
      expenses: this.state().expenses.filter((e) => e.id !== id),
      liabilities: updatedLiabilities,
      casheaPlans: updatedCasheaPlans,
      providers: updatedProviders,
      goals: updatedGoals,
    });
  }

  /**
   * Updates an existing income or expense entry preserving its frozen historical FX rates,
   * adjusting the vault delta accurately, and syncing linked liability balances when present.
   */
  updateMovement(
    id: string,
    type: 'income' | 'expense',
    patch: { title: string; amountUsd: number },
  ): void {
    const cleanAmountUsd = Math.max(0.01, roundMoney(patch.amountUsd));

    if (type === 'income') {
      const target = this.state().incomes.find((i) => i.id === id);
      if (!target) return;

      const frozenBcv = target.triMonetary.bcv_rate;
      const frozenPar = target.triMonetary.parallel_rate;
      const frozenEur = target.triMonetary.eur_usd_rate;
      const nextTri = this.rebuildTriMonetaryPreservingHistory(
        target.triMonetary,
        cleanAmountUsd,
        frozenBcv,
        frozenPar,
        frozenEur,
      );

      let updatedAssets = this.state().assets;
      if (target.vaultId) {
        updatedAssets = this.applyVaultDelta(updatedAssets, target.vaultId, target.triMonetary, -1);
        updatedAssets = this.applyVaultDelta(updatedAssets, target.vaultId, nextTri, 1);
      }

      const updatedIncomes = this.state().incomes.map((i) =>
        i.id === id
          ? {
              ...i,
              title: patch.title.trim() || i.title,
              triMonetary: nextTri,
            }
          : i,
      );
      this.updateState({ assets: updatedAssets, incomes: updatedIncomes });
      return;
    }

    const target = this.state().expenses.find((e) => e.id === id);
    if (!target) return;

    const frozenBcv = target.triMonetary.bcv_rate;
    const frozenPar = target.triMonetary.parallel_rate;
    const frozenEur = target.triMonetary.eur_usd_rate;
    const nextTri = this.rebuildTriMonetaryPreservingHistory(
      target.triMonetary,
      cleanAmountUsd,
      frozenBcv,
      frozenPar,
      frozenEur,
    );

    let updatedAssets = this.state().assets;
    if (target.vaultId) {
      updatedAssets = this.applyVaultDelta(updatedAssets, target.vaultId, target.triMonetary, 1);
      updatedAssets = this.applyVaultDelta(updatedAssets, target.vaultId, nextTri, -1);
    }

    let updatedLiabilities = this.state().liabilities;
    let updatedProviders = this.state().providers;
    if (target.liabilityId) {
      const deltaUsd = roundMoney(nextTri.amount_usd - target.triMonetary.amount_usd);
      const linked = updatedLiabilities.find((l) => l.id === target.liabilityId);
      updatedLiabilities = updatedLiabilities.map((l) => {
        if (l.id !== target.liabilityId) return l;
        const nextPaid = Math.max(
          0,
          Math.min(l.triMonetary.amount_usd, roundMoney(l.amountPaid + deltaUsd)),
        );
        const nextRemaining = Math.max(0, roundMoney(l.triMonetary.amount_usd - nextPaid));
        const nextStatus: LiabilityItem['status'] =
          nextRemaining <= 0 ? 'paid' : nextPaid > 0 ? 'partially_paid' : 'pending';
        return {
          ...l,
          amountPaid: nextPaid,
          remainingAmount: nextRemaining,
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        };
      });
      if (linked?.providerId) {
        updatedProviders = this.syncProviderDebtFromLiabilities(
          updatedProviders,
          updatedLiabilities,
          linked.providerId,
        );
      }
    }

    const updatedExpenses = this.state().expenses.map((e) =>
      e.id === id
        ? {
            ...e,
            title: patch.title.trim() || e.title,
            triMonetary: nextTri,
          }
        : e,
    );
    this.updateState({
      assets: updatedAssets,
      expenses: updatedExpenses,
      liabilities: updatedLiabilities,
      providers: updatedProviders,
    });
  }

  deleteLiability(id: string): void {
    const target = this.state().liabilities.find((l) => l.id === id);
    const nextLiabilities = this.state().liabilities.filter((l) => l.id !== id);
    const nextProviders = target?.providerId
      ? this.syncProviderDebtFromLiabilities(
          this.state().providers,
          nextLiabilities,
          target.providerId,
        )
      : this.state().providers;

    this.updateState({
      liabilities: nextLiabilities,
      providers: nextProviders,
    });
  }

  /**
   * Deletes a Cashea plan, removes all linked liabilities, releases remaining credit line usage,
   * and optionally reverses any initial/installment payments cleanly.
   */
  deleteCasheaPlan(planId: string, options?: { reversePayments?: boolean }): void {
    const targetPlan = this.state().casheaPlans.find((p) => p.id === planId);
    if (!targetPlan) return;

    const remainingUnpaid = roundMoney(
      this.state()
        .liabilities.filter((l) => l.casheaPlanId === planId && l.status !== 'paid')
        .reduce((sum, l) => sum + l.remainingAmount, 0),
    );

    let updatedAssets = this.state().assets;
    let updatedExpenses = this.state().expenses;

    if (options?.reversePayments) {
      const relatedExpenseIds = new Set<string>();
      for (const exp of this.state().expenses) {
        const isInitial = Boolean(targetPlan.initialExpenseId && exp.id === targetPlan.initialExpenseId);
        const isInstallment = Boolean(exp.liabilityId?.startsWith(`liab-cashea-${planId}-`));
        if (isInitial || isInstallment) {
          relatedExpenseIds.add(exp.id);
          if (exp.vaultId) {
            updatedAssets = this.applyVaultDelta(updatedAssets, exp.vaultId, exp.triMonetary, 1);
          }
        }
      }
      updatedExpenses = updatedExpenses.filter((e) => !relatedExpenseIds.has(e.id));
    }

    const updatedProfile = this.applyCasheaProfilePaymentDelta(
      this.state().casheaProfile ?? createDefaultCasheaProfile(),
      targetPlan.creditLine ?? 'principal',
      remainingUnpaid,
      0,
    );

    this.updateState({
      assets: updatedAssets,
      expenses: updatedExpenses,
      casheaPlans: this.state().casheaPlans.filter((p) => p.id !== planId),
      liabilities: this.state().liabilities.filter((l) => l.casheaPlanId !== planId),
      casheaProfile: updatedProfile,
    });
  }

  deleteProvider(providerId: string): void {
    this.updateState({
      providers: this.state().providers.filter((p) => p.id !== providerId),
      liabilities: this.state().liabilities.filter((l) => l.providerId !== providerId),
    });
  }

  deleteInventoryItem(itemId: string): void {
    this.updateState({
      inventory: this.state().inventory.filter((i) => i.id !== itemId),
    });
  }

  deleteQuote(quoteId: string): void {
    this.updateState({
      quotes: this.state().quotes.filter((q) => q.id !== quoteId),
    });
  }

  /**
   * Reconciles a vault's balance in its exact native currency (zero FX rounding drift),
   * records an audited adjustment movement, and appends a `VaultReconciliationRecord`.
   */
  reconcileVaultBalance(
    vaultId: string,
    actualBalanceInVaultCurrency: number,
  ): { success: boolean; deltaInCurrency: number; deltaUsd: number } {
    const vault = this.state().assets.find((v) => v.id === vaultId);
    if (!vault || !Number.isFinite(actualBalanceInVaultCurrency)) {
      return { success: false, deltaInCurrency: 0, deltaUsd: 0 };
    }
    if (vault.vaultKind !== 'credit_line' && actualBalanceInVaultCurrency < 0) {
      return { success: false, deltaInCurrency: 0, deltaUsd: 0 };
    }

    const cleanActual = roundMoney(actualBalanceInVaultCurrency);
    const expectedBalance = roundMoney(vault.balance);
    const deltaInCurrency = roundMoney(cleanActual - expectedBalance);
    if (Math.abs(deltaInCurrency) < 0.01) {
      return { success: true, deltaInCurrency: 0, deltaUsd: 0 };
    }

    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const eurUsd = this.currentEurUsdRate() || undefined;
    const absDeltaCurrency = Math.abs(deltaInCurrency);
    const tri = computeTriMonetaryAmount(absDeltaCurrency, vault.currency, bcv, par, eurUsd);
    const today = todayVetIso();

    let movementId: string;
    if (deltaInCurrency > 0) {
      const inc = this.addIncome({
        title: `Ajuste Positivo de Arqueo: ${vault.name}`,
        scope: vault.scope === 'all' ? 'personal' : vault.scope,
        category: 'other',
        channel: vault.channel,
        vaultId: vault.id,
        triMonetary: tri,
        date: today,
        notes: `Conciliación de saldo real (${vault.currency} ${cleanActual.toLocaleString('es-VE')})`,
      });
      movementId = inc.id;
    } else {
      const exp = this.addExpense({
        title: `Ajuste / Comisión de Arqueo: ${vault.name}`,
        scope: vault.scope === 'all' ? 'personal' : vault.scope,
        category: 'other',
        channel: vault.channel,
        vaultId: vault.id,
        triMonetary: tri,
        date: today,
        notes: `Conciliación por diferencia o comisiones bancarias (${vault.currency} ${cleanActual.toLocaleString('es-VE')})`,
      });
      movementId = exp.id;
    }

    const signedDeltaUsd = deltaInCurrency > 0 ? tri.amount_usd : -tri.amount_usd;
    const record: VaultReconciliationRecord = {
      id: generateFinanceId('rec'),
      vaultId: vault.id,
      vaultName: vault.name,
      currency: vault.currency,
      expectedBalance,
      actualBalance: cleanActual,
      deltaInCurrency,
      deltaUsd: signedDeltaUsd,
      bcvRateApplied: bcv,
      movementId,
      date: today,
      createdAt: new Date().toISOString(),
    };

    this.updateState({
      vaultReconciliations: [record, ...(this.state().vaultReconciliations ?? [])],
    });
    this.recordAudit('DATA_MUTATION', 'F360_VAULT_RECONCILE', {
      vaultId: vault.id,
      expectedBalance,
      actualBalance: cleanActual,
      deltaInCurrency,
      currency: vault.currency,
    });

    return {
      success: true,
      deltaInCurrency,
      deltaUsd: signedDeltaUsd,
    };
  }

  // -------------------------------------------------------------
  // WEALTH GOALS (EARMARKED RESERVES — NEVER EXPENSE ENTRIES)
  // -------------------------------------------------------------

  addWealthGoal(goal: Omit<WealthGoal, 'id' | 'createdAt'>): WealthGoal {
    const newGoal: WealthGoal = {
      ...goal,
      id: generateFinanceId('goal'),
      targetAmountUsd: Math.max(0, roundMoney(goal.targetAmountUsd)),
      currentAmountUsd: Math.max(0, roundMoney(goal.currentAmountUsd)),
      createdAt: new Date().toISOString(),
    };
    const existing = this.state().goals ?? [];
    this.updateState({ goals: [...existing, newGoal] });
    return newGoal;
  }

  /**
   * Earmarks funds into a Wealth Goal as a reserve transfer (`kind: 'goal_reserve'`),
   * NEVER creating an `ExpenseEntry` so Net Worth and Burn Rate remain truthful.
   */
  contributeToWealthGoal(goalId: string, amountUsd: number, sourceVaultId?: string): boolean {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return false;
    const existing = this.state().goals ?? [];
    const targetGoal = existing.find((g) => g.id === goalId);
    if (!targetGoal) return false;

    const cleanAmountUsd = roundMoney(amountUsd);
    const resolvedVault = sourceVaultId
      ? this.assets().find((v) => v.id === sourceVaultId)
      : undefined;

    if (
      sourceVaultId &&
      resolvedVault &&
      resolvedVault.vaultKind !== 'credit_line' &&
      resolvedVault.balanceUsdEquivalent < cleanAmountUsd
    ) {
      return false;
    }

    const updatedGoals = existing.map((g) =>
      g.id === goalId
        ? {
            ...g,
            currentAmountUsd: roundMoney(g.currentAmountUsd + cleanAmountUsd),
          }
        : g,
    );

    const bcv = this.currentBcvRate();
    const nowIso = new Date().toISOString();
    const reserveTransfer: TransferEntry = {
      id: generateFinanceId('trf-goal'),
      groupId: generateFinanceId('trf-grp'),
      fromVaultId: resolvedVault?.id ?? 'unassigned',
      toVaultId: `goal:${goalId}`,
      sourceCurrency: resolvedVault?.currency ?? 'USD',
      targetCurrency: 'USD',
      sourceAmount: cleanAmountUsd,
      creditedAmount: cleanAmountUsd,
      amountUsd: cleanAmountUsd,
      bcvRateApplied: bcv,
      date: todayVetIso(),
      kind: 'goal_reserve',
      goalId,
      notes: `Reserva etiquetada para meta: ${targetGoal.title}`,
      createdAt: nowIso,
    };

    this.updateState({
      goals: updatedGoals,
      transfers: [reserveTransfer, ...(this.state().transfers ?? [])],
    });

    return true;
  }

  /**
   * Releases earmarked funds back from a Wealth Goal cleanly without distorting Net Worth.
   */
  withdrawFromWealthGoal(
    goalId: string,
    amountUsd: number,
    targetVaultId?: string,
    notes?: string,
  ): boolean {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return false;
    const existing = this.state().goals ?? [];
    const targetGoal = existing.find((g) => g.id === goalId);
    if (!targetGoal) return false;

    const cleanAmountUsd = roundMoney(amountUsd);
    if (cleanAmountUsd > targetGoal.currentAmountUsd) return false;

    const updatedGoals = existing.map((g) =>
      g.id === goalId
        ? {
            ...g,
            currentAmountUsd: Math.max(0, roundMoney(g.currentAmountUsd - cleanAmountUsd)),
          }
        : g,
    );

    const resolvedVault = targetVaultId
      ? this.assets().find((v) => v.id === targetVaultId)
      : undefined;
    const nowIso = new Date().toISOString();
    const releaseTransfer: TransferEntry = {
      id: generateFinanceId('trf-goal'),
      groupId: generateFinanceId('trf-grp'),
      fromVaultId: `goal:${goalId}`,
      toVaultId: resolvedVault?.id ?? 'unassigned',
      sourceCurrency: 'USD',
      targetCurrency: resolvedVault?.currency ?? 'USD',
      sourceAmount: cleanAmountUsd,
      creditedAmount: cleanAmountUsd,
      amountUsd: cleanAmountUsd,
      bcvRateApplied: this.currentBcvRate(),
      date: todayVetIso(),
      kind: 'goal_release',
      goalId,
      notes: notes?.trim() || `Liberación de reserva desde meta: ${targetGoal.title}`,
      createdAt: nowIso,
    };

    this.updateState({
      goals: updatedGoals,
      transfers: [releaseTransfer, ...(this.state().transfers ?? [])],
    });

    return true;
  }

  deleteWealthGoal(goalId: string): void {
    const existing = this.state().goals ?? [];
    this.updateState({ goals: existing.filter((g) => g.id !== goalId) });
  }

  // -------------------------------------------------------------
  // OPT-IN DEMO PORTFOLIO, CLEAR DEMO & FULL RESET TO ZERO
  // -------------------------------------------------------------

  loadDemoPortfolio(): void {
    this.seedDemoPortfolio();
  }

  /**
   * Explicitly opt-in institutional demo seeder.
   * Uses isolated `vault-demo-*` vaults with balanced accounting so deleting demo items
   * or calling `clearDemoData()` never corrupts real user balances.
   */
  seedDemoPortfolio(): void {
    // Idempotent: clear prior demo artifacts first without touching any real user records.
    this.clearDemoData();

    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const today = todayVetIso();
    const now = Date.now();
    const dayMs = 86_400_000;
    const fmtDate = (daysAgo: number) => addCalendarDays(today, -daysAgo);

    const demoVaults: AssetVault[] = [
      {
        id: 'vault-demo-zelle',
        name: 'Zelle Personal (Demo)',
        channel: 'zelle',
        scope: 'personal',
        currency: 'USD',
        vaultKind: 'asset',
        openingBalance: 500,
        balance: 500,
        balanceUsdEquivalent: 500,
        balanceVesEquivalent: bcv > 0 ? roundMoney(500 * bcv) : 0,
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 'vault-demo-cash',
        name: 'Efectivo Divisas (Demo)',
        channel: 'cash',
        scope: 'all',
        currency: 'USD',
        vaultKind: 'asset',
        openingBalance: 300,
        balance: 300,
        balanceUsdEquivalent: 300,
        balanceVesEquivalent: bcv > 0 ? roundMoney(300 * bcv) : 0,
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 'vault-demo-banesco',
        name: 'Banesco Bs Personal (Demo)',
        channel: 'bs_bank',
        scope: 'personal',
        currency: 'VES',
        vaultKind: 'asset',
        bankCode: 'BANESCO',
        openingBalance: 12000,
        balance: 12000,
        balanceUsdEquivalent: bcv > 0 ? roundMoney(12000 / bcv) : 0,
        balanceVesEquivalent: 12000,
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 'vault-demo-pyme',
        name: 'Caja Operativa Pyme (Demo)',
        channel: 'cash',
        scope: 'business',
        currency: 'USD',
        vaultKind: 'asset',
        openingBalance: 450,
        balance: 450,
        balanceUsdEquivalent: 450,
        balanceVesEquivalent: bcv > 0 ? roundMoney(450 * bcv) : 0,
        updatedAt: new Date(now).toISOString(),
      },
    ];

    const demoIncomes: IncomeEntry[] = [
      {
        id: 'inc-demo-1',
        title: 'Anticipo 50% Pintura General Corolla',
        scope: 'business',
        category: 'quote_advance',
        channel: 'zelle',
        vaultId: 'vault-demo-pyme',
        triMonetary: computeTriMonetaryAmount(420, 'USD', bcv, par),
        date: fmtDate(1),
        drawerAllocations: { drawer1Usd: 210, drawer2Usd: 126, drawer3Usd: 84 },
        createdAt: new Date(now - dayMs).toISOString(),
        notes: 'Gaveta 1: $210 | Gaveta 2: $126 | Utilidad: $84',
      },
      {
        id: 'inc-demo-2',
        title: 'Honorarios Consultoría y Gestión',
        scope: 'personal',
        category: 'salary',
        channel: 'zelle',
        vaultId: 'vault-demo-zelle',
        triMonetary: computeTriMonetaryAmount(650, 'USD', bcv, par),
        date: fmtDate(3),
        createdAt: new Date(now - 3 * dayMs).toISOString(),
      },
      {
        id: 'inc-demo-3',
        title: 'Entrega Obra Remodelación Drywall',
        scope: 'business',
        category: 'business_sale',
        channel: 'cash',
        vaultId: 'vault-demo-cash',
        triMonetary: computeTriMonetaryAmount(380, 'USD', bcv, par),
        date: fmtDate(5),
        createdAt: new Date(now - 5 * dayMs).toISOString(),
      },
    ];

    const demoExpenses: ExpenseEntry[] = [
      {
        id: 'exp-demo-1',
        title: 'Compra Barniz Automotriz 2K y Lijas',
        scope: 'business',
        category: 'provider_merchandise',
        channel: 'zelle',
        vaultId: 'vault-demo-pyme',
        drawerAllocation: 'drawer_merchandise',
        triMonetary: computeTriMonetaryAmount(145, 'USD', bcv, par),
        date: fmtDate(0),
        createdAt: new Date(now - 3600000).toISOString(),
      },
      {
        id: 'exp-demo-2',
        title: 'Mercado Semanal Familiar',
        scope: 'personal',
        category: 'groceries',
        channel: 'bs_bank',
        vaultId: 'vault-demo-banesco',
        triMonetary: computeTriMonetaryAmount(85, 'USD', bcv, par),
        date: fmtDate(1),
        createdAt: new Date(now - dayMs).toISOString(),
      },
      {
        id: 'exp-demo-3',
        title: 'Adelanto Nómina Técnico Pintor',
        scope: 'business',
        category: 'payroll',
        channel: 'cash',
        vaultId: 'vault-demo-pyme',
        drawerAllocation: 'drawer_operations',
        triMonetary: computeTriMonetaryAmount(110, 'USD', bcv, par),
        date: fmtDate(2),
        createdAt: new Date(now - 2 * dayMs).toISOString(),
      },
      {
        id: 'exp-demo-4',
        title: 'Gasolina, Peajes y Logística',
        scope: 'personal',
        category: 'transport',
        channel: 'cash',
        vaultId: 'vault-demo-cash',
        triMonetary: computeTriMonetaryAmount(35, 'USD', bcv, par),
        date: fmtDate(4),
        createdAt: new Date(now - 4 * dayMs).toISOString(),
      },
      {
        id: 'exp-demo-5',
        title: 'Internet Fibra y Electricidad Taller',
        scope: 'business',
        category: 'services',
        channel: 'bs_bank',
        vaultId: 'vault-demo-banesco',
        drawerAllocation: 'drawer_operations',
        triMonetary: computeTriMonetaryAmount(55, 'USD', bcv, par),
        date: fmtDate(6),
        createdAt: new Date(now - 6 * dayMs).toISOString(),
      },
    ];

    // Apply demo incomes and expenses to demo vaults so balances stay 100% double-entry consistent.
    let balancedDemoVaults = demoVaults;
    for (const inc of demoIncomes) {
      if (inc.vaultId) {
        balancedDemoVaults = this.applyVaultDelta(balancedDemoVaults, inc.vaultId, inc.triMonetary, 1);
      }
    }
    for (const exp of demoExpenses) {
      if (exp.vaultId) {
        balancedDemoVaults = this.applyVaultDelta(balancedDemoVaults, exp.vaultId, exp.triMonetary, -1);
      }
    }

    const demoTransfer: TransferEntry = {
      id: 'trf-demo-1',
      groupId: 'trf-grp-demo-1',
      fromVaultId: 'vault-demo-zelle',
      toVaultId: 'vault-demo-cash',
      sourceCurrency: 'USD',
      targetCurrency: 'USD',
      sourceAmount: 100,
      creditedAmount: 100,
      amountUsd: 100,
      bcvRateApplied: bcv,
      date: fmtDate(2),
      kind: 'vault_transfer',
      notes: 'Traslado demo a caja fuerte',
      createdAt: new Date(now - 2 * dayMs).toISOString(),
    };
    balancedDemoVaults = balancedDemoVaults.map((v) => {
      if (v.id === 'vault-demo-zelle') return { ...v, balance: roundMoney(v.balance - 100) };
      if (v.id === 'vault-demo-cash') return { ...v, balance: roundMoney(v.balance + 100) };
      return v;
    });

    const schedule = this.calculateCasheaBreakdown(240, 3, 3, {
      startDate: fmtDate(10),
      creditLine: 'principal',
    });
    const demoPlan: CasheaPlan = {
      id: 'cashea-demo-1',
      productName: 'Compresor Neumático 50L + Pistola HVLP',
      storeName: 'Ferretería EPA',
      scope: 'business',
      level: 3,
      creditLine: 'principal',
      totalPriceUsd: 240,
      initialPaymentUsd: schedule.initialPaymentUsd,
      initialPercentage: schedule.initialPercentage,
      initialPercent: schedule.initialPercent,
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
      casheaLine: 'principal',
      triMonetary: computeTriMonetaryAmount(inst.amountUsd, 'USD', bcv, par),
      dueDate: inst.dueDate,
      status: 'pending',
      amountPaid: 0,
      remainingAmount: inst.amountUsd,
      casheaPlanId: 'cashea-demo-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const demoGoals: WealthGoal[] = [
      {
        id: 'goal-demo-1',
        title: 'Fondo de Reserva Patrimonial (6 Meses)',
        targetAmountUsd: 2000,
        currentAmountUsd: 850,
        scope: 'personal',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'goal-demo-2',
        title: 'Cabina de Pintura Presurizada Taller',
        targetAmountUsd: 1500,
        currentAmountUsd: 620,
        scope: 'business',
        createdAt: new Date().toISOString(),
      },
    ];

    this.updateState({
      assets: [...this.state().assets, ...balancedDemoVaults],
      incomes: [...demoIncomes, ...this.state().incomes],
      expenses: [...demoExpenses, ...this.state().expenses],
      transfers: [demoTransfer, ...(this.state().transfers ?? [])],
      casheaPlans: [demoPlan, ...this.state().casheaPlans],
      liabilities: [...demoLiabilities, ...this.state().liabilities],
      goals: [...demoGoals, ...(this.state().goals ?? [])],
    });
  }

  /**
   * Purges all demo-seeded artifacts (demo vaults, incomes, expenses including `exp-cashea-*`,
   * Cashea demo plans/liabilities, demo goals, and demo transfers) while keeping real user data intact.
   */
  clearDemoData(): void {
    this.updateState({
      assets: this.state().assets.filter((v) => !v.id.startsWith('vault-demo-')),
      incomes: this.state().incomes.filter(
        (i) => !i.id.startsWith('inc-demo-') && !(i.vaultId?.startsWith('vault-demo-') ?? false),
      ),
      expenses: this.state().expenses.filter(
        (e) =>
          !e.id.startsWith('exp-demo-') &&
          !e.id.startsWith('exp-cashea-cashea-demo-') &&
          !(e.liabilityId?.startsWith('liab-cashea-cashea-demo-') ?? false) &&
          !(e.vaultId?.startsWith('vault-demo-') ?? false),
      ),
      casheaPlans: this.state().casheaPlans.filter((p) => !p.id.startsWith('cashea-demo-')),
      liabilities: this.state().liabilities.filter(
        (l) =>
          !l.id.startsWith('liab-cashea-cashea-demo-') &&
          !(l.casheaPlanId?.startsWith('cashea-demo-') ?? false),
      ),
      goals: (this.state().goals ?? []).filter((g) => !g.id.startsWith('goal-demo-')),
      transfers: (this.state().transfers ?? []).filter(
        (t) =>
          !t.id.startsWith('trf-demo-') &&
          !t.fromVaultId.startsWith('vault-demo-') &&
          !t.toVaultId.startsWith('vault-demo-'),
      ),
    });
  }

  /**
   * Resets ALL collections INCLUDING `assets: []` for a clean Zero-Seed start.
   */
  resetLedgerToZero(): void {
    const previousCounts = {
      assets: this.state().assets.length,
      incomes: this.state().incomes.length,
      expenses: this.state().expenses.length,
      liabilities: this.state().liabilities.length,
    };
    this.updateState(createEmptyLedgerState());
    this.recordAudit('DATA_MUTATION', 'F360_RESET_LEDGER', previousCounts, 'warn');
  }

  // -------------------------------------------------------------
  // SUB-MÓDULO 1: CASHEA 2026 ENGINE (N1-N6, DUAL LINE, ANTI-MORA, ALIADO)
  // -------------------------------------------------------------

  /**
   * Generates a Cashea schedule supporting Levels 1-6 (Araguaney), Dual Line (`principal` / `cotidiana` / `vehicular`),
   * flexible initial percentage (0..90%), VET `firstDueDate`, 1/3/6/9/12 + vehicular 12..24 installments,
   * and final-installment penny absorption so `sum(installments) === financedAmountUsd` strictly.
   */
  calculateCasheaSchedule(
    totalPriceUsd: number,
    level: CasheaLevel = 3,
    numberOfInstallments = 3,
    startDateOrOptions?: Date | string | CasheaScheduleOptions,
  ): CasheaScheduleBreakdown {
    const safeTotal = Math.max(0, roundMoney(Number.isFinite(totalPriceUsd) ? totalPriceUsd : 0));
    const tier = CASHEA_CLUB_TIERS[level] ?? CASHEA_CLUB_TIERS[3];

    const options: CasheaScheduleOptions =
      startDateOrOptions instanceof Date || typeof startDateOrOptions === 'string'
        ? { startDate: startDateOrOptions }
        : (startDateOrOptions ?? {});

    const creditLine: CasheaCreditLine = options.creditLine ?? 'principal';
    let initialPercent: number;

    if (typeof options.initialPercent === 'number' && Number.isFinite(options.initialPercent)) {
      initialPercent = Math.max(0, Math.min(90, roundMoney(options.initialPercent, 2)));
    } else if (creditLine === 'cotidiana') {
      initialPercent = tier.cotidianaInitialPercent;
    } else if (options.zeroInitialCampaign && level === 6) {
      initialPercent = tier.campaignInitialPercent ?? 0;
    } else {
      initialPercent = tier.principalInitialPercent;
    }

    const initialFactor = roundMoney(initialPercent / 100, 4);
    const initialPaymentUsd = roundMoney(safeTotal * initialFactor);
    const financedAmountUsd = Math.max(0, roundMoney(safeTotal - initialPaymentUsd));

    const maxAllowed = creditLine === 'vehicular' ? 24 : 12;
    const count = Math.max(1, Math.min(maxAllowed, Math.round(numberOfInstallments || 3)));
    const frequencyDays =
      typeof options.frequencyDays === 'number' && options.frequencyDays > 0
        ? Math.round(options.frequencyDays)
        : creditLine === 'vehicular'
          ? 30
          : 14;

    const baseInstallment = count > 0 ? roundMoney(financedAmountUsd / count) : 0;

    let firstDueIso: string;
    if (options.firstDueDate) {
      firstDueIso = options.firstDueDate;
    } else {
      const purchaseIso =
        typeof options.startDate === 'string'
          ? options.startDate
          : options.startDate instanceof Date
            ? todayVetIso(options.startDate)
            : todayVetIso();
      firstDueIso = addCalendarDays(purchaseIso, frequencyDays);
    }

    const installments: CasheaInstallment[] = [];
    for (let i = 1; i <= count; i++) {
      const dueDate = addCalendarDays(firstDueIso, (i - 1) * frequencyDays);
      const amountUsd =
        financedAmountUsd <= 0
          ? 0
          : i === count
            ? roundMoney(financedAmountUsd - baseInstallment * (count - 1))
            : baseInstallment;

      installments.push({
        number: i,
        dueDate,
        amountUsd,
        amountPaidUsd: 0,
        status: 'pending',
      });
    }

    return {
      level: tier.level,
      tierName: tier.name,
      creditLine,
      initialPercent,
      initialPercentage: initialPercent,
      initialFactor,
      initialPaymentUsd,
      financedAmountUsd,
      installmentAmountUsd: baseInstallment,
      finalInstallmentAmountUsd: installments[installments.length - 1]?.amountUsd ?? 0,
      installmentsCount: count,
      frequencyDays,
      installments,
    };
  }

  calculateCasheaBreakdown(
    totalPriceUsd: number,
    level: CasheaLevel = 3,
    numberOfInstallments = 3,
    startDateOrOptions?: Date | string | CasheaScheduleOptions,
  ): CasheaScheduleBreakdown {
    return this.calculateCasheaSchedule(
      totalPriceUsd,
      level,
      numberOfInstallments,
      startDateOrOptions,
    );
  }

  addCasheaPlan(plan: Omit<CasheaPlan, 'id' | 'createdAt'>): CasheaPlan {
    const id = generateFinanceId('cashea');
    const nowIso = new Date().toISOString();
    const resolvedScope: FinanceScope = plan.scope ?? 'personal';
    const resolvedLine: CasheaCreditLine = plan.creditLine ?? 'principal';
    const normalizedInitialPercent =
      plan.initialPercent !== undefined
        ? plan.initialPercent
        : plan.initialPercentage > 0 && plan.initialPercentage <= 1
          ? roundMoney(plan.initialPercentage * 100, 2)
          : plan.initialPercentage;

    const newPlan: CasheaPlan = {
      ...plan,
      id,
      scope: resolvedScope,
      creditLine: resolvedLine,
      initialPercent: normalizedInitialPercent,
      initialPercentage: normalizedInitialPercent,
      createdAt: nowIso,
    };

    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();

    const liabilitiesToAdd: LiabilityItem[] = newPlan.installments.map((inst) => ({
      id: `liab-cashea-${newPlan.id}-${inst.number}`,
      title: `Cuota Cashea #${inst.number} - ${newPlan.productName}`,
      creditor: `Cashea (${newPlan.storeName})`,
      scope: resolvedScope,
      category: 'cashea',
      casheaLine: resolvedLine,
      triMonetary: computeTriMonetaryAmount(inst.amountUsd, 'USD', bcv, par),
      dueDate: inst.dueDate,
      status: 'pending',
      amountPaid: 0,
      remainingAmount: roundMoney(inst.amountUsd),
      casheaPlanId: newPlan.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    }));

    const financedTotal = roundMoney(
      newPlan.installments.reduce((sum, inst) => sum + inst.amountUsd, 0),
    );
    const currentProfile = this.state().casheaProfile ?? createDefaultCasheaProfile();
    const nextProfile: CasheaUserProfile = {
      ...currentProfile,
      principalUsedUsd:
        resolvedLine === 'cotidiana'
          ? currentProfile.principalUsedUsd
          : roundMoney(currentProfile.principalUsedUsd + financedTotal),
      cotidianaUsedUsd:
        resolvedLine === 'cotidiana'
          ? roundMoney(currentProfile.cotidianaUsedUsd + financedTotal)
          : currentProfile.cotidianaUsedUsd,
      updatedAt: nowIso,
    };

    this.updateState({
      casheaPlans: [...this.state().casheaPlans, newPlan],
      liabilities: [...this.state().liabilities, ...liabilitiesToAdd],
      casheaProfile: nextProfile,
    });

    return newPlan;
  }

  registerCasheaPlan(plan: Omit<CasheaPlan, 'id' | 'createdAt'>): CasheaPlan {
    return this.addCasheaPlan(plan);
  }

  /**
   * Idempotently marks a Cashea installment as fully paid.
   * Rejects replay without double-debiting vaults, respects `plan.scope`, and updates `casheaProfile`.
   */
  markCasheaInstallmentPaid(
    planId: string,
    installmentNumber: number,
    paymentRef?: string,
    bcvRateApplied?: number,
    debitVaultId?: string,
  ): CasheaPaymentResult {
    const targetPlan = this.state().casheaPlans.find((p) => p.id === planId);
    const targetInst = targetPlan?.installments.find((i) => i.number === installmentNumber);
    if (!targetPlan || !targetInst) {
      return { success: false, alreadyPaid: false, paidAmountUsd: 0, reason: 'NOT_FOUND' };
    }
    if (targetInst.status === 'paid') {
      return { success: false, alreadyPaid: true, paidAmountUsd: 0, reason: 'ALREADY_PAID' };
    }

    const alreadyPaidPartial = roundMoney(targetInst.amountPaidUsd ?? 0);
    const remainingToPay = Math.max(0, roundMoney(targetInst.amountUsd - alreadyPaidPartial));
    const bcv =
      typeof bcvRateApplied === 'number' && bcvRateApplied > 0
        ? bcvRateApplied
        : this.currentBcvRate();
    const par = this.currentParallelRate();
    const nowIso = new Date().toISOString();
    const liabilityId = `liab-cashea-${planId}-${installmentNumber}`;
    const planScope: FinanceScope =
      targetPlan.scope && targetPlan.scope !== 'all' ? targetPlan.scope : 'personal';
    const planLine: CasheaCreditLine = targetPlan.creditLine ?? 'principal';

    const plans = this.state().casheaPlans.map((plan) => {
      if (plan.id !== planId) return plan;
      const updatedInstallments = plan.installments.map((inst) =>
        inst.number === installmentNumber
          ? {
              ...inst,
              amountPaidUsd: inst.amountUsd,
              status: 'paid' as const,
              paidAt: nowIso,
              bcvRateApplied: bcv,
              paidVes: bcv > 0 ? roundMoney(inst.amountUsd * bcv) : 0,
              paymentReference: paymentRef ?? inst.paymentReference,
            }
          : inst,
      );
      const allPaid = updatedInstallments.every((i) => i.status === 'paid');
      return {
        ...plan,
        installments: updatedInstallments,
        status: allPaid ? ('completed' as const) : ('active' as const),
      };
    });

    const liabilities = this.state().liabilities.map((l) =>
      l.id === liabilityId
        ? {
            ...l,
            status: 'paid' as const,
            amountPaid: l.triMonetary.amount_usd,
            remainingAmount: 0,
            updatedAt: nowIso,
          }
        : l,
    );

    const resolvedVaultId = this.resolveValidVaultId(debitVaultId);
    const tri = computeTriMonetaryAmount(remainingToPay, 'USD', bcv, par);
    const updatedAssets =
      resolvedVaultId && remainingToPay > 0
        ? this.applyVaultDelta(this.state().assets, resolvedVaultId, tri, -1)
        : this.state().assets;

    let nextExpenses = this.state().expenses;
    let expenseId: string | undefined;
    if (remainingToPay > 0) {
      const vault = resolvedVaultId
        ? updatedAssets.find((v) => v.id === resolvedVaultId)
        : undefined;
      expenseId = planId.startsWith('cashea-demo-')
        ? `exp-cashea-${planId}-${installmentNumber}-${generateFinanceId('d')}`
        : generateFinanceId('exp-cashea');
      const exp: ExpenseEntry = {
        id: expenseId,
        title: `Cuota Cashea #${installmentNumber} - ${targetPlan.productName}`,
        scope: planScope,
        category: 'cashea_installment',
        channel: vault?.channel ?? 'bs_bank',
        vaultId: resolvedVaultId,
        liabilityId,
        casheaLine: planLine,
        triMonetary: tri,
        date: todayVetIso(),
        referenceNumber: paymentRef,
        notes: paymentRef ? `Ref: ${paymentRef}` : 'Cuota quincenal Cashea liquidada',
        createdAt: nowIso,
      };
      nextExpenses = [exp, ...nextExpenses];
    }

    const updatedProfile = this.applyCasheaProfilePaymentDelta(
      this.state().casheaProfile ?? createDefaultCasheaProfile(),
      planLine,
      remainingToPay,
      1,
    );

    this.updateState({
      assets: updatedAssets,
      casheaPlans: plans,
      liabilities,
      expenses: nextExpenses,
      casheaProfile: updatedProfile,
    });

    return {
      success: true,
      alreadyPaid: false,
      paidAmountUsd: remainingToPay,
      expenseId,
    };
  }

  /**
   * Records a partial (or full) abono on a pending Cashea installment.
   */
  recordCasheaPartialPayment(
    planId: string,
    installmentNumber: number,
    partialAmountUsd: number,
    paymentRef?: string,
    debitVaultId?: string,
    bcvRateApplied?: number,
  ): CasheaPaymentResult {
    const targetPlan = this.state().casheaPlans.find((p) => p.id === planId);
    const targetInst = targetPlan?.installments.find((i) => i.number === installmentNumber);
    if (!targetPlan || !targetInst) {
      return { success: false, alreadyPaid: false, paidAmountUsd: 0, reason: 'NOT_FOUND' };
    }
    if (targetInst.status === 'paid') {
      return { success: false, alreadyPaid: true, paidAmountUsd: 0, reason: 'ALREADY_PAID' };
    }
    if (!Number.isFinite(partialAmountUsd) || partialAmountUsd <= 0) {
      return { success: false, alreadyPaid: false, paidAmountUsd: 0, reason: 'INVALID_AMOUNT' };
    }

    const currentPaid = roundMoney(targetInst.amountPaidUsd ?? 0);
    const remaining = Math.max(0, roundMoney(targetInst.amountUsd - currentPaid));
    const applied = roundMoney(Math.min(partialAmountUsd, remaining));

    if (applied >= remaining) {
      return this.markCasheaInstallmentPaid(
        planId,
        installmentNumber,
        paymentRef,
        bcvRateApplied,
        debitVaultId,
      );
    }

    const bcv =
      typeof bcvRateApplied === 'number' && bcvRateApplied > 0
        ? bcvRateApplied
        : this.currentBcvRate();
    const par = this.currentParallelRate();
    const nowIso = new Date().toISOString();
    const liabilityId = `liab-cashea-${planId}-${installmentNumber}`;
    const planScope: FinanceScope =
      targetPlan.scope && targetPlan.scope !== 'all' ? targetPlan.scope : 'personal';
    const planLine: CasheaCreditLine = targetPlan.creditLine ?? 'principal';
    const nextInstPaid = roundMoney(currentPaid + applied);

    const plans = this.state().casheaPlans.map((plan) => {
      if (plan.id !== planId) return plan;
      return {
        ...plan,
        installments: plan.installments.map((inst) =>
          inst.number === installmentNumber
            ? {
                ...inst,
                amountPaidUsd: nextInstPaid,
                paymentReference: paymentRef ?? inst.paymentReference,
              }
            : inst,
        ),
      };
    });

    const liabilities = this.state().liabilities.map((l) => {
      if (l.id !== liabilityId) return l;
      const newPaid = roundMoney(Math.min(l.triMonetary.amount_usd, l.amountPaid + applied));
      const newRemaining = Math.max(0, roundMoney(l.triMonetary.amount_usd - newPaid));
      return {
        ...l,
        amountPaid: newPaid,
        remainingAmount: newRemaining,
        status: newRemaining <= 0 ? ('paid' as const) : ('partially_paid' as const),
        updatedAt: nowIso,
      };
    });

    const resolvedVaultId = this.resolveValidVaultId(debitVaultId);
    const tri = computeTriMonetaryAmount(applied, 'USD', bcv, par);
    const updatedAssets = resolvedVaultId
      ? this.applyVaultDelta(this.state().assets, resolvedVaultId, tri, -1)
      : this.state().assets;

    const vault = resolvedVaultId
      ? updatedAssets.find((v) => v.id === resolvedVaultId)
      : undefined;
    const expenseId = generateFinanceId('exp-cashea');
    const exp: ExpenseEntry = {
      id: expenseId,
      title: `Abono Cuota Cashea #${installmentNumber} - ${targetPlan.productName}`,
      scope: planScope,
      category: 'cashea_installment',
      channel: vault?.channel ?? 'bs_bank',
      vaultId: resolvedVaultId,
      liabilityId,
      casheaLine: planLine,
      triMonetary: tri,
      date: todayVetIso(),
      referenceNumber: paymentRef,
      notes: `Abono parcial $${applied.toFixed(2)} USD (acumulado $${nextInstPaid.toFixed(2)} / $${targetInst.amountUsd.toFixed(2)} USD)`,
      createdAt: nowIso,
    };

    const updatedProfile = this.applyCasheaProfilePaymentDelta(
      this.state().casheaProfile ?? createDefaultCasheaProfile(),
      planLine,
      applied,
      0,
    );

    this.updateState({
      assets: updatedAssets,
      casheaPlans: plans,
      liabilities,
      expenses: [exp, ...this.state().expenses],
      casheaProfile: updatedProfile,
    });

    return {
      success: true,
      alreadyPaid: false,
      paidAmountUsd: applied,
      expenseId,
    };
  }

  /**
   * Anti-Mora Diagnostic Engine:
   * - 2-day grace period (`grace_2d`, `$0` fee)
   * - Day 3+ overdue: `$4` reactivation fee per overdue installment + Club penalty tiers (`7d`, `14d`, `28d`)
   */
  evaluateCasheaInstallmentHealth(
    dueDate: string,
    status: CasheaInstallment['status'],
    todayIso: string = todayVetIso(),
  ): CasheaInstallmentHealth {
    if (status === 'paid') {
      return {
        status: 'paid',
        daysUntilDue: 0,
        daysOverdue: 0,
        inGracePeriod: false,
        reactivationFeeUsd: 0,
        penaltyTier: 'none',
        clubPointsImpact: 'Cuota saldada al día',
      };
    }

    const daysUntilDue = calendarDaysBetween(todayIso, dueDate);
    if (daysUntilDue > 2) {
      return {
        status: 'upcoming',
        daysUntilDue,
        daysOverdue: 0,
        inGracePeriod: false,
        reactivationFeeUsd: 0,
        penaltyTier: 'none',
        clubPointsImpact: 'Al día sin riesgo de penalización',
      };
    }

    if (daysUntilDue >= 0) {
      return {
        status: 'due_soon_48h',
        daysUntilDue,
        daysOverdue: 0,
        inGracePeriod: false,
        reactivationFeeUsd: 0,
        penaltyTier: 'none',
        clubPointsImpact: 'Vencimiento dentro de las próximas 48 horas',
      };
    }

    const daysOverdue = Math.abs(daysUntilDue);
    if (daysOverdue <= 2) {
      return {
        status: 'grace_2d',
        daysUntilDue,
        daysOverdue,
        inGracePeriod: true,
        reactivationFeeUsd: 0,
        penaltyTier: 'none',
        clubPointsImpact: 'Período de gracia de 2 días activo (sin recargo de reactivación)',
      };
    }

    if (daysOverdue >= 28) {
      return {
        status: 'overdue_penalty',
        daysUntilDue,
        daysOverdue,
        inGracePeriod: false,
        reactivationFeeUsd: 4,
        penaltyTier: '28d',
        clubPointsImpact: 'Mora crítica >= 28 días: riesgo de suspensión de línea y pérdida de nivel',
      };
    }

    if (daysOverdue >= 14) {
      return {
        status: 'overdue_penalty',
        daysUntilDue,
        daysOverdue,
        inGracePeriod: false,
        reactivationFeeUsd: 4,
        penaltyTier: '14d',
        clubPointsImpact: 'Mora >= 14 días: penalización severa y descenso de nivel Club Cashea Más',
      };
    }

    if (daysOverdue >= 7) {
      return {
        status: 'overdue_penalty',
        daysUntilDue,
        daysOverdue,
        inGracePeriod: false,
        reactivationFeeUsd: 4,
        penaltyTier: '7d',
        clubPointsImpact: 'Mora >= 7 días: reducción de puntos Club Cashea Más y cargo de reactivación',
      };
    }

    return {
      status: 'overdue_penalty',
      daysUntilDue,
      daysOverdue,
      inGracePeriod: false,
      reactivationFeeUsd: 4,
      penaltyTier: 'none',
      clubPointsImpact: 'Período de gracia vencido: aplica cargo de reactivación de $4 USD por cuota',
    };
  }

  /**
   * 14-Day Biweekly Collision Detector against pending liabilities and active recurring rules.
   */
  detectCasheaCollisions14D(
    candidateDates: readonly string[],
    windowDays = 2,
  ): CasheaCollisionItem[] {
    const safeWindow = Math.max(0, Math.trunc(windowDays));
    const pendingLiabilities = this.state().liabilities.filter((l) => l.status !== 'paid');
    const activeRules = (this.state().recurringRules ?? []).filter(
      (r) => r.active && (r.type === 'expense' || r.type === 'liability'),
    );
    const bcv = this.currentBcvRate();
    const eurUsd = this.currentEurUsdRate() || EUR_FALLBACK_RATE;

    return candidateDates.map((date) => {
      const matchedLiabilities = pendingLiabilities.filter(
        (l) => Math.abs(calendarDaysBetween(date, l.dueDate)) <= safeWindow,
      );

      const matchedRules = activeRules.filter((rule) =>
        this.doesRecurringRuleCollideWithDate(rule, date, safeWindow),
      );

      const liabUsd = matchedLiabilities.reduce((s, l) => s + l.remainingAmount, 0);
      const rulesUsd = matchedRules.reduce((s, r) => {
        if (r.currency === 'USD' || r.currency === 'USDT') return s + r.amount;
        if (r.currency === 'VES') return s + (bcv > 0 ? r.amount / bcv : 0);
        return s + r.amount * eurUsd;
      }, 0);

      const totalExistingCommittedUsd = roundMoney(liabUsd + rulesUsd);
      const collisionCount = matchedLiabilities.length + matchedRules.length;
      const severity: CasheaCollisionItem['severity'] =
        collisionCount === 0
          ? 'none'
          : collisionCount >= 2 || totalExistingCommittedUsd >= 150
            ? 'high'
            : 'medium';

      return {
        date,
        existingLiabilities: matchedLiabilities,
        existingRecurringRules: matchedRules,
        totalExistingCommittedUsd,
        collisionCount,
        severity,
      };
    });
  }

  /**
   * Dual Projector: Path A (Cash Savings) vs Path B (Cashea 0% Financed) with collision diagnostics.
   */
  simulateCasheaVsSavings(params: CasheaVsSavingsInput): CasheaVsSavingsResult {
    const price = Math.max(0, roundMoney(params.productPriceUsd));
    const capacity = Math.max(0, roundMoney(params.biweeklySavingsCapacityUsd));
    const inflationPct = Math.max(0, params.expectedBiweeklyInflationPct ?? 0);

    const biweeklyPeriodsNeeded = capacity > 0 ? Math.ceil(price / capacity) : 0;
    const daysUntilPurchase = biweeklyPeriodsNeeded * 14;
    const projectedCashPriceUsd =
      inflationPct > 0 && biweeklyPeriodsNeeded > 0
        ? roundMoney(price * Math.pow(1 + inflationPct / 100, biweeklyPeriodsNeeded))
        : price;

    const breakdown = this.calculateCasheaBreakdown(
      price,
      params.level,
      params.installmentsCount,
      {
        creditLine: params.creditLine,
        initialPercent: params.initialPercent,
        firstDueDate: params.firstDueDate,
        zeroInitialCampaign: params.zeroInitialCampaign,
      },
    );

    const collisions = this.detectCasheaCollisions14D(
      breakdown.installments.map((inst) => inst.dueDate),
    );
    const collisionCount = collisions.reduce((sum, c) => sum + c.collisionCount, 0);
    const totalCollisionExposureUsd = roundMoney(
      collisions.reduce((sum, c) => sum + c.totalExistingCommittedUsd, 0),
    );

    const canAffordInstallment =
      capacity > 0 && breakdown.installmentAmountUsd <= capacity;
    const biweeklySurplusAfterInstallmentUsd = roundMoney(
      capacity - breakdown.installmentAmountUsd,
    );

    let recommendation: CasheaVsSavingsResult['recommendation'];
    let rationale: string;

    if (!canAffordInstallment) {
      recommendation = 'save_cash_recommended';
      rationale = `La cuota quincenal ($${breakdown.installmentAmountUsd.toFixed(2)} USD) supera tu capacidad de ahorro quincenal ($${capacity.toFixed(2)} USD). Conviene ahorrar en efectivo (${biweeklyPeriodsNeeded} quincenas) o incrementar la inicial.`;
    } else if (collisionCount > 0 || biweeklySurplusAfterInstallmentUsd < breakdown.installmentAmountUsd * 0.25) {
      recommendation = 'stretch_warning';
      rationale = `La cuota es pagable, pero existen ${collisionCount} colisión(es) con compromisos previos ($${totalCollisionExposureUsd.toFixed(2)} USD) o margen quincenal ajustado. Evalúa desplazar la fecha de compra.`;
    } else {
      recommendation = 'cashea_viable';
      rationale = `Financiamiento viable sin intereses con excedente quincenal de $${biweeklySurplusAfterInstallmentUsd.toFixed(2)} USD y cero colisiones en el calendario 14D.`;
    }

    return {
      pathA_savings: {
        biweeklyPeriodsNeeded,
        daysUntilPurchase,
        projectedCashPriceUsd,
        debtRisk: 'none',
      },
      pathB_cashea: {
        initialPaymentUsd: breakdown.initialPaymentUsd,
        financedAmountUsd: breakdown.financedAmountUsd,
        installmentAmountUsd: breakdown.installmentAmountUsd,
        installmentsCount: breakdown.installmentsCount,
        canAffordInstallment,
        biweeklySurplusAfterInstallmentUsd,
        collisionCount,
        totalCollisionExposureUsd,
      },
      recommendation,
      rationale,
    };
  }

  updateCasheaProfile(patch: Partial<CasheaUserProfile>): CasheaUserProfile {
    const next: CasheaUserProfile = {
      ...(this.state().casheaProfile ?? createDefaultCasheaProfile()),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.updateState({ casheaProfile: next });
    return next;
  }

  // -------------------------------------------------------------
  // CASHEA PARA NEGOCIOS (MODO ALIADO PYME — OPT-IN)
  // -------------------------------------------------------------

  simulateCasheaMerchantSale(input: CasheaMerchantSaleInput): CasheaMerchantSaleSimulation {
    const grossSaleUsd = Math.max(0, roundMoney(input.grossSaleUsd));
    const costOfGoodsUsd = Math.max(0, roundMoney(input.costOfGoodsUsd));
    const mdrPercent = Math.max(0, Math.min(25, roundMoney(input.mdrPercent, 2)));
    const weeklyAdvanceFeePercent = input.useWeeklyAdvance
      ? Math.max(0, Math.min(15, roundMoney(input.weeklyAdvanceFeePercent ?? 3, 2)))
      : 0;

    const bcvRate = Number.isFinite(input.bcvRate) && input.bcvRate > 0 ? input.bcvRate : 0;
    const parallelRate =
      Number.isFinite(input.parallelReplacementRate) && input.parallelReplacementRate > 0
        ? input.parallelReplacementRate
        : bcvRate;

    const mdrFeeUsd = roundMoney((grossSaleUsd * mdrPercent) / 100);
    const weeklyAdvanceFeeUsd = roundMoney((grossSaleUsd * weeklyAdvanceFeePercent) / 100);
    const totalCasheaFeesUsd = roundMoney(mdrFeeUsd + weeklyAdvanceFeeUsd);

    const settlementUsdAtBcv = Math.max(0, roundMoney(grossSaleUsd - totalCasheaFeesUsd));
    const settlementVes = bcvRate > 0 ? roundMoney(settlementUsdAtBcv * bcvRate) : 0;
    const realReplacementUsd =
      bcvRate > 0 && parallelRate > 0
        ? roundMoney(settlementVes / parallelRate)
        : settlementUsdAtBcv;

    const fxGapPercent =
      bcvRate > 0 && parallelRate > 0
        ? roundMoney(((parallelRate - bcvRate) / bcvRate) * 100, 2)
        : 0;
    const fxGapErosionUsd = roundMoney(Math.max(0, settlementUsdAtBcv - realReplacementUsd));

    const realNetProfitUsd = roundMoney(realReplacementUsd - costOfGoodsUsd);
    const realNetMarginPercent =
      grossSaleUsd > 0 ? roundMoney((realNetProfitUsd / grossSaleUsd) * 100, 2) : 0;
    const isSellingAtLoss = realNetProfitUsd < 0;

    const monthlyMinimumFeeUsd = Math.max(0, roundMoney(input.monthlyMinimumFeeUsd ?? 100));
    const activationFeeUsd = Math.max(0, roundMoney(input.activationFeeUsd ?? 0));
    const monthlyBreakEvenVolumeUsd =
      mdrPercent > 0 ? roundMoney(monthlyMinimumFeeUsd / (mdrPercent / 100)) : 0;
    const profitBreakEvenVolumeUsd =
      realNetMarginPercent > 0
        ? roundMoney((monthlyMinimumFeeUsd + activationFeeUsd) / (realNetMarginPercent / 100))
        : 0;

    return {
      grossSaleUsd,
      costOfGoodsUsd,
      mdrPercent,
      mdrFeeUsd,
      weeklyAdvanceFeePercent,
      weeklyAdvanceFeeUsd,
      totalCasheaFeesUsd,
      settlementUsdAtBcv,
      settlementVes,
      realReplacementUsd,
      fxGapPercent,
      fxGapErosionUsd,
      realNetProfitUsd,
      realNetMarginPercent,
      isSellingAtLoss,
      monthlyMinimumFeeUsd,
      activationFeeUsd,
      monthlyBreakEvenVolumeUsd,
      profitBreakEvenVolumeUsd,
      surchargeProhibitionWarning:
        'Política Cashea Aliados: está prohibido aplicar recargos o precios diferenciados sobre el precio de lista por pagos con Cashea.',
    };
  }

  registerCasheaMerchantSale(input: CasheaMerchantSaleInput): CasheaMerchantSale {
    const sim = this.simulateCasheaMerchantSale(input);
    const saleDate = input.date?.trim() || todayVetIso();
    const settlementDays = input.settlementDays ?? (input.useWeeklyAdvance ? 7 : 14);
    const nowIso = new Date().toISOString();

    const sale: CasheaMerchantSale = {
      id: generateFinanceId('cashea-ally'),
      title: input.title?.trim() || 'Venta Comercial Cashea Aliado',
      customerName: input.customerName?.trim() || undefined,
      saleDate,
      expectedSettlementDate: addCalendarDays(saleDate, settlementDays),
      status: 'pending_settlement',
      grossSaleUsd: sim.grossSaleUsd,
      costOfGoodsUsd: sim.costOfGoodsUsd,
      mdrPercent: sim.mdrPercent,
      mdrFeeUsd: sim.mdrFeeUsd,
      weeklyAdvanceFeePercent: sim.weeklyAdvanceFeePercent,
      weeklyAdvanceFeeUsd: sim.weeklyAdvanceFeeUsd,
      bcvRateApplied: input.bcvRate,
      parallelRateApplied: input.parallelReplacementRate,
      fxGapErosionUsd: sim.fxGapErosionUsd,
      netReceivableUsd: sim.settlementUsdAtBcv,
      realNetProfitUsd: sim.realNetProfitUsd,
      isSellingAtLoss: sim.isSellingAtLoss,
      createdAt: nowIso,
    };

    this.updateState({
      casheaMerchantSales: [sale, ...(this.state().casheaMerchantSales ?? [])],
    });
    return sale;
  }

  settleCasheaMerchantSale(
    saleId: string,
    targetVaultId?: string,
    drawerRatios?: { d1: number; d2: number; d3: number },
  ): { success: boolean; incomeEntry?: IncomeEntry; reason?: string } {
    const sale = (this.state().casheaMerchantSales ?? []).find((s) => s.id === saleId);
    if (!sale) {
      return { success: false, reason: 'NOT_FOUND' };
    }
    if (sale.status === 'settled') {
      return { success: false, reason: 'ALREADY_SETTLED' };
    }

    const profile = this.pymeProfile();
    const d1Pct = drawerRatios?.d1 ?? profile.defaultDrawer1Percent;
    const d2Pct = drawerRatios?.d2 ?? profile.defaultDrawer2Percent;
    const d3Pct = drawerRatios?.d3 ?? profile.defaultDrawer3Percent;
    const pctSum = d1Pct + d2Pct + d3Pct || 100;

    const netAmount = sale.netReceivableUsd;
    const d1Usd = roundMoney((netAmount * d1Pct) / pctSum);
    const d2Usd = roundMoney((netAmount * d2Pct) / pctSum);
    const d3Usd = roundMoney(netAmount - d1Usd - d2Usd);

    const incomeEntry = this.settlePymeSaleWithDrawers({
      title: `Liquidación Cashea Aliado: ${sale.title}`,
      totalUsd: netAmount,
      vaultId: targetVaultId,
      drawer1Usd: d1Usd,
      drawer2Usd: d2Usd,
      drawer3Usd: d3Usd,
    });

    const nowIso = new Date().toISOString();
    const updatedSales = (this.state().casheaMerchantSales ?? []).map((s) =>
      s.id === saleId
        ? {
            ...s,
            status: 'settled' as const,
            settledAt: nowIso,
            settledVaultId: incomeEntry.vaultId,
            incomeEntryId: incomeEntry.id,
          }
        : s,
    );

    this.updateState({ casheaMerchantSales: updatedSales });
    return { success: true, incomeEntry };
  }

  updatePymeProfile(patch: Partial<PymeBusinessProfile>): PymeBusinessProfile {
    const next: PymeBusinessProfile = {
      ...(this.state().pymeProfile ?? createDefaultPymeProfile()),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.updateState({ pymeProfile: next });
    return next;
  }

  // -------------------------------------------------------------
  // SUB-MÓDULO 2: PYME 3 GAVETAS, PROVEEDORES CxP & INVENTARIO
  // -------------------------------------------------------------

  /**
   * Cumulative 3-Drawer Telemetry:
   * - Includes cumulative opening balance of business vaults + all business incomes
   * - Exhaustively routes every business expense via `getDrawerForExpenseCategory`
   * - Never hides negative overdrafts behind `Math.max(0, ...)`
   */
  readonly pymeDrawersTelemetry = computed(() => {
    const state = this.state();
    const bcv = this.currentBcvRate();
    const eurUsd = this.currentEurUsdRate() || EUR_FALLBACK_RATE;
    const profile = this.pymeProfile();
    const ratioSum =
      profile.defaultDrawer1Percent +
        profile.defaultDrawer2Percent +
        profile.defaultDrawer3Percent || 100;
    const r1 = profile.defaultDrawer1Percent / ratioSum;
    const r2 = profile.defaultDrawer2Percent / ratioSum;
    const r3 = profile.defaultDrawer3Percent / ratioSum;

    const businessVaults = this.assets().filter((a) => a.scope === 'business');
    const baseCajaUsd = roundMoney(
      businessVaults.reduce((sum, v) => sum + v.balanceUsdEquivalent, 0),
    );

    const openingCapitalUsd = roundMoney(
      businessVaults.reduce((sum, v) => {
        const opening = v.openingBalance ?? 0;
        if (opening <= 0) return sum;
        if (v.currency === 'VES') return sum + (bcv > 0 ? opening / bcv : 0);
        if (v.currency === 'EUR') return sum + opening * eurUsd;
        return sum + opening;
      }, 0),
    );

    let totalAllocatedD1 = openingCapitalUsd * r1;
    let totalAllocatedD2 = openingCapitalUsd * r2;
    let totalAllocatedD3 = openingCapitalUsd * r3;

    const businessVaultIds = new Set(businessVaults.map((v) => v.id));

    for (const inc of state.incomes) {
      if (inc.drawerAllocations) {
        totalAllocatedD1 += inc.drawerAllocations.drawer1Usd;
        totalAllocatedD2 += inc.drawerAllocations.drawer2Usd;
        totalAllocatedD3 += inc.drawerAllocations.drawer3Usd;
      } else if (inc.scope === 'business' || (inc.vaultId && businessVaultIds.has(inc.vaultId))) {
        const amount = inc.triMonetary.amount_usd;
        totalAllocatedD1 += amount * r1;
        totalAllocatedD2 += amount * r2;
        totalAllocatedD3 += amount * r3;
      }
    }

    let merchExpensesUsd = 0;
    let opsExpensesUsd = 0;
    let capexExpensesUsd = 0;

    for (const exp of state.expenses) {
      const isBusinessExpense =
        Boolean(exp.drawerAllocation) ||
        exp.scope === 'business' ||
        (exp.vaultId ? businessVaultIds.has(exp.vaultId) : false);
      if (!isBusinessExpense) continue;

      const drawer = exp.drawerAllocation ?? getDrawerForExpenseCategory(exp.category);
      if (drawer === 'drawer_merchandise') {
        merchExpensesUsd += exp.triMonetary.amount_usd;
      } else if (drawer === 'drawer_capex') {
        capexExpensesUsd += exp.triMonetary.amount_usd;
      } else {
        opsExpensesUsd += exp.triMonetary.amount_usd;
      }
    }

    const drawer1AllocatedUsd = roundMoney(totalAllocatedD1);
    const drawer2AllocatedUsd = roundMoney(totalAllocatedD2);
    const drawer3AllocatedUsd = roundMoney(totalAllocatedD3);

    merchExpensesUsd = roundMoney(merchExpensesUsd);
    opsExpensesUsd = roundMoney(opsExpensesUsd);
    capexExpensesUsd = roundMoney(capexExpensesUsd);

    const drawer1AvailableUsd = roundMoney(drawer1AllocatedUsd - merchExpensesUsd);
    const drawer2AvailableUsd = roundMoney(drawer2AllocatedUsd - opsExpensesUsd);
    const drawer3AvailableUsd = roundMoney(drawer3AllocatedUsd - capexExpensesUsd);

    const drawer1OverdraftUsd = drawer1AvailableUsd < 0 ? Math.abs(drawer1AvailableUsd) : 0;
    const drawer2OverdraftUsd = drawer2AvailableUsd < 0 ? Math.abs(drawer2AvailableUsd) : 0;
    const drawer3OverdraftUsd = drawer3AvailableUsd < 0 ? Math.abs(drawer3AvailableUsd) : 0;

    return {
      drawer1AllocatedUsd,
      drawer2AllocatedUsd,
      drawer3AllocatedUsd,
      drawer1AvailableUsd,
      drawer1AvailableVes: bcv > 0 ? roundMoney(drawer1AvailableUsd * bcv) : 0,
      merchExpensesUsd,
      drawer2AvailableUsd,
      drawer2AvailableVes: bcv > 0 ? roundMoney(drawer2AvailableUsd * bcv) : 0,
      opsExpensesUsd,
      drawer3AvailableUsd,
      drawer3AvailableVes: bcv > 0 ? roundMoney(drawer3AvailableUsd * bcv) : 0,
      capexExpensesUsd,
      drawer1OverdraftUsd,
      drawer2OverdraftUsd,
      drawer3OverdraftUsd,
      hasOverdraft: drawer1OverdraftUsd > 0 || drawer2OverdraftUsd > 0 || drawer3OverdraftUsd > 0,
      pymeCajaBalanceUsd: baseCajaUsd,
    };
  });

  settlePymeSaleWithDrawers(params: {
    title: string;
    totalUsd: number;
    vaultId?: string;
    drawer1Usd: number;
    drawer2Usd: number;
    drawer3Usd: number;
    isInitialInjection?: boolean;
    paymentChannel?: PaymentChannel;
  }): IncomeEntry {
    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const tri = computeTriMonetaryAmount(params.totalUsd, 'USD', bcv, par);
    const today = todayVetIso();
    const targetVaultId = this.resolveBusinessOrValidVaultId(params.vaultId);
    const vault = targetVaultId
      ? this.state().assets.find((v) => v.id === targetVaultId)
      : undefined;

    return this.addIncome({
      title:
        params.title ||
        (params.isInitialInjection ? 'Fondeo de Capital (3 Gavetas)' : 'Venta Comercial (3 Gavetas)'),
      scope: 'business',
      category: params.isInitialInjection ? 'other' : 'business_sale',
      channel: params.paymentChannel ?? vault?.channel ?? 'cash',
      vaultId: targetVaultId,
      triMonetary: tri,
      date: today,
      drawerAllocations: {
        drawer1Usd: roundMoney(params.drawer1Usd),
        drawer2Usd: roundMoney(params.drawer2Usd),
        drawer3Usd: roundMoney(params.drawer3Usd),
      },
      notes: `Cortafuegos 3 Gavetas: Reposición $${params.drawer1Usd.toFixed(2)} | Operativa $${params.drawer2Usd.toFixed(2)} | Utilidad Libre $${params.drawer3Usd.toFixed(2)}`,
    });
  }

  executePayrollExpense(params: {
    employeeName: string;
    amountUsd: number;
    vaultId: string;
    notes?: string;
    referenceNumber?: string;
    period?: string;
  }): ExpenseEntry {
    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const tri = computeTriMonetaryAmount(params.amountUsd, 'USD', bcv, par);
    const today = todayVetIso();
    const targetVaultId = this.resolveBusinessOrValidVaultId(params.vaultId);
    const vault = targetVaultId
      ? this.state().assets.find((v) => v.id === targetVaultId)
      : undefined;

    return this.addExpense({
      title: `Pago Nómina: ${params.employeeName}${params.period ? ' (' + params.period + ')' : ''}`,
      scope: 'business',
      category: 'payroll',
      channel: vault?.channel ?? 'cash',
      vaultId: targetVaultId,
      drawerAllocation: 'drawer_operations',
      triMonetary: tri,
      date: today,
      referenceNumber: params.referenceNumber,
      notes: params.notes || 'Desembolso de nómina cargado a Gaveta 2 (Operativa)',
    });
  }

  executeDrawerDisbursement(params: {
    drawer: 1 | 2 | 3;
    title: string;
    amountUsd: number;
    vaultId: string;
    category?: ExpenseCategory;
    notes?: string;
    referenceNumber?: string;
  }): ExpenseEntry {
    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const tri = computeTriMonetaryAmount(params.amountUsd, 'USD', bcv, par);
    const today = todayVetIso();
    const targetVaultId = this.resolveBusinessOrValidVaultId(params.vaultId);
    const vault = targetVaultId
      ? this.state().assets.find((v) => v.id === targetVaultId)
      : undefined;

    const config =
      params.drawer === 1
        ? {
            drawerAlloc: 'drawer_merchandise' as const,
            defaultCategory: 'provider_merchandise' as const,
            defaultTitle: 'Compra Insumos / Reposición (Gaveta 1)',
          }
        : params.drawer === 2
          ? {
              drawerAlloc: 'drawer_operations' as const,
              defaultCategory: 'services' as const,
              defaultTitle: 'Gasto Operativo (Gaveta 2)',
            }
          : {
              drawerAlloc: 'drawer_capex' as const,
              defaultCategory: 'equipment_capex' as const,
              defaultTitle: 'Inversión CAPEX / Retiro Socios (Gaveta 3)',
            };

    return this.addExpense({
      title: params.title || config.defaultTitle,
      scope: 'business',
      category: params.category || config.defaultCategory,
      channel: vault?.channel ?? 'cash',
      vaultId: targetVaultId,
      drawerAllocation: config.drawerAlloc,
      triMonetary: tri,
      date: today,
      referenceNumber: params.referenceNumber,
      notes: params.notes || `Desembolso ejecutado desde Gaveta #${params.drawer}`,
    });
  }

  /**
   * Registers a Pyme provider. When `outstandingDebtUsd > 0`, automatically creates one linked
   * `LiabilityItem` so Providers CxP and Liabilities share a single source of truth.
   */
  addProvider(provider: Omit<PymeProvider, 'id' | 'createdAt'>): PymeProvider {
    const id = generateFinanceId('prov');
    const nowIso = new Date().toISOString();
    const initialDebt = Math.max(0, roundMoney(provider.outstandingDebtUsd));

    const newProv: PymeProvider = {
      ...provider,
      id,
      outstandingDebtUsd: initialDebt,
      createdAt: nowIso,
    };

    let nextLiabilities = this.state().liabilities;
    if (initialDebt > 0) {
      const bcv = this.currentBcvRate();
      const par = this.currentParallelRate();
      const linkedLiability: LiabilityItem = {
        id: generateFinanceId('liab-prov'),
        title: `Saldo Inicial Proveedor: ${newProv.name}`,
        creditor: newProv.name,
        scope: 'business',
        category: 'provider',
        triMonetary: computeTriMonetaryAmount(initialDebt, 'USD', bcv, par),
        dueDate: addCalendarDays(todayVetIso(), 14),
        status: 'pending',
        amountPaid: 0,
        remainingAmount: initialDebt,
        providerId: newProv.id,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      nextLiabilities = [...nextLiabilities, linkedLiability];
    }

    this.updateState({
      providers: [...this.state().providers, newProv],
      liabilities: nextLiabilities,
    });
    return newProv;
  }

  updateProvider(id: string, partial: Partial<PymeProvider>): void {
    const updated = this.state().providers.map((p) => (p.id === id ? { ...p, ...partial } : p));
    this.updateState({ providers: updated });
  }

  /**
   * Settles partial or full provider payments FIFO across linked unpaid liabilities atomically
   * with a single vault debit and single ledger expense entry.
   */
  payProviderWithVault(providerId: string, amountUsd: number, debitVaultId?: string): void {
    const prov = this.state().providers.find((p) => p.id === providerId);
    if (!prov || !Number.isFinite(amountUsd) || amountUsd <= 0) return;

    const linkedOpenLiabilities = this.state()
      .liabilities.filter((l) => l.providerId === providerId && l.status !== 'paid')
      .sort((a, b) => calendarDaysBetween(b.dueDate, a.dueDate));

    const totalLinkedDebt = roundMoney(
      linkedOpenLiabilities.reduce((sum, l) => sum + l.remainingAmount, 0),
    );
    const effectiveDebt = totalLinkedDebt > 0 ? totalLinkedDebt : prov.outstandingDebtUsd;
    if (effectiveDebt <= 0) return;

    const appliedAmount = roundMoney(Math.min(amountUsd, effectiveDebt));
    const nowIso = new Date().toISOString();

    let remainingToApply = appliedAmount;
    const touchedLiabilityIds: string[] = [];
    const updatedLiabilities = this.state().liabilities.map((l) => {
      if (l.providerId !== providerId || l.status === 'paid' || remainingToApply <= 0) {
        return l;
      }
      const chunk = roundMoney(Math.min(remainingToApply, l.remainingAmount));
      if (chunk <= 0) return l;
      remainingToApply = roundMoney(remainingToApply - chunk);
      touchedLiabilityIds.push(l.id);

      const newPaid = roundMoney(l.amountPaid + chunk);
      const newRem = Math.max(0, roundMoney(l.triMonetary.amount_usd - newPaid));
      return {
        ...l,
        amountPaid: newPaid,
        remainingAmount: newRem,
        status: newRem <= 0 ? ('paid' as const) : ('partially_paid' as const),
        updatedAt: nowIso,
      };
    });

    const updatedDebt =
      linkedOpenLiabilities.length > 0
        ? roundMoney(
            updatedLiabilities
              .filter((l) => l.providerId === providerId && l.status !== 'paid')
              .reduce((sum, l) => sum + l.remainingAmount, 0),
          )
        : Math.max(0, roundMoney(prov.outstandingDebtUsd - appliedAmount));

    const updatedProviders = this.state().providers.map((p) =>
      p.id === providerId ? { ...p, outstandingDebtUsd: updatedDebt } : p,
    );

    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const tri = computeTriMonetaryAmount(appliedAmount, 'USD', bcv, par);
    const resolvedVaultId = this.resolveBusinessOrValidVaultId(debitVaultId);
    const updatedAssets = resolvedVaultId
      ? this.applyVaultDelta(this.state().assets, resolvedVaultId, tri, -1)
      : this.state().assets;
    const vault = resolvedVaultId
      ? updatedAssets.find((v) => v.id === resolvedVaultId)
      : undefined;

    const expenseEntry: ExpenseEntry = {
      id: generateFinanceId('exp-prov'),
      title: `Pago a Proveedor: ${prov.name}`,
      scope: 'business',
      category: 'provider_merchandise',
      channel: vault?.channel ?? 'zelle',
      vaultId: resolvedVaultId,
      liabilityId: touchedLiabilityIds.length === 1 ? touchedLiabilityIds[0] : undefined,
      drawerAllocation: 'drawer_merchandise',
      triMonetary: tri,
      date: todayVetIso(),
      notes: `Rubro: ${prov.category} · Saldo restante: $${updatedDebt.toFixed(2)} USD`,
      createdAt: nowIso,
    };

    this.updateState({
      assets: updatedAssets,
      liabilities: updatedLiabilities,
      providers: updatedProviders,
      expenses: [expenseEntry, ...this.state().expenses],
    });
  }

  /**
   * Simulates the impact of a future BCV exchange rate on VES vaults without coercing zero rates.
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
    const currentBcv = this.currentBcvRate();
    const simBcv = Number.isFinite(simulatedBcvRate) && simulatedBcvRate > 0 ? simulatedBcvRate : 0;
    const vesVaults = this.assets().filter((a) => a.currency === 'VES');
    const vesBalanceTotal = roundMoney(vesVaults.reduce((s, v) => s + v.balance, 0));

    const currentVesInUsd = currentBcv > 0 ? roundMoney(vesBalanceTotal / currentBcv) : 0;
    const simulatedVesInUsd = simBcv > 0 ? roundMoney(vesBalanceTotal / simBcv) : 0;
    const purchasingPowerDeltaUsd =
      currentBcv > 0 && simBcv > 0 ? roundMoney(simulatedVesInUsd - currentVesInUsd) : 0;
    const devaluationPct =
      currentBcv > 0 && simBcv > 0
        ? roundMoney(((simBcv - currentBcv) / currentBcv) * 100, 1)
        : 0;

    const projectedNetWorthUsd = roundMoney(this.netWorthUsd() + purchasingPowerDeltaUsd);
    const projectedNetWorthVes = simBcv > 0 ? roundMoney(projectedNetWorthUsd * simBcv) : 0;

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
    const id = generateFinanceId('inv');
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
   * Returns in-stock items with no rotation for more than `staleDays` days (cold merchandise alert).
   */
  getColdInventoryItems(staleDays = 45, todayIso: string = todayVetIso()): PymeInventoryItem[] {
    return this.state().inventory.filter((item) => {
      if (item.currentStock <= 0) return false;
      const referenceIso = (item.lastSoldAt ?? item.updatedAt).slice(0, 10);
      return calendarDaysBetween(referenceIso, todayIso) > staleDays;
    });
  }

  /**
   * Restocks an inventory item and records either a Vault Expense or ONE linked Provider Credit Liability
   * whose sum drives `provider.outstandingDebtUsd` without double-counting.
   */
  restockInventoryWithAccounting(params: {
    itemId: string;
    quantityToAdd: number;
    paymentMode: 'vault' | 'provider_credit';
    vaultId?: string;
    providerId?: string;
  }): { success: boolean; totalCostUsd: number; newStock: number } {
    const item = this.state().inventory.find((i) => i.id === params.itemId);
    if (!item || !Number.isFinite(params.quantityToAdd) || params.quantityToAdd <= 0) {
      return { success: false, totalCostUsd: 0, newStock: 0 };
    }

    const totalCostUsd = roundMoney(item.unitCostUsd * params.quantityToAdd);
    const newStock = roundMoney(item.currentStock + params.quantityToAdd, 2);
    this.updateInventoryItem(item.id, { currentStock: newStock });

    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const tri = computeTriMonetaryAmount(totalCostUsd, 'USD', bcv, par);
    const today = todayVetIso();

    if (params.paymentMode === 'vault') {
      const targetVaultId = this.resolveBusinessOrValidVaultId(params.vaultId);
      const vault = targetVaultId
        ? this.state().assets.find((v) => v.id === targetVaultId)
        : undefined;
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
      const prov = providers.find((p) => p.id === params.providerId) ?? providers[0];
      const dueIn14Days = addCalendarDays(today, 14);
      const nowIso = new Date().toISOString();

      const newLiability: LiabilityItem = {
        id: generateFinanceId('liab-prov'),
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
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const nextLiabilities = [...this.state().liabilities, newLiability];
      const nextProviders = prov
        ? this.syncProviderDebtFromLiabilities(providers, nextLiabilities, prov.id)
        : providers;

      this.updateState({
        liabilities: nextLiabilities,
        providers: nextProviders,
      });
    }

    return { success: true, totalCostUsd, newStock };
  }

  // -------------------------------------------------------------
  // SUB-MÓDULO 3: PRESUPUESTOS & AUTOMATIZACIÓN AL APROBAR
  // -------------------------------------------------------------

  addQuote(quote: Omit<BudgetQuote, 'id' | 'createdAt'>): BudgetQuote {
    const id = generateFinanceId('quote');
    const newQuote: BudgetQuote = {
      ...quote,
      id,
      version: quote.version ?? 1,
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

  /**
   * Idempotently approves a quote and triggers full Pyme accounting automations:
   * 1. Advance income (only if `minimumAdvanceUsd > 0`) credited to selected/business vault
   * 2. Receivable (CxC) tracking for remaining client balance
   * 3. Inventory stock deduction for matched materials
   * 4. Payroll liability for `laborCostUsd`
   */
  approveQuoteAndTriggerAutomations(quoteId: string, targetVaultId?: string): QuoteApprovalResult {
    const quote = this.state().quotes.find((q) => q.id === quoteId);
    if (!quote) {
      return {
        success: false,
        alreadyApproved: false,
        reason: 'QUOTE_NOT_FOUND',
        receivableUsd: 0,
        deductedInventory: [],
      };
    }

    if (quote.status === 'approved' || quote.status === 'completed') {
      return {
        success: false,
        alreadyApproved: true,
        reason: 'ALREADY_APPROVED',
        advanceIncomeId: quote.advanceIncomeId,
        receivableUsd: Math.max(0, roundMoney(quote.totalPriceUsd - quote.minimumAdvanceUsd)),
        receivableVaultId: quote.receivableVaultId,
        payrollLiabilityId: quote.payrollLiabilityId,
        deductedInventory: [],
      };
    }

    const nowIso = new Date().toISOString();
    const today = todayVetIso();
    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();

    let updatedAssets = [...this.state().assets];
    let updatedIncomes = [...this.state().incomes];
    let updatedLiabilities = [...this.state().liabilities];
    let updatedInventory = [...this.state().inventory];

    // 1. Advance income (only if minimumAdvanceUsd > 0)
    const advanceUsd = Math.max(0, roundMoney(quote.minimumAdvanceUsd));
    let advanceIncomeId: string | undefined;
    if (advanceUsd > 0) {
      const resolvedVaultId = this.resolveBusinessOrValidVaultId(targetVaultId);
      const vault = resolvedVaultId
        ? updatedAssets.find((v) => v.id === resolvedVaultId)
        : undefined;
      const tri = computeTriMonetaryAmount(advanceUsd, 'USD', bcv, par);
      const profile = this.pymeProfile();
      const pctSum =
        profile.defaultDrawer1Percent +
          profile.defaultDrawer2Percent +
          profile.defaultDrawer3Percent || 100;
      const d1 = roundMoney((advanceUsd * profile.defaultDrawer1Percent) / pctSum);
      const d2 = roundMoney((advanceUsd * profile.defaultDrawer2Percent) / pctSum);
      const d3 = roundMoney(advanceUsd - d1 - d2);

      advanceIncomeId = generateFinanceId('inc-quote');
      const advanceIncome: IncomeEntry = {
        id: advanceIncomeId,
        title: `Anticipo Presupuesto ${quote.quoteNumber}: ${quote.description}`,
        scope: 'business',
        category: 'quote_advance',
        channel: vault?.channel ?? 'bs_bank',
        vaultId: resolvedVaultId,
        quoteId: quote.id,
        triMonetary: tri,
        date: today,
        drawerAllocations: { drawer1Usd: d1, drawer2Usd: d2, drawer3Usd: d3 },
        notes: `Cliente: ${quote.clientName} · Anticipo aprobado`,
        createdAt: nowIso,
      };
      updatedIncomes = [advanceIncome, ...updatedIncomes];
      if (resolvedVaultId) {
        updatedAssets = this.applyVaultDelta(updatedAssets, resolvedVaultId, tri, 1);
      }
    }

    // 2. Receivable (CxC) tracking for remaining balance
    const receivableUsd = Math.max(0, roundMoney(quote.totalPriceUsd - advanceUsd));
    let receivableVaultId: string | undefined;
    if (receivableUsd > 0) {
      const existingReceivable = updatedAssets.find(
        (v) => v.channel === 'receivable' && v.scope === 'business',
      );
      if (existingReceivable) {
        receivableVaultId = existingReceivable.id;
        updatedAssets = updatedAssets.map((v) =>
          v.id === existingReceivable.id
            ? { ...v, balance: roundMoney(v.balance + receivableUsd), updatedAt: nowIso }
            : v,
        );
      } else {
        receivableVaultId = generateFinanceId('vault-cxc');
        updatedAssets.push({
          id: receivableVaultId,
          name: 'Cuentas por Cobrar (Clientes)',
          channel: 'receivable',
          scope: 'business',
          currency: 'USD',
          vaultKind: 'asset',
          openingBalance: 0,
          balance: receivableUsd,
          balanceUsdEquivalent: receivableUsd,
          balanceVesEquivalent: bcv > 0 ? roundMoney(receivableUsd * bcv) : 0,
          updatedAt: nowIso,
        });
      }
    }

    // 3. Inventory stock deduction for matched materials
    const materialRequests = new Map<string, number>();
    for (const mat of quote.materials) {
      const key = mat.name.trim().toLowerCase();
      if (key && mat.quantity > 0) {
        materialRequests.set(key, (materialRequests.get(key) ?? 0) + mat.quantity);
      }
    }
    if (materialRequests.size === 0 && quote.lineItems) {
      for (const line of quote.lineItems) {
        if (line.category !== 'material') continue;
        const key = line.name.trim().toLowerCase();
        if (key && line.quantity > 0) {
          materialRequests.set(key, (materialRequests.get(key) ?? 0) + line.quantity);
        }
      }
    }

    const deductedInventory: DeductedInventoryItem[] = [];
    if (materialRequests.size > 0) {
      updatedInventory = updatedInventory.map((inv) => {
        const nameKey = inv.name.trim().toLowerCase();
        const skuKey = (inv.sku ?? '').trim().toLowerCase();
        const qtyToDeduct =
          materialRequests.get(nameKey) ?? (skuKey ? materialRequests.get(skuKey) : undefined);
        if (!qtyToDeduct || qtyToDeduct <= 0) return inv;

        const actualDeducted = Math.min(inv.currentStock, qtyToDeduct);
        const newStock = Math.max(0, roundMoney(inv.currentStock - qtyToDeduct, 2));
        const status: PymeInventoryItem['status'] =
          newStock <= 0 ? 'depleted' : newStock <= inv.minimumStock ? 'low' : 'optimal';

        deductedInventory.push({
          itemId: inv.id,
          name: inv.name,
          quantityDeducted: roundMoney(actualDeducted, 2),
          newStock,
        });

        return {
          ...inv,
          currentStock: newStock,
          status,
          lastSoldAt: nowIso,
          updatedAt: nowIso,
        };
      });
    }

    // 4. Payroll liability for labor cost
    const laborUsd = Math.max(0, roundMoney(quote.laborCostUsd));
    let payrollLiabilityId: string | undefined;
    if (laborUsd > 0) {
      payrollLiabilityId = generateFinanceId('liab-payroll');
      const payrollLiability: LiabilityItem = {
        id: payrollLiabilityId,
        title: `Mano de Obra Presupuesto ${quote.quoteNumber}: ${quote.description}`,
        creditor: 'Nómina / Equipo Técnico',
        scope: 'business',
        category: 'fixed_service',
        triMonetary: computeTriMonetaryAmount(laborUsd, 'USD', bcv, par),
        dueDate: addCalendarDays(today, 14),
        status: 'pending',
        amountPaid: 0,
        remainingAmount: laborUsd,
        quoteId: quote.id,
        notes: `Compromiso de mano de obra generado al aprobar presupuesto #${quote.quoteNumber}`,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      updatedLiabilities = [...updatedLiabilities, payrollLiability];
    }

    const updatedQuotes = this.state().quotes.map((q) =>
      q.id === quoteId
        ? {
            ...q,
            status: 'approved' as const,
            approvedAt: nowIso,
            advanceIncomeId,
            receivableVaultId,
            payrollLiabilityId,
          }
        : q,
    );

    this.updateState({
      assets: updatedAssets,
      incomes: updatedIncomes,
      liabilities: updatedLiabilities,
      inventory: updatedInventory,
      quotes: updatedQuotes,
    });

    return {
      success: true,
      alreadyApproved: false,
      advanceIncomeId,
      receivableUsd,
      receivableVaultId,
      payrollLiabilityId,
      deductedInventory,
    };
  }

  // -------------------------------------------------------------
  // RECURRING RULES ENGINE
  // -------------------------------------------------------------

  addRecurringRule(rule: Omit<RecurringRule, 'id' | 'createdAt'>): RecurringRule {
    const newRule: RecurringRule = {
      ...rule,
      id: generateFinanceId('rec-rule'),
      amount: Math.max(0, roundMoney(rule.amount)),
      createdAt: new Date().toISOString(),
    };
    this.updateState({
      recurringRules: [...(this.state().recurringRules ?? []), newRule],
    });
    return newRule;
  }

  toggleRecurringRule(ruleId: string, active?: boolean): void {
    const updated = (this.state().recurringRules ?? []).map((rule) =>
      rule.id === ruleId
        ? { ...rule, active: active !== undefined ? active : !rule.active }
        : rule,
    );
    this.updateState({ recurringRules: updated });
  }

  deleteRecurringRule(ruleId: string): void {
    const filtered = (this.state().recurringRules ?? []).filter((r) => r.id !== ruleId);
    this.updateState({ recurringRules: filtered });
  }

  /**
   * Materializes all due active recurring rules up to `todayIso` idempotently.
   */
  materializeDueRecurringRules(todayIso: string = todayVetIso()): RecurringMaterializationResult {
    const rules = this.state().recurringRules ?? [];
    if (rules.length === 0) {
      return { materializedCount: 0, createdIds: [] };
    }

    const bcv = this.currentBcvRate();
    const par = this.currentParallelRate();
    const eurUsd = this.currentEurUsdRate() || undefined;
    const createdIds: string[] = [];

    const updatedRules: RecurringRule[] = rules.map((rule) => {
      if (!rule.active || rule.amount <= 0) return rule;

      let cursorDate = rule.nextDueDate;
      let lastMat = rule.lastMaterializedDate;
      let safetyIterations = 0;

      while (calendarDaysBetween(cursorDate, todayIso) >= 0 && safetyIterations < 24) {
        safetyIterations += 1;
        const ref = `REC-${rule.id}-${cursorDate}`;
        const tri = computeTriMonetaryAmount(rule.amount, rule.currency, bcv, par, eurUsd);

        if (!this.isDuplicateReference(ref, rule.vaultId)) {
          if (rule.type === 'income') {
            const inc = this.addIncome({
              title: rule.title,
              scope: rule.scope,
              category: rule.category as IncomeCategory,
              channel: rule.channel,
              vaultId: rule.vaultId,
              triMonetary: tri,
              date: cursorDate,
              referenceNumber: ref,
              notes: rule.notes ?? 'Movimiento recurrente automatizado',
            });
            createdIds.push(inc.id);
          } else if (rule.type === 'expense') {
            const exp = this.addExpense({
              title: rule.title,
              scope: rule.scope,
              category: rule.category as ExpenseCategory,
              channel: rule.channel,
              vaultId: rule.vaultId,
              triMonetary: tri,
              date: cursorDate,
              referenceNumber: ref,
              notes: rule.notes ?? 'Gasto recurrente automatizado',
            });
            createdIds.push(exp.id);
          } else {
            const liab = this.addLiability({
              title: rule.title,
              creditor: rule.title,
              scope: rule.scope,
              category: 'fixed_service',
              triMonetary: tri,
              dueDate: cursorDate,
              status: 'pending',
              amountPaid: 0,
              remainingAmount: tri.amount_usd,
              notes: rule.notes ?? 'Compromiso recurrente automatizado',
            });
            createdIds.push(liab.id);
          }
        }

        lastMat = cursorDate;
        cursorDate = this.advanceRecurringDate(cursorDate, rule.frequency);
      }

      return {
        ...rule,
        nextDueDate: cursorDate,
        lastMaterializedDate: lastMat,
      };
    });

    if (createdIds.length > 0) {
      this.updateState({ recurringRules: updatedRules });
    }

    return {
      materializedCount: createdIds.length,
      createdIds,
    };
  }

  // -------------------------------------------------------------
  // SCHEMA-VALIDATED RESTORE & SQLITE SNAPSHOT BRIDGE (T4)
  // -------------------------------------------------------------

  /**
   * Restores a complete Master Ledger state with strict schema & numeric validation
   * and automatic rollback safety on failure.
   */
  restoreLedgerState(importedLedger: unknown): boolean {
    const validated = this.validateAndNormalizeLedgerState(importedLedger);
    if (!validated) {
      return false;
    }

    const previousSnapshot = this.getSerializableState();
    try {
      this.updateState(validated);
      this.recordAudit('DATA_RESTORE', 'F360_RESTORE_LEDGER', {
        assets: validated.assets.length,
        incomes: validated.incomes.length,
        expenses: validated.expenses.length,
        liabilities: validated.liabilities.length,
        goals: (validated.goals ?? []).length,
      });
      return true;
    } catch {
      this.state.set(previousSnapshot);
      try {
        this.storage.set(FINANCE_360_STORAGE_KEY, previousSnapshot);
      } catch {
        // Ignore storage rollback errors in restricted environments
      }
      return false;
    }
  }

  getSerializableState(): Finance360LedgerState {
    const current = this.state();
    return JSON.parse(JSON.stringify(current)) as Finance360LedgerState;
  }

  applyExternalSnapshot(snapshot: Finance360LedgerState): boolean {
    return this.restoreLedgerState(snapshot);
  }

  // -------------------------------------------------------------
  // INTERNAL ACCOUNTING & VALIDATION HELPERS
  // -------------------------------------------------------------

  private resolveValidVaultId(vaultId?: string): string | undefined {
    if (!vaultId) return undefined;
    return this.state().assets.some((v) => v.id === vaultId) ? vaultId : undefined;
  }

  private resolveBusinessOrValidVaultId(vaultId?: string): string | undefined {
    const direct = this.resolveValidVaultId(vaultId);
    if (direct) return direct;
    const businessVault = this.state().assets.find(
      (v) => v.scope === 'business' && v.channel !== 'receivable',
    );
    return businessVault?.id;
  }

  private computeVaultDeltaInVaultCurrency(vault: AssetVault, tri: TriMonetaryAmount): number {
    if (
      tri.currency === vault.currency ||
      ((tri.currency === 'USD' || tri.currency === 'USDT') &&
        (vault.currency === 'USD' || vault.currency === 'USDT'))
    ) {
      return roundMoney(tri.amount_original);
    }

    const effectiveBcv = tri.bcv_rate > 0 ? tri.bcv_rate : this.currentBcvRate();
    const effectiveEurUsd =
      tri.eur_usd_rate && tri.eur_usd_rate > 0
        ? tri.eur_usd_rate
        : this.currentEurUsdRate() > 0
          ? this.currentEurUsdRate()
          : EUR_FALLBACK_RATE;

    if (vault.currency === 'USD' || vault.currency === 'USDT') {
      return roundMoney(tri.amount_usd);
    }
    if (vault.currency === 'VES') {
      return effectiveBcv > 0 ? roundMoney(tri.amount_usd * effectiveBcv) : 0;
    }
    if (vault.currency === 'EUR') {
      return effectiveEurUsd > 0 ? roundMoney(tri.amount_usd / effectiveEurUsd) : 0;
    }
    return roundMoney(tri.amount_usd);
  }

  private applyVaultDelta(
    assets: AssetVault[],
    vaultId: string,
    tri: TriMonetaryAmount,
    direction: 1 | -1,
  ): AssetVault[] {
    const nowIso = new Date().toISOString();
    return assets.map((v) => {
      if (v.id !== vaultId) return v;
      const delta = this.computeVaultDeltaInVaultCurrency(v, tri);
      return {
        ...v,
        balance: roundMoney(v.balance + direction * delta),
        updatedAt: nowIso,
      };
    });
  }

  private rebuildTriMonetaryPreservingHistory(
    previous: TriMonetaryAmount,
    newAmountUsd: number,
    frozenBcv: number,
    frozenPar: number,
    frozenEurUsd?: number,
  ): TriMonetaryAmount {
    if (previous.currency === 'VES') {
      const nextVes = frozenBcv > 0 ? roundMoney(newAmountUsd * frozenBcv) : previous.amount_ves;
      return computeTriMonetaryAmount(nextVes, 'VES', frozenBcv, frozenPar, frozenEurUsd);
    }
    if (previous.currency === 'EUR') {
      const rateEur = frozenEurUsd && frozenEurUsd > 0 ? frozenEurUsd : EUR_FALLBACK_RATE;
      const nextEur = roundMoney(newAmountUsd / rateEur);
      return computeTriMonetaryAmount(nextEur, 'EUR', frozenBcv, frozenPar, rateEur);
    }
    return computeTriMonetaryAmount(newAmountUsd, previous.currency, frozenBcv, frozenPar, frozenEurUsd);
  }

  private mapVaultEquivalents(assets: AssetVault[], bcv: number, eurUsd: number): AssetVault[] {
    const effectiveEurUsd = eurUsd > 0 ? eurUsd : EUR_FALLBACK_RATE;
    let changed = false;

    const next = assets.map((a) => {
      let usd: number;
      let ves: number;

      if (a.currency === 'VES') {
        usd = bcv > 0 ? roundMoney(a.balance / bcv) : 0;
        ves = roundMoney(a.balance);
      } else if (a.currency === 'EUR') {
        usd = roundMoney(a.balance * effectiveEurUsd);
        ves = bcv > 0 ? roundMoney(usd * bcv) : 0;
      } else {
        usd = roundMoney(a.balance);
        ves = bcv > 0 ? roundMoney(a.balance * bcv) : 0;
      }

      if (a.balanceUsdEquivalent !== usd || a.balanceVesEquivalent !== ves) {
        changed = true;
        return {
          ...a,
          balanceUsdEquivalent: usd,
          balanceVesEquivalent: ves,
        };
      }
      return a;
    });

    return changed ? next : assets;
  }

  private applyCasheaProfilePaymentDelta(
    profile: CasheaUserProfile,
    creditLine: CasheaCreditLine,
    paidAmountUsd: number,
    completedInstallmentsIncrement: number,
  ): CasheaUserProfile {
    const cleanPaid = Math.max(0, roundMoney(paidAmountUsd));
    return {
      ...profile,
      principalUsedUsd:
        creditLine === 'cotidiana'
          ? profile.principalUsedUsd
          : Math.max(0, roundMoney(profile.principalUsedUsd - cleanPaid)),
      cotidianaUsedUsd:
        creditLine === 'cotidiana'
          ? Math.max(0, roundMoney(profile.cotidianaUsedUsd - cleanPaid))
          : profile.cotidianaUsedUsd,
      cumulativeSpentUsd: roundMoney(profile.cumulativeSpentUsd + cleanPaid),
      paidInstallmentsCount: profile.paidInstallmentsCount + completedInstallmentsIncrement,
      updatedAt: new Date().toISOString(),
    };
  }

  private syncProviderDebtFromLiabilities(
    providers: PymeProvider[],
    liabilities: LiabilityItem[],
    providerId: string,
  ): PymeProvider[] {
    const openSum = roundMoney(
      liabilities
        .filter((l) => l.providerId === providerId && l.status !== 'paid')
        .reduce((sum, l) => sum + l.remainingAmount, 0),
    );
    return providers.map((p) => (p.id === providerId ? { ...p, outstandingDebtUsd: openSum } : p));
  }

  private advanceRecurringDate(iso: string, frequency: RecurringRule['frequency']): string {
    if (frequency === 'weekly') return addCalendarDays(iso, 7);
    if (frequency === 'biweekly') return addCalendarDays(iso, 14);
    return addCalendarMonths(iso, 1);
  }

  private doesRecurringRuleCollideWithDate(
    rule: RecurringRule,
    targetDate: string,
    windowDays: number,
  ): boolean {
    let cursor = rule.nextDueDate;
    for (let step = 0; step < 30; step++) {
      const diff = calendarDaysBetween(targetDate, cursor);
      if (Math.abs(diff) <= windowDays) return true;
      if (diff > windowDays) return false;
      cursor = this.advanceRecurringDate(cursor, rule.frequency);
    }
    return false;
  }

  private validateAndNormalizeLedgerState(input: unknown): Finance360LedgerState | null {
    if (!isPlainRecord(input) || !Array.isArray(input['assets'])) {
      return null;
    }

    const arrayKeys = [
      'liabilities',
      'incomes',
      'expenses',
      'casheaPlans',
      'providers',
      'inventory',
      'quotes',
      'goals',
      'transfers',
      'casheaMerchantSales',
      'recurringRules',
      'vaultReconciliations',
    ] as const;

    for (const key of arrayKeys) {
      if (input[key] !== undefined && !Array.isArray(input[key])) {
        return null;
      }
    }

    // Validate assets strictly
    const assets: AssetVault[] = [];
    for (const raw of input['assets']) {
      if (!isPlainRecord(raw)) return null;
      if (typeof raw['id'] !== 'string' || !raw['id'].trim()) return null;
      if (typeof raw['name'] !== 'string') return null;
      if (typeof raw['currency'] !== 'string' || !VALID_CURRENCIES.has(raw['currency'] as CurrencyCode)) {
        return null;
      }
      if (!isFiniteNumber(raw['balance'])) return null;
      if (raw['openingBalance'] !== undefined && !isFiniteNumber(raw['openingBalance'])) return null;
      assets.push(raw as unknown as AssetVault);
    }

    const rawIncomes = (input['incomes'] as unknown[] | undefined) ?? [];
    for (const raw of rawIncomes) {
      if (!isPlainRecord(raw) || typeof raw['id'] !== 'string' || !isPlainRecord(raw['triMonetary'])) {
        return null;
      }
      if (
        !isFiniteNumber(raw['triMonetary']['amount_usd']) ||
        raw['triMonetary']['amount_usd'] < 0 ||
        !isFiniteNumber(raw['triMonetary']['amount_original']) ||
        raw['triMonetary']['amount_original'] < 0
      ) {
        return null;
      }
    }

    const rawExpenses = (input['expenses'] as unknown[] | undefined) ?? [];
    for (const raw of rawExpenses) {
      if (!isPlainRecord(raw) || typeof raw['id'] !== 'string' || !isPlainRecord(raw['triMonetary'])) {
        return null;
      }
      if (
        !isFiniteNumber(raw['triMonetary']['amount_usd']) ||
        raw['triMonetary']['amount_usd'] < 0 ||
        !isFiniteNumber(raw['triMonetary']['amount_original']) ||
        raw['triMonetary']['amount_original'] < 0
      ) {
        return null;
      }
    }

    const rawLiabilities = (input['liabilities'] as unknown[] | undefined) ?? [];
    for (const raw of rawLiabilities) {
      if (!isPlainRecord(raw) || typeof raw['id'] !== 'string') return null;
      if (
        !isFiniteNumber(raw['amountPaid']) ||
        raw['amountPaid'] < 0 ||
        !isFiniteNumber(raw['remainingAmount']) ||
        raw['remainingAmount'] < 0
      ) {
        return null;
      }
    }

    const rawGoals = (input['goals'] as unknown[] | undefined) ?? [];
    for (const raw of rawGoals) {
      if (!isPlainRecord(raw) || typeof raw['id'] !== 'string') return null;
      if (
        !isFiniteNumber(raw['targetAmountUsd']) ||
        raw['targetAmountUsd'] < 0 ||
        !isFiniteNumber(raw['currentAmountUsd']) ||
        raw['currentAmountUsd'] < 0
      ) {
        return null;
      }
    }

    const casheaProfile = isPlainRecord(input['casheaProfile'])
      ? ({ ...createDefaultCasheaProfile(), ...input['casheaProfile'] } as CasheaUserProfile)
      : createDefaultCasheaProfile();

    const pymeProfile = isPlainRecord(input['pymeProfile'])
      ? ({ ...createDefaultPymeProfile(), ...input['pymeProfile'] } as PymeBusinessProfile)
      : createDefaultPymeProfile();

    return {
      version: CURRENT_LEDGER_VERSION,
      assets,
      liabilities: rawLiabilities as LiabilityItem[],
      incomes: rawIncomes as IncomeEntry[],
      expenses: rawExpenses as ExpenseEntry[],
      casheaPlans: ((input['casheaPlans'] as CasheaPlan[] | undefined) ?? []),
      providers: ((input['providers'] as PymeProvider[] | undefined) ?? []),
      inventory: ((input['inventory'] as PymeInventoryItem[] | undefined) ?? []),
      quotes: ((input['quotes'] as BudgetQuote[] | undefined) ?? []),
      goals: rawGoals as WealthGoal[],
      transfers: ((input['transfers'] as TransferEntry[] | undefined) ?? []),
      casheaProfile,
      casheaMerchantSales: ((input['casheaMerchantSales'] as CasheaMerchantSale[] | undefined) ?? []),
      recurringRules: ((input['recurringRules'] as RecurringRule[] | undefined) ?? []),
      pymeProfile,
      vaultReconciliations:
        ((input['vaultReconciliations'] as VaultReconciliationRecord[] | undefined) ?? []),
      lastUpdated:
        typeof input['lastUpdated'] === 'string'
          ? input['lastUpdated']
          : new Date().toISOString(),
    };
  }

  private getElectronFinance360Bridge(): ElectronFinance360Bridge | null {
    if (typeof window === 'undefined') return null;
    const bridge = (window as unknown as { electron?: { finance360?: ElectronFinance360Bridge } })
      ?.electron?.finance360;
    return bridge ?? null;
  }

  private isLedgerNonEmpty(ledger: Finance360LedgerState): boolean {
    return (
      ledger.assets.length > 0 ||
      ledger.incomes.length > 0 ||
      ledger.expenses.length > 0 ||
      ledger.liabilities.length > 0 ||
      ledger.casheaPlans.length > 0 ||
      ledger.providers.length > 0 ||
      ledger.inventory.length > 0 ||
      ledger.quotes.length > 0 ||
      (ledger.goals?.length ?? 0) > 0 ||
      (ledger.transfers?.length ?? 0) > 0 ||
      (ledger.recurringRules?.length ?? 0) > 0 ||
      (ledger.casheaMerchantSales?.length ?? 0) > 0
    );
  }

  private recordAudit(
    category: AuditCategory,
    action: string,
    details?: Record<string, unknown>,
    severity: AuditSeverity = 'info',
  ): void {
    try {
      this.auditLogger?.log(category, action, details, severity);
    } catch {
      // Never block ledger mutations if audit storage fails
    }
  }

  private applyHydratedState(hydrated: Finance360LedgerState): void {
    const bcv = this.currentBcvRate();
    const eurUsd = this.currentEurUsdRate();
    const nextState: Finance360LedgerState = {
      ...hydrated,
      version: CURRENT_LEDGER_VERSION,
      assets: this.mapVaultEquivalents(hydrated.assets, bcv, eurUsd),
    };
    this.state.set(nextState);
    this.storage.set(FINANCE_360_STORAGE_KEY, nextState);
  }

  private async hydrateFromPersistence(): Promise<void> {
    try {
      if (typeof this.storage.whenReady === 'function') {
        await this.storage.whenReady();
      }

      const storedAfterReady = this.storage.get<Finance360LedgerState>(FINANCE_360_STORAGE_KEY);
      const normalizedIdb =
        storedAfterReady &&
        (storedAfterReady.version === 1 || storedAfterReady.version === CURRENT_LEDGER_VERSION)
          ? this.validateAndNormalizeLedgerState(storedAfterReady)
          : null;

      const bridge = this.getElectronFinance360Bridge();
      if (bridge?.getSnapshot) {
        try {
          const rawSqlite = await bridge.getSnapshot();
          const normalizedSqlite = rawSqlite
            ? this.validateAndNormalizeLedgerState(rawSqlite)
            : null;
          if (normalizedSqlite && !this.hasLocalMutations) {
            this.applyHydratedState(normalizedSqlite);
            return;
          }
          if (!normalizedSqlite) {
            const candidate =
              normalizedIdb && this.isLedgerNonEmpty(normalizedIdb)
                ? normalizedIdb
                : this.isLedgerNonEmpty(this.state())
                  ? this.state()
                  : null;
            if (candidate) {
              if (!this.hasLocalMutations && candidate === normalizedIdb) {
                this.applyHydratedState(candidate);
              }
              if (bridge.saveSnapshot) {
                await bridge.saveSnapshot(candidate);
                this.recordAudit('DATA_MUTATION', 'F360_SQLITE_MIGRATED', {
                  assets: candidate.assets.length,
                  incomes: candidate.incomes.length,
                  expenses: candidate.expenses.length,
                });
              }
            }
            return;
          }
        } catch (err) {
          console.warn('[Finance360] Electron SQLite hydration warning:', err);
        }
      }

      if (normalizedIdb && !this.hasLocalMutations && this.isLedgerNonEmpty(normalizedIdb)) {
        this.applyHydratedState(normalizedIdb);
      }
    } finally {
      this.hydrated.set(true);
    }
  }

  private updateState(patch: Partial<Finance360LedgerState>): void {
    this.hasLocalMutations = true;
    const current = this.state();
    const bcv = this.currentBcvRate();
    const eurUsd = this.currentEurUsdRate();
    const nextAssets = patch.assets
      ? this.mapVaultEquivalents(patch.assets, bcv, eurUsd)
      : current.assets;

    const nextState: Finance360LedgerState = {
      ...current,
      ...patch,
      version: CURRENT_LEDGER_VERSION,
      assets: nextAssets,
      lastUpdated: new Date().toISOString(),
    };
    this.state.set(nextState);
    this.storage.set(FINANCE_360_STORAGE_KEY, nextState);

    const bridge = this.getElectronFinance360Bridge();
    if (bridge?.saveSnapshot) {
      void bridge.saveSnapshot(nextState).catch((err) => {
        console.warn('[Finance360] Electron SQLite dual-write warning:', err);
      });
    }
  }

  private loadInitialState(): Finance360LedgerState {
    const saved = this.storage.get<Finance360LedgerState>(FINANCE_360_STORAGE_KEY);
    if (saved && (saved.version === 1 || saved.version === CURRENT_LEDGER_VERSION)) {
      const normalized = this.validateAndNormalizeLedgerState(saved);
      if (normalized) {
        if (saved.version !== CURRENT_LEDGER_VERSION) {
          this.storage.set(FINANCE_360_STORAGE_KEY, normalized);
        }
        return normalized;
      }
    }

    const initial = createEmptyLedgerState();
    this.storage.set(FINANCE_360_STORAGE_KEY, initial);
    return initial;
  }
}
