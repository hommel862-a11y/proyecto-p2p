import dotenv from 'dotenv';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IS_TEST_IMPORT =
  process.env['TELEGRAM_DAEMON_TEST_IMPORT'] === 'true' || Boolean(process.env['VITEST']);

// Load .env from cwd, packages/telegram-daemon or deploy/vps
if (!IS_TEST_IMPORT) {
  dotenv.config();
  const potentialEnvPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'packages/telegram-daemon/.env'),
    path.resolve(process.cwd(), 'deploy/vps/.env'),
  ];
  for (const envPath of potentialEnvPaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }
}
import {
  dispatchTelegramUpdate,
  formatReceiptAuditTelegramMessage,
  formatBcvIntelligenceTelegramMessage,
  formatBankLimitsTelegramMessage,
  parseBankReceiptText,
  detectBankType,
  type BankType,
  evaluateFraudRisk,
  getBcvMarketIntelligence,
  escapeMarkdownV2,
  formatRadarTelegramMessage,
  formatRadarAltaDemandaTelegramMessage,
  formatMacroTelegramMessage,
  formatBacktestTelegramMessage,
  formatRepriceTelegramMessage,
  buildRepriceConfirmationKeyboard,
  buildSentinelReplyKeyboard,
  formatPanelTelegramMessage,
  buildPanelKeyboard,
  isPanelCallbackData,
  computeMarketDepth,
  computeHighDemandScan,
  predictTwoHourVolatility,
  computeTickVelocity,
  type BinanceP2pMarketDepth,
  type BinanceP2pRawItem,
  type BacktestReportResult,
  type BacktestRequestParams,
  type MacroIntelSnapshot,
  type PanelReport,
  type PriceTick,
  type RadarGapRow,
  type RadarScanParams,
  type RadarAltaDemandaParams,
  type RepriceParams,
  type AutoRepriceParams,
  type SentinelActionParams,
  type PlanActionParams,
  type StrategyPlanTelegramCard,
  formatStrategyPlanTelegramMessage,
  buildPlanApprovalKeyboard,
  evaluateFxBankDeskPlan,
  evaluateVenezuelanFxWindow,
  formatFxDeskTelegramMessage,
  buildFxDeskTelegramKeyboard,
  VENEZUELAN_FX_BANKS,
  FX_EXIT_RAIL_OPTIONS,
  VEN_DEFAULT_IGTF_PCT,
  roundMoney,
  type FxDeskActionParams,
  type FxBoughtCallbackParams,
  type FxEmptyCallbackParams,
  type FxInterventionBankId,
  type TelegramInboundUpdate,
  type TelegramInlineKeyboardMarkup,
  type TelegramReplyKeyboardMarkup,
} from '@p2p/core';
import { MicrostructureDataLake } from './data-lake';
import { RepricerEngine } from './repricer-engine';
import { CloudAiProxyService } from './ai-proxy';
import { EncryptedSyncStore } from './sync-store';
import {
  handleTelegramCloserCommand,
  buildTelegramPreCallBriefingCard,
} from './arm-closer-bridge';

// Configuration from Environment Variables
const BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN']?.trim() || '';
const AUTHORIZED_CHAT_ID = process.env['TELEGRAM_CHAT_ID']?.trim() || '';
const COTIZAVE_API_KEY = process.env['COTIZAVE_API_KEY']?.trim() || '';
const POLL_INTERVAL_MS = Number(process.env['POLL_INTERVAL_MS']) || 2000;
const ALPHA_SCAN_INTERVAL_SEC = Number(process.env['ALPHA_SCAN_INTERVAL_SEC']) || 15;
const MIN_NET_SPREAD_PCT = Number(process.env['MIN_NET_SPREAD_PCT']) || 1.0;
const HTTP_PORT = Number(process.env['PORT']) || 3000;
const ELECTRON_BRIDGE_URL = process.env['ELECTRON_BRIDGE_URL']?.trim() || 'http://127.0.0.1:51857';
const ELECTRON_BRIDGE_TOKEN = process.env['ELECTRON_BRIDGE_TOKEN']?.trim() || '';
const INBOUND_GATEWAY_URL = process.env['INBOUND_GATEWAY_URL']?.trim() || 'http://inbound-gateway:3030';

function buildElectronBridgeHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ELECTRON_BRIDGE_TOKEN) {
    headers['X-P2P-Bridge-Token'] = ELECTRON_BRIDGE_TOKEN;
  }
  return headers;
}

const COPILOT_SYSTEM_PROMPT = `Sos el Copiloto Estratega de Arbitraje P2P Institucional (P2P Decisor).
Tu rol es asistir a operadores profesionales de mesa de cambio con análisis cuantitativo riguroso, microestructura de mercado, arbitraje P2P (VES/USDT), triangulaciones, tasas BCV e identificación de riesgos.
REGLAS ESTRICTAS:
1. NUNCA inventes números ni tasas. Si no tenés una cifra de mercado, indicalo claramente ("N/D").
2. Pensá siempre en términos de disciplina institucional: spread neto (descontando comisiones Maker/Taker de 0.35%), límites bancarios SUDEBAN y preservación de capital.
3. Sé conciso, profesional y directo.`;

// In-memory cache for proposed strategy plans
const pendingPlans = new Map<string, StrategyPlanTelegramCard>();

// Helper functions for Electron Orchestrator Bridge
async function isElectronBridgeOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${ELECTRON_BRIDGE_URL}/api/orchestrator/status`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function callElectronChat(prompt: string, history?: any[]): Promise<{ text: string; suggestedPlan?: any } | null> {
  try {
    const res = await fetch(`${ELECTRON_BRIDGE_URL}/api/orchestrator/chat`, {
      method: 'POST',
      headers: buildElectronBridgeHeaders(),
      body: JSON.stringify({ prompt, history }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function callElectronPlan(capitalUsdt?: number, bank?: string): Promise<{ plan?: any; analysis?: string } | null> {
  try {
    const res = await fetch(`${ELECTRON_BRIDGE_URL}/api/orchestrator/plan`, {
      method: 'POST',
      headers: buildElectronBridgeHeaders(),
      body: JSON.stringify({ capitalUsdt, bank }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function callElectronExecutePlan(planId: string): Promise<{ success: boolean; error?: string; riskWarnings?: string[] } | null> {
  try {
    const res = await fetch(`${ELECTRON_BRIDGE_URL}/api/orchestrator/execute-plan`, {
      method: 'POST',
      headers: buildElectronBridgeHeaders(),
      body: JSON.stringify({ planId }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function callElectronKillswitch(action: 'trigger' | 'reset', reason?: string): Promise<boolean> {
  try {
    const res = await fetch(`${ELECTRON_BRIDGE_URL}/api/orchestrator/killswitch`, {
      method: 'POST',
      headers: buildElectronBridgeHeaders(),
      body: JSON.stringify({ action, reason }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function mapBankToPayType(bankName: string): string[] {
  const norm = bankName.toLowerCase().trim();
  if (norm.includes('banesco')) return ['Banesco'];
  if (norm.includes('mercantil')) return ['Mercantil'];
  if (norm.includes('bdv') || norm.includes('venezuela')) return ['BancoDeVenezuela'];
  if (norm.includes('bancamiga')) return ['Bancamiga'];
  if (norm.includes('provincial') || norm.includes('bbva')) return ['BBVAProvincial'];
  if (norm.includes('pago') || norm.includes('movil')) return ['PagoMovil'];
  if (norm.includes('bnc')) return ['BancoNacionalDeCredito'];
  return [];
}

const OFFSET_FILE = path.resolve(process.cwd(), '.telegram_offset');

function loadStoredOffset(): number {
  try {
    if (fs.existsSync(OFFSET_FILE)) {
      const data = fs.readFileSync(OFFSET_FILE, 'utf-8').trim();
      const num = Number(data);
      if (!Number.isNaN(num) && num > 0) return num;
    }
  } catch {
    // Ignore error
  }
  return 0;
}

function saveStoredOffset(offset: number): void {
  try {
    fs.writeFileSync(OFFSET_FILE, String(offset), 'utf-8');
  } catch {
    // Ignore error
  }
}

// Instantiate Microstructure Data Lake, Repricer Engine, AI Proxy & Encrypted Sync Store
const dataLake = new MicrostructureDataLake();
const repricerEngine = new RepricerEngine({
  enabled: process.env['AUTOREPRICE_ENABLED'] === 'true',
  baseMinSpreadPct: Number(process.env['AUTOREPRICE_MIN_SPREAD_PCT']) || 0.6,
  breakEvenSellPrice: Number(process.env['AUTOREPRICE_BREAKEVEN_PRICE']) || 0,
});
const aiProxy = new CloudAiProxyService();
const syncStore = new EncryptedSyncStore(
  IS_TEST_IMPORT ? path.join(os.tmpdir(), `p2p-daemon-test-sync-${process.pid}.json`) : undefined,
);

// Live Data Fetchers
async function fetchBinanceSide(
  tradeType: 'BUY' | 'SELL',
  asset = 'USDT',
  fiat = 'VES',
  payTypes: string[] = [],
): Promise<BinanceP2pRawItem[]> {
  try {
    const res = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        asset,
        fiat,
        tradeType,
        page: 1,
        rows: 20,
        payTypes,
        publisherType: null,
      }),
    });
    if (!res.ok) {
      console.warn(`[Daemon] Binance HTTP ${res.status} al consultar ${tradeType}`);
      return [];
    }
    const json = (await res.json()) as { data?: BinanceP2pRawItem[] };
    if (!json.data || !Array.isArray(json.data)) return [];
    return json.data;
  } catch (err) {
    console.error(`[Daemon] Error fetching Binance ${tradeType}:`, err);
    return [];
  }
}

async function fetchLiveMarketDepth(): Promise<BinanceP2pMarketDepth | null> {
  try {
    const [buyOffers, sellOffers] = await Promise.all([
      fetchBinanceSide('BUY'),
      fetchBinanceSide('SELL'),
    ]);
    if (buyOffers.length === 0 && sellOffers.length === 0) return null;
    return computeMarketDepth(buyOffers, sellOffers);
  } catch {
    return null;
  }
}

async function fetchCotizaveRates(apiKeyOverride?: string): Promise<any | null> {
  const apiKey = apiKeyOverride?.trim() || COTIZAVE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.cotizave.com/v1/fx/rates', {
      headers: {
        'X-API-Key': apiKey,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Telegram Sender API
async function sendTelegramMessage(
  token: string,
  chatId: string | number,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup,
): Promise<boolean> {
  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'MarkdownV2',
    };
    if (replyMarkup) {
      payload['reply_markup'] = replyMarkup;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[Daemon] Telegram API Error: ${res.status} - ${errBody}`);
      // Fallback: send as plain text without MarkdownV2 if parse error
      if (errBody.includes("can't parse entities") || res.status === 400) {
        const plainPayload: Record<string, unknown> = {
          chat_id: chatId,
          text: text.replace(/\\/g, '').replace(/[*_`]/g, ''),
        };
        if (replyMarkup) plainPayload['reply_markup'] = replyMarkup;
        const retryRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(plainPayload),
        });
        return retryRes.ok;
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Daemon] Error sending Telegram message:', err);
    return false;
  }
}

async function answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function clearTelegramInlineKeyboard(
  token: string,
  chatId: string | number,
  messageId: number,
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Mesa Cambiaria BCV Anti-Replay Nonces & 30m Cooldown State ───

const DAEMON_FX_NONCE_TTL_MS = 15 * 60 * 1000;
const DAEMON_FX_DEPLETED_TTL_MS = 30 * 60 * 1000;
const DAEMON_FX_HMAC_SECRET = crypto.randomBytes(32);

interface PendingDaemonFxNonce {
  readonly bankId: FxInterventionBankId;
  readonly orderUsd: number;
  readonly mac: string;
  readonly expiresAtMs: number;
}

const pendingDaemonFxNonces = new Map<string, PendingDaemonFxNonce>();
const consumedDaemonFxKeys = new Set<string>();
const daemonFxDepletedUntilMs = new Map<FxInterventionBankId, number>();

export function issueDaemonFxBoughtNonce(bankId: FxInterventionBankId, orderUsd: number): string {
  const now = Date.now();
  for (const [k, v] of pendingDaemonFxNonces.entries()) {
    if (v.expiresAtMs <= now) {
      pendingDaemonFxNonces.delete(k);
    }
  }
  const normalizedUsd = roundMoney(orderUsd, 2);
  const nonce = crypto.randomBytes(6).toString('hex');
  const mac = crypto
    .createHmac('sha256', DAEMON_FX_HMAC_SECRET)
    .update(`${nonce}:${bankId}:${normalizedUsd}`)
    .digest('hex');
  pendingDaemonFxNonces.set(nonce, {
    bankId,
    orderUsd: normalizedUsd,
    mac,
    expiresAtMs: now + DAEMON_FX_NONCE_TTL_MS,
  });
  return nonce;
}

export function validateAndConsumeDaemonFxBoughtNonce(
  nonce: string | undefined,
  bankId: FxInterventionBankId,
  orderUsd: number,
  dedupKey: string,
): boolean {
  if (!nonce || consumedDaemonFxKeys.has(dedupKey) || consumedDaemonFxKeys.has(`nonce:${nonce}`)) {
    return false;
  }
  const entry = pendingDaemonFxNonces.get(nonce);
  if (!entry) return false;

  const now = Date.now();
  if (entry.expiresAtMs <= now) {
    pendingDaemonFxNonces.delete(nonce);
    return false;
  }

  const normalizedUsd = roundMoney(orderUsd, 2);
  if (entry.bankId !== bankId || Math.abs(entry.orderUsd - normalizedUsd) > 0.01) {
    return false;
  }

  const expectedMac = crypto
    .createHmac('sha256', DAEMON_FX_HMAC_SECRET)
    .update(`${nonce}:${bankId}:${normalizedUsd}`)
    .digest('hex');
  const a = Buffer.from(entry.mac, 'hex');
  const b = Buffer.from(expectedMac, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return false;
  }

  pendingDaemonFxNonces.delete(nonce);
  consumedDaemonFxKeys.add(dedupKey);
  consumedDaemonFxKeys.add(`nonce:${nonce}`);
  if (consumedDaemonFxKeys.size > 500) {
    const oldest = consumedDaemonFxKeys.values().next().value;
    if (oldest) consumedDaemonFxKeys.delete(oldest);
  }
  return true;
}

export function markDaemonFxBankDepleted(bankId: FxInterventionBankId, nowMs = Date.now()): void {
  daemonFxDepletedUntilMs.set(bankId, nowMs + DAEMON_FX_DEPLETED_TTL_MS);
}

export function getActiveDaemonFxDepletedBanks(nowMs = Date.now()): FxInterventionBankId[] {
  const active: FxInterventionBankId[] = [];
  for (const [bankId, untilMs] of daemonFxDepletedUntilMs.entries()) {
    if (untilMs > nowMs) {
      active.push(bankId);
    } else {
      daemonFxDepletedUntilMs.delete(bankId);
    }
  }
  return active;
}

export function resetDaemonFxStateForTesting(): void {
  pendingDaemonFxNonces.clear();
  consumedDaemonFxKeys.clear();
  daemonFxDepletedUntilMs.clear();
}

// ─── HTTP Bearer Auth & Finanzas 360 Telegram Command Routing ───

const CASHEA_LEVEL_INITIAL_PCT: Record<number, number> = {
  1: 60,
  2: 50,
  3: 40,
  4: 40,
  5: 40,
  6: 40,
};

export function isProtectedDaemonEndpoint(pathname: string): boolean {
  return (
    pathname === '/api/ai/chat' ||
    pathname === '/api/sync' ||
    pathname.startsWith('/api/sync/')
  );
}

/**
 * Constant-time Bearer token verification using SHA-256 + `crypto.timingSafeEqual`.
 * When `expectedToken` is empty, Bearer auth is optional and passes through.
 */
export function verifyDaemonBearerAuth(
  authHeader: string | string[] | undefined,
  expectedToken: string,
): boolean {
  const cleanExpected = expectedToken.trim();
  if (!cleanExpected) return true;
  if (typeof authHeader !== 'string') return false;

  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!match || !match[1]) return false;

  const providedHash = crypto.createHash('sha256').update(match[1], 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(cleanExpected, 'utf8').digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
}

function parseStrictPositiveAmount(rawToken: string | undefined): number | null {
  if (!rawToken) return null;
  const trimmed = rawToken.trim();
  const match = /^\$?(\d+(?:[.,]\d{1,2})?)$/.exec(trimmed);
  if (!match || !match[1]) return null;
  const numeric = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 100) / 100;
}

export interface ParsedF360Command {
  isF360Command: boolean;
  valid: boolean;
  command?: 'expense' | 'income' | 'cashea' | 'summary';
  payload?: Record<string, unknown>;
  replyMarkdown: string;
}

function escapeInlineCode(text: string): string {
  return text.replace(/([`\\])/g, '\\$1');
}

export function parseFinance360TelegramCommand(rawText: string): ParsedF360Command {
  const trimmed = rawText.trim();
  const matchPrefix = /^(#gasto|#ingreso|#cashea|#resumen|#360|\/360|\/finanzas)(?:\s+([\s\S]*))?$/i.exec(
    trimmed,
  );
  if (!matchPrefix || !matchPrefix[1]) {
    return { isF360Command: false, valid: false, replyMarkdown: '' };
  }

  const trigger = matchPrefix[1].toLowerCase();
  const argsRaw = (matchPrefix[2] || '').trim();
  const parts = argsRaw ? argsRaw.split(/\s+/) : [];

  if (trigger === '#resumen' || trigger === '#360' || trigger === '/360' || trigger === '/finanzas') {
    return {
      isF360Command: true,
      valid: true,
      command: 'summary',
      payload: { trigger },
      replyMarkdown:
        `*Finanzas 360*\n\n` +
        `${escapeMarkdownV2('Comandos disponibles para el libro de Finanzas 360:')}\n` +
        `• \`#gasto 25 USD Gasolina pyme\`\n` +
        `• \`#ingreso 200 USD Cobro servicio pyme\`\n` +
        `• \`#cashea 180 4 Nevera\` ${escapeMarkdownV2('(niveles 1 a 6)')}\n` +
        `• \`#resumen\` ${escapeMarkdownV2('o')} \`/360\` ${escapeMarkdownV2('(consulta de patrimonio y vencimientos)')}`,
    };
  }

  if (trigger === '#gasto' || trigger === '#ingreso') {
    const isExpense = trigger === '#gasto';
    const commandKey = isExpense ? 'expense' : 'income';
    const example = isExpense
      ? '#gasto 25 USD Gasolina pyme'
      : '#ingreso 200 USD Cobro servicio pyme';

    const amount = parseStrictPositiveAmount(parts[0]);
    if (amount === null) {
      return {
        isF360Command: true,
        valid: false,
        command: commandKey,
        replyMarkdown:
          `⚠️ *${escapeMarkdownV2('Monto inválido en')}* \`${escapeInlineCode(trigger)}\`\n\n` +
          `${escapeMarkdownV2('Ingresa un monto numérico positivo válido. Ejemplo:')}\n` +
          `\`${escapeInlineCode(example)}\``,
      };
    }

    let currency: 'USD' | 'USDT' | 'VES' | 'EUR' = 'USD';
    let descStart = 1;
    const token2 = (parts[1] || '').toUpperCase();
    if (token2 === 'USD' || token2 === '$') {
      currency = 'USD';
      descStart = 2;
    } else if (token2 === 'USDT') {
      currency = 'USDT';
      descStart = 2;
    } else if (token2 === 'BS' || token2 === 'VES') {
      currency = 'VES';
      descStart = 2;
    } else if (token2 === 'EUR') {
      currency = 'EUR';
      descStart = 2;
    }

    const remaining = parts.slice(descStart).join(' ').trim();
    let scope: 'personal' | 'business' = 'personal';
    let title = remaining || (isExpense ? 'Gasto Telegram' : 'Ingreso Telegram');

    if (/\b(pyme|negocio)$/i.test(remaining)) {
      scope = 'business';
      title =
        remaining.replace(/\b(pyme|negocio)$/i, '').trim() ||
        (isExpense ? 'Gasto Comercial' : 'Ingreso Comercial');
    } else if (/\bpersonal$/i.test(remaining)) {
      scope = 'personal';
      title =
        remaining.replace(/\bpersonal$/i, '').trim() ||
        (isExpense ? 'Gasto Personal' : 'Ingreso Personal');
    }

    const label = isExpense ? 'Gasto validado' : 'Ingreso validado';
    const scopeLabel = scope === 'business' ? 'Pyme / Negocio' : 'Personal';

    return {
      isF360Command: true,
      valid: true,
      command: commandKey,
      payload: { amount, currency, scope, title },
      replyMarkdown:
        `📊 *${escapeMarkdownV2(`Finanzas 360 — ${label}`)}*\n\n` +
        `• *${escapeMarkdownV2('Concepto:') }* ${escapeMarkdownV2(title)}\n` +
        `• *${escapeMarkdownV2('Monto:') }* \`${escapeInlineCode(`${amount.toFixed(2)} ${currency}`)}\`\n` +
        `• *${escapeMarkdownV2('Ámbito:') }* ${escapeMarkdownV2(scopeLabel)}`,
    };
  }

  // #cashea <amount> <level 1-6> [product]
  const amount = parseStrictPositiveAmount(parts[0]);
  const levelStr = parts[1] || '';
  const isStrictInt = /^\d+$/.test(levelStr);
  const levelNum = isStrictInt ? Number.parseInt(levelStr, 10) : Number.NaN;

  if (amount === null || !Number.isInteger(levelNum) || levelNum < 1 || levelNum > 6) {
    return {
      isF360Command: true,
      valid: false,
      command: 'cashea',
      replyMarkdown:
        `⚠️ *${escapeMarkdownV2('Formato inválido en')}* \`#cashea\`\n\n` +
        `${escapeMarkdownV2('Indica un monto numérico positivo y un nivel Cashea válido entre 1 y 6. Ejemplo:')}\n` +
        `\`#cashea 180 4 Nevera Mabe\``,
    };
  }

  const product = parts.slice(2).join(' ').trim() || 'Compra Cashea';
  const initialPct = CASHEA_LEVEL_INITIAL_PCT[levelNum] ?? 40;
  const initialPaymentUsd = Math.round(amount * (initialPct / 100) * 100) / 100;
  const financedUsd = Math.max(0, Math.round((amount - initialPaymentUsd) * 100) / 100);
  const installmentUsd = Math.round((financedUsd / 3) * 100) / 100;

  return {
    isF360Command: true,
    valid: true,
    command: 'cashea',
    payload: {
      amount,
      level: levelNum,
      product,
      initialPercent: initialPct,
      initialPaymentUsd,
      installmentAmountUsd: installmentUsd,
      installmentsCount: 3,
    },
    replyMarkdown:
      `💳 *${escapeMarkdownV2(`Finanzas 360 — Plan Cashea Nivel ${levelNum}`)}*\n\n` +
      `• *${escapeMarkdownV2('Artículo:')}* ${escapeMarkdownV2(product)}\n` +
      `• *${escapeMarkdownV2('Precio total:')}* \`${escapeInlineCode(`$${amount.toFixed(2)} USD`)}\`\n` +
      `• *${escapeMarkdownV2(`Inicial (${initialPct}%):`)}* \`${escapeInlineCode(`$${initialPaymentUsd.toFixed(2)} USD`)}\`\n` +
      `• *${escapeMarkdownV2('3 cuotas quincenales:')}* \`${escapeInlineCode(`$${installmentUsd.toFixed(2)} USD`)}\``,
  };
}

export async function handleFinance360TelegramCommand(
  rawText: string,
  deps?: {
    electronBridgeUrl?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<{
  handled: boolean;
  valid: boolean;
  forwarded: boolean;
  replyMarkdown: string;
}> {
  const parsed = parseFinance360TelegramCommand(rawText);
  if (!parsed.isF360Command) {
    return { handled: false, valid: false, forwarded: false, replyMarkdown: '' };
  }

  if (!parsed.valid) {
    return {
      handled: true,
      valid: false,
      forwarded: false,
      replyMarkdown: parsed.replyMarkdown,
    };
  }

  const bridgeUrl = deps?.electronBridgeUrl ?? ELECTRON_BRIDGE_URL;
  const fetchFn = deps?.fetchImpl ?? fetch;

  try {
    const statusRes = await fetchFn(`${bridgeUrl}/api/orchestrator/status`, {
      signal: AbortSignal.timeout(1500),
    });
    if (statusRes.ok) {
      const forwardRes = await fetchFn(`${bridgeUrl}/api/f360/telegram-command`, {
        method: 'POST',
        headers: buildElectronBridgeHeaders(),
        body: JSON.stringify({
          command: parsed.command,
          rawText: rawText.trim(),
          payload: parsed.payload,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (forwardRes.ok) {
        const data = (await forwardRes.json()) as {
          replyMarkdown?: string;
          replyText?: string;
          message?: string;
        };
        const replyMarkdown =
          typeof data.replyMarkdown === 'string' && data.replyMarkdown.trim().length > 0
            ? data.replyMarkdown
            : escapeMarkdownV2(
                data.replyText ||
                  data.message ||
                  'Operación procesada por el terminal Finanzas 360.',
              );
        return { handled: true, valid: true, forwarded: true, replyMarkdown };
      }
    }
  } catch {
    // Bridge offline or unreachable; fall through to honest offline status message
  }

  const offlineNotice = escapeMarkdownV2(
    'El terminal de escritorio Finanzas 360 está desconectado en este momento. Conecta el puente Electron para guardar este registro en el libro contable.',
  );

  return {
    handled: true,
    valid: true,
    forwarded: false,
    replyMarkdown: `${parsed.replyMarkdown}\n\nℹ️ _${offlineNotice}_`,
  };
}

// Sentinel State
let isRunning = true;
let currentOffset = IS_TEST_IMPORT ? 0 : loadStoredOffset();
let isKillswitchActive = false;
let lastAlertTimestamp = 0;

if (!IS_TEST_IMPORT) {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  P2P DECISOR — TELEGRAM SENTINEL 2.0 & DATA LAKE CLOUD DAEMON');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  Bot Token Configurado:  ${BOT_TOKEN ? 'SÍ (' + BOT_TOKEN.slice(0, 8) + '...)' : 'NO'}`);
  console.log(`  Chat ID Autorizado:     ${AUTHORIZED_CHAT_ID || 'TODOS (No restringido)'}`);
  console.log(`  CotizaVe API Key:       ${COTIZAVE_API_KEY ? 'SÍ' : 'NO'}`);
  console.log(`  Data Lake Activo:       ${dataLake.getStats().totalTicks} ticks en memoria`);
  console.log(`  Repreciador Autónomo:   ${repricerEngine.getState().isActive ? 'ACTIVO' : 'INACTIVO'}`);
  console.log(`  HTTP API Port:          ${HTTP_PORT}`);
  console.log('───────────────────────────────────────────────────────────────────────');

  if (!BOT_TOKEN) {
    console.error('[Daemon] FATAL: TELEGRAM_BOT_TOKEN no está definido en el archivo .env o variables de entorno.');
    process.exit(1);
  }
}

// Message Processing
export interface HandleDaemonUpdateOverrides {
  readonly botToken?: string;
  readonly authorizedChatId?: string;
  readonly cotizaveApiKey?: string;
}

export async function handleUpdate(
  update: TelegramInboundUpdate,
  overrides?: HandleDaemonUpdateOverrides,
): Promise<void> {
  const activeToken = overrides?.botToken ?? BOT_TOKEN;
  const activeAuthChatId = overrides?.authorizedChatId ?? AUTHORIZED_CHAT_ID;
  const activeCotizaveKey = overrides?.cotizaveApiKey ?? COTIZAVE_API_KEY;

  const chat = update.message?.chat || update.callback_query?.message?.chat;
  const chatId = chat?.id || activeAuthChatId;
  if (!chatId) return;

  // Security guard: mutating FX_BOUGHT callbacks are strictly forbidden in group/supergroup/channel chats
  const rawCallbackData = update.callback_query?.data || '';
  const inboundChatType = chat && 'type' in chat ? chat.type : undefined;
  if (
    rawCallbackData.startsWith('FX_BOUGHT:') &&
    inboundChatType &&
    inboundChatType !== 'private'
  ) {
    if (update.callback_query?.id) {
      await answerCallbackQuery(
        activeToken,
        update.callback_query.id,
        'Operación bloqueada en grupos: usá chat privado 1:1',
      );
    }
    await sendTelegramMessage(
      activeToken,
      chatId,
      `🚫 *SEGURIDAD MESA CAMBIARIA:* Los asientos \`FX\\_BOUGHT\` están prohibidos en grupos o canales\\. Ejecutá \`/mesa\` desde tu chat privado autorizado\\.`,
    );
    return;
  }

  const dispatch = dispatchTelegramUpdate(update, activeAuthChatId);

  if (!dispatch.authorized) {
    await sendTelegramMessage(activeToken, chatId, dispatch.responseMarkdown);
    console.warn(`[Daemon] Intento de acceso no autorizado desde Chat ID ${chatId}`);
    return;
  }

  // Intercept Finanzas 360 commands (#gasto, #ingreso, #cashea, #resumen, /360) before generic COPILOT_CHAT fallback
  const inboundRawText = (update.message?.text || '').trim();
  if (inboundRawText) {
    const f360Result = await handleFinance360TelegramCommand(inboundRawText);
    if (f360Result.handled) {
      await sendTelegramMessage(BOT_TOKEN, chatId, f360Result.replyMarkdown);
      return;
    }
  }

  console.log(`[Daemon] Comando recibido: action=${dispatch.action}, rawText="${update.message?.text || update.callback_query?.data || ''}"`);

  switch (dispatch.action) {
    case 'KILLSWITCH': {
      isKillswitchActive = true;
      repricerEngine.disable();
      void callElectronKillswitch('trigger', 'Telegram remote killswitch');
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `🚨 *KILLSWITCH EJECUTADO EN EL SERVIDOR VPS*\n\nTodos los procesos de monitoreo y alertas automáticas fueron pausados inmediatamente\\.`,
      );
      break;
    }

    case 'RESUME': {
      isKillswitchActive = false;
      repricerEngine.resetCircuitBreaker();
      void callElectronKillswitch('reset');
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `✅ *CENTINELA REANUDADO EN EL SERVIDOR VPS*\n\nEl monitoreo continuo de arbitraje y tasas en vivo está activo nuevamente\\.`,
      );
      break;
    }

    case 'STATUS': {
      const depth = await fetchLiveMarketDepth();
      const bcvRates = await fetchCotizaveRates();
      const bcvRate = bcvRates?.rates?.bcv?.price || 0;
      const parallelRate = depth?.bestBuyPrice || bcvRates?.rates?.parallel?.price || 0;
      const spreadPct = depth?.grossSpreadPct || 0;
      const stats = dataLake.getStats();
      const repricerState = repricerEngine.getState();

      const statusText = `📡 *ESTADO DEL CENTINELA VPS 24/7*\n\n` +
        `• *Servidor:* Linux Cloud VPS\n` +
        `• *Estado Centinela:* ${isKillswitchActive ? '🔴 PAUSADO (Kill-Switch)' : '🟢 OPERATIVO Y MONITOREANDO'}\n` +
        `• *Repreciador 24/7:* ${repricerState.isActive ? '🟢 ACTIVO' : '⚪ INACTIVO'}\n` +
        `• *Binance P2P Buy:* \`${depth?.bestBuyPrice?.toFixed(2) || 'N/D'}\` VES\n` +
        `• *Binance P2P Sell:* \`${depth?.bestSellPrice?.toFixed(2) || 'N/D'}\` VES\n` +
        `• *Spread Bruto:* \`${spreadPct.toFixed(2)}%\`\n` +
        `• *Tasa Oficial BCV:* \`${bcvRate ? bcvRate.toFixed(2) : 'N/D'}\` VES\n` +
        `• *Data Lake:* \`${stats.totalTicks}\` ticks capturados\n\n` +
        `_Escribí /heatmap para ver horarios de arbitraje o /autoreprice para gestionar el reprecio autónomo\\._`;

      await sendTelegramMessage(BOT_TOKEN, chatId, statusText, buildSentinelReplyKeyboard());
      break;
    }

    case 'AUTOREPRICE_ON': {
      repricerEngine.enable();
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `🟢 *REPRECIO DINÁMICO AUTÓNOMO 24/7 ACTIVADO*\n\nEl servidor ajustará automáticamente las posturas en el libro de órdenes respetando los pisos de seguridad y buffers de volatilidad\\.`,
      );
      break;
    }

    case 'AUTOREPRICE_OFF': {
      repricerEngine.disable();
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `⏸️ *REPRECIO DINÁMICO AUTÓNOMO PAUSADO*\n\nLas posturas ya no se actualizarán automáticamente\\.`,
      );
      break;
    }

    case 'AUTOREPRICE_CONFIG': {
      const params = dispatch.params as AutoRepriceParams;
      repricerEngine.configure({
        strategy: params?.strategy as any,
        baseMinSpreadPct: params?.minSpread,
      });
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `⚙️ *CONFIGURACIÓN DE REPRECIO ACTUALIZADA*\n\n• Estrategia: \`${params?.strategy || 'TOP_1'}\`\n• Spread Mínimo: \`${(params?.minSpread || 0.6).toFixed(2)}%\``,
      );
      break;
    }

    case 'AUTOREPRICE_STATUS': {
      const depth = await fetchLiveMarketDepth();
      const bcvRates = await fetchCotizaveRates();
      const bcvRate = bcvRates?.rates?.bcv?.price || 0;
      const parallelRate = depth?.bestBuyPrice || 0;
      const bcvGapPct = bcvRate > 0 && parallelRate > 0 ? ((parallelRate - bcvRate) / bcvRate) * 100 : 0;
      if (depth) {
        repricerEngine.evaluate(depth, bcvGapPct, 'LOW');
      }
      const msg = repricerEngine.getTelegramStatusMessage();
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    case 'HEATMAP': {
      const msg = dataLake.getHeatmapTelegramText(30);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    case 'SYNC': {
      const msg = syncStore.getTelegramStatusMessage();
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    case 'BCV':
    case 'BCV_INTELLIGENCE': {
      const [depth, bcvRates] = await Promise.all([
        fetchLiveMarketDepth(),
        fetchCotizaveRates(),
      ]);
      const bcv = bcvRates?.rates?.bcv?.mid || bcvRates?.rates?.oficial?.mid || (bcvRates?.rates?.bcv?.price as number) || null;
      const parallel = depth?.bestBuyPrice || (bcvRates?.rates?.parallel?.mid as number) || null;

      const intel = getBcvMarketIntelligence(parallel, bcv);
      const msg = formatBcvIntelligenceTelegramMessage({
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
      });
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    case 'SPREADS': {
      const bankParam = (dispatch.params as PlanActionParams)?.bank;
      const payTypes = bankParam ? mapBankToPayType(bankParam) : [];
      let depth: BinanceP2pMarketDepth | null = null;

      if (payTypes.length > 0) {
        const [buyOffers, sellOffers] = await Promise.all([
          fetchBinanceSide('BUY', 'USDT', 'VES', payTypes),
          fetchBinanceSide('SELL', 'USDT', 'VES', payTypes),
        ]);
        if (buyOffers.length > 0 || sellOffers.length > 0) {
          depth = computeMarketDepth(buyOffers, sellOffers);
        }
      } else {
        depth = await fetchLiveMarketDepth();
      }

      if (depth && depth.bestBuyPrice > 0 && depth.bestSellPrice > 0) {
        const bankTitle = bankParam ? ` \\(${escapeMarkdownV2(bankParam.toUpperCase())}\\)` : '';
        const msg = `📈 *PUNTAS EN VIVO${bankTitle} \\(BINANCE P2P\\)*\n━━━━━━━━━━━━━━━━━━━━\n💵 Compra: \`${depth.bestBuyPrice.toFixed(2)} Bs\`\n💰 Venta: \`${depth.bestSellPrice.toFixed(2)} Bs\`\n⚡ Spread: \`+${depth.spreadPct.toFixed(2)}%\` \\(\`${depth.spreadVes.toFixed(2)} Bs\`\\)\n🕐 Actualizado en tiempo real por el Centinela 24/7`;
        await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      } else {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `⚠️ *Libro en sincronización o sin órdenes para esa ruta*, reintentá en unos segundos\\.`,
        );
      }
      break;
    }

    case 'AUDIT_RECEIPT': {
      if (!dispatch.fileId) {
        await sendTelegramMessage(BOT_TOKEN, chatId, '⚠️ *No se recibió el identificador del archivo\\.*');
        break;
      }
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        '🔍 *COMPROBANTE RECIBIDO*: Descargando imagen y analizando con Escudo Anti\\-Fraude\\.\\.\\.',
      );

      try {
        // 1. Obtener la ruta del archivo desde Telegram API
        const fileMetaRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${dispatch.fileId}`);
        if (!fileMetaRes.ok) throw new Error('Fallo al consultar metadatos del archivo en Telegram');
        const fileMeta = (await fileMetaRes.json()) as { ok: boolean; result?: { file_path?: string } };
        const filePath = fileMeta.result?.file_path;
        if (!filePath) throw new Error('Telegram no devolvió la ruta del archivo');

        // 2. Descargar el archivo directamente en Node.js
        const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
        const fileRes = await fetch(downloadUrl);
        if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status} al descargar imagen desde Telegram`);
        const arrayBuf = await fileRes.arrayBuffer();
        const base64 = Buffer.from(arrayBuf).toString('base64');
        let mimeType = 'image/jpeg';
        if (filePath.endsWith('.png')) mimeType = 'image/png';
        else if (filePath.endsWith('.webp')) mimeType = 'image/webp';

        // 3. Consultar IA Multimodal si hay API Key disponible
        let ocrText = '';
        let aiParsed: { amount?: number; reference?: string; bank?: string; payer?: string } = {};

        if (process.env['GEMINI_API_KEY']) {
          try {
            const geminiKey = process.env['GEMINI_API_KEY'].trim();
            const geminiModel = process.env['GEMINI_MODEL']?.trim() || 'gemini-2.0-flash';
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
            const prompt = `Analiza este comprobante de pago bancario / transferencia / Pago Móvil (Venezuela o Colombia).
Extrae en formato JSON exacto:
{
  "bank": "nombre del banco emisor o receptor (ej: BANESCO, BDV, MERCANTIL, BANCAMIGA, BANCOLOMBIA, etc)",
  "amount": 0.00,
  "currency": "VES" o "USD" o "COP",
  "reference": "número de referencia o confirmación",
  "payer": "nombre completo del pagador / titular emisor",
  "extractedText": "transcripción de los datos clave del comprobante"
}
Si algún dato no aparece, usa null o cadena vacía. Devuelve ÚNICAMENTE el JSON.`;

            const gRes = await fetch(geminiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': geminiKey,
              },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      { text: prompt },
                      {
                        inlineData: {
                          mimeType,
                          data: base64,
                        },
                      },
                    ],
                  },
                ],
              }),
            });

            if (gRes.ok) {
              const gData = (await gRes.json()) as any;
              const content = gData.candidates?.[0]?.content?.parts?.[0]?.text || '';
              ocrText = content;
              const jsonMatch = content.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsedJson = JSON.parse(jsonMatch[0]);
                aiParsed = {
                  amount: typeof parsedJson.amount === 'number' ? parsedJson.amount : parseFloat(String(parsedJson.amount || 0).replace(/[^0-9.]/g, '')),
                  reference: parsedJson.reference ? String(parsedJson.reference) : undefined,
                  bank: parsedJson.bank ? String(parsedJson.bank) : undefined,
                  payer: parsedJson.payer ? String(parsedJson.payer) : undefined,
                };
              }
            }
          } catch (aiErr) {
            console.warn('[Daemon] Gemini Vision error:', aiErr);
          }
        }

        // 4. Parseo heurístico de reglas bancarias locales
        const heuristicParsed = parseBankReceiptText(ocrText);
        const finalAmount = aiParsed.amount || heuristicParsed.amount || 0;
        const finalReference = aiParsed.reference || heuristicParsed.reference || 'N/A';
        const finalBank: BankType =
          heuristicParsed.bank !== 'UNKNOWN'
            ? heuristicParsed.bank
            : (aiParsed.bank ? detectBankType(aiParsed.bank) : 'UNKNOWN');
        const finalBankLabel =
          finalBank !== 'UNKNOWN'
            ? finalBank
            : (aiParsed.bank || 'BANCO NO IDENTIFICADO');
        const finalPayer = aiParsed.payer || heuristicParsed.payerName || 'Titular no detectado';

        // 5. Evaluar con Escudo Anti-Fraude
        const audit = evaluateFraudRisk({
          orderId: `TG-${Date.now().toString().slice(-6)}`,
          orderAmount: finalAmount,
          orderCurrency: heuristicParsed.currency || 'VES',
          advertiserVerifiedName: finalPayer,
          receipt: {
            ...heuristicParsed,
            amount: finalAmount,
            reference: finalReference,
            bank: finalBank,
            payerName: finalPayer,
          },
        });

        // 6. Formatear y enviar mensaje
        const msg = formatReceiptAuditTelegramMessage({
          receiptNumber: finalReference,
          bank: finalBankLabel,
          amountVes: finalAmount,
          extractedName: finalPayer,
          counterpartyName: 'Auditoría Móvil Telegram (Daemon VPS)',
          nameSimilarityPct: audit.nameMatch.score * 100,
          score: audit.overallScore,
          level: audit.riskLevel,
          recommendation:
            audit.riskLevel === 'SAFE'
              ? 'Pago verificado y consistente. Seguro para liberar.'
              : 'Posible discrepancia de datos o titular no verificado. Revisar banca online antes de liberar.',
        });

        await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      } catch (err: any) {
        console.error('[Daemon] Error al auditar comprobante:', err);
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `⚠️ *ERROR AL AUDITAR COMPROBANTE*: No se pudo extraer el texto o conectar con la imagen\\.\n_Detalle:_ \`${escapeMarkdownV2(err?.message || 'Error desconocido')}\``,
        );
      }
      break;
    }

    case 'BANCOS': {
      const defaultBanks = [
        { bankName: 'Banesco', spentTodayVes: 0, dailyLimitVes: 500000, consumedPct: 0, txCount: 0, maxTx: 20, isOverLimit: false },
        { bankName: 'BDV (Venezuela)', spentTodayVes: 0, dailyLimitVes: 500000, consumedPct: 0, txCount: 0, maxTx: 20, isOverLimit: false },
        { bankName: 'Mercantil', spentTodayVes: 0, dailyLimitVes: 500000, consumedPct: 0, txCount: 0, maxTx: 20, isOverLimit: false },
        { bankName: 'Bancamiga', spentTodayVes: 0, dailyLimitVes: 300000, consumedPct: 0, txCount: 0, maxTx: 20, isOverLimit: false },
      ];
      const msg = formatBankLimitsTelegramMessage(defaultBanks);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    case 'RADAR_SCAN': {
      const depth = await fetchLiveMarketDepth();
      if (!depth) {
        await sendTelegramMessage(BOT_TOKEN, chatId, '⚠️ *No se pudo obtener el libro de órdenes en vivo de Binance P2P*\\. Reintentá en unos segundos\\.');
        break;
      }
      const params: RadarScanParams = (dispatch.params as RadarScanParams) || {};
      const rows: RadarGapRow[] = [
        {
          bank: 'Banesco',
          price: depth.bestSellPrice,
          volumeUsdt: 1250,
          spreadPct: depth.spreadPct,
          maxTc: 20,
        },
        {
          bank: 'BDV',
          price: depth.bestSellPrice,
          volumeUsdt: 2400,
          spreadPct: depth.spreadPct,
          maxTc: 20,
        },
      ];
      const msg = formatRadarTelegramMessage(rows, params);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    case 'RADAR_ALTA_DEMANDA': {
      const depth = await fetchLiveMarketDepth();
      const scan = computeHighDemandScan(depth, {
        merchantLevel: 'STANDARD',
        stepVes: 0.01,
      });
      const msg = formatRadarAltaDemandaTelegramMessage(scan);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    case 'MACRO':
    case 'MACRO_INTEL': {
      const [depth, bcvRates] = await Promise.all([
        fetchLiveMarketDepth(),
        fetchCotizaveRates(),
      ]);
      const bcvRate = bcvRates?.rates?.bcv?.mid || bcvRates?.rates?.oficial?.mid || (bcvRates?.rates?.bcv?.price as number) || null;
      const parallelRate = depth?.bestBuyPrice || (bcvRates?.rates?.parallel?.mid as number) || null;
      const spreadPct = depth?.spreadPct ?? 0;

      const snapshot: MacroIntelSnapshot = {
        bcvRef: bcvRate,
        parallelRef: parallelRate,
        spreadPct,
        volatility2hPct: 0.25,
        forecastNote: 'Ventana de estabilidad · Riesgo moderado',
      };
      const msg = formatMacroTelegramMessage(snapshot);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    case 'PANEL': {
      const depth = await fetchLiveMarketDepth();
      const repricerState = repricerEngine.getState();
      const report: PanelReport = {
        executionMode: 'AUTOMATIC_24_7',
        repricerActive: repricerState.isActive,
        lastAskPrice: depth?.bestBuyPrice ?? null,
        lastBidPrice: depth?.bestSellPrice ?? null,
        marketSpreadPct: depth?.spreadPct ?? null,
        lastFetchLabel: 'en vivo',
        journalLine: '• _Journal_: Operando en Cloud VPS 24/7',
        killswitchActive: isKillswitchActive,
      };
      const msg = formatPanelTelegramMessage(report);
      const keyboard = buildPanelKeyboard(isKillswitchActive, repricerState.isActive);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg, keyboard);
      break;
    }

    case 'PLAN': {
      await sendTelegramMessage(BOT_TOKEN, chatId, dispatch.responseMarkdown);
      const planParams = (dispatch.params as PlanActionParams) || {};
      const capital = planParams.capital || 200;
      const bank = planParams.bank || 'Banesco';

      // 1. Intentar orquestador en Electron si está disponible
      if (await isElectronBridgeOnline()) {
        const electronResult = await callElectronPlan(capital, bank);
        if (electronResult?.plan) {
          const p = electronResult.plan;
          const planCard: StrategyPlanTelegramCard = {
            id: p.planId || p.id || `PLAN-${Date.now().toString(36).toUpperCase()}`,
            title: p.title || `Arbitraje P2P ${bank}`,
            route: p.route || `${bank} ↔ Binance P2P`,
            capitalRequiredUsdt: Number(p.capitalRequiredUsdt || capital),
            expectedNetSpreadPct: Number(p.expectedNetSpreadPct || 0),
            expectedProfitUsdt: Number(p.expectedProfitUsdt || 0),
            riskLevel: p.riskLevel || 'LOW',
            assignedOperatorName: 'Copiloto IA (Electron)',
          };
          pendingPlans.set(planCard.id, planCard);
          const cardText = formatStrategyPlanTelegramMessage(planCard);
          const kb = buildPlanApprovalKeyboard(planCard.id);
          await sendTelegramMessage(BOT_TOKEN, chatId, cardText, kb);
          break;
        }
      }

      // 2. Si Electron no está online o no generó plan, formular con motor local en vivo
      const depth = await fetchLiveMarketDepth();
      if (!depth || depth.bestBuyPrice <= 0 || depth.bestSellPrice <= 0) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `⚠️ *No se pudo formular el plan*: libro de Binance P2P no disponible en este momento\\.`,
        );
        break;
      }

      const grossSpreadPct = depth.grossSpreadPct;
      const netSpreadPct = Math.max(0, grossSpreadPct - 0.70); // Descontando comisiones Maker/Taker 0.35% x 2
      const profitUsdt = Number(((capital * netSpreadPct) / 100).toFixed(2));
      const planId = `PLAN-${Date.now().toString(36).toUpperCase()}`;

      const localPlanCard: StrategyPlanTelegramCard = {
        id: planId,
        title: `Arbitraje Rápido ${bank}`,
        route: `${bank} ↔ Binance P2P`,
        capitalRequiredUsdt: capital,
        expectedNetSpreadPct: Number(netSpreadPct.toFixed(2)),
        expectedProfitUsdt: profitUsdt,
        riskLevel: netSpreadPct >= 0.5 ? 'LOW' : 'MEDIUM',
        assignedOperatorName: 'Centinela VPS Autónomo',
      };
      pendingPlans.set(planId, localPlanCard);
      const cardText = formatStrategyPlanTelegramMessage(localPlanCard);
      const kb = buildPlanApprovalKeyboard(planId);
      await sendTelegramMessage(BOT_TOKEN, chatId, cardText, kb);
      break;
    }

    case 'PLAN_APPROVE': {
      if (update.callback_query?.id) {
        void answerCallbackQuery(BOT_TOKEN, update.callback_query.id, 'Aprobando plan...');
      }
      const planId = dispatch.planId || (dispatch.params as PlanActionParams)?.planId || '';
      if (!planId) {
        await sendTelegramMessage(BOT_TOKEN, chatId, '⚠️ *ID de plan no especificado*\\.');
        break;
      }

      if (await isElectronBridgeOnline()) {
        const execRes = await callElectronExecutePlan(planId);
        if (execRes && execRes.success) {
          await sendTelegramMessage(
            BOT_TOKEN,
            chatId,
            `✅ *PLAN ${escapeMarkdownV2(planId)} APROBADO Y DESPACHADO EN TERMINAL*\n\n` +
            `Las instrucciones de despacho operativo se ejecutaron satisfactoriamente en el terminal de escritorio\\.`,
          );
          pendingPlans.delete(planId);
          break;
        } else if (execRes && !execRes.success) {
          const errText = execRes.error || (execRes.riskWarnings ? execRes.riskWarnings.join(', ') : 'Veto de riesgo');
          await sendTelegramMessage(
            BOT_TOKEN,
            chatId,
            `🚫 *PLAN ${escapeMarkdownV2(planId)} BLOQUEADO POR RIESGO*\n\nMotivo: _${escapeMarkdownV2(errText)}_`,
          );
          break;
        }
      }

      const cached = pendingPlans.get(planId);
      if (cached) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `✅ *PLAN ${escapeMarkdownV2(planId)} AUTORIZADO POR EL OPERADOR*\n\n` +
          `• *Ruta:* \`${escapeMarkdownV2(cached.route)}\`\n` +
          `• *Capital:* \`${cached.capitalRequiredUsdt} USDT\`\n` +
          `• *Spread:* \`+${cached.expectedNetSpreadPct}%\`\n\n` +
          `_Registrado en la bitácora del Centinela 24/7\\._`,
        );
        pendingPlans.delete(planId);
      } else {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `✅ *Plan ${escapeMarkdownV2(planId)} autorizado por el operador*\\.`,
        );
      }
      break;
    }

    case 'PLAN_REJECT': {
      if (update.callback_query?.id) {
        void answerCallbackQuery(BOT_TOKEN, update.callback_query.id, 'Plan descartado');
      }
      const planId = dispatch.planId || (dispatch.params as PlanActionParams)?.planId || '';
      if (planId) {
        pendingPlans.delete(planId);
      }
      await sendTelegramMessage(
        BOT_TOKEN,
        chatId,
        `❌ *PLAN ${escapeMarkdownV2(planId || 'PROPUESTO')} DESCARTADO POR EL OPERADOR*\n\nNinguna orden fue despachada\\.`,
      );
      break;
    }

    case 'FX_DESK': {
      const params = (dispatch.params as FxDeskActionParams | undefined) ?? {};
      const [depth, bcvRates] = await Promise.all([
        fetchLiveMarketDepth(),
        fetchCotizaveRates(activeCotizaveKey),
      ]);
      const rawBcv =
        bcvRates?.rates?.bcv?.mid ??
        bcvRates?.rates?.oficial?.mid ??
        bcvRates?.rates?.bcv?.price ??
        null;
      const rawP2pSell =
        depth?.bestSellPrice ??
        depth?.bestBuyPrice ??
        bcvRates?.rates?.binance?.bid ??
        bcvRates?.rates?.parallel?.mid ??
        null;
      const bcv = typeof rawBcv === 'number' && rawBcv > 0 ? rawBcv : null;
      const p2pSell = typeof rawP2pSell === 'number' && rawP2pSell > 0 ? rawP2pSell : null;
      const fxWin = evaluateVenezuelanFxWindow();

      const plan = evaluateFxBankDeskPlan({
        bcvOfficialRateVes: bcv,
        p2pSellRateVes: p2pSell,
        modality: 'MENUDEO_BCV',
        igtfPct: VEN_DEFAULT_IGTF_PCT,
        simulatedCapitalVes: params.capitalVes ?? 100000,
        useSimulatedCapital: true,
        capitalAllocationMode: params.bankId ? 'PER_BANK' : 'DISTRIBUTE_TOTAL',
        depletedBanks: getActiveDaemonFxDepletedBanks(),
        isBcvWindowOpen: fxWin.isWindowOpen,
      });

      const msg = formatFxDeskTelegramMessage(plan, params.bankId);
      const kb = buildFxDeskTelegramKeyboard(plan, params.bankId, (bId, usd) =>
        issueDaemonFxBoughtNonce(bId, usd),
      );
      await sendTelegramMessage(activeToken, chatId, msg, kb);
      break;
    }

    case 'FX_BOUGHT': {
      const params = dispatch.params as FxBoughtCallbackParams | undefined;
      if (!params?.bankId || !params.orderUsd) {
        if (update.callback_query?.id) {
          await answerCallbackQuery(activeToken, update.callback_query.id, 'Datos incompletos');
        }
        await sendTelegramMessage(activeToken, chatId, dispatch.responseMarkdown);
        break;
      }

      const cbMsgId = update.callback_query?.message?.message_id;
      const dedupKey = params.nonce
        ? `vps-nonce:${params.nonce}`
        : `vps-msg:${cbMsgId ?? 'na'}:${params.bankId}:${params.orderUsd}`;

      if (
        !validateAndConsumeDaemonFxBoughtNonce(
          params.nonce,
          params.bankId,
          params.orderUsd,
          dedupKey,
        )
      ) {
        if (update.callback_query?.id) {
          await answerCallbackQuery(
            activeToken,
            update.callback_query.id,
            'Pacto ya procesado o expirado (Anti-Doble Gasto)',
          );
        }
        if (cbMsgId) {
          await clearTelegramInlineKeyboard(activeToken, chatId, cbMsgId);
        }
        break;
      }

      const bcvRates = await fetchCotizaveRates(activeCotizaveKey);
      const rawBcv =
        bcvRates?.rates?.bcv?.mid ??
        bcvRates?.rates?.oficial?.mid ??
        bcvRates?.rates?.bcv?.price ??
        null;
      const bcvRate = typeof rawBcv === 'number' && rawBcv > 0 ? roundMoney(rawBcv, 2) : null;
      const bankProfile = VENEZUELAN_FX_BANKS.find((b) => b.id === params.bankId);

      if (!bcvRate || !bankProfile) {
        if (update.callback_query?.id) {
          await answerCallbackQuery(
            activeToken,
            update.callback_query.id,
            'Bloqueado: tasa BCV en vivo no disponible',
          );
        }
        await sendTelegramMessage(
          activeToken,
          chatId,
          `⚠️ *Asiento bloqueado \\(Fail\\-Closed\\):* No se obtuvo tasa oficial BCV en vivo para liquidar \`${escapeMarkdownV2(params.orderUsd.toFixed(2))} USD\` en *${escapeMarkdownV2(params.bankId)}*\\.`,
        );
        break;
      }

      const principalVes = roundMoney(params.orderUsd * bcvRate, 2);
      const bankFeeVes = roundMoney(principalVes * (bankProfile.bankFxFeePct / 100), 2);
      const totalDebitVes = roundMoney(principalVes + bankFeeVes, 2);
      const railMeta = FX_EXIT_RAIL_OPTIONS.find((r) => r.id === bankProfile.primaryExitRail);
      const effectiveIgtfPct =
        railMeta?.appliesIgtfByDefault ?? bankProfile.primaryExitRail !== 'CASH_WITHDRAWAL_OTC'
          ? VEN_DEFAULT_IGTF_PCT
          : 0;
      const totalFrictionPct = roundMoney(effectiveIgtfPct + bankProfile.exitRailFrictionPct, 2);
      const netUsdt = roundMoney(params.orderUsd * (1 - totalFrictionPct / 100), 2);

      // Persist signed sync record in VPS SyncHub so desktop terminal reconciles it
      const recordId = `FX-VPS-${Date.now().toString(36).toUpperCase()}`;
      const payloadJson = JSON.stringify({
        id: recordId,
        bankId: bankProfile.id,
        purchasedUsd: params.orderUsd,
        netUsdt,
        bcvRateVes: bcvRate,
        principalVes,
        bankFeeVes,
        totalDebitVes,
        igtfPct: effectiveIgtfPct,
        exitRail: bankProfile.primaryExitRail,
        idempotencyKey: dedupKey,
        timestamp: new Date().toISOString(),
      });
      syncStore.push({
        deviceId: 'vps-telegram-daemon',
        records: [
          {
            id: recordId,
            entityType: 'operation',
            ciphertext: Buffer.from(payloadJson, 'utf8').toString('base64'),
            iv: crypto.randomBytes(12).toString('base64'),
            updatedAt: Date.now(),
            version: 1,
            deleted: false,
            deviceId: 'vps-telegram-daemon',
          },
        ],
      });

      if (cbMsgId) {
        await clearTelegramInlineKeyboard(activeToken, chatId, cbMsgId);
      }
      if (update.callback_query?.id) {
        await answerCallbackQuery(activeToken, update.callback_query.id, 'Pacto registrado (1x Fee)');
      }
      const summaryLine = `${bankProfile.shortName} · $${params.orderUsd.toFixed(2)} USD (Neto ${netUsdt.toFixed(2)} USDT) · Débito Total ${totalDebitVes.toFixed(2)} Bs (Principal ${principalVes.toFixed(2)} + Com. ${bankFeeVes.toFixed(2)} Bs)`;
      await sendTelegramMessage(
        activeToken,
        chatId,
        `${dispatch.responseMarkdown}\n\n📊 *Asiento 1x Fee \\(VPS Sync\\):* \`${escapeMarkdownV2(summaryLine)}\``,
      );
      break;
    }

    case 'FX_EMPTY': {
      const params = dispatch.params as FxEmptyCallbackParams | undefined;
      if (params?.bankId) {
        markDaemonFxBankDepleted(params.bankId);
      }
      if (update.callback_query?.id) {
        await answerCallbackQuery(
          activeToken,
          update.callback_query.id,
          'Banco en enfriamiento por 30m',
        );
      }
      await sendTelegramMessage(activeToken, chatId, dispatch.responseMarkdown);
      break;
    }

    case 'COPILOT_CHAT': {
      const userText = dispatch.command || update.message?.text || '';
      if (!userText.trim()) break;

      await sendTelegramMessage(BOT_TOKEN, chatId, `🧠 *CONSULTANDO AL COPILOTO ESTRATEGA IA*\\.\\.\\.`);

      if (await isElectronBridgeOnline()) {
        const chatRes = await callElectronChat(userText);
        if (chatRes && chatRes.text) {
          const textMsg = `🧠 *COPILOTO ESTRATEGA IA* \\(Terminal Conectado\\)\n\n${escapeMarkdownV2(chatRes.text)}`;
          if (chatRes.suggestedPlan) {
            const p = chatRes.suggestedPlan;
            const planCard: StrategyPlanTelegramCard = {
              id: p.planId || p.id || `PLAN-${Date.now().toString(36).toUpperCase()}`,
              title: p.title || 'Plan Táctico Propuesto',
              route: p.route || 'Ruta P2P',
              capitalRequiredUsdt: Number(p.capitalRequiredUsdt || 200),
              expectedNetSpreadPct: Number(p.expectedNetSpreadPct || 0),
              expectedProfitUsdt: Number(p.expectedProfitUsdt || 0),
              riskLevel: p.riskLevel || 'LOW',
              assignedOperatorName: 'Copiloto IA',
            };
            pendingPlans.set(planCard.id, planCard);
            const cardText = formatStrategyPlanTelegramMessage(planCard);
            const kb = buildPlanApprovalKeyboard(planCard.id);
            await sendTelegramMessage(BOT_TOKEN, chatId, textMsg);
            await sendTelegramMessage(BOT_TOKEN, chatId, cardText, kb);
          } else {
            await sendTelegramMessage(BOT_TOKEN, chatId, textMsg);
          }
          break;
        }
      }

      try {
        const answer = await aiProxy.ask(userText, COPILOT_SYSTEM_PROMPT);
        const badge = answer.cached
          ? `⚡ _Respuesta servida desde Caché Semántico_`
          : `🤖 _Respuesta vía ${answer.providerUsed} (${answer.latencyMs}ms)_`;
        const text = `🧠 *COPILOTO ESTRATEGA IA* \\(Cloud VPS\\)\n\n${escapeMarkdownV2(answer.content)}\n\n${escapeMarkdownV2(badge)}`;
        await sendTelegramMessage(BOT_TOKEN, chatId, text);
      } catch (err: any) {
        await sendTelegramMessage(
          BOT_TOKEN,
          chatId,
          `❌ *Error al procesar consulta:* ${escapeMarkdownV2(err?.message || 'Fallo de conectividad con proveedores de IA')}`,
        );
      }
      break;
    }

    default: {
      const raw = (update.message?.text || '').trim();
      if (raw.toLowerCase().startsWith('/closer')) {
        const closerRes = await handleTelegramCloserCommand({
          rawText: raw,
          gatewayUrl: INBOUND_GATEWAY_URL,
        });
        if (closerRes.handled && closerRes.replyMarkdown) {
          await sendTelegramMessage(BOT_TOKEN, chatId, closerRes.replyMarkdown);
          break;
        }
      }
      if (raw.startsWith('/ask ') || raw.startsWith('/ai ') || raw.startsWith('/ia ')) {
        const query = raw.replace(/^\/(ask|ai|ia)\s+/i, '').trim();
        if (query) {
          await sendTelegramMessage(BOT_TOKEN, chatId, `🧠 *CONSULTANDO A GENTLEMAN AI*\\.\\.\\.`);
          try {
            const answer = await aiProxy.ask(query);
            const badge = answer.cached
              ? `⚡ _Respuesta servida desde Caché Semántico_`
              : `🤖 _Respuesta vía ${answer.providerUsed} (${answer.latencyMs}ms)_`;
            const text = `💡 *GENTLEMAN AI*\n\n${escapeMarkdownV2(answer.content)}\n\n${escapeMarkdownV2(badge)}`;
            await sendTelegramMessage(BOT_TOKEN, chatId, text);
          } catch (err: any) {
            await sendTelegramMessage(BOT_TOKEN, chatId, `❌ *Error al consultar IA:* ${escapeMarkdownV2(err?.message || 'Fallo desconocido')}`);
          }
          break;
        }
      }
      if (dispatch.responseMarkdown) {
        await sendTelegramMessage(BOT_TOKEN, chatId, dispatch.responseMarkdown);
      }
      break;
    }
  }
}

// Background Long Polling Loop
async function startPolling(): Promise<void> {
  console.log('[Daemon] Iniciando bucle de Long-Polling con Telegram Bot API...');
  while (isRunning) {
    try {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${currentOffset}&timeout=20`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[Daemon] Telegram HTTP ${res.status}. Reintentando en 5s...`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      const data = (await res.json()) as { ok: boolean; result: TelegramInboundUpdate[] };
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          currentOffset = Math.max(currentOffset, update.update_id + 1);
          saveStoredOffset(currentOffset);
          await handleUpdate(update);
        }
      }
    } catch (err) {
      console.error('[Daemon] Error en loop de polling:', err);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

// Background Proactive Alpha Watcher & Data Lake Ingestion
async function startAlphaWatcher(): Promise<void> {
  console.log(`[Daemon] Iniciando Data Lake Ingestion y Alpha Watcher (${ALPHA_SCAN_INTERVAL_SEC}s)...`);
  while (isRunning) {
    await new Promise((r) => setTimeout(r, ALPHA_SCAN_INTERVAL_SEC * 1000));

    try {
      const depth = await fetchLiveMarketDepth();
      if (!depth) continue;

      const netSpread = depth.grossSpreadPct - 0.35;
      const now = Date.now();

      // Ingest tick into Time-Series Data Lake
      dataLake.recordTick({
        timestamp: now,
        buyPrice: depth.bestBuyPrice,
        sellPrice: depth.bestSellPrice,
        grossSpreadPct: depth.grossSpreadPct,
        netSpreadPct: netSpread,
        volumeUsdt: depth.totalBuyVolumeUsdt + depth.totalSellVolumeUsdt,
      });

      // Evaluate Autonomous 24/7 Repricer if active
      if (repricerEngine.getState().isActive && !isKillswitchActive) {
        const bcvRates = await fetchCotizaveRates();
        const bcvRate = bcvRates?.rates?.bcv?.price || 0;
        const bcvGapPct = bcvRate > 0 ? ((depth.bestBuyPrice - bcvRate) / bcvRate) * 100 : 0;
        const decision = repricerEngine.evaluate(depth, bcvGapPct, 'LOW');

        if (repricerEngine.getState().circuitBreakerTripped && AUTHORIZED_CHAT_ID) {
          const tripMsg =
            `🚨 *CIRCUIT BREAKER ACTIVADO EN REPRECIADOR 24/7*\n\n` +
            `El motor pausó automáticamente las operaciones debido a:\n_${escapeMarkdownV2(decision.reason)}_`;
          await sendTelegramMessage(BOT_TOKEN, AUTHORIZED_CHAT_ID, tripMsg);
          console.warn(`[Daemon] Repricer Circuit Breaker activado: ${decision.reason}`);
        }
      }

      if (isKillswitchActive || !AUTHORIZED_CHAT_ID) continue;

      // Proactive Alert when spread meets Golden Rule and throttle by 10 minutes
      if (netSpread >= MIN_NET_SPREAD_PCT && now - lastAlertTimestamp > 600_000) {
        lastAlertTimestamp = now;
        const alertMsg =
          `⚡ *OPORTUNIDAD DE ARBITRAJE DETECTADA POR CENTINELA VPS*\n\n` +
          `• *Spread Neto Estimado:* \`${netSpread.toFixed(2)}%\` \\(Regla de Oro \\>= ${MIN_NET_SPREAD_PCT.toFixed(2)}%\\)\n` +
          `• *Compra (BUY):* \`${depth.bestBuyPrice.toFixed(2)}\` VES\n` +
          `• *Venta (SELL):* \`${depth.bestSellPrice.toFixed(2)}\` VES\n` +
          `• *Ruta:* Banesco / Pago Móvil\n\n` +
          `_Enviá /heatmap para consultar la estacionalidad horaria o /status para libros en vivo\\._`;

        await sendTelegramMessage(BOT_TOKEN, AUTHORIZED_CHAT_ID, alertMsg);
        console.log(`[Daemon] Alerta proactiva enviada: Spread Neto ${netSpread.toFixed(2)}%`);
      }
    } catch (err) {
      console.error('[Daemon] Error en ciclo de Alpha Watcher:', err);
    }
  }
}

// Native HTTP Server for Microstructure, Repricer & AI Proxy REST API
function startHttpServer(): void {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), isKillswitchActive }));
      return;
    }

    // Optional Bearer token authentication on sensitive endpoints (/api/sync/* and /api/ai/chat)
    const configuredDaemonAuthToken = process.env['TELEGRAM_DAEMON_AUTH_TOKEN']?.trim() || '';
    if (configuredDaemonAuthToken && isProtectedDaemonEndpoint(url.pathname)) {
      if (!verifyDaemonBearerAuth(req.headers['authorization'], configuredDaemonAuthToken)) {
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="p2p-telegram-daemon"',
        });
        res.end(
          JSON.stringify({
            error: 'Unauthorized',
            message: 'Token Bearer requerido o inválido.',
          }),
        );
        return;
      }
    }

    if (url.pathname === '/api/market/heatmap') {
      const days = Number(url.searchParams.get('days')) || 30;
      const heatmap = dataLake.getHeatmap(days);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(heatmap));
      return;
    }

    if (url.pathname === '/api/market/stats') {
      const stats = dataLake.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
      return;
    }

    if (url.pathname === '/api/repricer/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(repricerEngine.getState()));
      return;
    }

    if (url.pathname === '/api/repricer/toggle' && req.method === 'POST') {
      if (repricerEngine.getState().isActive) {
        repricerEngine.disable();
      } else {
        repricerEngine.enable();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(repricerEngine.getState()));
      return;
    }

    if (url.pathname === '/api/ai/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(aiProxy.getCacheStats()));
      return;
    }

    if (url.pathname === '/api/ai/cache/clear' && req.method === 'POST') {
      aiProxy.clearCache();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', message: 'Caché semántico limpiado exitosamente.' }));
      return;
    }

    if (url.pathname === '/api/ai/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (!parsed.prompt) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'El campo "prompt" es obligatorio.' }));
            return;
          }
          const response = await aiProxy.ask(
            parsed.prompt,
            parsed.systemInstruction,
            Boolean(parsed.forceRefresh),
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Error interno en AI Proxy' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/sync/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(syncStore.getStats()));
      return;
    }

    if (url.pathname === '/api/sync/push' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const result = syncStore.push(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Error en sync push' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/sync/pull') {
      const sinceVersion = Number(url.searchParams.get('sinceVersion')) || 0;
      const deviceId = url.searchParams.get('deviceId') || undefined;
      const result = syncStore.pull(sinceVersion, deviceId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (url.pathname === '/api/arm/closer/briefing' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const briefing = buildTelegramPreCallBriefingCard({
            workspaceId: parsed.workspaceId || 'ARM_B2B',
            leadName: parsed.leadName || 'Dra. Elena Gómez',
            companyName: parsed.companyName || 'Clínica Aurora',
            startsInMinutes: parsed.startsInMinutes ?? 15,
            qualificationScore: parsed.qualificationScore ?? 92,
            bantData: parsed.bantData || {
              budget: '$2,400 USD',
              authority: 'Directora',
              need_pain_point: 'Automatización CRM',
              timeline: 'Esta semana',
            },
            memoryFacts: Array.isArray(parsed.memoryFacts) ? parsed.memoryFacts : [],
            estimatedDealValue: Number(parsed.estimatedDealValue || 2400),
          });
          if (BOT_TOKEN && AUTHORIZED_CHAT_ID) {
            await sendTelegramMessage(BOT_TOKEN, AUTHORIZED_CHAT_ID, briefing.telegramMarkdownPayload);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', briefing }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Error en briefing ARM' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint no encontrado' }));
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[Daemon] HTTP REST API activo en puerto ${HTTP_PORT}`);
  });
}

// Graceful Shutdown
function shutdown(signal: string): void {
  console.log(`\n[Daemon] Recibida señal ${signal}. Deteniendo servicios de forma segura...`);
  isRunning = false;
  saveStoredOffset(currentOffset);
  process.exit(0);
}

if (!IS_TEST_IMPORT) {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Launch All Services
  startHttpServer();
  void startPolling();
  void startAlphaWatcher();
}
