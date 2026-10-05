import { Injectable, inject, signal } from '@angular/core';
import { NativeHttpService } from './native-http.service';
import {
  type SpotBookTicker,
  type DataSourceAvailability,
  parseSpotBookTicker,
  createActiveDataSource,
  createUnavailableDataSource,
} from '@p2p/core';

interface ElectronSpotBridge {
  fetchBinanceSpotTicker?: (symbol: string) => Promise<unknown>;
}

@Injectable({ providedIn: 'root' })
export class SpotMarketService {
  private readonly nativeHttp = inject(NativeHttpService, { optional: true });

  readonly bookTickers = signal<Map<string, SpotBookTicker>>(new Map());
  readonly availability = signal<DataSourceAvailability>(
    createUnavailableDataSource('Binance Spot', 'Feed spot no consultado todavía'),
  );
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly lastFetched = signal<Date | null>(null);

  /**
   * Fetches top-of-book for a Binance spot trading pair.
   * Priority:
   * 1. Desktop Electron IPC bridge (`electron.fetchBinanceSpotTicker`) to bypass browser CORS.
   * 2. Native mobile HTTP (`CapacitorHttp`) on Android/iOS to bypass WebView CORS without proxy.
   * 3. Direct public REST API fetch to `api.binance.com`.
   *
   * Fail-closed: returns `null` and marks availability as UNAVAILABLE if network fails or data is corrupted.
   * Never invents parity or fallback prices (Sin dato antes que dato inventado).
   */
  async fetchBookTicker(symbol = 'USDCUSDT'): Promise<SpotBookTicker | null> {
    const cleanSymbol = symbol.trim().toUpperCase();
    this.loading.set(true);
    this.error.set(null);

    try {
      let rawData: unknown = null;

      const bridge =
        typeof window !== 'undefined'
          ? (window as unknown as { electron?: ElectronSpotBridge })?.electron
          : null;

      if (bridge?.fetchBinanceSpotTicker) {
        rawData = await bridge.fetchBinanceSpotTicker(cleanSymbol);
      } else if (this.nativeHttp?.isNative) {
        const url = `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(cleanSymbol)}`;
        rawData = await this.nativeHttp.get(url, { timeoutMs: 8000 });
      } else {
        const url = `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(cleanSymbol)}`;
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          throw new Error(`Binance Spot API error: HTTP ${res.status}`);
        }
        rawData = await res.json();
      }

      const ticker = parseSpotBookTicker(rawData);
      if (!ticker) {
        throw new Error(`Respuesta de spot inválida o corrupta para ${cleanSymbol}`);
      }

      const updated = new Map(this.bookTickers());
      updated.set(cleanSymbol, ticker);
      this.bookTickers.set(updated);

      const now = new Date();
      this.lastFetched.set(now);
      this.availability.set(
        createActiveDataSource(`Binance Spot ${cleanSymbol}`, 'LIVE', now),
      );
      this.loading.set(false);
      return ticker;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.error.set(message);

      // Preserve cache if previously observed, else declare unavailable
      const cached = this.bookTickers().get(cleanSymbol);
      if (cached) {
        this.availability.set(
          createActiveDataSource(`Binance Spot ${cleanSymbol}`, 'CACHE', cached.timestamp),
        );
      } else {
        this.availability.set(
          createUnavailableDataSource(
            `Binance Spot ${cleanSymbol}`,
            `Error de conexión con libro Spot: ${message}`,
          ),
        );
      }

      this.loading.set(false);
      return cached ?? null;
    }
  }

  getTicker(symbol: string): SpotBookTicker | null {
    return this.bookTickers().get(symbol.trim().toUpperCase()) ?? null;
  }
}
