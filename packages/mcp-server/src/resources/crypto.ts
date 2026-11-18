/**
 * Crypto Market Resources — Endpoints de lectura de profundidad P2P y volatilidad spot para agentes IA.
 */

import {
  fetchLiveBinanceP2pOrderbook,
  detectUsdtDepegParity,
  ORDERBOOK_PROVENANCE,
} from '../core/index.js';
import { fetchLiveUsdtSpotReading } from '../tools/usdt-spot-reader.js';

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
    description:
      'Snapshot estructurado del libro de órdenes VES/USDT en vivo con volumen acumulado, top bids, top asks y spread neto',
    mimeType: 'application/json',
    read: async () => {
      const depth = await fetchLiveBinanceP2pOrderbook({ fiat: 'VES', asset: 'USDT', rows: 10 });
      if (depth.provenance === ORDERBOOK_PROVENANCE.UNAVAILABLE) {
        return {
          timestamp: depth.timestamp,
          status: 'UNAVAILABLE_NO_LIVE_FEED',
          provenance: depth.provenance,
          actionable: false,
          unavailableReason: depth.unavailableReason,
          expectedSource: depth.expectedSource,
          topBuyPrice: null,
          topSellPrice: null,
          spreadVes: null,
          spreadPct: null,
          totalLiquidityUsdt: null,
          buyDepthUsdt: null,
          sellDepthUsdt: null,
          buyOffers: [],
          sellOffers: [],
        };
      }
      return {
        timestamp: depth.timestamp,
        status: depth.provenance,
        provenance: depth.provenance,
        actionable: depth.actionable,
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
    description:
      'Estado de paridad del USDT contra USD fiat, alertas de despegue y volatilidad spot global',
    mimeType: 'application/json',
    read: async () => {
      const live = await fetchLiveUsdtSpotReading();
      if (live === null) {
        return {
          timestamp: new Date().toISOString(),
          spotUsdtPrice: null,
          parityDeviationPct: null,
          status: 'UNAVAILABLE_NO_LIVE_FEED',
          isDepegged: null,
          arbitrageOpportunity: false,
          riskSeverity: 'NONE',
          recommendation:
            'Sin feed spot en vivo disponible para USDT. Se declara ausencia de paridad.',
          source: 'NONE',
        };
      }
      const parity = detectUsdtDepegParity(live.price, 0.2);
      return {
        timestamp: new Date().toISOString(),
        spotUsdtPrice: parity.spotUsdtPrice,
        parityDeviationPct: parity.parityDeviationPct,
        status: parity.status,
        isDepegged: parity.isDepegged,
        arbitrageOpportunity: parity.arbitrageOpportunity,
        riskSeverity: parity.riskSeverity,
        recommendation: parity.recommendation,
        source: live.source,
      };
    },
  },
];
