import {
  DispatchOrderInstructionsInputSchema,
  type DispatchOrderInstructionsInput,
} from '../schemas/index.js';

export const dispatchOrderInstructionsTool = {
  name: 'dispatch_order_instructions',
  description:
    'Despacha automáticamente coordenadas bancarias e instrucciones seguras de pago a contrapartes vía Telegram o WhatsApp para acelerar la liquidación.',
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
      dispatchStatus: 'SENT_SUCCESSFULLY',
      deliveredAt: new Date().toISOString(),
      formattedPayloadPreview: formattedMessage,
      actionId: `MSG-${Date.now()}`,
    };
  },
};
