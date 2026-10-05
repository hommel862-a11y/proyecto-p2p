import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { NativeHttpService } from './native-http.service';
import {
  computeMarketDepth,
  BINANCE_PAY_METHODS,
  type BinanceP2pMarketDepth,
  CircuitBreaker,
} from '@p2p/core';

export type BinanceDepthSource = 'LIVE' | 'CACHE';

export interface BinanceDepthFetch {
  readonly depth: BinanceP2pMarketDepth;
  readonly source: BinanceDepthSource;
  readonly fetchedAt: number;
}

@Injectable({ providedIn: 'root' })
export class BinanceP2pService implements OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly nativeHttp = inject(NativeHttpService, { optional: true });

  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly marketDepth = signal<BinanceP2pMarketDepth | null>(null);
  readonly selectedBank = signal<string>('ALL');
  readonly autoRefresh = signal<boolean>(false);
  readonly lastFetched = signal<Date | null>(null);

  /** Security policy: public third-party proxies are disabled by default */
  readonly usePublicCorsProxy = signal<boolean>(false);
  readonly customProxyUrl = signal<string>('');

  readonly circuitBreaker = new CircuitBreaker({
    failureThreshold: 4,
    cooldownPeriodMs: 30_000,
    maxRetries: 1,
    baseDelayMs: 400,
  });

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Epoch ms de la última consulta que LLEGÓ a Binance. Un acierto de caché no
   * lo mueve: es la referencia para decir cuán viejo es realmente el libro que
   * se está re-sirviendo.
   *
   * Solo existe si hubo una consulta real, y el camino de caché exige haber
   * tenido una: la caché se puebla únicamente desde el camino de red.
   */
  private liveFetchedAt: number | null = null;

  ngOnDestroy(): void {
    this.stopAutoRefresh();
  }

  setBankFilter(bankKey: string): void {
    this.selectedBank.set(bankKey);
  }

  setUsePublicProxy(enabled: boolean): void {
    this.usePublicCorsProxy.set(enabled);
  }

  toggleAutoRefresh(): void {
    const next = !this.autoRefresh();
    this.autoRefresh.set(next);
    if (next) {
      this.startAutoRefresh(30000);
      this.toast.info('Actualización automática activada (cada 30s).', 'Binance P2P');
    } else {
      this.stopAutoRefresh();
      this.toast.info('Actualización automática pausada.', 'Binance P2P');
    }
  }

  startAutoRefresh(intervalMs = 30000, asset = 'USDT'): void {
    this.stopAutoRefresh();
    this.autoRefresh.set(true);
    void this.fetchMarketDepth(asset, 'VES', true);
    this.refreshTimer = setInterval(() => {
      if (this.autoRefresh() && !this.loading()) {
        void this.fetchMarketDepth(asset, 'VES', true);
      }
    }, intervalMs);
  }

  stopAutoRefresh(): void {
    this.autoRefresh.set(false);
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * La profundidad, pelada. Es lo que consumen las pantallas.
   *
   * Quien tenga que AUDITAR una decisión necesita además saber de dónde salió
   * el libro, y eso no se puede recuperar del objeto: el camino de caché
   * devuelve el mismo depth que ya estaba en el signal. Por eso existe
   * {@link fetchMarketDepthWithSource}, y por eso no se agrega el dato acá: las
   * pantallas no lo necesitan y `BinanceP2pMarketDepth` es un tipo de core que
   * además está vendorizado byte a byte.
   */
  async fetchMarketDepth(
    asset = 'USDT',
    fiat = 'VES',
    silent = false,
  ): Promise<BinanceP2pMarketDepth | null> {
    const fetched = await this.fetchMarketDepthWithSource(asset, fiat, silent);
    return fetched?.depth ?? null;
  }

  /** Promesa en vuelo activa para deduplicar ráfagas simultáneas del renderer */
  private inFlightFetch: Promise<BinanceDepthFetch | null> | null = null;

  /**
   * Igual que {@link fetchMarketDepth}, pero además declara la procedencia del
   * libro: recién observado (`LIVE`) o re-servido desde la caché (`CACHE`).
   *
   * El circuit breaker es el único que sabe cuál de los dos caminos se tomó, y
   * esa información se pierde en cuanto se devuelve el depth suelto. Acá se
   * captura antes de perderla. `fetchedAt` es el instante real de la
   * observación: la caché lo conserva congelado en vez de "refrescarlo".
   */
  async fetchMarketDepthWithSource(
    asset = 'USDT',
    fiat = 'VES',
    silent = false,
  ): Promise<BinanceDepthFetch | null> {
    if (this.inFlightFetch) {
      return this.inFlightFetch;
    }
    const fetchPromise = this.doFetchMarketDepthWithSource(asset, fiat, silent);
    this.inFlightFetch = fetchPromise;
    try {
      return await fetchPromise;
    } finally {
      this.inFlightFetch = null;
    }
  }

  private async doFetchMarketDepthWithSource(
    asset = 'USDT',
    fiat = 'VES',
    silent = false,
  ): Promise<BinanceDepthFetch | null> {
    this.loading.set(true);
    this.error.set(null);

    const bankKey = this.selectedBank();
    const binanceMethod = BINANCE_PAY_METHODS[bankKey] || '';

    try {
      /** Se llena SOLO cuando la respuesta llegó; un acierto de caché no lo toca. */
      let observedAt: number | null = null;

      const executeNetworkCall = async (signal: AbortSignal) => {
        let buyData: unknown;
        let sellData: unknown;

        const electronWin =
          typeof window !== 'undefined'
            ? (window as unknown as {
                electron?: {
                  fetchBinanceP2p?: (p: unknown) => Promise<unknown>;
                };
              })
            : null;

        if (electronWin?.electron?.fetchBinanceP2p) {
          const resBuy = await electronWin.electron.fetchBinanceP2p({
            asset,
            fiat,
            tradeType: 'BUY',
            payTypes: binanceMethod ? [binanceMethod] : [],
            rows: 20,
          });
          await new Promise((r) => setTimeout(r, 200));
          const resSell = await electronWin.electron.fetchBinanceP2p({
            asset,
            fiat,
            tradeType: 'SELL',
            payTypes: binanceMethod ? [binanceMethod] : [],
            rows: 20,
          });
          buyData = resBuy;
          sellData = resSell;
        } else {
          const resBuy = await this.fetchViaWeb('BUY', asset, fiat, binanceMethod, signal);
          await new Promise((r) => setTimeout(r, 200));
          const resSell = await this.fetchViaWeb('SELL', asset, fiat, binanceMethod, signal);
          buyData = resBuy;
          sellData = resSell;
        }

        // El libro quedó observado AHORA. Se marca antes de parsearlo porque lo
        // que importa es cuándo llegó la respuesta, no cuándo se procesó.
        observedAt = Date.now();
        return computeMarketDepth(buyData, sellData, asset, fiat, binanceMethod);
      };

      const cachedDepth = this.marketDepth();
      const fallbackHandler = cachedDepth
        ? (): BinanceP2pMarketDepth => {
            if (!silent) {
              this.toast.warn(
                'Usando profundidad de mercado en caché (circuito Binance en protección).',
                'Binance P2P',
              );
            }
            return cachedDepth;
          }
        : undefined;

      const depth = await this.circuitBreaker.execute(executeNetworkCall, fallbackHandler);
      if (observedAt !== null) {
        this.liveFetchedAt = observedAt;
      }
      this.marketDepth.set(depth);
      this.lastFetched.set(new Date());
      return {
        depth,
        source: observedAt === null ? 'CACHE' : 'LIVE',
        fetchedAt: observedAt ?? this.liveFetchedAt ?? Date.now(),
      };
    } catch (err) {
      const msg = (err as Error).message || 'No se pudo conectar con Binance P2P';
      this.error.set(msg);
      if (!silent) {
        this.toast.error(msg, 'Error Mercado Binance P2P');
      }
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchViaWeb(
    tradeType: 'BUY' | 'SELL',
    asset: string,
    fiat: string,
    payType?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const payload = {
      asset,
      fiat,
      tradeType,
      page: 1,
      rows: 20,
      payTypes: payType ? [payType] : [],
      countries: [],
      proMerchantAds: false,
      shieldMerchantAds: false,
      filterType: 'all',
      periods: [],
    };

    const targetUrl = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

    // 1. Direct native execution on mobile (Capacitor Android/iOS) without CORS, bridges or proxies
    if (this.nativeHttp?.isNative) {
      return await this.nativeHttp.post(targetUrl, payload, { signal });
    }

    try {
      const resp = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      if (resp.ok) return await resp.json();
    } catch {
      // Direct fetch failed (likely browser CORS restriction)
    }

    // Fallback: bridge local de la app de escritorio
    try {
      const bridgeResp = await fetch('http://127.0.0.1:51857/api/binance/p2p', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      if (bridgeResp.ok) return await bridgeResp.json();
    } catch {
      // Bridge not available: fall through to proxy or clear error
    }

    // Security check: Only route through proxy if explicitly configured or enabled
    let proxyUrl: string;
    if (this.customProxyUrl()) {
      proxyUrl = `${this.customProxyUrl()}?url=${encodeURIComponent(targetUrl)}`;
    } else if (this.usePublicCorsProxy()) {
      proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    } else {
      throw new Error(
        'La API pública de Binance restringe CORS en navegadores. Abre la aplicación de escritorio (Electron) para cotizaciones directas en vivo o activa un proxy en configuración.',
      );
    }

    const proxyResp = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    if (!proxyResp.ok) {
      throw new Error('Servidor proxy P2P no disponible temporalmente.');
    }
    return await proxyResp.json();
  }
}
