import { computeCompetitivePriceRecommendation } from '../core/index.js';
import {
  RecommendCompetitivePricingInputSchema,
  type RecommendCompetitivePricingInput,
} from '../schemas/index.js';

export const recommendCompetitivePricingTool = {
  name: 'recommend_competitive_pricing',
  description:
    'Calcula el precio competitivo óptimo para posicionar un anuncio Maker en el Top 1, Top 2 o Top 3 del libro de órdenes de Binance P2P respetando pisos break-even.',
  inputSchema: RecommendCompetitivePricingInputSchema,
  execute: (input: RecommendCompetitivePricingInput) => {
    const rec = computeCompetitivePriceRecommendation({
      side: input.side,
      strategy: input.strategy,
      stepVes: input.stepVes,
      targetMarginPct: input.targetMarginPct,
      breakEvenPrice: input.breakEvenPrice,
      currentMarketMid: input.currentMarketMid,
    });

    return {
      side: rec.side,
      strategy: rec.strategy,
      suggestedPrice: rec.suggestedPrice,
      competitorPrice: rec.competitorPrice,
      stepVes: rec.stepVes,
      targetMarginPct: rec.targetMarginPct,
      marginVes: rec.marginVes,
      isWithinSafeBoundaries: rec.isWithinSafeBoundaries,
      advice: rec.advice,
      executionSummary: `Colocar anuncio ${rec.side} a ${rec.suggestedPrice.toFixed(2)} VES (${rec.strategy} vs competidor en ${rec.competitorPrice.toFixed(2)} VES)`,
    };
  },
};
