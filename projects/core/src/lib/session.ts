/**
 * Pure trading session lifecycle and analytics domain logic (framework-agnostic).
 * Computes workshift duration, session PnL, turnover velocity, and operational performance.
 * No network, no Angular.
 */

import { type Operation, computeLogSummary } from './log';

export interface TradingSession {
  /** Unique identifier for the session (UUID). */
  id: string;
  /** ISO timestamp when the session was opened. */
  startTime: string;
  /** ISO timestamp when the session was closed (undefined if active). */
  endTime?: string;
  /** Optional target number of operations planned for this session. */
  targetOps?: number;
  /** Opening or closing notes/observations by the operator. */
  notes?: string;
  /** Operator's self-discipline rating from 1 to 5. */
  disciplineRating?: number;
}

export interface SessionSummary {
  /** The session definition. */
  session: TradingSession;
  /** Whether the session is currently active/open. */
  isOpen: boolean;
  /** Total duration of the session in milliseconds. */
  durationMs: number;
  /** Number of operations executed in this session. */
  operationsCount: number;
  /** Net profit/loss in VES for the session. */
  pnlVes: number;
  /** Net profit/loss in USDT for the session. */
  pnlUsdt: number;
  /** Total USDT volume moved during this session. */
  volumeUsdt: number;
  /** Average duration of operations that had timer tracking (in ms). 0 if none. */
  avgOpDurationMs: number;
  /** Operational turnover velocity (operations executed per hour). */
  turnoverRatePerHour: number;
}

/**
 * Filter operations that belong to a specific session.
 * Matches by explicit `sessionId` first; falls back to timestamp window.
 */
export function getOperationsForSession(
  session: TradingSession,
  allOps: readonly Operation[],
): Operation[] {
  const startMs = new Date(session.startTime).getTime();
  const endMs = session.endTime ? new Date(session.endTime).getTime() : Infinity;

  return allOps.filter((o) => {
    if (o.sessionId) {
      return o.sessionId === session.id;
    }
    const opMs = new Date(o.timestamp).getTime();
    return opMs >= startMs && opMs <= endMs;
  });
}

/**
 * Compute the performance summary of a single trading session.
 */
export function computeSessionSummary(
  session: TradingSession,
  allOps: readonly Operation[],
  referenceNowIso = new Date().toISOString(),
): SessionSummary {
  const sessionOps = getOperationsForSession(session, allOps);
  const logSummary = computeLogSummary(sessionOps);

  const startMs = new Date(session.startTime).getTime();
  const endMs = session.endTime
    ? new Date(session.endTime).getTime()
    : new Date(referenceNowIso).getTime();

  const durationMs = Math.max(0, endMs - startMs);
  const durationHours = durationMs / 3_600_000;

  // Compute average duration of operations that tracked durationMs
  const timedOps = sessionOps.filter((o) => typeof o.durationMs === 'number' && o.durationMs > 0);
  const avgOpDurationMs =
    timedOps.length > 0
      ? Math.round(timedOps.reduce((sum, o) => sum + (o.durationMs ?? 0), 0) / timedOps.length)
      : 0;

  // Turnover rate: operations per hour
  const turnoverRatePerHour =
    durationHours > 0 ? Number((sessionOps.length / durationHours).toFixed(2)) : sessionOps.length;

  const volumeUsdt = sessionOps.reduce((sum, o) => sum + o.usdtAmount, 0);

  return {
    session,
    isOpen: !session.endTime,
    durationMs,
    operationsCount: sessionOps.length,
    pnlVes: logSummary.pnlVes,
    pnlUsdt: logSummary.pnlUsdt,
    volumeUsdt,
    avgOpDurationMs,
    turnoverRatePerHour,
  };
}

/**
 * Aggregate a list of sessions with their summaries, ordered by newest start time first.
 */
export function aggregateSessions(
  sessions: readonly TradingSession[],
  allOps: readonly Operation[],
): SessionSummary[] {
  const safe = Array.isArray(sessions) ? sessions : [];
  return safe
    .map((s) => computeSessionSummary(s, allOps))
    .sort(
      (a, b) => new Date(b.session.startTime).getTime() - new Date(a.session.startTime).getTime(),
    );
}
