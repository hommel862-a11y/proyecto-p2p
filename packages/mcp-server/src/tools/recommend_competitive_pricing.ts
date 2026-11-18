import { computeCompetitivePriceRecommendation, nd } from '../core/index.js';
import {
  RecommendCompetitivePricingInputSchema,
  type RecommendCompetitivePricingInput,
} from '../schemas/index.js';

export const recommendCompetitivePricingTool = {
  name: 'recommend_competitive_pricing',
  description:
    'Calcula el precio competitivo óptimo para posicionar un anuncio Maker en el Top 1, Top 2 o Top 3 del libro de órdenes en vivo de Binance P2P respetando pisos break-even.',
  inputSchema: RecommendCompetitivePricingInputSchema,
  execute: async (input: RecommendCompetitivePricingInput) => {
    const rec = await computeCompetitivePriceRecommendation({
      side: input.side,
      strategy: input.strategy,
      stepVes: input.stepVes,
      targetMarginPct: input.targetMarginPct,
      breakEvenPrice: input.breakEvenPrice,
      currentMarketMid: input.currentMarketMid,
    });

    const executionSummary =
      rec.suggestedPrice === null
        ? `UNAVAILABLE: no se pudo calcular precio competitivo para ${rec.side} (${rec.unavailableReason ?? 'SIN_LIBRO_EN_VIVO'}). Fuente requerida: ${rec.expectedSource}`
        : `Colocar anuncio ${rec.side} a ${nd(rec.suggestedPrice)} VES (${rec.strategy} vs competidor en ${nd(rec.competitorPrice)} VES)`;

    return {
      side: rec.side,
      strategy: rec.strategy,
      suggestedPrice: rec.suggestedPrice,
      competitorPrice: rec.competitorPrice,
      stepVes: rec.stepVes,
      targetMarginPct: rec.targetMarginPct,
      marginVes: rec.marginVes,
      isWithinSafeBoundaries: rec.isWithinSafeBoundaries,
      provenance: rec.provenance,
      actionable: rec.actionable,
      unavailableReason: rec.unavailableReason,
      expectedSource: rec.expectedSource,
      advice: rec.advice,
      executionSummary,
    };
  },
};
