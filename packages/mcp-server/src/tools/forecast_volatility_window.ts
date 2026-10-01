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

    // The depth ratio is only a number when the book was measured.
    //
    // It used to be `bidDepthUsdt > 0 ? askDepthUsdt / bidDepthUsdt : 1`, and the
    // `1` was invented: a zero or absent bid produced a "neutral" ratio that looks
    // like a computed result. `null` keeps the absence visible, and the missing
    // depth makes the forecast unavailable instead of falsely calm.
    const hasDepth = input.askDepthUsdt != null && input.bidDepthUsdt != null && input.bidDepthUsdt > 0;
    const depthRatio: number | null = hasDepth
      ? input.askDepthUsdt! / input.bidDepthUsdt!
      : null;

    let spreadDynamic: 'EXPANSION_LIKELY' | 'COMPRESSION_RISK' | 'STABLE' | 'UNAVAILABLE';
    let unavailableReason: string | null = null;

    if (gapPct == null) {
      // Declared, not defaulted. `gapPct > 18` on a `null` is `false`, which would
      // land on STABLE — "the spread is not expected to expand", a forecast
      // about a gap that was never measured. And `null.toFixed(2)` threw. The
      // window phase is still reported (it comes from the clock, not from rates),
      // but the spread dynamic is an absence.
      spreadDynamic = 'UNAVAILABLE';
      unavailableReason = bcvIntel.gap.unavailableReason;
    } else if (depthRatio == null) {
      // The gap is measured, so an expansion call would be legitimate — but this
      // tool's edge over a plain gap reading is the order book, and it was not
      // measured. A directional forecast built on half the inputs is how a
      // fabricated default turns into a trade.
      spreadDynamic = 'UNAVAILABLE';
      unavailableReason = 'missing_evidence:bookDepth';
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
      // Null passes through as null too. An absent book is not a balanced book.
      depthRatio: depthRatio == null ? null : Number(depthRatio.toFixed(4)),
      unavailableReason,
      isInBcvInterventionWindow: isInWindow,
      bcvPhase: bcvIntel.window.phase,
      hoursUntilIntervention: bcvIntel.window.hoursUntilIntervention,
      tacticalRecommendation: bcvIntel.recommendation.action,
      recommendationRationale: bcvIntel.recommendation.rationale,
      spreadDynamic,
      // A directional call needs both the gap and the book measured.
      actionable: gapPct != null && depthRatio != null,
      suggestedAction:
        spreadDynamic === 'UNAVAILABLE'
          ? `Sin pronóstico de dinámica de spread: ${unavailableReason ?? 'EVIDENCIA_INSUFICIENTE'}.`
          : spreadDynamic === 'COMPRESSION_RISK'
            ? 'Liquidar inventario con rapidez para evitar compresión de márgenes'
            : spreadDynamic === 'EXPANSION_LIKELY'
              ? 'Ampliar spread visible y capturar margen en puntas'
              : 'Operar con volumen normal',
    };
  },
};
