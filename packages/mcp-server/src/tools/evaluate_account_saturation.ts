import {
  EvaluateAccountSaturationInputSchema,
  type EvaluateAccountSaturationInput,
} from '../schemas/index.js';

export const evaluateAccountSaturationTool = {
  name: 'evaluate_account_saturation',
  description:
    'Monitorea la velocidad transaccional y saturación de cupos bancarios según normativas anti-SUDEBAN para evitar bloqueos preventivos de cuentas.',
  inputSchema: EvaluateAccountSaturationInputSchema,
  execute: (input: EvaluateAccountSaturationInput) => {
    const bankId = input.bankId;
    const currentVes = input.currentDailyVes;
    const limitVes = input.dailyLimitVes;
    const hourlyOps = input.hourlyTransactionCount;
    const incoming = input.incomingAmountVes || 0;

    const projectedVes = currentVes + incoming;
    const saturationPct = Number(((projectedVes / limitVes) * 100).toFixed(2));

    // Heuristics for SUDEBAN anti-structuring / pitufeo
    const isVelocityWarning = hourlyOps >= 8;
    const isApproachingLimit = saturationPct >= 80;
    const isOverLimit = saturationPct >= 100;

    let riskLevel: 'SAFE' | 'ELEVATED' | 'CRITICAL' = 'SAFE';
    if (isOverLimit || (isApproachingLimit && isVelocityWarning)) {
      riskLevel = 'CRITICAL';
    } else if (isApproachingLimit || isVelocityWarning) {
      riskLevel = 'ELEVATED';
    }

    const recommendRotation = riskLevel !== 'SAFE';

    return {
      bankId,
      currentDailyVes: currentVes,
      projectedDailyVes: projectedVes,
      dailyLimitVes: limitVes,
      saturationPercentage: saturationPct,
      remainingQuotaVes: Math.max(0, limitVes - projectedVes),
      hourlyOps,
      riskLevel,
      recommendBankRotation: recommendRotation,
      reason: recommendRotation
        ? isOverLimit
          ? 'Cupo diario excedido. Rotación bancaria obligatoria.'
          : 'Alerta de velocidad transaccional o saturación superior al 80%.'
        : 'Cuenta operando dentro de umbrales seguros.',
      timestamp: new Date().toISOString(),
    };
  },
};
