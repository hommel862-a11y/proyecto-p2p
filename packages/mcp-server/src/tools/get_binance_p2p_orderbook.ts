import { fetchLiveBinanceP2pOrderbook, ORDERBOOK_PROVENANCE } from '../core/index.js';
import {
  GetBinanceP2POrderbookInputSchema,
  type GetBinanceP2POrderbookInput,
} from '../schemas/index.js';

export const getBinanceP2POrderbookTool = {
  name: 'get_binance_p2p_orderbook',
  description:
    'Obtiene el libro de órdenes P2P en vivo de Binance para el par seleccionado (VES/USDT), desglosando ofertas de compra (bids), venta (asks), spread y profundidad acumulada.',
  inputSchema: GetBinanceP2POrderbookInputSchema,
  execute: async (input: GetBinanceP2POrderbookInput) => {
    const depth = await fetchLiveBinanceP2pOrderbook({
      fiat: input.fiat,
      asset: input.asset,
      rows: input.rows,
    });

    const marketStatus =
      depth.provenance === ORDERBOOK_PROVENANCE.UNAVAILABLE
        ? 'UNAVAILABLE'
        : (depth.spreadPct ?? 0) > 0.5
          ? 'HEALTHY_SPREAD'
          : 'TIGHT_COMPRESSED_SPREAD';

    return {
      fiat: depth.fiat,
      asset: depth.asset,
      timestamp: depth.timestamp,
      provenance: depth.provenance,
      actionable: depth.actionable,
      unavailableReason: depth.unavailableReason,
      expectedSource: depth.expectedSource,
      topBuyPrice: depth.topBuyPrice,
      topSellPrice: depth.topSellPrice,
      spreadVes: depth.spreadVes,
      spreadPct: depth.spreadPct,
      totalBuyDepthUsdt: depth.totalBuyDepthUsdt,
      totalSellDepthUsdt: depth.totalSellDepthUsdt,
      buyOffersCount: depth.buyOffers.length,
      sellOffersCount: depth.sellOffers.length,
      buyOffers: depth.buyOffers,
      sellOffers: depth.sellOffers,
      marketStatus,
    };
  },
};
