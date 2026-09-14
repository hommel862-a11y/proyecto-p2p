/**
 * Pure Cotizave API normalization and triangulation gap computation.
 * Framework-agnostic. No network, no Angular.
 */

export interface CotizaveRate {
  market: string;
  type: string;
  ask?: number;
  bid?: number;
  mid?: number;
  updated_at?: string;
}

export interface CotizaveRatesResult {
  country?: string;
  base?: string;
  rates: CotizaveRate[];
  fetched_at?: string;
}

const KNOWN_MARKET_ALIASES: Record<string, string> = {
  binance_p2p: 'binance',
  binance_p2p_ves: 'binance',
  bybit_p2p: 'bybit',
  bybit_p2p_ves: 'bybit',
  okx_p2p: 'okx',
  okx_p2p_ves: 'okx',
  bitget_p2p: 'bitget',
  bitget_p2p_ves: 'bitget',
  mexc_p2p: 'mexc',
  bingx_p2p: 'bingx',
  saldo: 'saldo',
  // "reference" is the official/BCV anchor rate the API serves as the
  // market's reference; consumers query it as the official BCV rate.
  reference: 'oficial',
  eur_reference: 'eur_reference',
  parallel: 'parallel',
};

/**
 * Types that carry a usable quote. The API marks different anchors with
 * `type` (p2p, reference, parallel, official); rejecting non-p2p types made
 * the BCV anchor disappear and /bcv always answer "no data".
 */
const ALLOWED_QUOTE_TYPES = new Set(['p2p', 'reference', 'parallel', 'official']);

function normalizeMarketKey(raw: string): string | null {
  const lower = raw.toLowerCase().trim().replace(/[-\s]+/g, '_');
  if (KNOWN_MARKET_ALIASES[lower]) return KNOWN_MARKET_ALIASES[lower];
  const stripped = lower.replace(/_p2p(_ves)?$/g, '');
  if (stripped && stripped !== lower) return stripped;
  if (/^[a-z][a-z0-9_]*$/.test(lower)) return lower;
  return null;
}

function toNum(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Build Cotizave API request headers.
 */
export function buildCotizaveHeaders(apiKey: string): Record<string, string> {
  return {
    'X-API-Key': apiKey,
    Accept: 'application/json',
  };
}

/**
 * Normalize raw Cotizave payload into a market-keyed record.
 * Ignores entries where type !== 'p2p', or that lack numeric ask/bid.
 * Robust against unknown shapes via controlled `as any`.
 */
export function normalizeCotizaveRates(payload: unknown): Record<string, CotizaveRate> {
  const result: Record<string, CotizaveRate> = {};
  if (!payload || typeof payload !== 'object') return result;

  const raw = payload as Record<string, unknown>;

  const rates: unknown[] = Array.isArray(raw['rates'])
    ? raw['rates']
    : Array.isArray(raw)
      ? raw
      : [];

  for (const entry of rates) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;

    const marketRaw = String(r['market'] ?? r['exchange'] ?? r['name'] ?? '').trim();
    if (!marketRaw) continue;

    const market = normalizeMarketKey(marketRaw);
    if (!market) continue;

    const type = String(r['type'] ?? '').toLowerCase();
    if (type && !ALLOWED_QUOTE_TYPES.has(type)) continue;

    const ask = toNum(r['ask']);
    const bid = toNum(r['bid']);
    const mid = toNum(r['mid']);

    if (ask == null && bid == null && mid == null) continue;

    result[market] = {
      market,
      type: type || 'p2p',
      ask,
      bid,
      mid,
      updated_at: r['updated_at'] != null ? String(r['updated_at']) : undefined,
    };
  }

  return result;
}

/**
 * Compute the triangulation gap for a "buy on Binance, sell on other" strategy.
 *
 * Orientation: the user pays binance.bid to acquire USDT on Binance,
 * and receives other.ask when selling USDT on the other exchange.
 * A positive gap means the other exchange pays more than Binance charges.
 *
 * IMPORTANT naming note for Binance P2P context:
 * - binance.bid here = Binance's bestAskPrice (lowest seller ask — what you pay)
 * - other.ask here = Other exchange's bestBidPrice (highest buyer bid — what you receive)
 */
export function computeTriangulationGap(
  binance: { ask?: number; bid?: number } | null,
  other: { ask?: number; bid?: number } | null,
): { gapVes: number | null; gapPct: number | null } {
  if (
    binance?.bid == null ||
    binance.bid <= 0 ||
    other?.ask == null ||
    other.ask <= 0
  ) {
    return { gapVes: null, gapPct: null };
  }
  const gapVes = round2(other.ask - binance.bid);
  const gapPct = round2((gapVes / binance.bid) * 100);
  return { gapVes, gapPct };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
