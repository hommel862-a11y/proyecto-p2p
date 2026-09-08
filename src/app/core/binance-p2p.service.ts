import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { computeMarketDepth, BINANCE_PAY_METHODS, type BinanceP2pMarketDepth } from '@p2p/core';

@Injectable({ providedIn: 'root' })
export class BinanceP2pService implements OnDestroy {
  private readonly toast = inject(ToastService);

  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly marketDepth = signal<BinanceP2pMarketDepth | null>(null);
  readonly selectedBank = signal<string>('ALL');
  readonly autoRefresh = signal<boolean>(false);
  readonly lastFetched = signal<Date | null>(null);

  /** Security policy: public third-party proxies are disabled by default */
  readonly usePublicCorsProxy = signal<boolean>(false);
  readonly customProxyUrl = signal<string>('');

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

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
    void this.fetchMarketDepth(asset, 'VES');
    this.refreshTimer = setInterval(() => {
      if (this.autoRefresh() && !this.loading()) {
        void this.fetchMarketDepth(asset, 'VES');
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

  async fetchMarketDepth(asset = 'USDT', fiat = 'VES'): Promise<BinanceP2pMarketDepth | null> {
    this.loading.set(true);
    this.error.set(null);

    const bankKey = this.selectedBank();
    const binanceMethod = BINANCE_PAY_METHODS[bankKey] || '';

    try {
      let buyData: unknown = null;
      let sellData: unknown = null;

      // Check if running in Electron with IPC bridge (Zero CORS, 100% direct & secure)
      const electronWin =
        typeof window !== 'undefined'
          ? (window as unknown as {
              electron?: {
                fetchBinanceP2p?: (p: unknown) => Promise<unknown>;
              };
            })
          : null;

      if (electronWin?.electron?.fetchBinanceP2p) {
        const [resBuy, resSell] = await Promise.all([
          electronWin.electron.fetchBinanceP2p({
            asset,
            fiat,
            tradeType: 'BUY',
            payTypes: binanceMethod ? [binanceMethod] : [],
            rows: 10,
          }),
          electronWin.electron.fetchBinanceP2p({
            asset,
            fiat,
            tradeType: 'SELL',
            payTypes: binanceMethod ? [binanceMethod] : [],
            rows: 10,
          }),
        ]);
        buyData = resBuy;
        sellData = resSell;
      } else {
        // Web browser environment
        const [resBuy, resSell] = await Promise.all([
          this.fetchViaWeb('BUY', asset, fiat, binanceMethod),
          this.fetchViaWeb('SELL', asset, fiat, binanceMethod),
        ]);
        buyData = resBuy;
        sellData = resSell;
      }

      const depth = computeMarketDepth(buyData, sellData, asset, fiat, binanceMethod);
      this.marketDepth.set(depth);
      this.lastFetched.set(new Date());

      return depth;
    } catch (err) {
      const msg = (err as Error).message || 'No se pudo conectar con Binance P2P';
      this.error.set(msg);
      this.toast.error(msg, 'Error Mercado Binance P2P');
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
  ): Promise<unknown> {
    const payload = {
      asset,
      fiat,
      tradeType,
      page: 1,
      rows: 10,
      payTypes: payType ? [payType] : [],
      countries: [],
      proMerchantAds: false,
      shieldMerchantAds: false,
      filterType: 'all',
      periods: [],
    };

    const targetUrl = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

    try {
      const resp = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) return await resp.json();
    } catch {
      // Direct fetch failed (likely browser CORS restriction)
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
    });

    if (!proxyResp.ok) {
      throw new Error('Servidor proxy P2P no disponible temporalmente.');
    }
    return await proxyResp.json();
  }
}
