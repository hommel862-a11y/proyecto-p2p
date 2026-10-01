import { describe, it, expect, vi } from 'vitest';
import { forecastVolatilityWindowTool } from './forecast_volatility_window.js';
import { ForecastVolatilityWindowInputSchema } from '../schemas/index.js';

/**
 * El input schema de `forecast_volatility_window` traía defaults que fabricaban
 * mediciones:
 *
 *   currentSpreadPct: z.number().default(1.2)
 *   askDepthUsdt:     z.number().min(0).default(5000)
 *   bidDepthUsdt:     z.number().min(0).default(4500)
 *
 * Un default en el schema no es un valor por defecto neutro: es un número que el
 * sistema afirma haber medido. Un agente que omita el campo recibía 1.2% de
 * spread, un libro de 5000/4500 USDT y un pronóstico construido sobre ambos.
 *
 * `currentSpreadPct` además estaba **muerto**: el handler nunca lo leía. O sea,
 * el default no sólo fabricaba, además ofrecía un parámetro que el agente podía
 * completar con un spread real y que se descartaba en silencio.
 *
 * Estos tests fijan las dos propiedades: el schema no inventa mediciones, y sin
 * profundidad medida el pronóstico no afirma nada sobre la dinámica del spread.
 */
/**
 * Lunes 10:00 VET = 14:00 UTC. Dentro de la ventana de subasta, que es la única
 * condición bajo la que la herramienta habla de compresión.
 *
 * Sin congelar el reloj, el caso de compresión no se puede probar: fuera de la
 * ventana la rama nunca se alcanza y el test pasa sin haber probado nada.
 */
function enVentanaDeSubasta<T>(cuerpo: () => T): T {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-05T14:00:00.000Z'));
  try {
    return cuerpo();
  } finally {
    vi.useRealTimers();
  }
}

describe('forecast_volatility_window: el schema no inventa mediciones', () => {
  const base = { parallelRate: 88.5, bcvRate: 72.0 };

  it('no rellena currentSpreadPct cuando el agente lo omite', () => {
    const parsed = ForecastVolatilityWindowInputSchema.parse({ ...base });

    expect(parsed).not.toHaveProperty('currentSpreadPct');
    expect((parsed as Record<string, unknown>)['currentSpreadPct']).toBeUndefined();
  });

  it('no rellena profundidad de libro cuando el agente la omite', () => {
    const parsed = ForecastVolatilityWindowInputSchema.parse({ ...base });

    expect(parsed).not.toHaveProperty('askDepthUsdt');
    expect(parsed).not.toHaveProperty('bidDepthUsdt');
  });

  it('sin profundidad medida no se afirma dinámica de spread', () => {
    const out = forecastVolatilityWindowTool.execute({
      parallelRate: 88.5,
      bcvRate: 72.0,
    } as never);

    expect(out.spreadDynamic).toBe('UNAVAILABLE');
    expect(out.unavailableReason).toBe('missing_evidence:bookDepth');
    expect(out.actionable).toBe(false);
  });

  it('dentro de la subasta, profundidad ausente no se lee como "sin compresión"', () => {
    // Este es el daño concreto del default 5000/4500: ratio 1.11, que no baja de
    // 0.8, así que la herramienta decía "sin riesgo de compresión" sobre un libro
    // que nadie había medido. Y lo decía justo en la ventana donde comprimir es
    // lo que te cuesta plata.
    const out = enVentanaDeSubasta(() =>
      forecastVolatilityWindowTool.execute({ parallelRate: 88.5, bcvRate: 72.0 } as never),
    );

    expect(out.isInBcvInterventionWindow).toBe(true);
    expect(out.spreadDynamic).toBe('UNAVAILABLE');
    expect(out.actionable).toBe(false);
    expect(out.depthRatio).toBeNull();
  });

  it('el motivo de ausencia nombra la profundidad, no una tasa', () => {
    const out = forecastVolatilityWindowTool.execute({
      parallelRate: 88.5,
      bcvRate: 72.0,
    } as never);

    expect(out.unavailableReason).not.toMatch(/TASA_NO_DISPONIBLE/);
  });

  it('un depthRatio no medible no se convierte en 1', () => {
    // El handler hacía `bidDepthUsdt > 0 ? ask/bid : 1`. Un bidDepth de 0 (o
    // ausente) producía un ratio "neutro" de 1, que es un número inventado con
    // apariencia de cálculo.
    const out = forecastVolatilityWindowTool.execute({
      parallelRate: 88.5,
      bcvRate: 72.0,
      askDepthUsdt: 0,
      bidDepthUsdt: 0,
    } as never);

    expect(out.spreadDynamic).toBe('UNAVAILABLE');
    expect(out.depthRatio).toBeNull();
  });

  it('con profundidad medida y real, el pronóstico sí se emite', () => {
    const out = enVentanaDeSubasta(() =>
      forecastVolatilityWindowTool.execute({
        parallelRate: 88.5,
        bcvRate: 72.0,
        askDepthUsdt: 100,
        bidDepthUsdt: 5000,
      } as never),
    );

    // ratio 0.02 << 0.8: libro thin y asimétrico, que es lo que sí justifica
    // hablar de compresión.
    expect(out.spreadDynamic).toBe('COMPRESSION_RISK');
    expect(out.actionable).toBe(true);
    expect(out.unavailableReason).toBeNull();
    expect(out.depthRatio).toBeCloseTo(0.02, 4);
  });

  it('una profundidad medida de 0 en ambos lados es ausencia, no "sin riesgo"', () => {
    const out = forecastVolatilityWindowTool.execute({
      parallelRate: 88.5,
      bcvRate: 72.0,
      askDepthUsdt: 0,
      bidDepthUsdt: 0,
    } as never);

    expect(out.spreadDynamic).not.toBe('STABLE');
    expect(out.actionable).toBe(false);
  });

  it('con book profundo y medido, la expansión sí se emite', () => {
    const out = enVentanaDeSubasta(() =>
      forecastVolatilityWindowTool.execute({
        parallelRate: 88.5,
        bcvRate: 72.0,
        askDepthUsdt: 5000,
        bidDepthUsdt: 4500,
      } as never),
    );

    // ratio 1.11: no comprime, y la brecha de 22% sí empuja expansión.
    expect(out.spreadDynamic).toBe('EXPANSION_LIKELY');
    expect(out.actionable).toBe(true);
  });
});
