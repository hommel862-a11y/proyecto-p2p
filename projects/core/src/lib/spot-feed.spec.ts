import { describe, it, expect } from 'vitest';
import {
  parseSpotBookTicker,
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
});
