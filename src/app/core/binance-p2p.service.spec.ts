import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BinanceP2pService,
  BINANCE_DEPTH_AGING_TTL_MS,
  BINANCE_DEPTH_DISK_MAX_AGE_MS,
  BINANCE_DEPTH_LIVE_TTL_MS,
  type PersistedBinanceDepth,
} from './binance-p2p.service';
import { ToastService } from './toast.service';
import { StorageService } from './storage';
import { MarketHistoryService } from './market-history.service';
import { MemoryStorage } from './memory-storage';

const BINANCE_PAYLOAD = {
  code: '000000',
  data: [
    {
      adv: {
        advNo: 'adv-1',
        price: '950.00',
        minSingleTransAmount: '100',
        maxSingleTransAmount: '5000',
        tradeMethods: [{ tradeMethodName: 'Banesco' }, { tradeMethodName: 'Mercantil' }],
      },
      advertiser: { nickName: 'Mercado', monthOrderCount: 120, monthFinishRate: 0.99 },
    },
  ],
};

function payloadWithPrice(price: string, bank = 'Banesco') {
  return {
    code: '000000',
    data: [
      {
        adv: {
          advNo: `adv-${bank}`,
          price,
          minSingleTransAmount: '100',
          maxSingleTransAmount: '5000',
          tradeMethods: [{ tradeMethodName: bank }],
        },
        advertiser: { nickName: `Comerciante_${bank}`, monthOrderCount: 120, monthFinishRate: 0.99 },
      },
    ],
  };
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response;
}

function createInMemoryStorageMock(): {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  store: MemoryStorage;
} {
  const store = new MemoryStorage();
  return {
    store,
    get: vi.fn((key: string) => {
      const raw = store.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }),
    set: vi.fn((key: string, value: unknown) => {
      store.setItem(key, JSON.stringify(value));
    }),
    remove: vi.fn((key: string) => {
      store.removeItem(key);
    }),
  };
}

describe('BinanceP2pService', () => {
  let svc: BinanceP2pService;
  const toast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(() => {
    toast.success.mockReset();
    toast.info.mockReset();
    toast.error.mockReset();
    toast.warn.mockReset();

    delete (window as unknown as Record<string, unknown>)['electron'];

    const storageMock = {
      get: vi.fn(() => null),
      set: vi.fn(),
      remove: vi.fn(),
    };

    const injector = Injector.create({
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: StorageService, useValue: storageMock },
        BinanceP2pService,
      ],
    });
    svc = injector.get(BinanceP2pService);
  });

  afterEach(() => {
    svc.ngOnDestroy();
    delete (window as unknown as Record<string, unknown>)['electron'];
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches depth directly from p2p.binance.com when the browser allows it', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(BINANCE_PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchMarketDepth('USDT', 'VES', true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search');
    expect(svc.marketDepth()).not.toBeNull();
    expect(svc.marketDepth()?.bestBuyPrice).toBeGreaterThan(0);
    expect(svc.error()).toBeNull();
  });

  it('falls back to the local desktop bridge when direct Binance fetch is CORS-blocked', async () => {
    const fetchMock = vi.fn<FetchLike>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('p2p.binance.com') || url.includes('/api/binance-p2p')) {
        throw new TypeError('Failed to fetch');
      }
      if (url.includes('127.0.0.1:51857')) {
        return jsonResponse(BINANCE_PAYLOAD);
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchMarketDepth('USDT', 'VES', true);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const bridgeCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('127.0.0.1:51857/api/binance/p2p'),
    );
    expect(bridgeCalls).toHaveLength(2);
    const buyInit = bridgeCalls[0][1] as RequestInit | undefined;
    expect(buyInit?.method).toBe('POST');
    const buyBody = JSON.parse(String(buyInit?.body)) as { tradeType: string };
    expect(buyBody.tradeType).toBe('BUY');
    const sellInit = bridgeCalls[1][1] as RequestInit | undefined;
    const sellBody = JSON.parse(String(sellInit?.body)) as { tradeType: string };
    expect(sellBody.tradeType).toBe('SELL');
    expect(svc.marketDepth()?.bestBuyPrice).toBeGreaterThan(0);
    expect(svc.marketDepth()?.bestSellPrice).toBeGreaterThan(0);
    expect(svc.lastFetched()).not.toBeNull();
    expect(svc.error()).toBeNull();
  });

  it('reports the desktop-app hint when direct, bridge and proxy are all unavailable', async () => {
    const fetchMock = vi.fn<FetchLike>().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchMarketDepth('USDT', 'VES', true);

    expect(svc.marketDepth()).toBeNull();
    expect(svc.error()).toContain('escritorio');
    expect(svc.freshnessStatus()).toBe('OFFLINE');
    expect(svc.lastFetched()).toBeNull();
  });

  describe('procedencia de la profundidad', () => {
    it('marca LIVE cuando la respuesta viene de Binance', async () => {
      vi.stubGlobal('fetch', vi.fn<FetchLike>(async () => jsonResponse(BINANCE_PAYLOAD)));

      const result = await svc.fetchMarketDepthWithSource('USDT', 'VES', true);

      expect(result?.source).toBe('LIVE');
      expect(result?.depth.bestBuyPrice).toBeGreaterThan(0);
      expect(result?.fetchedAt).toBeGreaterThan(0);
      expect(svc.freshnessStatus()).toBe('LIVE');
    });

    it('marca CACHE y conserva cuándo se observó el libro, durante una caída', async () => {
      const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(BINANCE_PAYLOAD));
      vi.stubGlobal('fetch', fetchMock);

      const live = await svc.fetchMarketDepthWithSource('USDT', 'VES', true);
      expect(live?.source).toBe('LIVE');

      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      const cached = await svc.fetchMarketDepthWithSource('USDT', 'VES', true);

      expect(cached?.source).toBe('CACHE');
      expect(cached?.depth).toBe(live?.depth);
      expect(cached?.fetchedAt).toBe(live?.fetchedAt);
      expect(svc.lastFetched()?.getTime()).toBe(live?.fetchedAt);
    });

    it('sigue devolviendo el depth pelado por la API que ya usan las pantallas', async () => {
      vi.stubGlobal('fetch', vi.fn<FetchLike>(async () => jsonResponse(BINANCE_PAYLOAD)));

      const depth = await svc.fetchMarketDepth('USDT', 'VES', true);

      expect(depth).not.toBeNull();
      expect(depth?.bestSellPrice).toBeGreaterThan(0);
      expect(Object.keys(depth ?? {})).not.toContain('source');
    });
  });

  describe('keyed inFlight, keyed disk cache with TTL, MarketHistory, autoRefresh, and aborts', () => {
    it('keys inFlightFetch by (asset, fiat, bankKey) so distinct banks/pairs do not collide while identical ones deduplicate', async () => {
      const fetchMock = vi.fn<FetchLike>(async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { payTypes?: string[]; fiat?: string };
        const bank = body.payTypes?.[0] ?? 'ALL';
        const price = bank === 'Banesco' ? '960.00' : bank === 'Mercantil' ? '975.00' : '950.00';
        return jsonResponse(payloadWithPrice(price, bank));
      });
      vi.stubGlobal('fetch', fetchMock);

      svc.setBankFilter('BANESCO');
      const banescoPromise1 = svc.fetchMarketDepthWithSource('USDT', 'VES', true);
      const banescoPromise2 = svc.fetchMarketDepthWithSource('USDT', 'VES', true);

      svc.setBankFilter('MERCANTIL');
      const mercantilPromise = svc.fetchMarketDepthWithSource('USDT', 'VES', true);

      const [b1, b2, m1] = await Promise.all([banescoPromise1, banescoPromise2, mercantilPromise]);

      expect(b1).toBe(b2);
      expect(b1?.depth.bestBuyPrice).toBe(960);
      expect(m1?.depth.bestBuyPrice).toBe(975);
      // 2 calls for BANESCO (BUY+SELL deduplicated) + 2 calls for MERCANTIL = 4
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('persists disk cache keyed by (asset, fiat, bankKey) and enforces LIVE -> AGING -> STALE -> OFFLINE TTL', async () => {
      vi.useFakeTimers();
      const t0 = new Date('2026-11-18T12:00:00.000Z').getTime();
      vi.setSystemTime(t0);

      const storageMock = createInMemoryStorageMock();
      const injector = Injector.create({
        providers: [
          { provide: ToastService, useValue: toast },
          { provide: StorageService, useValue: storageMock },
          MarketHistoryService,
          BinanceP2pService,
        ],
      });
      const localSvc = injector.get(BinanceP2pService);
      const history = injector.get(MarketHistoryService);

      vi.stubGlobal('fetch', vi.fn<FetchLike>(async () => jsonResponse(payloadWithPrice('960.00', 'Banesco'))));

      localSvc.setBankFilter('BANESCO');
      const liveFetchPromise = localSvc.fetchMarketDepthWithSource('USDT', 'VES', true);
      await vi.advanceTimersByTimeAsync(250);
      await liveFetchPromise;

      expect(storageMock.set).toHaveBeenCalledWith(
        'p2p.binance.lastDepth.USDT.VES.BANESCO',
        expect.objectContaining({
          fetchedAt: expect.any(Number),
          depth: expect.objectContaining({ bestBuyPrice: 960 }),
        }),
      );
      expect(localSvc.freshnessStatus()).toBe('LIVE');
      expect(history.history().length).toBe(1);

      // Advance past LIVE TTL into AGING
      await vi.advanceTimersByTimeAsync(BINANCE_DEPTH_LIVE_TTL_MS + 5_000);
      expect(localSvc.freshnessStatus()).toBe('AGING');

      // Advance past AGING TTL into STALE
      await vi.advanceTimersByTimeAsync(BINANCE_DEPTH_AGING_TTL_MS);
      expect(localSvc.freshnessStatus()).toBe('STALE');

      // Switching to MERCANTIL (no cache) and failing stays OFFLINE without leaking BANESCO depth
      vi.stubGlobal('fetch', vi.fn<FetchLike>().mockRejectedValue(new TypeError('Failed to fetch')));
      localSvc.setBankFilter('MERCANTIL');
      const mercPromise = localSvc.fetchMarketDepthWithSource('USDT', 'VES', true);
      await vi.advanceTimersByTimeAsync(250);
      const mercResult = await mercPromise;
      expect(mercResult).toBeNull();
      expect(localSvc.freshnessStatus()).toBe('OFFLINE');
      expect(localSvc.marketDepth()).toBeNull();
      // Cache fallback / failed fetch never adds fake snapshots to MarketHistory
      expect(history.history().length).toBe(1);

      localSvc.ngOnDestroy();
      history.clearHistory();
    });

    it('hydrates valid keyed disk cache with frozen fetchedAt and discards expired disk cache (> max age)', () => {
      vi.useFakeTimers();
      const now = new Date('2026-11-18T12:00:00.000Z').getTime();
      vi.setSystemTime(now);

      const storageMock = createInMemoryStorageMock();
      const staleButUsableAt = now - (BINANCE_DEPTH_AGING_TTL_MS + 5_000);
      const persisted: PersistedBinanceDepth = {
        fetchedAt: staleButUsableAt,
        depth: {
          asset: 'USDT',
          fiat: 'VES',
          bestBuyPrice: 910,
          bestSellPrice: 930,
          spreadVes: 20,
          spreadPct: 2.2,
          buyOffers: [],
          sellOffers: [],
          updatedAt: new Date(staleButUsableAt).toISOString(),
        },
      };
      storageMock.store.setItem('p2p.binance.lastDepth.USDT.VES.ALL', JSON.stringify(persisted));

      const inj1 = Injector.create({
        providers: [
          { provide: ToastService, useValue: toast },
          { provide: StorageService, useValue: storageMock },
          BinanceP2pService,
        ],
      });
      const svc1 = inj1.get(BinanceP2pService);
      expect(svc1.marketDepth()?.bestBuyPrice).toBe(910);
      expect(svc1.lastFetched()?.getTime()).toBe(staleButUsableAt);
      expect(svc1.freshnessStatus()).toBe('STALE');
      svc1.ngOnDestroy();

      // Expired beyond BINANCE_DEPTH_DISK_MAX_AGE_MS -> discarded as OFFLINE
      const expiredAt = now - (BINANCE_DEPTH_DISK_MAX_AGE_MS + 10_000);
      storageMock.store.setItem(
        'p2p.binance.lastDepth.USDT.VES.ALL',
        JSON.stringify({ ...persisted, fetchedAt: expiredAt }),
      );
      const inj2 = Injector.create({
        providers: [
          { provide: ToastService, useValue: toast },
          { provide: StorageService, useValue: storageMock },
          BinanceP2pService,
        ],
      });
      const svc2 = inj2.get(BinanceP2pService);
      expect(svc2.marketDepth()).toBeNull();
      expect(svc2.lastFetched()).toBeNull();
      expect(svc2.freshnessStatus()).toBe('OFFLINE');
      svc2.ngOnDestroy();
    });

    it('supports fiat in startAutoRefresh and skips polling when document.hidden is true', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(BINANCE_PAYLOAD));
      vi.stubGlobal('fetch', fetchMock);

      const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
      svc.startAutoRefresh(5000, 'USDT', 'COP');
      await vi.advanceTimersByTimeAsync(250);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { fiat: string };
      expect(firstBody.fiat).toBe('COP');

      // Tab hidden -> skip polling cycle
      hiddenSpy.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Tab visible again -> polls normally with COP
      hiddenSpy.mockReturnValue(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);

      svc.stopAutoRefresh();
      hiddenSpy.mockRestore();
    });

    it('rethrows immediately on signal.aborted in fetchViaWeb without cascading through proxies', async () => {
      const fetchMock = vi.fn<FetchLike>(async (_url, init) => {
        const signal = init?.signal as AbortSignal | undefined;
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted', 'AbortError')),
            { once: true },
          );
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      vi.useFakeTimers();
      svc.circuitBreaker.options.requestTimeoutMs = 100;
      const promise = svc.fetchMarketDepthWithSource('USDT', 'VES', true);
      await vi.advanceTimersByTimeAsync(150);
      const res = await promise;

      expect(res).toBeNull();
      // Must NOT cascade to /api/binance-p2p or 127.0.0.1:51857 after abort
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('races Electron IPC calls cleanly against AbortSignal timeout', async () => {
      vi.useFakeTimers();
      const neverSettlingIpc = vi.fn(() => new Promise<unknown>(() => undefined));
      (window as unknown as { electron?: { fetchBinanceP2p: typeof neverSettlingIpc } }).electron = {
        fetchBinanceP2p: neverSettlingIpc,
      };

      svc.circuitBreaker.options.requestTimeoutMs = 100;
      const promise = svc.fetchMarketDepthWithSource('USDT', 'VES', true);
      await vi.advanceTimersByTimeAsync(150);
      const res = await promise;

      expect(res).toBeNull();
      expect(neverSettlingIpc).toHaveBeenCalledTimes(1);
      expect(svc.loading()).toBe(false);
    });
  });
});