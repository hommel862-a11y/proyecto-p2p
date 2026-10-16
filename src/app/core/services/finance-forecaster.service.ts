import { Injectable } from '@angular/core';
import type {
  ExpenseEntry,
  IncomeEntry,
  LiabilityItem,
  AssetVault,
  ExpenseCategory,
} from '../models/finance-360.models';

export interface BurnRateAndRunway {
  dailyBurnRateUsd: number;
  monthlyBurnRateUsd: number;
  runwayDays: number;
  runwayMonths: number;
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

export interface CfoInsightCard {
  type: 'success' | 'warning' | 'alert' | 'tip';
  title: string;
  message: string;
  recommendation: string;
}

@Injectable({ providedIn: 'root' })
export class FinanceForecasterService {
  /**
   * Computes Daily Burn Rate and Cash Runway in days based on liquid assets.
   */
  calculateBurnRateAndRunway(
    expenses: ExpenseEntry[],
    liquidAssetsUsd: number,
    daysToAnalyze: number = 30,
  ): BurnRateAndRunway {
    const now = Date.now();
    const windowMs = daysToAnalyze * 24 * 60 * 60 * 1000;

    const recentExpenses = expenses.filter((e) => {
      const time = new Date(e.date).getTime();
      return now - time <= windowMs;
    });

    const totalSpent = recentExpenses.reduce((sum, e) => sum + e.triMonetary.amount_usd, 0);
    const dailyBurnRateUsd =
      daysToAnalyze > 0 ? Math.round((totalSpent / daysToAnalyze) * 100) / 100 : 0;
    const monthlyBurnRateUsd = Math.round(dailyBurnRateUsd * 30 * 100) / 100;

    let runwayDays = 999;
    let runwayMonths = 33;
    let status: BurnRateAndRunway['status'] = 'healthy';
    let statusLabel = 'RUNWAY SALUDABLE (+90 Días)';

    if (dailyBurnRateUsd > 0) {
      runwayDays = Math.round(liquidAssetsUsd / dailyBurnRateUsd);
      runwayMonths = Math.round((runwayDays / 30) * 10) / 10;

      if (runwayDays < 15) {
        status = 'critical';
        statusLabel = `ALERTA CRÍTICA (${runwayDays} días de caja)`;
      } else if (runwayDays < 45) {
        status = 'tight';
        statusLabel = `RUNWAY AJUSTADO (${runwayDays} días)`;
      } else if (runwayDays < 90) {
        status = 'moderate';
        statusLabel = `RUNWAY MODERADO (${runwayMonths} meses)`;
      }
    }

    return {
      dailyBurnRateUsd,
      monthlyBurnRateUsd,
      runwayDays,
      runwayMonths,
      status,
      statusLabel,
    };
  }

  /**
   * Generates a 7-day spending heatmap (Monday to Sunday)
   */
  generateWeeklyHeatmap(expenses: ExpenseEntry[]): DayHeatmapItem[] {
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const buckets: { total: number; count: number }[] = Array.from({ length: 7 }, () => ({
      total: 0,
      count: 0,
    }));

    const now = new Date();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const exp of expenses) {
      const d = new Date(exp.date);
      if (now.getTime() - d.getTime() <= sevenDaysMs) {
        const dayIdx = d.getDay();
        buckets[dayIdx].total += exp.triMonetary.amount_usd;
        buckets[dayIdx].count += 1;
      }
    }

    const maxSpent = Math.max(...buckets.map((b) => b.total), 1);

    return buckets.map((b, idx) => ({
      dayName: dayNames[idx],
      dayNumber: idx,
      totalSpentUsd: Math.round(b.total * 100) / 100,
      transactionCount: b.count,
      intensityPercent: Math.round((b.total / maxSpent) * 100),
    }));
  }

  /**
   * Breakdown of expenses by category with percentages
   */
  generateMonthlyCategoryBreakdown(
    expenses: ExpenseEntry[],
    bcvRate: number,
  ): CategoryBreakdownItem[] {
    const categoryTotals = new Map<ExpenseCategory, number>();

    let grandTotal = 0;
    for (const e of expenses) {
      const current = categoryTotals.get(e.category) || 0;
      categoryTotals.set(e.category, current + e.triMonetary.amount_usd);
      grandTotal += e.triMonetary.amount_usd;
    }

    const safeTotal = grandTotal > 0 ? grandTotal : 1;
    const categoryLabels: Record<string, string> = {
      groceries: 'Comida y Mercado',
      housing: 'Vivienda y Alquiler',
      transport: 'Transporte y Gasolina',
      services: 'Servicios Básicos',
      health: 'Salud y Medicina',
      cashea_installment: 'Cuotas Cashea',
      provider_merchandise: 'Proveedores / Mercancía',
      payroll: 'Nómina',
      maintenance: 'Mantenimiento',
      equipment_capex: 'Mejoras / Equipos',
      other: 'Otros Gastos',
    };

    const results: CategoryBreakdownItem[] = [];
    for (const [cat, usd] of categoryTotals.entries()) {
      results.push({
        category: cat,
        categoryLabel: categoryLabels[cat] || cat,
        totalUsd: Math.round(usd * 100) / 100,
        totalVes: Math.round(usd * bcvRate * 100) / 100,
        percentageOfTotal: Math.round((usd / safeTotal) * 100),
      });
    }

    return results.sort((a, b) => b.totalUsd - a.totalUsd);
  }

  /**
   * Virtual CFO Diagnostic Insights
   */
  generateCfoInsights(
    assets: AssetVault[],
    liabilities: LiabilityItem[],
    incomes: IncomeEntry[],
    expenses: ExpenseEntry[],
    bcvRate: number,
  ): CfoInsightCard[] {
    const insights: CfoInsightCard[] = [];
    const liquidAssetsUsd = assets.reduce((sum, a) => {
      if (a.currency === 'USD' || a.currency === 'USDT') return sum + a.balance;
      if (a.currency === 'VES') return sum + (bcvRate > 0 ? a.balance / bcvRate : 0);
      return sum + a.balance;
    }, 0);

    const burn = this.calculateBurnRateAndRunway(expenses, liquidAssetsUsd);

    // 1. Runway Insight
    if (burn.runwayDays < 30) {
      insights.push({
        type: 'alert',
        title: 'Caja Inmediata Ajustada',
        message: `A tu ritmo de gasto actual ($${burn.dailyBurnRateUsd}/día), tu liquidez cubre ${burn.runwayDays} días.`,
        recommendation:
          'Considera pausar compras financiadas o recortar gastos no esenciales este mes.',
      });
    } else {
      insights.push({
        type: 'success',
        title: 'Colchón de Seguridad Operativa',
        message: `Dispones de ${burn.runwayDays} días de supervivencia de caja con activos líquidos.`,
        recommendation: 'Tu liquidez te permite reinvertir en mercancía o acelerar metas de ahorro.',
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
            'No abras nuevas líneas de crédito hasta saldar al menos 2 cuotas pendientes.',
        });
      }
    }

    // 3. VES Devaluation Exposure Diagnostic
    const vesAssetsUsd = assets
      .filter((a) => a.currency === 'VES')
      .reduce((sum, a) => sum + (bcvRate > 0 ? a.balance / bcvRate : 0), 0);
    const vesSharePct = liquidAssetsUsd > 0 ? Math.round((vesAssetsUsd / liquidAssetsUsd) * 100) : 0;

    if (vesSharePct > 25) {
      insights.push({
        type: 'warning',
        title: `Alta Exposición en Bolívares (${vesSharePct}%)`,
        message: `Tienes $${Math.round(vesAssetsUsd)} USD equivalentes en cuentas VES expuestos al deslizamiento cambiario BCV.`,
        recommendation:
          'Usa el botón "🔄 Transferir Fondos" para convertir el excedente de Bs a USDT o USD y blindar tu poder adquisitivo.',
      });
    } else {
      insights.push({
        type: 'success',
        title: `Blindaje Cambiario Sólido (${100 - vesSharePct}% Moneda Dura)`,
        message: `Solo el ${vesSharePct}% de tu liquidez está en Bolívares ($${Math.round(vesAssetsUsd)} USD).`,
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
        message:
          'Aún no has importado ganancias de la Mesa P2P este mes.',
        recommendation:
          'Cuando tengas una jornada de arbitraje positiva, usa el botón "Importar Ganancia Neta P2P" para alimentar tu fondo de reserva.',
      });
    }

    return insights;
  }
}
