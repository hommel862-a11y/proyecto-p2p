/**
 * Capital Bracket Scanner & Institutional OTC Whale Detector.
 * Implements:
 * 1. Capital Brackets: "Inframundo" (5k-15k VES), "Medio" (50k-120k VES), "Institucional" (250k-300k VES).
 * 2. $20 USD safety floor against dust manipulation.
 * 3. Promoted/sponsored advertisement filters.
 * 4. OTC Whale Block detection ($100k-$500k USD) with liquidity absorption insights.
 * Framework-agnostic, pure TypeScript.
 */

import { type BinanceOfferSummary } from './binance-p2p';
import { roundMoney } from './money';

export type BracketId = 'INFRAMUNDO' | 'MEDIO' | 'INSTITUCIONAL';

export interface CapitalBracketConfig {
  id: BracketId;
  name: string;
  minVes: number;
  maxVes: number;
  targetNetSpreadMinPct: number;
  targetNetSpreadMaxPct: number;
  description: string;
  rotationProfile: string;
}

export const CAPITAL_BRACKETS: Record<BracketId, CapitalBracketConfig> = {
  INFRAMUNDO: {
    id: 'INFRAMUNDO',
    name: 'Tramo 1 (Inframundo)',
    minVes: 5000,
    maxVes: 15000,
    targetNetSpreadMinPct: 2.0,
    targetNetSpreadMaxPct: 3.5,
    description: 'Micro-lotes de alta rotación donde la competencia es menor y se capturan márgenes amplios.',
    rotationProfile: 'Alta Rotación (hasta 166 ops/día)',
  },
  MEDIO: {
    id: 'MEDIO',
    name: 'Tramo 2 (Medio)',
    minVes: 50000,
    maxVes: 120000,
    targetNetSpreadMinPct: 1.2,
    targetNetSpreadMaxPct: 1.8,
    description: 'Tickets medianos con velocidad balanceada y excelente ratio de rotación/comisiones.',
    rotationProfile: 'Velocidad Media',
  },
  INSTITUCIONAL: {
    id: 'INSTITUCIONAL',
    name: 'Tramo 3 (Institucional/Alto)',
    minVes: 250000,
    maxVes: 300000,
    targetNetSpreadMinPct: 0.8,
    targetNetSpreadMaxPct: 1.2,
    description: 'Volumen masivo para liquidación mayorista con spreads competitivos.',
    rotationProfile: 'Volumen Masivo',
  },
};

export interface BracketFilterOptions {
  /** Approximate exchange rate (VES per USD) to enforce the $20 USD safety floor */
  exchangeRateVesPerUsd?: number;
  /** Minimum order size in USD to discard micro-orders/dust (default: 20 USD) */
  minSafetyFloorUsd?: number;
  /** Discard ads flagged as promoted or sponsored */
  filterPromoted?: boolean;
}

export interface FilteredBracketResult {
  bracket: CapitalBracketConfig;
  offers: BinanceOfferSummary[];
  purgedDustCount: number;
  purgedPromotedCount: number;
  bestPrice: number;
  totalVolumeVes: number;
}

/**
 * Filters orderbook offers based on a selected capital bracket and applies anti-manipulation rules.
 */
export function filterOffersByBracket(
  offers: readonly BinanceOfferSummary[],
  bracketId: BracketId,
  options: BracketFilterOptions = {},
): FilteredBracketResult {
  const bracket = CAPITAL_BRACKETS[bracketId];
  const rate = options.exchangeRateVesPerUsd && options.exchangeRateVesPerUsd > 0 ? options.exchangeRateVesPerUsd : 70;
  const safetyFloorUsd = options.minSafetyFloorUsd ?? 20;
  const minSafetyFloorVes = safetyFloorUsd * rate;
  const filterPromoted = options.filterPromoted ?? true;

  let purgedDustCount = 0;
  let purgedPromotedCount = 0;

  const filtered = offers.filter((o) => {
    // 1. Promoted / sponsored filter (Binance tags or bait markers)
    if (filterPromoted && (o.merchantName?.toLowerCase().includes('promoted') || o.merchantName?.toLowerCase().includes('patrocinado'))) {
      purgedPromotedCount++;
      return false;
    }

    // 2. $20 USD safety floor: maximum order capacity must be at least the safety floor
    if (o.maxVes < minSafetyFloorVes) {
      purgedDustCount++;
      return false;
    }

    // 3. Bracket range intersection: offer must overlap with [minVes, maxVes]
    const overlaps = o.maxVes >= bracket.minVes && o.minVes <= bracket.maxVes;
    return overlaps;
  });

  const bestPrice = filtered.length > 0 ? filtered[0].price : 0;
  const totalVolumeVes = filtered.reduce((acc, o) => acc + o.maxVes, 0);

  return {
    bracket,
    offers: filtered,
    purgedDustCount,
    purgedPromotedCount,
    bestPrice,
    totalVolumeVes: roundMoney(totalVolumeVes, 2),
  };
}

// ---------------------------------------------------------------------------
// Institutional OTC Whale Detection
// ---------------------------------------------------------------------------

export interface OtcWhaleBlock {
  advNo: string;
  merchantName: string;
  price: number;
  volumeVes: number;
  estimatedVolumeUsd: number;
  shareOfTopDepthPct: number;
}

export interface OtcWhaleReport {
  whaleDetected: boolean;
  totalWhaleVolumeUsd: number;
  whaleBlocks: OtcWhaleBlock[];
  recommendedAction: 'ANTICIPATE_PRICE_SURGE' | 'PAUSE_BUYS_PHANTOM_CORRECTION' | 'NORMAL_MARKET_MONITORING';
  rationale: string;
}

/**
 * Detects massive institutional OTC blocks ($100k-$500k USD) inside the active order book.
 * Generates reactionary tactical guidance to avoid getting caught on the wrong side of liquidity dumps.
 */
export function detectOtcWhaleBlocks(
  offers: readonly BinanceOfferSummary[],
  exchangeRateVesPerUsd = 70,
  thresholdUsd = 100000,
): OtcWhaleReport {
  if (!offers || offers.length === 0 || exchangeRateVesPerUsd <= 0) {
    return {
      whaleDetected: false,
      totalWhaleVolumeUsd: 0,
      whaleBlocks: [],
      recommendedAction: 'NORMAL_MARKET_MONITORING',
      rationale: 'Libro de órdenes sin volumen institucional anómalo detectado.',
    };
  }

  const top10VolumeVes = offers.slice(0, 10).reduce((acc, o) => acc + o.maxVes, 0);

  const whaleBlocks: OtcWhaleBlock[] = [];
  let totalWhaleVolumeUsd = 0;

  for (const o of offers) {
    const volUsd = o.maxVes / exchangeRateVesPerUsd;
    if (volUsd >= thresholdUsd) {
      const share = top10VolumeVes > 0 ? roundMoney((o.maxVes / top10VolumeVes) * 100, 1) : 0;
      whaleBlocks.push({
        advNo: o.advNo,
        merchantName: o.merchantName,
        price: o.price,
        volumeVes: roundMoney(o.maxVes, 2),
        estimatedVolumeUsd: roundMoney(volUsd, 2),
        shareOfTopDepthPct: share,
      });
      totalWhaleVolumeUsd += volUsd;
    }
  }

  const whaleDetected = whaleBlocks.length > 0;
  let recommendedAction: OtcWhaleReport['recommendedAction'] = 'NORMAL_MARKET_MONITORING';
  let rationale = 'Libro de órdenes con flujo minorista normal.';

  if (whaleDetected) {
    if (totalWhaleVolumeUsd >= 250000) {
      recommendedAction = 'PAUSE_BUYS_PHANTOM_CORRECTION';
      rationale = `Irrupción de súper-bloques institucionales (${whaleBlocks.length} órdenes, \$${roundMoney(totalWhaleVolumeUsd, 0).toLocaleString()} USD). Alta probabilidad de liquidez fantasma o absorción violenta. Pausar compras y esperar corrección.`;
    } else {
      recommendedAction = 'ANTICIPATE_PRICE_SURGE';
      rationale = `Detección de absorción institucional por \$${roundMoney(totalWhaleVolumeUsd, 0).toLocaleString()} USD. Anticipar subida temporal de precio y ajustar postura de venta en picos.`;
    }
  }

  return {
    whaleDetected,
    totalWhaleVolumeUsd: roundMoney(totalWhaleVolumeUsd, 2),
    whaleBlocks,
    recommendedAction,
    rationale,
  };
}
