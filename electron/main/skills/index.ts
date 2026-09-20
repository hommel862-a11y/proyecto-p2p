/**
 * Modular Financial Agent Skills Registry & Dispatcher.
 * Orchestrates pure domain engines from @p2p/core with deterministic execution.
 */

import type { AgentSkillDefinition, FinancialSkillResult } from './types';
import { TRADING_SKILLS_DEFINITIONS, dispatchTradingSkill } from './trading-skills';
import { MACRO_SKILLS_DEFINITIONS, dispatchMacroSkill } from './macro-skills';
import { RISK_SKILLS_DEFINITIONS, dispatchRiskSkill } from './risk-skills';
import { EARN_SKILLS_DEFINITIONS, dispatchEarnSkill } from './earn-skills';
import { OPERATIONS_SKILLS_DEFINITIONS, dispatchOperationsSkill } from './operations-skills';

export * from './types';
export * from './market-state';
export * from './trading-skills';
export * from './macro-skills';
export * from './risk-skills';
export * from './earn-skills';
export * from './operations-skills';

export const GEMINI_FINANCIAL_SKILLS: AgentSkillDefinition[] = [
  ...TRADING_SKILLS_DEFINITIONS,
  ...MACRO_SKILLS_DEFINITIONS,
  ...RISK_SKILLS_DEFINITIONS,
  ...EARN_SKILLS_DEFINITIONS,
  ...OPERATIONS_SKILLS_DEFINITIONS,
];

/**
 * Deterministic dispatcher for all financial skills supported by Gemini Orchestrator.
 * Fully synchronous requirement to maintain compatibility with Gemini Orchestrator.
 */
export function executeFinancialSkill(
  skillName: string,
  args: Record<string, unknown>,
): FinancialSkillResult {
  const now = Date.now();

  try {
    const result =
      dispatchTradingSkill(skillName, args, now) ??
      dispatchMacroSkill(skillName, args, now) ??
      dispatchRiskSkill(skillName, args, now) ??
      dispatchEarnSkill(skillName, args, now) ??
      dispatchOperationsSkill(skillName, args, now);

    if (result) {
      return result;
    }

    return {
      success: false,
      skillName,
      error: `Habilidad no reconocida: ${skillName}`,
      executedAt: now,
    };
  } catch (err: unknown) {
    return {
      success: false,
      skillName,
      error: `execución del motor falló: ${err instanceof Error ? err.message : String(err)}`,
      executedAt: now,
    };
  }
}
