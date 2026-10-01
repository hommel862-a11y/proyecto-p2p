/**
 * Telegram Sentinel & Remote Dispatcher Engine.
 * Formats high-priority institutional alerts in MarkdownV2, generates interactive inline keyboards,
 * and securely parses and authenticates incoming remote commands (/killswitch, /status, /spreads, /panel).
 * Pure TypeScript, framework-agnostic, zero external dependencies.
 */

import type { VerificationSummary } from './decision-journal';

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
  | 'AUDIT_RECEIPT'
  | 'RADAR_SCAN'
  | 'REPRICE_REQUEST'
  | 'REPRICE_EXECUTE'
  | 'REPRICE_CANCEL'
  | 'MACRO'
  | 'BACKTEST_REQUEST'
  | 'BACKTEST_EXECUTE'
  | 'PANEL';

/** Filters accepted by `/radar [banco] [capital]`. */
export interface RadarScanParams {
  bank?: string;
  capital?: number;
}

/** Forced reprice prices, echoed both by `/reprecio` and by the confirm callback. */
export interface RepriceParams {
  buyPrice: number;
  sellPrice: number;
}

/** Optional selectors accepted by `/backtest [par] [temporalidad]`. */
export interface BacktestRequestParams {
  pair?: string;
  timeframe?: string;
}

/**
 * Payload carried by {@link DispatchResult.params}. The concrete shape depends on
 * {@link DispatchResult.action}; narrowing on the action is required to read it.
 */
export type SentinelActionParams = RadarScanParams | RepriceParams | BacktestRequestParams;

export interface DispatchResult {
  authorized: boolean;
  command?: string;
  action?: SentinelAction;
  params?: SentinelActionParams;
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
  parallelRate: number | null;
  bcvRate: number | null;
  gapPct: number | null;
  gapVes: number | null;
  zone: string;
  phase: string;
  nextExpectedIntervention: string;
  probabilityPct: number;
  actionLabel: string;
  timingNotice: string;
}): string {
  // Una tasa ausente no es una tasa de cero: se muestra como "s/d" para que el
  // operador distinga "no lo sé" de "medí cero".
  const bs = (value: number | null): string => (value == null ? 's/d' : `${value.toFixed(2)} Bs`);

  // El semáforo por defecto era 🟢, el estado más tranquilo del juego, y una zona
  // sin medir caía ahí. Lo desconocido se muestra como tal.
  const zoneIcon =
    intel.zone === 'CRITICAL_DISPERSION'
      ? '🔴'
      : intel.zone === 'ELEVATED'
        ? '🟡'
        : intel.zone === 'COMPRESSED'
          ? '🔵'
          : '⚪';

  const gapLine =
    intel.gapPct == null
      ? `⚡ *Brecha:* ${zoneIcon} *no disponible*`
      : `⚡ *Brecha:* ${zoneIcon} *+${escapeMarkdownV2(intel.gapPct.toFixed(2))}%* \\(\`${escapeMarkdownV2(bs(intel.gapVes))}\`\\)`;

  return `🏛️ *INTELIGENCIA CAMBIARIA BCV* 🏛️
━━━━━━━━━━━━━━━━━━━━
📈 *Tasa Paralelo:* \`${escapeMarkdownV2(bs(intel.parallelRate))}\`
🏛️ *Tasa Oficial BCV:* \`${escapeMarkdownV2(bs(intel.bcvRate))}\`
${gapLine}
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
━━━━━━━━━━━━━━━━━
${rows}
━━━━━━━━━━━━━━━━━
_P2P Decision Tool • Monitoreo de Rotación_`;
}

// ---------------------------------------------------------------------------
// Operational commands V2 — pure payload types
// ---------------------------------------------------------------------------

/** One spread opportunity reported by the radar. */
export interface RadarGapRow {
  bank: string;
  price: number;
  maxTc: number;
  volumeUsdt: number;
  spreadPct: number;
}

/** Filters echoed back in the radar report so the operator sees what was applied. */
export interface RadarReportOptions {
  bank?: string;
  capital?: number;
}

/** Consolidated macro snapshot backing `/macro`. */
export interface MacroIntelSnapshot {
  bcvRef: number | null;
  parallelRef: number | null;
  spreadPct: number;
  volatility2hPct: number;
  forecastNote?: string;
}

/** Metrics produced by the historical simulation harness behind `/backtest`. */
export interface BacktestReportResult {
  pair: string;
  timeframe: string;
  trades: number;
  winRatePct: number;
  avgReturnPct: number;
  maxDrawdownPct: number;
  netReturnPct: number;
}

/** Reprice state report: `confirmed: false` is the prompt, `true` the executed state. */
export interface RepriceRequestReport {
  buyPrice: number;
  sellPrice: number;
  confirmed: boolean;
}

// ---------------------------------------------------------------------------
// Operational commands V2 — MarkdownV2 formatting primitives
//
// Hard constraint (historical /start bug): every dynamic fragment goes through
// escapeMarkdownV2, and code-span interpolation additionally strips backticks and
// backslashes so an upstream value can never break out of the span.
// ---------------------------------------------------------------------------

/**
 * Renderiza una métrica para Telegram.
 *
 * El tipo admite `null` porque el cuerpo ya devolvía `n/d` para cualquier valor no
 * numérico: la ausencia se mostraba, pero la firma la prohibía, así que quien
 * llamaba tenía que inventar un 0 para poder compilar.
 */
function formatMetric(value: number | null, decimals = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/d';
  return escapeMarkdownV2(value.toFixed(decimals));
}

function formatCount(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/d';
  return escapeMarkdownV2(String(value));
}

function formatCodeSpan(value: string): string {
  const safe = typeof value === 'string' ? value.replace(/[`\\]/g, '') : '';
  return escapeMarkdownV2(safe);
}

/**
 * Formats the gap radar: ranked listing, top gap highlighted, filters echoed back.
 */
export function formatRadarTelegramMessage(
  rows: RadarGapRow[],
  opts: RadarReportOptions = {},
): string {
  const bankRaw =
    typeof opts.bank === 'string' && opts.bank.trim() ? opts.bank.trim() : 'todos';
  const capitalRaw =
    typeof opts.capital === 'number' && Number.isFinite(opts.capital)
      ? `${opts.capital.toFixed(2)} USDT`
      : 'sin filtro';
  const header = `🔎 *Filtro:* banco \`${formatCodeSpan(bankRaw)}\` • capital \`${formatCodeSpan(capitalRaw)}\``;

  if (!Array.isArray(rows) || rows.length === 0) {
    return `📡 *RADAR DE GAPS \\(SIN RESULTADOS\\)* 📡
━━━━━━━━━━━━━━━━━━
${header}
⚠️ ${escapeMarkdownV2('Ninguna oferta cumple el criterio solicitado')}`;
  }

  // The widest spread is the actionable one: highlight it instead of re-sorting,
  // so the ordering chosen by the caller is preserved.
  let topIndex = 0;
  for (let i = 1; i < rows.length; i++) {
    const candidate = rows[i].spreadPct;
    const best = rows[topIndex].spreadPct;
    const candidateOk = typeof candidate === 'number' && Number.isFinite(candidate);
    const bestOk = typeof best === 'number' && Number.isFinite(best);
    if (candidateOk && (!bestOk || candidate > best)) topIndex = i;
  }

  const body = rows
    .map((row, index) => {
      const marker = index === topIndex ? ` 🥇 *${escapeMarkdownV2('TOP GAP')}*` : '';
      const bank =
        typeof row.bank === 'string' && row.bank.trim() ? row.bank.trim() : 'sin banco';
      return `${index + 1}\\. *${formatCodeSpan(bank)}*${marker}
   • Precio: \`${formatMetric(row.price)}\`
   • Tope TC: \`${formatCount(row.maxTc)}\`
   • Volumen: \`${formatMetric(row.volumeUsdt, 0)} USDT\`
   • Spread: \`${formatMetric(row.spreadPct)}%\``;
    })
    .join('\n\n');

  return `📡 *RADAR DE GAPS* 📡
━━━━━━━━━━━━━━━━━━
${header}
━━━━━
${body}`;
}

/**
 * Formats the consolidated macro report: BCV reference, parallel rate, average
 * spread and 2h volatility, with an optional forecast note.
 */
export function formatMacroTelegramMessage(intel: MacroIntelSnapshot): string {
  const rawNote = typeof intel.forecastNote === 'string' ? intel.forecastNote.trim() : '';
  const note = rawNote ? `\n🧠 *Pronóstico:* _${formatCodeSpan(rawNote)}_` : '';

  return `🌎 *REPORTE MACRO CONSOLIDADO* 🌎
━━━━━━━━━━━━━━━━━━
🏛️ *Referencia BCV:* \`${formatMetric(intel.bcvRef)} Bs\`
💵 *Paralelo:* \`${formatMetric(intel.parallelRef)} Bs\`
📊 *Spread promedio:* \`${formatMetric(intel.spreadPct)}%\`
🌊 *Volatilidad 2h:* \`${formatMetric(intel.volatility2hPct)}%\`
━━━━━━━━━━━━━━━━━━${note}`;
}

/**
 * Formats the historical simulation report produced by the backtest harness.
 */
export function formatBacktestTelegramMessage(result: BacktestReportResult): string {
  return `🧪 *BACKTEST HISTÓRICO* 🧪
━━━━━━━━━━━━━━━━━━
💱 *Par:* \`${formatCodeSpan(result.pair)}\`
⏱️ *Temporalidad:* \`${formatCodeSpan(result.timeframe)}\`
━━━━━━━━━━━━━━━━━━
🧾 *Operaciones:* \`${formatCount(result.trades)}\`
🎯 *Tasa de acierto:* \`${formatMetric(result.winRatePct)}%\`
📈 *Retorno promedio:* \`${formatMetric(result.avgReturnPct)}%\`
🛡️ *Drawdown máximo:* \`${formatMetric(result.maxDrawdownPct)}%\`
💰 *Retorno neto:* \`${formatMetric(result.netReturnPct)}%\`
━━━━━━━━━━━━━━━━━━
_P2P Decision Tool • Simulación histórica_`;
}

/**
 * Formats a forced reprice. With `confirmed: false` it is the confirmation
 * prompt (nothing has run); with `confirmed: true` it reports the applied state.
 */
export function formatRepriceTelegramMessage(req: RepriceRequestReport): string {
  const buyPrice = typeof req.buyPrice === 'number' ? req.buyPrice : Number.NaN;
  const sellPrice = typeof req.sellPrice === 'number' ? req.sellPrice : Number.NaN;
  const delta = sellPrice - buyPrice;
  const deltaLine = Number.isFinite(delta)
    ? `\n📐 *Delta venta − compra:* \`${formatMetric(delta)} Bs\``
    : '';
  const head = req.confirmed
    ? '✅ *REPRICE APLICADO* ✅'
    : '⚠️ *REPRICE \\(CONFIRMACIÓN REQUERIDA\\)* ⚠️';
  const footer = req.confirmed
    ? `\n━━━━━━━━━━━━━━━━━━\n🟢 ${escapeMarkdownV2('Los precios fueron forzados en el motor de repricing')}`
    : `\n━━━━━━━━━━━━━━━━━━\n🔒 ${escapeMarkdownV2('No se ejecutó nada: se requiere confirmación explícita con el botón')}`;

  return `${head}
━━━━━━━━━━━━━━━━━━
💵 *Compra \\(Ask\\):* \`${formatMetric(buyPrice)}\`
💰 *Venta \\(Bid\\):* \`${formatMetric(sellPrice)}\`${deltaLine}${footer}`;
}

// ---------------------------------------------------------------------------
// Panel editable — payload puro, formateador y teclado
//
// El panel NO tiene estado: `update.callback_query.message` ES el panel y
// Telegram lo entrega en cada callback. No hay id por chat, ni store, ni
// sincronización que pueda quedar vieja.
//
// H Honestidad: el modo de ejecución entra YA resuelto desde el repricer y se
// imprime tal cual. No existe ninguna ruta por la que este formateador pueda
// afirmar publicación en vivo. Y un libro ausente se DECLARA ausente: nunca se
// imprime un cero haciéndolo pasar por un precio.
// ---------------------------------------------------------------------------

/** `callback_data` de los botones del panel editable. */
export const PANEL_CALLBACKS = {
  REFRESH: 'PANEL_REFRESH',
  REPRICER_STOP: 'PANEL_REPRICER_STOP',
  REPRICER_START: 'PANEL_REPRICER_START',
} as const;

export type PanelCallback = (typeof PANEL_CALLBACKS)[keyof typeof PANEL_CALLBACKS];

/** Lectura del libro de Binance. `null` cuando no hay profundidad disponible. */
export interface PanelMarketSnapshot {
  bestBuyPrice: number;
  bestSellPrice: number;
  spreadPct: number;
  spreadVes: number;
}

/**
 * Estado del terminal que imprime el panel. Todo valor numérico ausente viaja
 * como `NaN` para que el formateador lo muestre como `n/d`.
 */
export interface PanelReport {
  /** Etiqueta corta del modo REAL de ejecución (`SOLO LECTURA — NO PUBLICA`). */
  executionModeLabel: string;
  /** Frase que explica el modo real y qué NO hace el motor. */
  executionModeDetail: string;
  /** ¿Está corriendo el motor de repricing? */
  repricerActive: boolean;
  /** Precio de compra que el motor quiere dejar; `NaN` si aún no hay ninguno. */
  repricerBuyPrice: number;
  /** Precio de venta que el motor quiere dejar; `NaN` si aún no hay ninguno. */
  repricerSellPrice: number;
  /** Libro de Binance, o `null` si no hay profundidad disponible. */
  market: PanelMarketSnapshot | null;
  /** Momento de la lectura ya formateado por el worker; `—` si nunca hubo lectura. */
  fetchedAt: string;
  /** `true` cuando lo mostrado viene de caché y puede estar desactualizado. */
  marketStale: boolean;
  /**
   * Auditoría del decision journal.
   *
   * `undefined` = nunca se consultó (el panel omite la línea: no hay nada que
   * afirmar). `null` = se intentó y no se pudo leer (la línea dice "no
   * disponible"). No es lo mismo que un journal vacío, que tiene su propio texto.
   */
  journalAudit?: VerificationSummary | null;
}

/** Igual que `formatMetric`, pero con el signo del spread explícito. */
function formatSignedMetric(value: number, decimals = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/d';
  return `+${escapeMarkdownV2(value.toFixed(decimals))}`;
}

/** Un conteo que se puede mostrar tal cual: número finito y no negativo. */
function isReadableCount(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Una línea con la auditoría del decision journal.
 *
 * El número que se muestra NO es un trade. `verifiedDecisions` cuenta decisiones
 * con al menos un **intento de publicación** registrado: el motor pidió un precio
 * y otra persona lo vio. Eso no es una venta ejecutada, ni un orderId de Binance,
 * ni un fill. Decir "verificadas" le mentiría al operador sobre lo que el sistema
 * sabe, así que el rótulo dice exactamente lo que el número es.
 *
 * El resumen trae DOS denominadores porque hay DOS poblaciones: `totalDecisions`
 * cuenta solo las acciones publicables y `journaledDecisions` cuenta todo lo que
 * se registró. Por eso "se registró algo" se decide con el segundo y "hay algo que
 * medir" con el primero. Un slice de KEEP y PAUSE tiene denominador 0 con decisiones
 * de sobra, así que decidir con `totalDecisions` que no se registró nada mentiría por
 * partida doble: borraría lo que el motor decidió y taparía la exposición a libro
 * viejo, que es justo el dato que un slice así existe para mostrar.
 *
 * Cuatro casos, cuatro textos distintos, porque no son lo mismo:
 * - `null`: no se pudo leer el journal → "no disponible".
 * - nada journaleado: no se registró ninguna decisión → "sin decisiones registradas".
 * - journaleado pero sin denominador de verificación: se decidió, y ninguna de esas
 *   decisiones podía llegar a publicar → dice cuántas se registraron y NO un
 *   porcentaje, porque no hay división que lo respalde.
 * - tasas no finitas: hay datos parciales → "n/d" en vez de inventar un porcentaje.
 */
export function formatJournalAuditLine(summary: VerificationSummary | null): string {
  if (summary === null) {
    return `🗒️ *Auditoría de decisiones:* ${escapeMarkdownV2('no disponible')}`;
  }

  // El journal vacío se decide sobre `journaledDecisions`, nunca sobre `totalDecisions`:
  // el segundo está en cero para cualquier slice sin UPDATEs, y afirmar ahí que no se
  // registró nada es afirmar lo contrario de lo que el sistema sabe.
  const journaled = summary.journaledDecisions;
  if (!isReadableCount(journaled) || journaled <= 0) {
    return `🗒️ *Auditoría de decisiones:* ${escapeMarkdownV2('sin decisiones registradas todavía')}`;
  }

  const total = summary.totalDecisions;
  const measurable = isReadableCount(total) && total > 0;
  // Sin denominador no hay fracción ni tasa que imprimir. Un denominador en cero SÍ es
  // una afirmación: dice que de lo registrado ninguna decisión era publicable, y eso
  // vale la pena mostrar. Un denominador ilegible (NaN, Infinity) no afirma nada, así
  // que en ese caso la línea dice únicamente cuántas decisiones hay.
  const head = measurable
    ? `🗒️ *Auditoría de decisiones:* \`${formatCount(summary.verifiedDecisions)}/${formatCount(total)}\` ` +
      `${escapeMarkdownV2('decisiones con intento de publicación')} • \`${formatMetric(summary.verificationRate * 100, 1)}%\``
    : `🗒️ *Auditoría de decisiones:* \`${formatCount(journaled)}\` ` +
      `${escapeMarkdownV2('decisiones registradas')}` +
      (isReadableCount(total) ? `, ${escapeMarkdownV2('ninguna con intento de publicación')}` : '');

  // La porción de libro viejo aparece siempre que hubo decisiones tomadas sobre un
  // libro viejo, y NO depende del denominador de verificación: un 0% sin contexto es
  // ruido, no información, pero callar la exposición cuando lo único del slice son
  // KEEP y PAUSE es esconder la única métrica real que el repositorio calculó bien.
  // Sin fracción de la que colgar el relativo, la porción lleva su propio sujeto.
  const stale = summary.staleDecisions;
  if (isReadableCount(stale) && stale > 0) {
    const rate = `\`${formatMetric(summary.staleRate * 100, 1)}%\``;
    return measurable
      ? `${head} ${escapeMarkdownV2('decididas sobre libro viejo')} ${rate}`
      : `${head} • \`${formatCount(stale)}\` ${escapeMarkdownV2('sobre libro viejo')} ${rate}`;
  }

  return head;
}

/**
 * Formatea el panel editable del terminal: modo de ejecución real, estado del
 * motor, precios que el motor quiere dejar, libro de Binance, frescura de la
 * lectura y auditoría del journal. Cuando un dato no está disponible lo dice en
 * vez de mostrar ceros.
 */
export function formatPanelTelegramMessage(report: PanelReport): string {
  const engine = report.repricerActive ? '🟢 ACTIVO' : '⏸ DETENIDO';

  const marketBlock = report.market
    ? `💵 *Compra \\(Ask\\):* \`${formatMetric(report.market.bestBuyPrice)} Bs\`
💰 *Venta \\(Bid\\):* \`${formatMetric(report.market.bestSellPrice)} Bs\`
⚡ *Spread:* \`${formatSignedMetric(report.market.spreadPct)}%\` \\(\`${formatMetric(report.market.spreadVes)} Bs\`\\)`
    : `⚠️ *Libro sin datos:* ${escapeMarkdownV2('Binance no devolvió profundidad. No se muestran precios porque no los hay, no porque valgan cero.')}`;

  const freshness = report.marketStale
    ? `🕐 *Datos de las* \`${formatCodeSpan(report.fetchedAt)}\` ${escapeMarkdownV2('— pueden estar desactualizados')}`
    : `🕐 *Datos de las* \`${formatCodeSpan(report.fetchedAt)}\``;

  const audit =
    report.journalAudit === undefined
      ? ''
      : `\n${formatJournalAuditLine(report.journalAudit)}`;

  return `🛡️ *PANEL DEL TERMINAL* 🛡️
━━━━━━━━━━━━━━━━━━
🧠 *Modo de ejecución:* *${escapeMarkdownV2(report.executionModeLabel)}*
ℹ️ _${escapeMarkdownV2(report.executionModeDetail)}_
⚙️ *Motor de repricing:* ${escapeMarkdownV2(engine)}
💱 *Precios del motor:* compra \`${formatMetric(report.repricerBuyPrice)} Bs\` • venta \`${formatMetric(report.repricerSellPrice)} Bs\`

${marketBlock}${audit}

${freshness}
_${escapeMarkdownV2('Este mensaje se actualiza en el lugar: usá el botón de refrescar en vez de mandar el comando otra vez.')}_`;
}

/**
 * Teclado del panel editable. Todos sus botones re-renderizan el MISMO mensaje,
 * por eso usan callbacks `PANEL_*` propios y no reutilizan los `BOT_*`, que sí
 * emiten mensajes nuevos al chat.
 */
export function buildPanelKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '🔄 Refrescar', callback_data: PANEL_CALLBACKS.REFRESH }],
      [
        { text: '⏸ Pausar motor', callback_data: PANEL_CALLBACKS.REPRICER_STOP },
        { text: '▶ Reanudar motor', callback_data: PANEL_CALLBACKS.REPRICER_START },
      ],
    ],
  };
}

/** `true` cuando el callback proviene de un botón del panel editable. */
export function isPanelCallbackData(data: string | undefined): boolean {
  return Object.values(PANEL_CALLBACKS).some((value) => value === data);
}

// ---------------------------------------------------------------------------
// Operational commands V2 — command parsing helpers (shared by dispatcher and keyboards)
// ---------------------------------------------------------------------------

const REPRICE_CONFIRM_PREFIX = 'REPRICE_CONFIRM:';

interface ParsedCommand {
  name: string;
  args: string[];
}

/**
 * Splits a raw command into its name and positional arguments. Whitespace-only
 * tokens are dropped so a trailing space never yields an empty argument.
 */
function parseCommand(text: string): ParsedCommand {
  const tokens = text.trim().split(/\s+/).filter((token) => token.length > 0);
  return { name: tokens[0] ?? '', args: tokens.slice(1) };
}

/** Parses a finite number, rejecting NaN, Infinity and empty tokens. */
function parseFiniteNumber(token: string | undefined): number | undefined {
  if (token === undefined || token.length === 0) return undefined;
  const parsed = Number(token);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Builds the `callback_data` payload for the reprice confirmation button.
 * Prices are emitted verbatim (no rounding) so the confirmation round-trip
 * executes exactly the values the operator typed.
 */
export function buildRepriceCallbackData(buyPrice: number, sellPrice: number): string {
  return `${REPRICE_CONFIRM_PREFIX}${buyPrice}:${sellPrice}`;
}

/**
 * Parses `REPRICE_CONFIRM:<buy>:<sell>` back into finite prices.
 * Returns undefined for any other callback or for non-finite values.
 */
export function parseRepriceCallbackData(data: string): RepriceParams | undefined {
  if (typeof data !== 'string' || !data.startsWith(REPRICE_CONFIRM_PREFIX)) return undefined;
  const parts = data.slice(REPRICE_CONFIRM_PREFIX.length).split(':');
  if (parts.length !== 2) return undefined;
  const buyPrice = parseFiniteNumber(parts[0]);
  const sellPrice = parseFiniteNumber(parts[1]);
  if (buyPrice === undefined || sellPrice === undefined) return undefined;
  return { buyPrice, sellPrice };
}

/**
 * Builds the inline keyboard that gates the destructive reprice behind an
 * explicit confirmation, as required for any action that changes live pricing.
 */
export function buildRepriceConfirmationKeyboard(
  buyPrice: number,
  sellPrice: number,
): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Confirmar Reprice', callback_data: buildRepriceCallbackData(buyPrice, sellPrice) },
        { text: '❌ Cancelar', callback_data: 'REPRICE_CANCEL' },
      ],
    ],
  };
}

function formatRadarUsageMessage(): string {
  return `📡 *RADAR DE GAPS* 📡
━━━━━━━━━━━━━━━━━━
ℹ️ *Formato:* \`/radar [banco] [capital]\`
• \`/radar\` ${escapeMarkdownV2('→ todos los bancos, sin filtro de capital')}
• \`/radar bcv\` ${escapeMarkdownV2('→ banco bcv, cualquier capital')}
• \`/radar bcv 2000\` ${escapeMarkdownV2('→ banco bcv con 2000 USDT de capital')}
⚠️ ${escapeMarkdownV2('El banco es texto libre y el capital debe ser un número finito')}`;
}

function formatRepriceUsageMessage(): string {
  return `⚠️ *REPRICE \\(COMANDO DESTRUCTIVO\\)* ⚠️
━━━━━━━━━━━━━━━━━━
ℹ️ *Formato:* \`/reprecio <buy> <sell>\`
• ${escapeMarkdownV2('Ejemplo')}: \`/reprecio 84.5 85.2\`
🚫 ${escapeMarkdownV2('Ambos precios son obligatorios y deben ser números finitos')}`;
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

    // /start is the pairing and discovery handshake: always allow and respond with the Chat ID
    if (text.startsWith('/start')) {
      const isAuth = fromId === authId;
      const pairingInfo = isAuth
        ? escapeMarkdownV2('Tu terminal P2P ya está vinculado a este chat.')
        : `ℹ️ ${escapeMarkdownV2('Para autorizar este chat, ingresá este ID')} \`${fromId}\` ${escapeMarkdownV2('en')} *${escapeMarkdownV2('Reglas de Riesgo > Telegram Sentinel')}* ${escapeMarkdownV2('o pulsá')} *${escapeMarkdownV2('"Detectar mi Chat ID"')}*`;
      const availableCommands = [
        ['/status', 'Estado en tiempo real del terminal'],
        ['/spreads', 'Monitoreo de márgenes y arbitraje'],
        ['/bcv', 'Inteligencia cambiaria y ventana BCV'],
        ['/bancos', 'Cupos bancarios y límites SUDEBAN'],
        ['/radar [banco] [capital]', 'Radar de gaps con filtro por banco y capital'],
        ['/reprecio <buy> <sell>', 'Forzar repricing (requiere confirmación)'],
        ['/macro', 'Reporte macro consolidado: BCV, spread y volatilidad'],
        ['/backtest [par] [temporalidad]', 'Simulación histórica del par'],
        ['/panel', 'Panel editable del terminal: se actualiza en el lugar'],
        ['/killswitch', 'Parada de emergencia inmediata'],
        ['/resume', 'Reanudar operaciones'],
      ]
        .map(([cmd, desc]) => `• \`${cmd}\` \\- ${escapeMarkdownV2(desc)}`)
        .join('\n');

      return {
        authorized: true,
        command: '/start',
        action: 'STATUS',
        responseMarkdown:
          `🤖 *${escapeMarkdownV2('TELEGRAM SENTINEL 2.0 CONECTADO Y OPERATIVO')}* 🛡️\n\n` +
          `✅ ${escapeMarkdownV2('Tu Telegram Chat ID es')}: \`${fromId}\`\n\n` +
          `${pairingInfo}\n\n` +
          `*${escapeMarkdownV2('Comandos disponibles')}:*\n` +
          `${availableCommands}\n\n` +
          `📸 *${escapeMarkdownV2('Auditoría de Comprobantes')}:* ${escapeMarkdownV2('Enviá una foto de un Pago Móvil o transferencia y la auditaré al instante.')}`,
      };
    }

    if (fromId !== authId) {
      return {
        authorized: false,
        responseMarkdown: escapeMarkdownV2(
          `⛔ ACCESO DENEGADO (USUARIO NO AUTORIZADO): Tu Chat ID es ${fromId}. Configuralo en tu Terminal P2P (Reglas de Riesgo > Telegram Sentinel) para autorizar este chat.`,
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

    // Operational commands V2. Parsed by exact command token (not prefix) so a
    // command that merely starts like another one is never swallowed.

    const command = parseCommand(text);
    if (command.name === '/radar') {
      const [first, second] = command.args;
      let bank: string | undefined;
      let capital: number | undefined;
      if (first !== undefined) {
        // A leading numeric token is a capital, not a bank name.
        const asCapital = parseFiniteNumber(first);
        if (asCapital !== undefined) {
          capital = asCapital;
        } else {
          bank = first;
        }
      }
      if (second !== undefined) {
        const secondCapital = parseFiniteNumber(second);
        if (secondCapital === undefined) {
          // Never throw and never silently drop a filter: ask for a correction.
          return {
            authorized: true,
            command: '/radar',
            responseMarkdown: formatRadarUsageMessage(),
          };
        }
        capital = secondCapital;
      }
      const params: RadarScanParams = {};
      if (bank !== undefined) params.bank = bank;
      if (capital !== undefined) params.capital = capital;

      return {
        authorized: true,
        command: '/radar',
        action: 'RADAR_SCAN',
        params,
        responseMarkdown:
          `📡 *RADAR DE GAPS ACTIVADO* 📡\n\n` +
          `🔎 *Filtro:* banco \`${formatCodeSpan(bank ?? 'todos')}\` ` +
          `• capital \`${formatCodeSpan(capital === undefined ? 'sin filtro' : `${capital} USDT`)}\``,
      };
    }

    if (command.name === '/reprecio') {
      const buyPrice = parseFiniteNumber(command.args[0]);
      const sellPrice = parseFiniteNumber(command.args[1]);
      if (buyPrice === undefined || sellPrice === undefined) {
        return {
          authorized: true,
          command: '/reprecio',
          responseMarkdown: formatRepriceUsageMessage(),
        };
      }
      // Destructive: core only ever emits the prompt. Execution waits for the
      // authenticated REPRICE_CONFIRM callback.
      return {
        authorized: true,
        command: '/reprecio',
        action: 'REPRICE_REQUEST',
        params: { buyPrice, sellPrice },
        responseMarkdown: formatRepriceTelegramMessage({ buyPrice, sellPrice, confirmed: false }),
      };
    }

    if (command.name === '/macro') {
      return {
        authorized: true,
        command: '/macro',
        action: 'MACRO',
        responseMarkdown: `🌎 *CONSULTANDO REPORTE MACRO CONSOLIDADO*\\.\\.\\.`,
      };
    }

    if (command.name === '/backtest') {
      const [pair, timeframe] = command.args;
      const params: BacktestRequestParams = {};
      if (pair !== undefined) params.pair = pair;
      if (timeframe !== undefined) params.timeframe = timeframe;

      const selector = formatCodeSpan(
        `${pair ?? 'par por defecto'} ${timeframe ?? 'temporalidad por defecto'}`,
      );
      return {
        authorized: true,
        command: '/backtest',
        action: 'BACKTEST_REQUEST',
        params,
        responseMarkdown:
          `🧪 *BACKTEST HISTÓRICO EN COLA* 🧪\n\n` +
          `⚙️ *Selección:* \`${selector}\`\n` +
          `⏳ ${escapeMarkdownV2('El simulador puede tardar: el resultado arrive como mensaje posterior')}`,
      };
    }

    if (command.name === '/panel') {
      // Un panel se mira, no se scrollea: el worker devuelve UN mensaje con
      // teclado y los botones lo re-renderizan en el lugar.
      return {
        authorized: true,
        command: '/panel',
        action: 'PANEL',
        responseMarkdown: `🛡️ *CONSULTANDO PANEL DEL TERMINAL*\\.\\.\\.`,
      };
    }

    return {
      authorized: true,
      command: text,
      responseMarkdown: escapeMarkdownV2(
        `Comando recibido: "${text}". Comandos disponibles: /status, /spreads, /bcv, /bancos, /radar, /reprecio, /macro, /backtest, /panel, /killswitch, /resume o envía una foto de un comprobante bancario.`,
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

    // Botones del panel editable. El mensaje que trae el callback ES el panel,
    // así que el worker lo re-renderiza en el lugar en vez de emitir otro.
    if (isPanelCallbackData(data)) {
      if (data === PANEL_CALLBACKS.REFRESH) {
        return {
          authorized: true,
          action: 'PANEL',
          responseMarkdown: `🔄 *PANEL ACTUALIZADO*`,
        };
      }
      if (data === PANEL_CALLBACKS.REPRICER_STOP) {
        return {
          authorized: true,
          action: 'KILLSWITCH',
          responseMarkdown: `🚨 *MOTOR DE REPRICING DETENIDO DESDE EL PANEL*`,
        };
      }
      return {
        authorized: true,
        action: 'RESUME',
        responseMarkdown: `▶ *MOTOR DE REPRICING REANUDADO DESDE EL PANEL*`,
      };
    }

    // Destructive-action confirmations. Reachable only from an authenticated
    // callback_query (the gate above already rejected foreign chat ids).
    const reprice = parseRepriceCallbackData(data);
    if (reprice) {
      return {
        authorized: true,
        action: 'REPRICE_EXECUTE',
        params: reprice,
        responseMarkdown: formatRepriceTelegramMessage({
          buyPrice: reprice.buyPrice,
          sellPrice: reprice.sellPrice,
          confirmed: true,
        }),
      };
    }

    if (data.startsWith(REPRICE_CONFIRM_PREFIX)) {
      // Authenticated but unparseable: refuse to execute and re-teach the format.
      return {
        authorized: true,
        responseMarkdown: formatRepriceUsageMessage(),
      };
    }

    if (data === 'REPRICE_CANCEL') {
      return {
        authorized: true,
        action: 'REPRICE_CANCEL',
        responseMarkdown: `↩️ *REPRICE CANCELADO*\n\nNo se forzó ningún precio\\.`,
      };
    }

    if (data === 'BACKTEST_RUN') {
      return {
        authorized: true,
        action: 'BACKTEST_EXECUTE',
        responseMarkdown: `🧪 *BACKTEST EJECUTADO DESDE TELEGRAM*\n\n⏳ ${escapeMarkdownV2('El simulador está corriendo: el reporte llegará como mensaje posterior')}`,
      };
    }
  }

  return {
    authorized: false,
    responseMarkdown: escapeMarkdownV2('Update no reconocido.'),
  };
}
