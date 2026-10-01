import { describe, it, expect } from 'vitest';
import { evaluateTradeRiskTool } from './tools/evaluate_trade_risk.js';

/**
 * Regresión para el defecto más grave de esta ronda.
 *
 * `evaluate_trade_risk` llenaba el `RuleContext` con constantes: `currentSpread: 1.25`,
 * `openOps: 1`, `dailyLossPct: 0` y `consecutiveErrors: score < 50 ? 2 : 0`. Cada una
 * caía del lado seguro de su propio umbral, así que las reglas 2 a 5 del motor eran
 * inalcanzables — no sólo wrong, sino imposible que dispararan.
 *
 * El síntoma observable: un trade con `counterpartyScore: 0`, el peor valor que el
 * schema acepta, devolvía
 *
 *   decision: 'ALLOW', reason: 'Todos los parámetros dentro de umbrales seguros',
 *   isCounterpartyAcceptable: false, violations: [], actionable: true
 *
 * Auto-contradicción en un mismo objeto: "tu contraparte no es aceptable" junto a
 * "todo dentro de umbrales seguros" y "dale". `violations` estaba vacío, así que nada
 * que un llamador evaluara lo frenaba.
 *
 * Estos tests fijan las cuatro propiedades que faltaban: que una contraparte mala
 * deniega, que sin estado del motor no hay ALLOW, y que las reglas 2 a 5 ahora sí
 * pueden dispararse.
 */

// Estado del motor que pasa todos los umbrales: spread 1.25 sobre un piso de 0.5,
// una operación abierta de un máximo de 3, pérdida del día bajo el tope de 10, sin
// errores consecutivos bajo el límite de 3.
const ENGINE_STATE_SAFE = {
  currentSpreadPct: 1.25,
  openOps: 1,
  dailyLossPct: 0.4,
  consecutiveErrors: 0,
} as const;

describe('evaluate_trade_risk: la contraparte manda sobre el veredicto', () => {
  it('un score de cero deniega en vez de permitir (la regresión principal)', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 10,
      currentCapitalUsdt: 5000,
      counterpartyScore: 0,
      ...ENGINE_STATE_SAFE,
    });

    // Antes de la corrección esto era 'ALLOW' con actionable:true.
    expect(res.decision).toBe('DENY');
    expect(res.actionable).toBe(true);
    expect(res.isCounterpartyAcceptable).toBe(false);
    expect(res.violations).toContain('COUNTERPARTY_BELOW_MIN_SCORE_70');
    // Y sobre todo: ya no afirma que todo está en umbrales seguros.
    expect(res.reason).not.toMatch(/seguros/i);
  });

  it('no permite un trade cuya contraparte está justo bajo el piso', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 10,
      currentCapitalUsdt: 5000,
      counterpartyScore: 69,
      ...ENGINE_STATE_SAFE,
    });

    expect(res.decision).toBe('DENY');
    expect(res.violations).toContain('COUNTERPARTY_BELOW_MIN_SCORE_70');
  });

  it('acepta una contraparte exactamente en el piso de 70', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 10,
      currentCapitalUsdt: 5000,
      counterpartyScore: 70,
      ...ENGINE_STATE_SAFE,
    });

    expect(res.decision).toBe('ALLOW');
    expect(res.isCounterpartyAcceptable).toBe(true);
  });

  it('una contraparte mala deniega aunque falte el estado del motor', () => {
    // Precedencia: una violación medida gana a "datos insuficientes". Enterrar un score
    // de 30 detrás de telemetría faltante escondería un hecho conocido.
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 10,
      currentCapitalUsdt: 5000,
      counterpartyScore: 30,
    });

    expect(res.decision).toBe('DENY');
    expect(res.violations).toContain('COUNTERPARTY_BELOW_MIN_SCORE_70');
    // Pero sigue diciendo qué no midió, para que el llamador no se lo trague como
    // un veredicto completo.
    expect(res.unmeasuredInputs).toContain('dailyLossPct');
  });
});

describe('evaluate_trade_risk: sin estado del motor no hay ALLOW', () => {
  it('se niega a evaluar cuando no sabe nada del estado', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
    });

    expect(res.decision).toBe('INSUFFICIENT_DATA');
    expect(res.actionable).toBe(false);
    expect(res.unmeasuredInputs).toEqual([
      'currentSpreadPct',
      'openOps',
      'dailyLossPct',
      'consecutiveErrors',
    ]);
    // No hay violación porque ninguna regla corrió.
    expect(res.violations).toEqual([]);
  });

  it('reporta el ratio de riesgo real aunque el motor no corra', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
    });

    // 100/5000 = 2%. Es una razón entre dos números medidos: no necesita estado.
    expect(res.tradeRiskPct).toBe(2);
  });

  it('no ofrece un tamaño recomendado si no pudo correr los frenos', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
    });

    expect(res.recommendedSizeUsdt).toBeNull();
  });

  it('un solo input medido no basta para el motor', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
      dailyLossPct: 0.4,
    });

    expect(res.decision).toBe('INSUFFICIENT_DATA');
    expect(res.unmeasuredInputs).toHaveLength(3);
  });
});

describe('evaluate_trade_risk: las reglas 2 a 5 ahora sí pueden dispararse', () => {
  it('regla 2 — una pérdida del día sobre el tope de 10 pausa', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
      currentSpreadPct: 1.25,
      openOps: 1,
      consecutiveErrors: 0,
      dailyLossPct: 12,
    });

    expect(res.decision).toBe('PAUSE');
    expect(res.violations.length).toBeGreaterThan(0);
  });

  it('regla 2 — un 40% de pérdida ya no se reporta como día limpio', () => {
    // El defecto original en su forma más cruda: `dailyLossPct: 0` respondía ALLOW a
    // un día que había perdido 40%.
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
      currentSpreadPct: 1.25,
      openOps: 1,
      consecutiveErrors: 0,
      dailyLossPct: 40,
    });

    expect(res.decision).toBe('PAUSE');
    expect(res.actionable).toBe(true);
  });

  it('regla 3 — errores consecutivos en el límite deniegan', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
      currentSpreadPct: 1.25,
      openOps: 1,
      dailyLossPct: 0.4,
      consecutiveErrors: 3,
    });

    expect(res.decision).toBe('DENY');
  });

  it('regla 4 — un spread bajo el piso de 0.5 pausa', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
      openOps: 1,
      dailyLossPct: 0.4,
      consecutiveErrors: 0,
      currentSpreadPct: 0.4,
    });

    expect(res.decision).toBe('PAUSE');
  });

  it('regla 5 — saturar las operaciones abiertas pausa', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
      currentSpreadPct: 1.25,
      dailyLossPct: 0.4,
      consecutiveErrors: 0,
      openOps: 3,
    });

    expect(res.decision).toBe('PAUSE');
  });

  it('regla 1 — el riesgo por trade sigue funcionando', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 2500, // 50% de capital, sobre el tope del 20%
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
      ...ENGINE_STATE_SAFE,
    });

    expect(res.decision).toBe('DENY');
    expect(res.tradeRiskPct).toBe(50);
  });

  it('con todo medido y dentro de límites, sí permite', () => {
    const res = evaluateTradeRiskTool.execute({
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
      ...ENGINE_STATE_SAFE,
    });

    expect(res.decision).toBe('ALLOW');
    expect(res.actionable).toBe(true);
    expect(res.unmeasuredInputs).toEqual([]);
    // 100 vs el tope de 1000 (20% de 5000).
    expect(res.recommendedSizeUsdt).toBe(100);
  });
});
