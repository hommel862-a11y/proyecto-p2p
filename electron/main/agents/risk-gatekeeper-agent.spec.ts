import { describe, it, expect, beforeEach } from 'vitest';
import { RiskGatekeeperAgent } from './risk-gatekeeper-agent';
import type { StrategistProposal, TreasuryRiskContext } from './types';
import type { StrategyPlanCard } from '../../shared/types';

/**
 * Minimal viable proposal: healthy net spread, safe Monte Carlo tail and a ticket below the
 * anti-pitufeo threshold, so every assertion below is attributable to the treasury rules and
 * not to another Rule 1/2.1/5 effect.
 */
function buildProposal(overrides?: {
  capitalRequiredUsdt?: number;
  netSpreadPct?: number;
}): StrategistProposal {
  const capital = overrides?.capitalRequiredUsdt ?? 1000;
  const netSpreadPct = overrides?.netSpreadPct ?? 1.2;

  const plan: StrategyPlanCard = {
    id: 'PLAN-GK-1',
    title: 'Triangulación USDT/VES',
    route: 'BINANCE_P2P -> BANESCO_PM',
    capitalRequiredUsdt: capital,
    expectedNetSpreadPct: netSpreadPct,
    expectedProfitUsdt: (capital * netSpreadPct) / 100,
    riskLevel: 'LOW',
    rationale: 'Dispersión sana en el libro P2P.',
    status: 'PROPOSED',
  };

  return {
    plan,
    rationale: 'Spread neto por encima de la regla de oro.',
    mathematicalValidation: {
      grossSpreadPct: netSpreadPct + 0.4,
      estimatedFeesPct: 0.4,
      netSpreadPct,
      vwapPrice: 88.7,
      slippageBps: 12,
      meetsGoldenRule: true,
      monteCarlo: {
        meanSlippagePct: 0.1,
        p95SlippagePct: 0.2,
        p99SlippagePct: 0.35,
        fillRatePct: 96,
        var95Usdt: 40,
        isSafeForExecution: true,
        recommendation: 'Ejecución taker tolerable.',
      },
    },
    recommendedTiming: 'Inmediato',
  };
}

function buildTreasury(overrides: Partial<TreasuryRiskContext> = {}): TreasuryRiskContext {
  return {
    overLimitCount: 0,
    nearLimitCount: 0,
    disabledCount: 0,
    saturatedCount: 0,
    totalSpentTodayVes: 0,
    totalDailyLimitVes: 440000,
    ...overrides,
  };
}

describe('RiskGatekeeperAgent — reglas de tesorería real (T2)', () => {
  let gatekeeper: RiskGatekeeperAgent;

  beforeEach(() => {
    gatekeeper = new RiskGatekeeperAgent();
  });

  it('aprueba limpio cuando el snapshot real está sano y audita los datos reales', () => {
    const verdict = gatekeeper.evaluateProposal(buildProposal(), {
      dailyVolumeProcessedUsdt: 0,
      dailyLimitUsdt: 440000,
      treasurySnapshot: buildTreasury(),
    });

    expect(verdict.status).toBe('APPROVED');
    expect(verdict.warnings).toHaveLength(0);
    expect(verdict.riskScore).toBe(15);
    expect(verdict.auditedParameters.treasuryAudit).toEqual({
      source: 'RENDERER_SNAPSHOT',
      dailyVolumeUsed: 0,
      dailyLimitUsed: 440000,
      overLimitCount: 0,
      nearLimitCount: 0,
      disabledCount: 0,
      saturatedCount: 0,
    });
  });

  it('VETEA cuando una cuenta agotó su límite diario (overLimitCount > 0)', () => {
    const verdict = gatekeeper.evaluateProposal(buildProposal(), {
      dailyVolumeProcessedUsdt: 50000,
      dailyLimitUsdt: 440000,
      treasurySnapshot: buildTreasury({ overLimitCount: 1, totalSpentTodayVes: 50000 }),
    });

    expect(verdict.status).toBe('VETOED');
    expect(verdict.riskScore).toBe(90);
    expect(verdict.vetoReason).toContain('TESORERÍA REAL');
    expect(verdict.vetoReason).toContain('límite diario en VES');
    expect(verdict.auditedParameters.dailyBankLimitExceeded).toBe(true);
    expect(verdict.auditedParameters.treasuryAudit?.overLimitCount).toBe(1);
  });

  it('VETEA cuando existe una cuenta DISABLED (disabledCount > 0)', () => {
    const verdict = gatekeeper.evaluateProposal(buildProposal(), {
      dailyVolumeProcessedUsdt: 0,
      dailyLimitUsdt: 440000,
      treasurySnapshot: buildTreasury({ disabledCount: 1 }),
    });

    expect(verdict.status).toBe('VETOED');
    expect(verdict.riskScore).toBe(90);
    expect(verdict.vetoReason).toContain('DISABLED');
    // The VES cap is untouched, so the flag must not lie about being exceeded.
    expect(verdict.auditedParameters.dailyBankLimitExceeded).toBe(false);
    expect(verdict.auditedParameters.treasuryAudit?.disabledCount).toBe(1);
  });

  it('VETEA cuando una cuenta alcanzó su tope de transacciones (saturatedCount > 0)', () => {
    const verdict = gatekeeper.evaluateProposal(buildProposal(), {
      dailyVolumeProcessedUsdt: 0,
      dailyLimitUsdt: 440000,
      treasurySnapshot: buildTreasury({ saturatedCount: 2 }),
    });

      expect(verdict.status).toBe('VETOED');
      expect(verdict.riskScore).toBe(90);
      expect(verdict.vetoReason).toContain('VELOCIDAD BANCARIA');
      expect(verdict.vetoReason).toContain('tope diario de transacciones SUDEBAN');
      expect(verdict.warnings.some((w) => w.includes('SATURATED'))).toBe(true);
      expect(verdict.auditedParameters.treasuryAudit?.saturatedCount).toBe(2);
  });

  it('penaliza con warning (+15) en vez de vetear cuando hay cuentas cerca del límite', () => {
    const verdict = gatekeeper.evaluateProposal(buildProposal(), {
      dailyVolumeProcessedUsdt: 400000,
      dailyLimitUsdt: 440000,
      treasurySnapshot: buildTreasury({ nearLimitCount: 1, totalSpentTodayVes: 400000 }),
    });

      expect(verdict.status).toBe('APPROVED_WITH_WARNINGS');
      // Base 15 + 15 por la cuenta cerca del límite. 400000 + 1000 < 440000, así que no hay veto.
      expect(verdict.riskScore).toBe(30);
      expect(verdict.warnings.some((w) => w.includes('al límite diario VES'))).toBe(true);
      expect(verdict.auditedParameters.treasuryAudit?.nearLimitCount).toBe(1);
  });

  it('usa los límites reales del snapshot para la regla de exposición diaria', () => {
    // 9.500 + 1.000 = 10.500 > 10.000: con el snapshot real hay veto, mientras que con los
    // literales históricos (4.500 / 15.000) la operación habría pasado.
    const verdict = gatekeeper.evaluateProposal(buildProposal(), {
      dailyVolumeProcessedUsdt: 9500,
      dailyLimitUsdt: 10000,
      treasurySnapshot: buildTreasury({ totalSpentTodayVes: 9500, totalDailyLimitVes: 10000 }),
    });

    expect(verdict.status).toBe('VETOED');
    expect(verdict.vetoReason).toContain('10000');
    expect(verdict.auditedParameters.dailyBankLimitExceeded).toBe(true);
    expect(verdict.auditedParameters.treasuryAudit?.dailyVolumeUsed).toBe(9500);
    expect(verdict.auditedParameters.treasuryAudit?.dailyLimitUsed).toBe(10000);
  });

  describe('compatibilidad sin snapshot (comportamiento histórico)', () => {
    it('conserva los defaults 4200/15000 cuando no hay contexto de tesorería', () => {
      // 4.200 (default) + 12.000 = 16.200 > 15.000 (default): veto idéntico al previo al puente.
      const verdict = gatekeeper.evaluateProposal(
        buildProposal({ capitalRequiredUsdt: 12000 }),
      );

      expect(verdict.status).toBe('VETOED');
      expect(verdict.vetoReason).toContain('15000');
      expect(verdict.auditedParameters.treasuryAudit).toEqual({
        source: 'FALLBACK_DEFAULTS',
        dailyVolumeUsed: 4200,
        dailyLimitUsed: 15000,
        overLimitCount: 0,
        nearLimitCount: 0,
        disabledCount: 0,
        saturatedCount: 0,
      });
    });

    it('aprueba una operación sana con snapshot null explícito', () => {
      const verdict = gatekeeper.evaluateProposal(buildProposal(), {
        dailyVolumeProcessedUsdt: 4200,
        dailyLimitUsdt: 15000,
        treasurySnapshot: null,
      });

      expect(verdict.status).toBe('APPROVED');
      expect(verdict.riskScore).toBe(15);
      expect(verdict.auditedParameters.treasuryAudit?.source).toBe('FALLBACK_DEFAULTS');
    });

    it('no inventa límites a partir de un snapshot explícitamente vacío', () => {
      const verdict = gatekeeper.evaluateProposal(buildProposal(), {
        dailyVolumeProcessedUsdt: 0,
        dailyLimitUsdt: 15000,
        treasurySnapshot: null,
      });

      expect(verdict.status).toBe('APPROVED');
      expect(verdict.auditedParameters.treasuryAudit?.overLimitCount).toBe(0);
    });
  });
});
