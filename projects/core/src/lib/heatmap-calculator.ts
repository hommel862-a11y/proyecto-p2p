/**
 * Heatmap Calculator for Microstructure & Spread Seasonality.
 * Computes 24x7 matrix of liquidity, volume, and net spread across hours and days of week.
 */

import { escapeMarkdownV2 } from './telegram-sentinel';

export interface MarketTick {
  timestamp: number;
  buyPrice: number;
  sellPrice: number;
  grossSpreadPct: number;
  netSpreadPct: number;
  bcvRate?: number;
  volumeUsdt?: number;
  payMethod?: string;
}

export interface HeatmapCell {
  dayOfWeek: number; // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  dayName: string;
  hour: number; // 0..23
  sampleCount: number;
  avgNetSpreadPct: number;
  maxNetSpreadPct: number;
  minNetSpreadPct: number;
  goldenSpreadCount: number;
  goldenSpreadRatio: number;
  liquidityScore: number;
  isPeakHour: boolean;
}

export interface HeatmapMatrix {
  cells: HeatmapCell[];
  peakHours: HeatmapCell[];
  deadHours: HeatmapCell[];
  overallAvgNetSpreadPct: number;
  totalSamples: number;
}

export const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/**
 * Computes the 7x24 heatmap matrix from raw market ticks.
 */
export function computeHeatmapMatrix(ticks: MarketTick[]): HeatmapMatrix {
  // Initialize 168 cells (7 days * 24 hours)
  const cellMap = new Map<string, {
    samples: number;
    spreadSum: number;
    maxSpread: number;
    minSpread: number;
    goldenCount: number;
    volumeSum: number;
  }>();

  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      cellMap.set(`${d}-${h}`, {
        samples: 0,
        spreadSum: 0,
        maxSpread: Number.NEGATIVE_INFINITY,
        minSpread: Number.POSITIVE_INFINITY,
        goldenCount: 0,
        volumeSum: 0,
      });
    }
  }

  let totalValidSamples = 0;
  let totalSpreadSum = 0;

  for (const tick of ticks) {
    if (!Number.isFinite(tick.timestamp) || !Number.isFinite(tick.netSpreadPct)) {
      continue;
    }

    const date = new Date(tick.timestamp);
    const day = date.getDay();
    const hour = date.getHours();
    const key = `${day}-${hour}`;

    const cell = cellMap.get(key);
    if (!cell) continue;

    cell.samples++;
    cell.spreadSum += tick.netSpreadPct;
    if (tick.netSpreadPct > cell.maxSpread) cell.maxSpread = tick.netSpreadPct;
    if (tick.netSpreadPct < cell.minSpread) cell.minSpread = tick.netSpreadPct;
    if (tick.netSpreadPct >= 0.5) cell.goldenCount++;
    if (tick.volumeUsdt && Number.isFinite(tick.volumeUsdt)) {
      cell.volumeSum += tick.volumeUsdt;
    }

    totalValidSamples++;
    totalSpreadSum += tick.netSpreadPct;
  }

  const cells: HeatmapCell[] = [];

  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const data = cellMap.get(`${d}-${h}`)!;
      const samples = data.samples;
      const avgSpread = samples > 0 ? data.spreadSum / samples : 0;
      const goldenRatio = samples > 0 ? data.goldenCount / samples : 0;
      const liquidityScore = Math.min(100, Math.round(samples * 5 + (data.volumeSum / 1000) * 2));
      const isPeak = samples >= 3 && avgSpread >= 1.0 && goldenRatio >= 0.7;

      cells.push({
        dayOfWeek: d,
        dayName: DAY_NAMES[d],
        hour: h,
        sampleCount: samples,
        avgNetSpreadPct: Number(avgSpread.toFixed(2)),
        maxNetSpreadPct: samples > 0 ? Number(data.maxSpread.toFixed(2)) : 0,
        minNetSpreadPct: samples > 0 ? Number(data.minSpread.toFixed(2)) : 0,
        goldenSpreadCount: data.goldenCount,
        goldenSpreadRatio: Number(goldenRatio.toFixed(2)),
        liquidityScore,
        isPeakHour: isPeak,
      });
    }
  }

  const populatedCells = cells.filter((c) => c.sampleCount > 0);
  const peakHours = [...populatedCells]
    .sort((a, b) => b.avgNetSpreadPct - a.avgNetSpreadPct)
    .slice(0, 5);

  const deadHours = [...populatedCells]
    .sort((a, b) => a.avgNetSpreadPct - b.avgNetSpreadPct)
    .slice(0, 5);

  const overallAvg = totalValidSamples > 0 ? totalSpreadSum / totalValidSamples : 0;

  return {
    cells,
    peakHours,
    deadHours,
    overallAvgNetSpreadPct: Number(overallAvg.toFixed(2)),
    totalSamples: totalValidSamples,
  };
}

/**
 * Formats Heatmap analysis into rich Telegram MarkdownV2 text.
 */
export function formatHeatmapTelegramMessage(matrix: HeatmapMatrix): string {
  if (matrix.totalSamples === 0) {
    return (
      `📊 *MAPA DE CALOR DE LIQUIDEZ Y SPREAD \\(24/7\\)*\n\n` +
      `_Aún no hay suficientes ticks históricos registrados en el Data Lake del VPS para construir la matriz_\\.\n` +
      `_El servidor está capturando datos de microestructura de forma continua cada 15s_\\.`
    );
  }

  let text =
    `🔥 *MAPA DE CALOR: MEJORES HORARIOS DE ARBITRAJE*\n\n` +
    `• *Muestras Analizadas:* \`${matrix.totalSamples}\` ticks\n` +
    `• *Spread Neto Promedio Global:* \`${matrix.overallAvgNetSpreadPct.toFixed(2)}%\`\n\n` +
    `🏆 *VENTANAS HORARIAS DE MÁXIMO RENDIMIENTO \\(TOP 5\\)*\n`;

  if (matrix.peakHours.length === 0) {
    text += `_No se encontraron ventanas con más de 3 muestras aún_\\.\n`;
  } else {
    for (let i = 0; i < matrix.peakHours.length; i++) {
      const p = matrix.peakHours[i];
      const hourStr = `${String(p.hour).padStart(2, '0')}:00`;
      const nextHourStr = `${String((p.hour + 1) % 24).padStart(2, '0')}:00`;
      text += `*${i + 1}\\.* 🟢 *${escapeMarkdownV2(p.dayName)} \`${hourStr}–${nextHourStr}\`*: Spread \`${p.avgNetSpreadPct.toFixed(2)}%\` neto \\(Máx \`${p.maxNetSpreadPct.toFixed(2)}%\`\\)\n`;
    }
  }

  text += `\n❄️ *HORARIOS DE BAJA LIQUIDEZ / SPREAD COMPRIMIDO*\n`;
  if (matrix.deadHours.length > 0) {
    for (const d of matrix.deadHours.slice(0, 3)) {
      const hourStr = `${String(d.hour).padStart(2, '0')}:00`;
      const nextHourStr = `${String((d.hour + 1) % 24).padStart(2, '0')}:00`;
      text += `• 🔴 *${escapeMarkdownV2(d.dayName)} \`${hourStr}–${nextHourStr}\`*: Spread \`${d.avgNetSpreadPct.toFixed(2)}%\` neto\n`;
    }
  }

  text += `\n💡 _Consejo Táctico: Concentrá tus anuncios de venta en las ventanas verdes para acelerar la rotación del capital y maximizar el Sharpe Ratio diario\\._`;

  return text;
}
