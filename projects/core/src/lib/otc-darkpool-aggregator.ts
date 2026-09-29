/**
 * Pure Mathematical Engine for Multi-Market OTC Dark Pool & Cash-Desk Aggregator.
 * Compares liquidity and spreads across retail exchanges (Binance, Bybit, El Dorado)
 * and physical OTC cash desks (Caracas, Valencia, Bogotá, Medellín cash).
 * Deducts transport, custodial, network, and security risk frictions to derive pure net arbitrage yield.
 * Zero external dependencies.
 */

import { roundMoney } from './money';

export type VenueType = 'BINANCE_P2P' | 'BYBIT_P2P' | 'ELDORADO_P2P' | 'SYLO_P2P' | 'PHYSICAL_CASH_DESK';

export interface MarketVenueQuote {
  venueId: string;
  venueName: string;
  venueType: VenueType;
  currencyPair: string; // e.g. "USDT/VES" or "USD_CASH/USDT"
  buyRate: number;  // Price to acquire asset on this venue
  sellRate: number; // Price to liquidate asset on this venue
  makerFeePct?: number;
  takerFeePct?: number;
  transferOrCashFrictionPct?: number; // e.g. 0.5% security delivery or 1 USDT network fee
  minTradeVolumeUsd?: number;
  maxTradeVolumeUsd?: number;
  locationCity?: string; // e.g. "Caracas", "Bogota", "Online"
}

export interface CrossVenueArbitrageRoute {
  routeId: string;
  sourceVenue: MarketVenueQuote;
  destinationVenue: MarketVenueQuote;
  asset: string;
  /** Always observable: the price dislocation between two venues needs no cost assumption. */
  grossSpreadPct: number;
  /**
   * `null` when a friction term was never measured. An unmeasured cost is not a zero cost,
   * so no aggregate may be reported for it.
   */
  totalFrictionPct: number | null;
  /**
   * `null` when `hasUnknownFriction` is true. The net margin cannot be derived from a cost
   * term we never measured, and a number here would be read as available margin. `null`
   * means "no net margin is knowable", never 0.
   */
  netSpreadPct: number | null;
  projectedProfitUsd: number;
  capitalTestedUsd: number;
  isActionable: boolean;
  hasUnknownFriction?: boolean;
  /** Present when the route is blocked. Absent when every friction term is known. */
  reason?: 'MISSING_FRICTION_METRICS';
  securityRating: 'HIGH_SAFETY' | 'MODERATE_SECURITY' | 'PHYSICAL_ESCORT_REQUIRED';
  executionPlaybook: string;
  timestamp: string;
}

export interface DarkPoolAggregatorOptions {
  capitalUsd?: number;
  minNetSpreadPct?: number; // default 1.2%
}

/**
 * Evaluates all possible pairwise arbitrage routes across provided market quotes.
 */
export function aggregateDarkPoolOpportunities(
  venues: readonly MarketVenueQuote[],
  options: DarkPoolAggregatorOptions = {},
): CrossVenueArbitrageRoute[] {
  const capital = options.capitalUsd && options.capitalUsd > 0 ? options.capitalUsd : 5000;
  const minNetSpread = options.minNetSpreadPct ?? 1.2;

  const routes: CrossVenueArbitrageRoute[] = [];

  for (let i = 0; i < venues.length; i++) {
    for (let j = 0; j < venues.length; j++) {
      if (i === j) continue;

      const source = venues[i];
      const dest = venues[j];

      // Pair match check (same pair or convertible corridor)
      if (source.currencyPair !== dest.currencyPair) continue;

      // We buy at source.buyRate and sell at dest.sellRate
      if (source.buyRate <= 0 || dest.sellRate <= 0) continue;

      const grossSpread = ((dest.sellRate - source.buyRate) / source.buyRate) * 100;
      if (grossSpread <= 0) continue;

      const hasUnknownFriction =
        source.transferOrCashFrictionPct === undefined ||
        dest.transferOrCashFrictionPct === undefined;

      // An unmeasured friction term is not a zero friction term. While any term is unknown
      // the net spread is not computed at all: it would be inflated by exactly the cost we
      // did not measure, and a human would read that number as available margin.
      let roundedFriction: number | null = null;
      let roundedNet: number | null = null;
      if (!hasUnknownFriction) {
        const sourceTransferFriction = source.transferOrCashFrictionPct!;
        const destTransferFriction = dest.transferOrCashFrictionPct!;
        const sourceFriction = (source.takerFeePct ?? 0.1) + sourceTransferFriction;
        const destFriction = (dest.makerFeePct ?? 0.1) + destTransferFriction;
        const totalFriction = sourceFriction + destFriction;

        roundedFriction = roundMoney(totalFriction, 2);
        roundedNet = roundMoney(grossSpread - totalFriction, 2);
      }

      const roundedGross = roundMoney(grossSpread, 2);

      let securityRating: 'HIGH_SAFETY' | 'MODERATE_SECURITY' | 'PHYSICAL_ESCORT_REQUIRED' = 'HIGH_SAFETY';
      if (source.venueType === 'PHYSICAL_CASH_DESK' || dest.venueType === 'PHYSICAL_CASH_DESK') {
        securityRating = 'PHYSICAL_ESCORT_REQUIRED';
      } else if (source.venueType === 'ELDORADO_P2P' || dest.venueType === 'ELDORADO_P2P') {
        securityRating = 'MODERATE_SECURITY';
      }

      // If friction is unknown (undefined), block actionable status to prevent false-positive arbitrage.
      const isActionable = !hasUnknownFriction && roundedNet !== null && roundedNet >= minNetSpread;
      const profitUsd = isActionable ? roundMoney((capital * roundedNet!) / 100, 2) : 0;

      const playbook = hasUnknownFriction
        ? `Bloqueado por fricción desconocida: Se requiere parametrizar transferOrCashFrictionPct para ${source.venueName} y ${dest.venueName} antes de autorizar ejecución.`
        : isActionable
        ? `Arbitraje Detectado: Comprar en ${source.venueName} a ${source.buyRate} y vender en ${dest.venueName} a ${dest.sellRate}. Margen neto real: +${roundedNet}% (+$${profitUsd} USD sobre $${capital} USD).`
        : 'Margen insuficiente tras comisiones y fricción.';

      routes.push({
        routeId: `ROUTE-${source.venueId}-TO-${dest.venueId}-${Date.now().toString(36)}`,
        sourceVenue: source,
        destinationVenue: dest,
        asset: source.currencyPair,
        grossSpreadPct: roundedGross,
        totalFrictionPct: roundedFriction,
        netSpreadPct: roundedNet,
        projectedProfitUsd: profitUsd,
        capitalTestedUsd: capital,
        isActionable,
        hasUnknownFriction,
        ...(hasUnknownFriction ? { reason: 'MISSING_FRICTION_METRICS' as const } : {}),
        securityRating,
        executionPlaybook: playbook,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return routes.sort(compareRoutesByNetSpread);
}

/**
 * Routes with a known net spread rank first, highest first. A route whose net spread is
 * `null` is not comparable to a number, so it goes last instead of poisoning the ordering
 * with NaN. `Array.prototype.sort` is stable, so unpriced routes keep their insertion order
 * and the ranking stays deterministic.
 */
function compareRoutesByNetSpread(
  a: CrossVenueArbitrageRoute,
  b: CrossVenueArbitrageRoute,
): number {
  if (a.netSpreadPct === null || b.netSpreadPct === null) {
    if (a.netSpreadPct === b.netSpreadPct) return 0;
    return a.netSpreadPct === null ? 1 : -1;
  }
  return b.netSpreadPct - a.netSpreadPct;
}
