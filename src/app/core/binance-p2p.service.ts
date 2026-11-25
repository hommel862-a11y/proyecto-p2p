import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { ToastService } from './toast.service';
import { NativeHttpService } from './native-http.service';
import { StorageService } from './storage';
import { MarketHistoryService } from './market-history.service';
import {
  computeMarketDepth,
  BINANCE_PAY_METHODS,
  type BinanceP2pMarketDepth,
  CircuitBreaker,
} from '@p2p/core';

export const BINANCE_DEPTH_SOURCES = {
  LIVE: 'LIVE',
  CACHE: 'CACHE',
} as const;

export type BinanceDepthSource = (typeof BINANCE_DEPTH_SOURCES)[keyof typeof BINANCE_DEPTH_SOURCES];

export const BINANCE_FRESHNESS_STATUS = {
  LIVE: 'LIVE',
  AGING: 'AGING',
  STALE: 'STALE',
  OFFLINE: 'OFFLINE',
} as const;

export type BinanceFreshnessStatus =
  (typeof BINANCE_FRESHNESS_STATUS)[keyof typeof BINANCE_FRESHNESS_STATUS];

export const BINANCE_DEPTH_LIVE_TTL_MS = 60_000;
export const BINANCE_DEPTH_AGING_TTL_MS = 180_000;
export const BINANCE_DEPTH_DISK_MAX_AGE_MS = 15 * 60_000;

export interface PersistedBinanceDepth {
  readonly depth: BinanceP2pMarketDepth;
  readonly fetchedAt: number;
}

export interface BinanceDepthFetch {
  readonly depth: BinanceP2pMarketDepth;
  readonly source: BinanceDepthSource;
  readonly fetchedAt: number;
  readonly freshness?: BinanceFreshnessStatus;
}

const LAST_DEPTH_KEY_PREFIX = 'p2p.binance.lastDepth';
const USE_PROXY_KEY = 'p2p.binance.usePublicCorsProxy';

function buildDiskDepthKey(asset: string, fiat: string, bankKey: string): string {
  const normAsset = (asset || 'USDT').toUpperCase();
  const normFiat = (fiat || 'VES').toUpperCase();
  const normBank = bankKey || 'ALL';
  return `${LAST_DEPTH_KEY_PREFIX}.${normAsset}.${normFiat}.${normBank}`;
}

function buildFlightKey(asset: string, fiat: string, bankKey: string): string {
  return `${(asset || 'USDT').toUpperCase()}:${(fiat || 'VES').toUpperCase()}:${bankKey || 'ALL'}`;
}

function isValidPersistedDepth(raw: unknown): raw is PersistedBinanceDepth {
  if (!raw || typeof raw !== 'object') return false;
  const candidate = raw as Partial<PersistedBinanceDepth>;
  return (
    typeof candidate.fetchedAt === 'number' &&
    Number.isFinite(candidate.fetchedAt) &&
    candidate.fetchedAt > 0 &&
    Boolean(candidate.depth && typeof candidate.depth === 'object')
  );
}

/**
 * Classifies market depth freshness honestly from real observation time and source.
 */
export function classifyBinanceDepthFreshness(
  fetchedAt: number | null,
  hasDepth: boolean,
  source: BinanceDepthSource | null,
  nowMs = Date.now(),
): BinanceFreshnessStatus {
  if (!hasDepth || fetchedAt === null || !Number.isFinite(fetchedAt)) {
    return BINANCE_FRESHNESS_STATUS.OFFLINE;
  }
  const ageMs = Math.max(0, nowMs - fetchedAt);
  if (ageMs >= BINANCE_DEPTH_AGING_TTL_MS) {
    return BINANCE_FRESHNESS_STATUS.STALE;
  }
  if (source === BINANCE_DEPTH_SOURCES.CACHE || ageMs >= BINANCE_DEPTH_LIVE_TTL_MS) {
    return BINANCE_FRESHNESS_STATUS.AGING;
  }
  return BINANCE_FRESHNESS_STATUS.LIVE;
}

@Injectable({ providedIn: 'root' })
export class BinanceP2pService implements OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly nativeHttp = inject(NativeHttpService, { optional: true });
  private readonly storage = inject(StorageService);
  private readonly marketHistory = inject(MarketHistoryService, { optional: true });

  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly selectedBank = signal<string>('ALL');
  readonly marketDepth = signal<BinanceP2pMarketDepth | null>(null);
  readonly autoRefresh = signal<boolean>(false);
  readonly lastFetched = signal<Date | null>(null);

  /** Security policy: public third-party proxies can be enabled in settings */
  readonly usePublicCorsProxy = signal<boolean>(
    this.storage.get<boolean>(USE_PROXY_KEY) ?? false,
  );
  readonly customProxyUrl = signal<string>('');

  readonly circuitBreaker = new CircuitBreaker({
    failureThreshold: 4,
    cooldownPeriodMs: 30_000,
    maxRetries: 1,
    baseDelayMs: 400,
  });

  private readonly depthCache = new Map<string, PersistedBinanceDepth>();
  private readonly inFlightFetches = new Map<string, Promise<BinanceDepthFetch | null>>();

  private readonly activeAsset = signal<string>('USDT');
  private readonly activeFiat = signal<string>('VES');
  private readonly activeFetchedAt = signal<number | null>(null);
  private readonly activeSource = signal<BinanceDepthSource | null>(null);
  private readonly freshnessTickMs = signal<number>(Date.now());

  readonly freshnessStatus = computed<BinanceFreshnessStatus>(() => {
    const depth = this.marketDepth();
    return classifyBinanceDepthFreshness(
      this.activeFetchedAt(),
      depth !== null,
      this.activeSource(),
      this.freshnessTickMs(),
    );
  });

  readonly depthAgeMs = computed<number | null>(() => {
    const at = this.activeFetchedAt();
    if (at === null || this.marketDepth() === null) return null;
    return Math.max(0, this.freshnessTickMs() - at);
  });

  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private freshnessTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.hydrateFromStorage('USDT', 'VES', this.selectedBank());
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.clearFreshnessTimer();
  }

  setBankFilter(bankKey: string): void {
    this.selectedBank.set(bankKey);
    const cached = this.getCachedEntry(this.activeAsset(), this.activeFiat(), bankKey);
    if (cached) {
      this.applyActiveDepth(cached.depth, cached.fetchedAt, BINANCE_DEPTH_SOURCES.CACHE);
    } else {
      this.clearActiveDepth();
    }
  }

  setUsePublicProxy(enabled: boolean): void {
    this.usePublicCorsProxy.set(enabled);
    this.storage.set(USE_PROXY_KEY, enabled);
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

  startAutoRefresh(intervalMs = 30000, asset = 'USDT', fiat = 'VES'): void {
    this.stopAutoRefresh();
    this.autoRefresh.set(true);
    if (typeof document === 'undefined' || !document.hidden) {
      void this.fetchMarketDepth(asset, fiat, true);
    }
    this.refreshTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.autoRefresh() && !this.loading()) {
        void this.fetchMarketDepth(asset, fiat, true);
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

  async fetchMarketDepth(
    asset = 'USDT',
    fiat = 'VES',
    silent = false,
  ): Promise<BinanceP2pMarketDepth | null> {
    const fetched = await this.fetchMarketDepthWithSource(asset, fiat, silent);
    return fetched?.depth ?? null;
  }

  async fetchMarketDepthWithSource(
    asset = 'USDT',
    fiat = 'VES',
    silent = false,
  ): Promise<BinanceDepthFetch | null> {
    const bankKey = this.selectedBank();
    const flightKey = buildFlightKey(asset, fiat, bankKey);
    const existingFlight = this.inFlightFetches.get(flightKey);
    if (existingFlight) {
      return existingFlight;
    }

    const fetchPromise = this.doFetchMarketDepthWithSource(asset, fiat, bankKey, silent);
    this.inFlightFetches.set(flightKey, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      if (this.inFlightFetches.get(flightKey) === fetchPromise) {
        this.inFlightFetches.delete(flightKey);
      }
    }
  }

  private async doFetchMarketDepthWithSource(
    asset: string,
    fiat: string,
    bankKey: string,
    silent: boolean,
  ): Promise<BinanceDepthFetch | null> {
    this.loading.set(true);
    this.error.set(null);
    this.activeAsset.set(asset);
    this.activeFiat.set(fiat);

    const binanceMethod = BINANCE_PAY_METHODS[bankKey] || '';
    const flightKey = buildFlightKey(asset, fiat, bankKey);

    try {
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
          const resBuy = await this.raceWithAbort(
            electronWin.electron.fetchBinanceP2p({
              asset,
              fiat,
              tradeType: 'BUY',
              payTypes: binanceMethod ? [binanceMethod] : [],
              rows: 20,
            }),
            signal,
          );
          await this.delayWithAbort(200, signal);
          const resSell = await this.raceWithAbort(
            electronWin.electron.fetchBinanceP2p({
              asset,
              fiat,
              tradeType: 'SELL',
              payTypes: binanceMethod ? [binanceMethod] : [],
              rows: 20,
            }),
            signal,
          );
          buyData = resBuy;
          sellData = resSell;
        } else {
          const resBuy = await this.fetchViaWeb('BUY', asset, fiat, binanceMethod, signal);
          await this.delayWithAbort(200, signal);
          const resSell = await this.fetchViaWeb('SELL', asset, fiat, binanceMethod, signal);
          buyData = resBuy;
          sellData = resSell;
        }

        observedAt = Date.now();
        return computeMarketDepth(buyData, sellData, asset, fiat, binanceMethod);
      };

      const cachedEntry = this.getCachedEntry(asset, fiat, bankKey);
      const fallbackHandler = cachedEntry
        ? (): BinanceP2pMarketDepth => {
            if (!silent) {
              this.toast.warn(
                'Usando profundidad de mercado en caché (circuito Binance en protección).',
                'Binance P2P',
              );
            }
            return cachedEntry.depth;
          }
        : undefined;

      const depth = await this.circuitBreaker.execute(executeNetworkCall, fallbackHandler);

      if (observedAt !== null) {
        const entry: PersistedBinanceDepth = { depth, fetchedAt: observedAt };
        this.depthCache.set(flightKey, entry);
        if (depth.bestBuyPrice > 0 && depth.bestSellPrice > 0) {
          this.persistToDisk(asset, fiat, bankKey, entry);
          this.recordMarketHistory(asset, bankKey, depth);
        }
        if (bankKey === this.selectedBank()) {
          this.applyActiveDepth(depth, observedAt, BINANCE_DEPTH_SOURCES.LIVE);
        }
        return {
          depth,
          source: BINANCE_DEPTH_SOURCES.LIVE,
          fetchedAt: observedAt,
          freshness: classifyBinanceDepthFreshness(
            observedAt,
            true,
            BINANCE_DEPTH_SOURCES.LIVE,
            observedAt,
          ),
        };
      }

      // Cache fallback path: preserve frozen observation timestamp, never stamp Date.now()
      const frozenAt = cachedEntry!.fetchedAt;
      if (bankKey === this.selectedBank()) {
        this.applyActiveDepth(depth, frozenAt, BINANCE_DEPTH_SOURCES.CACHE);
      }
      return {
        depth,
        source: BINANCE_DEPTH_SOURCES.CACHE,
        fetchedAt: frozenAt,
        freshness: classifyBinanceDepthFreshness(frozenAt, true, BINANCE_DEPTH_SOURCES.CACHE),
      };
    } catch (err) {
      const msg = (err as Error).message || 'No se pudo conectar con Binance P2P';
      this.error.set(msg);
      if (bankKey === this.selectedBank() && !this.getCachedEntry(asset, fiat, bankKey)) {
        this.clearActiveDepth();
      }
      if (!silent) {
        this.toast.error(msg, 'Error Mercado Binance P2P');
      }
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  private hydrateFromStorage(asset: string, fiat: string, bankKey: string): void {
    const entry = this.getCachedEntry(asset, fiat, bankKey);
    if (entry) {
      this.applyActiveDepth(entry.depth, entry.fetchedAt, BINANCE_DEPTH_SOURCES.CACHE);
    }
  }

  private getCachedEntry(asset: string, fiat: string, bankKey: string): PersistedBinanceDepth | null {
    const flightKey = buildFlightKey(asset, fiat, bankKey);
    const inMemory = this.depthCache.get(flightKey);
    if (inMemory) {
      return inMemory;
    }

    const diskKey = buildDiskDepthKey(asset, fiat, bankKey);
    try {
      const stored = this.storage.get<unknown>(diskKey);
      if (!isValidPersistedDepth(stored)) {
        return null;
      }
      const ageMs = Date.now() - stored.fetchedAt;
      if (!Number.isFinite(ageMs) || ageMs > BINANCE_DEPTH_DISK_MAX_AGE_MS) {
        this.storage.remove?.(diskKey);
        return null;
      }
      this.depthCache.set(flightKey, stored);
      return stored;
    } catch {
      return null;
    }
  }

  private persistToDisk(
    asset: string,
    fiat: string,
    bankKey: string,
    entry: PersistedBinanceDepth,
  ): void {
    try {
      this.storage.set(buildDiskDepthKey(asset, fiat, bankKey), entry);
    } catch {
      // Non-blocking storage fallback
    }
  }

  private recordMarketHistory(
    asset: string,
    bankKey: string,
    depth: BinanceP2pMarketDepth,
  ): void {
    if (!this.marketHistory) return;
    const pair: 'USDT' | 'EUR' = asset.toUpperCase() === 'EUR' ? 'EUR' : 'USDT';
    this.marketHistory.recordSnapshot({
      pair,
      bank: bankKey || 'ALL',
      bestBuyPrice: depth.bestBuyPrice,
      bestSellPrice: depth.bestSellPrice,
      spreadVes: depth.spreadVes,
      spreadPct: depth.spreadPct,
    });
  }

  private applyActiveDepth(
    depth: BinanceP2pMarketDepth,
    fetchedAt: number,
    source: BinanceDepthSource,
  ): void {
    this.marketDepth.set(depth);
    this.lastFetched.set(new Date(fetchedAt));
    this.activeFetchedAt.set(fetchedAt);
    this.activeSource.set(source);
    this.freshnessTickMs.set(Date.now());
    this.scheduleFreshnessTransition(fetchedAt);
  }

  private clearActiveDepth(): void {
    this.clearFreshnessTimer();
    this.marketDepth.set(null);
    this.lastFetched.set(null);
    this.activeFetchedAt.set(null);
    this.activeSource.set(null);
  }

  private clearFreshnessTimer(): void {
    if (this.freshnessTimer !== null) {
      clearTimeout(this.freshnessTimer);
      this.freshnessTimer = null;
    }
  }

  private scheduleFreshnessTransition(fetchedAt: number): void {
    this.clearFreshnessTimer();
    const ageMs = Math.max(0, Date.now() - fetchedAt);
    let nextDelayMs: number | null = null;
    if (ageMs < BINANCE_DEPTH_LIVE_TTL_MS) {
      nextDelayMs = BINANCE_DEPTH_LIVE_TTL_MS - ageMs + 1;
    } else if (ageMs < BINANCE_DEPTH_AGING_TTL_MS) {
      nextDelayMs = BINANCE_DEPTH_AGING_TTL_MS - ageMs + 1;
    }
    if (nextDelayMs === null) return;

    this.freshnessTimer = setTimeout(() => {
      this.freshnessTimer = null;
      this.freshnessTickMs.set(Date.now());
      this.scheduleFreshnessTransition(fetchedAt);
    }, nextDelayMs);
  }

  private createAbortError(): Error {
    return typeof DOMException !== 'undefined'
      ? new DOMException('The operation was aborted', 'AbortError')
      : new Error('Aborted');
  }

  private raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) {
      return Promise.reject(this.createAbortError());
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(this.createAbortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (err: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }

  private delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(this.createAbortError());
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(this.createAbortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async fetchViaWeb(
    tradeType: 'BUY' | 'SELL',
    asset: string,
    fiat: string,
    payType?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) {
      throw this.createAbortError();
    }

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
    } catch (err) {
      if (signal?.aborted) throw err;
    }

    if (signal?.aborted) {
      throw this.createAbortError();
    }

    // 2. Dev-server proxy (/api/binance-p2p) when running in browser under ng serve
    try {
      const devProxyResp = await fetch('/api/binance-p2p', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      if (devProxyResp.ok) return await devProxyResp.json();
    } catch (err) {
      if (signal?.aborted) throw err;
    }

    if (signal?.aborted) {
      throw this.createAbortError();
    }

    // 3. Fallback: local desktop app bridge
    try {
      const bridgeResp = await fetch('http://127.0.0.1:51857/api/binance/p2p', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      if (bridgeResp.ok) return await bridgeResp.json();
      if (bridgeResp.status === 429) {
        throw new Error('Binance P2P error: HTTP 429 (Rate limit)');
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof Error && err.message.includes('HTTP 429')) throw err;
    }

    if (signal?.aborted) {
      throw this.createAbortError();
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
