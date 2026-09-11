/**
 * Johnson Market Depth — motor de análisis de profundidad para P2P Decisor.
 * Lógica pura, framework-agnostic. Consume los shapes reales de ./binance-p2p.
 * SOLO este archivo y su spec se crean en esta Task; el resto de funciones llegan en Tasks 2-3.
 */
import {
  type BinanceOfferSummary,
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
