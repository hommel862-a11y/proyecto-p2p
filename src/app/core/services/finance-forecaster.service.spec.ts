import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FinanceForecasterService } from './finance-forecaster.service';
import type { ExpenseEntry, AssetVault, LiabilityItem, IncomeEntry } from '../models/finance-360.models';

describe('FinanceForecasterService', () => {
  let service: FinanceForecasterService;

  beforeEach(() => {
    service = new FinanceForecasterService();
  });

  it('should calculate burn rate and runway properly', () => {
    const expenses: ExpenseEntry[] = [
      {
        id: 'exp-1',
        title: 'Mercado semanal',
        scope: 'personal',
        category: 'groceries',
        channel: 'cash',
        triMonetary: {
          amount_original: 60,
          currency: 'USD',
          bcv_rate: 60,
          parallel_rate: 70,
          amount_usd: 60,
          amount_ves: 3600,
        },
        date: new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString(),
      },
    ];

    // $60 spent over 30 days = $2.00/day
    // Liquid assets = $600 -> Runway = 300 days
    const result = service.calculateBurnRateAndRunway(expenses, 600, 30);
    expect(result.dailyBurnRateUsd).toBe(2);
    expect(result.monthlyBurnRateUsd).toBe(60);
    expect(result.runwayDays).toBe(300);
    expect(result.status).toBe('healthy');
  });

  it('should generate weekly heatmap and category breakdowns', () => {
    const expenses: ExpenseEntry[] = [
      {
        id: 'exp-1',
        title: 'Gasolina',
        scope: 'personal',
        category: 'transport',
        channel: 'cash',
        triMonetary: {
          amount_original: 20,
          currency: 'USD',
          bcv_rate: 60,
          parallel_rate: 70,
          amount_usd: 20,
          amount_ves: 1200,
        },
        date: new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString(),
      },
    ];

    const heatmap = service.generateWeeklyHeatmap(expenses);
    expect(heatmap.length).toBe(7);

    const breakdown = service.generateMonthlyCategoryBreakdown(expenses, 60);
    expect(breakdown.length).toBe(1);
    expect(breakdown[0].category).toBe('transport');
    expect(breakdown[0].totalUsd).toBe(20);
    expect(breakdown[0].percentageOfTotal).toBe(100);
  });

  it('should generate CFO diagnostic alerts when Cashea liabilities exceed 35% of liquidity', () => {
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
          parallel_rate: 70,
          amount_usd: 50,
          amount_ves: 3000,
        },
        dueDate: new Date().toISOString().split('T')[0],
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
