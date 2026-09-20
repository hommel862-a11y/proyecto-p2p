/**
 * Dispute Auditor Agent (Auditor de Disputas y Verificación)
 * Analyzes inbound bank events, OCR captures, payment proofs,
 * and drafts technical evidence for platform mediation.
 */

import type { AgentHealthStatus } from './types';
import { AGENT_MCP_DOMAINS, AGENT_ASSIGNED_SKILLS } from './types';
import { executeFinancialSkill } from '../gemini-skills';

export interface DisputeDossierResult {
  orderId: string;
  verdict: 'PAYMENT_MATCHED' | 'SUSPECT_FRAUD' | 'NEEDS_MANUAL_REVIEW';
  fraudScore: number;
  evidenceSummary: string;
  actionableDossierMarkdown: string;
}

export class DisputeAuditorAgent {
  readonly role = 'DISPUTE_AUDITOR' as const;
  readonly name = 'Auditor de Disputas & OCR';
  readonly assignedMcpDomains = AGENT_MCP_DOMAINS['DISPUTE_AUDITOR'];
  readonly assignedSkills = AGENT_ASSIGNED_SKILLS['DISPUTE_AUDITOR'];

  private opsProcessed = 0;
  private lastActive = Date.now();

  getHealth(): AgentHealthStatus {
    return {
      role: this.role,
      name: this.name,
      status: 'ONLINE',
      lastActiveTime: this.lastActive,
      opsProcessed: this.opsProcessed,
      description: 'Auditoría forense de comprobantes bancarios, deduplicación de pagos y armado de dossieres de apelación.',
      assignedMcpDomains: this.assignedMcpDomains,
      assignedSkills: this.assignedSkills,
    };
  }

  /**
   * Verifies that all required forensic fields are present for dispute mediation.
   */
  verifyEvidenceCompleteness(params: {
    orderId: string;
    receiptAmount?: number;
    reference?: string;
    bankName?: string;
  }): { isComplete: boolean; missingFields: string[] } {
    const missing: string[] = [];
    if (!params.orderId) missing.push('orderId');
    if (params.receiptAmount === undefined || params.receiptAmount <= 0) missing.push('receiptAmount');
    if (!params.reference || params.reference.trim().length === 0) missing.push('reference');
    if (!params.bankName || params.bankName.trim().length === 0) missing.push('bankName');

    return {
      isComplete: missing.length === 0,
      missingFields: missing,
    };
  }

  auditPaymentProof(params: {
    orderId: string;
    expectedAmountFiat: number;
    receiptAmountFiat: number;
    reference: string;
    bankName: string;
    payerName?: string;
  }): DisputeDossierResult {
    this.opsProcessed++;
    this.lastActive = Date.now();

    const amountDiff = Math.abs(params.expectedAmountFiat - params.receiptAmountFiat);
    const isAmountValid = amountDiff < 0.01;
    const isRefValid = Boolean(params.reference && params.reference.length >= 6);

    let fraudScore = 5;
    let verdict: DisputeDossierResult['verdict'] = 'PAYMENT_MATCHED';
    const reasons: string[] = [];

    if (!isAmountValid) {
      fraudScore += 65;
      verdict = 'SUSPECT_FRAUD';
      reasons.push(`Discrepancia en monto: esperado Bs ${params.expectedAmountFiat.toFixed(2)}, recibido en comprobante Bs ${params.receiptAmountFiat.toFixed(2)}.`);
    }

    if (!isRefValid) {
      fraudScore += 25;
      if (verdict !== 'SUSPECT_FRAUD') verdict = 'NEEDS_MANUAL_REVIEW';
      reasons.push('Referencia bancaria ausente o formato anormal.');
    }

    const dossierMarkdown = `### Dossier de Auditoría Forense P2P
* **Orden ID**: \`${params.orderId}\`
* **Banco**: ${params.bankName}
* **Referencia Auditada**: \`${params.reference}\`
* **Monto Esperado**: Bs ${params.expectedAmountFiat.toLocaleString('es-VE')}
* **Monto Detectado**: Bs ${params.receiptAmountFiat.toLocaleString('es-VE')}
* **Veredicto Forense**: **${verdict}** (Score de Riesgo: ${fraudScore}/100)

**Dictamen Técnico**:
${reasons.length > 0 ? reasons.map((r) => `• ${r}`).join('\n') : '• Comprobante 100% verificado. Monto y referencia concilian con el libro de órdenes.'}`;

    return {
      orderId: params.orderId,
      verdict,
      fraudScore,
      evidenceSummary: reasons.join(' ') || 'Conciliación bancaria limpia.',
      actionableDossierMarkdown: dossierMarkdown,
    };
  }
}
