import { calculateBcvGap } from '../core/index.js';
import { CalculateRateGapInputSchema, type CalculateRateGapInput } from '../schemas/index.js';

export const calculateRateGapTool = {
  name: 'calculate_rate_gap',
  description:
    'Calcula la brecha cambiaria porcentual entre la tasa paralela y la tasa oficial BCV, evaluando zona de riesgo y alerta de distorsión institucional.',
  inputSchema: CalculateRateGapInputSchema,
  execute: (input: CalculateRateGapInput) => {
    const gap = calculateBcvGap(input.parallelRate, input.bcvRate);

    let distortionRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    let arbitrageOpportunity = false;

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
      isDistortionCritical: gap.zone === 'CRITICAL_DISPERSION',
      strategicAdvice:
        gap.zone === 'CRITICAL_DISPERSION'
          ? 'ALTO RIESGO: Mantener inventario 100% dolarizado/USDT. No mantener saldos en bolívares overnight.'
          : gap.zone === 'ELEVATED'
            ? 'OPORTUNIDAD: Brecha elevada con probable subasta inminente. Capturar spread en puntas de venta antes de inyección.'
            : 'NORMAL: Operativa estándar de rotación rápida.',
    };
  },
};
