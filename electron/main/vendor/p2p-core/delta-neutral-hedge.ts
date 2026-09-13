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
