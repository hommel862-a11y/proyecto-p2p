/**
 * Pre-Flight Operator Discipline & Anti-Tilt Circuit Breaker.
 * Framework-agnostic pure domain logic.
 * Enforces systematic risk screening, SUDEBAN anti-saturation checks,
 * zero third-party compliance, and emotional tilt control before opening a P2P session.
 */

export type MentalState = 'OPTIMAL' | 'ALERT' | 'TIRED' | 'TILTED_STRESSED';

export type PreflightStatus = 'CLEARED' | 'WARNING' | 'HALTED_BLOCKED';

export interface PreflightSessionInput {
  bankSaturationPct: number; // e.g. 65 for 65% of daily bank transaction limit used
  strictNoThirdPartyAcknowledged: boolean;
  telegramSentinelActive: boolean;
  dailyLossLimitUsd: number; // Max daily loss allowed before killswitch
  mentalState: MentalState;
  unresolvedDisputesCount: number;
}

export interface ChecklistVerificationItem {
  id: string;
  label: string;
  passed: boolean;
  severity: 'CRITICAL' | 'IMPORTANT' | 'INFO';
  detail: string;
}

export interface PreflightEvaluationResult {
  status: PreflightStatus;
  canTrade: boolean;
  summaryTitle: string;
  summaryMessage: string;
  items: ChecklistVerificationItem[];
  recommendedMaxSingleTicketUsdt: number;
  antiTiltCooloffMinutesRequired: number;
  sessionToken: string;
  evaluatedAt: number;
}

/**
 * Evaluates the 5 critical pre-flight conditions to clear or restrict a trading session.
 */
export function evaluatePreflightDiscipline(
  input: PreflightSessionInput
): PreflightEvaluationResult {
  const items: ChecklistVerificationItem[] = [];
  let isHalted = false;
  let hasWarning = false;
  let cooloffMinutes = 0;
  let maxTicket = 1000; // standard cap

  // 1. Zero Third-Party Policy Check (Absolute Legal Blocker)
  const noThirdPartyOk = input.strictNoThirdPartyAcknowledged === true;
  items.push({
    id: 'NO_THIRD_PARTY',
    label: 'Política Estricta Cero Terceros',
    passed: noThirdPartyOk,
    severity: 'CRITICAL',
    detail: noThirdPartyOk
      ? 'Aceptado: Únicamente se liberan fondos con titularidad verificada.'
      : 'BLOQUEANTE: Riesgo penal por estafa triangular. Debes confirmar la política anti-terceros.',
  });
  if (!noThirdPartyOk) isHalted = true;

  // 2. Bank Account Saturation Check (SUDEBAN freeze prevention)
  const bankOk = input.bankSaturationPct < 90;
  const bankWarning = input.bankSaturationPct >= 75 && input.bankSaturationPct < 90;
  items.push({
    id: 'BANK_SATURATION',
    label: 'Saturación Bancaria (Prevención SUDEBAN)',
    passed: bankOk,
    severity: input.bankSaturationPct >= 90 ? 'CRITICAL' : 'IMPORTANT',
    detail:
      input.bankSaturationPct >= 90
        ? `BLOQUEANTE: Cuentas al ${input.bankSaturationPct}% de capacidad diaria. Riesgo inminente de congelamiento.`
        : bankWarning
        ? `Alerta: Cuentas al ${input.bankSaturationPct}%. Rota cuentas o usa brackets más altos.`
        : `Normal: Cuentas al ${input.bankSaturationPct}% del umbral diario.`,
  });
  if (input.bankSaturationPct >= 90) isHalted = true;
  else if (bankWarning) hasWarning = true;

  // 3. Unresolved Disputes Check
  const disputesOk = input.unresolvedDisputesCount === 0;
  items.push({
    id: 'DISPUTES_COUNT',
    label: 'Apelaciones Abiertas',
    passed: disputesOk,
    severity: 'CRITICAL',
    detail: disputesOk
      ? '0 disputas activas.'
      : `BLOQUEANTE: Hay ${input.unresolvedDisputesCount} apelación(es) abierta(s). Resolvé antes de abrir más capital.`,
  });
  if (!disputesOk) isHalted = true;

  // 4. Mental State & Tilt Guard
  const mentalOk = input.mentalState === 'OPTIMAL' || input.mentalState === 'ALERT';
  items.push({
    id: 'MENTAL_STATE',
    label: 'Estado Psicológico & Anti-Tilt',
    passed: mentalOk,
    severity: input.mentalState === 'TILTED_STRESSED' ? 'CRITICAL' : 'IMPORTANT',
    detail:
      input.mentalState === 'TILTED_STRESSED'
        ? 'BLOQUEANTE: Modo Tilt detectado (frustración o revancha). Requiere pausa de 30 minutos.'
        : input.mentalState === 'TIRED'
        ? 'Precaución: Fatiga operativa. Se reduce el ticket máximo por orden al 50%.'
        : 'Óptimo: Enfoque y disciplina confirmados.',
  });
  if (input.mentalState === 'TILTED_STRESSED') {
    isHalted = true;
    cooloffMinutes = 30;
  } else if (input.mentalState === 'TIRED') {
    hasWarning = true;
    maxTicket = 300;
  }

  // 5. Telegram Sentinel & Loss Limit Check
  const sentinelOk = input.telegramSentinelActive === true;
  items.push({
    id: 'SENTINEL_MONITOR',
    label: 'Monitoreo de Notificaciones',
    passed: sentinelOk,
    severity: 'IMPORTANT',
    detail: sentinelOk
      ? 'Centinela de alertas activo.'
      : 'Sin centinela remoto: Mantén la aplicación abierta en pantalla.',
  });
  if (!sentinelOk) hasWarning = true;

  // 6. Stop-Loss Configuration
  const lossLimitOk = input.dailyLossLimitUsd > 0;
  items.push({
    id: 'STOP_LOSS_SET',
    label: 'Límite de Pérdida Diaria Configurado',
    passed: lossLimitOk,
    severity: 'IMPORTANT',
    detail: lossLimitOk
      ? `Stop-loss diario fijado en $${input.dailyLossLimitUsd} USD.`
      : 'Recomendación: Establecé un stop-loss máximo diario para evitar descapitalización.',
  });
  if (!lossLimitOk) hasWarning = true;

  // Final Assessment
  let status: PreflightStatus = 'CLEARED';
  let summaryTitle = '🛡️ SESIÓN AUTORIZADA (BLINDADA)';
  let summaryMessage =
    'Protocolo de disciplina superado. Cuentas despejadas, regla anti-terceros vigente y control de riesgo activo.';

  if (isHalted) {
    status = 'HALTED_BLOCKED';
    summaryTitle = '⛔ SESIÓN BLOQUEADA POR RIESGO';
    summaryMessage =
      'Se detectaron condiciones críticas de riesgo. Resuelve los bloqueos antes de iniciar operaciones.';
  } else if (hasWarning) {
    status = 'WARNING';
    summaryTitle = '⚠️ SESIÓN AUTORIZADA CON PRECAUCIÓN';
    summaryMessage =
      'Operativa habilitada bajo parámetros restringidos. Vigila la saturación bancaria y el tamaño de los tickets.';
  }

  const sessionToken = `AUTH-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

  return {
    status,
    canTrade: !isHalted,
    summaryTitle,
    summaryMessage,
    items,
    recommendedMaxSingleTicketUsdt: isHalted ? 0 : maxTicket,
    antiTiltCooloffMinutesRequired: cooloffMinutes,
    sessionToken,
    evaluatedAt: Date.now(),
  };
}
