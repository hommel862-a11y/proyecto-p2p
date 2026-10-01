import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCotizaveOfficialReading,
  parseCotizaveOfficialReading,
} from './cotizave-official-reader.js';
import { getBcvRatesTool } from './get_bcv_rates.js';

/**
 * The reader for the official BCV anchor.
 *
 * Two things this must never do, because both are the defect class this whole
 * effort is about:
 *
 * 1. Return a number no entry in the payload carried. Cotizave serves
 *    `reference` (USD) and `eur_reference` (EUR) as separate markets. It carries
 *    no CNY and no RUB in any payload this system has evidence of, so those stay
 *    `null`. Filling them from a neighbouring currency would be fabrication with
 *    extra steps.
 * 2. Name a source it did not read from. `source` is reported verbatim from the
 *    payload, or the reading is dropped.
 *
 * The payload shapes below are the ones this repository has evidence of, from
 * `projects/core/src/lib/cotizave.spec.ts`.
 */
describe('parseCotizaveOfficialReading', () => {
  const realPayload = {
    country: 'VE',
    base: 'VES',
    fetched_at: '2025-01-15T12:00:00Z',
    rates: [
      { market: 'reference', type: 'reference', base: 'USD', mid: 36.0, updated_at: '2025-01-15T12:00:00Z' },
      { market: 'eur_reference', type: 'reference', base: 'EUR', mid: 39.2, updated_at: '2025-01-15T12:00:00Z' },
      { market: 'binance_p2p', type: 'p2p', ask: 36.5, bid: 35.8, mid: 36.15 },
      { market: 'parallel', type: 'parallel', base: 'USD', mid: 37.9 },
    ],
  };

  it('mapea `reference` a la tasa oficial de USD', () => {
    const reading = parseCotizaveOfficialReading(realPayload);
    expect(reading).not.toBeNull();
    expect(reading!.usd).toBe(36.0);
  });

  it('mapea `eur_reference` a la tasa oficial de EUR', () => {
    const reading = parseCotizaveOfficialReading(realPayload);
    expect(reading!.eur).toBe(39.2);
  });

  it('NO inventa CNY ni RUB: el payload no los trae', () => {
    const reading = parseCotizaveOfficialReading(realPayload);
    expect(reading!.cny).toBeNull();
    expect(reading!.rub).toBeNull();
  });

  it('ignora mercados P2P y paralelo: no son la fuente oficial', () => {
    const reading = parseCotizaveOfficialReading(realPayload);
    // binance_p2p mid 36.15 y parallel mid 37.9 no deben filtrarse a `usd`.
    expect(reading!.usd).toBe(36.0);
  });

  it('lee la fecha valor del payload, no la hora del reloj', () => {
    const reading = parseCotizaveOfficialReading(realPayload);
    expect(reading!.effectiveDate).toBe('2025-01-15T12:00:00Z');
  });

  it('devuelve la lectura parcial cuando sólo llega una moneda', () => {
    const reading = parseCotizaveOfficialReading({
      rates: [{ market: 'reference', type: 'reference', base: 'USD', mid: 36.0 }],
    });
    expect(reading!.usd).toBe(36.0);
    expect(reading!.eur).toBeNull();
  });

  it('rechaza valores no positivos o no finitos en vez de coercionar', () => {
    const reading = parseCotizaveOfficialReading({
      rates: [
        { market: 'reference', type: 'reference', base: 'USD', mid: 0 },
        { market: 'eur_reference', type: 'reference', base: 'EUR', mid: 'mucho' },
      ],
    });
    // Ni 0 ni NaN son una tasa. Sin lectura utilizable, no hay lectura.
    expect(reading).toBeNull();
  });

  it('acepta el número como string, que es como lo manda la API', () => {
    const reading = parseCotizaveOfficialReading({
      rates: [{ market: 'reference', type: 'reference', base: 'USD', mid: '36.55' }],
    });
    expect(reading!.usd).toBe(36.55);
  });

  it('deriva el punto medio de ask/bid cuando la fuente no manda mid', () => {
    const reading = parseCotizaveOfficialReading({
      rates: [{ market: 'reference', type: 'reference', base: 'USD', ask: 36.1, bid: 35.9 }],
    });
    expect(reading!.usd).toBe(36.0);
  });

  describe('payloads que no son una lectura', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['un string', 'no soy un payload'],
      ['un array vacío', []],
      ['sin `rates`', { country: 'VE' }],
      ['rates vacío', { rates: [] }],
      ['rates con basura', { rates: [null, 42, 'x'] }],
      ['sin mercados reconocibles', { rates: [{ market: 'ruta_desconocida', mid: 36 }] }],
    ])('devuelve null ante %s', (_label, payload) => {
      expect(parseCotizaveOfficialReading(payload)).toBeNull();
    });
  });

  it('reporta la fuente tal cual, nombrando cada mercado leído', () => {
    const reading = parseCotizaveOfficialReading(realPayload);
    // Nombre exactamente los mercados que aportaron un número, ni uno más.
    expect(reading!.source).toBe('cotizave:eur_reference + cotizave:reference');
  });

  it('no nombra un mercado que no aportó ninguna lectura', () => {
    // Sólo llegó USD: la fuente no puede insinuar que también leyó EUR.
    const reading = parseCotizaveOfficialReading({
      rates: [{ market: 'reference', type: 'reference', base: 'USD', mid: 36.0 }],
    });
    expect(reading!.source).toBe('cotizave:reference');
  });
});

/**
 * End to end through the tool.
 *
 * The whole point of wiring a live source is that a real number can finally
 * reach the operator. That path needs its own proof, not just the parser's:
 * before this, `get_bcv_rates` could only ever return an absence, so no test
 * could tell "correctly refused" from "wired to nothing".
 */
describe('get_bcv_rates con el feed conectado', () => {
  const payload = {
    fetched_at: '2026-09-30T12:00:00Z',
    rates: [
      { market: 'reference', type: 'reference', base: 'USD', mid: 36.55 },
      { market: 'eur_reference', type: 'reference', base: 'EUR', mid: 39.8 },
    ],
  };

  it('deja pasar el número real cuando hay lectura', async () => {
    const reading = parseCotizaveOfficialReading(payload);
    expect(reading).not.toBeNull();

    // The contract the tool relies on: a real reading yields LIVE provenance
    // and the numbers arrive untouched.
    const { getOfficialBcvRates } = await import('../core/index.js');
    const rates = getOfficialBcvRates(false, reading);

    expect(rates.provenance).toBe('LIVE');
    expect(rates.usd).toBe(36.55);
    expect(rates.eur).toBe(39.8);
    expect(rates.unavailableReason).toBeNull();
    expect(rates.effectiveDate).toBe('2026-09-30T12:00:00Z');
    expect(rates.source).toBe('cotizave:eur_reference + cotizave:reference');
  });

  it('declara la ausencia nombrando el endpoint credentialed', async () => {
    const out = await getBcvRatesTool.execute({ cacheFallback: false } as any);

    // Without a reading the tool must not emit a rate, and must say which
    // source would satisfy it — naming the credential, not a public endpoint.
    expect(out.usd).toBeNull();
    expect(out.eur).toBeNull();
    expect(out.cny).toBeNull();
    expect(out.rub).toBeNull();
    expect(out.provenance).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
    expect(out.actionable).toBe(false);
    expect(out.expectedSource).toContain('X-API-Key');
    expect(out.description).toContain('no disponible');
  });

  it('declara N/D por moneda en vez de omitirla', async () => {
    const out = await getBcvRatesTool.execute({ cacheFallback: false } as any);
    // A consumer reading the text must be able to tell "no data" from "zero".
    expect(out.description).toContain('N/D');
  });
});

// ─── El transporte ───────────────────────────────────────────────────────────

/**
 * Hasta aquí todo probado era el parser. Nada de lo anterior toca `fetch`.
 *
 * Eso deja el transporte entero sin medir: la credencial, el header, el
 * cortocircuito sin clave, el 401, el 500, el JSON que no parsea. Y como los
 * tests de la herramienta corren sin `COTIZAVE_API_KEY`, todos cortan en
 * `if (!apiKey) return null` — con la suite en verde no había forma de
 * distinguir "se negó correctamente" de "está cableado a nada". Las dos dan
 * `null`, y `null` no es evidencia.
 *
 * Estos tests fijan el contrato de alambre con `fetch` simulado. La clave se
 * inyecta en `process.env` por test y se restaura exacta al terminar: los
 * tests de arriba asumen que no hay clave, y una que se fugara los volvería
 * irrelevantes.
 */

type FetchMock = ReturnType<typeof vi.fn>;

/** El reader sólo mira estos tres miembros de la respuesta. */
interface RespuestaStub {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

/** Reemplaza el `fetch` global y devuelve el mock para poder inspeccionarlo. */
function instalarFetch(respuesta: RespuestaStub): FetchMock {
  const mock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(respuesta));
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Igual, pero el transporte revienta antes de poder producir una respuesta. */
function instalarFetchQueFalla(error: unknown): FetchMock {
  const mock = vi.fn((_url: string, _init?: RequestInit) => Promise.reject(error));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('el transporte de Cotizave, que hasta ahora no tenía una sola prueba', () => {
  /** No es una credencial real: la clave viaja en un header, no se valida aquí. */
  const CLAVE = 'clave-de-prueba-no-real';

  /**
   * `857.8876` es una tasa BCV realmente observada (la del incidente que motivó
   * sacar los números inventados de `getOfficialBcvRates`). Por eso se exige que
   * llegue entera: un redondeo en el transporte produciría un número que nadie
   * cotizó, que es exactamente el defecto que esta suite persigue.
   */
  const payload = {
    fetched_at: '2026-09-30T12:00:00Z',
    rates: [
      { market: 'reference', type: 'reference', base: 'USD', mid: 857.8876, updated_at: '2026-09-30T12:00:00Z' },
      { market: 'eur_reference', type: 'reference', base: 'EUR', mid: 943.2145, updated_at: '2026-09-30T12:00:00Z' },
    ],
  };

  let clavePrevia: string | undefined;

  beforeEach(() => {
    // Se fotografía el entorno en vez de asumirlo: si alguien corre la suite con
    // una clave real puesta, estos tests igual miden lo que deben medir.
    clavePrevia = process.env['COTIZAVE_API_KEY'];
  });

  afterEach(() => {
    // Restauración exacta, incluida la ausencia. Un `= ''` dejaría el valor
    // definido y los tests de arriba dejarían de estar midiendo "sin credencial".
    if (clavePrevia === undefined) delete process.env['COTIZAVE_API_KEY'];
    else process.env['COTIZAVE_API_KEY'] = clavePrevia;
    vi.unstubAllGlobals();
  });

  describe('con credencial y respuesta 200', () => {
    it('deja pasar el número real hasta el operador, con provenance LIVE', async () => {
      process.env['COTIZAVE_API_KEY'] = CLAVE;
      instalarFetch({ ok: true, status: 200, json: async () => payload });

      const out = await getBcvRatesTool.execute({ cacheFallback: false });

      // El camino que faltaba probar de punta a punta. Antes sólo se ejercía el
      // parser en aislamiento y el corto circuito sin clave; que el número real
      // atraviese el transporte, el parser y la herramienta era una esperanza.
      expect(out.provenance).toBe('LIVE');
      expect(out.usd).toBe(857.8876);
      expect(out.eur).toBe(943.2145);
      expect(out.unavailableReason).toBeNull();
      expect(out.effectiveDate).toBe('2026-09-30T12:00:00Z');
      expect(out.source).toBe('cotizave:eur_reference + cotizave:reference');
      // No basta con que el número llegue al JSON: tiene que llegar al texto
      // que un operador lee de verdad.
      expect(out.description).toContain('USD: 857.89 VES');
    });

    it('manda la credencial en X-API-Key y pide JSON', async () => {
      process.env['COTIZAVE_API_KEY'] = CLAVE;
      const mock = instalarFetch({ ok: true, status: 200, json: async () => payload });

      await fetchCotizaveOfficialReading();

      expect(mock).toHaveBeenCalledTimes(1);
      // La URL va literal a propósito: derivarla de la constante exportada
      // haría que un endpoint equivocado pasara el test sin despeinar.
      expect(mock.mock.calls[0]?.[0]).toBe('https://api.cotizave.com/v1/fx/rates');
      // `toMatchObject` y no igualdad exacta: lo que importa es que la
      // credencial viaje, no que noViaje nada más.
      const init = mock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined;
      expect(init?.headers).toMatchObject({
        'X-API-Key': CLAVE,
        Accept: 'application/json',
      });
    });
  });

  describe('sin credencial', () => {
    it('ni toca la red ni inventa una lectura', async () => {
      delete process.env['COTIZAVE_API_KEY'];
      // Un stub que además devolvería una lectura válida: si el cortocircuito
      // desapareciera, este test vería un número y no un `null`.
      const mock = instalarFetch({ ok: true, status: 200, json: async () => payload });

      const reading = await fetchCotizaveOfficialReading();

      // Sin corto circuito, cada llamada sin clave sería un 401 garantizado.
      expect(mock).not.toHaveBeenCalled();
      expect(reading).toBeNull();
    });
  });

  describe('cuando no llega una lectura utilizable', () => {
    it.each([
      [401, 'clave inválida'],
      [403, 'plan que no incluye el endpoint'],
      [500, 'error del lado de ellos'],
    ])('declara ausencia ante HTTP %i (%s)', async (status) => {
      process.env['COTIZAVE_API_KEY'] = CLAVE;
      instalarFetch({
        ok: false,
        status,
        // Cuerpo deliberadamente hostil: uno que SÍ parsearía como lectura. La
        // API real devuelve un documento de error, pero el invariante que se
        // está midiendo es más fuerte: el status es el que manda y ningún
        // cuerpo puede colar una tasa por debajo de la guardia. Con un cuerpo
        // de error real este test pasaría aunque la guardia desapareciera,
        // porque el parser también lo rechaza — sería una prueba vacua.
        json: async () => payload,
      });

      // Un 401 no es un cero, ni un 36.0 de respaldo: es ausencia declarada.
      expect(await fetchCotizaveOfficialReading()).toBeNull();
    });

    it('absorbe un 200 cuyo cuerpo no es JSON', async () => {
      process.env['COTIZAVE_API_KEY'] = CLAVE;
      // Un HTML de error o un gateway mal configurado llegan con status 200: el
      // `ok` no alcanza y el `json()` revienta. El `catch` tiene que tragárselo.
      instalarFetch({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
      });

      expect(await fetchCotizaveOfficialReading()).toBeNull();
    });

    it('absorbe un fallo de transporte (DNS caído, sin salida)', async () => {
      process.env['COTIZAVE_API_KEY'] = CLAVE;
      // `TypeError: fetch failed` es lo que lanza undici cuando no resuelve o
      // no conecta. No es un error de la API: es no tener red.
      instalarFetchQueFalla(new TypeError('fetch failed'));

      // Un corte de red es una ausencia, no una excepción que tumbe la herramienta.
      expect(await fetchCotizaveOfficialReading()).toBeNull();
    });

    it('absorbe un timeout o cancelación', async () => {
      process.env['COTIZAVE_API_KEY'] = CLAVE;
      const mock = instalarFetchQueFalla(
        new DOMException('The operation was aborted', 'AbortError'),
      );

      expect(await fetchCotizaveOfficialReading()).toBeNull();
      // Sin reloj de por medio: se comprueba que la petición llevaba un
      // `AbortSignal`, que es lo que hace posible que un timeout la corte.
      // Quitar el timeout no rompería el `null`, sólo dejaría la herramienta
      // colgada esperando un endpoint que no contesta.
      const init = mock.mock.calls[0]?.[1] as { signal?: unknown } | undefined;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });
});