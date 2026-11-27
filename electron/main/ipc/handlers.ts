import { ipcMain, app, net, safeStorage, shell, desktopCapturer, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHmac } from 'crypto';
import {
  ARM_WORKSPACES,
  type BinanceDockOpenRequest,
  type BinanceDockStateDto,
  type P2PIpcChannels,
  type BinanceSearchParams,
  type BinanceC2cOrdersFetchRequest,
  type CotizaveRequest,
  type BybitP2pFetchRequest,
  type ElDoradoQuoteRequest,
  type BacktestRunRequest,
  type BacktestRunResult,
  type ScreenPipeSource,
  type AlphaWatcherConfigDto,
  type TreasurySnapshotDto,
  type ArmWorkspaceCode,
  type ArmBankRailRecord,
  type ArmPaymentReceiptInput,
  type ArmTreasurySettlementInput,
  type Finance360SnapshotPayload,
  type Finance360StoredSnapshot,
  type Finance360SaveSnapshotResult,
  type Finance360AiAnalyzeRequest,
  type Finance360AiAnalyzeResult,
  type Finance360ExportPdfRequest,
  type Finance360ExportPdfResult,
} from '../../shared/types';
import { P2PDatabaseService } from '../db/database';
import { parseCloseCyclePayload } from '../db/decision-journal.repository';
import type {
  DecisionCyclesFilter,
  DecisionJournalRequest,
  DecisionPerformanceFilter,
  MarketSnapshotsFilter,
  OpenDecisionCycleInput,
  RecordDecisionInput,
  RecordMarketSnapshotInput,
  RecordOutcomeInput,
} from '../db/decision-journal.repository';
import { GeminiOrchestrator } from '../gemini-orchestrator';
import { AgentSwarmOrchestrator } from '../agents/swarm-orchestrator';
import { AgentDaemonScheduler } from '../agents/daemon-scheduler';
import { getTreasurySnapshot, setTreasurySnapshot } from './treasury-snapshot';
import { killswitchState, triggerKillswitch } from './killswitch-state';
import {
  MonteCarloSimulator,
  type MonteCarloSimulationConfig,
} from '../agents/monte-carlo-simulator';
import { getMcpFullStatus, executeMcpToolTest } from '../mcp-bootstrap';
import { AlphaWatcher } from '../alpha-watcher';
import { BinanceOperatorDock, isAllowedBinanceDockUrl } from '../binance-operator-dock';
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
  getBcvSnapshot,
  recordVolatilityTick,
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
const binanceInFlight = new Map<string, Promise<unknown>>();
const BINANCE_CACHE_TTL_MS = 5000;
const BINANCE_MIN_INTERVAL_MS = 350;
let lastBinanceNetworkCall = 0;
let binanceRateLimitedUntil = 0;

interface CotizaveIpcCacheEntry {
  apiKey: string;
  data: unknown;
  timestamp: number;
}
let cotizaveIpcCache: CotizaveIpcCacheEntry | null = null;
let cotizaveInFlight: { apiKey: string; promise: Promise<unknown> } | null = null;
const COTIZAVE_CACHE_TTL_MS = 120_000;
let cotizaveRateLimitedUntil = 0;

const binanceSpotCache = new Map<string, BinanceIpcCacheEntry>();
const binanceSpotInFlight = new Map<string, Promise<unknown>>();
const latestSpotPrices = new Map<string, { price: number; timestamp: number }>();
const AUTO_SNAPSHOT_INTERVAL_MS = 60_000;
let lastAutoSnapshotRecordedAt = 0;

/**
 * Resets Binance P2P IPC cache, in-flight deduplication, pacing, and rate-limit state.
 * Exported for deterministic unit testing alongside `registerIpcHandlers`.
 */
export function clearBinanceP2pCacheForTesting(): void {
  binanceIpcCache.clear();
  binanceInFlight.clear();
  lastBinanceNetworkCall = 0;
  binanceRateLimitedUntil = 0;
  lastAutoSnapshotRecordedAt = 0;
}

function isValidBinanceP2pResponse(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const rec = payload as { code?: unknown; data?: unknown; success?: unknown };
  if (!Array.isArray(rec.data)) {
    return false;
  }
  if (rec.code !== undefined && rec.code !== null && String(rec.code) !== '000000') {
    return false;
  }
  if (rec.success === false) {
    return false;
  }
  return true;
}

function createAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error(
    typeof reason === 'string' && reason.length > 0 ? reason : 'The operation was aborted',
  );
  err.name = 'AbortError';
  return err;
}

function raceWithAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(createAbortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(createAbortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface FetchBinanceP2pSharedOptions {
  signal?: AbortSignal;
}

/**
 * Shared singleflight + cached + paced Binance P2P C2C orderbook fetcher.
 * Used by `p2p:fetch-binance` IPC, the local HTTP bridge (`/api/binance/p2p`),
 * and `AlphaWatcher` so no caller in the main process bypasses pacing or 429 cooldowns.
 */
export async function fetchBinanceP2pShared(
  params: BinanceSearchParams,
  options: FetchBinanceP2pSharedOptions = {},
): Promise<unknown> {
  if (options.signal?.aborted) {
    throw createAbortError(options.signal);
  }

  const asset = params.asset ?? 'USDT';
  const fiat = params.fiat ?? 'VES';
  const tradeType = params.tradeType ?? 'BUY';
  const payTypes = Array.isArray(params.payTypes) ? params.payTypes : [];
  const normalizedPayTypes = payTypes.filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  const rows = params.rows ?? 10;
  const publisherType = params.publisherType === 'merchant' ? 'merchant' : null;
  const transAmount =
    typeof params.transAmount === 'number' && Number.isFinite(params.transAmount) && params.transAmount > 0
      ? Math.round(params.transAmount)
      : undefined;
  const cacheKey = `${asset}:${fiat}:${tradeType}:${normalizedPayTypes.join(',')}:${rows}:${publisherType ?? 'all'}:${transAmount ?? 'any'}`;

  const cached = binanceIpcCache.get(cacheKey);
  const now = Date.now();

  // 1. If fresh in cache (< 5s), return without hitting the network
  if (cached && now - cached.timestamp < BINANCE_CACHE_TTL_MS) {
    return cached.data;
  }

  // 2. If HTTP 429 cooldown is active
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

  // 3. Singleflight: share identical in-flight request while isolating per-caller abort
  const existingFlight = binanceInFlight.get(cacheKey);
  if (existingFlight) {
    return raceWithAbortSignal(existingFlight, options.signal);
  }

  const run = (async (): Promise<unknown> => {
    // 4. Reserve atomic pacing slot BEFORE await so concurrent callers do not burst
    const nowPacing = Date.now();
    const scheduledAt = Math.max(nowPacing, lastBinanceNetworkCall + BINANCE_MIN_INTERVAL_MS);
    lastBinanceNetworkCall = scheduledAt;
    const waitMs = scheduledAt - nowPacing;
    if (waitMs > 0) {
      await sleepWithAbort(waitMs, options.signal);
    }

    const timeoutSignal = AbortSignal.timeout(12_000);
    const requestSignal = options.signal
      ? AbortSignal.any([timeoutSignal, options.signal])
      : timeoutSignal;

    try {
      const response = await raceWithAbortSignal(
        net.fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
          method: 'POST',
          signal: requestSignal,
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
            payTypes: normalizedPayTypes,
            countries: [],
            proMerchantAds: false,
            shieldMerchantAds: false,
            filterType: 'all',
            periods: [],
            ...(publisherType ? { publisherType } : {}),
            ...(transAmount !== undefined ? { transAmount } : {}),
          }),
        }),
        requestSignal,
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
      if (!isValidBinanceP2pResponse(data)) {
        return data;
      }

      binanceIpcCache.set(cacheKey, { data, timestamp: Date.now() });

      // Only full-market snapshots (payTypes.length === 0, unfiltered) seed global market state & history
      if (normalizedPayTypes.length === 0 && asset === 'USDT' && fiat === 'VES' && !publisherType && transAmount === undefined) {
        try {
          const offers = parseBinanceP2pItems(data);
          if (offers.length > 0) {
            const sortedOffers = [...offers].sort((a, b) =>
              tradeType === 'BUY' ? a.price - b.price : b.price - a.price,
            );
            const currentBook = getMarketBook();
            const buyOffers =
              tradeType === 'BUY'
                ? sortedOffers
                : [...(currentBook?.buyOffers ?? [])].sort((a, b) => a.price - b.price);
            const sellOffers =
              tradeType === 'SELL'
                ? sortedOffers
                : [...(currentBook?.sellOffers ?? [])].sort((a, b) => b.price - a.price);
            seedFinancialSkillMarketData({ buyOffers, sellOffers });
            if (buyOffers.length > 0 && sellOffers.length > 0) {
              recordVolatilityTick(undefined, null);
              const nowSnap = Date.now();
              if (nowSnap - lastAutoSnapshotRecordedAt >= AUTO_SNAPSHOT_INTERVAL_MS) {
                lastAutoSnapshotRecordedAt = nowSnap;
                const askUsd = Math.min(...buyOffers.map((o) => o.price));
                const bidUsd = Math.max(...sellOffers.map((o) => o.price));
                if (askUsd > 0 && bidUsd > 0) {
                  const askVol = buyOffers
                    .slice(0, 5)
                    .reduce((s, o) => s + (o.price > 0 ? o.maxVes / o.price : 0), 0);
                  const bidVol = sellOffers
                    .slice(0, 5)
                    .reduce((s, o) => s + (o.price > 0 ? o.maxVes / o.price : 0), 0);
                  const totalVol = bidVol + askVol;
                  const obi = totalVol > 0 ? Number(((bidVol - askVol) / totalVol).toFixed(4)) : 0;
                  const btcEntry = latestSpotPrices.get('BTCUSDT');
                  const solEntry = latestSpotPrices.get('SOLUSDT');
                  const usdcEntry = latestSpotPrices.get('USDCUSDT');
                  const bcvSnap = getBcvSnapshot();
                  const snapshotInput: RecordMarketSnapshotInput = {
                    obi,
                    bidUsd,
                    askUsd,
                    nBids: sellOffers.length,
                    nAsks: buyOffers.length,
                    stale: false,
                    ...(btcEntry && nowSnap - btcEntry.timestamp < 300_000
                      ? { btcUsdt: btcEntry.price }
                      : {}),
                    ...(solEntry && nowSnap - solEntry.timestamp < 300_000
                      ? { solUsdt: solEntry.price }
                      : {}),
                    ...(usdcEntry && nowSnap - usdcEntry.timestamp < 300_000
                      ? { usdcUsdt: usdcEntry.price }
                      : {}),
                    ...(bcvSnap && bcvSnap.usd > 0 ? { bcvVes: bcvSnap.usd } : {}),
                  };
                  void getDbService()
                    .getDecisionJournal()
                    .appendMarketSnapshot(snapshotInput)
                    .catch(() => {
                      // Best-effort auto-snapshot persistence
                    });
                }
              }
            }
          }
        } catch {
          // Ignore book sync failures
        }
      }
      return data;
    } catch (err: unknown) {
      if (options.signal?.aborted) {
        throw err instanceof Error ? err : createAbortError(options.signal);
      }
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
    } finally {
      binanceInFlight.delete(cacheKey);
    }
  })();

  binanceInFlight.set(cacheKey, run);
  return raceWithAbortSignal(run, options.signal);
}

function normalizeElectronCotizaveKey(raw: string): string {
  const cleaned = raw
    .replace(/[\u200B-\u200D\uFEFF\r\n]/g, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim()
    .replace(/^COTIZAVE_API_KEY\s*=\s*/i, '')
    .replace(/^X-API-Key\s*:\s*/i, '')
    .replace(/^Authorization\s*:\s*Bearer\s+/i, '')
    .replace(/^Bearer\s+/i, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();
  return cleaned;
}

/**
 * Shared singleflight + cached + 429-protected Cotizave fetcher.
 * Used by both `p2p:fetch-cotizave` IPC and the local HTTP bridge (`/api/cotizave/rates`).
 */
export async function fetchCotizaveShared(req: CotizaveRequest): Promise<unknown> {
  if (!req || typeof req.apiKey !== 'string') {
    throw new Error('Cotizave API key is required');
  }
  const trimmedKey = normalizeElectronCotizaveKey(req.apiKey);
  if (trimmedKey.length === 0) {
    throw new Error('Cotizave API key is required');
  }
  if (req.endpoint !== 'rates') {
    throw new Error('Cotizave endpoint must be "rates"');
  }
  process.env['COTIZAVE_API_KEY'] = trimmedKey;

  if (isSecretStorageAvailable()) {
    try {
      const db = getDbService();
      db.setConfigValue('cotizave_api_key', encryptSecret(trimmedKey));
      db.setConfigValue('cotizave_api_key_scheme', SECRET_SCHEME);
    } catch (err) {
      console.warn('[Cotizave] safeStorage failed to persist API key:', err);
    }
  }

  const now = Date.now();
  if (
    cotizaveIpcCache &&
    cotizaveIpcCache.apiKey === trimmedKey &&
    now - cotizaveIpcCache.timestamp < COTIZAVE_CACHE_TTL_MS
  ) {
    return cotizaveIpcCache.data;
  }
  if (now < cotizaveRateLimitedUntil) {
    if (cotizaveIpcCache && cotizaveIpcCache.apiKey === trimmedKey) {
      console.warn('[Cotizave] Rate limit activo (429). Retornando rates desde caché fresca.');
      return cotizaveIpcCache.data;
    }
    const remainingSec = Math.ceil((cotizaveRateLimitedUntil - now) / 1000);
    throw new Error(
      `Cotizave HTTP Error 429: en enfriamiento por rate-limit. Esperá ${remainingSec}s para permitir que se restablezca tu cuota.`,
    );
  }

  if (cotizaveInFlight && cotizaveInFlight.apiKey === trimmedKey) {
    return cotizaveInFlight.promise;
  }

  const run = (async (): Promise<unknown> => {
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
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
          const cooldownMs =
            Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 60_000;
          cotizaveRateLimitedUntil = Date.now() + cooldownMs;
          if (cotizaveIpcCache && cotizaveIpcCache.apiKey === trimmedKey) {
            console.warn('[Cotizave] HTTP 429 detectado. Retornando caché previa de tasas.');
            return cotizaveIpcCache.data;
          }
        }
        const retryAfter = response.headers?.get?.('retry-after');
        const retryMsg = retryAfter ? ` (retry-after: ${retryAfter}s)` : '';
        let detail = '';
        if (typeof response.json === 'function') {
          try {
            const errBody = (await response.json()) as {
              code?: unknown;
              message?: unknown;
            } | null;
            if (errBody && typeof errBody === 'object') {
              const parts = [
                typeof errBody.code === 'string' ? `[${errBody.code}]` : '',
                typeof errBody.message === 'string' ? errBody.message : '',
              ].filter(Boolean);
              if (parts.length > 0) {
                detail = `: ${parts.join(' ')}`;
              }
            }
          } catch {
            // Cuerpo no-JSON o ya consumido
          }
        }
        throw new Error(`Cotizave HTTP Error ${response.status}${retryMsg}${detail}`);
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new Error('Cotizave returned non-JSON response');
      }
      const jsonResult = await response.json();
      cotizaveIpcCache = { apiKey: trimmedKey, data: jsonResult, timestamp: Date.now() };
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
    } finally {
      if (cotizaveInFlight?.apiKey === trimmedKey) {
        cotizaveInFlight = null;
      }
    }
  })();

  cotizaveInFlight = { apiKey: trimmedKey, promise: run };
  return run;
}

/**
 * Typed, allow-listed IPC handlers.
 * `p2p:fetch-binance` allows the app to query Binance P2P public orderbook
 * bypassing any browser CORS limitations natively and securely.
 * `crypto:*` handlers leverage OS-native DPAPI / Keychain encryption via safeStorage.
 */
export function registerIpcHandlers(): void {
  clearBinanceP2pCacheForTesting();
  cotizaveIpcCache = null;
  cotizaveInFlight = null;
  cotizaveRateLimitedUntil = 0;
  binanceSpotCache.clear();
  binanceSpotInFlight.clear();
  latestSpotPrices.clear();

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
    async (event: IpcMainInvokeEvent, params: BinanceSearchParams): Promise<unknown> => {
      const controller = new AbortController();
      const sender = event?.sender as { once?: (ev: string, fn: () => void) => void; removeListener?: (ev: string, fn: () => void) => void } | undefined;
      const onDestroyed = () => controller.abort();
      sender?.once?.('destroyed', onDestroyed);
      try {
        return await fetchBinanceP2pShared(params, { signal: controller.signal });
      } finally {
        sender?.removeListener?.('destroyed', onDestroyed);
      }
    },
  );

  ipcMain.removeHandler('p2p:fetch-binance-spot');
  ipcMain.handle(
    'p2p:fetch-binance-spot',
    async (
      _event: IpcMainInvokeEvent,
      symbolOrSymbols: string | readonly string[],
    ): Promise<unknown> => {
      const isBatch = Array.isArray(symbolOrSymbols);
      const cleanSymbols = isBatch
        ? Array.from(
            new Set(
              symbolOrSymbols
                .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
                .map((s) => s.trim().toUpperCase()),
            ),
          )
        : [];
      const cleanSingle =
        !isBatch && typeof symbolOrSymbols === 'string' && symbolOrSymbols.trim()
          ? symbolOrSymbols.trim().toUpperCase()
          : 'USDCUSDT';

      const cacheKey = isBatch
        ? `batch:${(cleanSymbols.length > 0 ? cleanSymbols : ['BTCUSDT', 'SOLUSDT', 'USDCUSDT']).join(',')}`
        : `single:${cleanSingle}`;

      const now = Date.now();
      const cached = binanceSpotCache.get(cacheKey);
      if (cached && now - cached.timestamp < BINANCE_CACHE_TTL_MS) {
        return cached.data;
      }

      const existingFlight = binanceSpotInFlight.get(cacheKey);
      if (existingFlight) {
        return existingFlight;
      }

      const run = (async (): Promise<unknown> => {
        try {
          const url = isBatch
            ? `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(
                JSON.stringify(
                  cleanSymbols.length > 0 ? cleanSymbols : ['BTCUSDT', 'SOLUSDT', 'USDCUSDT'],
                ),
              )}`
            : `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(cleanSingle)}`;
          const response = await net.fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) {
            throw new Error(`Binance Spot HTTP Error ${response.status}`);
          }
          const payload = await response.json();
          const fetchedAt = Date.now();
          binanceSpotCache.set(cacheKey, { data: payload, timestamp: fetchedAt });

          if (Array.isArray(payload)) {
            for (const entry of payload) {
              if (entry && typeof entry === 'object') {
                const rec = entry as Record<string, unknown>;
                const sym = typeof rec['symbol'] === 'string' ? rec['symbol'].toUpperCase() : '';
                const last = Number(rec['lastPrice']);
                const bid = Number(rec['bidPrice']);
                const ask = Number(rec['askPrice']);
                const mid =
                  Number.isFinite(last) && last > 0
                    ? last
                    : Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0
                      ? (bid + ask) / 2
                      : 0;
                if (sym && mid > 0) {
                  latestSpotPrices.set(sym, { price: mid, timestamp: fetchedAt });
                }
              }
            }
          } else if (payload && typeof payload === 'object') {
            const rec = payload as Record<string, unknown>;
            const sym =
              typeof rec['symbol'] === 'string' ? rec['symbol'].toUpperCase() : cleanSingle;
            const bid = Number(rec['bidPrice']);
            const ask = Number(rec['askPrice']);
            if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
              latestSpotPrices.set(sym, { price: (bid + ask) / 2, timestamp: fetchedAt });
            }
          }

          return payload;
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
        } finally {
          binanceSpotInFlight.delete(cacheKey);
        }
      })();

      binanceSpotInFlight.set(cacheKey, run);
      return run;
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
      return fetchCotizaveShared(req);
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

  ipcMain.removeHandler('p2p:telegram-download-file');
  ipcMain.handle(
    'p2p:telegram-download-file',
    async (
      _event: IpcMainInvokeEvent,
      params: { token: string; filePath: string },
    ): Promise<{ success: boolean; base64: string; mimeType: string }> => {
      const { token, filePath } = params || {};
      if (!token || !filePath) {
        throw new Error('Parámetros de Telegram inválidos (token o filePath faltante)');
      }
      const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const response = await net.fetch(downloadUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) {
        throw new Error(`Telegram Download HTTP Error ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const ext = path.extname(filePath).toLowerCase();
      const mimeType =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return {
        success: true,
        base64,
        mimeType,
      };
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

  ipcMain.removeHandler('p2p:db-list-market-snapshots');
  ipcMain.handle(
    'p2p:db-list-market-snapshots',
    (_event: IpcMainInvokeEvent, filter?: MarketSnapshotsFilter): unknown[] => {
      try {
        return db.listMarketSnapshots(filter);
      } catch (err) {
        console.warn('[IPC] Error in p2p:db-list-market-snapshots:', err);
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
  orchestrator.setStreamEmitter((streamEvent) => {
    try {
      if (typeof BrowserWindow?.getAllWindows === 'function') {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('copilot:stream-event', streamEvent);
          }
        }
      }
    } catch {
      // Ignore in headless/test environments without BrowserWindow
    }
  });

  ipcMain.removeHandler('copilot:send-message');
  ipcMain.handle(
    'copilot:send-message',
    async (
      _event: IpcMainInvokeEvent,
      params: {
        prompt: string;
        history?: any[];
        threadId?: string;
        agentId?: string;
        contextScope?: any;
        requestId?: string;
        apiKey?: string;
        provider?: any;
        model?: string;
      },
    ) => {
      return orchestrator.sendMessage(params);
    },
  );

  ipcMain.removeHandler('copilot:cancel-turn');
  ipcMain.handle(
    'copilot:cancel-turn',
    (_event: IpcMainInvokeEvent, params?: { requestId?: string }) => {
      return orchestrator.cancelTurn(params?.requestId);
    },
  );

  ipcMain.removeHandler('copilot:list-threads');
  ipcMain.handle(
    'copilot:list-threads',
    (_event: IpcMainInvokeEvent, params?: { limit?: number }) => {
      return orchestrator.listThreads(params?.limit);
    },
  );

  ipcMain.removeHandler('copilot:create-thread');
  ipcMain.handle(
    'copilot:create-thread',
    (_event: IpcMainInvokeEvent, params?: { title?: string; agentId?: string }) => {
      return orchestrator.createThread(params);
    },
  );

  ipcMain.removeHandler('copilot:get-thread-messages');
  ipcMain.handle(
    'copilot:get-thread-messages',
    (_event: IpcMainInvokeEvent, params: { threadId: string; limit?: number }) => {
      return orchestrator.getThreadMessages(params.threadId, params.limit);
    },
  );

  ipcMain.removeHandler('copilot:delete-thread');
  ipcMain.handle(
    'copilot:delete-thread',
    (_event: IpcMainInvokeEvent, params: { threadId: string }) => {
      return orchestrator.deleteThread(params.threadId);
    },
  );

  ipcMain.removeHandler('copilot:reject-plan');
  ipcMain.handle(
    'copilot:reject-plan',
    (_event: IpcMainInvokeEvent, params: { planId: string; reason?: string }) => {
      return orchestrator.rejectPlan(params.planId, params.reason);
    },
  );

  ipcMain.removeHandler('copilot:review-engram');
  ipcMain.handle(
    'copilot:review-engram',
    (_event: IpcMainInvokeEvent, params: { id: number; action: 'approve' | 'discard' }) => {
      return orchestrator.reviewEngramObservation(params.id, params.action);
    },
  );

  ipcMain.removeHandler('copilot:get-usage-summary');
  ipcMain.handle(
    'copilot:get-usage-summary',
    (_event: IpcMainInvokeEvent, params?: { windowHours?: number }) => {
      return orchestrator.getUsageSummary(params?.windowHours);
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

  // Custom Agent Studio & Real Background Daemon Scheduler
  const agentRepo = db.getCustomAgentRepo();
  agentRepo.seedDefaultsIfEmpty();

  const daemonScheduler = new AgentDaemonScheduler({
    repo: agentRepo,
    isKillswitchActive: () => killswitchState.isTriggered,
    onEvent: (event) => {
      // Closed Daemon-to-HITL Bridge: if a background daemon tick produces an actionable
      // HITL proposal, persist it into `strategy_plans` and broadcast a proactive alert.
      if (
        event.type === 'run_completed' &&
        event.run &&
        event.run.triggerType === 'daemon_tick' &&
        event.run.status === 'success' &&
        event.run.responseOutput &&
        /HITL_PROPOSAL|PROPUESTA HITL|APROBACI[OÓ]N HUMANA/i.test(event.run.responseOutput)
      ) {
        try {
          const planId = `PLAN-DMN-${Date.now().toString(36).toUpperCase()}`;
          const spreadMatch = /(\d+(?:\.\d+)?)\s*%/.exec(event.run.responseOutput);
          const expectedNetSpreadPct = spreadMatch ? Number(spreadMatch[1]) : 0.55;
          const plan = {
            id: planId,
            title: `[Daemon] ${event.run.agentName ?? event.run.agentId}`,
            route: `Propuesta automática READ-ONLY (${event.run.agentId})`,
            asset: 'USDT',
            fiat: 'VES',
            capitalRequiredUsdt: 1000,
            expectedNetSpreadPct,
            expectedProfitUsdt: Number(((1000 * expectedNetSpreadPct) / 100).toFixed(2)),
            riskLevel: 'MEDIUM' as const,
            rationale: event.run.responseOutput.slice(0, 500),
            status: 'PROPOSED' as const,
            esSimulado: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          db.saveStrategyPlan(plan);
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send('copilot:proactive-event-alert', {
                id: `ALERT-${planId}`,
                severity: 'HIGH',
                title: `Propuesta HITL de ${event.run.agentName ?? event.run.agentId}`,
                message: event.run.responseOutput.slice(0, 180),
                timestamp: Date.now(),
              });
            }
          }
        } catch {
          // Never break daemon event broadcast if plan persistence fails
        }
      }

      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('agents:run-event', event);
        }
      }
    },
    executor: async (req) => {
      const orch = getOrchestrator();
      const readOnlyGuard =
        req.blockedSkills.length > 0
          ? `\n[GUARDRAIL READ-ONLY ACTIVO]: Las herramientas de mutacion (${req.blockedSkills.join(', ')}) estan bloqueadas en esta ejecucion. Si se requiere accion, formula una propuesta clara para aprobacion humana (HITL).`
          : '';
      const composedPrompt =
        `[AGENTE ACTIVO: ${req.agent.name} (${req.agent.id})]\n` +
        `[SYSTEM PROMPT v${req.agent.promptVersion}]: ${req.agent.systemPrompt}\n` +
        `[SKILLS AUTORIZADAS]: ${req.allowedSkills.join(', ') || 'ninguna'}${readOnlyGuard}\n\n` +
        `Solicitud:\n${req.prompt}`;

      const response = await orch.sendMessage({
        prompt: composedPrompt,
        agentId: req.agent.id,
        provider: req.agent.modelProvider,
        model: req.agent.modelName,
        contextScope: {
          orderbook: req.agent.domain === 'P2P_DESK' || req.agent.domain === 'SECURITY',
          treasury: true,
          orders: req.agent.domain === 'P2P_DESK' || req.agent.domain === 'SECURITY',
          finance360: req.agent.domain === 'FINANCE_360',
        },
      });

      return {
        reply: response.reply ?? '',
        modelUsed: req.agent.modelName,
        providerUsed: req.agent.modelProvider,
        toolsCalled: (response.toolTraces ?? []).map((t) => ({
          name: t.toolName,
          ok: t.status === 'ok',
          latencyMs: t.durationMs,
        })),
        tokensIn: response.usage?.promptTokens ?? 0,
        tokensOut: response.usage?.completionTokens ?? 0,
        costUsd: response.usage?.estimatedCostUsd ?? 0,
      };
    },
  });
  daemonScheduler.start();

  ipcMain.removeHandler('agents:list');
  ipcMain.handle(
    'agents:list',
    async (
      _event: IpcMainInvokeEvent,
      filter?: { activeOnly?: boolean; mode?: 'on_demand' | 'ambient_daemon'; domain?: any },
    ) => {
      return agentRepo.listAgents(filter);
    },
  );

  ipcMain.removeHandler('agents:get');
  ipcMain.handle('agents:get', async (_event: IpcMainInvokeEvent, params: { id: string } | string) => {
    const id = typeof params === 'string' ? params : params.id;
    return agentRepo.getAgentById(id);
  });

  ipcMain.removeHandler('agents:create');
  ipcMain.handle('agents:create', async (_event: IpcMainInvokeEvent, dto: any) => {
    const created = agentRepo.createAgent(dto);
    daemonScheduler.reconcile();
    return created;
  });

  ipcMain.removeHandler('agents:update');
  ipcMain.handle('agents:update', async (_event: IpcMainInvokeEvent, params: { id: string; dto: any }) => {
    const updated = agentRepo.updateAgent(params.id, params.dto);
    daemonScheduler.reconcile();
    return updated;
  });

  ipcMain.removeHandler('agents:delete');
  ipcMain.handle('agents:delete', async (_event: IpcMainInvokeEvent, params: { id: string } | string) => {
    const id = typeof params === 'string' ? params : params.id;
    const deleted = agentRepo.deleteAgent(id);
    daemonScheduler.reconcile();
    return deleted;
  });

  ipcMain.removeHandler('agents:toggle');
  ipcMain.handle(
    'agents:toggle',
    async (_event: IpcMainInvokeEvent, params: { id: string; active?: boolean }) => {
      const toggled = agentRepo.toggleAgent(params.id, params.active);
      daemonScheduler.reconcile();
      return toggled;
    },
  );

  ipcMain.removeHandler('agents:run-sandbox');
  ipcMain.handle(
    'agents:run-sandbox',
    async (
      _event: IpcMainInvokeEvent,
      params: {
        agentId: string;
        prompt: string;
        overrideSystemPrompt?: string;
        overrideSkills?: string[];
        overrideModel?: string;
      },
    ) => {
      return daemonScheduler.runSandbox(params.agentId, params.prompt, {
        overrideSystemPrompt: params.overrideSystemPrompt,
        overrideSkills: params.overrideSkills,
        overrideModel: params.overrideModel,
      });
    },
  );

  ipcMain.removeHandler('agents:run-now');
  ipcMain.handle(
    'agents:run-now',
    async (_event: IpcMainInvokeEvent, params: { agentId: string; promptOverride?: string }) => {
      return daemonScheduler.runNow(params.agentId, params.promptOverride);
    },
  );

  ipcMain.removeHandler('agents:list-runs');
  ipcMain.handle('agents:list-runs', async (_event: IpcMainInvokeEvent, filter?: any) => {
    return agentRepo.listRuns(filter);
  });

  ipcMain.removeHandler('agents:get-fleet-metrics');
  ipcMain.handle('agents:get-fleet-metrics', async () => {
    return agentRepo.getFleetMetrics();
  });

  ipcMain.removeHandler('agents:get-daemon-status');
  ipcMain.handle('agents:get-daemon-status', async () => {
    return daemonScheduler.getStatus();
  });

  // ARM Multi-Workspace SQLite Mirror Handlers
  ipcMain.removeHandler('arm:list-leads');
  ipcMain.handle(
    'arm:list-leads',
    async (_event: IpcMainInvokeEvent, workspaceId: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360') => {
      return db.getArmRepo().listLeads(workspaceId);
    },
  );

  ipcMain.removeHandler('arm:upsert-lead');
  ipcMain.handle('arm:upsert-lead', async (_event: IpcMainInvokeEvent, lead: any) => {
    return db.getArmRepo().upsertLead(lead);
  });

  ipcMain.removeHandler('arm:list-approvals');
  ipcMain.handle(
    'arm:list-approvals',
    async (_event: IpcMainInvokeEvent, workspaceId: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360') => {
      return db.getArmRepo().listPendingApprovals(workspaceId);
    },
  );

  ipcMain.removeHandler('arm:save-approval');
  ipcMain.handle('arm:save-approval', async (_event: IpcMainInvokeEvent, item: any) => {
    return db.getArmRepo().saveApproval(item);
  });

  ipcMain.removeHandler('arm:resolve-approval');
  ipcMain.handle('arm:resolve-approval', async (_event: IpcMainInvokeEvent, params: any) => {
    return db.getArmRepo().resolveApproval(params);
  });

  ipcMain.removeHandler('arm:list-shadow-examples');
  ipcMain.handle(
    'arm:list-shadow-examples',
    async (
      _event: IpcMainInvokeEvent,
      params: { workspaceId: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360'; agentRole?: string; limit?: number },
    ) => {
      return db.getArmRepo().listShadowExamples(params.workspaceId, params.agentRole, params.limit);
    },
  );

  ipcMain.removeHandler('arm:append-outbox');
  ipcMain.handle('arm:append-outbox', async (_event: IpcMainInvokeEvent, params: any) => {
    return db.getArmRepo().appendOutboxEvent(params);
  });

  ipcMain.removeHandler('arm:list-outbox');
  ipcMain.handle(
    'arm:list-outbox',
    async (
      _event: IpcMainInvokeEvent,
      params: { sinceId: number; workspaceId?: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360' },
    ) => {
      return db.getArmRepo().listOutboxSince(params.sinceId, params.workspaceId);
    },
  );

  ipcMain.removeHandler('arm:upsert-bank-rail');
  ipcMain.handle('arm:upsert-bank-rail', async (_event: IpcMainInvokeEvent, rail: unknown) => {
    const payload = assertRecordPayload(rail, 'arm:upsert-bank-rail');
    assertArmWorkspaceCode(payload['workspaceId'], 'workspaceId');
    return db.getArmRepo().upsertBankRail(payload as unknown as ArmBankRailRecord);
  });

  ipcMain.removeHandler('arm:list-bank-rails');
  ipcMain.handle(
    'arm:list-bank-rails',
    async (_event: IpcMainInvokeEvent, workspaceId: unknown) => {
      const validWorkspace = assertArmWorkspaceCode(workspaceId, 'workspaceId');
      return db.getArmRepo().listBankRails(validWorkspace);
    },
  );

  ipcMain.removeHandler('arm:record-payment-receipt');
  ipcMain.handle(
    'arm:record-payment-receipt',
    async (_event: IpcMainInvokeEvent, receipt: unknown) => {
      const payload = assertRecordPayload(receipt, 'arm:record-payment-receipt');
      assertArmWorkspaceCode(payload['workspaceId'], 'workspaceId');
      return db.getArmRepo().recordPaymentReceipt(payload as unknown as ArmPaymentReceiptInput);
    },
  );

  ipcMain.removeHandler('arm:record-treasury-settlement');
  ipcMain.handle(
    'arm:record-treasury-settlement',
    async (_event: IpcMainInvokeEvent, settlement: unknown) => {
      const payload = assertRecordPayload(settlement, 'arm:record-treasury-settlement');
      assertArmWorkspaceCode(payload['sourceWorkspace'], 'sourceWorkspace');
      assertArmWorkspaceCode(payload['targetWorkspace'], 'targetWorkspace');
      return db
        .getArmRepo()
        .recordTreasurySettlement(payload as unknown as ArmTreasurySettlementInput);
    },
  );

  ipcMain.removeHandler('arm:get-gateway-config');
  ipcMain.handle(
    'arm:get-gateway-config',
    async (): Promise<{ url: string; authToken: string }> => {
      const readEnvKeyFromFiles = (key: string): string => {
        const candidates = [
          path.resolve(process.cwd(), '.env'),
          path.resolve(process.cwd(), 'deploy', 'vps', '.env'),
          path.resolve(__dirname, '../../../.env'),
          path.resolve(__dirname, '../../../deploy/vps/.env'),
          path.resolve(__dirname, '../../../../.env'),
          path.resolve(__dirname, '../../../../deploy/vps/.env'),
        ];
        const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, 'm');
        for (const filePath of candidates) {
          try {
            if (!fs.existsSync(filePath)) continue;
            const match = fs.readFileSync(filePath, 'utf8').match(pattern);
            if (match?.[1]) {
              return match[1].trim().replace(/^["']|["']$/g, '');
            }
          } catch {
            // Try next candidate
          }
        }
        return '';
      };

      const portRaw =
        process.env['INBOUND_GATEWAY_PORT']?.trim() ||
        readEnvKeyFromFiles('INBOUND_GATEWAY_PORT') ||
        '3030';
      const port = Number(portRaw) || 3030;
      const authToken =
        process.env['INBOUND_GATEWAY_AUTH_TOKEN']?.trim() ||
        readEnvKeyFromFiles('INBOUND_GATEWAY_AUTH_TOKEN');

      return {
        url: `http://127.0.0.1:${port}`,
        authToken,
      };
    },
  );

  // Finanzas 360 Institutional Ledger, Main-Process Gemini Proxy & Sandboxed PDF Export
  ipcMain.removeHandler('f360:get-snapshot');
  ipcMain.handle('f360:get-snapshot', async (): Promise<Finance360StoredSnapshot | null> => {
    return db.finance360.getSnapshot();
  });

  ipcMain.removeHandler('f360:save-snapshot');
  ipcMain.handle(
    'f360:save-snapshot',
    async (
      _event: IpcMainInvokeEvent,
      snapshot: unknown,
    ): Promise<Finance360SaveSnapshotResult> => {
      const payload = assertFinance360RecordPayload(snapshot, 'f360:save-snapshot');
      return db.finance360.saveSnapshot(payload as unknown as Finance360SnapshotPayload);
    },
  );

  ipcMain.removeHandler('f360:ai-analyze');
  ipcMain.handle(
    'f360:ai-analyze',
    async (
      _event: IpcMainInvokeEvent,
      request: unknown,
    ): Promise<Finance360AiAnalyzeResult> => {
      return handleFinance360AiAnalyze(request, db, orchestrator);
    },
  );

  ipcMain.removeHandler('f360:export-pdf');
  ipcMain.handle(
    'f360:export-pdf',
    async (
      _event: IpcMainInvokeEvent,
      request: unknown,
    ): Promise<Finance360ExportPdfResult> => {
      return handleFinance360ExportPdf(request);
    },
  );

  const inactiveDockState = (): BinanceDockStateDto => ({
    isOpen: false,
    currentUrl: null,
    widthPx: 0,
    mode: null,
  });

  ipcMain.removeHandler('p2p:dock-open');
  ipcMain.handle(
    'p2p:dock-open',
    async (_event: IpcMainInvokeEvent, req: BinanceDockOpenRequest): Promise<BinanceDockStateDto> => {
      if (!binanceDockInstance) return inactiveDockState();
      return binanceDockInstance.open(req);
    },
  );

  ipcMain.removeHandler('p2p:dock-close');
  ipcMain.handle('p2p:dock-close', (): BinanceDockStateDto => {
    return binanceDockInstance ? binanceDockInstance.close() : inactiveDockState();
  });

  ipcMain.removeHandler('p2p:dock-toggle');
  ipcMain.handle(
    'p2p:dock-toggle',
    async (
      _event: IpcMainInvokeEvent,
      req?: BinanceDockOpenRequest,
    ): Promise<BinanceDockStateDto> => {
      if (!binanceDockInstance) return inactiveDockState();
      return binanceDockInstance.toggle(req);
    },
  );

  ipcMain.removeHandler('p2p:dock-state');
  ipcMain.handle('p2p:dock-state', (): BinanceDockStateDto => {
    return binanceDockInstance ? binanceDockInstance.getState() : inactiveDockState();
  });

  ipcMain.removeHandler('p2p:open-external');
  ipcMain.handle(
    'p2p:open-external',
    async (_event: IpcMainInvokeEvent, url: unknown): Promise<{ opened: boolean }> => {
      if (!isAllowedBinanceDockUrl(url)) {
        return { opened: false };
      }
      await shell.openExternal(url);
      return { opened: true };
    },
  );
}

const F360_GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'] as const;
const MAX_F360_PROMPT_LENGTH = 200_000;
const MAX_F360_HTML_LENGTH = 5_000_000;

function assertFinance360RecordPayload(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`f360_ipc: invalid payload for ${channel}`);
  }
  return value as Record<string, unknown>;
}

function resolveMainGeminiKeyForF360(
  db: P2PDatabaseService,
  orchestrator: GeminiOrchestrator,
): string | null {
  const fromOrchestrator = orchestrator.getEffectiveApiKey('gemini')?.trim();
  if (fromOrchestrator) {
    return fromOrchestrator;
  }

  const envKey = process.env['GEMINI_API_KEY']?.trim();
  if (envKey) {
    return envKey;
  }

  if (isSecretStorageAvailable()) {
    const keyPairs: ReadonlyArray<readonly [string, string]> = [
      ['ai_api_key_gemini', 'ai_api_key_scheme_gemini'],
      ['gemini_api_key', 'gemini_api_key_scheme'],
    ];
    for (const [valueKey, schemeKey] of keyPairs) {
      const stored = db.getConfigValue(valueKey);
      const scheme = db.getConfigValue(schemeKey);
      if (stored && scheme === SECRET_SCHEME) {
        try {
          const decrypted = decryptSecret(stored).trim();
          if (decrypted) return decrypted;
        } catch {
          // Ignore undecryptable credential
        }
      }
    }
  }

  return null;
}

async function handleFinance360AiAnalyze(
  rawRequest: unknown,
  db: P2PDatabaseService,
  orchestrator: GeminiOrchestrator,
): Promise<Finance360AiAnalyzeResult> {
  if (typeof rawRequest !== 'object' || rawRequest === null || Array.isArray(rawRequest)) {
    return { ok: false, text: '', model: '', error: 'INVALID_REQUEST_PAYLOAD' };
  }

  const req = rawRequest as Partial<Finance360AiAnalyzeRequest>;
  const prompt = typeof req.prompt === 'string' ? req.prompt.trim() : '';
  if (!prompt || prompt.length > MAX_F360_PROMPT_LENGTH) {
    return { ok: false, text: '', model: '', error: 'INVALID_PROMPT' };
  }

  const apiKey = resolveMainGeminiKeyForF360(db, orchestrator);
  if (!apiKey) {
    return { ok: false, text: '', model: '', error: 'GEMINI_API_KEY_NOT_CONFIGURED' };
  }

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (req.inlineData && typeof req.inlineData === 'object') {
    const mimeType =
      typeof req.inlineData.mimeType === 'string' ? req.inlineData.mimeType.trim() : '';
    const data = typeof req.inlineData.data === 'string' ? req.inlineData.data.trim() : '';
    if (mimeType && data) {
      parts.push({
        inline_data: {
          mime_type: mimeType,
          data,
        },
      });
    }
  }

  const temperature =
    typeof req.temperature === 'number' &&
    Number.isFinite(req.temperature) &&
    req.temperature >= 0 &&
    req.temperature <= 2
      ? req.temperature
      : 0.1;

  const generationConfig: Record<string, unknown> = { temperature };
  if (typeof req.responseMimeType === 'string' && req.responseMimeType.trim().length > 0) {
    generationConfig['responseMimeType'] = req.responseMimeType.trim();
  }

  const envPreferredModel = process.env['F360_GEMINI_MODEL']?.trim();
  const candidateModels = Array.from(
    new Set(
      envPreferredModel
        ? [envPreferredModel, ...F360_GEMINI_FALLBACK_MODELS]
        : [...F360_GEMINI_FALLBACK_MODELS],
    ),
  );

  let lastModel = candidateModels[0] ?? 'gemini-2.5-flash';
  let lastError = 'GEMINI_REQUEST_FAILED';

  for (const model of candidateModels) {
    lastModel = model;
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const response = await net.fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig,
        }),
      });

      if (!response.ok) {
        const errBody = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
        lastError = `GEMINI_HTTP_${response.status}${errBody ? `: ${errBody.slice(0, 180)}` : ''}`;
        continue;
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: unknown }>;
          };
        }>;
      };

      const extractedText = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('')
        .trim();

      if (!extractedText) {
        lastError = 'GEMINI_EMPTY_RESPONSE';
        continue;
      }

      return {
        ok: true,
        text: extractedText,
        model,
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: false,
    text: '',
    model: lastModel,
    error: lastError,
  };
}

function sanitizePdfFilename(raw?: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return 'finanzas-360.pdf';
  }
  const base = path.basename(raw.trim()).replace(/[^a-zA-Z0-9._-]/g, '_');
  const cleaned = base.replace(/^\.+/, '') || 'finanzas-360';
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

async function handleFinance360ExportPdf(rawRequest: unknown): Promise<Finance360ExportPdfResult> {
  if (typeof rawRequest !== 'object' || rawRequest === null || Array.isArray(rawRequest)) {
    return { ok: false, error: 'INVALID_PDF_REQUEST' };
  }

  const req = rawRequest as Partial<Finance360ExportPdfRequest>;
  const html = typeof req.html === 'string' ? req.html.trim() : '';
  if (!html || html.length > MAX_F360_HTML_LENGTH) {
    return { ok: false, error: 'INVALID_HTML_CONTENT' };
  }

  const filename = sanitizePdfFilename(req.filename);
  const electronModule = await import('electron');
  const BrowserWindowCtor = electronModule.BrowserWindow;
  if (typeof BrowserWindowCtor !== 'function') {
    return { ok: false, error: 'BROWSER_WINDOW_UNAVAILABLE' };
  }

  let pdfWindow: InstanceType<typeof BrowserWindowCtor> | null = null;
  try {
    pdfWindow = new BrowserWindowCtor({
      show: false,
      width: 816,
      height: 1056,
      webPreferences: {
        javascript: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        plugins: false,
      },
    });

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await pdfWindow.loadURL(dataUrl);
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
    });

    return {
      ok: true,
      base64: Buffer.from(pdfBuffer).toString('base64'),
      filename,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.destroy();
    }
  }
}

const VALID_ARM_WORKSPACES = new Set<string>(Object.values(ARM_WORKSPACES));

function assertArmWorkspaceCode(value: unknown, fieldName: string): ArmWorkspaceCode {
  if (typeof value !== 'string' || !VALID_ARM_WORKSPACES.has(value)) {
    throw new Error(`arm_ipc: invalid ${fieldName}`);
  }
  return value as ArmWorkspaceCode;
}

function assertRecordPayload(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`arm_ipc: invalid payload for ${channel}`);
  }
  return value as Record<string, unknown>;
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

let binanceDockInstance: BinanceOperatorDock | null = null;
export function setBinanceOperatorDock(dock: BinanceOperatorDock | null): void {
  binanceDockInstance = dock;
}
export function getBinanceOperatorDock(): BinanceOperatorDock | null {
  return binanceDockInstance;
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
