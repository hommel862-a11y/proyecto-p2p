import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  dispatchTelegramUpdate,
  formatReceiptAuditTelegramMessage,
  formatBcvIntelligenceTelegramMessage,
  formatBankLimitsTelegramMessage,
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
  type BinanceOfferSummary,
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
  type TelegramInboundUpdate,
  type TelegramInlineKeyboardMarkup,
  type TelegramReplyKeyboardMarkup,
} from '@p2p/core';
import { MicrostructureDataLake } from './data-lake';
import { RepricerEngine } from './repricer-engine';
import { CloudAiProxyService } from './ai-proxy';
import { EncryptedSyncStore } from './sync-store';

// Configuration from Environment Variables
const BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN']?.trim() || '';
const AUTHORIZED_CHAT_ID = process.env['TELEGRAM_CHAT_ID']?.trim() || '';
const COTIZAVE_API_KEY = process.env['COTIZAVE_API_KEY']?.trim() || '';
const POLL_INTERVAL_MS = Number(process.env['POLL_INTERVAL_MS']) || 2000;
const ALPHA_SCAN_INTERVAL_SEC = Number(process.env['ALPHA_SCAN_INTERVAL_SEC']) || 15;
const MIN_NET_SPREAD_PCT = Number(process.env['MIN_NET_SPREAD_PCT']) || 1.0;
const HTTP_PORT = Number(process.env['PORT']) || 3000;

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
const syncStore = new EncryptedSyncStore();

// Live Data Fetchers
async function fetchBinanceSide(
  tradeType: 'BUY' | 'SELL',
  asset = 'USDT',
  fiat = 'VES',
  payTypes: string[] = ['Banesco', 'PagoMovil', 'Mercantil'],
): Promise<BinanceOfferSummary[]> {
  try {
    const res = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (P2P-Decisor-Cloud-Sentinel/2.0)',
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
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ adv: Record<string, unknown>; advertiser: Record<string, unknown> }> };
    if (!json.data || !Array.isArray(json.data)) return [];

    return json.data.map((item) => {
      const adv = item.adv;
      const advr = item.advertiser;
      return {
        advNo: String(adv['advNo'] || ''),
        price: Number(adv['price']) || 0,
        surplusAmount: Number(adv['surplusAmount']) || 0,
        minSingleTransAmount: Number(adv['minSingleTransAmount']) || 0,
        maxSingleTransAmount: Number(adv['maxSingleTransAmount']) || 0,
        tradeType,
        asset,
        fiatUnit: fiat,
        payMethods: Array.isArray(adv['tradeMethods'])
          ? adv['tradeMethods'].map((m: any) => m.tradeMethodName || m.identifier)
          : [],
        merchantName: String(advr['nickName'] || 'Anónimo'),
        merchantOrders: Number(advr['monthOrderCount']) || 0,
        merchantFinishRate: (Number(advr['monthFinishRate']) || 0) * 100,
        isMerchant: advr['userType'] === 'merchant',
      };
    });
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

async function fetchCotizaveRates(): Promise<any | null> {
  if (!COTIZAVE_API_KEY) return null;
  try {
    const res = await fetch('https://api.cotizave.com/v1/fx/rates', {
      headers: {
        'X-API-Key': COTIZAVE_API_KEY,
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
    return res.ok;
  } catch (err) {
    console.error('[Daemon] Error sending Telegram message:', err);
    return false;
  }
}

// Sentinel State
let isRunning = true;
let currentOffset = loadStoredOffset();
let isKillswitchActive = false;
let lastAlertTimestamp = 0;

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

// Message Processing
async function handleUpdate(update: TelegramInboundUpdate): Promise<void> {
  const chat = update.message?.chat || update.callback_query?.message?.chat;
  const chatId = chat?.id || AUTHORIZED_CHAT_ID;
  if (!chatId) return;

  const dispatch = dispatchTelegramUpdate(update, AUTHORIZED_CHAT_ID);

  if (!dispatch.authorized) {
    await sendTelegramMessage(BOT_TOKEN, chatId, dispatch.responseMarkdown);
    console.warn(`[Daemon] Intento de acceso no autorizado desde Chat ID ${chatId}`);
    return;
  }

  console.log(`[Daemon] Comando recibido: action=${dispatch.action}, rawText="${update.message?.text || update.callback_query?.data || ''}"`);

  switch (dispatch.action) {
    case 'KILLSWITCH': {
      isKillswitchActive = true;
      repricerEngine.disable();
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

    case 'BCV_INTELLIGENCE': {
      const depth = await fetchLiveMarketDepth();
      const bcvRates = await fetchCotizaveRates();
      const bcvRate = bcvRates?.rates?.bcv?.price || 0;
      const parallelRate = depth?.bestBuyPrice || bcvRates?.rates?.parallel?.price || 0;

      const intel = getBcvMarketIntelligence(bcvRate, parallelRate, new Date());
      const msg = formatBcvIntelligenceTelegramMessage(intel, new Date());
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    case 'RADAR_SCAN': {
      const depth = await fetchLiveMarketDepth();
      if (!depth) {
        await sendTelegramMessage(BOT_TOKEN, chatId, '⚠️ *No se pudo obtener el libro de órdenes en vivo de Binance P2P*\\. Reintentá en unos segundos\\.');
        break;
      }
      const params: RadarScanParams = (dispatch.params as RadarScanParams) || {
        filterBank: 'TODOS',
        ticketAmount: 1000,
        isCustomTicket: false,
      };
      const rows: RadarGapRow[] = [
        {
          paymentMethod: 'Banesco',
          buyPrice: depth.bestBuyPrice,
          sellPrice: depth.bestSellPrice,
          grossSpreadPct: depth.grossSpreadPct,
          netSpreadPct: depth.grossSpreadPct - 0.35,
          recommendedAction: depth.grossSpreadPct - 0.35 >= 0.5 ? 'OPERAR' : 'ESPERAR',
          minTicket: 50,
          maxTicket: 2500,
        },
      ];
      const msg = formatRadarTelegramMessage(rows, params);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    case 'RADAR_ALTA_DEMANDA': {
      const buyOffers = await fetchBinanceSide('BUY');
      const sellOffers = await fetchBinanceSide('SELL');
      const scan = computeHighDemandScan(buyOffers, sellOffers);
      const params: RadarAltaDemandaParams = (dispatch.params as RadarAltaDemandaParams) || {
        filterBank: 'TODOS',
        tierUsdt: 1000,
        showAllTiers: true,
      };
      const msg = formatRadarAltaDemandaTelegramMessage(scan, params);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    case 'MACRO_INTEL': {
      const depth = await fetchLiveMarketDepth();
      const bcvRates = await fetchCotizaveRates();
      const bcvRate = bcvRates?.rates?.bcv?.price || 0;
      const parallelRate = depth?.bestBuyPrice || bcvRates?.rates?.parallel?.price || 0;

      const snapshot: MacroIntelSnapshot = {
        bcvRate,
        parallelRate,
        gapPct: bcvRate > 0 ? ((parallelRate - bcvRate) / bcvRate) * 100 : 0,
        riskZone: 'MODERADO',
        volatilityTrend: 'ESTABLE',
        liquidityWindow: 'ABIERTA',
        timestamp: new Date().toISOString(),
      };
      const msg = formatMacroTelegramMessage(snapshot);
      await sendTelegramMessage(BOT_TOKEN, chatId, msg);
      break;
    }

    default: {
      const raw = (update.message?.text || '').trim();
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

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Launch All Services
startHttpServer();
void startPolling();
void startAlphaWatcher();
