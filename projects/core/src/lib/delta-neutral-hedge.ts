/**
 * Automated Crypto-Fiat Delta-Neutral Hedging Engine.
 * Dynamically computes net fiat portfolio exposure (VES/USD delta),
 * devaluation drift risk, and generates synthetic hedge orders with strict
 * Human-in-the-Loop execution guards.
 * Pure TypeScript, framework-agnostic, zero external dependencies.
 */

export type HedgeInstrument = 'BINANCE_SPOT' | 'BYBIT_PERP' | 'HYPERLIQUID_PERP' | 'CASH_OFFRAMP';
export type HedgeExecutionState = 'PROPOSED' | 'APPROVED_BY_OPERATOR' | 'REJECTED' | 'EXECUTED' | 'EXPIRED';

export interface PortfolioBalanceSnapshot {
  vesBalance: number;
  usdtBalance: number;
  currentParallelRate: number; // VES per USDT
  openP2pSellOrdersUsdt: number; // USDT committed in active sell orders
  openP2pBuyOrdersVes: number; // VES committed in active buy orders
  vesMaxHoldingTimeMinutes?: number; // Minutes oldest VES has been idle
}

export interface DeltaExposureMetrics {
  totalEquityUsd: number;
  fiatExposureUsd: number;
  cryptoExposureUsd: number;
  netDeltaRatio: number; // 0 = fully delta-neutral, > 0 = long fiat/long crypto
  unhedgedVesRiskScore: number; // 0 to 100
  urgency: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface HedgeOrderProposal {
  id: string;
  createdAtMs: number;
  instrument: HedgeInstrument;
  action: 'BUY_USDT_SPOT' | 'SHORT_PERP_USD' | 'CYCLE_P2P_VES';
  fiatAmountVes: number;
  hedgeAmountUsdt: number;
  targetPriceRate: number;
  maxSlippageBps: number; // e.g. 50 bps = 0.5%
  estimatedFundingFeeDailyUsd: number;
  state: HedgeExecutionState;
  requiresHumanSignature: true; // Mandatory constraint
  reason: string;
}

export interface DeltaNeutralEngineConfig {
  maxAllowedFiatDeltaRatio: number; // e.g. 0.20 = max 20% of equity in unhedged VES
  maxVesIdleMinutes: number; // e.g. 30 minutes
  minHedgeAmountUsdt: number; // e.g. 50 USDT minimum to avoid dust orders
  defaultInstrument: HedgeInstrument;
}

const DEFAULT_CONFIG: DeltaNeutralEngineConfig = {
  maxAllowedFiatDeltaRatio: 0.15, // Max 15% equity in VES
  maxVesIdleMinutes: 30,
  minHedgeAmountUsdt: 50,
  defaultInstrument: 'BYBIT_PERP',
};

/**
 * Calculates current portfolio net delta and currency devaluation exposure.
 */
export function calculatePortfolioDelta(
  snapshot: PortfolioBalanceSnapshot,
  config: Partial<DeltaNeutralEngineConfig> = {},
): DeltaExposureMetrics {
  const rate = snapshot.currentParallelRate > 0 ? snapshot.currentParallelRate : 1;
  const fiatExposureUsd = snapshot.vesBalance / rate;
  const cryptoExposureUsd = snapshot.usdtBalance;
  const totalEquityUsd = fiatExposureUsd + cryptoExposureUsd;

  if (totalEquityUsd <= 0) {
    return {
      totalEquityUsd: 0,
      fiatExposureUsd: 0,
      cryptoExposureUsd: 0,
      netDeltaRatio: 0,
      unhedgedVesRiskScore: 0,
      urgency: 'NONE',
    };
  }

  const fiatDeltaRatio = fiatExposureUsd / totalEquityUsd;

  // Compute unhedged VES risk score (0 to 100)
  let riskScore = Math.round(fiatDeltaRatio * 80);
  const idleMinutes = snapshot.vesMaxHoldingTimeMinutes ?? 0;
  if (idleMinutes > 60) {
    riskScore += 20;
  } else if (idleMinutes > 30) {
    riskScore += 10;
  }

  const finalRiskScore = Math.min(Math.max(riskScore, 0), 100);

  let urgency: DeltaExposureMetrics['urgency'] = 'NONE';
  if (finalRiskScore >= 80) urgency = 'CRITICAL';
  else if (finalRiskScore >= 60) urgency = 'HIGH';
  else if (finalRiskScore >= 40) urgency = 'MEDIUM';
  else if (finalRiskScore >= 20) urgency = 'LOW';

  return {
    totalEquityUsd: Math.round(totalEquityUsd * 100) / 100,
    fiatExposureUsd: Math.round(fiatExposureUsd * 100) / 100,
    cryptoExposureUsd: Math.round(cryptoExposureUsd * 100) / 100,
    netDeltaRatio: Math.round(fiatDeltaRatio * 1000) / 1000,
    unhedgedVesRiskScore: finalRiskScore,
    urgency,
  };
}

/**
 * Evaluates whether a delta-neutral hedge order proposal is required and generates
 * a structured proposal that STRICTLY requires operator authorization.
 */
export function evaluateDeltaHedge(
  snapshot: PortfolioBalanceSnapshot,
  userConfig: Partial<DeltaNeutralEngineConfig> = {},
): HedgeOrderProposal | null {
  const cfg: DeltaNeutralEngineConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const delta = calculatePortfolioDelta(snapshot, cfg);

  // If delta is within safe bounds and no critical idle time, no hedge required
  if (
    delta.netDeltaRatio <= cfg.maxAllowedFiatDeltaRatio &&
    (snapshot.vesMaxHoldingTimeMinutes ?? 0) < cfg.maxVesIdleMinutes
  ) {
    return null;
  }

  // Calculate target fiat in USD to reach maxAllowedFiatDeltaRatio
  const targetFiatUsd = delta.totalEquityUsd * cfg.maxAllowedFiatDeltaRatio;
  const excessFiatUsd = Math.max(delta.fiatExposureUsd - targetFiatUsd, 0);

  // If excess is smaller than minimum hedge size, skip dust
  if (excessFiatUsd < cfg.minHedgeAmountUsdt) {
    return null;
  }

  const rate = snapshot.currentParallelRate > 0 ? snapshot.currentParallelRate : 1;
  const excessVes = Math.round(excessFiatUsd * rate);
  const hedgeUsdt = Math.round(excessFiatUsd);

  const proposalId = `HDG-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  return {
    id: proposalId,
    createdAtMs: Date.now(),
    instrument: cfg.defaultInstrument,
    action: cfg.defaultInstrument === 'BINANCE_SPOT' ? 'BUY_USDT_SPOT' : 'SHORT_PERP_USD',
    fiatAmountVes: excessVes,
    hedgeAmountUsdt: hedgeUsdt,
    targetPriceRate: rate,
    maxSlippageBps: 40, // 0.40% max tolerance
    estimatedFundingFeeDailyUsd: Math.round(hedgeUsdt * 0.0003 * 100) / 100, // ~0.03% daily funding
    state: 'PROPOSED',
    requiresHumanSignature: true,
    reason: `Exposición en VES (${(delta.netDeltaRatio * 100).toFixed(1)}% del capital) excede el umbral seguro del ${(cfg.maxAllowedFiatDeltaRatio * 100).toFixed(0)}% tras ${snapshot.vesMaxHoldingTimeMinutes ?? 0}m de inactividad.`,
  };
}

/**
 * Validates operator approval. Enforces Human-in-the-Loop signature contract.
 */
export function authorizeHedgeProposal(
  proposal: HedgeOrderProposal,
  operatorSignature: string,
): { success: boolean; updatedProposal: HedgeOrderProposal; error?: string } {
  if (!operatorSignature || operatorSignature.trim().length < 3) {
    return {
      success: false,
      updatedProposal: proposal,
      error: 'Firma u operador inválido. Se requiere confirmación humana explícita.',
    };
  }

  if (proposal.state !== 'PROPOSED') {
    return {
      success: false,
      updatedProposal: proposal,
      error: `No se puede autorizar una propuesta en estado ${proposal.state}.`,
    };
  }

  return {
    success: true,
    updatedProposal: {
      ...proposal,
      state: 'APPROVED_BY_OPERATOR',
    },
  };
}

// ─── Phase 1: Convexity/Gamma Risk, Funding Arbitrage & Kelly Allocation ───────

export interface ConvexityRiskInput {
  spotParallelRate: number;
  vesHoldingAmount: number;
  expectedDevaluationJumpPct: number; // Salto proyectado (ej. 15% o 30%)
  timeHorizonDays: number;
}

export interface ConvexityRiskResult {
  linearLossUsdt: number;
  acceleratedGammaLossUsdt: number;
  convexityDragPct: number;
  riskSeverity: 'LINEAR_MANAGEABLE' | 'ACCELERATING_GAMMA_RISK' | 'EXPONENTIAL_COLLAPSE';
  actionableDirective: string;
}

/**
 * Modela el riesgo de convexidad y aceleración Gamma de pérdidas patrimoniales
 * ante rupturas no lineales del tipo de cambio paralelo (curva hiperbólica 1/x).
 */
export function calculateConvexityAndGammaRisk(input: ConvexityRiskInput): ConvexityRiskResult {
  const { spotParallelRate, vesHoldingAmount, expectedDevaluationJumpPct, timeHorizonDays } = input;
  const initialUsdtValue = spotParallelRate > 0 ? vesHoldingAmount / spotParallelRate : 0;

  const jumpedRate = spotParallelRate * (1 + expectedDevaluationJumpPct / 100);
  const postJumpUsdtValue = jumpedRate > 0 ? vesHoldingAmount / jumpedRate : 0;
  const actualLossUsdt = Math.round((initialUsdtValue - postJumpUsdtValue) * 100) / 100;

  // Pérdida lineal simplificada de primer orden (Delta aproximado)
  const linearApproximationLoss = Math.round((initialUsdtValue * (expectedDevaluationJumpPct / 100)) * 100) / 100;
  const nonLinearGammaDrag = Math.round(Math.abs(actualLossUsdt - linearApproximationLoss) * 100) / 100;
  const convexityDragPct = initialUsdtValue > 0 ? Math.round((actualLossUsdt / initialUsdtValue) * 10000) / 100 : 0;

  let riskSeverity: ConvexityRiskResult['riskSeverity'] = 'LINEAR_MANAGEABLE';
  if (convexityDragPct >= 20.0 || expectedDevaluationJumpPct >= 25.0) {
    riskSeverity = 'EXPONENTIAL_COLLAPSE';
  } else if (convexityDragPct >= 8.0) {
    riskSeverity = 'ACCELERATING_GAMMA_RISK';
  }

  return {
    linearLossUsdt: actualLossUsdt,
    acceleratedGammaLossUsdt: nonLinearGammaDrag,
    convexityDragPct,
    riskSeverity,
    actionableDirective: riskSeverity === 'EXPONENTIAL_COLLAPSE'
      ? `EMERGENCIA: Devaluación proyectada de ${expectedDevaluationJumpPct}%. Convexidad destructiva (-${convexityDragPct}%). Liquidar VES a mercado inmediatamente o abrir cobertura corta 100%.`
      : `Riesgo moderado. Drawdown estimado de -$${actualLossUsdt} USDT. Cobertura pasiva sugerida.`,
  };
}

export interface FundingRateArbitrageInput {
  collateralUsdt: number;
  currentFundingRate8hPct: number; // ej. 0.01% por cada 8h
  annualizedBorrowRateUsdtPct?: number; // ej. 4.5% anual
  holdingPeriodDays: number;
}

export interface FundingRateArbitrageResult {
  dailyYieldPct: number;
  annualizedApyPct: number;
  projectedFundingIncomeUsdt: number;
  netYieldAfterBorrowCostUsdt: number;
  isFundingAttractive: boolean;
  recommendation: string;
}

/**
 * Modela la viabilidad del arbitraje de Funding Rate en perpetuos (Cash-and-Carry)
 * para generar rendimiento pasivo sobre colateral en USDT que respalda la tesorería P2P.
 */
export function modelPerpetualFundingArbitrage(input: FundingRateArbitrageInput): FundingRateArbitrageResult {
  const { collateralUsdt, currentFundingRate8hPct, annualizedBorrowRateUsdtPct = 4.5, holdingPeriodDays } = input;

  const dailyYieldPct = Math.round((currentFundingRate8hPct * 3) * 1000) / 1000;
  const grossAnnualizedApyPct = Math.round((dailyYieldPct * 365) * 100) / 100;
  const dailyBorrowCostPct = annualizedBorrowRateUsdtPct / 365;

  const totalFundingIncome = collateralUsdt * (dailyYieldPct / 100) * holdingPeriodDays;
  const totalBorrowCost = collateralUsdt * (dailyBorrowCostPct / 100) * holdingPeriodDays;
  const netProfit = Math.round((totalFundingIncome - totalBorrowCost) * 100) / 100;

  const isFundingAttractive = (grossAnnualizedApyPct - annualizedBorrowRateUsdtPct) >= 5.0 && currentFundingRate8hPct > 0;

  return {
    dailyYieldPct,
    annualizedApyPct: grossAnnualizedApyPct,
    projectedFundingIncomeUsdt: Math.round(totalFundingIncome * 100) / 100,
    netYieldAfterBorrowCostUsdt: netProfit,
    isFundingAttractive,
    recommendation: isFundingAttractive
      ? `Tasa de financiamiento atractiva (${grossAnnualizedApyPct}% APY bruto). Cobro neto proyectado: +$${netProfit} USDT en ${holdingPeriodDays} días.`
      : `Funding comprimido o neutro (${grossAnnualizedApyPct}% APY). No justifica el riesgo de apalancamiento sintético.`,
  };
}

export interface KellyAllocationInput {
  totalCapitalUsdt: number;
  winRatePct: number; // Tasa de acierto histórica (ej. 75%)
  averageProfitPerWinUsdt: number;
  averageLossPerLossUsdt: number;
  fractionalSafetyMultiplier?: number; // Criterio de Kelly fraccional (default 0.33 para half/quarter Kelly)
  maxBankConcentrationPct?: number; // Límite por entidad bancaria (default 25%)
}

export interface KellyAllocationResult {
  fullKellyFractionPct: number;
  recommendedFractionPct: number;
  optimalTicketSizeUsdt: number;
  maximumDrawdownRiskPct: number;
  allocationByBankUsdt: { bankName: string; maxAllocationUsdt: number }[];
  strategicRationale: string;
}

/**
 * Optimiza la asignación de capital y tamaño de ticket mediante el Criterio Fraccional de Kelly,
 * maximizando la tasa de crecimiento geométrico y blindando contra la probabilidad de ruina.
 */
export function optimizeCapitalAllocationKelly(input: KellyAllocationInput): KellyAllocationResult {
  const {
    totalCapitalUsdt,
    winRatePct,
    averageProfitPerWinUsdt,
    averageLossPerLossUsdt,
    fractionalSafetyMultiplier = 0.33,
    maxBankConcentrationPct = 25,
  } = input;

  const p = Math.max(0.01, Math.min(0.99, winRatePct / 100));
  const q = 1 - p;
  const b = averageLossPerLossUsdt > 0 ? averageProfitPerWinUsdt / averageLossPerLossUsdt : 1;

  // Kelly formula: f* = (b * p - q) / b
  const rawKelly = ((b * p) - q) / b;
  const fullKellyFractionPct = Math.round(Math.max(0, rawKelly) * 10000) / 100;
  const recommendedFractionPct = Math.round((fullKellyFractionPct * fractionalSafetyMultiplier) * 100) / 100;

  const optimalTicketSizeUsdt = Math.round((totalCapitalUsdt * (recommendedFractionPct / 100)) * 100) / 100;
  const maxBankCap = Math.round((totalCapitalUsdt * (maxBankConcentrationPct / 100)) * 100) / 100;

  const bankDistribution = [
    { bankName: 'Banesco Banco Universal', maxAllocationUsdt: maxBankCap },
    { bankName: 'Banco Mercantil', maxAllocationUsdt: maxBankCap },
    { bankName: 'Banco de Venezuela (BDV)', maxAllocationUsdt: maxBankCap },
    { bankName: 'Bancamiga / Provincial', maxAllocationUsdt: maxBankCap },
  ];

  return {
    fullKellyFractionPct,
    recommendedFractionPct,
    optimalTicketSizeUsdt: Math.max(100, optimalTicketSizeUsdt),
    maximumDrawdownRiskPct: Math.round((recommendedFractionPct * 1.5) * 10) / 10,
    allocationByBankUsdt: bankDistribution,
    strategicRationale: `Kelly Óptimo Fraccional (${(fractionalSafetyMultiplier * 100).toFixed(0)}%): Asignar hasta ${recommendedFractionPct}% por ciclo ($${optimalTicketSizeUsdt} USDT). Límite por banco: $${maxBankCap} USDT.`,
  };
}

