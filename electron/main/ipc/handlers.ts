import { ipcMain, app, net, safeStorage, desktopCapturer, type IpcMainInvokeEvent } from 'electron';
import { createHmac } from 'crypto';
import type {
  P2PIpcChannels,
  BinanceSearchParams,
  BinanceC2cOrdersFetchRequest,
  CotizaveRequest,
  BybitP2pFetchRequest,
  ElDoradoQuoteRequest,
  BacktestRunRequest,
  BacktestRunResult,
  ScreenPipeSource,
  AlphaWatcherConfigDto,
  TreasurySnapshotDto,
} from '../../shared/types';
import { P2PDatabaseService } from '../db/database';
import { parseCloseCyclePayload } from '../db/decision-journal.repository';
import type {
  DecisionCyclesFilter,
  DecisionJournalRequest,
  DecisionPerformanceFilter,
  OpenDecisionCycleInput,
  RecordDecisionInput,
  RecordMarketSnapshotInput,
  RecordOutcomeInput,
} from '../db/decision-journal.repository';
import { GeminiOrchestrator } from '../gemini-orchestrator';
import { AgentSwarmOrchestrator } from '../agents/swarm-orchestrator';
import { getTreasurySnapshot, setTreasurySnapshot } from './treasury-snapshot';
import { killswitchState, triggerKillswitch } from './killswitch-state';
import {
  MonteCarloSimulator,
  type MonteCarloSimulationConfig,
} from '../agents/monte-carlo-simulator';
import { getMcpFullStatus, executeMcpToolTest } from '../mcp-bootstrap';
import { AlphaWatcher } from '../alpha-watcher';
import { ClipboardWatcherService } from '../services/clipboard-watcher';
import { createNodeExecutor, resolveAppRoot, runBacktest } from '../services/backtest-runner';
import {
  isSecretStorageAvailable,
  encryptSecret,
  decryptSecret,
  SECRET_SCHEME,
} from '../db/secret-store';
import {
  seedFinancialSkillMarketData,
  getMarketBook,
  seedBcvRate,
  parseCotizaveRatesPayload,
} from '../skills/market-state';
import { parseBinanceP2pItems } from '../vendor/p2p-core/binance-p2p';

/**
 * Exhaustiveness guard. Taking `never` means a new `DecisionJournalOp` that this file
 * does not handle is a compile error here, instead of silently falling through to a
 * runtime `undefined`. A plain `default:` clause would defeat that, because TypeScript
 * considers a switch with a `default` exhaustive regardless of its cases.
 */
function unsupportedDecisionJournalOp(op: never): never {
  throw new Error(`decision_journal: unsupported IPC op "${String(op)}"`);
}

interface BinanceIpcCacheEntry {
  data: unknown;
  timestamp: number;
}

const binanceIpcCache = new Map<string, BinanceIpcCacheEntry>();
const BINANCE_CACHE_TTL_MS = 5000;
const BINANCE_MIN_INTERVAL_MS = 350;
let lastBinanceNetworkCall = 0;
let binanceRateLimitedUntil = 0;

interface CotizaveIpcCacheEntry {
  data: unknown;
  timestamp: number;
}
let cotizaveIpcCache: CotizaveIpcCacheEntry | null = null;
const COTIZAVE_CACHE_TTL_MS = 30_000;
let cotizaveRateLimitedUntil = 0;

/**
 * Typed, allow-listed IPC handlers.
 * `p2p:fetch-binance` allows the app to query Binance P2P public orderbook
 * bypassing any browser CORS limitations natively and securely.
 * `crypto:*` handlers leverage OS-native DPAPI / Keychain encryption via safeStorage.
 */
export function registerIpcHandlers(): void {
  const db = getDbService();

  // Hidratar COTIZAVE_API_KEY en el entorno si fue persistida de forma segura
  if (!process.env['COTIZAVE_API_KEY'] && isSecretStorageAvailable()) {
    try {
      const scheme = db.getConfigValue('cotizave_api_key_scheme');
      const stored = db.getConfigValue('cotizave_api_key');
      if (stored && scheme === SECRET_SCHEME) {
        process.env['COTIZAVE_API_KEY'] = decryptSecret(stored);
      }
    } catch (err) {
      console.warn('[Cotizave] Error descifrando API key almacenada:', err);
    }
  }

  ipcMain.removeHandler('app:get-version');
  ipcMain.handle('app:get-version', (_event: IpcMainInvokeEvent): string => {
    return app.getVersion();
  });

  ipcMain.removeHandler('p2p:fetch-binance');
  ipcMain.handle(
    'p2p:fetch-binance',
    async (_event: IpcMainInvokeEvent, params: BinanceSearchParams): Promise<unknown> => {
      const asset = params.asset ?? 'USDT';
      const fiat = params.fiat ?? 'VES';
      const tradeType = params.tradeType ?? 'BUY';
      const payTypes = params.payTypes ?? [];
      const rows = params.rows ?? 10;
      const cacheKey = `${asset}:${fiat}:${tradeType}:${payTypes.join(',')}:${rows}`;

      const cached = binanceIpcCache.get(cacheKey);
      const now = Date.now();

      // 1. Si está fresco en caché (< 5s), devolver sin tocar red
      if (cached && now - cached.timestamp < BINANCE_CACHE_TTL_MS) {
        return cached.data;
      }

      // 2. Si hay rate-limit activo (HTTP 429 previo)
      if (now < binanceRateLimitedUntil) {
        if (cached && now - cached.timestamp < 120_000) {
          console.warn(
            `[Binance P2P] Rate-limit activo. Retornando caché previo (${Math.round((now - cached.timestamp) / 1000)}s).`,
          );
          return cached.data;
        }
        const remainingSec = Math.ceil((binanceRateLimitedUntil - now) / 1000);
        throw new Error(
          `Binance P2P en enfriamiento por rate-limit (HTTP 429). Reintentando en ${remainingSec}s.`,
        );
      }

      // 3. Pacing / serialización mínima para evitar ráfagas simultáneas
      const timeSinceLast = now - lastBinanceNetworkCall;
      if (timeSinceLast < BINANCE_MIN_INTERVAL_MS) {
        await new Promise((r) => setTimeout(r, BINANCE_MIN_INTERVAL_MS - timeSinceLast));
      }
      lastBinanceNetworkCall = Date.now();

      try {
        const response = await net.fetch(
          'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
          {
            method: 'POST',
            signal: AbortSignal.timeout(15000),
            headers: {
              'Content-Type': 'application/json',
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              Accept: '*/*',
              clienttype: 'web',
              Origin: 'https://p2p.binance.com',
              'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            },
            body: JSON.stringify({
              asset,
              fiat,
              tradeType,
              page: 1,
              rows,
              payTypes,
              countries: [],
              proMerchantAds: false,
              shieldMerchantAds: false,
              filterType: 'all',
              periods: [],
            }),
          },
        );

        if (response.status === 429) {
          binanceRateLimitedUntil = Date.now() + 20_000;
          if (cached) {
            console.warn('[Binance P2P] HTTP 429 recibido. Usando libro en caché.');
            return cached.data;
          }
          throw new Error('Binance P2P respondió HTTP 429 (Too Many Requests). Enfriamiento activado.');
        }

        if (!response.ok) {
          throw new Error(`Binance P2P respondió HTTP ${response.status}`);
        }

        const data = await response.json();
        binanceIpcCache.set(cacheKey, { data, timestamp: Date.now() });
        try {
          const offers = parseBinanceP2pItems(data);
          if (asset === 'USDT' && fiat === 'VES' && offers.length > 0) {
            const currentBook = getMarketBook();
            const buyOffers = tradeType === 'BUY' ? offers : (currentBook?.buyOffers ?? []);
            const sellOffers = tradeType === 'SELL' ? offers : (currentBook?.sellOffers ?? []);
            seedFinancialSkillMarketData({ buyOffers, sellOffers });
          }
        } catch {
          // Ignorar fallo de sincronización de libro
        }
        return data;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('ENOTFOUND') ||
          message.includes('fetch failed') ||
          message.includes('aborted') ||
          message.includes('timeout')
        ) {
          throw new Error(
            'Servidor de Binance P2P no accesible (sin conexión o DNS no disponible)',
            { cause: err },
          );
        }
        throw new Error(message, { cause: err });
      }
    },
  );

  ipcMain.removeHandler('p2p:fetch-binance-spot');
  ipcMain.handle(
    'p2p:fetch-binance-spot',
    async (_event: IpcMainInvokeEvent, symbol: string): Promise<unknown> => {
      const cleanSymbol =
        typeof symbol === 'string' && symbol.trim() ? symbol.trim().toUpperCase() : 'USDCUSDT';
      try {
        const url = `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(cleanSymbol)}`;
        const response = await net.fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          throw new Error(`Binance Spot HTTP Error ${response.status}`);
        }
        return await response.json();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('ENOTFOUND') ||
          message.includes('fetch failed') ||
          message.includes('aborted') ||
          message.includes('timeout')
        ) {
          throw new Error('Servidor de Binance Spot no accesible (sin conexión o timeout)', {
            cause: err,
          });
        }
        throw new Error(message, { cause: err });
      }
    },
  );

  ipcMain.removeHandler('p2p:fetch-binance-c2c-orders');
  ipcMain.handle(
    'p2p:fetch-binance-c2c-orders',
    async (_event: IpcMainInvokeEvent, req: BinanceC2cOrdersFetchRequest): Promise<unknown> => {
      if (
        !req ||
        typeof req.apiKey !== 'string' ||
        req.apiKey.trim().length === 0 ||
        typeof req.apiSecret !== 'string' ||
        req.apiSecret.trim().length === 0
      ) {
        throw new Error('Binance API key and secret are required for C2C trade history');
      }

      const tradeType = req.tradeType ?? 'BUY';
      const page = req.page ?? 1;
      const rows = req.rows ?? 100;
      const timestamp = Date.now().toString();
      const recvWindow = '10000';

      const queryParts = [
        `tradeType=${encodeURIComponent(tradeType)}`,
        `page=${page}`,
        `rows=${rows}`,
      ];

      if (req.startTimestamp) {
        queryParts.push(`startTimestamp=${req.startTimestamp}`);
      }
      if (req.endTimestamp) {
        queryParts.push(`endTimestamp=${req.endTimestamp}`);
      }
      queryParts.push(`recvWindow=${recvWindow}`);
      queryParts.push(`timestamp=${timestamp}`);

      const queryString = queryParts.join('&');
      const signature = createHmac('sha256', req.apiSecret.trim())
        .update(queryString)
        .digest('hex');

      const fullUrl = `https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory?${queryString}&signature=${signature}`;

      try {
        const response = await net.fetch(fullUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(15000),
          headers: {
            'X-MBX-APIKEY': req.apiKey.trim(),
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Binance C2C API HTTP Error ${response.status}`);
        }

        return await response.json();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('ENOTFOUND') ||
          message.includes('fetch failed') ||
          message.includes('aborted') ||
          message.includes('timeout')
        ) {
          throw new Error('Servidor Binance C2C no accesible (sin conexión o timeout)', {
            cause: err,
          });
        }
        throw new Error(message, { cause: err });
      }
    },
  );

  ipcMain.removeHandler('p2p:fetch-cotizave');
  ipcMain.handle(
    'p2p:fetch-cotizave',
    async (_event: IpcMainInvokeEvent, req: CotizaveRequest): Promise<unknown> => {
      if (!req || typeof req.apiKey !== 'string' || req.apiKey.trim().length === 0) {
        throw new Error('Cotizave API key is required');
      }
      if (req.endpoint !== 'rates') {
        throw new Error('Cotizave endpoint must be "rates"');
      }
      const trimmedKey = req.apiKey.trim();
      process.env['COTIZAVE_API_KEY'] = trimmedKey;

      if (isSecretStorageAvailable()) {
        try {
          db.setConfigValue('cotizave_api_key', encryptSecret(trimmedKey));
          db.setConfigValue('cotizave_api_key_scheme', SECRET_SCHEME);
        } catch (err) {
          console.warn('[Cotizave] safeStorage failed to persist API key:', err);
        }
      }

      const now = Date.now();
      if (cotizaveIpcCache && now - cotizaveIpcCache.timestamp < COTIZAVE_CACHE_TTL_MS) {
        return cotizaveIpcCache.data;
      }
      if (now < cotizaveRateLimitedUntil && cotizaveIpcCache) {
        console.warn('[Cotizave] Rate limit activo (429). Retornando rates desde caché fresca.');
        return cotizaveIpcCache.data;
      }

      try {
        const url = `https://api.cotizave.com/v1/fx/${req.endpoint}`;
        const response = await net.fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(15000),
          headers: {
            'X-API-Key': trimmedKey,
            Accept: 'application/json',
          },
        });
        if (!response.ok) {
          if (response.status === 429) {
            cotizaveRateLimitedUntil = Date.now() + 60_000;
            if (cotizaveIpcCache) {
              console.warn('[Cotizave] HTTP 429 detectado. Retornando caché previa de tasas.');
              return cotizaveIpcCache.data;
            }
          }
          const retryAfter = response.headers.get('retry-after');
          const retryMsg = retryAfter ? ` (retry-after: ${retryAfter}s)` : '';
          throw new Error(`Cotizave HTTP Error ${response.status}${retryMsg}`);
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          throw new Error('Cotizave returned non-JSON response');
        }
        const jsonResult = await response.json();
        cotizaveIpcCache = { data: jsonResult, timestamp: Date.now() };
        try {
          const reading = parseCotizaveRatesPayload(jsonResult);
          if (reading && typeof reading.usd === 'number' && reading.usd > 0) {
            seedBcvRate({
              usd: reading.usd,
              eur: reading.eur,
              source: reading.source,
              updatedAt: Date.now(),
              effectiveDate: reading.effectiveDate,
            });
          }
        } catch {
          // Ignorar fallo de sincronización BCV
        }
        return jsonResult;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('ENOTFOUND') ||
          message.includes('fetch failed') ||
          message.includes('aborted') ||
          message.includes('timeout')
        ) {
          throw new Error('Servidor Cotizave no accesible (sin conexión o timeout)', {
            cause: err,
          });
        }
        throw new Error(message, { cause: err });
      }
    },
  );

  ipcMain.removeHandler('p2p:fetch-bybit-p2p');
  ipcMain.handle(
    'p2p:fetch-bybit-p2p',
    async (_event: IpcMainInvokeEvent, req: BybitP2pFetchRequest): Promise<unknown> => {
      if (
        !req ||
        typeof req.apiKey !== 'string' ||
        req.apiKey.trim().length === 0 ||
        typeof req.apiSecret !== 'string' ||
        req.apiSecret.trim().length === 0
      ) {
        throw new Error('Bybit P2P API key and secret are required');
      }
      if (req.side !== 0 && req.side !== 1) {
        throw new Error('Bybit P2P side must be 0 (BUY) or 1 (SELL)');
      }

      const tokenId = req.tokenId ?? 'USDT';
      const currencyId = req.currencyId ?? 'VES';
      const page = req.page ?? 1;
      const size = req.size ?? 5;
      const body = JSON.stringify({ tokenId, currencyId, side: req.side, page, size });
      const timestamp = Date.now().toString();
      const recvWindow = '20000';
      const sign = createHmac('sha256', req.apiSecret.trim())
        .update(`${timestamp}${req.apiKey.trim()}${recvWindow}${body}`)
        .digest('hex');

      try {
        const response = await net.fetch('https://api.bybit.com/v5/p2p/item/online', {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            'X-BAPI-API-KEY': req.apiKey.trim(),
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-RECV-WINDOW': recvWindow,
            'X-BAPI-SIGN': sign,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body,
        });
        if (!response.ok) {
          throw new Error(`Bybit P2P HTTP Error ${response.status}`);
        }
        return await response.json();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('ENOTFOUND') ||
          message.includes('fetch failed') ||
          message.includes('aborted') ||
          message.includes('timeout')
        ) {
          throw new Error('Servidor Bybit P2P no accesible (sin conexión o timeout)', {
            cause: err,
          });
        }
        throw new Error(message, { cause: err });
      }
    },
  );

  ipcMain.removeHandler('p2p:fetch-eldorado-quote');
  ipcMain.handle(
    'p2p:fetch-eldorado-quote',
    async (_event: IpcMainInvokeEvent, req: ElDoradoQuoteRequest): Promise<unknown> => {
      if (
        !req ||
        typeof req.clientId !== 'string' ||
        req.clientId.trim().length === 0 ||
        typeof req.referralId !== 'string' ||
        req.referralId.trim().length === 0
      ) {
        throw new Error('El Dorado clientId and referralId are required');
      }
      if (req.direction !== 'buy' && req.direction !== 'sell') {
        throw new Error('El Dorado direction must be "buy" or "sell"');
      }

      const headers: Record<string, string> = {
        'X-Client-ID': req.clientId.trim(),
        'X-Referral-ID': req.referralId.trim(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (req.apiKey && req.apiKey.trim().length > 0) {
        headers['Authorization'] = `Bearer ${req.apiKey.trim()}`;
      }

      const body = {
        crypto: req.asset ?? 'USDT',
        legalTender: req.fiat ?? 'USD',
        ...(typeof req.amount === 'number' && req.amount > 0 ? { amount: req.amount } : {}),
        ...(req.paymentMethod && req.paymentMethod.trim().length > 0
          ? { payment_method: req.paymentMethod.trim() }
          : {}),
      };

      try {
        const response = await net.fetch(`https://api.eldorado.io/api/quote/${req.direction}`, {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`El Dorado HTTP Error ${response.status}`);
        }
        return await response.json();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('ENOTFOUND') ||
          message.includes('fetch failed') ||
          message.includes('aborted') ||
          message.includes('timeout')
        ) {
          throw new Error('Servidor El Dorado no accesible (sin conexión o timeout)', {
            cause: err,
          });
        }
        throw new Error(message, { cause: err });
      }
    },
  );

  ipcMain.removeHandler('p2p:backtest-run');
  ipcMain.handle(
    'p2p:backtest-run',
    async (_event: IpcMainInvokeEvent, req: BacktestRunRequest): Promise<BacktestRunResult> => {
      // `req` carries only the pair/timeframe labels the operator picked in Telegram.
      // They are never forwarded to the process: the harness path is a main-process
      // constant and the harness takes no selectors on its CLI, so the renderer has no
      // influence over what runs.
      return runBacktest(req ?? {}, {
        appRoot: resolveAppRoot(app.getAppPath()),
        execute: createNodeExecutor(),
      });
    },
  );

  ipcMain.removeHandler('crypto:is-available');
  ipcMain.handle('crypto:is-available', (): boolean => {
    return safeStorage.isEncryptionAvailable();
  });

  ipcMain.removeHandler('crypto:encrypt');
  ipcMain.handle('crypto:encrypt', (_event: IpcMainInvokeEvent, plaintext: string): string => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this platform');
    }
    const buffer = safeStorage.encryptString(plaintext);
    return buffer.toString('base64');
  });

  ipcMain.removeHandler('crypto:decrypt');
  ipcMain.handle('crypto:decrypt', (_event: IpcMainInvokeEvent, ciphertext: string): string => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this platform');
    }
    const buffer = Buffer.from(ciphertext, 'base64');
    return safeStorage.decryptString(buffer);
  });


  ipcMain.removeHandler('p2p:db-save-order');
  ipcMain.handle('p2p:db-save-order', (_event: IpcMainInvokeEvent, order: unknown): boolean => {
    try {
      db.saveOrder(order as any);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.removeHandler('p2p:db-get-order');
  ipcMain.handle('p2p:db-get-order', (_event: IpcMainInvokeEvent, orderId: string): unknown => {
    return db.getOrder(orderId);
  });

  ipcMain.removeHandler('p2p:db-list-active-orders');
  ipcMain.handle('p2p:db-list-active-orders', (): unknown[] => {
    return db.listActiveOrders();
  });

  ipcMain.removeHandler('p2p:db-record-bank-event');
  ipcMain.handle(
    'p2p:db-record-bank-event',
    (_event: IpcMainInvokeEvent, event: unknown): { isDuplicate: boolean; eventId: number } => {
      return db.recordInboundBankEvent(event as any);
    },
  );

  ipcMain.removeHandler('p2p:db-save-audit-log');
  ipcMain.handle('p2p:db-save-audit-log', (_event: IpcMainInvokeEvent, record: any): boolean => {
    try {
      return db.recordAuditLog(record);
    } catch (err) {
      console.warn('[IPC] Error in p2p:db-save-audit-log:', err);
      return false;
    }
  });

  ipcMain.removeHandler('p2p:db-list-audit-logs');
  ipcMain.handle(
    'p2p:db-list-audit-logs',
    (_event: IpcMainInvokeEvent, params?: { limit?: number; category?: string }): unknown[] => {
      try {
        return db.listAuditLogs(params?.limit, params?.category);
      } catch (err) {
        console.warn('[IPC] Error in p2p:db-list-audit-logs:', err);
        return [];
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Decision Journal
  //
  // One channel with an explicit `op` instead of one channel per operation: the journal
  // is a single append-only record set, so a single allow-listed entry point keeps the
  // renderer surface auditable in one place. The wire shape is `{ op, payload }`; the
  // switch narrows the opaque payload per op.
  //
  // Journal writes are NOT wrapped in try/catch-and-swallow: a rejected write (unknown
  // cycle, closed cycle) is information the caller must see, so the prefixed
  // `decision_journal:` Error propagates to the renderer instead of degrading to a
  // silent no-op. This is deliberately unlike the best-effort order/audit handlers
  // above, where a missing row is treated as an empty result.
  // ---------------------------------------------------------------------------
  ipcMain.removeHandler('p2p:db-decision-journal');
  ipcMain.handle(
    'p2p:db-decision-journal',
    async (_event: IpcMainInvokeEvent, request: DecisionJournalRequest): Promise<unknown> => {
      const journal = db.getDecisionJournal();
      const payload = request.payload;
      switch (request.op) {
        case 'appendMarketSnapshot':
          return journal.appendMarketSnapshot(payload as RecordMarketSnapshotInput);
        case 'openCycle':
          return journal.openCycle(payload as OpenDecisionCycleInput);
        case 'closeCycle':
          // Validated, not cast: `payload` is `unknown` here, and `closeCycle` is the one
          // op whose payload can restate a cycle's realized figures. A malformed request is
          // refused with a flat `decision_journal:` error naming the offending field; the
          // cast it replaces would have thrown a bare `TypeError` on a missing `payload`, or
          // forwarded unchecked numbers into the columns the operator reads to judge
          // performance. The adapter still enforces the terminal-cycle invariant itself —
          // this is the shape check in front of it, not a replacement.
          return (() => {
            const { cycleId, input } = parseCloseCyclePayload(payload);
            return journal.closeCycle(cycleId, input);
          })();
        case 'getCycle':
          return journal.getCycle(payload as string);
        case 'listCycles':
          return journal.listCycles(payload as DecisionCyclesFilter | undefined);
        case 'appendDecision':
          return journal.appendDecision(payload as RecordDecisionInput);
        case 'getDecision':
          return journal.getDecision(payload as number);
        case 'listDecisionsByCycle':
          return journal.listDecisionsByCycle(payload as string);
        case 'appendOutcome':
          return journal.appendOutcome(payload as RecordOutcomeInput);
        case 'listOutcomesByDecision':
          return journal.listOutcomesByDecision(payload as number);
        case 'getDecisionPerformance':
          return journal.getDecisionPerformance(payload as DecisionPerformanceFilter | undefined);
        case 'getVerificationSummary':
          return journal.getVerificationSummary(
            payload as DecisionPerformanceFilter | undefined,
          );
        case 'purgeMarketSnapshotsBefore':
          return db.purgeMarketSnapshotsBefore(payload as number);
        default:
          return unsupportedDecisionJournalOp(request.op);
      }
    },
  );

  ipcMain.removeHandler('p2p:db-save-operation-record');
  ipcMain.handle(
    'p2p:db-save-operation-record',
    (_event: IpcMainInvokeEvent, record: any): boolean => {
      try {
        return db.saveOperationRecord(record);
      } catch (err) {
        console.warn('[IPC] Error in p2p:db-save-operation-record:', err);
        return false;
      }
    },
  );

  ipcMain.removeHandler('p2p:db-list-operation-records');
  ipcMain.handle(
    'p2p:db-list-operation-records',
    (_event: IpcMainInvokeEvent, params?: { limit?: number }): unknown[] => {
      try {
        return db.listOperationRecords(params?.limit);
      } catch (err) {
        console.warn('[IPC] Error in p2p:db-list-operation-records:', err);
        return [];
      }
    },
  );

  ipcMain.removeHandler('p2p:db-save-bank-account');
  ipcMain.handle(
    'p2p:db-save-bank-account',
    (_event: IpcMainInvokeEvent, account: any): boolean => {
      try {
        return db.saveBankAccount(account);
      } catch (err) {
        console.warn('[IPC] Error in p2p:db-save-bank-account:', err);
        return false;
      }
    },
  );

  ipcMain.removeHandler('p2p:db-get-bank-account');
  ipcMain.handle(
    'p2p:db-get-bank-account',
    (_event: IpcMainInvokeEvent, id: string): unknown => {
      try {
        return db.getBankAccount(id);
      } catch (err) {
        console.warn('[IPC] Error in p2p:db-get-bank-account:', err);
        return null;
      }
    },
  );

  ipcMain.removeHandler('p2p:db-list-bank-accounts');
  ipcMain.handle(
    'p2p:db-list-bank-accounts',
    (_event: IpcMainInvokeEvent, filter?: { status?: string; bankCode?: string }): unknown[] => {
      try {
        return db.listBankAccounts(filter);
      } catch (err) {
        console.warn('[IPC] Error in p2p:db-list-bank-accounts:', err);
        return [];
      }
    },
  );

  ipcMain.removeHandler('p2p:db-delete-bank-account');
  ipcMain.handle(
    'p2p:db-delete-bank-account',
    (_event: IpcMainInvokeEvent, id: string): boolean => {
      try {
        return db.deleteBankAccount(id);
      } catch (err) {
        console.warn('[IPC] Error in p2p:db-delete-bank-account:', err);
        return false;
      }
    },
  );

  ipcMain.removeHandler('p2p:killswitch-trigger');
  ipcMain.handle(
    'p2p:killswitch-trigger',
    (_event: IpcMainInvokeEvent, params: { reason?: string; source?: string }): boolean => {
      return triggerKillswitch(params?.reason, params?.source);
    },
  );

  ipcMain.removeHandler('p2p:killswitch-status');
  ipcMain.handle('p2p:killswitch-status', () => {
    return { ...killswitchState };
  });

  // Bank accounts live only in renderer localStorage (`p2p.bank-accounts`), so this is the
  // single ingress that lets the main process audit against real limits instead of literals.
  ipcMain.removeHandler('p2p:treasury-announce');
  ipcMain.handle(
    'p2p:treasury-announce',
    (_event: IpcMainInvokeEvent, snapshot: TreasurySnapshotDto): boolean => {
      return setTreasurySnapshot(snapshot);
    },
  );

  ipcMain.removeHandler('p2p:screen-pipe-sources');
  ipcMain.handle('p2p:screen-pipe-sources', async (): Promise<ScreenPipeSource[]> => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false,
      });
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnailDataUrl: s.thumbnail.toDataURL(),
      }));
    } catch {
      return [];
    }
  });

  ipcMain.removeHandler('p2p:screen-pipe-capture');
  ipcMain.handle(
    'p2p:screen-pipe-capture',
    async (
      _event: IpcMainInvokeEvent,
      options?: { sourceId?: string },
    ): Promise<{ dataUrl: string; timestampMs: number } | null> => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['window', 'screen'],
          thumbnailSize: { width: 1920, height: 1080 },
        });
        const target = options?.sourceId
          ? sources.find((s) => s.id === options.sourceId)
          : sources[0];
        if (!target) return null;
        return {
          dataUrl: target.thumbnail.toDataURL(),
          timestampMs: Date.now(),
        };
      } catch {
        return null;
      }
    },
  );

  const orchestrator = getOrchestrator();

  ipcMain.removeHandler('copilot:send-message');
  ipcMain.handle(
    'copilot:send-message',
    async (
      _event: IpcMainInvokeEvent,
      params: {
        prompt: string;
        history?: any[];
        apiKey?: string;
        provider?: any;
        model?: string;
      },
    ) => {
      return orchestrator.sendMessage(params);
    },
  );

  ipcMain.removeHandler('copilot:transcribe-audio');
  ipcMain.handle(
    'copilot:transcribe-audio',
    async (_event: IpcMainInvokeEvent, params: { audioBase64: string; mimeType: string }) => {
      return orchestrator.transcribeAudio(params);
    },
  );

  ipcMain.removeHandler('copilot:execute-plan');
  ipcMain.handle(
    'copilot:execute-plan',
    (_event: IpcMainInvokeEvent, params: { planId: string }) => {
      return orchestrator.executePlan(params.planId);
    },
  );

  ipcMain.removeHandler('copilot:get-plans');
  ipcMain.handle('copilot:get-plans', (_event: IpcMainInvokeEvent, params?: { limit?: number }) => {
    return orchestrator.getPlans(params?.limit);
  });

  ipcMain.removeHandler('copilot:get-learnings');
  ipcMain.handle(
    'copilot:get-learnings',
    (_event: IpcMainInvokeEvent, params?: { category?: string; limit?: number }) => {
      return orchestrator.getLearnings(params?.category, params?.limit);
    },
  );

  ipcMain.removeHandler('copilot:get-engram-observations');
  ipcMain.handle(
    'copilot:get-engram-observations',
    (
      _event: IpcMainInvokeEvent,
      params?: { filter?: { topicKey?: string; type?: string; status?: string }; limit?: number },
    ) => {
      return orchestrator.getEngramObservations(params?.filter, params?.limit);
    },
  );

  ipcMain.removeHandler('copilot:set-api-key');
  ipcMain.handle(
    'copilot:set-api-key',
    (_event: IpcMainInvokeEvent, params: { apiKey: string; provider?: any }) => {
      orchestrator.setApiKey(params.apiKey, params.provider);
      return true;
    },
  );

  ipcMain.removeHandler('copilot:set-provider-config');
  ipcMain.handle(
    'copilot:set-provider-config',
    (_event: IpcMainInvokeEvent, params: { provider: any; model?: string; apiKey?: string }) => {
      if (params.apiKey) {
        orchestrator.setApiKey(params.apiKey, params.provider);
      }
      orchestrator.setActiveProvider(params.provider, params.model);
      return true;
    },
  );

  ipcMain.removeHandler('copilot:get-provider-config');
  ipcMain.handle('copilot:get-provider-config', () => {
    return orchestrator.getProviderConfigStatus();
  });

  ipcMain.removeHandler('copilot:test-connection');
  ipcMain.handle(
    'copilot:test-connection',
    async (
      _event: IpcMainInvokeEvent,
      params?: { provider?: any; apiKey?: string; model?: string },
    ) => {
      if (params?.model && params?.provider) {
        orchestrator.setActiveProvider(params.provider, params.model);
      }
      return orchestrator.testConnection(params?.provider, params?.apiKey);
    },
  );

  ipcMain.removeHandler('copilot:get-watcher-status');
  ipcMain.handle('copilot:get-watcher-status', async () => {
    const watcher = getAlphaWatcher();
    return watcher.getStatus();
  });

  ipcMain.removeHandler('copilot:set-watcher-config');
  ipcMain.handle(
    'copilot:set-watcher-config',
    async (_event: IpcMainInvokeEvent, params: Partial<AlphaWatcherConfigDto>) => {
      const watcher = getAlphaWatcher();
      watcher.setConfig(params);
      return true;
    },
  );

  ipcMain.removeHandler('copilot:run-swarm-analysis');
  ipcMain.handle('copilot:run-swarm-analysis', async (_event: IpcMainInvokeEvent, params?: any) => {
    const swarm = getAgentSwarm();
    return swarm.runAnalysisPipeline(params);
  });

  ipcMain.removeHandler('copilot:get-swarm-health');
  ipcMain.handle('copilot:get-swarm-health', async () => {
    const swarm = getAgentSwarm();
    return swarm.getSwarmHealth();
  });

  ipcMain.removeHandler('copilot:audit-dispute-proof');
  ipcMain.handle('copilot:audit-dispute-proof', async (_event: IpcMainInvokeEvent, params: any) => {
    const swarm = getAgentSwarm();
    return swarm.auditPaymentProof(params);
  });

  ipcMain.removeHandler('copilot:trigger-proactive-eval');
  ipcMain.handle(
    'copilot:trigger-proactive-eval',
    async (
      _event: IpcMainInvokeEvent,
      params?: { parallelRate?: number; bcvRate?: number; spotUsdt?: number },
    ) => {
      const watcher = getAlphaWatcher();
      const engine = watcher.getProactiveEngine();

      // DECLARED ABSENCE — a measurement the caller did not send stays `null`.
      //
      // `?? 78.5 / ?? 65.5 / ?? 1.0` turned "the renderer has no data right now" into a live
      // evaluation: a 19.7% BCV gap at an invented 78.5/65.5, plus a depeg check run against
      // USDT's peg value, which by construction can never fire. The renderer polls this channel,
      // so those alerts reached the swarm's alerting path as if the rates had been observed.
      const parallel = params?.parallelRate ?? null;
      const bcv = params?.bcvRate ?? null;
      const spot = params?.spotUsdt ?? null;

      // Only evaluate what was actually measured. Each alert needs its own real input: a gap
      // needs both rates, and the depeg monitor needs a real USDT/USD spot reading.
      const macroAlert =
        parallel !== null && bcv !== null ? engine.evaluateBcvMacroEvent(parallel, bcv) : null;
      const depegAlert = spot !== null ? engine.evaluateUsdtDepegEvent(spot) : null;

      const unavailable: Array<{
        measurement: 'parallelRate' | 'bcvRate' | 'spotUsdt';
        reason: string;
        expectedSource: string;
      }> = [];
      if (parallel === null) {
        unavailable.push({
          measurement: 'parallelRate',
          reason: 'El llamador no envió la tasa paralelo P2P.',
          expectedSource:
            'MCP get_parallel_rates / libro P2P de Binance (adv/search) para USDT/VES.',
        });
      }
      if (bcv === null) {
        unavailable.push({
          measurement: 'bcvRate',
          reason: 'El llamador no envió la tasa oficial BCV.',
          expectedSource:
            'MCP get_bcv_rates (Cotizave API GET /v1/fx/rates, market reference→USD oficial).',
        });
      }
      if (spot === null) {
        unavailable.push({
          measurement: 'spotUsdt',
          reason:
            'El llamador no envió el precio spot USDT/USD. La paridad 1.0 NO se usa como sustituto: ' +
            'es el valor del peg, así que un despeg evaluado contra él nunca puede dispararse.',
          expectedSource: 'Ticker público del exchange para el par USDTUSD (libro spot).',
        });
      }

      return {
        macroAlert,
        depegAlert,
        ...(unavailable.length > 0 ? { unavailable } : {}),
      };
    },
  );

  ipcMain.removeHandler('copilot:assess-counterparty');
  ipcMain.handle(
    'copilot:assess-counterparty',
    async (
      _event: IpcMainInvokeEvent,
      params: { alias: string; realName: string; documentId?: string; bankPayerName?: string },
    ) => {
      const swarm = getAgentSwarm();
      return swarm.getCounterpartyGraph().assessRisk(params);
    },
  );

  ipcMain.removeHandler('copilot:record-counterparty-trade');
  ipcMain.handle(
    'copilot:record-counterparty-trade',
    async (
      _event: IpcMainInvokeEvent,
      params: {
        alias: string;
        realName: string;
        documentId: string;
        volumeUsdt: number;
        bankPayerName: string;
        hadTriangulationAttempt: boolean;
      },
    ) => {
      const swarm = getAgentSwarm();
      swarm.getCounterpartyGraph().recordTrade(params);
      return { success: true };
    },
  );

  ipcMain.removeHandler('copilot:list-counterparties');
  ipcMain.handle(
    'copilot:list-counterparties',
    async (_event: IpcMainInvokeEvent, params?: { limit?: number }) => {
      const swarm = getAgentSwarm();
      return swarm.getCounterpartyGraph().listProfiles(params?.limit ?? 50);
    },
  );

  ipcMain.removeHandler('copilot:run-monte-carlo');
  ipcMain.handle(
    'copilot:run-monte-carlo',
    async (
      _event: IpcMainInvokeEvent,
      params: { offers: any[]; config: MonteCarloSimulationConfig },
    ) => {
      const sim = new MonteCarloSimulator();
      return sim.runSimulation(
        params?.offers ?? [],
        params?.config ?? {
          iterations: 500,
          cancellationProbabilityPct: 15,
          priceDriftVolatilityBps: 30,
          ticketAmountUsdt: 1000,
          side: 'BUY',
        },
      );
    },
  );

  ipcMain.removeHandler('copilot:list-agents');
  ipcMain.handle('copilot:list-agents', async () => {
    return orchestrator.listAgents();
  });

  ipcMain.removeHandler('copilot:toggle-agent');
  ipcMain.handle(
    'copilot:toggle-agent',
    async (_event: IpcMainInvokeEvent, params: { id: string; enabled: boolean }) => {
      return orchestrator.toggleAgent(params.id, params.enabled);
    },
  );

  ipcMain.removeHandler('copilot:save-agent');
  ipcMain.handle(
    'copilot:save-agent',
    async (_event: IpcMainInvokeEvent, params: { agent: any }) => {
      return orchestrator.saveAgent(params.agent);
    },
  );

  ipcMain.removeHandler('p2p:mcp-status');
  ipcMain.handle('p2p:mcp-status', async () => {
    return getMcpFullStatus();
  });

  ipcMain.removeHandler('p2p:mcp-test-tool');
  ipcMain.handle(
    'p2p:mcp-test-tool',
    async (_event: IpcMainInvokeEvent, params: { toolName: string; args: unknown }) => {
      return executeMcpToolTest(params.toolName, params.args);
    },
  );

  ipcMain.removeHandler('p2p:clipboard-watcher-toggle');
  ipcMain.handle(
    'p2p:clipboard-watcher-toggle',
    async (_event: IpcMainInvokeEvent, params: { enabled: boolean }): Promise<boolean> => {
      const watcher = getClipboardWatcher();
      if (params.enabled) {
        watcher.start();
      } else {
        watcher.stop();
      }
      return watcher.isEnabled();
    },
  );

  ipcMain.removeHandler('p2p:clipboard-watcher-status');
  ipcMain.handle('p2p:clipboard-watcher-status', async () => {
    return getClipboardWatcher().getStatus();
  });
}

let dbInstance: P2PDatabaseService | null = null;
export function getDbService(): P2PDatabaseService {
  if (!dbInstance) {
    dbInstance = new P2PDatabaseService();
  }
  return dbInstance;
}

let orchestratorInstance: GeminiOrchestrator | null = null;
export function getOrchestrator(): GeminiOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new GeminiOrchestrator(getDbService(), undefined, getAgentSwarm());
  }
  return orchestratorInstance;
}

let alphaWatcherInstance: AlphaWatcher | null = null;
export function setAlphaWatcher(watcher: AlphaWatcher): void {
  alphaWatcherInstance = watcher;
}

export function getAlphaWatcher(): AlphaWatcher {
  if (!alphaWatcherInstance) {
    alphaWatcherInstance = new AlphaWatcher(getDbService(), () => null);
  }
  return alphaWatcherInstance;
}

let clipboardWatcherInstance: ClipboardWatcherService | null = null;
export function setClipboardWatcher(watcher: ClipboardWatcherService): void {
  clipboardWatcherInstance = watcher;
}

export function getClipboardWatcher(): ClipboardWatcherService {
  if (!clipboardWatcherInstance) {
    clipboardWatcherInstance = new ClipboardWatcherService(getDbService(), () => null);
  }
  return clipboardWatcherInstance;
}

let agentSwarmInstance: AgentSwarmOrchestrator | null = null;
export function getAgentSwarm(): AgentSwarmOrchestrator {
  if (!agentSwarmInstance) {
    agentSwarmInstance = new AgentSwarmOrchestrator(getDbService());
  }
  return agentSwarmInstance;
}

/**
 * Kill-switch state lives in `ipc/killswitch-state.ts` (a leaf module) and is re-exported
 * here for backward compatibility with existing importers. Keeping it out of this file is
 * what lets `gemini-orchestrator.ts` enforce the kill-switch on plan execution: handlers.ts
 * imports the orchestrator, so the orchestrator must not import handlers.
 */
export type { KillswitchState } from './killswitch-state';
export { killswitchState, triggerKillswitch };

/**
 * Latest treasury snapshot announced by the renderer, or null when it never announced one.
 * The swarm reads it from `ipc/treasury-snapshot` directly (that module is a leaf, so no
 * import cycle with this file); this getter is the public accessor for other main-process
 * consumers such as plan execution.
 */
export function getLatestTreasurySnapshot(): TreasurySnapshotDto | null {
  return getTreasurySnapshot();
}

// Compile-time guarantee that the handler map matches the channel contract.
export type RegisteredChannels = keyof P2PIpcChannels;
