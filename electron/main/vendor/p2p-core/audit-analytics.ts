/**
 * Pure Quantitative Domain Engine: Forensic Audit & Risk Analytics (Skill #44).
 * Interrogates SQLite operational logs and audit events to evaluate trading discipline,
 * Golden Rule compliance (net spread >= 0.50%), and 24-hour vulnerability windows.
 * 0 external framework dependencies.
 */

export interface ForensicAuditEvent {
  id?: string;
  timestamp: string | number;
  category?: string;
  action?: string;
  details?: string | Record<string, unknown>;
  severity?: string; // 'info' | 'warn' | 'error' | 'critical'
  createdAt?: number;
}

export interface HourlyRiskBucket {
  hour: number; // 0..23
  totalEvents: number;
  infoCount: number;
  warnCount: number;
  errorCount: number;
  criticalRiskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface HourlyRiskDistributionResult {
  totalEventsAnalyzed: number;
  hourlyBuckets: HourlyRiskBucket[];
  peakRiskHour: number; // 0..23
  peakRiskWindow: string; // e.g. "11:00 - 12:00"
  peakRiskScore: number;
  totalCriticalIncidents: number; // errors + warns
  criticalIncidentRatePct: number;
  highRiskHours: number[];
  recommendation: string;
}

export interface ForensicOperationRecord {
  id?: string;
  timestamp: string | number;
  side?: string;
  fiatAmount?: number;
  cryptoAmount?: number;
  price?: number;
  bank?: string;
  reference?: string;
  counterparty?: string;
  status?: string;
  netSpreadPct?: number;
  rawJson?: string;
  createdAt?: number;
  errorFree?: boolean;
}

export interface SpreadDisciplineResult {
  totalOperationsAnalyzed: number;
  compliantOperationsCount: number;
  nonCompliantOperationsCount: number;
  complianceRatePct: number;
  minSpreadThresholdPct: number;
  averageSpreadPct: number;
  volumeWeightedAverageSpreadPct: number;
  minObservedSpreadPct: number;
  maxObservedSpreadPct: number;
  tiltDetected: boolean;
  tiltSeverity: 'NONE' | 'LOW' | 'MODERATE' | 'SEVERE';
  tiltConsecutiveViolations: number;
  estimatedSacrificedProfitUsdt: number;
  summary: string;
}

export interface ForensicDossier {
  generatedAt: number;
  operatorStanding: 'DISCIPLINED' | 'MODERATE_DEVIATION' | 'CRITICAL_TILT_RISK';
  goldenRuleComplianceScore: number; // 0..100
  riskConcentrationScore: number; // 0..100
  hourlyRisk: HourlyRiskDistributionResult;
  disciplineAudit: SpreadDisciplineResult;
  criticalFindings: string[];
  preventiveDirectives: string[];
  executiveVerdict: string;
}

/**
 * Parses timestamp into a valid hour (0..23).
 */
function extractHourFromTimestamp(ts: string | number): number {
  try {
    const date = typeof ts === 'number' ? new Date(ts) : new Date(String(ts));
    const h = date.getHours();
    return Number.isFinite(h) && h >= 0 && h <= 23 ? h : 0;
  } catch {
    return 0;
  }
}

/**
 * Safely extracts netSpreadPct from an operation record or its rawJson metadata.
 */
function extractNetSpreadPct(op: ForensicOperationRecord): number {
  if (typeof op.netSpreadPct === 'number' && Number.isFinite(op.netSpreadPct)) {
    return op.netSpreadPct;
  }

  if (op.rawJson) {
    try {
      const parsed = typeof op.rawJson === 'string' ? JSON.parse(op.rawJson) : op.rawJson;
      if (parsed && typeof parsed === 'object') {
        const candidate =
          parsed.netSpreadPct ??
          parsed.spreadPct ??
          parsed.expectedNetSpreadPct ??
          parsed.spread;
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
          return candidate;
        }
      }
    } catch {
      // Fallback
    }
  }

  return 0;
}

/**
 * Computes trade volume in USDT for weighting.
 */
function extractVolumeUsdt(op: ForensicOperationRecord): number {
  if (typeof op.cryptoAmount === 'number' && Number.isFinite(op.cryptoAmount) && op.cryptoAmount > 0) {
    return op.cryptoAmount;
  }
  if (
    typeof op.fiatAmount === 'number' &&
    typeof op.price === 'number' &&
    op.price > 0 &&
    Number.isFinite(op.fiatAmount)
  ) {
    return op.fiatAmount / op.price;
  }
  return 0;
}

/**
 * Analyzes the 24-hour distribution of audit and security events, identifying
 * peak risk windows and incident rates.
 */
export function analyzeHourlyRiskDistribution(
  events: readonly ForensicAuditEvent[],
): HourlyRiskDistributionResult {
  const buckets: HourlyRiskBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    totalEvents: 0,
    infoCount: 0,
    warnCount: 0,
    errorCount: 0,
    criticalRiskScore: 0,
    riskLevel: 'LOW',
  }));

  let totalErrors = 0;
  let totalWarns = 0;

  for (const ev of events) {
    const rawTs = ev.createdAt || ev.timestamp;
    const hour = extractHourFromTimestamp(rawTs);
    const bucket = buckets[hour];
    bucket.totalEvents++;

    const sev = String(ev.severity || 'info').toLowerCase();
    if (sev === 'error' || sev === 'critical') {
      bucket.errorCount++;
      totalErrors++;
    } else if (sev === 'warn' || sev === 'warning') {
      bucket.warnCount++;
      totalWarns++;
    } else {
      bucket.infoCount++;
    }
  }

  const highRiskHours: number[] = [];
  let peakRiskHour = 0;
  let peakRiskScore = 0;

  for (let h = 0; h < 24; h++) {
    const b = buckets[h];
    // Score formula: error * 3.0 + warn * 1.5 + info * 0.2
    const score = Number((b.errorCount * 3.0 + b.warnCount * 1.5 + b.infoCount * 0.2).toFixed(2));
    b.criticalRiskScore = score;

    if (score >= 6.0 || b.errorCount >= 2) {
      b.riskLevel = 'CRITICAL';
      highRiskHours.push(h);
    } else if (score >= 3.0 || b.errorCount >= 1) {
      b.riskLevel = 'HIGH';
      highRiskHours.push(h);
    } else if (score >= 1.0 || b.warnCount >= 1) {
      b.riskLevel = 'MEDIUM';
    } else {
      b.riskLevel = 'LOW';
    }

    if (score > peakRiskScore) {
      peakRiskScore = score;
      peakRiskHour = h;
    }
  }

  const totalEventsAnalyzed = events.length;
  const totalCriticalIncidents = totalErrors + totalWarns;
  const criticalIncidentRatePct =
    totalEventsAnalyzed > 0
      ? Number(((totalCriticalIncidents / totalEventsAnalyzed) * 100).toFixed(2))
      : 0;

  const nextHour = (peakRiskHour + 1) % 24;
  const peakRiskWindow = `${String(peakRiskHour).padStart(2, '0')}:00 - ${String(nextHour).padStart(2, '0')}:00`;

  let recommendation = 'Distribución horaria estable sin concentración anómala de riesgo.';
  if (highRiskHours.length > 0) {
    recommendation = `Precaución máxima en ventana ${peakRiskWindow} (${highRiskHours.length} horas de riesgo elevado detectadas). Se sugiere reducir exposición o aumentar spread protector.`;
  }

  return {
    totalEventsAnalyzed,
    hourlyBuckets: buckets,
    peakRiskHour,
    peakRiskWindow,
    peakRiskScore,
    totalCriticalIncidents,
    criticalIncidentRatePct,
    highRiskHours,
    recommendation,
  };
}

/**
 * Audits trading discipline and adherence to the Golden Rule (net spread >= minSpreadThresholdPct).
 * Detects emotional revenge trading ("tilt") via consecutive violations or margin degradation.
 */
export function auditTradingDisciplineAndSpreadCompliance(
  operations: readonly ForensicOperationRecord[],
  minSpreadThresholdPct = 0.50,
): SpreadDisciplineResult {
  if (operations.length === 0) {
    return {
      totalOperationsAnalyzed: 0,
      compliantOperationsCount: 0,
      nonCompliantOperationsCount: 0,
      complianceRatePct: 100,
      minSpreadThresholdPct,
      averageSpreadPct: 0,
      volumeWeightedAverageSpreadPct: 0,
      minObservedSpreadPct: 0,
      maxObservedSpreadPct: 0,
      tiltDetected: false,
      tiltSeverity: 'NONE',
      tiltConsecutiveViolations: 0,
      estimatedSacrificedProfitUsdt: 0,
      summary: 'Sin operaciones registradas para auditar.',
    };
  }

  let compliantCount = 0;
  let nonCompliantCount = 0;
  let totalSpread = 0;
  let totalVolumeWeightedSpread = 0;
  let totalVolumeUsdt = 0;
  let minObserved = Number.POSITIVE_INFINITY;
  let maxObserved = Number.NEGATIVE_INFINITY;
  let sacrificedProfitUsdt = 0;

  let currentRunViolations = 0;
  let maxConsecutiveViolations = 0;

  // Chronological traversal: if operations are sorted desc (newest first), reverse to evaluate timeline
  const chronological = [...operations].sort((a, b) => {
    const tA = Number(a.createdAt || (typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime()) || 0);
    const tB = Number(b.createdAt || (typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime()) || 0);
    return tA - tB;
  });

  for (const op of chronological) {
    const spread = extractNetSpreadPct(op);
    const volume = extractVolumeUsdt(op);

    totalSpread += spread;
    totalVolumeUsdt += volume;
    totalVolumeWeightedSpread += spread * volume;

    if (spread < minObserved) minObserved = spread;
    if (spread > maxObserved) maxObserved = spread;

    if (spread >= minSpreadThresholdPct) {
      compliantCount++;
      currentRunViolations = 0;
    } else {
      nonCompliantCount++;
      currentRunViolations++;
      if (currentRunViolations > maxConsecutiveViolations) {
        maxConsecutiveViolations = currentRunViolations;
      }
      const shortfall = minSpreadThresholdPct - spread;
      if (volume > 0 && shortfall > 0) {
        sacrificedProfitUsdt += (shortfall / 100) * volume;
      }
    }
  }

  const totalOps = operations.length;
  const complianceRatePct = Number(((compliantCount / totalOps) * 100).toFixed(2));
  const avgSpread = Number((totalSpread / totalOps).toFixed(2));
  const vwas =
    totalVolumeUsdt > 0
      ? Number((totalVolumeWeightedSpread / totalVolumeUsdt).toFixed(2))
      : avgSpread;

  // Tilt classification
  let tiltSeverity: 'NONE' | 'LOW' | 'MODERATE' | 'SEVERE' = 'NONE';
  let tiltDetected = false;

  if (maxConsecutiveViolations >= 3 || complianceRatePct < 60) {
    tiltSeverity = 'SEVERE';
    tiltDetected = true;
  } else if (maxConsecutiveViolations >= 2 || complianceRatePct < 85) {
    tiltSeverity = 'MODERATE';
    tiltDetected = true;
  } else if (maxConsecutiveViolations === 1 && complianceRatePct < 95) {
    tiltSeverity = 'LOW';
    tiltDetected = true;
  }

  let summary = `Cumplimiento de la Regla de Oro al ${complianceRatePct}% (VWAS: +${vwas}%). Operatoria disciplinada.`;
  if (tiltSeverity === 'SEVERE') {
    summary = `¡ALERTA DE TILT SEVERO! Racha máxima de ${maxConsecutiveViolations} operaciones por debajo del spread mínimo (${minSpreadThresholdPct}%). PnL sacrificado estimado: $${sacrificedProfitUsdt.toFixed(2)} USDT.`;
  } else if (tiltSeverity === 'MODERATE') {
    summary = `Desviación moderada de disciplina detectada (${complianceRatePct}% de cumplimiento, racha de ${maxConsecutiveViolations} desvíos).`;
  }

  return {
    totalOperationsAnalyzed: totalOps,
    compliantOperationsCount: compliantCount,
    nonCompliantOperationsCount: nonCompliantCount,
    complianceRatePct,
    minSpreadThresholdPct,
    averageSpreadPct: avgSpread,
    volumeWeightedAverageSpreadPct: vwas,
    minObservedSpreadPct: Number.isFinite(minObserved) ? Number(minObserved.toFixed(2)) : 0,
    maxObservedSpreadPct: Number.isFinite(maxObserved) ? Number(maxObserved.toFixed(2)) : 0,
    tiltDetected,
    tiltSeverity,
    tiltConsecutiveViolations: maxConsecutiveViolations,
    estimatedSacrificedProfitUsdt: Number(sacrificedProfitUsdt.toFixed(2)),
    summary,
  };
}

/**
 * Synthesizes hourly risk distribution and spread compliance into a comprehensive
 * forensic dossier with institutional rating and actionable recommendations.
 */
export function generateForensicDossier(
  hourlyRisk: HourlyRiskDistributionResult,
  disciplineAudit: SpreadDisciplineResult,
): ForensicDossier {
  const criticalFindings: string[] = [];
  const preventiveDirectives: string[] = [];

  // Standing calculation
  let operatorStanding: 'DISCIPLINED' | 'MODERATE_DEVIATION' | 'CRITICAL_TILT_RISK' =
    'DISCIPLINED';

  if (
    disciplineAudit.complianceRatePct < 80 ||
    disciplineAudit.tiltSeverity === 'SEVERE'
  ) {
    operatorStanding = 'CRITICAL_TILT_RISK';
  } else if (
    disciplineAudit.complianceRatePct < 95 ||
    disciplineAudit.tiltSeverity === 'MODERATE' ||
    hourlyRisk.highRiskHours.length >= 3
  ) {
    operatorStanding = 'MODERATE_DEVIATION';
  }

  // Findings
  if (disciplineAudit.complianceRatePct >= 95) {
    criticalFindings.push(
      `Excelente apego a la Regla de Oro: ${disciplineAudit.complianceRatePct}% de las operaciones cumplieron con el spread neto >= ${disciplineAudit.minSpreadThresholdPct}%.`,
    );
  } else {
    criticalFindings.push(
      `Infracción de margen mínimo en ${disciplineAudit.nonCompliantOperationsCount} operaciones (${(100 - disciplineAudit.complianceRatePct).toFixed(1)}% de desvío). Lucro cesante estimado: $${disciplineAudit.estimatedSacrificedProfitUsdt} USDT.`,
    );
  }

  if (disciplineAudit.tiltDetected) {
    criticalFindings.push(
      `Patrón de indisciplina / tilt clasificado como ${disciplineAudit.tiltSeverity} con hasta ${disciplineAudit.tiltConsecutiveViolations} transacciones deficientes consecutivas.`,
    );
  }

  if (hourlyRisk.highRiskHours.length > 0) {
    criticalFindings.push(
      `Concentración de riesgo en ventana crítica ${hourlyRisk.peakRiskWindow} con un puntaje de riesgo de ${hourlyRisk.peakRiskScore} (${hourlyRisk.totalCriticalIncidents} incidentes/alertas).`,
    );
  } else {
    criticalFindings.push('Distribución uniforme de seguridad sin horarios críticos anómalos.');
  }

  // Preventive directives
  if (operatorStanding === 'CRITICAL_TILT_RISK') {
    preventiveDirectives.push('Activar pausa mandatoria de 60 minutos en la mesa antes de tomar nuevas órdenes.');
    preventiveDirectives.push('Bloquear órdenes que no alcancen spread neto de 0.50% mediante Circuit Breaker.');
  } else if (operatorStanding === 'MODERATE_DEVIATION') {
    preventiveDirectives.push('Ajustar cotizaciones en ventana pico para incorporar prima de riesgo bancario (+0.25%).');
    preventiveDirectives.push('Verificar comisiones bancarias acumuladas que erosionan el margen neto.');
  } else {
    preventiveDirectives.push('Mantener el estándar disciplinario actual y sostener el libro de órdenes como Maker.');
  }

  const goldenRuleComplianceScore = Math.round(disciplineAudit.complianceRatePct);
  // Risk concentration score: lower incident rate and fewer high risk hours means better score
  const riskConcentrationScore = Math.max(
    0,
    Math.min(100, Math.round(100 - hourlyRisk.criticalIncidentRatePct * 1.5 - hourlyRisk.highRiskHours.length * 5)),
  );

  let executiveVerdict = 'Operador apto con grado de disciplina institucional.';
  if (operatorStanding === 'CRITICAL_TILT_RISK') {
    executiveVerdict = 'OPERADOR EN RIESGO: Desviación sistemática de márgenes y susceptibilidad a tilt. Requiere contramedidas de inmediato.';
  } else if (operatorStanding === 'MODERATE_DEVIATION') {
    executiveVerdict = 'DESVIACIÓN MODERADA: Apego aceptable pero con vulnerabilidad en horarios pico y margen erosionado.';
  }

  return {
    generatedAt: Date.now(),
    operatorStanding,
    goldenRuleComplianceScore,
    riskConcentrationScore,
    hourlyRisk,
    disciplineAudit,
    criticalFindings,
    preventiveDirectives,
    executiveVerdict,
  };
}
