import { evaluate, type RuleContext } from '../core/index.js';
import { EvaluateTradeRiskInputSchema, type EvaluateTradeRiskInput } from '../schemas/index.js';

// `evaluate()` needs a full RuleContext, and four of its fields describe the real
// market: the spread right now, the floor the desk accepts, how many operations are
// live, and how much the day has lost so far.
//
// They were hardcoded here as `1.25`, `0.5`, `1` and `0`. `dailyLossPct: 0` is the
// same defect as `currentExposureUsdt: 0` in the sibling tool: it asserts a clean
// day on a day nobody measured. `openOps: 1` asserts one open position.
//
// So they are named as absences and reported, instead of being quietly supplied.
// The deterministic engine still runs on the fields we DO have — a trade whose
// capital ratio is measurable gets a real verdict — and the caller is told which
// rules it should not read as authoritative.
const UNMEASURED_ENGINE_INPUTS = [
  'currentSpread',
  'minSpread',
  'openOps',
  'dailyLossPct',
] as const;

export const evaluateTradeRiskTool = {
  name: 'evaluate_trade_risk',
  description:
    'Evalúa una propuesta de trade contra el motor determinista de 6 reglas de riesgo de P2P Decisor.',
  inputSchema: EvaluateTradeRiskInputSchema,
  execute: (input: EvaluateTradeRiskInput) => {
    // Without a denominator there is no percentage. 2500/5000 would read as a 50%
    // risk on a treasury that was never reported.
    //
    // Narrowed into locals so the compiler keeps the fact past the early return
    // below. Assigning a `const` is the narrowing; a `!` would only silence it.
    const capital = input.currentCapitalUsdt;
    const counterpartyScore = input.counterpartyScore;

    // Two levels of absence, and they are not the same claim:
    // - capital absent: the core number of this tool does not exist
    // - counterparty absent: the number exists, the eligibility verdict does not
    let unavailableReason: string | null = null;
    if (capital == null) {
      unavailableReason = 'missing_evidence:currentCapital';
    } else if (counterpartyScore == null) {
      unavailableReason = 'missing_evidence:counterpartyScore';
    }

    if (capital == null || counterpartyScore == null) {
      return {
        decision: 'UNAVAILABLE' as const,
        reason: unavailableReason ?? 'EVIDENCIA_INSUFICIENTE',
        tradeRiskPct: null,
        // A recommended size against an unreported capital is a number the caller
        // would size an order from.
        recommendedSizeUsdt: null,
        isCounterpartyAcceptable: null,
        // There is no rule violation to report: no rule could be evaluated. Before,
        // `decision !== 'ALLOW'` put the fabricated reason into this array.
        violations: [] as string[],
        unmeasuredInputs: [...UNMEASURED_ENGINE_INPUTS],
        actionable: false,
        unavailableReason,
      };
    }

    const tradeRiskPct = (input.tradeAmountUsdt / capital) * 100;
    // A missing counterparty is not an acceptable one. The default was `100`, so
    // `score >= 70` was unconditionally true and `isCounterpartyAcceptable` was
    // really "was a score supplied".
    const isCounterpartyAcceptable = counterpartyScore >= 70;

    const ctx: RuleContext = {
      currentSpread: 1.25,
      minSpread: 0.5,
      openOps: 1,
      tradeRiskPct,
      dailyLossPct: 0,
      consecutiveErrors: counterpartyScore < 50 ? 2 : 0,
      maxRiskPerTradePct: 20,
    };

    const verdict = evaluate(ctx);

    // Calculate recommended max safe size (e.g. max 20% of capital)
    const recommendedMaxUsdt = (capital * (ctx.maxRiskPerTradePct ?? 20)) / 100;

    return {
      decision: verdict.decision,
      reason: verdict.reason,
      tradeRiskPct: Number(tradeRiskPct.toFixed(2)),
      recommendedSizeUsdt: Math.min(input.tradeAmountUsdt, recommendedMaxUsdt),
      isCounterpartyAcceptable: isCounterpartyAcceptable,
      violations: verdict.decision !== 'ALLOW' ? [verdict.reason] : [],
      unmeasuredInputs: [...UNMEASURED_ENGINE_INPUTS],
      actionable: true,
      unavailableReason: null,
    };
  },
};
