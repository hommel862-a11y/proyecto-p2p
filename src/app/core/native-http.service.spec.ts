import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NativeHttpService } from './native-http.service';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

vi.mock('@capacitor/core', () => {
  return {
    Capacitor: {
      isNativePlatform: vi.fn(() => false),
      getPlatform: vi.fn(() => 'web'),
    },
    CapacitorHttp: {
      request: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      patch: vi.fn(),
    },
  };
});

describe('NativeHttpService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to CapacitorHttp when isNative is true', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: { success: true, price: 950.5 },
      headers: {},
      url: 'https://p2p.binance.com/test',
    });

    const service = new NativeHttpService();
    expect(service.isNative).toBe(true);

    const result = await service.post<{ success: boolean; price: number }>(
      'https://p2p.binance.com/test',
      { asset: 'USDT' },
    );

    expect(result).toEqual({ success: true, price: 950.5 });
    expect(CapacitorHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://p2p.binance.com/test',
        method: 'POST',
        data: { asset: 'USDT' },
      }),
    );
  });

  it('throws error when native response status is not 2xx', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 403,
      data: { error: 'Forbidden' },
      headers: {},
      url: 'https://p2p.binance.com/test',
    });

    const service = new NativeHttpService();

    await expect(
      service.get('https://p2p.binance.com/test'),
    ).rejects.toThrow('Native HTTP Error 403');
  });

  it('delegates to global fetch when isNative is false', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rates: { bcv: 85.2 } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = new NativeHttpService();
    expect(service.isNative).toBe(false);

    const result = await service.get<{ rates: { bcv: number } }>(
      'https://api.cotizave.com/rates',
      { params: { asset: 'USD' } },
    );

    expect(result).toEqual({ rates: { bcv: 85.2 } });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cotizave.com/rates?asset=USD',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });
});
