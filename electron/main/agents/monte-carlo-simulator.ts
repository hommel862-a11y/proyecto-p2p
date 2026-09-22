/**
 * Institutional Desk - Monte Carlo Microstructure & Slippage Simulator.
 * Simulates random order arrival, sudden orderbook cancellations, and liquidity shifts
 * to generate rigorous statistical distributions: Expected Slippage, Value at Risk (VaR 95%),
 * and Worst-Case Tail Slippage (P95).
 */

import type { BinanceOfferSummary } from '../vendor/p2p-core/binance-p2p';
import {
  simulateTradeImpact,
  type TradeImpactSimulationResult,
} from '../vendor/p2p-core/trade-impact-simulator';

export interface MonteCarloSimulationConfig {
  iterations: number; // e.g. 500 to 1000 runs
  cancellationProbabilityPct: number; // Probability of top ads disappearing before fill (e.g. 15%)
  priceDriftVolatilityBps: number; // Market price drift volatility in basis points (e.g. 30 bps)
  ticketAmountUsdt: number;
  side: 'BUY' | 'SELL';
}

export interface MonteCarloSimulationResult {
  ticketAmountUsdt: number;
  side: 'BUY' | 'SELL';
  iterations: number;
  baseSlippagePct: number;
  meanSlippagePct: number;
  medianSlippagePct: number;
  p95SlippagePct: number; // 95th Percentile Worst-Case Slippage
  p99SlippagePct: number; // 99th Percentile Extreme Tail Risk
  fillRatePct: number; // % of iterations fully filled
  worstCaseNetSpreadImpactPct: number;
  var95Usdt: number; // Dollar Value at Risk at 95% confidence
  isSafeForExecution: boolean; // True if P95 slippage doesn't consume the Golden Rule spread
  recommendation: string;
}

export class MonteCarloSimulator {
  /**
   * Runs N stochastic iterations over the orderbook snapshot.
   */
  runSimulation(
    offers: readonly BinanceOfferSummary[],
    config: MonteCarloSimulationConfig,
  ): MonteCarloSimulationResult {
    const {
      iterations = 500,
      cancellationProbabilityPct = 15,
      priceDriftVolatilityBps = 30,
      ticketAmountUsdt = 1000,
      side = 'BUY',
    } = config;

    if (!offers || offers.length === 0) {
      return {
        ticketAmountUsdt,
        side,
        iterations: 0,
        baseSlippagePct: 0,
        meanSlippagePct: 0,
        medianSlippagePct: 0,
        p95SlippagePct: 0,
        p99SlippagePct: 0,
        fillRatePct: 0,
        worstCaseNetSpreadImpactPct: 0,
        var95Usdt: 0,
        isSafeForExecution: false,
        recommendation: 'Libro de órdenes vacío. Simulación estocástica no factible.',
      };
    }

    // 1. Baseline deterministic simulation
    const baseResult: TradeImpactSimulationResult = simulateTradeImpact({
      targetAmountUsdt: ticketAmountUsdt,
      side,
      availableOffers: [...offers],
    });

    const slippageDistribution: number[] = [];
    let fullyFilledRuns = 0;

    // 2. Monte Carlo Iteration Loop
    for (let i = 0; i < iterations; i++) {
      // Perturb orderbook: random cancellations & random micro drift
      const perturbedOffers: BinanceOfferSummary[] = [];

      for (const o of offers) {
        // Did merchant cancel or pull ad before user clicks?
        const isCancelled = Math.random() * 100 < cancellationProbabilityPct;
        if (isCancelled) continue;

        // Normal-distributed or uniform price drift
        const randomDriftBps = (Math.random() - 0.5) * 2 * priceDriftVolatilityBps;
        const driftFactor = 1 + randomDriftBps / 10000;
        const driftedPrice = Number((o.price * driftFactor).toFixed(4));

        // Capacity variation (partial fills by other concurrent market takers)
        const capacityFactor = 0.5 + Math.random() * 0.5; // 50% to 100% capacity remaining
        const remainingVes = o.maxVes * capacityFactor;

        perturbedOffers.push({
          ...o,
          price: driftedPrice,
          maxVes: remainingVes,
        });
      }

      // If all ads were cancelled, fallback to minimal depth
      if (perturbedOffers.length === 0 && offers.length > 0) {
        perturbedOffers.push({ ...offers[0] });
      }

      const runImpact = simulateTradeImpact({
        targetAmountUsdt: ticketAmountUsdt,
        side,
        availableOffers: perturbedOffers,
      });

      slippageDistribution.push(runImpact.slippagePct);
      if (runImpact.isFullyFillable) {
        fullyFilledRuns++;
      }
    }

    // 3. Statistical Quantile Analysis
    slippageDistribution.sort((a, b) => a - b);

    const sum = slippageDistribution.reduce((acc, v) => acc + v, 0);
    const meanSlippage = Number((sum / iterations).toFixed(3));
    const medianIndex = Math.floor(iterations * 0.5);
    const p95Index = Math.floor(iterations * 0.95);
    const p99Index = Math.floor(iterations * 0.99);

    const medianSlippage = Number(slippageDistribution[medianIndex].toFixed(3));
    const p95Slippage = Number(slippageDistribution[p95Index].toFixed(3));
    const p99Slippage = Number(slippageDistribution[p99Index].toFixed(3));
    const fillRate = Number(((fullyFilledRuns / iterations) * 100).toFixed(1));

    // VaR 95% in USDT
    const var95Usdt = Number(((ticketAmountUsdt * p95Slippage) / 100).toFixed(2));

    // Safe if P95 worst case slippage does not eat more than 0.30% of margin
    const isSafeForExecution = p95Slippage <= 0.3 && fillRate >= 80;

    let recommendation: string;
    if (isSafeForExecution) {
      recommendation = `Distribución robusta: Deslizamiento P95 proyectado en ${p95Slippage}% (${Math.round(p95Slippage * 100)} bps). Tasa de llenado del ${fillRate}%. Operación institucionalmente segura.`;
    } else if (p95Slippage <= 0.6) {
      recommendation = `Riesgo moderado de cola: El 5% de los escenarios genera slippage hasta ${p95Slippage}%. Operar solo si el spread neto supera 1.10% o reducir el ticket a la mitad.`;
    } else {
      recommendation = `ALERTA DE VOLATILIDAD EXTREMA: Deslizamiento P95 crítico (${p95Slippage}%). Alta probabilidad de cancelaciones en el libro. No despachar orden de mercado completa.`;
    }

    return {
      ticketAmountUsdt,
      side,
      iterations,
      baseSlippagePct: Number(baseResult.slippagePct.toFixed(3)),
      meanSlippagePct: meanSlippage,
      medianSlippagePct: medianSlippage,
      p95SlippagePct: p95Slippage,
      p99SlippagePct: p99Slippage,
      fillRatePct: fillRate,
      worstCaseNetSpreadImpactPct: p95Slippage,
      var95Usdt,
      isSafeForExecution,
      recommendation,
    };
  }
}
