import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CotizaveService,
  COTIZAVE_CACHE_MAX_AGE_MS,
  COTIZAVE_MIN_FETCH_INTERVAL_MS,
  formatCotizaveDataAge,
} from './cotizave.service';
import { CredentialStoreService } from './credential-store.service';
import { ToastService } from './toast.service';
import { P2P_STORAGE, StorageService } from './storage';
import { IndexedDbStorageService } from './indexed-db-storage.service';
import { MemoryStorage } from './memory-storage';
import type { CotizaveRate } from '@p2p/core';

/** Clave de persistencia de la caché de rates (convención `p2p.<dominio>.<sujeto>`). */
const RATES_STORAGE_KEY = 'p2p.cotizave.rates';

interface PersistedRates {
  rates: Record<string, CotizaveRate>;
  fetchedAt: string;
}

const RATES_PAYLOAD = {
  country: 'VE',
  base: 'USD',
  rates: [
    { market: 'binance_p2p_ves', type: 'p2p', ask: 800, bid: 795 },
    { market: 'reference', type: 'reference', ask: 36.5, bid: 36.2 },
    { market: 'parallel', type: 'parallel', ask: 39.9, bid: 39.6 },
  ],
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * `fetchRates` narrows `endpoint` to the single `'rates'` literal the app uses
 * today. The in-flight deduplication is keyed by that argument, so proving two
 * different endpoints are NOT collapsed into one flight requires calling the
 * method with a second literal. These tests reach it through this widened view
 * instead of loosening the production signature.
 */
type FetchRatesByEndpoint = (endpoint: string) => Promise<void>;

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response;
}

describe('CotizaveService', () => {
  let svc: CotizaveService;
  let mem: MemoryStorage;
  let storage: StorageService;
  const toast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  /**
   * `StorageService` consulta la capa IndexedDB (memoria + espejo a `localStorage`)
   * antes del adapter. En jsdom `localStorage` es global y sobrevive entre tests
   * (y entre archivos, con `--isolate` en false), así que un `set` de un test
   * anterior envenenaría la caché de uno nuevo. Este stub deja el `IndexedDbStorageService`
   * fuera del camino: el contrato se ejercita sobre el `WebStorageAdapter` real
   * backed por `MemoryStorage`.
   */
  const idbStub = {
    get: () => null,
    set: () => undefined,
    remove: () => undefined,
  };

  beforeEach(async () => {
    toast.success.mockReset();
    toast.info.mockReset();
    toast.error.mockReset();
    toast.warn.mockReset();

    mem = new MemoryStorage();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: CredentialStoreService,
          useValue: {
            getCotizaveApiKey: vi.fn(async () => 'test-key'),
            setCotizaveApiKey: vi.fn(async () => undefined),
          },
        },
        { provide: ToastService, useValue: toast },
        { provide: P2P_STORAGE, useValue: mem },
        { provide: IndexedDbStorageService, useValue: idbStub },
      ],
    });

    delete (window as unknown as Record<string, unknown>)['electron'];
    storage = TestBed.inject(StorageService);
    svc = TestBed.inject(CotizaveService);
    // hydrate() corre en el constructor; espera a que la key mockeada quede seteada.
    await vi.waitFor(() => expect(svc.apiKey()).toBe('test-key'));
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['electron'];
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  /**
   * Instancia nueva del servicio sobre el mismo backend de storage: simula un
   * reinicio de la app, donde solo sobrevive lo que está persistido.
   */
  async function newServiceOver(backend: Storage): Promise<CotizaveService> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CredentialStoreService,
          useValue: {
            getCotizaveApiKey: vi.fn(async () => 'test-key'),
            setCotizaveApiKey: vi.fn(async () => undefined),
          },
        },
        { provide: ToastService, useValue: toast },
        { provide: P2P_STORAGE, useValue: backend },
        { provide: IndexedDbStorageService, useValue: idbStub },
      ],
    });
    const fresh = TestBed.inject(CotizaveService);
    await vi.waitFor(() => expect(fresh.apiKey()).toBe('test-key'));
    return fresh;
  }

  it('populates ratesByMarket and sets lastFetched when the direct fetch succeeds', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(RATES_PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchRates();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.cotizave.com/v1/fx/rates');
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.method).toBe('GET');
    const headers = init?.headers as unknown as Record<string, string> | undefined;
    expect(headers?.['X-API-Key']).toBe('test-key');
    expect(svc.ratesByMarket()['binance']).toBeDefined();
    expect(svc.ratesByMarket()['oficial']).toBeDefined();
    expect(svc.lastFetched()).not.toBeNull();
    expect(svc.error()).toBeNull();
    expect(svc.loading()).toBe(false);
  });

  it('falls back to the local bridge when the direct fetch is blocked by CORS', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(RATES_PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchRates();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:51857/api/cotizave/rates');
    const init = fetchMock.mock.calls[1][1] as RequestInit | undefined;
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({ 'x-api-key': 'test-key', Accept: 'application/json' });
    expect(svc.ratesByMarket()['binance']).toBeDefined();
    expect(svc.lastFetched()).not.toBeNull();
    expect(svc.error()).toBeNull();
  });

  it('reports an error and shows a toast when the direct fetch and the bridge both fail', async () => {
    const fetchMock = vi.fn<FetchLike>().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchRates();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(svc.loading()).toBe(false);
    expect(svc.error()).not.toBeNull();
    expect(svc.error()).toContain('Cotizave');
    expect(toast.error).toHaveBeenCalled();
  });

  it('surfaces the real HTTP 401 (invalid key) instead of the generic no-cache message when the desktop IPC rejects', async () => {
    (window as unknown as Record<string, unknown>)['electron'] = {
      fetchCotizave: vi.fn(async () => {
        throw new Error('Cotizave HTTP Error 401');
      }),
    };

    await svc.fetchRates();

    expect(svc.loading()).toBe(false);
    expect(svc.error()).not.toBeNull();
    expect(svc.error()).toContain('401');
    expect(svc.error()).not.toContain('no disponible y sin caché');
    const toastMsg = toast.error.mock.calls[0]?.[0] as string | undefined;
    expect(toastMsg).toContain('401');
  });

  it('keeps using the cached rates and warns when the circuit is open but a previous cache exists', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(RATES_PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);
    await svc.fetchRates();
    expect(Object.keys(svc.ratesByMarket()).length).toBeGreaterThan(0);

    // Ahora el camino IPC/red falla: la próxima ejecución del circuito debe
    // caer en el fallback y reutilizar la caché cargada.
    const failingMock = vi.fn<FetchLike>().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', failingMock);

    await svc.fetchRates();

    expect(Object.keys(svc.ratesByMarket()).length).toBeGreaterThan(0);
    expect(svc.ratesByMarket()['binance']).toBeDefined();
    expect(toast.warn).toHaveBeenCalled();
  });

  it('configures a circuit-breaker timeout that outlives the slowest transport (15s in the Electron IPC handler)', () => {
    // Si el breaker expira antes que el transporte, el fallback corre con
    // `lastError === null` y el diagnóstico real se pierde (la inversión de D1).
    expect(svc.circuitBreaker.options.requestTimeoutMs).toBeGreaterThan(15_000);
  });

  it('surfaces the real transport error when the desktop IPC tarpits longer than the breaker timeout', async () => {
    const REAL = 'Servidor Cotizave no accesible (sin conexión o timeout)';
    // El upstream con key sospechosa entra en tarpit y recién responde cuando
    // dispara el abort del handler (15s). Un breaker de 10s expiraría antes y
    // devolvería el fallback sin `lastError`.
    (window as unknown as Record<string, unknown>)['electron'] = {
      fetchCotizave: vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error(REAL)), 15_000);
          }),
      ),
    };

    vi.useFakeTimers();
    try {
      const pending = svc.fetchRates();
      await vi.advanceTimersByTimeAsync(25_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    expect(svc.error()).not.toBeNull();
    expect(svc.error()).toContain(REAL);
    expect(svc.error()).not.toBe('Cotizave no disponible y sin caché previa');
    expect(toast.error.mock.calls[0]?.[0] as string).toContain(REAL);
  });

  it('reports the open circuit honestly when three attempts have already failed and no cache exists', async () => {
    (window as unknown as Record<string, unknown>)['electron'] = {
      fetchCotizave: vi.fn(async () => {
        throw new Error('Cotizave HTTP Error 403');
      }),
    };

    // Tres `fetchRates()` fallidos seguidos abren el circuito
    // (failureThreshold: 3, cooldownPeriodMs: 25_000).
    await svc.fetchRates();
    await svc.fetchRates();
    await svc.fetchRates();
    expect(svc.circuitBreaker.getMetrics().state).toBe('OPEN');

    // La cuarta llamada ni siquiera invoca la operación: el fast-fail no tiene
    // diagnóstico propio, y antes caía en el genérico "sin caché previa".
    await svc.fetchRates();

    expect(svc.error()).not.toBeNull();
    expect(svc.error()?.toLowerCase()).toContain('circuito');
    expect(svc.error()).toContain('abierto');
    expect(svc.error()).not.toContain('no disponible y sin caché');
  });

  it('hydrates the rates from the persisted cache on a fresh instance, before any network call', async () => {
    // Dentro del TTL: una caché de más de 15 min ya no se hidrata (ver el test
    // de descarte). La de 2 h que se usaba antes acá era un dato que la app
    //ractableba como si fuera actual para operar.
    const fetchedAt = new Date(Date.now() - 4 * 60_000).toISOString();
    storage.set<PersistedRates>(RATES_STORAGE_KEY, {
      rates: {
        binance: { market: 'binance', type: 'p2p', ask: 800, bid: 795 },
        oficial: { market: 'oficial', type: 'reference', ask: 36.5, bid: 36.2 },
      },
      fetchedAt,
    });

    // Instancia nueva = arranque de la app. `MemoryStorage` es el mismo backend
    // que sobrevive al reinicio; nada de red debería ser necesario.
    const fresh = await newServiceOver(mem);

    expect(Object.keys(fresh.ratesByMarket()).length).toBeGreaterThan(0);
    expect(fresh.ratesByMarket()['binance']).toBeDefined();
    expect(fresh.lastFetched()).toEqual(new Date(fetchedAt));
    // Y el consumidor tiene que poder distinguir esto de una descarga en vivo.
    expect(fresh.ratesProvenance()).toBe('restored');
  });

  it('descarta la cache persistida mas vieja que 15 min y la saca del almacenamiento', async () => {
    const tooOld = new Date(Date.now() - COTIZAVE_CACHE_MAX_AGE_MS - 60_000).toISOString();
    storage.set<PersistedRates>(RATES_STORAGE_KEY, {
      rates: {
        binance: { market: 'binance', type: 'p2p', ask: 800, bid: 795 },
        oficial: { market: 'oficial', type: 'reference', ask: 36.5, bid: 36.2 },
      },
      fetchedAt: tooOld,
    });

    const fresh = await newServiceOver(mem);

    // No hidrata: una brecha vieja no puede alimentar una decisión de trade.
    expect(Object.keys(fresh.ratesByMarket())).toHaveLength(0);
    // Y no queda una `lastFetched` vieja que parezca sana.
    expect(fresh.lastFetched()).toBeNull();
    expect(fresh.ratesProvenance()).toBe('none');
    // Se borra del storage: ignorada, volvería a hidratar en el próximo arranque.
    expect(storage.get(RATES_STORAGE_KEY)).toBeNull();
    // Y el operador se entera de por qué la app arrancó sin rates.
    expect(fresh.error()).toContain('descartada');
    expect(toast.warn).toHaveBeenCalled();
  });

  it('serves the persisted cache when the network path fails and warns with the cache age', async () => {
    const fourMinutesAgo = new Date(Date.now() - 4 * 60_000);
    storage.set<PersistedRates>(RATES_STORAGE_KEY, {
      rates: {
        binance: { market: 'binance', type: 'p2p', ask: 800, bid: 795 },
        oficial: { market: 'oficial', type: 'reference', ask: 36.5, bid: 36.2 },
      },
      fetchedAt: fourMinutesAgo.toISOString(),
    });

    const fresh = await newServiceOver(mem);
    (window as unknown as Record<string, unknown>)['electron'] = {
      fetchCotizave: vi.fn(async () => {
        throw new Error('Servidor Cotizave no accesible (sin conexión o timeout)');
      }),
    };

    await fresh.fetchRates();

    // La caché sobrevive al fallo...
    expect(Object.keys(fresh.ratesByMarket()).length).toBeGreaterThan(0);
    expect(fresh.ratesByMarket()['binance']).toBeDefined();
    // ...y se anuncia con su edad real, nunca como dato fresco.
    expect(fresh.lastFetched()).toEqual(fourMinutesAgo);
    const warnMsg = toast.warn.mock.calls.at(-1)?.[0] as string | undefined;
    expect(warnMsg).toContain('hace 4 min');
    // Servir la caché no convierte un dato restaurado en una descarga en vivo.
    expect(fresh.ratesProvenance()).toBe('restored');
  });

  it('marks the rates as live only when they come from a network fetch', async () => {
    expect(svc.ratesProvenance()).toBe('none');
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(async () => jsonResponse(RATES_PAYLOAD)),
    );

    await svc.fetchRates();

    expect(svc.ratesProvenance()).toBe('live');
    // Un fetch en vivo sí es lo que se persiste, y una app nueva lo hidrata como
    // restaurado: la procedencia cambia de vereda al cruzar el almacenamiento.
    const fresh = await newServiceOver(mem);
    expect(Object.keys(fresh.ratesByMarket()).length).toBeGreaterThan(0);
    expect(fresh.ratesProvenance()).toBe('restored');
  });

  it('keeps the real network cause in error() instead of overwriting it with the generic CORS text', async () => {
    // Camino navegador: la API directa y el puente local fallan con el mismo
    // `Failed to fetch`. Ese texto viaja ADEMÁS dentro del diagnóstico, así que
    // el `catch` no puede seguir matcheándolo a ciegas.
    vi.stubGlobal('fetch', vi.fn<FetchLike>().mockRejectedValue(new TypeError('Failed to fetch')));

    await svc.fetchRates();

    expect(svc.error()).toContain('Servidor Cotizave no accesible');
    // La causa cruda no se pierde...
    expect(svc.error()).toContain('Failed to fetch');
    // ...y la orientación de CORS/puente local sigue ahí, ahora dentro del
    // diagnóstico correcto en vez de tapándolo.
    expect(svc.error()).toContain('puente local de cotizaciones');
    // Antes esto era el texto genérico, que era lo que se veía.
    expect(svc.error()).not.toMatch(/^Error de red\/CORS al conectar/);
  });

  it('treats a 200 JSON payload with no recognizable rates as a failure and keeps the existing cache', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(RATES_PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);
    await svc.fetchRates();
    expect(Object.keys(svc.ratesByMarket()).length).toBeGreaterThan(0);
    const goodCache = { ...svc.ratesByMarket() };

    // 200 OK con una forma que `normalizeCotizaveRates` no reconoce → `{}`.
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(async () => jsonResponse({ unexpected: 'shape' })),
    );
    await svc.fetchRates();

    expect(svc.error()).not.toBeNull();
    expect(svc.error()?.toLowerCase()).toContain('sin datos');
    // No se pisa la caché previa ni se persiste una caché vacía.
    expect(svc.ratesByMarket()).toEqual(goodCache);
    const persisted = storage.get<PersistedRates>(RATES_STORAGE_KEY);
    expect(persisted?.rates).toEqual(goodCache);
  });

  it('counts a 200 that normalizes to nothing as a breaker failure and opens the circuit on the third', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ unexpected: 'shape' }));
    vi.stubGlobal('fetch', fetchMock);

    await svc.fetchRates();
    await svc.fetchRates();
    await svc.fetchRates();

    // Antes de esta corrección el breaker había visto tres EXITOES: el chequeo de
    // payload vacío corría después de `recordSuccess()`, así que el circuito
    // jamás podía abrirse para este modo de fallo.
    const metrics = svc.circuitBreaker.getMetrics();
    expect(metrics.totalFailures).toBe(3);
    expect(metrics.totalSuccesses).toBe(0);
    expect(metrics.state).toBe('OPEN');

    // Cuarta llamada: fast-fail sin volver a pegarle a la red.
    await svc.fetchRates();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(svc.error()?.toLowerCase()).toContain('circuito');
  });

  /**
   * Un 429 NO es "el servicio no está disponible": la key autenticó bien (si
   * fuera inválida sería 401), el servicio está vivo (si estuviera caído sería
   * 403 o un fallo de transporte) y lo que se agotó es la cuota de la ventana.
   * Cada forma de la causa tiene que caer en el mismo diagnóstico.
   *
   * Formas reales que llegan al renderer:
   * - navegador directo:  `Cotizave HTTP Error 429`
   * - puente local:       `Cotizave bridge HTTP Error 429`
   * - IPC de Electron:    `Error invoking remote method 'p2p:fetch-cotizave': Error: Cotizave HTTP Error 429`
   */
  describe('clasificación de HTTP 429 (límite de peticiones)', () => {
    it('reporta el 429 como cuota agotada y no como servicio no disponible', async () => {
      (window as unknown as Record<string, unknown>)['electron'] = {
        fetchCotizave: vi.fn(async () => {
          throw new Error('Cotizave HTTP Error 429');
        }),
      };

      await svc.fetchRates();

      const msg = svc.error();
      expect(msg).not.toBeNull();
      expect(msg).toContain('429');
      expect(msg).toContain('cuota');
      // Le dice al operador qué hacer: esperar, sin tocar la key ni reiniciar.
      // Voseo, igual que las ramas hermanas de este mismo handler.
      expect(msg).toContain('esperá');
      // Cualquier duración citada sale de la opción del circuito, no de un literal.
      expect(msg).toContain(
        `${Math.round(svc.circuitBreaker.options.cooldownPeriodMs / 1000)} s`,
      );
      // El diagnóstico anterior mentía: el servicio NO estaba caído...
      expect(msg).not.toContain('no disponible');
      // ...y la key NO era inválida. Un 429 prueba lo contrario.
      expect(msg).not.toContain('inválida');
      expect(msg).not.toContain('401');
      expect(toast.error.mock.calls[0]?.[0]).toBe(msg);
    });

    it('clasifica igual la causa limpia y la envuelta por el IPC de Electron', async () => {
      // El wrapper de Electron es serialización, no diagnóstico: si la
      // clasificación dependiera de él, el mensaje al operador llevaría
      // `Error invoking remote method` y el nombre del canal por delante.
      (window as unknown as Record<string, unknown>)['electron'] = {
        fetchCotizave: vi.fn(async () => {
          throw new Error(
            "Error invoking remote method 'p2p:fetch-cotizave': Error: Cotizave HTTP Error 429",
          );
        }),
      };
      await svc.fetchRates();
      const wrappedMsg = svc.error();

      (window as unknown as Record<string, unknown>)['electron'] = {
        fetchCotizave: vi.fn(async () => {
          throw new Error('Cotizave HTTP Error 429');
        }),
      };
      await svc.fetchRates();
      const cleanMsg = svc.error();

      expect(wrappedMsg).not.toBeNull();
      expect(wrappedMsg).toBe(cleanMsg);
      expect(wrappedMsg).toContain('429');
      // Ninguna capa interna puede filtrarse a la UI.
      expect(wrappedMsg).not.toContain('Error invoking remote method');
      expect(wrappedMsg).not.toContain('p2p:fetch-cotizave');
    });

    it('clasifica la forma del puente local del navegador como el mismo límite de peticiones', async () => {
      // Camino navegador: la API directa se bloquea y el puente local responde 429.
      const fetchMock = vi
        .fn<FetchLike>()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({ ok: false, status: 429 } as unknown as Response);
      vi.stubGlobal('fetch', fetchMock);

      await svc.fetchRates();

      const msg = svc.error();
      expect(msg).not.toBeNull();
      expect(msg).toContain('429');
      expect(msg).toContain('cuota');
      expect(msg).not.toContain('no disponible');
      expect(msg).not.toContain('inválida');
    });

    it('conserva el diagnóstico de contrato roto para un 200 sin datos y no lo llama límite de peticiones', async () => {
      // Regresión: un 200-basura es un upstream que rompió su contrato, no una
      // cuota agotada. Es un modo de fallo distinto y con otra acción.
      vi.stubGlobal(
        'fetch',
        vi.fn<FetchLike>(async () => jsonResponse({ unexpected: 'shape' })),
      );

      await svc.fetchRates();

      const msg = svc.error();
      expect(msg).not.toBeNull();
      expect(msg?.toLowerCase()).toContain('sin datos reconocibles');
      expect(msg).toContain('200');
      expect(msg).not.toContain('429');
      expect(msg?.toLowerCase()).not.toContain('cuota');
    });

    it('sigue sirviendo la caché y no expone el error de cuota cuando el 429 llega con rates válidos', async () => {
      vi.stubGlobal('fetch', vi.fn<FetchLike>(async () => jsonResponse(RATES_PAYLOAD)));
      await svc.fetchRates();
      expect(Object.keys(svc.ratesByMarket()).length).toBeGreaterThan(0);

      (window as unknown as Record<string, unknown>)['electron'] = {
        fetchCotizave: vi.fn(async () => {
          throw new Error('Cotizave HTTP Error 429');
        }),
      };

      await svc.fetchRates();

      expect(svc.ratesByMarket()['binance']).toBeDefined();
      const warnMsg = toast.warn.mock.calls.at(-1)?.[0] as string | undefined;
      expect(warnMsg).toContain('cacheadas');
      // Con caché manda el aviso de dato viejo: la clasificación no lo reemplaza.
      expect(svc.error()).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  /**
   * The circuit breaker only gates at ENTRY: `execute()` reads the state once
   * and, because `maxRetries: 1` means exactly one attempt, N concurrent
   * `fetchRates()` calls that all observe `CLOSED` each fire their own real
   * request. The breaker cannot stop a herd it has not seen yet. That is what
   * collapsed a single app launch into 10 real HTTP 429s from Cotizave.
   */
  describe('in-flight deduplication', () => {
    it('collapses a burst of concurrent fetchRates() calls into a single network request', async () => {
      // The transport stays unanswered so every concurrent caller is provably
      // inside the same window, not a sequence of completed round-trips.
      let answer: ((response: Response) => void) | null = null;
      const fetchMock = vi.fn<FetchLike>(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const burst = [
        svc.fetchRates(),
        svc.fetchRates(),
        svc.fetchRates(),
        svc.fetchRates(),
        svc.fetchRates(),
      ];

      // All five calls were issued before the first request could answer.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      answer!(jsonResponse(RATES_PAYLOAD));
      await Promise.all(burst);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      // The shared execution still does the real work for every caller.
      expect(svc.ratesByMarket()['binance']).toBeDefined();
      expect(svc.ratesByMarket()['oficial']).toBeDefined();
      expect(svc.lastFetched()).not.toBeNull();
      expect(svc.error()).toBeNull();
      expect(svc.loading()).toBe(false);
    });

    it('issues a fresh network request after a shared flight fails', async () => {
      // A rejected flight must not stay cached as the in-flight promise: if it
      // did, every later call would silently reuse one dead attempt and the
      // service would never recover without a restart.
      const failingMock = vi.fn<FetchLike>().mockRejectedValue(new TypeError('Failed to fetch'));
      vi.stubGlobal('fetch', failingMock);

      await Promise.all([svc.fetchRates(), svc.fetchRates()]);

      // Direct API plus local bridge, once: the two callers shared one flight.
      expect(failingMock).toHaveBeenCalledTimes(2);
      expect(svc.error()).not.toBeNull();

      const recoveringMock = vi.fn<FetchLike>(async () => jsonResponse(RATES_PAYLOAD));
      vi.stubGlobal('fetch', recoveringMock);

      await svc.fetchRates();

      expect(recoveringMock).toHaveBeenCalledTimes(1);
      expect(svc.ratesByMarket()['binance']).toBeDefined();
      expect(svc.error()).toBeNull();
    });

    it('keeps concurrent calls to different endpoints on separate network requests', async () => {
      const requestedUrls: string[] = [];
      const fetchMock = vi.fn<FetchLike>(async (input) => {
        requestedUrls.push(String(input));
        return jsonResponse(RATES_PAYLOAD);
      });
      vi.stubGlobal('fetch', fetchMock);
      const fetchByEndpoint = svc.fetchRates.bind(svc) as unknown as FetchRatesByEndpoint;

      await Promise.all([fetchByEndpoint('rates'), fetchByEndpoint('other')]);

      // Keying the in-flight map by endpoint is what keeps a 'rates' caller from
      // being served another endpoint's response.
      expect(requestedUrls).toContain('https://api.cotizave.com/v1/fx/rates');
      expect(requestedUrls).toContain('https://api.cotizave.com/v1/fx/other');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('vencimiento en vivo (no solo al arrancar)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('deja de servir la cache restaurada cuando el reloj pasa los 15 min DESPUES de hidratar', async () => {
      // Semilla dentro del TTL: a los ojos del arranque la cache es válida, que es
      // justamente el hueco que el descarte de arranque no cubría.
      storage.set<PersistedRates>(RATES_STORAGE_KEY, {
        rates: {
          binance: { market: 'binance', type: 'p2p', ask: 800, bid: 795 },
          oficial: { market: 'oficial', type: 'reference', ask: 36.5, bid: 36.2 },
        },
        fetchedAt: new Date(Date.now() - (COTIZAVE_CACHE_MAX_AGE_MS - 60_000)).toISOString(),
      });

      // Reloj falso ANTES de hidratar: el vencimiento tiene que quedar armado en el
      // mismo reloj que el test adelanta, si no el test no puede observar nada.
      vi.useFakeTimers();
      const fresh = await newServiceOver(mem);

      // Punto de partida observable: hidratada, restaurada y legible.
      expect(Object.keys(fresh.ratesByMarket()).length).toBeGreaterThan(0);
      expect(fresh.ratesProvenance()).toBe('restored');
      expect(fresh.error()).toBeNull();

      // Seis horas después: la cache tiene 6 h 1 min de antigüedad.
      await vi.advanceTimersByTimeAsync(6 * 3_600_000);

      expect(Object.keys(fresh.ratesByMarket())).toHaveLength(0);
      expect(fresh.ratesProvenance()).toBe('none');
      expect(fresh.lastFetched()).toBeNull();
      expect(fresh.error()).not.toBeNull();
      expect(fresh.error()).toContain('15');
      // La copia persistida no se resucita en el próximo arranque.
      expect(storage.get(RATES_STORAGE_KEY)).toBeNull();
    });

    it('vence igual una cache que envejece en memoria despues de un fetch en vivo', async () => {
      vi.useFakeTimers();
      const fresh = await newServiceOver(mem);

      vi.stubGlobal('fetch', vi.fn<FetchLike>(async () => jsonResponse(RATES_PAYLOAD)));
      await fresh.fetchRates();
      expect(fresh.ratesProvenance()).toBe('live');
      expect(Object.keys(fresh.ratesByMarket()).length).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(COTIZAVE_CACHE_MAX_AGE_MS + 60_000);

      expect(Object.keys(fresh.ratesByMarket())).toHaveLength(0);
      expect(fresh.ratesProvenance()).toBe('none');
    });

    it('ngOnDestroy limpia el temporizador de vencimiento', async () => {
      // Sin rates en memoria no hay temporizador que limpiar: hay que hidratar
      // primero para que la cuenta regresiva exista.
      storage.set<PersistedRates>(RATES_STORAGE_KEY, {
        rates: {
          binance: { market: 'binance', type: 'p2p', ask: 800, bid: 795 },
          oficial: { market: 'oficial', type: 'reference', ask: 36.5, bid: 36.2 },
        },
        fetchedAt: new Date(Date.now() - 60_000).toISOString(),
      });
      vi.useFakeTimers();
      const fresh = await newServiceOver(mem);

      expect(vi.getTimerCount()).toBe(1);
      fresh.ngOnDestroy();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  /**
   * `formatCotizaveDataAge` se muestra al operador en el dashboard, la
   * triangulación y Telegram, así que sus saltos de escala son parte del
   * diagnóstico: un minuto redondeado a 0, una hora mostrada como 60 min o un
   * reloj adelantado leído como una antigüedad negativa cambian lo que el
   * operador cree que está operando. Se cubre la escala completa con `now`
   * explícito, sin depender del reloj real ni de fake timers.
   */
  describe('formatCotizaveDataAge', () => {
    const NOW = new Date('2026-09-29T12:00:00.000Z').getTime();
    const at = (msAgo: number) => new Date(NOW - msAgo);

    const cases: readonly { readonly msAgo: number; readonly expected: string }[] = [
      { msAgo: 0, expected: 'hace menos de 1 min' },
      { msAgo: 59_999, expected: 'hace menos de 1 min' },
      { msAgo: 60_000, expected: 'hace 1 min' },
      { msAgo: 4 * 60_000, expected: 'hace 4 min' },
      // 59.9 min: sigue siendo minutos, todavía no "1 h".
      { msAgo: 3_599_000, expected: 'hace 59 min' },
      { msAgo: 3_600_000, expected: 'hace 1 h' },
      { msAgo: 5 * 3_600_000, expected: 'hace 5 h' },
      { msAgo: 23 * 3_600_000 + 59 * 60_000, expected: 'hace 23 h' },
      { msAgo: 86_400_000, expected: 'hace 1 d' },
      { msAgo: 3 * 86_400_000, expected: 'hace 3 d' },
    ];

    it.each(cases)('traduce $msAgo ms a "$expected"', ({ msAgo, expected }) => {
      expect(formatCotizaveDataAge(at(msAgo), NOW)).toBe(expected);
    });

    it('no inventa una edad futura cuando el reloj de Cotizave va adelantado', () => {
      // Reloj de máquina desincronizado: `now - from` sale negativo y un `Math.floor`
      // sin tope imprimiría "hace -3 min", que el operador leería como dato del futuro.
      expect(formatCotizaveDataAge(new Date(NOW + 3 * 60_000), NOW)).toBe('hace menos de 1 min');
    });

    it.each([
      { label: 'null', value: null },
      { label: 'undefined', value: undefined },
      { label: 'Invalid Date', value: new Date(Number.NaN) },
    ])('devuelve el texto de sesión anterior para $label', ({ value }) => {
      expect(formatCotizaveDataAge(value, NOW)).toBe('una sesión anterior');
    });
  });

  describe('guard de frescura (refreshIfStale)', () => {
    it('omite la llamada de red si las tasas tienen menos de maxAgeMs', async () => {
      const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(RATES_PAYLOAD));
      vi.stubGlobal('fetch', fetchMock);

      await svc.fetchRates();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // refreshIfStale omite la llamada si el dato es fresco
      await svc.refreshIfStale('rates', COTIZAVE_MIN_FETCH_INTERVAL_MS);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('ejecuta la llamada de red si las tasas superan maxAgeMs o no existen', async () => {
      const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(RATES_PAYLOAD));
      vi.stubGlobal('fetch', fetchMock);

      // Sin rates previos, refreshIfStale siempre consulta
      await svc.refreshIfStale('rates', COTIZAVE_MIN_FETCH_INTERVAL_MS);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Con maxAgeMs = 0 (forzar expiración)
      await svc.refreshIfStale('rates', 0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('omite la llamada de red silenciosamente si el circuito está abierto (OPEN)', async () => {
      const fetchMock = vi.fn<FetchLike>(async () => {
        throw new Error('Cotizave HTTP Error 429');
      });
      vi.stubGlobal('fetch', fetchMock);

      await svc.fetchRates();
      await svc.fetchRates();
      await svc.fetchRates();
      expect(svc.circuitBreaker.getMetrics().state).toBe('OPEN');

      const countBefore = fetchMock.mock.calls.length;
      await svc.refreshIfStale('rates', 0);
      expect(fetchMock.mock.calls.length).toBe(countBefore);
    });
  });
});
