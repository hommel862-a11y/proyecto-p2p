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
   * Genera el reporte de spoofing y liquidez fantasma para el estado actual.
   */
  generateSpoofReport(nowMs = Date.now()): SpoofReport {
    const orders = Array.from(this.tracked.values());
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
      // Anuncios con vida muy corta (< 75s) que desaparecen o tienen precio agresivo con reputación deficiente
      if (activeAgeSec < 75 && (isDisappeared || order.finishRatePct < 85 || volumeRatio > 2.0)) {
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
  const report = tracker.generateSpoofReport(nowMs);
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

  const q = currentInventoryUsdt - targetInventoryUsdt;
  const sigmaSquared = Math.pow(volatilityDaily, 2);
  const timeHorizon = Math.max(0.01, Math.min(1.0, timeRemainingFraction));

  // Reservation Price: r(s, q, t) = s - q * gamma * sigma^2 * (T - t)
  const inventoryDiscount = q * riskAversionGamma * sigmaSquared * timeHorizon * midPrice;
  const reservationPrice = midPrice - inventoryDiscount;

  // Optimal spread: s = (2 / gamma) * ln(1 + gamma / kappa)
  const baseSpread =
    (2 / riskAversionGamma) *
    Math.log(1 + riskAversionGamma / Math.max(0.01, orderbookLiquidityDensityK));
  const optimalHalfSpread = (baseSpread * midPrice) / 200; // Ajustado a porcentaje de precio

  const optimalBidPrice = Math.round((reservationPrice - optimalHalfSpread) * 100) / 100;
  const optimalAskPrice = Math.round((reservationPrice + optimalHalfSpread) * 100) / 100;

  let recommendedAction: AvellanedaStoikovResult['recommendedAction'] = 'HOLD';
  const inventoryRatio = targetInventoryUsdt > 0 ? q / targetInventoryUsdt : 0;

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

  let totalAbsoluteOrderImbalance = 0;
  let totalVolume = 0;
  let toxicCount = 0;

  for (const b of buckets) {
    const imbalance = Math.abs(b.buyVolume - b.sellVolume);
    totalAbsoluteOrderImbalance += imbalance;
    totalVolume += b.totalVolume;
    if (b.totalVolume > 0 && imbalance / b.totalVolume >= toxicityThreshold) {
      toxicCount++;
    }
  }

  const vpinScore =
    totalVolume > 0 ? Math.round((totalAbsoluteOrderImbalance / totalVolume) * 1000) / 1000 : 0.1;

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
    algorithm = 'TWAP',
  } = input;

  const durationHours = executionDurationMinutes / 60;
  const projectedTotalMarketVolume = estimatedMarketVolumePerHourUsdt * durationHours;

  const participationRate =
    projectedTotalMarketVolume > 0 ? (totalAmountUsdt / projectedTotalMarketVolume) * 100 : 100;

  const targetSliceSize = Math.max(300, Math.min(2500, totalAmountUsdt / 5));
  const rawSlices = Math.ceil(totalAmountUsdt / targetSliceSize);
  const totalSlices = Math.max(3, Math.min(24, rawSlices));
  const sliceIntervalMinutes = Math.max(2, Math.round(executionDurationMinutes / totalSlices));

  const slices: OrderSliceSchedule[] = [];
  const baseSliceUsdt = totalAmountUsdt / totalSlices;

  for (let i = 0; i < totalSlices; i++) {
    let weight = 1.0;
    if (algorithm === 'VWAP') {
      const normalizedTime = (i / (totalSlices - 1 || 1)) * 2 - 1;
      weight = 0.8 + 0.4 * Math.pow(normalizedTime, 2);
    }

    const sliceUsdt = Math.round(baseSliceUsdt * weight * 100) / 100;
    const sliceVes = Math.round(sliceUsdt * currentMidPrice * 100) / 100;

    slices.push({
      sliceIndex: i + 1,
      scheduledMinutesOffset: i * sliceIntervalMinutes,
      sliceAmountUsdt: sliceUsdt,
      sliceAmountVes: sliceVes,
      targetPrice: currentMidPrice,
      participationRatePct:
        Math.round(
          (sliceUsdt /
            Math.max(1, (estimatedMarketVolumePerHourUsdt / 60) * sliceIntervalMinutes)) *
            1000,
        ) / 10,
    });
  }

  const expectedMarketImpactPct = Math.round(0.4 * Math.sqrt(participationRate / 100) * 100) / 100;

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
