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
const REAL_GAP_PCT = Math.round(((REAL.parallelAverage - REAL.bcvUsd) / REAL.bcvUsd) * 10000) / 100;

const run = (toolName: string, args?: unknown) => simulateMcpTool(toolName, args, 1);

/**
 * Herramientas cuya lectura de mercado es una tasa única. Son las del incidente
 * original (BCV/paralelo) más las que se corrigieron después.
 */
const TOOLS_DE_LECTURA = [
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
] as const;

/**
 * Las 17 herramientas del barrido de precios, libro y anuncios. Se prueban todas
 * con el input vacío porque ese es el estado en el que el archivo solía fabricar.
 */
const HERRAMIENTAS_DEL_BARRIDO = [
  'calculate_spread',
  'forecast_volatility_window',
  'detect_usdt_depeg',
  'recommend_competitive_pricing',
  'analyze_orderbook_pressure',
  'fetch_cross_exchange_spread',
  'scan_synthetic_stable_arbitrage',
  'audit_distressed_liquidity_sniper',
  'query_otc_darkpool_spread',
  'route_fintech_payroll_settlement',
  'recommend_counterparty_yield_price',
  'process_concierge_inquiry',
  'predict_bcv_macro_regime',
  'evaluate_ad_repricing',
  'publish_ad_price',
  'audit_ad_competitiveness',
  'add_operation_entry',
] as const;

/**
 * Cada número que el archivo solía emitir como si fuera una observación. La lista
 * es acumulativa: los defaults del incidente (72.45, 84.12) más los del barrido de
 * precios, libro, anuncios younterparties.
 */
const NUMEROS_INVENTADOS = [
  // Incidente original: BCV / paralelo / brecha.
  72.45, 84.12, 51.3, 16.11,
  // Libro y orderbook P2P.
  82.2, 82.85, 82.0, 9500, 8000, 18000, 14000,
  // Spreads y precios de anuncio.
  78.5, 79.8, 78.85, 79.95, 78.8, 80.0, 82.5,
  // Tasa de despeg y venues.
  0.9992, 4250, 4210, 79.2, 85.2, 86.8, 83.5, 88.5,
  // Concierge, contraparte, macro y snipeo.
  87.0, 85.5, 80.0, 91.5, 86.5, 850,
] as const;

/**
 * Verifica el contrato de ausencia: valor en `null`, motivo declarado y nada
 * accionable. Es el invariante que comparten todas las herramientas tocadas.
 */
function expectDeclaredAbsence(result: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) {
    expect(result[field], `campo ${field} debe ir en null`).toBeNull();
  }
  expect(result['rateStatus']).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
  expect(result['unavailableReason']).toBeTruthy();
  expect(result['expectedSource']).toBeTruthy();
  expect(result['actionable']).toBe(false);
}

/**
 * Ausencia PARCIAL: falta una lectura dentro de una respuesta que sí trae otras
 * reales.
 *
 * No lleva `rateStatus` a propósito: afirmarlo diría "ninguna lectura de mercado
 * existe acá" y el LMC descartaría también las tasas que sí llegaron. Es el error
 * espejo del que se está barriendo.
 */
function expectPartialAbsence(result: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) {
    expect(result[field], `campo ${field} debe ir en null`).toBeNull();
  }
  expect(result['rateStatus']).toBeUndefined();
  expect(result['unavailableReason']).toBeTruthy();
  expect(result['expectedSource']).toBeTruthy();
  expect(result['actionable']).toBe(false);
}

/**
 * Red de contención: verifica que la respuesta serializada NO contenga ninguno de
 * los números que el archivo solía emitir como si fueran observaciones.
 *
 * El anclaje importa: `:8000` no debe coincidir con `:80000`, que es el
 * `unhedgedVesAmount` legítimo que sale del capital de cuenta de la mesa.
 */
function expectNoInventedNumbers(serializado: string, tool: string): void {
  for (const numero of NUMEROS_INVENTADOS) {
    const patron = new RegExp(`:${String(numero).replace('.', '\\.')}(?![0-9])`);
    expect(patron.test(serializado), `${tool} no debe emitir ${numero}`).toBe(false);
  }
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
    // La profundidad del libro también es una lectura: sin ella la acción operativa
    // queda en null aunque las tasas sean reales (test siguiente).
    const result = run('forecast_volatility_window', {
      bcvRate: REAL.bcvUsd,
      parallelRate: REAL.parallelAverage,
      bidDepthUsdt: 19000,
      askDepthUsdt: 14000,
    });

    expect(result['gapPct']).toBe(REAL_GAP_PCT);
    expect(result['spreadDynamic']).toBeTruthy();
    expect(result['suggestedAction']).toBeTruthy();
    expect(result['unavailableReason']).toBeUndefined();
  });

  it('forecast_volatility_window NO recommends acción sin profundidad de libro real', () => {
    // Con las dos tasas reales pero SIN libro, la respuesta anterior era
    // 'Operar con volumen normal' —una instrucción operativa— evaluada sobre 9500/
    // 8000 inventados. Ahora la acción es ausencia parcial: la brecha es real, la
    // recomendación no.
    const result = run('forecast_volatility_window', {
      bcvRate: REAL.bcvUsd,
      parallelRate: REAL.parallelAverage,
    });

    expect(result['gapPct']).toBe(REAL_GAP_PCT);
    expectPartialAbsence(result, [
      'bidDepthUsdt',
      'askDepthUsdt',
      'spreadDynamic',
      'suggestedAction',
    ]);
    expect(result['unavailableReason']).toBe('FALTA_ARGUMENTO_bidDepthUsdt');
  });

  it('calculate_spread NO declara viable un spread sobre precios inventados', () => {
    // La regresión central de este barrido: sin precios, el bloque usaba 78.5/79.8,
    // sacaba 1.3% neto y respondía `isGoldenSpread: true` con
    // `recommendation: 'VIABLE_INSTITUCIONAL'`. Con `false` tampoco se afirma nada,
    // porque `false` es un veredicto: el veredicto necesita los dos lados del libro.
    const result = run('calculate_spread');

    expect(result['isGoldenSpread']).not.toBe(true);
    expect(result['recommendation']).not.toBe('VIABLE_INSTITUCIONAL');
    expectDeclaredAbsence(result, [
      'buyPrice',
      'sellPrice',
      'unitSpread',
      'grossSpreadPercent',
      'netGainVes',
      'netSpreadPercent',
      'isGoldenSpread',
      'recommendation',
    ]);
  });

  it('calculate_spread calcula el veredicto con los precios que el llamante envía', () => {
    // Mismos números que el default usaba, pero ahora los envía la mesa como
    // observación: 78.5 → 79.8 sobre 100 USDT con 0.35% de fee da 1.3% neto, que
    // supera el umbral dorado de 0.5%.
    const result = run('calculate_spread', { buyPrice: 78.5, sellPrice: 79.8 });

    expect(result['buyPrice']).toBe(78.5);
    expect(result['sellPrice']).toBe(79.8);
    expect(result['unitSpread']).toBe(1.3);
    expect(result['netGainVes']).toBe(102.07);
    expect(result['netSpreadPercent']).toBeCloseTo(1.3, 2);
    expect(result['isGoldenSpread']).toBe(true);
    expect(result['recommendation']).toBe('VIABLE_INSTITUCIONAL');
    // Los fees son parámetros del exchange, no lecturas: se devuelven para que el
    // costo asumido no quede escondido dentro del spread neto.
    expect(result['makerFeePct']).toBe(0.35);
    expect(result['takerFeePct']).toBe(0);
    expect(result['rateStatus']).toBeUndefined();
  });

  it('calculate_spread distingue un 0 corrupto de un precio ausente', () => {
    const cero = run('calculate_spread', { buyPrice: 0, sellPrice: 79.8 });
    expect(cero['isGoldenSpread']).toBeNull();
    expect(cero['unavailableReason']).toBe('ARGUMENTO_buyPrice_NO_PLAUSIBLE');

    const nan = run('calculate_spread', { buyPrice: Number.NaN, sellPrice: 79.8 });
    expect(nan['isGoldenSpread']).toBeNull();
    expect(nan['unavailableReason']).toBe('ARGUMENTO_buyPrice_NO_PLAUSIBLE');

    const ausente = run('calculate_spread', { sellPrice: 79.8 });
    expect(ausente['unavailableReason']).toBe('FALTA_ARGUMENTO_buyPrice');
    expect(ausente['buyPrice']).toBeNull();
    expect(ausente['sellPrice']).toBe(79.8);
  });

  it('detect_usdt_depeg NO afirma paridad estable sobre un preciospot inventado', () => {
    const result = run('detect_usdt_depeg');

    expect(result['spotUsdtPrice']).not.toBe(0.9992);
    expect(result['isDepegged']).not.toBe(false);
    expectDeclaredAbsence(result, [
      'spotUsdtPrice',
      'parityDeviationPct',
      'status',
      'isDepegged',
      'arbitrageOpportunity',
      'riskSeverity',
      'recommendation',
      'isEmergencyActionRequired',
    ]);
    // El umbral es política de la mesa, no una lectura: sobrevive a la ausencia.
    expect(result['thresholdPct']).toBe(0.2);
  });

  it('detect_usdt_depeg calcula el desvío con el precio real', () => {
    const result = run('detect_usdt_depeg', { spotUsdtPrice: 0.985 });

    expect(result['spotUsdtPrice']).toBe(0.985);
    expect(result['parityDeviationPct']).toBe(1.5);
    expect(result['status']).toBe('DEPEG_DISCOUNT');
    expect(result['isDepegged']).toBe(true);
    expect(result['isEmergencyActionRequired']).toBe(true);
    expect(result['rateStatus']).toBeUndefined();
  });

  it('recommend_competitive_pricing NO afirma margen sobre un break-even inventado', () => {
    // Con 82.5 hardcodeado, `marginVes` y `isWithinSafeBoundaries` decían "estás
    // arriba de tu costo" sin que nadie hubiera comprado USDT a 82.5.
    const result = run('recommend_competitive_pricing', {
      currentMarketMid: REAL.parallelAverage,
    });

    expect(result['suggestedPrice']).toBeTruthy();
    expectPartialAbsence(result, ['breakEvenPrice', 'marginVes', 'isWithinSafeBoundaries']);
    expect(result['unavailableReason']).toBe('FALTA_ARGUMENTO_breakEvenPrice');
    expect(result['rateStatus']).toBeUndefined();
  });

  it('recommend_competitive_pricing calcula el margen con el break-even real', () => {
    const result = run('recommend_competitive_pricing', {
      currentMarketMid: REAL.parallelAverage,
      breakEvenPrice: 940,
    });

    expect(result['breakEvenPrice']).toBe(940);
    expect(result['marginVes']).toBe(
      Number(Math.abs(Number(result['suggestedPrice']) - 940).toFixed(2)),
    );
    expect(typeof result['isWithinSafeBoundaries']).toBe('boolean');
    expect(result['unavailableReason']).toBeUndefined();
  });

  it('analyze_orderbook_pressure NO dictamina presión de mercado sin libro', () => {
    const result = run('analyze_orderbook_pressure');

    expect(result['orderbookImbalanceRatio']).not.toBe(0.563);
    expect(result['dominantSide']).not.toBe('BUY_PRESSURE');
    expectDeclaredAbsence(result, [
      'bidDepthUsdt',
      'askDepthUsdt',
      'orderbookImbalanceRatio',
      'dominantSide',
      'manipulationRiskScore',
      'phantomLiquidityDetected',
      'pressureVelocity',
      'actionableInsight',
      'marketRegime',
    ]);
  });

  it('analyze_orderbook_pressure calcula la presión con la profundidad real', () => {
    const result = run('analyze_orderbook_pressure', {
      bidDepthUsdt: 19000,
      askDepthUsdt: 2000,
    });

    expect(result['orderbookImbalanceRatio']).toBeCloseTo(0.905, 3);
    expect(result['dominantSide']).toBe('BUY_PRESSURE');
    expect(result['marketRegime']).toBe('BULLISH_LOCAL_DEMAND');
    // Sin un cálculo de spoofing no se afirma score: 15 era constante en las dos
    // ramas, también en la honesta.
    expect(result['manipulationRiskScore']).toBeNull();
    expect(result['phantomLiquidityDetected']).toBeNull();
    expect(result['rateStatus']).toBeUndefined();
  });

  it('fetch_cross_exchange_spread NO publica una tabla de venues que nadie cotizó', () => {
    // El contrato real no acepta ninguna quote del llamante (solo filtros), así que
    // acá no hay libro al que pedirle una fila.
    const result = run('fetch_cross_exchange_spread');

    expect(result['exchanges']).toBeNull();
    expect(result['crossArbitrageOpportunity']).toBeNull();
    expectDeclaredAbsence(result, ['exchanges', 'crossArbitrageOpportunity', 'exchangesCount']);
    const serializado = JSON.stringify(result);
    for (const venue of ['KuCoin', 'OKX', 'Bybit', 'Binance']) {
      expect(serializado).not.toContain(venue);
    }
    expect(serializado).not.toContain('79.2');
    expect(serializado).not.toContain('4250');
  });

  it('scan_synthetic_stable_arbitrage NO escanea una curva sintética de ejemplo', () => {
    const result = run('scan_synthetic_stable_arbitrage');

    // `opportunitiesCount: 0` tampoco serviría: afirmaría que se escaneó y no se
    // halló nada. El conteo de una búsqueda que no ocurrió va en null.
    expect(result['opportunitiesCount']).toBeNull();
    expectDeclaredAbsence(result, ['opportunities', 'opportunitiesCount']);
  });

  it('scan_synthetic_stable_arbitrage escanea las curvas que envía el llamante', () => {
    const result = run('scan_synthetic_stable_arbitrage', {
      pairs: [
        {
          targetAsset: 'USDC',
          spotPair: 'USDCUSDT',
          spotRate: 1,
          spotFeePct: 0.05,
          p2pUsdtRateFiat: 950,
          p2pTargetRateFiat: 968,
          fiatCurrency: 'VES',
          tradingCapitalUsd: 2500,
        },
      ],
    });

    expect(result['pairsEvaluated']).toBe(1);
    expect(typeof result['opportunitiesCount']).toBe('number');
    expect(Array.isArray(result['opportunities'])).toBe(true);
    expect(result['rateStatus']).toBeUndefined();
  });

  it('audit_distressed_liquidity_sniper NO snipea un anuncio y una tasa inventados', () => {
    const result = run('audit_distressed_liquidity_sniper');

    expect(result['fairMarketRate']).not.toBe(85.5);
    expectDeclaredAbsence(result, [
      'fairMarketRate',
      'snipingOpportunities',
      'snipingOpportunitiesCount',
    ]);
    expect(result['frictionMetricsProvided']).toBe(false);
  });

  it('audit_distressed_liquidity_sniper audita los anuncios y la tasa reales', () => {
    const result = run('audit_distressed_liquidity_sniper', {
      ads: [
        {
          advId: 'AD-REAL-1',
          merchantName: 'Vendedor',
          orderType: 'SELL',
          price: 800,
          availableAmountCrypto: 800,
          minLimitFiat: 1000,
          maxLimitFiat: 64000,
          paymentMethods: ['Banesco'],
          fiatCurrency: 'VES',
        },
      ],
      fairMarketRate: 958.580188,
      maxTakerFeePct: 0.1,
    });

    expect(result['fairMarketRate']).toBe(958.580188);
    expect(result['adsEvaluated']).toBe(1);
    expect(result['frictionMetricsProvided']).toBe(true);
    expect(typeof result['snipingOpportunitiesCount']).toBe('number');
    expect(result['rateStatus']).toBeUndefined();
  });

  it('query_otc_darkpool_spread NO calcula rutas sobre venues de ejemplo', () => {
    const result = run('query_otc_darkpool_spread');

    expect(result['routesFoundCount']).toBeNull();
    expectDeclaredAbsence(result, ['routes', 'routesFoundCount']);
    expect(JSON.stringify(result)).not.toContain('Caracas Cash Desk');
    expect(JSON.stringify(result)).not.toContain('85.2');
  });

  it('query_otc_darkpool_spread agrega las quotes que envía el llamante', () => {
    const result = run('query_otc_darkpool_spread', {
      quotes: [
        {
          venueId: 'BINANCE_P2P',
          venueName: 'Binance P2P',
          venueType: 'BINANCE_P2P',
          currencyPair: 'USDT/VES',
          buyRate: 950,
          sellRate: 968,
        },
        {
          venueId: 'BYBIT_P2P',
          venueName: 'Bybit P2P',
          venueType: 'BYBIT_P2P',
          currencyPair: 'USDT/VES',
          buyRate: 948,
          sellRate: 966,
        },
      ],
    });

    expect(result['venuesEvaluated']).toBe(2);
    expect(typeof result['routesFoundCount']).toBe('number');
    expect(result['rateStatus']).toBeUndefined();
  });

  it('route_fintech_payroll_settlement NO cotiza una nómina sobre 85.5 inventado', () => {
    const result = run('route_fintech_payroll_settlement');

    expect(result['quote']).toBeNull();
    expectDeclaredAbsence(result, ['quote', 'grossAmountUsd', 'vesRatePerUsd']);
    expect(result['vesRateRequiredForRail']).toBe(true);
  });

  it('route_fintech_payroll_settlement exige tasa real solo si el rail es en VES', () => {
    const sinTasa = run('route_fintech_payroll_settlement', {
      grossAmountUsd: 2500,
      payoutRail: 'VES_PAGO_MOVIL',
    });

    expect(sinTasa['quote']).toBeNull();
    expect(sinTasa['vesRatePerUsd']).toBeNull();
    expect(sinTasa['unavailableReason']).toBe('FALTA_ARGUMENTO_vesRatePerUsd');
    expect(sinTasa['vesRateRequiredForRail']).toBe(true);

    // Rail que no pasa por VES: la tasa no interviene, así que no se exige.
    const railUsa = run('route_fintech_payroll_settlement', {
      grossAmountUsd: 2500,
      payoutRail: 'USD_CASH_DELIVERY',
    });

    expect(railUsa['quote']).not.toBeNull();
    expect(railUsa['vesRateRequiredForRail']).toBe(false);
    expect(railUsa['rateStatus']).toBeUndefined();
  });

  it('route_fintech_payroll_settlement liquida con la tasa real', () => {
    const result = run('route_fintech_payroll_settlement', {
      grossAmountUsd: 2500,
      payoutRail: 'VES_PAGO_MOVIL',
      vesRatePerUsd: REAL.parallelAverage,
    });

    expect(result['quote']).not.toBeNull();
    expect(result['vesRatePerUsd']).toBe(REAL.parallelAverage);
    const serializado = JSON.stringify(result);
    expect(serializado).not.toContain('85.5');
    expect(serializado).not.toContain('85.00');
  });

  it('route_fintech_payroll_settlement NO inventa la verificación del contratista', () => {
    // El bloque suponía `isVerifiedContractor: true`. Con ese default inventado, el
    // motor no activaba la ventana de validación y una nómina de 10k USDT salía
    // "Liquidación Inmediata: Sí (Fondos Verificados)" sin que nadie la verificara.
    const sinVerificar = run('route_fintech_payroll_settlement', {
      grossAmountUsd: 10000,
      payoutRail: 'USDT_TRC20',
    });

    expect(sinVerificar['isVerifiedContractor']).toBe(false);
    const quote = sinVerificar['quote'] as {
      chargebackRiskTier: string;
      holdHoursRequired: number;
    };
    expect(quote.chargebackRiskTier).toBe('MODERATE');
    expect(quote.holdHoursRequired).toBeGreaterThan(0);

    // Con la verificación declarada, el motor sí acorta el riesgo.
    const verificado = run('route_fintech_payroll_settlement', {
      grossAmountUsd: 10000,
      payoutRail: 'USDT_TRC20',
      isVerifiedContractor: true,
    });
    const quoteOk = verificado['quote'] as {
      chargebackRiskTier: string;
      holdHoursRequired: number;
    };
    expect(quoteOk.chargebackRiskTier).toBe('LOW');
    expect(quoteOk.holdHoursRequired).toBe(0);
  });

  it('route_fintech_payroll_settlement sigue el default de contrato STANDARD', () => {
    // El schema declara `clientTier: STANDARD`; el bloque suponía
    // `RECURRENT_REMOTE`, que cambia la comisión de mesa aplicada.
    const conDefault = run('route_fintech_payroll_settlement', {
      grossAmountUsd: 2500,
      payoutRail: 'USDT_TRC20',
    });

    expect(conDefault['clientTier']).toBe('STANDARD');
    const conMismoTier = run('route_fintech_payroll_settlement', {
      grossAmountUsd: 2500,
      payoutRail: 'USDT_TRC20',
      clientTier: 'STANDARD',
    });

    // `quote.timestamp` es `new Date().toISOString()` y `settlementId` se deriva de
    // `Date.now()`, ambos por llamada. Comparar el objeto entero es flake por
    // definición: falla cuando el reloj avanza entre las dos llamadas. Lo que
    // esta prueba afirma es que la decisión de ruteo no cambia.
    const sinReloj = (q: unknown) => {
      const { timestamp, settlementId, ...rest } = q as Record<string, unknown>;
      return rest;
    };
    expect(sinReloj(conDefault['quote'])).toEqual(sinReloj(conMismoTier['quote']));

    // La identidad sigue siendo una identidad real, solo que no comparable byte a byte.
    expect(conDefault['quote']).toMatchObject({
      settlementId: expect.stringMatching(/^SETTLE-DEEL-[0-9A-Z]+$/),
    });
  });

  it('recommend_counterparty_yield_price NO publica un yieldPrice sobre base inventada', () => {
    const result = run('recommend_counterparty_yield_price');

    expect(result['result']).toBeNull();
    expect(result['baseMarketRate']).not.toBe(85.5);
    expectDeclaredAbsence(result, ['result', 'baseMarketRate']);
  });

  it('recommend_counterparty_yield_price precio sobre la base real', () => {
    const result = run('recommend_counterparty_yield_price', {
      baseMarketRate: REAL.parallelAverage,
      requestedAmountUsd: 3000,
    });

    expect(result['baseMarketRate']).toBe(REAL.parallelAverage);
    expect(result['result']).not.toBeNull();
    expect(result['unavailableReason']).toBeUndefined();
  });

  it('process_concierge_inquiry NO responde al cliente una tasa de 87.00', () => {
    // El peor caso del barrido: la tasa inventada no iba a un panel, iba DENTRO del
    // texto que se le manda al cliente.
    const result = run('process_concierge_inquiry', {
      customerMessage: 'Buenas tardes, ¿cuál es la tasa de USDT?',
    });

    expect(result['formattedReplyMessage']).toBeNull();
    expect(result['exchangeRateUsed']).toBeNull();
    expect(result['quoteAmountCrypto']).toBeNull();
    expect(result['quoteAmountFiat']).toBeNull();
    expectDeclaredAbsence(result, ['exchangeRateUsed', 'formattedReplyMessage']);
    // El inquiry parseado sí es real: el operador debe saber qué le preguntan.
    expect(result['parsedInquiry']).not.toBeNull();
    expect(result['requiresOperatorHumanReview']).toBe(true);
  });

  it('process_concierge_inquiry responde con la tasa real de la mesa', () => {
    const result = run('process_concierge_inquiry', {
      customerMessage: 'Buenas tardes, ¿cuál es la tasa de USDT?',
      deskRatePerUsd: REAL.parallelAverage,
    });

    expect(result['exchangeRateUsed']).toBe(REAL.parallelAverage);
    expect(String(result['formattedReplyMessage'])).toContain('958.58');
    expect(result['rateStatus']).toBeUndefined();
  });

  it('process_concierge_inquiry NO redacta ni adivina un mensaje inexistente', () => {
    const result = run('process_concierge_inquiry');

    expect(result['parsedInquiry']).toBeNull();
    expect(result['formattedReplyMessage']).toBeNull();
    expect(result['unavailableReason']).toBe('FALTA_ARGUMENTO_customerMessage');
  });

  it('predict_bcv_macro_regime NO declara un régimen sobre tasas inventadas', () => {
    const result = run('predict_bcv_macro_regime');

    expect(result['assessment']).toBeNull();
    expectDeclaredAbsence(result, ['assessment', 'bcvOfficialRate', 'parallelMarketRate']);
    // El calendario sí es contexto, no mercado: sobrevive.
    expect(result['daysSinceLastIntervention']).toBe(4);
  });

  it('predict_bcv_macro_regime evalúa el régimen con las tasas reales', () => {
    const result = run('predict_bcv_macro_regime', {
      bcvOfficialRate: REAL.bcvUsd,
      parallelMarketRate: REAL.parallelAverage,
    });

    expect(result['bcvOfficialRate']).toBe(REAL.bcvUsd);
    expect(result['parallelMarketRate']).toBe(REAL.parallelAverage);
    const assessment = result['assessment'] as { regime?: string };
    expect(assessment.regime).toBeTruthy();
    expect(result['rateStatus']).toBeUndefined();
  });

  it('evaluate_ad_repricing NO sugiere precio sin órdenes de competidor', () => {
    const result = run('evaluate_ad_repricing', { side: 'BUY' });

    expect(result['suggestedPrice']).not.toBe(78.85);
    expect(result['targetCompetitorMerchant']).not.toBe('MarketMakerPro');
    // El daemon con el mismo input responde NO_COMPETITOR_FOUND; el fallback ahora
    // coincide con él en vez de inventar un competidor.
    expect(result['recommendedAction']).toBe('NO_COMPETITOR_FOUND');
    expect(result['suggestedPrice']).toBeNull();
    expect(result['circuitBreakerTriggered']).toBe(false);
    expect(result['rateStatus']).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
  });

  it('evaluate_ad_repricing calcula el precio contra el libro que envía el llamante', () => {
    const result = run('evaluate_ad_repricing', {
      side: 'BUY',
      targetRank: 'TOP_1',
      stepVes: 0.05,
      competitorOrders: [
        { price: 958.5, surplusAmount: 5000, finishRate: 0.97, advertiserName: 'Competidor' },
        { price: 957, surplusAmount: 5000, finishRate: 0.95, advertiserName: 'Segundo' },
      ],
    });

    expect(result['recommendedAction']).toBe('UPDATE_PRICE');
    expect(result['suggestedPrice']).toBe(958.55);
    expect(result['targetCompetitorPrice']).toBe(958.5);
    expect(result['targetCompetitorMerchant']).toBe('Competidor');
    expect(result['rateStatus']).toBeUndefined();
  });

  it('evaluate_ad_repricing respeta el default de contrato targetRank TOP_2', () => {
    // El schema declara `targetRank: TOP_2` y el bridge lo hereda. Con TOP_1 el
    // fallback apuntaba al líder: dos filas de distancia entre el precio simulado y
    // el que el daemon publicaría.
    const sinTarget = run('evaluate_ad_repricing', {
      side: 'BUY',
      competitorOrders: [
        { price: 958.5, surplusAmount: 5000, finishRate: 0.97, advertiserName: 'Lider' },
        { price: 957, surplusAmount: 5000, finishRate: 0.95, advertiserName: 'Segundo' },
      ],
    });

    expect(sinTarget['targetRank']).toBe('TOP_2');
    expect(sinTarget['targetCompetitorMerchant']).toBe('Segundo');
    expect(sinTarget['suggestedPrice']).toBe(957.05);
  });

  it('evaluate_ad_repricing NO inventa el lado de la orden', () => {
    // `side` decide el signo del ajuste y el orden del ranking. Suponer BUY es
    // inventar la decisión.
    const result = run('evaluate_ad_repricing', {
      competitorOrders: [{ price: 958.5, surplusAmount: 5000, finishRate: 0.97 }],
    });

    expect(result['recommendedAction']).toBeNull();
    expect(result['suggestedPrice']).toBeNull();
    expect(result['unavailableReason']).toBe('FALTA_ARGUMENTO_side');
  });

  it('evaluate_ad_repricing frena por saturación de cuenta declarada', () => {
    const result = run('evaluate_ad_repricing', {
      side: 'BUY',
      accountSaturationPct: 100,
      competitorOrders: [{ price: 958.5, surplusAmount: 5000, finishRate: 0.97 }],
    });

    expect(result['recommendedAction']).toBe('PAUSE_AD');
    expect(result['breakerType']).toBe('ACCOUNT_SATURATION');
    expect(result['circuitBreakerTriggered']).toBe(true);
    expect(result['suggestedPrice']).toBeNull();
  });

  it('evaluate_ad_repricing frena por intervención cambiaria declarada', () => {
    const result = run('evaluate_ad_repricing', {
      side: 'BUY',
      bcvInterventionActive: true,
      competitorOrders: [{ price: 958.5, surplusAmount: 5000, finishRate: 0.97 }],
    });

    expect(result['recommendedAction']).toBe('HOLD_OR_WIDEN');
    expect(result['breakerType']).toBe('BCV_INTERVENTION');
    expect(result['circuitBreakerTriggered']).toBe(true);
    expect(result['suggestedPrice']).toBeNull();
  });

  it('evaluate_ad_repricing NO afirma saturación de cuenta que nadie midió', () => {
    // El estado de la cuenta bancaria es un hecho externo: si no viene, se declara
    // ausente, no se reporta 0% de saturación.
    const result = run('evaluate_ad_repricing', {
      side: 'BUY',
      targetRank: 'TOP_1',
      competitorOrders: [{ price: 958.5, surplusAmount: 5000, finishRate: 0.97 }],
    });

    expect(result['accountSaturationPct']).toBeNull();

    const medida = run('evaluate_ad_repricing', {
      side: 'BUY',
      targetRank: 'TOP_1',
      accountSaturationPct: 42.5,
      competitorOrders: [{ price: 958.5, surplusAmount: 5000, finishRate: 0.97 }],
    });

    expect(medida['accountSaturationPct']).toBe(42.5);
  });

  it('evaluate_ad_repricing descarta liquidez fantasma por anti-spoofing', () => {
    const result = run('evaluate_ad_repricing', {
      side: 'BUY',
      competitorOrders: [
        // Finish rate de 5%: no es un competidor real, es una orden de pantalla.
        { price: 900, surplusAmount: 5000, finishRate: 0.05, advertiserName: 'Spoof' },
      ],
    });

    expect(result['recommendedAction']).toBe('NO_COMPETITOR_FOUND');
    expect(result['filteredSpoofingAdsCount']).toBe(1);
  });

  it('publish_ad_price NO confirma una publicación de un precio inventado', () => {
    const result = run('publish_ad_price', { adId: 'AD-1001', side: 'BUY', dryRun: false });

    expect(result['success']).toBe(false);
    expect(result['publishedPrice']).toBeNull();
    expect(result['merchantConfirmed']).toBe(false);
    expect(result['status']).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
    expect((result['auditTrail'] as { signature: unknown }).signature).toBeNull();
    expectDeclaredAbsence(result, ['publishedPrice']);
  });

  it('publish_ad_price NUNCA se presenta como publicación en vivo', () => {
    // Con `dryRun: false` el bloque devolvía `status: 'PUBLISHED_LIVE'` desde el
    // navegador. Sin transporte nativo esta función no publica en el exchange.
    const result = run('publish_ad_price', {
      adId: 'AD-1001',
      side: 'BUY',
      newPrice: 958.5,
      dryRun: false,
    });

    expect(result['publishedPrice']).toBe(958.5);
    expect(result['status']).toBe('SIMULATED_SUCCESS');
    expect(result['merchantConfirmed']).toBe(false);
    expect(result['simulated']).toBe(true);
  });

  it('audit_ad_competitiveness NO certifica una posición ganadora sobre un libro vacío', () => {
    const result = run('audit_ad_competitiveness', { adId: 'AD-1001', side: 'BUY' });

    expect(result['currentRank']).not.toBe('TOP_1');
    expect(result['isMeetingTargetRank']).not.toBe(true);
    expect(result['assessment']).toBeNull();
    expectDeclaredAbsence(result, [
      'myCurrentPrice',
      'currentRank',
      'isMeetingTargetRank',
      'priceGapWithLeader',
      'leaderPrice',
      'assessment',
    ]);
  });

  it('audit_ad_competitiveness rankea contra los competidores reales', () => {
    const result = run('audit_ad_competitiveness', {
      adId: 'AD-1001',
      side: 'SELL',
      myCurrentPrice: 960,
      desiredRank: 'TOP_2',
      competitors: [
        { price: 965, merchantName: 'Intermedio' },
        { price: 968, merchantName: 'Mas Caro' },
        { price: 955, merchantName: 'Mas Barato' },
      ],
    });

    // Compra y venta ordenan al revés: en SELL gana el precio más alto.
    expect(result['currentRank']).toBe('TOP_3');
    expect(result['leaderPrice']).toBe(968);
    expect(result['leaderMerchant']).toBe('Mas Caro');
    expect(result['totalCompetitorsAnalyzed']).toBe(3);
    expect(result['priceGapWithLeader']).toBe(-8);
    expect(result['isMeetingTargetRank']).toBe(false);
    expect(result['rateStatus']).toBeUndefined();
  });

  it('add_operation_entry no escribe un asiento con precio inventado', () => {
    const result = run('add_operation_entry', { side: 'buy', humanConfirm: true });

    expect(result['recorded']).toBe(false);
    expect(result['orderId']).toBeNull();
    expect(result['cryptographicReceiptHash']).toBeNull();
    expectDeclaredAbsence(result, ['price', 'vesAmount', 'usdtAmount']);
  });

  it('add_operation_entry sigue exigiendo confirmación humana', () => {
    const result = run('add_operation_entry', {
      side: 'buy',
      vesAmount: 1000,
      usdtAmount: 10,
      price: 100,
      humanConfirm: false,
    });

    expect(result['recorded']).toBe(false);
    expect(result['requiresHumanConfirmation']).toBe(true);
  });

  it('add_operation_entry escribe el asiento con los montos y el precio reales', () => {
    const result = run('add_operation_entry', {
      side: 'buy',
      vesAmount: 958580.188,
      usdtAmount: 1000,
      price: 958.580188,
      humanConfirm: true,
    });

    expect(result['recorded']).toBe(true);
    expect(result['price']).toBe(958.580188);
    expect(result['vesAmount']).toBe(958580.188);
    expect(result['usdtAmount']).toBe(1000);
    expect(result['price']).not.toBe(82.85);
    expectNoInventedNumbers(JSON.stringify(result), 'add_operation_entry');
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
    for (const tool of TOOLS_DE_LECTURA) {
      const result = run(tool);
      expect(result['simulated'], tool).toBe(true);
      expect(result['actionable'], tool).toBe(false);
      expect((result['availability'] as { degraded: boolean }).degraded, tool).toBe(true);
    }
  });

  it('ninguna tasa inventada sobrevive en las herramientas de mercado', () => {
    // Red de contención: los defaults históricos del archivo, por si alguien
    // reintroduce uno con otro nombre de variable.
    for (const tool of TOOLS_DE_LECTURA) {
      expectNoInventedNumbers(JSON.stringify(run(tool)), tool);
    }
  });

  it('las 17 herramientas del barrido no emiten ningún número sin origen', () => {
    // Última red: se recorren TODAS las herramientas tocadas por el barrido (las
    // del incidente más las de precios, libro y anuncios) y se verifica que ninguna
    // emita un valor de mercado con el input vacío.
    for (const tool of HERRAMIENTAS_DEL_BARRIDO) {
      const result = run(tool);
      expectNoInventedNumbers(JSON.stringify(result), tool);
      // Y ninguna puede afirmar que es ejecutable.
      expect(result['actionable'], tool).toBe(false);
    }
  });
});
