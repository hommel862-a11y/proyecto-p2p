import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Finance360Service } from '../../../core/finance-360.service';
import { ToastService } from '../../../core/toast.service';
import {
  FinanceForecasterService,
  type BurnRateAndRunway,
  type DayHeatmapItem,
  type CategoryBreakdownItem,
  type CfoInsightCard,
} from '../../../core/services/finance-forecaster.service';

export interface DonutSegment {
  label: string;
  amountUsd: number;
  percentage: number;
  color: string;
  dashArray: string;
  dashOffset: number;
}

export interface RunwayPoint {
  day: number;
  label: string;
  optimisticUsd: number;
  baselineUsd: number;
  stressUsd: number;
  x: number;
  yBaseline: number;
  yOptimistic: number;
  yStress: number;
}

@Component({
  selector: 'app-finance-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './finance-analytics.component.html',
  styleUrls: ['./finance-analytics.component.scss'],
})
export class FinanceAnalyticsComponent {
  readonly financeService = inject(Finance360Service);
  private readonly forecaster = inject(FinanceForecasterService);
  private readonly toast = inject(ToastService);

  readonly selectedHorizon = signal<'day' | 'week' | 'month' | 'quarter'>('month');

  /** Interactive BCV Stress-Test Simulator Rate (0 = defaults to current BCV + 10%) */
  readonly customBcvRate = signal<number | null>(null);

  readonly activeSimulatedBcvRate = computed<number>(() => {
    const custom = this.customBcvRate();
    if (custom !== null && custom > 0) return custom;
    return Number((this.financeService.currentBcvRate() * 1.1).toFixed(2));
  });

  readonly bcvStressSimulation = computed(() => {
    return this.financeService.simulateBcvRateImpact(this.activeSimulatedBcvRate());
  });

  setStressRateMultiplier(multiplier: number): void {
    const base = this.financeService.currentBcvRate();
    this.customBcvRate.set(Number((base * multiplier).toFixed(2)));
  }

  matchParallelRateInStress(): void {
    this.customBcvRate.set(Number(this.financeService.currentParallelRate().toFixed(2)));
  }

  /** Executive Cashflow KPIs */
  readonly executiveKpis = computed(() => {
    const incomes = this.financeService.incomes();
    const expenses = this.financeService.expenses();
    const assetsUsd = this.financeService.totalAssetsUsd();
    const liabilitiesUsd = this.financeService.totalLiabilitiesUsd();
    const bcv = this.financeService.currentBcvRate();

    const totalIncomeUsd = incomes.reduce((acc, i) => acc + i.triMonetary.amount_usd, 0);
    const totalExpenseUsd = expenses.reduce((acc, e) => acc + e.triMonetary.amount_usd, 0);
    const netCashflowUsd = totalIncomeUsd - totalExpenseUsd;

    const savingsRatePct =
      totalIncomeUsd > 0 ? Math.round(((totalIncomeUsd - totalExpenseUsd) / totalIncomeUsd) * 100) : 0;
    const debtToAssetPct =
      assetsUsd > 0 ? Math.min(100, Math.round((liabilitiesUsd / assetsUsd) * 100)) : 0;

    return {
      totalIncomeUsd: Number(totalIncomeUsd.toFixed(2)),
      totalIncomeVes: Number((totalIncomeUsd * bcv).toFixed(2)),
      incomeCount: incomes.length,
      totalExpenseUsd: Number(totalExpenseUsd.toFixed(2)),
      totalExpenseVes: Number((totalExpenseUsd * bcv).toFixed(2)),
      expenseCount: expenses.length,
      netCashflowUsd: Number(netCashflowUsd.toFixed(2)),
      netCashflowVes: Number((netCashflowUsd * bcv).toFixed(2)),
      savingsRatePct,
      debtToAssetPct,
    };
  });

  readonly burnRate = computed<BurnRateAndRunway>(() => {
    const expenses = this.financeService.expenses();
    const liquidAssets = this.financeService.totalAssetsUsd();
    return this.forecaster.calculateBurnRateAndRunway(expenses, liquidAssets);
  });

  readonly weeklyHeatmap = computed<DayHeatmapItem[]>(() => {
    return this.forecaster.generateWeeklyHeatmap(this.financeService.expenses());
  });

  readonly peakSpendingDay = computed<DayHeatmapItem | null>(() => {
    const days = this.weeklyHeatmap();
    const active = days.filter((d) => d.totalSpentUsd > 0);
    if (active.length === 0) return null;
    return active.reduce((prev, curr) => (curr.totalSpentUsd > prev.totalSpentUsd ? curr : prev));
  });

  readonly categoryBreakdown = computed<CategoryBreakdownItem[]>(() => {
    const expenses = this.financeService.expenses();
    const bcv = this.financeService.currentBcvRate();
    return this.forecaster.generateMonthlyCategoryBreakdown(expenses, bcv);
  });

  readonly cfoInsights = computed<CfoInsightCard[]>(() => {
    return this.forecaster.generateCfoInsights(
      this.financeService.assets(),
      this.financeService.liabilities(),
      this.financeService.incomes(),
      this.financeService.expenses(),
      this.financeService.currentBcvRate(),
    );
  });

  /** SVG Donut Chart 1: Asset Allocation by Currency (USD, USDT, VES) */
  readonly currencyDonutSegments = computed<DonutSegment[]>(() => {
    const vaults = this.financeService.assets();
    const bcv = this.financeService.currentBcvRate();
    const circumference = 2 * Math.PI * 62; // r = 62 -> ~389.56

    let usdTotal = 0;
    let usdtTotal = 0;
    let vesInUsdTotal = 0;

    for (const v of vaults) {
      if (v.currency === 'USD') usdTotal += v.balance;
      else if (v.currency === 'USDT') usdtTotal += v.balance;
      else if (v.currency === 'VES') vesInUsdTotal += bcv > 0 ? v.balance / bcv : 0;
    }

    const grandTotal = usdTotal + usdtTotal + vesInUsdTotal;
    if (grandTotal <= 0) return [];

    const rawItems = [
      { label: 'USD (Dólares / Zelle)', amountUsd: usdTotal, color: '#6366f1' },
      { label: 'USDT (Liquidez Cripto)', amountUsd: usdtTotal, color: '#10b981' },
      { label: 'VES (Bolívares BCV)', amountUsd: vesInUsdTotal, color: '#3b82f6' },
    ].filter((i) => i.amountUsd > 0);

    let accumulatedPct = 0;
    return rawItems.map((item) => {
      const pct = Number(((item.amountUsd / grandTotal) * 100).toFixed(1));
      const arcLength = (pct / 100) * circumference;
      const offset = circumference - (accumulatedPct / 100) * circumference;
      accumulatedPct += pct;

      return {
        label: item.label,
        amountUsd: Number(item.amountUsd.toFixed(2)),
        percentage: pct,
        color: item.color,
        dashArray: `${arcLength} ${circumference}`,
        dashOffset: offset,
      };
    });
  });

  /** SVG Donut Chart 2: Expense Category Breakdown */
  readonly categoryDonutSegments = computed<DonutSegment[]>(() => {
    const cats = this.categoryBreakdown();
    if (cats.length === 0) return [];

    const circumference = 2 * Math.PI * 62;
    const palette = ['#e2b755', '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6'];

    let accumulatedPct = 0;
    return cats.slice(0, 6).map((cat, idx) => {
      const pct = cat.percentageOfTotal;
      const arcLength = (pct / 100) * circumference;
      const offset = circumference - (accumulatedPct / 100) * circumference;
      accumulatedPct += pct;

      return {
        label: cat.categoryLabel,
        amountUsd: cat.totalUsd,
        percentage: pct,
        color: palette[idx % palette.length],
        dashArray: `${arcLength} ${circumference}`,
        dashOffset: offset,
      };
    });
  });

  /** 30-Day Predictive Cashflow & Runway SVG Curve (3 Scenarios: Optimistic, Baseline, Stress) */
  readonly runwayProjectionSvg = computed(() => {
    const startLiquidity = Math.max(100, this.financeService.totalAssetsUsd());
    const dailyBurn = Math.max(5, this.burnRate().dailyBurnRateUsd || 18);
    const dailyIncomeAvg =
      this.executiveKpis().totalIncomeUsd > 0
        ? this.executiveKpis().totalIncomeUsd / 30
        : dailyBurn * 1.15;

    const steps = [0, 5, 10, 15, 20, 25, 30];
    const rawPoints = steps.map((day) => {
      const baselineUsd = Math.max(0, startLiquidity - dailyBurn * day);
      const optimisticUsd = Math.max(0, startLiquidity + (dailyIncomeAvg - dailyBurn * 0.85) * day);
      const stressUsd = Math.max(0, startLiquidity - dailyBurn * 1.45 * day);
      return {
        day,
        label: day === 0 ? 'Hoy' : `+${day}d`,
        optimisticUsd: Number(optimisticUsd.toFixed(0)),
        baselineUsd: Number(baselineUsd.toFixed(0)),
        stressUsd: Number(stressUsd.toFixed(0)),
      };
    });

    const maxVal = Math.max(
      ...rawPoints.map((p) => Math.max(p.optimisticUsd, p.baselineUsd, startLiquidity)),
      100,
    );

    const chartLeft = 50;
    const chartRight = 640;
    const chartTop = 24;
    const chartBottom = 180;
    const width = chartRight - chartLeft;
    const height = chartBottom - chartTop;

    const points: RunwayPoint[] = rawPoints.map((p, idx) => {
      const x = Number((chartLeft + (idx / (rawPoints.length - 1)) * width).toFixed(1));
      const yBaseline = Number((chartBottom - (p.baselineUsd / maxVal) * height).toFixed(1));
      const yOptimistic = Number((chartBottom - (p.optimisticUsd / maxVal) * height).toFixed(1));
      const yStress = Number((chartBottom - (p.stressUsd / maxVal) * height).toFixed(1));
      return { ...p, x, yBaseline, yOptimistic, yStress };
    });

    const baselinePolyline = points.map((p) => `${p.x},${p.yBaseline}`).join(' ');
    const optimisticPolyline = points.map((p) => `${p.x},${p.yOptimistic}`).join(' ');
    const stressPolyline = points.map((p) => `${p.x},${p.yStress}`).join(' ');

    const baselineArea = `${chartLeft},${chartBottom} ${baselinePolyline} ${chartRight},${chartBottom}`;
    const optimisticArea = `${chartLeft},${chartBottom} ${optimisticPolyline} ${chartRight},${chartBottom}`;

    return {
      points,
      maxVal: Math.round(maxVal),
      midVal: Math.round(maxVal / 2),
      baselinePolyline,
      optimisticPolyline,
      stressPolyline,
      baselineArea,
      optimisticArea,
    };
  });

  seedDemoFromAnalytics(): void {
    this.financeService.seedDemoPortfolio();
    this.toast.success(
      '✨ Portafolio Demo cargado con ingresos, gastos y cuotas reales. Gráficas actualizadas.',
    );
  }
}
