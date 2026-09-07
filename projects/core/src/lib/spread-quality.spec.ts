import { describe, it, expect } from 'vitest';
import {
  computeArbitrageCycle,
  computeSpreadQualityScore,
  projectVelocityEarnings,
  planReverseGoal,
  VENEZUELAN_BANK_FEES,
} from './spread-quality';

describe('Spread Quality & Arbitrage Cascade Domain Logic', () => {
  describe('VENEZUELAN_BANK_FEES', () => {
    it('defines known fee structures for key Venezuelan retail banks', () => {
      expect(VENEZUELAN_BANK_FEES.BANESCO).toBeDefined();
      expect(VENEZUELAN_BANK_FEES.BANESCO.pagoMovilFeePct).toBe(0.003);
      expect(VENEZUELAN_BANK_FEES.MERCANTIL.velocityScore).toBeGreaterThanOrEqual(80);
      expect(VENEZUELAN_BANK_FEES.BDV.transferInterbankFeePct).toBe(0.003);
    });
  });

  describe('computeArbitrageCycle', () => {
    it('calculates full cascading deductions for a Maker-Maker cycle', () => {
      // 1,000 USDT buy @ 60 VES, sell @ 61.2 VES (2% nominal spread)
      const res = computeArbitrageCycle({
        capitalUsdt: 1000,
        buyPrice: 60,
        sellPrice: 61.2,
        buyRole: 'MAKER',
        sellRole: 'MAKER',
        sourceBank: 'BANESCO',
        targetBank: 'BANESCO',
        isInterbank: false,
      });

      expect(res.capitalVesInvested).toBe(60000);
      // Binance fee: 0.2% on buy (2 USDT) + 0.2% on sell (998 * 0.002 = 1.996 USDT)
      expect(res.binanceFeeUsdt).toBeCloseTo(3.996, 3);
      expect(res.netCryptoUsdt).toBeCloseTo(996.004, 3);
      // Same bank, no interbank fees
      expect(res.bankFeesVes).toBe(0);
      expect(res.grossProceedsVes).toBeCloseTo(996.004 * 61.2, 2);
      expect(res.netGainVes).toBeGreaterThan(0);
      expect(res.roiCyclePct).toBeGreaterThan(0);
      expect(res.spreadNominalPct).toBeCloseTo(2.0, 1);
      expect(res.effectiveFeeDragPct).toBeGreaterThan(0);
    });

    it('deducts interbank transfer and pago movil fees when applicable', () => {
      const res = computeArbitrageCycle({
        capitalUsdt: 1000,
        buyPrice: 60,
        sellPrice: 61.2,
        buyRole: 'TAKER',
        sellRole: 'TAKER',
        sourceBank: 'BANESCO',
        targetBank: 'MERCANTIL',
        isInterbank: true,
      });

      // Taker = 0% Binance fee
      expect(res.binanceFeeUsdt).toBe(0);
      expect(res.netCryptoUsdt).toBe(1000);
      // Interbank fees applied: 0.3% out + 0.3% in
      expect(res.bankFeesVes).toBeGreaterThan(0);
      expect(res.netGainVes).toBeLessThan(res.grossProceedsVes - res.capitalVesInvested);
    });

    it('throws when capital or prices are invalid', () => {
      expect(() =>
        computeArbitrageCycle({
          capitalUsdt: -10,
          buyPrice: 60,
          sellPrice: 61,
          buyRole: 'MAKER',
          sellRole: 'MAKER',
          sourceBank: 'BANESCO',
          targetBank: 'BANESCO',
          isInterbank: false,
        }),
      ).toThrow();
    });
  });

  describe('projectVelocityEarnings', () => {
    it('projects daily, weekly and monthly earnings across multiple turnover cycles', () => {
      const cycle = computeArbitrageCycle({
        capitalUsdt: 1000,
        buyPrice: 60,
        sellPrice: 61.2,
        buyRole: 'MAKER',
        sellRole: 'MAKER',
        sourceBank: 'BANESCO',
        targetBank: 'BANESCO',
        isInterbank: false,
      });

      const projections = projectVelocityEarnings(cycle, [1, 3, 5]);
      expect(projections).toHaveLength(3);
      expect(projections[0].cyclesPerDay).toBe(1);
      expect(projections[1].cyclesPerDay).toBe(3);
      expect(projections[1].dailyGainUsd).toBeCloseTo(projections[0].dailyGainUsd * 3, 2);
      expect(projections[2].weeklyGainUsd).toBeCloseTo(projections[2].dailyGainUsd * 7, 2);
      expect(projections[0].dailyBankVolumeVes).toBeGreaterThan(cycle.capitalVesInvested);
    });
  });

  describe('computeSpreadQualityScore', () => {
    it('gives an OPTIMAL score for large healthy margins with low volatility and plenty of bank quota', () => {
      const res = computeSpreadQualityScore({
        buyPrice: 60,
        sellPrice: 62, // 3.33% spread
        volatility4hPct: 0.3,
        bankCode: 'BANESCO',
        accountUsagePct: 10,
      });

      expect(res.score).toBeGreaterThanOrEqual(85);
      expect(res.verdict).toBe('OPTIMAL');
      expect(res.verdictLabel).toContain('Óptimo');
      expect(res.nominalSpreadPct).toBeCloseTo(3.33, 1);
    });

    it('gives a TOXIC verdict when spread is negligible and swallowed by fees', () => {
      const res = computeSpreadQualityScore({
        buyPrice: 60,
        sellPrice: 60.1, // 0.16% nominal spread (less than maker fees)
        volatility4hPct: 0.5,
        bankCode: 'BANESCO',
        accountUsagePct: 90,
      });

      expect(res.score).toBeLessThan(45);
      expect(res.verdict).toBe('TOXIC');
      expect(res.verdictLabel).toContain('Tóxico');
      expect(res.recommendation).toContain('Pausa');
    });
  });

  describe('planReverseGoal', () => {
    it('calculates required cycles and warns if unfeasible', () => {
      const plan = planReverseGoal({
        dailyTargetUsd: 30,
        availableCapitalUsdt: 1000,
        buyPrice: 60,
        sellPrice: 61.2,
        bankCode: 'BANESCO',
      });

      expect(plan.requiredCycles).toBeGreaterThan(0);
      expect(plan.isFeasible).toBe(true);
      expect(plan.totalDailyBankVolumeVes).toBeGreaterThan(0);
    });

    it('flags unfeasible when capital is too small to reach high target without insane turnover', () => {
      const plan = planReverseGoal({
        dailyTargetUsd: 500,
        availableCapitalUsdt: 50, // Insanely low capital for $500/day
        buyPrice: 60,
        sellPrice: 60.5,
        bankCode: 'BANESCO',
      });

      expect(plan.isFeasible).toBe(false);
      expect(plan.warning).toBeDefined();
    });
  });
});
