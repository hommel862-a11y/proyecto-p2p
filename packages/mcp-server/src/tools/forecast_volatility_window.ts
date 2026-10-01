import { getBcvMarketIntelligence, nd } from '../core/index.js';
import {
  ForecastVolatilityWindowInputSchema,
  type ForecastVolatilityWindowInput,
} from '../schemas/index.js';

export const forecastVolatilityWindowTool = {
  name: 'forecast_volatility_window',
  description:
    'Predice la dinámica de spread a 2 horas cruzando la presión del libro de órdenes y los ciclos de intervención cambiaria del BCV.',
  inputSchema: ForecastVolatilityWindowInputSchema,
  execute: (input: ForecastVolatilityWindowInput) => {
    const bcvIntel = getBcvMarketIntelligence(input.parallelRate, input.bcvRate);
    const gapPct = bcvIntel.gap.gapPct;

    const isInWindow = bcvIntel.window.phase === 'INTERVENTION_ACTIVE';
    const depthRatio = input.bidDepthUsdt > 0 ? input.askDepthUsdt / input.bidDepthUsdt : 1;
    let spreadDynamic: 'EXPANSION_LIKELY' | 'COMPRESSION_RISK' | 'STABLE' | 'UNAVAILABLE';

    if (gapPct == null) {
      // Declared, not defaulted. `gapPct > 18` on a `null` is `false`, which would
      // land on STABLE — "the spread is not expected to expand", a forecast
      // about a gap that was never measured. And `null.toFixed(2)` threw. The
      // window phase is still reported (it comes from the clock, not from rates),
      // but the spread dynamic is an absence.
      spreadDynamic = 'UNAVAILABLE';
    } else if (isInWindow && depthRatio < 0.8) {
      spreadDynamic = 'COMPRESSION_RISK';
    } else if (gapPct > 18) {
      spreadDynamic = 'EXPANSION_LIKELY';
    } else {
      spreadDynamic = 'STABLE';
    }

    return {
      // Null passes through as null. A `gapPct: 0` here would be read by a caller
      // as "parallel and official are identical".
      gapPct: gapPct == null ? null : Number(gapPct.toFixed(2)),
      gapStatus: gapPct == null ? 'UNAVAILABLE' : 'MEASURED',
      unavailableReason: bcvIntel.gap.unavailableReason,
      isInBcvInterventionWindow: isInWindow,
      bcvPhase: bcvIntel.window.phase,
      hoursUntilIntervention: bcvIntel.window.hoursUntilIntervention,
      tacticalRecommendation: bcvIntel.recommendation.action,
      recommendationRationale: bcvIntel.recommendation.rationale,
      spreadDynamic,
      // A 2h spread forecast has no gap behind it, so the depth ratio alone
      // cannot produce a directional call.
      actionable: gapPct != null,
      suggestedAction:
        spreadDynamic === 'UNAVAILABLE'
          ? `Sin pronóstico de dinámica de spread: brecha indeterminada (${bcvIntel.gap.unavailableReason ?? 'TASA_NO_DISPONIBLE'}).`
          : spreadDynamic === 'COMPRESSION_RISK'
            ? 'Liquidar inventario con rapidez para evitar compresión de márgenes'
            : spreadDynamic === 'EXPANSION_LIKELY'
              ? 'Ampliar spread visible y capturar margen en puntas'
              : 'Operar con volumen normal',
    };
  },
};
