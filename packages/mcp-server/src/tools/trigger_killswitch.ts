import { TriggerKillswitchInputSchema, type TriggerKillswitchInput } from '../schemas/index.js';
import { confirmationManager } from '../policy/permissions.js';

let sharedKillswitchTriggered = false;

export function isKillswitchActive(): boolean {
  return sharedKillswitchTriggered;
}

export function resetKillswitchForTesting(): void {
  sharedKillswitchTriggered = false;
}

export const triggerKillswitchTool = {
  name: 'trigger_killswitch',
  description: 'Detiene inmediatamente todas las operaciones y alertas del sistema. Requiere confirmación humana obligatoria.',
  inputSchema: TriggerKillswitchInputSchema,
  execute: (input: TriggerKillswitchInput) => {
    if (!input.humanConfirm) {
      const challengeToken = confirmationManager.generateChallengeToken('trigger_killswitch', {
        reason: input.reason,
        source: input.source,
      });

      return {
        triggered: false,
        requiresHumanConfirmation: true,
        challengeToken,
        message: 'Acción crítica protegida. Para confirmar la activación del Kill-Switch, reenvía la llamada con humanConfirm: true y el challengeToken provisto.',
      };
    }

    sharedKillswitchTriggered = true;

    return {
      triggered: true,
      timestamp: Date.now(),
      reason: input.reason,
      source: input.source,
      verdict: 'ALL_OPERATIONS_FROZEN_SUCCESSFULLY',
    };
  },
};
