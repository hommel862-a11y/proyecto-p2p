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

export function getMarketBook(): P2pBookSnapshot | null {
  return marketBook;
}

export function getZkMesh(): ZkMarketMesh {
  return zkMesh;
}

export function getVolatilityTicks(): PriceTick[] {
  return volatilityTicks;
}

export function recordVolatilityTick(
  parallelRate: number | undefined,
  currentSpreadPct: number,
): void {
  let buy = 0;
  let sell = 0;
  if (parallelRate && parallelRate > 0 && currentSpreadPct > 0) {
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
