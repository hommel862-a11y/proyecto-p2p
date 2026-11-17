import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SpotMarketService } from './spot-market.service';

const SPOT_PAYLOAD = {
  symbol: 'USDCUSDT',
  bidPrice: '0.99980000',
  bidQty: '10000.00',
  askPrice: '1.00000000',
  askQty: '20000.00',
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as unknown as Response;
}

describe('SpotMarketService', () => {
  let svc: SpotMarketService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SpotMarketService],
    });
    svc = TestBed.inject(SpotMarketService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('arranca con disponibilidad UNAVAILABLE antes de cualquier consulta', () => {
    expect(svc.availability().status).toBe('UNAVAILABLE');
    expect(svc.bookTickers().size).toBe(0);
    expect(svc.lastFetched()).toBeNull();
  });

  it('obtiene el ticker a través del puente Electron cuando está disponible', async () => {
    const fetchBinanceSpotTicker = vi.fn().mockResolvedValue(SPOT_PAYLOAD);
    vi.stubGlobal('window', {
      electron: { fetchBinanceSpotTicker },
    });

    const ticker = await svc.fetchBookTicker('USDCUSDT');

    expect(fetchBinanceSpotTicker).toHaveBeenCalledWith('USDCUSDT');
    expect(ticker).not.toBeNull();
    expect(ticker?.symbol).toBe('USDCUSDT');
    expect(ticker?.bidPrice).toBe(0.9998);
    expect(ticker?.askPrice).toBe(1.0);
    expect(ticker?.midPrice).toBe(0.9999);
    expect(svc.availability().status).toBe('LIVE');
    expect(svc.availability().provenance).toBe('LIVE_EXCHANGE_FEED');
    expect(svc.getTicker('USDCUSDT')).toEqual(ticker);
  });

  it('obtiene el ticker vía fetch web público cuando Electron no está disponible', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(SPOT_PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);

    const ticker = await svc.fetchBookTicker('USDCUSDT');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('bookTicker?symbol=USDCUSDT');
    expect(ticker?.symbol).toBe('USDCUSDT');
    expect(svc.availability().status).toBe('LIVE');
  });

  it('falla cerrado (UNAVAILABLE) ante error de red o timeout sin inventar precios', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn<FetchLike>().mockRejectedValue(new Error('Network offline'));
    vi.stubGlobal('fetch', fetchMock);

    const ticker = await svc.fetchBookTicker('USDCUSDT');

    expect(ticker).toBeNull();
    expect(svc.error()).toContain('Network offline');
    expect(svc.availability().status).toBe('UNAVAILABLE');
    expect(svc.availability().reason).toContain('Network offline');
  });

  it('degrada a CACHE con procedencia congelada si la red falla pero había lectura previa', async () => {
    const fetchBinanceSpotTicker = vi
      .fn()
      .mockResolvedValueOnce(SPOT_PAYLOAD)
      .mockRejectedValueOnce(new Error('Spot API down'));

    vi.stubGlobal('window', {
      electron: { fetchBinanceSpotTicker },
    });

    // 1st call: LIVE
    const liveTicker = await svc.fetchBookTicker('USDCUSDT');
    expect(svc.availability().status).toBe('LIVE');
    expect(liveTicker).not.toBeNull();

    // 2nd call: Falls back to cached ticker
    const cachedTicker = await svc.fetchBookTicker('USDCUSDT');
    expect(cachedTicker).toEqual(liveTicker);
    expect(svc.availability().status).toBe('CACHE');
    expect(svc.availability().provenance).toBe('LOCAL_CACHE');
  });

  it('consulta la canasta spot (BTCUSDT, SOLUSDT, USDCUSDT) en un solo batch y sincroniza bookTickers', async () => {
    const batchPayload = [
      {
        symbol: 'BTCUSDT',
        bidPrice: '89990.00',
        bidQty: '1.0',
        askPrice: '90010.00',
        askQty: '1.0',
        lastPrice: '90000.00',
        priceChangePercent: '3.10',
        highPrice: '91000.00',
        lowPrice: '87000.00',
        volume: '12000',
        quoteVolume: '1080000000',
      },
      {
        symbol: 'SOLUSDT',
        bidPrice: '184.50',
        bidQty: '20.0',
        askPrice: '185.50',
        askQty: '20.0',
        lastPrice: '185.00',
        priceChangePercent: '5.40',
        highPrice: '188.00',
        lowPrice: '175.00',
        volume: '450000',
        quoteVolume: '83250000',
      },
      {
        symbol: 'USDCUSDT',
        bidPrice: '0.9999',
        bidQty: '50000',
        askPrice: '1.0001',
        askQty: '50000',
        lastPrice: '1.0000',
        priceChangePercent: '0.00',
        highPrice: '1.0002',
        lowPrice: '0.9998',
        volume: '10000000',
        quoteVolume: '10000000',
      },
    ];

    const fetchBinanceSpotTicker = vi.fn().mockResolvedValue(batchPayload);
    vi.stubGlobal('window', {
      electron: { fetchBinanceSpotTicker },
    });

    const result = await svc.fetchCoreBasket();
    expect(fetchBinanceSpotTicker).toHaveBeenCalledWith(['BTCUSDT', 'SOLUSDT', 'USDCUSDT']);
    expect(result.size).toBe(3);
    expect(svc.btcTicker()?.lastPrice).toBe(90000);
    expect(svc.solTicker()?.lastPrice).toBe(185);
    expect(svc.usdcTicker()?.midPrice).toBe(1);
    expect(svc.getTicker('USDCUSDT')?.midPrice).toBe(1);
  });
});
