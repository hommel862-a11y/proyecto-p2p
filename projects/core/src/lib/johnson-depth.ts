/**
 * Johnson Market Depth — motor de análisis de profundidad para P2P Decisor.
 * Lógica pura, framework-agnostic. Consume los shapes reales de ./binance-p2p.
 * SOLO este archivo y su spec se crean en esta Task; el resto de funciones llegan en Tasks 2-3.
 */
import {
  type BinanceOfferSummary,
  type BinanceP2pMarketDepth,
} from './binance-p2p';
import { roundMoney } from './money';

export interface JohnsonDepthOptions {
  /** Ofertas con precio fuera de [mediana / factor, mediana * factor] se ignoran (anti-manipulación). Default 3. */
  maxPriceDeviationFactor?: number;
  /** Ofertas con finishRatePct < umbral se ignoran (anti-fake). Default 0 = sin filtro. */
  minFinishRatePct?: number;
}

/**
 * Calcula el precio promedio ponderado por volumen que realmente obtendrías
 * al operar `targetUsdt`, consumiendo ofertas del mejor precio hacia abajo,
 * tras descartar outliers de precio y ofertas de reputación baja.
 * @param offers Ofertas del lado correcto (sellOffers para comprar, buyOffers para vender)
 * @param side 'BUY' compras USDT (vendedores, precio menor primero); 'SELL' vendes USDT (compradores, precio mayor primero)
 * @param targetUsdt USDT objetivo
 * @param options Filtros anti-manipulación opcionales
 */
export function computeVolumeWeightedPrice(
  offers: readonly BinanceOfferSummary[],
  side: 'BUY' | 'SELL',
  targetUsdt: number,
  options: JohnsonDepthOptions = {},
): { price: number; fillableUsdt: number } {
  const maxDeviation = options.maxPriceDeviationFactor ?? 3;
  const minFinishRate = options.minFinishRatePct ?? 0;

  if (!offers || offers.length === 0 || targetUsdt <= 0) {
    return { price: 0, fillableUsdt: 0 };
  }

  // 1) Filtro base: precio y volumen positivos + reputación mínima
  let candidates = offers.filter(
    (o) => o.price > 0 && o.maxVes > 0 && o.finishRatePct >= minFinishRate,
  );
  if (candidates.length === 0) return { price: 0, fillableUsdt: 0 };

  // 2) Anti-manipulación: descartar outliers de precio por desviación de la mediana
  if (candidates.length >= 3 && maxDeviation > 1) {
    const prices = candidates.map((o) => o.price).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    if (median > 0) {
      candidates = candidates.filter(
        (o) => o.price >= median / maxDeviation && o.price <= median * maxDeviation,
      );
    }
  }
  if (candidates.length === 0) return { price: 0, fillableUsdt: 0 };

  const sorted = [...candidates].sort((a, b) =>
    side === 'BUY' ? a.price - b.price : b.price - a.price,
  );

  let remaining = targetUsdt;
  let totalVes = 0;
  let fillable = 0;

  for (const offer of sorted) {
    if (remaining <= 0) break;
    const maxUsdtThisOffer = offer.maxVes > 0 ? offer.maxVes / offer.price : 0;
    if (maxUsdtThisOffer <= 0) continue;
    const usdtAtLevel = Math.min(maxUsdtThisOffer, remaining);
    totalVes += usdtAtLevel * offer.price;
    fillable += usdtAtLevel;
    remaining -= usdtAtLevel;
  }

  const price = fillable > 0 ? totalVes / fillable : 0;
  return { price: roundMoney(price, 2), fillableUsdt: Math.round(fillable * 100) / 100 };
}

export interface JohnsonDepthRequirements {
  /** Spread mínimo en VES para activar señales positivas */
  minSpread: number;
  /** Liquidez mínima en USDT (por lado) para considerar el mercado opertable */
  minLiquidityUsdt: number;
  /** Tamaño típico de operación en USDT usado para medir profundidad */
  targetUsdt: number;
  /** Máximo de errores consecutivos antes de pausar (gobernanza) */
  maxConsecutiveErrors: number;
}

export const DEFAULT_JOHNSON_REQUIREMENTS: JohnsonDepthRequirements = {
  minSpread: 0.3,
  minLiquidityUsdt: 500,
  targetUsdt: 500,
  maxConsecutiveErrors: 2,
};

export function calculateDepthQuality(
  depth: BinanceP2pMarketDepth,
  req: JohnsonDepthRequirements,
): number {
  if (!depth.bestBuyPrice || !depth.bestSellPrice) return 0;

  const targetVol = Math.max(req.targetUsdt, req.minLiquidityUsdt);
  const buyUsdt = computeVolumeWeightedPrice(depth.buyOffers, 'SELL', targetVol).fillableUsdt;
  const sellUsdt = computeVolumeWeightedPrice(depth.sellOffers, 'BUY', targetVol).fillableUsdt;

  // 1. Ratio de balance buy/sell (50%)
  const total = buyUsdt + sellUsdt;
  const volumeRatio = total > 0
    ? Math.min(Math.min(buyUsdt, sellUsdt) / Math.max(total / 2, 1), 1) * 100
    : 50;

  // 2. Profundidad relativa al spread (30%) — spread porcentual alto castiga
  const spreadPct =
    depth.spreadPct !== undefined && depth.spreadPct !== null
      ? Math.abs(depth.spreadPct)
      : depth.bestBuyPrice > 0
        ? (Math.abs(depth.spreadVes ?? 0) / depth.bestBuyPrice) * 100
        : Math.abs(depth.spreadVes ?? 0);

  const spreadDepthRatio = Math.max(0, 100 - spreadPct * 5);

  // 3. Precio dentro de rango viable (20%)
  const priceInRange = depth.bestBuyPrice > 0 && depth.bestSellPrice > 0 ? 100 : 0;

  const quality = volumeRatio * 0.5 + spreadDepthRatio * 0.3 + priceInRange * 0.2;
  return Math.round(Math.max(0, Math.min(100, quality)));
}

export function calculateLiquidityScore(
  depth: BinanceP2pMarketDepth,
  req: JohnsonDepthRequirements,
): number {
  const minLiquidity = req.minLiquidityUsdt;
  const evalTarget = Math.max(req.targetUsdt, minLiquidity * 2);
  const buyUsdt = computeVolumeWeightedPrice(depth.buyOffers, 'SELL', evalTarget).fillableUsdt;
  const sellUsdt = computeVolumeWeightedPrice(depth.sellOffers, 'BUY', evalTarget).fillableUsdt;
  const avgVolume = (buyUsdt + sellUsdt) / 2;

  if (avgVolume >= minLiquidity * 2) return 100;
  if (avgVolume >= minLiquidity) return 75;
  if (avgVolume >= minLiquidity / 2) return 50;
  if (avgVolume > 0) return 25;
  return 0;
}

export function determineSignal(
  depth: BinanceP2pMarketDepth,
  qualityScore: number,
  liquidityScore: number,
  req: JohnsonDepthRequirements,
): 'STRONG_BUY' | 'BUY' | 'CAUTION' | 'AVOID' {
  if (depth.spreadVes !== undefined && depth.spreadVes !== null && depth.spreadVes < req.minSpread) {
    return 'AVOID';
  }
  if (liquidityScore < 40) return 'AVOID';
  if (qualityScore >= 80 && depth.spreadVes >= req.minSpread) return 'STRONG_BUY';
  if (qualityScore >= 60 && depth.spreadVes >= req.minSpread) return 'BUY';
  if (qualityScore >= 40) return 'CAUTION';
  return 'AVOID';
}
