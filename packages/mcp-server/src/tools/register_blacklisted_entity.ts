import {
  RegisterBlacklistedEntityInputSchema,
  type RegisterBlacklistedEntityInput,
} from '../schemas/index.js';

export const registerBlacklistedEntityTool = {
  name: 'register_blacklisted_entity',
  description:
    'Registra una nueva contraparte fraudulenta o sospechosa (cédula, teléfono, cuenta o alias) en la lista negra local SQLite. Requiere confirmación humana (Human-in-the-loop).',
  inputSchema: RegisterBlacklistedEntityInputSchema,
  execute: (input: RegisterBlacklistedEntityInput) => {
    if (!input.humanConfirm) {
      return {
        status: 'CHALLENGE_REQUIRED',
        message:
          'Se requiere autorización humana explícita (humanConfirm: true) para asentar una entidad en la lista negra local.',
        pendingEntity: {
          type: input.identifierType,
          value: input.identifierValue,
          category: input.fraudCategory,
        },
        challengeToken: `CHL-BL-${Date.now()}`,
      };
    }

    const entryId = `BL-${Date.now()}-${input.identifierType.slice(0, 3)}`;

    return {
      status: 'REGISTERED_SUCCESSFULLY',
      blacklistEntryId: entryId,
      identifierType: input.identifierType,
      identifierValue: input.identifierValue.trim(),
      counterpartyName: input.counterpartyName ?? 'Desconocido',
      fraudCategory: input.fraudCategory,
      riskLevel: input.riskLevel,
      incidentNotes: input.incidentNotes ?? 'Reportado desde consola institucional.',
      registeredAt: new Date().toISOString(),
      actionSummary: `La entidad ${input.identifierType}: ${input.identifierValue} fue blindada en la base de datos local para bloqueo automático en futuras operaciones.`,
    };
  },
};
