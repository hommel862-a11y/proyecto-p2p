/**
 * Institutional P2P Desk - Multi-Agent Swarm Types & Contracts.
 * Defines roles, proposals, verdicts, and governance mechanisms.
 */

import type { StrategyPlanCard } from '../../shared/types';
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
  assignedMcpDomains?: string[];
  assignedSkills?: string[];
}

/**
 * Institutional mapping of MCP Server Domains assigned to each Agent in the Swarm.
 */
export const AGENT_MCP_DOMAINS: Record<AgentRole, string[]> = {
  SENTINEL: ['p2p-macro-predictor', 'p2p-multi-exchange', 'p2p-sudeban-radar'],
  STRATEGIST: ['p2p-arbitrage-engine', 'p2p-orderbook-depth', 'p2p-capital-compounder'],
  RISK_GATEKEEPER: ['p2p-counterparty-intel', 'p2p-dispute-sentinel'],
  DISPUTE_AUDITOR: ['p2p-evidence-vault', 'p2p-dispute-sentinel'],
};

/**
 * Institutional mapping of Financial Skills dispatched by each Agent in the Swarm.
 */
export const AGENT_ASSIGNED_SKILLS: Record<AgentRole, string[]> = {
  SENTINEL: [
    'predict_bcv_market_intelligence',
    'forecast_central_bank_liquidity_drain',
    'monitor_fiat_flight_and_dollarization_velocity',
    'check_bank_operational_status',
    'estimate_adverse_selection_vpin',
    'evaluate_golden_spread',
  ],
  STRATEGIST: [
    'scan_triangular_arbitrage',
    'simulate_trade_impact',
    'calculate_optimal_spread_avellaneda',
    'compute_optimal_order_slicing_twap_vwap',
    'calculate_maker_fill_probability_markov',
    'analyze_fx_corridor_efficiency',
    'calculate_cross_exchange_basis_spread',
    'simulate_game_theory_nash_repricing',
    'optimize_idle_capital_simple_earn',
    'optimize_locked_vs_flexible_liquidity_ladder',
  ],
  RISK_GATEKEEPER: [
    'evaluate_golden_spread',
    'evaluate_delta_neutral_hedge',
    'forecast_market_volatility_2h',
    'audit_zk_mesh_threat',
    'check_counterparty_blacklist',
    'calculate_convexity_and_gamma_risk',
    'optimize_capital_allocation_kelly',
  ],
  DISPUTE_AUDITOR: [
    'generate_dispute_dossier',
    'audit_payment_proof_ocr',
    'audit_sop_compliance_enforcement',
    'sync_google_sheets_live_ledger',
    'triage_incident_and_escalate',
  ],
};

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

/**
 * Narrow view of the renderer's treasury snapshot consumed by the Risk Gatekeeper.
 * Projected from `TreasurySnapshotDto` by the orchestrator: the gatekeeper only needs the
 * aggregates, never the per-account list, so a bloated DTO cannot widen its blast radius.
 */
export interface TreasuryRiskContext {
  /** Accounts at or above 100% of their daily VES cap. */
  overLimitCount: number;
  /** Accounts between 80% and 100% of their daily VES cap. */
  nearLimitCount: number;
  /** Accounts the operator paused (`status === 'DISABLED'`). */
  disabledCount: number;
  /** Accounts at their daily transaction cap (SUDEBAN velocity). */
  saturatedCount: number;
  /** Real VES moved today across all accounts. */
  totalSpentTodayVes: number;
  /** Real sum of daily VES caps across ACTIVE accounts. */
  totalDailyLimitVes: number;
}

/** Where the daily-volume/daily-limit figures used by Rule 2 actually came from. */
export type TreasuryAuditSource = 'RENDERER_SNAPSHOT' | 'FALLBACK_DEFAULTS';

/**
 * Real treasury figures the verdict was audited against. Present on every verdict so
 * downstream consumers (plan execution, HUD) can tell a real limit from a placeholder.
 */
export interface TreasuryAudit {
  source: TreasuryAuditSource;
  dailyVolumeUsed: number;
  dailyLimitUsed: number;
  overLimitCount: number;
  nearLimitCount: number;
  disabledCount: number;
  saturatedCount: number;
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
    monteCarlo?: {
      meanSlippagePct: number;
      p95SlippagePct: number;
      p99SlippagePct: number;
      fillRatePct: number;
      var95Usdt: number;
      isSafeForExecution: boolean;
      recommendation: string;
    };
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
    /** Real treasury figures behind Rule 2; absent only on pre-bridge call sites. */
    treasuryAudit?: TreasuryAudit;
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
