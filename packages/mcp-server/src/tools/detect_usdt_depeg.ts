import { detectUsdtDepegParity } from '../core/index.js';
import { DetectUsdtDepegInputSchema, type DetectUsdtDepegInput } from '../schemas/index.js';

export const detectUsdtDepegTool = {
  name: 'detect_usdt_depeg',
  description:
    'Monitorea la paridad global de USDT respecto al USD fiat ($1.000), alertando sobre despegues por descuento o prima y riesgos de desconfianza sistémica.',
  inputSchema: DetectUsdtDepegInputSchema,
  execute: (input: DetectUsdtDepegInput) => {
    const evalResult = detectUsdtDepegParity(input.spotUsdtPrice, input.thresholdPct);

    return {
      spotUsdtPrice: evalResult.spotUsdtPrice,
      parityDeviationPct: evalResult.parityDeviationPct,
      status: evalResult.status,
      isDepegged: evalResult.isDepegged,
      thresholdPct: evalResult.thresholdPct,
      arbitrageOpportunity: evalResult.arbitrageOpportunity,
      riskSeverity: evalResult.riskSeverity,
      recommendation: evalResult.recommendation,
      isEmergencyActionRequired:
        evalResult.riskSeverity === 'CRITICAL' || evalResult.riskSeverity === 'HIGH',
    };
  },
};
