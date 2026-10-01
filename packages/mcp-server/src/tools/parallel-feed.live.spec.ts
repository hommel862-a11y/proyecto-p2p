import { describe, expect, it } from 'vitest';
import { toParallelReading } from './get_parallel_rates.js';
import { getParallelRatesFeed } from '../core/index.js';

/**
 * The parallel feed reads two independent Binance requests, so the two decisions
 * that carry real risk are: which side is the ask, and whether the book is
 * coherent. Both are pure and both are testable here without a network call.
 */
describe('toParallelReading', () => {
  it('trata buyRate como ask (lo que se paga) y sellRate como bid (lo que se recibe)', () => {
    const reading = toParallelReading({ buyRate: 36.8, sellRate: 36.2 });

    expect(reading).not.toBeNull();
    expect(reading!.ask).toBe(36.8);
    expect(reading!.bid).toBe(36.2);
  });

  it('produce un spread positivo, no invertido', () => {
    const reading = toParallelReading({ buyRate: 36.8, sellRate: 36.2 });
    const feed = getParallelRatesFeed(undefined, [reading!]);

    const entry = feed.sources['Binance P2P'];
    expect(entry.spreadPct).toBeGreaterThan(0);
    expect(entry.ask).toBeGreaterThan(entry.bid);
  });

  it('rechaza un libro cruzado en vez de publicar un spread negativo', () => {
    // El maker más barato que VENDE por debajo del más caro que COMPRA: mercado
    // imposible. Con `spreadPct = (ask - bid) / bid`, publicarlo se leería como
    // un arbitraje real.
    expect(toParallelReading({ buyRate: 35.9, sellRate: 36.4 })).toBeNull();
  });

  it('acepta un libro plano (ask === bid) con spread cero', () => {
    // Cero es un dato real; no es ausencia.
    const reading = toParallelReading({ buyRate: 36.5, sellRate: 36.5 });
    expect(reading).not.toBeNull();
    expect(getParallelRatesFeed(undefined, [reading!]).sources['Binance P2P'].spreadPct).toBe(0);
  });

  it.each([
    ['sin lectura', null],
    ['ask cero', { buyRate: 0, sellRate: 36 }],
    ['bid cero', { buyRate: 36, sellRate: 0 }],
    ['ask NaN', { buyRate: Number.NaN, sellRate: 36 }],
    ['bid infinito', { buyRate: 36, sellRate: Number.POSITIVE_INFINITY }],
    ['ask negativo', { buyRate: -1, sellRate: 36 }],
  ])('devuelve null ante %s', (_label, rates) => {
    expect(toParallelReading(rates as any)).toBeNull();
  });

  it('nombra la fuente sin componerla', () => {
    expect(toParallelReading({ buyRate: 36.8, sellRate: 36.2 })!.source).toBe('Binance P2P');
  });
});

/**
 * Dispersion measures disagreement between venues. With one venue the arithmetic
 * collapses to 0 and claims "every monitor agrees perfectly" from a sample of one.
 */
describe('dispersión entre monitores', () => {
  const at = (source: string, ask: number, bid: number) => ({
    source, ask, bid, fetchedAt: '2026-09-30T12:00:00Z',
  });

  it('es null con un solo monitor leído', () => {
    const feed = getParallelRatesFeed(undefined, [at('Binance P2P', 36.8, 36.2)]);
    expect(feed.provenance).toBe('LIVE');
    expect(feed.sourcesCount ?? Object.keys(feed.sources).length).toBe(1);
    expect(feed.summary.dispersionPct).toBeNull();
  });

  it('es null con cero monitores', () => {
    expect(getParallelRatesFeed(undefined, []).summary.dispersionPct).toBeNull();
  });

  it('aparece con dos monitores que discrepan de verdad', () => {
    const feed = getParallelRatesFeed(undefined, [
      at('Binance P2P', 36.8, 36.2),
      at('Otro monitor', 40.0, 39.0),
    ]);
    expect(feed.summary.dispersionPct).not.toBeNull();
    expect(feed.summary.dispersionPct).toBeGreaterThan(0);
  });

  it('es 0 sólo cuando dos monitores coinciden exactamente', () => {
    const feed = getParallelRatesFeed(undefined, [
      at('A', 36.5, 36.5),
      at('B', 36.5, 36.5),
    ]);
    // Cero con N=2 es un dato; con N=1 era una conclusión fabricada.
    expect(feed.summary.dispersionPct).toBe(0);
  });
});