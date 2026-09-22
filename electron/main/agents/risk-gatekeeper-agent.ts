/**
 * Risk Gatekeeper Agent (Oficial de Riesgo Institucional)
 * Holds UNILATERAL VETO POWER over any trade proposal.
 * Ensures capital safety, anti-triangulation checks, daily bank exposure limits,
 * and BCV intervention window protection.
 */

import type { RiskVerdict, StrategistProposal, AgentHealthStatus } from './types';
import { AGENT_MCP_DOMAINS, AGENT_ASSIGNED_SKILLS } from './types';
import { executeFinancialSkill } from '../gemini-skills';

export class RiskGatekeeperAgent {
  readonly role = 'RISK_GATEKEEPER' as const;
  readonly name = 'Risk Gatekeeper (Oficial de Riesgo)';
  readonly assignedMcpDomains = AGENT_MCP_DOMAINS['RISK_GATEKEEPER'];
  readonly assignedSkills = AGENT_ASSIGNED_SKILLS['RISK_GATEKEEPER'];

  private opsProcessed = 0;
  private lastActive = Date.now();

  getHealth(): AgentHealthStatus {
    return {
      role: this.role,
      name: this.name,
      status: 'ONLINE',
      lastActiveTime: this.lastActive,
      opsProcessed: this.opsProcessed,
      description:
        'Gobernanza institucional de riesgo con poder de veto unilateral. Audita límites bancarios, anti-pitufeo y timing.',
      assignedMcpDomains: this.assignedMcpDomains,
      assignedSkills: this.assignedSkills,
    };
  }

  /**
   * Audits an identifier against ZK Threat Mesh and Blacklist registries.
   */
  auditCounterpartySafety(params: {
    identifier?: string;
    cedula?: string;
    phone?: string;
    accountNumber?: string;
    binanceAlias?: string;
  }): { isClean: boolean; reason?: string } {
    if (params.identifier) {
      const zkRes = executeFinancialSkill('audit_zk_mesh_threat', {
        identifier: params.identifier,
      });
      const zkData = zkRes.data as { threatFound?: boolean; riskStatus?: string } | undefined;
      if (zkData?.threatFound || zkData?.riskStatus === 'FLAGGED') {
        return { isClean: false, reason: 'Identificador marcado en Malla ZK Antifraude' };
      }
    }

    const blRes = executeFinancialSkill('check_counterparty_blacklist', {
      cedula: params.cedula,
      phone: params.phone,
      accountNumber: params.accountNumber,
      binanceAlias: params.binanceAlias,
    });
    const blData = blRes.data as { isBlacklisted?: boolean; incidentNotes?: string } | undefined;
    if (blData?.isBlacklisted) {
      return {
        isClean: false,
        reason: blData.incidentNotes ?? 'Entidad en lista negra institucional',
      };
    }

    return { isClean: true };
  }

  /**
   * Evaluates a trade proposal against the 6 safety rules of institutional trading.
   */
  evaluateProposal(
    proposal: StrategistProposal,
    context?: {
      dailyVolumeProcessedUsdt?: number;
      dailyLimitUsdt?: number;
      counterpartyRiskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
      isBcvInterventionWindowActive?: boolean;
    },
  ): RiskVerdict {
    this.opsProcessed++;
    this.lastActive = Date.now();

    const warnings: string[] = [];
    let riskScore = 15; // Base low risk
    const meetsGoldenRule = proposal.mathematicalValidation.meetsGoldenRule;
    const dailyVolume = context?.dailyVolumeProcessedUsdt ?? 4200;
    const dailyLimit = context?.dailyLimitUsdt ?? 15000;
    const counterpartyRisk = context?.counterpartyRiskLevel ?? 'LOW';
    const isBcvActive = context?.isBcvInterventionWindowActive ?? false;

    // Rule 1: Golden Spread Rule (Net Spread >= 0.50%) - INNEGOCIABLE
    if (!meetsGoldenRule || proposal.mathematicalValidation.netSpreadPct < 0.5) {
      return {
        status: 'VETOED',
        riskScore: 95,
        vetoReason: `VETO POR RIESGO: El spread neto proyectado (${proposal.mathematicalValidation.netSpreadPct.toFixed(2)}%) es inferior a la regla de oro institucional (0.50% neto). Operar con este margen absorbe riesgo sin compensación adecuada.`,
        warnings: ['Margen neto insuficiente tras costos de red y comisiones bancarias.'],
        auditedParameters: {
          meetsGoldenRule: false,
          counterpartyRiskLevel: counterpartyRisk,
          bcvInterventionWindowRisk: isBcvActive ? 'ELEVATED' : 'NONE',
          dailyBankLimitExceeded: false,
          antiPitufeoViolation: false,
        },
        recommendedAction:
          'Descartar la ruta y aguardar mejor dispersión en los libros de órdenes.',
        evaluatedAt: Date.now(),
      };
    }

    // Rule 1.1: Monte Carlo Tail Risk & P95 Slippage Check
    const mc = proposal.mathematicalValidation.monteCarlo;
    if (mc) {
      if (mc.p95SlippagePct > 0.6) {
        return {
          status: 'VETOED',
          riskScore: 92,
          vetoReason: `VETO POR RIESGO (MICROESTRUCTURA MONTE CARLO): El deslizamiento en cola P95 proyectado (${mc.p95SlippagePct}%) destruye el margen neto. Alta probabilidad de cancelaciones súbitas y slippage en los libros.`,
          warnings: [
            `P95 Slippage Crítico: ${mc.p95SlippagePct}%`,
            `VaR 95%: $${mc.var95Usdt} USDT`,
          ],
          auditedParameters: {
            meetsGoldenRule: true,
            counterpartyRiskLevel: counterpartyRisk,
            bcvInterventionWindowRisk: isBcvActive ? 'ELEVATED' : 'NONE',
            dailyBankLimitExceeded: false,
            antiPitufeoViolation: false,
          },
          recommendedAction:
            'Reducir el tamaño del ticket a la mitad o suspender órdenes taker hasta que la profundidad del libro mejore.',
          evaluatedAt: Date.now(),
        };
      } else if (mc.p95SlippagePct > 0.3 || mc.fillRatePct < 85) {
        riskScore += 20;
        warnings.push(
          `Riesgo de cola Monte Carlo P95 (${mc.p95SlippagePct}%): Tasa de llenado proyectada en ${mc.fillRatePct}%. VaR 95%: $${mc.var95Usdt} USDT.`,
        );
      }
    }

    // Rule 2: Daily Banking & Custody Exposure Limit
    const projectedTotalVolume = dailyVolume + proposal.plan.capitalRequiredUsdt;
    const dailyBankLimitExceeded = projectedTotalVolume > dailyLimit;
    if (dailyBankLimitExceeded) {
      return {
        status: 'VETOED',
        riskScore: 90,
        vetoReason: `VETO POR RIESGO: La operación de ${proposal.plan.capitalRequiredUsdt} USDT excede el límite operativo diario de la cuenta bancaria (${dailyLimit} USDT proyectados). Riesgo inminente de bloqueo por compliance bancario.`,
        warnings: ['Límite diario de transferencias alcanzado en la cuenta custodia.'],
        auditedParameters: {
          meetsGoldenRule: true,
          counterpartyRiskLevel: counterpartyRisk,
          bcvInterventionWindowRisk: isBcvActive ? 'ELEVATED' : 'NONE',
          dailyBankLimitExceeded: true,
          antiPitufeoViolation: false,
        },
        recommendedAction:
          'Rotar hacia cuenta bancaria secundaria o esperar reset a las 00:00 UTC.',
        evaluatedAt: Date.now(),
      };
    }

    // Rule 2.1: Bank Network Health & Outage Protection (check_bank_operational_status)
    const bankAudit = executeFinancialSkill('check_bank_operational_status', {});
    const bankData = bankAudit.data as {
      pauseTradingDirective?: boolean;
      networkStatus?: string;
      affectedBanks?: string[];
    };
    if (bankData?.pauseTradingDirective) {
      return {
        status: 'VETOED',
        riskScore: 98,
        vetoReason: `VETO POR SEGURIDAD BANCARIA: Interrupción o mantenimiento crítico detectado en la red bancaria (${bankData.affectedBanks?.join(', ') || 'Bancos Locales'}). Riesgo severo de fondos atrapados en tránsito.`,
        warnings: ['Directiva de pausa preventiva activada por el monitor bancario.'],
        auditedParameters: {
          meetsGoldenRule: true,
          counterpartyRiskLevel: counterpartyRisk,
          bcvInterventionWindowRisk: isBcvActive ? 'ELEVATED' : 'NONE',
          dailyBankLimitExceeded: false,
          antiPitufeoViolation: false,
        },
        recommendedAction:
          'Suspender operaciones de salida en el banco afectado hasta confirmación de estabilidad de SUDEBAN/Cámara.',
        evaluatedAt: Date.now(),
      };
    } else if (bankData?.networkStatus === 'CAUTION_DEGRADED') {
      riskScore += 15;
      warnings.push(
        `Retrasos intermitentes reportados en la cámara de compensación bancaria (${bankData.affectedBanks?.join(', ') || 'Banca'}).`,
      );
    }

    // Rule 3: Counterparty Risk
    if (counterpartyRisk === 'HIGH') {
      return {
        status: 'VETOED',
        riskScore: 85,
        vetoReason:
          'VETO POR RIESGO: La contraparte presenta historial de disputas o antigüedad menor a 30 días con menos de 20 órdenes completadas.',
        warnings: ['Contraparte de alto riesgo de triangulación fraudulenta.'],
        auditedParameters: {
          meetsGoldenRule: true,
          counterpartyRiskLevel: 'HIGH',
          bcvInterventionWindowRisk: isBcvActive ? 'ELEVATED' : 'NONE',
          dailyBankLimitExceeded: false,
          antiPitufeoViolation: false,
        },
        recommendedAction:
          'Filtrar libro únicamente por comerciantes verificados (Merchant PRO / Yellow Badge).',
        evaluatedAt: Date.now(),
      };
    }

    // Rule 4: BCV Intervention Window Window Assessment
    if (isBcvActive) {
      riskScore += 25;
      warnings.push(
        'Ventana de intervención cambiaria BCV activa (10:00 - 11:30 AM). Volatilidad elevada de la tasa paralela.',
      );
    }

    // Rule 5: Ticket Concentration (Anti-Pitufeo)
    const isAntiPitufeo = proposal.plan.capitalRequiredUsdt > 3000;
    if (isAntiPitufeo) {
      riskScore += 15;
      warnings.push(
        'Ticket individual superior a 3000 USDT. Se sugiere fragmentar la ejecución en 2 tramos.',
      );
    }

    const status = warnings.length > 0 ? 'APPROVED_WITH_WARNINGS' : 'APPROVED';

    return {
      status,
      riskScore,
      warnings,
      auditedParameters: {
        meetsGoldenRule: true,
        counterpartyRiskLevel: counterpartyRisk,
        bcvInterventionWindowRisk: isBcvActive ? 'ELEVATED' : 'NONE',
        dailyBankLimitExceeded: false,
        antiPitufeoViolation: false,
      },
      recommendedAction:
        status === 'APPROVED'
          ? 'Aprobación limpia de riesgo. Habilitado para confirmación manual del operador.'
          : 'Aprobación condicionada: Operar con monitoreo activo de confirmación bancaria.',
      evaluatedAt: Date.now(),
    };
  }
}
