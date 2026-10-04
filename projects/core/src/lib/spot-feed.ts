/**
 * Pure Mathematical & Telemetry Models for Spot Feeds and Data Source Availability.
 * Provides institutional models for Binance Spot book tickers, parity pricing,
 * and fail-closed data availability states across the desk.
 * Zero external dependencies.
 */

import { roundMoney } from './money';

export type DataSourceStatus = 'LIVE' | 'CACHE' | 'UNAVAILABLE';
export type DataProvenance = 'LIVE_EXCHANGE_FEED' | 'LOCAL_CACHE' | 'UNAVAILABLE';

export interface DataSourceAvailability {
  status: DataSourceStatus;
  lastFetchedAt: string | null;
  provenance: DataProvenance;
  sourceName: string;
  reason?: string;
}

export interface SpotBookTicker {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  bidQty?: number;
  askQty?: number;
  midPrice: number;
  spreadPct: number;
  timestamp: string;
}

export interface SpotPriceTicker {
  symbol: string;
  price: number;
  timestamp: string;
}

/**
 * Creates an explicit UNAVAILABLE data source availability descriptor (fail-closed).
 */
export function createUnavailableDataSource(
  sourceName: string,
  reason: string,
): DataSourceAvailability {
  return {
    status: 'UNAVAILABLE',
    lastFetchedAt: null,
    provenance: 'UNAVAILABLE',
    sourceName,
    reason,
  };
}

/**
 * Creates a LIVE or CACHE data source availability descriptor with timestamp.
 */
export function createActiveDataSource(
  sourceName: string,
  status: 'LIVE' | 'CACHE',
  fetchedAt: Date | string = new Date(),
): DataSourceAvailability {
  return {
    status,
    lastFetchedAt: typeof fetchedAt === 'string' ? fetchedAt : fetchedAt.toISOString(),
    provenance: status === 'LIVE' ? 'LIVE_EXCHANGE_FEED' : 'LOCAL_CACHE',
    sourceName,
  };
}

/**
 * Parses raw Binance Spot bookTicker payload:
 * e.g. { symbol: "USDCUSDT", bidPrice: "0.99980000", bidQty: "15200.00", askPrice: "1.00000000", askQty: "24100.00" }
 *
 * Validates finite positive prices and computes midPrice and spread percentage.
 * Returns `null` if the payload is missing, malformed, or has non-positive prices (fail-closed).
 */
export function parseSpotBookTicker(raw: unknown): SpotBookTicker | null {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const symbol = typeof record['symbol'] === 'string' ? record['symbol'].trim().toUpperCase() : '';
  if (!symbol) return null;

  const bidPrice = Number(record['bidPrice']);
  const askPrice = Number(record['askPrice']);

  if (!Number.isFinite(bidPrice) || !Number.isFinite(askPrice) || bidPrice <= 0 || askPrice <= 0) {
    return null;
  }

  // Sanity check: ask must not be lower than bid in an active orderbook
  if (askPrice < bidPrice) {
    return null;
  }

  const bidQtyRaw = Number(record['bidQty']);
  const askQtyRaw = Number(record['askQty']);
  const bidQty = Number.isFinite(bidQtyRaw) && bidQtyRaw > 0 ? bidQtyRaw : undefined;
  const askQty = Number.isFinite(askQtyRaw) && askQtyRaw > 0 ? askQtyRaw : undefined;

  const midPrice = roundMoney((bidPrice + askPrice) / 2, 6);
  const spreadPct = roundMoney(((askPrice - bidPrice) / bidPrice) * 100, 4);

  return {
    symbol,
    bidPrice,
    askPrice,
    bidQty,
    askQty,
    midPrice,
    spreadPct,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Parses raw Binance Spot price payload:
 * e.g. { symbol: "USDCUSDT", price: "0.99990000" }
 */
export function parseSpotPrice(raw: unknown): SpotPriceTicker | null {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const symbol = typeof record['symbol'] === 'string' ? record['symbol'].trim().toUpperCase() : '';
  if (!symbol) return null;

  const price = Number(record['price']);
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    symbol,
    price,
    timestamp: new Date().toISOString(),
  };
}
