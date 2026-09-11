import { describe, it, expect } from 'vitest';
import {
  computeAccountUsage,
  computeTreasurySummary,
  recommendAccountForTrade,
  type BankAccount,
} from './accounts';
import { type Operation } from './log';

describe('BankAccount and Treasury Core Logic', () => {
  const banescoPagoMovil: BankAccount = {
    id: 'acc-1',
    bankName: 'Banesco Pago Móvil',
    bankCode: 'BANESCO',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0414-***1234',
    dailyLimitVes: 50000,
    initialBalanceVes: 60000,
    monthlyLimitVes: 100000,
  };

  const mercantilTransf: BankAccount = {
    id: 'acc-2',
    bankName: 'Mercantil Transferencia',
    bankCode: 'MERCANTIL',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0105-***9876',
    dailyLimitVes: 200000,
    initialBalanceVes: 150000,
    monthlyLimitVes: 500000,
  };

  // Ops con fecha de hoy (Septiembre 2026) — usados para cálculos diarios y mensuales
  const mockOps: Operation[] = [
    {
      id: 'op-1',
      timestamp: '2026-09-03T10:00:00.000Z',
      type: 'buy',
      pair: 'USDT',
      vesAmount: 20000,
      usdtAmount: 25,
      price: 800,
      merchantNote: '',
      fees: 0,
      notes: '',
      errorFree: true,
      bankAccountId: 'acc-1',
    },
    {
      id: 'op-2',
      timestamp: '2026-09-03T11:00:00.000Z',
      type: 'buy',
      pair: 'USDT',
      vesAmount: 22000,
      usdtAmount: 27.5,
      price: 800,
      merchantNote: '',
      fees: 50,
      notes: '',
      errorFree: true,
      bankAccountId: 'acc-1',
    },
    {
      id: 'op-3',
      timestamp: '2026-09-03T12:00:00.000Z',
      type: 'sell',
      pair: 'USDT',
      vesAmount: 15000,
      usdtAmount: 18,
      price: 833.33,
      merchantNote: '',
      fees: 0,
      notes: '',
      errorFree: true,
      bankAccountId: 'acc-1',
    },
  ];

  // Ops incluyendo una ops antigua de agosto (fuera del mes actual)
  const opsWithOld: Operation[] = [
    ...mockOps,
    {
      id: 'op-old',
      timestamp: '2026-08-20T10:00:00.000Z',
      type: 'buy',
      pair: 'USDT',
      vesAmount: 30000,
      usdtAmount: 37.5,
      price: 800,
      merchantNote: '',
      fees: 0,
      notes: '',
      errorFree: true,
      bankAccountId: 'acc-1',
    },
  ];

  it('computes daily usage and remaining limit accurately', () => {
    const usage = computeAccountUsage(banescoPagoMovil, mockOps);
    // spent: 20000 + 22050 = 42050
    expect(usage.spentTodayVes).toBe(42050);
    // received: 15000
    expect(usage.receivedTodayVes).toBe(15000);
    // current balance: 60000 - 42050 + 15000 = 32950
    expect(usage.currentBalanceVes).toBe(32950);
    // limit 50000 -> consumed 42050 / 50000 = 84.1% -> 84%
    expect(usage.consumedLimitPct).toBe(84);
    expect(usage.remainingLimitVes).toBe(7950);
    expect(usage.isNearLimit).toBe(true);
    expect(usage.isOverLimit).toBe(false);
  });

  it('flags over-limit when spent >= daily limit', () => {
    const heavyOp: Operation = {
      id: 'op-heavy',
      timestamp: '2026-09-03T14:00:00.000Z',
      type: 'buy',
      pair: 'USDT',
      vesAmount: 55000,
      usdtAmount: 65,
      price: 840,
      merchantNote: '',
      fees: 0,
      notes: '',
      errorFree: true,
      bankAccountId: 'acc-1',
    };
    const usage = computeAccountUsage(banescoPagoMovil, [heavyOp]);
    expect(usage.consumedLimitPct).toBe(110);
    expect(usage.remainingLimitVes).toBe(0);
    expect(usage.isOverLimit).toBe(true);
    expect(usage.isNearLimit).toBe(false);
  });

  it('aggregates treasury summary across accounts', () => {
    const summary = computeTreasurySummary([banescoPagoMovil, mercantilTransf], mockOps);
    expect(summary.totalSpentTodayVes).toBe(42050);
    expect(summary.totalReceivedTodayVes).toBe(15000);
    // banesco balance = 32950, mercantil balance = 150000 -> total = 182950
    expect(summary.totalBalanceVes).toBe(182950);
    expect(summary.nearLimitCount).toBe(1);
    expect(summary.overLimitCount).toBe(0);
  });

  it('recommends the best account with sufficient balance and limit', () => {
    // We need 15000 VES for a buy.
    // Banesco has 7950 remaining limit -> cannot cover 15000.
    // Mercantil has 200000 remaining limit and 150000 balance -> can cover.
    const best = recommendAccountForTrade([banescoPagoMovil, mercantilTransf], 15000, mockOps);
    expect(best).not.toBeNull();
    expect(best?.id).toBe('acc-2');
  });

  it('computes monthly usage when monthlyLimitVes is set', () => {
    const usage = computeAccountUsage(banescoPagoMovil, mockOps);
    // mockOps has 3 ops on 2026-09-03 (current month) -> spentThisMonthVes = 42050
    // monthlyLimitVes = 100000 -> consumed 42050 / 100000 = 42.05% -> 42%
    expect(usage.spentThisMonthVes).toBe(42050);
    expect(usage.consumedMonthlyLimitPct).toBe(42);
    expect(usage.isNearMonthlyLimit).toBe(false);
    expect(usage.isOverMonthlyLimit).toBe(false);
  });

  it('excludes old August ops from monthly usage', () => {
    const usage = computeAccountUsage(banescoPagoMovil, opsWithOld);
    // op-old is from August (not September), should NOT count in monthly spent
    // Daily counts all ops (caller responsibility to filter)
    expect(usage.spentTodayVes).toBe(72050); // 42050 + 30000 (August op counted in daily)
    expect(usage.spentThisMonthVes).toBe(42050); // Only September ops
    expect(usage.consumedMonthlyLimitPct).toBe(42);
    expect(usage.isNearMonthlyLimit).toBe(false);
    expect(usage.isOverMonthlyLimit).toBe(false);
  });

  it('flags over monthly limit when spent >= monthly limit', () => {
    // Create ops that exceed monthly limit: 120000 ves in current month
    const heavyOps: Operation[] = [
      ...mockOps,
      {
        id: 'op-monthly-heavy',
        timestamp: '2026-09-15T10:00:00.000Z',
        type: 'buy',
        pair: 'USDT',
        vesAmount: 80000,
        usdtAmount: 100,
        price: 800,
        merchantNote: '',
        fees: 0,
        notes: '',
        errorFree: true,
        bankAccountId: 'acc-1',
      },
    ];
    const usage = computeAccountUsage(banescoPagoMovil, heavyOps);
    // spentThisMonthVes = 42050 (first 3) + 80000 = 122050
    expect(usage.spentThisMonthVes).toBe(122050);
    expect(usage.consumedMonthlyLimitPct).toBe(122);
    expect(usage.isOverMonthlyLimit).toBe(true);
    expect(usage.isNearMonthlyLimit).toBe(false);
  });

  it('aggregates treasury summary with monthly counts', () => {
    const summary = computeTreasurySummary([banescoPagoMovil, mercantilTransf], mockOps);
    expect(summary.totalSpentTodayVes).toBe(42050);
    expect(summary.totalSpentThisMonthVes).toBe(42050);
    expect(summary.nearLimitCount).toBe(1);
    expect(summary.overLimitCount).toBe(0);
    expect(summary.nearMonthlyLimitCount).toBe(0);
    expect(summary.overMonthlyLimitCount).toBe(0);
  });
});
