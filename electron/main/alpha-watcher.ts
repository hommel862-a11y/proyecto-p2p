/**
 * Autonomous Continuous Alpha Watcher.
 * Background service in Electron that polls Binance P2P orderbooks periodically,
 * detects profitable arbitrage spreads meeting the Golden Rule (net spread >= 1.0%),
 * verifies depth with the trade-impact simulator, and pushes proactive plan alerts
 * directly to the Copilot UI and SQLite memory.
 *
 * ODD T3 (C1): every detected spread is audited by the Risk Gatekeeper BEFORE it is
 * persisted. The watcher used to write a PROPOSED plan straight to SQLite, which bypassed
 * the institutional veto the swarm applies on every other path. A vetoed spread is now
 * refused, recorded in Engram, and reported to the Copilot UI with its reason.
 */

import { BrowserWindow, Notification } from 'electron';
import type { P2PDatabaseService, StrategyPlanRecord } from './db/database';
import { ProactiveEventEngine } from './agents/proactive-event-engine';
import { RiskGatekeeperAgent } from './agents/risk-gatekeeper-agent';
import type { RiskVerdict, StrategistProposal, TreasuryRiskContext } from './agents/types';
import { getTreasurySnapshot } from './ipc/treasury-snapshot';
import { fetchBinanceP2pShared } from './ipc/handlers';
import { parseBinanceP2pItems, type BinanceOfferSummary } from './vendor/p2p-core/binance-p2p';
import type { BinanceSearchParams } from '../shared/types';

export type FetchBinanceP2pFn = (
  params: BinanceSearchParams,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

const BINANCE_DEEP_LINK_ID_RE = /^[A-Za-z0-9_-]{3,64}$/;

function buildAlphaAdUrl(advNo?: string): string | undefined {
  const clean = advNo?.trim() ?? '';
  if (!BINANCE_DEEP_LINK_ID_RE.test(clean)) return undefined;
  return `https://c2c.binance.com/es-LA/adv?code=${encodeURIComponent(clean)}`;
}

function buildAlphaAdvertiserUrl(advertiserNo?: string): string | undefined {
  const clean = advertiserNo?.trim() ?? '';
  if (!BINANCE_DEEP_LINK_ID_RE.test(clean)) return undefined;
  return `https://p2p.binance.com/es-LA/advertiserDetail?advertiserNo=${encodeURIComponent(clean)}`;
}

const MIN_QUALIFIED_FINISH_RATE_PCT = 90;
const MIN_QUALIFIED_ORDER_COUNT = 10;
const MAX_MEDIAN_DEVIATION_RATIO = 0.3;

/** Default single-leg Maker fallback commission in % (`STANDARD`), overridden when `merchantLevel` is set. */
const BINANCE_P2P_COMMISSION_PCT = 0.25;
const ALPHA_MAKER_FEE_PCT: Record<'STANDARD' | 'BRONZE' | 'SILVER' | 'GOLD', number> = {
  STANDARD: 0.25,
  BRONZE: 0.2,
  SILVER: 0.175,
  GOLD: 0.125,
};

/** Ticket the watcher proposes per detected spread. */
const ALPHA_TICKET_USDT = 1000;

/**
 * Rule 1 of the Risk Gatekeeper (net spread floor after fees). Mirrored here only so
 * `meetsGoldenRule` is computed honestly from the observed spread instead of being asserted;
 * the gatekeeper still re-checks the same floor itself.
 */
const GOLDEN_RULE_MIN_NET_SPREAD_PCT = 0.5;

/**
 * Audit figures used when the renderer never announced a treasury snapshot. Same pre-bridge
 * placeholders the swarm falls back to, so both entry points behave identically offline.
 */
const FALLBACK_DAILY_VOLUME_USDT = 4500;
const FALLBACK_DAILY_LIMIT_USDT = 15000;

export interface AlphaWatcherConfig {
  pollIntervalSeconds: number;
  minNetSpreadPct: number;
  asset: string;
  fiat: string;
  payTypes: string[];
  enabled: boolean;
  merchantLevel?: 'STANDARD' | 'BRONZE' | 'SILVER' | 'GOLD';
}

export class AlphaWatcher {
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private proactiveEngine: ProactiveEventEngine;
  private config: AlphaWatcherConfig = {
    pollIntervalSeconds: 30,
    minNetSpreadPct: 1.15,
    asset: 'USDT',
    fiat: 'VES',
    payTypes: ['Banesco', 'PagoMovil'],
    enabled: true,
  };

  private scanCount = 0;
  private lastOpportunity: { time: number; netSpreadPct: number; route: string } | null = null;
  private consecutiveErrors = 0;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;

  constructor(
    private db: P2PDatabaseService,
    private getMainWindow: () => BrowserWindow | null,
    /**
     * Injected for testability and so a host can share one gatekeeper instance. Defaults to
     * a private instance so existing call sites (`main/index.ts`, the handlers fallback) keep
     * enforcing the veto without any wiring change.
     */
    private riskGatekeeper: RiskGatekeeperAgent = new RiskGatekeeperAgent(),
    private fetchBinanceP2p: FetchBinanceP2pFn = fetchBinanceP2pShared,
  ) {
    this.proactiveEngine = new ProactiveEventEngine(this.db, (channel, payload) => {
      const win = this.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    });
  }

  getProactiveEngine(): ProactiveEventEngine {
    return this.proactiveEngine;
  }

  getStatus(): {
    enabled: boolean;
    pollIntervalSeconds: number;
    minNetSpreadPct: number;
    scanCount: number;
    lastOpportunity: unknown;
    consecutiveErrors: number;
    lastError: string | null;
    lastErrorAt: number | null;
  } {
    return {
      enabled: this.isRunning(),
      pollIntervalSeconds: this.config.pollIntervalSeconds,
      minNetSpreadPct: this.config.minNetSpreadPct,
      scanCount: this.scanCount,
      lastOpportunity: this.lastOpportunity,
      consecutiveErrors: this.consecutiveErrors,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
    };
  }

  setConfig(newConfig: Partial<AlphaWatcherConfig>): void {
    const prevPollInterval = this.config.pollIntervalSeconds;
    const sanitizedPoll =
      typeof newConfig.pollIntervalSeconds === 'number' &&
      Number.isFinite(newConfig.pollIntervalSeconds) &&
      newConfig.pollIntervalSeconds > 0
        ? Math.max(5, Math.floor(newConfig.pollIntervalSeconds))
        : prevPollInterval;

    this.config = {
      ...this.config,
      ...newConfig,
      pollIntervalSeconds: sanitizedPoll,
    };

    const pollIntervalChanged = sanitizedPoll !== prevPollInterval;
    if (newConfig.enabled === false) {
      this.stop();
      return;
    }
    if (newConfig.enabled === true) {
      if (this.isRunning() && pollIntervalChanged) {
        this.stop();
      }
      this.start();
      return;
    }
    if (this.isRunning() && pollIntervalChanged) {
      this.stop();
      this.start();
    }
  }

  start(): void {
    if (this.timer) return;
    this.config.enabled = true;
    this.timer = setInterval(() => {
      void this.runScanCycle();
    }, this.config.pollIntervalSeconds * 1000);
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.runScanCycle();
    }, 5000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    this.config.enabled = false;
  }

  isRunning(): boolean {
    return this.config.enabled && this.timer !== null;
  }

  async runScanCycle(): Promise<void> {
    if (this.isPolling || !this.config.enabled) return;
    this.isPolling = true;
    this.scanCount++;

    try {
      // 1. Fetch top BUY and SELL offers through the shared rate-limited Binance P2P path
      const [buyOffers, sellOffers] = await Promise.all([
        this.fetchBinanceSide('BUY'),
        this.fetchBinanceSide('SELL'),
      ]);

      this.consecutiveErrors = 0;
      this.lastError = null;
      this.lastErrorAt = null;

      const bestBuyOffer = buyOffers[0];
      const bestSellOffer = sellOffers[0];
      const bestBuy = bestBuyOffer?.price;
      const bestSell = bestSellOffer?.price;

      if (!bestBuy || !bestSell || bestSell <= bestBuy) {
        return; // Spread is negative or zero (no maker/taker gap)
      }

      const buyAdUrl = buildAlphaAdUrl(bestBuyOffer?.advNo);
      const sellAdUrl = buildAlphaAdUrl(bestSellOffer?.advNo);
      const buyAdvertiserUrl = buildAlphaAdvertiserUrl(bestBuyOffer?.advertiserNo);
      const sellAdvertiserUrl = buildAlphaAdvertiserUrl(bestSellOffer?.advertiserNo);
      const executionLinks = {
        ...(bestBuyOffer?.advNo ? { buyAdvNo: bestBuyOffer.advNo } : {}),
        ...(bestBuyOffer?.advertiserNo ? { buyAdvertiserNo: bestBuyOffer.advertiserNo } : {}),
        ...(buyAdUrl ? { buyAdUrl } : {}),
        ...(buyAdvertiserUrl ? { buyAdvertiserUrl } : {}),
        ...(bestSellOffer?.advNo ? { sellAdvNo: bestSellOffer.advNo } : {}),
        ...(bestSellOffer?.advertiserNo ? { sellAdvertiserNo: bestSellOffer.advertiserNo } : {}),
        ...(sellAdUrl ? { sellAdUrl } : {}),
        ...(sellAdvertiserUrl ? { sellAdvertiserUrl } : {}),
      };
      const rationaleLinks = [
        buyAdUrl ? `[Abrir Compra](${buyAdUrl})` : null,
        sellAdUrl ? `[Abrir Venta](${sellAdUrl})` : null,
      ]
        .filter((x): x is string => Boolean(x))
        .join(' · ');

      // Calculate gross and net spread deducting canonical Maker fee (or 0.25% STANDARD fallback)
      const commissionPct = this.config.merchantLevel
        ? ALPHA_MAKER_FEE_PCT[this.config.merchantLevel]
        : BINANCE_P2P_COMMISSION_PCT;
      const grossSpreadPct = ((bestSell - bestBuy) / bestBuy) * 100;
      const netSpreadPct = Number((grossSpreadPct - commissionPct).toFixed(2));
      const liveMidRateVes = (bestBuy + bestSell) / 2;

      if (netSpreadPct >= this.config.minNetSpreadPct) {
        const planId = `ALPHA-${Date.now().toString(36).toUpperCase()}`;
        const plan: StrategyPlanRecord = {
          id: planId,
          title: `Oportunidad Alpha Automática Binance P2P (${netSpreadPct}% neto)`,
          route: `Compra @ ${bestBuy} VES -> Venta @ ${bestSell} VES (${this.config.payTypes.join(' / ')})`,
          asset: this.config.asset,
          fiat: this.config.fiat,
          capitalRequiredUsdt: ALPHA_TICKET_USDT,
          expectedNetSpreadPct: netSpreadPct,
          expectedProfitUsdt: Number(((ALPHA_TICKET_USDT * netSpreadPct) / 100).toFixed(2)),
          riskLevel: 'LOW',
          assignedOperatorName: 'Centinela Autónomo',
          rationale:
            `El vigilante en segundo plano detectó un spread neto de ${netSpreadPct}% (Compra: ${bestBuy} VES, Venta: ${bestSell} VES) superando el umbral de ${this.config.minNetSpreadPct}%.` +
            (rationaleLinks ? ` Enlaces directos: ${rationaleLinks}` : ''),
          status: 'PROPOSED',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // Institutional veto BEFORE any persistence: the watcher is an unattended entry
        // point, so it must never reach SQLite without the same audit the swarm applies.
        const verdict = this.auditWithGatekeeper(
          plan,
          grossSpreadPct,
          netSpreadPct,
          liveMidRateVes,
          commissionPct,
        );
        const isVetoed = verdict.status === 'VETOED';

        if (isVetoed) {
          this.recordVeto(plan, verdict);
        } else {
          this.lastOpportunity = {
            time: Date.now(),
            netSpreadPct,
            route: plan.route,
          };

          // Persist to SQLite
          this.db.saveStrategyPlan(plan);

          // Record market learning
          this.db.recordMarketLearning({
            topicKey: `alpha/spread-${this.config.asset}-${this.config.fiat}`,
            category: 'SPREAD_CYCLE',
            insight: `Centinela detectó ventana de arbitraje de ${netSpreadPct}% en ${this.config.fiat} con ticket de ${ALPHA_TICKET_USDT} USDT.`,
            confidenceScore: 0.95,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }

        // Notify Desktop UI through IPC. A veto is reported on the same channel with
        // `persisted: false` and the reason attached, so the operator sees the refusal
        // instead of a silent absence.
        const win = this.getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('copilot:alpha-opportunity-detected', {
            plan,
            detectedAt: Date.now(),
            persisted: !isVetoed,
            executionLinks,
            riskVerdict: {
              status: verdict.status,
              riskScore: verdict.riskScore,
              vetoReason: verdict.vetoReason,
              warnings: verdict.warnings,
              recommendedAction: verdict.recommendedAction,
            },
          });
        }

        // Native OS Notification. Vetoes get their own wording: announcing a blocked spread
        // as an opportunity would push the operator toward a trade the gatekeeper refused.
        if (Notification.isSupported()) {
          if (isVetoed) {
            new Notification({
              title: `⛔ Oportunidad P2P bloqueada por riesgo (+${netSpreadPct}%)`,
              body: verdict.vetoReason ?? 'Criterios de seguridad institucional no superados.',
            }).show();
          } else {
            const adHint = bestBuyOffer?.advNo ? ` · Ad #${bestBuyOffer.advNo}` : '';
            new Notification({
              title: `🚨 Oportunidad P2P Detectada (+${netSpreadPct}%)`,
              body: `Spread neto viable: Compra @ ${bestBuy} | Venta @ ${bestSell}${adHint}. Click para ver plan en Copiloto.`,
            }).show();
          }
        }
      }

      // 2. Proactive Macro Evaluation (BCV Window & Extreme Gap) — NOT EVALUATED.
      //
      // DECLARED ABSENCE. This watcher reads top-of-book Binance P2P prices and nothing else:
      // there is no BCV official rate and no USDT/USD spot feed wired into the Electron process,
      // so both legs below are unmeasured. `bestBuy` IS real (measured P2P bid), but pairing it
      // with `estimatedBcvRate = 65.5` produced a 34.35% "gap" at a live 88.00 bid — past the
      // engine's own 28% CRITICAL threshold — which persisted a "BRECHA CAMBIARIA CRÍTICA"
      // Engram observation and an OS notification telling the operator to cut fiat exposure.
      // That was one invented number away from being true, and entirely invented besides.
      //
      // `evaluateUsdtDepegEvent(1.0)` had the mirror problem: 1.0 is USDT's peg, so the depeg
      // monitor could never fire, yet it reported "checked" every cycle.
      //
      // Evaluating with an absent rate is not an option: `macro-skills.ts` coerces missing input
      // to 0 and the vendored `calculateBcvGap` answers a non-positive rate with
      // `gapPct: 0, zone: 'NORMAL'` — a measured "no gap". So neither call is made at all.
      // `recordDeclaredMeasurementAbsence` states the gap once so the operator can see it is
      // unmonitored rather than assume the watcher is watching it.
      this.recordDeclaredMeasurementAbsence();
    } catch (err: unknown) {
      this.consecutiveErrors += 1;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.lastErrorAt = Date.now();
      console.warn(`[AlphaWatcher] Scan error (#${this.consecutiveErrors}): ${this.lastError}`);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Audits a detected spread with the Risk Gatekeeper before it becomes a persisted plan.
   * Converts VES treasury aggregates to USDT using the observed live P2P rate before running
   * Rule 2 so volume and limit checks compare apples to apples in USDT.
   */
  private auditWithGatekeeper(
    plan: StrategyPlanRecord,
    grossSpreadPct: number,
    netSpreadPct: number,
    liveRateVesPerUsdt: number,
    commissionPct: number,
  ): RiskVerdict {
    const snapshot = getTreasurySnapshot();
    const treasuryContext: TreasuryRiskContext | null = snapshot
      ? {
          overLimitCount: snapshot.overLimitCount,
          nearLimitCount: snapshot.nearLimitCount,
          disabledCount: snapshot.disabledCount,
          saturatedCount: snapshot.saturatedCount,
          totalSpentTodayVes: snapshot.totalSpentTodayVes,
          totalDailyLimitVes: snapshot.totalDailyLimitVes,
        }
      : null;

    const proposal: StrategistProposal = {
      // `StrategyPlanRecord` carries every required field of `StrategyPlanCard`, so the very
      // record that would be persisted is the one being audited: no parallel, weaker copy.
      plan,
      rationale: plan.rationale,
      mathematicalValidation: {
        grossSpreadPct,
        estimatedFeesPct: commissionPct,
        netSpreadPct,
        meetsGoldenRule: netSpreadPct >= GOLDEN_RULE_MIN_NET_SPREAD_PCT,
      },
      recommendedTiming: 'Inmediato',
    };

    const hasLiveRate = Number.isFinite(liveRateVesPerUsdt) && liveRateVesPerUsdt > 0;
    const dailyVolumeProcessedUsdt =
      snapshot && hasLiveRate
        ? Number((snapshot.totalSpentTodayVes / liveRateVesPerUsdt).toFixed(2))
        : FALLBACK_DAILY_VOLUME_USDT;
    const dailyLimitUsdt =
      snapshot && hasLiveRate && snapshot.totalDailyLimitVes > 0
        ? Number((snapshot.totalDailyLimitVes / liveRateVesPerUsdt).toFixed(2))
        : FALLBACK_DAILY_LIMIT_USDT;

    return this.riskGatekeeper.evaluateProposal(proposal, {
      dailyVolumeProcessedUsdt,
      dailyLimitUsdt,
      treasurySnapshot: treasuryContext,
    });
  }

  /**
   * Persists the declared measurement absence, at most once per process.
   *
   * The watcher's BCV macro leg and USDT depeg leg are both unmonitored because no feed exists
   * in this process for either input. Silence would read as "checked and found nothing", so the
   * gap is stated explicitly, naming the two sources that would satisfy it. Written once, not
   * once per poll cycle, because `runScanCycle` runs every 30 seconds forever.
   */
  private measurementAbsenceRecorded = false;

  private recordDeclaredMeasurementAbsence(): void {
    if (this.measurementAbsenceRecorded) return;
    this.measurementAbsenceRecorded = true;

    this.db.saveEngramObservation({
      topicKey: 'alpha/declared-absence-bcv-spot',
      type: 'decision',
      scope: 'project',
      what:
        'Vigilancia macro del vigilante NO evaluada (N/D): la tasa oficial BCV y el precio spot USDT/USD no tienen fuente conectada en este proceso.',
      why:
        'La brecha cambiaria BCV/paralelo y el despeg de USDT requieren mediciones que este proceso no ' +
        'recibe. Se declara la ausencia en lugar de estimarlas: una brecha o una paridad inventadas ' +
        'producirían alertas de riesgo actuales sobre datos que nadie midió.',
      whereAffected: 'Mesa de operaciones / Libros P2P',
      learned:
        'Fuente requerida para la tasa oficial BCV: MCP get_bcv_rates (Cotizave API GET /v1/fx/rates, ' +
        'market reference→USD oficial). Fuente requerida para el spot USDT/USD: ticker público del ' +
        'exchange para el par USDTUSD (libro spot). La paridad 1.0 NO es un sustituto: es el valor ' +
        'del peg de USDT, así que el monitor de despeg contra él nunca puede dispararse. La brecha ' +
        'tampoco se deriva de un ancla aproximada.',
      confidenceScore: 0.99,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  /** Persists the refusal in Engram so a vetoed spread is auditable after the fact. */
  private recordVeto(plan: StrategyPlanRecord, verdict: RiskVerdict): void {
    const vetoReason =
      verdict.vetoReason ?? 'Criterios de seguridad institucional no superados.';

    console.warn(
      `[AlphaWatcher] Spread ${plan.expectedNetSpreadPct}% neto vetado por el Oficial de Riesgo (${verdict.riskScore}/100): ${vetoReason}`,
    );

    this.db.saveEngramObservation({
      topicKey: `alpha/veto-${plan.id}`,
      type: 'decision',
      scope: 'project',
      what: `Oportunidad alpha ${plan.id} (${plan.expectedNetSpreadPct}% neto) vetada antes de persistirse.`,
      why: vetoReason,
      whereAffected: plan.route,
      learned: `El oficial de riesgo bloqueó la propagación automática del spread (Score: ${verdict.riskScore}/100). El plan NO se guardó en SQLite ni se despachó a canales externos. Acción recomendada: ${verdict.recommendedAction}`,
      confidenceScore: 0.98,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  private async fetchBinanceSide(tradeType: 'BUY' | 'SELL'): Promise<BinanceOfferSummary[]> {
    const raw = await this.fetchBinanceP2p(
      {
        asset: this.config.asset,
        fiat: this.config.fiat,
        tradeType,
        payTypes: this.config.payTypes,
        rows: 10,
      },
      { signal: AbortSignal.timeout(12_000) },
    );

    if (!raw || typeof raw !== 'object') {
      throw new Error(`Invalid Binance P2P response for ${tradeType}`);
    }
    const payload = raw as { code?: unknown; data?: unknown; success?: unknown };
    if (
      !Array.isArray(payload.data) ||
      (payload.code !== undefined && payload.code !== null && String(payload.code) !== '000000') ||
      payload.success === false
    ) {
      throw new Error(
        `Binance P2P returned error payload for ${tradeType} (code=${String(payload.code ?? 'invalid')})`,
      );
    }

    const offers = parseBinanceP2pItems(raw);
    return this.filterQualifiedOffers(offers, tradeType);
  }

  /**
   * Filters low-reputation bait and price outliers against the book median, then sorts
   * best-first (`BUY` ascending ask price, `SELL` descending bid price).
   */
  private filterQualifiedOffers(
    offers: readonly BinanceOfferSummary[],
    tradeType: 'BUY' | 'SELL',
  ): BinanceOfferSummary[] {
    const hasAdvertiserTelemetry = offers.some((o) => o.orderCount > 0);
    let qualified = offers.filter((o) => {
      if (!Number.isFinite(o.price) || o.price <= 0) return false;
      if (o.finishRatePct < MIN_QUALIFIED_FINISH_RATE_PCT) return false;
      if (hasAdvertiserTelemetry && o.orderCount < MIN_QUALIFIED_ORDER_COUNT) return false;
      return true;
    });

    if (qualified.length >= 3) {
      const prices = qualified.map((o) => o.price).sort((a, b) => a - b);
      const median = prices[Math.floor(prices.length / 2)];
      if (median > 0) {
        const minValid = median * (1 - MAX_MEDIAN_DEVIATION_RATIO);
        const maxValid = median * (1 + MAX_MEDIAN_DEVIATION_RATIO);
        qualified = qualified.filter((o) => o.price >= minValid && o.price <= maxValid);
      }
    }

    return [...qualified].sort((a, b) =>
      tradeType === 'BUY' ? a.price - b.price : b.price - a.price,
    );
  }
}
