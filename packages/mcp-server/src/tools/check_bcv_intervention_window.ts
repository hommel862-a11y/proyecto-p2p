import { predictBcvIntervention } from '../core/index.js';
import { CheckBcvInterventionWindowInputSchema, type CheckBcvInterventionWindowInput } from '../schemas/index.js';

export const checkBcvInterventionWindowTool = {
  name: 'check_bcv_intervention_window',
  description: 'Verifica la fase actual del ciclo de intervención cambiaria del BCV (09:00 - 13:00 VET) y estima probabilidad de inyección de divisas en la banca.',
  inputSchema: CheckBcvInterventionWindowInputSchema,
  execute: (input: CheckBcvInterventionWindowInput) => {
    const evalDate = input.testTimestamp ? new Date(input.testTimestamp) : new Date();
    const window = predictBcvIntervention(evalDate);

    const isInterventionActive = window.phase === 'INTERVENTION_ACTIVE';

    return {
      evaluatedTimestamp: evalDate.toISOString(),
      vetDayOfWeek: window.vetDayOfWeek,
      vetHour: window.vetHour,
      phase: window.phase,
      probabilityPct: window.probabilityPct,
      isInterventionActive,
      nextExpectedIntervention: window.nextExpectedIntervention,
      hoursUntilIntervention: window.hoursUntilIntervention,
      rationale: window.rationale,
      tradingDirectives: isInterventionActive
        ? 'INTERVENCIÓN EN CURSO: El BCV está colocando divisas. Esperar dip o cotizar spreads amplios ante compresión.'
        : window.phase === 'PRE_INTERVENTION_COMPRESSION'
          ? 'VENTANA PRE-INTERVENCIÓN: Expectativa de inyección. Acelerar venta de USDT en máximos antes de la apertura bancaria.'
          : window.phase === 'POST_INTERVENTION_REBOUND'
            ? 'VENTANA POST-INTERVENCIÓN: Divisas absorbidas por la banca. Prepararse para rebote del paralelo.'
            : 'MERCADO LIBRE: Flujo estándar sin influencia directa de subasta cambiaria.',
    };
  },
};
