import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { CredentialStoreService } from './credential-store.service';
import { StorageService } from './storage';
import {
  normalizeCotizaveRates,
  buildCotizaveHeaders,
  type CotizaveRate,
  CircuitBreaker,
} from '@p2p/core';

/** Clave de persistencia de la caché de rates (convención `p2p.<dominio>.<sujeto>`). */
const RATES_STORAGE_KEY = 'p2p.cotizave.rates';

/** Sobre persistido: los rates y la marca del fetch que realmente los produjo. */
interface PersistedCotizaveRates {
  rates: Record<string, CotizaveRate>;
  fetchedAt: string;
}

/**
 * Causas de red/tiempo: el upstream no respondió. Son materialmente distintas
 * de una key inválida (401) o de un plan que no incluye el endpoint (403), y
 * por lo tanto merecen su propio mensaje.
 */
const NETWORK_CAUSE =
  /failed to fetch|networkerror|cors|fetch failed|enotfound|enoent|econnrefused|econnreset|ehostunreach|enetunreach|abort|timed? ?out|timeout|no accesible/i;

@Injectable({ providedIn: 'root' })
export class CotizaveService implements OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly credentials = inject(CredentialStoreService);
  private readonly storage = inject(StorageService);

  readonly apiKey = signal<string>('');
  readonly ratesByMarket = signal<Record<string, CotizaveRate>>({});
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly lastFetched = signal<Date | null>(null);
  readonly autoRefresh = signal<boolean>(false);

  readonly circuitBreaker = new CircuitBreaker({
    failureThreshold: 3,
    cooldownPeriodMs: 25_000,
    // El breaker tiene que durar MÁS que el transporte más lento: el handler
    // IPC de Electron aborta a los 15s (`AbortSignal.timeout(15000)`). Con el
    // default de 10s el breaker ganaba la carrera por 5 segundos y el fallback
    // corría con `lastError === null`, así que el diagnóstico real (401, 403,
    // red) se descartaba. 20s deja ganar al error del transporte.
    requestTimeoutMs: 20_000,
    maxRetries: 1,
    baseDelayMs: 300,
  });

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // `StorageService.get` es síncrono: la caché persistida se hidrata antes de
    // que nadie pueda observar un `ratesByMarket()` vacío. El `hydrate()` async
    // de la API key sigue su curso aparte.
    this.hydrateRatesFromStorage();
    void this.hydrate();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
  }

  /**
   * Restaura la última caché de rates desde almacenamiento. Es la única razón
   * por la que "sin caché previa" puede ser falso después de un reinicio.
   */
  private hydrateRatesFromStorage(): void {
    const persisted = this.readPersistedRates();
    if (!persisted || typeof persisted !== 'object') return;
    const rates = persisted.rates;
    if (!rates || typeof rates !== 'object' || Object.keys(rates).length === 0) return;
    this.ratesByMarket.set(rates as Record<string, CotizaveRate>);
    if (persisted.fetchedAt) {
      const at = new Date(persisted.fetchedAt);
      if (!Number.isNaN(at.getTime())) {
        this.lastFetched.set(at);
      }
    }
  }

  private readPersistedRates(): PersistedCotizaveRates | null {
    try {
      return this.storage.get<PersistedCotizaveRates>(RATES_STORAGE_KEY);
    } catch {
      // Un almacenamiento inaccesible no puede impedir que la app arranque.
      return null;
    }
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
      let lastError: unknown = null;
      const executeNetworkCall = async (signal: AbortSignal) => {
        try {
          const electronWin =
            typeof window !== 'undefined'
              ? (window as unknown as {
                  electron?: {
                    fetchCotizave?: (req: unknown) => Promise<unknown>;
                  };
                })
              : null;

          if (electronWin?.electron?.fetchCotizave) {
            return await electronWin.electron.fetchCotizave({ apiKey: key, endpoint });
          }
          return await this.fetchRatesFromBrowser(endpoint, key, signal);
        } catch (err) {
          lastError = err;
          throw err;
        }
      };

      let rates: Record<string, CotizaveRate>;
      // Estado del circuito ANTES de ejecutar: distingue "el breaker cortó la
      // llamada" (no hay diagnóstico posible) de "la llamada corrió y falló"
      // (el diagnóstico real está en `lastError`).
      const stateBefore = this.circuitBreaker.getState();
      let servedFromCache = false;

      const fallbackHandler = (): Record<string, CotizaveRate> => {
        const cached = this.ratesByMarket();
        if (cached && Object.keys(cached).length > 0) {
          // La edad va en el aviso: un dato viejo tiene que leerse viejo.
          this.toast.warn(
            `Usando cotizaciones cacheadas de ${this.formatCacheAge(this.lastFetched())} (circuito en protección).`,
            'Cotizave',
          );
          servedFromCache = true;
          return cached;
        }

        // Sin caché y con el circuito abierto: `execute()` ni siquiera invoca la
        // operación, así que no hay `lastError` que mostrar. La causa sí se
        // conoce — el intento anterior falló y el breaker está protegiendo.
        if (stateBefore === 'OPEN') {
          const cooldownS = Math.round(this.circuitBreaker.options.cooldownPeriodMs / 1000);
          throw new Error(
            `Circuito de Cotizave abierto: el intento anterior falló y el servicio quedó en protección por ${cooldownS} s. No se volvió a llamar a la API. Reintentá en un momento.`,
            { cause: lastError ?? undefined },
          );
        }

        const lastMsg = lastError instanceof Error ? lastError.message : '';
        if (lastMsg.includes('HTTP Error 401')) {
          throw new Error(
            'API key de Cotizave inválida o vencida (HTTP 401). Revisá tu key en Ajustes → API Keys.',
            { cause: lastError },
          );
        }
        if (lastMsg.includes('HTTP Error 403')) {
          throw new Error(
            'Cotizave rechazó el acceso (HTTP 403). Verificá que el plan de tu API key incluya el endpoint /v1/fx.',
            { cause: lastError },
          );
        }
        // Upstream inalcanzable: ni key ni plan son el problema.
        if (NETWORK_CAUSE.test(lastMsg)) {
          throw new Error(
            `Servidor Cotizave no accesible: ${lastMsg}. Puede ser tu conexión o la protección anti-bot de Cotizave. Reintentá en unos segundos.`,
            { cause: lastError },
          );
        }
        // Cualquier otra causa real se declara tal cual, nunca diluida en un genérico.
        if (lastMsg) {
          throw new Error(`Cotizave no disponible: ${lastMsg}`, { cause: lastError });
        }
        // Sin caché y sin diagnóstico: al menos decir qué hacer.
        throw new Error(
          'Cotizave no disponible y sin caché previa: el intento falló sin dejar diagnóstico. Reintentá en unos segundos o revisá tu conexión.',
          { cause: lastError ?? undefined },
        );
      };

      const result = await this.circuitBreaker.execute(executeNetworkCall, fallbackHandler);
      if (result && typeof result === 'object' && ('binance' in result || 'oficial' in result)) {
        rates = result as Record<string, CotizaveRate>;
      } else {
        rates = normalizeCotizaveRates(result);
      }

      // Un 200 con un payload que no normaliza a ninguna tasa NO es un éxito:
      // reportarlo como tal borraba la caché en silencio y convertía el
      // siguiente fallo en "sin caché previa" aunque una llamada anterior sí
      // había funcionado.
      if (Object.keys(rates).length === 0) {
        throw new Error(
          'Cotizave devolvió una respuesta sin datos reconocibles (HTTP 200 con payload inesperado). Se conserva la caché anterior.',
        );
      }

      if (!servedFromCache) {
        this.ratesByMarket.set(rates);
        const fetchedAt = new Date();
        this.lastFetched.set(fetchedAt);
        this.persistRates(rates, fetchedAt);
      }
      // Si vino del fallback, la app no se actualizó: solo se sirvió lo viejo.
      // `ratesByMarket` ya la tiene y `lastFetched` no se toca, para que la
      // antigüedad mostrada en el aviso no mienta.
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

  /** Persiste rates + marca de tiempo para que la caché sobreviva al reinicio. */
  private persistRates(rates: Record<string, CotizaveRate>, fetchedAt: Date): void {
    try {
      this.storage.set<PersistedCotizaveRates>(RATES_STORAGE_KEY, {
        rates,
        fetchedAt: fetchedAt.toISOString(),
      });
    } catch {
      // La persistencia es best-effort: una cuota llena no puede tirar abajo un
      // fetch que ya salió bien.
    }
  }

  /**
   * Edad de la caché en lenguaje llano ("hace 3 min", "hace 2 h", "hace 1 d").
   * La antigüedad es parte del diagnóstico, no un detalle decorativo.
   */
  private formatCacheAge(from: Date | null, now: number = Date.now()): string {
    if (!from || Number.isNaN(from.getTime())) return 'una sesión anterior';
    const ms = Math.max(0, now - from.getTime());
    if (ms < 60_000) return 'hace menos de 1 min';
    if (ms < 3_600_000) return `hace ${Math.floor(ms / 60_000)} min`;
    if (ms < 86_400_000) return `hace ${Math.floor(ms / 3_600_000)} h`;
    return `hace ${Math.floor(ms / 86_400_000)} d`;
  }

  /**
   * Camino navegador: primero intenta la API directa de Cotizave. Si el
   * navegador la bloquea (CORS/red, típicamente `Failed to fetch`), reintenta a
   * través del puente local que la app de escritorio expone en
   * http://127.0.0.1:51857/api/cotizave/:endpoint.
   */
  private async fetchRatesFromBrowser(
    endpoint: 'rates',
    key: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = `https://api.cotizave.com/v1/fx/${endpoint}`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: buildCotizaveHeaders(key),
        signal,
      });
    } catch {
      return await this.fetchRatesViaLocalBridge(endpoint, key, signal);
    }
    if (!resp.ok) {
      throw new Error(`Cotizave HTTP Error ${resp.status}`);
    }
    return await resp.json();
  }

  private async fetchRatesViaLocalBridge(
    endpoint: 'rates',
    key: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const bridgeUrl = `http://127.0.0.1:51857/api/cotizave/${endpoint}`;
    const bridgeResp = await fetch(bridgeUrl, {
      method: 'GET',
      headers: { 'x-api-key': key, Accept: 'application/json' },
      signal,
    });
    if (!bridgeResp.ok) {
      throw new Error(`Cotizave bridge HTTP Error ${bridgeResp.status}`);
    }
    return await bridgeResp.json();
  }
}
