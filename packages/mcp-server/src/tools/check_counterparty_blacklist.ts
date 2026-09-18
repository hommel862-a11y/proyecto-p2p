import {
  CheckCounterpartyBlacklistInputSchema,
  type CheckCounterpartyBlacklistInput,
} from '../schemas/index.js';

// Seeded known high-risk / reported fraud identifiers for deterministic verification
const INTERNAL_BLACKLIST_SEED: Array<{
  identifierType: 'CEDULA' | 'PHONE' | 'ACCOUNT_NUMBER' | 'BINANCE_ALIAS';
  identifierValue: string;
  counterpartyName: string;
  fraudCategory: 'TRIANGULATION_SCAM' | 'THIRD_PARTY_PAYER' | 'CHARGEBACK_ATTEMPT' | 'IDENTITY_THEFT';
  incidentNotes: string;
  riskLevel: 'CRITICAL' | 'HIGH';
  reportedAt: string;
}> = [
  {
    identifierType: 'CEDULA',
    identifierValue: 'V-28999888',
    counterpartyName: 'Pedro Fraude',
    fraudCategory: 'TRIANGULATION_SCAM',
    incidentNotes: 'Reportado por estafa de triangulación: comprador suplantó identidad de un comercio.',
    riskLevel: 'CRITICAL',
    reportedAt: '2026-08-15T10:00:00Z',
  },
  {
    identifierType: 'PHONE',
    identifierValue: '04141234567',
    counterpartyName: 'Carlos Estafa',
    fraudCategory: 'THIRD_PARTY_PAYER',
    incidentNotes: 'Paga desde cuentas bancarias de terceros no autorizadas en Binance.',
    riskLevel: 'HIGH',
    reportedAt: '2026-08-20T14:30:00Z',
  },
  {
    identifierType: 'ACCOUNT_NUMBER',
    identifierValue: '01020111223344556677',
    counterpartyName: 'Mula Financiera',
    fraudCategory: 'CHARGEBACK_ATTEMPT',
    incidentNotes: 'Cuenta con reclamo de desconocimiento de débito bancario.',
    riskLevel: 'CRITICAL',
    reportedAt: '2026-09-01T09:15:00Z',
  },
  {
    identifierType: 'BINANCE_ALIAS',
    identifierValue: 'ScamMaster99',
    counterpartyName: 'Unknown',
    fraudCategory: 'TRIANGULATION_SCAM',
    incidentNotes: 'Usuario suspendido por apelaciones fraudulentas reiteradas.',
    riskLevel: 'CRITICAL',
    reportedAt: '2026-09-05T18:00:00Z',
  },
];

export const checkCounterpartyBlacklistTool = {
  name: 'check_counterparty_blacklist',
  description:
    'Consulta la base de datos local y registros internos de cuentas, cédulas, teléfonos o alias reportados por estafas de triangulación o fraude. Si hay coincidencia, bloquea la transacción de inmediato.',
  inputSchema: CheckCounterpartyBlacklistInputSchema,
  execute: (input: CheckCounterpartyBlacklistInput) => {
    const cedulaClean = input.cedula?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const phoneClean = input.phone?.replace(/[^0-9]/g, '');
    const accountClean = input.accountNumber?.replace(/[^0-9]/g, '');
    const aliasClean = input.alias?.trim().toLowerCase();

    const matches = INTERNAL_BLACKLIST_SEED.filter((record) => {
      if (input.cedula && record.identifierType === 'CEDULA') {
        const recCed = record.identifierValue.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (recCed === cedulaClean || recCed.includes(cedulaClean || '')) return true;
      }
      if (input.phone && record.identifierType === 'PHONE') {
        const recPh = record.identifierValue.replace(/[^0-9]/g, '');
        if (recPh === phoneClean || (phoneClean && recPh.endsWith(phoneClean.slice(-7)))) return true;
      }
      if (input.accountNumber && record.identifierType === 'ACCOUNT_NUMBER') {
        const recAcc = record.identifierValue.replace(/[^0-9]/g, '');
        if (recAcc === accountClean) return true;
      }
      if (input.alias && record.identifierType === 'BINANCE_ALIAS') {
        if (record.identifierValue.toLowerCase() === aliasClean) return true;
      }
      return false;
    });

    const isFlagged = matches.length > 0;
    const highestRisk = isFlagged
      ? matches.some((m) => m.riskLevel === 'CRITICAL')
        ? 'CRITICAL'
        : 'HIGH'
      : 'CLEAN';

    return {
      isFlagged,
      riskLevel: highestRisk,
      decision: isFlagged ? 'IMMEDIATE_BLOCK_TRANSACTION' : 'CLEAN_TO_PROCEED',
      totalMatchesFound: matches.length,
      matchedRecords: matches.map((m) => ({
        matchedOn: m.identifierType,
        identifier: m.identifierValue,
        suspectName: m.counterpartyName,
        category: m.fraudCategory,
        notes: m.incidentNotes,
        reportedAt: m.reportedAt,
      })),
      auditTimestamp: new Date().toISOString(),
      actionRequired: isFlagged
        ? 'ALERTA ROJA: Detener de inmediato el envío de Pago Móvil o liberación de criptomonedas. Notificar a soporte y reportar en el libro contable.'
        : 'Contraparte limpia de coincidencias en la lista negra interna. Proceder con las precauciones habituales.',
    };
  },
};
