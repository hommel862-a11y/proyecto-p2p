import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearBinanceOrderbookCacheForTesting,
  fetchLiveBinanceP2pOrderbook,
} from '../core/index.js';
import { getBinanceP2POrderbookTool } from './get_binance_p2p_orderbook.js';
import { recommendCompetitivePricingTool } from './recommend_competitive_pricing.js';
import { analyzeOrderbookPressureTool } from './analyze_orderbook_pressure.js';
import { AnalyzeOrderbookPressureInputSchema } from '../schemas/index.js';

interface MockBinanceLevel {
  advNo: string;
  merchant: string;
  price: number;
  availableCrypto: number;
  maxFiat?: number;
  finishRate?: number;
  orderCount?: number;
}

function buildBinanceC2cPayload(levels: MockBinanceLevel[], code = '000000') {
  return {
    code,
    success: code === '000000',
    data: levels.map((lvl) => ({
      adv: {
        advNo: lvl.advNo,
        price: String(lvl.price),
        surplusAmount: String(lvl.availableCrypto),
        minSingleTransAmount: '500',
        maxSingleTransAmount: String(lvl.maxFiat ?? Math.round(lvl.availableCrypto * lvl.price)),
      },
      advertiser: {
        nickName: lvl.merchant,
        monthFinishRate: lvl.finishRate ?? 0.99,
        monthOrderCount: lvl.orderCount ?? 250,
      },
    })),
  };
}

function makeOrderbookFetchMock(
  buySideMakersSelling: MockBinanceLevel[],
  sellSideMakersBuying: MockBinanceLevel[],
): ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { tradeType?: 'BUY' | 'SELL' };
    const payload =
      body.tradeType === 'BUY'
        ? buildBinanceC2cPayload(buySideMakersSelling)
        : buildBinanceC2cPayload(sellSideMakersBuying);
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as unknown as Response;
  });
}

describe('MCP Microstructure Live — sin mocks estáticos 79.2/79.8 ni 15000/12000', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearBinanceOrderbookCacheForTesting();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearBinanceOrderbookCacheForTesting();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('fetchLiveBinanceP2pOrderbook & get_binance_p2p_orderbook', () => {
    it('soporta hasta 20 filas, calcula bids/asks ordenados reales y respeta caché TTL de 15s por par', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));

      const asks: MockBinanceLevel[] = Array.from({ length: 20 }, (_, i) => ({
        advNo: `ASK-${i + 1}`,
        merchant: `AskMerchant_${i + 1}`,
        price: Number((90.1 + i * 0.05).toFixed(2)),
        availableCrypto: 1000,
      }));
      const bids: MockBinanceLevel[] = Array.from({ length: 20 }, (_, i) => ({
        advNo: `BID-${i + 1}`,
        merchant: `BidMerchant_${i + 1}`,
        price: Number((88.9 - i * 0.05).toFixed(2)),
        availableCrypto: 800,
      }));

      const fetchMock = makeOrderbookFetchMock(asks, bids);

      const first = await fetchLiveBinanceP2pOrderbook({
        fiat: 'VES',
        asset: 'USDT',
        rows: 20,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      expect(first.provenance).toBe('LIVE');
      expect(first.actionable).toBe(true);
      expect(first.topBuyPrice).toBe(88.9);
      expect(first.topSellPrice).toBe(90.1);
      expect(first.spreadVes).toBe(1.2);
      expect(first.buyOffers).toHaveLength(20);
      expect(first.sellOffers).toHaveLength(20);
      expect(first.totalBuyDepthUsdt).toBe(16000);
      expect(first.totalSellDepthUsdt).toBe(20000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Within 15s TTL -> served from cache without hitting network
      vi.advanceTimersByTime(10_000);
      const cached = await fetchLiveBinanceP2pOrderbook({
        fiat: 'VES',
        asset: 'USDT',
        rows: 5,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      expect(cached.provenance).toBe('CACHE');
      expect(cached.buyOffers).toHaveLength(5);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Past 15s TTL -> re-fetches live
      vi.advanceTimersByTime(6_000);
      const refreshed = await fetchLiveBinanceP2pOrderbook({
        fiat: 'VES',
        asset: 'USDT',
        rows: 10,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      expect(refreshed.provenance).toBe('LIVE');
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('falla cerrado con UNAVAILABLE cuando está offline o HTTP falla — nunca fabrica 79.2/79.8', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;

      const res = await getBinanceP2POrderbookTool.execute({
        fiat: 'VES',
        asset: 'USDT',
        rows: 10,
      });

      expect(res.provenance).toBe('UNAVAILABLE');
      expect(res.actionable).toBe(false);
      expect(res.marketStatus).toBe('UNAVAILABLE');
      expect(res.topBuyPrice).toBeNull();
      expect(res.topSellPrice).toBeNull();
      expect(res.spreadVes).toBeNull();
      expect(res.buyOffers).toEqual([]);
      expect(res.sellOffers).toEqual([]);

      const serialized = JSON.stringify(res);
      expect(serialized).not.toContain('79.2');
      expect(serialized).not.toContain('79.8');
      expect(serialized).not.toContain('OroVerde_Express');
      expect(serialized).not.toContain('CriptoMaracaibo');
    });

    it('no cachea respuestas Binance con código de error aplicativo', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ code: '000002', data: null }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ code: '000002', data: null }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () =>
            buildBinanceC2cPayload([{ advNo: 'a1', merchant: 'M1', price: 91.0, availableCrypto: 500 }]),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () =>
            buildBinanceC2cPayload([{ advNo: 'b1', merchant: 'M2', price: 89.5, availableCrypto: 500 }]),
        });

      const failed = await fetchLiveBinanceP2pOrderbook({
        fiat: 'VES',
        asset: 'USDT',
        rows: 5,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      expect(failed.provenance).toBe('UNAVAILABLE');

      const recovered = await fetchLiveBinanceP2pOrderbook({
        fiat: 'VES',
        asset: 'USDT',
        rows: 5,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      expect(recovered.provenance).toBe('LIVE');
      expect(recovered.topBuyPrice).toBe(89.5);
      expect(recovered.topSellPrice).toBe(91.0);
    });
  });

  describe('recommend_competitive_pricing', () => {
    it('usa niveles reales del libro vivo para TOP_1, TOP_2, TOP_3 y MATCH respetando breakEvenPrice', async () => {
      const asks: MockBinanceLevel[] = [
        { advNo: 's1', merchant: 'Ask1', price: 91.0, availableCrypto: 1000 },
        { advNo: 's2', merchant: 'Ask2', price: 91.2, availableCrypto: 1000 },
        { advNo: 's3', merchant: 'Ask3', price: 91.5, availableCrypto: 1000 },
      ];
      const bids: MockBinanceLevel[] = [
        { advNo: 'b1', merchant: 'Bid1', price: 89.5, availableCrypto: 1000 },
        { advNo: 'b2', merchant: 'Bid2', price: 89.3, availableCrypto: 1000 },
        { advNo: 'b3', merchant: 'Bid3', price: 89.0, availableCrypto: 1000 },
      ];
      globalThis.fetch = makeOrderbookFetchMock(asks, bids) as unknown as typeof fetch;

      const buyTop2 = await recommendCompetitivePricingTool.execute({
        side: 'BUY',
        strategy: 'TOP_2',
        stepVes: 0.05,
        targetMarginPct: 1.0,
      });
      expect(buyTop2.provenance).toBe('LIVE');
      expect(buyTop2.competitorPrice).toBe(89.3);
      expect(buyTop2.suggestedPrice).toBe(89.35);
      expect(buyTop2.isWithinSafeBoundaries).toBe(true);

      const sellMatch = await recommendCompetitivePricingTool.execute({
        side: 'SELL',
        strategy: 'MATCH',
        stepVes: 0.05,
        targetMarginPct: 1.0,
      });
      expect(sellMatch.competitorPrice).toBe(91.0);
      expect(sellMatch.suggestedPrice).toBe(91.0);

      const sellClamped = await recommendCompetitivePricingTool.execute({
        side: 'SELL',
        strategy: 'TOP_3',
        stepVes: 0.05,
        targetMarginPct: 1.0,
        breakEvenPrice: 92.0,
      });
      expect(sellClamped.competitorPrice).toBe(91.5);
      expect(sellClamped.suggestedPrice).toBe(92.0);
      expect(sellClamped.isWithinSafeBoundaries).toBe(false);
    });

    it('declara UNAVAILABLE cuando no hay libro en vivo ni currentMarketMid', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch;

      const res = await recommendCompetitivePricingTool.execute({
        side: 'SELL',
        strategy: 'TOP_1',
        stepVes: 0.05,
        targetMarginPct: 1.0,
      });

      expect(res.provenance).toBe('UNAVAILABLE');
      expect(res.actionable).toBe(false);
      expect(res.suggestedPrice).toBeNull();
      expect(res.competitorPrice).toBeNull();
      expect(JSON.stringify(res)).not.toContain('79.2');
      expect(JSON.stringify(res)).not.toContain('79.8');
    });

    it('usa currentMarketMid cuando no hay libro en vivo pero sí mid explícito', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch;

      const res = await recommendCompetitivePricingTool.execute({
        side: 'BUY',
        strategy: 'TOP_1',
        stepVes: 0.05,
        targetMarginPct: 1.5,
        currentMarketMid: 100.0,
      });

      expect(res.provenance).toBe('CALLER_MID_FALLBACK');
      expect(res.actionable).toBe(true);
      expect(res.competitorPrice).toBeNull();
      expect(res.suggestedPrice).toBe(98.5);
    });
  });

  describe('analyze_orderbook_pressure', () => {
    it('el schema NO inyecta 15000 ni 12000 por defecto cuando se omiten profundidades', () => {
      const parsed = AnalyzeOrderbookPressureInputSchema.parse({ fiat: 'VES' });
      expect(parsed.bidDepthUsdt).toBeUndefined();
      expect(parsed.askDepthUsdt).toBeUndefined();
    });

    it('retorna tanto obiRatio [-1,+1] como orderbookImbalanceRatio [0,1] y telemetría real de gaps/spoof desde libro en vivo', async () => {
      const asks: MockBinanceLevel[] = [
        { advNo: 'a1', merchant: 'Ask1', price: 90.0, availableCrypto: 1000, finishRate: 0.99, orderCount: 150 },
        { advNo: 'a2', merchant: 'Ask2', price: 91.2, availableCrypto: 1000, finishRate: 0.99, orderCount: 120 }, // >1.3% gap
      ];
      const bids: MockBinanceLevel[] = [
        { advNo: 'b1', merchant: 'BidBait', price: 89.0, availableCrypto: 8000, finishRate: 0.6, orderCount: 5 },
        { advNo: 'b2', merchant: 'Bid2', price: 88.8, availableCrypto: 1000, finishRate: 0.98, orderCount: 200 },
      ];
      globalThis.fetch = makeOrderbookFetchMock(asks, bids) as unknown as typeof fetch;

      const parsed = AnalyzeOrderbookPressureInputSchema.parse({ fiat: 'VES', includeSpoofCheck: true });
      const res = await analyzeOrderbookPressureTool.execute(parsed);

      expect(res.provenance).toBe('LIVE');
      expect(res.actionable).toBe(true);
      expect(res.bidDepthUsdt).toBe(9000);
      expect(res.askDepthUsdt).toBe(2000);
      expect(res.orderbookImbalanceRatio).toBeCloseTo(9000 / 11000, 3);
      expect(res.obiRatio).toBeCloseTo((9000 - 2000) / 11000, 3);
      expect(res.obiRatio).toBeGreaterThanOrEqual(-1);
      expect(res.obiRatio).toBeLessThanOrEqual(1);
      expect(res.liquidityGaps.length).toBeGreaterThanOrEqual(1);
      expect(res.suspiciousOffersCount).toBeGreaterThanOrEqual(1);
      expect(res.phantomLiquidityDetected).toBe(true);
    });

    it('falla cerrado con UNAVAILABLE cuando se omiten profundidades y el feed en vivo está caído', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch;

      const parsed = AnalyzeOrderbookPressureInputSchema.parse({ fiat: 'VES' });
      const res = await analyzeOrderbookPressureTool.execute(parsed);

      expect(res.provenance).toBe('UNAVAILABLE');
      expect(res.actionable).toBe(false);
      expect(res.bidDepthUsdt).toBeNull();
      expect(res.askDepthUsdt).toBeNull();
      expect(res.obiRatio).toBeNull();
      expect(res.orderbookImbalanceRatio).toBeNull();
      expect(res.marketRegime).toBe('UNAVAILABLE');
      expect(JSON.stringify(res)).not.toContain('15000');
      expect(JSON.stringify(res)).not.toContain('12000');
    });
  });
});
