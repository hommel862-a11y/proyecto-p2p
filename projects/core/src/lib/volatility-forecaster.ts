/**
 * 2-Hour Exchange Volatility & Spread Predictor Engine.
 * Combines orderbook microstructure velocity, depth imbalance, spoofing risk,
 * and Central Bank of Venezuela (BCV) intervention cycles to forecast
 * high-frequency volatility, spread drift, and optimal merchant quoting premiums.
 * Pure TypeScript, framework-agnostic, zero dependencies.
 */

import { type BcvGapAnalysis, type BcvPredictorWindow } from './bcv-intervention-predictor';
import { type SpoofReport } from './orderbook-microstructure';

export type VolatilityLevel = 'LOW' | 'NORMAL' | 'ELEVATED' | 'EXTREME';
export type SpreadDriftDirection = 'EXPANDING' | 'COMPRESSING' | 'STABLE';
export type LiquidityRiskLevel = 'SAFE' | 'THINNING' | 'IMMINENT_DRAIN';

export interface PriceTick {
  timestampMs: number;
  buyPrice: number;
  sellPrice: number;
  depthVes?: number;
}

export interface VolatilityForecastInput {
  recentTicks: PriceTick[];
  currentSpreadPct: number;
  bcvGap?: BcvGapAnalysis;
  bcvWindow?: BcvPredictorWindow;
  spoofReport?: SpoofReport;
  bidDepthUsdt?: number;
  askDepthUsdt?: number;
}

export interface VolatilityForecastResult {
  forecastWindowHours: number; // typically 2
  volatilityIndex: number; // 0 to 100
  level: VolatilityLevel;
  direction: SpreadDriftDirection;
  expectedSpreadDriftBps: number; // Basis points (-100 to +300)
  suggestedSpreadAdjustmentPct: {
    buyMarkupPct: number; // Adjustment to buy price (e.g. -0.30% to widen cushion)
    sellMarkupPct: number; // Adjustment to sell price (e.g. +0.45% to capture drift)
  };
  liquidityRisk: LiquidityRiskLevel;
  confidenceScorePct: number; // 0 to 100
  drivers: string[];
  actionableGuidance: string;
}

/**
 * Computes annualized or windowed price velocity and variance from recent price ticks.
 */
export function computeTickVelocity(ticks: PriceTick[]): {
  midPriceVelocityPctPerHour: number;
  spreadStandardDeviation: number;
  priceAcceleration: number;
} {
  if (ticks.length < 2) {
    return {
      midPriceVelocityPctPerHour: 0,
      spreadStandardDeviation: 0,
      priceAcceleration: 0,
    };
  }

  const sorted = [...ticks].sort((a, b) => a.timestampMs - b.timestampMs);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const timeDeltaHours = Math.max((last.timestampMs - first.timestampMs) / 3600000, 0.01);

  const firstMid = (first.buyPrice + first.sellPrice) / 2;
  const lastMid = (last.buyPrice + last.sellPrice) / 2;

  const midPriceVelocityPctPerHour =
    firstMid > 0 ? ((lastMid - firstMid) / firstMid) * 100 / timeDeltaHours : 0;

  // Spread standard deviation
  const spreads = sorted.map((t) =>
    t.sellPrice > 0 ? ((t.buyPrice - t.sellPrice) / t.sellPrice) * 100 : 0,
  );
  const meanSpread = spreads.reduce((acc, val) => acc + val, 0) / spreads.length;
  const variance =
    spreads.reduce((acc, val) => acc + Math.pow(val - meanSpread, 2), 0) / spreads.length;
  const spreadStandardDeviation = Math.sqrt(variance);

  // Acceleration: compare second half velocity to first half
  let priceAcceleration = 0;
  if (sorted.length >= 4) {
    const midIdx = Math.floor(sorted.length / 2);
    const midTick = sorted[midIdx];
    const midMid = (midTick.buyPrice + midTick.sellPrice) / 2;
    const h1Delta = Math.max((midTick.timestampMs - first.timestampMs) / 3600000, 0.005);
    const h2Delta = Math.max((last.timestampMs - midTick.timestampMs) / 3600000, 0.005);
    const v1 = ((midMid - firstMid) / firstMid) * 100 / h1Delta;
    const v2 = ((lastMid - midMid) / midMid) * 100 / h2Delta;
    priceAcceleration = v2 - v1;
  }

  return {
    midPriceVelocityPctPerHour,
    spreadStandardDeviation,
    priceAcceleration,
  };
}

/**
 * Generates institutional 2-hour exchange volatility forecast.
 */
export function predictTwoHourVolatility(input: VolatilityForecastInput): VolatilityForecastResult {
  const drivers: string[] = [];
  let score = 20; // Baseline calm volatility

  // 1. Tick Dynamics
  const velocity = computeTickVelocity(input.recentTicks);
  const absVelocity = Math.abs(velocity.midPriceVelocityPctPerHour);

  if (absVelocity > 1.5) {
    score += 25;
    drivers.push(`Fuerte velocidad de precio paralelo: ${velocity.midPriceVelocityPctPerHour > 0 ? '+' : ''}${velocity.midPriceVelocityPctPerHour.toFixed(2)}%/hora`);
  } else if (absVelocity > 0.6) {
    score += 15;
    drivers.push(`Deriva moderada de cotizaciones: ${velocity.midPriceVelocityPctPerHour.toFixed(2)}%/hora`);
  }

  if (velocity.spreadStandardDeviation > 0.4) {
    score += 15;
    drivers.push(`Inestabilidad en el spread del libro (σ = ${velocity.spreadStandardDeviation.toFixed(2)}%)`);
  }

  // 2. Depth Imbalance
  let liquidityRisk: LiquidityRiskLevel = 'SAFE';
  if (input.bidDepthUsdt !== undefined && input.askDepthUsdt !== undefined) {
    const totalDepth = input.bidDepthUsdt + input.askDepthUsdt;
    if (totalDepth > 0) {
      const bidRatio = input.bidDepthUsdt / totalDepth;
      if (bidRatio > 0.75) {
        score += 15;
        drivers.push(`Fuerte desbalance comprador (75%+ órdenes en Bid) — Presión alcista`);
      } else if (bidRatio < 0.25) {
        score += 15;
        drivers.push(`Libro cargado hacia la oferta (75%+ órdenes en Ask) — Resistencia`);
      }

      if (totalDepth < 5000) {
        liquidityRisk = 'IMMINENT_DRAIN';
        score += 20;
        drivers.push(`Profundidad crítica total menor a 5,000 USDT — Alto riesgo de slippage`);
      } else if (totalDepth < 15000) {
        liquidityRisk = 'THINNING';
        score += 10;
        drivers.push(`Profundidad de liquidez por debajo del promedio operativo`);
      }
    }
  }

  // 3. BCV Intervention Cycle Dynamics
  if (input.bcvWindow) {
    if (input.bcvWindow.phase === 'INTERVENTION_ACTIVE') {
      score += 25;
      drivers.push(`Ventana de inyección de divisas BCV activa (${input.bcvWindow.probabilityPct}% prob)`);
    } else if (input.bcvWindow.phase === 'PRE_INTERVENTION_COMPRESSION') {
      score += 10;
      drivers.push(`Fase previa a subasta bancaria: compresión artificial del tipo de cambio`);
    } else if (input.bcvWindow.phase === 'POST_INTERVENTION_REBOUND') {
      score += 20;
      drivers.push(`Fase de rebote post-intervención: absorción rápida de liquidez en bolívares`);
    }
  }

  // 4. BCV Gap Zone
  if (input.bcvGap) {
    if (input.bcvGap.zone === 'CRITICAL_DISPERSION') {
      score += 25;
      drivers.push(`Brecha Paralelo vs BCV en dispersión crítica (${input.bcvGap.gapPct.toFixed(1)}%)`);
    } else if (input.bcvGap.zone === 'ELEVATED') {
      score += 10;
      drivers.push(`Brecha cambiaria por encima del promedio histórico`);
    }
  }

  // 5. Spoofing & Orderbook Manipulation
  if (input.spoofReport && input.spoofReport.manipulationRiskScore > 40) {
    score += 15;
    drivers.push(`Manipulación detectada en microestructura (Riesgo Spoof: ${input.spoofReport.manipulationRiskScore}/100)`);
  }

  // Normalize final score between 5 and 100
  const finalScore = Math.min(Math.max(score, 5), 100);

  // Classify Level
  let level: VolatilityLevel = 'LOW';
  if (finalScore >= 75) {
    level = 'EXTREME';
  } else if (finalScore >= 50) {
    level = 'ELEVATED';
  } else if (finalScore >= 30) {
    level = 'NORMAL';
  }

  // Determine Spread Drift Direction & Expected bps
  let direction: SpreadDriftDirection = 'STABLE';
  let expectedSpreadDriftBps = 0;

  if (level === 'EXTREME') {
    direction = 'EXPANDING';
    expectedSpreadDriftBps = 85; // +0.85% spread widening
  } else if (level === 'ELEVATED') {
    direction = 'EXPANDING';
    expectedSpreadDriftBps = 45; // +0.45%
  } else if (level === 'NORMAL') {
    if (input.bcvWindow?.phase === 'PRE_INTERVENTION_COMPRESSION') {
      direction = 'COMPRESSING';
      expectedSpreadDriftBps = -20;
    } else {
      direction = 'STABLE';
      expectedSpreadDriftBps = 5;
    }
  } else {
    direction = 'COMPRESSING';
    expectedSpreadDriftBps = -15;
  }

  // Suggested spread adjustments for merchant quoting
  let buyMarkupPct = 0;
  let sellMarkupPct = 0;

  if (level === 'EXTREME') {
    buyMarkupPct = -0.50; // Discount bids to avoid getting caught on sudden drop
    sellMarkupPct = +0.65; // Raise asks to harvest volatility
  } else if (level === 'ELEVATED') {
    buyMarkupPct = -0.25;
    sellMarkupPct = +0.35;
  } else if (level === 'NORMAL') {
    buyMarkupPct = -0.10;
    sellMarkupPct = +0.10;
  } else {
    buyMarkupPct = 0;
    sellMarkupPct = 0;
  }

  // Actionable Guidance
  let actionableGuidance = '';
  if (level === 'EXTREME') {
    actionableGuidance = 'Pausar órdenes pasivas o ampliar spread en +80 bps. No mantener inventario en VES mayor a 15 minutos.';
  } else if (level === 'ELEVATED') {
    actionableGuidance = 'Ajustar cotizaciones: reducir precio de compra un 0.25% y aumentar venta un 0.35% para proteger margen.';
  } else if (level === 'NORMAL') {
    actionableGuidance = 'Condiciones operativas regulares. Spread estándar suficiente para rotación normal.';
  } else {
    actionableGuidance = 'Baja volatilidad: oportunidad de estrechar spread para maximizar volumen y captura de flujo.';
  }

  const confidenceScorePct = Math.min(
    Math.max(
      (input.recentTicks.length > 5 ? 40 : 20) +
        (input.bcvWindow ? 30 : 10) +
        (input.spoofReport ? 20 : 0) +
        (input.bidDepthUsdt !== undefined ? 10 : 0),
      40,
    ),
    95,
  );

  return {
    forecastWindowHours: 2,
    volatilityIndex: finalScore,
    level,
    direction,
    expectedSpreadDriftBps,
    suggestedSpreadAdjustmentPct: {
      buyMarkupPct,
      sellMarkupPct,
    },
    liquidityRisk,
    confidenceScorePct,
    drivers: drivers.length > 0 ? drivers : ['Parámetros de mercado dentro de rangos normales de estabilidad'],
    actionableGuidance,
  };
}
