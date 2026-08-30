import { type Operation } from './log';

export type PeriodKind = 'day' | 'month' | 'quarter';

export interface PeriodStat {
  /** Bucket key: `YYYY-MM-DD` (day), `YYYY-MM` (month), or `YYYY-Qn` (quarter). UTC. */
  period: string;
  operations: number;
  /** Profit/loss for the bucket in VES (sell proceeds − buy cost − fees). */
  pnlVes: number;
  /** PnL converted to USDT using the bucket's volume-weighted average price. */
  pnlUsdt: number;
  /** Total USDT moved in the bucket (both buy and sell legs). */
  volumeUsdt: number;
  /** Fees paid in the bucket (VES). */
  fees: number;
}

export interface StatsSummary {
  daily: PeriodStat[];
  monthly: PeriodStat[];
  quarterly: PeriodStat[];
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function periodKey(iso: string, kind: PeriodKind): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (kind === 'day') return `${y}-${pad(m)}-${pad(day)}`;
  if (kind === 'month') return `${y}-${pad(m)}`;
  const q = Math.floor((m - 1) / 3) + 1;
  return `${y}-Q${q}`;
}

/** VES moved on the leg, preferring the recorded value, falling back to price×USDT. */
function vesLeg(o: Operation): number {
  return o.type === 'sell'
    ? o.vesAmount > 0
      ? o.vesAmount
      : o.usdtAmount * o.price
    : o.vesAmount;
}

function aggregate(ops: Operation[], kind: PeriodKind): PeriodStat[] {
  const map = new Map<
    string,
    { operations: number; pnlVes: number; volumeUsdt: number; fees: number; vesSum: number; usdtSum: number }
  >();
  for (const o of ops) {
    const key = periodKey(o.timestamp, kind);
    const acc =
      map.get(key) ?? { operations: 0, pnlVes: 0, volumeUsdt: 0, fees: 0, vesSum: 0, usdtSum: 0 };
    acc.operations += 1;
    acc.fees += o.fees;
    acc.volumeUsdt += o.usdtAmount;
    const ves = vesLeg(o);
    acc.pnlVes += (o.type === 'sell' ? ves : -ves) - o.fees;
    acc.vesSum += ves;
    acc.usdtSum += o.usdtAmount;
    map.set(key, acc);
  }
  return Array.from(map.entries())
    .map(([period, a]) => {
      const avgPrice = a.usdtSum > 0 ? a.vesSum / a.usdtSum : 0;
      return {
        period,
        operations: a.operations,
        pnlVes: a.pnlVes,
        pnlUsdt: avgPrice > 0 ? a.pnlVes / avgPrice : 0,
        volumeUsdt: a.volumeUsdt,
        fees: a.fees,
      };
    })
    .sort((x, y) => y.period.localeCompare(x.period));
}

/**
 * Aggregate an operation ledger into day / month / quarter buckets.
 * @param ops operation ledger (records with an ISO `timestamp`). Non-arrays are treated as empty.
 */
export function computeStats(ops: Operation[]): StatsSummary {
  const safe = Array.isArray(ops) ? ops : [];
  return {
    daily: aggregate(safe, 'day'),
    monthly: aggregate(safe, 'month'),
    quarterly: aggregate(safe, 'quarter'),
  };
}
