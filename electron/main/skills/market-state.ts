/**
 * In-memory market state, P2P orderbook cache, and federated ZK fraud mesh.
 */

import { request as httpsRequest } from 'node:https';
import type { BinanceOfferSummary } from '../vendor/p2p-core/binance-p2p';
import { buildBinanceSearchPayload, parseBinanceP2pItems } from '../vendor/p2p-core/binance-p2p';
import type { BlindThreatRecord } from '../vendor/p2p-core/zk-market-mesh';
import { ZkMarketMesh } from '../vendor/p2p-core/zk-market-mesh';
import type { PriceTick } from '../vendor/p2p-core/volatility-forecaster';

export interface P2pBookSnapshot {
  asset: string;
  fiat: string;
  buyOffers: BinanceOfferSummary[];
  sellOffers: BinanceOfferSummary[];
  bestBuyPrice: number;
  bestSellPrice: number;
  bidDepthUsdt: number;
  askDepthUsdt: number;
  updatedAt: number;
}

let marketBook: P2pBookSnapshot | null = null;

const zkMesh = new ZkMarketMesh('electron-copilot-node');
const volatilityTicks: PriceTick[] = [];

export const GOLDEN_SPREAD_MIN_PCT = 0.5;

export function buildBookSnapshot(
  buyOffers: BinanceOfferSummary[],
  sellOffers: BinanceOfferSummary[],
): P2pBookSnapshot {
  const bestBuyPrice = buyOffers.length > 0 ? Math.min(...buyOffers.map((o) => o.price)) : 0;
  const bestSellPrice = sellOffers.length > 0 ? Math.max(...sellOffers.map((o) => o.price)) : 0;
  const depthUsdt = (offers: BinanceOfferSummary[]): number =>
    offers.reduce((acc, o) => acc + (o.price > 0 && o.maxVes > 0 ? o.maxVes / o.price : 0), 0);
  return {
    asset: 'USDT',
    fiat: 'VES',
    buyOffers,
    sellOffers,
    bestBuyPrice,
    bestSellPrice,
    bidDepthUsdt: depthUsdt(buyOffers),
    askDepthUsdt: depthUsdt(sellOffers),
    updatedAt: Date.now(),
  };
}

export function seedFinancialSkillMarketData(book: {
  buyOffers: BinanceOfferSummary[];
  sellOffers: BinanceOfferSummary[];
}): P2pBookSnapshot {
  marketBook = buildBookSnapshot(book.buyOffers ?? [], book.sellOffers ?? []);
  return marketBook;
}

export function clearFinancialSkillMarketData(): void {
  marketBook = null;
}

export function getFinancialSkillMarketData(): {
  available: boolean;
  updatedAt?: number;
  bestBuyPrice?: number;
  bestSellPrice?: number;
  bidDepthUsdt?: number;
  askDepthUsdt?: number;
} {
  if (!marketBook) return { available: false };
  return {
    available: true,
    updatedAt: marketBook.updatedAt,
    bestBuyPrice: marketBook.bestBuyPrice,
    bestSellPrice: marketBook.bestSellPrice,
    bidDepthUsdt: marketBook.bidDepthUsdt,
    askDepthUsdt: marketBook.askDepthUsdt,
  };
}

/**
 * A book older than this is not "live". P2P quotes go stale in minutes, so a
 * twelve-hour-old snapshot must never be reported as a connected live feed.
 */
export const MARKET_FEED_MAX_AGE_MS = 5 * 60 * 1000;

export type MarketFeedReason = 'LIVE' | 'NO_BOOK' | 'STALE_BOOK' | 'INCOMPLETE_BOOK';export interface ResolvedMarketFeed {
  /** True only when a fresh, complete book exists. Never infer this from anything else. */
  live: boolean;
  reason: MarketFeedReason;
  updatedAt?: number;
  ageMs?: number;
  bestBuyPrice?: number;
  bestSellPrice?: number;
  midPrice?: number;
  bidDepthUsdt?: number;
  askDepthUsdt?: number;
}

/**
 * Single source of truth for "do we have a live market feed?".
 *
 * This replaces hand-written copies of the same predicate that were duplicated
 * across the orchestrator and drifted apart. Callers that need to know whether
 * a number is real must use this, and must report `live: false` otherwise.
 */
export function resolveMarketFeed(
  maxAgeMs: number = MARKET_FEED_MAX_AGE_MS,
  now: number = Date.now(),
): ResolvedMarketFeed {
  if (!marketBook) {
    return { live: false, reason: 'NO_BOOK' };
  }

  const ageMs = now - marketBook.updatedAt;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) {
    return { live: false, reason: 'STALE_BOOK', updatedAt: marketBook.updatedAt, ageMs };
  }

  const hasBothSides =
    typeof marketBook.bestBuyPrice === 'number' &&
    marketBook.bestBuyPrice > 0 &&
    typeof marketBook.bestSellPrice === 'number' &&
    marketBook.bestSellPrice > 0;

  if (!hasBothSides) {
    return { live: false, reason: 'INCOMPLETE_BOOK', updatedAt: marketBook.updatedAt, ageMs };
  }

  return {
    live: true,
    reason: 'LIVE',
    updatedAt: marketBook.updatedAt,
    ageMs,
    bestBuyPrice: marketBook.bestBuyPrice,
    bestSellPrice: marketBook.bestSellPrice,
    midPrice: (marketBook.bestBuyPrice + marketBook.bestSellPrice) / 2,
    bidDepthUsdt: marketBook.bidDepthUsdt,
    askDepthUsdt: marketBook.askDepthUsdt,
  };
}

/** Human-readable provenance suffix. Fails loudly rather than decorating a fabrication. */
export function describeMarketFeed(feed: ResolvedMarketFeed): string {
  switch (feed.reason) {
    case 'LIVE':
      return `[en vivo · libro de ${Math.round((feed.ageMs ?? 0) / 1000)}s]`;
    case 'NO_BOOK':
      return '[sin feed: no hay libro cargado]';
    case 'STALE_BOOK':
      return `[sin feed: libro vencido (${Math.round((feed.ageMs ?? 0) / 60000)} min)]`;
    case 'INCOMPLETE_BOOK':
      return '[sin feed: libro incompleto]';
  }
}

export function getMarketBook(): P2pBookSnapshot | null {
  return marketBook;
}

export interface BcvRateSnapshot {
  usd: number;
  eur?: number | null;
  cny?: number | null;
  rub?: number | null;
  source: string;
  updatedAt: number;
  effectiveDate?: string | null;
}

let bcvSnapshot: BcvRateSnapshot | null = null;

export const BCV_RATE_MAX_AGE_MS = 60 * 60 * 1000;

export type BcvFeedReason = 'LIVE' | 'NO_BCV' | 'STALE_BCV';

export interface ResolvedBcvFeed {
  live: boolean;
  reason: BcvFeedReason;
  usd?: number;
  eur?: number | null;
  source?: string;
  updatedAt?: number;
  ageMs?: number;
  effectiveDate?: string | null;
}

export function seedBcvRate(snapshot: {
  usd?: number | null;
  eur?: number | null;
  cny?: number | null;
  rub?: number | null;
  source?: string;
  updatedAt?: number;
  effectiveDate?: string | null;
}): BcvRateSnapshot | null {
  if (typeof snapshot.usd !== 'number' || !Number.isFinite(snapshot.usd) || snapshot.usd <= 0) {
    return null;
  }
  bcvSnapshot = {
    usd: snapshot.usd,
    eur: snapshot.eur ?? null,
    cny: snapshot.cny ?? null,
    rub: snapshot.rub ?? null,
    source: snapshot.source || 'cotizave:reference',
    updatedAt: snapshot.updatedAt || Date.now(),
    effectiveDate: snapshot.effectiveDate ?? null,
  };
  return bcvSnapshot;
}

export function clearBcvRate(): void {
  bcvSnapshot = null;
}

export function getBcvSnapshot(): BcvRateSnapshot | null {
  return bcvSnapshot;
}

export function resolveBcvRate(
  maxAgeMs: number = BCV_RATE_MAX_AGE_MS,
  now: number = Date.now(),
): ResolvedBcvFeed {
  if (!bcvSnapshot) {
    return { live: false, reason: 'NO_BCV' };
  }
  const ageMs = now - bcvSnapshot.updatedAt;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) {
    return { live: false, reason: 'STALE_BCV', updatedAt: bcvSnapshot.updatedAt, ageMs };
  }
  return {
    live: true,
    reason: 'LIVE',
    usd: bcvSnapshot.usd,
    eur: bcvSnapshot.eur,
    source: bcvSnapshot.source,
    updatedAt: bcvSnapshot.updatedAt,
    ageMs,
    effectiveDate: bcvSnapshot.effectiveDate,
  };
}

export function describeBcvFeed(feed: ResolvedBcvFeed): string {
  switch (feed.reason) {
    case 'LIVE':
      return `[BCV en vivo · ${feed.usd?.toFixed(2)} VES · ${feed.source}]`;
    case 'NO_BCV':
      return '[sin feed BCV: no hay tasa registrada]';
    case 'STALE_BCV':
      return `[sin feed BCV: tasa vencida (${Math.round((feed.ageMs ?? 0) / 60000)} min)]`;
  }
}

const OFFICIAL_MARKETS: Record<string, 'usd' | 'eur'> = {
  reference: 'usd',
  bcv: 'usd',
  oficial: 'usd',
  eur_reference: 'eur',
};

function toRate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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

export function parseCotizaveRatesPayload(payload: unknown): {
  usd: number | null;
  eur: number | null;
  source: string;
  effectiveDate: string | null;
} | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const rates: unknown[] = Array.isArray(raw['rates']) ? raw['rates'] : [];
  if (rates.length === 0) return null;

  let usd: number | null = null;
  let eur: number | null = null;
  const source = new Set<string>();
  let effectiveDate: string | null = raw['fetched_at'] != null ? String(raw['fetched_at']) : null;

  for (const candidate of rates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const entry = candidate as Record<string, unknown>;
    const market = String(entry['market'] ?? '')
      .toLowerCase()
      .trim()
      .replace(/[-\s]+/g, '_');
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
    source: [...source].sort().join(' + '),
    effectiveDate,
  };
}

export function getZkMesh(): ZkMarketMesh {
  return zkMesh;
}

export function getVolatilityTicks(): PriceTick[] {
  return volatilityTicks;
}

/**
 * Registra un tick de precio para la serie de volatilidad.
 *
 * `currentSpreadPct` admite `null`: sin un spread medido no se puede derivar el
 * precio de compra a partir de la tasa paralela, y la caída honesta es al libro
 * real. Antes el caller rellenaba un 1.2 inventado que entraba al buffer circular
 * de 40 ticks y contaminaba los pronósticos posteriores.
 *
 * Un spread de `0` es un hecho del libro, no una ausencia: paralelo y oficial al
 * mismo precio. Por eso la comprobación es `> 0` sobre el valor medido y no una
 * guarda de presencia.
 */
export function recordVolatilityTick(
  parallelRate: number | undefined,
  currentSpreadPct: number | null,
): void {
  let buy = 0;
  let sell = 0;
  // La guarda distingue `null` (no medido) de `0` (medido, y válido): con tasa
  // paralela conocida y spread 0% el precio de compra es igual al de venta, y ese
  // tick es un hecho del libro. Rejectear el 0 descartaba una medición válida.
  if (
    parallelRate &&
    parallelRate > 0 &&
    currentSpreadPct !== null &&
    Number.isFinite(currentSpreadPct)
  ) {
    sell = parallelRate;
    buy = parallelRate * (1 - currentSpreadPct / 100);
  } else if (marketBook && marketBook.bestBuyPrice > 0 && marketBook.bestSellPrice > 0) {
    buy = marketBook.bestBuyPrice;
    sell = marketBook.bestSellPrice;
  }
  if (buy <= 0 || sell <= 0) return;
  volatilityTicks.push({ timestampMs: Date.now(), buyPrice: buy, sellPrice: sell });
  if (volatilityTicks.length > 40) volatilityTicks.shift();
}

export function getSideOffers(side: 'BUY' | 'SELL'): BinanceOfferSummary[] {
  if (!marketBook) return [];
  return side === 'BUY' ? marketBook.buyOffers : marketBook.sellOffers;
}

export function httpJsonPost(
  url: string,
  payload: unknown,
): Promise<{ ok: boolean; status?: number; data?: unknown }> {
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve({ ok: false });
      return;
    }
    const req = httpsRequest(
      {
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'electron-copilot/2.0',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({
              ok: (res.statusCode ?? 0) === 200,
              status: res.statusCode,
              data: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          } catch {
            resolve({ ok: (res.statusCode ?? 0) === 200, status: res.statusCode });
          }
        });
      },
    );
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ ok: false });
    });
    req.write(body);
    req.end();
  });
}

export async function refreshFinancialSkillMarketData(): Promise<{
  ok: boolean;
  message: string;
  updatedAt?: number;
}> {
  try {
    const [buyRes, sellRes] = await Promise.all([
      httpJsonPost(
        'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
        buildBinanceSearchPayload('USDT', 'VES', 'BUY', undefined, 20),
      ),
      httpJsonPost(
        'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
        buildBinanceSearchPayload('USDT', 'VES', 'SELL', undefined, 20),
      ),
    ]);
    const buyOffers = parseBinanceP2pItems(buyRes.data);
    const sellOffers = parseBinanceP2pItems(sellRes.data);
    if (!buyRes.ok || !sellRes.ok || (buyOffers.length === 0 && sellOffers.length === 0)) {
      return {
        ok: false,
        message:
          'No se obtuvieron ofertas válidas de Binance C2C (red/format). Libro sin refrescar.',
      };
    }
    marketBook = buildBookSnapshot(buyOffers, sellOffers);
    return {
      ok: true,
      message: `Libro P2P actualizado: ${buyOffers.length} ventas / ${sellOffers.length} compras.`,
      updatedAt: marketBook.updatedAt,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      message: `refreshFinancialSkillMarketData falló: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function reportMeshThreat(params: {
  rawIdentifier: string;
  threatType: BlindThreatRecord['threatType'];
  severity?: BlindThreatRecord['severity'];
  sanitizedSummary: string;
  saltDomain?: string;
}): BlindThreatRecord | null {
  return zkMesh.reportThreat(params);
}

export function getZkMeshStats(): { nodeId: string; threatCount: number } {
  return { nodeId: zkMesh.getNodeId(), threatCount: zkMesh.getThreatCount() };
}
