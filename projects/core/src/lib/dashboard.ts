/**
 * Pure dashboard aggregation (framework-agnostic).
 * Computes today's KPIs and a 7-day activity summary from the operation ledger.
 * No network, no Angular.
 */

import { type Operation, computeLogSummary, type LogSummary } from './log';

export interface DayActivity {
  /** Date key in `YYYY-MM-DD` format (UTC). */
  date: string;
  /** Number of operations that day. */
  operations: number;
  /** Net PnL in VES for that day. */
  pnlVes: number;
  /** Total USDT volume moved that day. */
  volumeUsdt: number;
}

export interface DashboardSummary {
  /** Summary for today's operations only. */
  today: LogSummary;
  /** Last 7 calendar days of activity (newest first), always 7 entries. */
  week: DayActivity[];
  /** The 3 most recent operations (newest first). */
  recentOps: Operation[];
  /** Total lifetime operation count. */
  totalOps: number;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function utcDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function last7DayKeys(): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  return keys;
}

/** VES moved on the leg, preferring the recorded value, falling back to price×USDT. */
function vesLeg(o: Operation): number {
  return o.type === 'sell' ? (o.vesAmount > 0 ? o.vesAmount : o.usdtAmount * o.price) : o.vesAmount;
}

/**
 * Aggregate the full operation ledger into a dashboard summary.
 * Pure and deterministic for a given `now` date.
 */
export function computeDashboard(ops: readonly Operation[]): DashboardSummary {
  const safe = Array.isArray(ops) ? ops : [];
  const today = todayKey();

  // Today's operations
  const todayOps = safe.filter((o) => utcDateKey(o.timestamp) === today);
  const todaySummary = computeLogSummary(todayOps);

  // 7-day activity
  const dayMap = new Map<string, { operations: number; pnlVes: number; volumeUsdt: number }>();
  for (const o of safe) {
    const key = utcDateKey(o.timestamp);
    const acc = dayMap.get(key) ?? { operations: 0, pnlVes: 0, volumeUsdt: 0 };
    acc.operations += 1;
    const ves = vesLeg(o);
    acc.pnlVes += (o.type === 'sell' ? ves : -ves) - o.fees;
    acc.volumeUsdt += o.usdtAmount;
    dayMap.set(key, acc);
  }

  const week: DayActivity[] = last7DayKeys().map((date) => {
    const acc = dayMap.get(date);
    return {
      date,
      operations: acc?.operations ?? 0,
      pnlVes: acc?.pnlVes ?? 0,
      volumeUsdt: acc?.volumeUsdt ?? 0,
    };
  });

  // Recent operations (newest first, max 3)
  const sorted = [...safe].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const recentOps = sorted.slice(0, 3);

  return {
    today: todaySummary,
    week,
    recentOps,
    totalOps: safe.length,
  };
}
