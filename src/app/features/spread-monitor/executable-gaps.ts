/**
 * Brechas ejecutables de la tabla de triangulación.
 *
 * POR QUÉ ESTE MÓDULO EXISTE Y NO UN CÁLCULO EN LA VISTA:
 * `https://api.cotizave.com/v1/fx/rates` (con `X-API-Key`) devuelve, por tasa,
 * únicamente `mid`. La forma real del payload es
 *
 * ```
 * { country, currency, base,
 *   rates: [ { market, type, base, mid, updated_at, effective_date }, ... ],
 *   index: { value, version, as_of, weights, components: { bcv, p2p, paralelo },
 *            p2p_median, p2p_count, flags, methodology_url },
 *   fetched_at }
 * ```
 *
 * No hay `ask` ni `bid` en ninguna parte, y las entradas `type: "p2p"` tampoco
 * traen `base`. Un `mid` es UN número: no describe una oferta ni una demanda, así
 * que no tiene spread ni profundidad. Restarle dos mids produce un número con
 * apariencia de brecha que nadie puede ejecutar, y ese es exactamente el modo de
 * falla que este módulo se niega a reproducir: la app informa decisiones de trade
 * con plata real.
 *
 * REGLA DE ORO ("solo brechas ejecutables"): una brecha se emite ÚNICAMENTE
 * cuando los dos lados son libros de órdenes reales. Todo lo demás es un ancla
 * indicativa, con su número y su etiqueta, y sin ninguna brecha derivada.
 *
 * Los dos únicos mercados con libro de órdenes propio en la app son Binance
 * (`BinanceP2pService.marketDepth()`) y Bybit (`BybitP2pService`). Todos los
 * demás venues de Cotizave (`bitget`, `okx`, `bingx`, `mexc`, `saldo`,
 * `eur_reference`) son un `mid` y nada más. Y `oficial` (BCV) más `parallel` son
 * dos tasas únicas: el diferencial entre ellas es la señal regulatoria que
 * calcula `calculateBcvGap` en core y consume el comando `/bcv` de Telegram. Es
 * una señal real y valiosa, pero NO es arbitraje —no hay nada que ejecutar— así
 * que aquí no se le inventa ninguna brecha.
 */

import { computeTriangulationGap, type CotizaveRate } from '@p2p/core';
import type { CotizaveRatesProvenance } from '../../core/cotizave.service';
import type { MarketDataMode } from '../../core/bybit-p2p.service';

/** Par de gaps de una fila: los dos lados del cruce, o ninguno. */
export interface TriangulationGaps {
  gapVes: number | null;
  gapPct: number | null;
}

/**
 * La respuesta honesta a "no hay dos libros": sin número, sin honestidad
 * prestada. Se exporta para que ninguna ruta pueda construir un gap a medias.
 */
export const NO_GAP: TriangulationGaps = { gapVes: null, gapPct: null };

/**
 * Qué clase de dato sostiene la fila. Decide si puede haber brecha: solo
 * `executable` puede.
 */
export type TriangulationRowKind = 'executable' | 'anchor' | 'reference';

/**
 * Una pata de libro de órdenes: lo que se PAGA (mejor ask) y lo que se RECIBE
 * (mejor bid). Los dos números salen del libro; ninguno es un `mid`.
 */
export interface LiveBookLeg {
  payPrice: number;
  receivePrice: number;
}

/** Los dos únicos mercados con libro de órdenes propio. */
export interface VenueBooks {
  binance: LiveBookLeg | null;
  bybit: LiveBookLeg | null;
}

/** El venue con el que la app puede cruzar contra Binance. */
export const EXECUTABLE_MARKET = 'bybit';

/**
 * Tasas únicas de referencia, no libros. `reference` llega normalizado como
 * `oficial` (`normalizeMarketKey` en core) y `bcv` es el nombre que usan
 * algunos estados históricos. `parallel` es el paralelo. Los tres son números
 * reales; ninguno es un libro.
 */
const REFERENCE_MARKETS = new Set(['oficial', 'bcv', 'parallel']);

/** Etiquetas: la fila tiene que decir de qué clase de dato es, no insinuarlo. */
export const ANCHOR_LABEL =
  'Ancla indicativa: es el mid que publica Cotizave, no un libro de órdenes. Sin oferta ni demanda no hay brecha ejecutable.';
export const REFERENCE_LABEL =
  'Tasa de referencia única (señal regulatoria, no libro). El diferencial oficial-paralelo se mide aparte, en el reporte /bcv.';
export const EXECUTABLE_LABEL =
  'Dos libros de órdenes en vivo: la brecha se puede ejecutar en ambos sentidos.';

/** La evidencia que decide si la pata de Bybit es real o un default de demo. */
export interface BybitQuoteEvidence {
  mode: MarketDataMode;
  /** Mejor oferta vendedora de Bybit = lo que se PAGA. `null` si no hay libro. */
  bestSellOffer: { price: number } | null;
  /** Mejor oferta compradora de Bybit = lo que se RECIBE. `null` si no hay libro. */
  bestBuyOffer: { price: number } | null;
  lastFetched: Date | null;
}

export interface BybitQuoteVerdict {
  /** Libro real, o `null` cuando no hay evidencia de uno. */
  leg: LiveBookLeg | null;
  /** Por qué no hay libro. Nunca vacío: el operador tiene que saber la razón. */
  reason: string;
}

function isPositive(v: number | undefined | null): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * DECISIÓN DE DISEÑO — por qué la puerta mira `bestSellOffer`/`bestBuyOffer` y
 * NO `buyPrice`/`sellPrice`:
 *
 * `BybitP2pService.buyPrice` y `sellPrice` arrancan en 808.5 y 813.0, que son
 * constantes de demo escritas a mano. `refresh()` los sobreescribe con el libro
 * real, pero entre el arranque y el primer `refresh()` —y cada vez que el
 * puente falla y el servicio vuelve a modo `demo`— esos dos números siguen ahí,
 * con apariencia de precio. Construir una brecha "en vivo" sobre ellos sería
 * fabricar un número ejecutable a partir de una constante.
 *
 * Los `bestXOffer` no tienen ese problema: solo los escribe el camino que ya
 * validó un libro real, y se quedan en `null` hasta que eso ocurre. Leyendo el
 * precio DENTRO de la oferta, el default de demo deja de ser alcanzable por
 * construcción: no es una condición que haya que recordar, es una ruta que no
 * existe.
 *
 * `mode` y `lastFetched` son la segunda red, no la primera: `mode === 'live'` se
 * activa al guardar credenciales (antes de cotizar) y `lastFetched` solo lo
 * escribe un `refresh()` exitoso, así que exige las tres señales y da un motivo
 * distinto a cada falta.
 */
export function resolveBybitBook(evidence: BybitQuoteEvidence): BybitQuoteVerdict {
  if (evidence.mode !== 'live') {
    return {
      leg: null,
      reason:
        'Bybit está en modo demo: sus precios por defecto no son un libro de órdenes, así que no hay brecha ejecutable.',
    };
  }
  if (!evidence.lastFetched) {
    return {
      leg: null,
      reason:
        'Bybit no registró ninguna consulta en vivo: los precios por defecto de demo no son una cotización y no pueden generar una brecha.',
    };
  }
  const payPrice = evidence.bestSellOffer?.price;
  const receivePrice = evidence.bestBuyOffer?.price;
  if (!isPositive(payPrice) || !isPositive(receivePrice)) {
    return {
      leg: null,
      reason:
        'Bybit no tiene las dos puntas reales del libro: sin oferta compradora y vendedora no se puede cruzar nada.',
    };
  }
  return { leg: { payPrice, receivePrice }, reason: 'Libro de Bybit en vivo.' };
}

/**
 * Las dos brechas ejecutables del par Binance ↔ Bybit, o ninguna de las dos.
 *
 * `computeTriangulationGap` usa la convención de core, que conviene no interpretar
 * a ojo: su parámetro `bid` es "lo que se PAGA" y su `ask` es "lo que se
 * RECIBE" (está documentado en `projects/core/src/lib/cotizave.ts`). Por eso acá
 * se le pasan `payPrice` como `bid` y `receivePrice` como `ask`:
 *
 * - `gapForward`: se PAGA en Binance, se RECIBE en Bybit.
 * - `gapReverse`: se PAGA en Bybit, se RECIBE en Binance.
 *
 * Faltando cualquiera de los dos libros devuelve `NO_GAP` en AMBOS sentidos: una
 * brecha a medias no es una brecha.
 */
export function computeExecutableGaps(books: VenueBooks): {
  gapForward: TriangulationGaps;
  gapReverse: TriangulationGaps;
} {
  const { binance, bybit } = books;
  if (!binance || !bybit) {
    return { gapForward: NO_GAP, gapReverse: NO_GAP };
  }
  return {
    gapForward: computeTriangulationGap(
      { bid: binance.payPrice },
      { ask: bybit.receivePrice },
    ),
    gapReverse: computeTriangulationGap({ bid: bybit.payPrice }, { ask: binance.receivePrice }),
  };
}

export interface TriangulationRow {
  market: string;
  kind: TriangulationRowKind;
  /** Lo que se PAGA acá. Solo hay valor si hay libro real detrás. */
  payPrice: number | null;
  /** Lo que se RECIBE acá. Solo hay valor si hay libro real detrás. */
  receivePrice: number | null;
  /** El `mid` de Cotizave. Un número real, pero un número solo. */
  mid: number | null;
  /** Qué es esta fila y por qué tiene o no tiene brecha. Nunca vacía. */
  label: string;
  updated_at: string | undefined;
  /**
   * Linaje del FETCH que produjo la fila, no de la tasa: `updated_at` es el
   * sello del upstream por tasa y no dice cuándo se descargó el conjunto.
   * Obligatorio a propósito: una fila sin reloj ni procedencia es un número
   * viejo presentado como fresco.
   */
  provenance: CotizaveRatesProvenance;
  fetchedAt: Date | null;
  dataAge: string;
  gapForward: TriangulationGaps;
  gapReverse: TriangulationGaps;
}

/** Linaje compartido por todas las filas: viene del mismo fetch. */
export interface TriangulationLineage {
  provenance: CotizaveRatesProvenance;
  fetchedAt: Date | null;
  dataAge: string;
}

/**
 * Construye la fila de un venue. La regla de oro vive acá: `executable` exige
 * los dos libros, y toda otra clase de fila sale con `NO_GAP` en los dos
 * sentidos, sin importar cuánto "se parezca" un mid a un precio de libro.
 *
 * `executableGapReason` es el motivo ya compuesto por el llamador para el caso
 * "no hay brecha ejecutable"; solo se usa si la fila efectivamente no es
 * ejecutable.
 */
export function buildTriangulationRow(
  market: string,
  rate: CotizaveRate,
  books: VenueBooks,
  executableGapReason: string,
  lineage: TriangulationLineage,
): TriangulationRow {
  const mid = isPositive(rate.mid) ? rate.mid : null;
  const base = {
    market,
    mid,
    updated_at: rate.updated_at,
    ...lineage,
  };

  if (REFERENCE_MARKETS.has(market)) {
    return {
      ...base,
      kind: 'reference',
      payPrice: null,
      receivePrice: null,
      label: REFERENCE_LABEL,
      gapForward: NO_GAP,
      gapReverse: NO_GAP,
    };
  }

  if (market === EXECUTABLE_MARKET) {
    if (!books.binance || !books.bybit) {
      return {
        ...base,
        kind: 'anchor',
        payPrice: null,
        receivePrice: null,
        label: executableGapReason,
        gapForward: NO_GAP,
        gapReverse: NO_GAP,
      };
    }
    return {
      ...base,
      kind: 'executable',
      payPrice: books.bybit.payPrice,
      receivePrice: books.bybit.receivePrice,
      label: EXECUTABLE_LABEL,
      ...computeExecutableGaps(books),
    };
  }

  return {
    ...base,
    kind: 'anchor',
    payPrice: null,
    receivePrice: null,
    label: ANCHOR_LABEL,
    gapForward: NO_GAP,
    gapReverse: NO_GAP,
  };
}
