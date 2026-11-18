import '@angular/compiler';
import { Injector, signal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BinanceP2pMarketDepth, BankAccount, TreasurySummary } from '@p2p/core';
import { SpreadQualityService } from './spread-quality.service';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import { MarketHistoryService } from './market-history.service';
import { StorageService } from './storage';
import { MemoryStorage } from './memory-storage';

function makeDepth(bestBuyPrice: number, bestSellPrice: number): BinanceP2pMarketDepth {
  return {
    asset: 'USDT',
    fiat: 'VES',
    bestBuyPrice,
    bestSellPrice,
    spreadVes: Number((bestSellPrice - bestBuyPrice).toFixed(2)),
    spreadPct: Number((((bestSellPrice - bestBuyPrice) / bestBuyPrice) * 100).toFixed(2)),
    buyOffers: [],
    sellOffers: [],
    updatedAt: new Date().toISOString(),
  };
}

function makeAccount(bankCode: BankAccount['bankCode'], id: string): BankAccount {
  return {
    id,
    bankName: `${bankCode} Cuenta`,
    bankCode,
    rail: 'TRANSFERENCIA',
    accountNumberMasked: '0134-***0001',
    dailyLimitVes: 100_000,
    initialBalanceVes: 50_000,
  };
}

function makeTreasurySummary(entries: { bankCode: BankAccount['bankCode']; consumedLimitPct: number }[]): TreasurySummary {
  const accountsUsage = entries.map((e, idx) => ({
    account: makeAccount(e.bankCode, `acc-${idx}`),
    spentTodayVes: e.consumedLimitPct * 1000,
    receivedTodayVes: 0,
    currentBalanceVes: 50_000,
    consumedLimitPct: e.consumedLimitPct,
    remainingLimitVes: Math.max(0, 100_000 - e.consumedLimitPct * 1000),
    isNearLimit: e.consumedLimitPct >= 80 && e.consumedLimitPct < 100,
    isOverLimit: e.consumedLimitPct >= 100,
    spentThisMonthVes: e.consumedLimitPct * 1000,
    consumedMonthlyLimitPct: e.consumedLimitPct,
    isNearMonthlyLimit: false,
    isOverMonthlyLimit: false,
  }));
  return {
    totalBalanceVes: accountsUsage.length * 50_000,
    totalSpentTodayVes: 0,
    totalReceivedTodayVes: 0,
    totalSpentThisMonthVes: 0,
    accountsUsage,
    nearLimitCount: 0,
    overLimitCount: 0,
    nearMonthlyLimitCount: 0,
    overMonthlyLimitCount: 0,
  };
}

describe('SpreadQualityService', () => {
  let service: SpreadQualityService;
  let marketHistory: MarketHistoryService;
  let depthSig: ReturnType<typeof signal<BinanceP2pMarketDepth | null>>;
  let bankSig: ReturnType<typeof signal<string>>;
  let treasurySig: ReturnType<typeof signal<TreasurySummary>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'));

    depthSig = signal<BinanceP2pMarketDepth | null>(makeDepth(800, 816));
    bankSig = signal<string>('BANESCO');
    treasurySig = signal<TreasurySummary>(
      makeTreasurySummary([
        { bankCode: 'BANESCO', consumedLimitPct: 40 },
        { bankCode: 'MERCANTIL', consumedLimitPct: 80 },
      ]),
    );

    const memStorage = new MemoryStorage();
    const storageMock = {
      get: <T>(k: string): T | null => {
        const raw = memStorage.getItem(k);
        return raw ? (JSON.parse(raw) as T) : null;
      },
      set: <T>(k: string, v: T) => memStorage.setItem(k, JSON.stringify(v)),
      remove: (k: string) => memStorage.removeItem(k),
    };

    const injector = Injector.create({
      providers: [
        { provide: StorageService, useValue: storageMock },
        {
          provide: BinanceP2pService,
          useValue: {
            marketDepth: depthSig,
            selectedBank: bankSig,
          },
        },
        {
          provide: AccountsService,
          useValue: {
            treasurySummary: treasurySig,
          },
        },
        MarketHistoryService,
        SpreadQualityService,
      ],
    });

    marketHistory = injector.get(MarketHistoryService);
    service = injector.get(SpreadQualityService);
  });

  afterEach(() => {
    marketHistory.clearHistory();
    vi.useRealTimers();
  });

  it('memoizes currentMarketQuality signals per (buyRole, sellRole) key without allocating new computed nodes', () => {
    const sig1 = service.currentMarketQuality('MAKER', 'TAKER');
    const sig2 = service.currentMarketQuality('MAKER', 'TAKER');
    const sig3 = service.currentMarketQuality('TAKER', 'TAKER');

    expect(sig1).toBe(sig2);
    expect(sig1).not.toBe(sig3);
  });

  it('falls back to 0.4 volatility with DEFAULT_INSUFFICIENT_HISTORY when < 2 points exist, and uses MEASURED volatility when >= 2 points exist', () => {
    const sqsDefault = service.currentMarketQuality('MAKER', 'MAKER')();
    expect(sqsDefault).not.toBeNull();
    expect(sqsDefault?.volatilitySource).toBe('DEFAULT_INSUFFICIENT_HISTORY');
    expect(sqsDefault?.volatility4hPct).toBe(0.4);

    // Record 2 distinct snapshots for BANESCO -> measured volatility (~2.44%)
    marketHistory.recordSnapshot({
      pair: 'USDT',
      bank: 'BANESCO',
      bestBuyPrice: 800,
      bestSellPrice: 820,
      spreadVes: 20,
      spreadPct: 2.5,
    });
    vi.advanceTimersByTime(60_000);
    marketHistory.recordSnapshot({
      pair: 'USDT',
      bank: 'BANESCO',
      bestBuyPrice: 840,
      bestSellPrice: 860,
      spreadVes: 20,
      spreadPct: 2.38,
    });

    const sqsMeasured = service.currentMarketQuality('MAKER', 'MAKER')();
    expect(sqsMeasured?.volatilitySource).toBe('MEASURED');
    expect(sqsMeasured?.volatility4hPct).toBeGreaterThan(2.0);
    // Higher volatility must lower safety score compared to the 0.4% fallback
    expect(sqsMeasured?.factors.safetyScore).toBeLessThan(sqsDefault!.factors.safetyScore);
  });

  it('computes real AccountsService usage (exact bank, average on ALL/missing, and 0 when zero accounts)', () => {
    // Exact bank BANESCO -> 40%
    expect(service.currentMarketQuality('MAKER', 'MAKER')()?.accountUsagePct).toBe(40);

    // ALL -> average of 40 and 80 = 60%
    bankSig.set('ALL');
    expect(service.currentMarketQuality('MAKER', 'MAKER')()?.accountUsagePct).toBe(60);

    // Unmatched bank BNC -> average of tracked accounts = 60%
    bankSig.set('BNC');
    expect(service.currentMarketQuality('MAKER', 'MAKER')()?.accountUsagePct).toBe(60);

    // Zero accounts -> 0% (never hardcoded 20)
    treasurySig.set(makeTreasurySummary([]));
    expect(service.currentMarketQuality('MAKER', 'MAKER')()?.accountUsagePct).toBe(0);
    expect(service.currentMarketQuality('MAKER', 'MAKER')()?.factors.limitHealthScore).toBe(100);
  });

  it('maps PAGO_MOVIL to OTRO bankCode with isInterbank: true', () => {
    bankSig.set('PAGO_MOVIL');
    const pmQuality = service.currentMarketQuality('MAKER', 'MAKER')();
    expect(pmQuality?.bankCode).toBe('OTRO');
    expect(pmQuality?.isInterbank).toBe(true);

    // Interbank friction (0.3% x 2) reduces netSpreadPct vs same-bank BANESCO
    bankSig.set('BANESCO');
    const banescoQuality = service.currentMarketQuality('MAKER', 'MAKER')();
    expect(pmQuality!.netSpreadPct).toBeLessThan(banescoQuality!.netSpreadPct);
  });

  it('preserves evaluateCustomSpread backward compatibility and supports optional overrides', () => {
    const basic = service.evaluateCustomSpread(800, 820, 'BANESCO', 20, 'MAKER', 'MAKER');
    const interbank = service.evaluateCustomSpread(800, 820, 'OTRO', 20, 'MAKER', 'MAKER', {
      isInterbank: true,
      volatility4hPct: 2.0,
      capitalUsdt: 2000,
    });

    expect(basic).not.toBeNull();
    expect(interbank).not.toBeNull();
    expect(interbank!.netSpreadPct).toBeLessThan(basic!.netSpreadPct);
    expect(interbank!.factors.safetyScore).toBeLessThan(basic!.factors.safetyScore);
  });
});
