import { ToggleAdStatusInputSchema, type ToggleAdStatusInput } from '../schemas/index.js';

export const toggleAdStatusTool = {
  name: 'toggle_ad_status',
  description:
    'Modifica el estado de un anuncio P2P (PAUSE, RESUME, CLOSE) disparado por circuit breakers institucionales (saturación de cuenta SUDEBAN, intervención BCV, killswitch) o por intervención manual.',
  inputSchema: ToggleAdStatusInputSchema,
  execute: (input: ToggleAdStatusInput) => {
    const { adId, exchange, action, reason, notes, humanConfirm = true } = input;

    if (!humanConfirm && action === 'CLOSE') {
      return {
        success: false,
        adId,
        error: 'El cierre definitivo de un anuncio requiere confirmación humana (Human-in-the-loop).',
      };
    }

    const stateMap = {
      PAUSE: 'PAUSED',
      RESUME: 'ACTIVE',
      CLOSE: 'CLOSED',
    };

    return {
      success: true,
      adId,
      exchange,
      previousAction: action,
      currentStatus: stateMap[action],
      triggerReason: reason,
      notes: notes ?? null,
      timestamp: new Date().toISOString(),
      actionSummary: `Anuncio ${adId} en ${exchange} conmutado a ${stateMap[action]} debido a ${reason}.`,
    };
  },
};
