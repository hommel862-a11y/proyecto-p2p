import { describe, it, expect } from 'vitest';
import { MonteCarloSimulator, type MonteCarloSimulationConfig } from './monte-carlo-simulator';
import type { BinanceOfferSummary } from '../vendor/p2p-core/binance-p2p';

describe('MonteCarloSimulator (Pilar 4 - Microestructura Estocástica)', () => {
  const mockOffers: BinanceOfferSummary[] = [
    {
      price: 65.20,
      minVes: 500,
      maxVes: 30000,
      availableFiatVes: 30000,
      merchantName: 'Merchant_Alpha',
      isMerchant: true,
      monthOrderCount: 450,
      monthFinishRatePct: 99.5,
      payMethods: ['PagoMovil', 'Banesco'],
    },
    {
      price: 65.35,
      minVes: 1000,
      maxVes: 50000,
      availableFiatVes: 50000,
      merchantName: 'Merchant_Beta',
      isMerchant: true,
      monthOrderCount: 300,
      monthFinishRatePct: 98.2,
      payMethods: ['Banesco'],
    },
    {
      price: 65.60,
      minVes: 2000,
      maxVes: 80000,
      availableFiatVes: 80000,
      merchantName: 'Merchant_Gamma',
      isMerchant: false,
      monthOrderCount: 80,
      monthFinishRatePct: 95.0,
      payMethods: ['Mercantil'],
    },
  ];

  it('handles empty orderbook safely with zeroed metrics', () => {
    const sim = new MonteCarloSimulator();
    const res = sim.runSimulation([], {
      iterations: 100,
      cancellationProbabilityPct: 15,
      priceDriftVolatilityBps: 30,
      ticketAmountUsdt: 1000,
      side: 'BUY',
    });

    expect(res.iterations).toBe(0);
    expect(res.isSafeForExecution).toBe(false);
    expect(res.p95SlippagePct).toBe(0);
    expect(res.var95Usdt).toBe(0);
    expect(res.recommendation).toContain('vacío');
  });

  it('computes 500 iterations and produces valid distribution quantiles', () => {
    const sim = new MonteCarloSimulator();
    const config: MonteCarloSimulationConfig = {
      iterations: 500,
      cancellationProbabilityPct: 15,
      priceDriftVolatilityBps: 20,
      ticketAmountUsdt: 500,
      side: 'BUY',
    };

    const res = sim.runSimulation(mockOffers, config);

    expect(res.iterations).toBe(500);
    expect(res.meanSlippagePct).toBeGreaterThanOrEqual(0);
    expect(res.medianSlippagePct).toBeGreaterThanOrEqual(0);
    // Quantile ordering guarantee: Median <= P95 <= P99
    expect(res.p95SlippagePct).toBeGreaterThanOrEqual(res.medianSlippagePct);
    expect(res.p99SlippagePct).toBeGreaterThanOrEqual(res.p95SlippagePct);
    expect(res.fillRatePct).toBeGreaterThan(0);
    expect(res.var95Usdt).toBeGreaterThanOrEqual(0);
    expect(typeof res.recommendation).toBe('string');
  });

  it('detects high tail risk when orderbook depth is thin relative to ticket', () => {
    const sim = new MonteCarloSimulator();
    // Huge ticket relative to top liquidity
    const config: MonteCarloSimulationConfig = {
      iterations: 300,
      cancellationProbabilityPct: 30, // severe cancellations
      priceDriftVolatilityBps: 60, // severe market drift
      ticketAmountUsdt: 2500,
      side: 'BUY',
    };

    const res = sim.runSimulation(mockOffers, config);

    expect(res.p95SlippagePct).toBeGreaterThan(0);
    expect(res.var95Usdt).toBeGreaterThan(0);
  });
});
