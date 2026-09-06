/**
 * Pure domain logic for automated ad repricing (Market Making) on Binance P2P.
 * Computes optimal buy/sell ad prices based on current market depth, desired position,
 * break-even cost floor, safety margins, and risk governance rules.
 * Framework-agnostic. Deterministic. Zero network.
 */

import { roundMoney } from './money';
import type { BinanceP2pMarketDepth, BinanceOfferSummary } from './binance-p2p';

export type RepricerStrategy = 'TOP_1' | 'TOP_2' | 'TOP_3' | 'UNDERCUT' | 'MATCH';

export interface RepricerConfig {
  /** Target asset, typically USDT */
  asset: string;
  /** Fiat currency, typically VES */
  fiat: string;
  /** Strategy for positioning in the order book */
  strategy: RepricerStrategy;
  /** Price increment/decrement step (e.g. 0.01 Bs) */
  stepVes: number;
  /** Minimum spread in VES required to keep ads active */
  minSpreadVes: number;
  /** Hard minimum selling price (break-even floor) to prevent selling at a loss */
  breakEvenSellPrice: number;
  /** Hard maximum buying price to prevent overpaying */
  maxBuyPrice?: number;
  /** Whether the repricer is in dry-run/simulation mode */
  isDryRun: boolean;
}

export interface RepricerEvaluationInput {
  config: RepricerConfig;
  marketDepth: BinanceP2pMarketDepth;
  currentBuyAdPrice?: number;
  currentSellAdPrice?: number;
  isDailyLimitExceeded?: boolean;
}

export interface RepricerDecision {
  action: 'UPDATE' | 'KEEP' | 'PAUSE';
  suggestedBuyPrice: number;
  suggestedSellPrice: number;
  spreadVes: number;
  spreadPct: number;
  reason: string;
  safetyFlags: string[];
  isSafe: boolean;
}

/**
 * Calculates optimal price for a maker ad based on competitors' prices.
 * For BUY ads (maker buys crypto / taker sells):
 *   To be Top 1, you need to offer the HIGHEST price to sellers (or match/undercut).
 * For SELL ads (maker sells crypto / taker buys):
 *   To be Top 1, you need to offer the LOWEST price to buyers.
 */
export function calculatePositionPrice(
  offers: readonly BinanceOfferSummary[],
  side: 'BUY' | 'SELL',
  strategy: RepricerStrategy,
  stepVes = 0.01,
): number {
  if (offers.length === 0) return 0;

  // Sort: BUY offers descending (highest price first), SELL offers ascending (lowest price first)
  const sorted = [...offers].sort((a, b) => (side === 'BUY' ? b.price - a.price : a.price - b.price));

  let targetIndex = 0;
  if (strategy === 'TOP_2' && sorted.length >= 2) targetIndex = 1;
  if (strategy === 'TOP_3' && sorted.length >= 3) targetIndex = 2;

  const basePrice = sorted[targetIndex].price;

  if (strategy === 'MATCH') {
    return roundMoney(basePrice, 2);
  }

  // To outcompete in BUY side (you buy crypto, taker sells), pay slightly more (+step)
  // To outcompete in SELL side (you sell crypto, taker buys), charge slightly less (-step)
  if (side === 'BUY') {
    return roundMoney(basePrice + (strategy === 'UNDERCUT' ? stepVes : 0), 2);
  } else {
    return roundMoney(basePrice - (strategy === 'UNDERCUT' ? stepVes : 0), 2);
  }
}

/**
 * Evaluates the market depth against repricing rules and computes the next decision.
 */
export function evaluateRepricer(input: RepricerEvaluationInput): RepricerDecision {
  const { config, marketDepth, currentBuyAdPrice, currentSellAdPrice, isDailyLimitExceeded } = input;
  const safetyFlags: string[] = [];

  // 1. Guard against bank limit exhaustion
  if (isDailyLimitExceeded) {
    return {
      action: 'PAUSE',
      suggestedBuyPrice: currentBuyAdPrice ?? 0,
      suggestedSellPrice: currentSellAdPrice ?? 0,
      spreadVes: 0,
      spreadPct: 0,
      reason: 'Límites bancarios diarios agotados. Anuncios pausados por seguridad.',
      safetyFlags: ['DAILY_BANK_LIMIT_EXCEEDED'],
      isSafe: false,
    };
  }

  // 2. Guard against missing market depth
  if (marketDepth.bestBuyPrice <= 0 || marketDepth.bestSellPrice <= 0) {
    return {
      action: 'PAUSE',
      suggestedBuyPrice: currentBuyAdPrice ?? 0,
      suggestedSellPrice: currentSellAdPrice ?? 0,
      spreadVes: 0,
      spreadPct: 0,
      reason: 'Profundidad de mercado no disponible o insuficiente.',
      safetyFlags: ['INSUFFICIENT_MARKET_DEPTH'],
      isSafe: false,
    };
  }

  // 3. Calculate target prices based on order book
  let targetBuy = calculatePositionPrice(
    marketDepth.buyOffers,
    'BUY',
    config.strategy,
    config.stepVes,
  );
  let targetSell = calculatePositionPrice(
    marketDepth.sellOffers,
    'SELL',
    config.strategy,
    config.stepVes,
  );

  // Fallbacks if offers array is smaller than target
  if (targetBuy <= 0) targetBuy = marketDepth.bestBuyPrice;
  if (targetSell <= 0) targetSell = marketDepth.bestSellPrice;

  // 4. Break-even safety check on sell price
  if (targetSell < config.breakEvenSellPrice) {
    safetyFlags.push('BREAK_EVEN_VIOLATION');
    // Enforce hard floor: never quote below break-even!
    targetSell = roundMoney(config.breakEvenSellPrice, 2);
  }

  // 5. Max buy price safety check
  if (config.maxBuyPrice && config.maxBuyPrice > 0 && targetBuy > config.maxBuyPrice) {
    safetyFlags.push('MAX_BUY_PRICE_EXCEEDED');
    targetBuy = roundMoney(config.maxBuyPrice, 2);
  }

  // 6. Compute resulting spread
  const spreadVes = roundMoney(targetSell - targetBuy, 2);
  const spreadPct = targetBuy > 0 ? roundMoney((spreadVes / targetBuy) * 100, 2) : 0;

  // 7. Validate minimum spread threshold
  if (spreadVes < config.minSpreadVes) {
    safetyFlags.push('SPREAD_BELOW_MINIMUM');
    return {
      action: 'PAUSE',
      suggestedBuyPrice: targetBuy,
      suggestedSellPrice: targetSell,
      spreadVes,
      spreadPct,
      reason: `Spread proyectado (${spreadVes} Bs) es menor al mínimo requerido (${config.minSpreadVes} Bs).`,
      safetyFlags,
      isSafe: false,
    };
  }

  // 8. Determine if update is needed
  const buyChanged = currentBuyAdPrice !== undefined && Math.abs(currentBuyAdPrice - targetBuy) >= 0.01;
  const sellChanged = currentSellAdPrice !== undefined && Math.abs(currentSellAdPrice - targetSell) >= 0.01;

  const action: 'UPDATE' | 'KEEP' = buyChanged || sellChanged || !currentBuyAdPrice ? 'UPDATE' : 'KEEP';

  return {
    action,
    suggestedBuyPrice: targetBuy,
    suggestedSellPrice: targetSell,
    spreadVes,
    spreadPct,
    reason: action === 'UPDATE'
      ? `Precios ajustados para estrategia ${config.strategy}: Compra ${targetBuy} Bs / Venta ${targetSell} Bs (Spread: ${spreadVes} Bs).`
      : 'Precios actuales de los anuncios ya se encuentran en la posición óptima.',
    safetyFlags,
    isSafe: true,
  };
}
