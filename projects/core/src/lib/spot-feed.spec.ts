import { describe, it, expect } from 'vitest';
import {
  CORE_SPOT_BASKET_SYMBOLS,
  parseSpotBookTicker,
  parseSpot24hTicker,
  parseSpot24hTickerBatch,
  parseSpotPrice,
  createUnavailableDataSource,
  createActiveDataSource,
} from './spot-feed';

describe('spot-feed: Modelos y Parser de Disponibilidad Spot', () => {
  describe('parseSpotBookTicker', () => {
    it('parsea correctamente un bookTicker válido de Binance Spot', () => {
      const raw = {
        symbol: 'USDCUSDT',
        bidPrice: '0.99980000',
        bidQty: '10000.50',
        askPrice: '1.00000000',
        askQty: '25000.00',
      };

      const parsed = parseSpotBookTicker(raw);
      expect(parsed).not.toBeNull();
      expect(parsed?.symbol).toBe('USDCUSDT');
      expect(parsed?.bidPrice).toBe(0.9998);
      expect(parsed?.askPrice).toBe(1.0);
      expect(parsed?.bidQty).toBe(10000.5);
      expect(parsed?.askQty).toBe(25000.0);
      expect(parsed?.midPrice).toBe(0.9999);
      expect(parsed?.spreadPct).toBeCloseTo(0.02, 2);
      expect(parsed?.timestamp).toBeTruthy();
    });

    it('retorna null cuando el ask es menor al bid (libro invertido o corrupto)', () => {
      const raw = {
        symbol: 'USDCUSDT',
        bidPrice: '1.0050',
        askPrice: '0.9990',
      };
      expect(parseSpotBookTicker(raw)).toBeNull();
    });

    it('retorna null con valores no finitos o negativos (fail-closed)', () => {
      expect(parseSpotBookTicker(null)).toBeNull();
      expect(parseSpotBookTicker({})).toBeNull();
      expect(parseSpotBookTicker({ symbol: 'USDCUSDT', bidPrice: '0', askPrice: '1.0' })).toBeNull();
      expect(parseSpotBookTicker({ symbol: 'USDCUSDT', bidPrice: '-1.0', askPrice: '1.0' })).toBeNull();
      expect(parseSpotBookTicker({ symbol: 'USDCUSDT', bidPrice: 'NaN', askPrice: '1.0' })).toBeNull();
      expect(parseSpotBookTicker({ symbol: '', bidPrice: '0.99', askPrice: '1.0' })).toBeNull();
    });
  });

  describe('parseSpotPrice', () => {
    it('parsea ticker/price correctamente', () => {
      const raw = { symbol: 'EURUSDT', price: '1.08500000' };
      const parsed = parseSpotPrice(raw);
      expect(parsed).not.toBeNull();
      expect(parsed?.symbol).toBe('EURUSDT');
      expect(parsed?.price).toBe(1.085);
    });

    it('retorna null ante payload corrupto', () => {
      expect(parseSpotPrice(null)).toBeNull();
      expect(parseSpotPrice({ symbol: 'EURUSDT', price: '0' })).toBeNull();
      expect(parseSpotPrice({ symbol: 'EURUSDT', price: '-5' })).toBeNull();
    });
  });

  describe('DataSourceAvailability', () => {
    it('crea descriptor UNAVAILABLE con razón explícita sin inventar datos', () => {
      const desc = createUnavailableDataSource(
        'Binance Spot USDCUSDT',
        'CORS blocked in browser and desktop bridge offline',
      );
      expect(desc.status).toBe('UNAVAILABLE');
      expect(desc.provenance).toBe('UNAVAILABLE');
      expect(desc.lastFetchedAt).toBeNull();
      expect(desc.reason).toContain('CORS blocked');
    });

    it('crea descriptor LIVE con procedencia y timestamp', () => {
      const date = new Date('2026-10-04T12:00:00Z');
      const desc = createActiveDataSource('Binance Spot USDCUSDT', 'LIVE', date);
      expect(desc.status).toBe('LIVE');
      expect(desc.provenance).toBe('LIVE_EXCHANGE_FEED');
      expect(desc.lastFetchedAt).toBe('2026-10-04T12:00:00.000Z');
    });

    it('crea descriptor CACHE con procedencia de caché', () => {
      const desc = createActiveDataSource('Binance Spot USDCUSDT', 'CACHE');
      expect(desc.status).toBe('CACHE');
      expect(desc.provenance).toBe('LOCAL_CACHE');
    });
  });

  describe('parseSpot24hTicker y parseSpot24hTickerBatch', () => {
    it('parsea un lote de /api/v3/ticker/24hr para BTCUSDT, SOLUSDT y USDCUSDT', () => {
      expect(CORE_SPOT_BASKET_SYMBOLS).toEqual(['BTCUSDT', 'SOLUSDT', 'USDCUSDT']);
      const rawBatch = [
        {
          symbol: 'BTCUSDT',
          bidPrice: '89990.00',
          bidQty: '1.2',
          askPrice: '90010.00',
          askQty: '0.8',
          lastPrice: '90000.00',
          priceChangePercent: '4.25',
          highPrice: '91200.00',
          lowPrice: '86000.00',
          volume: '15230.5',
          quoteVolume: '1365000000.0',
        },
        {
          symbol: 'SOLUSDT',
          bidPrice: '184.90',
          bidQty: '50.0',
          askPrice: '185.10',
          askQty: '45.0',
          lastPrice: '185.00',
          priceChangePercent: '-1.50',
          highPrice: '190.00',
          lowPrice: '180.00',
          volume: '950000',
          quoteVolume: '175750000',
        },
        {
          symbol: 'USDCUSDT',
          bidPrice: '0.9999',
          bidQty: '100000',
          askPrice: '1.0001',
          askQty: '120000',
          lastPrice: '1.0000',
          priceChangePercent: '0.01',
          highPrice: '1.0004',
          lowPrice: '0.9996',
          volume: '50000000',
          quoteVolume: '50000000',
        },
      ];

      const list = parseSpot24hTickerBatch(rawBatch);
      expect(list.length).toBe(3);
      const btc = list.find((t) => t.symbol === 'BTCUSDT');
      expect(btc?.lastPrice).toBe(90000);
      expect(btc?.priceChangePct24h).toBe(4.25);
      expect(btc?.highPrice24h).toBe(91200);
      expect(btc?.lowPrice24h).toBe(86000);

      const sol = list.find((t) => t.symbol === 'SOLUSDT');
      expect(sol?.lastPrice).toBe(185);
      expect(sol?.priceChangePct24h).toBe(-1.5);

      const usdc = list.find((t) => t.symbol === 'USDCUSDT');
      expect(usdc?.midPrice).toBe(1);
    });

    it('descarta entradas corruptas en el lote sin romper las válidas', () => {
      const list = parseSpot24hTickerBatch([
        { symbol: 'BTCUSDT', bidPrice: '90000', askPrice: '89000', lastPrice: '90000' }, // corrupto: ask < bid
        { symbol: 'SOLUSDT', bidPrice: '180', askPrice: '181', lastPrice: '180.5' },
      ]);
      expect(list.length).toBe(1);
      expect(list[0].symbol).toBe('SOLUSDT');
      expect(parseSpot24hTicker(null)).toBeNull();
    });
  });
});
