import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BinanceOfferSummary, BinanceP2pMarketDepth, Counterparty } from '@p2p/core';
import { MicrostructureEngineService } from './microstructure-engine.service';
import { BinanceP2pService } from './binance-p2p.service';
import { CounterpartyService } from './counterparty.service';
import { MarketHistoryService } from './market-history.service';
import { AccountsService } from './accounts.service';
import { CotizaveService } from './cotizave.service';
import { StorageService } from './storage';
import { MemoryStorage } from './memory-storage';

function makeOffer(overrides: Partial<BinanceOfferSummary> & { advNo: string; price: number }): BinanceOfferSummary {
  return {
    merchantName: `Merchant_${overrides.advNo}`,
    finishRatePct: 98,
    orderCount: 250,
    minVes: 10_000,
    maxVes: 250_000,
    payMethods: ['Banesco'],
    ...overrides,
  };
}

function makeDepth(
  buyOffers: BinanceOfferSummary[],
  sellOffers: BinanceOfferSummary[],
  updatedAt = new Date().toISOString(),
): BinanceP2pMarketDepth {
  const bestBuyPrice = buyOffers[0]?.price ?? 0;
  const bestSellPrice = sellOffers[0]?.price ?? 0;
  const spreadVes = bestBuyPrice > 0 && bestSellPrice > 0 ? Number((bestSellPrice - bestBuyPrice).toFixed(2)) : 0;
  const spreadPct = bestBuyPrice > 0 ? Number(((spreadVes / bestBuyPrice) * 100).toFixed(2)) : 0;
  return {
    asset: 'USDT',
    fiat: 'VES',
    bestBuyPrice,
    bestSellPrice,
    spreadVes,
    spreadPct,
    buyOffers: buyOffers.slice(0, 5),
    sellOffers: sellOffers.slice(0, 5),
    fullBuyOffers: buyOffers.slice(0, 20),
    fullSellOffers: sellOffers.slice(0, 20),
    updatedAt,
  };
}

describe('MicrostructureEngineService', () => {
  let engine: MicrostructureEngineService;
  let marketHistory: MarketHistoryService;
  let depthSig: ReturnType<typeof signal<BinanceP2pMarketDepth | null>>;
  let bankSig: ReturnType<typeof signal<string>>;
  let lastFetchedSig: ReturnType<typeof signal<Date | null>>;
  let freshnessSig: ReturnType<typeof signal<'LIVE' | 'AGING' | 'STALE' | 'OFFLINE'>>;
  let counterpartiesSig: ReturnType<typeof signal<Counterparty[]>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T14:00:00.000Z'));

    depthSig = signal<BinanceP2pMarketDepth | null>(null);
    bankSig = signal<string>('BANESCO');
    lastFetchedSig = signal<Date | null>(new Date('2026-11-18T14:00:00.000Z'));
    freshnessSig = signal<'LIVE' | 'AGING' | 'STALE' | 'OFFLINE'>('LIVE');
    counterpartiesSig = signal<Counterparty[]>([
      {
        id: 'cp-trusted',
        alias: 'CriptoVzla_VIP',
        realName: 'Juan Pérez',
        documentId: 'V-18452123',
        reputation: 'TRUSTED',
        createdAt: '2026-01-15',
      },
      {
        id: 'cp-verified',
        alias: 'CaracasExchange_Pro',
        realName: 'María Rodríguez',
        documentId: 'V-21334556',
        reputation: 'VERIFIED',
        createdAt: '2026-02-10',
      },
      {
        id: 'cp-blocked',
        alias: 'Estafador_Reportado',
        realName: 'Carlos Fraude',
        documentId: 'V-19888999',
        reputation: 'BLOCKED',
        createdAt: '2026-02-28',
      },
    ]);

    const mem = new MemoryStorage();
    const storageStub = {
      get: <T>(key: string): T | null => {
        const raw = mem.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
      },
      set: <T>(key: string, value: T) => mem.setItem(key, JSON.stringify(value)),
      remove: (key: string) => mem.removeItem(key),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: StorageService, useValue: storageStub },
        {
          provide: BinanceP2pService,
          useValue: {
            marketDepth: depthSig,
            selectedBank: bankSig,
            lastFetched: lastFetchedSig,
            freshnessStatus: freshnessSig,
          },
        },
        {
          provide: CounterpartyService,
          useValue: {
            counterparties: counterpartiesSig,
            findByQuery: (q: string) =>
              counterpartiesSig().find((c) => c.alias.toLowerCase() === q.trim().toLowerCase()),
          },
        },
        {
          provide: AccountsService,
          useValue: {
            treasurySummary: signal({
              totalBalanceVes: 100_000,
              totalSpentTodayVes: 0,
              totalReceivedTodayVes: 0,
              totalSpentThisMonthVes: 0,
              accountsUsage: [
                {
                  account: {
                    id: 'b-1',
                    bankName: 'Banesco',
                    bankCode: 'BANESCO' as const,
                    rail: 'TRANSFERENCIA' as const,
                    accountNumberMasked: '0134-***1111',
                    dailyLimitVes: 100_000,
                    initialBalanceVes: 50_000,
                  },
                  spentTodayVes: 35_000,
                  receivedTodayVes: 0,
                  currentBalanceVes: 15_000,
                  consumedLimitPct: 35,
                  remainingLimitVes: 65_000,
                  isNearLimit: false,
                  isOverLimit: false,
                  spentThisMonthVes: 35_000,
                  consumedMonthlyLimitPct: 35,
                  isNearMonthlyLimit: false,
                  isOverMonthlyLimit: false,
                },
              ],
              nearLimitCount: 0,
              overLimitCount: 0,
              nearMonthlyLimitCount: 0,
              overMonthlyLimitCount: 0,
            }),
          },
        },
        {
          provide: CotizaveService,
          useValue: {
            ratesByMarket: signal({}),
          },
        },
      ],
    });

    marketHistory = TestBed.inject(MarketHistoryService);
    engine = TestBed.inject(MicrostructureEngineService);
  });

  afterEach(() => {
    marketHistory.clearHistory();
    vi.useRealTimers();
  });

  it('uses up to 20 full-depth levels and 15 OBI levels without truncating to top 5', () => {
    const buys = Array.from({ length: 20 }, (_, i) =>
      makeOffer({
        advNo: `B${i}`,
        price: 850 + i * 0.5,
        maxVes: 850_000,
        merchantName: i === 0 ? 'CriptoVzla_VIP' : `BuyMaker_${i}`,
      }),
    );
    const sells = Array.from({ length: 20 }, (_, i) =>
      makeOffer({
        advNo: `S${i}`,
        price: 870 - i * 0.5,
        maxVes: 870_000,
        merchantName: i === 0 ? 'CaracasExchange_Pro' : `SellMaker_${i}`,
      }),
    );

    depthSig.set(makeDepth(buys, sells));

    expect(engine.fullBuyOffers().length).toBe(20);
    expect(engine.fullSellOffers().length).toBe(20);
    expect(engine.obiReport().depthLevelsEvaluated).toBe(15);
    expect(engine.snapshotHash().length).toBeGreaterThan(0);
  });

  it('persists OrderPersistenceTracker per (asset:fiat:bank), avoids snapshot #1 spoof false positives, and isolates sides', () => {
    const buys1 = [
      makeOffer({ advNo: 'LEGIT_BUY', price: 850, maxVes: 1_500_000, finishRatePct: 99, orderCount: 400 }),
    ];
    const sells1 = [
      makeOffer({ advNo: 'SPOOF_SELL', price: 890, maxVes: 500_000, finishRatePct: 80, orderCount: 12 }),
      makeOffer({ advNo: 'LEGIT_SELL_1', price: 870, maxVes: 100_000 }),
      makeOffer({ advNo: 'LEGIT_SELL_2', price: 868, maxVes: 100_000 }),
    ];

    depthSig.set(makeDepth(buys1, sells1, '2026-11-18T14:00:00.000Z'));

    // Snapshot #1 must NEVER emit false SPOOF_BAIT / PHANTOM_LIQUIDITY on active offers
    engine.selectedSide.set('SELL');
    expect(engine.spoofReport().spoofBaitCount).toBe(0);
    expect(engine.spoofReport().phantomLiquidityCount).toBe(0);

    // Advance 30s and remove SPOOF_SELL from SELL book while keeping BUY book intact
    vi.advanceTimersByTime(30_000);
    const sells2 = [
      makeOffer({ advNo: 'LEGIT_SELL_1', price: 870, maxVes: 100_000 }),
      makeOffer({ advNo: 'LEGIT_SELL_2', price: 868, maxVes: 100_000 }),
    ];
    depthSig.set(makeDepth(buys1, sells2, '2026-11-18T14:00:30.000Z'));

    // SELL reports phantom/spoof while BUY stays clean (side-isolated)
    engine.selectedSide.set('SELL');
    const sellReport = engine.spoofReport();
    expect(sellReport.phantomLiquidityCount + sellReport.spoofBaitCount).toBeGreaterThan(0);

    engine.selectedSide.set('BUY');
    const buyReport = engine.spoofReport();
    expect(buyReport.classifiedOrders.every((c) => c.side === 'BUY')).toBe(true);
    expect(buyReport.phantomLiquidityCount).toBe(0);
    expect(buyReport.spoofBaitCount).toBe(0);
  });

  it('tracks tick flash deltas (deltaPrice, isNew, flashDirection) and crosses CounterpartyService + verifiedProOnly', () => {
    const buys1 = [
      makeOffer({ advNo: 'A1', price: 850, merchantName: 'CriptoVzla_VIP', finishRatePct: 99, orderCount: 300 }),
      makeOffer({ advNo: 'A2', price: 851, merchantName: 'Estafador_Reportado', finishRatePct: 99, orderCount: 300 }),
      makeOffer({ advNo: 'A3', price: 852, merchantName: 'SmallUser', finishRatePct: 88, orderCount: 15 }),
    ];
    const sells1 = [makeOffer({ advNo: 'S1', price: 870, merchantName: 'CaracasExchange_Pro' })];

    depthSig.set(makeDepth(buys1, sells1, '2026-11-18T14:00:00.000Z'));

    engine.selectedSide.set('BUY');
    const snap1Rows = engine.activeEnrichedOffers();
    expect(snap1Rows.find((r) => r.offer.advNo === 'A1')?.counterpartyReputation).toBe('TRUSTED');
    expect(snap1Rows.find((r) => r.offer.advNo === 'A2')?.counterpartyReputation).toBe('BLOCKED');
    expect(snap1Rows.find((r) => r.offer.advNo === 'A1')?.flashDirection).toBeNull();

    vi.advanceTimersByTime(10_000);
    const buys2 = [
      makeOffer({ advNo: 'A1', price: 852.5, merchantName: 'CriptoVzla_VIP', finishRatePct: 99, orderCount: 300 }),
      makeOffer({ advNo: 'A2', price: 849.5, merchantName: 'Estafador_Reportado', finishRatePct: 99, orderCount: 300 }),
      makeOffer({ advNo: 'A4', price: 853, merchantName: 'NewTrader', finishRatePct: 97, orderCount: 150 }),
    ];
    depthSig.set(makeDepth(buys2, sells1, '2026-11-18T14:00:10.000Z'));

    const snap2Rows = engine.activeEnrichedOffers();
    const a1 = snap2Rows.find((r) => r.offer.advNo === 'A1');
    const a2 = snap2Rows.find((r) => r.offer.advNo === 'A2');
    const a4 = snap2Rows.find((r) => r.offer.advNo === 'A4');

    expect(a1?.deltaPrice).toBe(2.5);
    expect(a1?.flashDirection).toBe('up');
    expect(a1?.isNew).toBe(false);

    expect(a2?.deltaPrice).toBe(-1.5);
    expect(a2?.flashDirection).toBe('down');
    expect(a2?.isBlockedCounterparty).toBe(true);

    expect(a4?.isNew).toBe(true);
    expect(a4?.flashDirection).toBe('new');

    // Enabling verifiedProOnly excludes BLOCKED and low-rep SmallUser while keeping CriptoVzla_VIP and NewTrader
    engine.verifiedProOnly.set(true);
    const proRows = engine.activeEnrichedOffers();
    expect(proRows.some((r) => r.offer.advNo === 'A2')).toBe(false);
    expect(proRows.some((r) => r.offer.advNo === 'A1')).toBe(true);
    expect(proRows.some((r) => r.offer.advNo === 'A4')).toBe(true);
  });

  it('uses real refRate (never 70) for brackets and OTC whale detection, preventing $10k false whale alerts at 850 Bs', () => {
    // At 850 Bs/USD, 8,500,000 VES is $10,000 USD (NOT >= $100,000 whale).
    // With the old fallback rate=70, 8.5M / 70 = $121,428 -> false whale alert!
    const buys = [
      makeOffer({ advNo: 'B1', price: 850, minVes: 50_000, maxVes: 120_000 }),
      makeOffer({ advNo: 'B2', price: 851, minVes: 250_000, maxVes: 8_500_000 }),
    ];
    const sells = [
      makeOffer({ advNo: 'S1', price: 865, minVes: 50_000, maxVes: 120_000 }),
      makeOffer({ advNo: 'S2', price: 866, minVes: 5_000, maxVes: 15_000 }),
    ];
    depthSig.set(makeDepth(buys, sells));
    engine.selectedSide.set('BUY');

    expect(engine.refRate()).toBeCloseTo(857.5, 1);
    expect(engine.otcWhaleReport().whaleDetected).toBe(false);

    // Real whale >= $100k at 857.5 Bs (~90,000,000 VES) IS detected accurately
    const whaleBuys = [
      ...buys,
      makeOffer({ advNo: 'WHALE', price: 852, minVes: 500_000, maxVes: 95_000_000 }),
    ];
    depthSig.set(makeDepth(whaleBuys, sells, '2026-11-18T14:01:00.000Z'));
    expect(engine.otcWhaleReport().whaleDetected).toBe(true);
    expect(engine.otcWhaleReport().totalWhaleVolumeUsd).toBeGreaterThan(100_000);

    engine.selectedBracket.set('MEDIO');
    expect(engine.bracketResult()?.bracket.id).toBe('MEDIO');
    expect(engine.allBracketsSummary().length).toBe(3);
  });

  it('computes quantitative engines, honest VPIN proxy, BCV NO_MODEL volatility2h, Maker vs Taker trap, and SQS', () => {
    const buys = [
      makeOffer({ advNo: 'B1', price: 850, maxVes: 850_000 }),
      makeOffer({ advNo: 'B2', price: 852, maxVes: 852_000 }),
      makeOffer({ advNo: 'B3', price: 854, maxVes: 854_000 }),
    ];
    const sells = [
      makeOffer({ advNo: 'S1', price: 868, maxVes: 868_000 }),
      makeOffer({ advNo: 'S2', price: 866, maxVes: 866_000 }),
      makeOffer({ advNo: 'S3', price: 864, maxVes: 864_000 }),
    ];
    depthSig.set(makeDepth(buys, sells));

    engine.targetUsdt.set(1000);
    engine.liveBreakEvenSellPrice.set(855);
    engine.currentInventoryUsdt.set(1500);
    engine.targetInventoryUsdt.set(1000);

    expect(engine.tradeImpact().totalFilledUsdt).toBe(1000);
    expect(engine.avellanedaQuotes().reservationPrice).toBeGreaterThan(0);
    expect(engine.vpinReport().isProxy).toBe(true);
    expect(engine.vpinReport().proxySource).toBe('BOOK_TIER_SNAPSHOT_PROXY');
    expect(engine.slicingPlan().totalSlices).toBeGreaterThanOrEqual(3);
    expect(engine.markovFill().fillProbabilityInHorizonPct).toBeGreaterThan(0);
    expect(engine.dynamicAnchors().recommendedSellPrice).toBeGreaterThanOrEqual(855);

    // BCV window MUST NEVER invent probabilities
    const vol2h = engine.volatility2h();
    expect(vol2h.bcvWindow.probabilityBasis).toBe('NO_MODEL');
    expect(vol2h.bcvWindow.probabilityPct).toBeNull();
    expect(vol2h.bcvWindow.actionable).toBe(false);
    expect(vol2h.bcvGap.zone).toBe('UNAVAILABLE');

    // Setting real BCV rate produces real gap without touching NO_MODEL
    engine.bcvRateVes.set(700);
    expect(engine.volatility2h().bcvGap.actionable).toBe(true);
    expect(engine.volatility2h().bcvGap.gapPct).toBeGreaterThan(15);
    expect(engine.volatility2h().bcvWindow.probabilityBasis).toBe('NO_MODEL');

    // Maker vs Taker comparison + SQS + 1-click payloads
    const cmp = engine.makerVsTakerComparison();
    expect(cmp.maker.roiCyclePct).toBeDefined();
    expect(cmp.taker.roiCyclePct).toBeDefined();
    expect(cmp.deskPayload.side).toBe(engine.selectedSide());
    expect(cmp.repricerPayload.buyPrice).toBeGreaterThan(0);
    expect(engine.sqsResult()).not.toBeNull();
  });
});
