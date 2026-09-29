import {
  calculateTreasuryYieldAllocation,
  type TreasuryYieldParams,
} from '../core/index.js';
import {
  OptimizeTreasuryIdleYieldInputSchema,
  type OptimizeTreasuryIdleYieldInput,
} from '../schemas/index.js';

export const optimizeTreasuryIdleYieldTool = {
  name: 'optimize_treasury_idle_yield',
  description:
    'Optimiza el barrido de capital ocioso en USDT hacia bóvedas de rendimiento flexible (Binance Simple Earn) durante horas nocturnas o de baja actividad.',
  inputSchema: OptimizeTreasuryIdleYieldInputSchema,
  execute: (input: OptimizeTreasuryIdleYieldInput) => {
    const plan = calculateTreasuryYieldAllocation({
      totalUsdtInventory: input.totalUsdtInventory,
      currentlyCommittedUsdt: input.currentlyCommittedUsdt,
      marketVelocity: input.marketVelocity,
      flexibleApyPct: input.flexibleApyPct,
      minimumSafetyBufferUsd: input.minimumSafetyBufferUsd,
    });

    return {
      success: true,
      plan,
      evaluatedAt: new Date().toISOString(),
    };
  },
};
