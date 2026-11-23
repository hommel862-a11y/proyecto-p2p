import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Finance360Service } from '../../../core/finance-360.service';
import {
  FORECAST_HORIZON,
  FinanceForecasterService,
  type BurnRateAndRunway,
  type CategoryBreakdownItem,
  type CfoInsightCard,
  type DayHeatmapItem,
  type ForecastHorizon,
  type PeriodPnLReport,
} from '../../../core/services/finance-forecaster.service';
import {
  addCalendarDays,
  calendarDaysBetween,
  roundMoney,
  todayVetIso,
  type CurrencyCode,
} from '../../../core/models/finance-360.models';

export const PROJECTION_POINT_KIND = {
  HISTORICAL: 'historical',
  FORECAST: 'forecast',
} as const;
export type ProjectionPointKind =
  (typeof PROJECTION_POINT_KIND)[keyof typeof PROJECTION_POINT_KIND];

export interface HorizonOption {
  readonly key: ForecastHorizon;
  readonly label: string;
  readonly fullLabel: string;
}

export const ANALYTICS_HORIZON_OPTIONS: readonly HorizonOption[] = [
  { key: FORECAST_HORIZON.DAY, label: 'Hoy', fullLabel: 'Pulso Diario (24h)' },
  { key: FORECAST_HORIZON.WEEK, label: '7D', fullLabel: 'Últimos 7 Días' },
  { key: FORECAST_HORIZON.MONTH, label: '30D', fullLabel: 'Últimos 30 Días' },
  { key: FORECAST_HORIZON.QUARTER, label: '90D', fullLabel: 'Trimestral (90 Días)' },
  { key: FORECAST_HORIZON.YEAR, label: '12M', fullLabel: 'Anual (12 Meses)' },
];

export interface DonutSegment {
  currency?: CurrencyCode;
  label: string;
  amountUsd: number;
  percentage: number;
  color: string;
  dashArray: string;
  dashOffset: number;
}

export interface ExecutiveKpiSummary {
  totalIncomeUsd: number;
  totalIncomeVes: number;
  operatingIncomeUsd: number;
  p2pIsolatedProfitUsd: number;
  incomeCount: number;
  totalExpenseUsd: number;
  totalExpenseVes: number;
  directCostsCogsUsd: number;
  fixedExpensesUsd: number;
  expenseCount: number;
  grossProfitUsd: number;
  netCashflowUsd: number;
  netCashflowVes: number;
  savingsRatePct: number;
  debtToAssetPct: number;
}

export interface ProjectionNode {
  id: string;
  kind: ProjectionPointKind;
  dayOffset: number;
  dateIso: string;
  label: string;
  historicalUsd: number;
  optimisticUsd: number;
  baselineUsd: number;
  stressUsd: number;
  x: number;
  yHistorical: number;
  yOptimistic: number;
  yBaseline: number;
  yStress: number;
}

export interface LiquidityConeChart {
  historicalPoints: ProjectionNode[];
  forecastPoints: ProjectionNode[];
  allPoints: ProjectionNode[];
  splitX: number;
  maxVal: number;
  midVal: number;
  historicalPolyline: string;
  historicalAreaPolygon: string;
  optimisticPolyline: string;
  baselinePolyline: string;
  stressPolyline: string;
  coneAreaPolygon: string;
}

export interface CfoSignalCard extends CfoInsightCard {
  badgeLabel: string;
  confidenceLevel: number;
  confidenceLabel: string;
  segments: readonly boolean[];
}

export interface StressGaugeTelemetry {
  riskPercent: number;
  dashArray: string;
  dashOffset: number;
  tone: 'optimal' | 'warning' | 'critical';
  riskLabel: string;
}

const DONUT_CIRCUMFERENCE = 2 * Math.PI * 62;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 44;

const CURRENCY_META: readonly {
  readonly code: CurrencyCode;
  readonly label: string;
  readonly color: string;
}[] = [
  { code: 'USD', label: 'USD (Divisas / Zelle)', color: 'var(--accent-2)' },
  { code: 'USDT', label: 'USDT (Liquidez Cripto)', color: 'var(--accent)' },
  { code: 'VES', label: 'VES (Bolívares BCV)', color: 'var(--gold)' },
  { code: 'EUR', label: 'EUR (Euros / Divisas)', color: 'var(--warn)' },
];

const CATEGORY_COLORS: readonly string[] = [
  'var(--gold)',
  'var(--accent-2)',
  'var(--accent)',
  'var(--warn)',
  'var(--danger)',
  'var(--gold-strong)',
];

@Component({
  selector: 'app-finance-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './finance-analytics.component.html',
  styleUrls: ['./finance-analytics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinanceAnalyticsComponent {
  readonly financeService = inject(Finance360Service);
  private readonly forecaster = inject(FinanceForecasterService);

  readonly horizon = input<ForecastHorizon | null>(null);
  readonly privacyMode = input<boolean>(false);

  readonly horizonOptions = ANALYTICS_HORIZON_OPTIONS;

  readonly selectedHorizon = linkedSignal<ForecastHorizon | null, ForecastHorizon>({
    source: this.horizon,
    computation: (external, previous) => external ?? previous?.value ?? FORECAST_HORIZON.MONTH,
  });

  readonly customBcvRate = signal<number | null>(null);
  readonly hoveredPointId = signal<string | null>(null);

  readonly isBcvLive = computed<boolean>(() => this.financeService.isBcvRateLive());
  readonly isParallelLive = computed<boolean>(() => this.financeService.isParallelRateLive());

  readonly activeHorizonMeta = computed<HorizonOption>(() => {
    const active = this.selectedHorizon();
    return (
      this.horizonOptions.find((opt) => opt.key === active) ?? this.horizonOptions[2]
    );
  });

  readonly filteredIncomes = computed(() =>
    this.forecaster.filterByHorizon(this.financeService.incomes(), this.selectedHorizon()),
  );

  readonly filteredExpenses = computed(() =>
    this.forecaster.filterByHorizon(this.financeService.expenses(), this.selectedHorizon()),
  );

  readonly periodPnL = computed<PeriodPnLReport>(() =>
    this.forecaster.computePeriodPnL(
      this.financeService.incomes(),
      this.financeService.expenses(),
      this.selectedHorizon(),
    ),
  );

  readonly executiveKpis = computed<ExecutiveKpiSummary>(() => {
    const pnl = this.periodPnL();
    const assetsUsd = this.financeService.totalAssetsUsd();
    const liabilitiesUsd = this.financeService.totalLiabilitiesUsd();
    const bcv = this.financeService.currentBcvRate();

    const debtToAssetPct =
      assetsUsd > 0
        ? Math.min(100, Math.round((liabilitiesUsd / assetsUsd) * 100))
        : liabilitiesUsd > 0
          ? 100
          : 0;

    return {
      totalIncomeUsd: pnl.totalIncomeUsd,
      totalIncomeVes: bcv > 0 ? roundMoney(pnl.totalIncomeUsd * bcv) : 0,
      operatingIncomeUsd: pnl.operatingIncomeUsd,
      p2pIsolatedProfitUsd: pnl.p2pIsolatedProfitUsd,
      incomeCount: pnl.incomeCount,
      totalExpenseUsd: pnl.totalExpensesUsd,
      totalExpenseVes: bcv > 0 ? roundMoney(pnl.totalExpensesUsd * bcv) : 0,
      directCostsCogsUsd: pnl.directCostsCogsUsd,
      fixedExpensesUsd: pnl.fixedExpensesUsd,
      expenseCount: pnl.expenseCount,
      grossProfitUsd: pnl.grossProfitUsd,
      netCashflowUsd: pnl.netProfitUsd,
      netCashflowVes: bcv > 0 ? roundMoney(pnl.netProfitUsd * bcv) : 0,
      savingsRatePct: pnl.savingsRatePercent,
      debtToAssetPct,
    };
  });

  readonly burnRate = computed<BurnRateAndRunway>(() =>
    this.forecaster.calculateBurnRateAndRunway(
      this.financeService.expenses(),
      this.financeService.liquidAssetsUsd(),
      30,
    ),
  );

  readonly hasProjectionData = computed<boolean>(
    () => this.financeService.liquidAssetsUsd() > 0 && this.burnRate().hasExpenseHistory,
  );

  readonly runwayProjectionSvg = computed<LiquidityConeChart>(() => {
    if (!this.hasProjectionData()) {
      return {
        historicalPoints: [],
        forecastPoints: [],
        allPoints: [],
        splitX: 250,
        maxVal: 0,
        midVal: 0,
        historicalPolyline: '',
        historicalAreaPolygon: '',
        optimisticPolyline: '',
        baselinePolyline: '',
        stressPolyline: '',
        coneAreaPolygon: '',
      };
    }

    const todayIso = todayVetIso();
    const currentLiquidUsd = this.financeService.liquidAssetsUsd();
    const dailyBurn = this.burnRate().dailyBurnRateUsd;
    const pnl30 = this.forecaster.computePeriodPnL(
      this.financeService.incomes(),
      this.financeService.expenses(),
      FORECAST_HORIZON.MONTH,
      todayIso,
    );
    const dailyIncomeAvg = roundMoney(pnl30.totalIncomeUsd / 30);
    const vesEquivUsd = this.financeService.vesExposureTelemetry().vesEquivalentUsd;
    const vesStressDrag30d = roundMoney(vesEquivUsd * 0.25);

    const allIncomes = this.financeService.incomes();
    const allExpenses = this.financeService.expenses();

    const histOffsets = [-14, -10, -5, 0];
    const rawHistorical = histOffsets.map((offset) => {
      const dateIso = addCalendarDays(todayIso, offset);
      if (offset === 0) {
        return {
          id: 'hist-0',
          dayOffset: 0,
          dateIso,
          label: 'Hoy',
          valUsd: roundMoney(currentLiquidUsd),
        };
      }

      let netFlowAfterPoint = 0;
      for (const inc of allIncomes) {
        const diffFromPoint = calendarDaysBetween(dateIso, inc.date);
        const diffFromToday = calendarDaysBetween(inc.date, todayIso);
        if (diffFromPoint > 0 && diffFromToday >= 0) {
          netFlowAfterPoint += inc.triMonetary.amount_usd;
        }
      }
      for (const exp of allExpenses) {
        const diffFromPoint = calendarDaysBetween(dateIso, exp.date);
        const diffFromToday = calendarDaysBetween(exp.date, todayIso);
        if (diffFromPoint > 0 && diffFromToday >= 0) {
          netFlowAfterPoint -= exp.triMonetary.amount_usd;
        }
      }

      const reconstructedUsd = Math.max(0, roundMoney(currentLiquidUsd - netFlowAfterPoint));
      return {
        id: `hist-${Math.abs(offset)}`,
        dayOffset: offset,
        dateIso,
        label: `${offset}d`,
        valUsd: reconstructedUsd,
      };
    });

    const forecastOffsets = [0, 5, 10, 15, 20, 25, 30];
    const rawForecast = forecastOffsets.map((day) => {
      const dateIso = addCalendarDays(todayIso, day);
      const baselineUsd = Math.max(0, roundMoney(currentLiquidUsd - dailyBurn * day));
      const optimisticUsd = Math.max(
        0,
        roundMoney(currentLiquidUsd + (dailyIncomeAvg - dailyBurn * 0.85) * day),
      );
      const stressUsd = Math.max(
        0,
        roundMoney(currentLiquidUsd - dailyBurn * 1.35 * day - vesStressDrag30d * (day / 30)),
      );
      return {
        id: `fcst-${day}`,
        dayOffset: day,
        dateIso,
        label: day === 0 ? 'Hoy' : `+${day}d`,
        optimisticUsd,
        baselineUsd,
        stressUsd,
      };
    });

    const maxVal = Math.max(
      ...rawHistorical.map((p) => p.valUsd),
      ...rawForecast.map((p) => Math.max(p.optimisticUsd, p.baselineUsd, p.stressUsd)),
      1,
    );

    const chartLeft = 60;
    const splitX = 248;
    const chartRight = 692;
    const chartTop = 26;
    const chartBottom = 212;
    const chartHeight = chartBottom - chartTop;
    const histWidth = splitX - chartLeft;
    const forecastWidth = chartRight - splitX;

    const toY = (val: number): number =>
      Number((chartBottom - (Math.max(0, val) / maxVal) * chartHeight).toFixed(1));

    const historicalPoints: ProjectionNode[] = rawHistorical.map((p, idx) => {
      const x = Number((chartLeft + (idx / (rawHistorical.length - 1)) * histWidth).toFixed(1));
      const y = toY(p.valUsd);
      return {
        id: p.id,
        kind: PROJECTION_POINT_KIND.HISTORICAL,
        dayOffset: p.dayOffset,
        dateIso: p.dateIso,
        label: p.label,
        historicalUsd: p.valUsd,
        optimisticUsd: p.valUsd,
        baselineUsd: p.valUsd,
        stressUsd: p.valUsd,
        x,
        yHistorical: y,
        yOptimistic: y,
        yBaseline: y,
        yStress: y,
      };
    });

    const forecastPoints: ProjectionNode[] = rawForecast.map((p, idx) => {
      const x = Number((splitX + (idx / (rawForecast.length - 1)) * forecastWidth).toFixed(1));
      return {
        id: p.id,
        kind: PROJECTION_POINT_KIND.FORECAST,
        dayOffset: p.dayOffset,
        dateIso: p.dateIso,
        label: p.label,
        historicalUsd: currentLiquidUsd,
        optimisticUsd: p.optimisticUsd,
        baselineUsd: p.baselineUsd,
        stressUsd: p.stressUsd,
        x,
        yHistorical: toY(currentLiquidUsd),
        yOptimistic: toY(p.optimisticUsd),
        yBaseline: toY(p.baselineUsd),
        yStress: toY(p.stressUsd),
      };
    });

    const historicalPolyline = historicalPoints.map((p) => `${p.x},${p.yHistorical}`).join(' ');
    const historicalAreaPolygon = `${chartLeft},${chartBottom} ${historicalPolyline} ${splitX},${chartBottom}`;
    const optimisticPolyline = forecastPoints.map((p) => `${p.x},${p.yOptimistic}`).join(' ');
    const baselinePolyline = forecastPoints.map((p) => `${p.x},${p.yBaseline}`).join(' ');
    const stressPolyline = forecastPoints.map((p) => `${p.x},${p.yStress}`).join(' ');
    const reversedStress = [...forecastPoints]
      .reverse()
      .map((p) => `${p.x},${p.yStress}`)
      .join(' ');
    const coneAreaPolygon = `${optimisticPolyline} ${reversedStress}`;

    const allPoints = [...historicalPoints.slice(0, -1), ...forecastPoints];

    return {
      historicalPoints,
      forecastPoints,
      allPoints,
      splitX,
      maxVal: Math.ceil(maxVal),
      midVal: Math.round(maxVal / 2),
      historicalPolyline,
      historicalAreaPolygon,
      optimisticPolyline,
      baselinePolyline,
      stressPolyline,
      coneAreaPolygon,
    };
  });

  readonly hoveredPoint = computed<ProjectionNode | null>(() => {
    const id = this.hoveredPointId();
    if (!id) return null;
    return this.runwayProjectionSvg().allPoints.find((pt) => pt.id === id) ?? null;
  });

  readonly activeSimulatedBcvRate = computed<number>(() => {
    if (!this.isBcvLive()) return 0;
    const custom = this.customBcvRate();
    if (custom !== null && Number.isFinite(custom) && custom > 0) {
      return roundMoney(custom, 2);
    }
    return roundMoney(this.financeService.currentBcvRate() * 1.1, 2);
  });

  readonly stressSliderMin = computed<number>(() => {
    const bcv = this.financeService.currentBcvRate();
    return bcv > 0 ? roundMoney(bcv * 0.9, 1) : 0;
  });

  readonly stressSliderMax = computed<number>(() => {
    const bcv = this.financeService.currentBcvRate();
    const par = this.financeService.currentParallelRate();
    if (bcv <= 0) return 0;
    return roundMoney(Math.max(bcv * 2.2, par * 1.25), 1);
  });

  readonly bcvStressSimulation = computed(() =>
    this.financeService.simulateBcvRateImpact(this.activeSimulatedBcvRate()),
  );

  readonly stressGauge = computed<StressGaugeTelemetry>(() => {
    const vesExp = this.financeService.vesExposureTelemetry().exposurePct;
    const devalPct = Math.max(0, this.bcvStressSimulation().devaluationPct);
    const rawScore =
      vesExp <= 0 ? 0 : Math.min(100, Math.round(vesExp * 0.8 + devalPct * 0.55));
    const arcLength = (rawScore / 100) * GAUGE_CIRCUMFERENCE;
    const tone: StressGaugeTelemetry['tone'] =
      rawScore >= 60 ? 'critical' : rawScore >= 30 ? 'warning' : 'optimal';
    const riskLabel =
      tone === 'critical'
        ? 'Riesgo Alto'
        : tone === 'warning'
          ? 'Riesgo Moderado'
          : 'Blindaje Sólido';

    return {
      riskPercent: rawScore,
      dashArray: `${arcLength.toFixed(2)} ${GAUGE_CIRCUMFERENCE.toFixed(2)}`,
      dashOffset: 0,
      tone,
      riskLabel,
    };
  });

  readonly currencyDonutSegments = computed<DonutSegment[]>(() => {
    const vaults = this.financeService.assets();
    const totals: Record<CurrencyCode, number> = {
      USD: 0,
      USDT: 0,
      VES: 0,
      EUR: 0,
    };

    for (const vault of vaults) {
      const usdEquiv = vault.balanceUsdEquivalent;
      if (usdEquiv > 0) {
        totals[vault.currency] = roundMoney(totals[vault.currency] + usdEquiv);
      }
    }

    const grandTotal = roundMoney(totals.USD + totals.USDT + totals.VES + totals.EUR);
    if (grandTotal <= 0) return [];

    const activeCurrencies = CURRENCY_META.filter((item) => totals[item.code] > 0);
    let accumulatedPct = 0;

    return activeCurrencies.map((item) => {
      const amountUsd = totals[item.code];
      const pct = roundMoney((amountUsd / grandTotal) * 100, 1);
      const arcLength = (pct / 100) * DONUT_CIRCUMFERENCE;
      const offset = DONUT_CIRCUMFERENCE - (accumulatedPct / 100) * DONUT_CIRCUMFERENCE;
      accumulatedPct += pct;

      return {
        currency: item.code,
        label: item.label,
        amountUsd,
        percentage: pct,
        color: item.color,
        dashArray: `${arcLength.toFixed(2)} ${DONUT_CIRCUMFERENCE.toFixed(2)}`,
        dashOffset: Number(offset.toFixed(2)),
      };
    });
  });

  readonly categoryBreakdown = computed<CategoryBreakdownItem[]>(() =>
    this.forecaster.generateMonthlyCategoryBreakdown(
      this.filteredExpenses(),
      this.financeService.currentBcvRate(),
    ),
  );

  readonly categoryDonutSegments = computed<DonutSegment[]>(() => {
    const cats = this.categoryBreakdown();
    if (cats.length === 0) return [];

    let accumulatedPct = 0;
    return cats.slice(0, 6).map((cat, idx) => {
      const pct = cat.percentageOfTotal;
      const arcLength = (pct / 100) * DONUT_CIRCUMFERENCE;
      const offset = DONUT_CIRCUMFERENCE - (accumulatedPct / 100) * DONUT_CIRCUMFERENCE;
      accumulatedPct += pct;

      return {
        label: cat.categoryLabel,
        amountUsd: cat.totalUsd,
        percentage: pct,
        color: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
        dashArray: `${arcLength.toFixed(2)} ${DONUT_CIRCUMFERENCE.toFixed(2)}`,
        dashOffset: Number(offset.toFixed(2)),
      };
    });
  });

  readonly weeklyHeatmap = computed<DayHeatmapItem[]>(() =>
    this.forecaster.generateWeeklyHeatmap(this.financeService.expenses()),
  );

  readonly peakSpendingDay = computed<DayHeatmapItem | null>(() => {
    const active = this.weeklyHeatmap().filter((d) => d.totalSpentUsd > 0);
    if (active.length === 0) return null;
    return active.reduce((prev, curr) => (curr.totalSpentUsd > prev.totalSpentUsd ? curr : prev));
  });

  readonly cfoInsights = computed<CfoSignalCard[]>(() => {
    const eurUsd = this.financeService.currentEurUsdRate() || 1.08;
    const raw = this.forecaster.generateCfoInsights(
      this.financeService.assets(),
      this.financeService.liabilities(),
      this.financeService.incomes(),
      this.financeService.expenses(),
      this.financeService.currentBcvRate(),
      eurUsd,
    );

    const dataDensityBonus =
      this.financeService.expenses().length >= 5 && this.financeService.assets().length > 0 ? 1 : 0;

    return raw.map((card) => {
      const baseConfidence =
        card.type === 'alert'
          ? 5
          : card.type === 'warning'
            ? 4
            : card.type === 'success'
              ? 4
              : 3;
      const confidenceLevel = Math.min(5, baseConfidence + (card.type === 'tip' ? dataDensityBonus : 0));
      const badgeLabel =
        card.type === 'alert'
          ? 'Alerta de Riesgo'
          : card.type === 'warning'
            ? 'Precaución Patrimonial'
            : card.type === 'tip'
              ? 'Estrategia CFO'
              : 'Solvencia Óptima';

      return {
        ...card,
        badgeLabel,
        confidenceLevel,
        confidenceLabel: `Confianza ${confidenceLevel}/5`,
        segments: [1, 2, 3, 4, 5].map((n) => n <= confidenceLevel),
      };
    });
  });

  setHorizon(horizon: ForecastHorizon): void {
    this.selectedHorizon.set(horizon);
  }

  setHoveredPoint(pointId: string): void {
    this.hoveredPointId.set(pointId);
  }

  clearHoveredPoint(): void {
    this.hoveredPointId.set(null);
  }

  setStressRateMultiplier(multiplier: number): void {
    const base = this.financeService.currentBcvRate();
    if (base <= 0) return;
    this.customBcvRate.set(roundMoney(base * multiplier, 2));
  }

  matchParallelRateInStress(): void {
    const par = this.financeService.currentParallelRate();
    if (par <= 0) return;
    this.customBcvRate.set(roundMoney(par, 2));
  }

  resetStressRate(): void {
    this.customBcvRate.set(null);
  }

  onStressSliderChange(rawValue: number | string): void {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    this.customBcvRate.set(roundMoney(numeric, 2));
  }

  formatUsd(amount: number, showSign = false): string {
    if (this.privacyMode()) return '••••';
    const absFormatted = Math.abs(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (amount < 0) return `-$${absFormatted}`;
    return showSign && amount > 0 ? `+$${absFormatted}` : `$${absFormatted}`;
  }

  formatCompactUsd(amount: number): string {
    if (this.privacyMode()) return '••••';
    return `$${Math.round(amount).toLocaleString('en-US')}`;
  }

  formatVes(amount: number): string {
    if (this.privacyMode()) return '••••';
    return `Bs ${amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}
