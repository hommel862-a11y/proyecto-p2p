import { describe, it, expect } from 'vitest';
import {
  computeAccountUsage,
  computeTreasurySummary,
  recommendAccountForTrade,
  type BankAccount,
} from './accounts';
import type { Operation } from './log';

/**
 * `computeAccountUsage` derivaba `monthKey` del reloj de pared:
 *
 * ```ts
 * const monthKey = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
 * ```
 *
 * Un test que depende del reloj de pared es un test que falla en una fecha que
 * nadie eligió. El spec previo lo esquivó anclando los fixtures al mes UTC **en
 * curso**, con helpers (`tsInMonth`, `previousMonthKey`) que缸 adaptan al reloj.
 *
 * Eso desactiva la bomba, pero no la elimina: el test sigue sin poder fijar una
 * fecha, así que no puede afirmar nada sobre la semántica de fin de mes. Y el
 * contrato ya tenía el patrón correcto dos líneas más arriba:
 * `getTodayOperations(allOps, todayDateKey = new Date()...)`.
 *
 * Estos tests fijan el mes explícitamente. Con `2026-03`, una operación de marzo
 * cuenta y una de febrero no — sin importar qué mes sea hoy.
 */
const cuenta: BankAccount = {
  id: 'acc-clock',
  bankName: 'Banesco Pago Móvil',
  bankCode: 'BANESCO',
  rail: 'PAGO_MOVIL',
  accountNumberMasked: '0414-***1234',
  dailyLimitVes: 100000,
  initialBalanceVes: 500000,
  monthlyLimitVes: 100000,
};

function compra(fechaIso: string, ves: number): Operation {
  return {
    id: `op-${fechaIso}-${ves}`,
    type: 'buy',
    pair: 'USDT',
    vesAmount: ves,
    usdtAmount: ves / 900,
    price: 900,
    merchantNote: '',
    fees: 0,
    notes: '',
    errorFree: true,
    timestamp: fechaIso,
    bankAccountId: cuenta.id,
  } as unknown as Operation;
}

describe('el mes de consumo se fija, no se hereda del reloj', () => {
  it('cuenta lo que pasó en el mes que se le pasa', () => {
    const usage = computeAccountUsage(cuenta, [compra('2026-03-15T10:00:00.000Z', 50_000)], '2026-03');

    expect(usage.consumedMonthlyLimitPct).toBe(50);
  });

  it('no cuenta el mes anterior aunque el reloj diga que sí', () => {
    const usage = computeAccountUsage(
      cuenta,
      [compra('2026-02-15T10:00:00.000Z', 90_000)],
      '2026-03',
    );

    // Con el reloj de pared, esto dependería de qué mes sea hoy. Fijado a marzo,
    // una compra de febrero no toca el límite de marzo. Ni sube ni baja: no existe.
    expect(usage.consumedMonthlyLimitPct).toBe(0);
    expect(usage.isOverMonthlyLimit).toBe(false);
  });

  it('la misma operación cuenta o no según el mes que se fije', () => {
    const ops = [compra('2026-03-15T10:00:00.000Z', 50_000)];

    const enMarzo = computeAccountUsage(cuenta, ops, '2026-03');
    const enAbril = computeAccountUsage(cuenta, ops, '2026-04');

    expect(enMarzo.consumedMonthlyLimitPct).toBe(50);
    expect(enAbril.consumedMonthlyLimitPct).toBe(0);
  });

  it('computeTreasurySummary reparte el mismo mes a todas las cuentas', () => {
    const ops = [compra('2026-03-15T10:00:00.000Z', 50_000)];

    const enMarzo = computeTreasurySummary([cuenta], ops, '2026-03');
    const enAbril = computeTreasurySummary([cuenta], ops, '2026-04');

    expect(enMarzo.totalSpentThisMonthVes).toBe(50_000);
    expect(enAbril.totalSpentThisMonthVes).toBe(0);
    expect(enMarzo.overMonthlyLimitCount).toBe(0);
    expect(enMarzo.nearMonthlyLimitCount).toBe(0);
  });

  it('la recomendación de cuenta no depende del mes, y su firma lo dice', () => {
    const ops = [compra('2026-03-15T10:00:00.000Z', 50_000)];

    // `recommendAccountForTrade` filtra por límite **diario** y saldo. `todayOps` ya
    // viene filtrado por el llamante, así que el mes no entra en la decisión.
    //
    // Se intentó agregar `monthKey` a su firma por simetría, y el test lo dejó
    // descubierto: el parámetro no podía cambiar el resultado. Un parámetro que no
    // puede alterar la salida es un contrato publicado que no existe — la misma
    // familia que un campo que se anuncia y se descarta en silencio.
    //
    // Así que la firma se queda en cuatro argumentos, y esta aserción falla si
    // alguien vuelve a colar un mes que no manda.
    expect(recommendAccountForTrade.length).toBe(4);

    const recomendada = recommendAccountForTrade([cuenta], 40_000, ops);
    expect(recomendada?.id).toBe(cuenta.id);
  });

  it('computeAccountUsage mantiene el límite diario independiente del mes', () => {
    const ops = [compra('2026-03-15T10:00:00.000Z', 50_000)];

    // El consumo diario viene de `todayOps`, que el llamante ya filtró. Por eso el
    // mes mueve `consumedMonthlyLimitPct` y **no** `remainingLimitVes`. Conviene
    // dejarlo escrito: es la razón por la que el mes no entró en la firma de
    // `recommendAccountForTrade`.
    const enMarzo = computeAccountUsage(cuenta, ops, '2026-03');
    const enAbril = computeAccountUsage(cuenta, ops, '2026-04');

    expect(enMarzo.remainingLimitVes).toBe(50_000);
    expect(enAbril.remainingLimitVes).toBe(50_000);
    expect(enMarzo.consumedMonthlyLimitPct).toBe(50);
    expect(enAbril.consumedMonthlyLimitPct).toBe(0);
  });

  it('sin el parámetro sigue funcionando: el reloj es el default, no una obligatoriedad', () => {
    const usage = computeAccountUsage(cuenta, [compra('2026-03-15T10:00:00.000Z', 0)]);

    expect(usage).toBeDefined();
    expect(usage.consumedMonthlyLimitPct).toBeGreaterThanOrEqual(0);
  });
});
