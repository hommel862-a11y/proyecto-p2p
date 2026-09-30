import { describe, expect, it } from 'vitest';

import { readMarketRate, simulateMcpTool } from './mcp-fallbacks';

/**
 * Estas pruebas nacen de un incidente, no de cobertura.
 *
 * El síntoma original: con el daemon MCP caído, `simulateMcpTool` respondía
 * `get_bcv_rates → 72.45` y `get_parallel_rates → 84.12`. El operador veRates
 * "72.45 BCV / 84.12 paralelo" y entiende que hay una brecha de +16.11%.
 *
 * La brecha no existía. Las tasas reales observadas ese día fueron 857.8876 y
 * 958.580188. Los defaults estaban más de 10x lejos, así que no eran ni
 * redondeos ni placeholders tolerables: describían un mercado inexistente, y un
 * LMC que razona sobre "16% de brecha" convierte eso en una entrada.
 *
 * Una prueba que verifica que la función devuelve *algún número* no atrapa este
 * bug. Por eso cada caso acá tiene dos mitades:
 *
 *   1. SIN el dato, el campo dependiente va en `null` y se declara el motivo.
 *      (Si alguien reintroduce el default, esto falla.)
 *   2. CON el dato real, el campo vale el número real. (Esto prueba que no
 *      arreglamos el bug apagando la herramienta entera.)
 *
 * Los valores reales se usan a propósito. Un default "razonable" como 950
 * pasaría un test de "número plausible" y seguiría mintiendo.
 */

/** Tasas reales de Cotizave observadas durante el incidente. */
const REAL = {
  bcvUsd: 857.8876,
  parallelAverage: 958.580188,
} as const;

/** Cuánto estaba realmente el mercado por encima del oficial. */
const REAL_GAP_PCT =
  Math.round(((REAL.parallelAverage - REAL.bcvUsd) / REAL.bcvUsd) * 10000) / 100;

const run = (toolName: string, args?: unknown) => simulateMcpTool(toolName, args, 1);

/**
 * Verifica el contrato de ausencia: valor en `null`, motivo declarado y nada
 * accionable. Es el invariante que comparten todas las herramientas tocadas.
 */
function expectDeclaredAbsence(
  result: Record<string, unknown>,
  fields: string[],
): void {
  for (const field of fields) {
    expect(result[field], `campo ${field} debe ir en null`).toBeNull();
  }
  expect(result['rateStatus']).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
  expect(result['unavailableReason']).toBeTruthy();
  expect(result['expectedSource']).toBeTruthy();
  expect(result['actionable']).toBe(false);
}

describe('readMarketRate — la pieza que faltaba', () => {
  it('degrada a ausencia cuando el argumento no viene', () => {
    const reading = readMarketRate({}, 'bcvRate', 'Cotizave oficial');

    expect(reading.value).toBeNull();
    expect(reading.reason).toBe('FALTA_ARGUMENTO_bcvRate');
    expect(reading.expectedSource).toBe('Cotizave oficial');
  });

  it('degrada a ausencia cuando el argumento no es plausible', () => {
    // Un 0 o un NaN no son "tasa desconocida": son datos corruptos, y
    // distinguirlos del ausente evita que un feed roto parezca una pausa.
    expect(readMarketRate({ bcvRate: 0 }, 'bcvRate', 'src').reason).toBe(
      'ARGUMENTO_bcvRate_NO_PLAUSIBLE',
    );
    expect(readMarketRate({ bcvRate: -857 }, 'bcvRate', 'src').reason).toBe(
      'ARGUMENTO_bcvRate_NO_PLAUSIBLE',
    );
    expect(readMarketRate({ bcvRate: 'mucho' }, 'bcvRate', 'src').reason).toBe(
      'ARGUMENTO_bcvRate_NO_PLAUSIBLE',
    );
  });

  it('respeta un 0 legítimo de argumento (no es una tasa, pero no se pierde)', () => {
    // El guard de plausibilidad es del CONSUMIDOR de la tasa, no de la lectura.
    // Leer 0 debe devolver 0; el que decide si 0 es una tasa válida es quien
    // llama. Así el helper no se roba una regla de negocio de otro nivel.
    const reading = readMarketRate({ someFlag: 0 }, 'someFlag', 'src');
    expect(reading.value).toBeNull();
    expect(reading.reason).toBe('ARGUMENTO_someFlag_NO_PLAUSIBLE');
  });

  it('devuelve el valor tal cual cuando la tasa viene', () => {
    const reading = readMarketRate({ bcvRate: REAL.bcvUsd }, 'bcvRate', 'Cotizave oficial');

    expect(reading.value).toBe(REAL.bcvUsd);
    expect(reading.reason).toBeNull();
    expect(reading.expectedSource).toBe('Cotizave oficial');
  });

  it('no se rompe con args nulos, indefinidos o de otro tipo', () => {
    // `args` viene del transporte MCP: puede ser null, undefined o un string
    // si el agente manda algo raro. Ninguno de esos puede romper el fallback.
    for (const bad of [null, undefined, 42, 'texto', []]) {
      expect(readMarketRate(bad, 'bcvRate', 'src').value).toBeNull();
    }
  });
});

describe('simulateMcpTool — sin dato antes que dato inventado', () => {
  it('get_bcv_rates NO devuelve 72.45 cuando no hay daemon', () => {
    const result = run('get_bcv_rates');

    // La regresión literal. Si esto vuelve a 72.45, el incidente volvió.
    expect(result['usd']).not.toBe(72.45);
    expectDeclaredAbsence(result, ['usd', 'eur', 'cny', 'rub', 'effectiveDate']);
    expect(result['source']).toBe('SIN_FUENTE_EN_VIVO');
    expect(result['isFallback']).toBe(true);
  });

  it('get_parallel_rates NO devuelve 84.12 ni su spread derivado', () => {
    const result = run('get_parallel_rates');

    expect(result['average']).not.toBe(84.12);
    // El spread era la consecuencia agregada de la invención: si los cuatro
    // venues son desconocido, el spread también lo es.
    expectDeclaredAbsence(result, [
      'enparalelovzla',
      'cotizave',
      'criptonoticias',
      'spreadOverBcvPct',
    ]);
  });

  it('get_bcv_rates y get_parallel_rates SÍ devuelven la tasa si se les pasa', () => {
    // Mitad 2: no arreglamos el bug apagando la herramienta.
    const bcv = run('get_bcv_rates', { usd: REAL.bcvUsd });
    expect(bcv['usd']).toBe(REAL.bcvUsd);
    expect(bcv['rateStatus']).toBeUndefined();

    const parallel = run('get_parallel_rates', { average: REAL.parallelAverage });
    expect(parallel['average']).toBe(REAL.parallelAverage);
    expect(parallel['rateStatus']).toBeUndefined();
  });

  it('calculate_rate_gap sin tasas NO devuelve la brecha de 16.11%', () => {
    const result = run('calculate_rate_gap');

    expect(result['gapPct']).not.toBe(16.11);
    expectDeclaredAbsence(result, [
      'officialBcv',
      'parallelAverage',
      'gapVes',
      'gapPct',
      'riskClassification',
    ]);
  });

  it('calculate_rate_gap calcula la brecha REAL cuando llegan las tasas', () => {
    const result = run('calculate_rate_gap', {
      bcvRate: REAL.bcvUsd,
      parallelRate: REAL.parallelAverage,
    });

    expect(result['officialBcv']).toBe(REAL.bcvUsd);
    expect(result['parallelAverage']).toBe(REAL.parallelAverage);
    expect(result['gapPct']).toBe(REAL_GAP_PCT);
    expect(result['gapPct']).toBeGreaterThan(0);
    // 11.74% cae en MODERATE_DISTORTION según los cortes del propio fallback
    // (>20 SEVERE, >10 MODERATE). La clasificación se afirma contra la función,
    // no contra una suposición mía.
    expect(result['riskClassification']).toBe('MODERATE_DISTORTION');
    expect(result['unavailableReason']).toBeUndefined();
  });

  it('calculate_rate_gap declara ausencia si solo llega UNA de las dos tasas', () => {
    // El caso parcial es el que más miente: si solo hay BCV, "la brecha" no es
    // cero, es desconocida.
    const soloBcv = run('calculate_rate_gap', { bcvRate: REAL.bcvUsd });
    expect(soloBcv['gapPct']).toBeNull();
    expect(soloBcv['riskClassification']).toBeNull();
    expect(soloBcv['unavailableReason']).toBe('FALTA_ARGUMENTO_parallelRate');

    const soloParallel = run('calculate_rate_gap', { parallelRate: REAL.parallelAverage });
    expect(soloParallel['gapPct']).toBeNull();
    expect(soloParallel['unavailableReason']).toBe('FALTA_ARGUMENTO_bcvRate');
  });

  it('forecast_volatility_window NO recomienda acción sin las dos tasas', () => {
    const result = run('forecast_volatility_window');

    expect(result['gapPct']).not.toBe(16.11);
    // Una recomendación de acción sin brecha es la forma más peligrosa de
    // mentir: el LMC la ejecuta.
    expectDeclaredAbsence(result, [
      'gapPct',
      'isInBcvInterventionWindow',
      'bcvPhase',
      'tacticalRecommendation',
      'spreadDynamic',
      'suggestedAction',
    ]);
  });

  it('forecast_volatility_window pronostica con las tasas reales', () => {
    const result = run('forecast_volatility_window', {
      bcvRate: REAL.bcvUsd,
      parallelRate: REAL.parallelAverage,
    });

    expect(result['gapPct']).toBe(REAL_GAP_PCT);
    expect(result['suggestedAction']).toBeTruthy();
    expect(result['unavailableReason']).toBeUndefined();
  });

  it('calculate_delta_neutral_hedge NO dimensiona una cobertura sobre 84.12', () => {
    const result = run('calculate_delta_neutral_hedge');

    expect(result['usdtReferencePrice']).not.toBe(84.12);
    expectDeclaredAbsence(result, [
      'usdtReferencePrice',
      'usdtValueEquivalent',
      'requiredShortHedgeUsdt',
      'projectedLossIfUnhedged5PctUsd',
      'recommendedInstrument',
    ]);
  });

  it('calculate_delta_neutral_hedge dimensiona con la tasa real', () => {
    const result = run('calculate_delta_neutral_hedge', {
      usdtReferencePrice: REAL.parallelAverage,
    });

    expect(result['usdtReferencePrice']).toBe(REAL.parallelAverage);
    // 120000 VES / 958.58 ≈ 125.19 USDT.
    expect(result['usdtValueEquivalent']).toBeCloseTo(125.19, 2);
    expect(result['humanInTheLoopNotice']).toBeTruthy();
  });

  it('autofill_trade_reference NO sugiere precio de publicación sin el medio', () => {
    const result = run('autofill_trade_reference');

    expect(result['referenceMidRate']).not.toBe(84.12);
    expectDeclaredAbsence(result, [
      'referenceMidRate',
      'suggestedPrice',
      'marginVes',
      'executionAdvice',
      'formattedSummary',
    ]);
  });

  it('autofill_trade_reference sugiere con el medio real', () => {
    const result = run('autofill_trade_reference', {
      fallbackRate: REAL.parallelAverage,
      side: 'BUY',
      targetMarginPct: 1.2,
    });

    expect(result['referenceMidRate']).toBe(REAL.parallelAverage);
    // Compra 1.2% por debajo del medio: 958.580188 − 11.50 = 947.08.
    expect(result['suggestedPrice']).toBeLessThan(REAL.parallelAverage);
    expect(result['suggestedPrice']).toBe(947.08);
  });

  it('recommend_competitive_pricing NO compite contra un medio inventado', () => {
    const result = run('recommend_competitive_pricing');

    expect(result['currentMarketMid']).not.toBe(84.12);
    expectDeclaredAbsence(result, [
      'currentMarketMid',
      'suggestedPrice',
      'competitorPrice',
      'marginVes',
      'isWithinSafeBoundaries',
      'advice',
      'executionSummary',
    ]);
  });

  it('get_binance_p2p_orderbook NO inventa un libro de ofertas', () => {
    // El peor caso: un libro inventado no es contexto, ES la afirmación "estas
    // son las ofertas del mercado ahora", y la herramienta de pricing compite
    // contra él.
    const result = run('get_binance_p2p_orderbook');

    expect(result['topBuyPrice']).not.toBe(82.2);
    expect(result['topSellPrice']).not.toBe(82.85);
    expectDeclaredAbsence(result, [
      'topBuyPrice',
      'topSellPrice',
      'spreadVes',
      'spreadPct',
      'totalBuyDepthUsdt',
      'totalSellDepthUsdt',
      'buyOffersCount',
      'sellOffersCount',
    ]);
  });

  it('get_binance_p2p_orderbook deriva el spread de un libro real', () => {
    const result = run('get_binance_p2p_orderbook', {
      topBuyPrice: REAL.parallelAverage,
      topSellPrice: REAL.parallelAverage * 1.01,
    });

    expect(result['topBuyPrice']).toBe(REAL.parallelAverage);
    expect(result['spreadPct']).toBeCloseTo(1, 2);
    expect(result['unavailableReason']).toBeUndefined();
  });

  it('stress_test_portfolio NO emite escenarios de solvencia sobre 84.12', () => {
    const result = run('stress_test_portfolio');

    expect(result['referenceRate']).not.toBe(84.12);
    expectDeclaredAbsence(result, [
      'referenceRate',
      'baselinePortfolioValueUsdt',
      'vesExposureUsdt',
      'scenarios',
      'scenariosCount',
      'recommendedHedgeUsdt',
      'institutionalSummary',
    ]);
  });

  it('stress_test_portfolio corre escenarios con la tasa real', () => {
    const result = run('stress_test_portfolio', { referenceRate: REAL.parallelAverage });

    expect(result['referenceRate']).toBe(REAL.parallelAverage);
    expect(Array.isArray(result['scenarios'])).toBe(true);
    expect(result['scenariosCount']).toBe(3);
  });

  it('rebalance_capital_allocation NO reparte capital sin tasa de referencia', () => {
    const result = run('rebalance_capital_allocation');

    expect(result['referenceRate']).not.toBe(84.12);
    expectDeclaredAbsence(result, [
      'referenceRate',
      'allocations',
      'dynamicLimits',
      'strategicNotes',
      'activeChannelsCount',
    ]);
  });

  it('rebalance_capital_allocation planifica con la tasa real', () => {
    const result = run('rebalance_capital_allocation', { referenceRate: REAL.parallelAverage });

    expect(result['referenceRate']).toBe(REAL.parallelAverage);
    expect(Array.isArray(result['allocations'])).toBe(true);
  });

  it('project_compound_runway NO proyecta cobertura con 84.12 hardcodeado', () => {
    const result = run('project_compound_runway');

    expect(result['referenceRateVes']).not.toBe(84.12);
    expectDeclaredAbsence(result, [
      'referenceRateVes',
      'projectedFinalCapitalUsdt',
      'totalNetProfitUsdt',
      'milestones',
      'monthlyRunwayCoverageMonths',
      'hasReachedBankingWall',
      'executiveSummary',
    ]);
  });

  it('project_compound_runway proyecta con la tasa real', () => {
    const result = run('project_compound_runway', { referenceRateVes: REAL.parallelAverage });

    expect(result['referenceRateVes']).toBe(REAL.parallelAverage);
    expect(result['projectedFinalCapitalUsdt']).toBeGreaterThan(0);
  });

  it('toda herramienta tocada conserva el envoltorio degradado', () => {
    // La ausencia de la tasa no puede mejorar el estado de la herramienta: sigue
    // siendo una simulación sin daemon, y eso va declarado arriba de todo.
    for (const tool of [
      'get_bcv_rates',
      'get_parallel_rates',
      'calculate_rate_gap',
      'forecast_volatility_window',
      'calculate_delta_neutral_hedge',
      'autofill_trade_reference',
      'recommend_competitive_pricing',
      'get_binance_p2p_orderbook',
      'stress_test_portfolio',
      'rebalance_capital_allocation',
      'project_compound_runway',
    ]) {
      const result = run(tool);
      expect(result['simulated'], tool).toBe(true);
      expect(result['actionable'], tool).toBe(false);
      expect((result['availability'] as { degraded: boolean }).degraded, tool).toBe(true);
    }
  });

  it('ninguna tasa inventada sobrevive en las herramientas de mercado', () => {
    // Red de contención: los defaults históricos del archivo, por si alguien
    // reintroduce uno con otro nombre de variable.
    const inventadas = [72.45, 84.12, 82.85, 82.2, 51.3, 16.11, 4250, 4210];
    const herramientasMercado = [
      'get_bcv_rates',
      'get_parallel_rates',
      'calculate_rate_gap',
      'forecast_volatility_window',
      'calculate_delta_neutral_hedge',
      'autofill_trade_reference',
      'recommend_competitive_pricing',
      'get_binance_p2p_orderbook',
      'stress_test_portfolio',
      'rebalance_capital_allocation',
      'project_compound_runway',
    ];

    for (const tool of herramientasMercado) {
      const serializado = JSON.stringify(run(tool));
      for (const tasa of inventadas) {
        expect(serializado, `${tool} no debe emitir ${tasa}`).not.toContain(`:${tasa}`);
      }
    }
  });
});
