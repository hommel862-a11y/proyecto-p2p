import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  capitalFromDailyIncome,
  toBs,
  clampNonNegative,
  DEFAULT_DAYS_PER_YEAR,
  computeArbitrageCycle,
  projectVelocityEarnings,
  planReverseGoal,
  simulateCompoundGrowth,
  buildTeamAllocationPlan,
  auditOperatorPerformance,
  evaluateGoldenSpread,
  type BankCode,
  type P2PRole,
  type ArbitrageCycleResult,
  type VelocityProjection,
  type ReverseGoalResult,
  type CompoundSimulationResult,
  type OperatorProfile,
  type TeamAllocationPlan,
  type OperatorAuditResult,
} from '@p2p/core';
import { FORMAT_PIPES } from '../../core/format';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { AccountsService } from '../../core/accounts.service';
import { ToastService } from '../../core/toast.service';
import { DecimalPipe } from '@angular/common';

import { StorageService } from '../../core/storage';
import { type Operation } from '@p2p/core';

export type CalcViewMode = 'cycle' | 'reverse' | 'compound' | 'team' | 'classic';

/**
 * C2 — Smart P2P Arbitrage & Capital Calculator.
 * - Mode A: Cycle Arbitrage ROI & Velocity Projections (1, 3, 5, 10 vueltas).
 * - Mode B: Reverse Goal Sizing (Daily USD goal -> required cycles and bank volume).
 * - Mode C: Classic Long-term Capital / APR benchmark table.
 */
@Component({
  selector: 'app-income-calculator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, ...FORMAT_PIPES],
  templateUrl: './income-calculator.html',
  styleUrl: './income-calculator.scss',
})
export class IncomeCalculator {
  private readonly binance = inject(BinanceP2pService);
  private readonly accounts = inject(AccountsService);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(StorageService);

  readonly activeMode = signal<CalcViewMode>('cycle');

  // --- Mode A: Cycle Arbitrage Inputs ---
  readonly capitalUsdt = signal<number>(500);
  readonly buyPrice = signal<number>(60.0);
  readonly sellPrice = signal<number>(61.2);
  readonly buyRole = signal<P2PRole>('MAKER');
  readonly sellRole = signal<P2PRole>('MAKER');
  readonly sourceBank = signal<BankCode>('BANESCO');
  readonly targetBank = signal<BankCode>('BANESCO');
  readonly isInterbank = signal<boolean>(false);

  // --- Mode B: Reverse Goal Inputs ---
  readonly targetGoalUsd = signal<number>(25);
  readonly availableCapitalGoal = signal<number>(500);

  // --- Mode C: Compound Growth Projector Inputs ---
  readonly compoundInitialCapital = signal<number>(10000);
  readonly compoundNetMarginPct = signal<number>(0.9);
  readonly compoundCyclesPerDay = signal<number>(1.5);
  readonly compoundOperationalDays = signal<number>(90);
  readonly compoundReinvestmentRate = signal<number>(50); // 50/50 harvest policy default
  readonly compoundReferenceRate = signal<number>(60.0);

  // --- Mode D: Team Delegation & Scaling ($1,000/day Desk) ---
  readonly teamDeskCapital = signal<number>(7000);
  readonly teamReferenceRate = signal<number>(60.0);
  readonly teamExpectedSpreadPct = signal<number>(0.85);
  readonly teamOperators = signal<OperatorProfile[]>([
    {
      id: 'op-william',
      name: 'William (Operador Principal)',
      assignedCapitalUsdt: 5000,
      commissionSplitPct: 30, // 30% operator, 70% desk owner
      targetDailyCycles: 2,
      active: true,
    },
    {
      id: 'op-junior',
      name: 'Operador Secundario (Neobancos / Banesco)',
      assignedCapitalUsdt: 2000,
      commissionSplitPct: 25,
      targetDailyCycles: 1.5,
      active: true,
    },
  ]);

  // --- Mode E: Classic Target/APR Inputs ---
  readonly targetUsd = signal<number>(20);
  readonly aprPct = signal<number>(10);
  readonly daysPerYear = signal<number>(DEFAULT_DAYS_PER_YEAR);
  readonly rate = signal<number>(800);

  /** Template helper: collapse NaN/empty/negative money entries to 0. */
  clampMoney(v: number): number {
    return clampNonNegative(v);
  }

  // --- Computed Mode A: Cycle Arbitrage & Velocity ---
  readonly cycleResult = computed<ArbitrageCycleResult | null>(() => {
    try {
      if (this.capitalUsdt() <= 0 || this.buyPrice() <= 0 || this.sellPrice() <= 0) {
        return null;
      }
      return computeArbitrageCycle({
        capitalUsdt: this.capitalUsdt(),
        buyPrice: this.buyPrice(),
        sellPrice: this.sellPrice(),
        buyRole: this.buyRole(),
        sellRole: this.sellRole(),
        sourceBank: this.sourceBank(),
        targetBank: this.targetBank(),
        isInterbank: this.isInterbank(),
      });
    } catch {
      return null;
    }
  });

  readonly velocityProjections = computed<VelocityProjection[]>(() => {
    const cycle = this.cycleResult();
    if (!cycle) return [];
    return projectVelocityEarnings(cycle, [1, 3, 5, 10]);
  });

  // --- Computed Mode B: Reverse Goal Sizing ---
  readonly reverseGoalResult = computed<ReverseGoalResult | null>(() => {
    try {
      if (
        this.targetGoalUsd() <= 0 ||
        this.availableCapitalGoal() <= 0 ||
        this.buyPrice() <= 0 ||
        this.sellPrice() <= 0
      ) {
        return null;
      }
      return planReverseGoal({
        dailyTargetUsd: this.targetGoalUsd(),
        availableCapitalUsdt: this.availableCapitalGoal(),
        buyPrice: this.buyPrice(),
        sellPrice: this.sellPrice(),
        bankCode: this.sourceBank(),
        buyRole: this.buyRole(),
        sellRole: this.sellRole(),
        isInterbank: this.isInterbank(),
      });
    } catch {
      return null;
    }
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

      const treasury = this.accounts.treasurySummary();
      const totalLimit = treasury.accountsUsage.reduce((acc, u) => acc + u.account.dailyLimitVes, 0);
      const dailyBankLimitVes = totalLimit > 0 ? totalLimit : undefined;

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

  // --- Computed Mode D: Team Allocation Plan ($1,000/day Desk) ---
  readonly teamPlan = computed<TeamAllocationPlan | null>(() => {
    try {
      if (this.teamDeskCapital() <= 0) return null;
      return buildTeamAllocationPlan(
        this.teamDeskCapital(),
        this.teamOperators(),
        this.teamReferenceRate(),
        this.teamExpectedSpreadPct(),
      );
    } catch {
      return null;
    }
  });

  readonly operatorAudits = computed<OperatorAuditResult[]>(() => {
    const ops = this.storage.get<Operation[]>('p2p.operations') ?? [];
    const refRate = this.teamReferenceRate();
    return this.teamOperators().map((op) => {
      // Filter ops where merchantNote or notes match operator or audit all desk ops for lead
      const opOps = ops.filter(
        (o) =>
          (o.merchantNote && o.merchantNote.toLowerCase().includes(op.name.toLowerCase())) ||
          (o.notes && o.notes.toLowerCase().includes(op.name.toLowerCase())),
      );
      // Fallback: if no tag match yet, audit against general desk ops to provide live diagnostics
      const targetOps = opOps.length > 0 ? opOps : (op.id === 'op-william' ? ops.slice(0, 10) : []);
      return auditOperatorPerformance(op, targetOps, refRate, 10);
    });
  });

  // --- Computed Mode E: Classic Results ---
  readonly bands = [8, 10, 15] as const;
  readonly targets = [1, 5, 20] as const;

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

  /**
   * Helper: sync current live prices from Binance P2P depth if available.
   */
  loadBinancePrices(): void {
    const depth = this.binance.marketDepth();
    if (!depth || depth.bestBuyPrice <= 0 || depth.bestSellPrice <= 0) {
      this.toast.warn('No hay datos de Binance P2P disponibles aún. Sincronizá el radar primero.');
      return;
    }
    this.buyPrice.set(depth.bestBuyPrice);
    this.sellPrice.set(depth.bestSellPrice);
    this.toast.info(
      `Precios cargados de Binance: Compra ${depth.bestBuyPrice.toFixed(2)} | Venta ${depth.bestSellPrice.toFixed(2)}`,
    );
  }
}
