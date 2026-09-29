import { describe, it, expect } from 'vitest';
import {
  evaluateMacroBcvRegime,
  type MacroTelemetryInput,
} from './macro-bcv-intelligence';

describe('MacroBcvIntelligence Engine', () => {
  it('detects BCV_INTERVENTION_WINDOW on Monday morning during banking hours', () => {
    const input: MacroTelemetryInput = {
      bcvOfficialRate: 60.0,
      parallelMarketRate: 72.0, // 20% gap
      daysSinceLastIntervention: 4,
      currentHourOfDayUtcMinus4: 10, // 10:00 AM
      currentDayOfWeek: 1, // Lunes
    };

    const res = evaluateMacroBcvRegime(input);
    expect(res.regime).toBe('BCV_INTERVENTION_WINDOW');
    expect(res.interventionProbabilityPct).toBeGreaterThanOrEqual(70);
    expect(res.makerSpreadAdjustmentPct).toBeLessThan(0);
  });

  it('triggers EXTREME_DEVALUATION_PRESSURE when rate gap exceeds 30%', () => {
    const input: MacroTelemetryInput = {
      bcvOfficialRate: 50.0,
      parallelMarketRate: 70.0, // 40% gap
      daysSinceLastIntervention: 8,
      currentHourOfDayUtcMinus4: 16,
      currentDayOfWeek: 3,
    };

    const res = evaluateMacroBcvRegime(input);
    expect(res.regime).toBe('EXTREME_DEVALUATION_PRESSURE');
    expect(res.recommendedVesHoldMaxMinutes).toBe(30);
    expect(res.makerSpreadAdjustmentPct).toBeGreaterThanOrEqual(1.0);
    expect(res.tacticalDirective).toContain('ALERTA MÁXIMA DEVALUACIÓN');
  });
});
