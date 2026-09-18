import { auditHistoricalCounterpartyRisk } from '../core/index.js';
import {
  AuditCounterpartyExposureInputSchema,
  type AuditCounterpartyExposureInput,
} from '../schemas/index.js';

export const auditCounterpartyExposureTool = {
  name: 'audit_counterparty_exposure',
  description:
    'Audita la concentración de volumen por contrapartes individuales y alerta sobre discrepancias de titularidad (anti-triangulación) y antecedentes de disputas.',
  inputSchema: AuditCounterpartyExposureInputSchema,
  execute: (input: AuditCounterpartyExposureInput) => {
    const result = auditHistoricalCounterpartyRisk({
      counterpartyAlias: input.counterpartyAlias,
      historicalTradesCount: input.historicalTradesCount,
      disputeThresholdPct: input.disputeThresholdPct,
      maxConcentrationPct: input.maxConcentrationPct,
    });

    return {
      totalTradesAudited: result.totalTradesAudited,
      uniqueCounterpartiesCount: result.uniqueCounterpartiesCount,
      counterpartyRiskScore: result.counterpartyRiskScore,
      concentration: result.concentration,
      flaggedCounterpartiesCount: result.flaggedCounterparties.length,
      flaggedCounterparties: result.flaggedCounterparties,
      complianceVerdict: result.complianceVerdict,
      recommendations: result.recommendations,
      isSafeForInstitutionalTrading: result.complianceVerdict === 'APPROVED_FOR_TRADING',
    };
  },
};
