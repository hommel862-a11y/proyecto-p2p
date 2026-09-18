import { getBcvMarketIntelligence } from '../core/index.js';
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

    const isInWindow = bcvIntel.window.phase === 'INTERVENTION_ACTIVE';
    const depthRatio = input.bidDepthUsdt > 0 ? input.askDepthUsdt / input.bidDepthUsdt : 1;
    let spreadDynamic: 'EXPANSION_LIKELY' | 'COMPRESSION_RISK' | 'STABLE';

    if (isInWindow && depthRatio < 0.8) {
      spreadDynamic = 'COMPRESSION_RISK';
    } else if (bcvIntel.gap.gapPct > 18) {
      spreadDynamic = 'EXPANSION_LIKELY';
    } else {
      spreadDynamic = 'STABLE';
    }

    return {
      gapPct: Number(bcvIntel.gap.gapPct.toFixed(2)),
      isInBcvInterventionWindow: isInWindow,
      bcvPhase: bcvIntel.window.phase,
      hoursUntilIntervention: bcvIntel.window.hoursUntilIntervention,
      tacticalRecommendation: bcvIntel.recommendation.action,
      spreadDynamic,
      suggestedAction:
        spreadDynamic === 'COMPRESSION_RISK'
          ? 'Liquidar inventario con rapidez para evitar compresión de márgenes'
          : spreadDynamic === 'EXPANSION_LIKELY'
            ? 'Ampliar spread visible y capturar margen en puntas'
            : 'Operar con volumen normal',
    };
  },
};
