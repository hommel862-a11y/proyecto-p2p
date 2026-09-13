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
        const url = `https://api.cotizave.com/v1/fx/${endpoint}`;
        const resp = await fetch(url, {
          method: 'GET',
          headers: buildCotizaveHeaders(key),
        });
        if (!resp.ok) {
          throw new Error(`Cotizave HTTP Error ${resp.status}`);
        }
        data = await resp.json();
      }

      const rates = normalizeCotizaveRates(data);
      this.ratesByMarket.set(rates);
      this.lastFetched.set(new Date());
    } catch (err) {
      const msg = (err as Error).message || 'No se pudo conectar con Cotizave';
      if (msg.includes('Failed to fetch') || msg.includes('CORS') || msg.includes('NetworkError')) {
        this.error.set(
          'Error de red/CORS. En navegador, usa la aplicación de escritorio (Electron) para Cotizave.',
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
}
