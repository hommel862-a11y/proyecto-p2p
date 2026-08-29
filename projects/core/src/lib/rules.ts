/**
 * Risk-rules safety barrier (framework-agnostic, pure, deterministic).
 * NOT prediction/ML. Returns exactly one of ALLOW | DENY | PAUSE with a reason.
 * For the manual MVP, "stop-loss" maps to DENY ("do not recommend"), never auto-close.
 */

export const DECISION = {
  ALLOW: 'ALLOW',
  DENY: 'DENY',
  PAUSE: 'PAUSE',
} as const;
export type Decision = (typeof DECISION)[keyof typeof DECISION];

export const RULE_REASON = {
  API_FAILURE: 'api-failure',
  DAILY_LOSS_CAP: 'daily loss cap exceeded',
  CONSECUTIVE_ERRORS: 'consecutive errors limit reached',
  MAX_CONCURRENT: 'max concurrent operations reached',
  MIN_SPREAD: 'spread below minimum',
  RISK_PER_TRADE: 'risk per trade exceeded',
  OK: 'ok',
} as const;

export interface RuleContext {
  /** current unit spread (VES/USDT). */
  currentSpread: number;
  /** configured minimum acceptable spread (risk-rules config; also drives spread-monitor alert). */
  minSpread: number;
  /** number of operations currently open. */
  openOps: number;
  /** risk for the proposed trade, as a percentage (e.g. 2 = 2%). */
  tradeRiskPct: number;
  /** realized loss for the day, as a percentage. */
  dailyLossPct: number;
  /** consecutive error-tagged operations counter. */
  consecutiveErrors: number;
  maxConcurrentOps?: number;
  maxRiskPerTradePct?: number;
  dailyLossCapPct?: number;
  maxConsecutiveErrors?: number;
  /** API health stub. Inactive in MVP (no API). */
  apiStatus?: 'ok' | 'down';
}

export interface RuleVerdict {
  decision: Decision;
  reason: string;
}

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_RISK_PCT = 1;
const DEFAULT_DAILY_LOSS_CAP_PCT = 4;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Evaluate the current operating state against the 6 starter safety rules.
 * Order: API health -> daily loss -> consecutive errors -> concurrency -> min spread -> risk/trade.
 */
export function evaluate(ctx: RuleContext): RuleVerdict {
  const maxConcurrent = ctx.maxConcurrentOps ?? DEFAULT_MAX_CONCURRENT;
  const maxRisk = ctx.maxRiskPerTradePct ?? DEFAULT_MAX_RISK_PCT;
  const dailyLossCap = ctx.dailyLossCapPct ?? DEFAULT_DAILY_LOSS_CAP_PCT;
  const maxErrors = ctx.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
  const apiStatus = ctx.apiStatus ?? 'ok';

  if (apiStatus === 'down') {
    return { decision: DECISION.PAUSE, reason: RULE_REASON.API_FAILURE };
  }
  if (ctx.dailyLossPct > dailyLossCap) {
    return { decision: DECISION.PAUSE, reason: RULE_REASON.DAILY_LOSS_CAP };
  }
  if (ctx.consecutiveErrors >= maxErrors) {
    return { decision: DECISION.PAUSE, reason: RULE_REASON.CONSECUTIVE_ERRORS };
  }
  if (ctx.openOps >= maxConcurrent) {
    return { decision: DECISION.PAUSE, reason: RULE_REASON.MAX_CONCURRENT };
  }
  if (ctx.currentSpread < ctx.minSpread) {
    return { decision: DECISION.DENY, reason: RULE_REASON.MIN_SPREAD };
  }
  if (ctx.tradeRiskPct > maxRisk) {
    return { decision: DECISION.DENY, reason: RULE_REASON.RISK_PER_TRADE };
  }
  return { decision: DECISION.ALLOW, reason: RULE_REASON.OK };
}
