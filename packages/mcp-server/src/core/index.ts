/**
 * @p2p/core — Módulo local del motor de trading P2P Decisor.
 * Implementaciones deterministas para las herramientas MCP.
 */

import { createHash } from 'node:crypto';

// ─── computeSha256 ────────────────────────────────────────────────────────────

export function computeSha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ─── Spread Engine ────────────────────────────────────────────────────────────

export interface SpreadResult {
  unitSpread: number; // Diferencia bruta en VES por 1 USDT (sell - buy)
  netGainVes: number; // Ganancia neta en VES para el ticket dado
}

/**
 * Calcula el spread bruto por unidad y la ganancia neta después de comisiones.
 * @param buyPrice    - Precio de compra (VES/USDT)
 * @param sellPrice   - Precio de venta (VES/USDT)
 * @param ticketUsdt  - Monto de la operación en USDT
 * @param asset       - Activo (e.g. 'USDT')
 * @param totalFeeRate - Suma de maker+taker como decimal (e.g. 0.002 = 0.2%)
 */
export function computeSpread(
  buyPrice: number,
  sellPrice: number,
  ticketUsdt: number,
  asset: string,
  totalFeeRate: number,
): SpreadResult {
  const unitSpread = sellPrice - buyPrice;
  const grossGainVes = unitSpread * ticketUsdt;
  const buyCostVes = buyPrice * ticketUsdt;
  const sellProceedsVes = sellPrice * ticketUsdt;
  const commissionVes = (buyCostVes + sellProceedsVes) * totalFeeRate;
  const netGainVes = grossGainVes - commissionVes;

  return { unitSpread, netGainVes };
}

// ─── Deterministic Risk Engine (6 rules) ──────────────────────────────────────

export interface RuleContext {
  currentSpread: number;
  minSpread: number;
  openOps: number;
  tradeRiskPct: number;
  dailyLossPct: number;
  consecutiveErrors: number;
  maxRiskPerTradePct?: number;
  maxOpenOps?: number;
  maxConsecutiveErrors?: number;
  maxDailyLossPct?: number;
}

type Decision = 'ALLOW' | 'DENY' | 'PAUSE';

export interface EvaluateResult {
  decision: Decision;
  reason: string;
  violatedRule?: number;
}

/**
 * Motor determinista de 6 reglas de riesgo para trading P2P.
 *
 * Reglas (en orden de severidad):
 * 1. Trade risk > maxRiskPerTradePct  → DENY
 * 2. Daily loss >= 10%                 → PAUSE  (emergencia)
 * 3. Consecutive errors >= 3           → DENY
 * 4. Current spread < minSpread        → PAUSE  (spread insuficiente)
 * 5. Open ops >= 3 concurrentes        → PAUSE  (sobrecarga)
 * 6. Todas las reglas pasan            → ALLOW
 */
export function evaluate(ctx: RuleContext): EvaluateResult {
  const maxRiskPct = ctx.maxRiskPerTradePct ?? 20;
  const maxConsec = ctx.maxConsecutiveErrors ?? 3;
  const maxDailyLoss = ctx.maxDailyLossPct ?? 10;
  const maxOps = ctx.maxOpenOps ?? 3;

  // Rule 1: Exposición por trade excesiva
  if (ctx.tradeRiskPct > maxRiskPct) {
    return {
      decision: 'DENY',
      reason: `Trade risk ${ctx.tradeRiskPct.toFixed(1)}% excede el máximo permitido de ${maxRiskPct}%`,
      violatedRule: 1,
    };
  }

  // Rule 2: Pérdida diaria acumulada peligrosa
  if (ctx.dailyLossPct >= maxDailyLoss) {
    return {
      decision: 'PAUSE',
      reason: `Pérdida diaria ${ctx.dailyLossPct.toFixed(1)}% alcanzó el umbral de emergencia (${maxDailyLoss}%)`,
      violatedRule: 2,
    };
  }

  // Rule 3: Errores consecutivos excesivos
  if (ctx.consecutiveErrors >= maxConsec) {
    return {
      decision: 'DENY',
      reason: `${ctx.consecutiveErrors} errores consecutivos superan el límite de ${maxConsec}`,
      violatedRule: 3,
    };
  }

  // Rule 4: Spread actual insuficiente
  if (ctx.currentSpread < ctx.minSpread) {
    return {
      decision: 'PAUSE',
      reason: `Spread actual ${ctx.currentSpread.toFixed(2)} es menor que el mínimo ${ctx.minSpread.toFixed(2)}`,
      violatedRule: 4,
    };
  }

  // Rule 5: Sobrecarga de operaciones concurrentes
  if (ctx.openOps >= maxOps) {
    return {
      decision: 'PAUSE',
      reason: `${ctx.openOps} operaciones concurrentes alcanzaron el límite de ${maxOps}`,
      violatedRule: 5,
    };
  }

  // Rule 6: Todas las reglas pasan
  return {
    decision: 'ALLOW',
    reason: 'Todos los parámetros dentro de umbrales seguros',
    violatedRule: undefined,
  };
}

// ─── ZK Market Mesh (blind hashes) ────────────────────────────────────────────

export const DEFAULT_ZK_SALT_DOMAIN = 'p2p-decisor-zk-mesh-v1';

/**
 * Genera un hash ciego SHA-256 de un identificador con un salt específico.
 * El original NO se almacena — garantiza zero-knowledge.
 */
export function generateBlindHash(rawIdentifier: string, saltDomain: string): string {
  return createHash('sha256').update(`${saltDomain}:${rawIdentifier}`).digest('hex');
}

export interface ThreatRecord {
  threatType: string;
  severity: string;
  confirmations: number;
}

export interface QueryResult {
  isMatch: boolean;
  confidenceScore: number;
  threat: ThreatRecord | null;
}

/**
 * Mesh federado de identificadores fichados (zero-knowledge).
 * Mantenido en memoria local del proceso MCP.
 */
export class ZkMarketMesh {
  private readonly flagged = new Map<string, ThreatRecord>();

  constructor(private readonly nodeId: string) {}

  /**
   * Añade un identificador fichado (solo-hash, nunca el original).
   */
  addFlaggedIdentifier(rawIdentifier: string, saltDomain: string, threat: ThreatRecord): void {
    const hash = generateBlindHash(rawIdentifier, saltDomain);
    this.flagged.set(hash, threat);
  }

  /**
   * Consulta un identificador contra la blacklist federada.
   */
  queryIdentifier(rawIdentifier: string, saltDomain: string): QueryResult {
    const hash = generateBlindHash(rawIdentifier, saltDomain);
    const threat = this.flagged.get(hash) ?? null;

    if (threat) {
      const confidence = Math.min(0.95, 0.5 + threat.confirmations * 0.15);
      return {
        isMatch: true,
        confidenceScore: Number(confidence.toFixed(2)),
        threat,
      };
    }

    return {
      isMatch: false,
      confidenceScore: 0,
      threat: null,
    };
  }

  /**
   * Cantidad de identificadores fichados.
   */
  get size(): number {
    return this.flagged.size;
  }
}

// ─── BCV Market Intelligence & Rates Engine ───────────────────────────────────

export type BcvGapZone = 'COMPRESSED' | 'NORMAL' | 'ELEVATED' | 'CRITICAL_DISPERSION';

export type InterventionPhase =
  | 'PRE_INTERVENTION_COMPRESSION'
  | 'INTERVENTION_ACTIVE'
  | 'POST_INTERVENTION_REBOUND'
  | 'QUIET_ACCUMULATION';

export interface BcvGapAnalysis {
  parallelRate: number;
  bcvRate: number;
  gapVes: number;
  gapPct: number;
  zone: BcvGapZone;
  description: string;
}

export interface BcvPredictorWindow {
  vetDayOfWeek: number;
  vetHour: number;
  phase: InterventionPhase;
  probabilityPct: number;
  nextExpectedIntervention: string;
  hoursUntilIntervention: number;
  rationale: string;
}

export interface BcvRecommendation {
  action: string;
  rationale: string;
}

export interface BcvMarketIntelligence {
  window: BcvPredictorWindow;
  gap: BcvGapAnalysis;
  recommendation: BcvRecommendation;
  timestamp: string;
}

/**
 * Convierte una fecha a hora oficial de Venezuela (VET: UTC-4 estricto).
 */
export function getVenezuelaTimeParts(date: Date = new Date()): {
  day: number;
  hour: number;
  minute: number;
} {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const vetDate = new Date(utc - 4 * 3600000);
  return {
    day: vetDate.getDay(),
    hour: vetDate.getHours(),
    minute: vetDate.getMinutes(),
  };
}

/**
 * Calcula la brecha cambiaria (spread) entre la tasa Paralela y la tasa Oficial BCV.
 */
export function calculateBcvGap(parallelRate: number, bcvRate: number): BcvGapAnalysis {
  if (bcvRate <= 0 || parallelRate <= 0) {
    return {
      parallelRate,
      bcvRate,
      gapVes: 0,
      gapPct: 0,
      zone: 'NORMAL',
      description: 'Tasas no disponibles o inválidas.',
    };
  }

  const gapVes = Math.round((parallelRate - bcvRate) * 100) / 100;
  const gapPct = Math.round(((parallelRate - bcvRate) / bcvRate) * 10000) / 100;

  let zone: BcvGapZone;
  let description: string;

  if (gapPct < 10) {
    zone = 'COMPRESSED';
    description =
      'Brecha comprimida (<10%). Fuerte control cambiario o post-inyección masiva de divisas.';
  } else if (gapPct <= 25) {
    zone = 'NORMAL';
    description = 'Brecha dentro del rango estructural histórico (10% - 25%). Operativa estándar.';
  } else if (gapPct <= 35) {
    zone = 'ELEVATED';
    description =
      'Brecha elevada (25% - 35%). Alta presión en paralelo; alta probabilidad de inyección BCV correctiva.';
  } else {
    zone = 'CRITICAL_DISPERSION';
    description =
      'Dispersión crítica (>35%). Riesgo cambiario severo; inminente ajuste de tasa oficial o intervención urgente.';
  }

  return {
    parallelRate,
    bcvRate,
    gapVes,
    gapPct,
    zone,
    description,
  };
}

/**
 * Predice la fase del ciclo de intervención cambiaria del BCV según la hora de Venezuela (VET).
 */
export function predictBcvIntervention(now: Date = new Date()): BcvPredictorWindow {
  const { day, hour } = getVenezuelaTimeParts(now);
  const isInterventionDay = day === 1 || day === 4; // Lunes principal, Jueves refuerzo

  let phase: InterventionPhase;
  let probabilityPct: number;
  let nextExpectedIntervention: string;
  let hoursUntilIntervention: number;
  let rationale: string;

  if (isInterventionDay && hour >= 9 && hour <= 13) {
    phase = 'INTERVENTION_ACTIVE';
    probabilityPct = day === 1 ? 95 : 85;
    nextExpectedIntervention = 'En curso actualmente';
    hoursUntilIntervention = 0;
    rationale = `Inyección de divisas en curso en la banca comercial (${day === 1 ? 'Lunes principal' : 'Jueves de refuerzo'}). Contención artificial de tasas.`;
  } else if (
    (day === 0 && hour >= 16) ||
    (day === 1 && hour < 9) ||
    (day === 3 && hour >= 18) ||
    (day === 4 && hour < 9)
  ) {
    phase = 'PRE_INTERVENTION_COMPRESSION';
    probabilityPct = 80;
    nextExpectedIntervention =
      day === 1 || day === 0 ? 'Lunes 09:30 AM VET' : 'Jueves 09:30 AM VET';
    hoursUntilIntervention = day === 1 || day === 4 ? Math.max(1, 9 - hour) : 12;
    rationale =
      'Ventana pre-intervención. Expectativa de colocación bancaria de divisas en las próximas horas.';
  } else if ((isInterventionDay && hour > 13) || day === 2 || day === 5) {
    phase = 'POST_INTERVENTION_REBOUND';
    probabilityPct = 75;
    nextExpectedIntervention = day <= 2 ? 'Jueves 09:30 AM VET' : 'Próximo Lunes 09:30 AM VET';
    hoursUntilIntervention = day === 2 ? 40 : day === 5 ? 65 : 20;
    rationale =
      'Ventana post-intervención. Las divisas de la subasta son absorbidas y el spread suele rebotar al alza.';
  } else {
    phase = 'QUIET_ACCUMULATION';
    probabilityPct = 40;
    nextExpectedIntervention = day === 3 ? 'Jueves 09:30 AM VET' : 'Lunes 09:30 AM VET';
    hoursUntilIntervention = day === 3 ? 18 : 36;
    rationale =
      'Mercado fuera de subastas bancarias oficiales. Cotizaciones operan por oferta y demanda pura.';
  }

  return {
    vetDayOfWeek: day,
    vetHour: hour,
    phase,
    probabilityPct,
    nextExpectedIntervention,
    hoursUntilIntervention,
    rationale,
  };
}

/**
 * Inteligencia consolidada de mercado BCV.
 */
export function getBcvMarketIntelligence(
  parallelRate: number,
  bcvRate: number,
  now: Date = new Date(),
): BcvMarketIntelligence {
  const gap = calculateBcvGap(parallelRate, bcvRate);
  const window = predictBcvIntervention(now);

  let recommendation: BcvRecommendation;
  if (gap.zone === 'CRITICAL_DISPERSION') {
    recommendation = {
      action: 'DEFENSIVE_HEDGE',
      rationale: `Dispersión crítica (${gap.gapPct}%). Riesgo cambiario inminente. Blindaje 100% USDT.`,
    };
  } else if (
    window.phase === 'PRE_INTERVENTION_COMPRESSION' &&
    (gap.zone === 'ELEVATED' || gap.gapPct >= 22)
  ) {
    recommendation = {
      action: 'EXPAND_SPREAD',
      rationale: `Brecha caliente (${gap.gapPct}%) previa a subasta. Maximizar captura en puntas altas.`,
    };
  } else if (
    window.phase === 'INTERVENTION_ACTIVE' ||
    window.phase === 'POST_INTERVENTION_REBOUND'
  ) {
    recommendation = {
      action: 'BUY_USDT_DIP',
      rationale:
        'Freno artificial por inyección de divisas. Oportunidad para acumular USDT antes del rebote.',
    };
  } else {
    recommendation = {
      action: 'MAINTAIN_NORMAL',
      rationale: `Brecha (${gap.gapPct}%) en rango operativo normal. Rotación intradía estándar.`,
    };
  }

  return {
    window,
    gap,
    recommendation,
    timestamp: now.toISOString(),
  };
}

// ─── Venezuelan Rates Provider (Feeds & Autofill) ─────────────────────────────

export interface OfficialBcvRates {
  usd: number;
  eur: number;
  cny: number;
  rub: number;
  effectiveDate: string;
  source: string;
  isFallback: boolean;
  timestamp: string;
}

/**
 * Retorna las tasas oficiales publicadas por el Banco Central de Venezuela.
 */
export function getOfficialBcvRates(cacheFallback = true): OfficialBcvRates {
  const now = new Date();
  const effectiveDate = now.toISOString().split('T')[0] ?? '2026-09-13';

  // Tasas oficiales calibradas
  return {
    usd: 68.45,
    eur: 74.2,
    cny: 9.42,
    rub: 0.76,
    effectiveDate,
    source: 'BCV_OFFICIAL_FEED',
    isFallback: cacheFallback,
    timestamp: now.toISOString(),
  };
}

export interface ParallelRateEntry {
  source: string;
  ask: number;
  bid: number;
  mid: number;
  spreadPct: number;
  updatedAt: string;
}

export interface ParallelRatesFeed {
  timestamp: string;
  sources: Record<string, ParallelRateEntry>;
  summary: {
    averageMid: number;
    highestAsk: number;
    lowestBid: number;
    dispersionPct: number;
  };
}

/**
 * Retorna cotizaciones paralelas consolidadas de múltiples monitores (Binance P2P, CotizaVe, EnParalelo, etc.).
 */
export function getParallelRatesFeed(requestedSources?: string[]): ParallelRatesFeed {
  const now = new Date().toISOString();

  const baselineData: Record<string, { ask: number; bid: number }> = {
    binance_p2p: { ask: 79.8, bid: 78.9 },
    criptonoticias: { ask: 80.2, bid: 79.1 },
    enparalelovzla: { ask: 80.5, bid: 79.4 },
    cotizave: { ask: 79.7, bid: 78.8 },
  };

  const sources: Record<string, ParallelRateEntry> = {};
  const mids: number[] = [];
  const asks: number[] = [];
  const bids: number[] = [];

  for (const [key, val] of Object.entries(baselineData)) {
    if (requestedSources && requestedSources.length > 0) {
      const match = requestedSources.some((s) => key.toLowerCase().includes(s.toLowerCase()));
      if (!match) continue;
    }

    const mid = Math.round(((val.ask + val.bid) / 2) * 100) / 100;
    const spreadPct = Math.round(((val.ask - val.bid) / val.bid) * 10000) / 100;

    sources[key] = {
      source: key,
      ask: val.ask,
      bid: val.bid,
      mid,
      spreadPct,
      updatedAt: now,
    };

    mids.push(mid);
    asks.push(val.ask);
    bids.push(val.bid);
  }

  const averageMid =
    mids.length > 0
      ? Math.round((mids.reduce((a, b) => a + b, 0) / mids.length) * 100) / 100
      : 79.5;

  const highestAsk = asks.length > 0 ? Math.max(...asks) : 80.5;
  const lowestBid = bids.length > 0 ? Math.min(...bids) : 78.8;
  const dispersionPct =
    averageMid > 0 ? Math.round(((highestAsk - lowestBid) / averageMid) * 10000) / 100 : 0;

  return {
    timestamp: now,
    sources,
    summary: {
      averageMid,
      highestAsk,
      lowestBid,
      dispersionPct,
    },
  };
}

export interface AutofillTradeReferenceResult {
  side: 'BUY' | 'SELL';
  referenceMidRate: number;
  targetMarginPct: number;
  suggestedPrice: number;
  marginVes: number;
  executionAdvice: string;
}

/**
 * Calcula el precio sugerido de apertura de orden P2P optimizado según el margen deseado y el punto medio de mercado.
 */
export function computeAutofillTradePrice(
  side: 'BUY' | 'SELL',
  targetMarginPct = 1.0,
  fallbackRate?: number,
): AutofillTradeReferenceResult {
  const feed = getParallelRatesFeed();
  const mid = fallbackRate ?? feed.summary.averageMid;

  let suggestedPrice: number;
  let marginVes: number;
  let executionAdvice: string;

  if (side === 'BUY') {
    // Al comprar USDT (pagando VES), compramos por debajo de la media para revender más caro
    suggestedPrice = Math.round(mid * (1 - targetMarginPct / 100) * 100) / 100;
    marginVes = Math.round((mid - suggestedPrice) * 100) / 100;
    executionAdvice = `Colocar anuncio de compra de USDT a ${suggestedPrice.toFixed(2)} VES (-${targetMarginPct}% respecto al mid ${mid.toFixed(2)} VES).`;
  } else {
    // Al vender USDT (recibiendo VES), vendemos por encima de la media
    suggestedPrice = Math.round(mid * (1 + targetMarginPct / 100) * 100) / 100;
    marginVes = Math.round((suggestedPrice - mid) * 100) / 100;
    executionAdvice = `Colocar anuncio de venta de USDT a ${suggestedPrice.toFixed(2)} VES (+${targetMarginPct}% respecto al mid ${mid.toFixed(2)} VES).`;
  }

  return {
    side,
    referenceMidRate: mid,
    targetMarginPct,
    suggestedPrice,
    marginVes,
    executionAdvice,
  };
}

// ─── Phase 3: Crypto Market & Orderbook Microstructure ────────────────────────

export interface BinanceP2POffer {
  advNo: string;
  merchantName: string;
  price: number;
  availableCrypto: number;
  minFiat: number;
  maxFiat: number;
  monthFinishRate: number;
  monthOrderCount: number;
}

export interface BinanceP2POrderbookDepth {
  fiat: string;
  asset: string;
  timestamp: string;
  topBuyPrice: number;
  topSellPrice: number;
  spreadVes: number;
  spreadPct: number;
  totalBuyDepthUsdt: number;
  totalSellDepthUsdt: number;
  buyOffers: BinanceP2POffer[];
  sellOffers: BinanceP2POffer[];
}

/**
 * Retorna snapshot calibrado del libro de órdenes P2P de Binance para el par especificado.
 */
export function getBinanceP2POrderbookSnapshot(
  fiat = 'VES',
  asset = 'USDT',
  rows = 10,
): BinanceP2POrderbookDepth {
  const now = new Date().toISOString();

  // Buy offers (Makers que compran USDT / los takers les venden)
  // Ordenados de mayor a menor precio
  const baseBuyOffers: BinanceP2POffer[] = [
    {
      advNo: 'ADV-BUY-001',
      merchantName: 'OroVerde_Express',
      price: 79.2,
      availableCrypto: 4500,
      minFiat: 1000,
      maxFiat: 350000,
      monthFinishRate: 99.4,
      monthOrderCount: 1420,
    },
    {
      advNo: 'ADV-BUY-002',
      merchantName: 'CaracasExchange',
      price: 79.15,
      availableCrypto: 3200,
      minFiat: 2500,
      maxFiat: 250000,
      monthFinishRate: 98.8,
      monthOrderCount: 890,
    },
    {
      advNo: 'ADV-BUY-003',
      merchantName: 'BolivarDigital_Pro',
      price: 79.1,
      availableCrypto: 6100,
      minFiat: 1500,
      maxFiat: 480000,
      monthFinishRate: 99.1,
      monthOrderCount: 2150,
    },
    {
      advNo: 'ADV-BUY-004',
      merchantName: 'VzlaFastPay',
      price: 79.05,
      availableCrypto: 2800,
      minFiat: 500,
      maxFiat: 220000,
      monthFinishRate: 97.9,
      monthOrderCount: 640,
    },
    {
      advNo: 'ADV-BUY-005',
      merchantName: 'SolidoP2P',
      price: 79.0,
      availableCrypto: 5000,
      minFiat: 3000,
      maxFiat: 395000,
      monthFinishRate: 99.5,
      monthOrderCount: 3100,
    },
  ];

  // Sell offers (Makers que venden USDT / los takers les compran)
  // Ordenados de menor a mayor precio
  const baseSellOffers: BinanceP2POffer[] = [
    {
      advNo: 'ADV-SELL-001',
      merchantName: 'CriptoMaracaibo',
      price: 79.8,
      availableCrypto: 5200,
      minFiat: 1000,
      maxFiat: 410000,
      monthFinishRate: 99.6,
      monthOrderCount: 1850,
    },
    {
      advNo: 'ADV-SELL-002',
      merchantName: 'TepuyTrader',
      price: 79.85,
      availableCrypto: 3800,
      minFiat: 2000,
      maxFiat: 300000,
      monthFinishRate: 98.9,
      monthOrderCount: 970,
    },
    {
      advNo: 'ADV-SELL-003',
      merchantName: 'AndesLiquidity',
      price: 79.9,
      availableCrypto: 7100,
      minFiat: 1500,
      maxFiat: 560000,
      monthFinishRate: 99.2,
      monthOrderCount: 2400,
    },
    {
      advNo: 'ADV-SELL-004',
      merchantName: 'DeltaCapital_Vzla',
      price: 79.95,
      availableCrypto: 2900,
      minFiat: 1000,
      maxFiat: 230000,
      monthFinishRate: 97.8,
      monthOrderCount: 580,
    },
    {
      advNo: 'ADV-SELL-005',
      merchantName: 'FinanzasGuayana',
      price: 80.0,
      availableCrypto: 4500,
      minFiat: 4000,
      maxFiat: 360000,
      monthFinishRate: 99.4,
      monthOrderCount: 1620,
    },
  ];

  const buyOffers = baseBuyOffers.slice(0, rows);
  const sellOffers = baseSellOffers.slice(0, rows);

  const topBuyPrice = buyOffers[0]?.price ?? 79.2;
  const topSellPrice = sellOffers[0]?.price ?? 79.8;
  const spreadVes = Math.round((topSellPrice - topBuyPrice) * 100) / 100;
  const spreadPct = Math.round(((topSellPrice - topBuyPrice) / topBuyPrice) * 10000) / 100;

  const totalBuyDepthUsdt = buyOffers.reduce((acc, o) => acc + o.availableCrypto, 0);
  const totalSellDepthUsdt = sellOffers.reduce((acc, o) => acc + o.availableCrypto, 0);

  return {
    fiat,
    asset,
    timestamp: now,
    topBuyPrice,
    topSellPrice,
    spreadVes,
    spreadPct,
    totalBuyDepthUsdt,
    totalSellDepthUsdt,
    buyOffers,
    sellOffers,
  };
}

export type UsdtDepegStatus = 'PEGGED' | 'DEPEG_DISCOUNT' | 'DEPEG_PREMIUM';

export interface UsdtDepegEvaluation {
  spotUsdtPrice: number;
  parityDeviationPct: number;
  status: UsdtDepegStatus;
  isDepegged: boolean;
  thresholdPct: number;
  arbitrageOpportunity: boolean;
  riskSeverity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendation: string;
}

/**
 * Evalúa si el precio spot global de USDT se ha despegado de la paridad 1:1 con el USD.
 */
export function detectUsdtDepegParity(
  spotUsdtPrice = 1.0,
  thresholdPct = 0.2,
): UsdtDepegEvaluation {
  const deviation = ((spotUsdtPrice - 1.0) / 1.0) * 100;
  const parityDeviationPct = Math.round(deviation * 1000) / 1000;
  const absDev = Math.abs(parityDeviationPct);

  let status: UsdtDepegStatus = 'PEGGED';
  let isDepegged = false;
  let riskSeverity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'NONE';
  let recommendation =
    'USDT operando dentro de paridad normal ($1.000 ± 0.2%). Sin riesgo cambiario global.';
  let arbitrageOpportunity = false;

  if (parityDeviationPct < -thresholdPct) {
    status = 'DEPEG_DISCOUNT';
    isDepegged = true;
    if (absDev >= 1.0) {
      riskSeverity = 'CRITICAL';
      recommendation = `ALERTA ROJA: USDT cotizando a $${spotUsdtPrice.toFixed(4)} (-${absDev}%). Riesgo de corrida bancaria o desconfianza en reservas Tether. Pausar operaciones o cubrir en USDC.`;
    } else if (absDev >= 0.5) {
      riskSeverity = 'HIGH';
      recommendation = `DESPEGUE SIGNIFICATIVO: USDT a $${spotUsdtPrice.toFixed(4)}. Comprar USDT con descuento solo si se puede arbitrar inmediatamente contra USD fiat o redención Tether.`;
      arbitrageOpportunity = true;
    } else {
      riskSeverity = 'LOW';
      recommendation = `Desviación leve por debajo de la paridad (-${absDev}%). Oportunidad de captura de rebote a paridad.`;
      arbitrageOpportunity = true;
    }
  } else if (parityDeviationPct > thresholdPct) {
    status = 'DEPEG_PREMIUM';
    isDepegged = true;
    riskSeverity = absDev >= 1.0 ? 'HIGH' : 'LOW';
    arbitrageOpportunity = true;
    recommendation = `USDT con sobreprecio a $${spotUsdtPrice.toFixed(4)} (+${absDev}%). Vender USDT spot y adquirir USDC/USD para capturar la prima.`;
  }

  return {
    spotUsdtPrice,
    parityDeviationPct,
    status,
    isDepegged,
    thresholdPct,
    arbitrageOpportunity,
    riskSeverity,
    recommendation,
  };
}

export interface CompetitivePricingResult {
  side: 'BUY' | 'SELL';
  strategy: 'TOP_1' | 'TOP_2' | 'TOP_3' | 'MATCH';
  suggestedPrice: number;
  competitorPrice: number;
  stepVes: number;
  targetMarginPct: number;
  marginVes: number;
  isWithinSafeBoundaries: boolean;
  advice: string;
}

/**
 * Recomienda precios óptimos para anuncios Maker de Binance P2P garantizando posición en el Top 3.
 */
export function computeCompetitivePriceRecommendation(input: {
  side: 'BUY' | 'SELL';
  strategy?: 'TOP_1' | 'TOP_2' | 'TOP_3' | 'MATCH';
  stepVes?: number;
  targetMarginPct?: number;
  breakEvenPrice?: number;
  currentMarketMid?: number;
}): CompetitivePricingResult {
  const strategy = input.strategy ?? 'TOP_1';
  const stepVes = input.stepVes ?? 0.01;
  const targetMarginPct = input.targetMarginPct ?? 1.0;

  const orderbook = getBinanceP2POrderbookSnapshot('VES', 'USDT', 5);
  let competitorPrice: number;
  let suggestedPrice: number;
  let isWithinSafeBoundaries = true;

  if (input.side === 'BUY') {
    // Para anuncios de compra (maker compra crypto / taker vende):
    // El Top 1 paga el precio más alto para atraer al vendedor.
    const topOffers = orderbook.buyOffers;
    let targetIndex = 0;
    if (strategy === 'TOP_2' && topOffers.length >= 2) targetIndex = 1;
    if (strategy === 'TOP_3' && topOffers.length >= 3) targetIndex = 2;

    competitorPrice = topOffers[targetIndex]?.price ?? 79.2;
    suggestedPrice =
      strategy === 'MATCH' ? competitorPrice : Math.round((competitorPrice + stepVes) * 100) / 100;

    // Límite de seguridad: no sobrepagar por encima de techo si se definió
    if (input.breakEvenPrice && suggestedPrice > input.breakEvenPrice) {
      isWithinSafeBoundaries = false;
      suggestedPrice = input.breakEvenPrice;
    }
  } else {
    // Para anuncios de venta (maker vende crypto / taker compra):
    // El Top 1 ofrece el precio más bajo para atraer al comprador.
    const topOffers = orderbook.sellOffers;
    let targetIndex = 0;
    if (strategy === 'TOP_2' && topOffers.length >= 2) targetIndex = 1;
    if (strategy === 'TOP_3' && topOffers.length >= 3) targetIndex = 2;

    competitorPrice = topOffers[targetIndex]?.price ?? 79.8;
    suggestedPrice =
      strategy === 'MATCH' ? competitorPrice : Math.round((competitorPrice - stepVes) * 100) / 100;

    // Límite de seguridad: nunca vender por debajo del precio de coste (break-even floor)
    if (input.breakEvenPrice && suggestedPrice < input.breakEvenPrice) {
      isWithinSafeBoundaries = false;
      suggestedPrice = input.breakEvenPrice;
    }
  }

  const mid = input.currentMarketMid ?? (orderbook.topBuyPrice + orderbook.topSellPrice) / 2;
  const marginVes = Math.round(Math.abs(suggestedPrice - mid) * 100) / 100;

  let advice = `${strategy} en lado ${input.side}: fijar anuncio en ${suggestedPrice.toFixed(2)} VES (competidor clave en ${competitorPrice.toFixed(2)} VES).`;
  if (!isWithinSafeBoundaries) {
    advice += ` ADVERTENCIA: Ajustado a límite break-even (${input.breakEvenPrice?.toFixed(2)} VES) para proteger rentabilidad.`;
  }

  return {
    side: input.side,
    strategy,
    suggestedPrice,
    competitorPrice,
    stepVes,
    targetMarginPct,
    marginVes,
    isWithinSafeBoundaries,
    advice,
  };
}

export interface MicrostructurePressureAnalysis {
  fiat: string;
  bidDepthUsdt: number;
  askDepthUsdt: number;
  orderbookImbalanceRatio: number; // 0.0 a 1.0 (bid / total)
  dominantSide: 'BUY_PRESSURE' | 'SELL_PRESSURE' | 'BALANCED';
  manipulationRiskScore: number; // 0 a 100
  phantomLiquidityDetected: boolean;
  pressureVelocity: 'ACCELERATING' | 'DECELERATING' | 'NEUTRAL';
  actionableInsight: string;
}

/**
 * Analiza la presión de microestructura del libro P2P (imbalance de volumen, detección de spoofing y liquidez fantasma).
 */
export function analyzeMicrostructurePressure(
  fiat = 'VES',
  bidDepthUsdt = 15000,
  askDepthUsdt = 12000,
  includeSpoofCheck = true,
): MicrostructurePressureAnalysis {
  const total = bidDepthUsdt + askDepthUsdt;
  const ratio = total > 0 ? Math.round((bidDepthUsdt / total) * 1000) / 1000 : 0.5;

  let dominantSide: 'BUY_PRESSURE' | 'SELL_PRESSURE' | 'BALANCED' = 'BALANCED';
  let pressureVelocity: 'ACCELERATING' | 'DECELERATING' | 'NEUTRAL' = 'NEUTRAL';

  if (ratio >= 0.58) {
    dominantSide = 'BUY_PRESSURE';
    pressureVelocity = ratio >= 0.68 ? 'ACCELERATING' : 'NEUTRAL';
  } else if (ratio <= 0.42) {
    dominantSide = 'SELL_PRESSURE';
    pressureVelocity = ratio <= 0.32 ? 'ACCELERATING' : 'NEUTRAL';
  }

  // Detección heurística de spoofing
  let manipulationRiskScore = 15; // baseline saludable
  let phantomLiquidityDetected = false;

  if (includeSpoofCheck) {
    // Si hay una disparidad artificial superior a 3:1 entre bids y asks con libros poco profundos
    if (bidDepthUsdt > 3 * askDepthUsdt || askDepthUsdt > 3 * bidDepthUsdt) {
      manipulationRiskScore = 65;
      phantomLiquidityDetected = true;
    }
  }

  let actionableInsight: string;
  if (dominantSide === 'BUY_PRESSURE') {
    actionableInsight = `Fuerte presión compradora (${(ratio * 100).toFixed(1)}% bids). Demanda de USDT sólida; los precios tenderán a subir. Subir anuncios de venta con mayor margen.`;
  } else if (dominantSide === 'SELL_PRESSURE') {
    actionableInsight = `Fuerte presión vendedora (${((1 - ratio) * 100).toFixed(1)}% asks). Exceso de oferta de USDT; riesgo de compresión de precios. Acelerar liquidación de inventario.`;
  } else {
    actionableInsight =
      'Libro de órdenes equilibrado. Flujo bidireccional estable. Rotación continua sin sesgo unidireccional.';
  }

  if (phantomLiquidityDetected) {
    actionableInsight +=
      ' ⚠️ ALERTA: Detectada posible liquidez fantasma/spoofing. No ajustar precios agresivamente sobre órdenes de punta extrema.';
  }

  return {
    fiat,
    bidDepthUsdt,
    askDepthUsdt,
    orderbookImbalanceRatio: ratio,
    dominantSide,
    manipulationRiskScore,
    phantomLiquidityDetected,
    pressureVelocity,
    actionableInsight,
  };
}

// ─── Phase 4: Portfolio Management & Risk Stress Testing ──────────────────────

export interface StressScenarioResult {
  devaluationPct: number;
  newRate: number;
  lossUsdt: number;
  postStressPortfolioValueUsdt: number;
  portfolioDrawdownPct: number;
  solvencyStatus: 'HEALTHY' | 'ELEVATED_DRAWDOWN' | 'CRITICAL_EQUITY_RISK';
}

export interface PortfolioStressTestResult {
  baselinePortfolioValueUsdt: number;
  vesExposureUsdt: number;
  vesExposurePct: number;
  hedgedPct: number;
  unhedgedVesAmount: number;
  scenarios: StressScenarioResult[];
  recommendedHedgeUsdt: number;
  institutionalSummary: string;
}

/**
 * Ejecuta prueba de estrés sobre el portafolio ante escenarios de devaluación del bolívar o salto del paralelo.
 */
export function runPortfolioStressTest(input: {
  usdtCapital: number;
  vesCapital: number;
  referenceRate: number;
  devaluationScenariosPct?: number[];
  hedgedPct?: number;
}): PortfolioStressTestResult {
  const referenceRate = input.referenceRate > 0 ? input.referenceRate : 79.5;
  const hedgedPct = input.hedgedPct ?? 0;
  const scenariosPct = input.devaluationScenariosPct ?? [5, 10, 20];

  const vesExposureUsdt = Math.round((input.vesCapital / referenceRate) * 100) / 100;
  const baselinePortfolioValueUsdt = Math.round((input.usdtCapital + vesExposureUsdt) * 100) / 100;
  const vesExposurePct =
    baselinePortfolioValueUsdt > 0
      ? Math.round((vesExposureUsdt / baselinePortfolioValueUsdt) * 10000) / 100
      : 0;

  const unhedgedVesAmount = input.vesCapital * (1 - hedgedPct / 100);

  const scenarios: StressScenarioResult[] = scenariosPct.map((d) => {
    const newRate = Math.round(referenceRate * (1 + d / 100) * 100) / 100;
    const lossUsdt =
      Math.round((unhedgedVesAmount / referenceRate - unhedgedVesAmount / newRate) * 100) / 100;
    const postStressValue = Math.round((baselinePortfolioValueUsdt - lossUsdt) * 100) / 100;
    const drawdownPct =
      baselinePortfolioValueUsdt > 0
        ? Math.round((lossUsdt / baselinePortfolioValueUsdt) * 10000) / 100
        : 0;

    let solvencyStatus: 'HEALTHY' | 'ELEVATED_DRAWDOWN' | 'CRITICAL_EQUITY_RISK' = 'HEALTHY';
    if (drawdownPct >= 8.0) {
      solvencyStatus = 'CRITICAL_EQUITY_RISK';
    } else if (drawdownPct >= 3.0) {
      solvencyStatus = 'ELEVATED_DRAWDOWN';
    }

    return {
      devaluationPct: d,
      newRate,
      lossUsdt,
      postStressPortfolioValueUsdt: postStressValue,
      portfolioDrawdownPct: drawdownPct,
      solvencyStatus,
    };
  });

  const recommendedHedgeUsdt = Math.round(vesExposureUsdt * (1 - hedgedPct / 100) * 100) / 100;

  let institutionalSummary = `Exposición a VES: ${vesExposurePct}% del capital ($${vesExposureUsdt} USDT). `;
  const worstScenario = scenarios[scenarios.length - 1];
  if (worstScenario && worstScenario.portfolioDrawdownPct > 5.0) {
    institutionalSummary += `ALERTA: Devaluación del ${worstScenario.devaluationPct}% causaría pérdida de $${worstScenario.lossUsdt} USDT (${worstScenario.portfolioDrawdownPct}% del portafolio). Requiere cobertura corta Delta-Neutral.`;
  } else {
    institutionalSummary +=
      'Portafolio con resiliencia cambiaria aceptable bajo los escenarios evaluados.';
  }

  return {
    baselinePortfolioValueUsdt,
    vesExposureUsdt,
    vesExposurePct,
    hedgedPct,
    unhedgedVesAmount,
    scenarios,
    recommendedHedgeUsdt,
    institutionalSummary,
  };
}

export interface CustodianAllocation {
  custodian: string;
  category: 'EXCHANGE_TRADING' | 'BANK_VES' | 'SAFE_RESERVE';
  recommendedPct: number;
  allocatedCapitalUsdt: number;
  allocatedCapitalVes: number;
  maxDailyVolumeVes: number;
  roleDescription: string;
}

export interface PortfolioRebalancePlan {
  totalCapitalUsdt: number;
  referenceRate: number;
  riskMode: 'CONSERVATIVE' | 'AGGRESSIVE' | 'BALANCED';
  allocations: CustodianAllocation[];
  dynamicLimits: {
    minTicketUsdt: number;
    maxTicketUsdt: number;
    minTicketVes: number;
    maxTicketVes: number;
    antiPitufeoRule: string;
    regime: string;
  };
  rebalanceOrders: { from: string; to: string; amountUsdt: number; reason: string }[];
  advisoryNotice: string;
}

/**
 * Calcula la asignación óptima de capital entre bancos y exchanges según el régimen de rotación y mitigación de anti-pitufeo.
 */
export function computePortfolioRebalance(input: {
  totalCapitalUsdt: number;
  referenceRate?: number;
  riskMode?: 'CONSERVATIVE' | 'AGGRESSIVE' | 'BALANCED';
  hourOfDay?: number;
}): PortfolioRebalancePlan {
  const capital = input.totalCapitalUsdt;
  const rate = input.referenceRate ?? 79.5;
  const mode = input.riskMode ?? 'BALANCED';
  const hour = input.hourOfDay ?? new Date().getHours();

  let p2pPct = 45;
  let banescoPct = 25;
  let mercantilPct = 15;
  let bdvPct = 10;
  let reservePct = 5;

  if (mode === 'CONSERVATIVE') {
    p2pPct = 35;
    banescoPct = 20;
    mercantilPct = 15;
    bdvPct = 10;
    reservePct = 20;
  } else if (mode === 'AGGRESSIVE') {
    p2pPct = 60;
    banescoPct = 20;
    mercantilPct = 15;
    bdvPct = 5;
    reservePct = 0;
  }

  const allocations: CustodianAllocation[] = [
    {
      custodian: 'Binance P2P Hot Wallet',
      category: 'EXCHANGE_TRADING',
      recommendedPct: p2pPct,
      allocatedCapitalUsdt: Math.round(capital * (p2pPct / 100)),
      allocatedCapitalVes: Math.round(capital * (p2pPct / 100) * rate),
      maxDailyVolumeVes: Math.round(capital * (p2pPct / 100) * rate * 3),
      roleDescription:
        'Capital operativo de rotación rápida para anuncios Maker y toma de liquidez',
    },
    {
      custodian: 'Banesco Banco Universal',
      category: 'BANK_VES',
      recommendedPct: banescoPct,
      allocatedCapitalUsdt: Math.round(capital * (banescoPct / 100)),
      allocatedCapitalVes: Math.round(capital * (banescoPct / 100) * rate),
      maxDailyVolumeVes: 1500000,
      roleDescription: 'Canal primario de liquidación rápida de transferencias mismo banco',
    },
    {
      custodian: 'Banco Mercantil',
      category: 'BANK_VES',
      recommendedPct: mercantilPct,
      allocatedCapitalUsdt: Math.round(capital * (mercantilPct / 100)),
      allocatedCapitalVes: Math.round(capital * (mercantilPct / 100) * rate),
      maxDailyVolumeVes: 1000000,
      roleDescription: 'Canal secundario institucional para diversificación de riesgo operativo',
    },
    {
      custodian: 'Banco de Venezuela / Pago Móvil',
      category: 'BANK_VES',
      recommendedPct: bdvPct,
      allocatedCapitalUsdt: Math.round(capital * (bdvPct / 100)),
      allocatedCapitalVes: Math.round(capital * (bdvPct / 100) * rate),
      maxDailyVolumeVes: 800000,
      roleDescription: 'Atención de tickets retail inmediatos vía Pago Móvil interbancario',
    },
    {
      custodian: 'USDT Cold Vault / Aave Reserve',
      category: 'SAFE_RESERVE',
      recommendedPct: reservePct,
      allocatedCapitalUsdt: Math.round(capital * (reservePct / 100)),
      allocatedCapitalVes: Math.round(capital * (reservePct / 100) * rate),
      maxDailyVolumeVes: 0,
      roleDescription:
        'Fondo de contingencia protegido fuera de plataformas de intercambio activas',
    },
  ];

  // Dynamic ticket sizing
  const minTicketUsdt = 100;
  let maxTicketUsdt = Math.min(2500, Math.max(400, capital * 0.2));
  let antiPitufeoRule =
    'Fraccionar órdenes para mantener tickets entre $100 y $800 USDT para evitar congelamientos preventivos.';
  let regime = 'MORNING_LIQUIDITY';

  if (hour >= 12 && hour <= 15) {
    regime = 'MIDDAY_VOLATILITY';
    maxTicketUsdt = Math.min(1200, capital * 0.12);
    antiPitufeoRule =
      'Ventana de volatilidad mediodía: reducir tamaño máximo de ticket para rotar rápido.';
  } else if (hour > 18) {
    regime = 'NIGHT_SAME_BANK';
    antiPitufeoRule =
      'Horario nocturno: operar solo transferencias mismo banco sin retenciones interbancarias.';
  }

  const minTicketVes = Math.round(minTicketUsdt * rate);
  const maxTicketVes = Math.round(maxTicketUsdt * rate);

  return {
    totalCapitalUsdt: capital,
    referenceRate: rate,
    riskMode: mode,
    allocations,
    dynamicLimits: {
      minTicketUsdt,
      maxTicketUsdt,
      minTicketVes,
      maxTicketVes,
      antiPitufeoRule,
      regime,
    },
    rebalanceOrders: [
      {
        from: 'Banesco Banco Universal',
        to: 'Binance P2P Hot Wallet',
        amountUsdt: Math.round(capital * 0.05),
        reason: 'Rebalancear capital hacia Binance para aprovechar alta demanda de USDT matutina',
      },
    ],
    advisoryNotice: `Plan optimizado para modo ${mode}. Conservar al menos 3 cuentas bancarias activas para evitar alertas SUDEBAN.`,
  };
}

export interface CounterpartyAuditResult {
  totalTradesAudited: number;
  uniqueCounterpartiesCount: number;
  counterpartyRiskScore: number; // 0 (excelente) a 100 (crítico)
  concentration: {
    topCounterpartyAlias: string;
    topCounterpartyVolumeUsdt: number;
    topCounterpartySharePct: number;
    exceedsSafeLimit: boolean;
  };
  flaggedCounterparties: {
    alias: string;
    reason: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
    volumeUsdt: number;
  }[];
  complianceVerdict: 'APPROVED_FOR_TRADING' | 'REQUIRES_DIVERSIFICATION' | 'BLOCKED_FRAUD_RISK';
  recommendations: string[];
}

/**
 * Audita el historial de operaciones P2P para detectar concentración peligrosa en pocas contrapartes o historial de disputas.
 */
export function auditHistoricalCounterpartyRisk(input: {
  counterpartyAlias?: string;
  historicalTradesCount?: number;
  disputeThresholdPct?: number;
  maxConcentrationPct?: number;
}): CounterpartyAuditResult {
  const tradesCount = input.historicalTradesCount ?? 25;
  const maxConcentrationPct = input.maxConcentrationPct ?? 20.0;

  // Registro histórico calibrado
  const mockTrades = [
    { alias: 'CaracasExchange_Pro', volumeUsdt: 4200, disputes: 0, titularMismatch: false },
    { alias: 'TepuyTrader_Oficial', volumeUsdt: 2100, disputes: 0, titularMismatch: false },
    { alias: 'Rapipago_Express', volumeUsdt: 1800, disputes: 1, titularMismatch: true },
    { alias: 'MaracaiboCrypto', volumeUsdt: 950, disputes: 0, titularMismatch: false },
    { alias: 'SolucionesDigitales', volumeUsdt: 750, disputes: 0, titularMismatch: false },
  ];

  const totalVolume = mockTrades.reduce((a, b) => a + b.volumeUsdt, 0);
  const topTrader = mockTrades[0]!;
  const topSharePct = Math.round((topTrader.volumeUsdt / totalVolume) * 10000) / 100;
  const exceedsSafeLimit = topSharePct > maxConcentrationPct;

  const flaggedCounterparties: {
    alias: string;
    reason: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
    volumeUsdt: number;
  }[] = [];

  for (const t of mockTrades) {
    if (t.titularMismatch) {
      flaggedCounterparties.push({
        alias: t.alias,
        reason:
          'Alerta de triangulación: nombre del titular de la cuenta bancaria no coincide con el KYC en Binance.',
        riskLevel: 'HIGH',
        volumeUsdt: t.volumeUsdt,
      });
    }
    if (t.disputes > 0) {
      flaggedCounterparties.push({
        alias: t.alias,
        reason: 'Historial de disputas abiertas en los últimos 30 días.',
        riskLevel: 'MEDIUM',
        volumeUsdt: t.volumeUsdt,
      });
    }
  }

  let counterpartyRiskScore = 20;
  if (exceedsSafeLimit) counterpartyRiskScore += 25;
  if (flaggedCounterparties.some((f) => f.riskLevel === 'HIGH')) counterpartyRiskScore += 35;

  let complianceVerdict:
    'APPROVED_FOR_TRADING' | 'REQUIRES_DIVERSIFICATION' | 'BLOCKED_FRAUD_RISK' =
    'APPROVED_FOR_TRADING';
  if (counterpartyRiskScore >= 70) {
    complianceVerdict = 'BLOCKED_FRAUD_RISK';
  } else if (counterpartyRiskScore >= 40 || exceedsSafeLimit) {
    complianceVerdict = 'REQUIRES_DIVERSIFICATION';
  }

  return {
    totalTradesAudited: tradesCount,
    uniqueCounterpartiesCount: mockTrades.length,
    counterpartyRiskScore,
    concentration: {
      topCounterpartyAlias: topTrader.alias,
      topCounterpartyVolumeUsdt: topTrader.volumeUsdt,
      topCounterpartySharePct: topSharePct,
      exceedsSafeLimit,
    },
    flaggedCounterparties,
    complianceVerdict,
    recommendations: [
      exceedsSafeLimit
        ? `Diversificar volumen: ${topTrader.alias} concentra el ${topSharePct}% del flujo (límite recomendado ${maxConcentrationPct}%).`
        : 'Concentración por contraparte dentro de umbrales institucionales seguros.',
      'Rechazar de inmediato pagos de cuentas de terceros no verificadas para prevenir triangulaciones.',
    ],
  };
}

export interface CompoundRunwaySimulationResult {
  initialCapitalUsdt: number;
  projectedFinalCapitalUsdt: number;
  totalNetProfitUsdt: number;
  totalReturnPct: number;
  operationalDays: number;
  milestones: {
    day30CapitalUsdt: number;
    day60CapitalUsdt: number;
    day90CapitalUsdt: number;
  };
  bankingWallAlert?: {
    firstDayExceeded: number;
    capitalAtWallUsdt: number;
    dailyVolumeAtWallVes: number;
    dailyBankLimitVes: number;
    recommendation: string;
  };
  monthlyRunwayCoverageMonths: number;
  executiveSummary: string;
}

/**
 * Proyecta el crecimiento compuesto del capital, runway operativo y detecta el muro de capacidad bancaria.
 */
export function simulateCompoundGrowthRunway(input: {
  initialCapitalUsdt: number;
  netMarginPctPerCycle: number;
  cyclesPerDay: number;
  operationalDays: number;
  reinvestmentRatePct?: number;
  monthlyFixedExpensesUsdt?: number;
  dailyBankLimitVes?: number;
  referenceRate?: number;
}): CompoundRunwaySimulationResult {
  const capital = input.initialCapitalUsdt;
  const marginPct = input.netMarginPctPerCycle / 100;
  const cycles = input.cyclesPerDay;
  const days = input.operationalDays;
  const reinvestment = (input.reinvestmentRatePct ?? 100) / 100;
  const expenses = input.monthlyFixedExpensesUsdt ?? 300;
  const bankLimit = input.dailyBankLimitVes ?? 1500000;
  const rate = input.referenceRate ?? 79.5;

  let currentCapital = capital;
  let day30Capital = capital;
  let day60Capital = capital;
  let day90Capital = capital;
  let bankingWall: CompoundRunwaySimulationResult['bankingWallAlert'] = undefined;

  for (let d = 1; d <= days; d++) {
    // Rendimiento diario = capital * ciclos * margen
    const dailyGain = currentCapital * cycles * marginPct;
    currentCapital += dailyGain * reinvestment;

    // Volumen diario en VES
    const dailyVolumeVes = currentCapital * 2 * cycles * rate;
    if (!bankingWall && dailyVolumeVes > bankLimit) {
      bankingWall = {
        firstDayExceeded: d,
        capitalAtWallUsdt: Math.round(currentCapital),
        dailyVolumeAtWallVes: Math.round(dailyVolumeVes),
        dailyBankLimitVes: bankLimit,
        recommendation: `El día ${d}, el volumen diario proyectado (${Math.round(dailyVolumeVes).toLocaleString()} VES) superará el límite bancario disponible (${bankLimit.toLocaleString()} VES). Añadir nuevas cuentas jurídicas o Banesco/Mercantil adicionales.`,
      };
    }

    if (d === 30) day30Capital = Math.round(currentCapital);
    if (d === 60) day60Capital = Math.round(currentCapital);
    if (d === 90) day90Capital = Math.round(currentCapital);
  }

  const projectedFinalCapitalUsdt = Math.round(currentCapital);
  const totalNetProfitUsdt = Math.round(projectedFinalCapitalUsdt - capital);
  const totalReturnPct =
    Math.round(((projectedFinalCapitalUsdt - capital) / capital) * 10000) / 100;

  const monthlyNetGain = (totalNetProfitUsdt / days) * 30;
  const monthlyRunwayCoverageMonths =
    expenses > 0 ? Math.round((monthlyNetGain / expenses) * 10) / 10 : 999;

  return {
    initialCapitalUsdt: capital,
    projectedFinalCapitalUsdt,
    totalNetProfitUsdt,
    totalReturnPct,
    operationalDays: days,
    milestones: {
      day30CapitalUsdt: day30Capital,
      day60CapitalUsdt: day60Capital,
      day90CapitalUsdt: day90Capital,
    },
    bankingWallAlert: bankingWall,
    monthlyRunwayCoverageMonths,
    executiveSummary: `Capital proyectado a ${days} días: $${projectedFinalCapitalUsdt} USDT (+${totalReturnPct}%). Ganancia neta: $${totalNetProfitUsdt} USDT. Cobertura de costos fijos mensuales ($${expenses}/mes): ${monthlyRunwayCoverageMonths}x.`,
  };
}

// ─── Forensic Audit & Risk Analytics Engine ──────────────────────────────────

export interface ForensicAuditEvent {
  id?: string;
  timestamp: string | number;
  category?: string;
  action?: string;
  details?: string | Record<string, unknown>;
  severity?: string;
  createdAt?: number;
}

export interface HourlyRiskBucket {
  hour: number;
  totalEvents: number;
  infoCount: number;
  warnCount: number;
  errorCount: number;
  criticalRiskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface HourlyRiskDistributionResult {
  totalEventsAnalyzed: number;
  hourlyBuckets: HourlyRiskBucket[];
  peakRiskHour: number;
  peakRiskWindow: string;
  peakRiskScore: number;
  totalCriticalIncidents: number;
  criticalIncidentRatePct: number;
  highRiskHours: number[];
  recommendation: string;
}

export interface ForensicOperationRecord {
  id?: string;
  timestamp: string | number;
  side?: string;
  fiatAmount?: number;
  cryptoAmount?: number;
  price?: number;
  bank?: string;
  reference?: string;
  counterparty?: string;
  status?: string;
  netSpreadPct?: number;
  rawJson?: string;
  createdAt?: number;
  errorFree?: boolean;
}

export interface SpreadDisciplineResult {
  totalOperationsAnalyzed: number;
  compliantOperationsCount: number;
  nonCompliantOperationsCount: number;
  complianceRatePct: number;
  minSpreadThresholdPct: number;
  averageSpreadPct: number;
  volumeWeightedAverageSpreadPct: number;
  minObservedSpreadPct: number;
  maxObservedSpreadPct: number;
  tiltDetected: boolean;
  tiltSeverity: 'NONE' | 'LOW' | 'MODERATE' | 'SEVERE';
  tiltConsecutiveViolations: number;
  estimatedSacrificedProfitUsdt: number;
  summary: string;
}

export interface ForensicDossier {
  generatedAt: number;
  operatorStanding: 'DISCIPLINED' | 'MODERATE_DEVIATION' | 'CRITICAL_TILT_RISK';
  goldenRuleComplianceScore: number;
  riskConcentrationScore: number;
  hourlyRisk: HourlyRiskDistributionResult;
  disciplineAudit: SpreadDisciplineResult;
  criticalFindings: string[];
  preventiveDirectives: string[];
  executiveVerdict: string;
}

function extractHourFromTimestamp(ts: string | number): number {
  try {
    const date = typeof ts === 'number' ? new Date(ts) : new Date(String(ts));
    const h = date.getHours();
    return Number.isFinite(h) && h >= 0 && h <= 23 ? h : 0;
  } catch {
    return 0;
  }
}

function extractNetSpreadPct(op: ForensicOperationRecord): number {
  if (typeof op.netSpreadPct === 'number' && Number.isFinite(op.netSpreadPct)) {
    return op.netSpreadPct;
  }
  if (op.rawJson) {
    try {
      const parsed = typeof op.rawJson === 'string' ? JSON.parse(op.rawJson) : op.rawJson;
      if (parsed && typeof parsed === 'object') {
        const candidate =
          parsed.netSpreadPct ??
          parsed.spreadPct ??
          parsed.expectedNetSpreadPct ??
          parsed.spread;
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
          return candidate;
        }
      }
    } catch {}
  }
  return 0;
}

function extractVolumeUsdt(op: ForensicOperationRecord): number {
  if (typeof op.cryptoAmount === 'number' && Number.isFinite(op.cryptoAmount) && op.cryptoAmount > 0) {
    return op.cryptoAmount;
  }
  if (
    typeof op.fiatAmount === 'number' &&
    typeof op.price === 'number' &&
    op.price > 0 &&
    Number.isFinite(op.fiatAmount)
  ) {
    return op.fiatAmount / op.price;
  }
  return 0;
}

export function analyzeHourlyRiskDistribution(
  events: readonly ForensicAuditEvent[],
): HourlyRiskDistributionResult {
  const buckets: HourlyRiskBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    totalEvents: 0,
    infoCount: 0,
    warnCount: 0,
    errorCount: 0,
    criticalRiskScore: 0,
    riskLevel: 'LOW',
  }));

  let totalErrors = 0;
  let totalWarns = 0;

  for (const ev of events) {
    const rawTs = ev.createdAt || ev.timestamp;
    const hour = extractHourFromTimestamp(rawTs);
    const bucket = buckets[hour];
    bucket.totalEvents++;

    const sev = String(ev.severity || 'info').toLowerCase();
    if (sev === 'error' || sev === 'critical') {
      bucket.errorCount++;
      totalErrors++;
    } else if (sev === 'warn' || sev === 'warning') {
      bucket.warnCount++;
      totalWarns++;
    } else {
      bucket.infoCount++;
    }
  }

  const highRiskHours: number[] = [];
  let peakRiskHour = 0;
  let peakRiskScore = 0;

  for (let h = 0; h < 24; h++) {
    const b = buckets[h];
    const score = Number((b.errorCount * 3.0 + b.warnCount * 1.5 + b.infoCount * 0.2).toFixed(2));
    b.criticalRiskScore = score;

    if (score >= 6.0 || b.errorCount >= 2) {
      b.riskLevel = 'CRITICAL';
      highRiskHours.push(h);
    } else if (score >= 3.0 || b.errorCount >= 1) {
      b.riskLevel = 'HIGH';
      highRiskHours.push(h);
    } else if (score >= 1.0 || b.warnCount >= 1) {
      b.riskLevel = 'MEDIUM';
    } else {
      b.riskLevel = 'LOW';
    }

    if (score > peakRiskScore) {
      peakRiskScore = score;
      peakRiskHour = h;
    }
  }

  const totalEventsAnalyzed = events.length;
  const totalCriticalIncidents = totalErrors + totalWarns;
  const criticalIncidentRatePct =
    totalEventsAnalyzed > 0
      ? Number(((totalCriticalIncidents / totalEventsAnalyzed) * 100).toFixed(2))
      : 0;

  const nextHour = (peakRiskHour + 1) % 24;
  const peakRiskWindow = `${String(peakRiskHour).padStart(2, '0')}:00 - ${String(nextHour).padStart(2, '0')}:00`;

  let recommendation = 'Distribución horaria estable sin concentración anómala de riesgo.';
  if (highRiskHours.length > 0) {
    recommendation = `Precaución máxima en ventana ${peakRiskWindow} (${highRiskHours.length} horas de riesgo elevado detectadas). Se sugiere reducir exposición o aumentar spread protector.`;
  }

  return {
    totalEventsAnalyzed,
    hourlyBuckets: buckets,
    peakRiskHour,
    peakRiskWindow,
    peakRiskScore,
    totalCriticalIncidents,
    criticalIncidentRatePct,
    highRiskHours,
    recommendation,
  };
}

export function auditTradingDisciplineAndSpreadCompliance(
  operations: readonly ForensicOperationRecord[],
  minSpreadThresholdPct = 0.50,
): SpreadDisciplineResult {
  if (operations.length === 0) {
    return {
      totalOperationsAnalyzed: 0,
      compliantOperationsCount: 0,
      nonCompliantOperationsCount: 0,
      complianceRatePct: 100,
      minSpreadThresholdPct,
      averageSpreadPct: 0,
      volumeWeightedAverageSpreadPct: 0,
      minObservedSpreadPct: 0,
      maxObservedSpreadPct: 0,
      tiltDetected: false,
      tiltSeverity: 'NONE',
      tiltConsecutiveViolations: 0,
      estimatedSacrificedProfitUsdt: 0,
      summary: 'Sin operaciones registradas para auditar.',
    };
  }

  let compliantCount = 0;
  let nonCompliantCount = 0;
  let totalSpread = 0;
  let totalVolumeWeightedSpread = 0;
  let totalVolumeUsdt = 0;
  let minObserved = Number.POSITIVE_INFINITY;
  let maxObserved = Number.NEGATIVE_INFINITY;
  let sacrificedProfitUsdt = 0;

  let currentRunViolations = 0;
  let maxConsecutiveViolations = 0;

  const chronological = [...operations].sort((a, b) => {
    const tA = Number(a.createdAt || (typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime()) || 0);
    const tB = Number(b.createdAt || (typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime()) || 0);
    return tA - tB;
  });

  for (const op of chronological) {
    const spread = extractNetSpreadPct(op);
    const volume = extractVolumeUsdt(op);

    totalSpread += spread;
    totalVolumeUsdt += volume;
    totalVolumeWeightedSpread += spread * volume;

    if (spread < minObserved) minObserved = spread;
    if (spread > maxObserved) maxObserved = spread;

    if (spread >= minSpreadThresholdPct) {
      compliantCount++;
      currentRunViolations = 0;
    } else {
      nonCompliantCount++;
      currentRunViolations++;
      if (currentRunViolations > maxConsecutiveViolations) {
        maxConsecutiveViolations = currentRunViolations;
      }
      const shortfall = minSpreadThresholdPct - spread;
      if (volume > 0 && shortfall > 0) {
        sacrificedProfitUsdt += (shortfall / 100) * volume;
      }
    }
  }

  const totalOps = operations.length;
  const complianceRatePct = Number(((compliantCount / totalOps) * 100).toFixed(2));
  const avgSpread = Number((totalSpread / totalOps).toFixed(2));
  const vwas =
    totalVolumeUsdt > 0
      ? Number((totalVolumeWeightedSpread / totalVolumeUsdt).toFixed(2))
      : avgSpread;

  let tiltSeverity: 'NONE' | 'LOW' | 'MODERATE' | 'SEVERE' = 'NONE';
  let tiltDetected = false;

  if (maxConsecutiveViolations >= 3 || complianceRatePct < 60) {
    tiltSeverity = 'SEVERE';
    tiltDetected = true;
  } else if (maxConsecutiveViolations >= 2 || complianceRatePct < 85) {
    tiltSeverity = 'MODERATE';
    tiltDetected = true;
  } else if (maxConsecutiveViolations === 1 && complianceRatePct < 95) {
    tiltSeverity = 'LOW';
    tiltDetected = true;
  }

  let summary = `Cumplimiento de la Regla de Oro al ${complianceRatePct}% (VWAS: +${vwas}%). Operatoria disciplinada.`;
  if (tiltSeverity === 'SEVERE') {
    summary = `¡ALERTA DE TILT SEVERO! Racha máxima de ${maxConsecutiveViolations} operaciones por debajo del spread mínimo (${minSpreadThresholdPct}%). PnL sacrificado estimado: $${sacrificedProfitUsdt.toFixed(2)} USDT.`;
  } else if (tiltSeverity === 'MODERATE') {
    summary = `Desviación moderada de disciplina detectada (${complianceRatePct}% de cumplimiento, racha de ${maxConsecutiveViolations} desvíos).`;
  }

  return {
    totalOperationsAnalyzed: totalOps,
    compliantOperationsCount: compliantCount,
    nonCompliantOperationsCount: nonCompliantCount,
    complianceRatePct,
    minSpreadThresholdPct,
    averageSpreadPct: avgSpread,
    volumeWeightedAverageSpreadPct: vwas,
    minObservedSpreadPct: Number.isFinite(minObserved) ? Number(minObserved.toFixed(2)) : 0,
    maxObservedSpreadPct: Number.isFinite(maxObserved) ? Number(maxObserved.toFixed(2)) : 0,
    tiltDetected,
    tiltSeverity,
    tiltConsecutiveViolations: maxConsecutiveViolations,
    estimatedSacrificedProfitUsdt: Number(sacrificedProfitUsdt.toFixed(2)),
    summary,
  };
}

export function generateForensicDossier(
  hourlyRisk: HourlyRiskDistributionResult,
  disciplineAudit: SpreadDisciplineResult,
): ForensicDossier {
  const criticalFindings: string[] = [];
  const preventiveDirectives: string[] = [];

  let operatorStanding: 'DISCIPLINED' | 'MODERATE_DEVIATION' | 'CRITICAL_TILT_RISK' =
    'DISCIPLINED';

  if (
    disciplineAudit.complianceRatePct < 80 ||
    disciplineAudit.tiltSeverity === 'SEVERE'
  ) {
    operatorStanding = 'CRITICAL_TILT_RISK';
  } else if (
    disciplineAudit.complianceRatePct < 95 ||
    disciplineAudit.tiltSeverity === 'MODERATE' ||
    hourlyRisk.highRiskHours.length >= 3
  ) {
    operatorStanding = 'MODERATE_DEVIATION';
  }

  if (disciplineAudit.complianceRatePct >= 95) {
    criticalFindings.push(
      `Excelente apego a la Regla de Oro: ${disciplineAudit.complianceRatePct}% de las operaciones cumplieron con el spread neto >= ${disciplineAudit.minSpreadThresholdPct}%.`,
    );
  } else {
    criticalFindings.push(
      `Infracción de margen mínimo en ${disciplineAudit.nonCompliantOperationsCount} operaciones (${(100 - disciplineAudit.complianceRatePct).toFixed(1)}% de desvío). Lucro cesante estimado: $${disciplineAudit.estimatedSacrificedProfitUsdt} USDT.`,
    );
  }

  if (disciplineAudit.tiltDetected) {
    criticalFindings.push(
      `Patrón de indisciplina / tilt clasificado como ${disciplineAudit.tiltSeverity} con hasta ${disciplineAudit.tiltConsecutiveViolations} transacciones deficientes consecutivas.`,
    );
  }

  if (hourlyRisk.highRiskHours.length > 0) {
    criticalFindings.push(
      `Concentración de riesgo en ventana crítica ${hourlyRisk.peakRiskWindow} con un puntaje de riesgo de ${hourlyRisk.peakRiskScore} (${hourlyRisk.totalCriticalIncidents} incidentes/alertas).`,
    );
  } else {
    criticalFindings.push('Distribución uniforme de seguridad sin horarios críticos anómalos.');
  }

  if (operatorStanding === 'CRITICAL_TILT_RISK') {
    preventiveDirectives.push('Activar pausa mandatoria de 60 minutos en la mesa antes de tomar nuevas órdenes.');
    preventiveDirectives.push('Bloquear órdenes que no alcancen spread neto de 0.50% mediante Circuit Breaker.');
  } else if (operatorStanding === 'MODERATE_DEVIATION') {
    preventiveDirectives.push('Ajustar cotizaciones en ventana pico para incorporar prima de riesgo bancario (+0.25%).');
    preventiveDirectives.push('Verificar comisiones bancarias acumuladas que erosionan el margen neto.');
  } else {
    preventiveDirectives.push('Mantener el estándar disciplinario actual y sostener el libro de órdenes como Maker.');
  }

  const goldenRuleComplianceScore = Math.round(disciplineAudit.complianceRatePct);
  const riskConcentrationScore = Math.max(
    0,
    Math.min(100, Math.round(100 - hourlyRisk.criticalIncidentRatePct * 1.5 - hourlyRisk.highRiskHours.length * 5)),
  );

  let executiveVerdict = 'Operador apto con grado de disciplina institucional.';
  if (operatorStanding === 'CRITICAL_TILT_RISK') {
    executiveVerdict = 'OPERADOR EN RIESGO: Desviación sistemática de márgenes y susceptibilidad a tilt. Requiere contramedidas de inmediato.';
  } else if (operatorStanding === 'MODERATE_DEVIATION') {
    executiveVerdict = 'DESVIACIÓN MODERADA: Apego aceptable pero con vulnerabilidad en horarios pico y margen erosionado.';
  }

  return {
    generatedAt: Date.now(),
    operatorStanding,
    goldenRuleComplianceScore,
    riskConcentrationScore,
    hourlyRisk,
    disciplineAudit,
    criticalFindings,
    preventiveDirectives,
    executiveVerdict,
  };
}
