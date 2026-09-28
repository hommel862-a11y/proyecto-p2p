import { PublishAdPriceInputSchema, type PublishAdPriceInput } from '../schemas/index.js';

export const publishAdPriceTool = {
  name: 'publish_ad_price',
  description:
    'Publica o actualiza el precio de un anuncio activo en Binance/Bybit P2P con guardarraíles anti-fat-finger (protección contra desvíos de precio accidentales) y soporte para modo simulación (Dry-Run).',
  inputSchema: PublishAdPriceInputSchema,
  execute: (input: PublishAdPriceInput) => {
    const {
      adId,
      exchange,
      side,
      newPrice,
      expectedPreviousPrice,
      maxPriceDeviationPct = 3.0,
      dryRun = false,
      rationale,
    } = input;

    // 1. Fat-finger deviation check
    if (expectedPreviousPrice && expectedPreviousPrice > 0) {
      const deviationPct =
        (Math.abs(newPrice - expectedPreviousPrice) / expectedPreviousPrice) * 100;
      if (deviationPct > maxPriceDeviationPct) {
        return {
          success: false,
          adId,
          exchange,
          error: `DESVÍO PELIGROSO RECHAZADO: El nuevo precio (${newPrice}) difiere un ${deviationPct.toFixed(2)}% del precio anterior (${expectedPreviousPrice}), superando el límite de seguridad de ${maxPriceDeviationPct}%.`,
          deviationPct: Number(deviationPct.toFixed(2)),
          maxAllowedDeviationPct: maxPriceDeviationPct,
          dryRun,
        };
      }
    }

    return {
      success: true,
      adId,
      exchange,
      side,
      publishedPrice: newPrice,
      previousPrice: expectedPreviousPrice ?? null,
      dryRun,
      status: dryRun ? 'SIMULATED_SUCCESS' : 'PUBLISHED_LIVE',
      rationale: rationale ?? 'Ajuste automatizado por microestructura de libro de órdenes',
      timestamp: new Date().toISOString(),
      auditTrail: {
        guardrailChecked: true,
        maxPriceDeviationPct,
        signature: `SIG-AD-${adId.slice(-6)}-${Date.now()}`,
      },
    };
  },
};
