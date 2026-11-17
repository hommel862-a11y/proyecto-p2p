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
  if (!Number.isFinite(topN) || topN <= 0) return 0;
  const slice = cleanOffers.slice(0, topN);
  if (slice.length === 0) return 0;

  let totalVolume = 0;
  let weightedSum = 0;
  let validPriceSum = 0;
  let validPriceCount = 0;

  for (const offer of slice) {
    if (!Number.isFinite(offer.price) || offer.price <= 0) continue;
    validPriceSum += offer.price;
    validPriceCount++;
    if (Number.isFinite(offer.surplusAmount) && offer.surplusAmount > 0) {
      totalVolume += offer.surplusAmount;
      weightedSum += offer.price * offer.surplusAmount;
    }
  }

  if (totalVolume <= 0) {
    if (validPriceCount === 0) return 0;
    return Math.round((validPriceSum / validPriceCount) * 10000) / 10000;
  }

  return Math.round((weightedSum / totalVolume) * 10000) / 10000;
}

/**
 * Computes Exponential Moving Average (EMA) over a series of numbers.
 */
export function calculateEMA(values: readonly number[], period: number): number {
  const finiteValues = values.filter((v) => Number.isFinite(v));
  if (finiteValues.length === 0 || !Number.isFinite(period) || period <= 0) return 0;

  if (finiteValues.length <= period) {
    const sum = finiteValues.reduce((acc, v) => acc + v, 0);
    return Math.round((sum / finiteValues.length) * 10000) / 10000;
  }

  const multiplier = 2 / (period + 1);
  let ema = finiteValues.slice(0, period).reduce((acc, v) => acc + v, 0) / period;

  for (let i = period; i < finiteValues.length; i++) {
    ema = (finiteValues[i] - ema) * multiplier + ema;
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
  referenceNowMs?: number,
): BotDetectionResult[] {
  if (snapshots.length < 2) {
    return [];
  }

  // Group by advertiserNo::advNo so separate ads from the same merchant are not mixed,
  // and determine the latest snapshot timestamp for deterministic historical replay.
  const adHistory = new Map<string, AdvertiserSnapshotEntry[]>();
  let latestSnapshotMs = 0;

  for (const snap of snapshots) {
    if (Number.isFinite(snap.timestampMs) && snap.timestampMs > latestSnapshotMs) {
      latestSnapshotMs = snap.timestampMs;
    }
    for (const entry of snap.entries) {
      if (!Number.isFinite(entry.price) || entry.price <= 0) continue;
      const adKey = `${entry.advertiserNo}::${entry.advNo || 'default'}`;
      let list = adHistory.get(adKey);
      if (!list) {
        list = [];
        adHistory.set(adKey, list);
      }
      list.push(entry);
    }
  }

  const results: BotDetectionResult[] = [];
  const anchorMs =
    typeof referenceNowMs === 'number' && Number.isFinite(referenceNowMs)
      ? referenceNowMs
      : latestSnapshotMs > 0
        ? latestSnapshotMs
        : Date.now();
  const twoMinutesAgoMs = anchorMs - 120_000;

  for (const history of adHistory.values()) {
    if (history.length < 2) continue;

    history.sort((a, b) => a.timestampMs - b.timestampMs);

    const { advertiserNo, nickName } = history[0];
    let pennyWarMatches = 0;
    let pennyStepSum = 0;
    let rateChangesCount = 0;
    let recentSequentialChanges = 0;
    let negligibleSurplusChanges = 0;
    let reactionSecSum = 0;
    let reactionSecCount = 0;

    let minObservedPrice = history[0].price;
    let maxObservedPrice = history[0].price;

    // Adaptive minimum step scaled gently for higher nominal rates while keeping 0.01 around ~100 VES
    const adaptiveMaxStep = Math.max(0.021, minObservedPrice * 0.00025);

    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];

      if (curr.price < minObservedPrice) minObservedPrice = curr.price;
      if (curr.price > maxObservedPrice) maxObservedPrice = curr.price;

      const priceDiff = Math.abs(curr.price - prev.price);
      const timeDiffSec = Math.abs(curr.timestampMs - prev.timestampMs) / 1000;

      if (priceDiff > 0.0001) {
        rateChangesCount++;
        if (curr.timestampMs >= twoMinutesAgoMs) {
          recentSequentialChanges++;
        }
        if (Number.isFinite(timeDiffSec) && timeDiffSec > 0) {
          reactionSecSum += timeDiffSec;
          reactionSecCount++;
        }

        if (priceDiff >= 0.009 && priceDiff <= adaptiveMaxStep) {
          pennyWarMatches++;
          pennyStepSum += priceDiff;
        }

        const surplusDiffRatio =
          prev.surplusAmount > 0
            ? Math.abs(curr.surplusAmount - prev.surplusAmount) / prev.surplusAmount
            : 0;

        if (surplusDiffRatio < 0.05) {
          negligibleSurplusChanges++;
        }
      }
    }

    let botType: BotClassificationType = 'NONE';
    let confidenceScore = 0;
    let details = 'Comportamiento orgánico manual compatible.';

    const isPennyWar = pennyWarMatches >= 2;
    const isHighFrequency =
      (rateChangesCount >= 3 || recentSequentialChanges >= 3) && negligibleSurplusChanges >= 2;

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
      const reactionAvg =
        reactionSecCount > 0 ? Math.round((reactionSecSum / reactionSecCount) * 10) / 10 : 0;

      const limitPrice = side === 'SELL' ? minObservedPrice : maxObservedPrice;
      const counterStep = limitPrice < 500 ? 0.01 : Math.round(avgStep * 100) / 100 || 0.01;
      const counterPrice =
        side === 'SELL'
          ? Math.round((limitPrice + counterStep) * 10000) / 10000
          : Math.round((limitPrice - counterStep) * 10000) / 10000;

      results.push({
        advertiserNo,
        nickName,
        botType,
        confidenceScore,
        priceStepAverage: Math.round(avgStep * 10000) / 10000,
        reactionTimeSecondsAverage: reactionAvg,
        updateCountInWindow: rateChangesCount,
        estimatedLimitPrice: limitPrice,
        recommendedCounterPrice: counterPrice,
        details,
      });
    }
  }

  return results;
}
