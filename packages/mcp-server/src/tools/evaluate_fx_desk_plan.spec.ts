import { describe, it, expect } from 'vitest';
import { EvaluateFxDeskPlanInputSchema } from '../schemas/index.js';
import { evaluateFxDeskPlanTool, ALL_MCP_TOOLS, MCP_TOOLS_BY_SERVER } from './index.js';

describe('MCP Tool: evaluate_fx_desk_plan (Mesa Cambiaria BCV v2.0)', () => {
  it('registers evaluate_fx_desk_plan in ALL_MCP_TOOLS and macro/decisor server profiles', () => {
    expect(ALL_MCP_TOOLS.some((t) => t.name === 'evaluate_fx_desk_plan')).toBe(true);
    expect(
      MCP_TOOLS_BY_SERVER['p2p-decisor']?.some((t) => t.name === 'evaluate_fx_desk_plan'),
    ).toBe(true);
    expect(
      MCP_TOOLS_BY_SERVER['p2p-macro-predictor']?.some((t) => t.name === 'evaluate_fx_desk_plan'),
    ).toBe(true);
  });

  it('never fabricates rates or capital in schema defaults (fail-closed contract)', () => {
    const parsed = EvaluateFxDeskPlanInputSchema.parse({});
    expect(parsed.bcvOfficialRateVes).toBeUndefined();
    expect(parsed.p2pSellRateVes).toBeUndefined();
    expect(parsed.capitalVes).toBeUndefined();

    const res = evaluateFxDeskPlanTool.execute(parsed);
    expect(res.actionable).toBe(false);
    expect(res.verdict).toBe('UNAVAILABLE');
    expect(res.unavailableReason).toContain('missing_evidence:');
    expect(res.summary.totalRecommendedUsd).toBe(0);
  });

  it('computes 14-bank plan with 1x fee, 3% IGTF vs 0% OTC, VET window, and exact 100% Banco filter', () => {
    // 1. Verify exact 100% Banco resolution (CIEN_BANCO, default OTC rail = 0% IGTF)
    const cienPlan = evaluateFxDeskPlanTool.execute(
      EvaluateFxDeskPlanInputSchema.parse({
        bcvOfficialRateVes: 64.5,
        p2pSellRateVes: 79.8,
        capitalVes: 150000,
        modality: 'MENUDEO_BCV',
        igtfPct: 3,
        allocationMode: 'PER_BANK',
        bankFilter: '100% Banco',
        evaluationTimestampIso: '2026-11-26T14:30:00.000Z', // Thursday 10:30 VET -> BCV_INTERVENTION_LIVE
      }),
    );

    expect(cienPlan.actionable).toBe(true);
    expect(cienPlan.window.isWindowOpen).toBe(true);
    expect(cienPlan.window.regime).toBe('BCV_INTERVENTION_LIVE');
    expect(cienPlan.tickets).toHaveLength(1);
    expect(cienPlan.tickets[0]!.bankId).toBe('CIEN_BANCO');
    expect(cienPlan.tickets[0]!.igtfPct).toBe(0);

    // 2. Verify electronic rail (Bancamiga INTL_DEBIT_CARD = 3% IGTF) vs TAQUILLA_EFECTIVO_OTC (0% IGTF)
    const electronic = evaluateFxDeskPlanTool.execute(
      EvaluateFxDeskPlanInputSchema.parse({
        bcvOfficialRateVes: 64.5,
        p2pSellRateVes: 79.8,
        capitalVes: 150000,
        modality: 'MENUDEO_BCV',
        igtfPct: 3,
        allocationMode: 'PER_BANK',
        bankFilter: 'BANCAMIGA',
        evaluationTimestampIso: '2026-11-26T14:30:00.000Z',
      }),
    );

    const bancamigaTicket = electronic.tickets[0]!;
    expect(bancamigaTicket.bankId).toBe('BANCAMIGA');
    expect(bancamigaTicket.recommendedOrderUsd).toBeGreaterThan(0);
    expect(bancamigaTicket.igtfPct).toBe(3);
    expect(bancamigaTicket.netUsdtAfterExitRail).toBeLessThan(bancamigaTicket.recommendedOrderUsd);

    const otc = evaluateFxDeskPlanTool.execute(
      EvaluateFxDeskPlanInputSchema.parse({
        bcvOfficialRateVes: 64.5,
        p2pSellRateVes: 79.8,
        capitalVes: 150000,
        modality: 'TAQUILLA_EFECTIVO_OTC',
        igtfPct: 3,
        allocationMode: 'PER_BANK',
        bankFilter: 'BANCAMIGA',
        evaluationTimestampIso: '2026-11-26T14:30:00.000Z',
      }),
    );

    expect(otc.tickets[0]!.igtfPct).toBe(0);
    expect(otc.tickets[0]!.netUsdtAfterExitRail).toBeGreaterThan(bancamigaTicket.netUsdtAfterExitRail);
  });

  it('isolates multiple accounts of the same bank without summing sub-minimum balances', () => {
    const subMin = evaluateFxDeskPlanTool.execute(
      EvaluateFxDeskPlanInputSchema.parse({
        bcvOfficialRateVes: 65.0,
        p2pSellRateVes: 80.0,
        allocationMode: 'PER_BANK',
        bankFilter: 'BANCAMIGA', // minLotUsd = $20 (~1,313 Bs)
        accounts: [
          {
            id: 'acc-bancamiga-1',
            bankCode: 'BANCAMIGA',
            bankName: 'Bancamiga A',
            availableBalanceVes: 800,
            paymentRail: 'TRANSFERENCIA',
          },
          {
            id: 'acc-bancamiga-2',
            bankCode: 'BANCAMIGA',
            bankName: 'Bancamiga B',
            availableBalanceVes: 800,
            paymentRail: 'TRANSFERENCIA',
          },
        ],
      }),
    );

    expect(subMin.tickets[0]!.recommendedOrderUsd).toBe(0);
    expect(subMin.tickets[0]!.accountAllocations).toHaveLength(0);
  });
});
