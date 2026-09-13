import { describe, it, expect } from 'vitest';
import {
  computeTickVelocity,
  predictTwoHourVolatility,
  type PriceTick,
  type VolatilityForecastInput,
} from './volatility-forecaster';

describe('Volatility Forecaster (2-Hour Horizon)', () => {
  const now = Date.now();

  const flatTicks: PriceTick[] = [
    { timestampMs: now - 3600000, buyPrice: 50.0, sellPrice: 50.5 },
    { timestampMs: now - 2400000, buyPrice: 50.02, sellPrice: 50.51 },
    { timestampMs: now - 1200000, buyPrice: 50.01, sellPrice: 50.52 },
    { timestampMs: now, buyPrice: 50.03, sellPrice: 50.53 },
  ];

  const volatileTicks: PriceTick[] = [
    { timestampMs: now - 3600000, buyPrice: 50.0, sellPrice: 50.5 },
    { timestampMs: now - 2400000, buyPrice: 50.6, sellPrice: 51.2 },
    { timestampMs: now - 1200000, buyPrice: 51.4, sellPrice: 52.3 },
    { timestampMs: now, buyPrice: 52.5, sellPrice: 53.8 },
  ];

  it('calculates tick velocity and variance correctly', () => {
    const calmVelocity = computeTickVelocity(flatTicks);
    expect(calmVelocity.midPriceVelocityPctPerHour).toBeCloseTo(0.06, 1);
    expect(calmVelocity.spreadStandardDeviation).toBeLessThan(0.05);

    const highVelocity = computeTickVelocity(volatileTicks);
    expect(highVelocity.midPriceVelocityPctPerHour).toBeGreaterThan(5.0);
    expect(highVelocity.priceAcceleration).toBeGreaterThan(0);
  });

  it('forecasts calm/low volatility under stable conditions', () => {
    const input: VolatilityForecastInput = {
      recentTicks: flatTicks,
      currentSpreadPct: 1.0,
      bidDepthUsdt: 25000,
      askDepthUsdt: 24000,
    };

    const forecast = predictTwoHourVolatility(input);
    expect(forecast.level).toBe('LOW');
    expect(forecast.volatilityIndex).toBeLessThan(30);
    expect(forecast.liquidityRisk).toBe('SAFE');
    expect(forecast.direction).toBe('COMPRESSING');
    expect(forecast.suggestedSpreadAdjustmentPct.buyMarkupPct).toBe(0);
  });

  it('detects extreme volatility under fast price movement and active BCV auction', () => {
    const input: VolatilityForecastInput = {
      recentTicks: volatileTicks,
      currentSpreadPct: 2.5,
      bcvWindow: {
        vetDayOfWeek: 1, // Monday
        vetHour: 10,
        phase: 'INTERVENTION_ACTIVE',
        probabilityPct: 85,
        nextExpectedIntervention: 'Hoy lunes',
        hoursUntilIntervention: 0,
        rationale: 'Subasta bancaria en curso',
      },
      bcvGap: {
        parallelRate: 53.8,
        bcvRate: 42.0,
        gapVes: 11.8,
        gapPct: 28.1,
        zone: 'CRITICAL_DISPERSION',
        description: 'Brecha crítica',
      },
      spoofReport: {
        timestampMs: now,
        totalTracked: 20,
        classifiedOrders: [],
        spoofBaitCount: 3,
        phantomLiquidityCount: 2,
        suspiciousCount: 4,
        legitimateCount: 11,
        phantomLiquidityVes: 500000,
        manipulationRiskScore: 65,
      },
      bidDepthUsdt: 2500,
      askDepthUsdt: 1800,
    };

    const forecast = predictTwoHourVolatility(input);
    expect(forecast.level).toBe('EXTREME');
    expect(forecast.volatilityIndex).toBeGreaterThanOrEqual(75);
    expect(forecast.direction).toBe('EXPANDING');
    expect(forecast.expectedSpreadDriftBps).toBeGreaterThan(50);
    expect(forecast.liquidityRisk).toBe('IMMINENT_DRAIN');
    expect(forecast.suggestedSpreadAdjustmentPct.buyMarkupPct).toBeLessThan(0);
    expect(forecast.suggestedSpreadAdjustmentPct.sellMarkupPct).toBeGreaterThan(0);
    expect(forecast.drivers.length).toBeGreaterThanOrEqual(4);
  });
});
