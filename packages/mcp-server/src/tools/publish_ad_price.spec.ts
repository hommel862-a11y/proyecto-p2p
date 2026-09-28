import { describe, it, expect } from 'vitest';
import { publishAdPriceTool } from './publish_ad_price.js';

/**
 * ── Qué es realmente `execute` ─────────────────────────────────────────────
 *
 * Es una FUNCIÓN PURA. No abre socket, no pide credenciales, no toca la API de
 * merchant de Binance. Evalúa el guardarraíl anti-fat-finger y devuelve un
 * objeto. Eso no lo hace "una implementación pendiente": lo hace un simulador,
 * y su recibo (`SIG-AD-<sufijo del adId>-<Date.now()>`) lo prueba — se genera
 * localmente con `Date.now()`.
 *
 * El riesgo de este archivo no es que falle. Es que SUENA a que escribe: el
 * `status` decía `PUBLISHED_LIVE` con `dryRun: false`, y el `signature` parecía
 * un comprobante del exchange. Un consumidor que leyera eso journalizaría
 * "Binance confirmó la publicación" sobre una llamada que nunca salió de la
 * máquina.
 *
 * Estos tests fijan que la respuesta NO pueda confundirse con una confirmación
 * del merchant, para que el que consume no tenga que saber que esto es un
 * simulador para no mentir.
 */
describe('publish_ad_price — honestidad de la respuesta', () => {
  const baseInput = {
    adId: 'BINANCE-BUY-ADV-01',
    exchange: 'BINANCE_P2P' as const,
    side: 'BUY' as const,
    newPrice: 78.5,
    expectedPreviousPrice: 78.0,
    maxPriceDeviationPct: 3.0,
  };

  describe('con dryRun: false', () => {
    // Este es el caso que mentía: la lista "en vivo" sin haber escrito nada.
    it('NO devuelve PUBLISHED_LIVE: esta función nunca escribe contra Binance', () => {
      const res = publishAdPriceTool.execute({ ...baseInput, dryRun: false });

      expect(res.status).not.toBe('PUBLISHED_LIVE');
      expect(res.status).toBe('NOT_PUBLISHED_NO_MERCHANT_API');
    });

    it('declara que el merchant NO confirmó, aunque el guardarraíl acepte', () => {
      const res = publishAdPriceTool.execute({ ...baseInput, dryRun: false });

      expect(res.merchantConfirmed).toBe(false);
    });

    it('el recibo fabricado queda marcado como local y no como referencia del merchant', () => {
      const res = publishAdPriceTool.execute({ ...baseInput, dryRun: false });

      // El string sigue existiendo — hay consumidores que lo leen — pero ya no
      // puede pasar por un comprobante de Binance: su origen está declarado.
      expect(res.auditTrail.signature).toContain('SIG-AD-');
      expect(res.auditTrail.signatureOrigin).toBe('LOCAL_FABRICATION');
      expect(res.auditTrail.merchantRef).toBeNull();
    });
  });

  describe('con dryRun: true', () => {
    it('dice SIMULATED_SUCCESS y tampoco dice que el merchant confirmó', () => {
      const res = publishAdPriceTool.execute({ ...baseInput, dryRun: true });

      expect(res.status).toBe('SIMULATED_SUCCESS');
      expect(res.merchantConfirmed).toBe(false);
      expect(res.auditTrail.merchantRef).toBeNull();
    });
  });

  it('success:true habla del guardarraíl, no de una escritura happening', () => {
    // Documentado a propósito: `success` significa "el guardarraíl aceptó el
    // precio pedido". Si algún día significara "se publicó", este test es el que
    // hay que romper primero, porque el journal heredaría la mentira.
    const res = publishAdPriceTool.execute({ ...baseInput, dryRun: false });

    expect(res.success).toBe(true);
    expect(res.merchantConfirmed).toBe(false);
  });

  it('el guardarraíl anti-fat-finger sigue rechazando por desvío', () => {
    // Regresión: la única protección real de este archivo es el guardarraíl, y
    // el simulador no puede "arreglarse" quitándosela.
    const res = publishAdPriceTool.execute({
      ...baseInput,
      newPrice: 85.0,
      dryRun: false,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('DESVÍO PELIGROSO RECHAZADO');
    expect(res.deviationPct).toBeGreaterThan(3.0);
  });
});
