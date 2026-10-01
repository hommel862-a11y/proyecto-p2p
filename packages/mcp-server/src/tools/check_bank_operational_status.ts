import {
  CheckBankOperationalStatusInputSchema,
  type CheckBankOperationalStatusInput,
} from '../schemas/index.js';
import { unverifiedVerdict } from '../core/verdict.js';

export interface BankHealthDetail {
  bankCode: string;
  bankName: string;
  status: 'UNVERIFIED_OFFLINE';
  settlementLatencyMinutes: null;
  incidentType: 'UNKNOWN_NO_TELEMETRY';
  description: string;
  recommendedAction: 'VERIFY_WITH_BANK_STATEMENT';
}

/**
 * Display names only. The previous table also carried `baseLatency` per bank
 * (1.5, 0.8, 1.0, 1.2, 0.9, 0.5 minutes) which were invented constants, and a
 * dead branch `code === '0102' && false` that could never fire, so every bank
 * always reported `OPERATIONAL` with the advice "Todos los canales bancarios
 * y Pago Móvil operan con óptima liquidez y acreditación inmediata".
 *
 * That sentence is the dangerous part: it authorises continuing to advertise
 * payout rails that may be down, on the strength of a literal.
 */
const KNOWN_BANK_NAMES: Record<string, string> = {
  '0102': 'Banco de Venezuela (BDV)',
  '0134': 'Banesco Banco Universal',
  '0105': 'Mercantil Banco',
  '0108': 'BBVA Provincial',
  '0172': 'Bancamiga',
  '0191': 'Banco Nacional de Crédito (BNC)',
  '0114': 'Bancaribe',
  '0174': 'Banplus',
  PAGO_MOVIL: 'Suiche Pago Móvil Interbancario',
};

export const checkBankOperationalStatusTool = {
  name: 'check_bank_operational_status',
  description:
    'Consulta el estado operativo y las latencias de acreditación de plataformas bancarias venezolanas (Banesco, Mercantil, BDV, Provincial, Bancamiga, BNC, Bancaribe, Banplus, Pago Móvil). Sin telemetría bancaria configurada devuelve UNVERIFIED_OFFLINE para todos los códigos: no afirma que un canal esté operativo.',
  inputSchema: CheckBankOperationalStatusInputSchema,
  execute: (input: CheckBankOperationalStatusInput) => {
    const requestedCodes =
      input.bankCodes && input.bankCodes.length > 0
        ? input.bankCodes
        : ['0102', '0134', '0105', '0108', '0172', 'PAGO_MOVIL'];

    const details: BankHealthDetail[] = requestedCodes.map((code) => ({
      bankCode: code,
      bankName: KNOWN_BANK_NAMES[code] ?? `Banco Desconocido (${code})`,
      status: 'UNVERIFIED_OFFLINE',
      settlementLatencyMinutes: null,
      incidentType: 'UNKNOWN_NO_TELEMETRY',
      description:
        'Sin fuente de telemetría bancaria conectada. El estado real de este canal es desconocido para esta herramienta.',
      recommendedAction: 'VERIFY_WITH_BANK_STATEMENT',
    }));

    return unverifiedVerdict(
      {
        timestamp: new Date().toISOString(),
        networkStatus: null,
        pauseTradingDirective: null,
        affectedBanks: null,
        averageSettlementLatencyMinutes: null,
        bankDetails: details,
        operationalAdvice: null,
      },
      'NO_BANK_TELEMETRY',
      'bank interbank-clearing / Suiche telemetry source',
    );
  },
};
