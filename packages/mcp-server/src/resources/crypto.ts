/**
 * Crypto Market Resources — Endpoints de lectura de profundidad P2P y volatilidad spot para agentes IA.
 */

import { getBinanceP2POrderbookSnapshot, detectUsdtDepegParity } from '../core/index.js';

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: () => Promise<unknown> | unknown;
}

export const cryptoResources: McpResource[] = [
  {
    uri: 'p2p://market/binance-p2p/depth',
    name: 'Profundidad del Libro P2P (Binance)',
    description: 'Snapshot estructurado del libro de órdenes VES/USDT con volumen acumulado, top bids, top asks y spread neto',
    mimeType: 'application/json',
    read: () => {
      const depth = getBinanceP2POrderbookSnapshot('VES', 'USDT', 10);
      return {
        timestamp: depth.timestamp,
        topBuyPrice: depth.topBuyPrice,
        topSellPrice: depth.topSellPrice,
        spreadVes: depth.spreadVes,
        spreadPct: depth.spreadPct,
        totalLiquidityUsdt: depth.totalBuyDepthUsdt + depth.totalSellDepthUsdt,
        buyDepthUsdt: depth.totalBuyDepthUsdt,
        sellDepthUsdt: depth.totalSellDepthUsdt,
        buyOffers: depth.buyOffers,
        sellOffers: depth.sellOffers,
      };
    },
  },
  {
    uri: 'p2p://market/spot/volatility',
    name: 'Volatilidad Spot y Paridad USDT',
    description: 'Estado de paridad del USDT contra USD fiat, alertas de despegue y volatilidad spot global',
    mimeType: 'application/json',
    read: () => {
      const parity = detectUsdtDepegParity(1.000, 0.2);
      return {
        timestamp: new Date().toISOString(),
        spotUsdtPrice: parity.spotUsdtPrice,
        parityDeviationPct: parity.parityDeviationPct,
        status: parity.status,
        isDepegged: parity.isDepegged,
        arbitrageOpportunity: parity.arbitrageOpportunity,
        riskSeverity: parity.riskSeverity,
        recommendation: parity.recommendation,
      };
    },
  },
];
