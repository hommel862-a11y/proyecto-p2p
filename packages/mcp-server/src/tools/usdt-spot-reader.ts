/**
 * Reader for live public spot USDT/USD parity readings.
 *
 * Querying global exchange spot orderbooks without authentication:
 * 1. Binance public REST API: GET https://api.binance.com/api/v3/ticker/price?symbol=USDCUSDT
 * 2. Kraken public REST API:  GET https://api.kraken.com/0/public/Ticker?pair=USDTUSD
 *
 * Neither endpoint requires API keys. Both represent institutional spot liquidity for
 * stablecoin parity assessment.
 *
 * If neither source responds, the reader returns `null`. It NEVER invents 1.000.
 */

export interface UsdtSpotLiveReading {
  price: number;
  source: string;
  fetchedAt: string;
}

export const BINANCE_SPOT_USDC_USDT_URL =
  'https://api.binance.com/api/v3/ticker/price?symbol=USDCUSDT';
export const KRAKEN_SPOT_USDT_USD_URL =
  'https://api.kraken.com/0/public/Ticker?pair=USDTUSD';

export function parseBinanceUsdtSpot(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = Number((raw as Record<string, unknown>)['price']);
  if (!Number.isFinite(p) || p <= 0) return null;
  // USDC/USDT is USDC price per USDT; since USDC is pegged to 1 USD,
  // the USD spot value of USDT is 1 / price (e.g. 1 / 1.00032 = 0.99968).
  return 1 / p;
}

export function parseKrakenUsdtSpot(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const result = (raw as Record<string, unknown>)['result'];
  if (!result || typeof result !== 'object') return null;
  const pairData =
    (result as Record<string, unknown>)['USDTZUSD'] ??
    (result as Record<string, unknown>)['USDTUSD'];
  if (!pairData || typeof pairData !== 'object') return null;
  const c = (pairData as Record<string, unknown>)['c'];
  if (!Array.isArray(c) || c.length === 0) return null;
  const price = Number(c[0]);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export async function fetchLiveUsdtSpotReading(
  fetchImpl: typeof fetch = fetch,
): Promise<UsdtSpotLiveReading | null> {
  // 1. Primary: Binance public spot ticker (USDC/USDT)
  try {
    const res = await fetchImpl(BINANCE_SPOT_USDC_USDT_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const price = parseBinanceUsdtSpot(await res.json());
      if (price !== null) {
        return {
          price,
          source: 'binance:spot:USDCUSDT',
          fetchedAt: new Date().toISOString(),
        };
      }
    }
  } catch {
    // Fall through to secondary public venue
  }

  // 2. Secondary fallback: Kraken public spot ticker (USDT/USD)
  try {
    const res = await fetchImpl(KRAKEN_SPOT_USDT_USD_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const price = parseKrakenUsdtSpot(await res.json());
      if (price !== null) {
        return {
          price,
          source: 'kraken:spot:USDTUSD',
          fetchedAt: new Date().toISOString(),
        };
      }
    }
  } catch {
    // Transport failure is treated as absence
  }

  return null;
}
