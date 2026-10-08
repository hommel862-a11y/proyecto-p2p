/**
 * Dynamic L2 Spread Anchoring and Autonomous 24/7 Repricer Engine.
 * Dynamically adjusts market maker spread targets, micro-postures, and inventory skew
 * based on real-time order book depth, volatility regime, BCV macro gap, and bank account saturation.
 * Deterministic, pure domain logic, zero network, zero side effects.
 */

import { roundMoney } from './money';
import type { BinanceP2pMarketDepth } from './binance-p2p';
import { calculatePositionPrice, type RepricerStrategy } from './repricer';

export type VolatilityRegime = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
export type InventorySkew = 'BALANCED' | 'HEAVY_CRYPTO' | 'HEAVY_FIAT';

export interface DynamicSpreadInput {
  /** Real-time market depth */
  marketDepth: BinanceP2pMarketDepth;
  /** Base minimum net spread percentage desired (e.g., 0.60%) */
  baseMinSpreadPct: number;
  /** Maker positioning strategy in the order book */
  strategy: RepricerStrategy;
  /** Tick step in VES (default: 0.01) */
  stepVes?: number;
  /** Break-even floor price for selling crypto */
  breakEvenSellPrice: number;
  /** Maximum allowable purchase price */
  maxBuyPrice?: number;
  /** Market volatility regime (defaults to LOW if omitted) */
  volatilityRegime?: VolatilityRegime;
  /** Percentage gap between BCV and parallel rate (e.g. 15.4%) */
  bcvGapPct?: number;
  /** Current USDT inventory */
  currentInventoryUsdt?: number;
  /** Target USDT inventory to maintain balanced float */
  targetInventoryUsdt?: number;
  /** Primary bank saturation percentage (0 to 100) */
  bankSaturationPct?: number;
  /** Current active buy ad price on exchange */
  currentBuyPrice?: number;
  /** Current active sell ad price on exchange */
  currentSellPrice?: number;
  /** Maker platform fee percentage (e.g. 0.35%) */
  makerFeePct?: number;
}

export interface DynamicSpreadRecommendation {
  action: 'UPDATE' | 'KEEP' | 'PAUSE';
  recommendedBuyPrice: number;
  recommendedSellPrice: number;
  dynamicMinSpreadPct: number;
  projectedGrossSpreadPct: number;
  projectedNetSpreadPct: number;
  spreadVes: number;
  volatilityBufferPct: number;
  inventorySkew: InventorySkew;
  skewAdjustmentPct: number;
  safetyFlags: string[];
  isSafe: boolean;
  reason: string;
}

/**
 * Computes the volatility spread buffer percentage based on regime and BCV gap.
 */
export function calculateVolatilitySpreadBuffer(
  regime: VolatilityRegime = 'LOW',
  bcvGapPct = 0,
): number {
  let buffer = 0;

  switch (regime) {
    case 'LOW':
      buffer = 0.0;
      break;
    case 'MEDIUM':
      buffer = 0.25;
      break;
    case 'HIGH':
      buffer = 0.60;
      break;
    case 'EXTREME':
      buffer = 1.20;
      break;
  }

  // If BCV gap is elevated (> 15%), increase safety buffer to protect against intervention slip
  if (bcvGapPct >= 20) {
    buffer += 0.50;
  } else if (bcvGapPct >= 15) {
    buffer += 0.25;
  }

  return roundMoney(buffer, 2);
}

/**
 * Calculates inventory skew direction and percentage adjustment.
 * HEAVY_CRYPTO: Have > 125% target -> lower sell price to liquidate, raise buy threshold to slow buying.
 * HEAVY_FIAT: Have < 75% target -> raise buy price to restock, raise sell price.
 */
export function calculateInventorySkew(
  currentUsdt?: number,
  targetUsdt?: number,
): { skew: InventorySkew; adjustmentPct: number } {
  if (currentUsdt === undefined || targetUsdt === undefined || targetUsdt <= 0) {
    return { skew: 'BALANCED', adjustmentPct: 0 };
  }

  const ratio = currentUsdt / targetUsdt;

  if (ratio > 1.25) {
    // Over-allocated in crypto: skew toward selling
    const excessPct = Math.min((ratio - 1.25) * 0.5, 0.40);
    return { skew: 'HEAVY_CRYPTO', adjustmentPct: roundMoney(excessPct, 2) };
  }

  if (ratio < 0.75) {
    // Under-allocated in crypto: skew toward buying
    const deficitPct = Math.min((0.75 - ratio) * 0.5, 0.40);
    return { skew: 'HEAVY_FIAT', adjustmentPct: roundMoney(deficitPct, 2) };
  }

  return { skew: 'BALANCED', adjustmentPct: 0 };
}

/**
 * Pure calculation engine for Dynamic L2 Spread Anchoring.
 */
export function computeDynamicSpreadAnchors(
  input: DynamicSpreadInput,
): DynamicSpreadRecommendation {
  const {
    marketDepth,
    baseMinSpreadPct,
    strategy,
    stepVes = 0.01,
    breakEvenSellPrice,
    maxBuyPrice,
    volatilityRegime = 'LOW',
    bcvGapPct = 0,
    currentInventoryUsdt,
    targetInventoryUsdt,
    bankSaturationPct = 0,
    currentBuyPrice,
    currentSellPrice,
    makerFeePct = 0.35,
  } = input;

  const safetyFlags: string[] = [];

  // 1. Guard against bank limit exhaustion (>= 90% saturation)
  if (bankSaturationPct >= 90) {
    safetyFlags.push('BANK_SATURATION_CRITICAL');
    return {
      action: 'PAUSE',
      recommendedBuyPrice: currentBuyPrice ?? 0,
      recommendedSellPrice: currentSellPrice ?? 0,
      dynamicMinSpreadPct: baseMinSpreadPct,
      projectedGrossSpreadPct: 0,
      projectedNetSpreadPct: 0,
      spreadVes: 0,
      volatilityBufferPct: 0,
      inventorySkew: 'BALANCED',
      skewAdjustmentPct: 0,
      safetyFlags,
      isSafe: false,
      reason: `Saturación bancaria crítica (${bankSaturationPct.toFixed(1)}%). Operaciones pausadas para prevenir bloqueos regulatorios.`,
    };
  }

  // 2. Guard against missing market depth
  if (marketDepth.bestBuyPrice <= 0 || marketDepth.bestSellPrice <= 0) {
    safetyFlags.push('INSUFFICIENT_MARKET_DEPTH');
    return {
      action: 'PAUSE',
      recommendedBuyPrice: currentBuyPrice ?? 0,
      recommendedSellPrice: currentSellPrice ?? 0,
      dynamicMinSpreadPct: baseMinSpreadPct,
      projectedGrossSpreadPct: 0,
      projectedNetSpreadPct: 0,
      spreadVes: 0,
      volatilityBufferPct: 0,
      inventorySkew: 'BALANCED',
      skewAdjustmentPct: 0,
      safetyFlags,
      isSafe: false,
      reason: 'Profundidad de mercado insuficiente en Binance P2P.',
    };
  }

  // 3. Dynamic Spread Anchor calculation
  const volatilityBuffer = calculateVolatilitySpreadBuffer(volatilityRegime, bcvGapPct);
  const { skew, adjustmentPct } = calculateInventorySkew(currentInventoryUsdt, targetInventoryUsdt);

  const dynamicMinSpreadPct = roundMoney(baseMinSpreadPct + volatilityBuffer, 2);

  // 4. Base positioning prices
  let targetBuy = calculatePositionPrice(
    marketDepth.buyOffers,
    'BUY',
    strategy,
    stepVes,
  );
  let targetSell = calculatePositionPrice(
    marketDepth.sellOffers,
    'SELL',
    strategy,
    stepVes,
  );

  if (targetBuy <= 0) targetBuy = marketDepth.bestBuyPrice;
  if (targetSell <= 0) targetSell = marketDepth.bestSellPrice;

  // 5. Apply inventory skew adjustments
  if (skew === 'HEAVY_CRYPTO' && adjustmentPct > 0) {
    // Want to sell faster: lower sell price slightly, lower buy price to avoid buying more
    targetSell = roundMoney(targetSell * (1 - adjustmentPct / 100), 2);
    targetBuy = roundMoney(targetBuy * (1 - adjustmentPct / 100), 2);
  } else if (skew === 'HEAVY_FIAT' && adjustmentPct > 0) {
    // Want to buy faster: raise buy price slightly, raise sell price
    targetBuy = roundMoney(targetBuy * (1 + adjustmentPct / 100), 2);
    targetSell = roundMoney(targetSell * (1 + adjustmentPct / 100), 2);
  }

  // 6. Hard safety boundaries
  if (targetSell < breakEvenSellPrice) {
    safetyFlags.push('BREAK_EVEN_VIOLATION');
    targetSell = roundMoney(breakEvenSellPrice, 2);
  }

  if (maxBuyPrice && maxBuyPrice > 0 && targetBuy > maxBuyPrice) {
    safetyFlags.push('MAX_BUY_PRICE_EXCEEDED');
    targetBuy = roundMoney(maxBuyPrice, 2);
  }

  // 7. Measure resulting gross and net spread
  const spreadVes = roundMoney(targetSell - targetBuy, 2);
  const grossSpreadPct = targetBuy > 0 ? roundMoney((spreadVes / targetBuy) * 100, 2) : 0;
  const netSpreadPct = roundMoney(grossSpreadPct - makerFeePct, 2);

  // 8. Enforce Dynamic Minimum Spread rule
  if (netSpreadPct < dynamicMinSpreadPct) {
    safetyFlags.push('SPREAD_BELOW_DYNAMIC_MINIMUM');
    return {
      action: 'PAUSE',
      recommendedBuyPrice: targetBuy,
      recommendedSellPrice: targetSell,
      dynamicMinSpreadPct,
      projectedGrossSpreadPct: grossSpreadPct,
      projectedNetSpreadPct: netSpreadPct,
      spreadVes,
      volatilityBufferPct: volatilityBuffer,
      inventorySkew: skew,
      skewAdjustmentPct: adjustmentPct,
      safetyFlags,
      isSafe: false,
      reason: `Spread neto proyectado (${netSpreadPct.toFixed(2)}%) es inferior al mínimo dinámico exigido (${dynamicMinSpreadPct.toFixed(2)}% con buffer de volatilidad de +${volatilityBuffer.toFixed(2)}%).`,
    };
  }

  // 9. Determine change threshold (>= 0.01 VES)
  const buyChanged =
    currentBuyPrice !== undefined && Math.abs(currentBuyPrice - targetBuy) >= 0.01;
  const sellChanged =
    currentSellPrice !== undefined && Math.abs(currentSellPrice - targetSell) >= 0.01;

  const action: 'UPDATE' | 'KEEP' =
    buyChanged || sellChanged || currentBuyPrice === undefined ? 'UPDATE' : 'KEEP';

  return {
    action,
    recommendedBuyPrice: targetBuy,
    recommendedSellPrice: targetSell,
    dynamicMinSpreadPct,
    projectedGrossSpreadPct: grossSpreadPct,
    projectedNetSpreadPct: netSpreadPct,
    spreadVes,
    volatilityBufferPct: volatilityBuffer,
    inventorySkew: skew,
    skewAdjustmentPct: adjustmentPct,
    safetyFlags,
    isSafe: true,
    reason:
      action === 'UPDATE'
        ? `Precios actualizados para estrategia ${strategy}: Compra ${targetBuy.toFixed(2)} VES / Venta ${targetSell.toFixed(2)} VES (Neto: ${netSpreadPct.toFixed(2)}%).`
        : 'Los precios actuales de los anuncios se mantienen en la postura óptima del libro.',
  };
}

/**
 * Formats Telegram MarkdownV2 message for Dynamic Repricer decisions and status.
 */
export function formatDynamicRepricerTelegramMessage(
  rec: DynamicSpreadRecommendation,
  autoModeActive: boolean,
): string {
  const statusEmoji = autoModeActive ? '🟢 AUTÓNOMO ACTIVO' : '🟡 MANUAL / PAUSADO';
  const actionEmoji =
    rec.action === 'UPDATE' ? '⚡ AJUSTE RECOMENDADO' : rec.action === 'KEEP' ? '✅ MANTENER' : '🛑 PAUSAR ANUNCIOS';

  const lines = [
    `🤖 *MOTOR DE REPRECIO DINÁMICO 24/7*`,
    `━━━━━━━━━━━━━━━━━━`,
    `• *Modo de Operación:* \`${statusEmoji}\``,
    `• *Decisión del Motor:* \`${actionEmoji}\``,
    `• *Compra Sugerida (BUY):* \`${rec.recommendedBuyPrice.toFixed(2)}\` VES`,
    `• *Venta Sugerida (SELL):* \`${rec.recommendedSellPrice.toFixed(2)}\` VES`,
    `• *Spread VES:* \`${rec.spreadVes.toFixed(2)}\` Bs`,
    `• *Spread Neto Estimado:* \`${rec.projectedNetSpreadPct.toFixed(2)}%\``,
    `• *Piso Spread Dinámico:* \`${rec.dynamicMinSpreadPct.toFixed(2)}%\` \\(Buffer Vol: \`+${rec.volatilityBufferPct.toFixed(2)}%\`\\)`,
    `• *Sesgo de Inventario:* \`${rec.inventorySkew}\` \\(\`${rec.skewAdjustmentPct.toFixed(2)}%\`\\)`,
  ];

  if (rec.safetyFlags.length > 0) {
    lines.push(`• *Banderas de Seguridad:* \`${rec.safetyFlags.join(', ')}\``);
  }

  lines.push(`\n📝 _${rec.reason.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}_`);

  return lines.join('\n');
}
