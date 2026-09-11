import { describe, it, expect } from 'vitest';
import {
  calculateBcvGap,
  getVenezuelaTimeParts,
  predictBcvIntervention,
  recommendBcvTreasuryAction,
  getBcvMarketIntelligence,
} from './bcv-intervention-predictor';

describe('Predictor del Ciclo de Intervención Cambiaria BCV', () => {
  describe('calculateBcvGap (Análisis de Brecha Oficial vs Paralelo)', () => {
    it('debe clasificar brecha normal (15% a 25%) con valores estándar', () => {
      const res = calculateBcvGap(800.0, 680.0);
      expect(res.gapVes).toBe(120.0);
      expect(res.gapPct).toBe(17.65);
      expect(res.zone).toBe('NORMAL');
    });

    it('debe detectar brecha elevada (>25% hasta 35%) que anticipa intervención', () => {
      const res = calculateBcvGap(850.0, 650.0);
      expect(res.gapPct).toBe(30.77);
      expect(res.zone).toBe('ELEVATED');
    });

    it('debe encender alerta roja ante dispersión crítica (>35%)', () => {
      const res = calculateBcvGap(900.0, 600.0);
      expect(res.gapPct).toBe(50.0);
      expect(res.zone).toBe('CRITICAL_DISPERSION');
    });

    it('debe detectar brecha comprimida (<10%) tras inyección masiva', () => {
      const res = calculateBcvGap(680.0, 640.0);
      expect(res.gapPct).toBe(6.25);
      expect(res.zone).toBe('COMPRESSED');
    });
  });

  describe('predictBcvIntervention & Horario VET (Venezuela UTC-4)', () => {
    it('debe identificar intervención activa en un Lunes a las 10:30 AM VET', () => {
      // 2026-09-14 es Lunes. 10:30 AM VET = 14:30 UTC
      const mondayInterventionDate = new Date(Date.UTC(2026, 8, 14, 14, 30, 0));
      const window = predictBcvIntervention(mondayInterventionDate);

      expect(window.vetDayOfWeek).toBe(1); // Lunes
      expect(window.vetHour).toBe(10);
      expect(window.phase).toBe('INTERVENTION_ACTIVE');
      expect(window.probabilityPct).toBeGreaterThanOrEqual(90);
    });

    it('debe identificar ventana pre-intervención en Lunes a las 06:00 AM VET', () => {
      // 2026-09-14 06:00 VET = 10:00 UTC
      const preInterventionDate = new Date(Date.UTC(2026, 8, 14, 10, 0, 0));
      const window = predictBcvIntervention(preInterventionDate);

      expect(window.phase).toBe('PRE_INTERVENTION_COMPRESSION');
      expect(window.probabilityPct).toBe(80);
      expect(window.hoursUntilIntervention).toBe(3);
    });

    it('debe identificar ventana de rebote post-intervención en Martes a las 11:00 AM VET', () => {
      // 2026-09-15 es Martes. 11:00 VET = 15:00 UTC
      const tuesdayReboundDate = new Date(Date.UTC(2026, 8, 15, 15, 0, 0));
      const window = predictBcvIntervention(tuesdayReboundDate);

      expect(window.vetDayOfWeek).toBe(2); // Martes
      expect(window.phase).toBe('POST_INTERVENTION_REBOUND');
    });
  });

  describe('recommendBcvTreasuryAction (Recomendaciones Tácticas)', () => {
    it('debe recomendar DEFENSIVE_HEDGE ante dispersión crítica independientemente del día', () => {
      const gap = calculateBcvGap(920.0, 600.0); // 53%
      const window = predictBcvIntervention(new Date(Date.UTC(2026, 8, 16, 16, 0, 0))); // Miércoles
      const rec = recommendBcvTreasuryAction(gap, window);

      expect(rec.action).toBe('DEFENSIVE_HEDGE');
      expect(rec.confidencePct).toBeGreaterThanOrEqual(90);
    });

    it('debe recomendar ACCUMULATE_VES_HIGH (vender USDT) en pre-intervención con brecha caliente', () => {
      const gap = calculateBcvGap(820.0, 650.0); // 26%
      const window = predictBcvIntervention(new Date(Date.UTC(2026, 8, 14, 11, 0, 0))); // Lunes 7:00 AM VET
      const rec = recommendBcvTreasuryAction(gap, window);

      expect(rec.action).toBe('ACCUMULATE_VES_HIGH');
      expect(rec.confidencePct).toBe(88);
    });

    it('debe recomendar BUY_USDT_DIP durante la intervención bancaria activa', () => {
      const gap = calculateBcvGap(780.0, 680.0); // 14%
      const window = predictBcvIntervention(new Date(Date.UTC(2026, 8, 14, 15, 0, 0))); // Lunes 11:00 AM VET
      const rec = recommendBcvTreasuryAction(gap, window);

      expect(rec.action).toBe('BUY_USDT_DIP');
      expect(rec.confidencePct).toBe(85);
    });
  });

  describe('getBcvMarketIntelligence (Consolidado)', () => {
    it('debe generar el reporte completo con timestamp y recomendaciones coherentes', () => {
      const intel = getBcvMarketIntelligence(810.0, 675.0);
      expect(intel.gap).toBeDefined();
      expect(intel.window).toBeDefined();
      expect(intel.recommendation).toBeDefined();
      expect(intel.timestamp).toBeDefined();
    });
  });
});
