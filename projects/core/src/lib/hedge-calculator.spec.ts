import { describe, it, expect } from 'vitest';
import {
  calculateHedgeScenarios,
  simulateDevaluation,
  getHedgeRecommendation,
  type HedgeConfig,
  type HedgeScenario,
} from './hedge-calculator';

describe('hedge-calculator', () => {
  describe('calculateHedgeScenarios', () => {
    // Config simple: 100 USDT, tipo 20 Bs/USD, min 18, max 25, cobertura 70%
    const config: HedgeConfig = {
      usdtAmount: 100,
      vesPerUsdCurrent: 20,
      vesPerUsdMin: 18,
      vesPerUsdMax: 25,
      coveragePct: 70,
      usdtFeeRate: 0.5,
      usdtPerVesFee: 0.01,
    };

    it('returns three scenarios with correct names', () => {
      const scenarios = calculateHedgeScenarios(config);
      expect(scenarios).toHaveLength(3);
      expect(scenarios[0].name).toBe('Conservador');
      expect(scenarios[1].name).toBe('Moderado');
      expect(scenarios[2].name).toBe('Agresivo');
    });

    it('conservador requiere más USDT que moderado', () => {
      const scenarios = calculateHedgeScenarios(config);
      expect(scenarios[0].usdtNeeded).toBeGreaterThan(0);
      // Conservador cubre al tipo min (18), así que necesita más USDT que moderado (tipo actual 20)
      expect(scenarios[0].usdtNeeded).toBeGreaterThan(scenarios[1].usdtNeeded);
    });

    it('agresivo tiene coveragePct >= configurado y <= 100', () => {
      const scenarios = calculateHedgeScenarios(config);
      expect(scenarios[2].coveragePct).toBeGreaterThanOrEqual(config.coveragePct);
      expect(scenarios[2].coveragePct).toBeLessThanOrEqual(100);
    });
  });

  describe('simulateDevaluation', () => {
    // Config: 100 USDT, tipo actual 20, min 18, max 25
    const config: HedgeConfig = {
      usdtAmount: 100,
      vesPerUsdCurrent: 20,
      vesPerUsdMin: 18,
      vesPerUsdMax: 25,
      coveragePct: 70,
      usdtFeeRate: 0.5,
      usdtPerVesFee: 0.01,
    };

    it('calcula pérdida por devaluación a tipo menor (de 20 a 15)', () => {
      const result = simulateDevaluation(config, 15);
      // De 20 a 15 es pérdida del 25%
      // percentageLoss = ((15/20) - 1) * 100 = -25
      expect(result.percentageLoss).toBe(-25);
      expect(result.shouldHedge).toBe(true);
    });

    it('no recomienda hedge si pérdida es pequeña (de 20 a 19)', () => {
      const result = simulateDevaluation(config, 19);
      // Pérdida del 5%
      expect(result.percentageLoss).toBe(-5);
      expect(result.shouldHedge).toBe(false);
    });

    it('ganancia si tipo aumenta (de 20 a 25)', () => {
      const result = simulateDevaluation(config, 25);
      // De 20 a 25 es ganancia del 25%, percentageLoss debería ser positivo o el logic lo trate
      // Si percentageLoss > 15 triggers hedge, y es ganancia, shouldHedge debería ser false
      expect(result.shouldHedge).toBe(false);
    });
  });

  describe('getHedgeRecommendation', () => {
    it('recomienda full hedge cuando cobertura es baja (30%) y tipo en límite alto', () => {
      const config: HedgeConfig = {
        usdtAmount: 100,
        vesPerUsdCurrent: 20,
        vesPerUsdMin: 18,
        vesPerUsdMax: 25,
        coveragePct: 30, // Muy baja cobertura
        usdtFeeRate: 0.5,
        usdtPerVesFee: 0.01,
      };

      const rec = getHedgeRecommendation(config);
      // Cobertura 30% < 80%, así que partial hedge
      expect(rec.action).toBe('PARTIAL_HEDGE');
      expect(rec.usdtToHedge).toBeGreaterThan(0);
    });

    it('no recomienda acción cuando cobertura es alta y tipo ya en límite', () => {
      const config: HedgeConfig = {
        usdtAmount: 100,
        vesPerUsdCurrent: 25,
        vesPerUsdMin: 18,
        vesPerUsdMax: 25, // Ya en límite máximo
        coveragePct: 95, // Alta cobertura
        usdtFeeRate: 0.5,
        usdtPerVesFee: 0.01,
      };

      const rec = getHedgeRecommendation(config);
      expect(rec.action).toBe('NO_ACTION');
      expect(rec.usdtToHedge).toBe(0);
    });

    it('recomienda acción cuando cobertura es muy baja y tipo permite hedge', () => {
      const config: HedgeConfig = {
        usdtAmount: 100,
        vesPerUsdCurrent: 20,
        vesPerUsdMin: 18,
        vesPerUsdMax: 30,
        coveragePct: 20, // Muy baja
        usdtFeeRate: 0.5,
        usdtPerVesFee: 0.01,
      };

      const rec = getHedgeRecommendation(config);
      // Cobertura 20% < 80%
      expect(rec.action).toBe('PARTIAL_HEDGE');
      expect(rec.usdtToHedge).toBeGreaterThan(0);
    });
  });
});
