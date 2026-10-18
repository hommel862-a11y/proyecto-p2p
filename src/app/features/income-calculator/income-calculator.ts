import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  capitalFromDailyIncome,
  toBs,
  clampMoney as sharedClampMoney,
  OPS_KEY,
  DEFAULT_DAYS_PER_YEAR,
  computeArbitrageCycle,
  simulateCompoundGrowth,
  evaluateGoldenSpread,
  auditOperatorPerformance,
  computeFifoAccounting,
  computeDashboard,
  VENEZUELAN_BANK_FEES,
  type BankCode,
  type P2PRole,
  type ArbitrageCycleResult,
  type ReverseGoalResult,
  type CompoundSimulationResult,
  type DailyProjectionPoint,
  type OperatorProfile,
  type TeamAllocationPlan,
  type OperatorAuditResult,
  type GoldenSpreadCheck,
  type MakerMerchantLevel,
  type Operation,
} from '@p2p/core';
import { UiCard } from '../../shared/ui/ui-card';
import { UiPanelHeader } from '../../shared/ui/ui-panel-header';
import { FORMAT_PIPES } from '../../core/format';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { AccountsService } from '../../core/accounts.service';
import { ToastService } from '../../core/toast.service';
import { DecimalPipe, DatePipe } from '@angular/common';
import { StorageService } from '../../core/storage';
import { McpService } from '../../core/mcp.service';
import { Finance360Service } from '../../core/finance-360.service';
import { computeTriMonetaryAmount } from '../../core/models/finance-360.models';

export type CalcViewMode = 'cycle' | 'reverse' | 'compound' | 'team' | 'classic' | 'mcp-portfolio';

/** Local UI-view key (component-scoped), following the app-wide `p2p.*` storage pattern. */
const CALC_UI_KEY = 'p2p.income-calculator.ui';
export const ACTIVE_DAILY_GOAL_KEY = 'p2p.active-daily-goal';
const DAILY_TARGET_LEGACY_KEY = 'p2p.daily-target';
const OPERATOR_SETTLEMENTS_KEY = 'p2p.income-calculator.operator-settlements';

const CALC_MODES: readonly CalcViewMode[] = [
  'cycle',
  'reverse',
  'compound',
  'team',
  'classic',
  'mcp-portfolio',
];
const REINVEST_RATES: readonly number[] = [100, 70, 50, 30, 0];

export interface ActiveDailyGoalState {
  targetGoalUsd: number;
  availableCapitalUsdt: number;
  desiredCyclesPerDay: number;
  requiredSellPriceVes: number;
  requiredNetRoiPct: number;
  updatedAt: string;
}

export interface OperatorSettlementRecord {
  id: string;
  operatorId: string;
  operatorName: string;
  commissionSplitPct: number;
  allocatedCapitalUsdt: number;
  cycles: number;
  amountUsd: number;
  amountVes: number;
  rateAppliedVes: number;
  expenseId: string;
  settledAt: string;
}

interface CalcUiState {
  activeMode: CalcViewMode;
  compoundReinvestmentRate: number;
  merchantLevel?: MakerMerchantLevel;
  devaluationSlippagePct?: number;
  holdHoursInVes?: number;
  teamDeskCapital?: number;
  teamExpectedSpreadPct?: number;
  leaderDailyCycles?: number;
  teamOperators?: OperatorProfile[];
}

export interface EnhancedVelocityRow {
  cyclesPerDay: number;
  label: string;
  linearDailyUsd: number;
  linearDailyVes: number;
  compoundDailyUsd: number;
  compoundRoiDayPct: number;
  weeklyGainUsd: number;
  monthlyGainUsd: number;
  dailyBankVolumeVes: number;
  bankQuotaUsagePct: number;
  quotaStatus: 'SAFE' | 'WARNING' | 'EXCEEDED';
}

export interface ReverseScenarioRow {
  cycles: number;
  label: string;
  requiredCapitalUsdt: number;
  capitalGapUsdt: number;
  requiredSellPriceVes: number;
  requiredNetRoiPct: number;
  dailyBankVolumeVes: number;
  minutesPerCycle: number;
  isFeasibleWithCurrentCapital: boolean;
}

function sanitizeCalcUi(raw: CalcUiState | null): CalcUiState | null {
  if (!raw) return null;
  const activeMode = CALC_MODES.includes(raw.activeMode) ? raw.activeMode : null;
  const compoundReinvestmentRate = REINVEST_RATES.includes(raw.compoundReinvestmentRate)
    ? raw.compoundReinvestmentRate
    : 50;
  if (!activeMode) return null;
  return {
    activeMode,
    compoundReinvestmentRate,
    merchantLevel: raw.merchantLevel ?? 'STANDARD',
    devaluationSlippagePct:
      typeof raw.devaluationSlippagePct === 'number' ? raw.devaluationSlippagePct : 0,
    holdHoursInVes: typeof raw.holdHoursInVes === 'number' ? raw.holdHoursInVes : 2,
    teamDeskCapital: typeof raw.teamDeskCapital === 'number' ? raw.teamDeskCapital : 10000,
    teamExpectedSpreadPct:
      typeof raw.teamExpectedSpreadPct === 'number' ? raw.teamExpectedSpreadPct : 0.9,
    leaderDailyCycles: typeof raw.leaderDailyCycles === 'number' ? raw.leaderDailyCycles : 2.0,
    teamOperators: Array.isArray(raw.teamOperators) && raw.teamOperators.length > 0
      ? raw.teamOperators
      : undefined,
  };
}

/**
 * C2 — Smart P2P Arbitrage, Reverse Engineering & Institutional Capital Calculator.
 */
@Component({
  selector: 'app-income-calculator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, DatePipe, UiCard, UiPanelHeader, ...FORMAT_PIPES],
  templateUrl: './income-calculator.html',
  styleUrl: './income-calculator.scss',
})
export class IncomeCalculator {
  readonly binance = inject(BinanceP2pService);
  readonly accounts = inject(AccountsService);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(StorageService);
  readonly mcpService = inject(McpService);
  readonly finance360 = inject(Finance360Service);

  private readonly restoredUi: CalcUiState | null = sanitizeCalcUi(
    this.storage.get<CalcUiState>(CALC_UI_KEY),
  );

  readonly activeMode = signal<CalcViewMode>(this.restoredUi?.activeMode ?? 'cycle');
  readonly syncingLive = signal<boolean>(false);

  // --- Global Merchant VIP Level ---
  readonly merchantLevel = signal<MakerMerchantLevel>(
    this.restoredUi?.merchantLevel ?? 'STANDARD',
  );

  readonly makerFeeRate = computed<number>(() => {
    switch (this.merchantLevel()) {
      case 'GOLD':
        return 0.00125;
      case 'SILVER':
        return 0.00175;
      case 'BRONZE':
        return 0.002;
      case 'STANDARD':
      default:
        return 0.0025;
    }
  });

  readonly makerFeePct = computed<number>(() => Number((this.makerFeeRate() * 100).toFixed(3)));

  // --- Mode A: Cycle Arbitrage Inputs ---
  readonly capitalUsdt = signal<number>(1000);
  readonly buyPrice = signal<number>(800.0);
  readonly sellPrice = signal<number>(812.5);
  readonly buyRole = signal<P2PRole>('TAKER');
  readonly sellRole = signal<P2PRole>('MAKER');
  readonly sourceBank = signal<BankCode>('BANESCO');
  readonly targetBank = signal<BankCode>('BANESCO');
  readonly isInterbank = signal<boolean>(false);
  readonly extraFixedFeeVes = signal<number>(0);

  // --- VES Intraday / Overnight Devaluation Stress Simulator ---
  readonly devaluationSlippagePct = signal<number>(this.restoredUi?.devaluationSlippagePct ?? 0);
  readonly holdHoursInVes = signal<number>(this.restoredUi?.holdHoursInVes ?? 2);

  // --- Mode B: 3-Way Reverse Goal Planner Inputs & Active Goal Persistence ---
  private readonly savedDailyGoal = this.storage.get<ActiveDailyGoalState>(ACTIVE_DAILY_GOAL_KEY);
  readonly activeDailyGoal = signal<ActiveDailyGoalState | null>(this.savedDailyGoal);

  readonly targetGoalUsd = signal<number>(this.savedDailyGoal?.targetGoalUsd ?? 35);
  readonly availableCapitalGoal = signal<number>(this.savedDailyGoal?.availableCapitalUsdt ?? 1000);
  readonly desiredCyclesPerDay = signal<number>(this.savedDailyGoal?.desiredCyclesPerDay ?? 2);
  readonly operationalShiftHours = signal<number>(8);

  // --- Mode C: Compound Growth Projector Inputs ---
  readonly compoundInitialCapital = signal<number>(5000);
  readonly compoundNetMarginPct = signal<number>(0.95);
  readonly compoundCyclesPerDay = signal<number>(2);
  readonly compoundOperationalDays = signal<number>(90);
  readonly compoundReinvestmentRate = signal<number>(
    this.restoredUi?.compoundReinvestmentRate ?? 50,
  );
  readonly compoundReferenceRate = signal<number>(800.0);

  // --- Mode D: Team Delegation & Scaling ($1,000/day Desk) ---
  readonly teamDeskCapital = signal<number>(this.restoredUi?.teamDeskCapital ?? 10000);
  readonly teamReferenceRate = signal<number>(800.0);
  readonly teamExpectedSpreadPct = signal<number>(this.restoredUi?.teamExpectedSpreadPct ?? 0.9);
  readonly leaderDailyCycles = signal<number>(this.restoredUi?.leaderDailyCycles ?? 2.0);
  readonly teamOperators = signal<OperatorProfile[]>(
    this.restoredUi?.teamOperators ?? [
      {
        id: 'op-william',
        name: 'William (Operador Principal)',
        assignedCapitalUsdt: 5000,
        commissionSplitPct: 30,
        targetDailyCycles: 2.5,
        active: true,
      },
      {
        id: 'op-secondary',
        name: 'Cajero 2 (Banesco / Mercantil)',
        assignedCapitalUsdt: 3000,
        commissionSplitPct: 25,
        targetDailyCycles: 2.0,
        active: true,
      },
    ],
  );
  readonly operatorSettlements = signal<OperatorSettlementRecord[]>(
    this.storage.get<OperatorSettlementRecord[]>(OPERATOR_SETTLEMENTS_KEY) ?? [],
  );

  // --- Mode E: Classic & P2P APR Benchmark Inputs ---
  readonly targetUsd = signal<number>(35);
  readonly aprPct = signal<number>(15);
  readonly daysPerYear = signal<number>(DEFAULT_DAYS_PER_YEAR);
  readonly rate = signal<number>(800);

  // --- Real Treasury & FIFO Snapshot ---
  readonly treasuryTelemetry = computed(() => {
    const summary = this.accounts.treasurySummary();
    const totalDailyLimitVes = summary.accountsUsage.reduce(
      (acc, u) => acc + u.account.dailyLimitVes,
      0,
    );
    const remainingDailyLimitVes = summary.accountsUsage.reduce(
      (acc, u) => acc + Math.max(0, u.remainingLimitVes),
      0,
    );
    const activeAccountsCount = summary.accountsUsage.length;

    const ops = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    let openFifoUsdt = 0;
    let openFifoAvgVes = 0;
    if (ops.length > 0) {
      try {
        const fifo = computeFifoAccounting(ops);
        openFifoUsdt = fifo.openInventoryAmount;
        openFifoAvgVes = fifo.openInventoryAvgPriceVes;
      } catch {
        openFifoUsdt = 0;
      }
    }

    return {
      totalDailyLimitVes: totalDailyLimitVes > 0 ? totalDailyLimitVes : 1_500_000,
      remainingDailyLimitVes: remainingDailyLimitVes > 0 ? remainingDailyLimitVes : 1_500_000,
      hasRealAccounts: activeAccountsCount > 0,
      activeAccountsCount,
      totalBalanceVes: summary.totalBalanceVes,
      openFifoUsdt: Number(openFifoUsdt.toFixed(2)),
      openFifoAvgVes: Number(openFifoAvgVes.toFixed(2)),
    };
  });

  /** Live tracker comparing today's closed P2P operations against the Active Daily Goal. */
  readonly liveDailyGoalTracker = computed(() => {
    const ops = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    const todaySummary = computeDashboard(ops).today;
    const pinned = this.activeDailyGoal();
    const goalUsd = pinned ? pinned.targetGoalUsd : this.targetGoalUsd();
    const targetCycles = pinned ? pinned.desiredCyclesPerDay : this.desiredCyclesPerDay();
    const targetSellVes = pinned ? pinned.requiredSellPriceVes : this.sellPrice();

    const todayPnlUsdt = Number(todaySummary.pnlUsdt.toFixed(2));
    const todayPnlVes = Number(todaySummary.pnlVes.toFixed(2));
    const todayOpsCount = todaySummary.operations;
    const completedCyclesEst = Number((todayOpsCount / 2).toFixed(1));
    const progressPct =
      goalUsd > 0 ? Math.min(100, Math.max(0, Math.round((todayPnlUsdt / goalUsd) * 100))) : 0;
    const remainingUsd = Number(Math.max(0, goalUsd - todayPnlUsdt).toFixed(2));
    const isAchieved = goalUsd > 0 && todayPnlUsdt >= goalUsd;

    return {
      isPinned: pinned !== null,
      goalUsd,
      targetCycles,
      targetSellVes,
      todayPnlUsdt,
      todayPnlVes,
      todayOpsCount,
      completedCyclesEst,
      progressPct,
      remainingUsd,
      isAchieved,
      updatedAt: pinned?.updatedAt ?? null,
    };
  });

  private readonly persistEffect = effect(() => {
    this.storage.set(CALC_UI_KEY, {
      activeMode: this.activeMode(),
      compoundReinvestmentRate: this.compoundReinvestmentRate(),
      merchantLevel: this.merchantLevel(),
      devaluationSlippagePct: this.devaluationSlippagePct(),
      holdHoursInVes: this.holdHoursInVes(),
      teamDeskCapital: this.teamDeskCapital(),
      teamExpectedSpreadPct: this.teamExpectedSpreadPct(),
      leaderDailyCycles: this.leaderDailyCycles(),
      teamOperators: this.teamOperators(),
    });
  });

  constructor() {
    // Auto-hydrate reference rates if Binance P2P depth is already loaded in memory
    const depth = this.binance.marketDepth();
    if (depth && depth.bestBuyPrice > 0 && depth.bestSellPrice > 0) {
      this.buyPrice.set(depth.bestBuyPrice);
      this.sellPrice.set(depth.bestSellPrice);
      this.compoundReferenceRate.set(depth.bestSellPrice);
      this.teamReferenceRate.set(depth.bestSellPrice);
      this.rate.set(depth.bestSellPrice);
    }
  }

  /** Template helper: collapse NaN/empty/negative money entries to 0. */
  clampMoney(v: number): number {
    return sharedClampMoney(v);
  }

  /** Quick role preset switcher for Mode A & Mode B. */
  applyRolePreset(buy: P2PRole, sell: P2PRole): void {
    this.buyRole.set(buy);
    this.sellRole.set(sell);
  }

  /** Calculates and sets the exact sellPrice needed to earn `targetNetRoiPct` over current `buyPrice` + fees. */
  applyQuickNetMarginTarget(targetNetRoiPct: number): void {
    const buy = this.buyPrice();
    if (buy <= 0) return;
    const feeRate = this.makerFeeRate();
    const buyFee = this.buyRole() === 'MAKER' ? feeRate : 0;
    const sellFee = this.sellRole() === 'MAKER' ? feeRate : 0;
    const bankRate = this.isInterbank()
      ? VENEZUELAN_BANK_FEES[this.sourceBank()].transferInterbankFeePct +
        VENEZUELAN_BANK_FEES[this.targetBank()].pagoMovilFeePct
      : 0;
    const totalFrictionPct = (buyFee + sellFee + bankRate) * 100;
    const requiredNominalSpreadPct = totalFrictionPct + targetNetRoiPct;
    const nextSell = Number((buy * (1 + requiredNominalSpreadPct / 100)).toFixed(2));
    this.sellPrice.set(nextSell);
    this.toast.info(
      `Precio de venta ajustado a ${nextSell.toFixed(2)} Bs para lograr +${targetNetRoiPct}% neto.`,
    );
  }

  /** Swap buy and sell prices if user inverted them accidentally. */
  swapBuyAndSellPrices(): void {
    const b = this.buyPrice();
    const s = this.sellPrice();
    this.buyPrice.set(s);
    this.sellPrice.set(b);
  }

  // --- Computed Mode A: Cycle Arbitrage, Break-Even Floor & Velocity ---
  readonly cycleResult = computed<ArbitrageCycleResult | null>(() => {
    try {
      if (this.capitalUsdt() <= 0 || this.buyPrice() <= 0 || this.sellPrice() <= 0) {
        return null;
      }
      const base = computeArbitrageCycle({
        capitalUsdt: this.capitalUsdt(),
        buyPrice: this.buyPrice(),
        sellPrice: this.sellPrice(),
        buyRole: this.buyRole(),
        sellRole: this.sellRole(),
        sourceBank: this.sourceBank(),
        targetBank: this.targetBank(),
        isInterbank: this.isInterbank(),
        makerFeeRate: this.makerFeeRate(),
      });
      const extraVes = this.extraFixedFeeVes();
      if (extraVes <= 0) return base;

      const bankFeesVes = base.bankFeesVes + extraVes;
      const netProceedsVes = base.grossProceedsVes - bankFeesVes;
      const netGainVes = netProceedsVes - base.capitalVesInvested;
      const netGainUsd = netGainVes / this.sellPrice();
      const roiCyclePct = (netGainVes / base.capitalVesInvested) * 100;
      const effectiveFeeDragPct = base.spreadNominalPct - roiCyclePct;

      return {
        ...base,
        bankFeesVes,
        netProceedsVes,
        netGainVes,
        netGainUsd,
        roiCyclePct,
        effectiveFeeDragPct,
      };
    } catch {
      return null;
    }
  });

  /** Exact minimum sell price in Bs where cycle PnL = $0 after VIP Maker/Taker & Bank fees. */
  readonly cycleBreakEvenSellPrice = computed<number>(() => {
    const buy = this.buyPrice();
    const cap = this.capitalUsdt();
    if (buy <= 0 || cap <= 0) return 0;
    const feeRate = this.makerFeeRate();
    const buyFee = this.buyRole() === 'MAKER' ? feeRate : 0;
    const sellFee = this.sellRole() === 'MAKER' ? feeRate : 0;
    const srcBankFee = this.isInterbank()
      ? VENEZUELAN_BANK_FEES[this.sourceBank()].transferInterbankFeePct
      : 0;
    const tgtBankFee = this.isInterbank()
      ? VENEZUELAN_BANK_FEES[this.targetBank()].pagoMovilFeePct
      : 0;

    const netCryptoSold = cap * (1 - buyFee) * (1 - sellFee);
    if (netCryptoSold <= 0) return 0;
    const totalCostVes = cap * buy * (1 + srcBankFee) + this.extraFixedFeeVes();
    const breakEvenSell = totalCostVes / (netCryptoSold * (1 - tgtBankFee));
    return Number(breakEvenSell.toFixed(2));
  });

  readonly cycleGoldenVerdict = computed<GoldenSpreadCheck | null>(() => {
    const c = this.cycleResult();
    if (!c) return null;
    return evaluateGoldenSpread(c.roiCyclePct);
  });

  /**
   * Simulates the real purchasing-power impact (in USDT) if the Bolívar (VES) devalues
   * by `devaluationSlippagePct`% while the operator holds VES waiting to repurchase USDT.
   */
  readonly devaluationStressMetrics = computed(() => {
    const c = this.cycleResult();
    const buy = this.buyPrice();
    const sell = this.sellPrice();
    if (!c || buy <= 0 || sell <= 0 || c.capitalUsdt <= 0) return null;

    const devalPct = Math.max(0, this.devaluationSlippagePct());
    const nextRepurchaseRateVes = Number((buy * (1 + devalPct / 100)).toFixed(2));
    const usdtRepurchasedAfterDeval =
      nextRepurchaseRateVes > 0 ? c.netProceedsVes / nextRepurchaseRateVes : 0;
    const realNetGainUsdt = Number((usdtRepurchasedAfterDeval - c.capitalUsdt).toFixed(2));
    const realRoiAfterDevalPct = Number(((realNetGainUsdt / c.capitalUsdt) * 100).toFixed(2));
    const erodedUsdt = Number(Math.max(0, c.netGainUsd - realNetGainUsdt).toFixed(2));

    // Exact % rise in buyPrice that wipes out 100% of the cycle's net gain (PnL = 0 USDT)
    const maxDevalTolerancePct =
      c.capitalVesInvested > 0
        ? Number(Math.max(0, (c.netProceedsVes / c.capitalVesInvested - 1) * 100).toFixed(2))
        : 0;

    // Protected sell price needed to preserve the target margin against expected devaluation
    const baseTargetSell =
      this.activeMode() === 'reverse'
        ? (this.reverseSolverMatrix()?.requiredSellPriceVes ?? sell)
        : sell;
    const devalProtectedSellPriceVes = Number((baseTargetSell * (1 + devalPct / 100)).toFixed(2));

    const status: 'SAFE' | 'ERODED' | 'LOSS' =
      realRoiAfterDevalPct >= 0.5 ? 'SAFE' : realRoiAfterDevalPct > 0 ? 'ERODED' : 'LOSS';

    return {
      devalPct,
      holdHours: this.holdHoursInVes(),
      nextRepurchaseRateVes,
      usdtRepurchasedAfterDeval: Number(usdtRepurchasedAfterDeval.toFixed(2)),
      realNetGainUsdt,
      realRoiAfterDevalPct,
      erodedUsdt,
      maxDevalTolerancePct,
      devalProtectedSellPriceVes,
      status,
    };
  });

  readonly velocityProjections = computed<EnhancedVelocityRow[]>(() => {
    const cycle = this.cycleResult();
    if (!cycle) return [];
    const dailyLimitVes = this.treasuryTelemetry().totalDailyLimitVes;
    const marginFrac = cycle.roiCyclePct / 100;
    const rates: { cycles: number; label: string }[] = [
      { cycles: 1, label: 'Conservador' },
      { cycles: 2, label: 'Estándar' },
      { cycles: 3, label: 'Activo' },
      { cycles: 5, label: 'Alta Rotación' },
      { cycles: 8, label: 'Intensivo' },
      { cycles: 10, label: 'Desk Pro' },
    ];

    return rates.map(({ cycles, label }) => {
      const linearDailyUsd = cycle.netGainUsd * cycles;
      const linearDailyVes = cycle.netGainVes * cycles;
      const compoundFactor = marginFrac > -0.99 ? Math.pow(1 + marginFrac, cycles) - 1 : 0;
      const compoundDailyUsd = cycle.capitalUsdt * compoundFactor;
      const compoundRoiDayPct = compoundFactor * 100;
      const dailyBankVolumeVes = (cycle.capitalVesInvested + cycle.netProceedsVes) * cycles;
      const bankQuotaUsagePct =
        dailyLimitVes > 0 ? Number(((dailyBankVolumeVes / dailyLimitVes) * 100).toFixed(1)) : 0;
      const quotaStatus: 'SAFE' | 'WARNING' | 'EXCEEDED' =
        bankQuotaUsagePct > 100 ? 'EXCEEDED' : bankQuotaUsagePct >= 75 ? 'WARNING' : 'SAFE';

      return {
        cyclesPerDay: cycles,
        label,
        linearDailyUsd,
        linearDailyVes,
        compoundDailyUsd,
        compoundRoiDayPct,
        weeklyGainUsd: linearDailyUsd * 7,
        monthlyGainUsd: linearDailyUsd * 30,
        dailyBankVolumeVes,
        bankQuotaUsagePct,
        quotaStatus,
      };
    });
  });

  // --- Computed Mode B: 3-Way Reverse Goal Engineering ---
  readonly reverseGoalResult = computed<ReverseGoalResult | null>(() => {
    try {
      const targetUsd = this.targetGoalUsd();
      const availCap = this.availableCapitalGoal();
      const buy = this.buyPrice();
      const sell = this.sellPrice();
      if (targetUsd <= 0 || availCap <= 0 || buy <= 0 || sell <= 0) {
        return null;
      }

      const cycle = computeArbitrageCycle({
        capitalUsdt: availCap,
        buyPrice: buy,
        sellPrice: sell,
        buyRole: this.buyRole(),
        sellRole: this.sellRole(),
        sourceBank: this.sourceBank(),
        targetBank: this.targetBank(),
        isInterbank: this.isInterbank(),
        makerFeeRate: this.makerFeeRate(),
      });

      const netGainPerCycleUsd = cycle.netGainUsd;
      const roiCyclePct = cycle.roiCyclePct;

      if (netGainPerCycleUsd <= 0) {
        return {
          dailyTargetUsd: targetUsd,
          availableCapitalUsdt: availCap,
          netGainPerCycleUsd: 0,
          roiCyclePct: Number(roiCyclePct.toFixed(2)),
          requiredCycles: Infinity,
          totalDailyBankVolumeVes: 0,
          isFeasible: false,
          warning:
            'El diferencial actual genera pérdida o ganancia nula tras descontar comisiones VIP y bancarias. Ajusta tu precio de venta por encima del piso de equilibrio.',
        };
      }

      const rawCycles = targetUsd / netGainPerCycleUsd;
      const requiredCycles = Math.ceil(rawCycles);
      const totalDailyBankVolumeVes =
        (cycle.capitalVesInvested + cycle.netProceedsVes) * requiredCycles;
      const isFeasible = requiredCycles <= 10;

      let warning: string | undefined;
      if (requiredCycles > 10) {
        warning = `Requiere ${requiredCycles} vueltas completas al día (${rawCycles.toFixed(2)} exactas). Con este capital y spread quemarás tus cupos bancarios antes de lograr la meta.`;
      } else if (requiredCycles > 5) {
        warning = `Requiere ${requiredCycles} vueltas al día (${rawCycles.toFixed(2)} exactas). Exige alta rotación o ampliar capital por lote.`;
      }

      return {
        dailyTargetUsd: targetUsd,
        availableCapitalUsdt: availCap,
        netGainPerCycleUsd: Number(netGainPerCycleUsd.toFixed(2)),
        roiCyclePct: Number(roiCyclePct.toFixed(2)),
        requiredCycles,
        totalDailyBankVolumeVes: Number(totalDailyBankVolumeVes.toFixed(2)),
        isFeasible,
        warning,
      };
    } catch {
      return null;
    }
  });

  /**
   * 3-Way Reverse Engineering Matrix:
   * 1. Exact cycles & cadence with current capital & spread
   * 2. Required capital (USDT) to hit daily target in `desiredCyclesPerDay`
   * 3. Required sell price (Bs) & net ROI % to hit daily target with current capital in `desiredCyclesPerDay`
   */
  readonly reverseSolverMatrix = computed(() => {
    const targetUsd = this.targetGoalUsd();
    const availCap = this.availableCapitalGoal();
    const desiredCycles = Math.max(1, this.desiredCyclesPerDay());
    const shiftHours = Math.max(1, this.operationalShiftHours());
    const buy = this.buyPrice();
    const sell = this.sellPrice();
    if (targetUsd <= 0 || availCap <= 0 || buy <= 0 || sell <= 0) return null;

    const unitCycle = computeArbitrageCycle({
      capitalUsdt: availCap,
      buyPrice: buy,
      sellPrice: sell,
      buyRole: this.buyRole(),
      sellRole: this.sellRole(),
      sourceBank: this.sourceBank(),
      targetBank: this.targetBank(),
      isInterbank: this.isInterbank(),
      makerFeeRate: this.makerFeeRate(),
    });

    const roiDecimal = unitCycle.roiCyclePct / 100;
    const exactCycles =
      unitCycle.netGainUsd > 0 ? Number((targetUsd / unitCycle.netGainUsd).toFixed(2)) : Infinity;
    const minutesPerCycle =
      Number.isFinite(exactCycles) && exactCycles > 0
        ? Math.round((shiftHours * 60) / exactCycles)
        : 0;
    const usdtVolumePerHour =
      Number.isFinite(exactCycles) && exactCycles > 0
        ? Number(((availCap * exactCycles) / shiftHours).toFixed(2))
        : 0;

    // Path 2: Capital needed for `desiredCycles` at current spread
    const requiredCapitalForDesiredCyclesUsdt =
      roiDecimal > 0 ? Number((targetUsd / (roiDecimal * desiredCycles)).toFixed(2)) : Infinity;
    const capitalGapUsdt = Number.isFinite(requiredCapitalForDesiredCyclesUsdt)
      ? Number(Math.max(0, requiredCapitalForDesiredCyclesUsdt - availCap).toFixed(2))
      : Infinity;

    // Path 3: Sell Price & Net ROI needed with current `availCap` in `desiredCycles`
    const requiredGainPerCycleUsd = targetUsd / desiredCycles;
    const requiredNetRoiPerCyclePct = Number(((requiredGainPerCycleUsd / availCap) * 100).toFixed(2));

    const feeRate = this.makerFeeRate();
    const buyFee = this.buyRole() === 'MAKER' ? feeRate : 0;
    const sellFee = this.sellRole() === 'MAKER' ? feeRate : 0;
    const bankRate = this.isInterbank()
      ? VENEZUELAN_BANK_FEES[this.sourceBank()].transferInterbankFeePct +
        VENEZUELAN_BANK_FEES[this.targetBank()].pagoMovilFeePct
      : 0;
    const totalFrictionPct = (buyFee + sellFee + bankRate) * 100;
    const requiredNominalSpreadPct = Number(
      (totalFrictionPct + requiredNetRoiPerCyclePct).toFixed(2),
    );
    const requiredSellPriceVes = Number((buy * (1 + requiredNominalSpreadPct / 100)).toFixed(2));

    // Banking capacity check
    const dailyBankLimitVes = this.treasuryTelemetry().totalDailyLimitVes;
    const exactDailyBankVolVes = Number.isFinite(exactCycles)
      ? (unitCycle.capitalVesInvested + unitCycle.netProceedsVes) * Math.ceil(exactCycles)
      : 0;
    const bankAccountsNeeded =
      dailyBankLimitVes > 0 ? Math.max(1, Math.ceil(exactDailyBankVolVes / dailyBankLimitVes)) : 1;
    const bankUsagePct =
      dailyBankLimitVes > 0 ? Number(((exactDailyBankVolVes / dailyBankLimitVes) * 100).toFixed(1)) : 0;

    return {
      exactCycles,
      minutesPerCycle,
      usdtVolumePerHour,
      requiredCapitalForDesiredCyclesUsdt,
      capitalGapUsdt,
      requiredNetRoiPerCyclePct,
      requiredNominalSpreadPct,
      requiredSellPriceVes,
      exactDailyBankVolVes,
      bankAccountsNeeded,
      bankUsagePct,
      breakEvenSellPrice: this.cycleBreakEvenSellPrice(),
    };
  });

  readonly reverseCycleScenarios = computed<ReverseScenarioRow[]>(() => {
    const targetUsd = this.targetGoalUsd();
    const availCap = this.availableCapitalGoal();
    const shiftHours = Math.max(1, this.operationalShiftHours());
    const buy = this.buyPrice();
    const sell = this.sellPrice();
    if (targetUsd <= 0 || availCap <= 0 || buy <= 0 || sell <= 0) return [];

    const unitCycle = computeArbitrageCycle({
      capitalUsdt: availCap,
      buyPrice: buy,
      sellPrice: sell,
      buyRole: this.buyRole(),
      sellRole: this.sellRole(),
      sourceBank: this.sourceBank(),
      targetBank: this.targetBank(),
      isInterbank: this.isInterbank(),
      makerFeeRate: this.makerFeeRate(),
    });
    const roiDecimal = unitCycle.roiCyclePct / 100;

    const feeRate = this.makerFeeRate();
    const buyFee = this.buyRole() === 'MAKER' ? feeRate : 0;
    const sellFee = this.sellRole() === 'MAKER' ? feeRate : 0;
    const bankRate = this.isInterbank()
      ? VENEZUELAN_BANK_FEES[this.sourceBank()].transferInterbankFeePct +
        VENEZUELAN_BANK_FEES[this.targetBank()].pagoMovilFeePct
      : 0;
    const totalFrictionPct = (buyFee + sellFee + bankRate) * 100;

    const steps = [
      { cycles: 1, label: '1 vuelta (Relajado)' },
      { cycles: 2, label: '2 vueltas (Óptimo)' },
      { cycles: 3, label: '3 vueltas (Estándar)' },
      { cycles: 5, label: '5 vueltas (Intenso)' },
      { cycles: 8, label: '8 vueltas (Turbo Desk)' },
    ];

    return steps.map(({ cycles, label }) => {
      const reqCap = roiDecimal > 0 ? Number((targetUsd / (roiDecimal * cycles)).toFixed(2)) : 0;
      const gap = reqCap > 0 ? Number(Math.max(0, reqCap - availCap).toFixed(2)) : 0;
      const reqNetRoiPct = Number(((targetUsd / cycles / availCap) * 100).toFixed(2));
      const reqSellPrice = Number(
        (buy * (1 + (totalFrictionPct + reqNetRoiPct) / 100)).toFixed(2),
      );
      const dailyBankVol = reqCap > 0 ? reqCap * (buy + sell) * cycles : availCap * (buy + reqSellPrice) * cycles;
      const minutesPerCycle = Math.round((shiftHours * 60) / cycles);

      return {
        cycles,
        label,
        requiredCapitalUsdt: reqCap,
        capitalGapUsdt: gap,
        requiredSellPriceVes: reqSellPrice,
        requiredNetRoiPct: reqNetRoiPct,
        dailyBankVolumeVes: dailyBankVol,
        minutesPerCycle,
        isFeasibleWithCurrentCapital: reqCap > 0 && reqCap <= availCap,
      };
    });
  });

  // --- Computed Mode C: Compound Growth Projector ---
  readonly compoundResult = computed<CompoundSimulationResult | null>(() => {
    try {
      if (
        this.compoundInitialCapital() <= 0 ||
        this.compoundNetMarginPct() <= 0 ||
        this.compoundCyclesPerDay() <= 0 ||
        this.compoundOperationalDays() <= 0
      ) {
        return null;
      }

      const dailyBankLimitVes = this.treasuryTelemetry().totalDailyLimitVes;

      return simulateCompoundGrowth({
        initialCapitalUsdt: this.compoundInitialCapital(),
        netMarginPctPerCycle: this.compoundNetMarginPct(),
        cyclesPerDay: this.compoundCyclesPerDay(),
        operationalDays: this.compoundOperationalDays(),
        reinvestmentRatePct: this.compoundReinvestmentRate(),
        dailyBankLimitVes,
        referenceRateVes: this.compoundReferenceRate(),
      });
    } catch {
      return null;
    }
  });

  /** Filtered milestone schedule rows from `compoundResult().dailyProjection` for visual table. */
  readonly compoundScheduleRows = computed<DailyProjectionPoint[]>(() => {
    const comp = this.compoundResult();
    if (!comp || comp.dailyProjection.length === 0) return [];
    const targetDays = new Set<number>([1, 7, 15, 30, 45, 60, 75, 90, 120, 150, 180]);
    targetDays.add(comp.dailyProjection.length);
    if (comp.bankingWallAlert) {
      targetDays.add(comp.bankingWallAlert.firstDayExceeded);
    }
    return comp.dailyProjection.filter((pt) => targetDays.has(pt.day));
  });

  // --- Computed Mode D: Team Allocation Plan ($1,000/day Desk) ---
  readonly teamPlan = computed<TeamAllocationPlan | null>(() => {
    try {
      const safeTotalCapital = Math.max(0, this.teamDeskCapital());
      if (safeTotalCapital <= 0) return null;
      const referenceRateVes = this.teamReferenceRate() || 800;
      const expectedAvgCycleSpreadPct = this.teamExpectedSpreadPct();
      const activeOperators = this.teamOperators().filter((op) => op.active);

      let totalAllocatedToOperators = 0;
      const allocations: TeamAllocationPlan['operatorsAllocations'] = [];

      for (const op of activeOperators) {
        const allocatedCapital = Math.min(
          Math.max(0, op.assignedCapitalUsdt),
          Math.max(0, safeTotalCapital - totalAllocatedToOperators),
        );
        totalAllocatedToOperators += allocatedCapital;

        const dailyCycleProfitPerCycle = allocatedCapital * (expectedAvgCycleSpreadPct / 100);
        const totalDailyProfit = dailyCycleProfitPerCycle * Math.max(0.5, op.targetDailyCycles);
        const opShare = totalDailyProfit * (op.commissionSplitPct / 100);
        const ownerShare = totalDailyProfit - opShare;

        allocations.push({
          operator: op,
          allocatedCapitalUsdt: Number(allocatedCapital.toFixed(2)),
          allocatedCapitalVes: Number((allocatedCapital * referenceRateVes).toFixed(2)),
          targetDailyProfitUsdt: Number(totalDailyProfit.toFixed(2)),
          operatorDailyTakeUsdt: Number(opShare.toFixed(2)),
          ownerDailyTakeUsdt: Number(ownerShare.toFixed(2)),
        });
      }

      const deskOwnerRetainedCapitalUsdt = Math.max(0, safeTotalCapital - totalAllocatedToOperators);
      const leaderCycles = Math.max(0, this.leaderDailyCycles());
      const leaderRetainedProfitUsdt =
        deskOwnerRetainedCapitalUsdt * (expectedAvgCycleSpreadPct / 100) * leaderCycles;

      const operatorsDailyProfitSum = allocations.reduce((acc, a) => acc + a.targetDailyProfitUsdt, 0);
      const operatorsTakeSum = allocations.reduce((acc, a) => acc + a.operatorDailyTakeUsdt, 0);
      const ownerFromOperatorsSum = allocations.reduce((acc, a) => acc + a.ownerDailyTakeUsdt, 0);

      const totalDailyEstimatedProfitUsdt = Number(
        (leaderRetainedProfitUsdt + operatorsDailyProfitSum).toFixed(2),
      );
      const totalDailyOwnerProfitUsdt = Number(
        (leaderRetainedProfitUsdt + ownerFromOperatorsSum).toFixed(2),
      );
      const totalDailyOperatorsProfitUsdt = Number(operatorsTakeSum.toFixed(2));

      return {
        totalDeskCapitalUsdt: safeTotalCapital,
        referenceRateVes,
        deskOwnerRetainedCapitalUsdt: Number(deskOwnerRetainedCapitalUsdt.toFixed(2)),
        operatorsAllocations: allocations,
        totalDailyEstimatedProfitUsdt,
        totalDailyOwnerProfitUsdt,
        totalDailyOperatorsProfitUsdt,
        monthlyProjectedDeskProfitUsdt: Number((totalDailyOwnerProfitUsdt * 30).toFixed(2)),
      };
    } catch {
      return null;
    }
  });

  readonly operatorAudits = computed<OperatorAuditResult[]>(() => {
    const ops = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    const refRate = this.teamReferenceRate();
    return this.teamOperators().map((op) => {
      const opOps = ops.filter(
        (o) =>
          (o.merchantNote && o.merchantNote.toLowerCase().includes(op.name.toLowerCase())) ||
          (o.notes && o.notes.toLowerCase().includes(op.name.toLowerCase())),
      );
      const targetOps = opOps.length > 0 ? opOps : op.id === 'op-william' ? ops.slice(0, 10) : [];
      return auditOperatorPerformance(op, targetOps, refRate, 10);
    });
  });

  // --- Team Roster Actions ---
  addTeamOperator(): void {
    const idx = this.teamOperators().length + 1;
    this.teamOperators.update((list) => [
      ...list,
      {
        id: `op-${Date.now()}`,
        name: `Cajero ${idx} (Multibanco)`,
        assignedCapitalUsdt: 1500,
        commissionSplitPct: 25,
        targetDailyCycles: 2,
        active: true,
      },
    ]);
  }

  removeTeamOperator(id: string): void {
    if (this.teamOperators().length <= 1) return;
    this.teamOperators.update((list) => list.filter((op) => op.id !== id));
  }

  updateTeamOperator(
    id: string,
    field: 'name' | 'assignedCapitalUsdt' | 'commissionSplitPct' | 'targetDailyCycles' | 'active',
    value: string | number | boolean,
  ): void {
    this.teamOperators.update((list) =>
      list.map((op) => {
        if (op.id !== id) return op;
        if (field === 'name') return { ...op, name: String(value) };
        if (field === 'active') return { ...op, active: Boolean(value) };
        const num = Math.max(0, Number(value) || 0);
        if (field === 'commissionSplitPct') {
          return { ...op, commissionSplitPct: Math.min(90, num) };
        }
        return { ...op, [field]: num };
      }),
    );
  }

  /**
   * Settles a single operator's daily commission directly into Finance 360 (Pyme Drawer 2: Operations & Payroll)
   * and records an immutable audit receipt in `p2p.income-calculator.operator-settlements`.
   */
  settleOperatorCommission(
    alloc: TeamAllocationPlan['operatorsAllocations'][0],
    silentToast = false,
  ): boolean {
    if (!alloc || alloc.operatorDailyTakeUsdt <= 0) {
      if (!silentToast) {
        this.toast.warn('La comisión a liquidar debe ser mayor a $0.00 USDT.');
      }
      return false;
    }

    const bcv = this.finance360.currentBcvRate();
    const par = this.teamReferenceRate() > 0 ? this.teamReferenceRate() : this.finance360.currentParallelRate();
    const amountUsd = Number(alloc.operatorDailyTakeUsdt.toFixed(2));
    const amountVes = Number((amountUsd * par).toFixed(2));
    const today = new Date().toISOString().split('T')[0];

    const expenseEntry = this.finance360.addExpense({
      title: `Comisión Cajero P2P: ${alloc.operator.name}`,
      scope: 'business',
      category: 'payroll',
      channel: 'crypto',
      vaultId: 'vault-pyme-caja',
      drawerAllocation: 'drawer_operations',
      triMonetary: computeTriMonetaryAmount(amountUsd, 'USD', bcv, par),
      date: today,
      notes: `Split ${alloc.operator.commissionSplitPct}% · Capital operado: $${alloc.allocatedCapitalUsdt} USDT (${alloc.operator.targetDailyCycles} vueltas/día)`,
    });

    const record: OperatorSettlementRecord = {
      id: `settle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      operatorId: alloc.operator.id,
      operatorName: alloc.operator.name,
      commissionSplitPct: alloc.operator.commissionSplitPct,
      allocatedCapitalUsdt: alloc.allocatedCapitalUsdt,
      cycles: alloc.operator.targetDailyCycles,
      amountUsd,
      amountVes,
      rateAppliedVes: par,
      expenseId: expenseEntry.id,
      settledAt: new Date().toISOString(),
    };

    const nextList = [record, ...this.operatorSettlements()].slice(0, 30);
    this.operatorSettlements.set(nextList);
    this.storage.set(OPERATOR_SETTLEMENTS_KEY, nextList);

    if (!silentToast) {
      this.toast.success(
        `Comisión de ${alloc.operator.name} ($${amountUsd.toFixed(2)} USD / ${amountVes.toLocaleString('es-VE')} Bs) imputada a Gaveta 2 (Nómina Pyme).`,
      );
    }
    return true;
  }

  /** Settles commissions for all active operators in the Desk in a single batch. */
  settleAllOperatorsCommissions(): void {
    const plan = this.teamPlan();
    if (!plan || plan.operatorsAllocations.length === 0) return;

    let count = 0;
    let totalUsd = 0;
    for (const alloc of plan.operatorsAllocations) {
      if (alloc.operatorDailyTakeUsdt > 0 && this.settleOperatorCommission(alloc, true)) {
        count++;
        totalUsd += alloc.operatorDailyTakeUsdt;
      }
    }

    if (count > 0) {
      this.toast.success(
        `Liquidación masiva completada: ${count} cajero(s) por $${totalUsd.toFixed(2)} USD registrados en Finanzas 360° (Gaveta 2 Operación/Nómina).`,
      );
    } else {
      this.toast.info('No hay comisiones pendientes mayores a $0 para liquidar.');
    }
  }

  /** Reverses a commission settlement and removes its corresponding expense from Finance 360. */
  revertOperatorSettlement(recordId: string): void {
    const target = this.operatorSettlements().find((r) => r.id === recordId);
    if (!target) return;

    this.finance360.deleteMovement(target.expenseId, 'expense');
    const nextList = this.operatorSettlements().filter((r) => r.id !== recordId);
    this.operatorSettlements.set(nextList);
    this.storage.set(OPERATOR_SETTLEMENTS_KEY, nextList);
    this.toast.info(`Liquidación de ${target.operatorName} ($${target.amountUsd.toFixed(2)}) revertida de Finanzas 360°.`);
  }

  // --- Computed Mode E: Classic & P2P APR Benchmark Results ---
  readonly bands = [10, 20, 120, 240, 365] as const;
  readonly targets = [15, 35, 50, 100, 250] as const;

  readonly result = computed(() => {
    try {
      return capitalFromDailyIncome(this.targetUsd(), this.aprPct() / 100, this.daysPerYear());
    } catch {
      return null;
    }
  });

  readonly annual = computed(() => this.result()?.annual ?? 0);
  readonly capital = computed(() => this.result()?.capital ?? 0);

  readonly capitalBs = computed(() => {
    const r = this.result();
    if (!r) return 0;
    try {
      return toBs(r.capital, this.rate());
    } catch {
      return 0;
    }
  });

  /** Compare Passive APR Required Capital vs Active P2P Capital (using Mode A net ROI * 2 cycles/day). */
  readonly activeP2pComparison = computed(() => {
    const target = this.targetUsd();
    const cycleRoiPct = this.cycleResult()?.roiCyclePct ?? 0.9;
    const effectiveDailyRoiFrac = Math.max(0.002, (cycleRoiPct / 100) * 2); // 2 cycles/day
    const p2pCapitalNeeded = Number((target / effectiveDailyRoiFrac).toFixed(2));
    const passiveCapitalNeeded = this.capital();
    const capitalSavedMultiplier =
      p2pCapitalNeeded > 0 ? Number((passiveCapitalNeeded / p2pCapitalNeeded).toFixed(1)) : 1;

    return {
      p2pCapitalNeeded,
      effectiveDailyRoiPct: Number((effectiveDailyRoiFrac * 100).toFixed(2)),
      effectiveAnnualizedAprPct: Number((effectiveDailyRoiFrac * this.daysPerYear() * 100).toFixed(0)),
      capitalSavedMultiplier,
    };
  });

  readonly table = computed(() =>
    this.targets.map((target) => ({
      target,
      cells: this.bands.map((band) => {
        try {
          return capitalFromDailyIncome(target, band / 100, this.daysPerYear()).capital;
        } catch {
          return 0;
        }
      }),
    })),
  );

  // ─── Cross-Tab Bridges, Devaluation Shield & Active Daily Goal Pinning ───
  applyDevalProtectedSellPrice(): void {
    const stress = this.devaluationStressMetrics();
    if (!stress || stress.devalProtectedSellPriceVes <= 0) return;
    this.sellPrice.set(stress.devalProtectedSellPriceVes);
    this.toast.success(
      `Precio de venta blindado a ${stress.devalProtectedSellPriceVes.toFixed(2)} Bs contra una devaluación intradía de +${stress.devalPct}%.`,
    );
  }

  pinActiveDailyGoal(): void {
    const solver = this.reverseSolverMatrix();
    const nextGoal: ActiveDailyGoalState = {
      targetGoalUsd: this.targetGoalUsd(),
      availableCapitalUsdt: this.availableCapitalGoal(),
      desiredCyclesPerDay: this.desiredCyclesPerDay(),
      requiredSellPriceVes: solver?.requiredSellPriceVes ?? this.sellPrice(),
      requiredNetRoiPct: solver?.requiredNetRoiPerCyclePct ?? (this.cycleResult()?.roiCyclePct ?? 0.9),
      updatedAt: new Date().toISOString(),
    };
    this.activeDailyGoal.set(nextGoal);
    this.storage.set(ACTIVE_DAILY_GOAL_KEY, nextGoal);
    this.storage.set(DAILY_TARGET_LEGACY_KEY, nextGoal.targetGoalUsd);
    this.toast.success(
      `Meta diaria activa fijada en $${nextGoal.targetGoalUsd} USD/día (${nextGoal.desiredCyclesPerDay} vueltas @ ${nextGoal.requiredSellPriceVes.toFixed(2)} Bs) y sincronizada con el Centro de Control.`,
    );
  }

  clearActiveDailyGoal(): void {
    this.activeDailyGoal.set(null);
    this.storage.remove(ACTIVE_DAILY_GOAL_KEY);
    this.toast.info('Meta diaria personalizada desacoplada.');
  }

  bridgeCycleToReverse(cyclesPerDay?: number): void {
    this.availableCapitalGoal.set(this.capitalUsdt());
    if (cyclesPerDay && cyclesPerDay > 0) {
      this.desiredCyclesPerDay.set(cyclesPerDay);
      const c = this.cycleResult();
      if (c && c.netGainUsd > 0) {
        this.targetGoalUsd.set(Number((c.netGainUsd * cyclesPerDay).toFixed(2)));
      }
    }
    this.activeMode.set('reverse');
    this.toast.info('Parámetros enviados al Planificador Reverso 360°.');
  }

  bridgeCycleToCompound(): void {
    const c = this.cycleResult();
    this.compoundInitialCapital.set(this.capitalUsdt());
    if (c && c.roiCyclePct > 0) {
      this.compoundNetMarginPct.set(Number(c.roiCyclePct.toFixed(2)));
    }
    this.compoundReferenceRate.set(this.sellPrice());
    this.activeMode.set('compound');
    this.toast.info('Capital y margen neto sincronizados con el Proyector Compuesto.');
  }

  applyReverseScenarioToCycle(row: ReverseScenarioRow): void {
    this.desiredCyclesPerDay.set(row.cycles);
    if (!row.isFeasibleWithCurrentCapital && row.requiredSellPriceVes > 0) {
      this.sellPrice.set(row.requiredSellPriceVes);
      this.toast.info(
        `Precio de venta ajustado a ${row.requiredSellPriceVes.toFixed(2)} Bs para alcanzar $${this.targetGoalUsd()}/día en ${row.cycles} vueltas.`,
      );
    } else {
      this.toast.success(`Escenario de ${row.cycles} vueltas seleccionado.`);
    }
  }

  applyRequiredCapitalToGoal(): void {
    const solver = this.reverseSolverMatrix();
    if (!solver || !Number.isFinite(solver.requiredCapitalForDesiredCyclesUsdt)) return;
    const nextCap = Math.ceil(solver.requiredCapitalForDesiredCyclesUsdt);
    this.availableCapitalGoal.set(nextCap);
    this.capitalUsdt.set(nextCap);
    this.toast.success(`Capital actualizado a ${nextCap} USDT para operar a ${this.desiredCyclesPerDay()} vueltas/día.`);
  }

  applyRequiredSellPriceToCycle(): void {
    const solver = this.reverseSolverMatrix();
    if (!solver || solver.requiredSellPriceVes <= 0) return;
    this.sellPrice.set(solver.requiredSellPriceVes);
    this.toast.success(
      `Precio de venta fijado en ${solver.requiredSellPriceVes.toFixed(2)} Bs (+${solver.requiredNetRoiPerCyclePct}% neto/vuelta).`,
    );
  }

  // ─── Live Binance & Real Treasury Hydration ───
  async loadBinancePrices(): Promise<void> {
    this.syncingLive.set(true);
    try {
      let depth = this.binance.marketDepth();
      if (!depth || depth.bestBuyPrice <= 0 || depth.bestSellPrice <= 0) {
        await this.binance.fetchMarketDepth('USDT', 'VES');
        depth = this.binance.marketDepth();
      }
      if (!depth || depth.bestBuyPrice <= 0 || depth.bestSellPrice <= 0) {
        this.toast.warn('No se pudo obtener cotización en vivo de Binance P2P en este momento.');
        return;
      }
      this.buyPrice.set(depth.bestBuyPrice);
      this.sellPrice.set(depth.bestSellPrice);
      this.compoundReferenceRate.set(depth.bestSellPrice);
      this.teamReferenceRate.set(depth.bestSellPrice);
      this.rate.set(depth.bestSellPrice);
      this.toast.success(
        `Precios sincronizados en todas las pestañas: Compra ${depth.bestBuyPrice.toFixed(2)} Bs | Venta ${depth.bestSellPrice.toFixed(2)} Bs`,
      );
    } finally {
      this.syncingLive.set(false);
    }
  }

  loadInventoryAndTreasuryCapital(): void {
    const tel = this.treasuryTelemetry();
    if (tel.openFifoUsdt > 0) {
      this.capitalUsdt.set(tel.openFifoUsdt);
      this.availableCapitalGoal.set(tel.openFifoUsdt);
      this.compoundInitialCapital.set(tel.openFifoUsdt);
      if (tel.openFifoAvgVes > 0) {
        this.buyPrice.set(tel.openFifoAvgVes);
      }
      this.toast.success(
        `Inventario FIFO cargado: ${tel.openFifoUsdt} USDT a costo promedio de ${tel.openFifoAvgVes} Bs.`,
      );
      return;
    }

    const refRate = this.buyPrice() > 0 ? this.buyPrice() : 800;
    if (tel.totalBalanceVes > 0) {
      const eqUsdt = Number((tel.totalBalanceVes / refRate).toFixed(2));
      if (eqUsdt > 0) {
        this.capitalUsdt.set(eqUsdt);
        this.availableCapitalGoal.set(eqUsdt);
        this.toast.success(
          `Liquidez de Tesorería cargada: ~${eqUsdt} USDT equivalentes (${tel.totalBalanceVes.toLocaleString('es-VE')} Bs).`,
        );
        return;
      }
    }
    this.toast.info('No se detectaron lotes FIFO abiertos ni saldo VES en Tesorería; usando capital manual.');
  }

  // ─── MCP Suite (3 Tools): Runway, Rebalance, Trade Impact ───
  readonly mcpRunwayResult = signal<{
    operationalDays?: number;
    finalCapitalUsdt?: number;
    projectedCapitalUsdt?: number;
    harvestedProfitUsdt?: number;
    totalHarvestedUsdt?: number;
    bankingCapacityWallDay?: number;
  } | null>(null);
  readonly mcpRebalanceResult = signal<{
    timeWindow?: string;
    allocations?: {
      bankCode?: string;
      name?: string;
      assignedUsdt?: number;
      allocationPct?: number;
    }[];
  } | null>(null);
  readonly mcpTradeImpactResult = signal<{
    allowed?: boolean;
    estimatedSlippagePct?: number;
    resultingExposureUsdt?: number;
  } | null>(null);
  readonly mcpIncomeLoading = signal<boolean>(false);

  readonly rebalanceCapitalUsdt = signal<number>(5000);
  readonly rebalanceRiskMode = signal<'CONSERVATIVE' | 'AGGRESSIVE' | 'BALANCED'>('BALANCED');
  readonly impactTradeSizeUsdt = signal<number>(500);
  readonly impactCurrentExposureUsdt = signal<number>(1000);
  readonly impactExposureLimitUsdt = signal<number>(3000);

  async runMcpCompoundRunway(): Promise<void> {
    this.mcpIncomeLoading.set(true);
    try {
      const res = await this.mcpService.projectCompoundRunway({
        initialCapitalUsdt: this.compoundInitialCapital(),
        netMarginPctPerCycle: this.compoundNetMarginPct(),
        cyclesPerDay: this.compoundCyclesPerDay(),
        operationalDays: this.compoundOperationalDays(),
        reinvestmentRatePct: this.compoundReinvestmentRate(),
      });
      if (res.success && res.result) {
        this.mcpRunwayResult.set(
          res.result as NonNullable<ReturnType<typeof this.mcpRunwayResult>>,
        );
        this.toast.success('Proyección de pista compuesta MCP calculada.');
      } else {
        this.toast.error(res.error || 'Error al proyectar pista compuesta');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Fallo en projectCompoundRunway';
      this.toast.error(msg);
    } finally {
      this.mcpIncomeLoading.set(false);
    }
  }

  async runMcpRebalance(): Promise<void> {
    this.mcpIncomeLoading.set(true);
    try {
      const res = await this.mcpService.rebalanceCapitalAllocation({
        totalCapitalUsdt: this.rebalanceCapitalUsdt(),
        riskMode: this.rebalanceRiskMode(),
        hourOfDay: new Date().getHours(),
      });
      if (res.success && res.result) {
        this.mcpRebalanceResult.set(
          res.result as NonNullable<ReturnType<typeof this.mcpRebalanceResult>>,
        );
        this.toast.success('Rebalanceo de capital multi-bancario MCP completado.');
      } else {
        this.toast.error(res.error || 'Error al rebalancear capital');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Fallo en rebalanceCapitalAllocation';
      this.toast.error(msg);
    } finally {
      this.mcpIncomeLoading.set(false);
    }
  }

  async runMcpSimulateTradeImpact(): Promise<void> {
    this.mcpIncomeLoading.set(true);
    try {
      const res = await this.mcpService.simulateTradeImpact({
        proposedTradeAmountUsdt: this.impactTradeSizeUsdt(),
        currentExposureUsdt: this.impactCurrentExposureUsdt(),
        maxDailyExposureLimitUsdt: this.impactExposureLimitUsdt(),
      });
      if (res.success && res.result) {
        this.mcpTradeImpactResult.set(
          res.result as NonNullable<ReturnType<typeof this.mcpTradeImpactResult>>,
        );
        this.toast.info('Simulación de absorción y slippage completada.');
      } else {
        this.toast.error(res.error || 'Error al simular impacto');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Fallo en simulateTradeImpact';
      this.toast.error(msg);
    } finally {
      this.mcpIncomeLoading.set(false);
    }
  }
}
