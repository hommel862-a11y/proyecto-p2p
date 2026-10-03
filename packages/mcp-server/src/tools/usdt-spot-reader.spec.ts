import { describe, it, expect, vi } from 'vitest';
import {
  parseBinanceUsdtSpot,
  parseKrakenUsdtSpot,
  fetchLiveUsdtSpotReading,
  BINANCE_SPOT_USDC_USDT_URL,
  KRAKEN_SPOT_USDT_USD_URL,
} from './usdt-spot-reader.js';

describe('usdt-spot-reader: parsing y feeds en vivo', () => {
  describe('parseBinanceUsdtSpot', () => {
    it('calcula la paridad inversa correctamente para USDC/USDT', () => {
      const parsed = parseBinanceUsdtSpot({ symbol: 'USDCUSDT', price: '1.00032000' });
      expect(parsed).toBeCloseTo(1 / 1.00032, 6);
    });

    it('devuelve null ante precio no finito, cero o negativo', () => {
      expect(parseBinanceUsdtSpot({ price: '0' })).toBeNull();
      expect(parseBinanceUsdtSpot({ price: '-1.0' })).toBeNull();
      expect(parseBinanceUsdtSpot({ price: 'invalid' })).toBeNull();
      expect(parseBinanceUsdtSpot(null)).toBeNull();
      expect(parseBinanceUsdtSpot({})).toBeNull();
    });
  });

  describe('parseKrakenUsdtSpot', () => {
    it('extrae el último precio operado (c[0]) para USDTZUSD', () => {
      const payload = {
        result: {
          USDTZUSD: {
            c: ['0.99960000', '40.41620000'],
          },
        },
      };
      expect(parseKrakenUsdtSpot(payload)).toBe(0.9996);
    });

    it('soporta la clave alternativa USDTUSD', () => {
      const payload = {
        result: {
          USDTUSD: {
            c: ['0.99975000'],
          },
        },
      };
      expect(parseKrakenUsdtSpot(payload)).toBe(0.99975);
    });

    it('devuelve null ante payload malformado o sin array c', () => {
      expect(parseKrakenUsdtSpot({})).toBeNull();
      expect(parseKrakenUsdtSpot({ result: {} })).toBeNull();
      expect(parseKrakenUsdtSpot({ result: { USDTZUSD: { c: [] } } })).toBeNull();
    });
  });

  describe('fetchLiveUsdtSpotReading', () => {
    it('prioriza Binance cuando responde 200 y es válido', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url === BINANCE_SPOT_USDC_USDT_URL) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ symbol: 'USDCUSDT', price: '1.00020000' }),
          } as unknown as Response);
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      const reading = await fetchLiveUsdtSpotReading(mockFetch as unknown as typeof fetch);
      expect(reading).not.toBeNull();
      expect(reading?.source).toBe('binance:spot:USDCUSDT');
      expect(reading?.price).toBeCloseTo(1 / 1.0002, 6);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('hace fallback a Kraken si Binance falla', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url === BINANCE_SPOT_USDC_USDT_URL) {
          return Promise.resolve({
            ok: false,
            status: 502,
          } as unknown as Response);
        }
        if (url === KRAKEN_SPOT_USDT_USD_URL) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: { USDTZUSD: { c: ['0.99950000'] } },
            }),
          } as unknown as Response);
        }
        return Promise.reject(new Error('Unexpected URL'));
      });

      const reading = await fetchLiveUsdtSpotReading(mockFetch as unknown as typeof fetch);
      expect(reading).not.toBeNull();
      expect(reading?.source).toBe('kraken:spot:USDTUSD');
      expect(reading?.price).toBe(0.9995);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('devuelve null sin inventar 1.000 si ambas fuentes fallan', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const reading = await fetchLiveUsdtSpotReading(mockFetch as unknown as typeof fetch);
      expect(reading).toBeNull();
    });
  });
});
