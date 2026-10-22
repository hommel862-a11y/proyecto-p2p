import { Injectable, inject, signal, computed } from '@angular/core';
import { ToastService } from './toast.service';
import { NativeHttpService } from './native-http.service';
import { StorageService } from './storage';
import {
  type P2PUserTier,
  type RadarOrderSide,
  type CleanModeConfig,
  type RadarCleanBook,
  type VolumeBracketConfig,
  type RawP2POfferInput,
  type BotDetectionResult,
  type MarketTrendResult,
  type BookSnapshot,
  type ExecutionMode,
  type ArbitrageCycleParams,
  type ArbitrageCycleMetrics,
  type ArbitrageRoute,
  type MatrixScanResult,
  type RadarHudPayload,
  type RadarCompletedCycleRecord,
  type RadarDailyConsolidatedSummary,
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
export class P2PRadarService {
  private static readonly STORAGE_KEY_CYCLES = 'p2p.radar.completed-cycles';

  private readonly toast = inject(ToastService);
  private readonly nativeHttp = inject(NativeHttpService, { optional: true });
  private readonly storage = inject(StorageService, { optional: true });

  // ─── Phase 5: Browser Extension HUD & Accounting Isolation ─────────
  private readonly hudBroadcaster = new RadarHudBroadcaster();
  readonly hudActive = signal<boolean>(true);
  readonly lastHudPayload = signal<RadarHudPayload | null>(null);
  readonly completedCycles = signal<RadarCompletedCycleRecord[]>(this.loadStoredCycles());

  readonly dailyConsolidated = computed<RadarDailyConsolidatedSummary>(() => {
    return consolidateDailyCycles(this.completedCycles());
  });

  // ─── Phase 2 Memory Stores ─────────────────────────────────────────
  private readonly ringBuffers = new Map<string, SnapshotRingBuffer>();
  private readonly vwapHistories = new Map<string, number[]>();

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

  readonly totalBotsDetected = computed(() => {
    let count = 0;
    for (const bots of this.botReports().values()) {
      count += bots.length;
    }
    return count;
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
    this.cleanConfig.update((curr) => ({ ...curr, ...partial }));
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

  togglePaymentMethod(methodKey: string): void {
    this.activePaymentMethods.update((current) => {
      if (current.includes(methodKey)) {
        return current.filter((m) => m !== methodKey);
      }
      return [...current, methodKey];
    });
  }

  setBankPreset(preset: BankPresetId): void {
    if (preset === 'CLEAR') {
      this.activePaymentMethods.set([]);
      return;
    }
    this.activePaymentMethods.set([...BANK_PRESETS[preset]]);
  }

  selectAllBanks(): void {
    this.activePaymentMethods.set(Object.keys(RADAR_BANK_LABELS));
  }

  setBanks(methods: string[]): void {
    this.activePaymentMethods.set(methods);
  }

  // ─── Phase 3 Mutators ──────────────────────────────────────────────
  setExecutionMode(mode: ExecutionMode): void {
    this.executionMode.set(mode);
    this.recomputeMatrixScan();
  }

  setOperatingCapital(capitalUsdt: number): void {
    this.operatingCapitalUsdt.set(Math.max(1, capitalUsdt));
    this.recomputeMatrixScan();
  }

  setTargetNetMargin(marginPct: number): void {
    this.targetNetMarginPct.set(marginPct);
    this.recomputeMatrixScan();
  }

  setInterbankFriction(frictionPct: number): void {
    this.interbankFrictionPct.set(Math.max(0, frictionPct));
    this.recomputeMatrixScan();
  }

  // ─── Network Ingestion Pipeline ────────────────────────────────────
  /**
   * Scans multiple payment methods concurrently for both BUY and SELL.
   * Feeds the raw data into the Clean Mode mathematical engine.
   */
  async scanRadar(asset = 'USDT', fiat = 'VES'): Promise<Map<string, RadarCleanBook>> {
    this.loading.set(true);
    this.error.set(null);

    const methods = this.activePaymentMethods();
    if (methods.length === 0) {
      this.loading.set(false);
      this.toast.warn('Selecciona al menos un método de pago para el radar.');
      return this.radarBooks();
    }

    const tasks: RadarScanTarget[] = [];
    for (const m of methods) {
      tasks.push({ payType: m, side: 'BUY' });
      tasks.push({ payType: m, side: 'SELL' });
    }

    const nextBooks = new Map<string, RadarCleanBook>(this.radarBooks());
    const nextBotReports = new Map<string, BotDetectionResult[]>(this.botReports());
    const nextMarketTrends = new Map<string, MarketTrendResult>(this.marketTrends());
    const tier = this.userTier();
    const config = this.cleanConfig();
    const transAmount = this.selectedBracket().minAmountVes;

    try {
      // Execute in controlled batches of 4 to optimize turnaround without exceeding rate limits
      for (let i = 0; i < tasks.length; i += 4) {
        const batch = tasks.slice(i, i + 4);
        const batchResults = await Promise.all(
          batch.map((target) =>
            this.fetchBookTarget(asset, fiat, target.side, target.payType, transAmount, tier),
          ),
        );

        for (let j = 0; j < batch.length; j++) {
          const target = batch[j];
          const rawOffers = batchResults[j];
          const key = `${target.payType}_${target.side}`;

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

          // Track clean VWAP
          const vwap = calculateCleanVWAP(cleanBook.cleanOffers, 5);
          const history = this.vwapHistories.get(key) || [];
          history.push(vwap);
          if (history.length > 50) {
            history.shift();
          }
          this.vwapHistories.set(key, history);

          // Detect bots & evaluate market trend
          const detectedBots = detectBotsInHistory(ringBuffer.getSnapshots(), target.side);
          const trend = evaluateMarketTrend(history, target.payType, target.side);

          nextBotReports.set(key, detectedBots);
          nextMarketTrends.set(key, trend);
        }

        // 150ms pace delay between parallel slices
        if (i + 2 < tasks.length) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }

      this.radarBooks.set(nextBooks);
      this.botReports.set(nextBotReports);
      this.marketTrends.set(nextMarketTrends);
      this.recomputeMatrixScan(nextBooks);
      this.broadcastHud();
      this.lastUpdated.set(new Date());
      this.loading.set(false);
      return nextBooks;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error.set(msg);
      this.loading.set(false);
      this.toast.error(`Error al escanear radar P2P: ${msg}`);
      return this.radarBooks();
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
  ): Promise<RawP2POfferInput[]> {
    const publisherType = tier === 'VERIFIED' ? 'merchant' : null;

    const payload = {
      asset,
      fiat,
      tradeType: side,
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

    let responseData: unknown = null;

    if (electronWin?.electron?.fetchBinanceP2p) {
      responseData = await electronWin.electron.fetchBinanceP2p(payload);
    } else if (this.nativeHttp?.isNative) {
      const url = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
      responseData = await this.nativeHttp.post(url, payload, { timeoutMs: 9000 });
    } else {
      // Web proxy / direct fetch fallback
      const url = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) {
        throw new Error(`Binance P2P error: HTTP ${res.status}`);
      }
      responseData = await res.json();
    }

    return this.parseP2POffers(responseData);
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
          tradeMethods?: Array<{ payType?: string }>;
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

      parsed.push({
        advNo: String(adv.advNo),
        advertiserNo: String(advUser?.userNo || 'UNKNOWN'),
        nickName: String(advUser?.nickName || 'Anónimo'),
        price: Number.isFinite(price) ? price : 0,
        surplusAmount: Number.isFinite(surplus) ? surplus : 0,
        minSingleTransAmount: Number.isFinite(minSingle) ? minSingle : 0,
        maxSingleTransAmount: Number.isFinite(maxSingle) ? maxSingle : 0,
        monthOrderCount: Number(advUser?.monthOrderCount || 0),
        monthFinishRate: Number(advUser?.monthFinishRate ? advUser.monthFinishRate * 100 : 0),
        payTimeLimit: Number(adv.payTimeLimit || 15),
        isMerchant: advUser?.userType === 'merchant',
        payMethods,
      });
    }

    return parsed;
  }

  /** Recomputes clean books from memory when config or user tier changes */
  private recomputeBooks(): void {
    const current = this.radarBooks();
    if (current.size === 0) return;

    const nextBooks = new Map<string, RadarCleanBook>();
    const nextBotReports = new Map<string, BotDetectionResult[]>();
    const nextMarketTrends = new Map<string, MarketTrendResult>();
    const tier = this.userTier();
    const config = this.cleanConfig();

    for (const [key, book] of current.entries()) {
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
    if (targetBooks.size === 0) return;

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
