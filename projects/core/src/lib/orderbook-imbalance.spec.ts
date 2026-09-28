import { describe, it, expect } from 'vitest';
import {
  calculateOrderBookImbalance,
  type OrderBookImbalanceOptions,
} from './orderbook-imbalance';
import type { BinanceOfferSummary } from './binance-p2p';

describe('OrderBook Imbalance (OBI) Engine', () => {
  const mockBuyOffers: BinanceOfferSummary[] = [
    { advNo: 'b1', price: 100, minVes: 1000, maxVes: 50000, merchantName: 'M1', finishRatePct: 99, orderCount: 500, payMethods: ['Pago Movil'] },
    { advNo: 'b2', price: 99.8, minVes: 1000, maxVes: 60000, merchantName: 'M2', finishRatePct: 98, orderCount: 300, payMethods: ['Pago Movil'] },
    { advNo: 'b3', price: 99.5, minVes: 1000, maxVes: 80000, merchantName: 'M3', finishRatePct: 97, orderCount: 200, payMethods: ['Pago Movil'] },
  ];

  const mockSellOffers: BinanceOfferSummary[] = [
    { advNo: 's1', price: 101, minVes: 1000, maxVes: 20000, merchantName: 'M4', finishRatePct: 99, orderCount: 400, payMethods: ['Pago Movil'] },
    { advNo: 's2', price: 101.2, minVes: 1000, maxVes: 15000, merchantName: 'M5', finishRatePct: 95, orderCount: 150, payMethods: ['Pago Movil'] },
  ];

  it('should detect STRONG_BUY_PRESSURE when buy depth dominates sell depth', () => {
    const result = calculateOrderBookImbalance(mockBuyOffers, mockSellOffers);

    expect(result.buyVolumeUsdt).toBeGreaterThan(result.sellVolumeUsdt);
    expect(result.obiPercentage).toBeGreaterThan(30);
    expect(result.classification).toBe('STRONG_BUY_PRESSURE');
    expect(result.gaugePercent).toBeGreaterThan(65);
    expect(result.makerSellPriceGuidance).toContain('Subí tu precio Maker de venta');
  });

  it('should detect STRONG_SELL_PRESSURE when sell depth heavily dominates', () => {
    // Invert volume
    const lowBuy: BinanceOfferSummary[] = [
      { advNo: 'b1', price: 100, minVes: 1000, maxVes: 5000, merchantName: 'M1', finishRatePct: 99, orderCount: 50, payMethods: [] },
    ];
    const highSell: BinanceOfferSummary[] = [
      { advNo: 's1', price: 101, minVes: 1000, maxVes: 90000, merchantName: 'M4', finishRatePct: 99, orderCount: 400, payMethods: [] },
      { advNo: 's2', price: 101.5, minVes: 1000, maxVes: 80000, merchantName: 'M5', finishRatePct: 95, orderCount: 150, payMethods: [] },
    ];

    const result = calculateOrderBookImbalance(lowBuy, highSell);

    expect(result.obiPercentage).toBeLessThan(-30);
    expect(result.classification).toBe('STRONG_SELL_PRESSURE');
    expect(result.makerBuyPriceGuidance).toContain('Bajá tu precio Maker de compra');
  });

  it('should detect BALANCED when buy and sell are approximately equal', () => {
    const balancedBuy: BinanceOfferSummary[] = [
      { advNo: 'b1', price: 100, minVes: 1000, maxVes: 50000, merchantName: 'M1', finishRatePct: 99, orderCount: 50, payMethods: [] },
    ];
    const balancedSell: BinanceOfferSummary[] = [
      { advNo: 's1', price: 101, minVes: 1000, maxVes: 50500, merchantName: 'M4', finishRatePct: 99, orderCount: 400, payMethods: [] },
    ];

    const result = calculateOrderBookImbalance(balancedBuy, balancedSell);

    expect(Math.abs(result.obiPercentage)).toBeLessThan(10);
    expect(result.classification).toBe('BALANCED');
  });

  it('should detect liquidity gaps between consecutive orders', () => {
    const gapOffers: BinanceOfferSummary[] = [
      { advNo: 'b1', price: 100, minVes: 1000, maxVes: 50000, merchantName: 'M1', finishRatePct: 99, orderCount: 50, payMethods: [] },
      { advNo: 'b2', price: 98.5, minVes: 1000, maxVes: 50000, merchantName: 'M2', finishRatePct: 99, orderCount: 50, payMethods: [] }, // 1.5% gap
    ];

    const result = calculateOrderBookImbalance(gapOffers, [], { gapThresholdPct: 0.5 });

    expect(result.gaps.length).toBe(1);
    expect(result.gaps[0].gapPct).toBeCloseTo(1.5, 1);
    expect(result.gaps[0].severity).toBe('CRITICAL');
  });
});
