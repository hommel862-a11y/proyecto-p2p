import {
  computeSpread,
  evaluate,
  type RuleContext,
  predictBcvIntervention,
  getBcvMarketIntelligence,
  generateBlindHash,
  DEFAULT_ZK_SALT_DOMAIN,
  simulateCompoundGrowth,
  buildPortfolioAllocationPlan,
  scanSyntheticStableCurves,
  scanOrderbookSnipingOpportunities,
  aggregateDarkPoolOpportunities,
  calculateFintechSettlementQuote,
  calculateDynamicCounterpartyPricing,
  parseCustomerChatMessage,
  generateConciergeReply,
  evaluateMacroBcvRegime,
  calculateTreasuryYieldAllocation,
  compileBrowserOperatorTask,
} from '@p2p/core';

export interface McpFallbackAvailability {
  readonly degraded: boolean;
  readonly reason: string;
}

export const MCP_FALLBACK_DEGRADED_REASON =
  'El entorno web no cuenta con conexión al daemon MCP de Electron ni APIs bancarias o de exchange en vivo. ' +
  'Las respuestas son simulaciones referenciales y ninguna recomendación financiera es ejecutable automáticamente.';

const DEGRADED_MCP_AVAILABILITY: McpFallbackAvailability = Object.freeze({
  degraded: true,
  reason: MCP_FALLBACK_DEGRADED_REASON,
});

/** Cómo se declara una tasa de mercado que no se pudo obtener de verdad. */
export interface MarketRateReading {
  readonly value: number | null;
  /** Por qué no hay valor. `null` cuando sí lo hay. */
  readonly reason: string | null;
  /** De dónde habría salido el número. Se declara siempre. */
  readonly expectedSource: string;
}

/**
 * Lee una tasa de mercado de los argumentos de la herramienta.
 *
 * Esta función no existía y su ausencia es la causa de las tasas inventadas: cada
 * herramienta hacía `Number(args?.bcvRate ?? 72.45)` y, cuando el agente no pasaba
 * la tasa, devolvía un número con forma de mercado. Peor: 72.45 y 84.12 están más
 * de 10x lejos de las tasas reales observadas (857.8876 y 958.580188), así que no
 * eran ni defaults tolerables ni números redondeados: describían un mercado que
 * no existe, y para el LMC eso es una oportunidad de entrada.
 *
 * Con el argumento presente y plausible, la tasa es real y se usa. Sin él, la
 * ausencia se propaga como `null` y la herramienta lo declara.
 */
export function readMarketRate(
  args: unknown,
  key: string,
  expectedSource: string,
): MarketRateReading {
  const raw = (args as Record<string, unknown> | null | undefined)?.[key];
  const value = Number(raw);
  if (raw != null && Number.isFinite(value) && value > 0) {
    return { value, reason: null, expectedSource };
  }
  return {
    value: null,
    reason: raw == null ? `FALTA_ARGUMENTO_${key}` : `ARGUMENTO_${key}_NO_PLAUSIBLE`,
    expectedSource,
  };
}

/**
 * Bloque de ausencia que se agrega al resultado de una herramienta que necesita
 * una tasa de mercado. Sigue la convención que ya usa
 * `audit_counterparty_exposure`: `null` en el valor, un motivo legible y
 * `actionable: false`.
 */
function rateUnavailableFields(reading: MarketRateReading): Record<string, unknown> {
  return {
    rateStatus: 'UNAVAILABLE_NO_LIVE_SOURCE',
    unavailableReason: reading.reason,
    expectedSource: reading.expectedSource,
    actionable: false,
  };
}

/**
 * Bloque de ausencia para herramientas cuya lectura de mercado no es un número sino
 * un conjunto de lecturas: el libro, los pares de curvas, las quotes de venues. No
 * hay un `readMarketRate` que aplicar porque no hay una sola tasa, pero el marcador
 * es el mismo: `UNAVAILABLE_NO_LIVE_SOURCE` más un motivo explícito y el origen del
 * dato que falta. Sin este bloque, un libro P2P vacío se llenaba con precios de
 * ejemplo y el LMC competía contra un mercado que no existe.
 */
function readingsUnavailableFields(
  reason: string,
  expectedSource: string,
): Record<string, unknown> {
  return {
    rateStatus: 'UNAVAILABLE_NO_LIVE_SOURCE',
    unavailableReason: reason,
    expectedSource,
    actionable: false,
  };
}

/**
 * Bloque de AUSENCIA PARCIAL: falta una lectura dentro de una respuesta que sí
 * contiene otras reales.
 *
 * Deliberadamente NO lleva `rateStatus`: ponerlo afirmaría que todas las lecturas de
 * mercado de la herramienta están ausentes, y en estos casos hay tasas verdaderas en
 * la misma respuesta. Declarar ausencia de más es el error espejo — el LMC
 * descartaría un dato real porque el envelope dice "no hay dato", igual que el error
 * original lo hacía al revés.
 */
function missingReadingFields(reading: MarketRateReading): Record<string, unknown> {
  return {
    unavailableReason: reading.reason,
    expectedSource: reading.expectedSource,
    actionable: false,
  };
}

/**
 * Lee un número que llega del llamador sin inventar sustituto.
 *
 * El patrón `Number(args.x ?? 5000)` que este espejo usaba convertía dos ausencias
 * distintas en el mismo número. Un valor ausente se converts en `0` con
 * `Number(undefined)`, y `0` no es un default inofensivo en estos dominios: para
 * capital significa "no hay tesorería" y para score significa "contraparte
 * inexistente". Por eso un ausente devuelve `null` explícito, que es lo que
 * distingue "no medido" de "medido en cero".
 *
 * `0` SÍ es un valor de entrada legítimo y se preserva: un contador de pérdidas
 * consecutivas en cero es un hecho, y una exposición medida en cero también.
 */
function numeroODeferenciaAusente(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Simula la ejecución de herramientas MCP en modo web cuando no hay conexión nativa de Electron.
 */
export function simulateMcpTool(
  toolName: string,
  args: unknown,
  executionTimeMs: number,
): Record<string, unknown> {
  let simulatedResult: Record<string, unknown> = {
    toolName,
    status: 'OK',
    simulated: true,
    actionable: false,
    availability: DEGRADED_MCP_AVAILABILITY,
    args,
    message: `Ejecución de prueba simulada localmente en ${executionTimeMs} ms (modo degradado).`,
  };

  if (toolName === 'calculate_spread') {
    // Ambos precios son lecturas observadas del mercado, y el contrato real los exige:
    // `CalculateSpreadInputSchema` los declara positivos SIN default. El fallback
    // inventaba 78.5 / 79.8, sacaba un spread neto de ~1.65% y respondía
    // `isGoldenSpread: true` con `recommendation: 'VIABLE_INSTITUCIONAL'`: un
    // veredicto de viabilidad institucional sobre precios que nadie cotizó, que es
    // exactamente lo que un LMC ejecuta. Sin las dos lecturas no hay spread, y sin
    // spread no hay veredicto, así que se declara la ausencia.
    const buyRead = readMarketRate(
      args,
      'buyPrice',
      'libro Binance P2P en vivo o get_binance_p2p_orderbook',
    );
    const sellRead = readMarketRate(
      args,
      'sellPrice',
      'libro Binance P2P en vivo o get_binance_p2p_orderbook',
    );
    if (buyRead.value === null || sellRead.value === null) {
      const faltante = buyRead.value === null ? buyRead : sellRead;
      simulatedResult = {
        ...simulatedResult,
        buyPrice: buyRead.value,
        sellPrice: sellRead.value,
        unitSpread: null,
        grossSpreadPercent: null,
        netGainVes: null,
        netSpreadPercent: null,
        // `isGoldenSpread` no puede ser false: false también es un veredicto, y el
        // veredicto necesita los dos lados del libro. Desconocido es el único tercer
        // estado honesto.
        isGoldenSpread: null,
        recommendation: null,
        ...rateUnavailableFields(faltante),
      };
    } else {
      // makerFeePct/takerFeePct son parámetros del fee del exchange, no lecturas de
      // mercado: la mesa conoce su propio nivel de cuenta y ninguna observación del
      // mercado puede aportarlos. Se devuelven en la respuesta para que ningún costo
      // supuesto quede escondido dentro de `netSpreadPercent`; sin llamante solo
      // moldean una llamada de demostración.
      const makerFee = Number((args as any)?.makerFeePct ?? 0.35);
      const takerFee = Number((args as any)?.takerFeePct ?? 0);
      const totalFeeRate = (makerFee + takerFee) / 100;
      const spread = computeSpread(buyRead.value, sellRead.value, 100, 'USDT', totalFeeRate);
      const unitSpread = spread.unitSpread;
      const grossSpreadPercent = (unitSpread / buyRead.value) * 100;
      const netSpreadPercent = (spread.netGainVes / (buyRead.value * 100)) * 100;
      const isGolden = netSpreadPercent >= 0.5;
      simulatedResult = {
        ...simulatedResult,
        buyPrice: buyRead.value,
        sellPrice: sellRead.value,
        unitSpread: Number(unitSpread.toFixed(4)),
        grossSpreadPercent: Number(grossSpreadPercent.toFixed(2)),
        netGainVes: Number(spread.netGainVes.toFixed(2)),
        netSpreadPercent: Number(netSpreadPercent.toFixed(2)),
        isGoldenSpread: isGolden,
        recommendation: isGolden ? 'VIABLE_INSTITUCIONAL' : 'SPREAD_SUB_OPTIMAL',
        makerFeePct: makerFee,
        takerFeePct: takerFee,
      };
    }
  } else if (toolName === 'evaluate_trade_risk') {
    // Estos defaults son la misma invención que 9200a4f cerró en el servidor MCP, y
    // en el espejo era peor: no coincidían con los valores del servidor que ya nadie
    // defendía. Eran 5000, 98, 400 y 2500.
    //
    // `actionable: false` ya estaba puesto en toda esta rama, y por eso el defecto
    // nunca pareció grave. Pero eso encerra la autorización, no la afirmación: el
    // espejo publicaba `tradeRiskPct: 10.0` calculado sobre una tesorería que nadie
    // reportó, y `isCounterpartyAcceptable: true` porque el score por defecto era 98
    // y 98 >= 70 siempre. Ese campo no decía "la contraparte es buena": decía "se
    // pasó un score".
    //
    // `tradeAmountUsdt` es el caso más grave de los cuatro. En
    // `EvaluateTradeRiskInputSchema` es REQUERIDO: el servidor rechaza la llamada
    // entera si no llega. El espejo lo rellenaba con 500, así que una llamada
    // incompleta recibía un veredicto completo sobre un monto que nadie pidió.
    const tradeAmount = numeroODeferenciaAusente((args as any)?.tradeAmountUsdt);
    const capital = numeroODeferenciaAusente((args as any)?.currentCapitalUsdt);
    const score = numeroODeferenciaAusente((args as any)?.counterpartyScore);

    // El spread es una lectura observada del mercado. Without a caller-supplied
    // reading the MIN_SPREAD rule cannot be evaluated, so we declare absence instead
    // of inventing a spread that would silently clear the rule.
    const observedSpread = (args as any)?.currentSpreadPct;
    const hasObservedSpread = observedSpread !== undefined && Number(observedSpread) > 0;

    // El orden es el que un llamador tendría que arreglar: primero el operando
    // primario, luego el denominador, después la elegibilidad. El guard testean los
    // valores directamente, no el motivo derivado, para que el compilador estreche
    // `number | null` a `number` en la rama else.
    const unavailableReason =
      tradeAmount == null
        ? 'missing_evidence:tradeAmountUsdt'
        : capital == null
          ? 'missing_evidence:currentCapital'
          : score == null
            ? 'missing_evidence:counterpartyScore'
            : null;

    if (tradeAmount == null || capital == null || score == null) {
      // Sin denominador no hay porcentaje: 250/5000 leía como 5% de riesgo sobre una
      // tesorería nunca reportada.
      simulatedResult = {
        ...simulatedResult,
        decision: 'UNAVAILABLE',
        reason: unavailableReason,
        currentSpreadPct: hasObservedSpread ? Number(observedSpread) : null,
        tradeRiskPct: null,
        // Un tamaño recomendado contra capital no reportado es un número del que se
        // dimensiona una orden.
        recommendedSizeUsdt: null,
        // Una contraparte ausente no es una contraparte aceptable.
        isCounterpartyAcceptable: null,
        // No hay regla violada que reportar: no se pudo evaluar ninguna.
        violations: [],
        unmeasuredInputs: [
          ...(tradeAmount == null ? ['tradeAmountUsdt'] : []),
          ...(capital == null ? ['currentCapitalUsdt'] : []),
          ...(score == null ? ['counterpartyScore'] : []),
        ],
        unavailableReason,
        actionable: false,
      };
    } else {
      const tradeRiskPct = (tradeAmount / capital) * 100;
      const ctx: RuleContext = {
        currentSpread: Number(observedSpread),
        minSpread: 0.5,
        openOps: 1,
        tradeRiskPct,
        dailyLossPct: 0,
        consecutiveErrors: score < 50 ? 2 : 0,
        maxRiskPerTradePct: 20,
      };
      const recommendedMaxUsdt = (capital * (ctx.maxRiskPerTradePct ?? 20)) / 100;

      if (!hasObservedSpread) {
        simulatedResult = {
          ...simulatedResult,
          decision: 'INSUFFICIENT_DATA',
          reason: 'MISSING_CURRENT_SPREAD',
          currentSpreadPct: null,
          tradeRiskPct: Number(tradeRiskPct.toFixed(2)),
          recommendedSizeUsdt: null,
          isCounterpartyAcceptable: null,
          violations: ['MISSING_CURRENT_SPREAD'],
          unavailableReason: null,
          actionable: false,
        };
      } else {
        const verdict = evaluate(ctx);
        simulatedResult = {
          ...simulatedResult,
          decision: verdict.decision,
          reason: verdict.reason,
          currentSpreadPct: Number(observedSpread),
          tradeRiskPct: Number(tradeRiskPct.toFixed(2)),
          recommendedSizeUsdt: Math.min(tradeAmount, recommendedMaxUsdt),
          // El score viene del llamador: `score >= 70` es un cálculo sobre un dato
          // real, no un permiso.
          isCounterpartyAcceptable: score >= 70,
          violations: verdict.decision !== 'ALLOW' ? [verdict.reason] : [],
          unavailableReason: null,
          actionable: false,
        };
      }
    }
  } else if (toolName === 'simulate_trade_impact') {
    // Aquí el default peligroso era la pareja `maxDailyExposureLimitUsdt: 2500` con
    // `currentExposureUsdt: 400`. Juntos hacían que cualquier orden bajo el límite
    // pareciera estar dentro de los límites, y el veredicto era
    // `SIMULATED_WITHIN_LIMITS`: una licencia para mover dinero, no una lectura.
    //
    // Una aritmética de exposición sobre un operando desconocido tampoco es una
    // medición, así que un operando ausente da `null` en vez de tratar el libro como
    // vacío. `proposedTradeAmountUsdt` también es REQUERIDO en el schema del
    // servidor: aquí se rellenaba con 600.
    const proposedTrade = numeroODeferenciaAusente((args as any)?.proposedTradeAmountUsdt);
    const currentExposure = numeroODeferenciaAusente((args as any)?.currentExposureUsdt);
    const maxLimit = numeroODeferenciaAusente((args as any)?.maxDailyExposureLimitUsdt);
    // `consecutiveLosses: 0` sí es un default defendible: el servidor también lo
    // declara con `.default(0)` y "no se han registrado pérdidas" es un hecho
    // observable del contador, no una medición de mercado.
    const losses = Number((args as any)?.consecutiveLosses ?? 0);

    const projected = proposedTrade != null && currentExposure != null ? currentExposure + proposedTrade : null;
    const limitExceeded = projected != null && maxLimit != null ? projected > maxLimit : null;
    const utilization =
      projected != null && maxLimit != null && maxLimit > 0
        ? Number(((projected / maxLimit) * 100).toFixed(1))
        : null;

    const triggers: string[] = [];
    if (limitExceeded === true) triggers.push('DAILY_EXPOSURE_LIMIT_EXCEEDED');
    // Medido sobre input real, así que esta regla dispara por mérito propio.
    // Suprimirla porque el límite falta sería sobre-corregir: una regla conocida
    // sobre datos conocidos se sostiene igual.
    if (losses >= 3) triggers.push('MAX_CONSECUTIVE_LOSSES_TRIGGERED');

    // Un límite que nadie eligió es el que producía el falso verde, así que es el
    // que se reporta primero. El guard testean los valores directamente para que el
    // compilador estreche.
    const unavailableReason =
      proposedTrade == null
        ? 'missing_evidence:proposedTradeAmount'
        : maxLimit == null
          ? 'missing_evidence:maxDailyExposureLimit'
          : currentExposure == null
            ? 'missing_evidence:currentExposure'
            : null;

    simulatedResult = {
      ...simulatedResult,
      // `null` pasa como `null`. Un `0` aquí afirmaría que el libro está vacío.
      currentExposureUsdt: currentExposure,
      projectedExposureUsdt: projected,
      exposureUtilizationPct: utilization,
      limitExceeded,
      maxSafeRemainingUsdt:
        maxLimit != null && currentExposure != null ? Math.max(0, maxLimit - currentExposure) : null,
      wouldTrigger: triggers,
      // Un disparo conocido sobre input medido sigue siendo un hallazgo real aunque
      // la simulación entera no haya podido correr. `REQUIRES_REDUCTION` es una orden
      // de no crecer, que es la dirección segura.
      verdict:
        unavailableReason != null && triggers.length === 0
          ? 'UNAVAILABLE'
          : triggers.length === 0
            ? 'SIMULATED_WITHIN_LIMITS'
            : 'REQUIRES_REDUCTION',
      unmeasuredInputs: [
        ...(proposedTrade == null ? ['proposedTradeAmountUsdt'] : []),
        ...(currentExposure == null ? ['currentExposureUsdt'] : []),
        ...(maxLimit == null ? ['maxDailyExposureLimitUsdt'] : []),
      ],
      unavailableReason,
      actionable: false,
    };
  } else if (toolName === 'consult_zk_market_mesh') {
    const rawId = String((args as any)?.rawIdentifier ?? 'V-18456789');
    const salt = String((args as any)?.saltDomain ?? DEFAULT_ZK_SALT_DOMAIN);
    const blindHash = generateBlindHash(rawId, salt);
    simulatedResult = {
      ...simulatedResult,
      blindHash,
      isFlagged: false,
      threatCategory: null,
      severity: null,
      confidenceScore: 0,
      confirmationsCount: 0,
      // No mesh was contacted, so anonymity cannot be attested. Absence, not a guarantee.
      privacyGuaranteed: false,
      verdict: 'NO_MESH_CONNECTION_UNVERIFIED',
      actionable: false,
    };
  } else if (toolName === 'forecast_volatility_window') {
    const parallelRead = readMarketRate(
      args,
      'parallelRate',
      'Cotizave `parallel` o libro Binance P2P',
    );
    const bcvRead = readMarketRate(args, 'bcvRate', 'Cotizave `oficial` o get_bcv_rates');
    if (parallelRead.value === null || bcvRead.value === null) {
      // Sin las dos tasas no hay brecha, y sin brecha no hay pronóstico de
      // volatilidad. Antes devolvía 72.45/84.12 y de ahí una recomendación de
      // acción que el LMC leía como ventana real.
      const faltante = parallelRead.value === null ? parallelRead : bcvRead;
      simulatedResult = {
        ...simulatedResult,
        parallelRate: parallelRead.value,
        bcvRate: bcvRead.value,
        gapPct: null,
        isInBcvInterventionWindow: null,
        bcvPhase: null,
        hoursUntilIntervention: null,
        tacticalRecommendation: null,
        spreadDynamic: null,
        suggestedAction: null,
        ...rateUnavailableFields(faltante),
      };
    } else {
      const bcvIntel = getBcvMarketIntelligence(parallelRead.value, bcvRead.value);
      const isInWindow = bcvIntel.window.phase === 'INTERVENTION_ACTIVE';
      // La profundidad del libro es una lectura en vivo. El contrato real la declara
      // con default solo para moldear una llamada de demostración, y acá eso se
      // convertía en 9500/8000: una rama entera de `spreadDynamic` (COMPRESSION_RISK)
      // evaluada sobre un libro que no existe. Con la profundidad desconocida el
      // veredicto de dinámica y la acción quedan en null — `STABLE` sería una
      // observación, no una ausencia.
      const bidDepthRaw = (args as any)?.bidDepthUsdt;
      const askDepthRaw = (args as any)?.askDepthUsdt;
      const depthKnown =
        bidDepthRaw !== undefined &&
        askDepthRaw !== undefined &&
        Number.isFinite(Number(bidDepthRaw)) &&
        Number.isFinite(Number(askDepthRaw)) &&
        Number(bidDepthRaw) >= 0 &&
        Number(askDepthRaw) >= 0;
      const depthFaltante: MarketRateReading = {
        value: null,
        reason:
          bidDepthRaw === undefined
            ? 'FALTA_ARGUMENTO_bidDepthUsdt'
            : askDepthRaw === undefined
              ? 'FALTA_ARGUMENTO_askDepthUsdt'
              : 'ARGUMENTO_PROFUNDIDAD_LIBRO_NO_PLAUSIBLE',
        expectedSource: 'libro Binance P2P en vivo o get_binance_p2p_orderbook',
      };
      const bidDepth = Number(bidDepthRaw);
      const askDepth = Number(askDepthRaw);
      const depthRatio = bidDepth > 0 ? askDepth / bidDepth : 1;
      const bcvGapPct = bcvIntel.gap.gapPct;
      let spreadDynamic: 'EXPANSION_LIKELY' | 'COMPRESSION_RISK' | 'STABLE' = 'STABLE';
      if (isInWindow && depthRatio < 0.8) {
        spreadDynamic = 'COMPRESSION_RISK';
      } else if (bcvGapPct !== null && bcvGapPct > 18) {
        // Sólo se espera expansión con una brecha medida. `null > 18` es `false`,
        // así que sin este guard una brecha sin medir caería en STABLE y el
        // operador leería "Operar con volumen normal" sobre datos que no existen.
        spreadDynamic = 'EXPANSION_LIKELY';
      }
      const suggestedAction =
        spreadDynamic === 'COMPRESSION_RISK'
          ? 'Liquidar inventario con rapidez para evitar compresión de márgenes'
          : spreadDynamic === 'EXPANSION_LIKELY'
            ? 'Ampliar spread visible y capturar margen en puntas'
            : 'Operar con volumen normal';
      simulatedResult = {
        ...simulatedResult,
        parallelRate: parallelRead.value,
        bcvRate: bcvRead.value,
        gapPct: bcvGapPct === null ? null : Number(bcvGapPct.toFixed(2)),
        isInBcvInterventionWindow: isInWindow,
        bcvPhase: bcvIntel.window.phase,
        hoursUntilIntervention: bcvIntel.window.hoursUntilIntervention,
        tacticalRecommendation: bcvIntel.recommendation.action,
        bidDepthUsdt: depthKnown ? bidDepth : null,
        askDepthUsdt: depthKnown ? askDepth : null,
        spreadDynamic: depthKnown ? spreadDynamic : null,
        suggestedAction: depthKnown ? suggestedAction : null,
        ...(depthKnown ? {} : missingReadingFields(depthFaltante)),
      };
    }
  } else if (toolName === 'calculate_delta_neutral_hedge') {
    const vesBal = Number((args as any)?.vesBalance ?? 120000);
    const refRead = readMarketRate(
      args,
      'usdtReferencePrice',
      'Cotizave `parallel` o libro Binance P2P',
    );
    const targetHedge = Number((args as any)?.targetHedgePct ?? 100);
    if (refRead.value === null) {
      // Sin precio de referencia no hay conversión a USDT, y por lo tanto no hay
      // ni tamaño de cobertura ni pérdida proyectada. Antes ambos salían de
      // 84.12 y eran recommendations accionables sobre un precio inexistente.
      simulatedResult = {
        ...simulatedResult,
        vesBalance: vesBal,
        usdtReferencePrice: null,
        usdtValueEquivalent: null,
        targetHedgePct: targetHedge,
        requiredShortHedgeUsdt: null,
        projectedLossIfUnhedged5PctUsd: null,
        recommendedInstrument: null,
        humanInTheLoopNotice: null,
        ...rateUnavailableFields(refRead),
      };
    } else {
      const usdtVal = vesBal / refRead.value;
      const reqHedge = (usdtVal * targetHedge) / 100;
      simulatedResult = {
        ...simulatedResult,
        vesBalance: vesBal,
        usdtReferencePrice: refRead.value,
        usdtValueEquivalent: Number(usdtVal.toFixed(2)),
        targetHedgePct: targetHedge,
        requiredShortHedgeUsdt: Number(reqHedge.toFixed(2)),
        projectedLossIfUnhedged5PctUsd: Number((usdtVal * 0.05).toFixed(2)),
        recommendedInstrument: 'Perpetual Futures 1x Short o Aave Variable Debt',
        humanInTheLoopNotice:
          'Requiere confirmación explícita del operador antes de abrir posición en protocolo de derivados.',
      };
    }
  } else if (toolName === 'trigger_killswitch') {
    const reason = String((args as any)?.reason ?? 'Parada de emergencia');
    const source = String((args as any)?.source ?? 'UI');
    const humanConfirm = Boolean((args as any)?.humanConfirm);
    if (!humanConfirm) {
      simulatedResult = {
        ...simulatedResult,
        triggered: false,
        requiresHumanConfirmation: true,
        challengeToken: 'CHALLENGE_KILLSWITCH_' + Math.random().toString(36).substring(7),
        message: 'Acción crítica protegida. Reenvía con humanConfirm: true.',
      };
    } else {
      simulatedResult = {
        ...simulatedResult,
        triggered: true,
        timestamp: Date.now(),
        reason,
        source,
        verdict: 'ALL_OPERATIONS_FROZEN_SUCCESSFULLY',
      };
    }
  } else if (toolName === 'add_operation_entry') {
    // Los tres campos son obligatorios en `AddOperationEntryInputSchema`
    // (vesAmount, usdtAmount, price positivo) y los tres terminan en la misma fila
    // del ledger. Grabar 8200 / 100 / 82.0 no era una simulación: era un asiento con
    // un precio que nadie cotizó, y un asiento no se puede "declarar después" como
    // referencial porque es inmutable por diseño. Si falta cualquiera de los tres, no
    // se escribe nada.
    const side = (args as any)?.side ?? 'buy';
    const vesAmountRaw = (args as any)?.vesAmount;
    const usdtAmountRaw = (args as any)?.usdtAmount;
    const priceRead = readMarketRate(
      args,
      'price',
      'precio de la operación declarado por el llamante',
    );
    const amountsKnown =
      Number.isFinite(Number(vesAmountRaw)) && Number.isFinite(Number(usdtAmountRaw));
    const humanConfirm = Boolean((args as any)?.humanConfirm);
    if (!humanConfirm) {
      simulatedResult = {
        ...simulatedResult,
        recorded: false,
        requiresHumanConfirmation: true,
        challengeToken: 'CHALLENGE_LEDGER_' + Math.random().toString(36).substring(7),
        message: 'Acción de escritura en Ledger protegida. Reenvía con humanConfirm: true.',
      };
    } else if (!amountsKnown || priceRead.value === null) {
      simulatedResult = {
        ...simulatedResult,
        recorded: false,
        side,
        vesAmount: amountsKnown ? Number(vesAmountRaw) : null,
        usdtAmount: amountsKnown ? Number(usdtAmountRaw) : null,
        price: priceRead.value,
        // Sin los tres no hay asiento: el hash y el orderId se emiten en null para que
        // un consumidor no pueda interpretar la ausencia como un registro fallido que
        // tuvo un id.
        orderId: null,
        cryptographicReceiptHash: null,
        ...(priceRead.value === null
          ? rateUnavailableFields(priceRead)
          : readingsUnavailableFields(
              !amountsKnown
                ? 'FALTAN_MONTOS_DE_LA_OPERACION'
                : 'MONTOS_DE_LA_OPERACION_NO_PLAUSIBLES',
              'montos declarados por el llamante en `vesAmount` y `usdtAmount`',
            )),
      };
    } else {
      const orderId = `ORD-MCP-${Date.now().toString(36).toUpperCase()}`;
      simulatedResult = {
        ...simulatedResult,
        recorded: true,
        orderId,
        timestamp: new Date().toISOString(),
        side,
        vesAmount: Number(vesAmountRaw),
        usdtAmount: Number(usdtAmountRaw),
        price: priceRead.value,
        auditStatus: 'LEDGER_ENTRY_COMMITTED_IMMUTABLE',
        cryptographicReceiptHash: 'hash_' + Math.random().toString(36).substring(7),
      };
    }
  } else if (toolName === 'get_bcv_rates') {
    // Sin daemon no hay BCV. La firma de la herramienta (`McpService.getBcvRates`)
    // ni siquiera acepta una tasa como argumento, así que acá no hay ningún
    // camino real hacia un número: devolver 72.45 era inventar el ancla oficial
    // de un mercado que cotiza en 857.8876.
    const lectura = readMarketRate(args, 'usd', 'Cotizave `oficial` o el daemon MCP de Electron');
    simulatedResult = {
      ...simulatedResult,
      usd: lectura.value,
      eur: null,
      cny: null,
      rub: null,
      effectiveDate: null,
      source: lectura.value === null ? 'SIN_FUENTE_EN_VIVO' : 'ARGUMENTO_RECIBIDO',
      isFallback: lectura.value === null,
      // La ausencia se declara SOLO cuando hay ausencia. Declararla
      // incondicionalmente sería el error espejo: el LMC descartaría una tasa
      // real porque el envelope dice "no hay dato".
      ...(lectura.value === null ? rateUnavailableFields(lectura) : {}),
    };
  } else if (toolName === 'get_parallel_rates') {
    // Mismo caso: la firma (`McpService.getParallelRates`) no acepta tasas. Los
    // cuatro valores por venue eran inventados uno por uno, y el `average` que
    // colgaba de ellos era la suma de la invención.
    const lectura = readMarketRate(
      args,
      'average',
      'Cotizave `parallel` o el daemon MCP de Electron',
    );
    simulatedResult = {
      ...simulatedResult,
      enparalelovzla: null,
      cotizave: null,
      criptonoticias: null,
      average: lectura.value,
      spreadOverBcvPct: null,
      ...(lectura.value === null ? rateUnavailableFields(lectura) : {}),
    };
  } else if (toolName === 'calculate_rate_gap') {
    // Estas dos SÍ llegan por argumento, y cuando llegan son reales. Lo que no
    // puede pasar es inventarlas: la brecha es exactamente el número que un
    // operador lee como "entrás 16% arriba del oficial".
    const offRead = readMarketRate(args, 'bcvRate', 'Cotizave `oficial` o get_bcv_rates');
    const parRead = readMarketRate(
      args,
      'parallelRate',
      'Cotizave `parallel` o get_parallel_rates',
    );
    if (offRead.value === null || parRead.value === null) {
      const faltante = offRead.value === null ? offRead : parRead;
      simulatedResult = {
        ...simulatedResult,
        officialBcv: offRead.value,
        parallelAverage: parRead.value,
        gapVes: null,
        gapPct: null,
        riskClassification: null,
        ...rateUnavailableFields(faltante),
      };
    } else {
      const gapVes = Math.round((parRead.value - offRead.value) * 100) / 100;
      const gapPct = Math.round(((parRead.value - offRead.value) / offRead.value) * 10000) / 100;
      simulatedResult = {
        ...simulatedResult,
        officialBcv: offRead.value,
        parallelAverage: parRead.value,
        gapVes,
        gapPct,
        riskClassification:
          gapPct > 20
            ? 'SEVERE_DISTORTION'
            : gapPct > 10
              ? 'MODERATE_DISTORTION'
              : 'NORMAL_EQUILIBRIUM',
      };
    }
  } else if (toolName === 'check_bcv_intervention_window') {
    const evalDate = (args as any)?.testTimestamp
      ? new Date((args as any).testTimestamp)
      : new Date();
    const windowInfo = predictBcvIntervention(evalDate);
    const isInterventionActive = windowInfo.phase === 'INTERVENTION_ACTIVE';
    simulatedResult = {
      ...simulatedResult,
      evaluatedTimestamp: evalDate.toISOString(),
      vetDayOfWeek: windowInfo.vetDayOfWeek,
      vetHour: windowInfo.vetHour,
      phase: windowInfo.phase,
      probabilityPct: windowInfo.probabilityPct,
      isInterventionActive,
      nextExpectedIntervention: windowInfo.nextExpectedIntervention,
      hoursUntilIntervention: windowInfo.hoursUntilIntervention,
      rationale: windowInfo.rationale,
      tradingDirectives: isInterventionActive
        ? 'INTERVENCIÓN EN CURSO: El BCV está colocando divisas. Esperar dip o cotizar spreads amplios ante compresión.'
        : windowInfo.phase === 'PRE_INTERVENTION_COMPRESSION'
          ? 'VENTANA PRE-INTERVENCIÓN: Expectativa de inyección. Acelerar venta de USDT en máximos antes de la apertura bancaria.'
          : windowInfo.phase === 'POST_INTERVENTION_REBOUND'
            ? 'VENTANA POST-INTERVENCIÓN: Divisas absorbidas por la banca. Prepararse para rebote del paralelo.'
            : 'MERCADO LIBRE: Flujo estándar sin influencia directa de subasta cambiaria.',
    };
  } else if (toolName === 'autofill_trade_reference') {
    const side = ((args as any)?.side ?? 'BUY') as 'BUY' | 'SELL';
    const targetMargin = Number((args as any)?.targetMarginPct ?? 1.2);
    const fallbackRead = readMarketRate(
      args,
      'fallbackRate',
      'Cotizave `parallel` o libro Binance P2P',
    );
    if (fallbackRead.value === null) {
      // El punto medio sin el cual no hay precio sugerido: publicar una orden
      // alrededor de un 84.12 inventado es presentar una salida en el mercado
      // que el LMC firmaría.
      simulatedResult = {
        ...simulatedResult,
        side,
        referenceMidRate: null,
        targetMarginPct: targetMargin,
        suggestedPrice: null,
        marginVes: null,
        executionAdvice: null,
        formattedSummary: null,
        ...rateUnavailableFields(fallbackRead),
      };
    } else {
      const fallbackRate = fallbackRead.value;
      const marginVes = Math.round(fallbackRate * (targetMargin / 100) * 100) / 100;
      const suggestedPrice =
        side === 'BUY'
          ? Math.round((fallbackRate - marginVes) * 100) / 100
          : Math.round((fallbackRate + marginVes) * 100) / 100;
      simulatedResult = {
        ...simulatedResult,
        side,
        referenceMidRate: fallbackRate,
        targetMarginPct: targetMargin,
        suggestedPrice,
        marginVes,
        executionAdvice:
          side === 'BUY'
            ? 'Publicar orden de compra por debajo del punto medio para capturar margen taker.'
            : 'Publicar orden de venta por encima del punto medio.',
        formattedSummary: `${side} USDT @ ${suggestedPrice.toFixed(2)} VES (Mid: ${fallbackRate.toFixed(2)}, Margen: ${targetMargin}%)`,
      };
    }
  } else if (toolName === 'get_binance_p2p_orderbook') {
    // Un libro de órdenes inventado es el peor caso posible de esta función:
    // no es un dato de contexto, ES la afirmación "estas son las ofertas que
    // tenés en el mercado ahora". El LMC la lee como competencia real y
    // `recommend_competitive_pricing` compite contra ella. Antes devolvía
    // 82.2/82.85 (y 4210/4250 para COP) como si fueran el libro vivo.
    const fiat = (args as any)?.fiat ?? 'VES';
    const topBuyRead = readMarketRate(
      args,
      'topBuyPrice',
      'libro Binance P2P en vivo o get_binance_p2p_orderbook',
    );
    const topSellRead = readMarketRate(
      args,
      'topSellPrice',
      'libro Binance P2P en vivo o get_binance_p2p_orderbook',
    );
    if (topBuyRead.value === null || topSellRead.value === null) {
      const faltante = topBuyRead.value === null ? topBuyRead : topSellRead;
      simulatedResult = {
        ...simulatedResult,
        fiat,
        asset: (args as any)?.asset ?? 'USDT',
        timestamp: new Date().toISOString(),
        topBuyPrice: topBuyRead.value,
        topSellPrice: topSellRead.value,
        spreadVes: null,
        spreadPct: null,
        totalBuyDepthUsdt: null,
        totalSellDepthUsdt: null,
        buyOffersCount: null,
        sellOffersCount: null,
        ...rateUnavailableFields(faltante),
      };
    } else {
      const spreadVes = Math.round((topSellRead.value - topBuyRead.value) * 100) / 100;
      const spreadPct =
        topBuyRead.value > 0
          ? Math.round(((topSellRead.value - topBuyRead.value) / topBuyRead.value) * 10000) / 100
          : null;
      simulatedResult = {
        ...simulatedResult,
        fiat,
        asset: (args as any)?.asset ?? 'USDT',
        timestamp: new Date().toISOString(),
        topBuyPrice: topBuyRead.value,
        topSellPrice: topSellRead.value,
        spreadVes,
        spreadPct,
        totalBuyDepthUsdt: (args as any)?.totalBuyDepthUsdt ?? null,
        totalSellDepthUsdt: (args as any)?.totalSellDepthUsdt ?? null,
        buyOffersCount: (args as any)?.buyOffersCount ?? null,
        sellOffersCount: (args as any)?.sellOffersCount ?? null,
      };
    }
  } else if (toolName === 'detect_usdt_depeg') {
    // El precio spot es una lectura de mercado y el veredicto de depeg sale de
    // compararlo contra la paridad. Con 0.9992 inventado la respuesta era siempre
    // `isDepegged: false` con "paridad estable": una afirmación de salud de un
    // mercado que nadie observó. `thresholdPct` sí es un umbral de política y se
    // queda.
    const spotRead = readMarketRate(
      args,
      'spotUsdtPrice',
      'precio spot de USDT en vivo o libro Binance P2P',
    );
    const threshold = Number((args as any)?.thresholdPct ?? 0.2);
    if (spotRead.value === null) {
      simulatedResult = {
        ...simulatedResult,
        spotUsdtPrice: null,
        parityDeviationPct: null,
        status: null,
        isDepegged: null,
        thresholdPct: threshold,
        arbitrageOpportunity: null,
        riskSeverity: null,
        recommendation: null,
        isEmergencyActionRequired: null,
        ...rateUnavailableFields(spotRead),
      };
    } else {
      const spotPrice = spotRead.value;
      const devPct = Math.round(Math.abs(spotPrice - 1.0) * 10000) / 100;
      const isDepegged = devPct >= threshold;
      simulatedResult = {
        ...simulatedResult,
        spotUsdtPrice: spotPrice,
        parityDeviationPct: devPct,
        status: isDepegged
          ? spotPrice < 1.0
            ? 'DEPEG_DISCOUNT'
            : 'DEPEG_PREMIUM'
          : 'PEGGED_NORMAL',
        isDepegged,
        thresholdPct: threshold,
        arbitrageOpportunity: isDepegged,
        riskSeverity: devPct > 1.0 ? 'CRITICAL' : isDepegged ? 'HIGH' : 'LOW',
        recommendation: isDepegged
          ? 'Monitorear reservas y limitar exposición overnight en USDT.'
          : 'Paridad estable dentro de tolerancia.',
        isEmergencyActionRequired: devPct > 1.0,
      };
    }
  } else if (toolName === 'recommend_competitive_pricing') {
    const recSide = ((args as any)?.side ?? 'BUY') as 'BUY' | 'SELL';
    const recStrategy = (args as any)?.strategy ?? 'TOP_1';
    const stepVes = Number((args as any)?.stepVes ?? 0.05);
    const marginPct = Number((args as any)?.targetMarginPct ?? 1.15);
    // El break-even es un precio, y el precio de compra real de la USDT solo lo
    // conoce quien la compró. El contrato real lo declara `.optional()`, así que su
    // ausencia es un caso legítimo — y con 82.5 hardcodeado se filtraba igual al
    // resultado: `marginVes` y `isWithinSafeBoundaries` affirmed "estás 3.66 VES
    // arriba de tu costo" sobre un costo inventado. El medio del mercado alcanza
    // para sugerir precio; sin break-even no se afirma nada sobre el margen.
    const breakEvenRead = readMarketRate(
      args,
      'breakEvenPrice',
      'costo real de adquisición de la USDT (precio de compra + comisiones)',
    );
    const midRead = readMarketRate(
      args,
      'currentMarketMid',
      'Cotizave `parallel` o libro Binance P2P',
    );
    if (midRead.value === null) {
      // Sin el medio del mercado no hay precio competitivo que sugiera: la
      // herramienta deja de recomendar un precio de publicación.
      simulatedResult = {
        ...simulatedResult,
        side: recSide,
        strategy: recStrategy,
        currentMarketMid: null,
        suggestedPrice: null,
        competitorPrice: null,
        stepVes,
        targetMarginPct: marginPct,
        marginVes: null,
        isWithinSafeBoundaries: null,
        advice: null,
        executionSummary: null,
        ...rateUnavailableFields(midRead),
      };
    } else {
      const marketMid = midRead.value;
      const breakEven = breakEvenRead.value;
      const compPrice = recSide === 'BUY' ? marketMid - 0.5 : marketMid + 0.5;
      const suggPrice = recSide === 'BUY' ? compPrice + stepVes : compPrice - stepVes;
      simulatedResult = {
        ...simulatedResult,
        side: recSide,
        strategy: recStrategy,
        currentMarketMid: marketMid,
        breakEvenPrice: breakEven,
        suggestedPrice: Number(suggPrice.toFixed(2)),
        competitorPrice: Number(compPrice.toFixed(2)),
        stepVes,
        targetMarginPct: marginPct,
        marginVes: breakEven === null ? null : Number(Math.abs(suggPrice - breakEven).toFixed(2)),
        isWithinSafeBoundaries: breakEven === null ? null : suggPrice >= breakEven,
        advice: `Colocar anuncio ${recSide} a ${suggPrice.toFixed(2)} VES para liderar libro de órdenes.`,
        executionSummary: `Colocar anuncio ${recSide} a ${suggPrice.toFixed(2)} VES (${recStrategy} vs competidor en ${compPrice.toFixed(2)} VES)`,
        ...(breakEven === null ? missingReadingFields(breakEvenRead) : {}),
      };
    }
  } else if (toolName === 'analyze_orderbook_pressure') {
    // La profundidad del libro es la lectura en vivo que define TODA la salida de
    // esta herramienta: sin ella el ratio, el lado dominante, el régimen y la
    // velocidad de presión son invenciones. 18000/14000 además producían
    // `dominantSide: 'BUY_PRESSURE'` y `marketRegime: 'BULLISH_LOCAL_DEMAND'`, es
    // decir, una recomendación de mercado construida sobre un libro que no existe.
    const fiat = (args as any)?.fiat ?? 'VES';
    const bidDepthRaw = (args as any)?.bidDepthUsdt;
    const askDepthRaw = (args as any)?.askDepthUsdt;
    const depthsKnown =
      bidDepthRaw !== undefined &&
      askDepthRaw !== undefined &&
      Number.isFinite(Number(bidDepthRaw)) &&
      Number.isFinite(Number(askDepthRaw)) &&
      Number(bidDepthRaw) >= 0 &&
      Number(askDepthRaw) >= 0;
    if (!depthsKnown) {
      const faltante: MarketRateReading = {
        value: null,
        reason:
          bidDepthRaw === undefined
            ? 'FALTA_ARGUMENTO_bidDepthUsdt'
            : askDepthRaw === undefined
              ? 'FALTA_ARGUMENTO_askDepthUsdt'
              : 'ARGUMENTO_PROFUNDIDAD_LIBRO_NO_PLAUSIBLE',
        expectedSource: 'libro Binance P2P en vivo o get_binance_p2p_orderbook',
      };
      simulatedResult = {
        ...simulatedResult,
        fiat,
        bidDepthUsdt: null,
        askDepthUsdt: null,
        orderbookImbalanceRatio: null,
        dominantSide: null,
        // El score de manipulación y la detección de liquidez fantasma eran
        // constantes (15 y false) en las dos ramas: no salen de ningún cálculo, así
        // que tampoco puede afirmarlos la rama honesta. El spoofing se verifica en
        // `analyzeMicrostructurePressure` (herramienta del daemon).
        manipulationRiskScore: null,
        phantomLiquidityDetected: null,
        pressureVelocity: null,
        actionableInsight: null,
        marketRegime: null,
        ...rateUnavailableFields(faltante),
      };
    } else {
      const bidDepth = Number(bidDepthRaw);
      const askDepth = Number(askDepthRaw);
      const total = bidDepth + askDepth;
      const ratio = total > 0 ? Math.round((bidDepth / total) * 1000) / 1000 : 0.5;
      const dominantSide =
        ratio >= 0.58 ? 'BUY_PRESSURE' : ratio <= 0.42 ? 'SELL_PRESSURE' : 'BALANCED';
      simulatedResult = {
        ...simulatedResult,
        fiat,
        bidDepthUsdt: bidDepth,
        askDepthUsdt: askDepth,
        orderbookImbalanceRatio: ratio,
        dominantSide,
        manipulationRiskScore: null,
        phantomLiquidityDetected: null,
        pressureVelocity: ratio >= 0.68 || ratio <= 0.32 ? 'ACCELERATING' : 'NEUTRAL',
        actionableInsight:
          dominantSide === 'BUY_PRESSURE'
            ? 'Fuerte demanda de compra en libro.'
            : dominantSide === 'SELL_PRESSURE'
              ? 'Presión de venta en libro.'
              : 'Libro equilibrado.',
        marketRegime:
          dominantSide === 'BUY_PRESSURE'
            ? 'BULLISH_LOCAL_DEMAND'
            : dominantSide === 'SELL_PRESSURE'
              ? 'BEARISH_LOCAL_SUPPLY'
              : 'BALANCED_LIQUIDITY',
      };
    }
  } else if (toolName === 'stress_test_portfolio') {
    const usdtCapital = Number((args as any)?.usdtCapital ?? 8000);
    const vesCapital = Number((args as any)?.vesCapital ?? 160000);
    const refRead = readMarketRate(
      args,
      'referenceRate',
      'Cotizave `parallel` o get_parallel_rates',
    );
    const hedgedPct = Number((args as any)?.hedgedPct ?? 50);
    if (refRead.value === null) {
      // Todo el stress test se cuelga de la tasa de conversión VES→USDT. Sin ella
      // no hay exposición, ni escenarios de devaluación, ni veredicto de
      // solvencia: emitirlos habría sido una sentencia de riesgo sobre un
      // número inventado.
      simulatedResult = {
        ...simulatedResult,
        referenceRate: null,
        baselinePortfolioValueUsdt: null,
        vesExposureUsdt: null,
        vesExposurePct: null,
        hedgedPct,
        unhedgedVesAmount: vesCapital * (1 - hedgedPct / 100),
        scenariosCount: null,
        scenarios: null,
        recommendedHedgeUsdt: null,
        institutionalSummary: null,
        ...rateUnavailableFields(refRead),
      };
    } else {
      const refRate = refRead.value;
      const vesExpUsdt = Math.round((vesCapital / refRate) * 100) / 100;
      const baseValUsdt = Math.round((usdtCapital + vesExpUsdt) * 100) / 100;
      const scenarios = [5, 10, 20].map((d) => {
        const newRate = Math.round(refRate * (1 + d / 100) * 100) / 100;
        const loss =
          Math.round(
            ((vesCapital * (1 - hedgedPct / 100)) / refRate -
              (vesCapital * (1 - hedgedPct / 100)) / newRate) *
              100,
          ) / 100;
        return {
          devaluationPct: d,
          newRate,
          lossUsdt: loss,
          postStressPortfolioValueUsdt: Math.round((baseValUsdt - loss) * 100) / 100,
          portfolioDrawdownPct: Math.round((loss / baseValUsdt) * 10000) / 100,
          solvencyStatus: loss > baseValUsdt * 0.08 ? 'CRITICAL_EQUITY_RISK' : 'HEALTHY',
        };
      });
      simulatedResult = {
        ...simulatedResult,
        referenceRate: refRate,
        baselinePortfolioValueUsdt: baseValUsdt,
        vesExposureUsdt: vesExpUsdt,
        vesExposurePct: Math.round((vesExpUsdt / baseValUsdt) * 10000) / 100,
        hedgedPct,
        unhedgedVesAmount: vesCapital * (1 - hedgedPct / 100),
        scenariosCount: scenarios.length,
        scenarios,
        recommendedHedgeUsdt: Math.round(vesExpUsdt * (1 - hedgedPct / 100) * 100) / 100,
        institutionalSummary: `Exposición a VES: $${vesExpUsdt} USDT. Cobertura actual: ${hedgedPct}%.`,
      };
    }
  } else if (toolName === 'rebalance_capital_allocation') {
    const totalCap = Number((args as any)?.totalCapitalUsdt ?? 10000);
    const refRead = readMarketRate(
      args,
      'referenceRate',
      'Cotizave `parallel` o get_parallel_rates',
    );
    if (refRead.value === null) {
      // El plan de asignación se dimensiona en USDT a partir de la tasa de
      // referencia. Sin ella no hay plan que ejecutar.
      simulatedResult = {
        ...simulatedResult,
        totalCapitalUsdt: totalCap,
        referenceRate: null,
        riskMode: (args as any)?.riskMode ?? 'BALANCED',
        allocations: null,
        dynamicLimits: null,
        strategicNotes: null,
        activeChannelsCount: null,
        ...rateUnavailableFields(refRead),
      };
    } else {
      const plan = buildPortfolioAllocationPlan(totalCap, [], refRead.value);
      simulatedResult = {
        ...simulatedResult,
        totalCapitalUsdt: plan.totalCapitalUsdt,
        referenceRate: plan.referenceRateVes,
        riskMode: (args as any)?.riskMode ?? 'BALANCED',
        allocations: plan.allocations,
        dynamicLimits: plan.limitsRecommendation,
        strategicNotes: plan.strategicNotes,
        activeChannelsCount: plan.allocations.length,
      };
    }
  } else if (toolName === 'audit_counterparty_exposure') {
    const alias = (args as any)?.counterpartyAlias ?? null;
    const count = (args as any)?.historicalTradesCount ?? null;
    // No counterparty ledger is reachable here. Emitting a risk score or an approval
    // verdict would be fabricated KYC, so we report the absence instead.
    simulatedResult = {
      ...simulatedResult,
      totalTradesAudited: count,
      uniqueCounterpartiesCount: null,
      counterpartyRiskScore: null,
      concentration: {
        topCounterpartyAlias: alias,
        topCounterpartyVolumeUsdt: null,
        topCounterpartySharePct: null,
        exceedsSafeLimit: null,
      },
      flaggedCounterpartiesCount: null,
      flaggedCounterparties: null,
      complianceVerdict: 'UNVERIFIED_NO_COUNTERPARTY_LEDGER',
      recommendations: null,
      isSafeForInstitutionalTrading: null,
      unavailableReason: 'NO_COUNTERPARTY_LEDGER',
      actionable: false,
    };
  } else if (toolName === 'project_compound_runway') {
    const initCap = Number((args as any)?.initialCapitalUsdt ?? 5000);
    const netMargin = Number((args as any)?.netMarginPctPerCycle ?? 0.9);
    const cycles = Number((args as any)?.cyclesPerDay ?? 2);
    const days = Number((args as any)?.operationalDays ?? 30);
    const reinvest = Number((args as any)?.reinvestmentRatePct ?? 100);
    const fixedExp = Number((args as any)?.monthlyFixedExpensesUsdt ?? 200);
    const dailyLimit = (args as any)?.dailyBankLimitVes
      ? Number((args as any).dailyBankLimitVes)
      : undefined;
    const refRead = readMarketRate(
      args,
      'referenceRateVes',
      'Cotizave `parallel` o get_parallel_rates',
    );
    if (refRead.value === null) {
      // El runway del límite bancario se dimensiona con la referencia VES→USDT.
      // Con 84.12 hardcodeado, la proyección de cobertura de gastos y la alerta de
      // "banking wall"-salían de una tasa que difiere de la real en más de 10x.
      simulatedResult = {
        ...simulatedResult,
        initialCapitalUsdt: initCap,
        referenceRateVes: null,
        projectedFinalCapitalUsdt: null,
        totalNetProfitUsdt: null,
        totalReturnPct: null,
        operationalDays: days,
        milestones: null,
        bankingWallAlert: null,
        monthlyRunwayCoverageMonths: null,
        hasReachedBankingWall: null,
        executiveSummary: null,
        ...rateUnavailableFields(refRead),
      };
    } else {
      const runway = simulateCompoundGrowth({
        initialCapitalUsdt: initCap,
        netMarginPctPerCycle: netMargin,
        cyclesPerDay: cycles,
        operationalDays: days,
        reinvestmentRatePct: reinvest,
        dailyBankLimitVes: dailyLimit,
        referenceRateVes: refRead.value,
      });
      const coverageMonths =
        fixedExp > 0 ? Number((runway.totalNetProfitUsdt / fixedExp).toFixed(1)) : 12;
      simulatedResult = {
        ...simulatedResult,
        initialCapitalUsdt: runway.initialCapitalUsdt,
        referenceRateVes: refRead.value,
        projectedFinalCapitalUsdt: runway.finalWorkingCapitalUsdt,
        totalNetProfitUsdt: runway.totalNetProfitUsdt,
        totalReturnPct: runway.totalReturnPct,
        operationalDays: days,
        milestones: runway.milestones,
        bankingWallAlert: runway.bankingWallAlert,
        monthlyRunwayCoverageMonths: coverageMonths,
        hasReachedBankingWall: Boolean(runway.bankingWallAlert),
        executiveSummary: `Proyección a ${days} días: Capital proyectado $${runway.finalWorkingCapitalUsdt.toLocaleString()} USDT (+${runway.totalReturnPct}%). Ganancia neta: $${runway.totalNetProfitUsdt.toLocaleString()} USDT. Cobertura de gastos: ${coverageMonths} meses.`,
      };
    }
  } else if (toolName === 'gdrive_backup_receipt') {
    const tradeId = String((args as any)?.tradeId ?? 'ORD-DEMO-01');
    const counterparty = String((args as any)?.counterparty ?? 'Anónimo');
    const ext = (args as any)?.mimeType === 'application/pdf' ? 'pdf' : 'png';
    const fileName = (args as any)?.fileName ?? `Receipt_${tradeId}_${counterparty}.${ext}`;
    const simId = `1gDrive_${Date.now().toString(36)}`;
    simulatedResult = {
      ...simulatedResult,
      success: true,
      fileId: simId,
      fileName,
      folderPath: 'P2P_Receipts/2026-09',
      webViewLink: `https://drive.google.com/file/d/${simId}/view`,
      downloadLink: `https://drive.google.com/uc?id=${simId}&export=download`,
      tradeId,
      counterparty,
      mode: 'SIMULATED',
      syncedAt: new Date().toISOString(),
      message: `Comprobante ${fileName} respaldado en Google Drive.`,
    };
  } else if (toolName === 'gsheets_sync_trade') {
    const trade = (args as any)?.trade ?? {};
    const sheetName = String((args as any)?.sheetName ?? 'Operaciones P2P');
    // No Sheets connection exists in this environment. A hardcoded ID would point at a
    // spreadsheet that does not exist and invite the agent to "open" it.
    const spreadsheetId = (args as any)?.spreadsheetId ?? null;
    simulatedResult = {
      ...simulatedResult,
      success: false,
      spreadsheetId,
      sheetName,
      updatedRange: null,
      updatedRows: 0,
      spreadsheetUrl: null,
      mode: 'SIMULATED',
      syncedTrade: {
        id: trade.id ?? null,
        side: trade.side ?? null,
        rate: trade.rate ?? null,
        usdtAmount: trade.usdtAmount ?? null,
        vesAmount: trade.vesAmount ?? null,
        netProfitUsdt: trade.netProfitUsdt ?? null,
        counterparty: trade.counterparty ?? null,
      },
      unavailableReason: 'NO_GOOGLE_SHEETS_CONNECTION',
      message: 'No se pudo sincronizar: no hay conexión con Google Sheets en este entorno.',
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'gdrive_sync_db_backup') {
    const backupType = String((args as any)?.backupType ?? 'ledger_json');
    const simId = `1gDrive_backup_${Date.now().toString(36)}`;
    simulatedResult = {
      ...simulatedResult,
      success: true,
      fileId: simId,
      fileName: `p2p_backup_${backupType}_${new Date().toISOString().slice(0, 10)}.json`,
      backupType,
      encrypted: Boolean((args as any)?.encrypt),
      sizeBytes: 15420,
      webViewLink: `https://drive.google.com/file/d/${simId}/view`,
      mode: 'SIMULATED',
      backupTimestamp: new Date().toISOString(),
      message: `Respaldo ${backupType} sincronizado en Google Drive.`,
    };
  } else if (toolName === 'screen_wallet_address') {
    const addr = String((args as any)?.address ?? 'TYDzsYUEpvnYmQk4zGP9sWWcTEd36GunL');
    const net = String((args as any)?.network ?? 'TRC20');
    simulatedResult = {
      ...simulatedResult,
      address: addr,
      network: net,
      riskScore: null,
      riskLevel: 'UNVERIFIED_OFFLINE',
      recommendation: 'MANUAL_COMPLIANCE_REVIEW_REQUIRED',
      flags: ['NO_LIVE_AML_FEED'],
      sanctionedMatch: null,
      actionable: false,
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'inspect_tx_taint') {
    const tx = String((args as any)?.txHash ?? 'e4d909c290d0fb1ca068ffaddf22cbd0d0c35');
    simulatedResult = {
      ...simulatedResult,
      txHash: tx,
      chain: (args as any)?.chain ?? 'TRON',
      taintPercentage: null,
      directHopToMixer: null,
      clusterAttribution: 'UNINSPECTED_OFFLINE_FALLBACK',
      isClean: null,
      compliancePass: false,
      actionable: false,
      inspectionTimestamp: new Date().toISOString(),
    };
  } else if (toolName === 'fetch_cross_exchange_spread') {
    // El contrato real de esta herramienta no acepta ninguna lectura de mercado del
    // llamante: `FetchCrossExchangeSpreadInputSchema` solo trae filtros (fiat, asset,
    // paymentMethod, minMerchantTrades) y la herramienta real obtiene las quotes
    // ella misma de las APIs públicas de libro. Aquí no hay libro al que pedirle una
    // fila, así que no hay nada honesto que devolver: cuatro exchanges con rates
    // derivados de 79.2 y 4250, spreads fijos y "KuCoin compra / Bybit vende" eran
    // un arbitraje proyectado sobre un mercado que no existe. `isViable: false` y el
    // `unverifiedNotice` no convertían la tabla en una observación.
    const fiat = String((args as any)?.fiat ?? 'VES');
    simulatedResult = {
      ...simulatedResult,
      fiat,
      asset: (args as any)?.asset ?? 'USDT',
      paymentMethod: (args as any)?.paymentMethod ?? 'Pago Movil',
      minMerchantTrades: (args as any)?.minMerchantTrades ?? null,
      exchanges: null,
      exchangesCount: null,
      crossArbitrageOpportunity: null,
      bestVenueComparison: null,
      timestamp: new Date().toISOString(),
      ...readingsUnavailableFields(
        'NO_QUOTES_REACHABLE_NO_LIVE_VENUES',
        'quotes de libro en vivo por exchange vía fetch_cross_exchange_spread con transporte nativo',
      ),
    };
  } else if (toolName === 'verify_inbound_transfer') {
    const ref = (args as any)?.referenceNumber
      ? String((args as any).referenceNumber)
      : 'REF-UNVERIFIED';
    simulatedResult = {
      ...simulatedResult,
      referenceNumber: ref,
      amountVes: (args as any)?.amountVes ? Number((args as any).amountVes) : 0,
      bankCode: (args as any)?.bankCode ?? '0102',
      status: 'UNVERIFIED_NO_BANK_CONNECTION',
      reconciledInMs: 0,
      bankResponseCode: null,
      senderCedulaValidated: false,
      senderPhoneValidated: false,
      ledgerReceiptId: null,
      recommendation: 'DO_NOT_RELEASE_AWAITING_MANUAL_VERIFICATION',
      actionable: false,
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'compile_dispute_dossier') {
    const ord = String((args as any)?.orderId ?? 'ORD-2026-99128');
    simulatedResult = {
      ...simulatedResult,
      orderId: ord,
      dossierStatus: 'DOSSIER_COMPILED_READY_FOR_SUBMISSION',
      sha256Digest: `dossier_sha256_${Date.now()}_${ord.slice(-6)}`,
      disputeReason: (args as any)?.disputeReason ?? 'THIRD_PARTY_PAYMENT',
      recommendedAppealStatement:
        'La contraparte realizó el pago desde una cuenta bancaria a nombre de un tercero no titular...',
      evidenceMetadata: {
        orderId: ord,
        counterparty: (args as any)?.counterpartyNick ?? 'TraderNick',
        fiatAmountVes: Number((args as any)?.amountVes ?? 67320),
        cryptoAmountUsdt: Number((args as any)?.amountUsdt ?? 850),
        bankReference: (args as any)?.bankReference ?? 'REF-987123',
        chatLogSummaryIncluded: true,
        bankingProofTimestamp: new Date().toISOString(),
      },
      exportFormat: 'PDF_A_COMPLIANT',
      resolutionProbabilityPct: 98.4,
    };
  } else if (toolName === 'evaluate_account_saturation') {
    const bId = String((args as any)?.bankId ?? 'banesco_01');
    const cur = Number((args as any)?.currentDailyVes ?? 450000);
    const lim = Number((args as any)?.dailyLimitVes ?? 500000);
    const inc = Number((args as any)?.incomingAmountVes ?? 0);
    const proj = cur + inc;
    const sat = Number(((proj / lim) * 100).toFixed(2));
    simulatedResult = {
      ...simulatedResult,
      bankId: bId,
      currentDailyVes: cur,
      projectedDailyVes: proj,
      dailyLimitVes: lim,
      saturationPercentage: sat,
      remainingQuotaVes: Math.max(0, lim - proj),
      hourlyOps: Number((args as any)?.hourlyTransactionCount ?? 4),
      riskLevel: sat >= 90 ? 'CRITICAL' : sat >= 75 ? 'ELEVATED' : 'SAFE',
      recommendBankRotation: sat >= 80,
      reason:
        sat >= 80
          ? 'Alerta de saturación de cupo bancario superior al 80%.'
          : 'Cuenta en umbrales seguros.',
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'dispatch_order_instructions') {
    const ord = String((args as any)?.orderId ?? 'ORD-55182');
    simulatedResult = {
      ...simulatedResult,
      orderId: ord,
      channel: (args as any)?.channel ?? 'TELEGRAM',
      recipientContact: (args as any)?.recipientContact ?? '@TraderVIP',
      dispatchStatus: 'SENT_SUCCESSFULLY',
      deliveredAt: new Date().toISOString(),
      formattedPayloadPreview: `⚡ ORDEN P2P #${ord} - Pago a Banesco`,
      actionId: `MSG-${Date.now()}`,
    };
  } else if (toolName === 'lookup_counterparty_reputation') {
    const doc = String((args as any)?.documentId ?? 'V-20123456');
    simulatedResult = {
      ...simulatedResult,
      documentId: doc,
      blindHash: `zk_hash_${doc.slice(-4)}_mock`,
      trustScore: null,
      isBlacklisted: null,
      riskLevel: 'UNVERIFIED_OFFLINE',
      historicalIncidents: [],
      recommendation: 'VERIFICATION_UNAVAILABLE_PROCEED_WITH_CAUTION',
      actionable: false,
      consultedAt: new Date().toISOString(),
    };
  } else if (toolName === 'check_bank_operational_status') {
    simulatedResult = {
      ...simulatedResult,
      networkStatus: 'UNVERIFIED_OFFLINE',
      degraded: true,
      fallbackReason: 'OFFLINE_SIMULATION_NO_BANK_HEARTBEAT',
      pauseTradingDirective: false,
      affectedBanks: [],
      averageSettlementLatencyMinutes: null,
      bankDetails: [
        {
          bankCode: '0102',
          bankName: 'Banco de Venezuela (BDV)',
          status: 'UNVERIFIED_OFFLINE',
          settlementLatencyMinutes: null,
        },
        {
          bankCode: '0134',
          bankName: 'Banesco Banco Universal',
          status: 'UNVERIFIED_OFFLINE',
          settlementLatencyMinutes: null,
        },
        {
          bankCode: '0105',
          bankName: 'Mercantil Banco',
          status: 'UNVERIFIED_OFFLINE',
          settlementLatencyMinutes: null,
        },
        {
          bankCode: 'PAGO_MOVIL',
          bankName: 'Suiche Pago Móvil Interbancario',
          status: 'UNVERIFIED_OFFLINE',
          settlementLatencyMinutes: null,
        },
      ],
      operationalAdvice:
        'Sin telemetría bancaria en vivo: estado referencial no verificado. Confirmá manualmente la disponibilidad antes de operar.',
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'check_counterparty_blacklist') {
    const ced = String((args as any)?.cedula ?? '');
    const isBlacklisted = ced.includes('28999888');
    simulatedResult = {
      ...simulatedResult,
      isFlagged: isBlacklisted,
      riskLevel: isBlacklisted ? 'CRITICAL' : 'CLEAN',
      decision: isBlacklisted ? 'IMMEDIATE_BLOCK_TRANSACTION' : 'CLEAN_TO_PROCEED',
      totalMatchesFound: isBlacklisted ? 1 : 0,
      matchedRecords: isBlacklisted
        ? [
            {
              matchedOn: 'CEDULA',
              identifier: 'V-28999888',
              suspectName: 'Pedro Fraude',
              category: 'TRIANGULATION_SCAM',
              notes: 'Reportado por estafa de triangulación.',
              reportedAt: '2026-08-15T10:00:00Z',
            },
          ]
        : [],
      actionRequired: isBlacklisted
        ? 'ALERTA ROJA: Detener de inmediato el envío de Pago Móvil. Coincidencia en lista negra.'
        : 'Contraparte limpia de coincidencias en la lista negra interna.',
      auditTimestamp: new Date().toISOString(),
    };
  } else if (toolName === 'register_blacklisted_entity') {
    const hConf = Boolean((args as any)?.humanConfirm);
    if (!hConf) {
      simulatedResult = {
        ...simulatedResult,
        status: 'CHALLENGE_REQUIRED',
        message: 'Se requiere confirmación humana explícita (humanConfirm: true).',
        challengeToken: `CHL-BL-${Date.now()}`,
      };
    } else {
      simulatedResult = {
        ...simulatedResult,
        status: 'REGISTERED_SUCCESSFULLY',
        blacklistEntryId: `BL-${Date.now()}-REC`,
        identifierType: (args as any)?.identifierType ?? 'CEDULA',
        identifierValue: (args as any)?.identifierValue ?? 'V-11223344',
        counterpartyName: (args as any)?.counterpartyName ?? 'Desconocido',
        fraudCategory: (args as any)?.fraudCategory ?? 'TRIANGULATION_SCAM',
        registeredAt: new Date().toISOString(),
        actionSummary: 'Entidad blindada en la base de datos local para bloqueo automático.',
      };
    }
  } else if (toolName === 'send_multichannel_alert') {
    simulatedResult = {
      ...simulatedResult,
      alertId: `ALT-${Date.now()}`,
      channel: (args as any)?.channel ?? 'TELEGRAM',
      priority: (args as any)?.priority ?? 'ALERT',
      deliveryStatus: 'DISPATCHED_TO_QUEUE',
      deliveredAt: new Date().toISOString(),
      renderedPayloadPreview: `⚡ *${(args as any)?.title ?? 'ALERTA'}*\n${(args as any)?.messageMarkdown ?? ''}`,
      summary: 'Alerta enviada exitosamente por el canal configurado.',
    };
  } else if (toolName === 'process_remote_sentinel_command') {
    const raw = String((args as any)?.rawText ?? 'Registra compra de 500 USDT a 41.50 en Banesco');
    simulatedResult = {
      ...simulatedResult,
      commandType: 'LEDGER_TRANSACTION',
      action: 'ADD_OPERATION_ENTRY',
      status: 'SIMULATED_LOCAL_PARSE',
      ledgerImpact: false,
      actionable: false,
      transactionDetail: {
        ledgerId: `LEDGER-REMOTE-${Date.now()}`,
        side: raw.toLowerCase().includes('venta') ? 'sell' : 'buy',
        usdtAmount: 500,
        ratePrice: 41.5,
        vesTotal: 20750,
        bank: 'Banesco',
        recordedAt: new Date().toISOString(),
      },
      summary:
        'Comando interpretado localmente sin persistencia en base de datos SQLite (modo degradado).',
      rawText: raw,
    };
  } else if (toolName === 'audit_payment_proof_ocr') {
    const ocr = String((args as any)?.ocrRawText ?? '');
    const expAmt = Number((args as any)?.expectedAmountVes ?? 12500);
    simulatedResult = {
      ...simulatedResult,
      orderId: (args as any)?.orderId ?? 'ORD-P2P-101',
      verdict: 'SIMULATED_LOCAL_PREVIEW',
      isSafeToRelease: false,
      actionable: false,
      extractedData: {
        reference: ocr ? 'PARSED_FROM_OCR' : 'NO_REFERENCE',
        amountVes: expAmt,
        bank: (args as any)?.expectedBank ?? 'BANESCO',
        payerCedula: (args as any)?.expectedPayerIdDoc ?? 'V-UNVERIFIED',
      },
      expectedData: {
        amountVes: expAmt,
        bank: (args as any)?.expectedBank ?? 'BANESCO',
        payerIdDoc: (args as any)?.expectedPayerIdDoc ?? 'V-UNVERIFIED',
      },
      discrepancies: [
        'MODO SIMULACIÓN LOCAL: Requiere auditoría humana obligatoria antes de liberar fondos.',
      ],
      actionAdvice:
        'MODO SIMULACIÓN LOCAL: Requiere auditoría humana obligatoria antes de liberar fondos.',
      auditTimestamp: new Date().toISOString(),
    };
  } else if (toolName === 'evaluate_ad_repricing') {
    // El precio objetivo sale de `competitorOrders`, es decir del libro. Sin libro no
    // hay precio: el bloque devolvía 78.85/79.95 y un competidor "MarketMakerPro"
    // que no existe, cuando el daemon con el mismo input responde
    // `NO_COMPETITOR_FOUND`. Se replica la regla del daemon —circuit breakers,
    // filtro anti-spoofing, ranking por `targetRank`— para que la simulación sea la
    // MISMA decisión que ejecutaría el bridge, no una tercera versión inventada.
    const side = (args as any)?.side;
    // `targetRank` sigue el default del schema (TOP_2), no el TOP_1 que se usaba acá:
    // con el default equivocado la mesa apuntaba al líder cuando el bridge iba a
    // apuntar al segundo. Defaults de contrato se copian; supuestos, no.
    const targetRank = (args as any)?.targetRank ?? 'TOP_2';
    const stepVes = Number((args as any)?.stepVes ?? 0.05);
    const minSpreadPct = (args as any)?.minSpreadPct ?? 0.5;
    const breakEvenFloorPrice = Number((args as any)?.breakEvenFloorPrice ?? 0);
    const minCompetitorFinishRatePct = (args as any)?.minCompetitorFinishRatePct ?? 90;
    const minCompetitorOrderLimitUsdt = (args as any)?.minCompetitorOrderLimitUsdt ?? 200;
    const competitorOrdersRaw = (args as any)?.competitorOrders;
    const competitorOrders: any[] = Array.isArray(competitorOrdersRaw) ? competitorOrdersRaw : [];

    // Circuit breakers del daemon, en el mismo orden. `bcvInterventionActive` y
    // `accountSaturationPct` NO son lecturas que el fallback pueda observar: son
    // estado del BCV y de la cuenta bancaria de la mesa. Se replican con el default
    // del schema (`false` / `0`) para no divergir de la decisión del bridge, pero se
    // devuelven en `null` cuando el llamante no los informa: afirmar "0% de
    // saturación" o "sin intervención cambiaria" sería fabricar un hecho externo.
    const bcvInterventionActive = Boolean((args as any)?.bcvInterventionActive ?? false);
    const rawSaturation = (args as any)?.accountSaturationPct;
    const accountSaturationPct = Number.isFinite(Number(rawSaturation))
      ? Number(rawSaturation)
      : null;

    if (side !== 'BUY' && side !== 'SELL') {
      // `side` decide el signo del ajuste y el orden del ranking: sin él no hay
      // decisión que simular. El schema lo exige, así que la ausencia es del
      // llamante y no se cubre con un BUY supuesto.
      simulatedResult = {
        ...simulatedResult,
        recommendedAction: null,
        reason: 'Falta `side` (BUY | SELL): sin lado no hay ni ranking ni signo de ajuste.',
        targetRank,
        suggestedPrice: null,
        targetCompetitorPrice: null,
        targetCompetitorMerchant: null,
        circuitBreakerTriggered: false,
        ...readingsUnavailableFields(
          'FALTA_ARGUMENTO_side',
          'lado de la orden (BUY | SELL) declarado por el llamante',
        ),
      };
    } else if (accountSaturationPct !== null && accountSaturationPct >= 100) {
      simulatedResult = {
        ...simulatedResult,
        recommendedAction: 'PAUSE_AD',
        reason: 'Cuenta bancaria saturada al 100%. Rotación obligatoria antes de cotizar.',
        side,
        targetRank,
        suggestedPrice: null,
        circuitBreakerTriggered: true,
        breakerType: 'ACCOUNT_SATURATION',
        accountSaturationPct,
        ...missingReadingFields({
          value: null,
          reason: 'SIN_ORDENES_COMPETIDORAS_EN_INPUT',
          expectedSource:
            'libro de órdenes P2P en vivo (competitorOrders) provisto por el llamante',
        }),
      };
    } else if (bcvInterventionActive) {
      simulatedResult = {
        ...simulatedResult,
        recommendedAction: 'HOLD_OR_WIDEN',
        reason:
          'Intervención cambiaria activa del BCV. Alta probabilidad de devaluación en ventana de liquidación. Se sugiere pausar o ampliar margen.',
        side,
        targetRank,
        suggestedPrice: null,
        circuitBreakerTriggered: true,
        breakerType: 'BCV_INTERVENTION',
        accountSaturationPct,
        ...missingReadingFields({
          value: null,
          reason: 'SIN_ORDENES_COMPETIDORAS_EN_INPUT',
          expectedSource:
            'libro de órdenes P2P en vivo (competitorOrders) provisto por el llamante',
        }),
      };
    } else {
      const validCompetitors = competitorOrders.filter((c) => {
        const finishRate =
          (c?.finishRate ?? 1) <= 1 ? (c?.finishRate ?? 1) * 100 : (c?.finishRate ?? 1);
        const surplus = c?.surplusAmount ?? 9999;
        return finishRate >= minCompetitorFinishRatePct && surplus >= minCompetitorOrderLimitUsdt;
      });
      const sorted = [...validCompetitors].sort((a: any, b: any) =>
        side === 'BUY' ? b.price - a.price : a.price - b.price,
      );
      const rankIndex = targetRank === 'TOP_1' ? 0 : targetRank === 'TOP_2' ? 1 : 2;
      const targetCompetitor = sorted[rankIndex] ?? sorted[0];
      if (!targetCompetitor) {
        // Ausencia de libro, no ausencia de decisión: la acción recomendada es
        // "no tocar el anuncio" y el precio queda en null.
        simulatedResult = {
          ...simulatedResult,
          recommendedAction: 'NO_COMPETITOR_FOUND',
          reason:
            'Sin órdenes de competidor en el input: no hay libro contra el que calcular un precio de publicación.',
          side,
          targetRank,
          suggestedPrice: null,
          targetCompetitorPrice: null,
          targetCompetitorMerchant: null,
          stepVes,
          minSpreadPct,
          breakEvenFloorPrice,
          filteredSpoofingAdsCount: competitorOrders.length - validCompetitors.length,
          circuitBreakerTriggered: false,
          accountSaturationPct,
          timestamp: new Date().toISOString(),
          ...readingsUnavailableFields(
            'SIN_ORDENES_COMPETIDORAS_EN_INPUT',
            'libro de órdenes P2P en vivo (competitorOrders) provisto por el llamante',
          ),
        };
      } else {
        const rawSuggested =
          side === 'BUY' ? targetCompetitor.price + stepVes : targetCompetitor.price - stepVes;
        const violatesFloor =
          side === 'SELL' && breakEvenFloorPrice > 0 && rawSuggested < breakEvenFloorPrice;
        const suggestedPrice = violatesFloor
          ? breakEvenFloorPrice
          : Number(rawSuggested.toFixed(2));
        simulatedResult = {
          ...simulatedResult,
          recommendedAction: violatesFloor ? 'APPLY_BREAK_EVEN_FLOOR' : 'UPDATE_PRICE',
          side,
          targetRank,
          suggestedPrice,
          targetCompetitorPrice: targetCompetitor.price,
          targetCompetitorMerchant: targetCompetitor.advertiserName ?? 'Anonymous',
          stepVes,
          minSpreadPct,
          breakEvenFloorPrice,
          filteredSpoofingAdsCount: competitorOrders.length - validCompetitors.length,
          violatesFloor,
          circuitBreakerTriggered: false,
          accountSaturationPct,
          summary: `Precio sugerido para ${side} (${targetRank}): ${suggestedPrice.toFixed(2)} VES (vs competidor ${targetCompetitor.price.toFixed(2)} VES)`,
          timestamp: new Date().toISOString(),
        };
      }
    }
  } else if (toolName === 'publish_ad_price') {
    // El precio publicado es la lectura que la escritura va a usar; el contrato real
    // lo exige positivo (`PublishAdPriceInputSchema.newPrice`). Inventar 78.85
    // significaba confirmar en el recibo una escritura de un precio que nadie pidió.
    // Sin precio no hay publicación que confirmar: `success: false` y la ausencia
    // declarada. Con precio real la respuesta sigue siendo una SIMULACIÓN explícita
    // (`simulated: true`, `merchantConfirmed: false`), que es lo que
    // `McpAdPublisherService.judgeResponse` necesita para no escribirle una
    // confirmación de Binance en el journal.
    const adId = (args as any)?.adId ?? 'AD-1001';
    const exchange = (args as any)?.exchange ?? 'BINANCE_P2P';
    const priceRead = readMarketRate(
      args,
      'newPrice',
      'precio solicitado por el llamante (nunca una estimación del simulador)',
    );
    const dryRun = Boolean((args as any)?.dryRun ?? true);
    if (priceRead.value === null) {
      simulatedResult = {
        ...simulatedResult,
        success: false,
        error: 'NO_SE_PUEDE_PUBLICAR_SIN_PRECIO_REAL',
        adId,
        exchange,
        publishedPrice: null,
        dryRun,
        merchantConfirmed: false,
        status: 'UNAVAILABLE_NO_LIVE_SOURCE',
        rationale: (args as any)?.rationale ?? null,
        timestamp: new Date().toISOString(),
        auditTrail: {
          guardrailChecked: false,
          maxPriceDeviationPct: 3.0,
          signature: null,
          merchantRef: null,
        },
        ...rateUnavailableFields(priceRead),
      };
    } else {
      simulatedResult = {
        ...simulatedResult,
        success: true,
        adId,
        exchange,
        publishedPrice: priceRead.value,
        dryRun,
        merchantConfirmed: false,
        // Sin transporte nativo esta función no puede publicar en el exchange, así
        // que el status NO depende de `dryRun`: antes devolvía `PUBLISHED_LIVE` con
        // `dryRun: false` y un lector podía tomar una simulación por una escritura.
        status: 'SIMULATED_SUCCESS',
        rationale: (args as any)?.rationale ?? 'Ajuste automatizado por microestructura MCP',
        timestamp: new Date().toISOString(),
        auditTrail: {
          guardrailChecked: true,
          maxPriceDeviationPct: 3.0,
          signature: `SIG-AD-${adId.slice(-6)}-${Date.now()}`,
          merchantRef: null,
        },
      };
    }
  } else if (toolName === 'toggle_ad_status') {
    const adId = (args as any)?.adId ?? 'AD-1001';
    const exchange = (args as any)?.exchange ?? 'BINANCE_P2P';
    const action = (args as any)?.action ?? 'PAUSE';
    const reason = (args as any)?.reason ?? 'MANUAL_OVERRIDE';
    const stateMap: Record<string, string> = { PAUSE: 'PAUSED', RESUME: 'ACTIVE', CLOSE: 'CLOSED' };
    simulatedResult = {
      ...simulatedResult,
      success: true,
      adId,
      exchange,
      previousAction: action,
      currentStatus: stateMap[action] ?? 'PAUSED',
      triggerReason: reason,
      timestamp: new Date().toISOString(),
      actionSummary: `Anuncio ${adId} en ${exchange} conmutado a ${stateMap[action] ?? 'PAUSED'} debido a ${reason}.`,
    };
  } else if (toolName === 'audit_ad_competitiveness') {
    // El ranking se calcula sobre `competitors`, que el contrato exige (`z.array`, sin
    // optional). Con el array ausente el bloque afirmaba `currentRank: 'TOP_1'`,
    // `isMeetingTargetRank: true`, `totalCompetitorsAnalyzed: 10` y una "posición
    // competitiva saludable" sobre un libro vacío: el mejor veredicto posible sobre
    // el peor dato posible. Se calcula el ranking real del llamante; sin competidores
    // no hay rank y no hay veredicto.
    const adId = (args as any)?.adId ?? 'AD-1001';
    const priceRead = readMarketRate(args, 'myCurrentPrice', 'precio actual del propio anuncio');
    const competitorsRaw = (args as any)?.competitors;
    const competitors: any[] = Array.isArray(competitorsRaw)
      ? competitorsRaw.filter((c: any) => Number.isFinite(Number(c?.price)) && Number(c.price) > 0)
      : [];
    const desiredRank = (args as any)?.desiredRank ?? 'TOP_1';
    if (priceRead.value === null || competitors.length === 0) {
      simulatedResult = {
        ...simulatedResult,
        adId,
        myCurrentPrice: priceRead.value,
        currentRank: null,
        desiredRank,
        isMeetingTargetRank: null,
        totalCompetitorsAnalyzed: competitors.length,
        suspiciousCompetitorsCount: null,
        priceGapWithLeader: null,
        leaderPrice: null,
        leaderMerchant: null,
        assessment: null,
        timestamp: new Date().toISOString(),
        ...(priceRead.value === null
          ? rateUnavailableFields(priceRead)
          : readingsUnavailableFields(
              'SIN_COMPETIDORES_EN_INPUT',
              'precios de competidores del libro en vivo provistos por el llamante',
            )),
      };
    } else {
      const myPrice = priceRead.value;
      const isSell = (args as any)?.side === 'SELL';
      // Ranking por conteo de competidores que cotizan mejor que el mío. Es el mismo
      // criterio del daemon (`sorted.findIndex`) escrito como conteo para que no
      // dependa de la posición dentro del array de entrada.
      const betterCount = competitors.filter((c: any) =>
        isSell ? Number(c.price) > myPrice : Number(c.price) < myPrice,
      ).length;
      const ordered = [...competitors].sort((a: any, b: any) =>
        isSell ? b.price - a.price : a.price - b.price,
      );
      const leader = ordered[0] ?? null;
      const targetPositionRaw = Number(String(desiredRank).replace('TOP_', ''));
      const targetPosition =
        Number.isFinite(targetPositionRaw) && targetPositionRaw > 0 ? targetPositionRaw : 1;
      simulatedResult = {
        ...simulatedResult,
        adId,
        myCurrentPrice: myPrice,
        currentRank: `TOP_${betterCount + 1}`,
        desiredRank,
        isMeetingTargetRank: betterCount < targetPosition,
        totalCompetitorsAnalyzed: ordered.length,
        suspiciousCompetitorsCount: null,
        priceGapWithLeader: leader ? Number((myPrice - Number(leader.price)).toFixed(2)) : null,
        leaderPrice: leader ? Number(leader.price) : null,
        leaderMerchant: leader?.merchantName ?? 'Anonymous',
        assessment: null,
        timestamp: new Date().toISOString(),
      };
    }
  } else if (toolName === 'scan_synthetic_stable_arbitrage') {
    // Las curvas son lecturas de mercado spot y P2P. Sin `pairs` no hay curva que
    // escanear: el bloqueava un par USDC/VES fijo (85.5 / 86.8) y reportaba
    // `opportunitiesCount` sobre él, es decir un arbitrage sintético que ningún
    // scan observó. `opportunitiesCount: 0` tampoco serviría —afirmaría que se
    // escaneó y no halló nada— así que el conteo va en null junto al marcador.
    // DIVERGENCIA CONOCIDA (fuera de alcance de este barrido): el daemon tiene sus
    // propios `defaultQuotes` en `scan_synthetic_stable_arbitrage.ts` y corre el scan
    // sobre ellos cuando `pairs` viene vacío. Ese default debe caer por separado; acá
    // el fallback se niega a inventar la curva.
    const pairsRaw = (args as any)?.pairs;
    const pairs: any[] = Array.isArray(pairsRaw) ? pairsRaw : [];
    const minNetSpreadPct = Number((args as any)?.minNetSpreadPct ?? 0.15);
    if (pairs.length === 0) {
      simulatedResult = {
        ...simulatedResult,
        pairsEvaluated: 0,
        minNetSpreadPct,
        opportunitiesCount: null,
        opportunities: null,
        evaluatedAt: new Date().toISOString(),
        ...readingsUnavailableFields(
          'SIN_CURVAS_SPOT_P2P_EN_INPUT',
          'quotes spot y P2P en vivo provistas por el llamante en `pairs`',
        ),
      };
    } else {
      const opportunities = scanSyntheticStableCurves(pairs, minNetSpreadPct);
      simulatedResult = {
        ...simulatedResult,
        pairsEvaluated: pairs.length,
        minNetSpreadPct,
        opportunitiesCount: opportunities.length,
        opportunities,
        evaluatedAt: new Date().toISOString(),
      };
    }
  } else if (toolName === 'audit_distressed_liquidity_sniper') {
    // `ads` y `fairMarketRate` son ambos obligatorios en
    // `AuditDistressedLiquiditySniperInputSchema` y el daemon no les pone default. Acá
    // se anunciaba un anuncio de panic seller a 80.5 contra una "tasa justa" de 85.5 y
    // se reportaba la oportunidad de snipeo derivada de los dos números inventados.
    // El fee taker se propaga solo si viene: el daemon bloquea la alerta con
    // MISSING_FRICTION_METRICS en vez de asumir un fee que nadie midió.
    const adsRaw = (args as any)?.ads;
    const ads: any[] = Array.isArray(adsRaw) ? adsRaw : [];
    const fairRead = readMarketRate(
      args,
      'fairMarketRate',
      'tasa justa de mercado provista por el llamante',
    );
    const minDislocationPct = Number((args as any)?.minDislocationPct ?? 0.8);
    const maxTakerFeePct = (args as any)?.maxTakerFeePct;
    if (ads.length === 0 || fairRead.value === null) {
      simulatedResult = {
        ...simulatedResult,
        fairMarketRate: fairRead.value,
        minDislocationPct,
        maxTakerFeePct: maxTakerFeePct ?? null,
        frictionMetricsProvided: maxTakerFeePct !== undefined,
        adsEvaluated: ads.length,
        snipingOpportunitiesCount: null,
        snipingOpportunities: null,
        evaluatedAt: new Date().toISOString(),
        ...(fairRead.value === null
          ? rateUnavailableFields(fairRead)
          : readingsUnavailableFields(
              'SIN_ANUNCIOS_EN_LIBRO_EN_INPUT',
              'libro de anuncios P2P en vivo provisto por el llamante en `ads`',
            )),
      };
    } else {
      const snipingOpportunities = scanOrderbookSnipingOpportunities(ads, {
        fairMarketPrice: fairRead.value,
        minProfitThresholdPct: minDislocationPct,
        ...(maxTakerFeePct === undefined ? {} : { maxTakerFeePct }),
      });
      simulatedResult = {
        ...simulatedResult,
        fairMarketRate: fairRead.value,
        minDislocationPct,
        maxTakerFeePct: maxTakerFeePct ?? null,
        frictionMetricsProvided: maxTakerFeePct !== undefined,
        adsEvaluated: ads.length,
        snipingOpportunitiesCount: snipingOpportunities.length,
        snipingOpportunities,
        evaluatedAt: new Date().toISOString(),
      };
    }
  } else if (toolName === 'query_otc_darkpool_spread') {
    // Cada quote de venue es una lectura de mercado (buyRate/sellRate) y las fricciones
    // de transferencia son mediciones. Sin `quotes` el bloque montaba dos venues de
    // ejemplo —incluido un "Caracas Cash Desk" con 83.5/88.5— y devolvía las rutas de
    // arbitrage calculadas sobre ellas. Misma divergencia que en
    // `scan_synthetic_stable_arbitrage`: el daemon conserva `defaultVenues` en
    // `query_otc_darkpool_spread.ts` y hay que retirarlos por separado.
    const volumeUsd = Number((args as any)?.volumeUsd ?? 10000);
    const minNetSpreadPct = Number((args as any)?.minNetSpreadPct ?? 1.2);
    const quotesRaw = (args as any)?.quotes;
    const quotes: any[] = Array.isArray(quotesRaw) ? quotesRaw : [];
    if (quotes.length === 0) {
      simulatedResult = {
        ...simulatedResult,
        volumeTestedUsd: volumeUsd,
        minNetSpreadPct,
        venuesEvaluated: 0,
        routesFoundCount: null,
        routes: null,
        evaluatedAt: new Date().toISOString(),
        ...readingsUnavailableFields(
          'SIN_QUOTES_DE_VENUE_EN_INPUT',
          'quotes de venues en vivo provistas por el llamante en `quotes`',
        ),
      };
    } else {
      const routes = aggregateDarkPoolOpportunities(quotes, {
        capitalUsd: volumeUsd,
        minNetSpreadPct,
      });
      simulatedResult = {
        ...simulatedResult,
        volumeTestedUsd: volumeUsd,
        minNetSpreadPct,
        venuesEvaluated: quotes.length,
        routesFoundCount: routes.length,
        routes,
        evaluatedAt: new Date().toISOString(),
      };
    }
  } else if (toolName === 'route_fintech_payroll_settlement') {
    // La tasa VES/USD solo se usa para los rails en VES, y ahí el monto en VES que la
    // herramienta devuelve es dinero que se va a mover: con 85.5 inventado la
    // cotización de una nómina no era una simulación, era una promesa de pago. Para
    // rails que no pasan por VES la tasa no interviene, así que no se exige.
    // `grossAmountUsd` también es obligatorio en el contrato real y sin él no hay nada
    // que cotizar.
    const platform = (args as any)?.platform ?? (args as any)?.sourcePlatform ?? 'DEEL';
    const grossAmountRead = readMarketRate(
      args,
      'grossAmountUsd',
      'monto bruto de la nómina en USDT',
    );
    const payoutRail = (args as any)?.payoutRail ?? 'VES_PAGO_MOVIL';
    const usaRailVes = payoutRail === 'VES_PAGO_MOVIL' || payoutRail === 'VES_TRANSFERENCIA';
    const vesRateRead = readMarketRate(
      args,
      'vesRatePerUsd',
      'tasa VES/USD en vivo (Cotizave `parallel` o get_parallel_rates)',
    );
    // Defaults de contrato, copiados del schema (`RouteFintechPayrollSettlementInputSchema`):
    // antes el bloque suponía `RECURRENT_REMOTE` (el schema dice STANDARD) y, peor,
    // `isVerifiedContractor: true`. Ese `true` inventado apagaba la clasificación de
    // riesgo de `calculateFintechSettlementQuote`: sin él, una nómina de 10k USDT de
    // un contratista sin verificar salía `riskTier: LOW`, cero horas de validación y el
    // texto "Liquidación Inmediata: Sí (Fondos Verificados)". Fabricar una
    // verificación KYC no es un default, es una mentira de cumplimiento.
    const clientTier = (args as any)?.clientTier ?? 'STANDARD';
    const isVerifiedContractor = Boolean((args as any)?.isVerifiedContractor ?? false);
    const faltaTasa = usaRailVes && vesRateRead.value === null;
    if (grossAmountRead.value === null || faltaTasa) {
      simulatedResult = {
        ...simulatedResult,
        platform,
        grossAmountUsd: grossAmountRead.value,
        payoutRail,
        vesRatePerUsd: vesRateRead.value,
        vesRateRequiredForRail: usaRailVes,
        clientTier,
        isVerifiedContractor,
        quote: null,
        evaluatedAt: new Date().toISOString(),
        ...(faltaTasa
          ? rateUnavailableFields(vesRateRead)
          : readingsUnavailableFields(
              'FALTA_ARGUMENTO_grossAmountUsd',
              'monto bruto de la nómina declarado por el llamante',
            )),
      };
    } else {
      // Para rails que no pasan por VES la tasa no interviene en la liquidación, así
      // que se pasa `undefined` explícito en vez de un número nulo disfrazado: el
      // motor tiene su propio default interno de 85.0 y no hay razón para depender
      // de que su rama VES no se dispare.
      const vesRateForQuote: number | undefined = vesRateRead.value ?? undefined;
      const quote = calculateFintechSettlementQuote({
        platform,
        grossAmountUsd: grossAmountRead.value,
        payoutRail,
        vesRatePerUsd: vesRateForQuote,
        clientTier,
        isVerifiedContractor,
      });
      simulatedResult = {
        ...simulatedResult,
        platform,
        grossAmountUsd: grossAmountRead.value,
        payoutRail,
        vesRatePerUsd: vesRateRead.value,
        vesRateRequiredForRail: usaRailVes,
        clientTier,
        isVerifiedContractor,
        quote,
        evaluatedAt: new Date().toISOString(),
      };
    }
  } else if (toolName === 'recommend_counterparty_yield_price') {
    // `baseMarketRate` es el precio de mercado del que se parte; las métricas de la
    // contraparte (tiempo de liberación, trades, disputas, volumen) son datos de la
    // contraparte. Con la base inventada en 85.5 el bloque publicaba un "yieldPrice"
    // derivado, es decir el precio exacto que el LMC iba a ofrecer. Las métricas sí
    // tienen defaults documentados en el motor de pricing dinámico (ver
    // `calculateDynamicCounterpartyPricing`), así que se conservan; la base no.
    const counterpartyId = String((args as any)?.counterpartyId ?? 'CP-VIP-1');
    const baseRead = readMarketRate(
      args,
      'baseMarketRate',
      'tasa base de mercado provista por el llamante',
    );
    const orderType = ((args as any)?.orderType ?? 'BUY') as 'BUY' | 'SELL';
    const averageReleaseMinutes = Number((args as any)?.averageReleaseMinutes ?? 2.5);
    const completedTradesCount = Number((args as any)?.completedTradesCount ?? 120);
    const disputeCount = Number((args as any)?.disputeCount ?? 0);
    const monthlyVolumeUsd = Number((args as any)?.monthlyVolumeUsd ?? 30000);
    const requestedAmountUsd = Number((args as any)?.requestedAmountUsd ?? 3000);
    if (baseRead.value === null) {
      simulatedResult = {
        ...simulatedResult,
        counterpartyId,
        baseMarketRate: null,
        orderType,
        requestedAmountUsd,
        result: null,
        evaluatedAt: new Date().toISOString(),
        ...rateUnavailableFields(baseRead),
      };
    } else {
      const pricing = calculateDynamicCounterpartyPricing({
        metrics: {
          counterpartyId,
          averageReleaseMinutes,
          completedTradesCount,
          disputeCount,
          monthlyVolumeUsd,
        },
        baseMarketRate: baseRead.value,
        orderType,
        requestedAmountUsd,
      });
      simulatedResult = {
        ...simulatedResult,
        counterpartyId,
        baseMarketRate: baseRead.value,
        orderType,
        requestedAmountUsd,
        result: pricing,
        evaluatedAt: new Date().toISOString(),
      };
    }
  } else if (toolName === 'process_concierge_inquiry') {
    // `deskRatePerUsd` es la tasa que la mesa de concierge prometería al cliente y
    // `generateConciergeReply` la escribe dentro del texto de respuesta: un mensaje al
    // cliente con una tasa de 87.00 VES/USDT que la mesa nunca cotizó. Sin tasa no se
    // redacta la respuesta (sí se puede devolver el intent parseado, que es real), y se
    // declara la ausencia.
    const customerMessage = String((args as any)?.customerMessage ?? (args as any)?.message ?? '');
    const deskRateRead = readMarketRate(
      args,
      'deskRatePerUsd',
      'tasa de venta de la mesa en vivo (Cotizave `parallel` o get_parallel_rates)',
    );
    const bankName = (args as any)?.bankName ?? 'Banesco';
    const bankAccountDetails = (args as any)?.bankAccountDetails ?? '0134-XXXX-XXXX-XXXX';
    if (!customerMessage) {
      simulatedResult = {
        ...simulatedResult,
        parsedInquiry: null,
        exchangeRateUsed: null,
        quoteAmountCrypto: null,
        quoteAmountFiat: null,
        formattedReplyMessage: null,
        processedAt: new Date().toISOString(),
        ...readingsUnavailableFields(
          'FALTA_ARGUMENTO_customerMessage',
          'mensaje del cliente provisto por el llamante',
        ),
      };
    } else {
      const parsed = parseCustomerChatMessage(customerMessage);
      if (deskRateRead.value === null) {
        simulatedResult = {
          ...simulatedResult,
          deskRatePerUsd: null,
          quoteValidityMinutes: null,
          bankName,
          bankAccountDetails,
          // El inquiry parseado sí es una lectura real del mensaje: se devuelve para
          // que el operador sepa qué le preguntan, sin contestarle una tasa. La
          // respuesta queda en null porque redactarla exigiría la tasa.
          parsedInquiry: parsed,
          exchangeRateUsed: null,
          quoteAmountCrypto: null,
          quoteAmountFiat: null,
          formattedReplyMessage: null,
          requiresOperatorHumanReview: true,
          processedAt: new Date().toISOString(),
          ...rateUnavailableFields(deskRateRead),
        };
      } else {
        const reply = generateConciergeReply(parsed, {
          deskRatePerUsd: deskRateRead.value,
          bankName: String(bankName),
          bankAccountDetails: String(bankAccountDetails),
          quoteValidityMinutes: 15,
        });
        simulatedResult = {
          ...simulatedResult,
          deskRatePerUsd: deskRateRead.value,
          quoteValidityMinutes: 15,
          bankName,
          bankAccountDetails,
          ...reply,
          processedAt: new Date().toISOString(),
        };
      }
    }
  } else if (toolName === 'predict_bcv_macro_regime') {
    // Ambas tasas son lecturas de mercado y el régimen se deriva de su brecha. Con
    // 80.0 y 91.5 el motor devolvía `SURTENSION_PARALELO` con confianza calculada:
    // una señal de alerta macroeconómica sobre una brecha que nadie observó. El
    // contexto temporal (días desde la última intervención, hora, día de la semana,
    // inyección estimada) es calendario y política monetaria, no mercado, y se conserva
    // con su default.
    const officialRead = readMarketRate(
      args,
      'bcvOfficialRate',
      'tasa oficial BCV en vivo (get_bcv_rates)',
    );
    const parallelRead = readMarketRate(
      args,
      'parallelMarketRate',
      'tasa paralela en vivo (Cotizave `parallel` o get_parallel_rates)',
    );
    const daysSinceLastIntervention = Number((args as any)?.daysSinceLastIntervention ?? 4);
    const currentHourOfDayUtcMinus4 = Number((args as any)?.currentHourOfDayUtcMinus4 ?? 10);
    const currentDayOfWeek = Number((args as any)?.currentDayOfWeek ?? 1);
    const estimatedWeeklyBcvInjectionUsd = Number(
      (args as any)?.estimatedWeeklyBcvInjectionUsd ?? 50000000,
    );
    if (officialRead.value === null || parallelRead.value === null) {
      const faltante = officialRead.value === null ? officialRead : parallelRead;
      simulatedResult = {
        ...simulatedResult,
        bcvOfficialRate: officialRead.value,
        parallelMarketRate: parallelRead.value,
        gapPct: null,
        daysSinceLastIntervention,
        currentHourOfDayUtcMinus4,
        currentDayOfWeek,
        estimatedWeeklyBcvInjectionUsd,
        assessment: null,
        evaluatedAt: new Date().toISOString(),
        ...rateUnavailableFields(faltante),
      };
    } else {
      const assessment = evaluateMacroBcvRegime({
        bcvOfficialRate: officialRead.value,
        parallelMarketRate: parallelRead.value,
        daysSinceLastIntervention,
        currentHourOfDayUtcMinus4,
        currentDayOfWeek,
        estimatedWeeklyBcvInjectionUsd,
      });
      simulatedResult = {
        ...simulatedResult,
        bcvOfficialRate: officialRead.value,
        parallelMarketRate: parallelRead.value,
        daysSinceLastIntervention,
        currentHourOfDayUtcMinus4,
        currentDayOfWeek,
        estimatedWeeklyBcvInjectionUsd,
        assessment,
        evaluatedAt: new Date().toISOString(),
      };
    }
  } else if (toolName === 'optimize_treasury_idle_yield') {
    const totalUsdtInventory = Number((args as any)?.totalUsdtInventory ?? 25000);
    const currentlyCommittedUsdt = Number((args as any)?.currentlyCommittedUsdt ?? 4000);
    const marketVelocity = (args as any)?.marketVelocity ?? 'LOW_OFFPEAK';
    const flexibleApyPct = Number((args as any)?.flexibleApyPct ?? 10.5);
    const minimumSafetyBufferUsd = Number((args as any)?.minimumSafetyBufferUsd ?? 2500);
    const plan = calculateTreasuryYieldAllocation({
      totalUsdtInventory,
      currentlyCommittedUsdt,
      marketVelocity,
      flexibleApyPct,
      minimumSafetyBufferUsd,
    });
    simulatedResult = {
      ...simulatedResult,
      plan,
      evaluatedAt: new Date().toISOString(),
    };
  } else if (toolName === 'execute_browser_operator_task') {
    const targetSite = (args as any)?.targetSite ?? 'BANESCO_PANAMA';
    const action = (args as any)?.action ?? 'VERIFY_TRANSFER_REFERENCE';
    const referenceToVerify = (args as any)?.referenceToVerify ?? 'REF-998877';
    const expectedAmount = Number((args as any)?.expectedAmount ?? 1250);
    const compiledTask = compileBrowserOperatorTask({
      targetSite,
      action,
      referenceToVerify,
      expectedAmount,
      headless: true,
    });
    simulatedResult = {
      ...simulatedResult,
      compiledTask,
      executionStatus: 'TASK_COMPILED_READY_FOR_AGENT_RUNNER',
      evaluatedAt: new Date().toISOString(),
    };
  }

  return simulatedResult;
}
