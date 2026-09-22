import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { CredentialStoreService } from './credential-store.service';
import { normalizeCotizaveRates, buildCotizaveHeaders, type CotizaveRate } from '@p2p/core';

@Injectable({ providedIn: 'root' })
export class CotizaveService implements OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly credentials = inject(CredentialStoreService);

  readonly apiKey = signal<string>('');
  readonly ratesByMarket = signal<Record<string, CotizaveRate>>({});
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly lastFetched = signal<Date | null>(null);
  readonly autoRefresh = signal<boolean>(false);

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    void this.hydrate();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
  }

  private async hydrate(): Promise<void> {
    const key = await this.credentials.getCotizaveApiKey();
    if (key) {
      this.apiKey.set(key);
      this.toast.info('API key Cotizave cargada desde almacenamiento seguro.', 'Cotizave');
    }
  }

  setApiKey(key: string): void {
    this.apiKey.set(key);
    void this.credentials.setCotizaveApiKey(key).catch(() => undefined);
    if (key) {
      this.toast.success('API key Cotizave guardada. Puedes sincronizar rates.', 'Cotizave');
    } else {
      this.toast.info('API key Cotizave eliminada.', 'Cotizave');
    }
  }

  async fetchRates(endpoint: 'rates' = 'rates'): Promise<void> {
    const key = this.apiKey();
    if (!key) {
      this.error.set('Introduce tu Cotizave API key para activar la triangulación');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      let data: unknown;

      const electronWin =
        typeof window !== 'undefined'
          ? (window as unknown as {
              electron?: {
                fetchCotizave?: (req: unknown) => Promise<unknown>;
              };
            })
          : null;

      if (electronWin?.electron?.fetchCotizave) {
        data = await electronWin.electron.fetchCotizave({ apiKey: key, endpoint });
      } else {
        data = await this.fetchRatesFromBrowser(endpoint, key);
      }

      const rates = normalizeCotizaveRates(data);
      this.ratesByMarket.set(rates);
      this.lastFetched.set(new Date());
    } catch (err) {
      const msg = (err as Error).message || 'No se pudo conectar con Cotizave';
      if (msg.includes('Failed to fetch') || msg.includes('CORS') || msg.includes('NetworkError')) {
        this.error.set(
          'Error de red/CORS al conectar con Cotizave. Abrí la app de escritorio (P2P Decision Tool) para que el navegador use su puente local de cotizaciones, o verificá tu conexión.',
        );
      } else {
        this.error.set(msg);
      }
      this.toast.error(msg, 'Error Cotizave');
    } finally {
      this.loading.set(false);
    }
  }

  startAutoRefresh(intervalMs = 300000): void {
    this.stopAutoRefresh();
    this.autoRefresh.set(true);
    void this.fetchRates();
    this.refreshTimer = setInterval(() => {
      if (this.autoRefresh()) {
        void this.fetchRates();
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
   * Camino navegador: primero intenta la API directa de Cotizave. Si el
   * navegador la bloquea (CORS/red, típicamente `Failed to fetch`), reintenta a
   * través del puente local que la app de escritorio expone en
   * http://127.0.0.1:51857/api/cotizave/:endpoint.
   */
  private async fetchRatesFromBrowser(endpoint: 'rates', key: string): Promise<unknown> {
    const url = `https://api.cotizave.com/v1/fx/${endpoint}`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: buildCotizaveHeaders(key),
      });
    } catch {
      return await this.fetchRatesViaLocalBridge(endpoint, key);
    }
    if (!resp.ok) {
      throw new Error(`Cotizave HTTP Error ${resp.status}`);
    }
    return await resp.json();
  }

  private async fetchRatesViaLocalBridge(endpoint: 'rates', key: string): Promise<unknown> {
    const bridgeUrl = `http://127.0.0.1:51857/api/cotizave/${endpoint}`;
    const bridgeResp = await fetch(bridgeUrl, {
      method: 'GET',
      headers: { 'x-api-key': key, Accept: 'application/json' },
    });
    if (!bridgeResp.ok) {
      throw new Error(`Cotizave bridge HTTP Error ${bridgeResp.status}`);
    }
    return await bridgeResp.json();
  }
}
