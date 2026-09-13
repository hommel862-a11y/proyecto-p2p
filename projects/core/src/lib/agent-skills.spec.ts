import { describe, it, expect } from 'vitest';
import {
  GEMINI_FINANCIAL_SKILLS,
  executeFinancialSkill,
} from './agent-skills';

describe('Agent Skills & Function Calling Declarations', () => {
  it('should expose the 10 standard financial skills schemas for Gemini', () => {
    expect(GEMINI_FINANCIAL_SKILLS.length).toBe(10);
    const names = GEMINI_FINANCIAL_SKILLS.map((s) => s.name);
    expect(names).toContain('scan_triangular_arbitrage');
    expect(names).toContain('predict_bcv_market_intelligence');
    expect(names).toContain('inspect_orderbook_liquidity');
    expect(names).toContain('evaluate_golden_spread');
    expect(names).toContain('build_operator_allocation_plan');
    expect(names).toContain('evaluate_delta_neutral_hedge');
    expect(names).toContain('forecast_market_volatility_2h');
    expect(names).toContain('audit_zk_mesh_threat');
    expect(names).toContain('generate_dispute_dossier');
    expect(names).toContain('simulate_trade_impact');

    // All should have parameters of type OBJECT with properties
    for (const skill of GEMINI_FINANCIAL_SKILLS) {
      expect(skill.parameters.type).toBe('OBJECT');
      expect(Object.keys(skill.parameters.properties).length).toBeGreaterThan(0);
      expect(skill.parameters.required.length).toBeGreaterThan(0);
    }
  });

  it('should execute evaluate_delta_neutral_hedge deterministically', () => {
    const res = executeFinancialSkill('evaluate_delta_neutral_hedge', {
      vesBalance: 200000,
      usdtBalance: 1000,
      currentParallelRate: 80.0,
      vesMaxHoldingTimeMinutes: 45,
      maxAllowedFiatDeltaRatio: 0.15,
    });
    expect(res.success).toBe(true);
    const data = res.data as { metrics: { urgency: string; netDeltaRatio: number }; proposals: unknown[] };
    expect(data.metrics).toBeDefined();
    expect(data.metrics.urgency).not.toBe('NONE');
    expect(data.proposals.length).toBeGreaterThan(0);
  });

  it('should execute forecast_market_volatility_2h deterministically', () => {
    const res = executeFinancialSkill('forecast_market_volatility_2h', {
      currentSpreadPct: 1.5,
      recentTicks: [
        { timestampMs: 1000000, buyPrice: 80, sellPrice: 81.2 },
        { timestampMs: 1003600, buyPrice: 80.5, sellPrice: 82.0 },
      ],
      parallelRate: 82.0,
      bcvRate: 70.0,
    });
    expect(res.success).toBe(true);
    const data = res.data as { volatilityIndex: number; level: string; direction: string };
    expect(data.volatilityIndex).toBeGreaterThanOrEqual(0);
    expect(data.level).toBeDefined();
  });

  it('should execute audit_zk_mesh_threat deterministically', () => {
    const res = executeFinancialSkill('audit_zk_mesh_threat', {
      identifier: 'V-12345678',
    });
    expect(res.success).toBe(true);
    const data = res.data as { blindHash: string; riskStatus: string };
    expect(data.blindHash).toBeDefined();
    expect(data.blindHash.length).toBe(64); // SHA-256
    expect(data.riskStatus).toBe('CLEAN');
  });

  it('should execute generate_dispute_dossier deterministically', () => {
    const res = executeFinancialSkill('generate_dispute_dossier', {
      orderId: 'BNB-998877',
      orderAmountFiat: 85000,
      orderAmountCrypto: 1000,
      counterpartyBinanceName: 'Carlos Trader',
      bankPayerName: 'Maria Perez',
      bankName: 'Banesco',
      bankReference: '0098765432',
    });
    expect(res.success).toBe(true);
    const data = res.data as { appealTextEs: string; appealTextEn: string; timeline: unknown[] };
    expect(data.appealTextEs).toContain('BNB-998877');
    expect(data.appealTextEn).toContain('BNB-998877');
    expect(data.timeline.length).toBeGreaterThan(0);
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

  it('should execute simulate_trade_impact deterministically', () => {
    const res = executeFinancialSkill('simulate_trade_impact', {
      targetAmountUsdt: 600,
      side: 'BUY',
      availableOffers: [
        {
          advNo: 'ADV-1',
          price: 84.0,
          surplusAmount: 1000,
          merchantName: 'TraderPro',
          merchantFinishRate: 99,
        },
      ],
    });
    expect(res.success).toBe(true);
    const data = res.data as { isFullyFillable: boolean; totalFilledUsdt: number; bestQuotedPrice: number };
    expect(data.isFullyFillable).toBe(true);
    expect(data.totalFilledUsdt).toBe(600);
    expect(data.bestQuotedPrice).toBe(84.0);
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
