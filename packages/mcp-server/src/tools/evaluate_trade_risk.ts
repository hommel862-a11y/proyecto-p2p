import { evaluate, type RuleContext } from '../core/index.js';
import { EvaluateTradeRiskInputSchema, type EvaluateTradeRiskInput } from '../schemas/index.js';

// The four engine inputs this tool does not know on its own. They are state, not
// policy: what the spread is right now, how many positions are live, how much the
// day has lost, and whether operations are erroring.
//
// They were hardcoded as `1.25`, `1`, `0` and `counterpartyScore < 50 ? 2 : 0`. That
// last one is the giveaway: it capped the counterparty at 2 against a threshold of 3,
// so even `counterpartyScore: 0` could not trip rule 3. The counterparty was never
// wired to the decision at all.
//
// Every constant landed on the safe side of its own threshold, which is worse than an
// arbitrary number. Rules 2-5 were not merely wrong, they were unreachable: the tool
// could only ever return ALLOW or a rule-1 DENY, and it answered
// "Todos los parámetros dentro de umbrales seguros" for a trade whose counterparty
// scored zero.
//
// So the caller reports them, and when it cannot, the engine does not run. There is
// no set of defaults that makes an unknown measurement safe.
const ENGINE_STATE_INPUTS = [
  'currentSpreadPct',
  'openOps',
  'dailyLossPct',
  'consecutiveErrors',
] as const;

type EngineStateInput = (typeof ENGINE_STATE_INPUTS)[number];

// The engine's own fallback cap, stated here rather than left to a default the caller
// cannot see. `minSpread` is the desk floor: also policy, so it keeps its constant.
const POLICY_MAX_RISK_PER_TRADE_PCT = 20;
const POLICY_MIN_SPREAD_VES_PER_USDT = 0.5;

// A missing counterparty is not an acceptable one. The default was `100`, so
// `score >= 70` was unconditionally true and `isCounterpartyAcceptable` was really
// "was a score supplied".
const MIN_COUNTERPARTY_SCORE = 70;
const COUNTERPARTY_VIOLATION = `COUNTERPARTY_BELOW_MIN_SCORE_${MIN_COUNTERPARTY_SCORE}`;

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
        unmeasuredInputs: [...ENGINE_STATE_INPUTS],
        actionable: false,
        unavailableReason,
      };
    }

    const tradeRiskPct = (input.tradeAmountUsdt / capital) * 100;
    const isCounterpartyAcceptable = counterpartyScore >= MIN_COUNTERPARTY_SCORE;

    // Which engine inputs this call actually carried, and which it invented.
    const unmeasuredInputs: EngineStateInput[] = ENGINE_STATE_INPUTS.filter(
      (key) => input[key] == null
    );

    const measuredTradeRiskPct = Number(tradeRiskPct.toFixed(2));

    // A counterparty below the floor is a real, measured refusal. It outranks
    // "insufficient data": a caller that scores 30 already has its answer, and
    // burying that under INSUFFICIENT_DATA would hide a known-bad counterparty
    // behind missing telemetry.
    if (!isCounterpartyAcceptable) {
      return {
        decision: 'DENY' as const,
        reason: `Counterparty score ${counterpartyScore} is below the minimum ${MIN_COUNTERPARTY_SCORE}`,
        tradeRiskPct: measuredTradeRiskPct,
        recommendedSizeUsdt: 0,
        isCounterpartyAcceptable,
        violations: [COUNTERPARTY_VIOLATION],
        unmeasuredInputs,
        // The verdict itself is measured and final, so it is actionable even though
        // the engine never ran.
        actionable: true,
        unavailableReason: null,
      };
    }

    // `evaluate()` cannot represent "not measured": every comparison against an
    // absent field is false, so a zero or a NaN would silently answer ALLOW exactly
    // like the constants this replaced. Refusing to run is the only honest option.
    if (unmeasuredInputs.length > 0) {
      return {
        decision: 'INSUFFICIENT_DATA' as const,
        reason: `missing_evidence:${unmeasuredInputs.join(',')}`,
        // Real: a ratio of two measured numbers needs no engine state.
        tradeRiskPct: measuredTradeRiskPct,
        // Null on purpose. The 20% cap is policy over measured capital, so the
        // arithmetic works — but a "recommended size" from a tool that could not run
        // its brakes is a number a caller would size an order from. The caller has
        // capital and the documented cap; it can compute this itself.
        recommendedSizeUsdt: null,
        isCounterpartyAcceptable,
        // No rule was evaluated, so no rule was violated.
        violations: [],
        unmeasuredInputs,
        actionable: false,
        unavailableReason: null,
      };
    }

    // Every engine input is measured. Narrowing each non-null into a local is what
    // keeps the compiler aware of the filter above; a `!` would only silence it.
    const currentSpreadPct = input.currentSpreadPct as number;
    const openOps = input.openOps as number;
    const dailyLossPct = input.dailyLossPct as number;
    const consecutiveErrors = input.consecutiveErrors as number;

    const ctx: RuleContext = {
      currentSpread: currentSpreadPct,
      minSpread: POLICY_MIN_SPREAD_VES_PER_USDT,
      openOps,
      tradeRiskPct,
      dailyLossPct,
      consecutiveErrors,
      maxRiskPerTradePct: POLICY_MAX_RISK_PER_TRADE_PCT,
    };

    const verdict = evaluate(ctx);

    const recommendedMaxUsdt = (capital * POLICY_MAX_RISK_PER_TRADE_PCT) / 100;

    return {
      decision: verdict.decision,
      reason: verdict.reason,
      tradeRiskPct: measuredTradeRiskPct,
      recommendedSizeUsdt: Math.min(input.tradeAmountUsdt, recommendedMaxUsdt),
      isCounterpartyAcceptable,
      violations: verdict.decision !== 'ALLOW' ? [verdict.reason] : [],
      unmeasuredInputs,
      actionable: true,
      unavailableReason: null,
    };
  },
};
