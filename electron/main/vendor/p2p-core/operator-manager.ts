/**
 * Pure domain logic for P2P Operator Delegation, Team Capital Splitting,
 * 10-day Audit Windows, and Minimum Golden Spread Rule (0.50%).
 * Inspired by the institutional P2P scaling methodology ($1,000/day tier).
 * Deterministic, 0 network, 0 external dependencies.
 */

import { type Operation } from './log';
import { roundMoney, clampNonNegative } from './money';

export const MINIMUM_VIABLE_NET_SPREAD_PCT = 0.50; // Inflexible rule: never burn bank quotas below 0.50%

export interface OperatorProfile {
  id: string;
  name: string;
  assignedCapitalUsdt: number;
  commissionSplitPct: number; // e.g. 25 for 25% of net profit to operator, 75% to desk owner
  targetDailyCycles: number;
  maxDailyVolumeVesCap?: number;
  active: boolean;
}

export interface OperatorAuditResult {
  operatorId: string;
  operatorName: string;
  periodDays: number;
  assignedCapitalUsdt: number;
  totalOperations: number;
  completedCycles: number;
  totalVolumeUsdt: number;
  totalGrossProfitUsdt: number;
  totalFeesVes: number;
  totalNetProfitUsdt: number;
  averageNetSpreadPct: number;
  operatorShareUsdt: number;
  deskOwnerShareUsdt: number;
  projectedMonthlyDeskProfitUsdt: number;
  isMeetingSpreadTarget: boolean; // avgNetSpreadPct >= 0.50%
  status: 'OPTIMAL' | 'ACCEPTABLE' | 'UNDERPERFORMING' | 'INACTIVE';
  recommendations: string[];
}

export interface TeamAllocationPlan {
  totalDeskCapitalUsdt: number;
  referenceRateVes: number;
  deskOwnerRetainedCapitalUsdt: number;
  operatorsAllocations: {
    operator: OperatorProfile;
    allocatedCapitalUsdt: number;
    allocatedCapitalVes: number;
    targetDailyProfitUsdt: number;
    operatorDailyTakeUsdt: number;
    ownerDailyTakeUsdt: number;
  }[];
  totalDailyEstimatedProfitUsdt: number;
  totalDailyOwnerProfitUsdt: number;
  totalDailyOperatorsProfitUsdt: number;
  monthlyProjectedDeskProfitUsdt: number;
}

export interface GoldenSpreadCheck {
  netSpreadPct: number;
  isViable: boolean;
  alertLevel: 'GOLDEN_ZONE' | 'HEALTHY' | 'MARGINAL_CAUTION' | 'BELOW_THRESHOLD_PAUSE';
  headline: string;
  message: string;
}

/**
 * Validates a net spread against the Golden Rule (minimum 0.50% net).
 * Below 0.50%, operating burns bank quotas for pennies and increases fraud surface.
 */
export function evaluateGoldenSpread(netSpreadPct: number): GoldenSpreadCheck {
  const rounded = roundMoney(netSpreadPct, 2);

  if (rounded >= 1.5) {
    return {
      netSpreadPct: rounded,
      isViable: true,
      alertLevel: 'GOLDEN_ZONE',
      headline: 'Zona de Oro (Super Spread > 1.50%)',
      message: 'Margen institucional óptimo. Operar con tickets altos y máxima rotación de capital.',
    };
  }

  if (rounded >= 0.8) {
    return {
      netSpreadPct: rounded,
      isViable: true,
      alertLevel: 'HEALTHY',
      headline: 'Margen Saludable (0.80% - 1.49%)',
      message: 'Spread estable y seguro para mantener anuncios activos en Banesco y canales principales.',
    };
  }

  if (rounded >= MINIMUM_VIABLE_NET_SPREAD_PCT) {
    return {
      netSpreadPct: rounded,
      isViable: true,
      alertLevel: 'MARGINAL_CAUTION',
      headline: 'Umbral Mínimo Viable (0.50% - 0.79%)',
      message: 'En el piso de rentabilidad. Usar órdenes con tickets mínimos protegidos para no agotar cupos bancarios.',
    };
  }

  return {
    netSpreadPct: rounded,
    isViable: false,
    alertLevel: 'BELOW_THRESHOLD_PAUSE',
    headline: 'Regla de Oro Rota (< 0.50% Neto)',
    message: 'ALERTA: El spread está por debajo del 0.50%. Pausar anuncios o rotar de pasarela; quemar cupos por menos de 0.50% destruye la cuenta bancaria.',
  };
}

/**
 * Computes team capital allocation split between Desk Leader and external Operators.
 */
export function buildTeamAllocationPlan(
  totalDeskCapitalUsdt: number,
  operators: readonly OperatorProfile[],
  referenceRateVes: number = 60.0,
  expectedAvgCycleSpreadPct: number = 0.85,
): TeamAllocationPlan {
  const safeTotalCapital = clampNonNegative(totalDeskCapitalUsdt);
  const activeOperators = operators.filter((op) => op.active);

  let totalAllocatedToOperators = 0;
  const allocations: TeamAllocationPlan['operatorsAllocations'] = [];

  for (const op of activeOperators) {
    const allocatedCapital = Math.min(
      clampNonNegative(op.assignedCapitalUsdt),
      Math.max(0, safeTotalCapital - totalAllocatedToOperators),
    );
    totalAllocatedToOperators += allocatedCapital;

    const dailyCycleProfitPerCycle = (allocatedCapital * (expectedAvgCycleSpreadPct / 100));
    const totalDailyProfit = dailyCycleProfitPerCycle * Math.max(0.5, op.targetDailyCycles);
    const opShare = totalDailyProfit * (op.commissionSplitPct / 100);
    const ownerShare = totalDailyProfit - opShare;

    allocations.push({
      operator: op,
      allocatedCapitalUsdt: roundMoney(allocatedCapital, 2),
      allocatedCapitalVes: roundMoney(allocatedCapital * referenceRateVes, 2),
      targetDailyProfitUsdt: roundMoney(totalDailyProfit, 2),
      operatorDailyTakeUsdt: roundMoney(opShare, 2),
      ownerDailyTakeUsdt: roundMoney(ownerShare, 2),
    });
  }

  const deskOwnerRetainedCapitalUsdt = Math.max(0, safeTotalCapital - totalAllocatedToOperators);

  // Leader operating their own retained capital (e.g. 2 daily cycles)
  const leaderDailyCycles = 2.0;
  const leaderRetainedProfitUsdt = (deskOwnerRetainedCapitalUsdt * (expectedAvgCycleSpreadPct / 100)) * leaderDailyCycles;

  const operatorsDailyProfitSum = allocations.reduce((acc, a) => acc + a.targetDailyProfitUsdt, 0);
  const operatorsTakeSum = allocations.reduce((acc, a) => acc + a.operatorDailyTakeUsdt, 0);
  const ownerFromOperatorsSum = allocations.reduce((acc, a) => acc + a.ownerDailyTakeUsdt, 0);

  const totalDailyEstimatedProfitUsdt = roundMoney(leaderRetainedProfitUsdt + operatorsDailyProfitSum, 2);
  const totalDailyOwnerProfitUsdt = roundMoney(leaderRetainedProfitUsdt + ownerFromOperatorsSum, 2);
  const totalDailyOperatorsProfitUsdt = roundMoney(operatorsTakeSum, 2);

  return {
    totalDeskCapitalUsdt: safeTotalCapital,
    referenceRateVes,
    deskOwnerRetainedCapitalUsdt: roundMoney(deskOwnerRetainedCapitalUsdt, 2),
    operatorsAllocations: allocations,
    totalDailyEstimatedProfitUsdt,
    totalDailyOwnerProfitUsdt,
    totalDailyOperatorsProfitUsdt,
    monthlyProjectedDeskProfitUsdt: roundMoney(totalDailyOwnerProfitUsdt * 30, 2),
  };
}

/**
 * Audits an operator's performance over a 10-day window.
 */
export function auditOperatorPerformance(
  operator: OperatorProfile,
  operatorOps: readonly Operation[],
  referenceRateVes: number = 60.0,
  periodDays: number = 10,
): OperatorAuditResult {
  const safePeriod = Math.max(1, periodDays);
  let buyCount = 0;
  let sellCount = 0;
  let totalFeesVes = 0;
  let totalVolumeUsdt = 0;
  let netPnlVes = 0;

  for (const op of operatorOps) {
    totalFeesVes += op.fees;
    totalVolumeUsdt += op.usdtAmount;

    if (op.type === 'buy') {
      buyCount++;
      netPnlVes -= (op.vesAmount + op.fees);
    } else {
      sellCount++;
      netPnlVes += (op.vesAmount - op.fees);
    }
  }

  const completedCycles = Math.min(buyCount, sellCount);
  const totalGrossProfitUsdt = roundMoney((netPnlVes + totalFeesVes) / referenceRateVes, 2);
  const totalNetProfitUsdt = roundMoney(netPnlVes / referenceRateVes, 2);

  const investedCapitalVes = operator.assignedCapitalUsdt * referenceRateVes;
  const averageNetSpreadPct = investedCapitalVes > 0 && completedCycles > 0
    ? roundMoney((netPnlVes / (investedCapitalVes * completedCycles)) * 100, 2)
    : 0;

  const safeNetProfit = Math.max(0, totalNetProfitUsdt);
  const operatorShareUsdt = roundMoney(safeNetProfit * (operator.commissionSplitPct / 100), 2);
  const deskOwnerShareUsdt = roundMoney(safeNetProfit - operatorShareUsdt, 2);
  const projectedMonthlyDeskProfitUsdt = roundMoney((deskOwnerShareUsdt / safePeriod) * 30, 2);

  const isMeetingSpreadTarget = averageNetSpreadPct >= MINIMUM_VIABLE_NET_SPREAD_PCT;
  const recommendations: string[] = [];

  let status: OperatorAuditResult['status'] = 'INACTIVE';

  if (operatorOps.length === 0) {
    status = 'INACTIVE';
    recommendations.push('El operador no registra operaciones en esta ventana de auditoría.');
  } else if (!isMeetingSpreadTarget) {
    status = 'UNDERPERFORMING';
    recommendations.push(`Spread medio (${averageNetSpreadPct}%) por debajo de la Regla de Oro (0.50%). Revisar estrategia de precios para no quemar límites.`);
  } else if (averageNetSpreadPct >= 1.0) {
    status = 'OPTIMAL';
    recommendations.push(`Desempeño sobresaliente con ${averageNetSpreadPct}% neto por ciclo. Candidato a asignación prioritaria de capital.`);
  } else {
    status = 'ACCEPTABLE';
    recommendations.push(`Rendimiento saludable dentro de los estándares de mercado (${averageNetSpreadPct}% neto).`);
  }

  return {
    operatorId: operator.id,
    operatorName: operator.name,
    periodDays: safePeriod,
    assignedCapitalUsdt: operator.assignedCapitalUsdt,
    totalOperations: operatorOps.length,
    completedCycles,
    totalVolumeUsdt: roundMoney(totalVolumeUsdt, 2),
    totalGrossProfitUsdt,
    totalFeesVes: roundMoney(totalFeesVes, 2),
    totalNetProfitUsdt,
    averageNetSpreadPct,
    operatorShareUsdt,
    deskOwnerShareUsdt,
    projectedMonthlyDeskProfitUsdt,
    isMeetingSpreadTarget,
    status,
    recommendations,
  };
}
