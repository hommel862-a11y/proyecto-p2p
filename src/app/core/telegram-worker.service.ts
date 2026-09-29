import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { BinanceP2pService } from './binance-p2p.service';
import { BinanceRepricerService } from './binance-repricer.service';
import { AccountsService } from './accounts.service';
import { CotizaveService } from './cotizave.service';
import { MarketHistoryService } from './market-history.service';
import { CredentialStoreService } from './credential-store.service';
import {
  dispatchTelegramUpdate,
  formatReceiptAuditTelegramMessage,
  formatBcvIntelligenceTelegramMessage,
  formatBankLimitsTelegramMessage,
  parseBankReceiptText,
  evaluateFraudRisk,
  getBcvMarketIntelligence,
  escapeMarkdownV2,
  formatRadarTelegramMessage,
  formatMacroTelegramMessage,
  formatBacktestTelegramMessage,
  formatRepriceTelegramMessage,
  buildRepriceConfirmationKeyboard,
  formatPanelTelegramMessage,
  buildPanelKeyboard,
  isPanelCallbackData,
  formatJournalAuditLine,
  predictTwoHourVolatility,
  computeTickVelocity,
  type BinanceP2pMarketDepth,
  type BinanceOfferSummary,
  type BacktestReportResult,
  type BacktestRequestParams,
  type MacroIntelSnapshot,
  type PanelReport,
  type PriceTick,
  type RadarGapRow,
  type RadarScanParams,
  type RepriceParams,
  type SentinelActionParams,
  type TelegramInboundUpdate,
  type TelegramInlineKeyboardMarkup,
  type VerificationSummary,
} from '@p2p/core';
import Tesseract from 'tesseract.js';
import { DecisionJournalService, IN_MEMORY_JOURNAL_REASON } from './decision-journal.service';

/**
 * ¿Este resumen se puede imprimir sin que el panel mienta?
 *
 * `verificationRate` —la tasa que divide el repositorio— llega como `unknown` desde el
 * IPC, y una división sin denominador da `NaN`. Los dos adaptadores que existen hoy lo
 * evitan, pero acá no alcanza con confiar en que el otro lado tuvo cuidado. Un resumen
 * que no se puede imprimir se trata como una lectura fallida —"no disponible"— en vez
 * de dejar que el operador lea un porcentaje que no significa nada.
 *
 * `staleRate` NO se inspecciona acá, y es deliberado: el formateador la cubre una capa
 * más abajo, donde una tasa no finita se imprime como `n/d` en vez de como `NaN`
 * (`formatMetric`, telegram-sentinel.ts:344-347, usado por la rama de libro viejo de
 * `formatJournalAuditLine`). Exigirla acá tiraría el panel entero —con los conteos y la
 * tasa de verificación, que SÍ son reales— por un `n/d` que el formateador ya sabe
 * declarar solo.
 *
 * Un journal con 0 decisiones SÍ pasa: el formateador tiene su propio texto para eso y
 * no imprime ninguna cifra, así que no hay nada que proteger.
 */
function isPrintableAudit(summary: VerificationSummary | null | undefined): summary is VerificationSummary {
  if (summary === null || typeof summary !== 'object') return false;

  const total = summary.totalDecisions;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return true;

  return (
    typeof summary.verifiedDecisions === 'number' &&
    Number.isFinite(summary.verifiedDecisions) &&
    summary.verifiedDecisions >= 0 &&
    typeof summary.verificationRate === 'number' &&
    Number.isFinite(summary.verificationRate)
  );
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  alertsEnabled: boolean;
  pollingEnabled?: boolean;
}

export interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
}

export interface TelegramChatDetectionResult {
  success: boolean;
  chatId?: string;
  username?: string;
  firstName?: string;
  botUsername?: string;
  error?: string;
}

export interface TelegramLogEntry {
  time: string;
  command: string;
  action: string;
  status: 'SUCCESS' | 'DENIED' | 'ERROR';
  details?: string;
}

/**
 * Resultado de editar un mensaje en el lugar. Separa los finales que el operador
 * NO debe ver igual:
 *
 * - `EDITED`: el panel se re-renderizó.
 * - `UNCHANGED`: Telegram rechazó la edición porque texto y markup ya eran
 *   idénticos. Desde el punto de vista del panel es ÉXITO — tocó refrescar sin
 *   cambios de estado y no hay nada que mostrar.
 * - `NOT_FOUND`: el mensaje ya no existe (fue borrado). La recuperación honesta
 *   es enviar un panel nuevo.
 * - `FAILED`: error real de la API o de red.
 */
export type TelegramEditOutcome = 'EDITED' | 'UNCHANGED' | 'NOT_FOUND' | 'FAILED';

const TELEGRAM_DEFAULTS: TelegramConfig = {
  botToken: '',
  chatId: '',
  alertsEnabled: true,
  pollingEnabled: false,
};

const TELEGRAM_OFFSET_STORAGE_KEY = 'p2p_telegram_offset';

/** Result shape returned by the Electron backtest bridge. */
interface BacktestBridgeResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  summaryPath?: string;
  summary?: unknown;
}

/** SUDEBAN's default cap when an account does not declare its own. */
const DEFAULT_MAX_DAILY_TRANSACTIONS = 15;

/** How many bank rows `/radar` is willing to print before truncating. */
const RADAR_MAX_ROWS = 8;

/** Volatility window the macro report extrapolates to, in hours. */
const MACRO_VOLATILITY_WINDOW_HOURS = 2;

/** Selectors `/backtest` falls back to when the operator omits them. */
const DEFAULT_BACKTEST_PAIR = 'USDT/VES';
const DEFAULT_BACKTEST_TIMEFRAME = 'histórico completo';

/**
 * Bank-name fragments that identify the same institution in Binance offer
 * metadata. The operator types free text (`/radar bcv`), while offers spell the
 * bank in many ways ("Banco de Venezuela", "BDV Pago Móvil", "Banesco Pago
 * Móvil"), so the query is expanded before matching.
 */
const BANK_QUERY_TOKENS: Readonly<Record<string, readonly string[]>> = {
  BCV: ['BDV', 'BANCODELAVENEZUELA'],
  BANESCO: ['BANESCO'],
  MERCANTIL: ['MERCANTIL'],
  BANCAMIGA: ['BANCAMIGA'],
  PROVINCIAL: ['PROVINCIAL', 'BBVA'],
  PAGOMOVIL: ['PAGOMOVIL'],
};

/** Canonical institution behind a raw offer/label string, or null when unknown. */
function resolveBankCode(raw: string): string | null {
  const norm = normalizeBank(raw);
  if (!norm) return null;
  if (norm.includes('BANESCO')) return 'BANESCO';
  if (norm.includes('MERCANTIL')) return 'MERCANTIL';
  if (norm.includes('BANCAMIGA')) return 'BANCAMIGA';
  if (norm.includes('PROVINCIAL') || norm.includes('BBVA')) return 'PROVINCIAL';
  if (norm.includes('BANCODELAVENEZUELA') || norm.includes('BDV')) return 'BDV';
  return null;
}

/** Uppercase-and-strip a bank label so matching ignores case, spaces and accents. */
function normalizeBank(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** True when `bank` satisfies the operator's free-text filter. */
function matchesBankFilter(bank: string, query: string | undefined): boolean {
  const normQuery = query ? normalizeBank(query) : '';
  if (!normQuery) return true;
  const row = normalizeBank(bank);
  if (!row) return false;
  const tokens = BANK_QUERY_TOKENS[normQuery] ?? [normQuery];
  if (tokens.some((token) => row.includes(token))) return true;
  const code = resolveBankCode(bank);
  return code !== null && tokens.some((token) => token === code);
}

/** Narrow `DispatchResult.params` to `/radar` options, ignoring foreign payloads. */
function asRadarScanParams(params: SentinelActionParams | undefined): RadarScanParams {
  const source = asRecord(params);
  const out: RadarScanParams = {};
  const bank = source?.['bank'];
  if (typeof bank === 'string' && bank.trim()) out.bank = bank.trim();
  const capital = source?.['capital'];
  if (typeof capital === 'number' && Number.isFinite(capital)) out.capital = capital;
  return out;
}

/** Narrow `DispatchResult.params` to forced reprice prices, or undefined. */
function asRepriceParams(params: SentinelActionParams | undefined): RepriceParams | undefined {
  const source = asRecord(params);
  if (!source) return undefined;
  const buyPrice = source['buyPrice'];
  const sellPrice = source['sellPrice'];
  if (typeof buyPrice !== 'number' || !Number.isFinite(buyPrice)) return undefined;
  if (typeof sellPrice !== 'number' || !Number.isFinite(sellPrice)) return undefined;
  return { buyPrice, sellPrice };
}

/** Narrow `DispatchResult.params` to `/backtest` selectors. */
function asBacktestParams(params: SentinelActionParams | undefined): BacktestRequestParams {
  const source = asRecord(params);
  const out: BacktestRequestParams = {};
  const pair = source?.['pair'];
  if (typeof pair === 'string' && pair.trim()) out.pair = pair.trim();
  const timeframe = source?.['timeframe'];
  if (typeof timeframe === 'string' && timeframe.trim()) out.timeframe = timeframe.trim();
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRecord(value: unknown, key: string): Record<string, unknown> | null {
  return asRecord(asRecord(value)?.[key]);
}

function readNumber(value: unknown, key: string): number {
  const raw = asRecord(value)?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.NaN;
}

function readArray(value: unknown, key: string): unknown[] {
  const raw = asRecord(value)?.[key];
  return Array.isArray(raw) ? raw : [];
}

/**
 * Lee el `description` de un error de la Bot API. Tolera un cuerpo vacío o no
 * JSON: clasificar un fallo nunca puede ser la razón para romper el flujo.
 */
async function readTelegramErrorDescription(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { description?: unknown };
    return typeof data?.description === 'string' ? data.description : '';
  } catch {
    return '';
  }
}

/** Case-insensitive sobre el `description` de la Bot API (`Bad Request: …`). */
function telegramErrorMentions(description: string, needle: string): boolean {
  return description.toLowerCase().includes(needle.toLowerCase());
}

/** Mean ROI across harness cycles; NaN when the harness recorded none. */
function meanCycleRoiPct(cycles: unknown[], leg: 'simulated' | 'recorded'): number {
  const values: number[] = [];
  for (const cycle of cycles) {
    const roiPct = readNumber(readRecord(cycle, leg), 'roiPct');
    if (Number.isFinite(roiPct)) values.push(roiPct);
  }
  if (values.length === 0) return Number.NaN;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Maps the JSON summary written by `scripts/backtest.cjs` onto the W1 report
 * contract. Anything the harness does not compute stays NaN so the formatter
 * renders `n/d` instead of an invented number.
 */
function mapBacktestSummary(
  summary: unknown,
  selection: { pair: string; timeframe: string },
): { report: BacktestReportResult; caveats: string[] } {
  const data = readRecord(summary, 'data');
  const spread = readRecord(summary, 'spreadEngine');
  const triangular = readRecord(summary, 'triangularEngine');
  const cycles = readArray(triangular, 'cycles');
  const pointsEvaluated = readNumber(spread, 'pointsEvaluated');
  const cyclesFound = readNumber(triangular, 'cyclesFound');

  const caveats: string[] = [];
  caveats.push('El simulador no acepta par ni temporalidad por CLI: se ejecutó sobre su dataset local completo');
  if (!Number.isFinite(cyclesFound) || cycles.length === 0) {
    caveats.push('Sin ciclos triangulares en el dataset, las rentabilidades salen como n/d');
  }
  if (Number.isFinite(pointsEvaluated) && pointsEvaluated > 0) {
    const operations = readNumber(data, 'operations');
    caveats.push(
      `Evaluó ${Math.round(pointsEvaluated)} puntos de spread (las operaciones cerradas son ${Number.isFinite(operations) ? Math.round(operations) : 0})`,
    );
  }

  return {
    report: {
      pair: selection.pair,
      timeframe: selection.timeframe,
      trades: Math.max(0, Math.round(readNumber(data, 'operations')) || 0),
      winRatePct: readNumber(spread, 'aciertoNetoPct'),
      avgReturnPct: meanCycleRoiPct(cycles, 'simulated'),
      netReturnPct: meanCycleRoiPct(cycles, 'recorded'),
      // The harness never computes a drawdown curve: report it as unavailable.
      maxDrawdownPct: Number.NaN,
    },
    caveats,
  };
}

@Injectable({ providedIn: 'root' })
export class TelegramWorkerService implements OnDestroy {
  private readonly credentials = inject(CredentialStoreService);
  private readonly toast = inject(ToastService);
  private readonly binance = inject(BinanceP2pService);
  private readonly repricer = inject(BinanceRepricerService);
  private readonly accounts = inject(AccountsService);
  private readonly cotizave = inject(CotizaveService);
  private readonly marketHistory = inject(MarketHistoryService);
  /**
   * El journal, o `null` si el token no está cableado.
   *
   * Esto era un `try { inject(...) } catch { null }` y el `catch` mentía: `DecisionJournalService`
   * es `providedIn: 'root'`, así que pedirlo nunca falla por falta de bridge — un bridge
   * ausente se resuelve ADENTRO del servicio, que degrada a memoria y lo DECLARA en
   * `availability`. La razón del `catch` dejó de ser cierta en `e39ee8c`, y un `catch`
   * que se justifica con una razón imposible es peor que ningún `catch`: seguiría
   * tragándose un fallo de construcción real, que sí es un bug y merece verse.
   *
   * `null` significa una sola cosa ahora: nadie proveyó el token, y no hay journal que
   * leer. El build web NO llega acá: llega con un service degradado, que es el caso que
   * el panel tiene que declarar en vez de esconder.
   */
  private readonly journal = inject(DecisionJournalService, { optional: true });

  readonly config = signal<TelegramConfig>({ ...TELEGRAM_DEFAULTS });
  readonly isPolling = signal<boolean>(false);
  readonly lastHeartbeat = signal<Date | null>(null);
  readonly recentLogs = signal<TelegramLogEntry[]>([]);
  readonly lastInboundChat = signal<{
    chatId: string;
    username?: string;
    firstName?: string;
    receivedAt: Date;
  } | null>(null);

  private abortController: AbortController | null = null;
  private currentOffset = 0;
  /**
   * Selectors from the last `/backtest` confirmation. The W1 callback contract
   * sends a bare `BACKTEST_RUN` (no params), so the worker has to remember what
   * the operator actually asked for between the request and the button press.
   */
  private pendingBacktest: BacktestRequestParams | null = null;

  constructor() {
    void this.hydrateAndStart();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  async getConfig(): Promise<TelegramConfig> {
    const cfg = await this.credentials.getTelegramConfig();
    if (!cfg) return { ...TELEGRAM_DEFAULTS };
    return {
      botToken: cfg.token ?? '',
      chatId: cfg.chatId ?? '',
      alertsEnabled: cfg.alertsEnabled ?? true,
      pollingEnabled: cfg.pollingEnabled ?? false,
    };
  }

  async saveConfig(config: TelegramConfig): Promise<void> {
    const previous = this.config();
    await this.credentials.setTelegramConfig({
      token: config.botToken,
      chatId: config.chatId,
      alertsEnabled: config.alertsEnabled,
      pollingEnabled: config.pollingEnabled,
    });
    this.config.set({ ...config });

    const identityChanged =
      config.botToken !== previous.botToken || config.chatId !== previous.chatId;

    if (config.pollingEnabled && this.isPolling() && identityChanged) {
      // Long-polling activo con un Token/Chat ID distinto: reiniciar el loop
      // para que pollLoop recapture el nuevo authorizedChatId (si no, sigue
      // comparando contra el Chat ID anterior y deniega los mensajes nuevos).
      this.stopPolling();
      this.startPolling();
    } else if (config.pollingEnabled && !this.isPolling()) {
      this.startPolling();
    } else if (!config.pollingEnabled && this.isPolling()) {
      this.stopPolling();
    }
  }

  async getBotInfo(token: string): Promise<TelegramBotInfo | null> {
    const cleanToken = token.trim();
    if (!cleanToken) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        ok: boolean;
        result?: { id: number; username?: string; first_name?: string };
      };
      if (!data.ok || !data.result) return null;
      return {
        id: data.result.id,
        username: data.result.username ?? '',
        firstName: data.result.first_name ?? '',
      };
    } catch {
      return null;
    }
  }

  async detectChatIdFromUpdates(token: string): Promise<TelegramChatDetectionResult> {
    const cleanToken = token.trim();
    if (!cleanToken) {
      return { success: false, error: 'Ingresa primero el Token del Bot.' };
    }

    const botInfo = await this.getBotInfo(cleanToken);
    if (!botInfo) {
      return {
        success: false,
        error:
          'Token inválido o sin respuesta de api.telegram.org. Revisa el token provisto por @BotFather.',
      };
    }

    // Check if an inbound message was already captured in memory by background long-polling
    const cachedChat = this.lastInboundChat();
    if (cachedChat?.chatId) {
      return {
        success: true,
        chatId: cachedChat.chatId,
        username: cachedChat.username,
        firstName: cachedChat.firstName,
        botUsername: botInfo.username,
      };
    }

    // 409 CONFLICT — CONCURRENCY DECISION (documented):
    // getUpdates is a single-consumer API: the Bot API only allows ONE active
    // getUpdates connection per bot. The 24/7 pollLoop keeps a long-poll open with its
    // own `currentOffset`, so an additional getUpdates WITHOUT offset (as a raw
    // `getUpdates?limit=20` would) is rejected by Telegram with HTTP 409
    // "Conflict: terminated by other getUpdates request".
    // Therefore, when polling is RUNNING we never touch getUpdates: the pollLoop is
    // already capturing inbound updates and stores them in `lastInboundChat` (checked
    // above), so a /start pressed by the user will be detected on the next UI retry
    // from cache. We only query getUpdates directly when polling is OFF (the usual
    // first-pairing path, since startPolling requires a chatId that is still unknown).
    if (this.isPolling()) {
      return {
        success: false,
        botUsername: botInfo.username,
        error: `El worker 24/7 ya está escuchando al bot (long-polling activo). Abrí https://t.me/${botInfo.username}, tocá "Iniciar" (/start) y reintentá: el propio worker captura tu chat y lo detectará en el siguiente intento.`,
      };
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${cleanToken}/getUpdates?limit=20`);
      if (!res.ok) {
        return {
          success: false,
          botUsername: botInfo.username,
          error: `Error HTTP ${res.status} al consultar getUpdates.`,
        };
      }

      const data = (await res.json()) as { ok: boolean; result: TelegramInboundUpdate[] };
      if (!data.ok || !Array.isArray(data.result) || data.result.length === 0) {
        return {
          success: false,
          botUsername: botInfo.username,
          error: `No se encontraron mensajes en el bot. Abrí https://t.me/${botInfo.username}, tocá "Iniciar" (/start) y volvé a presionar "Detectar Chat ID".`,
        };
      }

      // Search from newest to oldest update for a valid chat id
      for (let i = data.result.length - 1; i >= 0; i--) {
        const u = data.result[i];
        const chat = u.message?.chat || u.callback_query?.message?.chat;
        const from = u.message?.from || u.callback_query?.from;
        if (chat?.id) {
          const firstName = from && 'first_name' in from ? (from as { first_name?: string }).first_name : undefined;
          return {
            success: true,
            chatId: String(chat.id),
            username: from?.username,
            firstName: firstName || from?.username,
            botUsername: botInfo.username,
          };
        }
      }

      return {
        success: false,
        botUsername: botInfo.username,
        error: `No se detectó ningún chat válido. Escribile /start a @${botInfo.username} en Telegram.`,
      };
    } catch {
      return {
        success: false,
        botUsername: botInfo.username,
        error: 'Error de red al conectar con los servidores de Telegram.',
      };
    }
  }

  startPolling(): void {
    const { botToken, chatId } = this.config();
    if (!botToken || !chatId) {
      this.toast.warn('Configura el Token y Chat ID para activar el Worker de Telegram.');
      return;
    }

    if (this.isPolling()) return;

    this.isPolling.set(true);
    this.abortController = new AbortController();
    void this.pollLoop(botToken, chatId);
    this.toast.success('Telegram Sentinel 2.0 (Worker 24/7) conectado en segundo plano.');
  }

  stopPolling(): void {
    if (!this.isPolling()) return;
    this.isPolling.set(false);
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.toast.info('Worker de Telegram Sentinel pausado.');
  }

  private async hydrateAndStart(): Promise<void> {
    const cfg = await this.credentials.getTelegramConfig();
    if (cfg) {
      this.config.set({
        botToken: cfg.token ?? '',
        chatId: cfg.chatId ?? '',
        alertsEnabled: cfg.alertsEnabled ?? true,
        pollingEnabled: cfg.pollingEnabled ?? false,
      });
    }
    this.restoreOffset();
    const { botToken, chatId, pollingEnabled } = this.config();
    if (botToken && chatId && pollingEnabled) {
      this.startPolling();
    }
  }

  private restoreOffset(): void {
    try {
      const saved = localStorage.getItem(TELEGRAM_OFFSET_STORAGE_KEY);
      if (saved && /^\d+$/.test(saved)) {
        this.currentOffset = Math.max(0, Number(saved));
      }
    } catch {
      // localStorage no disponible
    }
  }

  private persistOffset(): void {
    try {
      localStorage.setItem(TELEGRAM_OFFSET_STORAGE_KEY, String(this.currentOffset));
    } catch {
      // localStorage no disponible
    }
  }

  /**
   * Fetches a live Binance P2P depth (bypassing cache) with a safe timeout.
   * Returns null if the refresh fails or times out — the caller decides to fall back to cache.
   */
  private async getFreshMarketDepth(): Promise<BinanceP2pMarketDepth | null> {
    try {
      return await Promise.race([
        this.binance.fetchMarketDepth('USDT', 'VES', true),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
    } catch {
      return null;
    }
  }

  private formatFetchTime(d: Date | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  }

  private async pollLoop(token: string, authorizedChatId: string): Promise<void> {
    while (this.isPolling()) {
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${this.currentOffset}&timeout=15`;
        const res = await fetch(url, {
          signal: this.abortController?.signal,
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        const data = (await res.json()) as { ok: boolean; result: TelegramInboundUpdate[] };
        if (data.ok && Array.isArray(data.result)) {
          this.lastHeartbeat.set(new Date());
          for (const update of data.result) {
            this.currentOffset = Math.max(this.currentOffset, update.update_id + 1);
            await this.processIncomingUpdate(update, token, authorizedChatId);
          }
          this.persistOffset();
        }
      } catch {
        if (this.abortController?.signal.aborted) {
          break;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }

  private async processIncomingUpdate(
    update: TelegramInboundUpdate,
    token: string,
    authorizedChatId: string,
  ): Promise<void> {
    const chat = update.message?.chat || update.callback_query?.message?.chat;
    const from = update.message?.from || update.callback_query?.from;
    const chatId =
      update.message?.chat.id || update.callback_query?.message?.chat.id || authorizedChatId;

    if (chat?.id) {
      this.lastInboundChat.set({
        chatId: String(chat.id),
        username: from?.username,
        firstName: from && 'first_name' in from ? (from as { first_name?: string }).first_name : undefined,
        receivedAt: new Date(),
      });
    }

    const dispatch = dispatchTelegramUpdate(update, authorizedChatId);
    const timeStr = new Date().toLocaleTimeString('es-VE');

    if (!dispatch.authorized) {
      if (chatId) {
        await this.sendTelegramMessage(token, chatId, dispatch.responseMarkdown);
      }
      this.addLog({
        time: timeStr,
        command: update.message?.text || 'desconocido',
        action: 'DENEGADO',
        status: 'DENIED',
        details: 'Intento de acceso desde Chat ID no autorizado',
      });
      return;
    }

    // 1. Acciones del Despachador
    switch (dispatch.action) {
      case 'KILLSWITCH': {
        this.repricer.stop();
        this.toast.error('KILLSWITCH ACTIVADO REMOTAMENTE DESDE TELEGRAM', 'Seguridad P2P');
        // Un botón del panel no puede emitir un mensaje nuevo: el panel se
        // re-renderiza en el lugar, que es justo lo que el operador pidió.
        if (isPanelCallbackData(update.callback_query?.data)) {
          await this.answerCallbackQuery(token, update.callback_query?.id, 'Motor detenido');
          const outcome = await this.deliverPanel(
            token,
            chatId,
            update.callback_query?.message?.message_id ?? null,
          );
          this.addLog({
            time: timeStr,
            command: 'Panel',
            action: 'KILLSWITCH',
            status: outcome === 'FAILED' ? 'ERROR' : 'SUCCESS',
            details: `detenido desde el panel (${outcome})`,
          });
          break;
        }
        await this.sendTelegramMessage(
          token,
          chatId,
          `🚨 *KILLSWITCH EJECUTADO EN EL TERMINAL*\n\nTodos los procesos de cotización y venta fueron detenidos inmediatamente\\.`,
        );
        this.addLog({
          time: timeStr,
          command: '/killswitch',
          action: 'KILLSWITCH',
          status: 'SUCCESS',
        });
        break;
      }

      case 'RESUME': {
        this.repricer.start();
        this.toast.info('Bot reanudado remotamente desde Telegram', 'Telegram Sentinel');
        if (isPanelCallbackData(update.callback_query?.data)) {
          await this.answerCallbackQuery(token, update.callback_query?.id, 'Motor reanudado');
          const outcome = await this.deliverPanel(
            token,
            chatId,
            update.callback_query?.message?.message_id ?? null,
          );
          this.addLog({
            time: timeStr,
            command: 'Panel',
            action: 'RESUME',
            status: outcome === 'FAILED' ? 'ERROR' : 'SUCCESS',
            details: `reanudado desde el panel (${outcome})`,
          });
          break;
        }
        await this.sendTelegramMessage(
          token,
          chatId,
          `▶ *BOTS REANUDADOS*\n\nEl terminal ha reactivado la cotización supervisada\\.`,
        );
        this.addLog({ time: timeStr, command: '/resume', action: 'RESUME', status: 'SUCCESS' });
        break;
      }

      case 'STATUS': {
        if (dispatch.command === '/start') {
          await this.sendTelegramMessage(token, chatId, dispatch.responseMarkdown);
          this.addLog({ time: timeStr, command: '/start', action: 'STATUS', status: 'SUCCESS' });
          break;
        }

        const freshDepth = await this.getFreshMarketDepth();
        const depth = freshDepth ?? this.binance.marketDepth();
        const journalAudit = await this.readJournalAudit();
        const repricerState = this.repricer.isActive() ? '🟢 ACTIVO' : '⏸ DETENIDO';
        const libroState = depth
          ? freshDepth
            ? 'SINCRONIZADO'
            : '⚠️ SINCRONIZADO (stale)'
          : 'PENDIENTE';
        // La auditoría se formatea con el MISMO formateador puro del panel: el
        // worker no compone texto de auditoría por su cuenta, así que /panel y
        // /status no pueden divergir en el rótulo ni en el escapado. El aviso de
        // journal degradado NO es texto de auditoría, va aparte y también es el
        // mismo en las dos superficies: acá y en el panel.
        const msg = `📊 *ESTADO DEL TERMINAL P2P*\n━━━━━━━━━━━━━━━━━━━━\n• Repricer Bot: *${escapeMarkdownV2(repricerState)}*\n• Modo del Repricer: *${escapeMarkdownV2(this.repricer.executionModeLabel())}*\n• Libro Binance: *${escapeMarkdownV2(libroState)}*\n• Último Ask: \`${depth?.bestBuyPrice ? depth.bestBuyPrice.toFixed(2) : '0'} Bs\`\n• Último Bid: \`${depth?.bestSellPrice ? depth.bestSellPrice.toFixed(2) : '0'} Bs\`\n🕐 Dato de las \`${this.formatFetchTime(this.binance.lastFetched())}\`\n\n${formatJournalAuditLine(journalAudit)}\n\nℹ️ ${escapeMarkdownV2(this.repricer.executionModeDetail())}${this.journalDegradedNotice()}`;
        await this.sendTelegramMessage(token, chatId, msg);
        this.addLog({ time: timeStr, command: '/status', action: 'STATUS', status: 'SUCCESS' });
        break;
      }

      case 'PANEL': {
        // Un tap en un botón no puede dejar el spinner girando: se responde
        // SIEMPRE antes de editar, incluso si la edición después falla.
        await this.answerCallbackQuery(
          token,
          update.callback_query?.id,
          update.callback_query ? 'Panel actualizado' : undefined,
        );

        const panelMessageId = update.callback_query?.message?.message_id ?? null;
        const outcome = await this.deliverPanel(token, chatId, panelMessageId);
        this.addLog({
          time: timeStr,
          command: dispatch.command ?? '/panel',
          action: 'PANEL',
          status: outcome === 'FAILED' ? 'ERROR' : 'SUCCESS',
          details: panelMessageId === null ? `enviado nuevo (${outcome})` : `re-renderizado (${outcome})`,
        });
        break;
      }

      case 'SPREADS': {
        const freshDepth = await this.getFreshMarketDepth();
        const depth = freshDepth ?? this.binance.marketDepth();
        if (depth) {
          const tiempoLine = freshDepth
            ? `🕐 Actualizado: \`${this.formatFetchTime(this.binance.lastFetched())}\` (hora local)`
            : `🕐 Datos de las \`${this.formatFetchTime(this.binance.lastFetched())}\` — pueden estar desactualizados`;
          const msg = `📈 *PUNTAS EN VIVO \\(BINANCE P2P\\)*\n━━━━━━━━━━━━━━━━━━━━\n💵 Compra: \`${depth.bestBuyPrice.toFixed(2)} Bs\`\n💰 Venta: \`${depth.bestSellPrice.toFixed(2)} Bs\`\n⚡ Spread: \`+${depth.spreadPct.toFixed(2)}%\` \\(\`${depth.spreadVes.toFixed(2)} Bs\`\\)\n${tiempoLine}`;
          await this.sendTelegramMessage(token, chatId, msg);
        } else {
          await this.sendTelegramMessage(
            token,
            chatId,
            `⚠️ *Libro en sincronización*, actualiza el panel en unos segundos\\.`,
          );
        }
        this.addLog({ time: timeStr, command: '/spreads', action: 'SPREADS', status: 'SUCCESS' });
        break;
      }

      case 'BCV': {
        const [depth] = await Promise.all([
          this.getFreshMarketDepth(),
          this.cotizave.fetchRates().catch(() => undefined),
        ]);
        const rates = this.cotizave.ratesByMarket();
        const parallel = depth?.bestBuyPrice || rates['binance']?.ask;
        const bcv = rates['bcv']?.mid || rates['oficial']?.mid;

        if (!parallel || !bcv) {
          await this.sendTelegramMessage(
            token,
            chatId,
            `⚠️ *Datos de mercado no disponibles ahora mismo* — abre el panel de spreads o verifica la API key de Cotizave e inténtalo de nuevo\\.`,
          );
          this.addLog({ time: timeStr, command: '/bcv', action: 'BCV', status: 'SUCCESS' });
          break;
        }

        const intel = getBcvMarketIntelligence(parallel, bcv);

        const msg =
          formatBcvIntelligenceTelegramMessage({
            parallelRate: intel.gap.parallelRate,
            bcvRate: intel.gap.bcvRate,
            gapPct: intel.gap.gapPct,
            gapVes: intel.gap.gapVes,
            zone: intel.gap.zone,
            phase: intel.window.phase,
            nextExpectedIntervention: intel.window.nextExpectedIntervention,
            probabilityPct: intel.window.probabilityPct,
            actionLabel: intel.recommendation.actionLabel,
            timingNotice: intel.recommendation.timingNotice,
          }) + `\n🕐 Actualizado: \`${this.formatFetchTime(this.binance.lastFetched())}\``;

        await this.sendTelegramMessage(token, chatId, msg);
        this.addLog({ time: timeStr, command: '/bcv', action: 'BCV', status: 'SUCCESS' });
        break;
      }

      case 'BANCOS': {
        const usages = this.accounts.usages();
        const accountsData = usages.map((u) => ({
          bankName: u.account.bankName,
          spentTodayVes: u.spentTodayVes,
          dailyLimitVes: u.account.dailyLimitVes,
          consumedPct: u.consumedLimitPct,
          txCount: 0,
          maxTx: 20,
          isOverLimit: u.isOverLimit,
        }));

        const msg = formatBankLimitsTelegramMessage(accountsData);
        await this.sendTelegramMessage(token, chatId, msg);
        this.addLog({ time: timeStr, command: '/bancos', action: 'BANCOS', status: 'SUCCESS' });
        break;
      }

      case 'AUDIT_RECEIPT': {
        if (dispatch.fileId) {
          await this.sendTelegramMessage(
            token,
            chatId,
            `🔍 *COMPROBANTE RECIBIDO*: Descargando y procesando extracción OCR\\.\\.\\.`,
          );
          void this.processReceiptFile(token, chatId, dispatch.fileId);
          this.addLog({
            time: timeStr,
            command: 'Foto Comprobante',
            action: 'AUDIT_RECEIPT',
            status: 'SUCCESS',
          });
        }
        break;
      }

      // ---- Operational commands V2 (W1 contract) ----------------------------

      case 'RADAR_SCAN': {
        const params = asRadarScanParams(dispatch.params);
        const depth = await this.getFreshMarketDepth();
        const allRows = depth ? this.buildRadarRows(depth, params.bank, params.capital) : [];
        // Telegram rejects messages over 4096 characters and a full book can produce far
        // more banks than fit, so the report is capped at the widest gaps and says how
        // many it left out.
        const rows = allRows.slice(0, RADAR_MAX_ROWS);
        const dropped = allRows.length - rows.length;
        const notes: string[] = [];
        if (depth) {
          if (dropped > 0) {
            notes.push(
              `Se muestran los ${rows.length} bancos con mayor gap; ${dropped} quedaron fuera del reporte.`,
            );
          }
        } else {
          notes.push('Sin datos en vivo: el libro de Binance no respondió. Se muestran cero oportunidades, no un estimado.');
        }
        const msg =
          formatRadarTelegramMessage(rows, { bank: params.bank, capital: params.capital }) +
          (notes.length > 0
            ? `\nℹ️ ${notes.map((note) => escapeMarkdownV2(note)).join('\nℹ️ ')}`
            : '');
        await this.sendTelegramMessage(token, chatId, msg);
        this.addLog({
          time: timeStr,
          command: dispatch.command ?? '/radar',
          action: 'RADAR_SCAN',
          status: 'SUCCESS',
          details: `${rows.length}/${allRows.length} fila(s) desde ${depth ? 'libro en vivo' : 'sin libro'}`,
        });
        break;
      }

      case 'REPRICE_REQUEST': {
        const params = asRepriceParams(dispatch.params);
        if (!params) {
          await this.sendTelegramMessage(token, chatId, dispatch.responseMarkdown);
          break;
        }
        await this.sendTelegramMessage(
          token,
          chatId,
          formatRepriceTelegramMessage({ ...params, confirmed: false }),
          buildRepriceConfirmationKeyboard(params.buyPrice, params.sellPrice),
        );
        this.addLog({
          time: timeStr,
          command: dispatch.command ?? '/reprecio',
          action: 'REPRICE_REQUEST',
          status: 'SUCCESS',
          details: `pendiente ${params.buyPrice}/${params.sellPrice}`,
        });
        break;
      }

      case 'REPRICE_EXECUTE': {
        // The callback must always be answered first, even if the apply fails:
        // otherwise Telegram leaves the button spinning for 30s.
        await this.answerCallbackQuery(token, update.callback_query?.id, 'Reprice aplicado');
        const params = asRepriceParams(dispatch.params);
        if (!params) {
          await this.sendTelegramMessage(token, chatId, dispatch.responseMarkdown);
          this.addLog({
            time: timeStr,
            command: 'Reprice',
            action: 'REPRICE_EXECUTE',
            status: 'ERROR',
            details: 'Callback sin precios finitos',
          });
          break;
        }

        const previousBuy = this.repricer.currentBuyAdPrice();
        const previousSell = this.repricer.currentSellAdPrice();
        const applied = this.applyForcedReprice(params);
        const state = applied
          ? `📌 *Estado anterior:* \`buy ${previousBuy.toFixed(2)} · sell ${previousSell.toFixed(2)}\``
          : `⚠️ ${escapeMarkdownV2('El motor rechazó los precios forzados: no se modificó la cotización.')}`;

        await this.sendTelegramMessage(
          token,
          chatId,
          formatRepriceTelegramMessage({ ...params, confirmed: applied }) + `\n${state}`,
        );
        this.addLog({
          time: timeStr,
          command: 'Reprice',
          action: 'REPRICE_EXECUTE',
          status: applied ? 'SUCCESS' : 'ERROR',
          details: `${previousBuy}/${previousSell} -> ${params.buyPrice}/${params.sellPrice}`,
        });
        break;
      }

      case 'REPRICE_CANCEL': {
        await this.answerCallbackQuery(token, update.callback_query?.id, 'Reprice cancelado');
        await this.sendTelegramMessage(token, chatId, dispatch.responseMarkdown);
        this.addLog({
          time: timeStr,
          command: 'Reprice',
          action: 'REPRICE_CANCEL',
          status: 'SUCCESS',
          details: `sin cambios (${this.repricer.currentBuyAdPrice().toFixed(2)}/${this.repricer.currentSellAdPrice().toFixed(2)})`,
        });
        break;
      }

      case 'MACRO': {
        const [depth] = await Promise.all([
          this.getFreshMarketDepth(),
          this.cotizave.fetchRates().catch(() => undefined),
        ]);
        const rates = this.cotizave.ratesByMarket();
        const parallel = depth?.bestBuyPrice || rates['binance']?.ask;
        const bcv = rates['bcv']?.mid || rates['oficial']?.mid;

        if (!parallel || !bcv) {
          await this.sendTelegramMessage(
            token,
            chatId,
            `⚠️ *MACRO SIN DATOS EN VIVO*\n\nNo hay tasa BCV ni libro de Binance disponibles. Verifica la API key de Cotizave y sincroniza el panel antes de pedir este reporte\\.`,
          );
          this.addLog({
            time: timeStr,
            command: dispatch.command ?? '/macro',
            action: 'MACRO',
            status: 'SUCCESS',
            details: 'sin tasa BCV o sin libro',
          });
          break;
        }

        const intel = getBcvMarketIntelligence(parallel, bcv);
        const history = this.marketHistory.history();
        const spread = this.resolveAverageSpreadPct(depth);
        const spreadPct = spread.spreadPct;
        const ticks = this.buildPriceTicks();
        const velocity = computeTickVelocity(ticks);
        const forecast = predictTwoHourVolatility({
          recentTicks: ticks,
          currentSpreadPct: Number.isFinite(spreadPct) ? spreadPct : intel.gap.gapPct,
          bcvGap: intel.gap,
          bcvWindow: intel.window,
        });

        const snapshot: MacroIntelSnapshot = {
          bcvRef: intel.gap.bcvRate,
          parallelRef: intel.gap.parallelRate,
          spreadPct,
          // Linearized 2h move from real tick velocity — the forecaster itself
          // returns a 0-100 index, not a percentage.
          volatility2hPct: Number.isFinite(velocity.midPriceVelocityPctPerHour)
            ? Math.abs(velocity.midPriceVelocityPctPerHour) * MACRO_VOLATILITY_WINDOW_HOURS
            : Number.NaN,
          forecastNote: `${forecast.level} · ${forecast.direction} · ${escapeMarkdownV2(forecast.actionableGuidance)} (${history.length} snapshots)`,
        };

        await this.sendTelegramMessage(
          token,
          chatId,
          formatMacroTelegramMessage(snapshot) +
            `\nℹ️ ${escapeMarkdownV2(`Spread: ${spread.source} · Velo 2h: ${MACRO_VOLATILITY_WINDOW_HOURS}h · índice ${forecast.volatilityIndex.toFixed(0)}/100 · confianza ${forecast.confidenceScorePct.toFixed(0)}%`)}`,
        );
        this.addLog({
          time: timeStr,
          command: dispatch.command ?? '/macro',
          action: 'MACRO',
          status: 'SUCCESS',
          details: `gap ${intel.gap.gapPct.toFixed(2)}% · zona ${intel.gap.zone}`,
        });
        break;
      }

      case 'BACKTEST_REQUEST': {
        const params = asBacktestParams(dispatch.params);
        this.pendingBacktest = params;
        const selection = `${params.pair ?? DEFAULT_BACKTEST_PAIR} · ${params.timeframe ?? DEFAULT_BACKTEST_TIMEFRAME}`;
        await this.sendTelegramMessage(
          token,
          chatId,
          `🧪 *BACKTEST HISTÓRICO EN COLA* 🧪\n━━━━━━━━━━━━━━━━━\n⚙️ *Selección:* \`${escapeMarkdownV2(selection)}\`\n⏳ ${escapeMarkdownV2('Confirmá para encolar la simulación: lee el historial local y puede tardar.')}\nℹ️ ${escapeMarkdownV2('El simulador corre sobre su dataset completo; par y temporalidad son etiquetas de referencia.')}`,
          {
            inline_keyboard: [[{ text: '▶ Ejecutar backtest', callback_data: 'BACKTEST_RUN' }]],
          },
        );
        this.addLog({
          time: timeStr,
          command: dispatch.command ?? '/backtest',
          action: 'BACKTEST_REQUEST',
          status: 'SUCCESS',
          details: selection,
        });
        break;
      }

      case 'BACKTEST_EXECUTE': {
        await this.answerCallbackQuery(token, update.callback_query?.id, 'Backtest encolado');
        await this.sendTelegramMessage(token, chatId, dispatch.responseMarkdown);
        const selection = this.pendingBacktest ?? {};
        this.pendingBacktest = null;
        this.addLog({
          time: timeStr,
          command: 'Backtest',
          action: 'BACKTEST_EXECUTE',
          status: 'SUCCESS',
          details: `encolado: ${selection.pair ?? DEFAULT_BACKTEST_PAIR} · ${selection.timeframe ?? DEFAULT_BACKTEST_TIMEFRAME}`,
        });
        // Fire and forget: the poll loop must keep draining getUpdates while the
        // harness runs, so the simulation is never awaited inline.
        void this.runBacktestAndReport(token, chatId, selection);
        break;
      }

      default: {
        if (dispatch.responseMarkdown) {
          await this.sendTelegramMessage(token, chatId, dispatch.responseMarkdown);
        }
      }
    }
  }

  /**
   * Derives one row per bank from the live orderbook: best ask price, the
   * liquidity behind it in USDT (`maxVes / price`), the spread against the same
   * bank's best bid, and the SUDEBAN cap of the matching treasury account.
   * Every field traces back to a real offer — nothing is estimated.
   */
  private buildRadarRows(
    depth: BinanceP2pMarketDepth,
    bankFilter?: string,
    capital?: number,
  ): RadarGapRow[] {
    // Best ask per bank = lowest ask; best bid per bank = highest bid.
    const bestAsk = new Map<string, BinanceOfferSummary>();
    for (const offer of depth.sellOffers ?? []) {
      for (const method of this.offerBankLabels(offer)) {
        const current = bestAsk.get(method);
        if (!current || offer.price < current.price) bestAsk.set(method, offer);
      }
    }
    const bestBid = new Map<string, BinanceOfferSummary>();
    for (const offer of depth.buyOffers ?? []) {
      for (const method of this.offerBankLabels(offer)) {
        const current = bestBid.get(method);
        if (!current || offer.price > current.price) bestBid.set(method, offer);
      }
    }

    const caps = this.resolveTransactionCaps();
    const rows: RadarGapRow[] = [];

    for (const [bank, ask] of bestAsk) {
      if (!matchesBankFilter(bank, bankFilter)) continue;
      if (!Number.isFinite(ask.price) || ask.price <= 0) continue;

      const volumeUsdt = ask.maxVes > 0 ? ask.maxVes / ask.price : 0;
      if (typeof capital === 'number' && Number.isFinite(capital) && volumeUsdt < capital) {
        continue;
      }

      const bid = bestBid.get(bank);
      const spreadPct =
        bid && Number.isFinite(bid.price) && bid.price > 0
          ? ((bid.price - ask.price) / ask.price) * 100
          : Number.NaN;

      rows.push({
        bank,
        price: ask.price,
        maxTc: caps.get(resolveBankCode(bank) ?? normalizeBank(bank)) ?? DEFAULT_MAX_DAILY_TRANSACTIONS,
        volumeUsdt,
        spreadPct,
      });
    }

    // Actionable rows first: widest gap wins, and banks with no matching bid (unknown
    // spread) sink to the bottom instead of interleaving by price.
    rows.sort((a, b) => {
      const aOk = Number.isFinite(a.spreadPct);
      const bOk = Number.isFinite(b.spreadPct);
      if (aOk !== bOk) return aOk ? -1 : 1;
      if (aOk && bOk) {
        const delta = b.spreadPct - a.spreadPct;
        if (delta !== 0) return delta;
      }
      return a.price - b.price;
    });
    return rows;
  }

  /** Offer payment methods, or a single empty-key bucket when unlabelled. */
  private offerBankLabels(offer: BinanceOfferSummary): string[] {
    const methods = (offer.payMethods ?? []).filter(
      (method): method is string => typeof method === 'string' && method.trim().length > 0,
    );
    return methods.length > 0 ? methods : [''];
  }

  /**
   * SUDEBAN daily transaction caps keyed by canonical bank code, taken from the
   * real treasury accounts. The highest configured cap wins so a split pair of
   * accounts (transfer + P2M) is not understated.
   */
  private resolveTransactionCaps(): Map<string, number> {
    const caps = new Map<string, number>();
    for (const usage of this.accounts.usages()) {
      const account = usage.account;
      const declared = account.maxDailyTransactions;
      if (typeof declared !== 'number' || !Number.isFinite(declared)) continue;
      const code = resolveBankCode(account.bankName) ?? resolveBankCode(account.bankCode);
      if (!code) continue;
      const current = caps.get(code);
      if (current === undefined || declared > current) caps.set(code, declared);
    }
    return caps;
  }

  /**
   * Average spread percentage plus where it came from: the mean of the recorded
   * history when present, otherwise the live book spread. The source is reported
   * to the operator so a historical average is never read as a live reading.
   */
  private resolveAverageSpreadPct(
    depth: BinanceP2pMarketDepth | null,
  ): { spreadPct: number; source: string } {
    const spreads = this.marketHistory
      .history()
      .map((point) => point.spreadPct)
      .filter((value) => typeof value === 'number' && Number.isFinite(value));
    if (spreads.length > 0) {
      return {
        spreadPct: spreads.reduce((total, value) => total + value, 0) / spreads.length,
        source: `promedio del historial (${spreads.length} snapshots)`,
      };
    }
    if (depth && Number.isFinite(depth.spreadPct)) {
      return { spreadPct: depth.spreadPct, source: 'libro en vivo' };
    }
    return { spreadPct: Number.NaN, source: 'sin datos de spread' };
  }

  /** Converts the recorded market history into forecaster price ticks. */
  private buildPriceTicks(): PriceTick[] {
    return this.marketHistory
      .history()
      .filter(
        (point) =>
          Number.isFinite(point.bestBuyPrice) &&
          Number.isFinite(point.bestSellPrice) &&
          point.bestBuyPrice > 0 &&
          point.bestSellPrice > 0,
      )
      .map((point) => ({
        timestampMs: Date.parse(point.timestamp),
        buyPrice: point.bestBuyPrice,
        sellPrice: point.bestSellPrice,
      }));
  }

  /**
   * Lee la auditoría del journal sin dejar que un fallo tumbe el panel.
   *
   * `null` es "no hay nada que afirmar acá" y el formateador lo dice con "no
   * disponible". Llega por tres caminos distintos, y este método los cubre a los
   * tres por la misma razón: en ningún caso pinta cifras.
   *
   * El caso degradado es el que más importa acá: un journal en RAM responde TODAS las
   * consultas con éxito, así que sin esta comprobación el panel pintaría las cifras de
   * un almacén que muere con el proceso como si fueran el registro persistido.
   *
   * OJO con lo que este método NO hace: ocultar las cifras no es declarar la causa.
   * "No disponible" y "todo lo que registres se pierde al salir" se leen igual de
   * propósito para el operador, y confundirlos es el hueco que dejó el commit que
   * degrada en silencio. Por eso tapar las cifras (acá) y nombrarlas
   * (`journalDegradedNotice`) están separados: uno protege las cifras, el otro explica.
   *
   * Un journal vacío es otra cosa: trae su propio resumen y el formateador lo distingue.
   */
  private async readJournalAudit(): Promise<VerificationSummary | null> {
    if (!this.journal) return null;
    if (this.journal.availability.degraded) return null;
    try {
      const summary = await this.journal.getVerificationSummary();
      return isPrintableAudit(summary) ? summary : null;
    } catch {
      return null;
    }
  }

  /**
   * La línea que le dice al operador que sus registros se están tirando.
   *
   * Sale del mismo warning que ya separa el libro viejo de la lectura fresca: acá lo
   * que se separa es "no hay nada que leer" de "lo que leas no va a estar mañana".
   *
   * Devuelve `''` (no un bloque condicional) para poder concatenarla siempre: la
   * presencia del aviso la decide `availability`, y el texto es el que declaró el
   * servicio, textual. Lo único que este worker agrega es la etiqueta —con qué marca
   * se dice—, porque la frase es del service: quién lo dice es decisión de la capa de
   * presentación, qué es cierto no lo es.
   *
   * `IN_MEMORY_JOURNAL_REASON` es el piso, no una segunda copia: un journal degradado
   * con razón vacía imprimiría un aviso vacío, que es exactamente el silencio que esto
   * reemplaza.
   */
  private journalDegradedNotice(): string {
    const availability = this.journal?.availability;
    if (!availability?.degraded) return '';
    return `\n\n⚠️ *Journal de decisiones:* ${escapeMarkdownV2(availability.reason || IN_MEMORY_JOURNAL_REASON)}`;
  }

  /**
   * Reúne el estado REAL del terminal para el panel. Cada campo es una lectura
   * concreta: nada se estima. Lo que no existe viaja como `null` / `NaN` para
   * que el formateador lo declare en vez de inventar un precio.
   */
  private async buildPanelReport(): Promise<PanelReport> {
    // El journal y el libro son lecturas independientes: una lenta no tiene por
    // qué frenar a la otra, y un journal colgado no puede quedarse esperando.
    const [freshDepth, journalAudit] = await Promise.all([
      this.getFreshMarketDepth(),
      this.readJournalAudit(),
    ]);
    const depth = freshDepth ?? this.binance.marketDepth();
    // El motor arranca en 0 = "todavía no hay precio". Imprimir `0.00` sería un
    // precio inventado, así que viaja como NaN y el panel lo muestra como n/d.
    const engineBuy = this.repricer.currentBuyAdPrice();
    const engineSell = this.repricer.currentSellAdPrice();

    return {
      executionModeLabel: this.repricer.executionModeLabel(),
      executionModeDetail: this.repricer.executionModeDetail(),
      repricerActive: this.repricer.isActive(),
      repricerBuyPrice: Number.isFinite(engineBuy) && engineBuy > 0 ? engineBuy : Number.NaN,
      repricerSellPrice: Number.isFinite(engineSell) && engineSell > 0 ? engineSell : Number.NaN,
      market: depth
        ? {
            bestBuyPrice: depth.bestBuyPrice,
            bestSellPrice: depth.bestSellPrice,
            spreadPct: depth.spreadPct,
            spreadVes: depth.spreadVes,
          }
        : null,
      fetchedAt: this.formatFetchTime(this.binance.lastFetched()),
      // Sin lectura fresca lo mostrado viene de caché y puede estar viejo: el
      // panel lo declara en vez de presentarlo como lectura de este momento.
      marketStale: !freshDepth,
      journalAudit,
    };
  }

  /**
   * Entrega el panel: lo re-renderiza en el lugar cuando el mensaje sigue vivo
   * y cae a un envío nuevo cuando ya no existe.
   *
   * `messageId` es SIEMPRE `callback_query.message.message_id`: ese mensaje ES el
   * panel, así que no hay id por chat que recordar ni estado que pueda quedar
   * viejo. `null` significa "no hay mensaje que editar": se envía uno nuevo.
   */
  private async deliverPanel(
    token: string,
    chatId: number | string,
    messageId: number | null,
  ): Promise<TelegramEditOutcome | 'SENT'> {
    const report = await this.buildPanelReport();
    // El aviso va pegado al cuerpo del panel, no dentro de él: el formateador puro es
    // el dueño del panel y no se le mete texto encima. Encadenarlo lo deja entero, y el
    // formateador no necesita saber que existe esta situación.
    const text = `${formatPanelTelegramMessage(report)}${this.journalDegradedNotice()}`;
    const keyboard = buildPanelKeyboard();

    if (messageId === null) {
      return (await this.sendTelegramMessage(token, chatId, text, keyboard)) ? 'SENT' : 'FAILED';
    }

    const outcome = await this.editTelegramMessage(token, chatId, messageId, text, keyboard);
    if (outcome === 'NOT_FOUND') {
      // El mensaje fue borrado: mandar un panel nuevo es la recuperación honesta.
      return (await this.sendTelegramMessage(token, chatId, text, keyboard)) ? 'SENT' : 'FAILED';
    }
    return outcome;
  }

  /**
   * Applies the operator's forced prices to the repricer engine.
   *
   * The engine has no separate "force" API: `currentBuyAdPrice` /
   * `currentSellAdPrice` *are* its live ad prices and are what the next
   * `executeCycle()` evaluates against. Deliberately no cycle is run here — an
   * automatic evaluation would immediately overwrite the manual override.
   */
  private applyForcedReprice(params: RepriceParams): boolean {
    try {
      this.repricer.currentBuyAdPrice.set(params.buyPrice);
      this.repricer.currentSellAdPrice.set(params.sellPrice);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Runs the historical harness through the desktop bridge and reports back.
   * Always resolves: a failing or missing harness is reported, never thrown.
   */
  private async runBacktestAndReport(
    token: string,
    chatId: number | string,
    selection: BacktestRequestParams,
  ): Promise<void> {
    const pair = selection.pair ?? DEFAULT_BACKTEST_PAIR;
    const timeframe = selection.timeframe ?? DEFAULT_BACKTEST_TIMEFRAME;
    const bridge = this.electronBacktestBridge();

    if (!bridge) {
      await this.sendTelegramMessage(
        token,
        chatId,
        `⚠️ *BACKTEST NO DISPONIBLE*\n\nEl simulador requiere la app de escritorio: el navegador no puede lanzar Node\\. Ejecutá \`/backtest\` desde la app de escritorio\\.`,
      );
      return;
    }

    try {
      const result = await bridge.run({ pair, timeframe });
      if (!result || result.ok !== true) {
        const reason =
          (result && typeof result.error === 'string' && result.error) ||
          'el simulador no devolvió un informe';
        await this.sendTelegramMessage(
          token,
          chatId,
          `⚠️ *BACKTEST NO DISPONIBLE*\n\n${escapeMarkdownV2(reason)}`,
        );
        return;
      }

      const mapped = mapBacktestSummary(result.summary, { pair, timeframe });
      const caveats = mapped.caveats.map((line) => `ℹ️ ${escapeMarkdownV2(line)}`).join('\n');
      await this.sendTelegramMessage(
        token,
        chatId,
        `${formatBacktestTelegramMessage(mapped.report)}\n${caveats}` +
          (result.summaryPath
            ? `\n📄 ${escapeMarkdownV2(`Informe: ${result.summaryPath}`)}`
            : ''),
      );
    } catch {
      await this.sendTelegramMessage(
        token,
        chatId,
        `⚠️ *BACKTEST NO DISPONIBLE*\n\n${escapeMarkdownV2('El simulador histórico falló al ejecutarse. Revisa la terminal.')}`,
      );
    }
  }

  /** The preload-exposed backtest runner, or null outside the desktop shell. */
  private electronBacktestBridge(): { run: (options: unknown) => Promise<BacktestBridgeResult> } | null {
    const shell = (globalThis as unknown as Record<string, unknown>)['electron'];
    const backtest = asRecord(asRecord(shell)?.['backtest']);
    const run = backtest?.['run'];
    if (typeof run !== 'function') return null;
    return { run: run as (options: unknown) => Promise<BacktestBridgeResult> };
  }

  private async processReceiptFile(
    token: string,
    chatId: number | string,
    fileId: string,
  ): Promise<void> {
    try {
      // 1. Obtener la ruta del archivo desde Telegram API
      const fileMetaRes = await fetch(
        `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`,
      );
      if (!fileMetaRes.ok) throw new Error('No se pudo obtener el archivo de Telegram');
      const fileMeta = (await fileMetaRes.json()) as { ok: boolean; result: { file_path: string } };

      const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileMeta.result.file_path}`;

      // 2. Ejecutar OCR con Tesseract
      const ocrResult = await Tesseract.recognize(downloadUrl, 'spa+eng');
      const text = ocrResult.data.text;

      // 3. Parsear datos bancarios
      const parsed = parseBankReceiptText(text);

      // 4. Evaluar riesgo con Escudo Anti-Fraude
      const audit = evaluateFraudRisk({
        orderId: `TG-${Date.now().toString().slice(-6)}`,
        orderAmount: parsed.amount,
        orderCurrency: parsed.currency,
        advertiserVerifiedName: parsed.payerName || 'Verificación Móvil',
        receipt: parsed,
      });

      // 5. Enviar tarjeta formateada a Telegram
      const msg = formatReceiptAuditTelegramMessage({
        receiptNumber: parsed.reference,
        bank: parsed.bank,
        amountVes: parsed.amount,
        extractedName: parsed.payerName || 'No detectado',
        counterpartyName: 'Auditoría Móvil Telegram',
        nameSimilarityPct: audit.nameMatch.score * 100,
        score: audit.overallScore,
        level: audit.riskLevel,
        recommendation:
          audit.riskLevel === 'SAFE'
            ? 'Pago consistente. Seguro para liberar.'
            : 'Posible discrepancia de datos. Verifica en tu banca en línea antes de liberar.',
      });

      await this.sendTelegramMessage(token, chatId, msg);
    } catch {
      const errorMsg = `⚠️ *ERROR AL AUDITAR COMPROBANTE*: No se pudo extraer el texto o conectar con la imagen\\.`;
      await this.sendTelegramMessage(token, chatId, errorMsg);
    }
  }

  /**
   * Answers a Telegram callback query so the button stops spinning.
   * Best effort: a failed ack must never abort the command the operator asked for.
   */
  async answerCallbackQuery(
    token: string,
    callbackQueryId: string | undefined,
    text?: string,
  ): Promise<boolean> {
    if (!callbackQueryId) return false;
    try {
      const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
      if (text) body['text'] = text.slice(0, 190);
      const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async sendTelegramMessage(
    token: string,
    chatId: number | string,
    markdownText: string,
    keyboard?: TelegramInlineKeyboardMarkup,
  ): Promise<boolean> {
    try {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: markdownText,
        parse_mode: 'MarkdownV2',
      };
      if (keyboard) {
        body['reply_markup'] = keyboard;
      }

      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Ability de editar un mensaje en el lugar (`editMessageText`).
   *
   * Devuelve el motivo del fallo en vez de un booleano, porque los dos finales
   * 400 habituales exigen respuestas distintas: `message is not modified`
   * es éxito silencioso, `message to edit not found` se recupera enviando un
   * panel nuevo, y cualquier otra cosa sí es un error.
   *
   * Nunca se desreferencia el cuerpo de la respuesta: `editMessageText` devuelve
   * el Message, o `true` cuando el mensaje fue enviado desde modo inline, así que
   * asumir la forma del resultado rompería justo en el caso que la API no
   * garantiza.
   */
  async editTelegramMessage(
    token: string,
    chatId: number | string,
    messageId: number,
    markdownText: string,
    keyboard?: TelegramInlineKeyboardMarkup,
  ): Promise<TelegramEditOutcome> {
    try {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        message_id: messageId,
        text: markdownText,
        parse_mode: 'MarkdownV2',
      };
      if (keyboard) {
        body['reply_markup'] = keyboard;
      }

      const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) return 'EDITED';

      const description = await readTelegramErrorDescription(res);
      if (telegramErrorMentions(description, 'message is not modified')) return 'UNCHANGED';
      if (telegramErrorMentions(description, 'message to edit not found')) return 'NOT_FOUND';
      return 'FAILED';
    } catch {
      return 'FAILED';
    }
  }

  private addLog(entry: TelegramLogEntry): void {
    const logs = [entry, ...this.recentLogs()].slice(0, 15);
    this.recentLogs.set(logs);
  }
}
