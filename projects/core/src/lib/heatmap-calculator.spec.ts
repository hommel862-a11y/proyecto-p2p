import { describe, it, expect } from 'vitest';
import {
  computeHeatmapMatrix,
  formatHeatmapTelegramMessage,
  type MarketTick,
} from './heatmap-calculator';

describe('heatmap-calculator: Time-Series & Microstructure Analysis', () => {
  it('inicializa los 168 cuadrantes horarios (7 días x 24 horas)', () => {
    const matrix = computeHeatmapMatrix([]);
    expect(matrix.cells).toHaveLength(168);
    expect(matrix.totalSamples).toBe(0);
    expect(matrix.overallAvgNetSpreadPct).toBe(0);
    expect(matrix.peakHours).toHaveLength(0);
    expect(matrix.deadHours).toHaveLength(0);
  });

  it('calcula métricas de promedio, máximo y ratio de regla de oro correctamente', () => {
    // 2026-10-07 es miércoles (dayOfWeek = 3) a las 14:00
    const sampleDate = new Date('2026-10-07T14:30:00Z').getTime();

    const mockTicks: MarketTick[] = [
      {
        timestamp: sampleDate,
        buyPrice: 84.0,
        sellPrice: 85.5,
        grossSpreadPct: 1.78,
        netSpreadPct: 1.43,
        volumeUsdt: 500,
      },
      {
        timestamp: sampleDate + 60_000,
        buyPrice: 84.1,
        sellPrice: 85.6,
        grossSpreadPct: 1.78,
        netSpreadPct: 1.43,
        volumeUsdt: 1200,
      },
      {
        timestamp: sampleDate + 120_000,
        buyPrice: 84.2,
        sellPrice: 85.8,
        grossSpreadPct: 1.9,
        netSpreadPct: 1.55,
        volumeUsdt: 800,
      },
    ];

    const matrix = computeHeatmapMatrix(mockTicks);
    expect(matrix.totalSamples).toBe(3);
    expect(matrix.overallAvgNetSpreadPct).toBe(1.47);

    const populated = matrix.cells.filter((c) => c.sampleCount > 0);
    expect(populated).toHaveLength(1);
    const cell = populated[0];
    expect(cell.sampleCount).toBe(3);
    expect(cell.avgNetSpreadPct).toBe(1.47);
    expect(cell.maxNetSpreadPct).toBe(1.55);
    expect(cell.minNetSpreadPct).toBe(1.43);
    expect(cell.goldenSpreadCount).toBe(3);
    expect(cell.goldenSpreadRatio).toBe(1.0);
    expect(cell.isPeakHour).toBe(true);
  });

  it('formatea el mensaje de Telegram sin muestras de forma segura', () => {
    const emptyMatrix = computeHeatmapMatrix([]);
    const msg = formatHeatmapTelegramMessage(emptyMatrix);
    expect(msg).toContain('MAPA DE CALOR');
    expect(msg).toContain('Aún no hay suficientes ticks');
  });

  it('formatea el mensaje de Telegram con ranking de ventanas pico', () => {
    const date1 = new Date('2026-10-05T10:00:00Z').getTime();
    const date2 = new Date('2026-10-06T15:00:00Z').getTime();

    const mockTicks: MarketTick[] = [
      { timestamp: date1, buyPrice: 80, sellPrice: 82, grossSpreadPct: 2.5, netSpreadPct: 2.15 },
      { timestamp: date1 + 1000, buyPrice: 80, sellPrice: 82, grossSpreadPct: 2.5, netSpreadPct: 2.15 },
      { timestamp: date1 + 2000, buyPrice: 80, sellPrice: 82, grossSpreadPct: 2.5, netSpreadPct: 2.15 },
      { timestamp: date2, buyPrice: 80, sellPrice: 80.5, grossSpreadPct: 0.62, netSpreadPct: 0.27 },
      { timestamp: date2 + 1000, buyPrice: 80, sellPrice: 80.5, grossSpreadPct: 0.62, netSpreadPct: 0.27 },
      { timestamp: date2 + 2000, buyPrice: 80, sellPrice: 80.5, grossSpreadPct: 0.62, netSpreadPct: 0.27 },
    ];

    const matrix = computeHeatmapMatrix(mockTicks);
    const msg = formatHeatmapTelegramMessage(matrix);

    expect(msg).toContain('VENTANAS HORARIAS DE MÁXIMO RENDIMIENTO');
    expect(msg).toContain('2.15%');
    expect(msg).toContain('HORARIOS DE BAJA LIQUIDEZ');
    expect(msg).toContain('0.27%');
  });
});
