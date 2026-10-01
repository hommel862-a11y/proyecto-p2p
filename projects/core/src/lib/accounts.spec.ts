import { describe, it, expect } from 'vitest';
import {
  computeAccountUsage,
  computeTreasurySummary,
  recommendAccountForTrade,
  type BankAccount,
} from './accounts';
import { type Operation } from './log';

/**
 * `computeAccountUsage` deriva `monthKey` del reloj real (`new Date().toISOString()`)
 * y no acepta un reloj inyectado, así que los fixtures se anclan al mes UTC en curso
 * en lugar de a una fecha fija. Anclarlos a un mes concreto dejaba el spec rojo en
 * cada cambio de mes sin que nadie hubiera tocado la lógica de producción.
 *
 * Se captura una sola vez para que todos los fixtures compartan el mismo mes y la
 * relación "mes actual vs. mes anterior" sea siempre consistente dentro del archivo.
 */
const NOW_MONTH_KEY = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

/** Marca de tiempo en UTC dentro de un mes dado, mismo criterio que `monthKey`. */
function tsInMonth(monthKey: string, day: number, hour = 10): string {
  return `${monthKey}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

/** Mes UTC inmediatamente anterior, con rollover correcto de enero -> diciembre del año previo. */
function previousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

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

  // Ops del mes UTC en curso — usados para los cálculos diarios y mensuales.
  // El día 03 existe en cualquier mes, así que el fixture nunca desborda el calendario.
  const mockOps: Operation[] = [
    {
      id: 'op-1',
      timestamp: tsInMonth(NOW_MONTH_KEY, 3, 10),
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
      timestamp: tsInMonth(NOW_MONTH_KEY, 3, 11),
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
      timestamp: tsInMonth(NOW_MONTH_KEY, 3, 12),
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

  // Ops que incluyen una del mes anterior (fuera del mes en curso).
  const opsWithOld: Operation[] = [
    ...mockOps,
    {
      id: 'op-old',
      timestamp: tsInMonth(previousMonthKey(NOW_MONTH_KEY), 20, 10),
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
      timestamp: tsInMonth(NOW_MONTH_KEY, 3, 14),
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
    // mockOps has 3 ops in the current month -> spentThisMonthVes = 42050
    // monthlyLimitVes = 100000 -> consumed 42050 / 100000 = 42.05% -> 42%
    expect(usage.spentThisMonthVes).toBe(42050);
    expect(usage.consumedMonthlyLimitPct).toBe(42);
    expect(usage.isNearMonthlyLimit).toBe(false);
    expect(usage.isOverMonthlyLimit).toBe(false);
  });

  it('excludes old August ops from monthly usage', () => {
    // El nombre histórico dice "August" porque el fixture original fijaba agosto y septiembre.
    // Ahora "op-old" se deriva como mes actual menos uno, que es la condición que importa.
    const usage = computeAccountUsage(banescoPagoMovil, opsWithOld);
    // op-old is from the previous month, should NOT count in monthly spent
    // Daily counts all ops (caller responsibility to filter)
    expect(usage.spentTodayVes).toBe(72050); // 42050 + 30000 (previous-month op counted in daily)
    expect(usage.spentThisMonthVes).toBe(42050); // Only current-month ops
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
        timestamp: tsInMonth(NOW_MONTH_KEY, 15, 10),
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

describe('Multi-account selection: targetBankCode and DISABLED status', () => {
  // mercantil has the most headroom, so it wins every unfiltered recommendation.
  const mercantilBig: BankAccount = {
    id: 'acc-m1',
    bankName: 'Mercantil Transferencia',
    bankCode: 'MERCANTIL',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0105-***0001',
    dailyLimitVes: 900000,
    initialBalanceVes: 900000,
  };

  const banescoA: BankAccount = {
    id: 'acc-b1',
    bankName: 'Banesco Pago Móvil A',
    bankCode: 'BANESCO',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0414-***0002',
    dailyLimitVes: 50000,
    initialBalanceVes: 100000,
  };

  const banescoB: BankAccount = {
    id: 'acc-b2',
    bankName: 'Banesco Pago Móvil B',
    bankCode: 'BANESCO',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0414-***0003',
    dailyLimitVes: 30000,
    initialBalanceVes: 80000,
  };

  const disabledMercantil: BankAccount = {
    id: 'acc-off',
    bankName: 'Mercantil Cuenta Pausada',
    bankCode: 'MERCANTIL',
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0105-***0004',
    dailyLimitVes: 900000,
    initialBalanceVes: 900000,
    status: 'DISABLED',
  };

  const disabledBanesco: BankAccount = {
    id: 'acc-off-b',
    bankName: 'Banesco Cuenta Pausada',
    bankCode: 'BANESCO',
    rail: 'PAGO_MOVIL',
    accountNumberMasked: '0414-***0005',
    dailyLimitVes: 900000,
    initialBalanceVes: 900000,
    status: 'DISABLED',
  };

  it('recommends the largest-headroom account when no target bank is requested', () => {
    const best = recommendAccountForTrade([banescoA, banescoB, mercantilBig], 1000, []);
    expect(best?.id).toBe('acc-m1');
  });

  it('recommends only accounts of targetBankCode even when another bank has more headroom', () => {
    // Without the filter mercantilBig (900000 remaining) would win.
    const best = recommendAccountForTrade(
      [banescoA, banescoB, mercantilBig],
      1000,
      [],
      'BANESCO',
    );
    expect(best?.id).toBe('acc-b1'); // 50000 remaining beats banescoB's 30000
  });

  it('picks the other bank when targetBankCode points to it', () => {
    const best = recommendAccountForTrade(
      [banescoA, banescoB, mercantilBig],
      1000,
      [],
      'MERCANTIL',
    );
    expect(best?.id).toBe('acc-m1');
  });

  it('returns null when no account of the target bank has enough daily limit', () => {
    // Banesco accounts cap at 50000 / 30000 remaining; only mercantil could cover 60000.
    const best = recommendAccountForTrade(
      [banescoA, banescoB, mercantilBig],
      60000,
      [],
      'BANESCO',
    );
    expect(best).toBeNull();
  });

  it('excludes DISABLED accounts from the recommendation', () => {
    // disabledMercantil would win unfiltered (900000 remaining, best headroom).
    const best = recommendAccountForTrade([banescoA, disabledMercantil], 1000, []);
    expect(best?.id).toBe('acc-b1');
  });

  it('returns null when the only DISABLED account is otherwise the best candidate', () => {
    expect(recommendAccountForTrade([disabledMercantil], 1000, [])).toBeNull();
  });

  it('prefers an ACTIVE account of the target bank over a DISABLED one', () => {
    // Both are BANESCO, but the paused one has far more headroom.
    const best = recommendAccountForTrade([banescoA, disabledBanesco], 1000, [], 'BANESCO');
    expect(best?.id).toBe('acc-b1');
  });

  it('returns null when every account of the target bank is DISABLED', () => {
    expect(recommendAccountForTrade([disabledBanesco], 1000, [], 'BANESCO')).toBeNull();
  });

  it('keeps the legacy three-argument signature working', () => {
    expect(recommendAccountForTrade([banescoA, mercantilBig], 1000, [])?.id).toBe('acc-m1');
    expect(recommendAccountForTrade([banescoA, mercantilBig], 60000, [])?.id).toBe('acc-m1');
    expect(recommendAccountForTrade([banescoA, banescoB], 1000, [])?.id).toBe('acc-b1');
  });

  it('computes VES consumption unchanged for accounts carrying the new optional fields', () => {
    const active: BankAccount = {
      id: 'acc-b1',
      bankName: 'Banesco Pago Móvil A',
      bankCode: 'BANESCO',
      rail: 'PAGO_MOVIL',
      accountNumberMasked: '0414-***0002',
      dailyLimitVes: 50000,
      initialBalanceVes: 60000,
      monthlyLimitVes: 100000,
      status: 'ACTIVE',
      maxDailyTransactions: 3,
    };

    const ops: Operation[] = Array.from({ length: 3 }, (_, i) => ({
      id: `op-c-${i}`,
      timestamp: tsInMonth(NOW_MONTH_KEY, 3, 10),
      type: 'buy' as const,
      pair: 'USDT',
      vesAmount: 1000,
      usdtAmount: 1.25,
      price: 800,
      merchantNote: '',
      fees: 0,
      notes: '',
      errorFree: true,
      bankAccountId: 'acc-b1',
    }));

    const usage = computeAccountUsage(active, ops);
    // The new fields are carried through untouched and do not alter the VES math.
    expect(usage.account.status).toBe('ACTIVE');
    expect(usage.account.maxDailyTransactions).toBe(3);
    expect(usage.spentTodayVes).toBe(3000);
    expect(usage.receivedTodayVes).toBe(0);
    expect(usage.currentBalanceVes).toBe(57000);
    expect(usage.consumedLimitPct).toBe(6); // 3000 / 50000
    expect(usage.remainingLimitVes).toBe(47000);
    expect(usage.isOverLimit).toBe(false);
  });

  it('still computes limit consumption for DISABLED accounts (config is preserved)', () => {
    const nearLimitPaused: BankAccount = { ...disabledBanesco, dailyLimitVes: 50000, initialBalanceVes: 60000 };
    const ops: Operation[] = [
      {
        id: 'op-p1',
        timestamp: tsInMonth(NOW_MONTH_KEY, 3, 10),
        type: 'buy',
        pair: 'USDT',
        vesAmount: 42050,
        usdtAmount: 52.5,
        price: 800,
        merchantNote: '',
        fees: 0,
        notes: '',
        errorFree: true,
        bankAccountId: 'acc-off-b',
      },
    ];

    const usage = computeAccountUsage(nearLimitPaused, ops);
    expect(usage.spentTodayVes).toBe(42050);
    expect(usage.consumedLimitPct).toBe(84);
    expect(usage.remainingLimitVes).toBe(7950);
    expect(usage.isNearLimit).toBe(true);
    expect(usage.isOverLimit).toBe(false);
  });

  it('aggregates treasury summary including DISABLED accounts', () => {
    const summary = computeTreasurySummary([banescoA, disabledBanesco], []);
    expect(summary.accountsUsage).toHaveLength(2);
    expect(summary.accountsUsage[1].account.status).toBe('DISABLED');
    expect(summary.totalBalanceVes).toBe(1000000); // 100000 + 900000
  });
});
