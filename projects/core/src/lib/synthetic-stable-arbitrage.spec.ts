import { describe, it, expect } from 'vitest';
import {
  calculateSyntheticStableOpportunity,
  scanSyntheticStableCurves,
  type StableCrossQuote,
  type SyntheticStableOpportunity,
} from './synthetic-stable-arbitrage';
import { evaluateTriangularSlippageRisk, type SlippageRiskGuardResult } from './triangular-arbitrage';
import { roundMoney } from './money';

describe('SyntheticStableArbitrage Engine', () => {
  it('detects profitable CONVERT_SPOT_AND_SELL_P2P opportunity', () => {
    // Spot: 1 USDC = 0.9980 USDT (discount on spot)
    // USDT/VES on P2P = 85.00
    // Synthetic cost = 0.9980 * 85.00 = 84.83 Bs
    // USDC/VES on P2P = 86.80 Bs (USDC trades at a premium in local P2P)
    const quote: StableCrossQuote = {
      targetAsset: 'USDC',
      spotPair: 'USDCUSDT',
      spotRate: 0.998,
      spotFeePct: 0.0, // Binance Zero-Fee promo
      p2pMakerFeePct: 0.1,
      transferOrCashFrictionPct: 0.2,
      p2pUsdtRateFiat: 85.0,
      p2pTargetRateFiat: 86.8,
      tradingCapitalUsd: 2000,
    };

    const opp = calculateSyntheticStableOpportunity(quote);
    expect(opp.direction).toBe('CONVERT_SPOT_AND_SELL_P2P');
    expect(opp.isActionable).toBe(true);
    expect(opp.reason).toBeUndefined();
    expect(opp.missingCostInputs).toEqual([]);
    expect(opp.netSpreadPct).toBeGreaterThan(1.5);
    expect(opp.projectedProfitUsd).toBeGreaterThan(30);
    expect(opp.syntheticP2pEquivalentRate).toBeCloseTo(84.83, 1);
  });

  it('rejects unaligned markets with zero or negative spread', () => {
    const flatQuote: StableCrossQuote = {
      targetAsset: 'FDUSD',
      spotPair: 'FDUSDUSDT',
      spotRate: 1.0,
      spotFeePct: 0.0,
      p2pMakerFeePct: 0.0,
      transferOrCashFrictionPct: 0.0,
      p2pUsdtRateFiat: 85.0,
      p2pTargetRateFiat: 85.0,
      tradingCapitalUsd: 1000,
    };

    const opp = calculateSyntheticStableOpportunity(flatQuote);
    expect(opp.isActionable).toBe(false);
    expect(opp.projectedProfitUsd).toBe(0);
  });

  it('scans and ranks multiple stablecoin quotes in descending order of profitability', () => {
    const quotes: StableCrossQuote[] = [
      {
        targetAsset: 'FDUSD',
        spotPair: 'FDUSDUSDT',
        spotRate: 1.0,
        spotFeePct: 0.05,
        p2pMakerFeePct: 0.1,
        transferOrCashFrictionPct: 0.2,
        p2pUsdtRateFiat: 85.0,
        p2pTargetRateFiat: 85.1,
      },
      {
        targetAsset: 'USDC',
        spotPair: 'USDCUSDT',
        spotRate: 0.9975,
        spotFeePct: 0.05,
        p2pMakerFeePct: 0.1,
        transferOrCashFrictionPct: 0.2,
        p2pUsdtRateFiat: 85.0,
        p2pTargetRateFiat: 87.0, // Large gap
      },
      {
        targetAsset: 'EURC',
        spotPair: 'EURCUSDT',
        spotRate: 1.085,
        spotFeePct: 0.05,
        p2pMakerFeePct: 0.1,
        transferOrCashFrictionPct: 0.2,
        p2pUsdtRateFiat: 85.0,
        p2pTargetRateFiat: 93.0,
      },
    ];

    const ranked = scanSyntheticStableCurves(quotes);
    expect(ranked).toHaveLength(3);
    // Every quote above is fully priced, so a null here would be a contract violation.
    const spreads = ranked.map(knownNetSpread);
    expect(spreads[0]).toBeGreaterThanOrEqual(spreads[1]);
    expect(spreads[1]).toBeGreaterThanOrEqual(spreads[2]);
  });

  // ---------------------------------------------------------------------------
  // Remediation contract: absence of a friction term must BLOCK, never default.
  // ---------------------------------------------------------------------------

  it('nunca declara isActionable sin friccion explicita', () => {
    const quoteWithoutFriction: StableCrossQuote = {
      targetAsset: 'USDC',
      spotPair: 'USDCUSDT',
      spotRate: 0.998,
      spotFeePct: 0.0,
      p2pMakerFeePct: 0.1,
      // transferOrCashFrictionPct omitted on purpose.
      p2pUsdtRateFiat: 85.0,
      p2pTargetRateFiat: 86.8,
      tradingCapitalUsd: 2000,
    };

    const opp = calculateSyntheticStableOpportunity(quoteWithoutFriction);
    expect(opp.isActionable).toBe(false);
    expect(opp.reason).toBe('MISSING_FRICTION_METRICS');
    expect(opp.missingCostInputs).toContain('transferOrCashFrictionPct');
    // No profit may be projected off an unpriced cost term.
    expect(opp.projectedProfitUsd).toBe(0);
  });

  it('bloquea tambien cuando falta la fee P2P o la fee spot', () => {
    const base: StableCrossQuote = {
      targetAsset: 'USDC',
      spotPair: 'USDCUSDT',
      spotRate: 0.998,
      spotFeePct: 0.0,
      p2pMakerFeePct: 0.1,
      transferOrCashFrictionPct: 0.2,
      p2pUsdtRateFiat: 85.0,
      p2pTargetRateFiat: 86.8,
      tradingCapitalUsd: 2000,
    };

    const noP2pFee = calculateSyntheticStableOpportunity({ ...base, p2pMakerFeePct: undefined });
    expect(noP2pFee.isActionable).toBe(false);
    expect(noP2pFee.reason).toBe('MISSING_FRICTION_METRICS');
    expect(noP2pFee.missingCostInputs).toContain('p2pMakerFeePct');

    const noSpotFee = calculateSyntheticStableOpportunity({ ...base, spotFeePct: undefined });
    expect(noSpotFee.isActionable).toBe(false);
    expect(noSpotFee.reason).toBe('MISSING_FRICTION_METRICS');
    expect(noSpotFee.missingCostInputs).toContain('spotFeePct');
  });

  it('propaga slippage desde calculateTriangularArbitrage', () => {
    const quote: StableCrossQuote = {
      targetAsset: 'USDC',
      spotPair: 'USDCUSDT',
      spotRate: 0.998,
      spotFeePct: 0.0,
      p2pMakerFeePct: 0.1,
      transferOrCashFrictionPct: 0.2,
      p2pUsdtRateFiat: 85.0,
      p2pTargetRateFiat: 86.8,
      tradingCapitalUsd: 2000,
    };

    const opp = calculateSyntheticStableOpportunity(quote);

    // The guard is the base engine's, not a local re-implementation.
    const expected = evaluateTriangularSlippageRisk({
      initialSpreadPct: knownNetSpread(opp),
      volatileAsset: 'USDC',
      estimatedSettlementMinutes: 30,
    });
    expect(opp.slippageGuard).toEqual(expected);
    expect(opp.slippageGuard.worstCaseSlippagePct).toBeGreaterThan(0);

    // Actionability is gated by the guard, so the adapter cannot bypass it.
    expect(opp.isActionable).toBe(slippageGuardAllows(opp.slippageGuard));
  });

  it('el slippage guard puede vetoear una oportunidad por encima del umbral', () => {
    // A net spread above the threshold that the guard still rejects must not be actionable.
    const thinButPositive: StableCrossQuote = {
      targetAsset: 'FDUSD',
      spotPair: 'FDUSDUSDT',
      spotRate: 1.0,
      spotFeePct: 0.0,
      p2pMakerFeePct: 0.0,
      transferOrCashFrictionPct: 0.0,
      p2pUsdtRateFiat: 85.0,
      p2pTargetRateFiat: 85.2,
      tradingCapitalUsd: 1000,
    };

    const opp = calculateSyntheticStableOpportunity(thinButPositive, 0.0);
    const netSpread = knownNetSpread(opp);
    expect(netSpread).toBeGreaterThan(0);
    expect(opp.slippageGuard.netRiskAdjustedSpreadPct).toBe(
      roundMoney(netSpread - opp.slippageGuard.worstCaseSlippagePct, 2),
    );
    // Whatever the guard says is what governs actionability.
    expect(opp.isActionable).toBe(
      opp.slippageGuard.recommendation === 'OPERAR' && opp.slippageGuard.netRiskAdjustedSpreadPct > 0.3,
    );
  });

  it('no emite ningun veredicto afirmativo sin fuente real', () => {
    const quotes: StableCrossQuote[] = [
      // Fully priced.
      {
        targetAsset: 'USDC',
        spotPair: 'USDCUSDT',
        spotRate: 0.998,
        spotFeePct: 0.0,
        p2pMakerFeePct: 0.1,
        transferOrCashFrictionPct: 0.2,
        p2pUsdtRateFiat: 85.0,
        p2pTargetRateFiat: 86.8,
        tradingCapitalUsd: 2000,
      },
      // No cost terms at all: a real EURC depeg, but completely unpriced.
      {
        targetAsset: 'EURC',
        spotPair: 'EURCUSDT',
        spotRate: 1.085,
        p2pUsdtRateFiat: 85.0,
        p2pTargetRateFiat: 93.0,
        tradingCapitalUsd: 2000,
      },
    ];

    const all = scanSyntheticStableCurves(quotes, 0.0);

    for (const opp of all) {
      const serialized = JSON.stringify(opp);
      expect(serialized).not.toMatch(/SAFE_TO_/);
      expect(serialized).not.toMatch(/APPROVE_/);
      expect(serialized).not.toMatch(/"isViable":/);
      // An unpriced opportunity never carries a projected profit.
      if (opp.reason === 'MISSING_FRICTION_METRICS') {
        expect(opp.isActionable).toBe(false);
        expect(opp.projectedProfitUsd).toBe(0);
        expect(opp.missingCostInputs.length).toBeGreaterThan(0);
      }
    }
  });
});

function slippageGuardAllows(guard: SlippageRiskGuardResult): boolean {
  return guard.recommendation === 'OPERAR';
}

/**
 * Narrows a priced net spread for the tests that operate on fully parameterized quotes.
 * A `null` here is a contract violation, so it fails loudly instead of coercing to 0 and
 * hiding a regression where an unpriced route starts reporting a margin again.
 */
function knownNetSpread(opp: SyntheticStableOpportunity): number {
  if (opp.netSpreadPct === null) {
    throw new Error(
      `Expected a priced net spread for ${opp.id} but got null (reason: ${opp.reason ?? 'none'}, ` +
        `missing: ${opp.missingCostInputs.join(', ') || 'none'})`,
    );
  }
  return opp.netSpreadPct;
}
