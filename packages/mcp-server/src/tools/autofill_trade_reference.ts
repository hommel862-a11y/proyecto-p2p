import { computeAutofillTradePrice } from '../core/index.js';
import {
  AutofillTradeReferenceInputSchema,
  type AutofillTradeReferenceInput,
} from '../schemas/index.js';

export const autofillTradeReferenceTool = {
  name: 'autofill_trade_reference',
  description:
    'Calcula el precio de referencia sugerido y optimizado para una nueva orden P2P (BUY/SELL) en función del punto medio del mercado y margen objetivo.',
  inputSchema: AutofillTradeReferenceInputSchema,
  execute: (input: AutofillTradeReferenceInput) => {
    const result = computeAutofillTradePrice(input.side, input.targetMarginPct, input.fallbackRate);

    return {
      side: result.side,
      referenceMidRate: result.referenceMidRate,
      targetMarginPct: result.targetMarginPct,
      suggestedPrice: result.suggestedPrice,
      marginVes: result.marginVes,
      executionAdvice: result.executionAdvice,
      formattedSummary: `${result.side} USDT @ ${result.suggestedPrice.toFixed(2)} VES (Mid: ${result.referenceMidRate.toFixed(2)}, Margen: ${result.targetMarginPct}%)`,
    };
  },
};
