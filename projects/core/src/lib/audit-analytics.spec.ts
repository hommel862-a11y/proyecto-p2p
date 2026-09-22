import { describe, it, expect } from 'vitest';
import {
  analyzeHourlyRiskDistribution,
  auditTradingDisciplineAndSpreadCompliance,
  generateForensicDossier,
  type ForensicAuditEvent,
  type ForensicOperationRecord,
} from './audit-analytics';

describe('AuditAnalytics Domain Engine', () => {
  describe('analyzeHourlyRiskDistribution', () => {
    it('handles empty audit events gracefully', () => {
      const res = analyzeHourlyRiskDistribution([]);
      expect(res.totalEventsAnalyzed).toBe(0);
      expect(res.hourlyBuckets).toHaveLength(24);
      expect(res.totalCriticalIncidents).toBe(0);
      expect(res.criticalIncidentRatePct).toBe(0);
      expect(res.highRiskHours).toEqual([]);
      expect(res.recommendation).toContain('estable');
    });

    it('correctly aggregates events by hour and calculates peak risk window', () => {
      const baseDate = new Date('2026-09-19T11:15:00Z');
      const hour11 = baseDate.getTime();
      const hour14 = new Date('2026-09-19T14:30:00Z').getTime();

      const events: ForensicAuditEvent[] = [
        { timestamp: hour11, severity: 'error', action: 'PAYMENT_MISMATCH' },
        { timestamp: hour11, severity: 'error', action: 'COUNTERPARTY_BLACKLISTED' },
        { timestamp: hour11, severity: 'warn', action: 'HIGH_LATENCY' },
        { timestamp: hour14, severity: 'info', action: 'NORMAL_HEARTBEAT' },
      ];

      const res = analyzeHourlyRiskDistribution(events);
      expect(res.totalEventsAnalyzed).toBe(4);
      expect(res.totalCriticalIncidents).toBe(3); // 2 errors + 1 warn

      const targetHour11 = new Date(hour11).getHours();
      const bucket11 = res.hourlyBuckets[targetHour11];
      expect(bucket11.errorCount).toBe(2);
      expect(bucket11.warnCount).toBe(1);
      expect(bucket11.riskLevel).toBe('CRITICAL');

      expect(res.peakRiskHour).toBe(targetHour11);
      expect(res.highRiskHours).toContain(targetHour11);
      expect(res.peakRiskScore).toBeGreaterThanOrEqual(7.5); // 2*3 + 1*1.5 = 7.5
      expect(res.recommendation).toContain('Precaución máxima');
    });

    it('identifies MEDIUM risk when only warnings occur', () => {
      const ts = new Date('2026-09-19T08:00:00Z').getTime();
      const events: ForensicAuditEvent[] = [
        { timestamp: ts, severity: 'warn', action: 'SPREAD_SPIKE' },
      ];
      const res = analyzeHourlyRiskDistribution(events);
      const targetHour = new Date(ts).getHours();
      expect(res.hourlyBuckets[targetHour].riskLevel).toBe('MEDIUM');
    });
  });

  describe('auditTradingDisciplineAndSpreadCompliance', () => {
    it('handles empty operations ledger', () => {
      const res = auditTradingDisciplineAndSpreadCompliance([]);
      expect(res.totalOperationsAnalyzed).toBe(0);
      expect(res.complianceRatePct).toBe(100);
      expect(res.tiltDetected).toBe(false);
      expect(res.tiltSeverity).toBe('NONE');
    });

    it('evaluates 100% compliant operations adhering to the Golden Rule (>= 0.50%)', () => {
      const ops: ForensicOperationRecord[] = [
        { id: 'OP-1', timestamp: '2026-09-19T10:00:00Z', netSpreadPct: 1.2, cryptoAmount: 1000 },
        { id: 'OP-2', timestamp: '2026-09-19T10:30:00Z', netSpreadPct: 0.85, cryptoAmount: 2000 },
        { id: 'OP-3', timestamp: '2026-09-19T11:00:00Z', netSpreadPct: 1.5, cryptoAmount: 1500 },
      ];

      const res = auditTradingDisciplineAndSpreadCompliance(ops, 0.5);
      expect(res.totalOperationsAnalyzed).toBe(3);
      expect(res.compliantOperationsCount).toBe(3);
      expect(res.nonCompliantOperationsCount).toBe(0);
      expect(res.complianceRatePct).toBe(100);
      expect(res.tiltDetected).toBe(false);
      expect(res.tiltSeverity).toBe('NONE');
      expect(res.estimatedSacrificedProfitUsdt).toBe(0);
      expect(res.volumeWeightedAverageSpreadPct).toBeGreaterThan(1.0);
    });

    it('detects severe tilt when 3 consecutive operations violate spread threshold', () => {
      const ops: ForensicOperationRecord[] = [
        { id: 'OP-1', timestamp: 1000, netSpreadPct: 1.1, cryptoAmount: 500 },
        { id: 'OP-2', timestamp: 2000, netSpreadPct: 0.2, cryptoAmount: 1000 }, // violation 1
        { id: 'OP-3', timestamp: 3000, netSpreadPct: 0.15, cryptoAmount: 1000 }, // violation 2
        { id: 'OP-4', timestamp: 4000, netSpreadPct: 0.1, cryptoAmount: 1000 }, // violation 3
      ];

      const res = auditTradingDisciplineAndSpreadCompliance(ops, 0.5);
      expect(res.totalOperationsAnalyzed).toBe(4);
      expect(res.compliantOperationsCount).toBe(1);
      expect(res.nonCompliantOperationsCount).toBe(3);
      expect(res.complianceRatePct).toBe(25);
      expect(res.tiltDetected).toBe(true);
      expect(res.tiltSeverity).toBe('SEVERE');
      expect(res.tiltConsecutiveViolations).toBe(3);
      // Shortfalls:
      // OP-2: (0.50 - 0.20)/100 * 1000 = 3 USDT
      // OP-3: (0.50 - 0.15)/100 * 1000 = 3.5 USDT
      // OP-4: (0.50 - 0.10)/100 * 1000 = 4 USDT
      // Total = 10.50 USDT
      expect(res.estimatedSacrificedProfitUsdt).toBeCloseTo(10.5, 1);
      expect(res.summary).toContain('ALERTA DE TILT SEVERO');
    });

    it('parses netSpreadPct from rawJson metadata if not explicitly provided', () => {
      const ops: ForensicOperationRecord[] = [
        {
          id: 'OP-RAW-1',
          timestamp: '2026-09-19T10:00:00Z',
          cryptoAmount: 1000,
          rawJson: JSON.stringify({ netSpreadPct: 1.45, bank: 'Banesco' }),
        },
        {
          id: 'OP-RAW-2',
          timestamp: '2026-09-19T10:30:00Z',
          cryptoAmount: 1000,
          rawJson: JSON.stringify({ spreadPct: 0.35, bank: 'Mercantil' }), // Below 0.50%
        },
      ];

      const res = auditTradingDisciplineAndSpreadCompliance(ops, 0.5);
      expect(res.totalOperationsAnalyzed).toBe(2);
      expect(res.compliantOperationsCount).toBe(1);
      expect(res.nonCompliantOperationsCount).toBe(1);
      expect(res.complianceRatePct).toBe(50);
      expect(res.maxObservedSpreadPct).toBe(1.45);
      expect(res.minObservedSpreadPct).toBe(0.35);
    });
  });

  describe('generateForensicDossier', () => {
    it('produces DISCIPLINED standing for compliant trading and low risk distribution', () => {
      const risk = analyzeHourlyRiskDistribution([]);
      const discipline = auditTradingDisciplineAndSpreadCompliance([
        { timestamp: 1000, netSpreadPct: 1.3, cryptoAmount: 1000 },
        { timestamp: 2000, netSpreadPct: 1.1, cryptoAmount: 1000 },
      ]);

      const dossier = generateForensicDossier(risk, discipline);
      expect(dossier.operatorStanding).toBe('DISCIPLINED');
      expect(dossier.goldenRuleComplianceScore).toBe(100);
      expect(dossier.riskConcentrationScore).toBe(100);
      expect(dossier.criticalFindings.length).toBeGreaterThan(0);
      expect(dossier.preventiveDirectives.length).toBeGreaterThan(0);
      expect(dossier.executiveVerdict).toContain('institucional');
    });

    it('produces CRITICAL_TILT_RISK standing when severe tilt occurs', () => {
      const risk = analyzeHourlyRiskDistribution([
        { timestamp: '2026-09-19T11:00:00Z', severity: 'error' },
        { timestamp: '2026-09-19T11:10:00Z', severity: 'error' },
      ]);
      const discipline = auditTradingDisciplineAndSpreadCompliance([
        { timestamp: 1000, netSpreadPct: 0.1, cryptoAmount: 1000 },
        { timestamp: 2000, netSpreadPct: 0.1, cryptoAmount: 1000 },
        { timestamp: 3000, netSpreadPct: 0.1, cryptoAmount: 1000 },
      ]);

      const dossier = generateForensicDossier(risk, discipline);
      expect(dossier.operatorStanding).toBe('CRITICAL_TILT_RISK');
      expect(dossier.executiveVerdict).toContain('OPERADOR EN RIESGO');
      expect(dossier.preventiveDirectives).toEqual(
        expect.arrayContaining([
          expect.stringContaining('pausa mandatoria'),
          expect.stringContaining('Circuit Breaker'),
        ]),
      );
    });
  });
});
