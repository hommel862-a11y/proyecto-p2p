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
  unitSpread: number;   // Diferencia bruta en VES por 1 USDT (sell - buy)
  netGainVes: number;   // Ganancia neta en VES para el ticket dado
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
  addFlaggedIdentifier(
    rawIdentifier: string,
    saltDomain: string,
    threat: ThreatRecord,
  ): void {
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
      const confidence = Math.min(0.95, 0.5 + (threat.confirmations * 0.15));
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

// ─── BCV Market Intelligence ──────────────────────────────────────────────────

export interface BcvWindow {
  phase: 'NO_INTERVENTION_IMMINENT' | 'INTERVENTION_ACTIVE' | 'POST_INTERVENTION_COOLING';
  hoursUntilIntervention: number;
}

export interface BcvGap {
  gapPct: number;
  parallelRate: number;
  bcvRate: number;
}

export interface BcvRecommendation {
  action: string;
  rationale: string;
}

export interface BcvMarketIntelligence {
  window: BcvWindow;
  gap: BcvGap;
  recommendation: BcvRecommendation;
}

/**
 * Calcula inteligencia de mercado BCV basado en ciclos de intervención cambiaria
 * y brecha entre tasa paralela y oficial.
 *
 * Ciclo típico BCV: intervención cada ~24-48h (martes/jueves/viernes).
 * Se aproxima con un offset de 24h desde la última intervención conocida.
 */
export function getBcvMarketIntelligence(
  parallelRate: number,
  bcvRate: number,
): BcvMarketIntelligence {
  const gapPct = bcvRate > 0
    ? ((parallelRate - bcvRate) / bcvRate) * 100
    : 0;

  // Ciclo BCV aproximado (intervención cada ~24h hábiles)
  const hourOfDay = new Date().getHours();
  const dayOfWeek = new Date().getDay(); // 0=Dom, 1=Lun...5=Vie

  let window: BcvWindow;

  // Ventana de intervención: martes, jueves, viernes 09:00-15:00 VET (UTC-4)
  const isInterventionDay = dayOfWeek === 2 || dayOfWeek === 4 || dayOfWeek === 5;
  const isInterventionHour = hourOfDay >= 9 && hourOfDay <= 15;

  if (isInterventionDay && isInterventionHour && gapPct > 12) {
    window = {
      phase: 'INTERVENTION_ACTIVE',
      hoursUntilIntervention: 0,
    };
  } else if (gapPct > 20) {
    // Brecha tan alta que intervención es probable
    const hoursRemaining = isInterventionDay
      ? Math.max(0, 9 - hourOfDay)
      : 24 - hourOfDay + (dayOfWeek < 2 ? (2 - dayOfWeek) * 24 : (5 - dayOfWeek) * 24);
    window = {
      phase: 'NO_INTERVENTION_IMMINENT',
      hoursUntilIntervention: hoursRemaining,
    };
  } else {
    window = {
      phase: 'POST_INTERVENTION_COOLING',
      hoursUntilIntervention: 24,
    };
  }

  // Recomendación táctica
  let recommendation: BcvRecommendation;
  if (gapPct > 18) {
    recommendation = {
      action: 'EXPAND_SPREAD',
      rationale: `Brecha BCV-paralelo ${gapPct.toFixed(1)}% crea oportunidad de capturar margen`,
    };
  } else if (gapPct < 8) {
    recommendation = {
      action: 'REDUCE_EXPOSURE',
      rationale: `Brecha ${gapPct.toFixed(1)}% indica presión de convergencia; proteger capital`,
    };
  } else {
    recommendation = {
      action: 'MAINTAIN_NORMAL',
      rationale: `Brecha ${gapPct.toFixed(1)}% dentro de rango operativo normal`,
    };
  }

  return {
    window,
    gap: {
      gapPct: Number(gapPct.toFixed(2)),
      parallelRate,
      bcvRate,
    },
    recommendation,
  };
}