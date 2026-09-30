/**
 * Pure Mathematical Engine for Orderbook Sniping & Distressed Liquidity Absorption.
 * Detects mispriced ads, fat-finger inputs, and distressed panic liquidations in P2P orderbooks.
 * Evaluates immediate absorption profit, resale execution risk, and urgency score.
 * Zero external dependencies.
 */

import { roundMoney } from './money';

export interface P2pOrderbookAdItem {
  advId: string;
  merchantName: string;
  orderType: 'BUY' | 'SELL';
  price: number;
  availableAmountCrypto: number; // e.g. USDT
  minLimitFiat: number;
  maxLimitFiat: number;
  paymentMethods: string[];
  fiatCurrency?: string;
}

export interface SnipedOpportunityAlert {
  advId: string;
  merchantName: string;
  orderType: 'BUY' | 'SELL';
  adPrice: number;
  fairMarketPrice: number;
  priceDivergencePct: number; // e.g. -2.3% below fair market price
  availableLiquidityUsd: number;
  grossProfitUsd: number;
  takerFeePct: number | null;
  netProfitUsd: number;
  netYieldPct: number | null;
  urgencyScore: number; // 1 to 100
  recommendedAction: 'SNIPE_IMMEDIATELY' | 'PROCEED_WITH_CAUTION' | 'IGNORE';
  /**
   * A dislocation is only executable when the fee assumption is explicit. When the taker
   * fee is unknown the alert is still surfaced (the price gap is real) but it is not
   * actionable and carries no projected profit.
   */
  isActionable: boolean;
  /** Present when the alert is blocked. Absent when the fee is explicitly known. */
  reason?: 'MISSING_FRICTION_METRICS';
  riskRationale: string;
  timestamp: string;
}

export interface SniperAuditConfig {
  fairMarketPrice: number;
  minProfitThresholdPct?: number; // default 1.2%
  /** Must be supplied explicitly. There is no safe default for an unknown fee. */
  maxTakerFeePct?: number;
  minLiquidityFloorUsd?: number; // default $50 USD to avoid dust
}

/**
 * Audits a single P2P ad against fair market price and determines if it represents a snipable dislocation.
 */
export function evaluateSnipingOpportunity(
  ad: P2pOrderbookAdItem,
  config: SniperAuditConfig,
): SnipedOpportunityAlert | null {
  const fair = config.fairMarketPrice;
  if (!fair || fair <= 0 || !ad.price || ad.price <= 0) return null;

  const minThreshold = config.minProfitThresholdPct ?? 1.2;
  // An unknown taker fee is not a zero fee. The fee is the term that decides whether the
  // dislocation survives costs, so we block instead of defaulting it away.
  const hasExplicitFee = config.maxTakerFeePct !== undefined && config.maxTakerFeePct >= 0;
  const takerFeePct = hasExplicitFee ? config.maxTakerFeePct! : null;
  const floorUsd = config.minLiquidityFloorUsd ?? 50;

  if (ad.availableAmountCrypto < floorUsd) {
    return null; // Dust order, ignore
  }

  const divergencePct =
    ad.orderType === 'SELL'
      ? ((fair - ad.price) / fair) * 100
      : ((ad.price - fair) / fair) * 100;

  if (divergencePct < minThreshold) {
    return null; // Normal order, no anomaly
  }

  const roundedDivergence = roundMoney(divergencePct, 2);

  // Without an explicit fee the net yield is unknown, so no net profitability is asserted.
  const netYieldPct = takerFeePct === null ? null : roundMoney(roundedDivergence - takerFeePct, 2);

  if (netYieldPct !== null && netYieldPct < minThreshold) {
    return null;
  }

  const isActionable = takerFeePct !== null;
  const liquidityUsd = roundMoney(ad.availableAmountCrypto, 2);
  const grossProfitUsd = roundMoney((liquidityUsd * roundedDivergence) / 100, 2);
  const netProfitUsd = isActionable ? roundMoney((liquidityUsd * netYieldPct!) / 100, 2) : 0;

  // Urgency score: higher divergence and moderate ticket size increase urgency
  let urgency = Math.min(100, Math.round(roundedDivergence * 25));
  if (liquidityUsd >= 500 && liquidityUsd <= 5000) {
    urgency = Math.min(100, urgency + 20); // Sweet spot liquidity
  }

  let recommendedAction: 'SNIPE_IMMEDIATELY' | 'PROCEED_WITH_CAUTION' | 'IGNORE' = 'SNIPE_IMMEDIATELY';
  let riskRationale = 'Oportunidad de absorción limpia con descalce de precio favorable.';

  if (!isActionable) {
    recommendedAction = 'PROCEED_WITH_CAUTION';
    riskRationale =
      'Bloqueado por fricción desconocida: se requiere parametrizar maxTakerFeePct antes de autorizar ejecución. El descalce de precio es observable, el margen neto no.';
  } else if (roundedDivergence > 6.0) {
    recommendedAction = 'PROCEED_WITH_CAUTION';
    riskRationale = 'Desvío extremo (>6%). Posible error tipográfico grave (fat-finger) o condiciones de pago no estándar. Verificar términos antes de liberar.';
  } else if (ad.paymentMethods.length === 0) {
    recommendedAction = 'PROCEED_WITH_CAUTION';
    riskRationale = 'Sin métodos de pago reconocidos explícitos.';
  }

  return {
    advId: ad.advId,
    merchantName: ad.merchantName,
    orderType: ad.orderType,
    adPrice: ad.price,
    fairMarketPrice: fair,
    priceDivergencePct: roundedDivergence,
    availableLiquidityUsd: liquidityUsd,
    grossProfitUsd,
    takerFeePct,
    netProfitUsd,
    netYieldPct,
    urgencyScore: urgency,
    recommendedAction,
    isActionable,
    ...(isActionable ? {} : { reason: 'MISSING_FRICTION_METRICS' as const }),
    riskRationale,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Scans an array of orderbook ads and returns all actionable sniping opportunities ranked by net profit.
 */
export function scanOrderbookSnipingOpportunities(
  ads: readonly P2pOrderbookAdItem[],
  config: SniperAuditConfig,
): SnipedOpportunityAlert[] {
  const alerts: SnipedOpportunityAlert[] = [];

  for (const ad of ads) {
    const evaluated = evaluateSnipingOpportunity(ad, config);
    if (evaluated) {
      alerts.push(evaluated);
    }
  }

  return alerts.sort((a, b) => b.netProfitUsd - a.netProfitUsd);
}
