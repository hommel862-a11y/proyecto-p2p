/**
 * Trade Impact, Slippage & Fill Probability Simulation Engine.
 * Simulates real-world execution friction on Binance P2P orderbooks:
 * order exhaustion, slippage across multiple depth tiers, merchant reliability
 * scoring, and bank transfer clearing latency.
 * Pure TypeScript, zero external dependencies.
 */

import type { BinanceOfferSummary } from './binance-p2p';

export interface TradeImpactInput {
  targetAmountUsdt: number;
  side: 'BUY' | 'SELL';
  availableOffers: BinanceOfferSummary[];
  targetFiatCurrency?: string;
  bankName?: string;
}

export interface MatchedTier {
  advNo: string;
  merchantName: string;
  price: number;
  matchedUsdt: number;
  matchedFiat: number;
  finishRatePct: number;
  avgReleaseTimeMinutes: number;
}

export interface TradeImpactSimulationResult {
  targetAmountUsdt: number;
  totalFilledUsdt: number;
  isFullyFillable: boolean;
  unfilledUsdt: number;
  bestQuotedPrice: number;
  effectiveVwapPrice: number;
  slippagePct: number;
  slippageBps: number;
  matchedTiers: MatchedTier[];
  overallFillProbabilityPct: number; // 0 to 100
  estimatedExecutionTimeMinutes: number;
  liquidityHealth: 'HIGH_LIQUIDITY' | 'ACCEPTABLE' | 'THIN_BOOK' | 'CRITICAL_SLIPPAGE';
  actionableRecommendation: string;
}

/**
 * Simulates filling a target USDT volume through the available orderbook depth,
 * calculating true effective VWAP and counterparty friction.
 */
export function simulateTradeImpact(input: TradeImpactInput): TradeImpactSimulationResult {
  const { targetAmountUsdt, side, availableOffers } = input;

  if (!availableOffers || availableOffers.length === 0 || targetAmountUsdt <= 0) {
    return {
      targetAmountUsdt,
      totalFilledUsdt: 0,
      isFullyFillable: false,
      unfilledUsdt: targetAmountUsdt,
      bestQuotedPrice: 0,
      effectiveVwapPrice: 0,
      slippagePct: 0,
      slippageBps: 0,
      matchedTiers: [],
      overallFillProbabilityPct: 0,
      estimatedExecutionTimeMinutes: 0,
      liquidityHealth: 'CRITICAL_SLIPPAGE',
      actionableRecommendation: 'Libro de órdenes vacío o volumen no válido.',
    };
  }

  // Sort offers: BUY wants lowest ask price, SELL wants highest bid price
  const sortedOffers = [...availableOffers].sort((a, b) => {
    return side === 'BUY' ? a.price - b.price : b.price - a.price;
  });

  const bestQuotedPrice = sortedOffers[0].price;
  let remainingUsdt = targetAmountUsdt;
  let totalFiatCost = 0;
  let totalFilledUsdt = 0;
  const matchedTiers: MatchedTier[] = [];
  let weightedFinishRateSum = 0;
  let maxReleaseTime = 5; // Baseline 5 min

  for (const offer of sortedOffers) {
    if (remainingUsdt <= 0) break;

    // Available USDT inferred from maxVes / price or direct capacity
    const availableInAdv = offer.maxVes > 0 && offer.price > 0 ? offer.maxVes / offer.price : 1000;
    if (availableInAdv <= 0) continue;

    const fillFromThis = Math.min(remainingUsdt, availableInAdv);
    const fiatAmount = fillFromThis * offer.price;
    const finishRate = offer.finishRatePct ?? 95;
    const avgRelease = 10; // Baseline estimate in minutes

    matchedTiers.push({
      advNo: offer.advNo || 'ADV-UNKNOWN',
      merchantName: offer.merchantName,
      price: offer.price,
      matchedUsdt: fillFromThis,
      matchedFiat: fiatAmount,
      finishRatePct: finishRate,
      avgReleaseTimeMinutes: avgRelease,
    });

    totalFilledUsdt += fillFromThis;
    totalFiatCost += fiatAmount;
    remainingUsdt -= fillFromThis;

    weightedFinishRateSum += finishRate * fillFromThis;
    if (avgRelease > maxReleaseTime) {
      maxReleaseTime = avgRelease;
    }
  }

  const isFullyFillable = remainingUsdt <= 0.0001;
  const unfilledUsdt = Math.max(0, remainingUsdt);
  const effectiveVwapPrice = totalFilledUsdt > 0 ? totalFiatCost / totalFilledUsdt : 0;

  // Slippage calculation against the best quote in the book
  let slippagePct = 0;
  if (bestQuotedPrice > 0 && effectiveVwapPrice > 0) {
    if (side === 'BUY') {
      slippagePct = ((effectiveVwapPrice - bestQuotedPrice) / bestQuotedPrice) * 100;
    } else {
      slippagePct = ((bestQuotedPrice - effectiveVwapPrice) / bestQuotedPrice) * 100;
    }
  }
  const slippageBps = Math.round(slippagePct * 100);

  // Overall fill probability based on merchant quality and orderbook depth
  const avgMerchantScore = totalFilledUsdt > 0 ? weightedFinishRateSum / totalFilledUsdt : 50;
  const depthPenalty = isFullyFillable ? 0 : 35;
  const slippagePenalty = Math.min(30, slippagePct * 10);
  const overallFillProbabilityPct = Math.max(
    5,
    Math.min(99, Math.round(avgMerchantScore - depthPenalty - slippagePenalty)),
  );

  // Liquidity health classification
  let liquidityHealth: 'HIGH_LIQUIDITY' | 'ACCEPTABLE' | 'THIN_BOOK' | 'CRITICAL_SLIPPAGE' =
    'HIGH_LIQUIDITY';
  if (!isFullyFillable || slippagePct > 1.5) {
    liquidityHealth = 'CRITICAL_SLIPPAGE';
  } else if (slippagePct > 0.6) {
    liquidityHealth = 'THIN_BOOK';
  } else if (slippagePct > 0.2) {
    liquidityHealth = 'ACCEPTABLE';
  }

  let actionableRecommendation: string;
  if (liquidityHealth === 'HIGH_LIQUIDITY') {
    actionableRecommendation =
      'Liquidez óptima. Deslizamiento casi nulo (<20 bps). Ejecución inmediata recomendada.';
  } else if (liquidityHealth === 'ACCEPTABLE') {
    actionableRecommendation = `Deslizamiento moderado (${slippageBps} bps). Viable para tickets institucionales si el spread supera 0.80%.`;
  } else if (liquidityHealth === 'THIN_BOOK') {
    actionableRecommendation = `Libro fino. Deslizamiento de ${slippagePct.toFixed(2)}%. Fragmentar el ticket en 2 órdenes más pequeñas.`;
  } else {
    actionableRecommendation =
      'ALERTA: Profundidad insuficiente para el ticket solicitado. Riesgo alto de quemar margen.';
  }

  return {
    targetAmountUsdt,
    totalFilledUsdt,
    isFullyFillable,
    unfilledUsdt,
    bestQuotedPrice,
    effectiveVwapPrice,
    slippagePct,
    slippageBps,
    matchedTiers,
    overallFillProbabilityPct,
    estimatedExecutionTimeMinutes: maxReleaseTime,
    liquidityHealth,
    actionableRecommendation,
  };
}
