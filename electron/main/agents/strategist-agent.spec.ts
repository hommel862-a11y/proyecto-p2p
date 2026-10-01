import { describe, it, expect } from 'vitest';
import { StrategistAgent } from './strategist-agent';
import type { SentinelSignal } from './types';

/**
 * Doctrine under test: an operator-facing string must render the absence explicitly.
 *
 * `plan.rationale` used to read `signal.rateGapPct?.toFixed(1) ?? '22.9'`, so a signal with no
 * measured gap produced the operational claim "Brecha BCV en 22.9% y liquidez profunda". It is a
 * string, which is why a numeric sweep never found it.
 */

function signalWith(overrides: Partial<SentinelSignal>): SentinelSignal {
  return {
    timestamp: Date.now(),
    source: 'Binance P2P + BCV Feeds',
    asset: 'USDT',
    fiat: 'VES',
    grossSpreadPct: 1.14,
    netSpreadPct: 0.74,
    bestBid: 88,
    bestAsk: 89,
    bcvRate: null,
    parallelRate: null,
    rateGapPct: null,
    isViable: true,
    notes: [],
    ...overrides,
  };
}

describe('StrategistAgent — la brecha BCV del rationale es una medición o una ausencia', () => {
  it('no inventa la brecha BCV en el rationale cuando la medición no existe', () => {
    const proposal = new StrategistAgent().formulateProposal(signalWith({}), 1000);

    expect(proposal.plan.rationale).not.toContain('22.9');
    expect(proposal.plan.rationale).toContain('N/D');
    // The absence must point at the feed that would satisfy it.
    expect(proposal.plan.rationale).toMatch(/get_bcv_rates/);
    expect(proposal.plan.rationale).toMatch(/get_parallel_rates/);
  });

  it('propaga la brecha medida cuando el centinela la entregó', () => {
    const proposal = new StrategistAgent().formulateProposal(
      signalWith({ bcvRate: 64.2, parallelRate: 85.5, rateGapPct: 33.18 }),
      1000,
    );

    // 33.18.toFixed(1) === '33.2'
    expect(proposal.plan.rationale).toContain('Brecha BCV en 33.2%');
    expect(proposal.plan.rationale).not.toContain('N/D');
  });

  it('no afirma urgencia de intervención cambiaria sobre una brecha no medida', () => {
    const proposal = new StrategistAgent().formulateProposal(signalWith({}), 1000);

    expect(proposal.recommendedTiming).toContain('ESTÁNDAR');
  });
});
