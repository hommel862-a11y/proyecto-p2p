/**
 * Pure PnP operation-log aggregation (framework-agnostic).
 * Running PnL / capital / exposure / discipline-streak math for the operation ledger.
 * No network, no Angular.
 */

export interface Operation {
  /** stable id (uuid from the recording shell). */
  id: string;
  /** ISO timestamp of when the operation was recorded. */
  timestamp: string;
  /** buy (spend VES to acquire USDT) or sell (receive VES for USDT). */
  type: 'buy' | 'sell';
  /** trading pair the operation belongs to. */
  pair: 'USDT' | 'EUR';
  /** VES spent/received on the VES leg. */
  vesAmount: number;
  /** USDT amount moved on the USDT leg. */
  usdtAmount: number;
  /** observed price (VES per USDT) for this operation. */
  price: number;
  /** counterparty / merchant note. */
  merchantNote: string;
  /** fees paid in VES. */
  fees: number;
  /** free-form notes. */
  notes: string;
  /** whether the operator tagged this operation as error-free (discipline ladder). */
  errorFree: boolean;
  /** operation cycle duration in milliseconds (if timed). */
  durationMs?: number;
  /** trading session id this operation was executed under (if any). */
  sessionId?: string;
  /** bank account id used for local fiat settlement (if assigned). */
  bankAccountId?: string;
  /** counterparty CRM identifier (if matched). */
  counterpartyId?: string;
  /** bank account holder name observed on the transfer receipt (for anti-triangulation audit). */
  payerName?: string;
}

export interface LogSummary {
  /** number of recorded operations. */
  operations: number;
  /** gross profit/loss in VES = Σ sell proceeds − Σ buy cost − Σ fees. */
  pnlVes: number;
  /** PnL expressed in USDT using a volume-weighted average price. */
  pnlUsdt: number;
  /** net VES tied up = Σ buy VES − Σ sell proceeds. Negative means VES freed. */
  capitalDeployed: number;
  /** net USDT held = Σ buy USDT − Σ sell USDT. */
  exposure: number;
  /** trailing count of consecutive error-free operations. */
  zeroErrorStreak: number;
}

/**
 * Aggregate a list of operations into a running summary.
 * Pure and deterministic: same input always yields the same summary.
 */
export function computeLogSummary(ops: readonly Operation[]): LogSummary {
  let buyVes = 0;
  let sellVes = 0;
  let buyUsdt = 0;
  let sellUsdt = 0;
  let fees = 0;

  for (const o of ops) {
    if (o.type === 'buy') {
      buyVes += o.vesAmount;
      buyUsdt += o.usdtAmount;
    } else {
      // Prefer the recorded VES leg when present; fall back to price×USDT for legacy entries.
      sellVes += o.vesAmount > 0 ? o.vesAmount : o.usdtAmount * o.price;
      sellUsdt += o.usdtAmount;
    }
    fees += o.fees;
  }

  const pnlVes = sellVes - buyVes - fees;
  const denomUsdt = buyUsdt + sellUsdt;
  const weightedAvg = denomUsdt > 0 ? (buyVes + sellVes) / denomUsdt : 0;
  const pnlUsdt = weightedAvg > 0 ? pnlVes / weightedAvg : 0;

  const exposure = buyUsdt - sellUsdt;
  const capitalDeployed = buyVes - sellVes;

  let zeroErrorStreak = 0;
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i].errorFree) zeroErrorStreak++;
    else break;
  }

  return {
    operations: ops.length,
    pnlVes,
    pnlUsdt,
    capitalDeployed,
    exposure,
    zeroErrorStreak,
  };
}
