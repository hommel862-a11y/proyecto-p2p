import {
  LookupCounterpartyReputationInputSchema,
  type LookupCounterpartyReputationInput,
} from '../schemas/index.js';

export const lookupCounterpartyReputationTool = {
  name: 'lookup_counterparty_reputation',
  description:
    'Consulta la reputación y reportes de fraude de una contraparte en la red federada ZK antes de aceptar o procesar una orden P2P.',
  inputSchema: LookupCounterpartyReputationInputSchema,
  execute: (input: LookupCounterpartyReputationInput) => {
    const docId = input.documentId.trim().toUpperCase();
    const phone = input.phoneNumber?.trim();

    // Check against mock blacklist patterns
    const isMockBlacklisted =
      docId.includes('99999') || docId.endsWith('000') || (phone && phone.endsWith('0000'));

    const trustScore = isMockBlacklisted ? 12 : 96;
    const isBlacklisted = trustScore < 50;

    return {
      documentId: docId,
      blindHash: `zk_hash_${docId.slice(-4)}_${Math.random().toString(36).substring(7)}`,
      trustScore,
      isBlacklisted,
      riskLevel: isBlacklisted ? 'HIGH_RISK_FRAUD' : 'VERIFIED_CLEAN',
      historicalIncidents: isBlacklisted
        ? [
            {
              type: 'THIRD_PARTY_PAYMENT_CHARGEBACK',
              reportedAt: '2026-03-12',
              source: 'ZK_FEDERATED_MESH',
            },
          ]
        : [],
      recommendation: isBlacklisted ? 'ABORT_TRADE_REFUSE_COUNTERPARTY' : 'PROCEED_WITH_TRADE',
      consultedAt: new Date().toISOString(),
    };
  },
};
