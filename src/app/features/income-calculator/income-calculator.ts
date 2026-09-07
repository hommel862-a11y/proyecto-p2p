import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  capitalFromDailyIncome,
  toBs,
  clampNonNegative,
  DEFAULT_DAYS_PER_YEAR,
  computeArbitrageCycle,
  projectVelocityEarnings,
  planReverseGoal,
  type BankCode,
  type P2PRole,
  type ArbitrageCycleResult,
  type VelocityProjection,
  type ReverseGoalResult,
} from '@p2p/core';
import { FORMAT_PIPES } from '../../core/format';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { ToastService } from '../../core/toast.service';
import { DecimalPipe } from '@angular/common';

export type CalcViewMode = 'cycle' | 'reverse' | 'classic';

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
  private readonly toast = inject(ToastService);

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

  // --- Mode C: Classic Target/APR Inputs ---
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

  // --- Computed Mode C: Classic Results ---
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
