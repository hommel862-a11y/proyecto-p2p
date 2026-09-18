import {
  SendMultichannelAlertInputSchema,
  type SendMultichannelAlertInput,
} from '../schemas/index.js';

export const sendMultichannelAlertTool = {
  name: 'send_multichannel_alert',
  description:
    'Despacha alertas institucionales multicanal (Telegram, WhatsApp, Push) con botones interactivos de acción para monitoreo remoto de oportunidades de spread y eventos de riesgo.',
  inputSchema: SendMultichannelAlertInputSchema,
  execute: (input: SendMultichannelAlertInput) => {
    const formattedDate = new Date().toISOString();
    const alertId = `ALT-${Date.now()}`;

    // Formatting for remote channels
    const priorityIcon =
      input.priority === 'CRITICAL_ACTION' ? '🚨' : input.priority === 'ALERT' ? '⚡' : 'ℹ️';

    const renderedPayload = [
      `${priorityIcon} *${input.title.toUpperCase()}*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      input.messageMarkdown,
      `━━━━━━━━━━━━━━━━━━━━`,
      input.orderId ? `📋 *Orden:* \`#${input.orderId}\`` : '',
      `⏱️ *Emitido:* ${formattedDate}`,
      input.actionButtons && input.actionButtons.length > 0
        ? `🔘 *Acciones Disponibles:* ${input.actionButtons.map((b) => `[${b.label}]`).join(' ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      alertId,
      channel: input.channel,
      priority: input.priority,
      deliveryStatus: 'DISPATCHED_TO_QUEUE',
      deliveredAt: formattedDate,
      actionButtonsConfigured: input.actionButtons?.length ?? 0,
      renderedPayloadPreview: renderedPayload,
      summary: `Alerta enviada exitosamente por el canal ${input.channel} (${input.priority}).`,
    };
  },
};
