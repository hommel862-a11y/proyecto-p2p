import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketHistoryService } from './market-history.service';
import { StorageService } from './storage';

describe('MarketHistoryService', () => {
  let service: MarketHistoryService;
  let storage: StorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MarketHistoryService);
    storage = TestBed.inject(StorageService);
    service.clearHistory();
  });

  afterEach(() => {
    vi.useRealTimers();
    service.clearHistory();
  });

  it('should be created and start empty or with persisted data', () => {
    expect(service).toBeTruthy();
    expect(service.history()).toEqual([]);
    expect(service.stats().totalPoints).toBe(0);
  });

  it('should record snapshots and compute stats reactively', () => {
    service.recordSnapshot({
      pair: 'USDT',
      bank: 'BANESCO',
      bestBuyPrice: 800,
      bestSellPrice: 820,
      spreadVes: 20,
      spreadPct: 2.5,
    });

    expect(service.history().length).toBe(1);
    expect(service.stats().totalPoints).toBe(1);
    expect(service.stats().averageSpreadVes).toBe(20);
    expect(service.stats().lastSpreadVes).toBe(20);
  });

  it('should filter snapshots by bank', () => {
    service.recordSnapshot({
      pair: 'USDT',
      bank: 'BANESCO',
      bestBuyPrice: 800,
      bestSellPrice: 820,
      spreadVes: 20,
      spreadPct: 2.5,
    });

    service.recordSnapshot({
      pair: 'USDT',
      bank: 'MERCANTIL',
      bestBuyPrice: 805,
      bestSellPrice: 822,
      spreadVes: 17,
      spreadPct: 2.1,
    });

    expect(service.getFilteredPoints('BANESCO').length).toBe(1);
    expect(service.getFilteredPoints('MERCANTIL').length).toBe(1);
    expect(service.getFilteredPoints('ALL').length).toBe(2);
  });

  it('updates history synchronously while debouncing storage.set writes and supports flushPersistence', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
    const setSpy = vi.spyOn(storage, 'set');

    service.recordSnapshot({
      pair: 'USDT',
      bank: 'BANESCO',
      bestBuyPrice: 800,
      bestSellPrice: 820,
      spreadVes: 20,
      spreadPct: 2.5,
    });
    vi.advanceTimersByTime(100);
    service.recordSnapshot({
      pair: 'USDT',
      bank: 'BANESCO',
      bestBuyPrice: 802,
      bestSellPrice: 824,
      spreadVes: 22,
      spreadPct: 2.74,
    });

    // Signal updates immediately, disk write is debounced
    expect(service.history().length).toBe(2);
    expect(setSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(450);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith('p2p.market-history', service.history());

    // flushPersistence writes immediately without waiting for timer
    vi.advanceTimersByTime(1000);
    service.recordSnapshot({
      pair: 'USDT',
      bank: 'MERCANTIL',
      bestBuyPrice: 804,
      bestSellPrice: 825,
      spreadVes: 21,
      spreadPct: 2.61,
    });
    expect(setSpy).toHaveBeenCalledTimes(1);
    service.flushPersistence();
    expect(setSpy).toHaveBeenCalledTimes(2);
  });

  it('cancels pending debounce writes in clearHistory and flushes cleanly in ngOnDestroy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
    const setSpy = vi.spyOn(storage, 'set');
    const removeSpy = vi.spyOn(storage, 'remove');

    service.recordSnapshot({
      pair: 'USDT',
      bank: 'BANESCO',
      bestBuyPrice: 800,
      bestSellPrice: 820,
      spreadVes: 20,
      spreadPct: 2.5,
    });
    service.clearHistory();
    vi.advanceTimersByTime(600);

    expect(removeSpy).toHaveBeenCalledWith('p2p.market-history');
    expect(setSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    service.recordSnapshot({
      pair: 'USDT',
      bank: 'BANESCO',
      bestBuyPrice: 810,
      bestSellPrice: 830,
      spreadVes: 20,
      spreadPct: 2.47,
    });
    service.ngOnDestroy();
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('computes measured 4h window volatility pct when >= 2 points exist and null otherwise', () => {
    vi.useFakeTimers();
    const t0 = new Date('2026-11-18T12:00:00.000Z');
    vi.setSystemTime(t0);

    expect(service.computeWindowVolatilityPct('BANESCO')).toBeNull();

    service.recordSnapshot({
      pair: 'USDT',
      bank: 'BANESCO',
      bestBuyPrice: 800,
      bestSellPrice: 820,
      spreadVes: 20,
      spreadPct: 2.5,
    });
    expect(service.computeWindowVolatilityPct('BANESCO')).toBeNull();

    vi.advanceTimersByTime(60_000);
    service.recordSnapshot({
      pair: 'USDT',
      bank: 'BANESCO',
      bestBuyPrice: 808,
      bestSellPrice: 828,
      spreadVes: 20,
      spreadPct: 2.48,
    });

    // Mid prices: 810 and 818 -> mean 814, stddev 4 -> (4 / 814) * 100 ≈ 0.4914%
    const vol = service.computeWindowVolatilityPct('BANESCO', 4 * 3600_000);
    expect(vol).not.toBeNull();
    expect(vol!).toBeGreaterThan(0.45);
    expect(vol!).toBeLessThan(0.55);

    // Other bank with 0 points still returns null
    expect(service.computeWindowVolatilityPct('MERCANTIL', 4 * 3600_000)).toBeNull();

    // Advance 5 hours so points fall outside 4h window
    vi.advanceTimersByTime(5 * 3600_000);
    expect(service.computeWindowVolatilityPct('BANESCO', 4 * 3600_000)).toBeNull();
  });
});
