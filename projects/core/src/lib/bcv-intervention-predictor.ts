/**
 * Predictor del Ciclo de Intervención Cambiaria del BCV (Banco Central de Venezuela).
 * Modela la estacionalidad semanal de inyecciones de divisas (lunes y jueves bancarios),
 * la dinámica de la brecha Paralelo vs Oficial (BCV), y genera recomendaciones tácticas
 * de tesorería institucional para el trader de P2P en Venezuela.
 * Lógica pura, framework-agnostic.
 */

import { roundMoney } from './money';

export type BcvGapZone = 'COMPRESSED' | 'NORMAL' | 'ELEVATED' | 'CRITICAL_DISPERSION';

export type InterventionPhase =
  | 'PRE_INTERVENTION_COMPRESSION'
  | 'INTERVENTION_ACTIVE'
  | 'POST_INTERVENTION_REBOUND'
  | 'QUIET_ACCUMULATION';

export type TreasuryAction =
  'ACCUMULATE_VES_HIGH' | 'BUY_USDT_DIP' | 'HOLD_USDT' | 'AGGRESSIVE_CYCLE_VES' | 'DEFENSIVE_HEDGE';

export interface BcvGapAnalysis {
  parallelRate: number;
  bcvRate: number;
  gapVes: number;
  gapPct: number;
  zone: BcvGapZone;
  description: string;
}

export interface BcvPredictorWindow {
  vetDayOfWeek: number; // 0=Dom, 1=Lun, ..., 6=Sab
  vetHour: number; // 0..23
  phase: InterventionPhase;
  probabilityPct: number;
  nextExpectedIntervention: string;
  hoursUntilIntervention: number;
  rationale: string;
}

export interface BcvRecommendation {
  action: TreasuryAction;
  confidencePct: number;
  actionLabel: string;
  timingNotice: string;
  rationale: string;
}

export interface BcvMarketIntelligence {
  gap: BcvGapAnalysis;
  window: BcvPredictorWindow;
  recommendation: BcvRecommendation;
  timestamp: string;
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

  const gapVes = roundMoney(parallelRate - bcvRate);
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
 * Convierte una fecha UTC a hora oficial de Venezuela (VET: UTC-4 estricto, sin horario de verano).
 */
export function getVenezuelaTimeParts(date: Date = new Date()): {
  day: number;
  hour: number;
  minute: number;
} {
  // Offset UTC-4 en milisegundos = -4 * 3600 * 1000
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const vetDate = new Date(utc - 4 * 3600000);

  return {
    day: vetDate.getDay(), // 0=Domingo, 1=Lunes, ..., 6=Sábado
    hour: vetDate.getHours(),
    minute: vetDate.getMinutes(),
  };
}

/**
 * Predice la fase del ciclo de intervención cambiaria del BCV según la hora de Venezuela.
 */
export function predictBcvIntervention(now: Date = new Date()): BcvPredictorWindow {
  const { day, hour } = getVenezuelaTimeParts(now);

  // Días de intervención típica del BCV: Lunes (1) = principal, Jueves (4) = complementaria
  // Horario bancario de colocación: 9:00 AM - 1:00 PM VET (09:00 a 13:00)

  let phase: InterventionPhase;
  let probabilityPct: number;
  let nextExpectedIntervention: string;
  let hoursUntilIntervention: number;
  let rationale: string;

  const isInterventionDay = day === 1 || day === 4;

  if (isInterventionDay && hour >= 9 && hour <= 13) {
    phase = 'INTERVENTION_ACTIVE';
    probabilityPct = day === 1 ? 95 : 85;
    nextExpectedIntervention = 'En curso actualmente';
    hoursUntilIntervention = 0;
    rationale = `Inyección de divisas en curso en la banca comercial (${day === 1 ? 'Lunes principal' : 'Jueves de refuerzo'}). Se registra contención artificial del paralelo.`;
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
      'Ventana pre-intervención. Expectativa de inyección de divisas en las próximas horas.';
  } else if ((isInterventionDay && hour > 13) || day === 2 || day === 5) {
    phase = 'POST_INTERVENTION_REBOUND';
    probabilityPct = 75;
    nextExpectedIntervention = day <= 2 ? 'Jueves 09:30 AM VET' : 'Próximo Lunes 09:30 AM VET';
    hoursUntilIntervention = day === 2 ? 40 : day === 5 ? 65 : 20;
    rationale =
      'Ventana post-intervención. Los dólares de la subasta son absorbidos rápidamente y el spread suele rebotar al alza en 24-48h.';
  } else {
    phase = 'QUIET_ACCUMULATION';
    probabilityPct = 40;
    nextExpectedIntervention = day === 3 ? 'Jueves 09:30 AM VET' : 'Lunes 09:30 AM VET';
    hoursUntilIntervention = day === 3 ? 18 : 36;
    rationale =
      'Mercado fuera de subastas bancarias. Cotizaciones del paralelo operan por oferta y demanda pura de la calle.';
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
 * Genera la recomendación institucional de gestión de inventario y tesorería.
 */
export function recommendBcvTreasuryAction(
  gap: BcvGapAnalysis,
  window: BcvPredictorWindow,
): BcvRecommendation {
  // Caso de Emergencia: Dispersión Crítica (>35%)
  if (gap.zone === 'CRITICAL_DISPERSION') {
    return {
      action: 'DEFENSIVE_HEDGE',
      confidencePct: 92,
      actionLabel: 'BLINDAJE DEFENSIVO (HEDGE USDT MÁXIMO)',
      timingNotice: 'Inmediata — Alto riesgo cambiario',
      rationale:
        'La brecha supera el 35%. Riesgo inminente de devaluación oficial brusca o descontrol en el paralelo. Mantén el inventario 100% en USDT y minimiza exposición a bolívares.',
    };
  }

  // Pre-Intervención con brecha elevada
  if (
    window.phase === 'PRE_INTERVENTION_COMPRESSION' &&
    (gap.zone === 'ELEVATED' || gap.gapPct >= 22)
  ) {
    return {
      action: 'ACCUMULATE_VES_HIGH',
      confidencePct: 88,
      actionLabel: 'VENDER USDT EN MÁXIMOS (CAPTURA DE SPREAD)',
      timingNotice: `Vender antes de ${window.nextExpectedIntervention}`,
      rationale:
        'La brecha está caliente y el BCV inyectará divisas en breve. Liquida USDT a precios pico del paralelo antes de que la subasta enfríe momentáneamente el mercado.',
    };
  }

  // Intervención Activa o Post-Intervención Inmediata
  if (window.phase === 'INTERVENTION_ACTIVE' || window.phase === 'POST_INTERVENTION_REBOUND') {
    return {
      action: 'BUY_USDT_DIP',
      confidencePct: 85,
      actionLabel: 'COMPRAR USDT EN CORTE / DIP (VENTANA DE ORO)',
      timingNotice: 'Próximas 12-24 horas',
      rationale:
        'Aprovecha el freno artificial de precios producido por la inyección bancaria. El mercado suele rebotar con fuerza tras agotarse las divisas de la subasta.',
    };
  }

  // Operativa Regular de Rotación Rápida
  return {
    action: 'AGGRESSIVE_CYCLE_VES',
    confidencePct: 80,
    actionLabel: 'CICLO RÁPIDO DE ROTACIÓN (SAME-DAY CYCLE)',
    timingNotice: 'Intradía continuo',
    rationale:
      'Condiciones de mercado estables. Maximiza la rotación de capital completando ciclos de compra/venta en menos de 2 horas sin acumular saldos nocturnos en VES.',
  };
}

/**
 * Inteligencia completa consolidada para el Centro de Control y Monitor de Spread.
 */
export function getBcvMarketIntelligence(
  parallelRate: number,
  bcvRate: number,
  now: Date = new Date(),
): BcvMarketIntelligence {
  const gap = calculateBcvGap(parallelRate, bcvRate);
  const window = predictBcvIntervention(now);
  const recommendation = recommendBcvTreasuryAction(gap, window);

  return {
    gap,
    window,
    recommendation,
    timestamp: now.toISOString(),
  };
}

// ─── Phase 1: Macro Liquidity Drain, Dollarization Velocity & Nash Repricing ───

export interface CentralBankLiquidityDrainInput {
  dayOfMonth: number;
  dayOfWeek: number; // 0=Dom, 1=Lun, ..., 6=Sab
  estimatedSeniatCollectionActive: boolean; // Quincenas o cierre de mes fiscal
  weeklyBcvInjectionMillionsUsd: number;
}

export interface CentralBankLiquidityDrainResult {
  interbankLiquidityLevel: 'TIGHT_LIQUIDITY_DRAIN' | 'MODERATE' | 'SURPLUS_BOLIVARES';
  p2pDemandImpact: 'COMPRESSED_BUY_PRESSURE' | 'BALANCED_TURNOVER' | 'HIGH_INFLATION_SURGE';
  projectedParallelTrend48h: 'SIDEWAYS_DIP' | 'STABLE_EXPANSION' | 'BULLISH_BREAKOUT';
  strategicGuidance: string;
}

/**
 * Modela el impacto macro del drenaje de liquidez interbancaria por recaudación fiscal (SENIAT: ISLR/IVA)
 * y subastas del BCV sobre la disponibilidad de bolívares en el sistema P2P.
 */
export function forecastCentralBankLiquidityDrain(
  input: CentralBankLiquidityDrainInput,
): CentralBankLiquidityDrainResult {
  const { dayOfMonth, estimatedSeniatCollectionActive, weeklyBcvInjectionMillionsUsd } = input;

  // Drenaje máximo: Quincenas fiscales (15, 30/31) y días de subasta bancaria (Lunes/Jueves) con inyección > 50M
  const isTaxDrainWindow = estimatedSeniatCollectionActive || dayOfMonth === 15 || dayOfMonth >= 28;
  const isHeavyIntervention = weeklyBcvInjectionMillionsUsd >= 50;

  if (isTaxDrainWindow && isHeavyIntervention) {
    return {
      interbankLiquidityLevel: 'TIGHT_LIQUIDITY_DRAIN',
      p2pDemandImpact: 'COMPRESSED_BUY_PRESSURE',
      projectedParallelTrend48h: 'SIDEWAYS_DIP',
      strategicGuidance:
        'Drenaje agresivo de liquidez en bolívares por recaudación tributaria (SENIAT) + subasta BCV masiva. La demanda de USDT se enfriará temporalmente. Evitar comprar en puntas máximas; esperar retroceso.',
    };
  }

  if (weeklyBcvInjectionMillionsUsd < 25 && !isTaxDrainWindow) {
    return {
      interbankLiquidityLevel: 'SURPLUS_BOLIVARES',
      p2pDemandImpact: 'HIGH_INFLATION_SURGE',
      projectedParallelTrend48h: 'BULLISH_BREAKOUT',
      strategicGuidance:
        'Exceso de liquidez en cuenta corriente interbancaria con baja intervención del BCV. Aceleración inminente del tipo de cambio paralelo. Mantener inventario en USDT y no retrasar ventas.',
    };
  }

  return {
    interbankLiquidityLevel: 'MODERATE',
    p2pDemandImpact: 'BALANCED_TURNOVER',
    projectedParallelTrend48h: 'STABLE_EXPANSION',
    strategicGuidance:
      'Condiciones de liquidez equilibradas. Rotación continua con spread regular.',
  };
}

export interface FiatDollarizationVelocityInput {
  averageVesHoldingMinutes: number; // Tiempo promedio que los comerciantes retienen VES
  merchantUsdtAcceptancePct: number; // % de comercios que prefieren USDT
  monthlyInflationEstimatePct: number;
}

export interface FiatDollarizationVelocityResult {
  moneyVelocityIndex: number; // 1.0 = baseline normal, > 2.5 = huida extrema de moneda
  flightRegime: 'ORDERLY_DOLLARIZATION' | 'ACCELERATED_FLIGHT' | 'HYPER_VELOCITY_REPUDIATION';
  expectedHoldingTimeSafetyThresholdMinutes: number;
  recommendation: string;
}

/**
 * Mide el ritmo de repudio de la moneda local frente a USDT evaluando la teoría cuantitativa
 * de velocidad del dinero (MV = PY) aplicada a la tesorería de arbitraje.
 */
export function monitorFiatFlightAndDollarizationVelocity(
  input: FiatDollarizationVelocityInput,
): FiatDollarizationVelocityResult {
  const { averageVesHoldingMinutes, monthlyInflationEstimatePct } = input;

  // Cuanto menor es el tiempo de retención y mayor la inflación, mayor es la velocidad de repudio
  const holdingRatio = Math.max(1, averageVesHoldingMinutes) / 60; // en horas
  const velocityRaw = monthlyInflationEstimatePct / 10 / Math.max(0.2, holdingRatio);
  const moneyVelocityIndex = Math.round(velocityRaw * 100) / 100;

  let flightRegime: FiatDollarizationVelocityResult['flightRegime'] = 'ORDERLY_DOLLARIZATION';
  let safetyMinutes = 45;

  if (moneyVelocityIndex >= 4.0 || averageVesHoldingMinutes <= 20) {
    flightRegime = 'HYPER_VELOCITY_REPUDIATION';
    safetyMinutes = 15;
  } else if (moneyVelocityIndex >= 2.0 || averageVesHoldingMinutes <= 60) {
    flightRegime = 'ACCELERATED_FLIGHT';
    safetyMinutes = 30;
  }

  return {
    moneyVelocityIndex,
    flightRegime,
    expectedHoldingTimeSafetyThresholdMinutes: safetyMinutes,
    recommendation:
      flightRegime === 'HYPER_VELOCITY_REPUDIATION'
        ? `HUIDA AGUDA DE MONEDA: Los saldos en VES no deben mantenerse más de ${safetyMinutes} minutos ociosos. Salir a USDT inmediatamente.`
        : `Dolarización transaccional activa. Umbral máximo de tenencia segura en bolívares: ${safetyMinutes} minutos.`,
  };
}

export interface CompetitorAdProfile {
  merchantName: string;
  price: number;
  maxLimitVes: number;
  isVerifiedMerchant: boolean;
}

export interface NashRepricingInput {
  myCurrentPrice: number;
  targetSide: 'BUY' | 'SELL';
  topCompetitors: CompetitorAdProfile[];
  minimumSpreadAllowedPct: number;
  stepVes?: number;
}

export interface NashRepricingResult {
  suggestedNashPrice: number;
  expectedCompetitorResponse: 'WILL_COOPERATE_STEP' | 'PRICE_WAR_TRIGGERED' | 'UNDERCUT_DEFENSE';
  payoffNetSpreadPct: number;
  nashEquilibriumStatus: 'STABLE_NASH_EQUILIBRIUM' | 'FRAGILE_COOPERATION' | 'DESTRUCTIVE_WAR_ZONE';
  strategicDirective: string;
}

/**
 * Simula el Equilibrio de Nash entre los creadores de mercado dominantes del libro P2P
 * para evitar guerras destructivas de precios (undercutting wars) maximizando el spread conjunto.
 */
export function simulateGameTheoryNashRepricing(input: NashRepricingInput): NashRepricingResult {
  const {
    myCurrentPrice,
    targetSide,
    topCompetitors,
    minimumSpreadAllowedPct,
    stepVes = 0.01,
  } = input;

  if (!topCompetitors || topCompetitors.length === 0) {
    return {
      suggestedNashPrice: myCurrentPrice,
      expectedCompetitorResponse: 'WILL_COOPERATE_STEP',
      payoffNetSpreadPct: 1.2,
      nashEquilibriumStatus: 'STABLE_NASH_EQUILIBRIUM',
      strategicDirective:
        'Libro despejado sin competencia directa en punta. Mantener margen máximo.',
    };
  }

  const bestCompetitor = topCompetitors[0];
  const priceDistance = Math.abs(myCurrentPrice - bestCompetitor.price);

  let suggestedNashPrice: number;
  let expectedResponse: NashRepricingResult['expectedCompetitorResponse'] = 'WILL_COOPERATE_STEP';
  let equilibriumStatus: NashRepricingResult['nashEquilibriumStatus'] = 'STABLE_NASH_EQUILIBRIUM';

  // Si intentamos saltar más de 0.05 VES por delante, provocamos guerra destructiva
  if (targetSide === 'BUY') {
    if (priceDistance < 0.03) {
      // Cooperación tácita: colocarse a 0.01 de ventaja
      suggestedNashPrice = Math.round((bestCompetitor.price + stepVes) * 100) / 100;
      expectedResponse = 'WILL_COOPERATE_STEP';
      equilibriumStatus = 'STABLE_NASH_EQUILIBRIUM';
    } else {
      suggestedNashPrice = Math.round((bestCompetitor.price + 0.01) * 100) / 100;
      expectedResponse = 'PRICE_WAR_TRIGGERED';
      equilibriumStatus = 'FRAGILE_COOPERATION';
    }
  } else {
    // SELL: colocarse justo por debajo para liderar venta
    suggestedNashPrice = Math.round((bestCompetitor.price - stepVes) * 100) / 100;
  }

  return {
    suggestedNashPrice,
    expectedCompetitorResponse: expectedResponse,
    payoffNetSpreadPct: Math.max(minimumSpreadAllowedPct, 0.85),
    nashEquilibriumStatus: equilibriumStatus,
    strategicDirective: `Equilibrio de Nash: Fijar cotización a ${suggestedNashPrice} VES (+${stepVes} vs ${bestCompetitor.merchantName}). Evita subcotización agresiva que destruiría el margen de ambos.`,
  };
}
