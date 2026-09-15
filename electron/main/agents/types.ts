/**
 * Institutional P2P Desk - Multi-Agent Swarm Types & Contracts.
 * Defines roles, proposals, verdicts, and governance mechanisms.
 */

import type { StrategyPlanCard } from '../shared/types';
import type { EngramObservationRecord } from '../db/database';

export type AgentRole = 'SENTINEL' | 'STRATEGIST' | 'RISK_GATEKEEPER' | 'DISPUTE_AUDITOR';

export type RiskVerdictStatus = 'APPROVED' | 'APPROVED_WITH_WARNINGS' | 'VETOED';

export interface AgentHealthStatus {
  role: AgentRole;
  name: string;
  status: 'ONLINE' | 'STANDBY' | 'BUSY' | 'DEGRADED';
  lastActiveTime: number;
  opsProcessed: number;
  description: string;
}

export interface SentinelSignal {
  timestamp: number;
  source: string;
  asset: string;
  fiat: string;
  grossSpreadPct: number;
  netSpreadPct: number;
  bestBid: number;
  bestAsk: number;
  bcvRate?: number;
  parallelRate?: number;
  rateGapPct?: number;
  isViable: boolean;
  notes: string[];
}

export interface StrategistProposal {
  plan: StrategyPlanCard;
  rationale: string;
  mathematicalValidation: {
    grossSpreadPct: number;
    estimatedFeesPct: number;
    netSpreadPct: number;
    vwapPrice?: number;
    slippageBps?: number;
    meetsGoldenRule: boolean;
  };
  recommendedTiming: string;
}

export interface RiskVerdict {
  status: RiskVerdictStatus;
  riskScore: number; // 0 to 100 (higher = riskier)
  vetoReason?: string;
  warnings: string[];
  auditedParameters: {
    meetsGoldenRule: boolean;
    counterpartyRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    bcvInterventionWindowRisk: 'NONE' | 'ELEVATED' | 'CRITICAL';
    dailyBankLimitExceeded: boolean;
    antiPitufeoViolation: boolean;
  };
  recommendedAction: string;
  evaluatedAt: number;
}

export interface SwarmAnalysisResult {
  swarmTimestamp: number;
  sentinelSignal: SentinelSignal;
  strategistProposal?: StrategistProposal;
  riskVerdict: RiskVerdict;
  suggestedPlan?: StrategyPlanCard;
  engramObservation?: EngramObservationRecord;
  executionSummary: string;
}
