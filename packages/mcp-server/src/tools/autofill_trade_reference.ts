import { computeAutofillTradePrice, nd } from '../core/index.js';
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
      // Propagated from the core, not reconstructed here: a caller must be able
      // to see that no order price exists before it reads one.
      actionable: result.actionable,
      unavailableReason: result.unavailableReason,
      expectedSource: result.expectedSource,
      // `suggestedPrice` and `referenceMidRate` are `number | null`, and this
      // used to call `.toFixed(2)` on both unconditionally — an order price
      // without a live mid crashed the tool with a TypeError. `nd()` keeps the
      // slot filled and states it is empty. It never substitutes a number,
      // because a price printed next to "no live mid" is an instruction, not an
      // estimate.
      formattedSummary:
        result.suggestedPrice == null
          ? `${result.side} USDT @ N/D VES (Mid: ${nd(result.referenceMidRate)}, Margen: ${result.targetMarginPct}%) · Sin precio de orden: ${result.unavailableReason ?? 'MID_NO_DISPONIBLE'}. Fuente requerida: ${result.expectedSource}.`
          : `${result.side} USDT @ ${result.suggestedPrice.toFixed(2)} VES (Mid: ${nd(result.referenceMidRate)}, Margen: ${result.targetMarginPct}%)`,
    };
  },
};
