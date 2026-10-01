import { getOfficialBcvRates, type BcvLiveReading } from '../core/index.js';
import { GetBcvRatesInputSchema, type GetBcvRatesInput } from '../schemas/index.js';
import { fetchCotizaveOfficialReading } from './cotizave-official-reader.js';

/**
 * Fetches the official rate from Cotizave.
 *
 * The endpoint is credentialed (`X-API-Key`); with no `COTIZAVE_API_KEY` in the
 * environment the reading arrives as `null` and the tool declares the absence
 * rather than emitting a number. The wire contract lives in
 * `./cotizave-official-reader.ts`; this stays a thin seam over it.
 */
export async function fetchBcvLiveReading(): Promise<BcvLiveReading | null> {
  return fetchCotizaveOfficialReading();
}

export const getBcvRatesTool = {
  name: 'get_bcv_rates',
  description:
    'Consulta las tasas oficiales del Banco Central de Venezuela y su fecha valor. USD y EUR provienen del ancla oficial de Cotizave (`reference` y `eur_reference`); CNY y RUB se declaran N/D porque esta fuente no los publica. Sin API key o sin respuesta utilizable no emite tasa: declara la ausencia y la fuente requerida.',
  inputSchema: GetBcvRatesInputSchema,
  execute: async (input: GetBcvRatesInput) => {
    const reading = await fetchBcvLiveReading();
    const rates = getOfficialBcvRates(input.cacheFallback, reading);

    const describe = (code: string, value: number | null): string =>
      value == null ? `${code}: N/D` : `${code}: ${value.toFixed(2)} VES`;

    return {
      usd: rates.usd,
      eur: rates.eur,
      cny: rates.cny,
      rub: rates.rub,
      effectiveDate: rates.effectiveDate,
      source: rates.source,
      provenance: rates.provenance,
      unavailableReason: rates.unavailableReason,
      expectedSource: rates.expectedSource,
      actionable: rates.actionable,
      isFallback: rates.isFallback,
      timestamp: rates.timestamp,
      description:
        rates.provenance === 'LIVE'
          ? `Tasa oficial BCV — ${describe('USD', rates.usd)} · ${describe('EUR', rates.eur)} (fuente: ${rates.source})`
          : `Tasa oficial BCV no disponible (${rates.unavailableReason}). Fuente requerida: ${rates.expectedSource}. Monedas: ${describe('USD', rates.usd)} · ${describe('EUR', rates.eur)}.`,
    };
  },
};