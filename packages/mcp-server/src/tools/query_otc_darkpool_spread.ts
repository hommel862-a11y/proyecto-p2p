import {
  aggregateDarkPoolOpportunities,
  type MarketVenueQuote,
} from '../core/index.js';
import {
  QueryOtcDarkpoolSpreadInputSchema,
  type QueryOtcDarkpoolSpreadInput,
} from '../schemas/index.js';

export const queryOtcDarkpoolSpreadTool = {
  name: 'query_otc_darkpool_spread',
  description:
    'Agrega y compara spreads y profundidad de liquidez entre exchanges digitales (Binance, Bybit) y mesas OTC / taquillas de efectivo.',
  inputSchema: QueryOtcDarkpoolSpreadInputSchema,
  execute: (input: QueryOtcDarkpoolSpreadInput) => {
    const quotes = (input.quotes as MarketVenueQuote[]) || [];
    const volumeUsd = input.volumeUsd ?? 10000;
    const minNetSpreadPct = input.minNetSpreadPct ?? 1.2;

    const defaultVenues: MarketVenueQuote[] = [
      {
        venueId: 'BINANCE_P2P_VES',
        venueName: 'Binance P2P',
        venueType: 'BINANCE_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.2,
        sellRate: 86.8,
        makerFeePct: 0.1,
        takerFeePct: 0.1,
        minTradeVolumeUsd: 50,
        maxTradeVolumeUsd: 20000,
        locationCity: 'Online',
      },
      {
        venueId: 'CCS_CASH_DESK_1',
        venueName: 'Caracas Cash Desk Chacao',
        venueType: 'PHYSICAL_CASH_DESK',
        currencyPair: 'USDT/VES',
        buyRate: 83.5,
        sellRate: 88.5,
        makerFeePct: 0.0,
        takerFeePct: 0.0,
        transferOrCashFrictionPct: 0.5,
        minTradeVolumeUsd: 2000,
        maxTradeVolumeUsd: 100000,
        locationCity: 'Caracas',
      },
      {
        venueId: 'BYBIT_P2P_VES',
        venueName: 'Bybit P2P',
        venueType: 'BYBIT_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.0,
        sellRate: 86.5,
        makerFeePct: 0.0,
        takerFeePct: 0.0,
        minTradeVolumeUsd: 50,
        maxTradeVolumeUsd: 15000,
        locationCity: 'Online',
      },
    ];

    const venuesToEvaluate = quotes.length > 0 ? quotes : defaultVenues;
    const routes = aggregateDarkPoolOpportunities(venuesToEvaluate, {
      capitalUsd: volumeUsd,
      minNetSpreadPct,
    });

    return {
      success: true,
      volumeTestedUsd: volumeUsd,
      routesFoundCount: routes.length,
      routes,
      evaluatedAt: new Date().toISOString(),
    };
  },
};
