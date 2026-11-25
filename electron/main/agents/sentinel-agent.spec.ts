import { describe, it, expect } from 'vitest';
import { SentinelAgent } from './sentinel-agent';

/**
 * Doctrine under test: a missing measurement is `null` plus a declared absence, never a number.
 *
 * `scanMarket` used to answer `params?.bcvRate ?? 72.0` and `params?.parallelRate ?? 88.5`, so a
 * caller that measured nothing still got a 22.92% "brecha BCV" and a risk note built on it.
 * `runMarketDiagnostic` was worse: it passed the same two numbers unconditionally, without ever
 * looking at an input.
 */

/** A book with no BCV/parallel measurement behind it — the shape the swarm passes by default. */
const BOOK_ONLY = { bestBid: 88, bestAsk: 89 } as const;

describe('SentinelAgent — declared absence instead of a fabricated rate', () => {
  it('no inventa la tasa BCV ni la de paralelo cuando el llamador no aporta medición', () => {
    const signal = new SentinelAgent().scanMarket({ ...BOOK_ONLY });

    expect(signal.bcvRate).toBeNull();
    expect(signal.parallelRate).toBeNull();
    // The gap is arithmetic on the two rates, so it is unknown too — never 0, which would read
    // as "there is no gap".
    expect(signal.rateGapPct).toBeNull();
  });

  it('declara la ausencia nombrando la fuente que la satisfaría', () => {
    const signal = new SentinelAgent().scanMarket({ ...BOOK_ONLY });
    const notes = signal.notes.join('\n');

    // The human-readable rendering must name the absence, never print a number or a blank.
    expect(notes).toContain('N/D');
    expect(notes).toMatch(/get_bcv_rates/);
    expect(notes).toMatch(/get_parallel_rates/);
    // 72.0 / 88.5 were the invented pair; they must not survive anywhere in the output.
    expect(notes).not.toMatch(/72(\.0+)?%|88\.5/);
  });

  it('usa las tasas medidas cuando el llamador las aporta', () => {
    const signal = new SentinelAgent().scanMarket({
      ...BOOK_ONLY,
      bcvRate: 64.2,
      parallelRate: 85.5,
    });

    expect(signal.bcvRate).toBe(64.2);
    expect(signal.parallelRate).toBe(85.5);
    // (85.5 - 64.2) / 64.2 = 33.1775...% -> 33.18, rounded by the predictor.
    expect(signal.rateGapPct).toBe(33.18);
  });

  it('no emite la nota de brecha elevada cuando la brecha no fue medida', () => {
    const signal = new SentinelAgent().scanMarket({ ...BOOK_ONLY });

    expect(signal.notes.join('\n')).not.toContain('Brecha BCV/Paralelo elevada');
  });

  it('runMarketDiagnostic no publica zona de riesgo BCV calculada sobre tasas inventadas', () => {
    // The method takes no parameters, so it can never hold a measured rate. It used to hardcode
    // 88.5 / 72.0 and answer 'NORMAL'.
    const diagnostic = new SentinelAgent().runMarketDiagnostic();

    expect(diagnostic.bcvInterventionRisk).toBe('UNAVAILABLE');
    expect(diagnostic.flowToxicityRisk).toBe('UNAVAILABLE');
  });

  it('runMarketDiagnostic lee toxicityClassification real cuando se proveen buckets VPIN', () => {
    const diagnostic = new SentinelAgent().runMarketDiagnostic({
      vpinBuckets: [{ buyVolume: 900, sellVolume: 100, totalVolume: 1000 }],
    });

    expect(diagnostic.flowToxicityRisk).toBe('EXTREME_ADVERSE_SELECTION');
  });

  it('scanMarket declara VPIN UNAVAILABLE sin buckets y usa vpinScore/toxicityClassification cuando existen', () => {
    const withoutBuckets = new SentinelAgent().scanMarket({ ...BOOK_ONLY });
    expect(withoutBuckets.notes.join('\n')).toContain('UNAVAILABLE');
    expect(withoutBuckets.notes.join('\n')).not.toContain('LOW_RETAIL');

    const withBuckets = new SentinelAgent().scanMarket({
      ...BOOK_ONLY,
      vpinBuckets: [{ buyVolume: 850, sellVolume: 150, totalVolume: 1000 }],
    });
    const notes = withBuckets.notes.join('\n');
    expect(notes).toContain('EXTREME_ADVERSE_SELECTION');
    expect(notes).toContain('70.0%');
  });

  it('NO inventa 88.5/89.8 cuando no hay libro en vivo ni parámetros de orden', () => {
    const signal = new SentinelAgent().scanMarket();
    expect(signal.isViable).toBe(false);
    expect(signal.esSimulado).toBe(true);
    expect(signal.bestBid).toBe(0);
    expect(signal.bestAsk).toBe(0);
    expect(signal.unavailableReason).toContain('NO_LIVE_FEED');
  });
});
