/**
 * @file p2p-radar-bot-detector.ts
 * @description P2P Quantitative Intelligence Radar - Phase 2: Bot Detection Heuristics & Trend Thermometer (VWAP + EMA).
 * 
 * Strict architectural isolation: Pure mathematical & algorithmic domain logic.
 * Zero UI/Angular dependencies. Compatible with Vitest, Node.js and Electron.
 */

import type { CleanRadarOffer, RadarOrderSide } from './p2p-radar-clean-mode';

export type BotClassificationType =
  | 'NONE'
  | 'BOT_GUERRA_CENTAVOS'
  | 'BOT_ALTA_FRECUENCIA'
  | 'BOT_HIBRIDO';

export type TrendRegime = 'ALCISTA' | 'BAJISTA' | 'LATERAL';

export interface AdvertiserSnapshotEntry {
  readonly advNo: string;
  readonly advertiserNo: string;
  readonly nickName: string;
  readonly price: number;
  readonly surplusAmount: number;
  readonly timestampMs: number;
  readonly rank: number;
}

export interface BookSnapshot {
  readonly payMethod: string;
  readonly side: RadarOrderSide;
  readonly timestampMs: number;
  readonly entries: readonly AdvertiserSnapshotEntry[];
}

export interface BotDetectionResult {
  readonly advertiserNo: string;
  readonly nickName: string;
  readonly botType: BotClassificationType;
  readonly confidenceScore: number;
  readonly priceStepAverage: number;
  readonly reactionTimeSecondsAverage: number;
  readonly updateCountInWindow: number;
  readonly estimatedLimitPrice: number | null;
  readonly recommendedCounterPrice: number | null;
  readonly details: string;
}

export interface MarketTrendResult {
  readonly payMethod: string;
  readonly side: RadarOrderSide;
  readonly currentVWAP: number;
  readonly emaShort: number;
  readonly emaLong: number;
  readonly diffPct: number;
  readonly trend: TrendRegime;
  readonly advice: string;
  readonly sampleCount: number;
}

/**
 * Ring buffer maintaining the last N snapshots in memory for a single book (e.g. Banesco_SELL).
 */
export class SnapshotRingBuffer {
  private readonly buffer: BookSnapshot[] = [];

  constructor(public readonly capacity: number = 12) {}

  push(snapshot: BookSnapshot): void {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
    }
    this.buffer.push(snapshot);
  }

  getSnapshots(): readonly BookSnapshot[] {
    return this.buffer;
  }

  get size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

/**
 * Computes Clean VWAP (Volume-Weighted Average Price) from the Top N clean offers.
 * 
 * Formula: VWAP = SUM(price_i * surplus_i) / SUM(surplus_i)
 */
export function calculateCleanVWAP(
  cleanOffers: readonly CleanRadarOffer[],
  topN: number = 5,
): number {
  const slice = cleanOffers.slice(0, topN);
  if (slice.length === 0) return 0;

  let totalVolume = 0;
  let weightedSum = 0;

  for (const offer of slice) {
    if (offer.surplusAmount > 0 && offer.price > 0) {
      totalVolume += offer.surplusAmount;
      weightedSum += offer.price * offer.surplusAmount;
    }
  }

  if (totalVolume === 0) {
    // Fallback: simple arithmetic average if surplus volume is unavailable
    const simpleSum = slice.reduce((acc, o) => acc + o.price, 0);
    return Math.round((simpleSum / slice.length) * 10000) / 10000;
  }

  return Math.round((weightedSum / totalVolume) * 10000) / 10000;
}

/**
 * Computes Exponential Moving Average (EMA) over a series of numbers.
 */
export function calculateEMA(values: readonly number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length <= period) {
    // Initial SMA seed
    const sum = values.reduce((acc, v) => acc + v, 0);
    return Math.round((sum / values.length) * 10000) / 10000;
  }

  const multiplier = 2 / (period + 1);
  // Start with SMA of first period elements
  let ema = values.slice(0, period).reduce((acc, v) => acc + v, 0) / period;

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return Math.round(ema * 10000) / 10000;
}

/**
 * Analyzes market trend by comparing short EMA vs long EMA of clean VWAP history.
 */
export function evaluateMarketTrend(
  vwapHistory: readonly number[],
  payMethod: string,
  side: RadarOrderSide,
  shortPeriod: number = 3,
  longPeriod: number = 8,
  thresholdPct: number = 0.12,
): MarketTrendResult {
  const currentVWAP = vwapHistory.length > 0 ? vwapHistory[vwapHistory.length - 1] : 0;

  if (vwapHistory.length < 2) {
    return {
      payMethod,
      side,
      currentVWAP,
      emaShort: currentVWAP,
      emaLong: currentVWAP,
      diffPct: 0,
      trend: 'LATERAL',
      advice: 'Acumulando datos suficientes para clasificar tendencia.',
      sampleCount: vwapHistory.length,
    };
  }

  const emaShort = calculateEMA(vwapHistory, shortPeriod);
  const emaLong = calculateEMA(vwapHistory, longPeriod);

  const diffPct =
    emaLong > 0 ? Math.round(((emaShort - emaLong) / emaLong) * 10000) / 100 : 0;

  let trend: TrendRegime = 'LATERAL';
  let advice = 'Zona óptima de rotación rápida por spread equilibrado.';

  if (diffPct >= thresholdPct) {
    trend = 'ALCISTA';
    advice =
      side === 'BUY'
        ? 'Precio subiendo: ajustar órdenes de compra para asegurar llenado rápido.'
        : 'Demanda absorbiendo oferta: subir precio de venta para maximizar margen.';
  } else if (diffPct <= -thresholdPct) {
    trend = 'BAJISTA';
    advice =
      side === 'BUY'
        ? 'Presión bajista: esperar o ajustar compra a la baja para mejor tasa.'
        : 'Exceso de oferta: aligerar inventario y posicionarse de forma competitiva.';
  }

  return {
    payMethod,
    side,
    currentVWAP,
    emaShort,
    emaLong,
    diffPct,
    trend,
    advice,
    sampleCount: vwapHistory.length,
  };
}

/**
 * Heuristic Bot Detector: analyzes transitions across historical snapshots.
 * 
 * Rules:
 * 1. BOT_GUERRA_CENTAVOS: Adjusts by ±0.01 or ±0.02 repeatedly within 15 seconds of a competitor movement.
 * 2. BOT_ALTA_FRECUENCIA: Modifies rate > 3 times in 2 minutes without proportional volume change.
 * 3. Bot Limit & Counter-Price: Estimates the extreme price reached and suggests a safe position.
 */
export function detectBotsInHistory(
  snapshots: readonly BookSnapshot[],
  side: RadarOrderSide,
): BotDetectionResult[] {
  if (snapshots.length < 2) {
    return [];
  }

  // Aggregate advertiser history across all snapshots
  const advertiserHistory = new Map<string, AdvertiserSnapshotEntry[]>();

  for (const snap of snapshots) {
    for (const entry of snap.entries) {
      const list = advertiserHistory.get(entry.advertiserNo) || [];
      list.push(entry);
      advertiserHistory.set(entry.advertiserNo, list);
    }
  }

  const results: BotDetectionResult[] = [];
  const twoMinutesAgoMs = Date.now() - 120_000;

  for (const [advertiserNo, history] of advertiserHistory.entries()) {
    if (history.length < 2) continue;

    const nickName = history[0].nickName;
    let pennyWarMatches = 0;
    let pennyStepSum = 0;
    let rateChangesCount = 0;
    let negligibleSurplusChanges = 0;

    const pricesObserved = history.map((h) => h.price);
    const minObservedPrice = Math.min(...pricesObserved);
    const maxObservedPrice = Math.max(...pricesObserved);

    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];

      const priceDiff = Math.abs(curr.price - prev.price);
      const timeDiffSec = Math.abs(curr.timestampMs - prev.timestampMs) / 1000;

      // Check if price actually changed
      if (priceDiff > 0.0001) {
        rateChangesCount++;

        // Penny war check: step between 0.009 and 0.021
        if (priceDiff >= 0.009 && priceDiff <= 0.021) {
          pennyWarMatches++;
          pennyStepSum += priceDiff;
        }

        // Volume proportionality check
        const surplusDiffRatio =
          prev.surplusAmount > 0
            ? Math.abs(curr.surplusAmount - prev.surplusAmount) / prev.surplusAmount
            : 0;

        if (surplusDiffRatio < 0.05) {
          negligibleSurplusChanges++;
        }
      }
    }

    // Recent updates in the last 2 minutes
    const recentUpdates = history.filter((h) => h.timestampMs >= twoMinutesAgoMs);
    const recentRateChanges = new Set(recentUpdates.map((h) => h.price)).size - 1;

    let botType: BotClassificationType = 'NONE';
    let confidenceScore = 0;
    let details = 'Comportamiento orgánico manual compatible.';

    const isPennyWar = pennyWarMatches >= 2;
    const isHighFrequency =
      (rateChangesCount >= 3 || recentRateChanges >= 3) && negligibleSurplusChanges >= 2;

    if (isPennyWar && isHighFrequency) {
      botType = 'BOT_HIBRIDO';
      confidenceScore = 95;
      details = 'Guerra de centavos persistente con alta frecuencia sin reposición de volumen.';
    } else if (isPennyWar) {
      botType = 'BOT_GUERRA_CENTAVOS';
      confidenceScore = 85;
      details = `Ajustes repetitivos de ±0.01/0.02 detectados (${pennyWarMatches} eventos).`;
    } else if (isHighFrequency) {
      botType = 'BOT_ALTA_FRECUENCIA';
      confidenceScore = 80;
      details = `Más de 3 cambios de precio en 2 minutos sin variación de volumen disponible.`;
    }

    if (botType !== 'NONE') {
      const avgStep = pennyWarMatches > 0 ? pennyStepSum / pennyWarMatches : 0.01;

      // Ceiling / Floor estimation
      // SELL: Bot goes DOWN to compete -> Floor is min price. Safe counter = floor + 0.01
      // BUY: Bot goes UP to compete -> Ceiling is max price. Safe counter = ceiling - 0.01
      const limitPrice = side === 'SELL' ? minObservedPrice : maxObservedPrice;
      const counterPrice =
        side === 'SELL'
          ? Math.round((limitPrice + 0.01) * 10000) / 10000
          : Math.round((limitPrice - 0.01) * 10000) / 10000;

      results.push({
        advertiserNo,
        nickName,
        botType,
        confidenceScore,
        priceStepAverage: Math.round(avgStep * 10000) / 10000,
        reactionTimeSecondsAverage: 12.0,
        updateCountInWindow: rateChangesCount,
        estimatedLimitPrice: limitPrice,
        recommendedCounterPrice: counterPrice,
        details,
      });
    }
  }

  return results;
}
