import { predictBcvIntervention } from '../core/index.js';
import {
  CheckBcvInterventionWindowInputSchema,
  type CheckBcvInterventionWindowInput,
} from '../schemas/index.js';

export const checkBcvInterventionWindowTool = {
  name: 'check_bcv_intervention_window',
  description:
    'Indica si el momento actual cae dentro de la ventana horaria programada de subasta cambiaria del BCV (09:00 - 13:00 VET, lunes y jueves). Es una lectura de calendario: no estima probabilidad de inyección de divisas, porque no hay modelo ni histórico detrás de esa cifra.',
  inputSchema: CheckBcvInterventionWindowInputSchema,
  execute: (input: CheckBcvInterventionWindowInput) => {
    const evalDate = input.testTimestamp ? new Date(input.testTimestamp) : new Date();
    const window = predictBcvIntervention(evalDate);

    // "Inside the scheduled window" is a calendar fact. It is NOT evidence that
    // the BCV placed any currency today, so it is named accordingly and never
    // treated as an actionable signal.
    const insideScheduledWindow = window.phase === 'INTERVENTION_ACTIVE';

    return {
      evaluatedTimestamp: evalDate.toISOString(),
      vetDayOfWeek: window.vetDayOfWeek,
      vetHour: window.vetHour,
      phase: window.phase,
      probabilityPct: window.probabilityPct,
      probabilityBasis: window.probabilityBasis,
      isInterventionActive: insideScheduledWindow,
      isVerifiedIntervention: false,
      nextExpectedIntervention: window.nextExpectedIntervention,
      hoursUntilIntervention: window.hoursUntilIntervention,
      rationale: window.rationale,
      actionable: window.actionable,
      tradingDirectives: insideScheduledWindow
        ? 'VENTANA DE SUBASTA PROGRAMADA: el reloj cae dentro del horario habitual de subasta. No hay verificación de que el BCV haya colocado divisas hoy; no actúe sobre esta ventana por sí sola.'
        : window.phase === 'PRE_INTERVENTION_COMPRESSION'
          ? 'VENTANA PRE-SUBASTA PROGRAMADA: proximity horaria a la próxima subasta del calendario. No es una señal de intervención forthcoming.'
          : window.phase === 'POST_INTERVENTION_REBOUND'
            ? 'VENTANA POST-SUBASTA PROGRAMADA: han pasado las horas habituales de subasta. No implica comportamiento observado del paralelo.'
            : 'FUERA DE VENTANAS DE SUBASTA: horario calendario sin subasta programada.',
    };
  },
};