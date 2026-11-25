/**
 * @file p2p-radar-spread-engine.ts
 * @description P2P Quantitative Intelligence Radar - Phase 3: Net Spread Engine, Break-Even & Triangulation Matrix.
 * 
 * Strict architectural isolation: Pure mathematical & quantitative financial domain logic.
 * Zero UI/Angular dependencies. Compatible with Vitest, Node.js and Electron.
 */

import {
  computeExecutableCapitalPrice,
  type P2PUserTier,
  type RadarCleanBook,
} from './p2p-radar-clean-mode';
import { MAKER_FEE_RATES, type MakerMerchantLevel } from './market-scanner';

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
  readonly merchantLevel?: MakerMerchantLevel;
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
  rank: number;
  /** Liquidity coverage % of requested operating capital available in clean books (min of buy/sell leg). */
  readonly liquidityCoveragePct?: number;
  /** Most profitable execution mode (e.g. TAKER_COMPRA_MAKER_VENTA saves 50% fee for STANDARD operators). */
  readonly recommendedMode?: ExecutionMode;
  readonly optimalHybridNetSpreadPct?: number;
  readonly optimalHybridNetProfitUsdt?: number;
  readonly sourceMerchantWallPct?: number;
  readonly targetMerchantWallPct?: number;
}

export interface MatrixScanOptions {
  readonly capitalUsdt: number;
  readonly mode: ExecutionMode;
  readonly userTier: P2PUserTier;
  readonly merchantLevel?: MakerMerchantLevel;
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
 * Resolves Maker fee ratio based on custom override, canonical MakerMerchantLevel, or legacy tier.
 */
export function resolveMakerFeeRatio(
  tier: P2PUserTier,
  customFeePct?: number,
  merchantLevel?: MakerMerchantLevel,
): number {
  if (typeof customFeePct === 'number' && Number.isFinite(customFeePct) && customFeePct >= 0) {
    return Math.round((customFeePct / 100) * 1_000_000) / 1_000_000;
  }
  if (merchantLevel && merchantLevel in MAKER_FEE_RATES) {
    return Math.round(MAKER_FEE_RATES[merchantLevel] * 1_000_000) / 1_000_000;
  }
  return Math.round((DEFAULT_MAKER_FEES_PCT[tier] / 100) * 1_000_000) / 1_000_000;
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
    merchantLevel,
    customMakerFeeBuyPct,
    customMakerFeeSellPct,
    fiatFrictionPct = 0,
    targetNetMarginPct = 0.35,
  } = params;

  const invalidCoreInputs =
    !Number.isFinite(buyPrice) ||
    !Number.isFinite(sellPrice) ||
    !Number.isFinite(capitalUsdt) ||
    buyPrice <= 0 ||
    sellPrice <= 0 ||
    capitalUsdt <= 0;

  if (invalidCoreInputs) {
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
      feeRatioBuy = resolveMakerFeeRatio(userTier, customMakerFeeBuyPct, merchantLevel);
      feeRatioSell = resolveMakerFeeRatio(userTier, customMakerFeeSellPct, merchantLevel);
      break;
    case 'MAKER_COMPRA_TAKER_VENTA':
      feeRatioBuy = resolveMakerFeeRatio(userTier, customMakerFeeBuyPct, merchantLevel);
      feeRatioSell = 0; // Taker pays 0%
      break;
    case 'TAKER_COMPRA_MAKER_VENTA':
      feeRatioBuy = 0; // Taker pays 0%
      feeRatioSell = resolveMakerFeeRatio(userTier, customMakerFeeSellPct, merchantLevel);
      break;
  }

  const safeFiatFrictionPct = Number.isFinite(fiatFrictionPct) ? Math.max(0, fiatFrictionPct) : 0;
  const safeTargetMarginPct = Number.isFinite(targetNetMarginPct)
    ? Math.max(0, targetNetMarginPct)
    : 0.35;

  const fiatFrictionRatio = Math.min(1, safeFiatFrictionPct / 100);
  const targetMarginRatio = safeTargetMarginPct / 100;

  // K = Friction & fee retention coefficient
  const retentionK = Math.max(
    0,
    (1 - Math.min(1, feeRatioSell)) * (1 - Math.min(1, feeRatioBuy)) * (1 - fiatFrictionRatio),
  );

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
  const breakEvenBuyPrice =
    retentionK > 0 ? Math.round(sellPrice * retentionK * 10000) / 10000 : 0;

  // Target rates for specified net margin
  const targetSellPrice =
    retentionK > 0
      ? Math.round(((buyPrice * (1 + targetMarginRatio)) / retentionK) * 10000) / 10000
      : 0;
  const targetBuyPrice =
    retentionK > 0 && 1 + targetMarginRatio > 0
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
    isViable: retentionK > 0 && netSpreadPct > 0,
  };
}

/**
 * Automatic Matrix Scanner (Blocks x Banks).
 * Cross-references all active payment methods for both monobank and interbank triangular paths.
 * Uses capital-weighted executable prices when clean depth is present to prevent Top-1 illusion.
 */
export function scanArbitrageMatrix(
  radarBooks: Map<string, RadarCleanBook>,
  options: MatrixScanOptions,
): MatrixScanResult {
  const {
    capitalUsdt,
    mode,
    userTier,
    merchantLevel,
    targetNetMarginPct = 0.35,
    interbankFrictionPct = 0.3, // e.g. 0.3% Pago Movil or interbank transaction fee
    monobankFrictionPct = 0.0,
    customMakerFeeBuyPct,
    customMakerFeeSellPct,
  } = options;

  // Pre-resolve distinct payment methods and effective capital-weighted leg quotes once (avoids O(B^2) recomputation)
  const bankSet = new Set<string>();
  for (const book of radarBooks.values()) {
    bankSet.add(book.payMethod);
  }
  const bankList = Array.from(bankSet);

  const sellLegs = new Map<string, { price: number; coveragePct: number; merchantWallPct?: number }>();
  const buyLegs = new Map<string, { price: number; coveragePct: number; merchantWallPct?: number }>();

  for (const bank of bankList) {
    const sellBook = radarBooks.get(`${bank}_SELL`);
    if (sellBook && sellBook.cleanCount > 0) {
      const capQuote = computeExecutableCapitalPrice(sellBook.cleanOffers, capitalUsdt);
      const price = capQuote.executablePrice ?? sellBook.effectiveTopPrice;
      if (price != null && Number.isFinite(price) && price > 0) {
        sellLegs.set(bank, {
          price,
          coveragePct: capQuote.executablePrice != null ? capQuote.coveragePct : 100,
          merchantWallPct: sellBook.merchantWallPct,
        });
      }
    }

    const buyBook = radarBooks.get(`${bank}_BUY`);
    if (buyBook && buyBook.cleanCount > 0) {
      const capQuote = computeExecutableCapitalPrice(buyBook.cleanOffers, capitalUsdt);
      const price = capQuote.executablePrice ?? buyBook.effectiveTopPrice;
      if (price != null && Number.isFinite(price) && price > 0) {
        buyLegs.set(bank, {
          price,
          coveragePct: capQuote.executablePrice != null ? capQuote.coveragePct : 100,
          merchantWallPct: buyBook.merchantWallPct,
        });
      }
    }
  }

  const routes: ArbitrageRoute[] = [];

  for (const [sourceBank, sellLeg] of sellLegs.entries()) {
    for (const [targetBank, buyLeg] of buyLegs.entries()) {
      const isInterbank = sourceBank !== targetBank;
      const fiatFrictionPct = isInterbank ? interbankFrictionPct : monobankFrictionPct;

      const baseParams = {
        buyPrice: buyLeg.price,
        sellPrice: sellLeg.price,
        capitalUsdt,
        userTier,
        merchantLevel,
        customMakerFeeBuyPct,
        customMakerFeeSellPct,
        fiatFrictionPct,
        targetNetMarginPct,
      };

      const metrics = calculateArbitrageCycle({
        ...baseParams,
        mode,
      });

      const takerBuyMakerSell = calculateArbitrageCycle({
        ...baseParams,
        mode: 'TAKER_COMPRA_MAKER_VENTA',
      });
      const makerBuyTakerSell = calculateArbitrageCycle({
        ...baseParams,
        mode: 'MAKER_COMPRA_TAKER_VENTA',
      });
      const doubleMaker =
        mode === 'DOBLE_MAKER'
          ? metrics
          : calculateArbitrageCycle({ ...baseParams, mode: 'DOBLE_MAKER' });

      let recommendedMode: ExecutionMode = 'DOBLE_MAKER';
      let bestCandidate = doubleMaker;
      if (takerBuyMakerSell.netSpreadPct > bestCandidate.netSpreadPct) {
        recommendedMode = 'TAKER_COMPRA_MAKER_VENTA';
        bestCandidate = takerBuyMakerSell;
      }
      if (makerBuyTakerSell.netSpreadPct > bestCandidate.netSpreadPct) {
        recommendedMode = 'MAKER_COMPRA_TAKER_VENTA';
        bestCandidate = makerBuyTakerSell;
      }

      routes.push({
        routeId: `${sourceBank}_TO_${targetBank}`,
        sourceBank,
        targetBank,
        isInterbank,
        sellPrice: sellLeg.price,
        buyPrice: buyLeg.price,
        executionMode: mode,
        metrics,
        rank: 0,
        liquidityCoveragePct: Math.min(sellLeg.coveragePct, buyLeg.coveragePct),
        recommendedMode,
        optimalHybridNetSpreadPct: bestCandidate.netSpreadPct,
        optimalHybridNetProfitUsdt: bestCandidate.netProfitUsdt,
        sourceMerchantWallPct: sellLeg.merchantWallPct,
        targetMerchantWallPct: buyLeg.merchantWallPct,
      });
    }
  }

  // Sort in-place descending by netSpreadPct, then assign rank & count viable routes in a single pass
  routes.sort((a, b) => b.metrics.netSpreadPct - a.metrics.netSpreadPct);

  let viableRoutesCount = 0;
  for (let i = 0; i < routes.length; i++) {
    routes[i].rank = i + 1;
    if (routes[i].metrics.isViable) {
      viableRoutesCount++;
    }
  }

  return {
    allRoutes: routes,
    topRoutes: routes.slice(0, 3),
    bestRoute: routes.length > 0 ? routes[0] : null,
    scannedBanksCount: bankList.length,
    scannedPairsCount: routes.length,
    viableRoutesCount,
    timestampMs: Date.now(),
  };
}
