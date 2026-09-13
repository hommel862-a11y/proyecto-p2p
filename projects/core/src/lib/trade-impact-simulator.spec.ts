import { describe, it, expect } from 'vitest';
import { simulateTradeImpact, type TradeImpactInput } from './trade-impact-simulator';
import type { BinanceOfferSummary } from './binance-p2p';

describe('Trade Impact & Fill Probability Simulation Engine', () => {
  const sampleOffers: BinanceOfferSummary[] = [
    {
      advNo: 'ADV-1',
      price: 85.0,
      merchantName: 'CryptoExpress',
      finishRatePct: 99,
      orderCount: 450,
      minVes: 1000,
      maxVes: 42500, // 500 USDT available (42500 / 85.0)
      payMethods: ['Banesco'],
    },
    {
      advNo: 'ADV-2',
      price: 85.5,
      merchantName: 'FastMerchant',
      finishRatePct: 98,
      orderCount: 890,
      minVes: 5000,
      maxVes: 85500, // 1000 USDT available (85500 / 85.5)
      payMethods: ['Banesco', 'Pago Movil'],
    },
    {
      advNo: 'ADV-3',
      price: 86.0,
      merchantName: 'SlowMerchant',
      finishRatePct: 85,
      orderCount: 120,
      minVes: 10000,
      maxVes: 172000, // 2000 USDT available (172000 / 86.0)
      payMethods: ['Mercantil'],
    },
  ];

  it('should fill full ticket when orderbook depth exceeds requested amount', () => {
    const input: TradeImpactInput = {
      targetAmountUsdt: 800,
      side: 'BUY',
      availableOffers: sampleOffers,
    };

    const res = simulateTradeImpact(input);

    expect(res.isFullyFillable).toBe(true);
    expect(res.totalFilledUsdt).toBe(800);
    expect(res.unfilledUsdt).toBe(0);
    expect(res.matchedTiers.length).toBe(2); // 500 from ADV-1, 300 from ADV-2

    expect(res.bestQuotedPrice).toBe(85.0);
    expect(res.effectiveVwapPrice).toBeCloseTo(85.1875, 4);
    expect(res.slippagePct).toBeGreaterThan(0);
    expect(res.overallFillProbabilityPct).toBeGreaterThan(70);
  });

  it('should flag critical slippage if book is too thin to fill ticket', () => {
    const input: TradeImpactInput = {
      targetAmountUsdt: 5000,
      side: 'BUY',
      availableOffers: sampleOffers, // Total depth is 3500 USDT
    };

    const res = simulateTradeImpact(input);

    expect(res.isFullyFillable).toBe(false);
    expect(res.totalFilledUsdt).toBe(3500);
    expect(res.unfilledUsdt).toBe(1500);
    expect(res.liquidityHealth).toBe('CRITICAL_SLIPPAGE');
    expect(res.actionableRecommendation).toContain('ALERTA: Profundidad insuficiente');
  });

  it('should handle empty or invalid orderbooks gracefully', () => {
    const input: TradeImpactInput = {
      targetAmountUsdt: 1000,
      side: 'BUY',
      availableOffers: [],
    };

    const res = simulateTradeImpact(input);

    expect(res.isFullyFillable).toBe(false);
    expect(res.totalFilledUsdt).toBe(0);
    expect(res.effectiveVwapPrice).toBe(0);
  });
});
