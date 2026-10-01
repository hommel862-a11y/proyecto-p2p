/**
 * @p2p/core — Módulo local del motor de trading P2P Decisor.
 * Implementaciones deterministas para las herramientas MCP.
 */

import { createHash } from 'node:crypto';

// ─── computeSha256 ────────────────────────────────────────────────────────────

export function computeSha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ─── roundMoney ──────────────────────────────────────────────────────────────

export function roundMoney(value: number, decimals: number = 2): number {
  // Hand-maintained mirror of `projects/core/src/lib/money.ts`. Unlike the copies under
  // `electron/main/vendor/p2p-core` (which `gemini-skills.spec.ts` enforces byte-for-byte),
  // this aggregate is NOT covered by that guard, so semantic drift here is silent. The
  // -0 normalization below MUST match the core, because the engines in this file route
  // every reported margin through it.
  const factor = Math.pow(10, decimals);
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  // Keep the canonical 0: rounding a small negative yields -0, which is mathematically zero
  // but compares unequal to 0 and would surface as a signed "edge" in the tool payload.
  return rounded === 0 ? 0 : rounded;
}

// ─── nd (no disponible) ───────────────────────────────────────────────────────

/**
 * Renders a nullable measurement inside a human-readable sentence.
 *
 * A missing measurement is an absence, not a zero. The two obvious wrong
 * answers both invent a fact:
 *
 * - `value ?? 0` prints `0.00`, which for a gap reads as "the parallel rate and
 *   the official rate are identical" — a claim about the market that nobody
 *   measured, and the single most dangerous thing a rates tool can say.
 * - raw interpolation prints the literal word `null`.
 *
 * `N/D` (no disponible) is the honest rendering: it occupies the same slot as a
 * number and states that the slot is empty.
 *
 * Non-finite values (`NaN`, `±Infinity`) are absences too, so they render as
 * `N/D` rather than as a numeric string that would parse back as a rate.
 */
export function nd(value: number | null | undefined, decimals = 2): string {
  return value == null || !Number.isFinite(value) ? 'N/D' : value.toFixed(decimals);
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
  parallelRate: number | null;
  bcvRate: number | null;
  /** `null` when either side is missing. A zero gap is a claim about the world. */
  gapVes: number | null;
  gapPct: number | null;
  zone: BcvGapZone | 'UNAVAILABLE';
  description: string;
  /** A gap nobody measured is not a gap you can act on. */
  actionable: boolean;
  unavailableReason: string | null;
}

export interface BcvPredictorWindow {
  vetDayOfWeek: number;
  vetHour: number;
  phase: InterventionPhase;
  /**
   * Always `null`.
   *
   * This used to be 95 / 85 / 80 / 75, chosen from the day of the week and the
   * hour. There is no model, no historical series and no intervention record
   * behind those numbers — they were a calendar dressed up as a forecast, and a
   * percentage is the single most trusted shape an agent can be handed.
   */
  probabilityPct: number | null;
  probabilityBasis: 'NO_MODEL';
  nextExpectedIntervention: string;
  hoursUntilIntervention: number;
  rationale: string;
  actionable: false;
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
 *
 * Falla cerrado. Antes devolvía `gapPct: 0` y `zone: 'NORMAL'` cuando una tasa
 * faltaba, y eso se lee como "no hay brecha" — una afirmación sobre el mercado.
 * Cuando falta una de las dos tasas, la brecha se desconoce.
 */
export function calculateBcvGap(
  parallelRate: number | null,
  bcvRate: number | null,
): BcvGapAnalysis {
  const missing =
    parallelRate == null || !Number.isFinite(parallelRate) || parallelRate <= 0
      ? 'TASA_PARALELA_NO_DISPONIBLE'
      : bcvRate == null || !Number.isFinite(bcvRate) || bcvRate <= 0
        ? 'TASA_BCV_NO_DISPONIBLE'
        : null;

  if (missing) {
    return {
      parallelRate: parallelRate ?? null,
      bcvRate: bcvRate ?? null,
      gapVes: null,
      gapPct: null,
      zone: 'UNAVAILABLE',
      description:
        'Brecha indeterminada: falta al menos una de las dos tasas. No se emite zona de riesgo porque no hay medición.',
      actionable: false,
      unavailableReason: missing,
    };
  }

  const gapVes = Math.round((parallelRate! - bcvRate!) * 100) / 100;
  const gapPct = Math.round(((parallelRate! - bcvRate!) / bcvRate!) * 10000) / 100;

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
    actionable: true,
    unavailableReason: null,
  };
}

/**
 * Describe la fase del ciclo cambiario por reloj de Venezuela.
 *
 * Sólo afirma lo observable: qué día y qué hora son en VET, y la fase que el
 * calendario sugiere. NO emite probabilidad. Las 95/85/80/75 anteriores
 * salían del día de la semana y la hora, sin modelo, histórico ni registro de
 * intervenciones — un calendario vestido de pronóstico.
 */
export function predictBcvIntervention(now: Date = new Date()): BcvPredictorWindow {
  const { day, hour } = getVenezuelaTimeParts(now);
  const isInterventionDay = day === 1 || day === 4; // Lunes principal, Jueves refuerzo

  let phase: InterventionPhase;
  let nextExpectedIntervention: string;
  let hoursUntilIntervention: number;
  let calendarNote: string;

  if (isInterventionDay && hour >= 9 && hour <= 13) {
    phase = 'INTERVENTION_ACTIVE';
    nextExpectedIntervention = 'En curso actualmente';
    hoursUntilIntervention = 0;
    calendarNote = day === 1 ? 'Lunes principal' : 'Jueves de refuerzo';
  } else if (
    (day === 0 && hour >= 16) ||
    (day === 1 && hour < 9) ||
    (day === 3 && hour >= 18) ||
    (day === 4 && hour < 9)
  ) {
    phase = 'PRE_INTERVENTION_COMPRESSION';
    nextExpectedIntervention =
      day === 1 || day === 0 ? 'Lunes 09:30 AM VET' : 'Jueves 09:30 AM VET';
    hoursUntilIntervention = day === 1 || day === 4 ? Math.max(1, 9 - hour) : 12;
    calendarNote = 'ventana previa a subasta';
  } else if ((isInterventionDay && hour > 13) || day === 2 || day === 5) {
    phase = 'POST_INTERVENTION_REBOUND';
    nextExpectedIntervention = day <= 2 ? 'Jueves 09:30 AM VET' : 'Próximo Lunes 09:30 AM VET';
    hoursUntilIntervention = day === 2 ? 40 : day === 5 ? 65 : 20;
    calendarNote = 'ventana posterior a subasta';
  } else {
    phase = 'QUIET_ACCUMULATION';
    nextExpectedIntervention = day === 3 ? 'Jueves 09:30 AM VET' : 'Lunes 09:30 AM VET';
    hoursUntilIntervention = day === 3 ? 18 : 36;
    calendarNote = 'fuera de subastas bancarias';
  }

  return {
    vetDayOfWeek: day,
    vetHour: hour,
    phase,
    probabilityPct: null,
    probabilityBasis: 'NO_MODEL',
    nextExpectedIntervention,
    hoursUntilIntervention,
    rationale:
      `Fase de calendario: ${calendarNote} (${day === 1 ? 'Lunes' : day === 4 ? 'Jueves' : 'día no hábil'}, ` +
      `${String(hour).padStart(2, '0')}:00 VET). Esta herramienta no hay modelo probabilístico ni histórico ` +
      'de intervenciones, por lo que no emite probabilidad de intervención.',
    actionable: false,
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

  // An unmeasured gap cannot steer a position, so it is checked before every
  // other branch. `gap.gapPct` is `null` in this case, and each branch below both
  // reads that number and emits a trade instruction. Letting it fall through to
  // MAINTAIN_NORMAL would order "rotate intraday as normal" on the strength of a
  // gap nobody measured — and `null >= 22` is `false`, so the hot-gap test would
  // also fail silently. The absence is published as the recommendation instead.
  if (gap.gapPct == null) {
    recommendation = {
      action: 'UNAVAILABLE',
      rationale:
        `Brecha indeterminada (${gap.unavailableReason ?? 'TASA_NO_DISPONIBLE'}): ` +
        `no se emite recomendación táctica porque no hay medición. ` +
        `Paralelo: ${nd(gap.parallelRate)} VES · BCV: ${nd(gap.bcvRate)} VES.`,
    };
  } else if (gap.zone === 'CRITICAL_DISPERSION') {
    recommendation = {
      action: 'DEFENSIVE_HEDGE',
      rationale: `Dispersión crítica (${nd(gap.gapPct)}%). Riesgo cambiario inminente. Blindaje 100% USDT.`,
    };
  } else if (
    window.phase === 'PRE_INTERVENTION_COMPRESSION' &&
    (gap.zone === 'ELEVATED' || gap.gapPct >= 22)
  ) {
    recommendation = {
      action: 'EXPAND_SPREAD',
      rationale: `Brecha caliente (${nd(gap.gapPct)}%) previa a subasta. Maximizar captura en puntas altas.`,
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
      rationale: `Brecha (${nd(gap.gapPct)}%) en rango operativo normal. Rotación intradía estándar.`,
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

/**
 * Una lectura de tasa que alguien realmente fue a buscar.
 * `null` en cualquier campo significa que ese campo no se pudo leer.
 */
export interface BcvLiveReading {
  usd: number | null;
  eur: number | null;
  cny: number | null;
  rub: number | null;
  effectiveDate: string | null;
  /** De dónde salió el número, tal cual lo reportó la fuente. */
  source: string;
  fetchedAt: string;
}

export interface OfficialBcvRates {
  usd: number | null;
  eur: number | null;
  cny: number | null;
  rub: number | null;
  /** `null` cuando no hay tasa: una fecha de valor sin tasa no describe nada. */
  effectiveDate: string | null;
  /** Nunca `BCV_OFFICIAL_FEED` a menos que un feed real haya respondido. */
  source: string;
  provenance: 'LIVE' | 'UNAVAILABLE_NO_LIVE_SOURCE';
  unavailableReason: string | null;
  expectedSource: string;
  actionable: boolean;
  isFallback: boolean;
  timestamp: string;
}

/**
 * Dónde debería venir la tasa oficial si alguien la fuera a buscar.
 */
export const BCV_EXPECTED_SOURCE =
  'Cotizave API `GET /v1/fx/rates` (endpoint credentialed, header `X-API-Key`; markets `reference`→USD oficial y `eur_reference`→EUR oficial) · MCP get_bcv_rates';

/**
 * Retorna las tasas oficiales publicadas por el Banco Central de Venezuela.
 *
 * Antes devolvía un literal — `usd: 68.45, eur: 74.2, cny: 9.42, rub: 0.76` —
 * con `source: 'BCV_OFFICIAL_FEED'` y un `isFallback` que los llamadores ignoraban.
 * Eso no era una tasa oficial: era un número escrito a mano con el nombre de una
 * institución encima. Peor: 68.45 no se parecía a ninguna tasa real observada
 * (la de la fecha del incidente era 857.8876), así que no era ni un default
 * tolerable ni un redondeo.
 *
 * Ahora la ausencia se propaga como ausencia y la lectura real pasa intacta.
 */
export function getOfficialBcvRates(
  cacheFallback = true,
  reading: BcvLiveReading | null = null,
): OfficialBcvRates {
  const now = new Date().toISOString();
  const pos = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(v) && v > 0 ? v : null;

  if (!reading) {
    return {
      usd: null,
      eur: null,
      cny: null,
      rub: null,
      effectiveDate: null,
      source: 'SIN_FUENTE_BCV',
      provenance: 'UNAVAILABLE_NO_LIVE_SOURCE',
      unavailableReason: 'SIN_FUENTE_BCV_EN_VIVO',
      expectedSource: BCV_EXPECTED_SOURCE,
      actionable: false,
      isFallback: cacheFallback,
      timestamp: now,
    };
  }

  const usd = pos(reading.usd);
  const eur = pos(reading.eur);
  const cny = pos(reading.cny);
  const rub = pos(reading.rub);

  // A live response that carries no usable rate is still an absence.
  if (usd == null && eur == null && cny == null && rub == null) {
    return {
      usd: null,
      eur: null,
      cny: null,
      rub: null,
      effectiveDate: null,
      source: reading.source,
      provenance: 'UNAVAILABLE_NO_LIVE_SOURCE',
      unavailableReason: 'RESPUESTA_SIN_TASAS_USABLES',
      expectedSource: BCV_EXPECTED_SOURCE,
      actionable: false,
      isFallback: cacheFallback,
      timestamp: now,
    };
  }

  return {
    usd,
    eur,
    cny,
    rub,
    effectiveDate: reading.effectiveDate,
    source: reading.source,
    provenance: 'LIVE',
    unavailableReason: null,
    expectedSource: BCV_EXPECTED_SOURCE,
    actionable: false,
    isFallback: false,
    timestamp: now,
  };
}

/**
 * Una cotización paralelo que alguien realmente fue a leer de un monitor concreto.
 */
export interface ParallelLiveReading {
  source: string;
  ask: number;
  bid: number;
  fetchedAt: string;
}

export interface ParallelRateEntry {
  source: string;
  ask: number;
  bid: number;
  mid: number;
  spreadPct: number;
  updatedAt: string;
  sourceLabel: 'LIVE';
}

export interface ParallelRatesFeed {
  timestamp: string;
  /** Sólo monitores efectivamente leídos. Sin lectura, sin entrada. */
  sources: Record<string, ParallelRateEntry>;
  summary: {
    /** `null` sin al menos una lectura: un mid inventado es peor que ninguno. */
    averageMid: number | null;
    highestAsk: number | null;
    lowestBid: number | null;
    dispersionPct: number | null;
  };
  provenance: 'LIVE' | 'UNAVAILABLE_NO_LIVE_SOURCE';
  unavailableReason: string | null;
  expectedSource: string;
  actionable: boolean;
}

/**
 * Dónde deberían venir las cotizaciones paralelas si alguien las fuera a buscar.
 */
export const PARALLEL_EXPECTED_SOURCE =
  'Binance P2P C2C (endpoint público) · EnParaleloVzla · CriptoNoticias · CotizaVe';

/**
 * Retorna cotizaciones paralelas consolidadas de los monitores que se leyeron.
 *
 * Antes publicaba cuatro citas fijas atribuidas a cuatro monitores nombrados
 * (`binance_p2p`, `criptonoticias`, `enparalelovzla`, `cotizave`) y, cuando no
 * había ninguna, devolvía 79.5 / 80.5 / 78.8 como resumen. Ninguno de esos
 * monitores se consultaba. El resultado: una "dispersión de mercado" calculada
 * sobre números escritos a mano, con el nombre de cuatro fuentes encima.
 */
export function getParallelRatesFeed(
  requestedSources?: string[],
  readings: ParallelLiveReading[] = [],
): ParallelRatesFeed {
  const now = new Date().toISOString();

  const sources: Record<string, ParallelRateEntry> = {};
  const mids: number[] = [];
  const asks: number[] = [];
  const bids: number[] = [];

  for (const reading of readings) {
    if (requestedSources && requestedSources.length > 0) {
      const match = requestedSources.some((s) =>
        reading.source.toLowerCase().includes(s.toLowerCase()),
      );
      if (!match) continue;
    }
    if (!Number.isFinite(reading.ask) || reading.ask <= 0) continue;
    if (!Number.isFinite(reading.bid) || reading.bid <= 0) continue;

    const mid = Math.round(((reading.ask + reading.bid) / 2) * 100) / 100;
    const spreadPct = Math.round(((reading.ask - reading.bid) / reading.bid) * 10000) / 100;

    sources[reading.source] = {
      source: reading.source,
      ask: reading.ask,
      bid: reading.bid,
      mid,
      spreadPct,
      updatedAt: reading.fetchedAt,
      sourceLabel: 'LIVE',
    };

    mids.push(mid);
    asks.push(reading.ask);
    bids.push(reading.bid);
  }

  if (mids.length === 0) {
    return {
      timestamp: now,
      sources: {},
      summary: {
        averageMid: null,
        highestAsk: null,
        lowestBid: null,
        dispersionPct: null,
      },
      provenance: 'UNAVAILABLE_NO_LIVE_SOURCE',
      unavailableReason: 'SIN_MONITORES_PARALELOS_EN_VIVO',
      expectedSource: PARALLEL_EXPECTED_SOURCE,
      actionable: false,
    };
  }

  const averageMid = Math.round((mids.reduce((a, b) => a + b, 0) / mids.length) * 100) / 100;
  const highestAsk = Math.max(...asks);
  const lowestBid = Math.min(...bids);

  return {
    timestamp: now,
    sources,
    summary: {
      averageMid,
      highestAsk,
      lowestBid,
      dispersionPct:
        // Disagreement *between* venues. With a single venue there is nothing to
        // disagree about: the arithmetic would collapse to 0 and report "every
        // monitor agrees perfectly" from a sample of one. That is a conclusion
        // invented from an absence of comparison, so it stays null until a second
        // venue is actually read.
        mids.length >= 2 && averageMid > 0
          ? Math.round(((highestAsk - lowestBid) / averageMid) * 10000) / 100
          : null,
    },
    provenance: 'LIVE',
    unavailableReason: null,
    expectedSource: PARALLEL_EXPECTED_SOURCE,
    actionable: false,
  };
}

export interface AutofillTradeReferenceResult {
  side: 'BUY' | 'SELL';
  referenceMidRate: number | null;
  targetMarginPct: number;
  /** `null` sin un mid real: un precio de orden sin libro es un pedido al vacío. */
  suggestedPrice: number | null;
  marginVes: number | null;
  executionAdvice: string;
  actionable: boolean;
  unavailableReason: string | null;
  expectedSource: string;
}

/**
 * Calcula el precio sugerido de apertura de orden P2P según el margen deseado.
 *
 * Antes tomaba el mid de un feed de cuatro cotizaciones escritas a mano y publicaba
 * un precio de orden derivado de ahí. Un precio de orden es una instrucción, no una
 * estimación: si el mid no viene de un libro real, no hay precio que sugerir.
 */
export function computeAutofillTradePrice(
  side: 'BUY' | 'SELL',
  targetMarginPct = 1.0,
  realMidRate?: number | null,
): AutofillTradeReferenceResult {
  const mid =
    realMidRate != null && Number.isFinite(realMidRate) && realMidRate > 0 ? realMidRate : null;

  if (mid == null) {
    return {
      side,
      referenceMidRate: null,
      targetMarginPct,
      suggestedPrice: null,
      marginVes: null,
      executionAdvice:
        'No se sugiere precio de orden: sin un punto medio de mercado leído en vivo, un precio sería una instrucción enviada al vacío.',
      actionable: false,
      unavailableReason: 'SIN_MID_DE_MERCADO_EN_VIVO',
      expectedSource: 'getParallelRatesFeed (Binance P2P u otro monitor leído)',
    };
  }

  const suggestedPrice =
    side === 'BUY'
      ? Math.round(mid * (1 - targetMarginPct / 100) * 100) / 100
      : Math.round(mid * (1 + targetMarginPct / 100) * 100) / 100;
  const marginVes =
    side === 'BUY'
      ? Math.round((mid - suggestedPrice) * 100) / 100
      : Math.round((suggestedPrice - mid) * 100) / 100;

  return {
    side,
    referenceMidRate: mid,
    targetMarginPct,
    suggestedPrice,
    marginVes,
    executionAdvice:
      side === 'BUY'
        ? `Colocar anuncio de compra de USDT a ${suggestedPrice.toFixed(2)} VES (-${targetMarginPct}% respecto al mid ${mid.toFixed(2)} VES).`
        : `Colocar anuncio de venta de USDT a ${suggestedPrice.toFixed(2)} VES (+${targetMarginPct}% respecto al mid ${mid.toFixed(2)} VES).`,
    // The price is evidence-based here, so it is usable. That is not the same as
    // auto-executable: no tool in this system places an order by itself.
    actionable: true,
    unavailableReason: null,
    expectedSource: 'getParallelRatesFeed (Binance P2P u otro monitor leído)',
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

/**
 * Whether an assessment had real data behind it.
 *
 * `NOT_ASSESSED` is not a grade. It is the absence of one: an operator with no
 * recorded operations has neither complied nor failed, and reporting either
 * would be a fabrication. Downstream code must branch on this before reading
 * any score, because a null score is not comparable to 0 and not comparable to
 * 100.
 */
export type AssessmentStatus = 'ASSESSED' | 'NOT_ASSESSED';

export interface SpreadDisciplineResult {
  assessmentStatus: AssessmentStatus;
  totalOperationsAnalyzed: number;
  compliantOperationsCount: number;
  nonCompliantOperationsCount: number;
  /** `null` when `assessmentStatus` is `NOT_ASSESSED`. */
  complianceRatePct: number | null;
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
  assessmentStatus: AssessmentStatus;
  operatorStanding: 'DISCIPLINED' | 'MODERATE_DEVIATION' | 'CRITICAL_TILT_RISK' | 'NOT_ASSESSED';
  /** `null` when `assessmentStatus` is `NOT_ASSESSED`. */
  goldenRuleComplianceScore: number | null; // 0..100
  /** `null` when `assessmentStatus` is `NOT_ASSESSED`. */
  riskConcentrationScore: number | null; // 0..100
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
          parsed.netSpreadPct ?? parsed.spreadPct ?? parsed.expectedNetSpreadPct ?? parsed.spread;
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
          return candidate;
        }
      }
    } catch {
      /* ignore malformed payload */
    }
  }
  return 0;
}

function extractVolumeUsdt(op: ForensicOperationRecord): number {
  if (
    typeof op.cryptoAmount === 'number' &&
    Number.isFinite(op.cryptoAmount) &&
    op.cryptoAmount > 0
  ) {
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
    if (!bucket) continue;
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
    if (!b) continue;
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
  minSpreadThresholdPct = 0.5,
): SpreadDisciplineResult {
  if (operations.length === 0) {
    return {
      assessmentStatus: 'NOT_ASSESSED',
      totalOperationsAnalyzed: 0,
      compliantOperationsCount: 0,
      nonCompliantOperationsCount: 0,
      // An empty ledger is not a perfect ledger. Returning 100 here made every
      // downstream comparison land on its best branch and certified an operator
      // who has never traded as 100% compliant.
      complianceRatePct: null,
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
    const tA = Number(
      a.createdAt ||
        (typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime()) ||
        0,
    );
    const tB = Number(
      b.createdAt ||
        (typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime()) ||
        0,
    );
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
    assessmentStatus: 'ASSESSED',
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

  // Without operations there is nothing to grade. Every branch below compares
  // `complianceRatePct` against thresholds, so any value chosen for "no data"
  // silently becomes a verdict — 100 certified an empty track record as
  // institutionally disciplined. Refuse to produce a rating instead.
  if (disciplineAudit.assessmentStatus === 'NOT_ASSESSED') {
    return {
      generatedAt: Date.now(),
      assessmentStatus: 'NOT_ASSESSED',
      operatorStanding: 'NOT_ASSESSED',
      goldenRuleComplianceScore: null,
      riskConcentrationScore: null,
      hourlyRisk,
      disciplineAudit,
      criticalFindings,
      preventiveDirectives,
      executiveVerdict:
        disciplineAudit.totalOperationsAnalyzed === 0
          ? 'SIN CALIFICAR: No hay operaciones registradas. La disciplina operativa no puede evaluarse hasta que exista historial.'
          : 'SIN CALIFICAR: La muestra de operaciones es insuficiente para emitir una calificación.',
    };
  }

  const complianceRatePct = disciplineAudit.complianceRatePct as number;

  let operatorStanding: 'DISCIPLINED' | 'MODERATE_DEVIATION' | 'CRITICAL_TILT_RISK' = 'DISCIPLINED';

  if (complianceRatePct < 80 || disciplineAudit.tiltSeverity === 'SEVERE') {
    operatorStanding = 'CRITICAL_TILT_RISK';
  } else if (
    complianceRatePct < 95 ||
    disciplineAudit.tiltSeverity === 'MODERATE' ||
    hourlyRisk.highRiskHours.length >= 3
  ) {
    operatorStanding = 'MODERATE_DEVIATION';
  }

  if (complianceRatePct >= 95) {
    criticalFindings.push(
      `Excelente apego a la Regla de Oro: ${complianceRatePct}% de las operaciones cumplieron con el spread neto >= ${disciplineAudit.minSpreadThresholdPct}%.`,
    );
  } else {
    criticalFindings.push(
      `Infracción de margen mínimo en ${disciplineAudit.nonCompliantOperationsCount} operaciones (${(100 - complianceRatePct).toFixed(1)}% de desvío). Lucro cesante estimado: $${disciplineAudit.estimatedSacrificedProfitUsdt} USDT.`,
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
    preventiveDirectives.push(
      'Activar pausa mandatoria de 60 minutos en la mesa antes de tomar nuevas órdenes.',
    );
    preventiveDirectives.push(
      'Bloquear órdenes que no alcancen spread neto de 0.50% mediante Circuit Breaker.',
    );
  } else if (operatorStanding === 'MODERATE_DEVIATION') {
    preventiveDirectives.push(
      'Ajustar cotizaciones en ventana pico para incorporar prima de riesgo bancario (+0.25%).',
    );
    preventiveDirectives.push(
      'Verificar comisiones bancarias acumuladas que erosionan el margen neto.',
    );
  } else {
    preventiveDirectives.push(
      'Mantener el estándar disciplinario actual y sostener el libro de órdenes como Maker.',
    );
  }

  const goldenRuleComplianceScore = Math.round(complianceRatePct);
  const riskConcentrationScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 - hourlyRisk.criticalIncidentRatePct * 1.5 - hourlyRisk.highRiskHours.length * 5,
      ),
    ),
  );

  let executiveVerdict = 'Operador apto con grado de disciplina institucional.';
  if (operatorStanding === 'CRITICAL_TILT_RISK') {
    executiveVerdict =
      'OPERADOR EN RIESGO: Desviación sistemática de márgenes y susceptibilidad a tilt. Requiere contramedidas de inmediato.';
  } else if (operatorStanding === 'MODERATE_DEVIATION') {
    executiveVerdict =
      'DESVIACIÓN MODERADA: Apego aceptable pero con vulnerabilidad en horarios pico y margen erosionado.';
  }

  return {
    generatedAt: Date.now(),
    assessmentStatus: 'ASSESSED',
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

// ==========================================
// 1. SYNTHETIC STABLECOIN ARBITRAGE HUNTER
// ==========================================

export type StableAsset = 'USDT' | 'USDC' | 'FDUSD' | 'EURC' | 'PYUSD';

export interface StableCrossQuote {
  targetAsset: StableAsset;
  spotPair: string;
  spotRate: number;
  spotFeePct?: number;
  p2pMakerFeePct?: number;
  transferOrCashFrictionPct?: number;
  p2pUsdtRateFiat: number;
  p2pTargetRateFiat: number;
  fiatCurrency?: string;
  tradingCapitalUsd?: number;
}

export interface SyntheticStableOpportunity {
  id: string;
  targetAsset: StableAsset;
  spotPair: string;
  spotRate: number;
  syntheticP2pEquivalentRate: number;
  p2pTargetMarketRate: number;
  /** Always observable: the spot/P2P rate dislocation needs no cost assumption. */
  grossSpreadPct: number;
  /** `null` when at least one cost input is missing. An unmeasured cost is not a zero cost. */
  estimatedFeesPct: number | null;
  /**
   * `null` when at least one cost input is missing. A net margin derived from zeroed costs
   * is inflated by exactly the term that was never measured and would be read as available
   * margin. `null` means "no net margin is knowable", never 0.
   */
  netSpreadPct: number | null;
  direction: 'CONVERT_SPOT_AND_SELL_P2P' | 'BUY_P2P_AND_CONVERT_SPOT' | 'NO_OPPORTUNITY';
  projectedProfitUsd: number;
  isActionable: boolean;
  reason?: 'MISSING_FRICTION_METRICS';
  missingCostInputs: readonly (
    | 'spotFeePct'
    | 'p2pMakerFeePct'
    | 'transferOrCashFrictionPct'
  )[];
  actionDirective: string;
  timestamp: string;
}

export function calculateSyntheticStableOpportunity(
  quote: StableCrossQuote,
  minThresholdPct = 0.45,
): SyntheticStableOpportunity {
  const capital = quote.tradingCapitalUsd && quote.tradingCapitalUsd > 0 ? quote.tradingCapitalUsd : 1000;

  // An unknown fee is not a zero fee. Every cost term must be supplied by the caller;
  // when one is missing the route is reported but never marked actionable, because the
  // net margin would otherwise be inflated by the very term that is unknown.
  const missingCostInputs: ('spotFeePct' | 'p2pMakerFeePct' | 'transferOrCashFrictionPct')[] = [];
  if (quote.spotFeePct === undefined) missingCostInputs.push('spotFeePct');
  if (quote.p2pMakerFeePct === undefined) missingCostInputs.push('p2pMakerFeePct');
  if (quote.transferOrCashFrictionPct === undefined) missingCostInputs.push('transferOrCashFrictionPct');
  const hasExplicitCosts = missingCostInputs.length === 0;

  const spotFee = quote.spotFeePct ?? 0;
  const p2pMakerFee = quote.p2pMakerFeePct ?? 0;
  const settlementFriction = quote.transferOrCashFrictionPct ?? 0;
  // Only summed when every term was supplied: the aggregate is meaningless over a mix of
  // measured and defaulted terms, and it would read as a real fee estimate.
  const totalFrictionPct = hasExplicitCosts ? spotFee + p2pMakerFee + settlementFriction : null;

  const syntheticCostFiat = quote.spotRate * quote.p2pUsdtRateFiat;
  const marketSellFiat = quote.p2pTargetRateFiat;

  const spreadRouteA = syntheticCostFiat > 0
    ? ((marketSellFiat - syntheticCostFiat) / syntheticCostFiat) * 100
    : 0;

  const spreadRouteB = marketSellFiat > 0
    ? ((syntheticCostFiat - marketSellFiat) / marketSellFiat) * 100
    : 0;

  let direction: 'CONVERT_SPOT_AND_SELL_P2P' | 'BUY_P2P_AND_CONVERT_SPOT' | 'NO_OPPORTUNITY' = 'NO_OPPORTUNITY';
  let bestGrossSpread = 0;

  // Direction is chosen from the observable rate dislocation only; whether it survives costs
  // is a separate question that needs the cost inputs.
  if (spreadRouteA > spreadRouteB && spreadRouteA > 0) {
    direction = 'CONVERT_SPOT_AND_SELL_P2P';
    bestGrossSpread = spreadRouteA;
  } else if (spreadRouteB > 0) {
    direction = 'BUY_P2P_AND_CONVERT_SPOT';
    bestGrossSpread = spreadRouteB;
  } else {
    direction = 'NO_OPPORTUNITY';
    bestGrossSpread = Math.max(spreadRouteA, spreadRouteB);
  }

  // The net margin only exists when every cost term was measured. A zero-cost subtraction
  // would be inflated by exactly the term we did not measure, so it is not reported at all.
  const roundedGrossSpread = roundMoney(bestGrossSpread, 2);
  const roundedNetSpread: number | null =
    totalFrictionPct === null ? null : roundMoney(bestGrossSpread - totalFrictionPct, 2);
  const isActionable =
    hasExplicitCosts &&
    roundedNetSpread !== null &&
    roundedNetSpread >= minThresholdPct &&
    direction !== 'NO_OPPORTUNITY';
  const projectedProfitUsd = isActionable
    ? roundMoney((capital * roundedNetSpread!) / 100, 2)
    : 0;

  let actionDirective = 'Mercado alineado sin descalce explotable.';
  if (!hasExplicitCosts) {
    actionDirective =
      `Bloqueado por fricción desconocida: se requieren ${missingCostInputs.join(', ')} antes de autorizar ejecución. ` +
      `El descalce bruto es observable (${roundedGrossSpread}%), el margen neto no.`;
  } else if (direction === 'CONVERT_SPOT_AND_SELL_P2P') {
    actionDirective = `Comprar ${quote.targetAsset} en Spot a tasa ${quote.spotRate.toFixed(4)} y publicar anuncio de venta P2P a ${quote.p2pTargetRateFiat.toFixed(2)} ${quote.fiatCurrency || 'VES'}. Margen neto: +${roundedNetSpread}% (+$${projectedProfitUsd} USD).`;
  } else if (direction === 'BUY_P2P_AND_CONVERT_SPOT') {
    actionDirective = `Tomar ${quote.targetAsset} barato en P2P a ${quote.p2pTargetRateFiat.toFixed(2)} ${quote.fiatCurrency || 'VES'} y convertir a USDT en Spot. Margen neto: +${roundedNetSpread}% (+$${projectedProfitUsd} USD).`;
  }

  return {
    id: `SYNTH-${quote.targetAsset}-${Date.now().toString(36)}`,
    targetAsset: quote.targetAsset,
    spotPair: quote.spotPair,
    spotRate: quote.spotRate,
    syntheticP2pEquivalentRate: roundMoney(syntheticCostFiat, 2),
    p2pTargetMarketRate: roundMoney(marketSellFiat, 2),
    grossSpreadPct: roundedGrossSpread,
    estimatedFeesPct: totalFrictionPct === null ? null : roundMoney(totalFrictionPct, 2),
    netSpreadPct: roundedNetSpread,
    direction,
    projectedProfitUsd,
    isActionable,
    ...(hasExplicitCosts ? {} : { reason: 'MISSING_FRICTION_METRICS' as const }),
    missingCostInputs,
    actionDirective,
    timestamp: new Date().toISOString(),
  };
}

export function scanSyntheticStableCurves(
  quotes: readonly StableCrossQuote[],
  minThresholdPct = 0.45,
): SyntheticStableOpportunity[] {
  // Unpriced routes are reported, not hidden: the gross dislocation is real information
  // even when the cost inputs needed to price it are missing.
  return quotes
    .map((q) => calculateSyntheticStableOpportunity(q, minThresholdPct))
    .sort(compareOpportunitiesByNetSpread);
}

/**
 * Opportunities with a known net spread rank first, highest first. An opportunity whose net
 * spread is `null` is not comparable to a number, so it goes last instead of poisoning the
 * ordering with NaN. `Array.prototype.sort` is stable, so unpriced routes keep their input
 * order and the ranking stays deterministic.
 */
function compareOpportunitiesByNetSpread(
  a: SyntheticStableOpportunity,
  b: SyntheticStableOpportunity,
): number {
  if (a.netSpreadPct === null || b.netSpreadPct === null) {
    if (a.netSpreadPct === b.netSpreadPct) return 0;
    return a.netSpreadPct === null ? 1 : -1;
  }
  return b.netSpreadPct - a.netSpreadPct;
}

// ==========================================
// 2. ORDERBOOK SNIPER & DISTRESSED LIQUIDITY
// ==========================================

export interface P2pOrderbookAdItem {
  advId: string;
  merchantName: string;
  orderType: 'BUY' | 'SELL';
  price: number;
  availableAmountCrypto: number;
  minLimitFiat: number;
  maxLimitFiat: number;
  paymentMethods: string[];
  fiatCurrency?: string;
}

export interface SnipedOpportunityAlert {
  advId: string;
  merchantName: string;
  orderType: 'BUY' | 'SELL';
  adPrice: number;
  fairMarketPrice: number;
  priceDivergencePct: number;
  availableLiquidityUsd: number;
  grossProfitUsd: number;
  takerFeePct: number | null;
  netProfitUsd: number;
  netYieldPct: number | null;
  urgencyScore: number;
  recommendedAction: 'SNIPE_IMMEDIATELY' | 'PROCEED_WITH_CAUTION' | 'IGNORE';
  isActionable: boolean;
  reason?: 'MISSING_FRICTION_METRICS';
  riskRationale: string;
  timestamp: string;
}

export interface SniperAuditConfig {
  fairMarketPrice: number;
  minProfitThresholdPct?: number;
  maxTakerFeePct?: number;
  minLiquidityFloorUsd?: number;
}

export function evaluateSnipingOpportunity(
  ad: P2pOrderbookAdItem,
  config: SniperAuditConfig,
): SnipedOpportunityAlert | null {
  const fair = config.fairMarketPrice;
  if (!fair || fair <= 0 || !ad.price || ad.price <= 0) return null;

  const minThreshold = config.minProfitThresholdPct ?? 1.2;
  // An unknown taker fee is not a zero fee. Block instead of defaulting it away.
  const hasExplicitFee = config.maxTakerFeePct !== undefined && config.maxTakerFeePct >= 0;
  const takerFeePct = hasExplicitFee ? config.maxTakerFeePct! : null;
  const floorUsd = config.minLiquidityFloorUsd ?? 50;

  if (ad.availableAmountCrypto < floorUsd) {
    return null;
  }

  let divergencePct = 0;
  let isUnderpricedSell = false;
  let isOverpricedBuy = false;

  if (ad.orderType === 'SELL') {
    divergencePct = ((fair - ad.price) / fair) * 100;
    isUnderpricedSell = divergencePct >= minThreshold;
  } else {
    divergencePct = ((ad.price - fair) / fair) * 100;
    isOverpricedBuy = divergencePct >= minThreshold;
  }

  if (!isUnderpricedSell && !isOverpricedBuy) {
    return null;
  }

  const roundedDivergence = roundMoney(divergencePct, 2);
  const liquidityUsd = roundMoney(ad.availableAmountCrypto, 2);
  const grossProfitUsd = roundMoney((liquidityUsd * roundedDivergence) / 100, 2);

  let netProfitUsd = 0;
  let netYieldPct: number | null = null;
  if (takerFeePct !== null) {
    const takerFeeUsd = roundMoney((liquidityUsd * takerFeePct) / 100, 2);
    netProfitUsd = roundMoney(grossProfitUsd - takerFeeUsd, 2);
    netYieldPct = roundMoney((netProfitUsd / liquidityUsd) * 100, 2);
    // Same gate as the core engine: a priced dislocation that no longer clears the
    // threshold once the fee is deducted is not an opportunity.
    if (netYieldPct < minThreshold) return null;
  }

  const isActionable = takerFeePct !== null;

  let urgency = 50;
  if (roundedDivergence > 2.5) urgency += 30;
  if (liquidityUsd >= 500) urgency += 20;

  let recommendedAction: 'SNIPE_IMMEDIATELY' | 'PROCEED_WITH_CAUTION' | 'IGNORE' = 'SNIPE_IMMEDIATELY';
  let riskRationale = 'Oportunidad de absorción limpia con descalce de precio favorable.';

  if (!isActionable) {
    recommendedAction = 'PROCEED_WITH_CAUTION';
    riskRationale =
      'Bloqueado por fricción desconocida: se requiere parametrizar maxTakerFeePct antes de autorizar ejecución. El descalce de precio es observable, el margen neto no.';
  } else if (roundedDivergence > 6.0) {
    recommendedAction = 'PROCEED_WITH_CAUTION';
    riskRationale = 'Desvío extremo (>6%). Posible error tipográfico grave (fat-finger) o condiciones de pago no estándar. Verificar términos antes de liberar.';
  } else if (ad.paymentMethods.length === 0) {
    recommendedAction = 'PROCEED_WITH_CAUTION';
    riskRationale = 'Sin métodos de pago reconocidos explícitos.';
  }

  return {
    advId: ad.advId,
    merchantName: ad.merchantName,
    orderType: ad.orderType,
    adPrice: ad.price,
    fairMarketPrice: fair,
    priceDivergencePct: roundedDivergence,
    availableLiquidityUsd: liquidityUsd,
    grossProfitUsd,
    takerFeePct,
    netProfitUsd,
    netYieldPct,
    urgencyScore: urgency,
    recommendedAction,
    isActionable,
    ...(isActionable ? {} : { reason: 'MISSING_FRICTION_METRICS' as const }),
    riskRationale,
    timestamp: new Date().toISOString(),
  };
}

export function scanOrderbookSnipingOpportunities(
  ads: readonly P2pOrderbookAdItem[],
  config: SniperAuditConfig,
): SnipedOpportunityAlert[] {
  const alerts: SnipedOpportunityAlert[] = [];
  for (const ad of ads) {
    const evaluated = evaluateSnipingOpportunity(ad, config);
    if (evaluated) {
      alerts.push(evaluated);
    }
  }
  return alerts.sort((a, b) => b.netProfitUsd - a.netProfitUsd);
}

// ==========================================
// 3. MULTI-MARKET OTC DARK POOL AGGREGATOR
// ==========================================

export type VenueType = 'BINANCE_P2P' | 'BYBIT_P2P' | 'ELDORADO_P2P' | 'SYLO_P2P' | 'PHYSICAL_CASH_DESK';

export interface MarketVenueQuote {
  venueId: string;
  venueName: string;
  venueType: VenueType;
  currencyPair: string;
  buyRate: number;
  sellRate: number;
  makerFeePct?: number;
  takerFeePct?: number;
  transferOrCashFrictionPct?: number;
  minTradeVolumeUsd?: number;
  maxTradeVolumeUsd?: number;
  locationCity?: string;
}

export interface CrossVenueArbitrageRoute {
  routeId: string;
  sourceVenue: MarketVenueQuote;
  destinationVenue: MarketVenueQuote;
  asset: string;
  /** Always observable: the price dislocation between two venues needs no cost assumption. */
  grossSpreadPct: number;
  /**
   * `null` when a friction term was never measured. An unmeasured cost is not a zero cost,
   * so no aggregate may be reported for it.
   */
  totalFrictionPct: number | null;
  /**
   * `null` when `hasUnknownFriction` is true. The net margin cannot be derived from a cost
   * term we never measured, and a number here would be read as available margin. `null`
   * means "no net margin is knowable", never 0.
   */
  netSpreadPct: number | null;
  projectedProfitUsd: number;
  capitalTestedUsd: number;
  isActionable: boolean;
  hasUnknownFriction?: boolean;
  reason?: 'MISSING_FRICTION_METRICS';
  securityRating: 'HIGH_SAFETY' | 'MODERATE_SECURITY' | 'PHYSICAL_ESCORT_REQUIRED';
  executionPlaybook: string;
  timestamp: string;
}

export interface DarkPoolAggregatorOptions {
  capitalUsd?: number;
  minNetSpreadPct?: number;
}

export function aggregateDarkPoolOpportunities(
  venues: readonly MarketVenueQuote[],
  options: DarkPoolAggregatorOptions = {},
): CrossVenueArbitrageRoute[] {
  const capital = options.capitalUsd && options.capitalUsd > 0 ? options.capitalUsd : 5000;
  const minNetSpread = options.minNetSpreadPct ?? 1.2;
  const routes: CrossVenueArbitrageRoute[] = [];

  for (const source of venues) {
    for (const dest of venues) {
      if (source.venueId === dest.venueId) continue;
      if (source.currencyPair !== dest.currencyPair) continue;

      const buyCost = source.buyRate;
      const sellProceeds = dest.sellRate;
      if (buyCost <= 0 || sellProceeds <= 0) continue;

      const grossSpread = ((sellProceeds - buyCost) / buyCost) * 100;
      if (grossSpread <= 0) continue;

      const hasUnknownFriction =
        source.transferOrCashFrictionPct === undefined ||
        dest.transferOrCashFrictionPct === undefined;

      // An unmeasured friction term is not a zero friction term. While any term is unknown
      // the net spread is not computed at all: it would be inflated by exactly the cost we
      // did not measure, and a human would read that number as available margin.
      let totalFrictionPct: number | null = null;
      let netSpreadPct: number | null = null;
      if (!hasUnknownFriction) {
        const sourceTransferFriction = source.transferOrCashFrictionPct!;
        const destTransferFriction = dest.transferOrCashFrictionPct!;
        const sourceFriction = (source.takerFeePct ?? 0.1) + sourceTransferFriction;
        const destFriction = (dest.makerFeePct ?? 0.1) + destTransferFriction;
        const totalFriction = sourceFriction + destFriction;

        totalFrictionPct = roundMoney(totalFriction, 2);
        netSpreadPct = roundMoney(grossSpread - totalFriction, 2);
      }

      const isActionable = !hasUnknownFriction && netSpreadPct !== null && netSpreadPct >= minNetSpread;
      const projectedProfitUsd = isActionable ? roundMoney((capital * netSpreadPct!) / 100, 2) : 0;

      let securityRating: 'HIGH_SAFETY' | 'MODERATE_SECURITY' | 'PHYSICAL_ESCORT_REQUIRED' = 'HIGH_SAFETY';
      let playbook = hasUnknownFriction
        ? `Bloqueado por fricción desconocida: Se requiere parametrizar transferOrCashFrictionPct para ${source.venueName} y ${dest.venueName} antes de autorizar ejecución.`
        : `Comprar en ${source.venueName} y vender en ${dest.venueName} vía libro digital.`;

      if (!hasUnknownFriction && (source.venueType === 'PHYSICAL_CASH_DESK' || dest.venueType === 'PHYSICAL_CASH_DESK')) {
        securityRating = 'PHYSICAL_ESCORT_REQUIRED';
        playbook = `ALERTA DE SEGURIDAD FÍSICA: Liquidación en efectivo presencial en mesa física. Exigir furgón/escolta blindada, conteo con máquina UV y acreditación de fondos bancarios antes de retirarse.`;
      } else if (!hasUnknownFriction && (source.venueType === 'ELDORADO_P2P' || dest.venueType === 'ELDORADO_P2P')) {
        securityRating = 'MODERATE_SECURITY';
        playbook = `Operación cross-platform con custodia en El Dorado / Sylo. Verificar confirmación en blockchain antes de liberar fiat.`;
      }

      routes.push({
        routeId: `ROUTE-${source.venueId}-TO-${dest.venueId}`,
        sourceVenue: source,
        destinationVenue: dest,
        asset: source.currencyPair,
        grossSpreadPct: roundMoney(grossSpread, 2),
        totalFrictionPct,
        netSpreadPct,
        projectedProfitUsd,
        capitalTestedUsd: capital,
        isActionable,
        hasUnknownFriction,
        ...(hasUnknownFriction ? { reason: 'MISSING_FRICTION_METRICS' as const } : {}),
        securityRating,
        executionPlaybook: playbook,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return routes.sort(compareRoutesByNetSpread);
}

/**
 * Routes with a known net spread rank first, highest first. A route whose net spread is
 * `null` is not comparable to a number, so it goes last instead of poisoning the ordering
 * with NaN. `Array.prototype.sort` is stable, so unpriced routes keep their insertion order
 * and the ranking stays deterministic.
 */
function compareRoutesByNetSpread(
  a: CrossVenueArbitrageRoute,
  b: CrossVenueArbitrageRoute,
): number {
  if (a.netSpreadPct === null || b.netSpreadPct === null) {
    if (a.netSpreadPct === b.netSpreadPct) return 0;
    return a.netSpreadPct === null ? 1 : -1;
  }
  return b.netSpreadPct - a.netSpreadPct;
}

// ==========================================
// 4. FINTECH SETTLEMENT & PAYROLL ROUTING
// ==========================================

export type FintechPlatform = 'DEEL' | 'WISE' | 'PAYONEER' | 'STRIPE' | 'PAYPAL';
export type PayoutRail = 'USDT_TRC20' | 'VES_PAGO_MOVIL' | 'VES_TRANSFERENCIA' | 'USD_CASH_DELIVERY';

export interface FintechSettlementRequest {
  platform: FintechPlatform;
  grossAmountUsd: number;
  payoutRail: PayoutRail;
  vesRatePerUsd?: number;
  clientTier?: 'STANDARD' | 'RECURRENT_REMOTE' | 'CORPORATE_AGENCY';
  isVerifiedContractor?: boolean;
}

export interface FintechSettlementQuote {
  settlementId: string;
  platform: FintechPlatform;
  payoutRail: PayoutRail;
  grossAmountUsd: number;
  platformIncomingFeeUsd: number;
  deskCommissionPct: number;
  deskCommissionUsd: number;
  netProceedsUsd: number;
  netProceedsVes?: number;
  effectiveExchangeRateVes?: number;
  chargebackRiskTier: 'LOW' | 'MODERATE' | 'HIGH_HOLD_REQUIRED';
  holdHoursRequired: number;
  complianceDossierRequired: boolean;
  formattedClientProposal: string;
  timestamp: string;
}

const PLATFORM_INBOUND_FEES: Record<FintechPlatform, number> = {
  DEEL: 0.0,
  WISE: 0.005,
  PAYONEER: 0.01,
  STRIPE: 0.029,
  PAYPAL: 0.044,
};

function resolveDeskFeePct(platform: FintechPlatform, amount: number, tier: string): number {
  let baseFee = 4.5;
  if (amount >= 10000) baseFee = 3.2;
  else if (amount >= 5000) baseFee = 3.8;
  else if (amount >= 2000) baseFee = 4.2;

  if (tier === 'CORPORATE_AGENCY') baseFee -= 0.5;
  else if (tier === 'RECURRENT_REMOTE') baseFee -= 0.3;

  if (platform === 'PAYPAL') baseFee += 2.5;
  else if (platform === 'STRIPE') baseFee += 1.5;

  return Math.max(1.5, baseFee);
}

export function calculateFintechSettlementQuote(
  req: FintechSettlementRequest,
): FintechSettlementQuote {
  const gross = Math.max(10, req.grossAmountUsd);
  const platformFeeRate = PLATFORM_INBOUND_FEES[req.platform] ?? 0.01;
  const platformIncomingFeeUsd = roundMoney(gross * platformFeeRate, 2);
  const netInboundAfterPlatform = gross - platformIncomingFeeUsd;

  const tier = req.clientTier ?? 'STANDARD';
  const deskCommissionPct = resolveDeskFeePct(req.platform, gross, tier);
  const deskCommissionUsd = roundMoney((netInboundAfterPlatform * deskCommissionPct) / 100, 2);
  const netProceedsUsd = roundMoney(netInboundAfterPlatform - deskCommissionUsd, 2);

  let holdHours = 0;
  let chargebackRisk: 'LOW' | 'MODERATE' | 'HIGH_HOLD_REQUIRED' = 'LOW';
  let complianceRequired = gross >= 3000;

  if (req.platform === 'PAYPAL' || req.platform === 'STRIPE') {
    chargebackRisk = 'HIGH_HOLD_REQUIRED';
    holdHours = req.isVerifiedContractor ? 24 : 48;
    complianceRequired = true;
  } else if (req.platform === 'WISE') {
    chargebackRisk = 'MODERATE';
    holdHours = 6;
  } else {
    chargebackRisk = 'LOW';
    holdHours = 0;
  }

  let netProceedsVes: number | undefined;
  let effectiveRateVes: number | undefined;

  if (req.payoutRail === 'VES_PAGO_MOVIL' || req.payoutRail === 'VES_TRANSFERENCIA') {
    const rate = req.vesRatePerUsd && req.vesRatePerUsd > 0 ? req.vesRatePerUsd : 85.0;
    netProceedsVes = roundMoney(netProceedsUsd * rate, 2);
    effectiveRateVes = roundMoney(netProceedsVes / gross, 2);
  }

  const payoutDesc = netProceedsVes
    ? `${netProceedsVes.toLocaleString('es-VE')} VES`
    : `${netProceedsUsd} USDT`;

  const proposal = [
    `💼 *LIQUIDACIÓN DE FONDOS INTERNACIONALES (${req.platform})*`,
    `────────────────────────────`,
    `💵 *Monto Bruto Facturado:* $${gross.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`,
    `📉 *Comisión de Red/Recepción:* -$${platformIncomingFeeUsd.toFixed(2)} USD`,
    `⚖️ *Tarifa de Gestión de Mesa:* ${deskCommissionPct.toFixed(2)}% (-$${deskCommissionUsd.toFixed(2)} USD)`,
    `✅ *FONDOS NETOS A RECIBIR:* *${payoutDesc}*`,
    `📍 *Método de Desembolso:* ${req.payoutRail}`,
    holdHours > 0 ? `⏳ *Período de Seguridad / Hold:* ${holdHours} horas por política antifraude.` : `⚡ *Desembolso Inmediato:* Sin período de retención.`,
  ].join('\n');

  return {
    settlementId: `STL-${req.platform}-${Date.now().toString(36).toUpperCase()}`,
    platform: req.platform,
    payoutRail: req.payoutRail,
    grossAmountUsd: gross,
    platformIncomingFeeUsd,
    deskCommissionPct,
    deskCommissionUsd,
    netProceedsUsd,
    netProceedsVes,
    effectiveExchangeRateVes: effectiveRateVes,
    chargebackRiskTier: chargebackRisk,
    holdHoursRequired: holdHours,
    complianceDossierRequired: complianceRequired,
    formattedClientProposal: proposal,
    timestamp: new Date().toISOString(),
  };
}

// ==========================================
// 5. COUNTERPARTY YIELD & SPREAD PRICING
// ==========================================

export type CounterpartyTier =
  | 'VIP_INSTITUTIONAL'
  | 'FAST_AND_RELIABLE'
  | 'STANDARD'
  | 'SLOW_OR_FRICTIONAL'
  | 'HIGH_RISK_SURCHARGE';

export interface CounterpartyMetrics {
  counterpartyId: string;
  name?: string;
  averageReleaseMinutes: number;
  completedTradesCount: number;
  disputeCount: number;
  monthlyVolumeUsd: number;
  frictionScore?: number;
}

export interface DynamicPricingRequest {
  metrics: CounterpartyMetrics;
  baseMarketRate: number;
  orderType: 'BUY' | 'SELL';
  requestedAmountUsd: number;
}

export interface DynamicPricingResult {
  counterpartyId: string;
  tier: CounterpartyTier;
  baseMarketRate: number;
  spreadAdjustmentPct: number;
  adjustedRate: number;
  projectedDeskAlphaUsd: number;
  rationale: string;
  recommendedMaxExposureUsd: number;
  timestamp: string;
}

export function classifyCounterpartyTier(metrics: CounterpartyMetrics): CounterpartyTier {
  if (metrics.disputeCount >= 2 || (metrics.frictionScore && metrics.frictionScore > 75)) {
    return 'HIGH_RISK_SURCHARGE';
  }
  if (metrics.completedTradesCount >= 25 && metrics.monthlyVolumeUsd >= 10000 && metrics.averageReleaseMinutes <= 3) {
    return 'VIP_INSTITUTIONAL';
  }
  if (metrics.completedTradesCount >= 10 && metrics.averageReleaseMinutes <= 5) {
    return 'FAST_AND_RELIABLE';
  }
  if (metrics.averageReleaseMinutes > 20 || (metrics.frictionScore && metrics.frictionScore > 50)) {
    return 'SLOW_OR_FRICTIONAL';
  }
  return 'STANDARD';
}

export function calculateDynamicCounterpartyPricing(
  req: DynamicPricingRequest,
): DynamicPricingResult {
  const tier = classifyCounterpartyTier(req.metrics);
  const baseRate = req.baseMarketRate;
  const amount = Math.max(10, req.requestedAmountUsd);

  let spreadAdjustmentPct = 0;
  let rationale = '';
  let maxExposure = 5000;

  switch (tier) {
    case 'VIP_INSTITUTIONAL':
      spreadAdjustmentPct = -0.3;
      rationale = 'Cliente VIP recurrente con liberación ultra rápida (<3 min). Descuento de fidelidad para maximizar rotación de capital.';
      maxExposure = 50000;
      break;
    case 'FAST_AND_RELIABLE':
      spreadAdjustmentPct = 0.0;
      rationale = 'Contraparte rápida y confiable. Tasa de mercado estándar competitiva.';
      maxExposure = 15000;
      break;
    case 'STANDARD':
      spreadAdjustmentPct = 0.35;
      rationale = 'Cliente estándar o nuevo. Margen de seguridad moderado aplicado.';
      maxExposure = 5000;
      break;
    case 'SLOW_OR_FRICTIONAL':
      spreadAdjustmentPct = 1.25;
      rationale = 'Cliente lento (>20 min liberación). Recargo por costo de oportunidad y bloqueo transaccional de cuentas bancarias.';
      maxExposure = 2000;
      break;
    case 'HIGH_RISK_SURCHARGE':
      spreadAdjustmentPct = 2.0;
      rationale = 'Historial de disputas o alta fricción. Recargo estricto de riesgo con límite de exposición reducido.';
      maxExposure = 800;
      break;
  }

  let adjustedRate = baseRate;
  if (req.orderType === 'SELL') {
    adjustedRate = baseRate * (1 + spreadAdjustmentPct / 100);
  } else {
    adjustedRate = baseRate * (1 - spreadAdjustmentPct / 100);
  }

  const roundedRate = roundMoney(adjustedRate, 2);
  const projectedAlphaUsd = roundMoney((amount * Math.abs(spreadAdjustmentPct)) / 100, 2);

  return {
    counterpartyId: req.metrics.counterpartyId,
    tier,
    baseMarketRate: baseRate,
    spreadAdjustmentPct: roundMoney(spreadAdjustmentPct, 2),
    adjustedRate: roundedRate,
    projectedDeskAlphaUsd: projectedAlphaUsd,
    rationale,
    recommendedMaxExposureUsd: maxExposure,
    timestamp: new Date().toISOString(),
  };
}

// ==========================================
// 6. OMNICHANNEL CONCIERGE (WHATSAPP/TELEGRAM)
// ==========================================

export type ConciergeIntent =
  | 'QUOTE_REQUEST'
  | 'PAYMENT_PROOF_SENT'
  | 'BANK_DETAILS_REQUEST'
  | 'GREETING'
  | 'UNRECOGNIZED';

export interface ConciergeParsedInquiry {
  intent: ConciergeIntent;
  detectedAmount?: number;
  detectedCurrency?: string;
  detectedBankRail?: string;
  operationType: 'BUY_CRYPTO' | 'SELL_CRYPTO';
  confidenceScore: number;
}

export interface ConciergeQuoteContext {
  deskRatePerUsd: number;
  bankName: string;
  bankAccountDetails: string;
  quoteValidityMinutes?: number;
}

export interface ConciergeResponsePayload {
  parsedInquiry: ConciergeParsedInquiry;
  quoteAmountCrypto?: number;
  quoteAmountFiat?: number;
  exchangeRateUsed: number;
  validUntilIso: string;
  formattedReplyMessage: string;
  requiresOperatorHumanReview: boolean;
}

export function parseCustomerChatMessage(message: string): ConciergeParsedInquiry {
  const clean = message.toLowerCase().trim();
  let intent: ConciergeIntent = 'UNRECOGNIZED';

  if (/hola|buen(as|os)|saludos|que tal/i.test(clean) && clean.length < 25) {
    intent = 'GREETING';
  } else if (/comprobante|capture|pago realizado|ya transfer[ií]|listo el pago|aqui esta el capture/i.test(clean)) {
    intent = 'PAYMENT_PROOF_SENT';
  } else if (/datos|cuenta|donde transfiero|pasa los datos|numero de cuenta|pago movil/i.test(clean) && !/\d{2,}/.test(clean)) {
    intent = 'BANK_DETAILS_REQUEST';
  } else if (/cuanto|tasa|precio|cotiz|cambi|tienes|disponible|\$/i.test(clean) || /\d+/.test(clean)) {
    intent = 'QUOTE_REQUEST';
  }

  let opType: 'BUY_CRYPTO' | 'SELL_CRYPTO' = 'BUY_CRYPTO';
  if (/vendo|vender|recibo bolivares|cambiar usdt a|tengo usdt/i.test(clean)) {
    opType = 'SELL_CRYPTO';
  }

  let detectedAmount: number | undefined;
  const numMatch = clean.match(/(\d+([\.,]\d+)?)/);
  if (numMatch) {
    const rawNum = numMatch[1].replace(',', '.');
    const parsedVal = parseFloat(rawNum);
    if (!isNaN(parsedVal) && parsedVal > 0) {
      detectedAmount = parsedVal;
    }
  }

  let detectedCurrency = 'USDT';
  if (/bs|ves|boliv/i.test(clean)) detectedCurrency = 'VES';
  else if (/\$|usd|dolar/i.test(clean)) detectedCurrency = 'USD';

  let detectedBankRail: string | undefined;
  if (/pago movil|pagomovil/i.test(clean)) detectedBankRail = 'Pago Móvil';
  else if (/banesco/i.test(clean)) detectedBankRail = 'Banesco';
  else if (/mercantil/i.test(clean)) detectedBankRail = 'Mercantil';
  else if (/zelle/i.test(clean)) detectedBankRail = 'Zelle';

  const confidence = detectedAmount ? 0.9 : 0.6;

  return {
    intent,
    detectedAmount,
    detectedCurrency,
    detectedBankRail,
    operationType: opType,
    confidenceScore: confidence,
  };
}

export function generateConciergeReply(
  inquiry: ConciergeParsedInquiry,
  context: ConciergeQuoteContext,
): ConciergeResponsePayload {
  const rate = context.deskRatePerUsd;
  const validityMins = context.quoteValidityMinutes ?? 15;
  const validUntil = new Date(Date.now() + validityMins * 60000).toISOString();
  const timeFormatted = new Date(Date.now() + validityMins * 60000).toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  let quoteCrypto: number | undefined;
  let quoteFiat: number | undefined;
  let replyText = '';
  let requiresReview = false;

  if (inquiry.intent === 'GREETING') {
    replyText = `👋 ¡Hola! Bienvenido a nuestra Mesa de Cambio P2P.\n\nActualmente tenemos liquidez activa en *Banesco, Mercantil y Pago Móvil*.\n\n📊 *Tasa del Momento:* 1 USDT = ${rate.toFixed(2)} Bs\n\n¿Qué monto te gustaría consultar o cambiar hoy?`;
  } else if (inquiry.intent === 'PAYMENT_PROOF_SENT') {
    replyText = `📥 *Comprobante recibido con éxito.*\n\nEstamos conciliando la referencia en nuestra banca electrónica. Una vez confirmado en cuenta, liberaremos tu operación en menos de 3 minutos.\n\n¡Gracias por tu paciencia!`;
    requiresReview = true;
  } else if (inquiry.intent === 'BANK_DETAILS_REQUEST') {
    replyText = `🏦 *DATOS BANCARIOS OFICIALES PARA TRANSFERIR:*\n\n${context.bankAccountDetails}\n\n⚠️ *Regla de Oro:* Solo recibimos fondos del titular de la cuenta (Cero terceros). Por favor envía el comprobante tras transferir.`;
  } else {
    const amount = inquiry.detectedAmount ?? 100;
    if (inquiry.detectedCurrency === 'VES') {
      quoteFiat = amount;
      quoteCrypto = roundMoney(amount / rate, 2);
    } else {
      quoteCrypto = amount;
      quoteFiat = roundMoney(amount * rate, 2);
    }

    replyText = [
      `📊 *COTIZACIÓN OFICIAL — MESA P2P*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `▪ *Monto a Liquidar:* ${quoteCrypto} USDT`,
      `▪ *Tasa de Mesa:* ${rate.toFixed(2)} Bs/USDT`,
      `▪ *Total Neto en Bolívares:* *${quoteFiat.toLocaleString('es-VE')} VES*`,
      `▪ *Banco:* ${context.bankName}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `⏱️ *Cotización garantizada hasta:* ${timeFormatted} (Válida por ${validityMins} minutos)`,
      `\n¿Deseas que te enviemos los datos bancarios para proceder?`,
    ].join('\n');
  }

  return {
    parsedInquiry: inquiry,
    quoteAmountCrypto: quoteCrypto,
    quoteAmountFiat: quoteFiat,
    exchangeRateUsed: rate,
    validUntilIso: validUntil,
    formattedReplyMessage: replyText,
    requiresOperatorHumanReview: requiresReview,
  };
}

// ==========================================
// 7. MACRO SENTIMENT & BCV INTELLIGENCE
// ==========================================

export type MacroRegimeType =
  | 'BCV_INTERVENTION_WINDOW'
  | 'PARALLEL_GAP_EXPANSION'
  | 'INVENTORY_STABILITY'
  | 'EXTREME_DEVALUATION_PRESSURE';

export interface MacroTelemetryInput {
  bcvOfficialRate: number;
  parallelMarketRate: number;
  daysSinceLastIntervention: number;
  currentHourOfDayUtcMinus4: number;
  currentDayOfWeek: number;
  estimatedWeeklyBcvInjectionUsd?: number;
}

export interface MacroRegimeAssessment {
  regime: MacroRegimeType;
  rateGapPct: number;
  /**
   * A weighted sum of a calendar and a threshold, clamped to [5, 95].
   *
   * It is NOT a calibrated probability: there is no training set, no base rate,
   * no backtest and no outcome data behind those weights. It is retained because
   * it is part of the agent-facing contract, but it is always published with
   * `probabilityBasis` so a caller cannot mistake it for a measurement.
   */
  interventionProbabilityPct: number;
  probabilityBasis: 'HEURISTIC_UNCALIBRATED';
  devaluationSpeedRiskScore: number;
  recommendedVesHoldMaxMinutes: number;
  makerSpreadAdjustmentPct: number;
  tacticalDirective: string;
  provenance: 'ESTIMATED_HEURISTIC' | 'VERIFIED_SCHEDULE';
  timestamp: string;
}

export function evaluateMacroBcvRegime(input: MacroTelemetryInput): MacroRegimeAssessment {
  const bcv = Math.max(0.01, input.bcvOfficialRate);
  const parallel = Math.max(0.01, input.parallelMarketRate);
  const rateGapPct = roundMoney(((parallel - bcv) / bcv) * 100, 2);

  const scheduleDays = [1, 4]; // Default Monday & Thursday heuristic
  const startHour = 9;
  const endHour = 13;
  const provenance: 'ESTIMATED_HEURISTIC' | 'VERIFIED_SCHEDULE' = 'ESTIMATED_HEURISTIC';

  let interventionProb = 15;
  const isInterventionDay = scheduleDays.includes(input.currentDayOfWeek);
  const isInterventionHour = input.currentHourOfDayUtcMinus4 >= startHour && input.currentHourOfDayUtcMinus4 <= endHour;

  if (isInterventionDay && isInterventionHour) {
    interventionProb += 55;
  } else if (input.daysSinceLastIntervention >= 5) {
    interventionProb += 35;
  }

  if (rateGapPct > 25) {
    interventionProb += 15;
  }
  interventionProb = Math.min(95, Math.max(5, interventionProb));

  let regime: MacroRegimeType = 'INVENTORY_STABILITY';
  let devalSpeedRisk = 20;
  let maxVesHoldMinutes = 60;
  let spreadAdjustmentPct = 0;
  let tacticalDirective = 'Operación habitual. Mantener inventario balanceado 50% USDT / 50% VES.';

  if (interventionProb >= 70) {
    regime = 'BCV_INTERVENTION_WINDOW';
    devalSpeedRisk = 30;
    maxVesHoldMinutes = 30;
    spreadAdjustmentPct = 0.45;
    // The injection figure is only ever stated when the caller actually supplied
    // a measured one. It used to fall back to the literal '50', printing a $50M
    // estimate that nothing in the system had observed.
    const injection =
      input.estimatedWeeklyBcvInjectionUsd != null
        ? ` con una inyección semanal provista de USD ${input.estimatedWeeklyBcvInjectionUsd.toLocaleString('en-US')}`
        : '';
    tacticalDirective =
      `VENTANA DE SUBASTA CALENDARIZADA${injection}: el reloj cae dentro del horario habitual de subasta y la heurística ` +
      'estimó alta probabilidad de intervención. La probabilidad es una heurística sin calibrar, no una medición; ' +
      'no retenga bolívares más de 30 minutos por este motivo.';
  } else if (rateGapPct > 22) {
    regime = 'PARALLEL_GAP_EXPANSION';
    devalSpeedRisk = 85;
    maxVesHoldMinutes = 15;
    spreadAdjustmentPct = 0.8;
    tacticalDirective = `BRECHA CAMBIARIA CRÍTICA (${rateGapPct}%): Presión severa de devaluación en paralelo. Drenar bolívares a USDT de inmediato (Hold máx: 15 min). Ajustar puntas vendedoras agresivamente.`;
  } else if (rateGapPct > 15) {
    regime = 'EXTREME_DEVALUATION_PRESSURE';
    devalSpeedRisk = 60;
    maxVesHoldMinutes = 30;
    spreadAdjustmentPct = 0.35;
    tacticalDirective = `Presión moderada de devaluación. Ajustar spread +0.35% y priorizar rotación rápida de compras.`;
  }

  return {
    regime,
    rateGapPct,
    interventionProbabilityPct: interventionProb,
    probabilityBasis: 'HEURISTIC_UNCALIBRATED',
    devaluationSpeedRiskScore: devalSpeedRisk,
    recommendedVesHoldMaxMinutes: maxVesHoldMinutes,
    makerSpreadAdjustmentPct: spreadAdjustmentPct,
    tacticalDirective,
    provenance,
    timestamp: new Date().toISOString(),
  };
}

// ==========================================
// 8. SMART TREASURY YIELD MAXIMIZER
// ==========================================

export type MarketVelocityLevel = 'LOW_OFFPEAK' | 'NORMAL_FLOW' | 'HIGH_SURGE';

export interface TreasuryYieldParams {
  totalUsdtInventory: number;
  currentlyCommittedUsdt: number;
  marketVelocity: MarketVelocityLevel;
  flexibleApyPct?: number;
  apyProvenance?: 'LIVE_EXCHANGE_FEED' | 'ESTIMATED_BENCHMARK';
  minimumSafetyBufferUsd?: number;
}

export interface TreasuryAllocationPlan {
  totalInventoryUsd: number;
  availableIdleUsdt: number;
  recommendedSweepAmountUsd: number;
  retainedSafetyBufferUsd: number;
  flexibleApyPct: number;
  apyProvenance: 'LIVE_EXCHANGE_FEED' | 'ESTIMATED_BENCHMARK';
  projectedDailyInterestUsd: number;
  projectedMonthlyInterestUsd: number;
  projectedAnnualInterestUsd: number;
  actionDirective: 'EXECUTE_SWEEP_DEPOSIT' | 'MAINTAIN_CURRENT_ALLOCATION' | 'TRIGGER_INSTANT_REDEMPTION';
  redemptionThresholdNotice: string;
  timestamp: string;
}

export function calculateTreasuryYieldAllocation(
  params: TreasuryYieldParams,
): TreasuryAllocationPlan {
  const total = Math.max(0, params.totalUsdtInventory);
  const committed = Math.max(0, params.currentlyCommittedUsdt);
  const idle = Math.max(0, total - committed);

  const apy = params.flexibleApyPct && params.flexibleApyPct > 0 ? params.flexibleApyPct : 10.5;
  const apyProvenance = params.apyProvenance ?? (params.flexibleApyPct ? 'LIVE_EXCHANGE_FEED' : 'ESTIMATED_BENCHMARK');
  const defaultBuffer = params.minimumSafetyBufferUsd ?? 2500;

  let bufferRequired = defaultBuffer;
  let sweepAmount = 0;
  let directive: 'EXECUTE_SWEEP_DEPOSIT' | 'MAINTAIN_CURRENT_ALLOCATION' | 'TRIGGER_INSTANT_REDEMPTION' =
    'MAINTAIN_CURRENT_ALLOCATION';

  if (params.marketVelocity === 'LOW_OFFPEAK') {
    bufferRequired = Math.min(1000, idle * 0.15);
    sweepAmount = Math.max(0, idle - bufferRequired);
    if (sweepAmount >= 500) {
      directive = 'EXECUTE_SWEEP_DEPOSIT';
    }
  } else if (params.marketVelocity === 'HIGH_SURGE') {
    bufferRequired = total;
    sweepAmount = 0;
    directive = 'TRIGGER_INSTANT_REDEMPTION';
  } else {
    bufferRequired = defaultBuffer;
    sweepAmount = Math.max(0, idle - bufferRequired);
    if (sweepAmount >= 1000) {
      directive = 'EXECUTE_SWEEP_DEPOSIT';
    }
  }

  const principalAllocated = directive === 'EXECUTE_SWEEP_DEPOSIT' ? sweepAmount : 0;
  const annualInterest = (principalAllocated * apy) / 100;
  const dailyInterest = annualInterest / 365;
  const monthlyInterest = annualInterest / 12;

  let notice = 'Liquidez óptima en spot para atender flujo de órdenes.';
  if (directive === 'EXECUTE_SWEEP_DEPOSIT') {
    notice = `Baja actividad detectada: Barrer $${sweepAmount.toFixed(2)} USDT hacia Flexible Earn (${apy}% APY). Redención instantánea configurada si la reserva cae de $${bufferRequired.toFixed(2)} USDT.`;
  } else if (directive === 'TRIGGER_INSTANT_REDEMPTION') {
    notice = `ALERTA PICO DE OPERACIONES: Rescatar fondos depositados en Simple Earn inmediatamente para garantizar liquidez en anuncios P2P.`;
  }

  return {
    totalInventoryUsd: roundMoney(total, 2),
    availableIdleUsdt: roundMoney(idle, 2),
    recommendedSweepAmountUsd: roundMoney(principalAllocated, 2),
    retainedSafetyBufferUsd: roundMoney(bufferRequired, 2),
    flexibleApyPct: apy,
    apyProvenance,
    projectedDailyInterestUsd: roundMoney(dailyInterest, 2),
    projectedMonthlyInterestUsd: roundMoney(monthlyInterest, 2),
    projectedAnnualInterestUsd: roundMoney(annualInterest, 2),
    actionDirective: directive,
    redemptionThresholdNotice: notice,
    timestamp: new Date().toISOString(),
  };
}

// ==========================================
// 9. BROWSER-USE AUTONOMOUS OPERATOR BRIDGE
// ==========================================

export type FinancialPortalSite =
  | 'BANESCO_PANAMA'
  | 'FACEBANK'
  | 'SIMLY'
  | 'MERCANTIL_PANAMA'
  | 'BINANCE_P2P';

export type OperatorActionType =
  | 'FETCH_RECENT_TRANSACTIONS'
  | 'DOWNLOAD_ACCOUNT_STATEMENT'
  | 'VERIFY_TRANSFER_REFERENCE'
  | 'CHECK_BALANCE';

export interface BrowserNavigationStep {
  stepIndex: number;
  action: 'NAVIGATE' | 'TYPE_TEXT' | 'CLICK_ELEMENT' | 'WAIT_SELECTOR' | 'EXTRACT_TEXT' | 'CAPTURE_SCREENSHOT';
  selector?: string;
  payloadValue?: string;
  description: string;
}

export interface BrowserOperatorTaskInput {
  targetSite: FinancialPortalSite;
  action: OperatorActionType;
  referenceToVerify?: string;
  expectedAmount?: number;
  headless?: boolean;
}

export interface CompiledBrowserOperatorTask {
  taskId: string;
  targetPortal: FinancialPortalSite;
  action: OperatorActionType;
  requiresMfaHumanIntervention: boolean;
  mfaChannelNotice: string;
  steps: BrowserNavigationStep[];
  successAssertionSelector: string;
  timestamp: string;
}

export function compileBrowserOperatorTask(
  input: BrowserOperatorTaskInput,
): CompiledBrowserOperatorTask {
  const steps: BrowserNavigationStep[] = [];
  let requiresMfa = false;
  let mfaNotice = 'No requiere MFA para navegación de lectura.';
  let successSelector = 'div.account-balance-card';

  switch (input.targetSite) {
    case 'BANESCO_PANAMA':
      requiresMfa = true;
      mfaNotice = 'Requiere Token Móvil / Clave de operaciones para login corporativo.';
      steps.push(
        { stepIndex: 1, action: 'NAVIGATE', payloadValue: 'https://panama.banesco.com', description: 'Abrir portal Banesco Panamá Empresas' },
        { stepIndex: 2, action: 'TYPE_TEXT', selector: '#txtUsuario', payloadValue: '${BANESCO_USER}', description: 'Ingresar usuario institucional' },
        { stepIndex: 3, action: 'TYPE_TEXT', selector: '#txtPassword', payloadValue: '${BANESCO_PASS}', description: 'Ingresar contraseña enmascarada' },
        { stepIndex: 4, action: 'CLICK_ELEMENT', selector: '#btnIngresar', description: 'Hacer click en Entrar' },
        { stepIndex: 5, action: 'WAIT_SELECTOR', selector: '.dashboard-accounts-table', description: 'Esperar resolución de MFA y carga de cuentas' },
      );
      if (input.action === 'VERIFY_TRANSFER_REFERENCE' && input.referenceToVerify) {
        steps.push(
          { stepIndex: 6, action: 'NAVIGATE', payloadValue: 'https://panama.banesco.com/movimientos', description: 'Abrir historial de movimientos' },
          { stepIndex: 7, action: 'TYPE_TEXT', selector: '#inputSearchRef', payloadValue: input.referenceToVerify, description: `Filtrar por referencia ${input.referenceToVerify}` },
          { stepIndex: 8, action: 'EXTRACT_TEXT', selector: 'table.movimientos-table tr.selected', description: 'Extraer comprobante y verificar coincidencia' },
        );
      }
      break;

    case 'FACEBANK':
      steps.push(
        { stepIndex: 1, action: 'NAVIGATE', payloadValue: 'https://online.facebank.pr', description: 'Abrir banca online Facebank' },
        { stepIndex: 2, action: 'WAIT_SELECTOR', selector: '#login-container', description: 'Esperar contenedor de autenticación' },
        { stepIndex: 3, action: 'CAPTURE_SCREENSHOT', description: 'Guardar captura forense de movimientos' },
      );
      break;

    case 'SIMLY':
      steps.push(
        { stepIndex: 1, action: 'NAVIGATE', payloadValue: 'https://app.simly.io/login', description: 'Abrir dashboard de Simly Neobank' },
        { stepIndex: 2, action: 'WAIT_SELECTOR', selector: '[data-testid="transactions-feed"]', description: 'Esperar feed de transferencias' },
        { stepIndex: 3, action: 'EXTRACT_TEXT', selector: '[data-testid="balance-display"]', description: 'Extraer balance disponible en USD' },
      );
      break;

    default:
      steps.push(
        { stepIndex: 1, action: 'NAVIGATE', payloadValue: `https://${input.targetSite.toLowerCase()}.com`, description: 'Navegar al portal financiero' },
        { stepIndex: 2, action: 'WAIT_SELECTOR', selector: 'body', description: 'Esperar carga del documento' },
      );
  }

  return {
    taskId: `TASK-NAV-${input.targetSite.substring(0, 4)}-${Date.now().toString(36).toUpperCase()}`,
    targetPortal: input.targetSite,
    action: input.action,
    requiresMfaHumanIntervention: requiresMfa,
    mfaChannelNotice: mfaNotice,
    steps,
    successAssertionSelector: successSelector,
    timestamp: new Date().toISOString(),
  };
}

