import { describe, expect, it } from 'vitest';
import { simulateMcpTool } from './mcp-fallbacks';

/**
 * El espejo (`mcp-fallbacks.ts`) es lo que corre cuando el daemon MCP no
 * responde. Su trabajo es no romper la UI, y eso lo cumple. Lo que NO puede hacer
 * es volver a fabricar las mediciones que el servidor MCP ya se negó a inventar.
 *
 * Contexto: en el commit 9200a4f el servidor cerró cuatro defaults — capital de
 * tesorería, score de contraparte, exposición corriente y límite diario. El espejo
 * tenía sus propios defaults para los mismos cuatro campos: `5000`, `98`, `400` y
 * `2500`. Los cuatro valores no coincidían con los del servidor que ya nadie
 * defendía, lo cual es peor que una simple copia: son números que no corresponden
 * ni al dato ni a la invencion declarada del servidor.
 *
 * El riesgo real: el espejo ya tenía `actionable: false`, y por eso este defecto
 * nunca habrá parecido grave. Pero `evaluate_trade_risk` publicaba `tradeRiskPct:
 * 10.0` calculado sobre un capital que nadie reportó, y `simulate_trade_impact`
 * publicaba `SIMULATED_WITHIN_LIMITS` con una utilización calculada sobre una
 * exposición y un límite inventados. Un `actionable: false` no vuelve honesto un
 * número falso: encerra la autorización, no la afirmación.
 *
 * Los defaults de `tradeAmountUsdt` (500) y `proposedTradeAmountUsdt` (600) están
 * en la misma categoría y son aún más graves: en el schema del servidor esos dos
 * campos son REQUERIDOS. El servidor rechaza la llamada entera si no vienen. El
 * espejo los rellenaba, así que un llamador que olvidaba el campo recibía una
 * simulación completa sobre un monto que nunca pidió.
 *
 * Estos tests fijan la misma semántica que el servidor: ausencia se declara como
 * ausencia, `null` no se convierte en `0`, y una ausencia no borra un
 * hallazgo que si se midio.
 */

const run = (toolName: string, args?: unknown) => simulateMcpTool(toolName, args, 1);

describe('espejo de evaluate_trade_risk — sin capital ni contraparte inventados', () => {
  it('sin capital NO calcula tradeRiskPct sobre un 5000 inventado', () => {
    const r = run('evaluate_trade_risk', {
      tradeAmountUsdt: 250,
      counterpartyScore: 90,
      currentSpreadPct: 1.4,
    });

    // El 10% que salía de 250/5000 era un ratio sobre una tesorería no reportada.
    expect(r['tradeRiskPct']).not.toBe(10);
    expect(r['tradeRiskPct']).toBeNull();
  });

  it('sin contraparte NO declara la contraparte aceptable por un 98 inventado', () => {
    const r = run('evaluate_trade_risk', {
      tradeAmountUsdt: 250,
      currentCapitalUsdt: 5000,
      currentSpreadPct: 1.4,
    });

    // El default era 98, así que `score >= 70` era siempre cierto y
    // `isCounterpartyAcceptable` realmente significaba "se pasó un score".
    expect(r['isCounterpartyAcceptable']).not.toBe(true);
    expect(r['isCounterpartyAcceptable']).toBeNull();
  });

  it('sin monto NO simula sobre un 500 inventado', () => {
    const r = run('evaluate_trade_risk', {
      counterpartyScore: 90,
      currentCapitalUsdt: 5000,
      currentSpreadPct: 1.4,
    });

    // El schema del servidor declara `tradeAmountUsdt` como requerido. El espejo
    // lo rellenaba, así que una llamada incompleta devolvía un veredicto.
    expect(r['decision']).toBe('UNAVAILABLE');
    expect(r['tradeRiskPct']).toBeNull();
    expect(r['recommendedSizeUsdt']).toBeNull();
  });

  it('declara cuál evidencia falta, en vez de devolver un número', () => {
    const r = run('evaluate_trade_risk', { tradeAmountUsdt: 250, currentSpreadPct: 1.4 });

    expect(r['unavailableReason']).toBe('missing_evidence:currentCapital');
    expect(r['decision']).toBe('UNAVAILABLE');
    expect(r['actionable']).toBe(false);
  });

  it('un limite de tamano contra capital no_reportado es ausencia', () => {
    const r = run('evaluate_trade_risk', {
      tradeAmountUsdt: 250,
      counterpartyScore: 90,
      currentSpreadPct: 1.4,
    });

    // `recommendedSizeUsdt` era `Math.min(250, (5000 * 20) / 100)`. Un tamaño
    // recomendado sobre capital no reportado es un número del que se dimensiona una
    // orden.
    expect(r['recommendedSizeUsdt']).not.toBe(250);
    expect(r['recommendedSizeUsdt']).toBeNull();
  });

  it('con capital, contraparte y monto reales SÍ calcula', () => {
    const r = run('evaluate_trade_risk', {
      tradeAmountUsdt: 250,
      currentCapitalUsdt: 5000,
      counterpartyScore: 90,
      currentSpreadPct: 1.4,
    });

    // 250/5000 = 5%
    expect(r['tradeRiskPct']).toBe(5);
    expect(r['isCounterpartyAcceptable']).toBe(true);
    expect(r['decision']).not.toBe('UNAVAILABLE');
  });

  it('un score bajo es una contraparte NO aceptable, no una ausencia', () => {
    const r = run('evaluate_trade_risk', {
      tradeAmountUsdt: 250,
      currentCapitalUsdt: 5000,
      counterpartyScore: 40,
      currentSpreadPct: 1.4,
    });

    // El dato existe y es malo. Declararlo ausente sería perder el hallazgo.
    expect(r['isCounterpartyAcceptable']).toBe(false);
    expect(r['unavailableReason']).toBeNull();
  });
});

describe('espejo de evaluate_trade_risk — los frenos del motor no se rellenan con constantes', () => {
  const ENGINE_STATE_SAFE = {
    currentSpreadPct: 1.25,
    openOps: 1,
    dailyLossPct: 0.4,
    consecutiveErrors: 0,
  } as const;

  it('un score de contraparte bajo 70 deniega en vez de permitir (la contraparte manda)', () => {
    const r = run('evaluate_trade_risk', {
      tradeAmountUsdt: 10,
      currentCapitalUsdt: 5000,
      counterpartyScore: 0,
      ...ENGINE_STATE_SAFE,
    });

    expect(r['decision']).toBe('DENY');
    expect(r['isCounterpartyAcceptable']).toBe(false);
    expect(r['violations']).toContain('COUNTERPARTY_BELOW_MIN_SCORE_70');
  });

  it('no permite un trade cuya contraparte está en 69', () => {
    const r = run('evaluate_trade_risk', {
      tradeAmountUsdt: 10,
      currentCapitalUsdt: 5000,
      counterpartyScore: 69,
      ...ENGINE_STATE_SAFE,
    });

    expect(r['decision']).toBe('DENY');
    expect(r['violations']).toContain('COUNTERPARTY_BELOW_MIN_SCORE_70');
  });

  it('acepta una contraparte en 70 con estado seguro del motor', () => {
    const r = run('evaluate_trade_risk', {
      tradeAmountUsdt: 10,
      currentCapitalUsdt: 5000,
      counterpartyScore: 70,
      ...ENGINE_STATE_SAFE,
    });

    expect(r['decision']).toBe('ALLOW');
    expect(r['isCounterpartyAcceptable']).toBe(true);
    expect(r['unmeasuredInputs']).toEqual([]);
  });

  it('una contraparte mala deniega aunque falte telemetría del motor', () => {
    const r = run('evaluate_trade_risk', {
      tradeAmountUsdt: 10,
      currentCapitalUsdt: 5000,
      counterpartyScore: 40,
    });

    expect(r['decision']).toBe('DENY');
    expect(r['isCounterpartyAcceptable']).toBe(false);
    expect(r['violations']).toContain('COUNTERPARTY_BELOW_MIN_SCORE_70');
    expect(r['unmeasuredInputs']).toContain('dailyLossPct');
  });

  it('sin estado del motor responde INSUFFICIENT_DATA sin inventar constantes seguras', () => {
    const r = run('evaluate_trade_risk', {
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 90,
    });

    expect(r['decision']).toBe('INSUFFICIENT_DATA');
    expect(r['recommendedSizeUsdt']).toBeNull();
    expect(r['violations']).toEqual([]);
    expect(r['unmeasuredInputs']).toEqual([
      'currentSpreadPct',
      'openOps',
      'dailyLossPct',
      'consecutiveErrors',
    ]);
  });

  it('las reglas 2 a 5 ahora sí disparan en el espejo y no quedan ocultas tras constantes', () => {
    // Regla 2: pérdida diaria >= 10%
    const rLoss = run('evaluate_trade_risk', {
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 90,
      currentSpreadPct: 1.25,
      openOps: 1,
      dailyLossPct: 15,
      consecutiveErrors: 0,
    });
    expect(rLoss['decision']).toBe('PAUSE');

    // Regla 3: errores consecutivos >= 3
    const rErrors = run('evaluate_trade_risk', {
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 90,
      currentSpreadPct: 1.25,
      openOps: 1,
      dailyLossPct: 0.4,
      consecutiveErrors: 3,
    });
    expect(rErrors['decision']).toBe('PAUSE');

    // Regla 4: spread bajo el mínimo de 0.5
    const rSpread = run('evaluate_trade_risk', {
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 90,
      currentSpreadPct: 0.2,
      openOps: 1,
      dailyLossPct: 0.4,
      consecutiveErrors: 0,
    });
    expect(rSpread['decision']).toBe('DENY');

    // Regla 5: operaciones concurrentes >= 3
    const rOps = run('evaluate_trade_risk', {
      tradeAmountUsdt: 100,
      currentCapitalUsdt: 5000,
      counterpartyScore: 90,
      currentSpreadPct: 1.25,
      openOps: 3,
      dailyLossPct: 0.4,
      consecutiveErrors: 0,
    });
    expect(rOps['decision']).toBe('PAUSE');
  });
});

describe('espejo de simulate_trade_impact — sin exposición ni límite inventados', () => {
  it('sin exposición NO proyecta sobre un 400 inventado', () => {
    const r = run('simulate_trade_impact', {
      proposedTradeAmountUsdt: 600,
      maxDailyExposureLimitUsdt: 2500,
    });

    expect(r['currentExposureUsdt']).toBeNull();
    expect(r['projectedExposureUsdt']).toBeNull();
  });

  it('sin límite NO calcula utilización sobre un 2500 inventado', () => {
    const r = run('simulate_trade_impact', {
      proposedTradeAmountUsdt: 600,
      currentExposureUsdt: 400,
    });

    expect(r['exposureUtilizationPct']).toBeNull();
    expect(r['maxSafeRemainingUsdt']).toBeNull();
    expect(r['limitExceeded']).toBeNull();
  });

  it('sin monto NO proyecta sobre un 600 inventado', () => {
    const r = run('simulate_trade_impact', {
      currentExposureUsdt: 400,
      maxDailyExposureLimitUsdt: 2500,
    });

    // `proposedTradeAmountUsdt` es requerido en el schema del servidor.
    expect(r['projectedExposureUsdt']).toBeNull();
    expect(r['verdict']).toBe('UNAVAILABLE');
    expect(r['actionable']).toBe(false);
  });

  it('no declara EXCEED cuando el límite no se eligió', () => {
    const r = run('simulate_trade_impact', {
      proposedTradeAmountUsdt: 9999,
      currentExposureUsdt: 400,
    });

    // 400 + 9999 contra el 2500 inventado dispara la alarma. Ese verde/rojo era
    // una decisión tomada con un límite que nadie eligió.
    expect(r['wouldTrigger']).not.toContain('DAILY_EXPOSURE_LIMIT_EXCEEDED');
    expect(r['unavailableReason']).toBe('missing_evidence:maxDailyExposureLimit');
    expect(r['actionable']).toBe(false);
  });

  it('no declara EXCEEDED cuando la exposición no se midió', () => {
    const r = run('simulate_trade_impact', {
      proposedTradeAmountUsdt: 600,
      maxDailyExposureLimitUsdt: 2500,
    });

    expect(r['wouldTrigger']).not.toContain('DAILY_EXPOSURE_LIMIT_EXCEEDED');
    expect(r['unavailableReason']).toBe('missing_evidence:currentExposure');
  });

  it('un hallazgo medido sobrevive a la ausencia de otro campo', () => {
    const r = run('simulate_trade_impact', {
      proposedTradeAmountUsdt: 600,
      currentExposureUsdt: 400,
      maxDailyExposureLimitUsdt: 2500,
      consecutiveLosses: 3,
    });

    // Igual que en el servidor: una regla conocida sobre datos conocidos se
    // sostiene. `REQUIRES_REDUCTION` es una orden de no crecer, no un permiso.
    expect(r['wouldTrigger']).toContain('MAX_CONSECUTIVE_LOSSES_TRIGGERED');
    expect(r['verdict']).toBe('REQUIRES_REDUCTION');
  });

  it('un hallazgo medido sobrevive aunque falte el límite', () => {
    const r = run('simulate_trade_impact', {
      proposedTradeAmountUsdt: 600,
      consecutiveLosses: 4,
    });

    // Sobre-suprimir sería sobre-corregir: el límite ausente no vuelve falso un
    // disparo de pérdidas consecutivas que sí se midió.
    expect(r['wouldTrigger']).toContain('MAX_CONSECUTIVE_LOSSES_TRIGGERED');
    expect(r['verdict']).toBe('REQUIRES_REDUCTION');
    expect(r['unavailableReason']).toBe('missing_evidence:maxDailyExposureLimit');
  });

  it('con exposición y límite medidos SÍ calcula la utilización', () => {
    const r = run('simulate_trade_impact', {
      proposedTradeAmountUsdt: 600,
      currentExposureUsdt: 400,
      maxDailyExposureLimitUsdt: 2500,
    });

    // (400 + 600) / 2500 = 40%
    expect(r['projectedExposureUsdt']).toBe(1000);
    expect(r['exposureUtilizationPct']).toBe(40);
    expect(r['limitExceeded']).toBe(false);
    expect(r['maxSafeRemainingUsdt']).toBe(2100);
    expect(r['unavailableReason']).toBeNull();
  });

  it('una exposición mayor al límite REAL sigue disparando', () => {
    const r = run('simulate_trade_impact', {
      proposedTradeAmountUsdt: 3000,
      currentExposureUsdt: 400,
      maxDailyExposureLimitUsdt: 2500,
    });

    expect(r['limitExceeded']).toBe(true);
    expect(r['wouldTrigger']).toContain('DAILY_EXPOSURE_LIMIT_EXCEEDED');
    expect(r['verdict']).toBe('REQUIRES_REDUCTION');
  });
});
