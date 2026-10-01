import {
  EvaluateAccountSaturationInputSchema,
  type EvaluateAccountSaturationInput,
} from '../schemas/index.js';

/**
 * Unlike the other tools in this suite, the arithmetic here is honest: the
 * caller supplies `currentDailyVes`, `dailyLimitVes` and `incomingAmountVes`,
 * and the saturation percentage is a correct division of those numbers. That
 * part is a calculator over caller-supplied facts and is kept.
 *
 * What was fabricated was the framing around it. The tool presented the
 * caller-supplied limit as "cupos bancarios según normativas anti-SUDEBAN" and
 * then applied invented regulatory thresholds — 80% saturation and 8
 * transactions per hour — to emit `riskLevel: 'CRITICAL'` and
 * `recommendBankRotation: true` with reasons like "Cupo diario excedido.
 * Rotación bancaria obligatoria."
 *
 * No SUDEBAN limit was consulted, and rotating bank accounts in response to a
 * self-supplied number is a suggestion that reads as compliance guidance while
 * being pure fiction. The arithmetic is reported; the regulatory verdict is
 * not.
 */
export const evaluateAccountSaturationTool = {
  name: 'evaluate_account_saturation',
  description:
    'Calcula el porcentaje de saturación de un cupo diario a partir de los montos que proporciona el operador. Los umbrales del callers son datos del operador, NO límites regulatorios verificados: la herramienta no emite veredicto de cumplimiento ni recomienda rotación de bancos.',
  inputSchema: EvaluateAccountSaturationInputSchema,
  execute: (input: EvaluateAccountSaturationInput) => {
    const bankId = input.bankId;
    const currentVes = input.currentDailyVes;
    const limitVes = input.dailyLimitVes;
    const hourlyOps = input.hourlyTransactionCount;
    const incoming = input.incomingAmountVes || 0;

    const projectedVes = currentVes + incoming;
    const saturationPct = Number(((projectedVes / limitVes) * 100).toFixed(2));

    return {
      bankId,
      currentDailyVes: currentVes,
      projectedDailyVes: projectedVes,
      dailyLimitVes: limitVes,
      saturationPercentage: saturationPct,
      remainingQuotaVes: Math.max(0, limitVes - projectedVes),
      hourlyOps,

      // The regulatory dimension is absent, not merely uncertain.
      limitProvenance: 'CALLER_SUPPLIED',
      regulatoryLimitVerified: false,
      riskLevel: null,
      recommendBankRotation: null,
      reason: null,
      hourlyThreshold: null,
      saturationAlertThreshold: null,

      callerObservation:
        saturationPct >= 100
          ? 'El monto proyectado supera el cupo que vos declaraste. Verificá el límite real con tu banco.'
          : saturationPct >= 80
            ? 'El monto proyectado se acerca al cupo que vos declaraste. Verificá el límite real con tu banco.'
            : 'El monto proyectado queda por debajo del cupo que vos declaraste.',
      timestamp: new Date().toISOString(),
    };
  },
};