/**
 * Institutional Multi-Agent Swarm Orchestrator.
 * Coordinates Sentinel, Strategist, Risk Gatekeeper and Dispute Auditor.
 * Enforces strict separation of concerns, risk veto power, and Engram memory persistence.
 */

import type { P2PDatabaseService, EngramObservationRecord } from '../db/database';
import { getTreasurySnapshot } from '../ipc/treasury-snapshot';
import { SentinelAgent } from './sentinel-agent';
import { StrategistAgent } from './strategist-agent';
import { RiskGatekeeperAgent } from './risk-gatekeeper-agent';
import { DisputeAuditorAgent, type DisputeDossierResult } from './dispute-auditor-agent';
import { CounterpartyReputationGraph } from './counterparty-graph';
import type {
  SwarmAnalysisResult,
  AgentHealthStatus,
  SentinelSignal,
  StrategistProposal,
  RiskVerdict,
  TreasuryRiskContext,
} from './types';

/**
 * Placeholders used ONLY while the renderer has not announced a real treasury snapshot.
 * They keep the pre-bridge behavior identical instead of failing closed, so an un-bridged
 * renderer degrades to the previous (deliberately conservative) numbers.
 */
const FALLBACK_DAILY_VOLUME_USDT = 4500;
const FALLBACK_DAILY_LIMIT_USDT = 15000;

export class AgentSwarmOrchestrator {
  private sentinel: SentinelAgent;
  private strategist: StrategistAgent;
  private riskGatekeeper: RiskGatekeeperAgent;
  private disputeAuditor: DisputeAuditorAgent;
  private counterpartyGraph: CounterpartyReputationGraph;

  constructor(private db: P2PDatabaseService) {
    this.sentinel = new SentinelAgent();
    this.strategist = new StrategistAgent();
    this.riskGatekeeper = new RiskGatekeeperAgent();
    this.disputeAuditor = new DisputeAuditorAgent();
    this.counterpartyGraph = new CounterpartyReputationGraph(this.db);
  }

  getCounterpartyGraph(): CounterpartyReputationGraph {
    return this.counterpartyGraph;
  }

  /**
   * Returns current health and telemetry status of all agents in the swarm.
   */
  getSwarmHealth(): AgentHealthStatus[] {
    return [
      this.sentinel.getHealth(),
      this.strategist.getHealth(),
      this.riskGatekeeper.getHealth(),
      this.disputeAuditor.getHealth(),
    ];
  }

  /**
   * Executes the full institutional multi-agent pipeline:
   * 1. Sentinel scans market conditions
   * 2. Strategist (Gentleman AI) models route and VWAP
   * 3. Risk Gatekeeper audits and applies unilateral veto if needed
   * 4. Swarm persists the observation into Engram Memory
   */
  async runAnalysisPipeline(params?: {
    asset?: string;
    fiat?: string;
    capitalUsdt?: number;
    bestBid?: number;
    bestAsk?: number;
    bcvRate?: number;
    parallelRate?: number;
    counterpartyAlias?: string;
    counterpartyRealName?: string;
    counterpartyDoc?: string;
    counterpartyRiskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    isBcvInterventionWindowActive?: boolean;
  }): Promise<SwarmAnalysisResult> {
    const capital = params?.capitalUsdt ?? 1000;

    // 1. Sentinel Stage
    const sentinelSignal: SentinelSignal = this.sentinel.scanMarket({
      asset: params?.asset,
      fiat: params?.fiat,
      bestBid: params?.bestBid,
      bestAsk: params?.bestAsk,
      bcvRate: params?.bcvRate,
      parallelRate: params?.parallelRate,
    });

    // 2. Counterparty Reputation & Anti-Triangulation check (if alias/name provided)
    let evaluatedRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = params?.counterpartyRiskLevel ?? 'LOW';
    if (params?.counterpartyAlias && params?.counterpartyRealName) {
      const cpartyEval = this.counterpartyGraph.assessRisk({
        alias: params.counterpartyAlias,
        realName: params.counterpartyRealName,
        documentId: params.counterpartyDoc,
      });
      if (cpartyEval.riskLevel === 'CRITICAL' || cpartyEval.riskLevel === 'HIGH') {
        evaluatedRiskLevel = 'HIGH';
      } else if (cpartyEval.riskLevel === 'MEDIUM') {
        evaluatedRiskLevel = 'MEDIUM';
      }
    }

    // 3. Strategist Stage (Gentleman AI)
    const strategistProposal: StrategistProposal = this.strategist.formulateProposal(
      sentinelSignal,
      capital,
    );

    // 4. Risk Gatekeeper Stage (Unilateral Veto Power)
    // Real treasury state announced by the renderer; null until it announces one.
    const announcedSnapshot = getTreasurySnapshot();
    const treasuryContext: TreasuryRiskContext | null = announcedSnapshot
      ? {
          overLimitCount: announcedSnapshot.overLimitCount,
          nearLimitCount: announcedSnapshot.nearLimitCount,
          disabledCount: announcedSnapshot.disabledCount,
          saturatedCount: announcedSnapshot.saturatedCount,
          totalSpentTodayVes: announcedSnapshot.totalSpentTodayVes,
          totalDailyLimitVes: announcedSnapshot.totalDailyLimitVes,
        }
      : null;

    const riskVerdict: RiskVerdict = this.riskGatekeeper.evaluateProposal(strategistProposal, {
      // Real figures when the treasury is bridged, legacy placeholders otherwise.
      // A zero aggregate limit means every account is unlimited/disabled, so the
      // placeholder is the safer ceiling to audit against.
      dailyVolumeProcessedUsdt: treasuryContext
        ? treasuryContext.totalSpentTodayVes
        : FALLBACK_DAILY_VOLUME_USDT,
      dailyLimitUsdt: treasuryContext?.totalDailyLimitVes || FALLBACK_DAILY_LIMIT_USDT,
      counterpartyRiskLevel: evaluatedRiskLevel,
      isBcvInterventionWindowActive: params?.isBcvInterventionWindowActive ?? false,
      treasurySnapshot: treasuryContext,
    });

    // 5. Persistence & Governance
    let engramObs: EngramObservationRecord | undefined;
    let executionSummary: string;

    if (riskVerdict.status === 'VETOED') {
      executionSummary = `⛔ **OPERACIÓN VETADA POR EL OFICIAL DE RIESGO**\n\n${riskVerdict.vetoReason}\n\n*Acción recomendada*: ${riskVerdict.recommendedAction}`;
      engramObs = {
        topicKey: `swarm/risk-veto/${Date.now().toString(36)}`,
        type: 'decision',
        scope: 'project',
        what: `Propuesta de triangulación vetada por riesgo: ${strategistProposal.plan.route}`,
        why: riskVerdict.vetoReason ?? 'Criterios de seguridad institucional no superados',
        whereAffected: strategistProposal.plan.route,
        learned: `El oficial de riesgo bloqueó la operación (Score: ${riskVerdict.riskScore}/100). Preservación de capital ejecutada antes de arriesgar saldo bancario.`,
        confidenceScore: 0.98,
        status: 'active',
      };
      this.db.saveEngramObservation(engramObs);
    } else {
      // Approved or Approved with Warnings
      this.db.saveStrategyPlan({
        ...strategistProposal.plan,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const warningText =
        riskVerdict.warnings.length > 0
          ? `\n\n⚠️ **Advertencias del Gatekeeper**:\n${riskVerdict.warnings.map((w) => `• ${w}`).join('\n')}`
          : '\n\n✓ **Auditoría de Riesgo**: Todos los parámetros de seguridad aprobados.';

      executionSummary = `Mirá, el Enjambre Multi-Agente completó la auditoría institucional.\n\n* **Estratega (Gentleman AI)**: ${strategistProposal.rationale}\n* **Retorno Neto Proyectado**: ${strategistProposal.mathematicalValidation.netSpreadPct.toFixed(2)}% (${strategistProposal.plan.expectedProfitUsdt} USDT)\n* **Timing**: ${strategistProposal.recommendedTiming}${warningText}\n\nFijate en los parámetros y dale **EJECUTAR** cuando estés listo para despacharlo.`;

      engramObs = {
        topicKey: `swarm/plan-approved/${Date.now().toString(36)}`,
        type: 'discovery',
        scope: 'project',
        what: `Swarm aprobó plan: ${strategistProposal.plan.title} (Spread neto: ${strategistProposal.mathematicalValidation.netSpreadPct}%)`,
        why: `Auditoría del Risk Gatekeeper exitosa con Score ${riskVerdict.riskScore}/100`,
        whereAffected: strategistProposal.plan.route,
        learned: `Ruta validada con slippage de ${strategistProposal.mathematicalValidation.slippageBps} bps. Regla de oro superada con holgura.`,
        confidenceScore: 0.95,
        status: 'active',
      };
      this.db.saveEngramObservation(engramObs);
    }

    return {
      swarmTimestamp: Date.now(),
      sentinelSignal,
      strategistProposal,
      riskVerdict,
      suggestedPlan: riskVerdict.status !== 'VETOED' ? strategistProposal.plan : undefined,
      engramObservation: engramObs,
      executionSummary,
    };
  }

  /**
   * Delegates payment receipt audit to Dispute Auditor.
   */
  auditPaymentProof(params: {
    orderId: string;
    expectedAmountFiat: number;
    receiptAmountFiat: number;
    reference: string;
    bankName: string;
    payerName?: string;
  }): DisputeDossierResult {
    return this.disputeAuditor.auditPaymentProof(params);
  }
}
