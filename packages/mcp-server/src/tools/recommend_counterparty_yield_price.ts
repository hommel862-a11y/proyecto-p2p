import {
  calculateDynamicCounterpartyPricing,
  type DynamicPricingRequest,
} from '../core/index.js';
import {
  RecommendCounterpartyYieldPriceInputSchema,
  type RecommendCounterpartyYieldPriceInput,
} from '../schemas/index.js';

export const recommendCounterpartyYieldPriceTool = {
  name: 'recommend_counterparty_yield_price',
  description:
    'Discrimina spreads y personaliza precios según el historial de la contraparte: tiempo de liberación, volumen mensual y fricción operativa.',
  inputSchema: RecommendCounterpartyYieldPriceInputSchema,
  execute: (input: RecommendCounterpartyYieldPriceInput) => {
    const result = calculateDynamicCounterpartyPricing({
      metrics: {
        counterpartyId: input.counterpartyId,
        averageReleaseMinutes: input.averageReleaseMinutes,
        completedTradesCount: input.completedTradesCount,
        disputeCount: input.disputeCount,
        monthlyVolumeUsd: input.monthlyVolumeUsd,
        frictionScore: input.frictionScore,
      },
      baseMarketRate: input.baseMarketRate,
      orderType: input.orderType,
      requestedAmountUsd: input.requestedAmountUsd,
    });

    return {
      success: true,
      result,
      evaluatedAt: new Date().toISOString(),
    };
  },
};
