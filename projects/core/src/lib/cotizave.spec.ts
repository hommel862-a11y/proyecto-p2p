import { describe, it, expect } from 'vitest';
import {
  buildCotizaveHeaders,
  normalizeCotizaveRates,
  computeTriangulationGap,
  type CotizaveRate,
} from './cotizave';

describe('cotizave core', () => {
  describe('buildCotizaveHeaders', () => {
    it('returns correct headers', () => {
      const h = buildCotizaveHeaders('ctz_live_abc123');
      expect(h['X-API-Key']).toBe('ctz_live_abc123');
      expect(h['Accept']).toBe('application/json');
    });
  });

  describe('normalizeCotizaveRates', () => {
    const examplePayload = {
      country: 'VE',
      base: 'VES',
      fetched_at: '2025-01-15T12:00:00Z',
      rates: [
        { market: 'binance_p2p', type: 'p2p', ask: 36.5, bid: 35.8, mid: 36.15, updated_at: '2025-01-15T11:55:00Z' },
        { market: 'bybit_p2p', type: 'p2p', ask: 37.0, bid: 35.5 },
        { market: 'okx_p2p', type: 'p2p', ask: 36.8, bid: 35.9 },
        { market: 'bitget', type: 'p2p', ask: 36.2, bid: 35.4 },
        { market: 'forex', type: 'fiat', ask: 36.1, bid: 36.0 },
        { market: 'bcv', type: 'official', ask: 36.0 },
      ],
    };

    it('normalizes payload and maps aliases', () => {
      const result = normalizeCotizaveRates(examplePayload);
      expect(result['binance']).toBeDefined();
      expect(result['binance'].ask).toBe(36.5);
      expect(result['binance'].bid).toBe(35.8);
      expect(result['bybit']).toBeDefined();
      expect(result['bybit'].ask).toBe(37.0);
      expect(result['okx']).toBeDefined();
      expect(result['bitget']).toBeDefined();
    });

    it('ignores non-quote entries but keeps official anchors', () => {
      const result = normalizeCotizaveRates(examplePayload);
      // fiat/forex carries no usable p2p quote for this product
      expect(result['forex']).toBeUndefined();
      // official BCV anchor is now accepted
      expect(result['bcv']).toBeDefined();
      expect(result['bcv'].ask).toBe(36.0);
    });

    it('maps the real Cotizave reference/parallel payload', () => {
      const payload = {
        rates: [
          { market: 'reference', type: 'reference', base: 'USD', mid: 832.4883, updated_at: '2026-09-11T04:00:00Z' },
          { market: 'parallel', type: 'parallel', base: 'USD', mid: 952.405674, updated_at: '2026-09-13T21:01:44.648Z' },
          { market: 'binance', type: 'p2p', ask: 962.795, bid: 962.28, mid: 962.5375 },
        ],
      };
      const result = normalizeCotizaveRates(payload);
      expect(result['oficial']).toBeDefined();
      expect(result['oficial'].mid).toBe(832.4883);
      expect(result['parallel']).toBeDefined();
      expect(result['parallel'].mid).toBe(952.405674);
      expect(result['binance']).toBeDefined();
      expect(result['binance'].ask).toBe(962.795);
    });

    it('handles unknown/null payload gracefully', () => {
      expect(normalizeCotizaveRates(null)).toEqual({});
      expect(normalizeCotizaveRates(undefined)).toEqual({});
      expect(normalizeCotizaveRates('string')).toEqual({});
      expect(normalizeCotizaveRates({ rates: null })).toEqual({});
    });

    it('handles array payload', () => {
      const arr = [
        { market: 'mexc_p2p', type: 'p2p', ask: 38, bid: 34 },
      ];
      const result = normalizeCotizaveRates(arr);
      expect(result['mexc']).toBeDefined();
      expect(result['mexc'].ask).toBe(38);
    });

    it('skips entries without numeric ask/bid/mid', () => {
      const payload = {
        rates: [
          { market: 'bybit', type: 'p2p', ask: null, bid: 'not-a-number' },
          { market: 'okx', type: 'p2p', ask: 37, bid: 36 },
        ],
      };
      const result = normalizeCotizaveRates(payload);
      expect(result['bybit']).toBeUndefined();
      expect(result['okx']).toBeDefined();
    });
  });

  describe('computeTriangulationGap', () => {
    it('detects gap >= 2', () => {
      // binance.bid = 35.8 (price user pays on Binance)
      // other.ask = 38.0 (price user receives on other exchange)
      const { gapVes, gapPct } = computeTriangulationGap(
        { ask: 36.5, bid: 35.8 },
        { ask: 38.0, bid: 37.5 },
      );
      expect(gapVes).toBe(2.2);
      expect(gapPct).toBeCloseTo(6.15, 1);
    });

    it('returns null if binance bid missing', () => {
      const r = computeTriangulationGap({ ask: 36.5 }, { ask: 38, bid: 37 });
      expect(r.gapVes).toBeNull();
      expect(r.gapPct).toBeNull();
    });

    it('returns null if other ask missing', () => {
      const r = computeTriangulationGap({ ask: 36.5, bid: 35.8 }, { bid: 37 });
      expect(r.gapVes).toBeNull();
      expect(r.gapPct).toBeNull();
    });

    it('returns null if either is null input', () => {
      expect(computeTriangulationGap(null, { ask: 38, bid: 37 }).gapVes).toBeNull();
      expect(computeTriangulationGap({ ask: 36, bid: 35 }, null).gapVes).toBeNull();
      expect(computeTriangulationGap(null, null).gapVes).toBeNull();
    });

    it('returns negative gap when other.ask < binance.bid', () => {
      const { gapVes } = computeTriangulationGap(
        { ask: 36, bid: 37 },
        { ask: 35.5, bid: 35 },
      );
      expect(gapVes).toBe(-1.5);
    });
  });
});
