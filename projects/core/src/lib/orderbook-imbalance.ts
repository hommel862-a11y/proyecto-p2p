/**
 * Pure Order Book Imbalance (OBI) & Market Microstructure Pressure Engine.
 * Computes normalised buy vs sell volume pressure on Binance P2P depth,
 * identifies liquidity gaps (vacuum zones), and advises Maker ad pricing ticks.
 * Zero network, zero dependencies.
 */

import { roundMoney } from './money';
import type { BinanceOfferSummary } from './binance-p2p';

export type PressureClassification =
  | 'STRONG_BUY_PRESSURE'
  | 'MODERATE_BUY_PRESSURE'
  | 'BALANCED'
  | 'MODERATE_SELL_PRESSURE'
  | 'STRONG_SELL_PRESSURE';

export interface LiquidityGap {
  side: 'BUY' | 'SELL';
  level: number;
  fromPrice: number;
  toPrice: number;
  gapPct: number;
  severity: 'MILD' | 'SIGNIFICANT' | 'CRITICAL';
}

export interface OrderBookImbalanceOptions {
  depthLevels?: number; // default 10
  minOrderUsdt?: number; // default 20 USDT to ignore dust
  gapThresholdPct?: number; // default 0.4% gap between consecutive offers
}

export interface OrderBookImbalanceResult {
  depthLevelsEvaluated: number;
  buyVolumeUsdt: number;
  sellVolumeUsdt: number;
  totalVolumeUsdt: number;
  
  // Normalized imbalance from -1.0 to +1.0 (-100% to +100%)
  obiRatio: number;
  obiPercentage: number;
  
  classification: PressureClassification;
  pressureLabel: string;
  gaugePercent: number; // 0 to 100 for visual gauge meter (50 = balanced, 0 = strong sell, 100 = strong buy)
  
  // Tactical Maker pricing recommendations
  makerBuyPriceGuidance: string;
  makerSellPriceGuidance: string;
  recommendedPriceTickDeltaPct: number;
  
  // Microstructure gaps detected
  gaps: LiquidityGap[];
  timestamp: number;
}

/**
 * Computes Order Book Imbalance (OBI) from top buy and sell offers.
 */
export function calculateOrderBookImbalance(
  buyOffers: BinanceOfferSummary[] = [],
  sellOffers: BinanceOfferSummary[] = [],
  options: OrderBookImbalanceOptions = {}
): OrderBookImbalanceResult {
  const depthK = options.depthLevels ?? 10;
  const minUsdt = options.minOrderUsdt ?? 20;
  const gapThreshold = options.gapThresholdPct ?? 0.4;

  // Filter and extract top K valid liquidity levels
  const validBuy = buyOffers
    .filter((o) => o.price > 0 && o.maxVes / o.price >= minUsdt)
    .slice(0, depthK);

  const validSell = sellOffers
    .filter((o) => o.price > 0 && o.maxVes / o.price >= minUsdt)
    .slice(0, depthK);

  const buyVolumeUsdt = roundMoney(
    validBuy.reduce((sum, o) => sum + o.maxVes / o.price, 0)
  );
  const sellVolumeUsdt = roundMoney(
    validSell.reduce((sum, o) => sum + o.maxVes / o.price, 0)
  );
  const totalVolumeUsdt = roundMoney(buyVolumeUsdt + sellVolumeUsdt);

  let obiRatio = 0;
  if (totalVolumeUsdt > 0) {
    obiRatio = (buyVolumeUsdt - sellVolumeUsdt) / totalVolumeUsdt;
  }
  obiRatio = Number(Math.max(-1, Math.min(1, obiRatio)).toFixed(4));
  const obiPercentage = Number((obiRatio * 100).toFixed(1));

  // Gauge meter: scale -1..1 to 0..100
  const gaugePercent = Number(((obiRatio + 1) * 50).toFixed(1));

  let classification: PressureClassification = 'BALANCED';
  let pressureLabel = 'Libro Equilibrado (Sin sesgo dominante)';
  let makerBuyPriceGuidance = 'Mantené precio competitivo estándar sobre el tramo activo.';
  let makerSellPriceGuidance = 'Mantené precio competitivo estándar sobre el tramo activo.';
  let recommendedPriceTickDeltaPct = 0.0;

  if (obiPercentage >= 30) {
    classification = 'STRONG_BUY_PRESSURE';
    pressureLabel = 'Fuerte Presión Compradora (Alta demanda de USDT)';
    makerSellPriceGuidance =
      'Subí tu precio Maker de venta (+0.15% a +0.30% sobre la mediana). La absorción rápida permite capturar mayor spread sin perder velocidad.';
    makerBuyPriceGuidance =
      'Podés mantener compra conservadora; la demanda absorberá tu venta rápidamente.';
    recommendedPriceTickDeltaPct = 0.2;
  } else if (obiPercentage >= 10) {
    classification = 'MODERATE_BUY_PRESSURE';
    pressureLabel = 'Presión Compradora Moderada';
    makerSellPriceGuidance = 'Ajustá tu precio Maker de venta +0.10% por encima de la media.';
    makerBuyPriceGuidance = 'Compra estable en los primeros 3 puestos del tramo.';
    recommendedPriceTickDeltaPct = 0.1;
  } else if (obiPercentage <= -30) {
    classification = 'STRONG_SELL_PRESSURE';
    pressureLabel = 'Fuerte Presión Vendedora (Exceso de oferta de USDT)';
    makerBuyPriceGuidance =
      'Bajá tu precio Maker de compra (-0.15% a -0.25%). No pagues por encima de la media para evitar quedar atrapado en inventario costoso.';
    makerSellPriceGuidance =
      'Para salir rápido de USDT, igualá los primeros 2 puestos del libro.';
    recommendedPriceTickDeltaPct = -0.2;
  } else if (obiPercentage <= -10) {
    classification = 'MODERATE_SELL_PRESSURE';
    pressureLabel = 'Presión Vendedora Moderada';
    makerBuyPriceGuidance = 'Ajustá compra a la baja para defender tu margen de seguridad.';
    makerSellPriceGuidance = 'Venta competitiva en los primeros 3 puestos.';
    recommendedPriceTickDeltaPct = -0.1;
  }

  // Detect gaps in consecutive offers
  const gaps: LiquidityGap[] = [];

  for (let i = 0; i < validBuy.length - 1; i++) {
    const p1 = validBuy[i].price;
    const p2 = validBuy[i + 1].price;
    const diffPct = Math.abs((p1 - p2) / p1) * 100;
    if (diffPct >= gapThreshold) {
      gaps.push({
        side: 'BUY',
        level: i + 1,
        fromPrice: p1,
        toPrice: p2,
        gapPct: Number(diffPct.toFixed(2)),
        severity: diffPct >= 1.0 ? 'CRITICAL' : diffPct >= 0.6 ? 'SIGNIFICANT' : 'MILD',
      });
    }
  }

  for (let i = 0; i < validSell.length - 1; i++) {
    const p1 = validSell[i].price;
    const p2 = validSell[i + 1].price;
    const diffPct = Math.abs((p2 - p1) / p1) * 100;
    if (diffPct >= gapThreshold) {
      gaps.push({
        side: 'SELL',
        level: i + 1,
        fromPrice: p1,
        toPrice: p2,
        gapPct: Number(diffPct.toFixed(2)),
        severity: diffPct >= 1.0 ? 'CRITICAL' : diffPct >= 0.6 ? 'SIGNIFICANT' : 'MILD',
      });
    }
  }

  return {
    depthLevelsEvaluated: Math.max(validBuy.length, validSell.length),
    buyVolumeUsdt,
    sellVolumeUsdt,
    totalVolumeUsdt,
    obiRatio,
    obiPercentage,
    classification,
    pressureLabel,
    gaugePercent,
    makerBuyPriceGuidance,
    makerSellPriceGuidance,
    recommendedPriceTickDeltaPct,
    gaps,
    timestamp: Date.now(),
  };
}
