/**
 * Microestructura del Libro P2P — Detección de Spoofing, Liquidez Fantasma y Persistencia de Órdenes.
 * Diseñado para detectar manipulación algorítmica de libros de órdenes P2P venezolanos (Binance/Bybit).
 * Lógica pura, framework-agnostic.
 */

import { type BinanceOfferSummary } from './binance-p2p';
import { computeVolumeWeightedPrice, type JohnsonDepthOptions } from './johnson-depth';

export type SpoofCategory =
  'LEGITIMATE' | 'SUSPICIOUS_HIGH_TURNOVER' | 'PHANTOM_LIQUIDITY' | 'SPOOF_BAIT';

export interface TrackedOrderState {
  advNo: string;
  merchantName: string;
  side: 'BUY' | 'SELL';
  firstSeenMs: number;
  lastSeenMs: number;
  disappearedAtMs?: number;
  lifespanSeconds: number;
  snapshotsPresent: number;
  price: number;
  minVes: number;
  maxVes: number;
  finishRatePct: number;
  orderCount: number;
  lastOrderCount: number;
}

export interface OrderClassification {
  advNo: string;
  merchantName: string;
  price: number;
  maxVes: number;
  side: 'BUY' | 'SELL';
  category: SpoofCategory;
  confidencePct: number;
  reason: string;
  lifespanSeconds: number;
}

export interface SpoofReport {
  timestampMs: number;
  totalTracked: number;
  classifiedOrders: OrderClassification[];
  spoofBaitCount: number;
  phantomLiquidityCount: number;
  suspiciousCount: number;
  legitimateCount: number;
  phantomLiquidityVes: number;
  manipulationRiskScore: number; // 0 a 100
}

export interface SanitizedDepthResult {
  rawOffersCount: number;
  sanitizedOffersCount: number;
  purgedSpoofCount: number;
  purgedPhantomVolumeVes: number;
  sanitizedPrice: number;
  fillableUsdt: number;
  sanitizedOffers: BinanceOfferSummary[];
  manipulationDetected: boolean;
}

export class OrderPersistenceTracker {
  private readonly tracked = new Map<string, TrackedOrderState>();
  private readonly windowMs: number;

  constructor(windowMinutes = 15) {
    this.windowMs = windowMinutes * 60 * 1000;
  }

  /**
   * Ingesta un snapshot del libro de órdenes y actualiza tiempos de persistencia.
   */
  ingestSnapshot(
    offers: readonly BinanceOfferSummary[],
    side: 'BUY' | 'SELL',
    nowMs = Date.now(),
  ): void {
    const currentAdvNos = new Set<string>();

    for (const offer of offers) {
      currentAdvNos.add(offer.advNo);
      const existing = this.tracked.get(offer.advNo);

      if (existing) {
        existing.lastSeenMs = nowMs;
        existing.snapshotsPresent += 1;
        existing.price = offer.price;
        existing.minVes = offer.minVes;
        existing.maxVes = offer.maxVes;
        existing.finishRatePct = offer.finishRatePct;
        existing.lastOrderCount = offer.orderCount;
        existing.lifespanSeconds = Math.max(1, Math.round((nowMs - existing.firstSeenMs) / 1000));
        existing.disappearedAtMs = undefined; // Sigue activa
      } else {
        this.tracked.set(offer.advNo, {
          advNo: offer.advNo,
          merchantName: offer.merchantName,
          side,
          firstSeenMs: nowMs,
          lastSeenMs: nowMs,
          lifespanSeconds: 1,
          snapshotsPresent: 1,
          price: offer.price,
          minVes: offer.minVes,
          maxVes: offer.maxVes,
          finishRatePct: offer.finishRatePct,
          orderCount: offer.orderCount,
          lastOrderCount: offer.orderCount,
        });
      }
    }

    // Identificar órdenes que desaparecieron en este snapshot para este lado
    for (const [advNo, order] of this.tracked.entries()) {
      if (order.side === side && !currentAdvNos.has(advNo) && !order.disappearedAtMs) {
        order.disappearedAtMs = nowMs;
        order.lifespanSeconds = Math.max(1, Math.round((nowMs - order.firstSeenMs) / 1000));
      }
    }

    // Poda de memoria fuera de la ventana
    this.pruneOldOrders(nowMs);
  }

  /**
   * Genera el reporte de spoofing y liquidez fantasma para el estado actual (opcionalmente filtrado por lado).
   */
  generateSpoofReport(nowMs = Date.now(), sideFilter?: 'BUY' | 'SELL'): SpoofReport {
    const allOrders = Array.from(this.tracked.values());
    const orders = sideFilter ? allOrders.filter((o) => o.side === sideFilter) : allOrders;
    if (orders.length === 0) {
      return {
        timestampMs: nowMs,
        totalTracked: 0,
        classifiedOrders: [],
        spoofBaitCount: 0,
        phantomLiquidityCount: 0,
        suspiciousCount: 0,
        legitimateCount: 0,
        phantomLiquidityVes: 0,
        manipulationRiskScore: 0,
      };
    }

    // Calcular métricas robustas del libro (mediana de volumen para evitar distorsión por la ballena)
    const sortedVolumes = orders.map((o) => o.maxVes).sort((a, b) => a - b);
    const medianVolumeVes = sortedVolumes[Math.floor(sortedVolumes.length / 2)] || 1;
    const avgVolumeVes = orders.reduce((acc, o) => acc + o.maxVes, 0) / orders.length;

    const classified: OrderClassification[] = [];
    let spoofBaitCount = 0;
    let phantomLiquidityCount = 0;
    let suspiciousCount = 0;
    let legitimateCount = 0;
    let phantomLiquidityVes = 0;

    for (const order of orders) {
      const activeAgeSec = order.disappearedAtMs
        ? order.lifespanSeconds
        : Math.max(1, Math.round((nowMs - order.firstSeenMs) / 1000));

      const isDisappeared = !!order.disappearedAtMs;
      const executedTrades = order.lastOrderCount - order.orderCount;
      const volumeRatio =
        medianVolumeVes > 0 ? order.maxVes / medianVolumeVes : order.maxVes / avgVolumeVes;

      // 1. Detección de Liquidez Fantasma (Phantom Liquidity)
      // Muro de volumen masivo (> 4x mediana o > 400,000 VES) que desaparece rápidamente sin completar órdenes
      if (
        (volumeRatio >= 4.0 || order.maxVes >= 400000) &&
        isDisappeared &&
        activeAgeSec <= 150 &&
        executedTrades === 0
      ) {
        classified.push({
          advNo: order.advNo,
          merchantName: order.merchantName,
          price: order.price,
          maxVes: order.maxVes,
          side: order.side,
          category: 'PHANTOM_LIQUIDITY',
          confidencePct: 92,
          reason: `Muro de liquidez fantasma de ${order.maxVes.toLocaleString()} VES retirado en ${activeAgeSec}s sin operaciones`,
          lifespanSeconds: activeAgeSec,
        });
        phantomLiquidityCount++;
        phantomLiquidityVes += order.maxVes;
        continue;
      }

      // 2. Detección de Anuncio Cebo / Spoofing (Spoof Bait)
      // Solo clasifica cuando desaparece en <75s o muestra baja reputación extrema repetida en >=2 snapshots.
      // Nunca penaliza anuncios legítimos activos en el snapshot #1 solo por su tamaño.
      const repeatedLowRep =
        !isDisappeared &&
        order.snapshotsPresent >= 2 &&
        activeAgeSec < 75 &&
        order.finishRatePct < 75 &&
        order.lastOrderCount < 20;
      if ((isDisappeared && activeAgeSec < 75) || repeatedLowRep) {
        classified.push({
          advNo: order.advNo,
          merchantName: order.merchantName,
          price: order.price,
          maxVes: order.maxVes,
          side: order.side,
          category: 'SPOOF_BAIT',
          confidencePct: 88,
          reason: `Anuncio cebo con persistencia efímera (${activeAgeSec}s) para falsear el spread visible`,
          lifespanSeconds: activeAgeSec,
        });
        spoofBaitCount++;
        continue;
      }

      // 3. Sospecha de Alta Rotación (sólo si ya desapareció rápidamente o tiene muy baja reputación)
      if (isDisappeared && activeAgeSec < 180) {
        classified.push({
          advNo: order.advNo,
          merchantName: order.merchantName,
          price: order.price,
          maxVes: order.maxVes,
          side: order.side,
          category: 'SUSPICIOUS_HIGH_TURNOVER',
          confidencePct: 65,
          reason: `Persistencia inestable (${activeAgeSec}s), rotación frecuente del anuncio`,
          lifespanSeconds: activeAgeSec,
        });
        suspiciousCount++;
        continue;
      }

      // 4. Anuncio Legítimo y Estable
      classified.push({
        advNo: order.advNo,
        merchantName: order.merchantName,
        price: order.price,
        maxVes: order.maxVes,
        side: order.side,
        category: 'LEGITIMATE',
        confidencePct: 95,
        reason: `Liquidez orgánica con alta persistencia (${activeAgeSec}s) y consistencia`,
        lifespanSeconds: activeAgeSec,
      });
      legitimateCount++;
    }

    // Cálculo de Score de Riesgo de Manipulación (0 a 100)
    const totalToxic = spoofBaitCount * 25 + phantomLiquidityCount * 30 + suspiciousCount * 10;
    const manipulationRiskScore = Math.min(100, Math.round(totalToxic));

    return {
      timestampMs: nowMs,
      totalTracked: orders.length,
      classifiedOrders: classified,
      spoofBaitCount,
      phantomLiquidityCount,
      suspiciousCount,
      legitimateCount,
      phantomLiquidityVes,
      manipulationRiskScore,
    };
  }

  private pruneOldOrders(nowMs: number): void {
    for (const [advNo, order] of this.tracked.entries()) {
      if (nowMs - order.lastSeenMs > this.windowMs) {
        this.tracked.delete(advNo);
      }
    }
  }

  clear(): void {
    this.tracked.clear();
  }

  clearSide(side: 'BUY' | 'SELL'): void {
    for (const [advNo, order] of this.tracked.entries()) {
      if (order.side === side) {
        this.tracked.delete(advNo);
      }
    }
  }
}

/**
 * Filtra los anuncios que corresponden a spoofing o liquidez fantasma según el reporte.
 */
export function sanitizeOffers(
  offers: readonly BinanceOfferSummary[],
  report: SpoofReport,
): BinanceOfferSummary[] {
  const toxicAdvNos = new Set(
    report.classifiedOrders
      .filter((c) => c.category === 'SPOOF_BAIT' || c.category === 'PHANTOM_LIQUIDITY')
      .map((c) => c.advNo),
  );

  return offers.filter((o) => !toxicAdvNos.has(o.advNo));
}

/**
 * Calcula la profundidad de mercado Johnson purgada de spoofing y liquidez fantasma.
 */
export function computeMicrostructureSanitizedDepth(
  offers: readonly BinanceOfferSummary[],
  side: 'BUY' | 'SELL',
  targetUsdt: number,
  tracker: OrderPersistenceTracker,
  nowMs = Date.now(),
  options: JohnsonDepthOptions = {},
): SanitizedDepthResult {
  const report = tracker.generateSpoofReport(nowMs, side);
  const sanitized = sanitizeOffers(offers, report);

  const purgedSpoofCount = offers.length - sanitized.length;
  const purgedPhantomVolumeVes = report.phantomLiquidityVes;

  const depth = computeVolumeWeightedPrice(sanitized, side, targetUsdt, options);

  return {
    rawOffersCount: offers.length,
    sanitizedOffersCount: sanitized.length,
    purgedSpoofCount,
    purgedPhantomVolumeVes,
    sanitizedPrice: depth.price,
    fillableUsdt: depth.fillableUsdt,
    sanitizedOffers: sanitized,
    manipulationDetected: purgedSpoofCount > 0 || report.manipulationRiskScore >= 40,
  };
}

// ─── Phase 1: Advanced Quantitative Market Making & Execution Models ───────────

export interface AvellanedaStoikovInput {
  midPrice: number;
  currentInventoryUsdt: number;
  targetInventoryUsdt: number;
  volatilityDaily: number; // Volatilidad diaria estimada en decimal (ej. 0.02 = 2%)
  timeRemainingFraction?: number; // Fracción del horizonte de trading restante (0.0 a 1.0, default 1.0)
  riskAversionGamma?: number; // Parámetro gamma de aversión al riesgo (default: 0.1)
  orderbookLiquidityDensityK?: number; // Densidad del libro kappa (default: 1.5)
}

export interface AvellanedaStoikovResult {
  reservationPrice: number; // r(s, q, t) = s - q * gamma * sigma^2 * (T - t)
  optimalHalfSpread: number; // delta^a, delta^b
  optimalBidPrice: number;
  optimalAskPrice: number;
  inventorySkewUsdt: number; // q = current - target
  inventoryRiskPremium: number; // Compensación por cargar inventario
  recommendedAction: 'HOLD' | 'SKEW_BUY' | 'SKEW_SELL' | 'AGGRESSIVE_UNLOAD';
}

/**
 * Calcula el precio de reserva (indiferencia) y las cotizaciones óptimas de compra/venta
 * bajo la teoría clásica de microestructura de Avellaneda-Stoikov (2008).
 */
export function computeAvellanedaStoikovQuotes(
  input: AvellanedaStoikovInput,
): AvellanedaStoikovResult {
  const {
    midPrice,
    currentInventoryUsdt,
    targetInventoryUsdt,
    volatilityDaily,
    timeRemainingFraction = 1.0,
    riskAversionGamma = 0.1,
    orderbookLiquidityDensityK = 1.5,
  } = input;

  if (!Number.isFinite(midPrice) || midPrice <= 0) {
    return {
      reservationPrice: 0,
      optimalHalfSpread: 0,
      optimalBidPrice: 0,
      optimalAskPrice: 0,
      inventorySkewUsdt: 0,
      inventoryRiskPremium: 0,
      recommendedAction: 'HOLD',
    };
  }

  const safeCurrent = Number.isFinite(currentInventoryUsdt) ? currentInventoryUsdt : 0;
  const safeTarget = Number.isFinite(targetInventoryUsdt) && targetInventoryUsdt > 0 ? targetInventoryUsdt : 0;
  const q = safeCurrent - safeTarget;
  const safeVol =
    Number.isFinite(volatilityDaily) && volatilityDaily >= 0 ? Math.min(volatilityDaily, 0.5) : 0.02;
  const safeGamma =
    Number.isFinite(riskAversionGamma) && riskAversionGamma > 0.001 ? riskAversionGamma : 0.1;
  const safeKappa =
    Number.isFinite(orderbookLiquidityDensityK) && orderbookLiquidityDensityK > 0.01
      ? orderbookLiquidityDensityK
      : 1.5;
  const sigmaSquared = Math.pow(safeVol, 2);
  const timeHorizon = Number.isFinite(timeRemainingFraction)
    ? Math.max(0.01, Math.min(1.0, timeRemainingFraction))
    : 1.0;

  // Normalize inventory skew proportionally so extreme balances never push reservationPrice negative.
  const denomUsdt = safeTarget > 0 ? safeTarget : 1000;
  const normalizedSkew = Math.max(-5, Math.min(5, q / denomUsdt));
  const rawInventoryDiscount = normalizedSkew * safeGamma * sigmaSquared * timeHorizon * midPrice * 15;
  const maxDiscount = midPrice * 0.15;
  const inventoryDiscount = Math.max(-maxDiscount, Math.min(maxDiscount, rawInventoryDiscount));
  const reservationPrice = Math.max(0.01, midPrice - inventoryDiscount);

  // Optimal spread: s = (2 / gamma) * ln(1 + gamma / kappa)
  const baseSpread = (2 / safeGamma) * Math.log(1 + safeGamma / safeKappa);
  const optimalHalfSpread = Math.max(0.01, (baseSpread * midPrice) / 200);

  const optimalBidPrice = Math.max(0.01, Math.round((reservationPrice - optimalHalfSpread) * 100) / 100);
  const optimalAskPrice = Math.max(
    optimalBidPrice + 0.01,
    Math.round((reservationPrice + optimalHalfSpread) * 100) / 100,
  );

  let recommendedAction: AvellanedaStoikovResult['recommendedAction'] = 'HOLD';
  const inventoryRatio = safeTarget > 0 ? q / safeTarget : 0;

  if (inventoryRatio > 0.4) {
    recommendedAction = inventoryRatio > 0.8 ? 'AGGRESSIVE_UNLOAD' : 'SKEW_SELL';
  } else if (inventoryRatio < -0.4) {
    recommendedAction = 'SKEW_BUY';
  }

  return {
    reservationPrice: Math.round(reservationPrice * 100) / 100,
    optimalHalfSpread: Math.round(optimalHalfSpread * 100) / 100,
    optimalBidPrice,
    optimalAskPrice,
    inventorySkewUsdt: Math.round(q * 100) / 100,
    inventoryRiskPremium: Math.round(inventoryDiscount * 100) / 100,
    recommendedAction,
  };
}

export interface VpinBucket {
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
}

export interface VpinAnalysisInput {
  buckets: VpinBucket[];
  toxicityThreshold?: number; // Default 0.25 (25% de asimetría tóxica)
}

export interface VpinAnalysisResult {
  vpinScore: number; // 0.0 a 1.0 (Probabilidad de flujo tóxico/informado)
  toxicBucketCount: number;
  totalVolumeEvaluated: number;
  toxicityClassification:
    'LOW_RETAIL' | 'MODERATE_FLOW' | 'HIGH_INFORMED_TOXICITY' | 'EXTREME_ADVERSE_SELECTION';
  recommendedProtectiveSpreadMultiplier: number;
  warningNotice?: string;
}

/**
 * Estima la probabilidad de flujo tóxico informado mediante la métrica VPIN (Easley, López de Prado et al.).
 * VPIN = sum(|V_buy - V_sell|) / (N * V_bucket)
 */
export function calculateVpinMetric(input: VpinAnalysisInput): VpinAnalysisResult {
  const { buckets, toxicityThreshold = 0.25 } = input;
  if (!buckets || buckets.length === 0) {
    return {
      vpinScore: 0.1,
      toxicBucketCount: 0,
      totalVolumeEvaluated: 0,
      toxicityClassification: 'LOW_RETAIL',
      recommendedProtectiveSpreadMultiplier: 1.0,
    };
  }

  const safeThreshold =
    Number.isFinite(toxicityThreshold) && toxicityThreshold >= 0 ? toxicityThreshold : 0.25;
  let totalAbsoluteOrderImbalance = 0;
  let totalVolume = 0;
  let toxicCount = 0;

  for (const b of buckets) {
    const buyVol = Number.isFinite(b.buyVolume) && b.buyVolume >= 0 ? b.buyVolume : 0;
    const sellVol = Number.isFinite(b.sellVolume) && b.sellVolume >= 0 ? b.sellVolume : 0;
    const bucketVol = Number.isFinite(b.totalVolume) && b.totalVolume >= 0 ? b.totalVolume : buyVol + sellVol;
    if (bucketVol <= 0) continue;

    const imbalance = Math.abs(buyVol - sellVol);
    totalAbsoluteOrderImbalance += imbalance;
    totalVolume += bucketVol;
    if (imbalance / bucketVol >= safeThreshold) {
      toxicCount++;
    }
  }

  const rawVpin = totalVolume > 0 ? totalAbsoluteOrderImbalance / totalVolume : 0.1;
  const vpinScore = Math.max(0, Math.min(1, Math.round(rawVpin * 1000) / 1000));

  let toxicityClassification: VpinAnalysisResult['toxicityClassification'] = 'LOW_RETAIL';
  let multiplier = 1.0;
  let warningNotice: string | undefined;

  if (vpinScore >= 0.45) {
    toxicityClassification = 'EXTREME_ADVERSE_SELECTION';
    multiplier = 2.2;
    warningNotice =
      'ALERTA CRÍTICA: Flujo predominantemente informado/institucional. Alto riesgo de salto cambiario inminente. Ampliar spread Maker o congelar órdenes pasivas.';
  } else if (vpinScore >= 0.3) {
    toxicityClassification = 'HIGH_INFORMED_TOXICITY';
    multiplier = 1.6;
    warningNotice =
      'PRECAUCIÓN: Desbalance marcado en la dirección de órdenes. Los tomadores tienen urgencia de salida.';
  } else if (vpinScore >= 0.2) {
    toxicityClassification = 'MODERATE_FLOW';
    multiplier = 1.25;
  }

  return {
    vpinScore,
    toxicBucketCount: toxicCount,
    totalVolumeEvaluated: totalVolume,
    toxicityClassification,
    recommendedProtectiveSpreadMultiplier: multiplier,
    warningNotice,
  };
}

export interface OrderSliceSchedule {
  sliceIndex: number;
  scheduledMinutesOffset: number;
  sliceAmountUsdt: number;
  sliceAmountVes: number;
  targetPrice: number;
  participationRatePct: number;
}

export interface InstitutionalSlicingInput {
  totalAmountUsdt: number;
  executionDurationMinutes: number; // Duración objetivo (ej. 60 min)
  estimatedMarketVolumePerHourUsdt: number;
  currentMidPrice: number;
  maxMarketParticipationPct?: number; // Máximo % del volumen de mercado a capturar (default: 15%)
  algorithm: 'TWAP' | 'VWAP';
}

export interface InstitutionalSlicingResult {
  slices: OrderSliceSchedule[];
  totalSlices: number;
  averageSliceAmountUsdt: number;
  sliceIntervalMinutes: number;
  expectedMarketImpactPct: number;
  executionAlgorithm: 'TWAP' | 'VWAP';
  summary: string;
}

/**
 * Divide un ticket institucional en micro-lotes temporales (TWAP/VWAP) para minimizar
 * el impacto de mercado y prevenir el front-running en el libro P2P.
 */
export function computeOrderSlicingPlan(
  input: InstitutionalSlicingInput,
): InstitutionalSlicingResult {
  const {
    totalAmountUsdt,
    executionDurationMinutes,
    estimatedMarketVolumePerHourUsdt,
    currentMidPrice,
    maxMarketParticipationPct = 15,
    algorithm = 'TWAP',
  } = input;

  if (
    !Number.isFinite(totalAmountUsdt) ||
    totalAmountUsdt <= 0 ||
    !Number.isFinite(currentMidPrice) ||
    currentMidPrice <= 0
  ) {
    return {
      slices: [],
      totalSlices: 0,
      averageSliceAmountUsdt: 0,
      sliceIntervalMinutes: 0,
      expectedMarketImpactPct: 0,
      executionAlgorithm: algorithm,
      summary: 'Monto o precio no válido para fragmentación.',
    };
  }

  const safeDurationMin =
    Number.isFinite(executionDurationMinutes) && executionDurationMinutes >= 0
      ? executionDurationMinutes
      : 60;
  const safeHourlyVol =
    Number.isFinite(estimatedMarketVolumePerHourUsdt) && estimatedMarketVolumePerHourUsdt >= 0
      ? estimatedMarketVolumePerHourUsdt
      : 0;
  const durationHours = safeDurationMin / 60;
  const projectedTotalMarketVolume = safeHourlyVol * durationHours;

  const participationRate =
    projectedTotalMarketVolume > 0 ? (totalAmountUsdt / projectedTotalMarketVolume) * 100 : 100;

  const targetSliceSize = Math.max(300, Math.min(2500, totalAmountUsdt / 5));
  const rawSlices = Math.ceil(totalAmountUsdt / targetSliceSize);
  const safeMaxParticipation =
    Number.isFinite(maxMarketParticipationPct) && maxMarketParticipationPct > 0
      ? maxMarketParticipationPct
      : 15;
  const minSlicesByParticipation =
    projectedTotalMarketVolume > 0 && participationRate > safeMaxParticipation
      ? Math.ceil(participationRate / safeMaxParticipation)
      : 3;
  const totalSlices = Math.max(3, Math.min(24, Math.max(rawSlices, minSlicesByParticipation)));
  const sliceIntervalMinutes = Math.max(2, Math.round(safeDurationMin / totalSlices));

  const weights: number[] = [];
  for (let i = 0; i < totalSlices; i++) {
    if (algorithm === 'VWAP') {
      const normalizedTime = (i / (totalSlices - 1 || 1)) * 2 - 1;
      weights.push(0.8 + 0.4 * Math.pow(normalizedTime, 2));
    } else {
      weights.push(1.0);
    }
  }
  const weightSum = weights.reduce((acc, w) => acc + w, 0) || totalSlices;

  const slices: OrderSliceSchedule[] = [];
  let allocatedUsdt = 0;

  for (let i = 0; i < totalSlices; i++) {
    const isLast = i === totalSlices - 1;
    const rawSliceUsdt = isLast
      ? totalAmountUsdt - allocatedUsdt
      : (totalAmountUsdt * weights[i]) / weightSum;
    const sliceUsdt = Math.max(0, Math.round(rawSliceUsdt * 100) / 100);
    allocatedUsdt += sliceUsdt;
    const sliceVes = Math.round(sliceUsdt * currentMidPrice * 100) / 100;

    slices.push({
      sliceIndex: i + 1,
      scheduledMinutesOffset: i * sliceIntervalMinutes,
      sliceAmountUsdt: sliceUsdt,
      sliceAmountVes: sliceVes,
      targetPrice: currentMidPrice,
      participationRatePct:
        Math.round(
          (sliceUsdt / Math.max(1, (safeHourlyVol / 60) * sliceIntervalMinutes)) * 1000,
        ) / 10,
    });
  }

  const expectedMarketImpactPct =
    Math.round(0.4 * Math.sqrt(Math.max(0, participationRate) / 100) * 100) / 100;

  return {
    slices,
    totalSlices,
    averageSliceAmountUsdt: Math.round((totalAmountUsdt / totalSlices) * 100) / 100,
    sliceIntervalMinutes,
    expectedMarketImpactPct,
    executionAlgorithm: algorithm,
    summary: `Ejecución fragmentada en ${totalSlices} bloques cada ${sliceIntervalMinutes}m (${algorithm}). Tasa de participación: ${participationRate.toFixed(1)}%. Deslizamiento esperado: ${expectedMarketImpactPct}%.`,
  };
}

export interface MarkovFillProbabilityInput {
  queuePositionIndex: number;
  queueAheadVolumeUsdt: number;
  recentFillVelocityPerMinuteUsdt: number;
  orderCancellationRatePct?: number;
  targetHorizonMinutes?: number;
}

export interface MarkovFillProbabilityResult {
  queuePosition: number;
  queueAheadVolumeUsdt: number;
  effectiveQueueAheadUsdt: number;
  fillProbabilityInHorizonPct: number;
  expectedFillDurationMinutes: number;
  urgencyState:
    'INSTANT_FILL_PROBABLE' | 'HEALTHY_EXECUTION' | 'CONGESTED_QUEUE' | 'DEAD_ORDER_ZONE';
  recommendedPricingAdjustment: number;
}

/**
 * Estima la probabilidad estocástica de llenado de una orden pasiva (Maker)
 * mediante modelado de colas y procesos markovianos de absorción de liquidez.
 */
export function calculateMakerFillProbabilityMarkov(
  input: MarkovFillProbabilityInput,
): MarkovFillProbabilityResult {
  const {
    queuePositionIndex,
    queueAheadVolumeUsdt,
    recentFillVelocityPerMinuteUsdt,
    orderCancellationRatePct = 20,
    targetHorizonMinutes = 15,
  } = input;

  const cancellationDiscount = 1 - Math.max(0, Math.min(0.8, orderCancellationRatePct / 100));
  const effectiveQueue = queueAheadVolumeUsdt * cancellationDiscount;

  const velocity = Math.max(1, recentFillVelocityPerMinuteUsdt);
  const expectedFillDurationMinutes = Math.round((effectiveQueue / velocity) * 10) / 10;

  const lambda = velocity / Math.max(10, effectiveQueue);
  const rawProb = (1 - Math.exp(-lambda * targetHorizonMinutes)) * 100;
  const fillProbabilityInHorizonPct = Math.round(Math.min(99.9, Math.max(1.0, rawProb)) * 10) / 10;

  let urgencyState: MarkovFillProbabilityResult['urgencyState'] = 'HEALTHY_EXECUTION';
  let recommendedPricingAdjustment = 0;

  if (queuePositionIndex === 0 || fillProbabilityInHorizonPct >= 85) {
    urgencyState = 'INSTANT_FILL_PROBABLE';
  } else if (
    fillProbabilityInHorizonPct < 30 ||
    expectedFillDurationMinutes > targetHorizonMinutes * 2
  ) {
    urgencyState = 'DEAD_ORDER_ZONE';
    recommendedPricingAdjustment = 0.05;
  } else if (fillProbabilityInHorizonPct < 55) {
    urgencyState = 'CONGESTED_QUEUE';
    recommendedPricingAdjustment = 0.02;
  }

  return {
    queuePosition: queuePositionIndex + 1,
    queueAheadVolumeUsdt,
    effectiveQueueAheadUsdt: Math.round(effectiveQueue * 100) / 100,
    fillProbabilityInHorizonPct,
    expectedFillDurationMinutes,
    urgencyState,
    recommendedPricingAdjustment,
  };
}
