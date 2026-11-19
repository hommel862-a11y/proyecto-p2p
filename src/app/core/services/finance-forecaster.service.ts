import { Injectable } from '@angular/core';
import {
  addCalendarDays,
  calendarDaysBetween,
  parseCalendarDate,
  roundMoney,
  todayVetIso,
  type ExpenseEntry,
  type IncomeEntry,
  type LiabilityItem,
  type AssetVault,
  type ExpenseCategory,
} from '../models/finance-360.models';

export const FORECAST_HORIZON = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  QUARTER: 'quarter',
  YEAR: 'year',
} as const;
export type ForecastHorizon = (typeof FORECAST_HORIZON)[keyof typeof FORECAST_HORIZON];

export interface BurnRateAndRunway {
  dailyBurnRateUsd: number;
  monthlyBurnRateUsd: number;
  runwayDays: number;
  runwayMonths: number;
  isRunwayUnbounded: boolean;
  hasExpenseHistory: boolean;
  status: 'healthy' | 'moderate' | 'tight' | 'critical';
  statusLabel: string;
}

export interface DayHeatmapItem {
  dayName: string;
  dayNumber: number;
  totalSpentUsd: number;
  transactionCount: number;
  intensityPercent: number;
}

export interface CategoryBreakdownItem {
  category: ExpenseCategory;
  categoryLabel: string;
  totalUsd: number;
  totalVes: number;
  percentageOfTotal: number;
}

export interface PeriodPnLReport {
  horizon: ForecastHorizon;
  periodStartIso: string;
  periodEndIso: string;
  operatingIncomeUsd: number;
  p2pIsolatedProfitUsd: number;
  totalIncomeUsd: number;
  directCostsCogsUsd: number;
  fixedExpensesUsd: number;
  totalExpensesUsd: number;
  grossProfitUsd: number;
  netProfitUsd: number;
  operatingNetProfitUsd: number;
  savingsRatePercent: number;
  incomeCount: number;
  expenseCount: number;
}

export interface CfoInsightCard {
  type: 'success' | 'warning' | 'alert' | 'tip';
  title: string;
  message: string;
  recommendation: string;
}

const HORIZON_WINDOW_DAYS: Record<ForecastHorizon, number> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  groceries: 'Comida y Mercado',
  housing: 'Vivienda y Alquiler',
  transport: 'Transporte y Gasolina',
  services: 'Servicios Básicos',
  health: 'Salud y Medicina',
  education: 'Educación',
  personal_care: 'Cuidado Personal',
  entertainment: 'Entretenimiento',
  cashea_installment: 'Cuotas Cashea',
  provider_merchandise: 'Proveedores / Mercancía',
  payroll: 'Nómina',
  rent: 'Alquiler Comercial',
  utilities: 'Servicios Locales',
  maintenance: 'Mantenimiento',
  equipment_capex: 'Mejoras / Equipos',
  marketing: 'Marketing y Publicidad',
  taxes: 'Impuestos y Tributos',
  other: 'Otros Gastos',
};

@Injectable({ providedIn: 'root' })
export class FinanceForecasterService {
  /**
   * Filters dated entries strictly within the requested VET horizon ending on `todayVet`.
   * Excludes all future-dated entries (`date > todayVet`).
   */
  filterByHorizon<T extends { date: string }>(
    items: readonly T[],
    horizon: ForecastHorizon,
    todayVet: string = todayVetIso(),
  ): T[] {
    const windowDays = HORIZON_WINDOW_DAYS[horizon] ?? 30;
    return items.filter((item) => {
      const diffDays = calendarDaysBetween(item.date, todayVet);
      return diffDays >= 0 && diffDays < windowDays;
    });
  }

  /**
   * Computes a structured Profit & Loss (P&L) statement for the requested horizon.
   * Separates Operating Income from P2P Isolated Profit and COGS from Fixed Expenses.
   */
  computePeriodPnL(
    incomes: readonly IncomeEntry[],
    expenses: readonly ExpenseEntry[],
    horizon: ForecastHorizon,
    todayVet: string = todayVetIso(),
  ): PeriodPnLReport {
    const windowDays = HORIZON_WINDOW_DAYS[horizon] ?? 30;
    const periodStartIso = addCalendarDays(todayVet, -(windowDays - 1));
    const filteredIncomes = this.filterByHorizon(incomes, horizon, todayVet);
    const filteredExpenses = this.filterByHorizon(expenses, horizon, todayVet);

    let operatingIncomeUsd = 0;
    let p2pIsolatedProfitUsd = 0;
    for (const inc of filteredIncomes) {
      if (inc.category === 'p2p_profit') {
        p2pIsolatedProfitUsd += inc.triMonetary.amount_usd;
      } else {
        operatingIncomeUsd += inc.triMonetary.amount_usd;
      }
    }

    let directCostsCogsUsd = 0;
    let fixedExpensesUsd = 0;
    for (const exp of filteredExpenses) {
      if (exp.category === 'provider_merchandise') {
        directCostsCogsUsd += exp.triMonetary.amount_usd;
      } else {
        fixedExpensesUsd += exp.triMonetary.amount_usd;
      }
    }

    operatingIncomeUsd = roundMoney(operatingIncomeUsd);
    p2pIsolatedProfitUsd = roundMoney(p2pIsolatedProfitUsd);
    const totalIncomeUsd = roundMoney(operatingIncomeUsd + p2pIsolatedProfitUsd);

    directCostsCogsUsd = roundMoney(directCostsCogsUsd);
    fixedExpensesUsd = roundMoney(fixedExpensesUsd);
    const totalExpensesUsd = roundMoney(directCostsCogsUsd + fixedExpensesUsd);

    const grossProfitUsd = roundMoney(operatingIncomeUsd - directCostsCogsUsd);
    const netProfitUsd = roundMoney(totalIncomeUsd - totalExpensesUsd);
    const operatingNetProfitUsd = roundMoney(operatingIncomeUsd - totalExpensesUsd);
    const savingsRatePercent =
      totalIncomeUsd > 0 ? roundMoney((netProfitUsd / totalIncomeUsd) * 100, 1) : 0;

    return {
      horizon,
      periodStartIso,
      periodEndIso: todayVet,
      operatingIncomeUsd,
      p2pIsolatedProfitUsd,
      totalIncomeUsd,
      directCostsCogsUsd,
      fixedExpensesUsd,
      totalExpensesUsd,
      grossProfitUsd,
      netProfitUsd,
      operatingNetProfitUsd,
      savingsRatePercent,
      incomeCount: filteredIncomes.length,
      expenseCount: filteredExpenses.length,
    };
  }

  /**
   * Computes Daily Burn Rate and Cash Runway in days based on liquid assets.
   * Excludes future-dated expenses and never invents fake runway values when assets or burn are zero.
   */
  calculateBurnRateAndRunway(
    expenses: readonly ExpenseEntry[],
    liquidAssetsUsd: number,
    daysToAnalyze = 30,
    todayIso: string = todayVetIso(),
  ): BurnRateAndRunway {
    const safeDays = daysToAnalyze > 0 ? daysToAnalyze : 30;
    const safeLiquidUsd = Number.isFinite(liquidAssetsUsd) ? Math.max(0, liquidAssetsUsd) : 0;

    const recentExpenses = expenses.filter((e) => {
      const diffDays = calendarDaysBetween(e.date, todayIso);
      return diffDays >= 0 && diffDays <= safeDays;
    });

    const totalSpent = recentExpenses.reduce((sum, e) => sum + e.triMonetary.amount_usd, 0);
    const dailyBurnRateUsd = roundMoney(totalSpent / safeDays);
    const monthlyBurnRateUsd = roundMoney(dailyBurnRateUsd * 30);
    const hasExpenseHistory = recentExpenses.length > 0 && dailyBurnRateUsd > 0;

    if (safeLiquidUsd <= 0) {
      return {
        dailyBurnRateUsd,
        monthlyBurnRateUsd,
        runwayDays: 0,
        runwayMonths: 0,
        isRunwayUnbounded: false,
        hasExpenseHistory,
        status: 'critical',
        statusLabel:
          dailyBurnRateUsd > 0
            ? 'Caja agotada (0 días de cobertura)'
            : 'Sin liquidez disponible ($0 USD)',
      };
    }

    if (dailyBurnRateUsd <= 0) {
      return {
        dailyBurnRateUsd: 0,
        monthlyBurnRateUsd: 0,
        runwayDays: 0,
        runwayMonths: 0,
        isRunwayUnbounded: true,
        hasExpenseHistory: false,
        status: 'healthy',
        statusLabel: 'Sin egresos registrados en el período',
      };
    }

    const runwayDays = Math.round(safeLiquidUsd / dailyBurnRateUsd);
    const runwayMonths = roundMoney(runwayDays / 30, 1);

    let status: BurnRateAndRunway['status'] = 'healthy';
    let statusLabel = `Runway saludable (${runwayDays} días)`;

    if (runwayDays < 15) {
      status = 'critical';
      statusLabel = `Alerta crítica (${runwayDays} días de caja)`;
    } else if (runwayDays < 45) {
      status = 'tight';
      statusLabel = `Runway ajustado (${runwayDays} días)`;
    } else if (runwayDays < 90) {
      status = 'moderate';
      statusLabel = `Runway moderado (${runwayMonths} meses)`;
    }

    return {
      dailyBurnRateUsd,
      monthlyBurnRateUsd,
      runwayDays,
      runwayMonths,
      isRunwayUnbounded: false,
      hasExpenseHistory: true,
      status,
      statusLabel,
    };
  }

  /**
   * Generates a 7-day spending heatmap (Sunday to Saturday) using calendar date parsing
   * immune to UTC-4 weekday shifts and strictly excluding future dates (`0 <= diff <= 7d`).
   */
  generateWeeklyHeatmap(
    expenses: readonly ExpenseEntry[],
    todayIso: string = todayVetIso(),
  ): DayHeatmapItem[] {
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const buckets: { total: number; count: number }[] = Array.from({ length: 7 }, () => ({
      total: 0,
      count: 0,
    }));

    for (const exp of expenses) {
      const diffDays = calendarDaysBetween(exp.date, todayIso);
      if (diffDays >= 0 && diffDays <= 7) {
        const dayIdx = parseCalendarDate(exp.date).getDay();
        buckets[dayIdx].total += exp.triMonetary.amount_usd;
        buckets[dayIdx].count += 1;
      }
    }

    const maxSpent = Math.max(...buckets.map((b) => b.total), 0);

    return buckets.map((b, idx) => ({
      dayName: dayNames[idx],
      dayNumber: idx,
      totalSpentUsd: roundMoney(b.total),
      transactionCount: b.count,
      intensityPercent: maxSpent > 0 ? Math.round((b.total / maxSpent) * 100) : 0,
    }));
  }

  /**
   * Breakdown of expenses by category with percentages.
   */
  generateMonthlyCategoryBreakdown(
    expenses: readonly ExpenseEntry[],
    bcvRate: number,
  ): CategoryBreakdownItem[] {
    const categoryTotals = new Map<ExpenseCategory, number>();
    const safeBcv = Number.isFinite(bcvRate) && bcvRate > 0 ? bcvRate : 0;

    let grandTotal = 0;
    for (const e of expenses) {
      const current = categoryTotals.get(e.category) ?? 0;
      categoryTotals.set(e.category, current + e.triMonetary.amount_usd);
      grandTotal += e.triMonetary.amount_usd;
    }

    const safeTotal = grandTotal > 0 ? grandTotal : 1;
    const results: CategoryBreakdownItem[] = [];

    for (const [cat, usd] of categoryTotals.entries()) {
      results.push({
        category: cat,
        categoryLabel: EXPENSE_CATEGORY_LABELS[cat] ?? cat,
        totalUsd: roundMoney(usd),
        totalVes: safeBcv > 0 ? roundMoney(usd * safeBcv) : 0,
        percentageOfTotal: Math.round((usd / safeTotal) * 100),
      });
    }

    return results.sort((a, b) => b.totalUsd - a.totalUsd);
  }

  /**
   * Virtual CFO Diagnostic Insights.
   */
  generateCfoInsights(
    assets: readonly AssetVault[],
    liabilities: readonly LiabilityItem[],
    incomes: readonly IncomeEntry[],
    expenses: readonly ExpenseEntry[],
    bcvRate: number,
    eurUsdRate = 1.08,
    todayIso: string = todayVetIso(),
  ): CfoInsightCard[] {
    const insights: CfoInsightCard[] = [];
    const safeBcv = Number.isFinite(bcvRate) && bcvRate > 0 ? bcvRate : 0;
    const safeEur = Number.isFinite(eurUsdRate) && eurUsdRate > 0 ? eurUsdRate : 1.08;

    const liquidAssetsUsd = assets.reduce((sum, a) => {
      if (a.isFixedAsset || a.channel === 'receivable') return sum;
      if (a.currency === 'USD' || a.currency === 'USDT') return sum + a.balance;
      if (a.currency === 'VES') return sum + (safeBcv > 0 ? a.balance / safeBcv : 0);
      if (a.currency === 'EUR') return sum + a.balance * safeEur;
      return sum + a.balance;
    }, 0);

    const burn = this.calculateBurnRateAndRunway(expenses, liquidAssetsUsd, 30, todayIso);

    // 1. Runway Insight
    if (liquidAssetsUsd <= 0) {
      insights.push({
        type: 'alert',
        title: 'Sin Liquidez Registrada',
        message: 'No hay saldo líquido disponible en bóvedas activas.',
        recommendation:
          'Registra tus bóvedas reales o un ingreso inicial para activar la telemetría de cobertura.',
      });
    } else if (burn.isRunwayUnbounded) {
      insights.push({
        type: 'success',
        title: 'Sin Consumo Reciente Registrado',
        message: `Cuentas con $${roundMoney(liquidAssetsUsd).toFixed(2)} USD líquidos sin egresos en los últimos 30 días.`,
        recommendation:
          'Registra tus gastos fijos o reglas recurrentes para proyectar un runway real.',
      });
    } else if (burn.runwayDays < 30) {
      insights.push({
        type: 'alert',
        title: 'Caja Inmediata Ajustada',
        message: `Al ritmo de gasto actual ($${burn.dailyBurnRateUsd}/día), tu liquidez cubre ${burn.runwayDays} días.`,
        recommendation:
          'Considera pausar compras financiadas o recortar gastos no esenciales este mes.',
      });
    } else {
      insights.push({
        type: 'success',
        title: 'Colchón de Seguridad Operativa',
        message: `Dispones de ${burn.runwayDays} días de supervivencia de caja con activos líquidos.`,
        recommendation:
          'Tu liquidez permite reinvertir en mercancía o fortalecer reservas patrimoniales.',
      });
    }

    // 2. Cashea Overlap Alert
    const pendingCasheaLiabilities = liabilities.filter(
      (l) => l.category === 'cashea' && l.status !== 'paid',
    );
    const casheaTotalUsd = pendingCasheaLiabilities.reduce(
      (sum, l) => sum + l.remainingAmount,
      0,
    );

    if (casheaTotalUsd > 0 && liquidAssetsUsd > 0) {
      const casheaRatio = (casheaTotalUsd / liquidAssetsUsd) * 100;
      if (casheaRatio > 35) {
        insights.push({
          type: 'warning',
          title: 'Presión por Cuotas Cashea',
          message: `El total de cuotas Cashea por pagar ($${Math.round(casheaTotalUsd)} USD) representa el ${Math.round(casheaRatio)}% de tu caja líquida.`,
          recommendation:
            'Evita abrir nuevas líneas de crédito hasta saldar al menos 2 cuotas pendientes.',
        });
      }
    }

    // 3. VES Devaluation Exposure Diagnostic
    const vesAssetsUsd = assets
      .filter((a) => a.currency === 'VES')
      .reduce((sum, a) => sum + (safeBcv > 0 ? a.balance / safeBcv : 0), 0);
    const vesSharePct =
      liquidAssetsUsd > 0 ? Math.round((vesAssetsUsd / liquidAssetsUsd) * 100) : 0;

    if (vesSharePct > 25) {
      insights.push({
        type: 'warning',
        title: `Alta Exposición en Bolívares (${vesSharePct}%)`,
        message: `Tienes $${Math.round(vesAssetsUsd)} USD equivalentes en cuentas VES expuestos al deslizamiento cambiario BCV.`,
        recommendation:
          'Transfiere el excedente de bolívares a divisas o USDT para proteger tu poder adquisitivo.',
      });
    } else if (liquidAssetsUsd > 0) {
      insights.push({
        type: 'success',
        title: `Blindaje Cambiario Sólido (${100 - vesSharePct}% Moneda Dura)`,
        message: `Solo el ${vesSharePct}% de tu liquidez está en bolívares ($${Math.round(vesAssetsUsd)} USD).`,
        recommendation:
          'Mantén en VES únicamente el capital necesario para gastos operativos de los próximos 5 a 7 días.',
      });
    }

    // 4. P2P Synergy Tip
    const p2pIncomes = incomes.filter((i) => i.category === 'p2p_profit');
    if (p2pIncomes.length === 0) {
      insights.push({
        type: 'tip',
        title: 'Sinergia P2P Pendiente',
        message: 'Aún no has importado ganancias de la Mesa P2P en este período.',
        recommendation:
          'Al cerrar una jornada positiva de arbitraje, importa tu ganancia neta para alimentar tu fondo de reserva.',
      });
    }

    return insights;
  }
}
