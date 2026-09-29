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
 * Antigüedad máxima con la que una caché de Cotizave puede alimentar la app: 15 minutos.
 *
 * POR QUÉ 15 MIN Y NO MÁS: el spread P2P se mueve de forma continua. Una brecha
 * medida hace 20 minutos ya no describe el mercado que el operador está por
 * operar, así que ese dato NO puede entrar en una decisión de trade aunque la app
 * tenga algo guardado. La tasa oficial/referencia recibe deliberadamente el mismo
 * límite estricto en lugar de que sirva de coartada para justificar una brecha de
 * un día de antigüedad: si la referencia fuera más laxa, la brecha mediría dos
 * momentos distintos y el número mentiría aunque cada parte por separado pareciera
 * defendible. 15 min cubre un ciclo de sincronización con margen y descarta todo
 * lo que no se pueda defender frente a un operador.
 */
export const COTIZAVE_CACHE_MAX_AGE_MS = 15 * 60_000;

/**
 * De dónde vinieron los rates que hoy están en `ratesByMarket()`. Sin esto, un
 * dato restaurado del disco es indistinguible de uno descargado hace 3 segundos,
 * y el consumidor no tiene forma de ser honesto con el operador.
 *
 * - `none`: no hay rates.
 * - `live`: salieron de una llamada de red de esta sesión.
 * - `restored`: salieron del almacenamiento al arrancar, dentro del TTL.
 *
 * El camino de fallback (circuito abierto con caché en memoria) NO cambia este
 * valor a propósito: cambia cómo llegaron los rates, no de dónde salieron.
 */
export type CotizaveRatesProvenance = 'none' | 'live' | 'restored';

/**
 * Causas de red/tiempo: el upstream no respondió. Son materialmente distintas
 * de una key inválida (401) o de un plan que no incluye el endpoint (403), y
 * por lo tanto merecen su propio mensaje.
 */
const NETWORK_CAUSE =
  /failed to fetch|networkerror|cors|fetch failed|enotfound|enoent|econnrefused|econnreset|ehostunreach|enetunreach|abort|timed? ?out|timeout|no accesible/i;

/**
 * Diagnóstico que el servicio YA clasificó. La causa real viaja dentro del
 * mensaje, así que el `catch` de `fetchRates()` no puede reemplazarlo por un
 * texto genérico: el error de red embebido ("Failed to fetch") no es lo mismo
 * que un `TypeError('Failed to fetch')` crudo, y confundirlos es exactamente el
 * enmascaramiento que este servicio existe para evitar.
 */
class CotizaveDiagnosisError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'CotizaveDiagnosisError';
  }
}

/**
 * Un 200 cuyo payload no normaliza a ninguna tasa. No es un problema de red ni
 * de credenciales: el contrato del upstream se rompió, así que se distingue del
 * resto de los fallos. Ese matiz importa porque la caché anterior sigue siendo
 * válida — hay que reportar el contrato roto, no disfrazarlo de "el circuito
 * está protegiendo el servicio".
 */
class CotizaveEmptyPayloadError extends Error {
  constructor() {
    super(
      'Cotizave devolvió una respuesta sin datos reconocibles (HTTP 200 con payload inesperado). Se conserva la caché anterior.',
    );
    this.name = 'CotizaveEmptyPayloadError';
  }
}

/**
 * Edad de un dato de Cotizave en lenguaje llano ("hace 3 min", "hace 2 h",
 * "hace 1 d"). Exportado porque el dashboard, la三角ulación y el worker de
 * Telegram muestran tasas de Cotizave: la antigüedad es parte del diagnóstico
 * en las tres superficies, y una sola implementación evita que cada consumidor
 * invente su propia escala.
 */
export function formatCotizaveDataAge(
  from: Date | null | undefined,
  now: number = Date.now(),
): string {
  if (!from || Number.isNaN(new Date(from).getTime())) return 'una sesión anterior';
  const ms = Math.max(0, now - new Date(from).getTime());
  if (ms < 60_000) return 'hace menos de 1 min';
  if (ms < 3_600_000) return `hace ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `hace ${Math.floor(ms / 3_600_000)} h`;
  return `hace ${Math.floor(ms / 86_400_000)} d`;
}

/**
 * Traduce la procedencia a texto para el operador. Vive acá y no en cada
 * consumidor porque "restaurado" tiene que significar lo mismo en el panel, en
 * Telegram y en el snapshot de mercado.
 */
export function describeCotizaveProvenance(provenance: CotizaveRatesProvenance): string {
  switch (provenance) {
    case 'live':
      return 'Cotizave en vivo';
    case 'restored':
      return 'Cotizave restaurada del disco';
    default:
      return 'Cotizave sin datos';
  }
}

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
  /** De dónde salieron los rates actuales: red en vivo o almacenamiento. */
  readonly ratesProvenance = signal<CotizaveRatesProvenance>('none');
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
   *
   * Pero solo si el dato se puede defender frente a un operador: una caché vieja
   * o sin marca de tiempo verificable se DESCARTA (y se borra del storage, para
   * que no pueda volver a aparecer), porque un dato viejo presentado como
   * disponible es peor que no tener dato. `ratesByMarket` queda vacío y
   * `lastFetched` en `null`: nunca queda una marca vieja que parezca sana.
   */
  private hydrateRatesFromStorage(): void {
    const persisted = this.readPersistedRates();
    if (!persisted || typeof persisted !== 'object') return;
    const rates = persisted.rates;
    if (!rates || typeof rates !== 'object' || Object.keys(rates).length === 0) return;

    const at = persisted.fetchedAt ? new Date(persisted.fetchedAt) : null;
    const ageMs = at && !Number.isNaN(at.getTime()) ? Date.now() - at.getTime() : null;

    if (ageMs === null || ageMs > COTIZAVE_CACHE_MAX_AGE_MS) {
      this.discardPersistedRates(at, ageMs);
      return;
    }

    this.ratesByMarket.set(rates as Record<string, CotizaveRate>);
    this.ratesProvenance.set('restored');
    if (at) {
      this.lastFetched.set(at);
    }
  }

  /**
   * Rechaza la caché persistida y lo dice. Se borra del storage en vez de solo
   * ignorarse: ignorada volvería a hidratar en el próximo arranque y a fingir
   * que es dato usable. El aviso va a `error()` (superficie persistente, la
   * renderiza el panel de Cotizave) y a un toast (avisa en el arranque) porque
   * una app que arranca sin rates tiene que explicar por qué.
   */
  private discardPersistedRates(at: Date | null, ageMs: number | null): void {
    this.removePersistedRates();
    const detail =
      ageMs === null
        ? 'sin marca de tiempo verificable'
        : `${formatCotizaveDataAge(at)} (máximo ${COTIZAVE_CACHE_MAX_AGE_MS / 60_000} min)`;
    this.toast.warn(
      `Caché de Cotizave descartada: los datos guardados son ${detail}. Sincronizá las rates para trabajar con datos actuales.`,
      'Cotizave',
    );
    this.error.set(
      `Caché de Cotizave descartada: los datos guardados son ${detail}. Sincronizá las rates para trabajar con datos actuales.`,
    );
  }

  private removePersistedRates(): void {
    try {
      this.storage.remove(RATES_STORAGE_KEY);
    } catch {
      // Un almacenamiento inaccesible no puede impedir que la app arranque; la
      // entrada vieja simplemente seguirá sin hidratarse.
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

      /**

       * La operación del breaker devuelve rates YA normalizados y YA validados.
       * La validación va adentro a propósito: si un 200 que no normaliza a nada
       * se detectara afuera, el breaker ya habría contabilizado un `recordSuccess()`
       * y el fallo nunca podría abrir el circuito (`failureThreshold: 3`), con
       * un contador que decía "todo bien" mientras el servicio fallaba. Adentro,
       * el 200-basura es un fallo más y el breaker lo cuenta.
       */
      const executeNetworkCall = async (
        signal: AbortSignal,
      ): Promise<Record<string, CotizaveRate>> => {
        let result: unknown;
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
            // LIMITACIÓN CONOCIDA: por IPC el `AbortSignal` del breaker no viaja
            // al handler (un signal no es serializable), así que el timeout de
            // 20 s es un `Promise.race` que ABANDONA la llamada en vuelo en vez de
            // cancelarla. La petición sigue viva del lado de Electron hasta que su
            // propio `AbortSignal.timeout(15000)` la corta. Arreglarlo exigiría
            // cambiar el contrato IPC, que es compartido y fuera de alcance.
            result = await electronWin.electron.fetchCotizave({ apiKey: key, endpoint });
          } else {
            result = await this.fetchRatesFromBrowser(endpoint, key, signal);
          }
        } catch (err) {
          lastError = err;
          throw err;
        }

        const rates =
          result && typeof result === 'object' && ('binance' in result || 'oficial' in result)
            ? (result as Record<string, CotizaveRate>)
            : normalizeCotizaveRates(result);

        if (Object.keys(rates).length === 0) {
          const err = new CotizaveEmptyPayloadError();
          lastError = err;
          throw err;
        }
        return rates;
      };

      // Estado del circuito ANTES de ejecutar: distingue "el breaker cortó la
      // llamada" (no hay diagnóstico posible) de "la llamada corrió y falló"
      // (el diagnóstico real está en `lastError`).
      const stateBefore = this.circuitBreaker.getState();
      let servedFromCache = false;

      const fallbackHandler = (): Record<string, CotizaveRate> => {
        // Un 200-basura NO se disfraza de "circuito protegiendo el servicio": la
        // red funcionó, la key es válida y la caché anterior sigue siendo buena.
        // Se reporta el contrato roto y se conserva la caché intacta.
        if (lastError instanceof CotizaveEmptyPayloadError) {
          throw new CotizaveDiagnosisError(lastError.message, lastError);
        }

        const cached = this.ratesByMarket();
        if (cached && Object.keys(cached).length > 0) {
          // La edad va en el aviso: un dato viejo tiene que leerse viejo.
          this.toast.warn(
            `Usando cotizaciones cacheadas de ${formatCotizaveDataAge(this.lastFetched())} (circuito en protección).`,
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
          throw new CotizaveDiagnosisError(
            `Circuito de Cotizave abierto: el intento anterior falló y el servicio quedó en protección por ${cooldownS} s. No se volvió a llamar a la API. Reintentá en un momento.`,
            lastError ?? undefined,
          );
        }

        const lastMsg = lastError instanceof Error ? lastError.message : '';
        if (lastMsg.includes('HTTP Error 401')) {
          throw new CotizaveDiagnosisError(
            'API key de Cotizave inválida o vencida (HTTP 401). Revisá tu key en Ajustes → API Keys.',
            lastError,
          );
        }
        if (lastMsg.includes('HTTP Error 403')) {
          throw new CotizaveDiagnosisError(
            'Cotizave rechazó el acceso (HTTP 403). Verificá que el plan de tu API key incluya el endpoint /v1/fx.',
            lastError,
          );
        }
        // Upstream inalcanzable: ni key ni plan son el problema. El mensaje
        // conserva la causa cruda (`Failed to fetch`) y además dice qué hacer
        // según dónde se esté ejecutando: en el navegador el bloqueo típico es
        // CORS contra la API directa, y la salida es el puente local de escritorio.
        if (NETWORK_CAUSE.test(lastMsg)) {
          throw new CotizaveDiagnosisError(
            `Servidor Cotizave no accesible: ${lastMsg}. Puede ser tu conexión, el bloqueo CORS del navegador o la protección anti-bot de Cotizave. Reintentá en unos segundos; si seguís en la versión web, abrí la app de escritorio (P2P Decision Tool) para que el navegador use su puente local de cotizaciones.`,
            lastError,
          );
        }
        // Cualquier otra causa real se declara tal cual, nunca diluida en un genérico.
        if (lastMsg) {
          throw new CotizaveDiagnosisError(`Cotizave no disponible: ${lastMsg}`, lastError);
        }
        // Sin caché y sin diagnóstico: al menos decir qué hacer.
        throw new CotizaveDiagnosisError(
          'Cotizave no disponible y sin caché previa: el intento falló sin dejar diagnóstico. Reintentá en unos segundos o revisá tu conexión.',
          lastError ?? undefined,
        );
      };

      const rates = await this.circuitBreaker.execute(executeNetworkCall, fallbackHandler);

      if (!servedFromCache) {
        this.ratesByMarket.set(rates);
        const fetchedAt = new Date();
        this.lastFetched.set(fetchedAt);
        this.ratesProvenance.set('live');
        this.persistRates(rates, fetchedAt);
      }
      // Si vino del fallback, la app no se actualizó: solo se sirvió lo viejo.
      // `ratesByMarket` ya la tiene y `lastFetched` no se toca, para que la
      // antigüedad mostrada en el aviso no mienta. `ratesProvenance` tampoco se
      // toca: los rates que siguen ahí son los mismos de antes, no datos nuevos.
    } catch (err) {
      const msg = (err as Error).message || 'No se pudo conectar con Cotizave';
      // La causa de red ya clasificada gana: su mensaje trae el motivo crudo
      // (`Failed to fetch`), el diagnóstico y la acción (incluido el puente local
      // de escritorio), así que pisarlo con el texto genérico devolvía al
      // operador al mismo mensaje de siempre y perdía el motivo. La rama
      // genérica queda como red de seguridad para un fallo de transporte que
      // llegue SIN clasificar, que es donde de verdad no sabemos si es CORS, red
      // u otra cosa. Hoy todo lo que llega al `catch` pasa por el fallback y sale
      // clasificado: la red no borra diagnósticos, solo los evita duplicar.
      const classified = err instanceof CotizaveDiagnosisError;
      if (
        !classified &&
        (msg.includes('Failed to fetch') || msg.includes('CORS') || msg.includes('NetworkError'))
      ) {
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
