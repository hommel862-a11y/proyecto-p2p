import {
  getParallelRatesFeed,
  type ParallelLiveReading,
} from '../core/index.js';
import { GetParallelRatesInputSchema, type GetParallelRatesInput } from '../schemas/index.js';
import { fetchBinanceLiveRates } from './fetch_cross_exchange_spread.js';

/**
 * Fetches live parallel quotes from the monitors this daemon can actually reach.
 *
 * Binance P2P's public C2C endpoint needs no credentials, so it is the one venue
 * wired here — through the same reader `fetch_cross_exchange_spread` uses, not a
 * second client with its own idea of the book.
 *
 * EnParaleloVzla, CriptoNoticias and CotizaVe have no adapter in this daemon, so
 * they are absent rather than approximated. With only one venue there is no
 * cross-venue comparison to draw, and the feed reports exactly that.
 */
export async function fetchParallelLiveReadings(): Promise<ParallelLiveReading[]> {
  const reading = toParallelReading(await fetchBinanceLiveRates('USDT', 'VES'));
  return reading ? [reading] : [];
}

/**
 * Turns a Binance book into a parallel reading, or `null` when it cannot be
 * trusted.
 *
 * Split out from the fetch so the two decisions that carry real risk — which
 * side is the ask, and whether the book is coherent — are testable without a
 * network call.
 */
export function toParallelReading(
  rates: { buyRate: number; sellRate: number } | null,
): ParallelLiveReading | null {
  if (!rates) return null;

  // Binance orientation: `buyRate` is the cheapest maker selling, so it is what
  // we would pay — our ask. `sellRate` is the dearest maker buying, so it is what
  // we would receive — our bid. Swapping them would invert every spread the feed
  // computes downstream.
  const ask = rates.buyRate;
  const bid = rates.sellRate;
  if (!Number.isFinite(ask) || ask <= 0) return null;
  if (!Number.isFinite(bid) || bid <= 0) return null;

  // The two sides come from two independent requests, so a crossed book is
  // possible in a thin market: the cheapest maker selling can sit below the
  // dearest maker buying. Downstream, `spreadPct = (ask - bid) / bid`, so a
  // crossed reading publishes a negative spread that reads as a real arbitrage.
  // A number that describes an impossible market is worse than no number.
  if (ask < bid) return null;

  return {
    source: 'Binance P2P',
    ask,
    bid,
    fetchedAt: new Date().toISOString(),
  };
}

export const getParallelRatesTool = {
  name: 'get_parallel_rates',
  description:
    'Obtiene cotizaciones paralelas del dólar en Venezuela de los monitores leídos en vivo. Sólo publica un monitor que fue realmente consultado; sin lectura declara la ausencia en vez de mostrar un punto medio de ejemplo.',
  inputSchema: GetParallelRatesInputSchema,
  execute: async (input: GetParallelRatesInput) => {
    const readings = await fetchParallelLiveReadings();
    const feed = getParallelRatesFeed(input.includeSources, readings);

    const nd = (value: number | null, decimals = 2): string =>
      value == null ? 'N/D' : value.toFixed(decimals);

    return {
      timestamp: feed.timestamp,
      sourcesCount: Object.keys(feed.sources).length,
      sources: feed.sources,
      summary: feed.summary,
      provenance: feed.provenance,
      unavailableReason: feed.unavailableReason,
      expectedSource: feed.expectedSource,
      actionable: feed.actionable,
      recommendation:
        feed.provenance === 'LIVE'
          ? `Punto medio de los monitores leídos: ${nd(feed.summary.averageMid)} VES · Dispersión: ${nd(feed.summary.dispersionPct)}%`
          : `Sin cotizaciones en vivo (${feed.unavailableReason}). Fuentes requeridas: ${feed.expectedSource}.`,
    };
  },
};