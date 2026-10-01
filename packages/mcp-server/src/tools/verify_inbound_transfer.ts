import {
  VerifyInboundTransferInputSchema,
  type VerifyInboundTransferInput,
} from '../schemas/index.js';
import { unverifiedVerdict } from '../core/verdict.js';

/**
 * This is the highest-consequence fabricated verdict in the toolset.
 *
 * The previous implementation treated any reference of four or more characters
 * as an exact bank match and returned:
 *   status: 'MATCH_FOUND_VERIFIED'
 *   bankResponseCode: '00'
 *   recommendation: 'SAFE_TO_RELEASE_CRYPTO'
 *   reconciledInMs: 142
 *
 * `bankResponseCode: '00'` asserted that a bank answered and returned the
 * approval code. No bank was ever contacted. `SAFE_TO_RELEASE_CRYPTO` then
 * instructs the operator to hand over the purchased crypto against a
 * fabricated confirmation — which is precisely the third-party-payment and
 * fake-receipt attack this whole feature exists to stop.
 *
 * `senderCedulaValidated: !!input.senderCedula` compounds it: it "validated"
 * an identity by checking that a non-empty string was typed.
 */
export const verifyInboundTransferTool = {
  name: 'verify_inbound_transfer',
  description:
    'Concilia una transferencia o PagoMóvil entrante verificando referencia, banco emisor y monto. Sin conexión a la red de compensación bancaria devuelve UNVERIFIED y NUNCA autoriza liberar cripto: la referencia debe confirmarse contra un estado de cuenta real.',
  inputSchema: VerifyInboundTransferInputSchema,
  execute: (input: VerifyInboundTransferInput) => {
    const ref = input.referenceNumber.trim();

    return unverifiedVerdict(
      {
        referenceNumber: ref,
        amountVes: input.amountVes,
        bankCode: input.bankCode,
        status: null,
        reconciledInMs: null,
        bankResponseCode: null,
        bankContacted: false,
        senderCedulaProvided: !!input.senderCedula,
        senderPhoneProvided: !!input.senderPhone,
        senderIdentityVerified: null,
        ledgerReceiptId: null,
        recommendation: null,
        timestamp: new Date().toISOString(),
        blockingInstruction:
          'NO liberar cripto por esta herramienta. Confirmá la referencia en el estado de cuenta de tu banco emisor.',
      },
      'NO_BANK_TELEMETRY',
      'bank interbank-clearing / Suiche confirmation response',
    );
  },
};