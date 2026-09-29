/**
 * Pure Mathematical Engine for Macro Sentiment & BCV Intelligence Sentinel.
 * Predicts central bank foreign exchange interventions, parallel rate jump probabilities,
 * and prescribes defensive or offensive inventory allocation rules for P2P desks.
 * Zero external dependencies.
 */

import { roundMoney } from './money';

export type MacroRegimeType =
  | 'BCV_INTERVENTION_WINDOW'
  | 'PARALLEL_GAP_EXPANSION'
  | 'INVENTORY_STABILITY'
  | 'EXTREME_DEVALUATION_PRESSURE';

export interface MacroTelemetryInput {
  bcvOfficialRate: number; // e.g. 60.50 Bs
  parallelMarketRate: number; // e.g. 85.50 Bs
  daysSinceLastIntervention: number;
  currentHourOfDayUtcMinus4: number; // 0 to 23 (Venezuela local time)
  currentDayOfWeek: number; // 1 = Mon, 5 = Fri
  estimatedWeeklyBcvInjectionUsd?: number; // e.g. 70,000,000
  interventionSchedule?: {
    customInterventionDays?: number[]; // e.g. [1, 4] for Mon/Thu
    startHourUtcMinus4?: number; // default 9
    endHourUtcMinus4?: number; // default 13
    provenance?: 'ESTIMATED_HEURISTIC' | 'VERIFIED_SCHEDULE';
  };
}

export interface MacroRegimeAssessment {
  regime: MacroRegimeType;
  rateGapPct: number; // ((parallel - bcv) / bcv) * 100
  interventionProbabilityPct: number; // 0 to 100
  devaluationSpeedRiskScore: number; // 0 to 100
  recommendedVesHoldMaxMinutes: number; // Maximum minutes to hold bolívares before mandatory delta hedge
  makerSpreadAdjustmentPct: number; // Suggested spread expansion/contraction
  tacticalDirective: string;
  provenance: 'ESTIMATED_HEURISTIC' | 'VERIFIED_SCHEDULE';
  timestamp: string;
}

/**
 * Evaluates macroeconomic FX indicators and generates prescriptive desk directives.
 */
export function evaluateMacroBcvRegime(input: MacroTelemetryInput): MacroRegimeAssessment {
  const bcv = Math.max(0.01, input.bcvOfficialRate);
  const parallel = Math.max(0.01, input.parallelMarketRate);

  const rateGapPct = roundMoney(((parallel - bcv) / bcv) * 100, 2);

  // Intervention probability model:
  // Uses injected schedule when available or documented heuristic with explicit provenance tag.
  const scheduleDays = input.interventionSchedule?.customInterventionDays ?? [1, 4]; // Default Monday & Thursday
  const startHour = input.interventionSchedule?.startHourUtcMinus4 ?? 9;
  const endHour = input.interventionSchedule?.endHourUtcMinus4 ?? 13;
  const provenance = input.interventionSchedule?.provenance ?? 'ESTIMATED_HEURISTIC';

  let interventionProb = 15;
  const isInterventionDay = scheduleDays.includes(input.currentDayOfWeek);
  const isInterventionHour = input.currentHourOfDayUtcMinus4 >= startHour && input.currentHourOfDayUtcMinus4 <= endHour;

  if (isInterventionDay && isInterventionHour) {
    interventionProb += 55;
  } else if (input.daysSinceLastIntervention >= 5) {
    interventionProb += 35;
  }

  if (rateGapPct > 25) {
    interventionProb += 15; // High gap forces central bank intervention
  }
  interventionProb = Math.min(95, Math.max(5, interventionProb));

  // Devaluation speed risk:
  let devalRisk = Math.min(100, Math.round(rateGapPct * 2.2));
  if (input.daysSinceLastIntervention >= 7) {
    devalRisk = Math.min(100, devalRisk + 20);
  }

  // Determine regime:
  let regime: MacroRegimeType = 'INVENTORY_STABILITY';
  let vesHoldMinutes = 120;
  let spreadAdj = 0.0;
  let directive = 'Régimen cambiario estable. Operar con rotación estándar.';

  if (rateGapPct >= 30) {
    regime = 'EXTREME_DEVALUATION_PRESSURE';
    vesHoldMinutes = 30; // Do not hold VES for more than 30 mins
    spreadAdj = 1.2;
    directive = 'ALERTA MÁXIMA DEVALUACIÓN: Brecha cambiaria >30%. Prohibido retener bolívares >30 min. Abrir spread de venta +1.2% y activar compras continuas.';
  } else if (interventionProb >= 70) {
    regime = 'BCV_INTERVENTION_WINDOW';
    vesHoldMinutes = 60;
    spreadAdj = -0.3; // Can buy slightly cheaper during banking dollar supply injection
    directive = 'VENTANA DE INTERVENCIÓN ACTIVA: Alta probabilidad de inyección de divisas en banca. Ajustar compras Maker a la baja y esperar absorción del flujo bancario.';
  } else if (rateGapPct >= 18) {
    regime = 'PARALLEL_GAP_EXPANSION';
    vesHoldMinutes = 45;
    spreadAdj = 0.6;
    directive = 'EXPANSIÓN DE BRECHA CAMBIARIA: Dólar paralelo acelerando. Mantener inventario en bolívares mínimo (<45 min) y priorizar captación de USDT.';
  }

  return {
    regime,
    rateGapPct,
    interventionProbabilityPct: interventionProb,
    devaluationSpeedRiskScore: devalRisk,
    recommendedVesHoldMaxMinutes: vesHoldMinutes,
    makerSpreadAdjustmentPct: spreadAdj,
    tacticalDirective: directive,
    provenance,
    timestamp: new Date().toISOString(),
  };
}
