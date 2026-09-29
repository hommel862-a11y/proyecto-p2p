/**
 * Adapter module for Synthetic Stablecoin Arbitrage.
 * Uses the battle-tested Triangular Arbitrage domain engine (`calculateTriangularArbitrage`)
 * to evaluate multi-leg conversion curves without duplicating calculation logic or fee models.
 * Zero external dependencies.
 */

import { roundMoney } from './money';
import {
  calculateTriangularArbitrage,
  evaluateTriangularSlippageRisk,
  type ExchangeLeg,
  type TriangularRiskLevel,
  type TriangularArbitrageResult,
  type SlippageRiskGuardResult,
} from './triangular-arbitrage';

export type StableAsset = 'USDT' | 'USDC' | 'FDUSD' | 'EURC' | 'PYUSD';

export interface StableCrossQuote {
  targetAsset: StableAsset;
  spotPair: string; // e.g. "USDCUSDT"
  spotRate: number; // e.g. 0.9985
  /** Must be supplied explicitly. There is no safe default for an unknown spot fee. */
  spotFeePct?: number; // e.g. 0.0% for promo pairs or 0.075%
  /** Must be supplied explicitly. P2P maker/taker cost is venue-specific, not a constant. */
  p2pMakerFeePct?: number;
  /** Must be supplied explicitly. Cash-out / bank-transfer friction is the term that
   *  decides whether a depeg survives settlement, so an unknown value must block. */
  transferOrCashFrictionPct?: number;
  p2pUsdtRateFiat: number; // e.g. 85.50 Bs/USDT
  p2pTargetRateFiat: number; // e.g. 86.80 Bs/USDC
  fiatCurrency?: string; // default "VES"
  tradingCapitalUsd?: number; // default $1000
}

export interface SyntheticStableOpportunity {
  id: string;
  targetAsset: StableAsset;
  spotPair: string;
  spotRate: number;
  syntheticP2pEquivalentRate: number; // What the target asset costs effectively in fiat
  p2pTargetMarketRate: number;
  /** Always observable: the spot/P2P rate dislocation needs no cost assumption. */
  grossSpreadPct: number;
  /**
   * `null` when at least one cost input is missing. An unmeasured cost is not a zero cost,
   * so no fee aggregate may be reported for it.
   */
  estimatedFeesPct: number | null;
  /**
   * `null` when at least one cost input is missing. A net margin derived from zeroed costs
   * is inflated by exactly the term that was never measured, and would be read as available
   * margin. `null` means "no net margin is knowable", never 0.
   */
  netSpreadPct: number | null;
  direction: 'CONVERT_SPOT_AND_SELL_P2P' | 'BUY_P2P_AND_CONVERT_SPOT' | 'NO_OPPORTUNITY';
  projectedProfitUsd: number;
  isActionable: boolean;
  /** Present when the opportunity is blocked. Absent when the route is fully priced. */
  reason?: 'MISSING_FRICTION_METRICS';
  /** Cost inputs that were not supplied. Empty when the route is fully parameterized. */
  missingCostInputs: readonly (
    | 'spotFeePct'
    | 'p2pMakerFeePct'
    | 'transferOrCashFrictionPct'
  )[];
  actionDirective: string;
  /** Absent when costs are unknown: the grade is derived from a zero-cost roi. */
  riskLevel?: TriangularRiskLevel;
  /** Slippage guard delegated from the base triangular engine. */
  slippageGuard: SlippageRiskGuardResult;
  /**
   * Absent when costs are unknown. The base engine ran with zeroed cost terms in that case,
   * so every profitability field it reports (netProfit, roiPct, isProfitable) is an artifact
   * of the missing inputs rather than a measurement.
   */
  triangularDetails?: TriangularArbitrageResult;
  timestamp: string;
}

/** Minimum net spread required to trigger actionable signal (0.45% covers friction) */
const DEFAULT_ACTIONABLE_NET_THRESHOLD_PCT = 0.45;

/** Minutes the fiat legs hold a P2P position open while awaiting payment settlement. */
const P2P_SETTLEMENT_LEG_MINUTES = 15;

/**
 * Adapts a stable cross quote into 3-leg triangular routes and calculates
 * the opportunity using the pure triangular arbitrage domain engine.
 *
 * The adapter adds no cost model of its own: every fee and friction term must be supplied
 * by the caller. When one is missing the route is reported but never marked actionable,
 * because the net margin would otherwise be inflated by the very term that is unknown.
 */
export function calculateSyntheticStableOpportunity(
  quote: StableCrossQuote,
  minThresholdPct = DEFAULT_ACTIONABLE_NET_THRESHOLD_PCT,
): SyntheticStableOpportunity {
  const capital = quote.tradingCapitalUsd && quote.tradingCapitalUsd > 0 ? quote.tradingCapitalUsd : 1000;
  const fiat = quote.fiatCurrency || 'VES';

  const missingCostInputs: ('spotFeePct' | 'p2pMakerFeePct' | 'transferOrCashFrictionPct')[] = [];
  if (quote.spotFeePct === undefined) missingCostInputs.push('spotFeePct');
  if (quote.p2pMakerFeePct === undefined) missingCostInputs.push('p2pMakerFeePct');
  if (quote.transferOrCashFrictionPct === undefined) missingCostInputs.push('transferOrCashFrictionPct');
  const hasExplicitCosts = missingCostInputs.length === 0;

  // When costs are unknown we still run the engine so the gross dislocation is visible,
  // but with zero cost terms it is treated purely as an unpriced observation.
  const spotFeePct = quote.spotFeePct ?? 0;
  const p2pMakerFeePct = quote.p2pMakerFeePct ?? 0;
  const settlementFrictionPct = quote.transferOrCashFrictionPct ?? 0;

  const syntheticCostFiat = quote.spotRate * quote.p2pUsdtRateFiat;
  const marketSellFiat = quote.p2pTargetRateFiat;

  // Route A: USDT -> (Spot) -> TargetAsset -> (P2P Sell) -> Fiat -> (P2P Buy) -> USDT
  const legsA: [ExchangeLeg, ExchangeLeg, ExchangeLeg] = [
    {
      id: 'leg-1-spot',
      fromCurrency: 'USDT',
      toCurrency: quote.targetAsset,
      operationType: 'BUY_CRYPTO',
      platform: 'Binance Spot',
      paymentMethod: 'Spot Orderbook',
      price: quote.spotRate,
      isDivision: true, // 1000 USDT / 0.998 = 1002.00 USDC
      feePct: spotFeePct,
      fixedFee: 0,
      fixedFeeCurrency: quote.targetAsset,
      estimatedDurationMinutes: 1,
    },
    {
      id: 'leg-2-p2p-sell',
      fromCurrency: quote.targetAsset,
      toCurrency: fiat,
      operationType: 'SELL_CRYPTO',
      platform: 'Binance P2P',
      paymentMethod: 'Pago Móvil',
      price: quote.p2pTargetRateFiat,
      isDivision: false, // USDC * p2pTargetRateFiat = Fiat
      feePct: p2pMakerFeePct,
      bankingFeePct: settlementFrictionPct,
      fixedFee: 0,
      fixedFeeCurrency: fiat,
      estimatedDurationMinutes: P2P_SETTLEMENT_LEG_MINUTES,
    },
    {
      id: 'leg-3-p2p-buy',
      fromCurrency: fiat,
      toCurrency: 'USDT',
      operationType: 'BUY_CRYPTO',
      platform: 'Binance P2P',
      paymentMethod: 'Pago Móvil',
      price: quote.p2pUsdtRateFiat,
      isDivision: true, // Fiat / p2pUsdtRateFiat = USDT
      feePct: p2pMakerFeePct,
      bankingFeePct: settlementFrictionPct,
      fixedFee: 0,
      fixedFeeCurrency: 'USDT',
      estimatedDurationMinutes: P2P_SETTLEMENT_LEG_MINUTES,
    },
  ];

  const resultA = calculateTriangularArbitrage(
    `ROUTE-A-${quote.targetAsset}`,
    `USDT -> ${quote.targetAsset} -> ${fiat} -> USDT`,
    capital,
    legsA,
  );

  // Route B: USDT -> (P2P Sell) -> Fiat -> (P2P Buy) -> TargetAsset -> (Spot) -> USDT
  const legsB: [ExchangeLeg, ExchangeLeg, ExchangeLeg] = [
    {
      id: 'leg-1-p2p-sell',
      fromCurrency: 'USDT',
      toCurrency: fiat,
      operationType: 'SELL_CRYPTO',
      platform: 'Binance P2P',
      paymentMethod: 'Pago Móvil',
      price: quote.p2pUsdtRateFiat,
      isDivision: false,
      feePct: p2pMakerFeePct,
      bankingFeePct: settlementFrictionPct,
      fixedFee: 0,
      fixedFeeCurrency: fiat,
      estimatedDurationMinutes: P2P_SETTLEMENT_LEG_MINUTES,
    },
    {
      id: 'leg-2-p2p-buy',
      fromCurrency: fiat,
      toCurrency: quote.targetAsset,
      operationType: 'BUY_CRYPTO',
      platform: 'Binance P2P',
      paymentMethod: 'Pago Móvil',
      price: quote.p2pTargetRateFiat,
      isDivision: true,
      feePct: p2pMakerFeePct,
      bankingFeePct: settlementFrictionPct,
      fixedFee: 0,
      fixedFeeCurrency: quote.targetAsset,
      estimatedDurationMinutes: P2P_SETTLEMENT_LEG_MINUTES,
    },
    {
      id: 'leg-3-spot',
      fromCurrency: quote.targetAsset,
      toCurrency: 'USDT',
      operationType: 'SELL_CRYPTO',
      platform: 'Binance Spot',
      paymentMethod: 'Spot Orderbook',
      price: quote.spotRate,
      isDivision: false, // TargetAsset * spotRate = USDT
      feePct: spotFeePct,
      fixedFee: 0,
      fixedFeeCurrency: 'USDT',
      estimatedDurationMinutes: 1,
    },
  ];

  const resultB = calculateTriangularArbitrage(
    `ROUTE-B-${quote.targetAsset}`,
    `USDT -> ${fiat} -> ${quote.targetAsset} -> USDT`,
    capital,
    legsB,
  );

  let direction: 'CONVERT_SPOT_AND_SELL_P2P' | 'BUY_P2P_AND_CONVERT_SPOT' | 'NO_OPPORTUNITY' = 'NO_OPPORTUNITY';
  let chosenResult: TriangularArbitrageResult = resultA;
  let grossSpreadPct = 0;

  if (resultA.roiPct > resultB.roiPct && resultA.roiPct > 0) {
    direction = 'CONVERT_SPOT_AND_SELL_P2P';
    chosenResult = resultA;
    grossSpreadPct = syntheticCostFiat > 0
      ? ((marketSellFiat - syntheticCostFiat) / syntheticCostFiat) * 100
      : 0;
  } else if (resultB.roiPct > 0) {
    direction = 'BUY_P2P_AND_CONVERT_SPOT';
    chosenResult = resultB;
    grossSpreadPct = marketSellFiat > 0
      ? ((syntheticCostFiat - marketSellFiat) / marketSellFiat) * 100
      : 0;
  } else {
    direction = 'NO_OPPORTUNITY';
    chosenResult = resultA.roiPct >= resultB.roiPct ? resultA : resultB;
    grossSpreadPct = Math.max(0, syntheticCostFiat > 0 ? ((marketSellFiat - syntheticCostFiat) / syntheticCostFiat) * 100 : 0);
  }

  // The net margin only exists when every cost term was measured. With a zero-cost engine run
  // it would be inflated by exactly the term we did not measure, so it is not computed at all.
  const roundedNetSpread: number | null = hasExplicitCosts
    ? roundMoney(chosenResult.roiPct, 2)
    : null;
  const roundedGrossSpread = roundMoney(grossSpreadPct, 2);
  const estimatedFeesPct: number | null =
    roundedNetSpread === null ? null : Math.max(0, roundMoney(roundedGrossSpread - roundedNetSpread, 2));

  // Slippage guard is delegated to the base engine; the adapter must not be able to
  // bypass it, so it gates actionability alongside the spread threshold. Over an unpriced
  // route it keeps being evaluated, but against the observable gross dislocation: it never
  // reads a zero-cost net margin, and it can never be what makes a route actionable.
  const slippageGuard = evaluateTriangularSlippageRisk({
    initialSpreadPct: roundedNetSpread ?? roundedGrossSpread,
    volatileAsset: quote.targetAsset,
    estimatedSettlementMinutes: P2P_SETTLEMENT_LEG_MINUTES * 2,
  });

  // A spread gate that compares against a number we do not have is not a gate at all:
  // without explicit costs there is no net spread to clear.
  const meetsSpread =
    roundedNetSpread !== null && roundedNetSpread >= minThresholdPct && direction !== 'NO_OPPORTUNITY';
  const passesSlippage = slippageGuard.recommendation === 'OPERAR';
  const isActionable = hasExplicitCosts && meetsSpread && passesSlippage;
  const projectedProfitUsd = isActionable ? roundMoney(chosenResult.netProfit, 2) : 0;

  let actionDirective = 'Mercado alineado sin descalce explotable.';
  if (!hasExplicitCosts) {
    actionDirective =
      `Bloqueado por fricción desconocida: se requieren ${missingCostInputs.join(', ')} antes de autorizar ejecución. ` +
      `El descalce bruto es observable (${roundedGrossSpread}%), el margen neto no.`;
  } else if (direction === 'CONVERT_SPOT_AND_SELL_P2P') {
    actionDirective = `Comprar ${quote.targetAsset} en Spot a tasa ${quote.spotRate.toFixed(4)} y publicar anuncio de venta P2P a ${quote.p2pTargetRateFiat.toFixed(2)} ${fiat}. Margen neto triangulado: +${roundedNetSpread}% (+$${projectedProfitUsd} USD).`;
  } else if (direction === 'BUY_P2P_AND_CONVERT_SPOT') {
    actionDirective = `Tomar ${quote.targetAsset} barato en P2P a ${quote.p2pTargetRateFiat.toFixed(2)} ${fiat} y convertir a USDT en Spot. Margen neto triangulado: +${roundedNetSpread}% (+$${projectedProfitUsd} USD).`;
  }

  return {
    id: `SYNTH-${quote.targetAsset}-${Date.now().toString(36)}`,
    targetAsset: quote.targetAsset,
    spotPair: quote.spotPair,
    spotRate: quote.spotRate,
    syntheticP2pEquivalentRate: roundMoney(syntheticCostFiat, 2),
    p2pTargetMarketRate: roundMoney(marketSellFiat, 2),
    grossSpreadPct: roundedGrossSpread,
    estimatedFeesPct,
    netSpreadPct: roundedNetSpread,
    direction,
    projectedProfitUsd,
    isActionable,
    ...(hasExplicitCosts ? {} : { reason: 'MISSING_FRICTION_METRICS' as const }),
    missingCostInputs,
    actionDirective,
    // riskLevel and triangularDetails are both derived from the engine's roiPct, which was
    // computed with zeroed costs on an unpriced route. Reporting them would reintroduce the
    // inflated margin the null above just removed.
    ...(hasExplicitCosts ? { riskLevel: chosenResult.riskLevel, triangularDetails: chosenResult } : {}),
    slippageGuard,
    timestamp: new Date().toISOString(),
  };
}

export function scanSyntheticStableCurves(
  quotes: readonly StableCrossQuote[],
  minThresholdPct = DEFAULT_ACTIONABLE_NET_THRESHOLD_PCT,
): SyntheticStableOpportunity[] {
  return quotes
    .map((q) => calculateSyntheticStableOpportunity(q, minThresholdPct))
    .sort(compareOpportunitiesByNetSpread);
}

/**
 * Opportunities with a known net spread rank first, highest first. An opportunity whose net
 * spread is `null` is not comparable to a number, so it goes last instead of poisoning the
 * ordering with NaN. `Array.prototype.sort` is stable, so unpriced routes keep their input
 * order and the ranking stays deterministic.
 */
function compareOpportunitiesByNetSpread(
  a: SyntheticStableOpportunity,
  b: SyntheticStableOpportunity,
): number {
  if (a.netSpreadPct === null || b.netSpreadPct === null) {
    if (a.netSpreadPct === b.netSpreadPct) return 0;
    return a.netSpreadPct === null ? 1 : -1;
  }
  return b.netSpreadPct - a.netSpreadPct;
}
