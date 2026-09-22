import {
  analyzeHourlyRiskDistribution,
  auditTradingDisciplineAndSpreadCompliance,
  generateForensicDossier,
  type ForensicAuditEvent,
  type ForensicOperationRecord,
} from '../core/index.js';
import {
  AuditAndRiskAnalyticsInputSchema,
  type AuditAndRiskAnalyticsInput,
} from '../schemas/index.js';

export const auditAndRiskAnalyticsTool = {
  name: 'audit_and_risk_analytics',
  description:
    'Interroga el registro forense en SQLite para auditar disciplina de trading, cumplimiento de la Regla de Oro (spread neto >= 0.50%), detector de tilt y ventana horaria de mayor riesgo de alertas.',
  inputSchema: AuditAndRiskAnalyticsInputSchema,
  execute: (input: AuditAndRiskAnalyticsInput) => {
    const timeframeDays = input.timeframeDays ?? 7;
    const minSpreadThresholdPct = input.minSpreadThresholdPct ?? 0.5;
    const focusArea = input.focusArea ?? 'ALL';
    const sampleEvents = (input.sampleEvents as ForensicAuditEvent[]) ?? [];
    const sampleOperations = (input.sampleOperations as ForensicOperationRecord[]) ?? [];

    const riskDist = analyzeHourlyRiskDistribution(sampleEvents);
    const discipline = auditTradingDisciplineAndSpreadCompliance(
      sampleOperations,
      minSpreadThresholdPct,
    );
    const dossier = generateForensicDossier(riskDist, discipline);

    return {
      success: true,
      timeframeDays,
      focusArea,
      dossier,
    };
  },
};
