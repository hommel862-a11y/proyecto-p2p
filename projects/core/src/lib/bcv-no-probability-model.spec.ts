/**
 * El calendario BCV no es un modelo probabilístico.
 *
 * `predictBcvIntervention` emitía 95/85/80/75/40 según el día y la hora. Ningún
 * número detrás: no hay set de entrenamiento, ni base rate, ni backtest, ni
 * histórico de intervenciones. La copia sister en `packages/mcp-server` ya fue
 * corregida a `probabilityPct: null` + `probabilityBasis: 'NO_MODEL'`, y este
 * archivo es la versión que quedó atrás.
 *
 * El daño no es el número en sí —es una heurística razonable— sino que viajaba
 * sin etiqueta al panel de Telegram y al forecaster de volatilidad, donde se lee
 * como "hay 95% de probabilidad de inyección". Un agente que decide timing de
 * tesorería lo toma en serio.
 */

import { describe, expect, it } from 'vitest';
import { predictBcvIntervention } from './bcv-intervention-predictor';

const DIAS: { nombre: string; dow: number; hora: number; esperado: string }[] = [
  { nombre: 'Lunes 10:00 VET (ventana de subasta)', dow: 1, hora: 10, esperado: 'INTERVENTION_ACTIVE' },
  { nombre: 'Jueves 10:00 VET (ventana de subasta)', dow: 4, hora: 10, esperado: 'INTERVENTION_ACTIVE' },
  { nombre: 'Lunes 07:00 VET (pre-ventana)', dow: 1, hora: 7, esperado: 'PRE_INTERVENTION_COMPRESSION' },
  { nombre: 'Domingo 17:00 VET (pre-ventana)', dow: 0, hora: 17, esperado: 'PRE_INTERVENTION_COMPRESSION' },
  { nombre: 'Martes 10:00 VET (post-ventana)', dow: 2, hora: 10, esperado: 'POST_INTERVENTION_REBOUND' },
  { nombre: 'Sábado 10:00 VET (fuera de subasta)', dow: 6, hora: 10, esperado: 'QUIET_ACCUMULATION' },
];

/** Construye un instante UTC que cae en el día/hora VET pedido. VET = UTC-4 fijo. */
function instanteVet(dow: number, horaVet: number): Date {
  // 2026-01-05 fue un lunes (getUTCDay() === 1).
  const base = Date.UTC(2026, 0, 5, horaVet + 4);
  const fecha = new Date(base);
  const delta = (dow - fecha.getUTCDay() + 7) % 7;
  return new Date(base + delta * 86400000);
}

describe('predictBcvIntervention: el calendario no emite probabilidad', () => {
  it('probabilityPct es null en las cuatro fases', () => {
    for (const { nombre, dow, hora, esperado } of DIAS) {
      const w = predictBcvIntervention(instanteVet(dow, hora));
      expect(w.phase, nombre).toBe(esperado);
      expect(w.probabilityPct, nombre).toBeNull();
    }
  });

  it('declara que no hay modelo probabilístico', () => {
    for (const { nombre, dow, hora } of DIAS) {
      const w = predictBcvIntervention(instanteVet(dow, hora));
      expect(w.probabilityBasis, nombre).toBe('NO_MODEL');
    }
  });

  it('no emite 95/85/80/75 en ninguna hora de la semana', () => {
    // Barrido de las 168 horas. Un default inventado reaparece si se reintroduce.
    for (let dow = 0; dow < 7; dow++) {
      for (let hora = 0; hora < 24; hora++) {
        const w = predictBcvIntervention(instanteVet(dow, hora));
        expect(w.probabilityPct, `dow=${dow} hora=${hora}`).toBeNull();
        expect(w.probabilityBasis, `dow=${dow} hora=${hora}`).toBe('NO_MODEL');
      }
    }
  });

  it('el calendario de fases sigue funcionando — eso no es un modelo', () => {
    // La fase es una observación de calendario publicly verificable.
    const lunes = predictBcvIntervention(instanteVet(1, 10));
    const sabado = predictBcvIntervention(instanteVet(6, 10));

    expect(lunes.phase).toBe('INTERVENTION_ACTIVE');
    expect(sabado.phase).toBe('QUIET_ACCUMULATION');
    expect(lunes.hoursUntilIntervention).toBe(0);
  });

  it('no es accionable: no hay modelo detrás de la ventana', () => {
    for (const { nombre, dow, hora } of DIAS) {
      expect(predictBcvIntervention(instanteVet(dow, hora)).actionable, nombre).toBe(false);
    }
  });

  it('la rationale declara la ausencia de modelo', () => {
    const w = predictBcvIntervention(instanteVet(1, 10));
    expect(w.rationale).toMatch(/no hay modelo probabil/i);
  });

  it('sigue declarando la proxima fecha esperada de calendario', () => {
    const w = predictBcvIntervention(instanteVet(1, 10));
    expect(w.nextExpectedIntervention).toBeTruthy();
    expect(w.hoursUntilIntervention).toBe(0);
  });
});
