import { Injectable, computed, inject, signal } from '@angular/core';
import { NativeHttpService } from './native-http.service';
import {
  CORE_SPOT_BASKET_SYMBOLS,
  type SpotBookTicker,
  type Spot24hTicker,
  type DataSourceAvailability,
  parseSpotBookTicker,
  parseSpot24hTickerBatch,
  createActiveDataSource,
  createUnavailableDataSource,
} from '@p2p/core';

interface ElectronSpotBridge {
  fetchBinanceSpotTicker?: (symbol: string | readonly string[]) => Promise<unknown>;
}

@Injectable({ providedIn: 'root' })
export class SpotMarketService {
  private readonly nativeHttp = inject(NativeHttpService, { optional: true });
  private basketInFlight: Promise<Map<string, Spot24hTicker>> | null = null;

  readonly bookTickers = signal<Map<string, SpotBookTicker>>(new Map());
  readonly tickers24h = signal<Map<string, Spot24hTicker>>(new Map());
  readonly btcTicker = computed<Spot24hTicker | null>(
    () => this.tickers24h().get('BTCUSDT') ?? null,
  );
  readonly solTicker = computed<Spot24hTicker | null>(
    () => this.tickers24h().get('SOLUSDT') ?? null,
  );
  readonly usdcTicker = computed<Spot24hTicker | null>(
    () => this.tickers24h().get('USDCUSDT') ?? null,
  );
  readonly availability = signal<DataSourceAvailability>(
    createUnavailableDataSource('Binance Spot', 'Feed spot no consultado todavía'),
  );
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly lastFetched = signal<Date | null>(null);

  /**
   * Fetches 24h statistics and top-of-book for the core spot basket (`BTCUSDT`, `SOLUSDT`, `USDCUSDT`)
   * in a single batch HTTP/IPC call (`/api/v3/ticker/24hr?symbols=...`), populating both `tickers24h`
   * and `bookTickers`.
   */
  async fetchCoreBasket(
    symbols: readonly string[] = CORE_SPOT_BASKET_SYMBOLS,
  ): Promise<Map<string, Spot24hTicker>> {
    if (this.basketInFlight) {
      return this.basketInFlight;
    }

    const cleanSymbols = Array.from(
      new Set(
        symbols
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .map((s) => s.trim().toUpperCase()),
      ),
    );
    const targetSymbols = cleanSymbols.length > 0 ? cleanSymbols : [...CORE_SPOT_BASKET_SYMBOLS];

    const run = (async (): Promise<Map<string, Spot24hTicker>> => {
      this.loading.set(true);
      this.error.set(null);

      try {
        let rawData: unknown = null;
        const bridge =
          typeof window !== 'undefined'
            ? (window as unknown as { electron?: ElectronSpotBridge })?.electron
            : null;

        if (bridge?.fetchBinanceSpotTicker) {
          rawData = await bridge.fetchBinanceSpotTicker(targetSymbols);
        } else {
          const encoded = encodeURIComponent(JSON.stringify(targetSymbols));
          const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encoded}`;
          if (this.nativeHttp?.isNative) {
            rawData = await this.nativeHttp.get(url, { timeoutMs: 8000 });
          } else {
            const res = await fetch(url, {
              headers: { Accept: 'application/json' },
              signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) {
              throw new Error(`Binance Spot API error: HTTP ${res.status}`);
            }
            rawData = await res.json();
          }
        }

        const parsed = parseSpot24hTickerBatch(rawData);
        if (parsed.length === 0) {
          throw new Error('Respuesta de canasta spot inválida o vacía');
        }

        const next24h = new Map(this.tickers24h());
        const nextBook = new Map(this.bookTickers());
        for (const ticker of parsed) {
          next24h.set(ticker.symbol, ticker);
          nextBook.set(ticker.symbol, {
            symbol: ticker.symbol,
            bidPrice: ticker.bidPrice,
            askPrice: ticker.askPrice,
            midPrice: ticker.midPrice,
            spreadPct: ticker.spreadPct,
            timestamp: ticker.timestamp,
          });
        }
        this.tickers24h.set(next24h);
        this.bookTickers.set(nextBook);

        const now = new Date();
        this.lastFetched.set(now);
        this.availability.set(
          createActiveDataSource(`Binance Spot (${targetSymbols.join(', ')})`, 'LIVE', now),
        );
        this.loading.set(false);
        return next24h;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.error.set(message);

        const current = this.tickers24h();
        if (current.size > 0 && this.lastFetched()) {
          this.availability.set(
            createActiveDataSource(
              `Binance Spot (${targetSymbols.join(', ')})`,
              'CACHE',
              this.lastFetched()!,
            ),
          );
        } else {
          this.availability.set(
            createUnavailableDataSource(
              'Binance Spot',
              `Error de conexión con canasta Spot: ${message}`,
            ),
          );
        }

        this.loading.set(false);
        return current;
      } finally {
        this.basketInFlight = null;
      }
    })();

    this.basketInFlight = run;
    return run;
  }

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
