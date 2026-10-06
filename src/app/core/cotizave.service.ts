import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { CredentialStoreService } from './credential-store.service';
import { StorageService } from './storage';
import { NativeHttpService } from './native-http.service';
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
 *
 * Y NO ES SOLO UNA PUERTA DE ARRANQUE: el límite corre en vivo. Los rates que
 * están en memoria son un dato viejo en cuanto pasan los 15 min, se hydraten del
 * disco o los bajara la red, y una app abierta cuatro horas tiene que seguir
 * mirando los 15 min, no "los 15 min contados desde que arrancó el proceso". Quien
 * vigila el TTL es `armExpiry()`, no el constructor.
 */
export const COTIZAVE_CACHE_MAX_AGE_MS = 15 * 60_000;

/**
 * Intervalo mínimo entre llamadas de red en `fetchRates()`: 2 minutos.
 * Protege contra ráfagas de sincronizaciones o pulsaciones repetidas
 * en la interfaz que agoten la cuota de la ventana y disparen HTTP 429.
 * Si se requiere forzar la consulta independientemente de la edad, se pasa `force = true`.
 */
export const COTIZAVE_MIN_FETCH_INTERVAL_MS = 2 * 60_000;

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
 * Envoltura que Electron agrega al serializar un rechazo del proceso principal
 * hacia el renderer: `Error invoking remote method '<canal>': Error: <causa>`.
 *
 * POR QUÉ HAY QUE DESVESTIRLA Y NO BUSCAR DENTRO: el canal y el prefijo son
 * transporte, no diagnóstico. Si la clasificación depende de que la causa
 * sobreviva como substring, el día que Electron cambie esa forma el mensaje
 * deja de clasificar sin que nadie lo note, y el texto que ve el operador
 * arrastra `Error invoking remote method` y el nombre del canal. Se pela la
 * envoltura primero y se clasifica sobre la causa limpia.
 */
const IPC_INVOKE_WRAPPER = /^Error invoking remote method '[^']*':\s*/;

/** Prefijo `Error:` que Electron/Node agregan al serializar la causa anidada. */
const ERROR_NAME_PREFIX = /^Error:\s*/;

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
  private readonly nativeHttp = inject(NativeHttpService, { optional: true });

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
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAttemptAt = 0;

  constructor() {
    // `StorageService.get` es síncrono: la caché persistida se hidrata antes de
    // que nadie pueda observar un `ratesByMarket()` vacío. El `hydrate()` async
    // de la API key sigue su curso aparte.
    this.hydrateRatesFromStorage();
    void this.hydrate();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.clearExpiry();
  }

  /**
   * Programa el vencimiento de los rates que hay en memoria AHORA.
   *
   * POR QUÉ UN TIMER Y NO UNA VISTA DERIVADA: la alternativa era no usar reloj y
   * calcular un "rates efectivos" que quedara vacío al detectarse viejo. Se
   * descartó porque la política no se cumple con una vista: `provenance` y
   * `error()` son señales mutables que el resto de la app ya lee, y vaciar la
   * vista sin vaciar la señal deja al operador mirando un panel que dice
   * "restaurada del disco" sobre datos que además ya no puede leer nadie, o un
   * `error()` viejo que explica otra cosa. Un vencimiento real borra las tres
   * cosas juntas y una sola vez, y `ngOnDestroy` lo limpia sin dejar nada vivo.
   *
   * El reloj queda ADEMÁS dentro del timer: el temporizador dispara el aviso pero
   * la edad se vuelve a medir contra `Date.now()` antes de tirar el dato. Un
   * temporizador disparado temprano (reloj del sistema adelantado, suspensión del
   * proceso) no puede convertir en fresco lo que ya venció, y uno disparado tarde
   * sigue siendo correcto porque la edad se recalcula.
   */
  private armExpiry(at: Date | null): void {
    this.clearExpiry();
    if (!at || Number.isNaN(at.getTime())) return;

    const remainingMs = COTIZAVE_CACHE_MAX_AGE_MS - (Date.now() - at.getTime());
    // Un `setTimeout` con un remanente negativo dispara en el próximo tick: es lo
    // mismo que expirar ya, y el handler vuelve a medir la edad de todas formas.
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.expireRatesAt(at);
    }, Math.max(0, remainingMs));
  }

  private clearExpiry(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  /**
   * Vence los rates en memoria y lo dice. Solo actúa si los rates que siguen en
   * pantalla son exactamente los que nacieron en `at` y ya superaron el TTL: un
   * fetch más nuevo re-armó el timer con su propia marca, así que un vencimiento
   * viejo no puede pisar datos frescos.
   */
  private expireRatesAt(at: Date): void {
    const current = this.lastFetched();
    if (!current || current.getTime() !== at.getTime()) return;
    if (Date.now() - current.getTime() < COTIZAVE_CACHE_MAX_AGE_MS) {
      // Todavía no venció (temporizador disparado antes de tiempo): se rearma.
      this.armExpiry(current);
      return;
    }

    const age = formatCotizaveDataAge(current);
    this.ratesByMarket.set({});
    this.ratesProvenance.set('none');
    this.lastFetched.set(null);
    // La copia persistida se borra junto con la de memoria: si el proceso
    // muriera ahora mismo, el próximo arranque no puede resucitarla.
    this.removePersistedRatesIfSameFetch(current);

    const msg =
      `Caché de Cotizave vencida: las tasas en memoria tienen ${age} ` +
      `(máximo ${COTIZAVE_CACHE_MAX_AGE_MS / 60_000} min) y ya no alimentan la app. ` +
      `Sincronizá las rates para trabajar con datos actuales.`;
    this.error.set(msg);
    this.toast.warn(msg, 'Cotizave');
  }

  /**
   * Borra del storage SOLO si lo persistido es el mismo fetch que está venciendo.
   * Sin esa comprobación, un vencimiento podría borrar en el disco una caché que
   * otro camino acaba de escribir más nueva.
   */
  private removePersistedRatesIfSameFetch(at: Date): void {
    const persisted = this.readPersistedRates();
    if (!persisted || typeof persisted !== 'object') return;
    if (persisted.fetchedAt !== at.toISOString()) return;
    this.removePersistedRates();
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
    // Hidratar no es una excepción al TTL: lo que entra por el disco arranca su
    // propia cuenta regresiva, así que la ventana se cierra sola aunque la app
    // nunca vuelva a pedir rates.
    this.armExpiry(at);
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

  /**
   * In-flight fetches keyed by endpoint, so concurrent callers share one network
   * round trip instead of firing their own.
   *
   * WHY THE CIRCUIT BREAKER ALONE CANNOT DO THIS: `execute()` reads the breaker
   * state exactly once, at entry, and `maxRetries: 1` makes that a single attempt.
   * A burst of concurrent `fetchRates()` calls therefore all observe `CLOSED`
   * before any of them has recorded a failure, so all of them reach the network.
   * `failureThreshold: 3` only opens the gate on the third failure, by which time
   * the herd has already been sent. The breaker reacts to a herd after the fact;
   * this map prevents the herd from ever leaving.
   *
   * WHY IT IS KEYED BY ENDPOINT: `endpoint` selects the upstream URL and the
   * payload shape, so collapsing flights across different endpoints could serve a
   * `'rates'` caller a promise resolved from a different endpoint's response.
   * Keying the map by endpoint keeps those flights independent.
   */
  private readonly inFlightFetches = new Map<'rates', Promise<void>>();

  /**
   * Collapses a concurrent burst into the single flight already running.
   *
   * The entry is cleared in a `finally`, which is what keeps a failure from
   * poisoning the service: without it a single failed flight would stay cached
   * as the in-flight promise and every later call would silently reuse a dead
   * attempt, so the app could never recover without a restart. Clearing it in
   * `finally` also means a sequential call after a completed one starts a NEW
   * flight instead of reusing an already-resolved promise.
   */
  async fetchRates(endpoint: 'rates' = 'rates'): Promise<void> {
    const inFlight = this.inFlightFetches.get(endpoint);
    if (inFlight) {
      await inFlight;
      return;
    }

    const flight = this.runFetchRates(endpoint);
    this.inFlightFetches.set(endpoint, flight);
    try {
      await flight;
    } finally {
      this.inFlightFetches.delete(endpoint);
    }
  }

  /**
   * Consulta las tasas solo si no existen en memoria o si superaron la frescura mínima.
   * Evita que múltiples llamadas en ráfaga (por ejemplo, desde el monitor de spreads)
   * quemen la cuota del operador con HTTP 429.
   */
  async refreshIfStale(
    endpoint: 'rates' = 'rates',
    maxAgeMs = COTIZAVE_MIN_FETCH_INTERVAL_MS,
  ): Promise<void> {
    if (this.circuitBreaker.getState() === 'OPEN') {
      return;
    }
    const minInterval = Math.min(COTIZAVE_MIN_FETCH_INTERVAL_MS, maxAgeMs);
    const now = Date.now();
    if (minInterval > 0 && now - this.lastAttemptAt < minInterval) {
      return;
    }
    const last = this.lastFetched();
    const rates = this.ratesByMarket();
    if (
      last &&
      !Number.isNaN(last.getTime()) &&
      Object.keys(rates).length > 0 &&
      now - last.getTime() < maxAgeMs
    ) {
      return;
    }
    await this.fetchRates(endpoint);
  }

  /**
   * Saca la causa real de un mensaje de error que pudo haber cruzado capas de
   * transporte, dejando limpio lo que sirve tanto para clasificar como para
   * mostrar al operador.
   *
   * POR QUÉ EXISTE: por IPC el mismo 429 llega como
   * `Error invoking remote method 'p2p:fetch-cotizave': Error: Cotizave HTTP
   * Error 429`. Clasificar con `includes` sobre ese texto funcionaba por
   * suerte de substring, no por diseño: dependía de que la causa sobreviviera
   * intacta detrás de una envoltura ajena, y el mensaje que veía el operador
   * llevaba el canal interno adelante. Desvistiendo primero, la clasificación
   * depende de la causa y el texto que sale es el mismo para navegador,
   * puente local y escritorio.
   *
   * DEFENSIVA POR DISEÑO: si no hay envoltura, devuelve la entrada sin tocar.
   * Un mensaje que no matchea nada tiene que llegar tal cual, porque puede
   * ser la única evidencia de un fallo que todavía no sabemos clasificar.
   *
   * El bucle pela repetidas veces porque Electron puede anidar la envoltura
   * (un `invoke` que reenvía otro `invoke`), y `MAX` acota el trabajo para que
   * una cadena patológica no convierta el diagnóstico en un bucle.
   */
  private extractUpstreamMessage(raw: string): string {
    const MAX_UNWRAP_DEPTH = 8;
    let current = raw.trim();

    for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
      const unwrapped = current
        .replace(IPC_INVOKE_WRAPPER, '')
        .replace(ERROR_NAME_PREFIX, '')
        .trim();
      // Sin progreso: la entrada no traía envoltura, se devuelve sin cambios.
      if (unwrapped === current || unwrapped.length === 0) break;
      current = unwrapped;
    }

    return current;
  }

  private async runFetchRates(endpoint: 'rates'): Promise<void> {
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

        // La causa se desviste ANTES de clasificar: si el 429 llega envuelto por
        // el IPC de Electron, sin esto la clasificación dependería de que el
        // substring sobreviviera a la envoltura, y el mensaje del operador
        // llevaría `Error invoking remote method` y el canal interno adelante.
        const lastMsg = this.extractUpstreamMessage(
          lastError instanceof Error ? lastError.message : '',
        );
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
        /**
         * LÍMITE DE PETICIONES (429). Va con sus ramas hermanas porque es un
         * cuarto diagnóstico, no una variante del genérico: la key autenticó
         * bien (si fuera inválida sería 401), el servicio está vivo (si estuviera
         * caído sería 403 o un fallo de transporte) y lo agotado es la cuota de
         * la ventana. Decir "no disponible" sería mentira, y mandar a revisar la
         * key también: un 429 prueba que la key sirve.
         *
         * SOBRE LA DURACIÓN CITADA: sale de `cooldownPeriodMs`, el mismo número
         * que usa el mensaje de circuito abierto. No es un criterio nuevo de
         * espera — es lo que el breaker efectivamente hace si el fallo se repite.
         * El mensaje no promete ninguna cuenta regresiva propia: solo dice qué
         * hacer y qué va a hacer el circuito si el 429 insiste.
         */
        if (lastMsg.includes('HTTP Error 429')) {
          const cooldownS = Math.round(this.circuitBreaker.options.cooldownPeriodMs / 1000);
          throw new CotizaveDiagnosisError(
            `Cotizave limitó las solicitudes (HTTP 429): tu API key es válida, pero su cuota de esta ventana está agotada. No es una caída del servicio ni un problema de la key. Una ráfaga anterior puede haberla consumido: esperá y la app reintenta sola. Si el fallo insiste, el circuito frena las llamadas durante ${cooldownS} s.`,
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
        // Un dato bajado de la red también envejece: la política no distingue
        // "restaurado" de "live", dice "viejo a los 15 min".
        this.armExpiry(fetchedAt);
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
      this.lastAttemptAt = Date.now();
      this.loading.set(false);
    }
  }

  startAutoRefresh(intervalMs = 10 * 60_000): void {
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

    // 1. En móviles nativos (Capacitor Android/iOS), consultar directamente por socket nativo sin CORS
    if (this.nativeHttp?.isNative) {
      return await this.nativeHttp.get(url, {
        headers: buildCotizaveHeaders(key),
        signal,
      });
    }

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
      const retryAfter =
        typeof resp.headers?.get === 'function' ? resp.headers.get('retry-after') : null;
      const retryMsg = retryAfter ? ` (retry-after: ${retryAfter}s)` : '';
      throw new Error(`Cotizave HTTP Error ${resp.status}${retryMsg}`);
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
      const retryAfter =
        typeof bridgeResp.headers?.get === 'function'
          ? bridgeResp.headers.get('retry-after')
          : null;
      const retryMsg = retryAfter ? ` (retry-after: ${retryAfter}s)` : '';
      throw new Error(`Cotizave bridge HTTP Error ${bridgeResp.status}${retryMsg}`);
    }
    return await bridgeResp.json();
  }
}
