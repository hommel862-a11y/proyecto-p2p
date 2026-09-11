import { describe, it, expect } from 'vitest';
import {
  normalizeBinanceOrder,
  normalizeBybitOrder,
  normalizeElDoradoOrder,
  findCrossExchangeArbitrage,
  UnifiedP2pBook,
  UnifiedP2pOrder,
  DEFAULT_EXCHANGE_FEES,
} from './multi-exchange-p2p';

describe('MultiExchangeP2P: Normalizador de Libros y Arbitraje Espacial', () => {
  describe('Normalizadores de Libros P2P', () => {
    it('normaliza una oferta de Binance P2P a UnifiedP2pOrder', () => {
      const rawBinance = {
        advNo: 'bin-12345',
        price: 810.5,
        merchantName: 'TraderPro',
        finishRatePct: 99.2,
        orderCount: 450,
        minVes: 500,
        maxVes: 50000,
        payMethods: ['Banesco', 'Pago Movil'],
      };

      const order: UnifiedP2pOrder = normalizeBinanceOrder(rawBinance, 'SELL', 'VES', 'USDT');
      expect(order.id).toBe('bin-12345');
      expect(order.exchange).toBe('BINANCE');
      expect(order.side).toBe('SELL');
      expect(order.price).toBe(810.5);
      expect(order.merchantName).toBe('TraderPro');
      expect(order.fiatCurrency).toBe('VES');
      expect(order.paymentMethods).toContain('Banesco');
    });

    it('normaliza una oferta de Bybit P2P', () => {
      const rawBybit = {
        id: 'byb-9876',
        userId: 'u-555',
        nickName: 'BybitKing',
        price: '805.20',
        currencyId: 'VES',
        tokenId: 'USDT',
        lastQuantity: '1200.50',
        minAmount: '1000',
        maxAmount: '80000',
        payments: ['363', '14'], // Banesco / Pago Movil IDs
        recentOrderNum: 320,
        recentExecuteRate: 98,
      };

      const order = normalizeBybitOrder(rawBybit, 'SELL', {
        '363': 'Banesco',
        '14': 'Pago Movil',
      });
      expect(order.exchange).toBe('BYBIT');
      expect(order.price).toBe(805.2);
      expect(order.availableCrypto).toBe(1200.5);
      expect(order.paymentMethods).toContain('Banesco');
    });

    it('normaliza una oferta de El Dorado P2P', () => {
      const rawElDorado = {
        order_id: 'eld-4321',
        username: 'CaracasExchange',
        rate: 802.0,
        fiat: 'VES',
        crypto: 'USDT',
        min_limit: 200,
        max_limit: 25000,
        available_balance: 500,
        payment_method_name: 'Banesco',
        completed_orders: 110,
        completion_percent: 97.5,
      };

      const order = normalizeElDoradoOrder(rawElDorado, 'SELL');
      expect(order.exchange).toBe('ELDORADO');
      expect(order.price).toBe(802.0);
      expect(order.availableCrypto).toBe(500);
      expect(order.paymentMethods).toContain('Banesco');
    });
  });

  describe('findCrossExchangeArbitrage (Arbitraje Espacial Inter-Exchange)', () => {
    function makeBook(
      exchange: 'BINANCE' | 'BYBIT' | 'ELDORADO',
      bestBuyPrice: number, // Best ask (taker buys from seller)
      bestSellPrice: number, // Best bid (taker sells to buyer)
      volumeUsdt = 1000,
    ): UnifiedP2pBook {
      return {
        timestamp: new Date().toISOString(),
        fiatCurrency: 'VES',
        cryptoCurrency: 'USDT',
        sellOffers: [
          {
            id: `${exchange}-sell-1`,
            exchange,
            side: 'SELL',
            merchantName: `Seller-${exchange}`,
            merchantOrdersCount: 200,
            merchantFinishRatePct: 99,
            price: bestBuyPrice,
            fiatCurrency: 'VES',
            cryptoCurrency: 'USDT',
            availableCrypto: volumeUsdt,
            minFiat: 100,
            maxFiat: volumeUsdt * bestBuyPrice,
            paymentMethods: ['Banesco'],
          },
        ],
        buyOffers: [
          {
            id: `${exchange}-buy-1`,
            exchange,
            side: 'BUY',
            merchantName: `Buyer-${exchange}`,
            merchantOrdersCount: 200,
            merchantFinishRatePct: 99,
            price: bestSellPrice,
            fiatCurrency: 'VES',
            cryptoCurrency: 'USDT',
            availableCrypto: volumeUsdt,
            minFiat: 100,
            maxFiat: volumeUsdt * bestSellPrice,
            paymentMethods: ['Banesco'],
          },
        ],
      };
    }

    it('detecta oportunidad de arbitraje: comprar barato en El Dorado y vender caro en Binance', () => {
      const books = {
        ELDORADO: makeBook('ELDORADO', 800, 790, 1000),
        BINANCE: makeBook('BINANCE', 825, 820, 1000),
        BYBIT: makeBook('BYBIT', 810, 805, 1000),
      };

      const opps = findCrossExchangeArbitrage(books, 500, { network: 'BEP20' });
      expect(opps.length).toBeGreaterThan(0);

      const best = opps[0];
      expect(best.buyExchange).toBe('ELDORADO');
      expect(best.sellExchange).toBe('BINANCE');
      expect(best.buyPrice).toBe(800);
      expect(best.sellPrice).toBe(820);
      expect(best.grossSpreadPct).toBeCloseTo(2.5, 2);
      expect(best.netSpreadPct).toBeGreaterThan(1.5);
      expect(best.netProfitUsdt).toBeGreaterThan(5);
      expect(best.isViable).toBe(true);
    });

    it('deduce comisión de retiro de red correctamente (ej. TRC20 vs BEP20)', () => {
      const books = {
        BYBIT: makeBook('BYBIT', 800, 795, 1000),
        BINANCE: makeBook('BINANCE', 812, 810, 1000),
        ELDORADO: makeBook('ELDORADO', 815, 800, 1000),
      };

      const oppBep20 = findCrossExchangeArbitrage(books, 300, { network: 'BEP20' })[0];
      const oppTrc20 = findCrossExchangeArbitrage(books, 300, { network: 'TRC20' })[0];

      expect(oppBep20.withdrawalFeeUsdt).toBeLessThan(oppTrc20.withdrawalFeeUsdt);
      expect(oppBep20.netProfitUsdt).toBeGreaterThan(oppTrc20.netProfitUsdt);
    });

    it('descarta oportunidades con spread neto negativo tras comisiones', () => {
      const books = {
        BYBIT: makeBook('BYBIT', 800, 799, 1000),
        BINANCE: makeBook('BINANCE', 802, 801, 1000),
        ELDORADO: makeBook('ELDORADO', 805, 800, 1000),
      };

      const opps = findCrossExchangeArbitrage(books, 100, {
        network: 'TRC20',
        minNetSpreadPct: 0.5,
      });
      const viableOpps = opps.filter((o) => o.isViable);
      expect(viableOpps.length).toBe(0);
    });
  });
});
