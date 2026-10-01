import { calculateBcvGap } from '../core/index.js';
import { CalculateRateGapInputSchema, type CalculateRateGapInput } from '../schemas/index.js';

export const calculateRateGapTool = {
  name: 'calculate_rate_gap',
  description:
    'Calcula la brecha cambiaria porcentual entre la tasa paralela y la tasa oficial BCV, evaluando zona de riesgo y alerta de distorsión institucional.',
  inputSchema: CalculateRateGapInputSchema,
  execute: (input: CalculateRateGapInput) => {
    const gap = calculateBcvGap(input.parallelRate, input.bcvRate);

    let distortionRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' | 'UNAVAILABLE';
    let arbitrageOpportunity = false;
    let isDistortionCritical = false;

    switch (gap.zone) {
      case 'COMPRESSED':
        distortionRisk = 'LOW';
        break;
      case 'NORMAL':
        distortionRisk = 'MEDIUM';
        break;
      case 'ELEVATED':
        distortionRisk = 'HIGH';
        arbitrageOpportunity = true;
        break;
      case 'CRITICAL_DISPERSION':
        distortionRisk = 'EXTREME';
        arbitrageOpportunity = true;
        isDistortionCritical = true;
        break;
      case 'UNAVAILABLE':
        distortionRisk = 'UNAVAILABLE';
        break;
    }

    return {
      parallelRate: gap.parallelRate,
      bcvRate: gap.bcvRate,
      gapVes: gap.gapVes,
      gapPct: gap.gapPct,
      zone: gap.zone,
      description: gap.description,
      distortionRisk,
      arbitrageOpportunity,
      isDistortionCritical,
      actionable: gap.actionable,
      unavailableReason: gap.unavailableReason,
      strategicAdvice:
        gap.zone === 'UNAVAILABLE'
          ? 'Brecha no medible: sin al menos una de las dos tasas, no hay base para emitir recomendación táctica. Solicitar lectura en vivo de paralelo y BCV.'
          : gap.zone === 'CRITICAL_DISPERSION'
            ? 'ALTO RIESGO: Mantener inventario 100% dolarizado/USDT. No mantener saldos en bolívares overnight.'
            : gap.zone === 'ELEVATED'
              ? 'OPORTUNIDAD: Brecha elevada con probable subasta inminente. Capturar spread en puntas de venta antes de inyección.'
              : 'NORMAL: Operativa estándar de rotación rápida.',
    };
  },
};
