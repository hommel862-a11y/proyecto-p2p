import { evaluate, type RuleContext } from '../core/index.js';
import { EvaluateTradeRiskInputSchema, type EvaluateTradeRiskInput } from '../schemas/index.js';

export const evaluateTradeRiskTool = {
  name: 'evaluate_trade_risk',
  description: 'Evalúa una propuesta de trade contra el motor determinista de 6 reglas de riesgo de P2P Decisor.',
  inputSchema: EvaluateTradeRiskInputSchema,
  execute: (input: EvaluateTradeRiskInput) => {
    const tradeRiskPct = (input.tradeAmountUsdt / input.currentCapitalUsdt) * 100;

    const ctx: RuleContext = {
      currentSpread: 1.25,
      minSpread: 0.50,
      openOps: 1,
      tradeRiskPct,
      dailyLossPct: 0,
      consecutiveErrors: input.counterpartyScore < 50 ? 2 : 0,
      maxRiskPerTradePct: 20,
    };

    const verdict = evaluate(ctx);

    // Calculate recommended max safe size (e.g. max 20% of capital)
    const recommendedMaxUsdt = (input.currentCapitalUsdt * (ctx.maxRiskPerTradePct ?? 20)) / 100;

    return {
      decision: verdict.decision,
      reason: verdict.reason,
      tradeRiskPct: Number(tradeRiskPct.toFixed(2)),
      recommendedSizeUsdt: Math.min(input.tradeAmountUsdt, recommendedMaxUsdt),
      isCounterpartyAcceptable: input.counterpartyScore >= 70,
      violations: verdict.decision !== 'ALLOW' ? [verdict.reason] : [],
    };
  },
};
