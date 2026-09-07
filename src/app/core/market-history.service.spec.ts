import { TestBed } from '@angular/core/testing';
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
});
