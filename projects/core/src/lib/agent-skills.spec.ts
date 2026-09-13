import { describe, it, expect } from 'vitest';
import {
  GEMINI_FINANCIAL_SKILLS,
  executeFinancialSkill,
} from './agent-skills';

describe('Agent Skills & Function Calling Declarations', () => {
  it('should expose the 5 standard financial skills schemas for Gemini', () => {
    expect(GEMINI_FINANCIAL_SKILLS.length).toBe(5);
    const names = GEMINI_FINANCIAL_SKILLS.map((s) => s.name);
    expect(names).toContain('scan_triangular_arbitrage');
    expect(names).toContain('predict_bcv_market_intelligence');
    expect(names).toContain('inspect_orderbook_liquidity');
    expect(names).toContain('evaluate_golden_spread');
    expect(names).toContain('build_operator_allocation_plan');

    // All should have parameters of type OBJECT with properties
    for (const skill of GEMINI_FINANCIAL_SKILLS) {
      expect(skill.parameters.type).toBe('OBJECT');
      expect(Object.keys(skill.parameters.properties).length).toBeGreaterThan(0);
      expect(skill.parameters.required.length).toBeGreaterThan(0);
    }
  });

  it('should execute evaluate_golden_spread deterministically', () => {
    const res = executeFinancialSkill('evaluate_golden_spread', { netSpreadPct: 1.6 });
    expect(res.success).toBe(true);
    expect(res.skillName).toBe('evaluate_golden_spread');
    const data = res.data as { isViable: boolean; alertLevel: string };
    expect(data.isViable).toBe(true);
    expect(data.alertLevel).toBe('GOLDEN_ZONE');

    const lowRes = executeFinancialSkill('evaluate_golden_spread', { netSpreadPct: 0.2 });
    expect(lowRes.success).toBe(true);
    const lowData = lowRes.data as { isViable: boolean; alertLevel: string };
    expect(lowData.isViable).toBe(false);
    expect(lowData.alertLevel).toBe('BELOW_THRESHOLD_PAUSE');
  });

  it('should execute predict_bcv_market_intelligence deterministically', () => {
    const res = executeFinancialSkill('predict_bcv_market_intelligence', {
      parallelRate: 85.0,
      bcvRate: 70.0,
    });
    expect(res.success).toBe(true);
    const data = res.data as { gap: { gapPct: number; riskLevel: string }; recommendation: { action: string } };
    expect(data.gap.gapPct).toBeGreaterThan(20);
    expect(data.recommendation).toBeDefined();
  });

  it('should execute build_operator_allocation_plan deterministically', () => {
    const res = executeFinancialSkill('build_operator_allocation_plan', {
      deskCapitalUsdt: 5000,
      referenceRateVes: 80.0,
      operators: [
        {
          id: 'OP-1',
          name: 'Operador Turno Mañana',
          assignedCapitalUsdt: 2500,
          commissionSplitPct: 25,
          targetDailyCycles: 3,
          active: true,
        },
      ],
    });
    expect(res.success).toBe(true);
    const data = res.data as { totalDeskCapitalUsdt: number; operatorsAllocations: unknown[] };
    expect(data.totalDeskCapitalUsdt).toBe(5000);
    expect(data.operatorsAllocations.length).toBe(1);
  });

  it('should return error gracefully for unknown skill or missing parameters', () => {
    const unknownRes = executeFinancialSkill('invented_skill', {});
    expect(unknownRes.success).toBe(false);
    expect(unknownRes.error).toContain('Habilidad desconocida');

    const missingArgsRes = executeFinancialSkill('predict_bcv_market_intelligence', {
      parallelRate: 0,
      bcvRate: 0,
    });
    expect(missingArgsRes.success).toBe(false);
    expect(missingArgsRes.error).toContain('requiere parallelRate y bcvRate');
  });
});
