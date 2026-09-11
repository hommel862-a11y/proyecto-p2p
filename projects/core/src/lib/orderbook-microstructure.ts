/**
 * Microestructura del Libro P2P — Detección de Spoofing, Liquidez Fantasma y Persistencia de Órdenes.
 * Diseñado para detectar manipulación algorítmica de libros de órdenes P2P venezolanos (Binance/Bybit).
 * Lógica pura, framework-agnostic.
 */

import { type BinanceOfferSummary } from './binance-p2p';
import { computeVolumeWeightedPrice, type JohnsonDepthOptions } from './johnson-depth';

export type SpoofCategory = 'LEGITIMATE' | 'SUSPICIOUS_HIGH_TURNOVER' | 'PHANTOM_LIQUIDITY' | 'SPOOF_BAIT';

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
  ingestSnapshot(offers: readonly BinanceOfferSummary[], side: 'BUY' | 'SELL', nowMs = Date.now()): void {
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
      const volumeRatio = medianVolumeVes > 0 ? order.maxVes / medianVolumeVes : order.maxVes / avgVolumeVes;

      // 1. Detección de Liquidez Fantasma (Phantom Liquidity)
      // Muro de volumen masivo (> 4x mediana o > 400,000 VES) que desaparece rápidamente sin completar órdenes
      if ((volumeRatio >= 4.0 || order.maxVes >= 400000) && isDisappeared && activeAgeSec <= 150 && executedTrades === 0) {
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
