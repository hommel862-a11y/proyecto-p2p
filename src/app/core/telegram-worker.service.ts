import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { BinanceP2pService } from './binance-p2p.service';
import { BinanceRepricerService } from './binance-repricer.service';
import { AccountsService } from './accounts.service';
import { CotizaveService } from './cotizave.service';
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
  type BinanceP2pMarketDepth,
  type TelegramInboundUpdate,
  type TelegramInlineKeyboardMarkup,
} from '@p2p/core';
import Tesseract from 'tesseract.js';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  alertsEnabled: boolean;
  pollingEnabled?: boolean;
}

export interface TelegramLogEntry {
  time: string;
  command: string;
  action: string;
  status: 'SUCCESS' | 'DENIED' | 'ERROR';
  details?: string;
}

const TELEGRAM_DEFAULTS: TelegramConfig = {
  botToken: '',
  chatId: '',
  alertsEnabled: true,
  pollingEnabled: false,
};

const TELEGRAM_OFFSET_STORAGE_KEY = 'p2p_telegram_offset';

@Injectable({ providedIn: 'root' })
export class TelegramWorkerService implements OnDestroy {
  private readonly credentials = inject(CredentialStoreService);
  private readonly toast = inject(ToastService);
  private readonly binance = inject(BinanceP2pService);
  private readonly repricer = inject(BinanceRepricerService);
  private readonly accounts = inject(AccountsService);
  private readonly cotizave = inject(CotizaveService);

  readonly config = signal<TelegramConfig>({ ...TELEGRAM_DEFAULTS });
  readonly isPolling = signal<boolean>(false);
  readonly lastHeartbeat = signal<Date | null>(null);
  readonly recentLogs = signal<TelegramLogEntry[]>([]);

  private abortController: AbortController | null = null;
  private currentOffset = 0;

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
    await this.credentials.setTelegramConfig({
      token: config.botToken,
      chatId: config.chatId,
      alertsEnabled: config.alertsEnabled,
      pollingEnabled: config.pollingEnabled,
    });
    this.config.set({ ...config });
    if (config.pollingEnabled && !this.isPolling()) {
      this.startPolling();
    } else if (!config.pollingEnabled && this.isPolling()) {
      this.stopPolling();
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
    const dispatch = dispatchTelegramUpdate(update, authorizedChatId);
    const timeStr = new Date().toLocaleTimeString('es-VE');

    if (!dispatch.authorized) {
      this.addLog({
        time: timeStr,
        command: update.message?.text || 'desconocido',
        action: 'DENEGADO',
        status: 'DENIED',
        details: 'Intento de acceso desde Chat ID no autorizado',
      });
      return;
    }

    const chatId =
      update.message?.chat.id || update.callback_query?.message?.chat.id || authorizedChatId;

    // 1. Acciones del Despachador
    switch (dispatch.action) {
      case 'KILLSWITCH': {
        this.repricer.stop();
        this.toast.error('KILLSWITCH ACTIVADO REMOTAMENTE DESDE TELEGRAM', 'Seguridad P2P');
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
        await this.sendTelegramMessage(
          token,
          chatId,
          `▶ *BOTS REANUDADOS*\n\nEl terminal ha reactivado la cotización supervisada\\.`,
        );
        this.addLog({ time: timeStr, command: '/resume', action: 'RESUME', status: 'SUCCESS' });
        break;
      }

      case 'STATUS': {
        const freshDepth = await this.getFreshMarketDepth();
        const depth = freshDepth ?? this.binance.marketDepth();
        const repricerState = this.repricer.isActive() ? '🟢 ACTIVO' : '⏸ DETENIDO';
        const libroState = depth
          ? freshDepth
            ? 'SINCRONIZADO'
            : '⚠️ SINCRONIZADO (stale)'
          : 'PENDIENTE';
        const msg = `📊 *ESTADO DEL TERMINAL P2P*\n━━━━━━━━━━━━━━━━━━━━\n• Repricer Bot: *${escapeMarkdownV2(repricerState)}*\n• Libro Binance: *${escapeMarkdownV2(libroState)}*\n• Último Ask: \`${depth?.bestBuyPrice ? depth.bestBuyPrice.toFixed(2) : '0'} Bs\`\n• Último Bid: \`${depth?.bestSellPrice ? depth.bestSellPrice.toFixed(2) : '0'} Bs\`\n🕐 Dato de las \`${this.formatFetchTime(this.binance.lastFetched())}\``;
        await this.sendTelegramMessage(token, chatId, msg);
        this.addLog({ time: timeStr, command: '/status', action: 'STATUS', status: 'SUCCESS' });
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

      default: {
        if (dispatch.responseMarkdown) {
          await this.sendTelegramMessage(token, chatId, dispatch.responseMarkdown);
        }
      }
    }
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

  private addLog(entry: TelegramLogEntry): void {
    const logs = [entry, ...this.recentLogs()].slice(0, 15);
    this.recentLogs.set(logs);
  }
}
