import { describe, it, expect } from 'vitest';
import {
  calculateBcvGap,
  predictBcvIntervention,
  recommendBcvTreasuryAction,
  getBcvMarketIntelligence,
} from './bcv-intervention-predictor';

/**
 * Una brecha que nadie midió no es una brecha de cero.
 *
 * La implementación anterior devolvía `gapPct: 0`, `gapVes: 0` y
 * `zone: 'NORMAL'` cuando una de las dos tasas faltaba o no era positiva. Un 0%
 * de brecha y una zona NORMAL son afirmaciones sobre el mercado, y esa es
 * exactamente la forma que un agente ordena operar: "las condiciones están
 * estables, rotá". Un `0` que significa "no sé" es indistinguible de un `0` que
 * significa "las dos tasas son iguales".
 *
 * Estos tests fijan el contrato de ausencia honesta de la brecha BCV.
 */
describe('BCV — brecha fail-closed', () => {
  describe('calculateBcvGap: tasa ausente o inválida', () => {
    it('no mide brecha cuando falta la tasa paralela', () => {
      const gap = calculateBcvGap(null, 680);

      expect(gap.gapVes).toBeNull();
      expect(gap.gapPct).toBeNull();
      expect(gap.zone).toBe('UNAVAILABLE');
      expect(gap.actionable).toBe(false);
      expect(gap.unavailableReason).toBe('TASA_PARALELA_NO_DISPONIBLE');
    });

    it('no mide brecha cuando falta la tasa BCV', () => {
      const gap = calculateBcvGap(800, null);

      expect(gap.gapVes).toBeNull();
      expect(gap.gapPct).toBeNull();
      expect(gap.zone).toBe('UNAVAILABLE');
      expect(gap.unavailableReason).toBe('TASA_BCV_NO_DISPONIBLE');
    });

    it('no mide brecha cuando faltan ambas tasas', () => {
      const gap = calculateBcvGap(null, null);

      expect(gap.gapVes).toBeNull();
      expect(gap.gapPct).toBeNull();
      expect(gap.zone).toBe('UNAVAILABLE');
    });

    // El dispatcherMention coerce los rates ausentes a 0 antes de llamar, asi que
    // el 0 es la forma en la que la ausencia llega a esta funcion.
    it('rechaza una tasa en cero en lugar de tratarla como medida', () => {
      const gap = calculateBcvGap(0, 680);

      expect(gap.gapPct).toBeNull();
      expect(gap.zone).toBe('UNAVAILABLE');
      expect(gap.unavailableReason).toBe('TASA_PARALELA_NO_DISPONIBLE');
    });

    it('rechaza una tasa BCV en cero', () => {
      const gap = calculateBcvGap(800, 0);

      expect(gap.gapPct).toBeNull();
      expect(gap.zone).toBe('UNAVAILABLE');
      expect(gap.unavailableReason).toBe('TASA_BCV_NO_DISPONIBLE');
    });

    it('rechaza tasas negativas: una tasa negativa es un dato corrupto, no una tasa', () => {
      expect(calculateBcvGap(-800, 680).gapPct).toBeNull();
      expect(calculateBcvGap(800, -680).gapPct).toBeNull();
    });

    it('rechaza tasas no finitas en lugar de propagar NaN o Infinity', () => {
      expect(calculateBcvGap(Number.NaN, 680).gapPct).toBeNull();
      expect(calculateBcvGap(800, Number.NaN).gapPct).toBeNull();
      expect(calculateBcvGap(Number.POSITIVE_INFINITY, 680).gapPct).toBeNull();
    });

    it('conserva la tasa presente para que el operador vea qué se midió', () => {
      const gap = calculateBcvGap(800, null);

      expect(gap.parallelRate).toBe(800);
      expect(gap.bcvRate).toBeNull();
    });
  });

  describe('calculateBcvGap: brecha efectivamente medida', () => {
    it('sigue calculando la brecha cuando ambas tasas son reales', () => {
      const gap = calculateBcvGap(800, 680);

      expect(gap.gapVes).toBe(120);
      expect(gap.gapPct).toBe(17.65);
      expect(gap.zone).toBe('NORMAL');
      expect(gap.actionable).toBe(true);
      expect(gap.unavailableReason).toBeNull();
    });

    it('una brecha medida de 0% es un hecho, no una ausencia', () => {
      // Las dos tasas son iguales y ambas se midieron: la brecha es 0 y NORMAL.
      // Esta es la distincion que un `0` de relleno destroys.
      const gap = calculateBcvGap(680, 680);

      expect(gap.gapPct).toBe(0);
      expect(gap.gapVes).toBe(0);
      expect(gap.zone).toBe('COMPRESSED');
      expect(gap.actionable).toBe(true);
    });
  });

  describe('recommendBcvTreasuryAction: no se opera sobre una brecha desconocida', () => {
    const window = predictBcvIntervention(new Date('2024-06-12T14:00:00Z'));

    it('no ordena rotar cuando la brecha no se midio', () => {
      const gap = calculateBcvGap(0, 0);

      const rec = recommendBcvTreasuryAction(gap, window);

      expect(rec.action).toBe('UNAVAILABLE');
      expect(rec.actionable).toBe(false);
    });

    it('no afirma que las condiciones de mercado estan estables', () => {
      // El fallo original: caia en el branch por defecto y decia "estables".
      const gap = calculateBcvGap(0, 0);

      const rec = recommendBcvTreasuryAction(gap, window);

      expect(rec.rationale).not.toMatch(/estables/i);
      expect(rec.actionLabel).not.toMatch(/estables/i);
    });

    it('no emite ninguna accion operativa: ni ciclo agresivo, ni compra, ni blindaje', () => {
      const gap = calculateBcvGap(null, 680);

      const rec = recommendBcvTreasuryAction(gap, window);

      expect(rec.action).not.toBe('AGGRESSIVE_CYCLE_VES');
      expect(rec.action).not.toBe('BUY_USDT_DIP');
      expect(rec.action).not.toBe('DEFENSIVE_HEDGE');
      expect(rec.action).not.toBe('ACCUMULATE_VES_HIGH');
    });

    it('la ausencia se nombra en la justificacion para que el operador sepa por que', () => {
      const gap = calculateBcvGap(null, 680);

      const rec = recommendBcvTreasuryAction(gap, window);

      expect(rec.rationale).toMatch(/indeterminada/i);
      expect(rec.rationale).toContain('TASA_PARALELA_NO_DISPONIBLE');
    });

    it('sigue recomendando sobre una brecha medida', () => {
      const gap = calculateBcvGap(920, 600); // 53% -> CRITICAL_DISPERSION

      const rec = recommendBcvTreasuryAction(gap, window);

      expect(rec.action).toBe('DEFENSIVE_HEDGE');
      expect(rec.actionable).toBe(true);
    });
  });

  describe('getBcvMarketIntelligence: la ausencia viaja hasta la cima', () => {
    it('no entrega una inteligencia accionable sin medicion', () => {
      const intel = getBcvMarketIntelligence(0, 0, new Date('2024-06-12T14:00:00Z'));

      expect(intel.gap.zone).toBe('UNAVAILABLE');
      expect(intel.recommendation.action).toBe('UNAVAILABLE');
      expect(intel.recommendation.actionable).toBe(false);
    });
  });
});
