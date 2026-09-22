/**
 * Pure domain logic for Spread Quality Score (SQS) and Venezuelan P2P Arbitrage Fee Cascades.
 * Framework-agnostic, deterministic, no side effects, no Angular dependencies.
 */

import { type BankCode } from './accounts';

export type SpreadQualityVerdict = 'OPTIMAL' | 'HEALTHY' | 'CAUTION' | 'TOXIC';
export type P2PRole = 'MAKER' | 'TAKER';

export interface BankFeeStructure {
  bankCode: BankCode;
  name: string;
  pagoMovilFeePct: number; // e.g. 0.003 (0.3%)
  transferSameBankFeePct: number; // 0%
  transferInterbankFeePct: number; // e.g. 0.003 (0.3%)
  igtfPct: number; // e.g. 0 for natural persons local currency
  velocityScore: number; // 0 to 100 (ease and speed of turnover in VE market)
}

/**
 * Known fee tables for Venezuelan retail banking channels in P2P settlements.
 */
export const VENEZUELAN_BANK_FEES: Record<BankCode, BankFeeStructure> = {
  BANESCO: {
    bankCode: 'BANESCO',
    name: 'Banesco Banco Universal',
    pagoMovilFeePct: 0.003,
    transferSameBankFeePct: 0,
    transferInterbankFeePct: 0.003,
    igtfPct: 0,
    velocityScore: 95, // High liquidity, fast clearing
  },
  MERCANTIL: {
    bankCode: 'MERCANTIL',
    name: 'Mercantil Banco',
    pagoMovilFeePct: 0.003,
    transferSameBankFeePct: 0,
    transferInterbankFeePct: 0.003,
    igtfPct: 0,
    velocityScore: 90,
  },
  BDV: {
    bankCode: 'BDV',
    name: 'Banco de Venezuela',
    pagoMovilFeePct: 0.003,
    transferSameBankFeePct: 0,
    transferInterbankFeePct: 0.003,
    igtfPct: 0,
    velocityScore: 85,
  },
  BANCAMIGA: {
    bankCode: 'BANCAMIGA',
    name: 'Bancamiga',
    pagoMovilFeePct: 0.003,
    transferSameBankFeePct: 0,
    transferInterbankFeePct: 0.003,
    igtfPct: 0,
    velocityScore: 80,
  },
  PROVINCIAL: {
    bankCode: 'PROVINCIAL',
    name: 'BBVA Provincial',
    pagoMovilFeePct: 0.003,
    transferSameBankFeePct: 0,
    transferInterbankFeePct: 0.003,
    igtfPct: 0,
    velocityScore: 75,
  },
  OTRO: {
    bankCode: 'OTRO',
    name: 'Otro Banco / Sistema General',
    pagoMovilFeePct: 0.003,
    transferSameBankFeePct: 0,
    transferInterbankFeePct: 0.003,
    igtfPct: 0,
    velocityScore: 60,
  },
};

export interface ArbitrageCycleInput {
  capitalUsdt: number;
  buyPrice: number; // VES per USDT
  sellPrice: number; // VES per USDT
  buyRole: P2PRole; // MAKER (e.g. 0.25% commission) or TAKER (0%)
  sellRole: P2PRole; // MAKER or TAKER
  sourceBank: BankCode; // Bank used when buying/paying
  targetBank: BankCode; // Bank used when selling/receiving
  isInterbank: boolean; // Did it clear via interbank Pago Movil / Transfer?
  makerFeeRate?: number; // Default 0.0025 (0.25%)
}

export interface ArbitrageCycleResult {
  capitalUsdt: number;
  capitalVesInvested: number;
  cryptoGrossProceedsUsdt: number;
  binanceFeeUsdt: number;
  netCryptoUsdt: number;
  grossProceedsVes: number;
  bankFeesVes: number;
  netProceedsVes: number;
  netGainVes: number;
  netGainUsd: number;
  roiCyclePct: number; // e.g. 1.25%
  spreadNominalPct: number; // ((sellPrice - buyPrice) / buyPrice) * 100
  effectiveFeeDragPct: number; // spreadNominalPct - roiCyclePct
}

export interface VelocityProjection {
  cyclesPerDay: number;
  dailyGainVes: number;
  dailyGainUsd: number;
  weeklyGainUsd: number;
  monthlyGainUsd: number;
  dailyBankVolumeVes: number;
}

export interface SpreadQualityInput {
  buyPrice: number;
  sellPrice: number;
  volatility4hPct?: number; // Estimated price shift stddev or range in last 4h (e.g. 0.5%)
  bankCode?: BankCode; // Primary operational bank
  accountUsagePct?: number; // Consumed limit % (0 to 100)
  buyRole?: P2PRole;
  sellRole?: P2PRole;
}

export interface SpreadQualityResult {
  score: number; // 0 to 100
  verdict: SpreadQualityVerdict;
  verdictLabel: string;
  verdictColor: string; // Hex code or CSS class reference
  nominalSpreadPct: number;
  netSpreadPct: number;
  safetyCorridorPct: number;
  factors: {
    netMarginScore: number; // 0 to 100 (35% weight)
    safetyScore: number; // 0 to 100 (25% weight)
    velocityScore: number; // 0 to 100 (25% weight)
    limitHealthScore: number; // 0 to 100 (15% weight)
  };
  recommendation: string;
}

export interface ReverseGoalInput {
  dailyTargetUsd: number;
  availableCapitalUsdt: number;
  buyPrice: number;
  sellPrice: number;
  bankCode: BankCode;
  buyRole?: P2PRole;
  sellRole?: P2PRole;
  isInterbank?: boolean;
}

export interface ReverseGoalResult {
  dailyTargetUsd: number;
  availableCapitalUsdt: number;
  netGainPerCycleUsd: number;
  roiCyclePct: number;
  requiredCycles: number; // Number of full roundtrips needed
  totalDailyBankVolumeVes: number;
  isFeasible: boolean; // Feasible without inhuman turnover (>12 cycles is risky)
  warning?: string;
}

/**
 * Simulates a complete P2P Arbitrage cycle with full cascading deductions.
 */
export function computeArbitrageCycle(input: ArbitrageCycleInput): ArbitrageCycleResult {
  const {
    capitalUsdt,
    buyPrice,
    sellPrice,
    buyRole,
    sellRole,
    sourceBank,
    targetBank,
    isInterbank,
    makerFeeRate = 0.0025, // 0.25% Binance P2P VES maker fee (feb-2026)
  } = input;

  if (capitalUsdt <= 0 || buyPrice <= 0 || sellPrice <= 0) {
    throw new Error('Capital and prices must be positive numbers');
  }

  // 1. Fiat deployed to buy USDT:
  const capitalVesInvested = capitalUsdt * buyPrice;

  // 2. Binance fee deduction on buy leg (if Maker):
  const buyBinanceFeeUsdt = buyRole === 'MAKER' ? capitalUsdt * makerFeeRate : 0;
  const acquiredUsdt = capitalUsdt - buyBinanceFeeUsdt;

  // 3. Binance fee deduction on sell leg (if Maker):
  const sellBinanceFeeUsdt = sellRole === 'MAKER' ? acquiredUsdt * makerFeeRate : 0;
  const netSoldCryptoUsdt = acquiredUsdt - sellBinanceFeeUsdt;
  const totalBinanceFeeUsdt = buyBinanceFeeUsdt + sellBinanceFeeUsdt;

  // 4. Fiat proceeds from selling:
  const grossProceedsVes = netSoldCryptoUsdt * sellPrice;

  // 5. Bank fee deductions (source & target banking rail):
  const sourceBankFeeRate = isInterbank
    ? VENEZUELAN_BANK_FEES[sourceBank].transferInterbankFeePct
    : VENEZUELAN_BANK_FEES[sourceBank].transferSameBankFeePct;
  const sourceBankFeeVes = capitalVesInvested * sourceBankFeeRate;

  const targetBankFeeRate = isInterbank ? VENEZUELAN_BANK_FEES[targetBank].pagoMovilFeePct : 0;
  const targetBankFeeVes = grossProceedsVes * targetBankFeeRate;
  const totalBankFeesVes = sourceBankFeeVes + targetBankFeeVes;

  // 6. Net proceeds and earnings:
  const netProceedsVes = grossProceedsVes - totalBankFeesVes;
  const netGainVes = netProceedsVes - capitalVesInvested;
  const netGainUsd = netGainVes / sellPrice;

  const roiCyclePct = (netGainVes / capitalVesInvested) * 100;
  const spreadNominalPct = ((sellPrice - buyPrice) / buyPrice) * 100;
  const effectiveFeeDragPct = spreadNominalPct - roiCyclePct;

  return {
    capitalUsdt,
    capitalVesInvested,
    cryptoGrossProceedsUsdt: capitalUsdt,
    binanceFeeUsdt: totalBinanceFeeUsdt,
    netCryptoUsdt: netSoldCryptoUsdt,
    grossProceedsVes,
    bankFeesVes: totalBankFeesVes,
    netProceedsVes,
    netGainVes,
    netGainUsd,
    roiCyclePct,
    spreadNominalPct,
    effectiveFeeDragPct,
  };
}

/**
 * Projects multi-cycle earnings and required bank volumes across daily turnover rates.
 */
export function projectVelocityEarnings(
  cycle: ArbitrageCycleResult,
  turnoverRates: number[] = [1, 3, 5, 10],
): VelocityProjection[] {
  return turnoverRates.map((cycles) => {
    const dailyGainVes = cycle.netGainVes * cycles;
    const dailyGainUsd = cycle.netGainUsd * cycles;
    const weeklyGainUsd = dailyGainUsd * 7;
    const monthlyGainUsd = dailyGainUsd * 30;
    // Each cycle moves: buying fiat out + selling fiat in
    const dailyBankVolumeVes = (cycle.capitalVesInvested + cycle.netProceedsVes) * cycles;

    return {
      cyclesPerDay: cycles,
      dailyGainVes,
      dailyGainUsd,
      weeklyGainUsd,
      monthlyGainUsd,
      dailyBankVolumeVes,
    };
  });
}

/**
 * Calculates the Spread Quality Score (SQS: 0-100) combining net margin,
 * volatility cushion, bank rail velocity, and account limits.
 */
export function computeSpreadQualityScore(input: SpreadQualityInput): SpreadQualityResult {
  const {
    buyPrice,
    sellPrice,
    volatility4hPct = 0.4,
    bankCode = 'BANESCO',
    accountUsagePct = 25,
    buyRole = 'MAKER',
    sellRole = 'MAKER',
  } = input;

  if (buyPrice <= 0 || sellPrice <= 0) {
    throw new Error('Prices must be positive');
  }

  const nominalSpreadPct = ((sellPrice - buyPrice) / buyPrice) * 100;

  // Run a reference 1,000 USDT cycle to measure net margin:
  const refCycle = computeArbitrageCycle({
    capitalUsdt: 1000,
    buyPrice,
    sellPrice,
    buyRole,
    sellRole,
    sourceBank: bankCode,
    targetBank: bankCode,
    isInterbank: false,
  });

  const netSpreadPct = refCycle.roiCyclePct;

  // Factor 1: Net Margin Score (35% weight)
  // Target benchmark: 1.5% net is 100 pts. 0% is 0 pts. < 0 is 0.
  const netMarginScore = Math.min(100, Math.max(0, (netSpreadPct / 1.5) * 100));

  // Factor 2: Safety Corridor vs Volatility (25% weight)
  // Target: Net spread must be at least 2.5x the 4h volatility to get 100 pts.
  const corridorRatio = volatility4hPct > 0 ? netSpreadPct / volatility4hPct : 2.5;
  const safetyScore = Math.min(100, Math.max(0, (corridorRatio / 2.5) * 100));
  const safetyCorridorPct = corridorRatio;

  // Factor 3: Bank Rail Velocity Score (25% weight)
  const bankInfo = VENEZUELAN_BANK_FEES[bankCode] ?? VENEZUELAN_BANK_FEES.OTRO;
  const velocityScore = bankInfo.velocityScore;

  // Factor 4: Account Limit Health Score (15% weight)
  // 0% usage -> 100 score; 80% usage -> 40 score; 100% usage -> 0 score.
  const limitHealthScore = Math.min(100, Math.max(0, (100 - accountUsagePct) * 1.25));

  // Weighted total:
  const rawScore =
    netMarginScore * 0.35 + safetyScore * 0.25 + velocityScore * 0.25 + limitHealthScore * 0.15;

  const score = Math.round(Math.min(100, Math.max(0, rawScore)));

  // Determine Verdict:
  let verdict: SpreadQualityVerdict;
  let verdictLabel: string;
  let verdictColor: string;
  let recommendation: string;

  if (score >= 85) {
    verdict = 'OPTIMAL';
    verdictLabel = 'Óptimo / Expansivo';
    verdictColor = '#10b981'; // Green
    recommendation =
      'Spread robusto con excelente colchón. Operar con máximo volumen y posicionamiento Top 1.';
  } else if (score >= 65) {
    verdict = 'HEALTHY';
    verdictLabel = 'Saludable / Normal';
    verdictColor = '#f59e0b'; // Amber
    recommendation =
      'Operativa estándar. Mantener posición Top 2/Top 3 con margen objetivo de 1.2% - 1.8%.';
  } else if (score >= 45) {
    verdict = 'CAUTION';
    verdictLabel = 'Ajustado / Cauteloso';
    verdictColor = '#f97316'; // Orange
    recommendation =
      'Margen comprimido. Operar solo como Maker (evitar órdenes Taker). Reducir tamaño de lote.';
  } else {
    verdict = 'TOXIC';
    verdictLabel = 'Tóxico / Inviable';
    verdictColor = '#ef4444'; // Red
    recommendation =
      'Pausa recomendada. Las comisiones y el riesgo cambiario absorben la ganancia esperada.';
  }

  return {
    score,
    verdict,
    verdictLabel,
    verdictColor,
    nominalSpreadPct: Number(nominalSpreadPct.toFixed(2)),
    netSpreadPct: Number(netSpreadPct.toFixed(2)),
    safetyCorridorPct: Number(safetyCorridorPct.toFixed(2)),
    factors: {
      netMarginScore: Math.round(netMarginScore),
      safetyScore: Math.round(safetyScore),
      velocityScore: Math.round(velocityScore),
      limitHealthScore: Math.round(limitHealthScore),
    },
    recommendation,
  };
}

/**
 * Plans reverse goal sizing: calculates required cycles and bank volume to reach a target.
 */
export function planReverseGoal(input: ReverseGoalInput): ReverseGoalResult {
  const {
    dailyTargetUsd,
    availableCapitalUsdt,
    buyPrice,
    sellPrice,
    bankCode,
    buyRole = 'MAKER',
    sellRole = 'MAKER',
    isInterbank = false,
  } = input;

  if (dailyTargetUsd <= 0 || availableCapitalUsdt <= 0 || buyPrice <= 0 || sellPrice <= 0) {
    throw new Error('All target, capital and price inputs must be positive numbers');
  }

  const cycle = computeArbitrageCycle({
    capitalUsdt: availableCapitalUsdt,
    buyPrice,
    sellPrice,
    buyRole,
    sellRole,
    sourceBank: bankCode,
    targetBank: bankCode,
    isInterbank,
  });

  const netGainPerCycleUsd = cycle.netGainUsd;
  const roiCyclePct = cycle.roiCyclePct;

  if (netGainPerCycleUsd <= 0) {
    return {
      dailyTargetUsd,
      availableCapitalUsdt,
      netGainPerCycleUsd: 0,
      roiCyclePct: 0,
      requiredCycles: Infinity,
      totalDailyBankVolumeVes: 0,
      isFeasible: false,
      warning:
        'El ciclo actual genera pérdida o ganancia nula debido a comisiones. No es posible alcanzar la meta.',
    };
  }

  const rawCycles = dailyTargetUsd / netGainPerCycleUsd;
  const requiredCycles = Math.ceil(rawCycles);
  const totalDailyBankVolumeVes =
    (cycle.capitalVesInvested + cycle.netProceedsVes) * requiredCycles;

  const isFeasible = requiredCycles <= 12; // More than 12 cycles/day is physically and operationally unsustainable for a single operator
  let warning: string | undefined;

  if (requiredCycles > 12) {
    warning = `Requiere ${requiredCycles} vueltas/día. Esto supera la capacidad operativa saludable de una cuenta retail y disparará alertas bancarias.`;
  } else if (requiredCycles > 7) {
    warning = `Requiere ${requiredCycles} vueltas/día (alta intensidad operativa). Vigilar cupos bancarios de salida.`;
  }

  return {
    dailyTargetUsd,
    availableCapitalUsdt,
    netGainPerCycleUsd: Number(netGainPerCycleUsd.toFixed(2)),
    roiCyclePct: Number(roiCyclePct.toFixed(2)),
    requiredCycles,
    totalDailyBankVolumeVes: Number(totalDailyBankVolumeVes.toFixed(2)),
    isFeasible,
    warning,
  };
}
