import { describe, expect, it } from 'vitest';
import {
  calculateBcvGap,
  computeAutofillTradePrice,
  getOfficialBcvRates,
  getParallelRatesFeed,
  predictBcvIntervention,
  evaluateMacroBcvRegime,
} from './index.js';
import { PredictBcvMacroRegimeInputSchema } from '../schemas/index.js';

/**
 * The defect class: numbers that describe the external world with nothing behind
 * them, presented with the authority of a measurement.
 *
 *   getOfficialBcvRates()  -> usd: 68.45, source: 'BCV_OFFICIAL_FEED'
 *   getParallelRatesFeed() -> binance_p2p 79.8/78.9, criptonoticias 80.2/79.1,
 *                             enparalelovzla 80.5/79.4, cotizave 79.7/78.8
 *   predictBcvIntervention() -> probabilityPct: 95 | 85 | 80 | 75
 *
 * No feed, no monitors, no model. Every one of these is a hardcoded literal with
 * a source label attached to it, and the labels are what an agent trusts.
 *
 * The contract tested here: absence propagates as absence, and a real reading
 * flows through unchanged when one exists.
 */

describe('getOfficialBcvRates — no hay feed, no hay tasa', () => {
  it('does not publish the hardcoded 68.45 as an official BCV rate', () => {
    const rates = getOfficialBcvRates(true, null);

    expect(rates.usd).toBeNull();
    expect(rates.eur).toBeNull();
    expect(rates.cny).toBeNull();
    expect(rates.rub).toBeNull();
    expect(JSON.stringify(rates)).not.toContain('68.45');
  });

  it('never claims BCV_OFFICIAL_FEED when nothing was read', () => {
    const rates = getOfficialBcvRates(true, null);

    expect(rates.source).not.toBe('BCV_OFFICIAL_FEED');
    expect(rates.provenance).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
    expect(rates.unavailableReason).toBeTruthy();
    // A missing rate must name where it would have come from.
    expect(rates.expectedSource).toBeTruthy();
    expect(rates.actionable).toBe(false);
  });

  it('does not invent an effective date for a rate that does not exist', () => {
    const rates = getOfficialBcvRates(true, null);
    expect(rates.effectiveDate).toBeNull();
  });
});

describe('getOfficialBcvRates — con lectura real, el número real sale', () => {
  it('returns exactly the observed reading and marks it live', () => {
    const rates = getOfficialBcvRates(false, {
      usd: 857.8876,
      eur: 928.1,
      cny: 119.4,
      rub: 8.71,
      effectiveDate: '2026-09-29',
      source: 'Cotizave market `oficial`',
      fetchedAt: '2026-09-29T12:00:00.000Z',
    });

    expect(rates.usd).toBe(857.8876);
    expect(rates.eur).toBe(928.1);
    expect(rates.effectiveDate).toBe('2026-09-29');
    expect(rates.provenance).toBe('LIVE');
    expect(rates.source).toBe('Cotizave market `oficial`');
    expect(rates.isFallback).toBe(false);
  });

  it('rejects a partial reading instead of filling the missing currencies', () => {
    const rates = getOfficialBcvRates(false, {
      usd: 857.8876,
      eur: null,
      cny: null,
      rub: null,
      effectiveDate: '2026-09-29',
      source: 'Cotizave market `oficial`',
      fetchedAt: '2026-09-29T12:00:00.000Z',
    });

    expect(rates.usd).toBe(857.8876);
    expect(rates.eur).toBeNull();
    expect(rates.cny).toBeNull();
    expect(rates.rub).toBeNull();
  });
});

describe('getParallelRatesFeed — no hay monitores, no hay cotizaciones', () => {
  it('does not publish four named monitors nobody polled', () => {
    const feed = getParallelRatesFeed(undefined, []);

    expect(feed.sources).toEqual({});
    expect(feed.provenance).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
    expect(feed.unavailableReason).toBeTruthy();
    expect(feed.actionable).toBe(false);
  });

  it('never emits the hardcoded summary numbers as a reading', () => {
    const feed = getParallelRatesFeed(undefined, []);

    // 79.5 / 80.5 / 78.8 were the empty-case fallbacks.
    expect(feed.summary.averageMid).toBeNull();
    expect(feed.summary.highestAsk).toBeNull();
    expect(feed.summary.lowestBid).toBeNull();
    expect(feed.summary.dispersionPct).toBeNull();

    const serialised = JSON.stringify(feed);
    for (const fabricated of ['79.5', '80.5', '78.8', '79.8', '78.9', '80.2', '79.1']) {
      expect(serialised).not.toContain(fabricated);
    }
  });

  it('summarises only the venues actually read', () => {
    const feed = getParallelRatesFeed(undefined, [
      { source: 'binance_p2p', ask: 80.6, bid: 78.4, fetchedAt: '2026-09-29T12:00:00.000Z' },
      { source: 'enparalelovzla', ask: 81.2, bid: 79.1, fetchedAt: '2026-09-29T12:00:00.000Z' },
    ]);

    expect(Object.keys(feed.sources).sort()).toEqual(['binance_p2p', 'enparalelovzla']);
    expect(feed.provenance).toBe('LIVE');
    expect(feed.summary.averageMid).toBeCloseTo((79.5 + 80.15) / 2, 2);
    expect(feed.summary.highestAsk).toBe(81.2);
    expect(feed.summary.lowestBid).toBe(78.4);
  });
});

describe('calculateBcvGap — sin una de las dos tasas, la brecha se desconoce', () => {
  it('does not report a zero gap when the official rate is missing', () => {
    const gap = calculateBcvGap(80.0, null);

    // 0% / NORMAL reads as "there is no gap", which is a claim about the world.
    expect(gap.gapPct).toBeNull();
    expect(gap.gapVes).toBeNull();
    expect(gap.zone).toBe('UNAVAILABLE');
    expect(gap.bcvRate).toBeNull();
    expect(gap.parallelRate).toBe(80.0);
    expect(gap.actionable).toBe(false);
  });

  it('does not report a zero gap when the parallel rate is missing', () => {
    const gap = calculateBcvGap(null, 857.8876);
    expect(gap.gapPct).toBeNull();
    expect(gap.zone).toBe('UNAVAILABLE');
  });

  it('still computes the real gap when both rates are present', () => {
    const gap = calculateBcvGap(80.0, 68.45);

    expect(gap.gapVes).toBe(11.55);
    expect(gap.gapPct).toBe(16.87);
    expect(gap.zone).toBe('NORMAL');
    expect(gap.actionable).toBe(true);
  });
});

describe('predictBcvIntervention — no hay modelo, no hay probabilidad', () => {
  it('does not emit a probability derived from the calendar alone', () => {
    const window = predictBcvIntervention(new Date('2026-09-28T15:00:00.000Z'));

    // 95/85/80/75 came from day-of-week and hour. There is no model behind them.
    expect(window.probabilityPct).toBeNull();
    expect(window.probabilityBasis).toBe('NO_MODEL');
    expect(window.actionable).toBe(false);
  });

  it('keeps the observable part: the clock in Venezuela', () => {
    const window = predictBcvIntervention(new Date('2026-09-28T15:00:00.000Z'));
    expect(typeof window.vetHour).toBe('number');
    expect(typeof window.vetDayOfWeek).toBe('number');
    expect(window.rationale).toContain('no hay modelo');
  });
});

describe('computeAutofillTradePrice — sin mid real no hay precio de orden', () => {
  it('does not suggest an order price from a fabricated mid', () => {
    const res = computeAutofillTradePrice('BUY', 1.0, null);

    expect(res.referenceMidRate).toBeNull();
    expect(res.suggestedPrice).toBeNull();
    expect(res.marginVes).toBeNull();
    expect(res.actionable).toBe(false);
    expect(res.unavailableReason).toBeTruthy();
  });

  it('computes the real price when a real mid is supplied', () => {
    const res = computeAutofillTradePrice('SELL', 1.0, 80.0);

    expect(res.referenceMidRate).toBe(80.0);
    expect(res.suggestedPrice).toBe(80.8);
    expect(res.actionable).toBe(true);
  });
});
describe('predict_bcv_macro_regime — sin lectura real no hay cifra del mundo real', () => {
  it('never invents a weekly BCV injection amount when none was measured', () => {
    // The schema carried `estimatedWeeklyBcvInjectionUsd: z.number().positive()
    // .default(50000000)`. A Zod default means the caller passes nothing and the
    // system still asserts "$50M per week", which the directive then prints as
    // "Inyecci\u00f3n inminente estimada en $50M USD". An invented fact, silently
    // supplied, then laundered into a trade instruction.
    const input = PredictBcvMacroRegimeInputSchema.parse({ bcvOfficialRate: 78.7, parallelMarketRate: 98 });
    expect(input.estimatedWeeklyBcvInjectionUsd).toBeUndefined();
  });

  it('does not print a dollar figure in the directive when injection is unknown', () => {
    const assessment = evaluateMacroBcvRegime({
      bcvOfficialRate: 78.7,
      parallelMarketRate: 98,
      daysSinceLastIntervention: 6,
      currentHourOfDayUtcMinus4: 10,
      currentDayOfWeek: 1,
    });

    expect(assessment.tacticalDirective).not.toMatch(/\$50M|\$50 M|50M USD/);
    expect(assessment.tacticalDirective).not.toContain('Inyecci\u00f3n inminente estimada');
  });

  it('declares its probability as uncalibrated rather than emitting a bare percentage', () => {
    const assessment = evaluateMacroBcvRegime({
      bcvOfficialRate: 78.7,
      parallelMarketRate: 98,
      daysSinceLastIntervention: 6,
      currentHourOfDayUtcMinus4: 10,
      currentDayOfWeek: 1,
    });

    expect(assessment.probabilityBasis).toBe('HEURISTIC_UNCALIBRATED');
  });
});
