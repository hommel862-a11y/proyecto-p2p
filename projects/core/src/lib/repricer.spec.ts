import { describe, it, expect } from 'vitest';
import {
  calculatePositionPrice,
  evaluateRepricer,
  type RepricerConfig,
  type RepricerEvaluationInput,
} from './repricer';
import type { BinanceP2pMarketDepth, BinanceOfferSummary } from './binance-p2p';

describe('Repricer Engine (Core)', () => {
  const sampleOffers: BinanceOfferSummary[] = [
    {
      advNo: '101',
      price: 850.5,
      merchantName: 'TraderA',
      finishRatePct: 99,
      orderCount: 400,
      minVes: 500,
      maxVes: 50000,
      payMethods: ['Banesco'],
    },
    {
      advNo: '102',
      price: 849.0,
      merchantName: 'TraderB',
      finishRatePct: 98,
      orderCount: 350,
      minVes: 500,
      maxVes: 50000,
      payMethods: ['Banesco'],
    },
    {
      advNo: '103',
      price: 848.0,
      merchantName: 'TraderC',
      finishRatePct: 95,
      orderCount: 200,
      minVes: 500,
      maxVes: 50000,
      payMethods: ['Banesco'],
    },
  ];

  const sampleDepth: BinanceP2pMarketDepth = {
    asset: 'USDT',
    fiat: 'VES',
    bestBuyPrice: 830.0,
    bestSellPrice: 850.5,
    spreadVes: 20.5,
    spreadPct: 2.47,
    buyOffers: [
      {
        advNo: '201',
        price: 830.0,
        merchantName: 'BuyerA',
        finishRatePct: 100,
        orderCount: 500,
        minVes: 1000,
        maxVes: 100000,
        payMethods: ['Banesco'],
      },
      {
        advNo: '202',
        price: 829.0,
        merchantName: 'BuyerB',
        finishRatePct: 98,
        orderCount: 150,
        minVes: 1000,
        maxVes: 100000,
        payMethods: ['Banesco'],
      },
    ],
    sellOffers: sampleOffers,
    updatedAt: new Date().toISOString(),
  };

  const baseConfig: RepricerConfig = {
    asset: 'USDT',
    fiat: 'VES',
    strategy: 'TOP_1',
    stepVes: 0.05,
    minSpreadVes: 10.0,
    breakEvenSellPrice: 835.0,
    maxBuyPrice: 832.0,
    isDryRun: true,
  };

  it('calculates position price correctly for TOP_1, TOP_2 and UNDERCUT', () => {
    // For BUY side (highest price is 830, TOP_2 is 829)
    const buyTop1 = calculatePositionPrice(sampleDepth.buyOffers, 'BUY', 'TOP_1');
    expect(buyTop1).toBe(830.0);

    const buyTop2 = calculatePositionPrice(sampleDepth.buyOffers, 'BUY', 'TOP_2');
    expect(buyTop2).toBe(829.0);

    const buyUndercut = calculatePositionPrice(sampleDepth.buyOffers, 'BUY', 'UNDERCUT', 0.1);
    expect(buyUndercut).toBe(830.1);

    // For SELL side (lowest price is 848, TOP_2 is 849)
    const sellTop1 = calculatePositionPrice(sampleOffers, 'SELL', 'TOP_1');
    expect(sellTop1).toBe(848.0);

    const sellTop2 = calculatePositionPrice(sampleOffers, 'SELL', 'TOP_2');
    expect(sellTop2).toBe(849.0);

    const sellUndercut = calculatePositionPrice(sampleOffers, 'SELL', 'UNDERCUT', 0.1);
    expect(sellUndercut).toBe(847.9);
  });

  it('evaluates safe repricer decision when market conditions are profitable', () => {
    const input: RepricerEvaluationInput = {
      config: baseConfig,
      marketDepth: sampleDepth,
      currentBuyAdPrice: 825.0,
      currentSellAdPrice: 855.0,
    };

    const decision = evaluateRepricer(input);
    expect(decision.action).toBe('UPDATE');
    expect(decision.isSafe).toBe(true);
    expect(decision.suggestedBuyPrice).toBe(830.0);
    expect(decision.suggestedSellPrice).toBe(848.0);
    expect(decision.spreadVes).toBe(18.0);
    expect(decision.safetyFlags).toHaveLength(0);
  });

  it('protects against selling below break-even floor', () => {
    const strictConfig: RepricerConfig = {
      ...baseConfig,
      breakEvenSellPrice: 850.0, // Competitor is at 848!
    };

    const input: RepricerEvaluationInput = {
      config: strictConfig,
      marketDepth: sampleDepth,
    };

    const decision = evaluateRepricer(input);
    expect(decision.suggestedSellPrice).toBe(850.0);
    expect(decision.safetyFlags).toContain('BREAK_EVEN_VIOLATION');
  });

  it('pauses repricer when spread falls below required minimum', () => {
    const tightConfig: RepricerConfig = {
      ...baseConfig,
      minSpreadVes: 25.0, // Market spread is only 18 VES
    };

    const input: RepricerEvaluationInput = {
      config: tightConfig,
      marketDepth: sampleDepth,
    };

    const decision = evaluateRepricer(input);
    expect(decision.action).toBe('PAUSE');
    expect(decision.isSafe).toBe(false);
    expect(decision.safetyFlags).toContain('SPREAD_BELOW_MINIMUM');
  });

  it('pauses repricer immediately if bank limits are exceeded', () => {
    const input: RepricerEvaluationInput = {
      config: baseConfig,
      marketDepth: sampleDepth,
      isDailyLimitExceeded: true,
    };

    const decision = evaluateRepricer(input);
    expect(decision.action).toBe('PAUSE');
    expect(decision.safetyFlags).toContain('DAILY_BANK_LIMIT_EXCEEDED');
  });
});
