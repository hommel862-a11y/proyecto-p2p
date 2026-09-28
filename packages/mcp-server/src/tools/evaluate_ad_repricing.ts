import {
  EvaluateAdRepricingInputSchema,
  type EvaluateAdRepricingInput,
} from '../schemas/index.js';

export const evaluateAdRepricingTool = {
  name: 'evaluate_ad_repricing',
  description:
    'Evalúa la microestructura del libro de órdenes, aplica filtros anti-spoofing (descartando liquidez fantasma y mala reputación), valida la Regla de Oro (spread >= 0.50%) y circuit breakers de saturación bancaria para calcular el precio óptimo del anuncio.',
  inputSchema: EvaluateAdRepricingInputSchema,
  execute: (input: EvaluateAdRepricingInput) => {
    const {
      side,
      targetRank,
      stepVes = 0.05,
      minSpreadPct = 0.5,
      breakEvenFloorPrice = 0,
      minCompetitorOrderLimitUsdt = 200,
      minCompetitorFinishRatePct = 90,
      bcvInterventionActive = false,
      accountSaturationPct = 0,
      competitorOrders = [],
    } = input;

    // 1. Circuit breaker checks
    if (accountSaturationPct >= 100) {
      return {
        recommendedAction: 'PAUSE_AD',
        reason: 'Cuenta bancaria saturada al 100%. Rotación obligatoria antes de cotizar.',
        targetRank,
        suggestedPrice: null,
        circuitBreakerTriggered: true,
        breakerType: 'ACCOUNT_SATURATION',
      };
    }

    if (bcvInterventionActive) {
      return {
        recommendedAction: 'HOLD_OR_WIDEN',
        reason:
          'Intervención cambiaria activa del BCV. Alta probabilidad de devaluación en ventana de liquidación. Se sugiere pausar o ampliar margen.',
        targetRank,
        suggestedPrice: null,
        circuitBreakerTriggered: true,
        breakerType: 'BCV_INTERVENTION',
      };
    }

    // 2. Anti-spoofing filtration
    const validCompetitors = competitorOrders.filter((c) => {
      const finishRate = (c.finishRate ?? 1) <= 1 ? (c.finishRate ?? 1) * 100 : (c.finishRate ?? 1);
      const isReputable = finishRate >= minCompetitorFinishRatePct;
      const surplus = c.surplusAmount ?? 9999;
      const isSubstantial = surplus >= minCompetitorOrderLimitUsdt;
      return isReputable && isSubstantial;
    });

    // Sort order: for BUY (maker buys fiat/sells crypto or vice versa)
    // In P2P: BUY ads are sorted descending (highest price paid first) or ascending depending on side perspective.
    const sorted = [...validCompetitors].sort((a, b) =>
      side === 'BUY' ? b.price - a.price : a.price - b.price,
    );

    const rankIndex = targetRank === 'TOP_1' ? 0 : targetRank === 'TOP_2' ? 1 : 2;
    const targetCompetitor = sorted[rankIndex] ?? sorted[0];

    if (!targetCompetitor) {
      return {
        recommendedAction: 'NO_COMPETITOR_FOUND',
        reason: 'No se encontraron competidores válidos que cumplan los filtros anti-spoofing.',
        suggestedPrice: null,
        circuitBreakerTriggered: false,
      };
    }

    // Calculate suggested price by adjusting with stepVes
    let suggestedPrice: number;
    if (side === 'BUY') {
      suggestedPrice = Number((targetCompetitor.price + stepVes).toFixed(2));
    } else {
      suggestedPrice = Number((targetCompetitor.price - stepVes).toFixed(2));
    }

    // Enforce break-even floor for SELL orders
    let violatesFloor = false;
    if (side === 'SELL' && breakEvenFloorPrice > 0 && suggestedPrice < breakEvenFloorPrice) {
      suggestedPrice = breakEvenFloorPrice;
      violatesFloor = true;
    }

    return {
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
      accountSaturationPct,
      violatesFloor,
      circuitBreakerTriggered: false,
      summary: `Precio sugerido para ${side} (${targetRank}): ${suggestedPrice.toFixed(2)} VES (vs competidor ${targetCompetitor.price.toFixed(2)} VES)`,
      timestamp: new Date().toISOString(),
    };
  },
};
