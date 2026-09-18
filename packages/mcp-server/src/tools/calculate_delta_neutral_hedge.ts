import {
  CalculateDeltaNeutralHedgeInputSchema,
  type CalculateDeltaNeutralHedgeInput,
} from '../schemas/index.js';

export const calculateDeltaNeutralHedgeTool = {
  name: 'calculate_delta_neutral_hedge',
  description:
    'Calcula la posición corta sintética necesaria para congelar el valor USD del capital retenido en bolívares (VES).',
  inputSchema: CalculateDeltaNeutralHedgeInputSchema,
  execute: (input: CalculateDeltaNeutralHedgeInput) => {
    const usdtValueEquivalent = input.vesBalance / input.usdtReferencePrice;
    const requiredHedgeUsdt = (usdtValueEquivalent * input.targetHedgePct) / 100;

    // Projected devaluation loss if VES drops 5% without hedge
    const unhedgedLoss5PctUsd = usdtValueEquivalent * 0.05;

    return {
      vesBalance: input.vesBalance,
      usdtReferencePrice: input.usdtReferencePrice,
      usdtValueEquivalent: Number(usdtValueEquivalent.toFixed(2)),
      targetHedgePct: input.targetHedgePct,
      requiredShortHedgeUsdt: Number(requiredHedgeUsdt.toFixed(2)),
      projectedLossIfUnhedged5PctUsd: Number(unhedgedLoss5PctUsd.toFixed(2)),
      recommendedInstrument: 'Perpetual Futures 1x Short o Aave Variable Debt',
      humanInTheLoopNotice:
        'Requiere confirmación explícita del operador antes de abrir posición en protocolo de derivados.',
    };
  },
};
