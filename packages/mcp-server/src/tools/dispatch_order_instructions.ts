import {
  DispatchOrderInstructionsInputSchema,
  type DispatchOrderInstructionsInput,
} from '../schemas/index.js';

/**
 * This tool renders text. It does not send anything.
 *
 * The previous implementation returned `dispatchStatus: 'SENT_SUCCESSFULLY'`,
 * a `deliveredAt` timestamp, and an `actionId`, without a single network
 * call. That is a forged delivery receipt: an operator auditing their order
 * log would see confirmation that the counterparty had been notified, for a
 * message that only ever existed in a local variable.
 *
 * The formatted message is genuinely useful — it correctly formats Venezuelan
 * thousands separators and carries the P2P counterparty rules — so it is
 * kept verbatim. What is removed is the claim that it went anywhere.
 */
export const dispatchOrderInstructionsTool = {
  name: 'dispatch_order_instructions',
  description:
    'Formatea las coordenadas bancarias e instrucciones de pago para una orden P2P, listas para copiar y enviar por el canal que el operador elija. Esta herramienta NO envía mensajes: devuelve el texto y requiere que el envío se ejecute y verifique por separado.',
  inputSchema: DispatchOrderInstructionsInputSchema,
  execute: (input: DispatchOrderInstructionsInput) => {
    const formattedMessage = [
      `⚡ *ORDEN P2P #${input.orderId}*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🏦 *Banco:* ${input.bankName}`,
      `👤 *Titular:* ${input.accountHolder}`,
      `📱 *PagoMóvil / Cuenta:* \`${input.accountNumberOrPhone}\``,
      `💰 *Monto Exacto:* *${input.amountVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })} VES*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `⚠️ *REGLAS CRÍTICAS:*`,
      `• NO colocar palabras como "Cripto", "USDT" o "Binance" en el concepto.`,
      `• Solo pagos desde cuenta del titular verificado. Pagos de terceros serán rechazados.`,
      input.termsNote ? `ℹ️ *Nota:* ${input.termsNote}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      orderId: input.orderId,
      channel: input.channel,
      recipientContact: input.recipientContact,
      dispatchStatus: 'NOT_SENT_RENDERED_ONLY',
      sent: false,
      deliveredAt: null,
      formattedPayloadPreview: formattedMessage,
      actionId: null,
      instruction:
        'Copiá este texto y envialo por el canal indicado. El envío y su confirmación no forman parte de esta herramienta.',
    };
  },
};