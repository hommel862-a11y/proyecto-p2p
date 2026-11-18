import { Injectable, OnDestroy, inject, signal, computed } from '@angular/core';
import { ToastService } from './toast.service';
import { NativeHttpService } from './native-http.service';
import { StorageService } from './storage';
import {
  CircuitBreaker,
  type P2PUserTier,
  type RadarOrderSide,
  type CleanModeConfig,
  type CleanRadarOffer,
  type RadarCleanBook,
  type VolumeBracketConfig,
  type RawP2POfferInput,
  type BotDetectionResult,
  type MarketTrendResult,
  type BookSnapshot,
  type ExecutionMode,
  type ArbitrageCycleParams,
  type ArbitrageCycleMetrics,
  type MatrixScanResult,
  type RadarHudPayload,
  type RadarCompletedCycleRecord,
  type RadarDailyConsolidatedSummary,
  type PipelineDeal,
  CRM_STORAGE_KEYS,
  safeHydrateCrmCollection,
  DEFAULT_CLEAN_MODE_CONFIG,
  RADAR_VOLUME_BRACKETS,
  buildCleanRadarBook,
  SnapshotRingBuffer,
  calculateCleanVWAP,
  evaluateMarketTrend,
  detectBotsInHistory,
  calculateArbitrageCycle,
  scanArbitrageMatrix,
  buildRadarHudPayload,
  RadarHudBroadcaster,
  createCompletedCycleRecord,
  consolidateDailyCycles,
} from '@p2p/core';

export const RADAR_BANK_LABELS: Record<string, string> = {
  Banesco: 'Banesco',
  Mercantil: 'Mercantil',
  SpecificBank: 'Banco de Venezuela',
  PagoMovil: 'Pago Móvil',
  BBVA: 'BBVA Provincial',
  BNC: 'Banco Nacional de Crédito (BNC)',
  Bancaribe: 'Bancaribe',
  Banplus: 'Banplus',
  BanescoPanama: 'Banesco Panamá',
  Zinli: 'Zinli',
};

export type BankPresetId = 'TOP_VES' | 'ALL_VES' | 'EXPANDED' | 'CLEAR';
export type AutoRefreshIntervalSec = 0 | 10 | 15 | 30;

export const BANK_PRESETS: Record<Exclude<BankPresetId, 'CLEAR'>, readonly string[]> = {
  TOP_VES: ['Banesco', 'Mercantil', 'SpecificBank', 'PagoMovil'],
  ALL_VES: [
    'Banesco',
    'Mercantil',
    'SpecificBank',
    'PagoMovil',
    'BBVA',
    'BNC',
    'Bancaribe',
    'Banplus',
  ],
  EXPANDED: [
    'Banesco',
    'Mercantil',
    'SpecificBank',
    'PagoMovil',
    'BBVA',
    'BNC',
    'Bancaribe',
    'Banplus',
    'BanescoPanama',
    'Zinli',
  ],
};

export interface RadarScanTarget {
  readonly payType: string;
  readonly side: RadarOrderSide;
}

@Injectable({ providedIn: 'root' })
export class P2PRadarService implements OnDestroy {
  private static readonly STORAGE_KEY_CYCLES = 'p2p.radar.completed-cycles';

  private readonly toast = inject(ToastService);
  private readonly nativeHttp = inject(NativeHttpService, { optional: true });
  private readonly storage = inject(StorageService, { optional: true });

  readonly circuitBreaker = new CircuitBreaker({
    failureThreshold: 4,
    cooldownPeriodMs: 30_000,
    maxRetries: 1,
    baseDelayMs: 400,
  });

  private inFlightScan: Promise<Map<string, RadarCleanBook>> | null = null;
  private scanAbortController: AbortController | null = null;

  // ─── Phase 5: Browser Extension HUD & Accounting Isolation ─────────
  private readonly hudBroadcaster = new RadarHudBroadcaster();
  readonly hudActive = signal<boolean>(true);
  readonly lastHudPayload = signal<RadarHudPayload | null>(null);
  readonly completedCycles = signal<RadarCompletedCycleRecord[]>(this.loadStoredCycles());

  readonly dailyConsolidated = computed<RadarDailyConsolidatedSummary>(() => {
    return consolidateDailyCycles(this.completedCycles());
  });

  // ─── Phase 2 Memory Stores & Live Stream Telemetry ─────────────────
  private readonly ringBuffers = new Map<string, SnapshotRingBuffer>();
  private readonly vwapHistories = new Map<string, number[]>();
  private autoPollTimer: ReturnType<typeof setInterval> | null = null;

  readonly autoRefreshIntervalSec = signal<AutoRefreshIntervalSec>(0);
  readonly streamCountdownSec = signal<number>(0);
  readonly scanCycleCount = signal<number>(0);
  readonly bufferSampleCount = computed(() => Math.min(12, this.scanCycleCount()));

  // ─── Reactive State ────────────────────────────────────────────────
  readonly userTier = signal<P2PUserTier>('UNVERIFIED');
  readonly cleanConfig = signal<CleanModeConfig>({ ...DEFAULT_CLEAN_MODE_CONFIG });
  readonly selectedBracket = signal<VolumeBracketConfig>(RADAR_VOLUME_BRACKETS[0]);
  readonly activePaymentMethods = signal<string[]>([
    'Banesco',
    'Mercantil',
    'SpecificBank',
    'PagoMovil',
  ]);

  // Phase 3 Tactical Arbitrage State
  readonly executionMode = signal<ExecutionMode>('DOBLE_MAKER');
  readonly operatingCapitalUsdt = signal<number>(1000);
  readonly targetNetMarginPct = signal<number>(0.35);
  readonly interbankFrictionPct = signal<number>(0.3);
  readonly matrixScanResult = signal<MatrixScanResult | null>(null);

  readonly radarBooks = signal<Map<string, RadarCleanBook>>(new Map());
  readonly botReports = signal<Map<string, BotDetectionResult[]>>(new Map());
  readonly marketTrends = signal<Map<string, MarketTrendResult>>(new Map());

  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly lastUpdated = signal<Date | null>(null);

  // Computed summary
  readonly totalCleanOffers = computed(() => {
    let count = 0;
    for (const book of this.radarBooks().values()) {
      count += book.cleanCount;
    }
    return count;
  });

  readonly totalCleanLiquidityUsdt = computed(() => {
    let total = 0;
    for (const book of this.radarBooks().values()) {
      for (const offer of book.cleanOffers) {
        total += offer.surplusAmount || 0;
      }
    }
    return Math.round(total * 100) / 100;
  });

  readonly totalBotsDetected = computed(() => {
    let count = 0;
    for (const bots of this.botReports().values()) {
      count += bots.length;
    }
    return count;
  });

  readonly allDetectedBots = computed<
    (BotDetectionResult & { payMethod: string; side: RadarOrderSide })[]
  >(() => {
    const list: (BotDetectionResult & { payMethod: string; side: RadarOrderSide })[] = [];
    for (const [key, bots] of this.botReports().entries()) {
      const sepIdx = key.lastIndexOf('_');
      const payMethod = sepIdx > 0 ? key.slice(0, sepIdx) : key;
      const side = (sepIdx > 0 ? key.slice(sepIdx + 1) : 'SELL') as RadarOrderSide;
      for (const bot of bots) {
        list.push({ ...bot, payMethod, side });
      }
    }
    return list.sort((a, b) => b.confidenceScore - a.confidenceScore);
  });

  readonly allRejectedOffers = computed<
    (CleanRadarOffer & { payMethod: string; side: RadarOrderSide })[]
  >(() => {
    const list: (CleanRadarOffer & { payMethod: string; side: RadarOrderSide })[] = [];
    for (const book of this.radarBooks().values()) {
      for (const rej of book.rejectedOffers) {
        list.push({ ...rej, payMethod: book.payMethod, side: book.side });
      }
    }
    return list;
  });

  readonly topRoutes = computed(() => this.matrixScanResult()?.topRoutes ?? []);
  readonly bestRoute = computed(() => this.matrixScanResult()?.bestRoute ?? null);
  readonly allRoutes = computed(() => this.matrixScanResult()?.allRoutes ?? []);
  readonly viableRoutesCount = computed(() => this.matrixScanResult()?.viableRoutesCount ?? 0);

  readonly totalManipulationsDetected = computed(() => {
    let count = 0;
    for (const book of this.radarBooks().values()) {
      for (const rej of book.rejectedOffers) {
        if (rej.isOutlier || rej.verdict.reasons.includes('MANIPULACION_DETECTADA')) {
          count++;
        }
      }
    }
    return count;
  });

  // ─── Mutators ──────────────────────────────────────────────────────
  setUserTier(tier: P2PUserTier): void {
    this.userTier.set(tier);
    // Re-evaluate existing books if present
    this.recomputeBooks();
  }

  updateCleanConfig(partial: Partial<CleanModeConfig>): void {
    this.cleanConfig.update((curr) => ({
      ...curr,
      ...partial,
      maxPayTimeMinutes:
        typeof partial.maxPayTimeMinutes === 'number' && Number.isFinite(partial.maxPayTimeMinutes)
          ? Math.max(1, partial.maxPayTimeMinutes)
          : curr.maxPayTimeMinutes,
      minMonthFinishRate:
        typeof partial.minMonthFinishRate === 'number' && Number.isFinite(partial.minMonthFinishRate)
          ? Math.min(100, Math.max(0, partial.minMonthFinishRate))
          : curr.minMonthFinishRate,
      minMonthOrderCount:
        typeof partial.minMonthOrderCount === 'number' && Number.isFinite(partial.minMonthOrderCount)
          ? Math.max(0, partial.minMonthOrderCount)
          : curr.minMonthOrderCount,
      minSurplusUsdt:
        typeof partial.minSurplusUsdt === 'number' && Number.isFinite(partial.minSurplusUsdt)
          ? Math.max(0, partial.minSurplusUsdt)
          : curr.minSurplusUsdt,
      minTransAmountVes:
        typeof partial.minTransAmountVes === 'number' && Number.isFinite(partial.minTransAmountVes)
          ? Math.max(0, partial.minTransAmountVes)
          : curr.minTransAmountVes,
      outlierDeviationPct:
        typeof partial.outlierDeviationPct === 'number' && Number.isFinite(partial.outlierDeviationPct)
          ? Math.max(0.05, partial.outlierDeviationPct)
          : curr.outlierDeviationPct,
    }));
    this.recomputeBooks();
  }

  setVolumeBracket(bracketId: string): void {
    const found = RADAR_VOLUME_BRACKETS.find((b) => b.id === bracketId);
    if (found) {
      this.selectedBracket.set(found);
      this.cleanConfig.update((curr) => ({
        ...curr,
        minTransAmountVes: found.minAmountVes,
      }));
      this.recomputeBooks();
    }
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.scanAbortController?.abort();
    this.scanAbortController = null;
  }

  togglePaymentMethod(methodKey: string): void {
    this.activePaymentMethods.update((current) => {
      if (current.includes(methodKey)) {
        return current.filter((m) => m !== methodKey);
      }
      return [...current, methodKey];
    });
    this.pruneInactiveBooks();
  }

  setBankPreset(preset: BankPresetId): void {
    if (preset === 'CLEAR') {
      this.activePaymentMethods.set([]);
      this.pruneInactiveBooks();
      return;
    }
    this.activePaymentMethods.set([...BANK_PRESETS[preset]]);
    this.pruneInactiveBooks();
  }

  selectAllBanks(): void {
    this.activePaymentMethods.set(Object.keys(RADAR_BANK_LABELS));
    this.pruneInactiveBooks();
  }

  setBanks(methods: string[]): void {
    this.activePaymentMethods.set(methods);
    this.pruneInactiveBooks();
  }

  // ─── Phase 3 Mutators ──────────────────────────────────────────────
  setExecutionMode(mode: ExecutionMode): void {
    this.executionMode.set(mode);
    this.recomputeMatrixScan();
  }

  setOperatingCapital(capitalUsdt: number): void {
    const parsed = Number(capitalUsdt);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    this.operatingCapitalUsdt.set(Math.max(1, parsed));
    this.recomputeMatrixScan();
  }

  setTargetNetMargin(marginPct: number): void {
    if (marginPct === null || marginPct === undefined) return;
    const parsed = Number(marginPct);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    this.targetNetMarginPct.set(parsed);
    this.recomputeMatrixScan();
  }

  setInterbankFriction(frictionPct: number): void {
    if (frictionPct === null || frictionPct === undefined) return;
    const parsed = Number(frictionPct);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    this.interbankFrictionPct.set(parsed);
    this.recomputeMatrixScan();
  }

  // ─── Network Ingestion Pipeline ────────────────────────────────────
  /**
   * Scans multiple payment methods concurrently for both BUY and SELL.
   * Feeds the raw data into the Clean Mode mathematical engine.
   */
  async scanRadar(asset = 'USDT', fiat = 'VES'): Promise<Map<string, RadarCleanBook>> {
    if (this.inFlightScan) {
      return this.inFlightScan;
    }

    const methods = this.activePaymentMethods();
    if (methods.length === 0) {
      this.pruneInactiveBooks();
      this.loading.set(false);
      this.toast.warn('Selecciona al menos un método de pago para el radar.');
      return this.radarBooks();
    }

    if (this.circuitBreaker.getState() === 'OPEN') {
      const msg = 'Escudo HTTP 429 activo (enfriamiento de 30s). Usando últimos libros limpios en memoria.';
      this.error.set(msg);
      this.toast.warn(msg);
      return this.radarBooks();
    }

    this.scanAbortController?.abort();
    const controller = new AbortController();
    this.scanAbortController = controller;

    const runScan = (async (): Promise<Map<string, RadarCleanBook>> => {
      this.loading.set(true);
      this.error.set(null);

      const activeSet = new Set(methods);
      const tasks: RadarScanTarget[] = [];
      for (const m of methods) {
        tasks.push({ payType: m, side: 'BUY' });
        tasks.push({ payType: m, side: 'SELL' });
      }

      // Prune deselected banks so stale books do not pollute liquidity or arbitrage matrix
      const nextBooks = new Map<string, RadarCleanBook>();
      const nextBotReports = new Map<string, BotDetectionResult[]>();
      const nextMarketTrends = new Map<string, MarketTrendResult>();
      for (const [key, book] of this.radarBooks().entries()) {
        if (activeSet.has(book.payMethod)) {
          nextBooks.set(key, book);
          const bots = this.botReports().get(key);
          if (bots) nextBotReports.set(key, bots);
          const trend = this.marketTrends().get(key);
          if (trend) nextMarketTrends.set(key, trend);
        }
      }

      const tier = this.userTier();
      const config = this.cleanConfig();
      const transAmount = this.selectedBracket().minAmountVes;
      let fulfilledCount = 0;
      const failedMethods: string[] = [];

      try {
        for (let i = 0; i < tasks.length; i += 4) {
          if (controller.signal.aborted) {
            return this.radarBooks();
          }

          const batch = tasks.slice(i, i + 4);
          const batchSettled = await Promise.allSettled(
            batch.map((target) =>
              this.circuitBreaker.execute(() =>
                this.fetchBookTarget(
                  asset,
                  fiat,
                  target.side,
                  target.payType,
                  transAmount,
                  tier,
                  controller.signal,
                ),
              ),
            ),
          );

          for (let j = 0; j < batch.length; j++) {
            const target = batch[j];
            const settled = batchSettled[j];
            const key = `${target.payType}_${target.side}`;

            if (settled.status !== 'fulfilled') {
              failedMethods.push(`${target.payType} (${target.side})`);
              continue;
            }

            fulfilledCount++;
            const rawOffers = settled.value;
            const cleanBook = buildCleanRadarBook(
              rawOffers,
              target.side,
              target.payType,
              tier,
              config,
            );
            nextBooks.set(key, cleanBook);

            // Phase 2: Ring buffer snapshot & VWAP update
            let ringBuffer = this.ringBuffers.get(key);
            if (!ringBuffer) {
              ringBuffer = new SnapshotRingBuffer(12);
              this.ringBuffers.set(key, ringBuffer);
            }

            const nowMs = Date.now();
            const snapshot: BookSnapshot = {
              payMethod: target.payType,
              side: target.side,
              timestampMs: nowMs,
              entries: cleanBook.cleanOffers.slice(0, 10).map((o, idx) => ({
                advNo: o.advNo,
                advertiserNo: o.advertiserNo,
                nickName: o.nickName,
                price: o.price,
                surplusAmount: o.surplusAmount,
                timestampMs: nowMs,
                rank: idx + 1,
              })),
            };
            ringBuffer.push(snapshot);

            const vwap = calculateCleanVWAP(cleanBook.cleanOffers, 5);
            const history = this.vwapHistories.get(key) || [];
            history.push(vwap);
            if (history.length > 50) {
              history.shift();
            }
            this.vwapHistories.set(key, history);

            const detectedBots = detectBotsInHistory(ringBuffer.getSnapshots(), target.side);
            const trend = evaluateMarketTrend(history, target.payType, target.side);

            nextBotReports.set(key, detectedBots);
            nextMarketTrends.set(key, trend);
          }

          // 150ms pace delay strictly between parallel slices (never after the final batch)
          if (i + 4 < tasks.length && !controller.signal.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        }

        if (fulfilledCount === 0 && failedMethods.length > 0) {
          throw new Error(`Todos los sub-libros fallaron (${failedMethods.slice(0, 3).join(', ')})`);
        }

        if (failedMethods.length > 0) {
          this.error.set(`Escaneo parcial: fallaron ${failedMethods.length} consultas (${failedMethods[0]}).`);
        } else {
          this.error.set(null);
        }

        this.radarBooks.set(nextBooks);
        this.botReports.set(nextBotReports);
        this.marketTrends.set(nextMarketTrends);
        this.recomputeMatrixScan(nextBooks);
        this.broadcastHud();
        this.lastUpdated.set(new Date());
        this.scanCycleCount.update((c) => c + 1);
        return nextBooks;
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          return this.radarBooks();
        }
        const msg = err instanceof Error ? err.message : String(err);
        this.error.set(msg);
        this.toast.error(`Error al escanear radar P2P: ${msg}`);
        return this.radarBooks();
      } finally {
        if (this.scanAbortController === controller) {
          this.scanAbortController = null;
        }
        this.loading.set(false);
        this.inFlightScan = null;
      }
    })();

    this.inFlightScan = runScan;
    return runScan;
  }

  // ─── Real-Time Auto-Polling Engine (Live Stream) ───────────────────
  setAutoRefreshInterval(seconds: AutoRefreshIntervalSec): void {
    this.stopAutoRefresh(false);
    this.autoRefreshIntervalSec.set(seconds);

    if (seconds <= 0) {
      this.streamCountdownSec.set(0);
      return;
    }

    this.streamCountdownSec.set(seconds);
    this.autoPollTimer = setInterval(() => {
      if (this.loading()) return;
      if (typeof document !== 'undefined' && document.hidden) return;

      const nextTick = this.streamCountdownSec() - 1;
      if (nextTick <= 0) {
        this.streamCountdownSec.set(this.autoRefreshIntervalSec());
        void this.scanRadar();
      } else {
        this.streamCountdownSec.set(nextTick);
      }
    }, 1000);
  }

  stopAutoRefresh(resetState = true): void {
    if (this.autoPollTimer) {
      clearInterval(this.autoPollTimer);
      this.autoPollTimer = null;
    }
    if (resetState) {
      this.autoRefreshIntervalSec.set(0);
      this.streamCountdownSec.set(0);
    }
  }

  // ─── Private Ingestion Helper ──────────────────────────────────────
  private async fetchBookTarget(
    asset: string,
    fiat: string,
    side: RadarOrderSide,
    payType: string,
    transAmount: number,
    tier: P2PUserTier,
    externalSignal?: AbortSignal,
  ): Promise<RawP2POfferInput[]> {
    const publisherType = tier === 'VERIFIED' ? 'merchant' : null;
    // Binance C2C adv/search returns Maker BUY ads when queried with tradeType='SELL',
    // and Maker SELL ads when queried with tradeType='BUY'.
    const binanceTradeType: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY';

    const payload = {
      asset,
      fiat,
      tradeType: binanceTradeType,
      payTypes: [payType],
      transAmount: transAmount > 0 ? transAmount : undefined,
      publisherType,
      page: 1,
      rows: 20,
    };

    const electronWin =
      typeof window !== 'undefined'
        ? (window as unknown as {
            electron?: {
              fetchBinanceP2p?: (p: unknown) => Promise<unknown>;
            };
          })
        : null;

    let responseData: unknown;
    const timeoutSignal = AbortSignal.timeout(9000);
    const requestSignal =
      externalSignal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([externalSignal, timeoutSignal])
        : externalSignal ?? timeoutSignal;

    if (electronWin?.electron?.fetchBinanceP2p) {
      responseData = await electronWin.electron.fetchBinanceP2p(payload);
    } else if (this.nativeHttp?.isNative) {
      const url = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
      responseData = await this.nativeHttp.post(url, payload, { timeoutMs: 9000, signal: requestSignal });
    } else {
      const directUrl = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
      responseData = await this.fetchWebWithFallback(directUrl, payload, requestSignal);
    }

    return this.parseP2POffers(responseData);
  }

  private async fetchWebWithFallback(
    directUrl: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const postJson = async (url: string): Promise<{ ok: boolean; status: number; headers?: Headers; body?: unknown }> => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok) {
        return { ok: false, status: res.status, headers: res.headers };
      }
      return { ok: true, status: res.status, body: await res.json() };
    };

    // 1. Direct endpoint (also used in tests & CORS-unlocked webviews)
    try {
      const first = await postJson(directUrl);
      if (first.ok) return first.body;
      if (first.status === 429) {
        const retrySec = Number(first.headers?.get('Retry-After') || '1');
        const waitMs = Number.isFinite(retrySec) && retrySec > 0 ? Math.min(2500, retrySec * 1000) : 800;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        const retry = await postJson(directUrl);
        if (retry.ok) return retry.body;
        throw new Error(`Binance P2P error: HTTP 429 (Rate limit)`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('HTTP 429')) {
        throw err;
      }
      if (signal.aborted) {
        throw err;
      }
      // CORS / network failure falls through to local dev/desktop bridges
    }

    // 2. Angular dev proxy (/api/binance-p2p)
    try {
      const devRes = await postJson('/api/binance-p2p');
      if (devRes.ok) return devRes.body;
      if (devRes.status === 429) throw new Error('Binance P2P error: HTTP 429 (Rate limit)');
    } catch (err) {
      if (err instanceof Error && err.message.includes('HTTP 429')) throw err;
    }

    // 3. Desktop local bridge (127.0.0.1:51857)
    try {
      const bridgeRes = await postJson('http://127.0.0.1:51857/api/binance/p2p');
      if (bridgeRes.ok) return bridgeRes.body;
    } catch {
      // Bridge offline
    }

    throw new Error('Binance P2P no accesible desde navegador web (CORS / red). Usa la app Electron o proxy local.');
  }

  private parseP2POffers(raw: unknown): RawP2POfferInput[] {
    if (!raw || typeof raw !== 'object') return [];
    const root = raw as { data?: unknown[] };
    if (!Array.isArray(root.data)) return [];

    const parsed: RawP2POfferInput[] = [];

    for (const item of root.data) {
      if (!item || typeof item !== 'object') continue;
      const record = item as {
        adv?: {
          advNo?: string;
          price?: string | number;
          surplusAmount?: string | number;
          minSingleTransAmount?: string | number;
          maxSingleTransAmount?: string | number;
          payTimeLimit?: number;
          tradeMethods?: { payType?: string }[];
        };
        advertiser?: {
          userNo?: string;
          nickName?: string;
          monthOrderCount?: number;
          monthFinishRate?: number;
          userType?: string;
        };
      };

      const adv = record.adv;
      const advUser = record.advertiser;
      if (!adv || !adv.advNo) continue;

      const price = typeof adv.price === 'string' ? parseFloat(adv.price) : Number(adv.price);
      const surplus =
        typeof adv.surplusAmount === 'string'
          ? parseFloat(adv.surplusAmount)
          : Number(adv.surplusAmount);
      const minSingle =
        typeof adv.minSingleTransAmount === 'string'
          ? parseFloat(adv.minSingleTransAmount)
          : Number(adv.minSingleTransAmount);
      const maxSingle =
        typeof adv.maxSingleTransAmount === 'string'
          ? parseFloat(adv.maxSingleTransAmount)
          : Number(adv.maxSingleTransAmount);

      const payMethods = Array.isArray(adv.tradeMethods)
        ? adv.tradeMethods.map((m) => m.payType).filter((t): t is string => !!t)
        : [];

      const rawFinishRate = Number(advUser?.monthFinishRate ?? 0);
      const normalizedFinishRate = Number.isFinite(rawFinishRate)
        ? Math.min(100, Math.max(0, rawFinishRate > 1 ? rawFinishRate : rawFinishRate * 100))
        : 0;
      const rawPayTime = Number(adv.payTimeLimit);
      const payTimeLimit =
        Number.isFinite(rawPayTime) && rawPayTime > 0 ? rawPayTime : 15;

      parsed.push({
        advNo: String(adv.advNo),
        advertiserNo: String(advUser?.userNo || 'UNKNOWN'),
        nickName: String(advUser?.nickName || 'Anónimo'),
        price: Number.isFinite(price) ? price : 0,
        surplusAmount: Number.isFinite(surplus) ? surplus : 0,
        minSingleTransAmount: Number.isFinite(minSingle) ? minSingle : 0,
        maxSingleTransAmount: Number.isFinite(maxSingle) ? maxSingle : 0,
        monthOrderCount: Number(advUser?.monthOrderCount || 0),
        monthFinishRate: normalizedFinishRate,
        payTimeLimit,
        isMerchant: advUser?.userType === 'merchant',
        payMethods,
      });
    }

    return parsed;
  }

  /** Prunes cached books/bots/trends belonging to deselected payment methods. */
  private pruneInactiveBooks(): void {
    const activeSet = new Set(this.activePaymentMethods());
    const current = this.radarBooks();
    if (current.size === 0) return;

    let changed = false;
    const nextBooks = new Map<string, RadarCleanBook>();
    const nextBotReports = new Map<string, BotDetectionResult[]>();
    const nextMarketTrends = new Map<string, MarketTrendResult>();

    for (const [key, book] of current.entries()) {
      if (activeSet.has(book.payMethod)) {
        nextBooks.set(key, book);
        const bots = this.botReports().get(key);
        if (bots) nextBotReports.set(key, bots);
        const trend = this.marketTrends().get(key);
        if (trend) nextMarketTrends.set(key, trend);
      } else {
        changed = true;
      }
    }

    if (!changed) return;
    this.radarBooks.set(nextBooks);
    this.botReports.set(nextBotReports);
    this.marketTrends.set(nextMarketTrends);
    this.recomputeMatrixScan(nextBooks);
    this.broadcastHud();
  }

  /** Recomputes clean books from memory when config or user tier changes */
  private recomputeBooks(): void {
    const current = this.radarBooks();
    if (current.size === 0) return;

    const activeSet = new Set(this.activePaymentMethods());
    const nextBooks = new Map<string, RadarCleanBook>();
    const nextBotReports = new Map<string, BotDetectionResult[]>();
    const nextMarketTrends = new Map<string, MarketTrendResult>();
    const tier = this.userTier();
    const config = this.cleanConfig();

    for (const [key, book] of current.entries()) {
      if (!activeSet.has(book.payMethod)) continue;
      // Re-run with updated tier and clean config
      const allOffers = [...book.cleanOffers, ...book.rejectedOffers];
      const recomputed = buildCleanRadarBook(allOffers, book.side, book.payMethod, tier, config);
      nextBooks.set(key, recomputed);

      const ringBuffer = this.ringBuffers.get(key);
      if (ringBuffer) {
        nextBotReports.set(key, detectBotsInHistory(ringBuffer.getSnapshots(), book.side));
      }
      const history = this.vwapHistories.get(key) || [];
      if (history.length > 0) {
        nextMarketTrends.set(key, evaluateMarketTrend(history, book.payMethod, book.side));
      }
    }

    this.radarBooks.set(nextBooks);
    this.botReports.set(nextBotReports);
    this.marketTrends.set(nextMarketTrends);
    this.recomputeMatrixScan(nextBooks);
    this.broadcastHud();
  }

  // ─── Phase 2 Getters ───────────────────────────────────────────────
  getBotsForBook(payType: string, side: RadarOrderSide): BotDetectionResult[] {
    return this.botReports().get(`${payType}_${side}`) || [];
  }

  getTrendForBook(payType: string, side: RadarOrderSide): MarketTrendResult | undefined {
    return this.marketTrends().get(`${payType}_${side}`);
  }

  // ─── Phase 3 Tactical Methods ──────────────────────────────────────
  /**
   * Evaluates arbitrage matrix across all currently loaded payment methods.
   */
  recomputeMatrixScan(books?: Map<string, RadarCleanBook>): void {
    const targetBooks = books ?? this.radarBooks();
    if (targetBooks.size === 0) {
      this.matrixScanResult.set(null);
      return;
    }

    const result = scanArbitrageMatrix(targetBooks, {
      capitalUsdt: this.operatingCapitalUsdt(),
      mode: this.executionMode(),
      userTier: this.userTier(),
      targetNetMarginPct: this.targetNetMarginPct(),
      interbankFrictionPct: this.interbankFrictionPct(),
    });
    this.matrixScanResult.set(result);
  }

  /**
   * Fast simulation helper for interactive calculators and UI trade preview.
   */
  simulateArbitrage(
    buyPrice: number,
    sellPrice: number,
    overrides?: Partial<ArbitrageCycleParams>,
  ): ArbitrageCycleMetrics {
    return calculateArbitrageCycle({
      buyPrice,
      sellPrice,
      capitalUsdt: overrides?.capitalUsdt ?? this.operatingCapitalUsdt(),
      mode: overrides?.mode ?? this.executionMode(),
      userTier: overrides?.userTier ?? this.userTier(),
      customMakerFeeBuyPct: overrides?.customMakerFeeBuyPct,
      customMakerFeeSellPct: overrides?.customMakerFeeSellPct,
      fiatFrictionPct: overrides?.fiatFrictionPct ?? 0,
      targetNetMarginPct: overrides?.targetNetMarginPct ?? this.targetNetMarginPct(),
    });
  }

  // ─── Phase 5: Browser Extension HUD & Accounting Isolation ─────────
  broadcastHud(): RadarHudPayload | null {
    if (!this.hudActive()) return null;

    const payload = buildRadarHudPayload({
      radarBooks: this.radarBooks(),
      matrixResult: this.matrixScanResult(),
      botReports: this.botReports(),
      marketTrends: this.marketTrends(),
      userTier: this.userTier(),
      executionMode: this.executionMode(),
      operatingCapitalUsdt: this.operatingCapitalUsdt(),
      targetNetMarginPct: this.targetNetMarginPct(),
      activeBanks: this.activePaymentMethods(),
    });

    this.hudBroadcaster.broadcast(payload);
    this.lastHudPayload.set(payload);
    return payload;
  }

  toggleHudBroadcasting(): boolean {
    const next = !this.hudActive();
    this.hudActive.set(next);
    if (next) {
      this.broadcastHud();
      this.toast.info('Puente HUD Extension activado (BroadcastChannel en vivo).');
    } else {
      this.toast.warn('Puente HUD Extension pausado.');
    }
    return next;
  }

  recordCompletedCycle(params: {
    sourceBank: string;
    targetBank: string;
    executionMode: ExecutionMode;
    capitalUsdt: number;
    buyPrice: number;
    sellPrice: number;
    netSpreadPct: number;
    netProfitUsdt: number;
    netProfitFiat: number;
    notes?: string;
  }): RadarCompletedCycleRecord {
    const record = createCompletedCycleRecord(params);
    this.completedCycles.update((curr) => [record, ...curr]);
    this.persistCycles(this.completedCycles());
    this.toast.success(
      `Ciclo registrado: +$${record.netProfitUsdt.toFixed(2)} USDT (+${record.netSpreadPct.toFixed(2)}%)`,
    );
    return record;
  }

  /**
   * Dispatches a tactical arbitrage route directly to the CRM & Treasury Kanban Pipeline
   * (`STAGE_2_TRANSIT`) so the operator can track bank reservation and reference verification.
   */
  dispatchRouteToCrmPipeline(params: {
    sourceBank: string;
    targetBank: string;
    buyPrice: number;
    sellPrice: number;
    capitalUsdt: number;
    netProfitUsdt: number;
  }): PipelineDeal {
    const now = Date.now();
    const dealId = `RADAR-${now.toString(36).toUpperCase()}`;
    const sourceBankLabel = RADAR_BANK_LABELS[params.sourceBank] || params.sourceBank;
    const targetBankLabel = RADAR_BANK_LABELS[params.targetBank] || params.targetBank;

    const newDeal: PipelineDeal = {
      id: dealId,
      scope: 'P2P_DESK',
      title: `Arbitraje Radar: ${sourceBankLabel} ➔ ${targetBankLabel}`,
      contactId: 'RADAR_DESK',
      contactName: `Mesa P2P (${sourceBankLabel} ➔ ${targetBankLabel})`,
      bankAccountId: `BANK_${params.sourceBank.toUpperCase()}`,
      bankName: sourceBankLabel,
      stage: 'STAGE_2_TRANSIT',
      fiatCurrency: 'VES',
      cryptoAmountUsdt: params.capitalUsdt,
      appliedRate: params.sellPrice,
      replacementRate: params.buyPrice,
      totalFiatAmount: Math.round(params.capitalUsdt * params.sellPrice * 100) / 100,
      paidFiatAmount: 0,
      netProfitUsdt: params.netProfitUsdt,
      bankReferenceId: '',
      quoteTtlMinutes: 15,
      quotedAt: now,
      isRateExpired: false,
      timeline: [
        {
          timestamp: now,
          fromStage: null,
          toStage: 'STAGE_2_TRANSIT',
          notes: `Despachado desde Radar Cuantitativo (${sourceBankLabel} @ ${params.sellPrice.toFixed(2)} ➔ ${targetBankLabel} @ ${params.buyPrice.toFixed(2)})`,
        },
      ],
      createdAt: now,
      closedAt: null,
    };

    try {
      let existingDeals: PipelineDeal[] = [];
      if (this.storage) {
        const raw = this.storage.get<unknown>(CRM_STORAGE_KEYS.DEALS);
        existingDeals = safeHydrateCrmCollection<PipelineDeal>(raw);
        this.storage.set(CRM_STORAGE_KEYS.DEALS, [newDeal, ...existingDeals]);
      } else if (typeof localStorage !== 'undefined' && typeof localStorage?.getItem === 'function') {
        const rawStr = localStorage.getItem(CRM_STORAGE_KEYS.DEALS);
        const parsed = rawStr ? JSON.parse(rawStr) : [];
        existingDeals = safeHydrateCrmCollection<PipelineDeal>(parsed);
        localStorage.setItem(CRM_STORAGE_KEYS.DEALS, JSON.stringify([newDeal, ...existingDeals]));
      }
      this.toast.success(`Trato ${dealId} enviado al Kanban del CRM (En Tránsito).`);
    } catch (err) {
      console.debug('[P2PRadarService] Error dispatching deal to CRM:', err);
    }

    return newDeal;
  }

  clearCompletedCycles(dateKey?: string): void {
    if (dateKey) {
      this.completedCycles.update((curr) => curr.filter((c) => c.dateKey !== dateKey));
    } else {
      this.completedCycles.set([]);
    }
    this.persistCycles(this.completedCycles());
    this.toast.info('Registro de ciclos completados actualizado.');
  }

  private loadStoredCycles(): RadarCompletedCycleRecord[] {
    try {
      if (this.storage) {
        const stored = this.storage.get<RadarCompletedCycleRecord[]>(
          P2PRadarService.STORAGE_KEY_CYCLES,
        );
        if (Array.isArray(stored)) return stored;
      }
      if (typeof localStorage !== 'undefined' && typeof localStorage?.getItem === 'function') {
        const raw = localStorage.getItem(P2PRadarService.STORAGE_KEY_CYCLES);
        if (raw) return JSON.parse(raw);
      }
    } catch (err) {
      console.debug('[P2PRadarService] Error loading stored cycles:', err);
    }
    return [];
  }

  private persistCycles(records: RadarCompletedCycleRecord[]): void {
    try {
      if (this.storage) {
        this.storage.set(P2PRadarService.STORAGE_KEY_CYCLES, records);
      }
      if (typeof localStorage !== 'undefined' && typeof localStorage?.setItem === 'function') {
        localStorage.setItem(P2PRadarService.STORAGE_KEY_CYCLES, JSON.stringify(records));
      }
    } catch (err) {
      console.debug('[P2PRadarService] Error persisting cycles:', err);
    }
  }
}
