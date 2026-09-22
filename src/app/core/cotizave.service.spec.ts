import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CotizaveService } from './cotizave.service';
import { CredentialStoreService } from './credential-store.service';
import { ToastService } from './toast.service';

const RATES_PAYLOAD = {
  country: 'VE',
  base: 'USD',
  rates: [
    { market: 'binance_p2p_ves', type: 'p2p', ask: 800, bid: 795 },
    { market: 'reference', type: 'reference', ask: 36.5, bid: 36.2 },
    { market: 'parallel', type: 'parallel', ask: 39.9, bid: 39.6 },
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

describe('CotizaveService', () => {
  let svc: CotizaveService;
  const toast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(async () => {
    toast.success.mockReset();
    toast.info.mockReset();
    toast.error.mockReset();
    toast.warn.mockReset();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: CredentialStoreService,
          useValue: {
            getCotizaveApiKey: vi.fn(async () => 'test-key'),
            setCotizaveApiKey: vi.fn(async () => undefined),
          },
        },
        { provide: ToastService, useValue: toast },
      ],
    });

    delete (window as unknown as Record<string, unknown>)['electron'];
    svc = TestBed.inject(CotizaveService);
    // hydrate() corre en el constructor; espera a que la key mockeada quede seteada.
    await vi.waitFor(() => expect(svc.apiKey()).toBe('test-key'));
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['electron'];
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('populates ratesByMarket and sets lastFetched when the direct fetch succeeds', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(RATES_PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchRates();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.cotizave.com/v1/fx/rates');
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.method).toBe('GET');
    const headers = init?.headers as unknown as Record<string, string> | undefined;
    expect(headers?.['X-API-Key']).toBe('test-key');
    expect(svc.ratesByMarket()['binance']).toBeDefined();
    expect(svc.ratesByMarket()['oficial']).toBeDefined();
    expect(svc.lastFetched()).not.toBeNull();
    expect(svc.error()).toBeNull();
    expect(svc.loading()).toBe(false);
  });

  it('falls back to the local bridge when the direct fetch is blocked by CORS', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(RATES_PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchRates();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:51857/api/cotizave/rates');
    const init = fetchMock.mock.calls[1][1] as RequestInit | undefined;
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({ 'x-api-key': 'test-key', Accept: 'application/json' });
    expect(svc.ratesByMarket()['binance']).toBeDefined();
    expect(svc.lastFetched()).not.toBeNull();
    expect(svc.error()).toBeNull();
  });

  it('reports an error and shows a toast when the direct fetch and the bridge both fail', async () => {
    const fetchMock = vi.fn<FetchLike>().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchRates();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(svc.loading()).toBe(false);
    expect(svc.error()).not.toBeNull();
    expect(svc.error()).toContain('Cotizave');
    expect(toast.error).toHaveBeenCalled();
  });
});
