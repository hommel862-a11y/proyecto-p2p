import { describe, it, expect, beforeEach } from 'vitest';
import { FinanceForecasterService } from './finance-forecaster.service';
import type {
  ExpenseEntry,
  AssetVault,
  LiabilityItem,
  IncomeEntry,
} from '../models/finance-360.models';

function makeExpense(
  id: string,
  date: string,
  amountUsd: number,
  category: ExpenseEntry['category'] = 'groceries',
): ExpenseEntry {
  return {
    id,
    title: `Gasto ${id}`,
    scope: 'personal',
    category,
    channel: 'cash',
    triMonetary: {
      amount_original: amountUsd,
      currency: 'USD',
      bcv_rate: 60,
      parallel_rate: 72,
      amount_usd: amountUsd,
      amount_ves: amountUsd * 60,
    },
    date,
    createdAt: `${date}T16:00:00.000Z`,
  };
}

function makeIncome(
  id: string,
  date: string,
  amountUsd: number,
  category: IncomeEntry['category'] = 'business_sale',
): IncomeEntry {
  return {
    id,
    title: `Ingreso ${id}`,
    scope: 'business',
    category,
    channel: 'zelle',
    triMonetary: {
      amount_original: amountUsd,
      currency: 'USD',
      bcv_rate: 60,
      parallel_rate: 72,
      amount_usd: amountUsd,
      amount_ves: amountUsd * 60,
    },
    date,
    createdAt: `${date}T16:00:00.000Z`,
  };
}

describe('FinanceForecasterService', () => {
  let service: FinanceForecasterService;
  const fixedTodayVet = '2026-05-14'; // Thursday (getDay() === 4)

  beforeEach(() => {
    service = new FinanceForecasterService();
  });

  it('calculates burn rate and runway excluding future dates and handling $0 assets / $0 burn cleanly', () => {
    const expenses: ExpenseEntry[] = [
      makeExpense('past-valid', '2026-05-10', 60, 'groceries'),
      makeExpense('future-ignored', '2026-05-20', 900, 'housing'), // Future date MUST be ignored
    ];

    // $60 spent over 30 days = $2.00/day, $600 liquid assets -> 300 days runway
    const result = service.calculateBurnRateAndRunway(expenses, 600, 30, fixedTodayVet);
    expect(result.dailyBurnRateUsd).toBe(2);
    expect(result.monthlyBurnRateUsd).toBe(60);
    expect(result.runwayDays).toBe(300);
    expect(result.status).toBe('healthy');

    // $0 assets with $0 burn MUST NOT invent fake 999 days
    const zeroAssets = service.calculateBurnRateAndRunway([], 0, 30, fixedTodayVet);
    expect(zeroAssets.runwayDays).toBe(0);
    expect(zeroAssets.status).toBe('critical');

    // Positive assets with $0 burn MUST NOT invent fake 999 days
    const zeroBurn = service.calculateBurnRateAndRunway([], 500, 30, fixedTodayVet);
    expect(zeroBurn.dailyBurnRateUsd).toBe(0);
    expect(zeroBurn.runwayDays).toBe(0);
    expect(zeroBurn.isRunwayUnbounded).toBe(true);
    expect(zeroBurn.status).toBe('healthy');
  });

  it('generates weekly heatmap using parseCalendarDate (no UTC-4 weekday shift) and excludes future & >7d dates', () => {
    // 2026-05-11 is Monday (dayNumber 1), 2026-05-14 is Thursday (dayNumber 4)
    const expenses: ExpenseEntry[] = [
      makeExpense('mon-valid', '2026-05-11', 25, 'transport'),
      makeExpense('thu-valid', '2026-05-14', 40, 'groceries'),
      makeExpense('future-excluded', '2026-05-16', 100, 'housing'),
      makeExpense('too-old-excluded', '2026-05-01', 80, 'services'),
    ];

    const heatmap = service.generateWeeklyHeatmap(expenses, fixedTodayVet);
    expect(heatmap.length).toBe(7);
    expect(heatmap[1].dayName).toBe('Lun');
    expect(heatmap[1].totalSpentUsd).toBe(25);
    expect(heatmap[4].dayName).toBe('Jue');
    expect(heatmap[4].totalSpentUsd).toBe(40);
    // Future Saturday (idx 6) and old Friday (idx 5) excluded
    expect(heatmap[6].totalSpentUsd).toBe(0);
    expect(heatmap[5].totalSpentUsd).toBe(0);
  });

  it('filters entries strictly by horizon (day/week/month/quarter/year) and computes structured Period P&L', () => {
    const incomes: IncomeEntry[] = [
      makeIncome('inc-today', '2026-05-14', 300, 'business_sale'),
      makeIncome('inc-p2p', '2026-05-12', 120, 'p2p_profit'),
      makeIncome('inc-month', '2026-04-20', 500, 'salary'),
      makeIncome('inc-quarter', '2026-03-01', 400, 'freelance'),
      makeIncome('inc-year', '2025-08-01', 1000, 'investment'),
      makeIncome('inc-future', '2026-05-25', 999, 'business_sale'), // excluded
    ];

    const expenses: ExpenseEntry[] = [
      makeExpense('exp-cogs', '2026-05-14', 100, 'provider_merchandise'),
      makeExpense('exp-fixed', '2026-05-11', 50, 'payroll'),
      makeExpense('exp-month', '2026-04-25', 80, 'rent'),
      makeExpense('exp-future', '2026-05-25', 500, 'rent'), // excluded
    ];

    expect(service.filterByHorizon(incomes, 'day', fixedTodayVet).map((i) => i.id)).toEqual(['inc-today']);
    expect(service.filterByHorizon(incomes, 'week', fixedTodayVet).map((i) => i.id)).toEqual([
      'inc-today',
      'inc-p2p',
    ]);
    expect(service.filterByHorizon(incomes, 'month', fixedTodayVet).length).toBe(3);
    expect(service.filterByHorizon(incomes, 'quarter', fixedTodayVet).length).toBe(4);
    expect(service.filterByHorizon(incomes, 'year', fixedTodayVet).length).toBe(5);

    const weekPnl = service.computePeriodPnL(incomes, expenses, 'week', fixedTodayVet);
    expect(weekPnl.operatingIncomeUsd).toBe(300);
    expect(weekPnl.p2pIsolatedProfitUsd).toBe(120);
    expect(weekPnl.totalIncomeUsd).toBe(420);
    expect(weekPnl.directCostsCogsUsd).toBe(100);
    expect(weekPnl.fixedExpensesUsd).toBe(50);
    expect(weekPnl.grossProfitUsd).toBe(200); // 300 - 100
    expect(weekPnl.netProfitUsd).toBe(270); // 420 - 150
    expect(weekPnl.savingsRatePercent).toBe(64.3); // round(270 / 420 * 100, 1)
  });

  it('generates CFO diagnostic alerts when Cashea liabilities exceed 35% of liquidity', () => {
    const assets: AssetVault[] = [
      {
        id: 'vault-1',
        name: 'Caja',
        channel: 'cash',
        scope: 'personal',
        currency: 'USD',
        balance: 100,
        balanceUsdEquivalent: 100,
        balanceVesEquivalent: 6000,
        updatedAt: new Date().toISOString(),
      },
    ];

    const liabilities: LiabilityItem[] = [
      {
        id: 'liab-1',
        title: 'Cuota Cashea',
        creditor: 'Cashea',
        scope: 'personal',
        category: 'cashea',
        triMonetary: {
          amount_original: 50,
          currency: 'USD',
          bcv_rate: 60,
          parallel_rate: 72,
          amount_usd: 50,
          amount_ves: 3000,
        },
        dueDate: fixedTodayVet,
        status: 'pending',
        amountPaid: 0,
        remainingAmount: 50,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const insights = service.generateCfoInsights(assets, liabilities, [], [], 60);
    const casheaAlert = insights.find((i) => i.title.includes('Cashea'));
    expect(casheaAlert).toBeDefined();
    expect(casheaAlert?.type).toBe('warning');
  });
});
