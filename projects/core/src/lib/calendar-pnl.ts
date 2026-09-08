/**
 * Pure domain logic for P2P Calendar Bitacora and Heatmap Analysis.
 * Aggregates operation ledgers into financial calendar grids with PnL heat levels,
 * cycle counts, and fee breakdowns.
 * Framework-agnostic, deterministic, 0 external dependencies.
 */

import { type Operation } from './log';

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

export interface CalendarDayStat {
  date: string;               // YYYY-MM-DD
  dayOfMonth: number;         // 1-31
  dayOfWeek: number;          // 0 (Sun) - 6 (Sat)
  operationsCount: number;
  buyCount: number;
  sellCount: number;
  completedCycles: number;    // min(buyCount, sellCount)
  volumeUsdt: number;
  pnlVes: number;
  pnlUsdt: number;
  feesVes: number;
  roiPct: number;             // pnl / invested capital
  heatLevel: HeatmapLevel;    // 0: none/idle, 1: low (<0.5%), 2: med (0.5-1%), 3: high (1-1.5%), 4: superstar (>1.5%)
  hasLoss: boolean;
}

export interface CalendarMonthView {
  year: number;
  month: number;              // 1-12
  monthName: string;
  totalDays: number;
  startingDayOfWeek: number;  // 0 (Sun) - 6 (Sat)
  activeTradingDays: number;
  profitableDays: number;
  lossDays: number;
  winRatePct: number;
  totalPnlVes: number;
  totalPnlUsdt: number;
  totalVolumeUsdt: number;
  totalFeesVes: number;
  totalOperations: number;
  totalCycles: number;
  days: (CalendarDayStat | null)[]; // Padded grid (null for days outside the month)
}

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function vesLeg(o: Operation): number {
  return o.type === 'sell'
    ? o.vesAmount > 0
      ? o.vesAmount
      : o.usdtAmount * o.price
    : o.vesAmount;
}

export function buildCalendarMonthView(
  ops: readonly Operation[],
  year: number,
  month: number, // 1 to 12
  referenceRateVes: number = 60.0,
): CalendarMonthView {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstDayOfWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

  const dailyMap = new Map<number, {
    ops: Operation[];
    pnlVes: number;
    volumeUsdt: number;
    feesVes: number;
    buyCount: number;
    sellCount: number;
    buyVesInvested: number;
  }>();

  for (let d = 1; d <= daysInMonth; d++) {
    dailyMap.set(d, {
      ops: [],
      pnlVes: 0,
      volumeUsdt: 0,
      feesVes: 0,
      buyCount: 0,
      sellCount: 0,
      buyVesInvested: 0,
    });
  }

  for (const o of ops) {
    const d = new Date(o.timestamp);
    if (Number.isNaN(d.getTime())) continue;

    const opYear = d.getUTCFullYear();
    const opMonth = d.getUTCMonth() + 1;
    const opDay = d.getUTCDate();

    if (opYear === year && opMonth === month) {
      if (o.type === 'assign') continue;
      const entry = dailyMap.get(opDay);
      if (entry) {
        entry.ops.push(o);
        entry.volumeUsdt += o.usdtAmount;
        entry.feesVes += o.fees;

        const leg = vesLeg(o);
        if (o.type === 'buy') {
          entry.buyCount++;
          entry.buyVesInvested += leg;
          entry.pnlVes -= (leg + o.fees);
        } else {
          entry.sellCount++;
          entry.pnlVes += (leg - o.fees);
        }
      }
    }
  }

  let totalPnlVes = 0;
  let totalPnlUsdt = 0;
  let totalVolumeUsdt = 0;
  let totalFeesVes = 0;
  let totalOperations = 0;
  let totalCycles = 0;
  let activeDays = 0;
  let profitableDays = 0;
  let lossDays = 0;

  const paddedDays: (CalendarDayStat | null)[] = [];

  // Pad beginning of month
  for (let i = 0; i < firstDayOfWeek; i++) {
    paddedDays.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const entry = dailyMap.get(day)!;
    const count = entry.ops.length;
    const completedCycles = Math.min(entry.buyCount, entry.sellCount);

    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const dayDate = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = dayDate.getUTCDay();

    const pnlUsdt = referenceRateVes > 0 ? entry.pnlVes / referenceRateVes : 0;
    const roiPct = entry.buyVesInvested > 0 ? (entry.pnlVes / entry.buyVesInvested) * 100 : 0;

    let heatLevel: HeatmapLevel = 0;
    const hasLoss = count > 0 && entry.pnlVes < 0;

    if (count > 0 && entry.pnlVes >= 0) {
      if (roiPct >= 1.5) heatLevel = 4;
      else if (roiPct >= 1.0) heatLevel = 3;
      else if (roiPct >= 0.5) heatLevel = 2;
      else heatLevel = 1;
    }

    if (count > 0) {
      activeDays++;
      if (entry.pnlVes > 0) profitableDays++;
      else if (entry.pnlVes < 0) lossDays++;

      totalPnlVes += entry.pnlVes;
      totalPnlUsdt += pnlUsdt;
      totalVolumeUsdt += entry.volumeUsdt;
      totalFeesVes += entry.feesVes;
      totalOperations += count;
      totalCycles += completedCycles;
    }

    paddedDays.push({
      date: dateStr,
      dayOfMonth: day,
      dayOfWeek,
      operationsCount: count,
      buyCount: entry.buyCount,
      sellCount: entry.sellCount,
      completedCycles,
      volumeUsdt: entry.volumeUsdt,
      pnlVes: entry.pnlVes,
      pnlUsdt,
      feesVes: entry.feesVes,
      roiPct,
      heatLevel,
      hasLoss,
    });
  }

  const winRatePct = activeDays > 0 ? (profitableDays / activeDays) * 100 : 0;

  return {
    year,
    month,
    monthName: MONTH_NAMES_ES[month - 1] || '',
    totalDays: daysInMonth,
    startingDayOfWeek: firstDayOfWeek,
    activeTradingDays: activeDays,
    profitableDays,
    lossDays,
    winRatePct,
    totalPnlVes,
    totalPnlUsdt,
    totalVolumeUsdt,
    totalFeesVes,
    totalOperations,
    totalCycles,
    days: paddedDays,
  };
}
