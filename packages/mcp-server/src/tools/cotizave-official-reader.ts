import type { BcvLiveReading } from '../core/index.js';

/**
 * Reader for the official BCV anchor, served by Cotizave.
 *
 * Verified from this repository (`src/app/core/cotizave.service.ts` and
 * `projects/core/src/lib/cotizave.ts`):
 *
 *   GET https://api.cotizave.com/v1/fx/rates
 *   headers: X-API-Key: <key>, Accept: application/json
 *
 * ...which is a **credentialed commercial endpoint**, not a public one. It
 * answers 401 on a bad key and 403 when the plan does not include the endpoint.
 *
 * The payload carries the official anchors as separate markets:
 * `reference` → USD official, `eur_reference` → EUR official. There is no
 * evidence of any market carrying CNY or RUB, so `parseCotizaveOfficialReading`
 * leaves those `null` rather than deriving them from a neighbouring currency.
 */
export const COTIZAVE_RATES_URL = 'https://api.cotizave.com/v1/fx/rates';

/** Markets in the payload that are the official anchor, and the currency each one carries. */
const OFFICIAL_MARKETS: Record<string, 'usd' | 'eur'> = {
  reference: 'usd',
  bcv: 'usd',
  eur_reference: 'eur',
};

/** A rate must be a positive finite number. `0`, `NaN` and `'mucho'` are not rates. */
function toRate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolves one official rate from a single payload entry.
 * Prefers `mid`; falls back to the midpoint of `ask`/`bid`, then to either side.
 */
function rateFromEntry(entry: Record<string, unknown>): number | null {
  const mid = toRate(entry['mid']);
  if (mid !== null) return mid;

  const ask = toRate(entry['ask']);
  const bid = toRate(entry['bid']);
  if (ask !== null && bid !== null) return (ask + bid) / 2;
  if (ask !== null) return ask;
  if (bid !== null) return bid;
  return null;
}

function normalizeMarket(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[-\s]+/g, '_');
}

/**
 * Turns a Cotizave payload into an official BCV reading, or `null`.
 *
 * Returns `null` — not a partial object with zeroes — when the payload carries
 * no usable official rate at all. A partial reading is only returned when at
 * least one real official rate was found.
 */
export function parseCotizaveOfficialReading(payload: unknown): BcvLiveReading | null {
  if (!payload || typeof payload !== 'object') return null;

  const raw = payload as Record<string, unknown>;
  const rates: unknown[] = Array.isArray(raw['rates']) ? raw['rates'] : [];
  if (rates.length === 0) return null;

  let usd: number | null = null;
  let eur: number | null = null;
  const source = new Set<string>();
  let effectiveDate: string | null =
    raw['fetched_at'] != null ? String(raw['fetched_at']) : null;

  for (const candidate of rates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const entry = candidate as Record<string, unknown>;

    const market = normalizeMarket(entry['market']);
    const currency = OFFICIAL_MARKETS[market];
    if (!currency) continue;

    const rate = rateFromEntry(entry);
    if (rate === null) continue;

    if (currency === 'usd') usd = rate;
    else eur = rate;

    source.add(`cotizave:${market}`);
    if (effectiveDate === null && entry['updated_at'] != null) {
      effectiveDate = String(entry['updated_at']);
    }
  }

  if (usd === null && eur === null) return null;

  return {
    usd,
    eur,
    cny: null,
    rub: null,
    effectiveDate,
    source: [...source].sort().join(' + '),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetches the official rate from Cotizave.
 *
 * Returns `null` when there is no credential, when the endpoint refuses the
 * request, or when the transport fails. It never throws and never substitutes a
 * number: a missing API key and an unreachable endpoint both mean "no reading",
 * and the caller declares the absence.
 *
 * Set `COTIZAVE_API_KEY` to enable it. `COTIZAVE_RATES_URL` is exported as a
 * constant so a change on their side is a one-line correction, not a search.
 */
export async function fetchCotizaveOfficialReading(): Promise<BcvLiveReading | null> {
  const apiKey = process.env['COTIZAVE_API_KEY'];
  if (!apiKey) return null;

  try {
    const response = await fetch(COTIZAVE_RATES_URL, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    return parseCotizaveOfficialReading(await response.json());
  } catch {
    // A transport failure is an absence, not an error worth surfacing as data.
    return null;
  }
}