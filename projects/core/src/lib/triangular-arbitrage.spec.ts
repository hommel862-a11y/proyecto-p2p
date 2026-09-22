import { describe, it, expect } from 'vitest';
import {
  simulateLeg,
  evaluateTriangularRisk,
  calculateTriangularArbitrage,
  DEFAULT_TRIANGULAR_PRESETS,
  type ExchangeLeg,
} from './triangular-arbitrage';

describe('Triangular Arbitrage Domain Engine', () => {
  describe('simulateLeg', () => {
    it('handles division conversion correctly (e.g. buying crypto with fiat)', () => {
      const leg: ExchangeLeg = {
        id: 'leg-buy',
        fromCurrency: 'VES',
        toCurrency: 'USDT',
        operationType: 'BUY_CRYPTO',
        platform: 'Binance P2P',
        paymentMethod: 'Pago Móvil',
        price: 80,
        isDivision: true,
        feePct: 1, // 1%
        fixedFee: 0,
        fixedFeeCurrency: 'USDT',
        estimatedDurationMinutes: 10,
      };

      // 8,000 VES / 80 = 100 USDT gross. Minus 1% fee (1 USDT) => 99 USDT.
      const sim = simulateLeg(8000, leg);
      expect(sim.inputAmount).toBe(8000);
      expect(sim.percentageFeeAmount).toBe(1);
      expect(sim.outputAmount).toBe(99);
      expect(sim.effectiveRate).toBe(0.012375);
    });

    it('handles multiplication conversion correctly (e.g. selling crypto for fiat)', () => {
      const leg: ExchangeLeg = {
        id: 'leg-sell',
        fromCurrency: 'USDT',
        toCurrency: 'COP',
        operationType: 'SELL_CRYPTO',
        platform: 'Binance P2P',
        paymentMethod: 'Bancolombia',
        price: 4000,
        isDivision: false,
        feePct: 0.5, // 0.5%
        fixedFee: 1000, // 1000 COP fixed fee
        fixedFeeCurrency: 'COP',
        estimatedDurationMinutes: 15,
      };

      // 100 USDT * 4000 = 400,000 COP gross.
      // 0.5% fee = 2,000 COP. Fixed fee = 1,000 COP.
      // Net output = 400,000 - 3,000 = 397,000 COP.
      const sim = simulateLeg(100, leg);
      expect(sim.inputAmount).toBe(100);
      expect(sim.percentageFeeAmount).toBe(2000);
      expect(sim.fixedFeeAmount).toBe(1000);
      expect(sim.outputAmount).toBe(397000);
    });

    it('returns zero safely if input amount or price is zero', () => {
      const leg: ExchangeLeg = {
        id: 'leg-zero',
        fromCurrency: 'USDT',
        toCurrency: 'VES',
        operationType: 'SELL_CRYPTO',
        platform: 'Test',
        paymentMethod: 'Test',
        price: 0,
        isDivision: false,
        feePct: 0,
        fixedFee: 0,
        fixedFeeCurrency: 'VES',
        estimatedDurationMinutes: 0,
      };

      const sim = simulateLeg(100, leg);
      expect(sim.outputAmount).toBe(0);
      expect(sim.effectiveRate).toBe(0);
    });
  });

  describe('evaluateTriangularRisk', () => {
    it('returns CRITICAL if ROI is negative or zero', () => {
      const risk = evaluateTriangularRisk(-1.5, 30, ['USDT', 'COP', 'VES']);
      expect(risk.level).toBe('CRITICAL');
      expect(risk.reasons.length).toBeGreaterThan(0);
    });

    it('returns LOW risk for healthy margin and fast turnaround', () => {
      const risk = evaluateTriangularRisk(3.5, 30, ['USDT', 'USD', 'EUR']);
      expect(risk.level).toBe('LOW');
      expect(risk.reasons.length).toBe(0);
    });

    it('returns HIGH risk for low margin with long execution duration', () => {
      const risk = evaluateTriangularRisk(0.5, 100, ['USDT', 'COP', 'VES']);
      expect(risk.level).toBe('HIGH');
      expect(risk.reasons).toContain(
        'Margen neto muy bajo (< 0.8%): alto riesgo de quedar en pérdida ante slippage o micro-fluctuaciones.',
      );
      expect(risk.reasons).toContain(
        'Tiempo de ejecución prolongado (>= 90 min): alta exposición a volatilidad cambiaria durante la rotación.',
      );
    });
  });

  describe('calculateTriangularArbitrage', () => {
    it('correctly calculates the full 3-leg cycle for a profitable route', () => {
      const preset = DEFAULT_TRIANGULAR_PRESETS[1]; // USDT -> USD -> VES -> USDT
      const result = calculateTriangularArbitrage(
        preset.id,
        preset.name,
        1000, // 1,000 USDT
        preset.legs,
      );

      expect(result.initialAmount).toBe(1000);
      expect(result.initialCurrency).toBe('USDT');
      expect(result.steps.length).toBe(3);
      expect(result.finalAmount).toBeGreaterThan(0);
      expect(typeof result.roiPct).toBe('number');
      expect(typeof result.isProfitable).toBe('boolean');
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(result.riskLevel);
      expect(result.projectedTurnoverHours).toBeGreaterThan(0);
      expect(typeof result.hourlyRoiPct).toBe('number');
      expect(result.breakevenPriceLeg3).toBeGreaterThan(0);
      expect(typeof result.slippageTolerancePct).toBe('number');
    });

    it('calculates breakeven price and slippage tolerance accurately', () => {
      const preset = DEFAULT_TRIANGULAR_PRESETS[0];
      const result = calculateTriangularArbitrage(preset.id, preset.name, 10000, preset.legs);

      expect(result.breakevenPriceLeg3).toBeGreaterThan(0);
      if (result.isProfitable) {
        expect(result.slippageTolerancePct).toBeGreaterThanOrEqual(0);
      }
    });

    it('applies banking friction fees (percentage and fixed) to reduce net output', () => {
      const legWithoutBanking: ExchangeLeg = {
        id: 'leg-nobank',
        fromCurrency: 'USDT',
        toCurrency: 'COP',
        operationType: 'SELL_CRYPTO',
        platform: 'Binance P2P',
        paymentMethod: 'Bancolombia',
        price: 4000,
        isDivision: false,
        feePct: 0.5,
        fixedFee: 0,
        fixedFeeCurrency: 'COP',
        estimatedDurationMinutes: 15,
      };

      const legWithBanking: ExchangeLeg = {
        ...legWithoutBanking,
        bankingFeePct: 0.4, // 4x1000 GMF
        bankingFixedFee: 2000,
      };

      const simNoBank = simulateLeg(100, legWithoutBanking);
      const simWithBank = simulateLeg(100, legWithBanking);

      expect(simWithBank.bankingFeeAmount).toBeGreaterThan(0);
      expect(simWithBank.outputAmount).toBeLessThan(simNoBank.outputAmount);
    });

    it('preserves default preset structure integrity', () => {
      expect(DEFAULT_TRIANGULAR_PRESETS.length).toBeGreaterThanOrEqual(2);
      for (const preset of DEFAULT_TRIANGULAR_PRESETS) {
        expect(preset.legs.length).toBe(3);
        expect(preset.legs[0].fromCurrency).toBe(preset.legs[2].toCurrency);
      }
    });
  });

  describe('Phase 1: Global Corridors & Spatial Basis Arbitrage', () => {
    it('analyzeFxCorridorEfficiency ranks corridors by net yield after friction', async () => {
      const { analyzeFxCorridorEfficiency } = await import('./triangular-arbitrage');
      const result = analyzeFxCorridorEfficiency(1000, [
        {
          corridorId: 'USDT-COP',
          sourceCurrency: 'USDT',
          targetCurrency: 'COP',
          spotCrossRate: 4200,
          officialParityRate: 4100,
          bankingFrictionPct: 0.4,
          transferLatencyMinutes: 10,
          makerFeePct: 0.1,
        },
        {
          corridorId: 'USDT-VES',
          sourceCurrency: 'USDT',
          targetCurrency: 'VES',
          spotCrossRate: 85,
          officialParityRate: 75,
          bankingFrictionPct: 0.2,
          transferLatencyMinutes: 15,
          makerFeePct: 0.1,
        },
      ]);

      expect(result.rankedCorridors.length).toBe(2);
      expect(result.recommendedCorridorId).toBe('USDT-VES');
      expect(result.arbitrageSpreadBetweenBestAndWorstPct).toBeGreaterThan(0);
      expect(result.rankedCorridors[0].viabilityStatus).toBe('OPTIMAL_CORRIDOR');
    });

    it('calculateCrossExchangeBasisSpread detects profitable spatial basis across P2P platforms', async () => {
      const { calculateCrossExchangeBasisSpread } = await import('./triangular-arbitrage');
      const result = calculateCrossExchangeBasisSpread(2000, [
        {
          platformName: 'ElDorado',
          fiatCurrency: 'VES',
          bestBidPrice: 83.0,
          bestAskPrice: 83.5, // Barato para comprar
          availableDepthUsdt: 5000,
          internalTransferFeeUsdt: 1.0,
        },
        {
          platformName: 'Binance',
          fiatCurrency: 'VES',
          bestBidPrice: 85.0, // Caro para vender
          bestAskPrice: 85.5,
          availableDepthUsdt: 10000,
          internalTransferFeeUsdt: 0,
        },
      ]);

      expect(result.buyPlatform).toBe('ElDorado');
      expect(result.sellPlatform).toBe('Binance');
      expect(result.grossSpreadPct).toBeGreaterThan(1.5);
      expect(result.netSpreadPct).toBeGreaterThan(0.5);
      expect(result.isExecutable).toBe(true);
      expect(result.netProfitUsdt).toBeGreaterThan(0);
    });
  });
});
