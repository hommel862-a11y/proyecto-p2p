/**
 * @file p2p-radar-spread-engine.ts
 * @description P2P Quantitative Intelligence Radar - Phase 3: Net Spread Engine, Break-Even & Triangulation Matrix.
 * 
 * Strict architectural isolation: Pure mathematical & quantitative financial domain logic.
 * Zero UI/Angular dependencies. Compatible with Vitest, Node.js and Electron.
 */

import type { P2PUserTier, RadarCleanBook } from './p2p-radar-clean-mode';

export type ExecutionMode =
  | 'DOBLE_MAKER'
  | 'MAKER_COMPRA_TAKER_VENTA'
  | 'TAKER_COMPRA_MAKER_VENTA';

export interface ArbitrageCycleParams {
  readonly buyPrice: number;
  readonly sellPrice: number;
  readonly capitalUsdt: number;
  readonly mode: ExecutionMode;
  readonly userTier: P2PUserTier;
  readonly customMakerFeeBuyPct?: number;
  readonly customMakerFeeSellPct?: number;
  readonly fiatFrictionPct?: number;
  readonly targetNetMarginPct?: number;
}

export interface ArbitrageCycleMetrics {
  readonly grossSpreadPct: number;
  readonly netSpreadPct: number;
  readonly grossProfitUsdt: number;
  readonly netProfitUsdt: number;
  readonly netProfitFiat: number;
  readonly breakEvenSellPrice: number;
  readonly breakEvenBuyPrice: number;
  readonly targetSellPrice: number;
  readonly targetBuyPrice: number;
  readonly totalFeesUsdt: number;
  readonly fiatFrictionCostFiat: number;
  readonly totalMultiplier: number;
  readonly isViable: boolean;
}

export interface ArbitrageRoute {
  readonly routeId: string;
  readonly sourceBank: string;
  readonly targetBank: string;
  readonly isInterbank: boolean;
  readonly sellPrice: number;
  readonly buyPrice: number;
  readonly executionMode: ExecutionMode;
  readonly metrics: ArbitrageCycleMetrics;
  readonly rank: number;
}

export interface MatrixScanOptions {
  readonly capitalUsdt: number;
  readonly mode: ExecutionMode;
  readonly userTier: P2PUserTier;
  readonly targetNetMarginPct?: number;
  readonly interbankFrictionPct?: number;
  readonly monobankFrictionPct?: number;
  readonly customMakerFeeBuyPct?: number;
  readonly customMakerFeeSellPct?: number;
}

export interface MatrixScanResult {
  readonly allRoutes: readonly ArbitrageRoute[];
  readonly topRoutes: readonly ArbitrageRoute[];
  readonly bestRoute: ArbitrageRoute | null;
  readonly scannedBanksCount: number;
  readonly scannedPairsCount: number;
  readonly viableRoutesCount: number;
  readonly timestampMs: number;
}

/**
 * Standard Maker fee percentages by user tier.
 * Verified Merchants typically get preferred 0.20%, unverified standard is 0.35%.
 */
export const DEFAULT_MAKER_FEES_PCT: Record<P2PUserTier, number> = {
  VERIFIED: 0.2,
  UNVERIFIED: 0.35,
};

/**
 * Resolves Maker fee percentage based on user tier and optional override.
 */
export function resolveMakerFeeRatio(tier: P2PUserTier, customFeePct?: number): number {
  if (typeof customFeePct === 'number' && customFeePct >= 0) {
    return Math.round((customFeePct / 100) * 10000) / 10000;
  }
  return Math.round((DEFAULT_MAKER_FEES_PCT[tier] / 100) * 10000) / 10000;
}

/**
 * Pure Mathematical Engine for P2P Arbitrage Cycle Calculations.
 * 
 * Formula:
 * Net Multiplier K = (1 - f_sell) * (1 - f_buy) * (1 - f_fiat)
 * Final Capital = C * (P_sell / P_buy) * K
 * Net Spread % = ((P_sell / P_buy) * K - 1) * 100
 * BreakEven Sell Price = P_buy / K
 * BreakEven Buy Price  = P_sell * K
 * Target Sell Price    = P_buy * (1 + targetNetMargin) / K
 * Target Buy Price     = P_sell * K / (1 + targetNetMargin)
 */
export function calculateArbitrageCycle(params: ArbitrageCycleParams): ArbitrageCycleMetrics {
  const {
    buyPrice,
    sellPrice,
    capitalUsdt,
    mode,
    userTier,
    customMakerFeeBuyPct,
    customMakerFeeSellPct,
    fiatFrictionPct = 0,
    targetNetMarginPct = 0.35,
  } = params;

  if (buyPrice <= 0 || sellPrice <= 0 || capitalUsdt <= 0) {
    return {
      grossSpreadPct: 0,
      netSpreadPct: 0,
      grossProfitUsdt: 0,
      netProfitUsdt: 0,
      netProfitFiat: 0,
      breakEvenSellPrice: 0,
      breakEvenBuyPrice: 0,
      targetSellPrice: 0,
      targetBuyPrice: 0,
      totalFeesUsdt: 0,
      fiatFrictionCostFiat: 0,
      totalMultiplier: 0,
      isViable: false,
    };
  }

  // Determine fees by execution mode
  let feeRatioBuy = 0;
  let feeRatioSell = 0;

  switch (mode) {
    case 'DOBLE_MAKER':
      feeRatioBuy = resolveMakerFeeRatio(userTier, customMakerFeeBuyPct);
      feeRatioSell = resolveMakerFeeRatio(userTier, customMakerFeeSellPct);
      break;
    case 'MAKER_COMPRA_TAKER_VENTA':
      feeRatioBuy = resolveMakerFeeRatio(userTier, customMakerFeeBuyPct);
      feeRatioSell = 0; // Taker pays 0%
      break;
    case 'TAKER_COMPRA_MAKER_VENTA':
      feeRatioBuy = 0; // Taker pays 0%
      feeRatioSell = resolveMakerFeeRatio(userTier, customMakerFeeSellPct);
      break;
  }

  const fiatFrictionRatio = Math.max(0, fiatFrictionPct / 100);
  const targetMarginRatio = Math.max(0, targetNetMarginPct / 100);

  // K = Friction & fee retention coefficient
  const retentionK = (1 - feeRatioSell) * (1 - feeRatioBuy) * (1 - fiatFrictionRatio);

  const priceRatio = sellPrice / buyPrice;
  const netMultiplier = priceRatio * retentionK;

  const grossSpreadPct = Math.round((priceRatio - 1) * 10000) / 100;
  const netSpreadPct = Math.round((netMultiplier - 1) * 10000) / 100;

  const grossProfitUsdt = Math.round(capitalUsdt * (priceRatio - 1) * 100) / 100;
  const netProfitUsdt = Math.round(capitalUsdt * (netMultiplier - 1) * 100) / 100;
  const netProfitFiat = Math.round(netProfitUsdt * sellPrice * 100) / 100;

  // Break-even rates
  const breakEvenSellPrice =
    retentionK > 0 ? Math.round((buyPrice / retentionK) * 10000) / 10000 : 0;
  const breakEvenBuyPrice = Math.round(sellPrice * retentionK * 10000) / 10000;

  // Target rates for specified net margin
  const targetSellPrice =
    retentionK > 0
      ? Math.round(((buyPrice * (1 + targetMarginRatio)) / retentionK) * 10000) / 10000
      : 0;
  const targetBuyPrice =
    targetMarginRatio > -1
      ? Math.round(((sellPrice * retentionK) / (1 + targetMarginRatio)) * 10000) / 10000
      : 0;

  // Friction costs breakdown
  const totalFeesUsdt = Math.round(capitalUsdt * Math.max(0, 1 - retentionK) * 100) / 100;
  const fiatFrictionCostFiat =
    Math.round(capitalUsdt * sellPrice * fiatFrictionRatio * 100) / 100;

  return {
    grossSpreadPct,
    netSpreadPct,
    grossProfitUsdt,
    netProfitUsdt,
    netProfitFiat,
    breakEvenSellPrice,
    breakEvenBuyPrice,
    targetSellPrice,
    targetBuyPrice,
    totalFeesUsdt,
    fiatFrictionCostFiat,
    totalMultiplier: Math.round(netMultiplier * 10000) / 10000,
    isViable: netSpreadPct > 0,
  };
}

/**
 * Automatic Matrix Scanner (Blocks x Banks).
 * Cross-references all active payment methods for both monobank and interbank triangular paths.
 * Produces a sorted real-time ranking of the most profitable routes.
 */
export function scanArbitrageMatrix(
  radarBooks: Map<string, RadarCleanBook>,
  options: MatrixScanOptions,
): MatrixScanResult {
  const {
    capitalUsdt,
    mode,
    userTier,
    targetNetMarginPct = 0.35,
    interbankFrictionPct = 0.3, // e.g. 0.3% Pago Movil or interbank transaction fee
    monobankFrictionPct = 0.0,
    customMakerFeeBuyPct,
    customMakerFeeSellPct,
  } = options;

  // Collect distinct payment methods present in the clean books
  const bankSet = new Set<string>();
  for (const book of radarBooks.values()) {
    bankSet.add(book.payMethod);
  }
  const bankList = Array.from(bankSet);

  const routes: ArbitrageRoute[] = [];

  for (const sourceBank of bankList) {
    const sellKey = `${sourceBank}_SELL`;
    const sellBook = radarBooks.get(sellKey);
    if (!sellBook || sellBook.cleanCount === 0) {
      continue;
    }
    const sellPrice = sellBook.effectiveTopPrice;
    if (sellPrice == null || sellPrice <= 0) {
      continue;
    }

    for (const targetBank of bankList) {
      const buyKey = `${targetBank}_BUY`;
      const buyBook = radarBooks.get(buyKey);
      if (!buyBook || buyBook.cleanCount === 0) {
        continue;
      }
      const buyPrice = buyBook.effectiveTopPrice;
      if (buyPrice == null || buyPrice <= 0) {
        continue;
      }

      const isInterbank = sourceBank !== targetBank;
      const fiatFrictionPct = isInterbank ? interbankFrictionPct : monobankFrictionPct;

      const metrics = calculateArbitrageCycle({
        buyPrice,
        sellPrice,
        capitalUsdt,
        mode,
        userTier,
        customMakerFeeBuyPct,
        customMakerFeeSellPct,
        fiatFrictionPct,
        targetNetMarginPct,
      });

      const routeId = `${sourceBank}_TO_${targetBank}`;

      routes.push({
        routeId,
        sourceBank,
        targetBank,
        isInterbank,
        sellPrice,
        buyPrice,
        executionMode: mode,
        metrics,
        rank: 0, // Assigned after sorting
      });
    }
  }

  // Sort descending by netSpreadPct (highest profitability first)
  routes.sort((a, b) => b.metrics.netSpreadPct - a.metrics.netSpreadPct);

  // Assign sequential ranking
  const rankedRoutes: ArbitrageRoute[] = routes.map((r, index) => ({
    ...r,
    rank: index + 1,
  }));

  const topRoutes = rankedRoutes.slice(0, 3);
  const bestRoute = rankedRoutes.length > 0 ? rankedRoutes[0] : null;
  const viableRoutesCount = rankedRoutes.filter((r) => r.metrics.isViable).length;

  return {
    allRoutes: rankedRoutes,
    topRoutes,
    bestRoute,
    scannedBanksCount: bankList.length,
    scannedPairsCount: rankedRoutes.length,
    viableRoutesCount,
    timestampMs: Date.now(),
  };
}
