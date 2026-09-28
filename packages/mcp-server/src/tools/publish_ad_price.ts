import { PublishAdPriceInputSchema, type PublishAdPriceInput } from '../schemas/index.js';

/**
 * ── Lo que esta herramienta NO es ───────────────────────────────────────────
 *
 * `execute` es una FUNCIÓN PURA. No abre socket, no pide credenciales, no toca
 * la API de merchant de Binance: evalúa el guardarraíl anti-fat-finger y
 * devuelve un objeto. El único endpoint de Binance del proyecto es
 * `adv/search` (lectura, en `binance-p2p.service.ts`).
 *
 * El riesgo de este archivo no es que falle, es que SUENE a que escribe. Por eso
 * la respuesta declara `merchantConfirmed: false` y `merchantRef: null`: sin eso,
 * un consumidor que llegue a mirar el status o la firma hereda la afirmación de
 * que hubo una publicación real, y si eso aterriza en el journal de decisiones
 * el registro afirma algo que nunca pasó.
 *
 * Cuando exista una implementación real contra la API de merchant, el trabajo
 * empieza por la capa de escritura, no por acá adentro: este archivo pasa a ser
 * solo el guardarraíl, y la referencia real la trae quien escribe, no un
 * `Date.now()`.
 */
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
      // `status` describe lo que PASÓ, no lo que el operador pidió. Antes
      // devolvía `PUBLISHED_LIVE` con `dryRun: false` sobre una función que no
      // abre ningún socket: un consumidor podía journalizar "Binance confirmó
      // la publicación" de una llamada que nunca salió de la máquina.
      status: dryRun ? 'SIMULATED_SUCCESS' : 'NOT_PUBLISHED_NO_MERCHANT_API',
      merchantConfirmed: false,
      rationale: rationale ?? 'Ajuste automatizado por microestructura de libro de órdenes',
      timestamp: new Date().toISOString(),
      auditTrail: {
        guardrailChecked: true,
        maxPriceDeviationPct,
        signature: `SIG-AD-${adId.slice(-6)}-${Date.now()}`,
        // El recibo de arriba se genera acá, con el reloj de esta máquina. Se
        // sigue devolviendo porque hay consumidores que lo leen, pero declara su
        // origen para que nadie pueda tomarlo por un comprobante del exchange.
        signatureOrigin: 'LOCAL_FABRICATION',
        merchantRef: null,
      },
    };
  },
};
