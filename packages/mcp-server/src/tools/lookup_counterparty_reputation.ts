import {
  LookupCounterpartyReputationInputSchema,
  type LookupCounterpartyReputationInput,
} from '../schemas/index.js';
import { unverifiedVerdict } from '../core/verdict.js';

/**
 * The previous implementation blacklisted anyone whose document ID contained
 * `99999`, ended in `000`, or whose phone ended in `0000`; everyone else
 * received `trustScore: 96`, `riskLevel: 'VERIFIED_CLEAN'` and
 * `recommendation: 'PROCEED_WITH_TRADE'`.
 *
 * It also invented a ZK blind hash with `Math.random()`, so the same
 * counterparty produced a different "cryptographic" identifier on every call,
 * and attached a hardcoded chargeback incident dated 2026-03-12 to anyone it
 * decided to blacklist.
 *
 * There is no federated mesh and no reputation ledger. `VERIFIED_CLEAN` and
 * `PROCEED_WITH_TRADE` were fabrications.
 */
export const lookupCounterpartyReputationTool = {
  name: 'lookup_counterparty_reputation',
  description:
    'Consulta la reputación y reportes de fraude de una contraparte en la red federada ZK antes de aceptar o procesar una orden P2P. Sin ledger de reputación conectado devuelve UNVERIFIED y no autoriza avanzar con la orden.',
  inputSchema: LookupCounterpartyReputationInputSchema,
  execute: (input: LookupCounterpartyReputationInput) => {
    const docId = input.documentId.trim().toUpperCase();

    return unverifiedVerdict(
      {
        documentId: docId,
        phoneNumberProvided: !!input.phoneNumber,
        bankAccountProvided: !!input.bankAccountNumber,
        blindHash: null,
        trustScore: null,
        isBlacklisted: null,
        riskLevel: null,
        historicalIncidents: null,
        recommendation: null,
        consultedAt: new Date().toISOString(),
      },
      'NO_COUNTERPARTY_LEDGER',
      'federated ZK reputation mesh / counterparty incident ledger',
    );
  },
};
