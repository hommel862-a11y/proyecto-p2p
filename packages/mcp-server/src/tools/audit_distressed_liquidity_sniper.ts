import {
  scanOrderbookSnipingOpportunities,
  type P2pOrderbookAdItem,
} from '../core/index.js';
import {
  AuditDistressedLiquiditySniperInputSchema,
  type AuditDistressedLiquiditySniperInput,
} from '../schemas/index.js';

export const auditDistressedLiquiditySniperTool = {
  name: 'audit_distressed_liquidity_sniper',
  description:
    'Audita anuncios en el libro de órdenes P2P para detectar precios erróneos (fat-finger) o liquidaciones de pánico snipables.',
  inputSchema: AuditDistressedLiquiditySniperInputSchema,
  execute: (input: AuditDistressedLiquiditySniperInput) => {
    const ads = input.ads as P2pOrderbookAdItem[];
    const fairMarketRate = input.fairMarketRate;
    const minDislocationPct = input.minDislocationPct ?? 0.8;
    // No default: the engine blocks the alert as MISSING_FRICTION_METRICS when the fee
    // is not supplied, instead of assuming a fee that was never measured.
    const maxTakerFeePct = input.maxTakerFeePct;

    const snipingOpportunities = scanOrderbookSnipingOpportunities(ads, {
      fairMarketPrice: fairMarketRate,
      minProfitThresholdPct: minDislocationPct,
      ...(maxTakerFeePct === undefined ? {} : { maxTakerFeePct }),
    });

    return {
      success: true,
      fairMarketRate,
      maxTakerFeePct: maxTakerFeePct ?? null,
      frictionMetricsProvided: maxTakerFeePct !== undefined,
      snipingOpportunitiesCount: snipingOpportunities.length,
      snipingOpportunities,
      evaluatedAt: new Date().toISOString(),
    };
  },
};
