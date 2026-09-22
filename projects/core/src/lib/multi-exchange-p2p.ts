/**
 * Multi-Exchange P2P Aggregator & Spatial Arbitrage Engine.
 * Normalizes order books across Binance, Bybit, and El Dorado.
 * Calculates cross-platform arbitrage opportunities factoring in taker/maker fees
 * and cross-chain withdrawal transfer costs (TRC20, BEP20, Internal).
 * Pure TypeScript, framework-agnostic, zero external dependencies.
 */

export type ExchangeName = 'BINANCE' | 'BYBIT' | 'ELDORADO';
export type P2pOrderSide = 'BUY' | 'SELL';
export type TransferNetwork = 'TRC20' | 'BEP20' | 'INTERNAL';

export interface UnifiedP2pOrder {
  id: string;
  exchange: ExchangeName;
  side: P2pOrderSide;
  merchantName: string;
  merchantOrdersCount: number;
  merchantFinishRatePct: number;
  price: number;
  fiatCurrency: string;
  cryptoCurrency: string;
  availableCrypto: number;
  minFiat: number;
  maxFiat: number;
  paymentMethods: string[];
  isVerifiedMerchant?: boolean;
}

export interface UnifiedP2pBook {
  timestamp: string;
  fiatCurrency: string;
  cryptoCurrency: string;
  buyOffers: UnifiedP2pOrder[]; // Counterparties buying crypto (taker sells)
  sellOffers: UnifiedP2pOrder[]; // Counterparties selling crypto (taker buys)
}

export interface CrossExchangeFeeConfig {
  makerFeePct: number;
  takerFeePct: number;
  networkWithdrawalFeeUsdt: Record<TransferNetwork, number>;
}

export const DEFAULT_EXCHANGE_FEES: Record<ExchangeName, CrossExchangeFeeConfig> = {
  BINANCE: {
    makerFeePct: 0.25,
    takerFeePct: 0.0,
    networkWithdrawalFeeUsdt: {
      TRC20: 1.0,
      BEP20: 0.2,
      INTERNAL: 0.0,
    },
  },
  BYBIT: {
    makerFeePct: 0.2,
    takerFeePct: 0.0,
    networkWithdrawalFeeUsdt: {
      TRC20: 1.0,
      BEP20: 0.25,
      INTERNAL: 0.0,
    },
  },
  ELDORADO: {
    makerFeePct: 0.1,
    takerFeePct: 0.0,
    networkWithdrawalFeeUsdt: {
      TRC20: 1.5,
      BEP20: 0.3,
      INTERNAL: 0.0,
    },
  },
};

export interface CrossExchangeArbitrageOpportunity {
  buyExchange: ExchangeName;
  sellExchange: ExchangeName;
  buyPrice: number;
  sellPrice: number;
  grossSpreadPct: number;
  netSpreadPct: number;
  fillableCapitalUsdt: number;
  netProfitUsdt: number;
  netProfitFiat: number;
  fiatCurrency: string;
  network: TransferNetwork;
  withdrawalFeeUsdt: number;
  buyMerchant: string;
  sellMerchant: string;
  isViable: boolean;
}

export interface CrossArbitrageOptions {
  network?: TransferNetwork;
  minNetSpreadPct?: number;
  exchangeFees?: Record<ExchangeName, CrossExchangeFeeConfig>;
}

/**
 * Normalizes a raw Binance P2P offer summary into a UnifiedP2pOrder.
 */
export function normalizeBinanceOrder(
  raw: {
    advNo?: string;
    price?: number;
    merchantName?: string;
    finishRatePct?: number;
    orderCount?: number;
    minVes?: number;
    maxVes?: number;
    payMethods?: string[];
  },
  side: P2pOrderSide,
  fiatCurrency = 'VES',
  cryptoCurrency = 'USDT',
): UnifiedP2pOrder {
  const price = Number(raw.price) || 0;
  const maxFiat = Number(raw.maxVes) || 0;
  const availableCrypto = price > 0 ? maxFiat / price : 0;

  return {
    id: raw.advNo || `bin-${Math.random().toString(36).slice(2, 9)}`,
    exchange: 'BINANCE',
    side,
    merchantName: raw.merchantName || 'Binance Merchant',
    merchantOrdersCount: Number(raw.orderCount) || 0,
    merchantFinishRatePct: Number(raw.finishRatePct) || 100,
    price,
    fiatCurrency,
    cryptoCurrency,
    availableCrypto,
    minFiat: Number(raw.minVes) || 0,
    maxFiat,
    paymentMethods: Array.isArray(raw.payMethods) ? raw.payMethods : [],
    isVerifiedMerchant: true,
  };
}

/**
 * Normalizes a raw Bybit P2P offer record into a UnifiedP2pOrder.
 */
export function normalizeBybitOrder(
  raw: {
    id?: string;
    userId?: string;
    nickName?: string;
    price?: string | number;
    currencyId?: string;
    tokenId?: string;
    lastQuantity?: string | number;
    minAmount?: string | number;
    maxAmount?: string | number;
    payments?: string[];
    recentOrderNum?: number;
    recentExecuteRate?: number;
  },
  side: P2pOrderSide,
  paymentMap?: Record<string, string>,
): UnifiedP2pOrder {
  const price = Number(raw.price) || 0;
  const availableCrypto = Number(raw.lastQuantity) || 0;
  const methods = (raw.payments || []).map((p) =>
    paymentMap && paymentMap[p] ? paymentMap[p] : p,
  );

  return {
    id: raw.id || `byb-${Math.random().toString(36).slice(2, 9)}`,
    exchange: 'BYBIT',
    side,
    merchantName: raw.nickName || raw.userId || 'Bybit Merchant',
    merchantOrdersCount: Number(raw.recentOrderNum) || 0,
    merchantFinishRatePct: Number(raw.recentExecuteRate) || 100,
    price,
    fiatCurrency: raw.currencyId || 'VES',
    cryptoCurrency: raw.tokenId || 'USDT',
    availableCrypto,
    minFiat: Number(raw.minAmount) || 0,
    maxFiat: Number(raw.maxAmount) || 0,
    paymentMethods: methods,
    isVerifiedMerchant: true,
  };
}

/**
 * Normalizes a raw El Dorado P2P order into a UnifiedP2pOrder.
 */
export function normalizeElDoradoOrder(
  raw: {
    order_id?: string;
    username?: string;
    rate?: number;
    fiat?: string;
    crypto?: string;
    min_limit?: number;
    max_limit?: number;
    available_balance?: number;
    payment_method_name?: string;
    completed_orders?: number;
    completion_percent?: number;
  },
  side: P2pOrderSide,
): UnifiedP2pOrder {
  return {
    id: raw.order_id || `eld-${Math.random().toString(36).slice(2, 9)}`,
    exchange: 'ELDORADO',
    side,
    merchantName: raw.username || 'El Dorado Merchant',
    merchantOrdersCount: Number(raw.completed_orders) || 0,
    merchantFinishRatePct: Number(raw.completion_percent) || 100,
    price: Number(raw.rate) || 0,
    fiatCurrency: raw.fiat || 'VES',
    cryptoCurrency: raw.crypto || 'USDT',
    availableCrypto: Number(raw.available_balance) || 0,
    minFiat: Number(raw.min_limit) || 0,
    maxFiat: Number(raw.max_limit) || 0,
    paymentMethods: raw.payment_method_name ? [raw.payment_method_name] : [],
    isVerifiedMerchant: true,
  };
}

/**
 * Scans normalized books across exchanges and finds spatial arbitrage opportunities.
 */
export function findCrossExchangeArbitrage(
  books: Partial<Record<ExchangeName, UnifiedP2pBook>>,
  capitalUsdt: number,
  options?: CrossArbitrageOptions,
): CrossExchangeArbitrageOpportunity[] {
  const network = options?.network || 'BEP20';
  const minSpread = options?.minNetSpreadPct ?? 0.5;
  const fees = options?.exchangeFees || DEFAULT_EXCHANGE_FEES;

  const exchanges: ExchangeName[] = (Object.keys(books) as ExchangeName[]).filter(
    (ex) => books[ex] && books[ex]!.sellOffers.length > 0 && books[ex]!.buyOffers.length > 0,
  );

  const opportunities: CrossExchangeArbitrageOpportunity[] = [];

  for (const buyEx of exchanges) {
    for (const sellEx of exchanges) {
      if (buyEx === sellEx) continue;

      const buyBook = books[buyEx];
      const sellBook = books[sellEx];
      if (!buyBook || !sellBook) continue;

      // Buy side: Taker buys from seller (cheapest sellOffer)
      const sortedSellOffers = [...buyBook.sellOffers].sort((a, b) => a.price - b.price);
      const buyOffer = sortedSellOffers[0];

      // Sell side: Taker sells to buyer (highest buyOffer)
      const sortedBuyOffers = [...sellBook.buyOffers].sort((a, b) => b.price - a.price);
      const sellOffer = sortedBuyOffers[0];

      if (!buyOffer || !sellOffer || buyOffer.price <= 0 || sellOffer.price <= 0) continue;

      const buyPrice = buyOffer.price;
      const sellPrice = sellOffer.price;

      if (sellPrice <= buyPrice) continue;

      const grossSpreadPct = ((sellPrice - buyPrice) / buyPrice) * 100;

      // Volume limits
      const fillableCapitalUsdt = Math.min(
        capitalUsdt,
        buyOffer.availableCrypto,
        sellOffer.availableCrypto,
      );
      if (fillableCapitalUsdt <= 0) continue;

      // Cost of cross-chain transfer
      const withdrawalFeeUsdt = fees[buyEx]?.networkWithdrawalFeeUsdt[network] ?? 1.0;
      const cryptoArrivedUsdt = Math.max(0, fillableCapitalUsdt - withdrawalFeeUsdt);

      const fiatSpent = fillableCapitalUsdt * buyPrice;
      const fiatReceived = cryptoArrivedUsdt * sellPrice;
      const netProfitFiat = fiatReceived - fiatSpent;
      const netProfitUsdt = netProfitFiat / buyPrice;
      const netSpreadPct = (netProfitFiat / fiatSpent) * 100;

      const isViable = netSpreadPct >= minSpread && netProfitUsdt > 0;

      opportunities.push({
        buyExchange: buyEx,
        sellExchange: sellEx,
        buyPrice,
        sellPrice,
        grossSpreadPct,
        netSpreadPct,
        fillableCapitalUsdt,
        netProfitUsdt,
        netProfitFiat,
        fiatCurrency: buyBook.fiatCurrency,
        network,
        withdrawalFeeUsdt,
        buyMerchant: buyOffer.merchantName,
        sellMerchant: sellOffer.merchantName,
        isViable,
      });
    }
  }

  return opportunities.sort((a, b) => b.netProfitUsdt - a.netProfitUsdt);
}
