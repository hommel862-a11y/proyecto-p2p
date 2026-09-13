import { computeSpread } from '../core/index.js';
import { CalculateSpreadInputSchema, type CalculateSpreadInput } from '../schemas/index.js';

export const calculateSpreadTool = {
  name: 'calculate_spread',
  description: 'Calcula el spread bruto, comisiones deducibles y spread neto porcentual para una operación P2P.',
  inputSchema: CalculateSpreadInputSchema,
  execute: (input: CalculateSpreadInput) => {
    const totalCommissionRate = ((input.makerFeePct || 0) + (input.takerFeePct || 0)) / 100;
    const spread = computeSpread(
      input.buyPrice,
      input.sellPrice,
      100, // Normalized unit ticket of 100 USDT
      'USDT',
      totalCommissionRate,
    );

    const unitSpread = spread.unitSpread;
    const grossSpreadPercent = (unitSpread / input.buyPrice) * 100;
    const netSpreadPercent = ((spread.netGainVes / (input.buyPrice * 100)) * 100);
    const isGolden = netSpreadPercent >= 0.50;

    return {
      unitSpread: Number(unitSpread.toFixed(4)),
      grossSpreadPercent: Number(grossSpreadPercent.toFixed(2)),
      netGainVes: Number(spread.netGainVes.toFixed(2)),
      netSpreadPercent: Number(netSpreadPercent.toFixed(2)),
      isGoldenSpread: isGolden,
      recommendation: isGolden ? 'VIABLE_INSTITUCIONAL' : 'SPREAD_SUB_OPTIMAL',
    };
  },
};
