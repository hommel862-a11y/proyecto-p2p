/**
 * Telegram Sentinel & Remote Dispatcher Engine.
 * Formats high-priority institutional alerts in MarkdownV2, generates interactive inline keyboards,
 * and securely parses and authenticates incoming remote commands (/killswitch, /status, /spreads).
 * Pure TypeScript, framework-agnostic, zero external dependencies.
 */

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramInboundUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
    photo?: {
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      file_size?: number;
    }[];
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    caption?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

export type SentinelAction =
  | 'KILLSWITCH'
  | 'RESUME'
  | 'STATUS'
  | 'SPREADS'
  | 'BCV'
  | 'BANCOS'
  | 'DISPUTE_ORDER'
  | 'AUDIT_RECEIPT';

export interface DispatchResult {
  authorized: boolean;
  command?: string;
  action?: SentinelAction;
  orderId?: string;
  fileId?: string;
  responseMarkdown: string;
}

/**
 * Escapes characters reserved by Telegram Bot API MarkdownV2 formatting.
 * Reserved: _ * [ ] ( ) ~ > # + - = | { } . !
 */
export function escapeMarkdownV2(text: string): string {
  if (!text) return '';
  return text.replace(/([_*[\]()~>#+=|{}.!\\-])/g, '\\$1');
}

/**
 * Generates an institutional alert message for record spreads.
 */
export function formatSpreadAlertMessage(alert: {
  pair: string;
  buyPrice: number;
  sellPrice: number;
  netSpreadPct: number;
  bank?: string;
}): string {
  const bankStr = alert.bank ? ` \\(${escapeMarkdownV2(alert.bank)}\\)` : '';
  return `🚨 *ALERTA DE SPREAD RECORD* 🚨
━━━━━━━━━━━━━━━━━━━━
📈 *Par:* \`${escapeMarkdownV2(alert.pair)}\`${bankStr}
💵 *Compra \\(Ask\\):* \`${escapeMarkdownV2(alert.buyPrice.toFixed(2))}\`
💰 *Venta \\(Bid\\):* \`${escapeMarkdownV2(alert.sellPrice.toFixed(2))}\`
⚡ *Spread Neto:* \`+${escapeMarkdownV2(alert.netSpreadPct.toFixed(2))}%\`
━━━━━━━━━━━━━━━━━━━━
_P2P Decision Tool • Modo Centinela_`;
}

/**
 * Generates an urgent security alert for suspected third-party payer / triangular scam.
 */
export function formatFraudAlertMessage(alert: {
  orderId: string;
  riskLevel: string;
  score: number;
  payerName: string;
  verifiedName: string;
  flags: string[];
}): string {
  const flagsStr = alert.flags.map((f) => `• \`${escapeMarkdownV2(f)}\``).join('\n');
  return `🛡️ *ALERTA FORENSE ANTI\\-FRAUDE* 🛡️
━━━━━━━━━━━━━━━━━━━━
⚠️ *Peligro:* *ESTAFA TRIANGULAR DETECTADA*
🆔 *Orden:* \`${escapeMarkdownV2(alert.orderId)}\`
📊 *Score de Riesgo:* \`${alert.score}/100\` \\(CRÍTICO\\)

👤 *Usuario en Exchange:* \`${escapeMarkdownV2(alert.verifiedName)}\`
🏦 *Titular que Transfirió:* \`${escapeMarkdownV2(alert.payerName)}\`

🚨 *Inconsistencias:*
${flagsStr}
━━━━━━━━━━━━━━━━━━━━
⚠️ *ACCION REQUERIDA:* NO liberes los criptoactivos en custodia\\.`;
}

/**
 * Builds interactive inline keyboard for fraud alert actions.
 */
export function buildFraudAlertKeyboard(orderId: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🚨 Bloquear & Disputar', callback_data: `DISPUTE_${orderId}` },
        { text: '⏸ Retener Fondos', callback_data: `HOLD_${orderId}` },
      ],
      [{ text: '📋 Copiar Reclamo', callback_data: `COPY_CLAIM_${orderId}` }],
    ],
  };
}

/**
 * Builds remote control inline keyboard for the P2P bot.
 */
export function buildRepricerControlKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🚨 KILL-SWITCH (Parada)', callback_data: 'BOT_KILLSWITCH' },
        { text: '▶ Reanudar', callback_data: 'BOT_RESUME' },
      ],
      [{ text: '📊 Estado del Terminal', callback_data: 'BOT_STATUS' }],
    ],
  };
}

/**
 * Formats instantaneous forensic receipt audit results.
 */
export function formatReceiptAuditTelegramMessage(audit: {
  receiptNumber?: string;
  bank?: string;
  amountVes?: number;
  extractedName?: string;
  counterpartyName?: string;
  nameSimilarityPct: number;
  score: number;
  level: 'SAFE' | 'WARNING' | 'CRITICAL';
  recommendation: string;
}): string {
  const icon = audit.level === 'SAFE' ? '🟢' : audit.level === 'WARNING' ? '🟡' : '🔴';
  const scoreStr = `${audit.score}/100`;
  const amountStr = audit.amountVes
    ? `${audit.amountVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })} VES`
    : 'No detectado';

  return `🛡️ *AUDITORÍA FORENSE INSTANTÁNEA* 🛡️
━━━━━━━━━━━━━━━━━━━━
📊 *Veredicto:* ${icon} *${escapeMarkdownV2(audit.level)}* \\(Score: \`${escapeMarkdownV2(scoreStr)}\`\\)
🏦 *Banco:* \`${escapeMarkdownV2(audit.bank || 'No identificado')}\`
🔢 *Referencia:* \`${escapeMarkdownV2(audit.receiptNumber || 'Sin número')}\`
💵 *Monto:* \`${escapeMarkdownV2(amountStr)}\`

👤 *Titular en Comprobante:* \`${escapeMarkdownV2(audit.extractedName || 'No detectado')}\`
👥 *Contraparte P2P:* \`${escapeMarkdownV2(audit.counterpartyName || 'No provisto')}\`
🎯 *Similitud de Identidad:* \`${escapeMarkdownV2(audit.nameSimilarityPct.toFixed(1))}%\`
━━━━━━━━━━━━━━━━━━━━
💡 *Recomendación:* _${escapeMarkdownV2(audit.recommendation)}_`;
}

/**
 * Formats macro BCV intervention and gap analysis.
 */
export function formatBcvIntelligenceTelegramMessage(intel: {
  parallelRate: number;
  bcvRate: number;
  gapPct: number;
  gapVes: number;
  zone: string;
  phase: string;
  nextExpectedIntervention: string;
  probabilityPct: number;
  actionLabel: string;
  timingNotice: string;
}): string {
  const zoneIcon =
    intel.zone === 'CRITICAL_DISPERSION' ? '🔴' : intel.zone === 'ELEVATED' ? '🟡' : '🟢';
  return `🏛️ *INTELIGENCIA CAMBIARIA BCV* 🏛️
━━━━━━━━━━━━━━━━━━━━
📈 *Tasa Paralelo:* \`${escapeMarkdownV2(intel.parallelRate.toFixed(2))} Bs\`
🏛️ *Tasa Oficial BCV:* \`${escapeMarkdownV2(intel.bcvRate.toFixed(2))} Bs\`
⚡ *Brecha:* ${zoneIcon} *+${escapeMarkdownV2(intel.gapPct.toFixed(2))}%* \\(\`${escapeMarkdownV2(intel.gapVes.toFixed(2))} Bs\`\\)
📊 *Zona:* \`${escapeMarkdownV2(intel.zone)}\`

⏱️ *Fase del Ciclo:* \`${escapeMarkdownV2(intel.phase)}\`
📅 *Próxima Inyección:* \`${escapeMarkdownV2(intel.nextExpectedIntervention)}\` \\(${intel.probabilityPct}% prob\\)
━━━━━━━━━━━━━━━━━━━━
🎯 *Directiva de Tesorería:*
👉 *${escapeMarkdownV2(intel.actionLabel)}*
⏳ _Timing: ${escapeMarkdownV2(intel.timingNotice)}_`;
}

/**
 * Formats bank account usage limits and SUDEBAN alerts.
 */
export function formatBankLimitsTelegramMessage(
  accounts: {
    bankName: string;
    spentTodayVes: number;
    dailyLimitVes: number;
    consumedPct: number;
    txCount: number;
    maxTx: number;
    isOverLimit: boolean;
  }[],
): string {
  const rows = accounts
    .map((acc) => {
      const status = acc.isOverLimit
        ? '🚨 SATURADA'
        : acc.consumedPct >= 80
          ? '⚠️ LÍMITE PRÓXIMO'
          : '✅ OPERATIVA';
      return `🏦 *${escapeMarkdownV2(acc.bankName)}:* ${status}
  • Consumo: \`${escapeMarkdownV2(acc.spentTodayVes.toLocaleString('es-VE'))} / ${escapeMarkdownV2(acc.dailyLimitVes.toLocaleString('es-VE'))} Bs\` \\(${acc.consumedPct}%\\)
  • Transferencias: \`${acc.txCount} / ${acc.maxTx} tx\``;
    })
    .join('\n\n');

  return `📊 *ESTADO DE CUPOS BANCARIOS \\(SUDEBAN\\)*
━━━━━━━━━━━━━━━━━━━━
${rows}
━━━━━━━━━━━━━━━━━━━━
_P2P Decision Tool • Monitoreo de Rotación_`;
}

/**
 * Dispatches and authenticates incoming Telegram messages, photos, or callback queries.
 */
export function dispatchTelegramUpdate(
  update: TelegramInboundUpdate,
  authorizedChatId: number | string,
): DispatchResult {
  const authId = Number(authorizedChatId);

  // 1. Message Handling
  if (update.message) {
    const fromId = update.message.from.id;
    const text = (update.message.text || update.message.caption || '').trim();

    if (fromId !== authId) {
      return {
        authorized: false,
        responseMarkdown: escapeMarkdownV2(
          '⛔ ACCESO DENEGADO (USUARIO NO AUTORIZADO): Tu Chat ID no tiene permisos en este terminal P2P.',
        ),
      };
    }

    // A. Photo or Document (Forensic Receipt Audit)
    if (update.message.photo && update.message.photo.length > 0) {
      const bestPhoto = update.message.photo[update.message.photo.length - 1];
      return {
        authorized: true,
        action: 'AUDIT_RECEIPT',
        fileId: bestPhoto.file_id,
        responseMarkdown: `🔍 *COMPROBANTE BANCARIO RECIBIDO*\n\nIniciando extracción OCR y validación cruzada con el Escudo Anti\\-Fraude\\.\\.\\.`,
      };
    }

    if (update.message.document) {
      return {
        authorized: true,
        action: 'AUDIT_RECEIPT',
        fileId: update.message.document.file_id,
        responseMarkdown: `🔍 *DOCUMENTO DE PAGO RECIBIDO*\n\nIniciando extracción OCR y validación cruzada con el Escudo Anti\\-Fraude\\.\\.\\.`,
      };
    }

    // B. Text Commands
    if (text.startsWith('/killswitch') || text.startsWith('/pausar')) {
      return {
        authorized: true,
        command: text.startsWith('/pausar') ? '/pausar' : '/killswitch',
        action: 'KILLSWITCH',
        responseMarkdown: `🚨 *KILLSWITCH ACTIVADO* 🚨\n\nTodos los bots y procesos de repricing han sido detenidos de emergencia\\.`,
      };
    }

    if (text.startsWith('/resume')) {
      return {
        authorized: true,
        command: '/resume',
        action: 'RESUME',
        responseMarkdown: `▶ *BOTS REANUDADOS*\n\nEl sistema continúa operando con las reglas de riesgo activas\\.`,
      };
    }

    if (text.startsWith('/status')) {
      return {
        authorized: true,
        command: '/status',
        action: 'STATUS',
        responseMarkdown: `📊 *ESTADO DEL TERMINAL P2P*\n\n• Sistema: *ONLINE*\n• Auditoría Forense: *ACTIVA*\n• Criptografía: *ENCRIPTADA*`,
      };
    }

    if (text.startsWith('/spreads')) {
      return {
        authorized: true,
        command: '/spreads',
        action: 'SPREADS',
        responseMarkdown: `📈 *RADAR DE MERCADO*\n\nConsulta el panel de Spread Monitor para ver las mejores ofertas en vivo\\.`,
      };
    }

    if (text.startsWith('/bcv')) {
      return {
        authorized: true,
        command: '/bcv',
        action: 'BCV',
        responseMarkdown: `🏛️ *CONSULTANDO CICLO CAMBIARIO BCV*\\.\\.\\.`,
      };
    }

    if (text.startsWith('/bancos')) {
      return {
        authorized: true,
        command: '/bancos',
        action: 'BANCOS',
        responseMarkdown: `🏦 *CONSULTANDO CUPOS BANCARIOS SUDEBAN*\\.\\.\\.`,
      };
    }

    return {
      authorized: true,
      command: text,
      responseMarkdown: escapeMarkdownV2(
        `Comando recibido: "${text}". Comandos disponibles: /status, /spreads, /bcv, /bancos, /killswitch, /resume o envía una foto de un comprobante bancario.`,
      ),
    };
  }

  // 2. Callback Query Handling (from Inline Keyboards)
  if (update.callback_query) {
    const fromId = update.callback_query.from.id;
    const data = update.callback_query.data || '';

    if (fromId !== authId) {
      return {
        authorized: false,
        responseMarkdown: escapeMarkdownV2('⛔ ACCESO NO AUTORIZADO.'),
      };
    }

    if (data.startsWith('DISPUTE_')) {
      const orderId = data.replace('DISPUTE_', '');
      return {
        authorized: true,
        action: 'DISPUTE_ORDER',
        orderId,
        responseMarkdown: `🚨 *ORDEN ${escapeMarkdownV2(orderId)} BLOQUEADA*\n\nSe ha preparado el reclamo de disputa por terceros no autorizados\\.`,
      };
    }

    if (data === 'BOT_KILLSWITCH') {
      return {
        authorized: true,
        action: 'KILLSWITCH',
        responseMarkdown: `🚨 *KILLSWITCH EJECUTADO DESDE TELEGRAM*`,
      };
    }

    if (data === 'BOT_RESUME') {
      return {
        authorized: true,
        action: 'RESUME',
        responseMarkdown: `▶ *REANUDADO EXITOSAMENTE*`,
      };
    }

    if (data === 'BOT_STATUS') {
      return {
        authorized: true,
        action: 'STATUS',
        responseMarkdown: `📊 *ESTADO OPERATIVO VERIFICADO*`,
      };
    }
  }

  return {
    authorized: false,
    responseMarkdown: escapeMarkdownV2('Update no reconocido.'),
  };
}
