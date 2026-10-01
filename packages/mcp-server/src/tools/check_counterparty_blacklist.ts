import {
  CheckCounterpartyBlacklistInputSchema,
  type CheckCounterpartyBlacklistInput,
} from '../schemas/index.js';
import { unverifiedVerdict, type VerdictProvenance } from '../core/verdict.js';

/**
 * These are SYNTHETIC TEST FIXTURES, not real fraud reports.
 *
 * The previous version presented this array as `INTERNAL_BLACKLIST_SEED` —
 * "seeded known high-risk / reported fraud identifiers" — with invented
 * people named "Pedro Fraude", "Carlos Estafa" and "Mula Financiera", hardcoded
 * `reportedAt` timestamps, and incident notes written as if a real victim had
 * filed them. Nothing in this repository has ever reported these accounts.
 *
 * The array is retained only so the matching logic stays exercised, and it is
 * now labelled honestly and carries provenance. A caller can therefore tell a
 * fixture match from a real one.
 *
 * Two matching bugs are also fixed below:
 *  - `recCed.includes(cedulaClean || '')` returns true for EVERY seed record
 *    whenever the input cédula contains no alphanumeric characters, because
 *    `'abc'.includes('')` is true. A cédula of `---` flagged every record.
 *  - `recPh.endsWith(phoneClean.slice(-7))` matched on as little as one digit.
 */
type BlacklistRecord = {
  identifierType: 'CEDULA' | 'PHONE' | 'ACCOUNT_NUMBER' | 'BINANCE_ALIAS';
  identifierValue: string;
  counterpartyName: string;
  fraudCategory:
    | 'TRIANGULATION_SCAM'
    | 'THIRD_PARTY_PAYER'
    | 'CHARGEBACK_ATTEMPT'
    | 'IDENTITY_THEFT';
  incidentNotes: string;
  riskLevel: 'CRITICAL' | 'HIGH';
  reportedAt: string | null;
};

const SAMPLE_RECORD_FIXTURES: BlacklistRecord[] = [
  {
    identifierType: 'CEDULA',
    identifierValue: 'V-28999888',
    counterpartyName: 'FIXTURE-SUBASTAQUE',
    fraudCategory: 'TRIANGULATION_SCAM',
    incidentNotes:
      'FIXTURE: escenario sintético de estafa de triangulación. No es un reporte real.',
    riskLevel: 'CRITICAL',
    reportedAt: null,
  },
  {
    identifierType: 'PHONE',
    identifierValue: '04141234567',
    counterpartyName: 'FIXTURE-PAGADOR-TERCERO',
    fraudCategory: 'THIRD_PARTY_PAYER',
    incidentNotes: 'FIXTURE: escenario sintético de pago de tercero. No es un reporte real.',
    riskLevel: 'HIGH',
    reportedAt: null,
  },
  {
    identifierType: 'ACCOUNT_NUMBER',
    identifierValue: '01020111223344556677',
    counterpartyName: 'FIXTURE-CUENTA-CARGO',
    fraudCategory: 'CHARGEBACK_ATTEMPT',
    incidentNotes: 'FIXTURE: escenario sintético de reclamo. No es un reporte real.',
    riskLevel: 'CRITICAL',
    reportedAt: null,
  },
  {
    identifierType: 'BINANCE_ALIAS',
    identifierValue: 'FIXTUREALIAS99',
    counterpartyName: 'FIXTURE-ALIAS',
    fraudCategory: 'TRIANGULATION_SCAM',
    incidentNotes: 'FIXTURE: escenario sintético de alias. No es un reporte real.',
    riskLevel: 'CRITICAL',
    reportedAt: null,
  },
];

/** Provenance of the record store currently in use. */
const ACTIVE_STORE_PROVENANCE: VerdictProvenance = {
  source: 'INTERNAL_SAMPLE_FIXTURES',
  observedAt: null,
  sourceRef: 'packages/mcp-server/src/tools/check_counterparty_blacklist.ts',
};

const ALPHANUM = /[^a-zA-Z0-9]/g;
const DIGITS = /[^0-9]/g;

/** Normalises then requires a non-empty result, so `---` never matches all. */
function normalize(value: string | undefined, pattern: RegExp): string | null {
  if (!value) return null;
  const cleaned = value.replace(pattern, '').toLowerCase();
  return cleaned.length > 0 ? cleaned : null;
}

export const checkCounterpartyBlacklistTool = {
  name: 'check_counterparty_blacklist',
  description:
    'Consulta la lista interna de entidades reportadas por fraude (triangulación, pago de terceros, cargo no reconocido). Sin una lista cargada desde la base de datos real devuelve UNVERIFIED: la ausencia de coincidencia NO habilita continuar.',
  inputSchema: CheckCounterpartyBlacklistInputSchema,
  execute: (input: CheckCounterpartyBlacklistInput) => {
    const cedulaClean = normalize(input.cedula, ALPHANUM);
    const phoneClean = normalize(input.phone, DIGITS);
    const accountClean = normalize(input.accountNumber, DIGITS);
    const aliasClean = input.alias?.trim().toLowerCase() || null;

    const matches = SAMPLE_RECORD_FIXTURES.filter((record) => {
      if (cedulaClean && record.identifierType === 'CEDULA') {
        const rec = record.identifierValue.replace(ALPHANUM, '').toLowerCase();
        if (rec === cedulaClean) return true;
      }
      if (phoneClean && record.identifierType === 'PHONE') {
        const rec = record.identifierValue.replace(DIGITS, '');
        // Require at least the last 7 significant digits before matching.
        if (phoneClean.length >= 7 && rec.endsWith(phoneClean.slice(-7))) return true;
      }
      if (accountClean && record.identifierType === 'ACCOUNT_NUMBER') {
        const rec = record.identifierValue.replace(DIGITS, '');
        if (rec === accountClean) return true;
      }
      if (aliasClean && record.identifierType === 'BINANCE_ALIAS') {
        if (record.identifierValue.toLowerCase() === aliasClean) return true;
      }
      return false;
    });

    if (matches.length === 0) {
      return unverifiedVerdict(
        {
          isFlagged: null,
          riskLevel: null,
          totalMatchesFound: 0,
          matchedRecords: [],
          actionRequired: null,
          blockDecision: null,
          auditTimestamp: new Date().toISOString(),
        },
        'NO_COUNTERPARTY_LEDGER',
        'populated counterparty blacklist from the local database',
      );
    }

    // A match against the fixture store is reported, but flagged as fixture
    // provenance so it can never be mistaken for an authoritative record.
    const isFixture = ACTIVE_STORE_PROVENANCE.source === 'INTERNAL_SAMPLE_FIXTURES';

    return {
      verdict: isFixture ? ('UNVERIFIED' as const) : ('MATCH' as const),
      verdictReason: isFixture
        ? ('NO_COUNTERPARTY_LEDGER' as const)
        : ('NO_LIVE_SANCTIONS_FEED' as const),
      expectedSource: 'populated counterparty blacklist from the local database',
      actionable: false,
      isFlagged: isFixture ? null : true,
      riskLevel: isFixture ? null : matches.some((m) => m.riskLevel === 'CRITICAL') ? 'CRITICAL' : 'HIGH',
      blockDecision: null,
      totalMatchesFound: matches.length,
      matchedRecords: matches.map((m) => ({
        matchedOn: m.identifierType,
        identifier: m.identifierValue,
        suspectName: m.counterpartyName,
        category: m.fraudCategory,
        notes: m.incidentNotes,
        reportedAt: m.reportedAt,
        isSampleFixture: true,
      })),
      provenance: ACTIVE_STORE_PROVENANCE,
      auditTimestamp: new Date().toISOString(),
      actionRequired:
        'Las coincidencias provienen de fixtures de prueba, no de reportes reales. No bloquees una transacción por este resultado; cargá la lista real desde la base de datos.',
    };
  },
};