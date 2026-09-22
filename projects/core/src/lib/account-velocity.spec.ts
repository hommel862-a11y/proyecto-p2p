import { describe, it, expect } from 'vitest';
import {
  countTodayTransactions,
  assessVelocity,
  computeAccountVelocity,
  computeVelocities,
  getRotationRecommendation,
} from './account-velocity';
import { type BankAccount } from './accounts';
import { type Operation } from './log';

describe('Account Velocity & Rotation (Anti-Sudeban)', () => {
  const banescoPagoMovil: BankAccount = {
    id: 'acc-1',
    bankName: 'Banesco Pago Móvil',
    bankCode: 'BANESCO',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0414-***1234',
    dailyLimitVes: 50000,
    initialBalanceVes: 60000,
  };

  const mercantilTransf: BankAccount = {
    id: 'acc-2',
    bankName: 'Mercantil Transferencia',
    bankCode: 'MERCANTIL',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0105-***9876',
    dailyLimitVes: 200000,
    initialBalanceVes: 150000,
  };

  const baseOp: Operation = {
    id: 'op',
    timestamp: '2026-09-03T10:00:00.000Z',
    type: 'buy',
    pair: 'USDT',
    vesAmount: 1000,
    usdtAmount: 1.2,
    price: 800,
    merchantNote: '',
    fees: 0,
    notes: '',
    errorFree: true,
    bankAccountId: 'acc-1',
  };

  /** Creates `count` buy operations for an account, each moving `vesEach` VES. */
  function makeBuyOps(accountId: string, count: number, vesEach = 1000): Operation[] {
    return Array.from({ length: count }, (_, i) => ({
      ...baseOp,
      id: `op-${accountId}-${i}`,
      bankAccountId: accountId,
      vesAmount: vesEach,
      usdtAmount: vesEach / 800,
    }));
  }

  const mockOps: Operation[] = [
    {
      ...baseOp,
      id: 'op-1',
      timestamp: '2026-09-03T10:00:00.000Z',
      bankAccountId: 'acc-1',
    },
    {
      ...baseOp,
      id: 'op-2',
      timestamp: '2026-09-03T11:00:00.000Z',
      bankAccountId: 'acc-1',
    },
    {
      ...baseOp,
      id: 'op-3',
      timestamp: '2026-09-03T12:00:00.000Z',
      bankAccountId: 'acc-1',
    },
  ];

  it('counts today transactions matched by bankAccountId', () => {
    expect(countTodayTransactions(banescoPagoMovil, mockOps)).toBe(3);
    // Operations assigned to another account do not count.
    expect(countTodayTransactions(mercantilTransf, mockOps)).toBe(0);
  });

  it('counts today transactions matched by merchantNote when no bankAccountId is set', () => {
    const noteOps: Operation[] = [
      {
        ...baseOp,
        id: 'op-n1',
        bankAccountId: undefined,
        merchantNote: 'Compra vía Banesco Pago Móvil',
      },
      {
        ...baseOp,
        id: 'op-n2',
        bankAccountId: undefined,
        merchantNote: 'Venta Banesco pago móvil',
      },
      { ...baseOp, id: 'op-n3', bankAccountId: undefined, merchantNote: 'Sin referencia bancaria' },
    ];
    expect(countTodayTransactions(banescoPagoMovil, noteOps)).toBe(2);
    // Notes mentioning another bank do not match this account.
    expect(countTodayTransactions(mercantilTransf, noteOps)).toBe(0);
  });

  it('ignores merchantNote when bankAccountId is present (same rule as computeAccountUsage)', () => {
    const idNoteOp: Operation = {
      ...baseOp,
      id: 'op-n4',
      bankAccountId: 'acc-2',
      merchantNote: 'Banesco Pago Móvil',
    };
    // bankAccountId points to acc-2, so the note must NOT count for acc-1.
    expect(countTodayTransactions(banescoPagoMovil, [idNoteOp])).toBe(0);
    expect(countTodayTransactions(mercantilTransf, [idNoteOp])).toBe(1);
  });

  it('assesses velocity across all four health states with the default 15-op cap', () => {
    expect(assessVelocity(3)).toBe('OPTIMAL');
    expect(assessVelocity(5)).toBe('OPTIMAL');
    expect(assessVelocity(6)).toBe('MODERATE');
    expect(assessVelocity(10)).toBe('MODERATE');
    expect(assessVelocity(11)).toBe('REST_RECOMMENDED');
    expect(assessVelocity(12)).toBe('REST_RECOMMENDED');
    expect(assessVelocity(15)).toBe('SATURATED');
    expect(assessVelocity(16)).toBe('SATURATED');
  });

  it('assesses velocity with a custom daily threshold', () => {
    // 5-op cap: 40% = 2, 75% = round(3.75) = 4.
    expect(assessVelocity(1, 5)).toBe('OPTIMAL');
    expect(assessVelocity(2, 5)).toBe('MODERATE');
    expect(assessVelocity(4, 5)).toBe('REST_RECOMMENDED');
    expect(assessVelocity(5, 5)).toBe('SATURATED');
  });

  it('computes usedPct and threshold flags per account', () => {
    const moderate = computeAccountVelocity(banescoPagoMovil, makeBuyOps('acc-1', 6));
    expect(moderate.todayTransactionCount).toBe(6);
    expect(moderate.maxDailyTransactions).toBe(15);
    expect(moderate.usedPct).toBe(40); // 6/15 = 40%
    expect(moderate.velocityHealth).toBe('MODERATE');
    expect(moderate.isNearThreshold).toBe(false);
    expect(moderate.isAtThreshold).toBe(false);
    expect(moderate.recommendedWaitHours).toBe(0);

    const rest = computeAccountVelocity(banescoPagoMovil, makeBuyOps('acc-1', 12));
    expect(rest.usedPct).toBe(80); // 12/15 = 80%
    expect(rest.velocityHealth).toBe('REST_RECOMMENDED');
    expect(rest.isNearThreshold).toBe(true);
    expect(rest.isAtThreshold).toBe(false);
    expect(rest.recommendedWaitHours).toBe(4);

    const saturated = computeAccountVelocity(banescoPagoMovil, makeBuyOps('acc-1', 16));
    expect(saturated.usedPct).toBe(107); // 16/15 ≈ 106.67 -> 107
    expect(saturated.velocityHealth).toBe('SATURATED');
    expect(saturated.isNearThreshold).toBe(false);
    expect(saturated.isAtThreshold).toBe(true);
    expect(saturated.recommendedWaitHours).toBe(24);
  });

  it('computes velocities for every account in the list', () => {
    const sixAcc1 = makeBuyOps('acc-1', 6);
    const [first, second] = computeVelocities([banescoPagoMovil, mercantilTransf], sixAcc1);
    expect(first.accountId).toBe('acc-1');
    expect(first.velocityHealth).toBe('MODERATE');
    expect(second.accountId).toBe('acc-2');
    expect(second.velocityHealth).toBe('OPTIMAL');
  });

  it('recommends the healthiest account even when another has more remaining limit', () => {
    // acc-1: 3 ops -> OPTIMAL, remaining 47000 (spent 3000).
    // acc-2: 6 ops -> MODERATE, remaining 194000 (spent 6000).
    const rec = getRotationRecommendation(
      [banescoPagoMovil, mercantilTransf],
      [...makeBuyOps('acc-1', 3), ...makeBuyOps('acc-2', 6)],
      10000,
    );
    expect(rec?.id).toBe('acc-1');
  });

  it('excludes saturated accounts even when they cover the amount', () => {
    // acc-1: 16 ops -> SATURATED, remaining 34000 >= 10000 but excluded.
    // acc-2: 3 ops -> OPTIMAL.
    const rec = getRotationRecommendation(
      [banescoPagoMovil, mercantilTransf],
      [...makeBuyOps('acc-1', 16), ...makeBuyOps('acc-2', 3)],
      10000,
    );
    expect(rec?.id).toBe('acc-2');
  });

  it('honors requiredVes against the remaining daily limit', () => {
    // mockOps spend 3000 on acc-1 -> remaining 47000; acc-2 unused -> 200000.
    const rec = getRotationRecommendation([banescoPagoMovil, mercantilTransf], mockOps, 10000);
    expect(rec?.id).toBe('acc-2');
  });

  it('returns null when the requested amount exceeds every remaining limit', () => {
    const rec = getRotationRecommendation([mercantilTransf], [], 250000);
    expect(rec).toBeNull();
  });

  it('returns null when every account is saturated or over-limit', () => {
    // acc-1 over-limit (55000 spent > 50000 cap) but still OPTIMAL in velocity terms.
    const overLimitOp: Operation = {
      ...baseOp,
      id: 'op-ol',
      bankAccountId: 'acc-1',
      vesAmount: 55000,
      usdtAmount: 68.75,
    };
    const saturatedAcc2 = makeBuyOps('acc-2', 16);
    const rec = getRotationRecommendation(
      [banescoPagoMovil, mercantilTransf],
      [overLimitOp, ...saturatedAcc2],
      0,
    );
    expect(rec).toBeNull();

    // All accounts saturated.
    const allSaturated = getRotationRecommendation(
      [banescoPagoMovil, mercantilTransf],
      [...makeBuyOps('acc-1', 16), ...makeBuyOps('acc-2', 16)],
      0,
    );
    expect(allSaturated).toBeNull();
  });
});
