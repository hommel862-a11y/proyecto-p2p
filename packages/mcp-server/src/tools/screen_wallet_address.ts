import { ScreenWalletAddressInputSchema, type ScreenWalletAddressInput } from '../schemas/index.js';
import { unverifiedVerdict } from '../core/verdict.js';

/**
 * AML screening requires the sanctions feed (OFAC SDN, UN Consolidated List).
 *
 * The previous implementation derived `sanctionedMatch` from a substring test
 * on the address text — any address containing `dead` scored 95 and any
 * address not containing it scored 5. That is not screening. It is a
 * fabricated clearance for the overwhelming majority of inputs, presented to
 * the caller under the authority of an AML tool.
 *
 * Only address/network structure is determinable offline, so only that is
 * reported here. Risk stays `null` until a sanctions source is wired.
 */
export const screenWalletAddressTool = {
  name: 'screen_wallet_address',
  description:
    'Evalúa el riesgo AML on-chain de una dirección de billetera cripto (TRC20, ERC20, BEP20) para prevenir fondos congelados por hacks o mixers sancionados. Sin un feed de sanciones configurado devuelve UNVERIFIED y no debe usarse para aprobar ni rechazar una transferencia.',
  inputSchema: ScreenWalletAddressInputSchema,
  execute: (input: ScreenWalletAddressInput) => {
    const addr = input.address.trim();
    const network = input.network;

    // Structural checks only: these are facts about the string, not judgements
    // about the counterparty.
    const flags: string[] = [];

    if (addr.startsWith('T') && network !== 'TRC20') {
      flags.push('NETWORK_MISMATCH_TRON_ADDRESS_ON_EVM');
    }

    if (addr.startsWith('0x') && network === 'TRC20') {
      flags.push('NETWORK_MISMATCH_EVM_ADDRESS_ON_TRON');
    }

    if (addr.toLowerCase().includes('dead') || addr.toLowerCase().includes('000000')) {
      flags.push('BURN_OR_NULL_SENTINEL_PATTERN_UNVERIFIED');
    }

    if (input.expectedAmountUsdt && input.expectedAmountUsdt > 10000) {
      flags.push('HIGH_VALUE_TRANSACTION_DECLARED_BY_CALLER');
    }

    return unverifiedVerdict(
      {
        address: addr,
        network,
        declaredAmountUsdt: input.expectedAmountUsdt ?? null,
        structuralFlags: flags,
        riskScore: null,
        riskLevel: null,
        recommendation: null,
        sanctionedMatch: null,
        timestamp: new Date().toISOString(),
      },
      'NO_LIVE_SANCTIONS_FEED',
      'OFAC SDN + UN Consolidated List sanctions feed',
    );
  },
};