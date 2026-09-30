/**
 * Pure Mathematical Engine for Counterparty Yield Profiling & Dynamic Spread Discrimination.
 * Tailors customized exchange rates and spreads according to counterparty historical behavior:
 * release speed, ticket volume, dispute history, and operational friction.
 * Zero external dependencies.
 */

import { roundMoney } from './money';

export type CounterpartyTier =
  | 'VIP_INSTITUTIONAL'
  | 'FAST_AND_RELIABLE'
  | 'STANDARD'
  | 'SLOW_OR_FRICTIONAL'
  | 'HIGH_RISK_SURCHARGE';

export interface CounterpartyMetrics {
  counterpartyId: string;
  name?: string;
  averageReleaseMinutes: number; // e.g. 1.2 min vs 38 min
  completedTradesCount: number;
  disputeCount: number;
  monthlyVolumeUsd: number;
  frictionScore?: number; // 0 (seamless) to 100 (high friction, asks too many questions)
}

export interface DynamicPricingRequest {
  metrics: CounterpartyMetrics;
  baseMarketRate: number; // e.g. 85.50 Bs/USDT
  orderType: 'BUY' | 'SELL';
  requestedAmountUsd: number;
}

export interface DynamicPricingResult {
  counterpartyId: string;
  tier: CounterpartyTier;
  baseMarketRate: number;
  spreadAdjustmentPct: number; // e.g. -0.25% for VIP discount or +1.50% friction surcharge
  adjustedRate: number;
  projectedDeskAlphaUsd: number;
  rationale: string;
  recommendedMaxExposureUsd: number;
  timestamp: string;
}

/**
 * Evaluates counterparty tier based on behavioral and quantitative trading metrics.
 */
export function classifyCounterpartyTier(metrics: CounterpartyMetrics): CounterpartyTier {
  if (metrics.disputeCount >= 2 || (metrics.frictionScore && metrics.frictionScore > 75)) {
    return 'HIGH_RISK_SURCHARGE';
  }

  if (metrics.completedTradesCount >= 25 && metrics.monthlyVolumeUsd >= 10000 && metrics.averageReleaseMinutes <= 3) {
    return 'VIP_INSTITUTIONAL';
  }

  if (metrics.completedTradesCount >= 10 && metrics.averageReleaseMinutes <= 5) {
    return 'FAST_AND_RELIABLE';
  }

  if (metrics.averageReleaseMinutes > 20 || (metrics.frictionScore && metrics.frictionScore > 50)) {
    return 'SLOW_OR_FRICTIONAL';
  }

  return 'STANDARD';
}

/**
 * Calculates dynamic spread adjustment and tailored exchange rate for a counterparty.
 */
export function calculateDynamicCounterpartyPricing(
  req: DynamicPricingRequest,
): DynamicPricingResult {
  const tier = classifyCounterpartyTier(req.metrics);
  const baseRate = req.baseMarketRate;
  const amount = Math.max(10, req.requestedAmountUsd);

  let spreadAdjustmentPct = 0;
  let rationale = '';
  let maxExposure = 5000;

  switch (tier) {
    case 'VIP_INSTITUTIONAL':
      // Reward fast institutional client with tighter price (-0.30%) to guarantee massive turnover
      spreadAdjustmentPct = -0.3;
      rationale = 'Cliente VIP recurrente con liberación ultra rápida (<3 min). Descuento de fidelidad para maximizar rotación de capital.';
      maxExposure = 50000;
      break;

    case 'FAST_AND_RELIABLE':
      // Normal competitive pricing
      spreadAdjustmentPct = 0.0;
      rationale = 'Contraparte rápida y confiable. Tasa de mercado estándar competitiva.';
      maxExposure = 15000;
      break;

    case 'STANDARD':
      // Modest buffer (+0.35%)
      spreadAdjustmentPct = 0.35;
      rationale = 'Cliente estándar o nuevo. Margen de seguridad moderado aplicado.';
      maxExposure = 5000;
      break;

    case 'SLOW_OR_FRICTIONAL':
      // Surcharge (+1.25%) to compensate for locked bank accounts and slow confirmation
      spreadAdjustmentPct = 1.25;
      rationale = 'Cliente lento (>20 min liberación). Recargo por costo de oportunidad y bloqueo transaccional de cuentas bancarias.';
      maxExposure = 2000;
      break;

    case 'HIGH_RISK_SURCHARGE':
      // High surcharge (+2.00%) for dispute history or operational friction
      spreadAdjustmentPct = 2.0;
      rationale = 'Historial de disputas o alta fricción. Recargo estricto de riesgo con límite de exposición reducido.';
      maxExposure = 800;
      break;
  }

  // Direction adjustment:
  // If we SELL crypto to client: we want a higher fiat price (rate * (1 + spread%))
  // If we BUY crypto from client: we want a lower fiat price (rate * (1 - spread%))
  const adjustedRate =
    req.orderType === 'SELL'
      ? baseRate * (1 + spreadAdjustmentPct / 100)
      : baseRate * (1 - spreadAdjustmentPct / 100);

  const roundedRate = roundMoney(adjustedRate, 2);
  const projectedAlphaUsd = roundMoney((amount * Math.abs(spreadAdjustmentPct)) / 100, 2);

  return {
    counterpartyId: req.metrics.counterpartyId,
    tier,
    baseMarketRate: baseRate,
    spreadAdjustmentPct: roundMoney(spreadAdjustmentPct, 2),
    adjustedRate: roundedRate,
    projectedDeskAlphaUsd: projectedAlphaUsd,
    rationale,
    recommendedMaxExposureUsd: maxExposure,
    timestamp: new Date().toISOString(),
  };
}
