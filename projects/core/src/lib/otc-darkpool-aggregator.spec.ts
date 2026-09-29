import { describe, it, expect } from 'vitest';
import {
  aggregateDarkPoolOpportunities,
  type MarketVenueQuote,
} from './otc-darkpool-aggregator';

describe('OtcDarkPoolAggregator Engine', () => {
  it('identifies profitable cross-exchange and cash-desk arbitrage', () => {
    const venues: MarketVenueQuote[] = [
      {
        venueId: 'binance-p2p',
        venueName: 'Binance P2P',
        venueType: 'BINANCE_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.0,
        sellRate: 85.5,
        takerFeePct: 0.0,
        makerFeePct: 0.1,
        transferOrCashFrictionPct: 0.0,
      },
      {
        venueId: 'bybit-p2p',
        venueName: 'Bybit P2P',
        venueType: 'BYBIT_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.2,
        sellRate: 87.2, // ~2.58% higher than Binance buy rate
        takerFeePct: 0.0,
        makerFeePct: 0.0,
        transferOrCashFrictionPct: 0.0,
      },
      {
        venueId: 'caracas-cash',
        venueName: 'Mesa Efectivo Caracas',
        venueType: 'PHYSICAL_CASH_DESK',
        currencyPair: 'USDT/VES',
        buyRate: 84.5, // Even cheaper in physical cash
        sellRate: 86.0,
        transferOrCashFrictionPct: 0.4, // Cash security transport cost
      },
    ];

    const routes = aggregateDarkPoolOpportunities(venues, { capitalUsd: 10000 });
    expect(routes.length).toBeGreaterThan(0);

    const topRoute = routes[0];
    expect(topRoute.isActionable).toBe(true);
    expect(topRoute.netSpreadPct).toBeGreaterThan(1.5);
    expect(topRoute.projectedProfitUsd).toBeGreaterThan(150);
  });

  it('marks physical cash desk routes with PHYSICAL_ESCORT_REQUIRED security rating', () => {
    const venues: MarketVenueQuote[] = [
      {
        venueId: 'cash-desk',
        venueName: 'OTC Desk Altamira',
        venueType: 'PHYSICAL_CASH_DESK',
        currencyPair: 'USDT/VES',
        buyRate: 84.0,
        sellRate: 85.0,
        transferOrCashFrictionPct: 0.5,
      },
      {
        venueId: 'binance',
        venueName: 'Binance P2P',
        venueType: 'BINANCE_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.5,
        sellRate: 86.5,
        transferOrCashFrictionPct: 0.0,
      },
    ];

    const routes = aggregateDarkPoolOpportunities(venues);
    expect(routes).toHaveLength(1);
    expect(routes[0].securityRating).toBe('PHYSICAL_ESCORT_REQUIRED');
  });

  it('blocks execution (isActionable: false) when transfer or cash friction is unknown/undefined', () => {
    const venues: MarketVenueQuote[] = [
      {
        venueId: 'cash-desk',
        venueName: 'OTC Desk Unknown',
        venueType: 'PHYSICAL_CASH_DESK',
        currencyPair: 'USDT/VES',
        buyRate: 80.0,
        sellRate: 90.0,
        // transferOrCashFrictionPct is omitted (undefined)
      },
      {
        venueId: 'binance',
        venueName: 'Binance P2P',
        venueType: 'BINANCE_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.0,
        sellRate: 86.0,
        transferOrCashFrictionPct: 0.0,
      },
    ];

    const routes = aggregateDarkPoolOpportunities(venues);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.hasUnknownFriction).toBe(true);
      expect(route.isActionable).toBe(false);
      expect(route.reason).toBe('MISSING_FRICTION_METRICS');
      expect(route.projectedProfitUsd).toBe(0);
      expect(route.executionPlaybook).toContain('Bloqueado por fricción desconocida');
    }
  });

  it('no marca reason cuando la friccion esta completamente parametrizada', () => {
    const venues: MarketVenueQuote[] = [
      {
        venueId: 'binance',
        venueName: 'Binance P2P',
        venueType: 'BINANCE_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.0,
        sellRate: 85.5,
        takerFeePct: 0.0,
        makerFeePct: 0.1,
        transferOrCashFrictionPct: 0.0,
      },
      {
        venueId: 'bybit',
        venueName: 'Bybit P2P',
        venueType: 'BYBIT_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.2,
        sellRate: 87.2,
        takerFeePct: 0.0,
        makerFeePct: 0.0,
        transferOrCashFrictionPct: 0.0,
      },
    ];

    const routes = aggregateDarkPoolOpportunities(venues);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.hasUnknownFriction).toBe(false);
      expect(route.reason).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------------
  // Contract: "unknown cost" is not "zero cost", and absence must be modeled as null
  // so an unpriced route can never be read as available margin.
  // ---------------------------------------------------------------------------

  it('no presenta margen disponible cuando faltan costos', () => {
    const venues: MarketVenueQuote[] = [
      {
        venueId: 'unpriced-cash-desk',
        venueName: 'Mesa Sin Friccion',
        venueType: 'PHYSICAL_CASH_DESK',
        currencyPair: 'USDT/VES',
        buyRate: 80.0,
        sellRate: 90.0,
        // transferOrCashFrictionPct never measured.
      },
      {
        venueId: 'binance',
        venueName: 'Binance P2P',
        venueType: 'BINANCE_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.0,
        sellRate: 86.0,
        transferOrCashFrictionPct: 0.0,
      },
    ];

    const routes = aggregateDarkPoolOpportunities(venues);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      // The net margin is unknown, not zero: no number may be displayed.
      expect(route.netSpreadPct).toBeNull();
      expect(route.totalFrictionPct).toBeNull();
      // The gross dislocation is observable and must survive.
      expect(route.grossSpreadPct).toBeGreaterThan(0);
      expect(route.isActionable).toBe(false);
      expect(route.projectedProfitUsd).toBe(0);
    }
  });

  it('distingue costo cero de costo desconocido', () => {
    const priced: MarketVenueQuote[] = [
      {
        venueId: 'binance',
        venueName: 'Binance P2P',
        venueType: 'BINANCE_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.0,
        sellRate: 85.0,
        takerFeePct: 0.0,
        makerFeePct: 0.0,
        transferOrCashFrictionPct: 0.0,
      },
      {
        venueId: 'bybit',
        venueName: 'Bybit P2P',
        venueType: 'BYBIT_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.0,
        sellRate: 85.85, // +1.00% gross
        takerFeePct: 0.0,
        makerFeePct: 1.0, // exactly eats the gross dislocation
        transferOrCashFrictionPct: 0.0,
      },
    ];

    const zeroCostRoutes = aggregateDarkPoolOpportunities(priced);
    expect(zeroCostRoutes).toHaveLength(1);
    const zeroCostRoute = zeroCostRoutes[0];
    // A measured zero cost is a number, and so is a net spread of exactly zero.
    expect(zeroCostRoute.netSpreadPct).toBe(0);
    expect(zeroCostRoute.totalFrictionPct).toBe(1);
    expect(zeroCostRoute.hasUnknownFriction).toBe(false);

    // Same prices, friction never measured: the net margin is unknown, not zero.
    const unpricedRoutes = aggregateDarkPoolOpportunities(
      priced.map((venue) => ({ ...venue, transferOrCashFrictionPct: undefined })),
    );
    expect(unpricedRoutes).toHaveLength(1);
    const unpricedRoute = unpricedRoutes[0];
    expect(unpricedRoute.netSpreadPct).toBeNull();
    expect(unpricedRoute.totalFrictionPct).toBeNull();
    // Both cases observe the same gross dislocation and must not report the same thing.
    expect(unpricedRoute.grossSpreadPct).toBe(zeroCostRoute.grossSpreadPct);
    expect(unpricedRoute.netSpreadPct).not.toBe(zeroCostRoute.netSpreadPct);
  });

  it('el sort no rompe con netSpreadPct null y pone lo desconocido al final', () => {
    const venues: MarketVenueQuote[] = [
      {
        venueId: 'binance',
        venueName: 'Binance P2P',
        venueType: 'BINANCE_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.0,
        sellRate: 85.5,
        takerFeePct: 0.0,
        makerFeePct: 0.0,
        transferOrCashFrictionPct: 0.0,
      },
      {
        venueId: 'bybit',
        venueName: 'Bybit P2P',
        venueType: 'BYBIT_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.2,
        sellRate: 87.2,
        takerFeePct: 0.0,
        makerFeePct: 0.0,
        transferOrCashFrictionPct: 0.0,
      },
      {
        venueId: 'unpriced-desk',
        venueName: 'Mesa Sin Friccion',
        venueType: 'PHYSICAL_CASH_DESK',
        currencyPair: 'USDT/VES',
        buyRate: 84.0,
        sellRate: 86.0,
        // transferOrCashFrictionPct never measured.
      },
    ];

    const pairOrder = (routes: { sourceVenue: MarketVenueQuote; destinationVenue: MarketVenueQuote }[]) =>
      routes.map((r) => `${r.sourceVenue.venueId}->${r.destinationVenue.venueId}`);

    const routes = aggregateDarkPoolOpportunities(venues);
    const known = routes.filter((r) => r.netSpreadPct !== null);
    const unknown = routes.filter((r) => r.netSpreadPct === null);

    expect(known).toHaveLength(2);
    expect(unknown).toHaveLength(4);

    // Known margins first, descending.
    expect(pairOrder(routes).slice(0, 2)).toEqual(pairOrder(known));
    expect(known[0].netSpreadPct!).toBeGreaterThan(known[1].netSpreadPct!);

    // Unknown margins last, in input order (stable sort), never interleaved as NaN.
    expect(pairOrder(routes).slice(2)).toEqual(pairOrder(unknown));
    expect(routes.slice(2).every((r) => r.netSpreadPct === null)).toBe(true);

    // Deterministic: the same input yields the same order on every run.
    expect(pairOrder(aggregateDarkPoolOpportunities(venues))).toEqual(pairOrder(routes));
  });
});
