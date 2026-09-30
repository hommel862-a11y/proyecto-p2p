/**
 * Binance P2P Fills & Realized Trade Ingestion Engine
 *
 * Implements pure normalization, CSV parsing, metrics computation, and
 * correlation between realized Binance C2C fills and Repricer decisions.
 */

import type { DecisionSide, RepricerDecisionRecord, DecisionOutcome, RecordOutcomeInput } from './decision-journal';

export interface BinanceRawC2cOrder {
  orderNumber: string;
  advNo?: string;
  tradeType: 'BUY' | 'SELL' | string;
  asset?: string;
  fiat?: string;
  amount: string | number;
  totalPrice: string | number;
  unitPrice: string | number;
  orderStatus: 'COMPLETED' | 'CANCELLED' | 'PENDING' | string;
  createTime: number;
  commission?: string | number;
  counterPartNickName?: string;
}

export type BinanceC2cFillStatus = 'COMPLETED' | 'CANCELLED' | 'PENDING' | 'OTHER';

export interface BinanceC2cFill {
  readonly orderNumber: string;
  readonly advNo: string;
  readonly side: DecisionSide;
  readonly asset: string;
  readonly fiat: string;
  readonly filledAmountUsdt: number;
  readonly filledPrice: number;
  readonly totalFiat: number;
  readonly status: BinanceC2cFillStatus;
  readonly createdAt: number;
  readonly commissionUsdt: number;
  readonly counterpartyNickname?: string;
}

export interface FillRealizedMetrics {
  readonly realizedProfitUsdt: number;
  readonly realizedSpreadPct: number;
}

export interface CorrelateFillsOptions {
  readonly fills: readonly BinanceC2cFill[];
  readonly decisions: readonly RepricerDecisionRecord[];
  readonly existingOutcomes: readonly DecisionOutcome[];
  /** Maximum time window in ms to match a decision before the fill (defaults to 2 hours) */
  readonly maxWindowMs?: number;
}

export interface CorrelateFillsResult {
  readonly outcomesToRecord: readonly RecordOutcomeInput[];
  readonly skippedExistingFills: readonly string[];
  readonly unmatchedFills: readonly BinanceC2cFill[];
}

function parseNumberSafe(val: unknown, fallback = 0): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : fallback;
  }
  if (typeof val === 'string') {
    const cleaned = val.replace(/,/g, '').trim();
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : fallback;
  }
  return fallback;
}

function normalizeStatus(statusStr: string): BinanceC2cFillStatus {
  const upper = statusStr.trim().toUpperCase();
  if (upper === 'COMPLETED' || upper === 'COMPLETADO') return 'COMPLETED';
  if (upper === 'CANCELLED' || upper === 'CANCELADO') return 'CANCELLED';
  if (upper === 'PENDING' || upper === 'PENDIENTE') return 'PENDING';
  return 'OTHER';
}

function normalizeSide(sideStr: string): DecisionSide {
  const upper = sideStr.trim().toUpperCase();
  if (upper === 'SELL' || upper === 'VENTA') return 'SELL';
  return 'BUY';
}

/**
 * Normalizes raw API response rows from Binance sapi/v1/c2c/orderMatch/listUserOrderHistory.
 */
export function normalizeBinanceApiOrders(rawOrders: readonly BinanceRawC2cOrder[]): BinanceC2cFill[] {
  return rawOrders.map((raw) => {
    return {
      orderNumber: String(raw.orderNumber).trim(),
      advNo: raw.advNo ? String(raw.advNo).trim() : '',
      side: normalizeSide(raw.tradeType),
      asset: raw.asset?.trim() || 'USDT',
      fiat: raw.fiat?.trim() || 'VES',
      filledAmountUsdt: parseNumberSafe(raw.amount, 0),
      filledPrice: parseNumberSafe(raw.unitPrice, 0),
      totalFiat: parseNumberSafe(raw.totalPrice, 0),
      status: normalizeStatus(raw.orderStatus),
      createdAt: typeof raw.createTime === 'number' ? raw.createTime : Date.now(),
      commissionUsdt: parseNumberSafe(raw.commission, 0),
      counterpartyNickname: raw.counterPartNickName?.trim() || undefined,
    };
  });
}

/**
 * Parses CSV export files downloaded from Binance P2P Web portal.
 * Supports both standard English and Spanish headers.
 */
export function parseBinanceCsvFills(csvContent: string): BinanceC2cFill[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return [];

  // Parse header
  const headerLine = lines[0];
  const headers = splitCsvLine(headerLine).map((h) => h.toLowerCase());

  const colIdx = {
    orderNumber: headers.findIndex((h) => h.includes('order number') || h.includes('orden')),
    side: headers.findIndex((h) => h.includes('order type') || h.includes('tipo de orden')),
    asset: headers.findIndex((h) => h.includes('asset') || h.includes('criptomoneda')),
    fiat: headers.findIndex((h) => h.includes('fiat') || h.includes('moneda fiat')),
    totalPrice: headers.findIndex((h) => h.includes('total price') || h.includes('precio total')),
    unitPrice: headers.findIndex((h) => h.includes('unit price') || h.includes('precio unitario')),
    amount: headers.findIndex((h) => h.includes('quantity') || h.includes('cantidad') || h.includes('amount')),
    status: headers.findIndex((h) => h.includes('status') || h.includes('estado')),
    date: headers.findIndex((h) => h.includes('time') || h.includes('fecha')),
    counterparty: headers.findIndex((h) => h.includes('counterparty') || h.includes('contraparte')),
  };

  const results: BinanceC2cFill[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length <= 1) continue;

    const orderNumber = colIdx.orderNumber !== -1 ? cols[colIdx.orderNumber] : `CSV-ROW-${i}`;
    const side = colIdx.side !== -1 ? normalizeSide(cols[colIdx.side]) : 'BUY';
    const asset = colIdx.asset !== -1 ? cols[colIdx.asset] : 'USDT';
    const fiat = colIdx.fiat !== -1 ? cols[colIdx.fiat] : 'VES';
    const totalFiat = colIdx.totalPrice !== -1 ? parseNumberSafe(cols[colIdx.totalPrice]) : 0;
    const filledPrice = colIdx.unitPrice !== -1 ? parseNumberSafe(cols[colIdx.unitPrice]) : 0;
    const filledAmountUsdt = colIdx.amount !== -1 ? parseNumberSafe(cols[colIdx.amount]) : 0;
    const status = colIdx.status !== -1 ? normalizeStatus(cols[colIdx.status]) : 'COMPLETED';
    const rawDate = colIdx.date !== -1 ? cols[colIdx.date] : '';
    const createdAt = rawDate ? new Date(rawDate).getTime() || Date.now() : Date.now();
    const counterparty = colIdx.counterparty !== -1 ? cols[colIdx.counterparty] : undefined;

    results.push({
      orderNumber,
      advNo: '',
      side,
      asset,
      fiat,
      filledAmountUsdt,
      filledPrice,
      totalFiat,
      status,
      createdAt,
      commissionUsdt: 0,
      counterpartyNickname: counterparty,
    });
  }

  return results;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map((item) => item.replace(/^"+|"+$/g, '').trim());
}

/**
 * Calculates net realized metrics (profit and spread percentage) for a filled trade
 * based on the decision that priced the ad and deducting exchange fees.
 */
export function calculateFillRealizedMetrics(
  fill: BinanceC2cFill,
  decision: Pick<RepricerDecisionRecord, 'modeledSpreadPct' | 'decisionPrice'>,
): FillRealizedMetrics {
  const notional = fill.filledAmountUsdt;
  if (notional <= 0) {
    return { realizedProfitUsdt: 0, realizedSpreadPct: 0 };
  }

  // Use the modeled spread percentage if available; otherwise calculate relative margin
  const grossPct = decision.modeledSpreadPct || 0;
  const grossProfit = notional * (grossPct / 100);
  const netProfit = Math.max(0, grossProfit - fill.commissionUsdt);
  const realizedSpreadPct = Number(((netProfit / notional) * 100).toFixed(4));
  const realizedProfitUsdt = Number(netProfit.toFixed(4));

  return { realizedProfitUsdt, realizedSpreadPct };
}

/**
 * Correlates real Binance C2C fills against the decisions in the Decision Journal.
 * Deduplicates against existing outcomes (by externalRef === orderNumber).
 */
export function correlateFillsToDecisions(options: CorrelateFillsOptions): CorrelateFillsResult {
  const { fills, decisions, existingOutcomes, maxWindowMs = 2 * 60 * 60 * 1000 } = options;

  const existingRefs = new Set(
    existingOutcomes
      .map((o) => o.externalRef)
      .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0),
  );

  const outcomesToRecord: RecordOutcomeInput[] = [];
  const skippedExistingFills: string[] = [];
  const unmatchedFills: BinanceC2cFill[] = [];

  for (const fill of fills) {
    // 1. Skip non-completed trades
    if (fill.status !== 'COMPLETED') {
      continue;
    }

    // 2. Enforce idempotency: skip already registered orderNumbers
    if (existingRefs.has(fill.orderNumber)) {
      skippedExistingFills.push(fill.orderNumber);
      continue;
    }

    // 3. Find matching decisions:
    // Match by side, within temporal window (decision made before or near fill time)
    const candidateDecisions = decisions.filter((d) => {
      if (d.side !== fill.side) return false;
      const timeDiff = fill.createdAt - d.createdAt;
      // Decision must have happened before the fill or within maxWindowMs
      return timeDiff >= -60_000 && timeDiff <= maxWindowMs;
    });

    if (candidateDecisions.length === 0) {
      unmatchedFills.push(fill);
      continue;
    }

    // Pick closest decision in time
    candidateDecisions.sort((a, b) => Math.abs(fill.createdAt - a.createdAt) - Math.abs(fill.createdAt - b.createdAt));
    const matchedDecision = candidateDecisions[0];

    // 4. Calculate realized metrics
    const metrics = calculateFillRealizedMetrics(fill, matchedDecision);

    outcomesToRecord.push({
      decisionId: matchedDecision.id,
      source: 'BINANCE_MERCHANT',
      success: true,
      filledAmountUsdt: fill.filledAmountUsdt,
      filledPrice: fill.filledPrice,
      realizedSpreadPct: metrics.realizedSpreadPct,
      realizedProfitUsdt: metrics.realizedProfitUsdt,
      externalRef: fill.orderNumber,
      detail: `Fill confirmado Binance P2P (#${fill.orderNumber}) contraparte: ${fill.counterpartyNickname ?? 'N/A'}`,
      recordedAt: fill.createdAt,
    });
  }

  return {
    outcomesToRecord,
    skippedExistingFills,
    unmatchedFills,
  };
}
