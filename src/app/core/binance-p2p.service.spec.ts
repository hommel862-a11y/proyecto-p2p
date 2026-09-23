import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BinanceP2pService } from './binance-p2p.service';
import { ToastService } from './toast.service';

const BINANCE_PAYLOAD = {
  code: '000000',
  data: [
    {
      adv: {
        price: '950.00',
        minSingleTransAmount: '100',
        maxSingleTransAmount: '5000',
      },
      advertiser: { nickName: 'Mercado' },
    },
  ],
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response;
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

    const injector = Injector.create({
      providers: [{ provide: ToastService, useValue: toast }, BinanceP2pService],
    });
    svc = injector.get(BinanceP2pService);
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['electron'];
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
    const fetchMock = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(BINANCE_PAYLOAD))
      .mockResolvedValueOnce(jsonResponse(BINANCE_PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchMarketDepth('USDT', 'VES', true);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const bridgeUrl = fetchMock.mock.calls[2][0] as string;
    expect(bridgeUrl).toBe('http://127.0.0.1:51857/api/binance/p2p');
    const buyInit = fetchMock.mock.calls[2][1] as RequestInit | undefined;
    expect(buyInit?.method).toBe('POST');
    const buyBody = JSON.parse(String(buyInit?.body)) as { tradeType: string };
    expect(buyBody.tradeType).toBe('BUY');
    const sellInit = fetchMock.mock.calls[3][1] as RequestInit | undefined;
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
  });
});