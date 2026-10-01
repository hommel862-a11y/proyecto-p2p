/**
 * These dispatch sites used a ternary default instead of `requiredNumber`:
 *
 *   args['x'] !== undefined ? Number(args['x']) : <literal>
 *
 * Same semantics as the `?? <literal>` the sweep removed — but a different
 * spelling, so the sweep's grep could not see it. The engine behind them became
 * fail-closed, and this entrance handed it the fabricated number anyway, which
 * defeated the whole layer.
 *
 * These are venue-published measurements, not operator thresholds, so a default
 * is never legitimate here. `policyNumber` stays for real operator choices.
 */
import { describe, it, expect } from 'vitest';
import { executeFinancialSkill } from './agent-skills';
import { forecastFlexibleEarnTierSaturation } from './binance-earn-vault';

describe('agent-skills: los defaults de medición no entran por la puerta de atrás', () => {
  /**
   * `calculate_usdt_fdusd_yield_arbitrage` is the worst of them. With
   * `usdtFdusdMarketRate` defaulted to 1.0, `pegDeviationPct` came out as a
   * perfect `0.000%` AND `marketRate <= 1.0005` passed, so the skill emitted
   * `SWAP_USDT_TO_FDUSD` — an operation recommendation on the user's money,
   * derived from a rate nobody measured.
   */
  it('no convierte una tasa de mercado ausente en un swap recomendado', () => {
    const res = executeFinancialSkill('calculate_usdt_fdusd_yield_arbitrage', {
      usdtBalance: 5000,
      fdusdBalance: 0,
      usdtFlexibleAprPct: 4.1,
      fdusdFlexibleAprPct: 9.2,
      // No usdtFdusdMarketRate: nobody measured it.
    });

    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('SWAP_USDT_TO_FDUSD');
    expect(serialized).not.toContain('SWAP_FDUSD_TO_USDT');
  });

  it('declara qué falta cuando la curva USDT/FDUSD no está medida', () => {
    const res = executeFinancialSkill('calculate_usdt_fdusd_yield_arbitrage', {
      usdtBalance: 5000,
      fdusdBalance: 0,
      usdtFlexibleAprPct: 4.1,
      fdusdFlexibleAprPct: 9.2,
    });

    const serialized = JSON.stringify(res);
    expect(serialized).toContain('NOT_ASSESSED');
    expect(serialized).toContain('usdtFdusdMarketRate');
  });

  it('no inventa un APR alternativo de 2.5% para comparar una alternativa', () => {
    const res = executeFinancialSkill('model_launchpool_capital_parking', {
      capitalUsdt: 1000,
      stakedAsset: 'BNB',
      launchpoolDurationDays: 30,
      totalPoolStaked: 50000,
      dailyRewardPoolTokens: 100,
      estimatedTokenListingPriceUsdt: 5.5,
      // No alternativeEarnAprPct: comparing against an invented APR is not a comparison.
    });

    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('2.5');
    expect(serialized).toContain('alternativeEarnAprPct');
  });

  it('no afirma una cuota instantánea intacta cuando nadie la midió', () => {
    const res = executeFinancialSkill('simulate_earn_instant_redemption_latency', {
      accountTier: 'VIP_1',
      redemptionAmountUsdt: 500000,
      dailyInstantQuotaUsdt: 1000000,
      // No dailyQuotaConsumedUsdt: `?? 0` asserted the whole quota was still free.
    });

    const serialized = JSON.stringify(res);
    // Available quota is unknown, so instant redemption must not be approved
    // and no pending balance may be invented.
    expect(serialized).toContain('NOT_ASSESSED');
    expect(serialized).toContain('dailyQuotaConsumedUsdt');
  });

  it('no autoriza un rescate instantáneo sin cuota medida', () => {
    const res = executeFinancialSkill('simulate_earn_instant_redemption_latency', {
      redemptionAmountUsdt: 500000,
      dailyInstantQuotaUsdt: 1000000,
      dailyQuotaConsumedUsdt: 0,
    });

    expect(res.success).toBe(true);
    const data = res.data as { executionRisk?: string };
    // Consumed=0 supplied, so it is assessed — this one proves the gate is not
    // simply always refusing.
    expect(data.executionRisk).not.toBe('NOT_ASSESSED');
  });

  /**
   * A swap fee of `0` is the single most dangerous default in this module: it is
   * indistinguishable from "the venue charges nothing", so it inflates every
   * projected gain while looking like real evidence.
   *
   * The earlier version of this test supplied `swapFeePct` and asserted the net
   * was negative. That mutant is *equivalent* — supplying the fee means the
   * default branch never runs — so it proved nothing about the default. To test
   * the default, the fee must be absent.
   */
  it('no supone que el swap es gratis cuando nadie midió la comisión', () => {
    const res = executeFinancialSkill('calculate_usdt_fdusd_yield_arbitrage', {
      usdtBalance: 5000,
      fdusdBalance: 0,
      usdtFlexibleAprPct: 4.2,
      fdusdFlexibleAprPct: 6.0,
      usdtFdusdMarketRate: 1.0,
      plannedHorizonDays: 30,
      // No swapFeePct: whether the venue charges for this swap is a fact, not a default.
    });

    const data = res.data as {
      assessmentStatus?: string;
      projectedNetAdvantageUsdt?: number | null;
      missingInputs?: string[];
    };
    expect(data.assessmentStatus).toBe('NOT_ASSESSED');
    expect(data.missingInputs).toContain('swapFeePct');
    // Without the fee there is no honest net number to show.
    expect(data.projectedNetAdvantageUsdt).toBeNull();
  });

  /**
   * `Math.max(0, input.tier1AprPct)` turned an unmeasured APR into a real `0%`,
   * which is worse than an obvious hole: it understates Tier-1 yield and makes a
   * saturated tier look like the reason to move capital elsewhere. The 45 existing
   * tests in `binance-earn-vault.spec.ts` did not catch this.
   */
  it('no convierte un APR de Tier no medido en 0% real', () => {
    const res = forecastFlexibleEarnTierSaturation({
      totalCapitalUsdt: 20000,
      tier1LimitPerAccountUsdt: 5000,
      availableSubaccountsCount: 3,
      // No tier1AprPct / tier2AprPct: nobody measured the venue's rates.
    });

    expect(res.assessmentStatus).toBe('NOT_ASSESSED');
    expect(res.missingInputs).toContain('tier1AprPct');
    expect(res.missingInputs).toContain('tier2AprPct');
    expect(res.singleAccountEffectiveAprPct).toBeNull();
    expect(res.multiAccountOptimizedAprPct).toBeNull();
  });

  /**
   * The counterpart, and the reason `tier1LimitPerAccountUsdt` uses `measured`
   * rather than `measuredPositive`: a limit of 0 and a subaccount count of 0 are
   * real, actionable facts, not absences. `measuredPositive` reported both as
   * NOT_ASSESSED, hiding the very product limitation the operator needs.
   */
  it('trata un límite de Tier 1 de cero como hecho medido, no como ausencia', () => {
    const res = forecastFlexibleEarnTierSaturation({
      totalCapitalUsdt: 20000,
      tier1LimitPerAccountUsdt: 0,
      tier1AprPct: 4.0,
      tier2AprPct: 1.5,
      availableSubaccountsCount: 3,
    });

    expect(res.assessmentStatus).not.toBe('NOT_ASSESSED');
    // Zero Tier-1 capacity means everything sits in the degraded tier.
    expect(res.tier1UtilizedUsdt).toBe(0);
    expect(res.tier2DegradedUsdt).toBe(20000);
    expect(res.missingInputs).toEqual([]);
  });

  /**
   * And the counterpart: with a real fee supplied, the engine must actually do
   * the arithmetic. The engine normalizes APRs to decimal, so the 0.015 gate is
   * 1.5 percentage points. Spread 6.0-4.2 = 1.8 clears it; 30 days on 5000 USDT
   * grosses 7.40 and a 1% fee costs 50, so the honest net is -42.60.
   */
  it('cobra la comisión de swap real en la ganancia proyectada', () => {
    const res = executeFinancialSkill('calculate_usdt_fdusd_yield_arbitrage', {
      usdtBalance: 5000,
      fdusdBalance: 0,
      usdtFlexibleAprPct: 4.2,
      fdusdFlexibleAprPct: 6.0,
      usdtFdusdMarketRate: 1.0,
      swapFeePct: 1.0,
      plannedHorizonDays: 30,
    });

    const data = res.data as {
      optimalSwapDirection?: string;
      projectedNetAdvantageUsdt?: number | null;
    };
    expect(data.optimalSwapDirection).toBe('SWAP_USDT_TO_FDUSD');
    // The fee exceeds the gross spread: the honest answer is "this loses money".
    expect(data.projectedNetAdvantageUsdt).toBeLessThan(0);
  });
});
