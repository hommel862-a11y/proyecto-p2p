import { SimulateTradeImpactInputSchema, type SimulateTradeImpactInput } from '../schemas/index.js';

export const simulateTradeImpactTool = {
  name: 'simulate_trade_impact',
  description:
    'Simula el impacto de una orden en la exposición acumulada y alerta si violaría límites diarios.',
  inputSchema: SimulateTradeImpactInputSchema,
  execute: (input: SimulateTradeImpactInput) => {
    const projectedExposure = input.currentExposureUsdt + input.proposedTradeAmountUsdt;
    const limitExceeded = projectedExposure > input.maxDailyExposureLimitUsdt;
    const exposureUtilizationPct = Number(
      ((projectedExposure / input.maxDailyExposureLimitUsdt) * 100).toFixed(1),
    );

    const wouldTrigger: string[] = [];
    if (limitExceeded) {
      wouldTrigger.push('DAILY_EXPOSURE_LIMIT_EXCEEDED');
    }
    if (input.consecutiveLosses >= 3) {
      wouldTrigger.push('MAX_CONSECUTIVE_LOSSES_TRIGGERED');
    }

    const maxSafeRemainingUsdt = Math.max(
      0,
      input.maxDailyExposureLimitUsdt - input.currentExposureUsdt,
    );

    return {
      currentExposureUsdt: input.currentExposureUsdt,
      projectedExposureUsdt: projectedExposure,
      exposureUtilizationPct,
      limitExceeded,
      maxSafeRemainingUsdt,
      wouldTrigger,
      verdict: wouldTrigger.length === 0 ? 'SAFE_TO_EXECUTE' : 'REQUIRES_REDUCTION',
    };
  },
};
