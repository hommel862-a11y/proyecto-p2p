import { computePortfolioRebalance } from '../core/index.js';
import { RebalanceCapitalAllocationInputSchema, type RebalanceCapitalAllocationInput } from '../schemas/index.js';

export const rebalanceCapitalAllocationTool = {
  name: 'rebalance_capital_allocation',
  description: 'Calcula la distribución óptima de capital entre cuentas bancarias (Banesco, Mercantil, BDV) y exchanges, estructurando reglas anti-pitufeo y órdenes de rebalanceo.',
  inputSchema: RebalanceCapitalAllocationInputSchema,
  execute: (input: RebalanceCapitalAllocationInput) => {
    const plan = computePortfolioRebalance({
      totalCapitalUsdt: input.totalCapitalUsdt,
      referenceRate: input.referenceRate,
      riskMode: input.riskMode,
      hourOfDay: input.hourOfDay,
    });

    return {
      totalCapitalUsdt: plan.totalCapitalUsdt,
      referenceRate: plan.referenceRate,
      riskMode: plan.riskMode,
      allocations: plan.allocations,
      dynamicLimits: plan.dynamicLimits,
      rebalanceOrders: plan.rebalanceOrders,
      advisoryNotice: plan.advisoryNotice,
      activeChannelsCount: plan.allocations.filter((a) => a.category === 'BANK_VES').length,
    };
  },
};
