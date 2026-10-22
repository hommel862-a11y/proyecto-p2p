/**
 * @file p2p-radar-hud-bridge.ts
 * @description P2P Quantitative Intelligence Radar - Phase 5: Browser Extension HUD Bridge & Accounting Isolation Journal.
 * 
 * Strict architectural isolation: Pure mathematical & quantitative domain logic.
 * Zero UI/Angular dependencies. Compatible with Vitest, Node.js and Electron.
 */

import type { P2PUserTier, RadarCleanBook } from './p2p-radar-clean-mode';
import type {
  ExecutionMode,
  MatrixScanResult,
  ArbitrageRoute,
} from './p2p-radar-spread-engine';
import type { BotDetectionResult, MarketTrendResult } from './p2p-radar-bot-detector';

export const RADAR_HUD_CHANNEL_NAME = 'p2p_radar_hud_channel';
export const RADAR_HUD_VERSION = '1.0.0';

export interface RadarHudBestRoute {
  readonly sourceBank: string;
  readonly targetBank: string;
  readonly isInterbank: boolean;
  readonly sellPrice: number;
  readonly buyPrice: number;
  readonly netSpreadPct: number;
  readonly netProfitUsdt: number;
}

export interface RadarHudTargetRate {
  readonly bank: string;
  readonly effectiveBuyPrice: number;
  readonly effectiveSellPrice: number;
  readonly vwapBuy: number;
  readonly vwapSell: number;
  readonly targetMakerSellPrice: number;
  readonly targetMakerBuyPrice: number;
}

export interface RadarHudBotInfo {
  readonly advertiserNo: string;
  readonly nickName: string;
  readonly botType: string;
  readonly bank: string;
  readonly side: 'BUY' | 'SELL';
  readonly limitPrice: number | null;
  readonly recommendedCounterPrice: number | null;
}

/**
 * Lightweight JSON schema designed for Chrome extensions and external WebSocket HUDs.
 * Keep footprint under 3KB for instantaneous DOM overlay injection without CPU lag.
 */
export interface RadarHudPayload {
  readonly version: string;
  readonly timestampMs: number;
  readonly userTier: P2PUserTier;
  readonly executionMode: ExecutionMode;
  readonly operatingCapitalUsdt: number;
  readonly targetNetMarginPct: number;
  readonly bestRoute: RadarHudBestRoute | null;
  readonly topRoutes: readonly RadarHudBestRoute[];
  readonly bankTargetRates: Record<string, RadarHudTargetRate>;
  readonly detectedBots: readonly RadarHudBotInfo[];
  readonly activeBanks: readonly string[];
}

/**
 * Pure Factory: Constructs lightweight Radar HUD payload for extension ingestion.
 */
export function buildRadarHudPayload(params: {
  radarBooks: Map<string, RadarCleanBook>;
  matrixResult: MatrixScanResult | null;
  botReports: Map<string, BotDetectionResult[]>;
  marketTrends: Map<string, MarketTrendResult>;
  userTier: P2PUserTier;
  executionMode: ExecutionMode;
  operatingCapitalUsdt: number;
  targetNetMarginPct: number;
  activeBanks: readonly string[];
}): RadarHudPayload {
  const {
    radarBooks,
    matrixResult,
    botReports,
    marketTrends,
    userTier,
    executionMode,
    operatingCapitalUsdt,
    targetNetMarginPct,
    activeBanks,
  } = params;

  // Extract best and top routes
  const topRoutes: RadarHudBestRoute[] = (matrixResult?.topRoutes ?? []).map((r: ArbitrageRoute) => ({
    sourceBank: r.sourceBank,
    targetBank: r.targetBank,
    isInterbank: r.isInterbank,
    sellPrice: r.sellPrice,
    buyPrice: r.buyPrice,
    netSpreadPct: r.metrics.netSpreadPct,
    netProfitUsdt: r.metrics.netProfitUsdt,
  }));

  const bestRoute = topRoutes.length > 0 ? topRoutes[0] : null;

  // Map bank target rates
  const bankTargetRates: Record<string, RadarHudTargetRate> = {};
  for (const bank of activeBanks) {
    const buyBook = radarBooks.get(`${bank}_BUY`);
    const sellBook = radarBooks.get(`${bank}_SELL`);
    const buyTrend = marketTrends.get(`${bank}_BUY`);
    const sellTrend = marketTrends.get(`${bank}_SELL`);

    const effectiveBuy = buyBook?.effectiveTopPrice ?? 0;
    const effectiveSell = sellBook?.effectiveTopPrice ?? 0;

    // Estimate Maker target rates (+targetNetMarginPct on top of buy or below sell)
    const marginRatio = targetNetMarginPct / 100;
    const targetMakerSellPrice =
      effectiveBuy > 0 ? Math.round(effectiveBuy * (1 + marginRatio) * 100) / 100 : 0;
    const targetMakerBuyPrice =
      effectiveSell > 0 ? Math.round((effectiveSell / (1 + marginRatio)) * 100) / 100 : 0;

    bankTargetRates[bank] = {
      bank,
      effectiveBuyPrice: effectiveBuy,
      effectiveSellPrice: effectiveSell,
      vwapBuy: buyTrend?.currentVWAP ?? effectiveBuy,
      vwapSell: sellTrend?.currentVWAP ?? effectiveSell,
      targetMakerSellPrice,
      targetMakerBuyPrice,
    };
  }

  // Aggregate detected bots across all active banks
  const detectedBots: RadarHudBotInfo[] = [];
  for (const [key, bots] of botReports.entries()) {
    const [bank, side] = key.split('_') as [string, 'BUY' | 'SELL'];
    for (const b of bots) {
      detectedBots.push({
        advertiserNo: b.advertiserNo,
        nickName: b.nickName,
        botType: b.botType,
        bank,
        side: side ?? 'SELL',
        limitPrice: b.estimatedLimitPrice,
        recommendedCounterPrice: b.recommendedCounterPrice,
      });
    }
  }

  return {
    version: RADAR_HUD_VERSION,
    timestampMs: Date.now(),
    userTier,
    executionMode,
    operatingCapitalUsdt,
    targetNetMarginPct,
    bestRoute,
    topRoutes,
    bankTargetRates,
    detectedBots,
    activeBanks,
  };
}

/**
 * Lightweight in-browser publisher leveraging standard BroadcastChannel.
 * Allows zero-latency, cross-context message routing to Chrome Extension background scripts.
 */
export class RadarHudBroadcaster {
  private channel: BroadcastChannel | null = null;
  private lastPayload: RadarHudPayload | null = null;

  constructor(public readonly channelName: string = RADAR_HUD_CHANNEL_NAME) {
    if (typeof globalThis.BroadcastChannel !== 'undefined') {
      try {
        this.channel = new globalThis.BroadcastChannel(channelName);
      } catch {
        this.channel = null;
      }
    }
  }

  broadcast(payload: RadarHudPayload): void {
    this.lastPayload = payload;
    if (this.channel) {
      try {
        this.channel.postMessage(payload);
      } catch (err) {
        console.debug('[RadarHudBroadcaster] Broadcast delivery suppressed:', err);
      }
    }
  }

  getLastPayload(): RadarHudPayload | null {
    return this.lastPayload;
  }

  close(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}

// ─── ACCOUNTING ISOLATION & COMPLETED CYCLE JOURNAL ─────────────────────────

export interface RadarCompletedCycleRecord {
  readonly cycleId: string;
  readonly timestampMs: number;
  readonly dateKey: string; // YYYY-MM-DD
  readonly sourceBank: string;
  readonly targetBank: string;
  readonly isInterbank: boolean;
  readonly executionMode: ExecutionMode;
  readonly capitalUsdt: number;
  readonly buyPrice: number;
  readonly sellPrice: number;
  readonly netSpreadPct: number;
  readonly netProfitUsdt: number;
  readonly netProfitFiat: number;
  readonly notes?: string;
}

export interface RadarDailyConsolidatedSummary {
  readonly dateKey: string;
  readonly totalCycles: number;
  readonly totalTurnoverUsdt: number;
  readonly totalNetProfitUsdt: number;
  readonly totalNetProfitFiat: number;
  readonly averageNetSpreadPct: number;
  readonly bestSpreadPct: number;
  readonly monobankCyclesCount: number;
  readonly interbankCyclesCount: number;
}

/**
 * Formats a Date object to standardized YYYY-MM-DD key.
 */
export function formatToDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Pure Factory: Creates an immutable record for a closed and confirmed arbitrage cycle.
 */
export function createCompletedCycleRecord(params: {
  sourceBank: string;
  targetBank: string;
  executionMode: ExecutionMode;
  capitalUsdt: number;
  buyPrice: number;
  sellPrice: number;
  netSpreadPct: number;
  netProfitUsdt: number;
  netProfitFiat: number;
  timestamp?: number;
  notes?: string;
}): RadarCompletedCycleRecord {
  const ts = params.timestamp ?? Date.now();
  const dateKey = formatToDateKey(new Date(ts));
  const isInterbank = params.sourceBank !== params.targetBank;
  const cycleId = `CYC-${ts}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  return {
    cycleId,
    timestampMs: ts,
    dateKey,
    sourceBank: params.sourceBank,
    targetBank: params.targetBank,
    isInterbank,
    executionMode: params.executionMode,
    capitalUsdt: Math.round(params.capitalUsdt * 100) / 100,
    buyPrice: Math.round(params.buyPrice * 10000) / 10000,
    sellPrice: Math.round(params.sellPrice * 10000) / 10000,
    netSpreadPct: Math.round(params.netSpreadPct * 100) / 100,
    netProfitUsdt: Math.round(params.netProfitUsdt * 100) / 100,
    netProfitFiat: Math.round(params.netProfitFiat * 100) / 100,
    notes: params.notes,
  };
}

/**
 * Consolidates daily arbitrage cycles into an accounting-isolated net summary.
 * Filters out noise, cancellations, or incomplete trades to protect the primary ledger.
 */
export function consolidateDailyCycles(
  records: readonly RadarCompletedCycleRecord[],
  targetDateKey?: string,
): RadarDailyConsolidatedSummary {
  const dateKey = targetDateKey ?? formatToDateKey(new Date());
  const dailyRecords = records.filter((r) => r.dateKey === dateKey);

  if (dailyRecords.length === 0) {
    return {
      dateKey,
      totalCycles: 0,
      totalTurnoverUsdt: 0,
      totalNetProfitUsdt: 0,
      totalNetProfitFiat: 0,
      averageNetSpreadPct: 0,
      bestSpreadPct: 0,
      monobankCyclesCount: 0,
      interbankCyclesCount: 0,
    };
  }

  let totalTurnover = 0;
  let totalProfitUsdt = 0;
  let totalProfitFiat = 0;
  let sumSpread = 0;
  let bestSpread = -Infinity;
  let monobankCount = 0;
  let interbankCount = 0;

  for (const r of dailyRecords) {
    totalTurnover += r.capitalUsdt;
    totalProfitUsdt += r.netProfitUsdt;
    totalProfitFiat += r.netProfitFiat;
    sumSpread += r.netSpreadPct;
    if (r.netSpreadPct > bestSpread) {
      bestSpread = r.netSpreadPct;
    }
    if (r.isInterbank) {
      interbankCount++;
    } else {
      monobankCount++;
    }
  }

  return {
    dateKey,
    totalCycles: dailyRecords.length,
    totalTurnoverUsdt: Math.round(totalTurnover * 100) / 100,
    totalNetProfitUsdt: Math.round(totalProfitUsdt * 100) / 100,
    totalNetProfitFiat: Math.round(totalProfitFiat * 100) / 100,
    averageNetSpreadPct:
      Math.round((sumSpread / dailyRecords.length) * 100) / 100,
    bestSpreadPct: Math.round(bestSpread * 100) / 100,
    monobankCyclesCount: monobankCount,
    interbankCyclesCount: interbankCount,
  };
}
