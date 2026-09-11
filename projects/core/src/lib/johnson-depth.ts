/**
 * Johnson Market Depth — motor de análisis de profundidad para P2P Decisor.
 * Lógica pura, framework-agnostic. Consume los shapes reales de ./binance-p2p.
 * SOLO este archivo y su spec se crean en esta Task; el resto de funciones llegan en Tasks 2-3.
 */
import {
  BINANCE_PAY_METHODS,
  type BinanceOfferSummary,
  type BinanceP2pMarketDepth,
} from './binance-p2p';
import { roundMoney } from './money';
import {
  computeArbitrageCycle,
  VENEZUELAN_BANK_FEES,
  type P2PRole,
} from './spread-quality';
import { type BankCode } from './accounts';
import { MINIMUM_VIABLE_NET_SPREAD_PCT } from './operator-manager';

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

export interface JohnsonBankProfit {
  bankKey: string;
  bankName: string;
  bankCode: BankCode;
  buyPriceVes: number;
  sellPriceVes: number;
  fillableUsdt: number;
  grossProfitVes: number;      // (sell - buy) * fillable — bruto, sin fees
  binanceFeeUsdt: number;
  bankFeesVes: number;
  netGainVes: number;          // ganancia neta tras fees
  netGainUsd: number;
  roiCyclePct: number;         // sobre capital invertido
  effectiveFeeDragPct: number; // % del spread nominal perdido en fees
  isSafe: boolean;             // roiCyclePct >= MINIMUM_VIABLE_NET_SPREAD_PCT
}

export interface JohnsonBankConfig {
  bankCodes: readonly string[];
  buyRole: P2PRole;
  sellRole: P2PRole;
  isInterbank: boolean;
}

export const DEFAULT_JOHNSON_BANK_CONFIG: JohnsonBankConfig = {
  bankCodes: ['BANESCO', 'MERCANTIL', 'BDV', 'BANCAMIGA', 'PROVINCIAL', 'OTRO'],
  buyRole: 'TAKER',
  sellRole: 'TAKER',
  isInterbank: false,
};

export function computeBankProfits(
  depth: BinanceP2pMarketDepth,
  bankKeys: readonly string[],
  req: JohnsonDepthRequirements,
  config: JohnsonBankConfig = DEFAULT_JOHNSON_BANK_CONFIG,
): JohnsonBankProfit[] {
  const results: JohnsonBankProfit[] = [];

  for (const bankKey of bankKeys) {
    const bankName = BINANCE_PAY_METHODS[bankKey] ?? '';
    const filter = (o: BinanceOfferSummary) => (bankName ? o.payMethods.includes(bankName) : true);

    const buyList = depth.buyOffers.filter(filter);
    const sellList = depth.sellOffers.filter(filter);

    const buy = computeVolumeWeightedPrice(buyList, 'BUY', req.targetUsdt);
    const sell = computeVolumeWeightedPrice(sellList, 'SELL', req.targetUsdt);

    const fillableUsdt = Math.min(buy.fillableUsdt, sell.fillableUsdt);
    const grossProfitVes = (sell.price - buy.price) * fillableUsdt;

    // Guarda obligatoria: computeArbitrageCycle lanza excepción con inputs <= 0
    if (fillableUsdt <= 0 || buy.price <= 0 || sell.price <= 0) {
      results.push({
        bankKey,
        bankName: bankName || bankKey,
        bankCode: (bankKey in VENEZUELAN_BANK_FEES ? bankKey : 'OTRO') as BankCode,
        buyPriceVes: buy.price,
        sellPriceVes: sell.price,
        fillableUsdt,
        grossProfitVes: roundMoney(grossProfitVes, 2),
        binanceFeeUsdt: 0,
        bankFeesVes: 0,
        netGainVes: 0,
        netGainUsd: 0,
        roiCyclePct: 0,
        effectiveFeeDragPct: 0,
        isSafe: false,
      });
      continue;
    }

    const bankCode = (bankKey in VENEZUELAN_BANK_FEES ? bankKey : 'OTRO') as BankCode;
    const cycle = computeArbitrageCycle({
      capitalUsdt: fillableUsdt,
      buyPrice: buy.price,
      sellPrice: sell.price,
      buyRole: config.buyRole,
      sellRole: config.sellRole,
      sourceBank: bankCode,
      targetBank: bankCode,
      isInterbank: config.isInterbank,
    });

    results.push({
      bankKey,
      bankName: bankName || bankCode,
      bankCode,
      buyPriceVes: buy.price,
      sellPriceVes: sell.price,
      fillableUsdt,
      grossProfitVes: roundMoney(grossProfitVes, 2),
      binanceFeeUsdt: roundMoney(cycle.binanceFeeUsdt, 4),
      bankFeesVes: roundMoney(cycle.bankFeesVes, 2),
      netGainVes: roundMoney(cycle.netGainVes, 2),
      netGainUsd: roundMoney(cycle.netGainUsd, 2),
      roiCyclePct: roundMoney(Math.max(0, cycle.roiCyclePct), 2),
      effectiveFeeDragPct: roundMoney(cycle.effectiveFeeDragPct, 2),
      isSafe: cycle.roiCyclePct >= MINIMUM_VIABLE_NET_SPREAD_PCT,
    });
  }

  return results.sort((a, b) => b.netGainVes - a.netGainVes);
}

export interface JohnsonMarketQuality {
  depthScore: number;
  liquidityScore: number;
  spreadVes: number;
  spreadPct: number;
  recommendation: 'STRONG_BUY' | 'BUY' | 'CAUTION' | 'AVOID';
  bestBank: string | null;
  bankProfits: JohnsonBankProfit[];
  timestamp: number;
}

export function buildJohnsonMarketQuality(
  depth: BinanceP2pMarketDepth,
  bankKeys: readonly string[],
  req: JohnsonDepthRequirements,
  config: JohnsonBankConfig = DEFAULT_JOHNSON_BANK_CONFIG,
): JohnsonMarketQuality {
  const depthScore = calculateDepthQuality(depth, req);
  const liquidityScore = calculateLiquidityScore(depth, req);
  const bankProfits = computeBankProfits(depth, bankKeys, req, config);
  const recommendation = determineSignal(depth, depthScore, liquidityScore, req);
  const bestBank = bankProfits.length > 0 && bankProfits[0].netGainVes > 0 ? bankProfits[0].bankKey : null;
  const spreadPct = depth.bestBuyPrice > 0 ? ((depth.spreadVes ?? 0) / depth.bestBuyPrice) * 100 : 0;

  return {
    depthScore,
    liquidityScore,
    spreadVes: roundMoney(depth.spreadVes ?? 0, 2),
    spreadPct: roundMoney(spreadPct, 2),
    recommendation,
    bestBank,
    bankProfits,
    timestamp: Date.now(),
  };
}

