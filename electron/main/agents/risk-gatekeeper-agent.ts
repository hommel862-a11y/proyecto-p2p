/**
 * Risk Gatekeeper Agent (Oficial de Riesgo Institucional)
 * Holds UNILATERAL VETO POWER over any trade proposal.
 * Ensures capital safety, anti-triangulation checks, daily bank exposure limits,
 * and BCV intervention window protection.
 */

import type {
  RiskVerdict,
  StrategistProposal,
  AgentHealthStatus,
  TreasuryAudit,
  TreasuryRiskContext,
} from './types';
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
   *
   * `context.treasurySnapshot` carries the renderer's real bank-account state. When it is
   * present, Rule 2 audits against those figures and the hard treasury blocks apply. When it
   * is absent or null, the legacy literal-based behavior is preserved unchanged.
   */
  evaluateProposal(
    proposal: StrategistProposal,
    context?: {
      dailyVolumeProcessedUsdt?: number;
      dailyLimitUsdt?: number;
      counterpartyRiskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
      isBcvInterventionWindowActive?: boolean;
      treasurySnapshot?: TreasuryRiskContext | null;
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

    // Real treasury state announced by the renderer, or null when it never announced one.
    const treasury = context?.treasurySnapshot ?? null;

    // Record which figures Rule 2 actually ran on, so consumers never confuse a real limit
    // with a placeholder. Always present, even on the fallback path.
    const treasuryAudit: TreasuryAudit = {
      source: treasury ? 'RENDERER_SNAPSHOT' : 'FALLBACK_DEFAULTS',
      dailyVolumeUsed: dailyVolume,
      dailyLimitUsed: dailyLimit,
      overLimitCount: treasury?.overLimitCount ?? 0,
      nearLimitCount: treasury?.nearLimitCount ?? 0,
      disabledCount: treasury?.disabledCount ?? 0,
      saturatedCount: treasury?.saturatedCount ?? 0,
    };

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

    // Rule 2.a: Hard treasury blocks read from the real renderer snapshot.
    // Entirely skipped when no snapshot was announced, which keeps the legacy
    // literal-based behavior intact for call sites that do not bridge the treasury.
    if (treasury) {
      if (treasury.disabledCount > 0) {
        return {
          status: 'VETOED',
          riskScore: 90,
          vetoReason: `VETO POR RIESGO (TESORERÍA REAL): ${treasury.disabledCount} cuenta(s) bancaria(s) están en estado DISABLED (pausadas por el operador o bloqueadas por el banco). No existe ruta de custodia ejecutable mientras una cuenta esté deshabilitada.`,
          warnings: [
            `${treasury.disabledCount} cuenta(s) en estado DISABLED: la rotación de cuenta está bloqueada.`,
          ],
          auditedParameters: {
            meetsGoldenRule: true,
            counterpartyRiskLevel: counterpartyRisk,
            bcvInterventionWindowRisk: isBcvActive ? 'ELEVATED' : 'NONE',
            dailyBankLimitExceeded: false,
            antiPitufeoViolation: false,
            treasuryAudit,
          },
          recommendedAction:
            'Reactivar las cuentas deshabilitadas en Tesorería y relanzar el análisis con un snapshot actualizado.',
          evaluatedAt: Date.now(),
        };
      }

      if (treasury.overLimitCount > 0) {
        return {
          status: 'VETOED',
          riskScore: 90,
          vetoReason: `VETO POR RIESGO (TESORERÍA REAL): ${treasury.overLimitCount} cuenta(s) bancaria(s) agotaron su límite diario en VES. Riesgo inminente de rechazo por compliance bancario. Rotación obligatoria antes de operar.`,
          warnings: [
            `${treasury.overLimitCount} cuenta(s) sobre el límite diario: ${treasuryAudit.dailyVolumeUsed} VES movementados contra ${treasuryAudit.dailyLimitUsed} VES de límite agregado.`,
          ],
          auditedParameters: {
            meetsGoldenRule: true,
            counterpartyRiskLevel: counterpartyRisk,
            bcvInterventionWindowRisk: isBcvActive ? 'ELEVATED' : 'NONE',
            dailyBankLimitExceeded: true,
            antiPitufeoViolation: false,
            treasuryAudit,
          },
          recommendedAction:
            'Rotar hacia una cuenta ACTIVE con saldo disponible o esperar el reset de las 00:00 UTC.',
          evaluatedAt: Date.now(),
        };
      }

      if (treasury.saturatedCount > 0) {
        return {
          status: 'VETOED',
          riskScore: 90,
          vetoReason: `VETO POR RIESGO (VELOCIDAD BANCARIA): ${treasury.saturatedCount} cuenta(s) alcanzó su tope diario de transacciones SUDEBAN. Añadir una transferencia más expone a veto del banco por saturación de la cuenta.`,
          warnings: [
            `${treasury.saturatedCount} cuenta(s) en estado de velocidad SATURATED: sin ruta de rotación disponible.`,
          ],
          auditedParameters: {
            meetsGoldenRule: true,
            counterpartyRiskLevel: counterpartyRisk,
            bcvInterventionWindowRisk: isBcvActive ? 'ELEVATED' : 'NONE',
            dailyBankLimitExceeded: false,
            antiPitufeoViolation: false,
            treasuryAudit,
          },
          recommendedAction:
            'Esperar el reset de transacciones (00:00 UTC) o recargar la tesorería con una cuenta adicional antes de operar.',
          evaluatedAt: Date.now(),
        };
      }

      if (treasury.nearLimitCount > 0) {
        riskScore += 15;
        warnings.push(
          `${treasury.nearLimitCount} cuenta(s) cercana(s) al límite diario VES (>= 80%). Rotar antes de la próxima operación para preservar margen de custodia.`,
        );
      }
    }

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
          treasuryAudit,
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
        treasuryAudit,
      },
      recommendedAction:
        status === 'APPROVED'
          ? 'Aprobación limpia de riesgo. Habilitado para confirmación manual del operador.'
          : 'Aprobación condicionada: Operar con monitoreo activo de confirmación bancaria.',
      evaluatedAt: Date.now(),
    };
  }
}
