/**
 * Defaults inventados que sobreviven en el dispatcher de skills.
 *
 * Estos casos comparten una forma: el wrapper de `agent-skills.ts` rellena con un
 * número una medición que el llamador no pasó, y el motor puro —que sí es honesto—
 * no tiene forma de saber que ese número no se midió. El motor sólo ve el 0.
 */

import { describe, expect, it } from 'vitest';
import { executeFinancialSkill } from './agent-skills';

describe('Defaults de medicion inventados en el dispatcher', () => {
  describe('calculate_maker_fill_probability_markov', () => {
    it('sin argumentos NO devuelve 99.9% de llenado inmediato', () => {
      // La cadena completa del bug, antes del fix:
      //   queuePositionIndex        = 0     -> urgencyState = 'INSTANT_FILL_PROBABLE'
      //   queueAheadVolumeUsdt      = 0     -> effectiveQueue = 0
      //   recentFillVelocityPerMin   = 100   -> lambda = 100 / max(10, 0) = 10
      //   rawProb = (1 - e^(-10*15)) * 100 ~ 100 -> recortado a 99.9%
      // Es decir: una skill de probabilidad de llenado que, sin una sola medicion,
      // afirma que tu orden maker se llena casi con certeza de inmediato.
      const res = executeFinancialSkill('calculate_maker_fill_probability_markov', {});

      expect(res.success).toBe(false);
      expect((res as any).data).toBeNull();

      // Ninguna afirmación de llenado puede sobrevivir a la negativa.
      const serializado = JSON.stringify(res);
      expect(serializado).not.toContain('99.9');
      expect(serializado).not.toContain('INSTANT_FILL_PROBABLE');
    });

    it('exige la posicion en la cola medida', () => {
      const sinPosicion = executeFinancialSkill('calculate_maker_fill_probability_markov', {
        queueAheadVolumeUsdt: 1000,
        recentFillVelocityPerMinuteUsdt: 100,
      });

      expect(sinPosicion.success).toBe(false);
      expect((sinPosicion as any).unavailableReason).toContain('queuePositionIndex');
    });

    it('exige el volumen adelante de la cola medido', () => {
      const sinVolumen = executeFinancialSkill('calculate_maker_fill_probability_markov', {
        queuePositionIndex: 3,
        recentFillVelocityPerMinuteUsdt: 100,
      });

      expect(sinVolumen.success).toBe(false);
      expect((sinVolumen as any).unavailableReason).toContain('queueAheadVolumeUsdt');
    });

    it('exige la velocidad de llenado reciente medida', () => {
      // 100 USDT/min es una velocidad inventada. Es el término que decide si la
      // cola avanza, asi que un default aqui es un pronostico disfrazado de dato.
      const sinVelocidad = executeFinancialSkill('calculate_maker_fill_probability_markov', {
        queuePositionIndex: 3,
        queueAheadVolumeUsdt: 1000,
      });

      expect(sinVelocidad.success).toBe(false);
      expect((sinVelocidad as any).unavailableReason).toContain('recentFillVelocityPerMinuteUsdt');
    });

    it('una cola realmente vacia se distingue de una cola no medida', () => {
      // La distincion que el `|| 0` borraba: 0 volumen adelante con velocidad
      // real es un hecho del libro y SI debe calcular probability 99.9%.
      const colaVaciaReal = executeFinancialSkill('calculate_maker_fill_probability_markov', {
        queuePositionIndex: 0,
        queueAheadVolumeUsdt: 0,
        recentFillVelocityPerMinuteUsdt: 100,
      });

      expect(colaVaciaReal.success).toBe(true);
      expect((colaVaciaReal.data as any).fillProbabilityInHorizonPct).toBe(99.9);
      expect((colaVaciaReal.data as any).urgencyState).toBe('INSTANT_FILL_PROBABLE');
    });
  });

  describe('calculate_optimal_spread_avellaneda', () => {
    it('exige el horizonte restante de sesion medido', () => {
      // Sus cuatro vecinos usan requiredNumber con su fuente nombrada; este usa
      // `?? 1.0`, es decir "sesion completa". El default es optimista y silencioso.
      const res = executeFinancialSkill('calculate_optimal_spread_avellaneda', {
        midPrice: 85,
        currentInventoryUsdt: 1000,
        targetInventoryUsdt: 0,
        volatilityDaily: 0.02,
      });

      expect(res.success).toBe(false);
      expect((res as any).unavailableReason).toContain('timeRemainingFraction');
    });

    it('un horizonte restante de 1.0 explicito se respeta', () => {
      // 1.0 sigue siendo un valor valido cuando el operador lo declara.
      const res = executeFinancialSkill('calculate_optimal_spread_avellaneda', {
        midPrice: 85,
        currentInventoryUsdt: 1000,
        targetInventoryUsdt: 0,
        volatilityDaily: 0.02,
        timeRemainingFraction: 1.0,
      });

      expect(res.success).toBe(true);
    });
  });

  describe('audit_distressed_liquidity_sniper', () => {
    it('exige el precio de mercado justo medido', () => {
      // `|| 0` no fabricaba oportunidades (el motor corta con fair <= 0), pero
      // publicaba `fairMarketRate: 0` como si fuera el precio justo y devolvia
      // cero oportunidades sin decir por que. Ausencia declarada, no silencio.
      const res = executeFinancialSkill('audit_distressed_liquidity_sniper', {
        ads: [
          {
            advId: 'AD-1',
            merchantName: 'TraderFast',
            price: 84.5,
            availableAmountCrypto: 500,
            minLimitFiat: 1000,
            maxLimitFiat: 40000,
            paymentMethods: ['Banesco'],
            orderType: 'SELL',
          },
        ],
        side: 'SELL',
      });

      expect(res.success).toBe(false);
      expect((res as any).unavailableReason).toContain('fairMarketRate');
    });

    it('no publica fairMarketRate 0 como si fuera una medicion', () => {
      const res = executeFinancialSkill('audit_distressed_liquidity_sniper', { side: 'SELL' });

      expect(JSON.stringify(res)).not.toMatch(/"fairMarketRate":0/);
    });
  });
});
