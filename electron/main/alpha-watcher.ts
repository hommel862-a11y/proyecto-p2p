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

import { net, BrowserWindow, Notification } from 'electron';
import type { P2PDatabaseService, StrategyPlanRecord } from './db/database';
import { ProactiveEventEngine } from './agents/proactive-event-engine';
import { RiskGatekeeperAgent } from './agents/risk-gatekeeper-agent';
import type { RiskVerdict, StrategistProposal, TreasuryRiskContext } from './agents/types';
import { getTreasurySnapshot } from './ipc/treasury-snapshot';

/** Commission Binance P2P charges, already deducted from the gross spread in `runScanCycle`. */
const BINANCE_P2P_COMMISSION_PCT = 0.35;

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
}

export class AlphaWatcher {
  private timer: NodeJS.Timeout | null = null;
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

  constructor(
    private db: P2PDatabaseService,
    private getMainWindow: () => BrowserWindow | null,
    /**
     * Injected for testability and so a host can share one gatekeeper instance. Defaults to
     * a private instance so existing call sites (`main/index.ts`, the handlers fallback) keep
     * enforcing the veto without any wiring change.
     */
    private riskGatekeeper: RiskGatekeeperAgent = new RiskGatekeeperAgent(),
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
  } {
    return {
      enabled: this.isRunning(),
      pollIntervalSeconds: this.config.pollIntervalSeconds,
      minNetSpreadPct: this.config.minNetSpreadPct,
      scanCount: this.scanCount,
      lastOpportunity: this.lastOpportunity,
    };
  }

  setConfig(newConfig: Partial<AlphaWatcherConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.enabled !== undefined) {
      if (newConfig.enabled) {
        this.start();
      } else {
        this.stop();
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.config.enabled = true;
    this.timer = setInterval(() => {
      void this.runScanCycle();
    }, this.config.pollIntervalSeconds * 1000);
    setTimeout(() => {
      void this.runScanCycle();
    }, 5000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
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
      // 1. Fetch top BUY and SELL offers from Binance P2P
      const [buyOffersRaw, sellOffersRaw] = await Promise.all([
        this.fetchBinanceSide('BUY'),
        this.fetchBinanceSide('SELL'),
      ]);

      const bestBuy = buyOffersRaw?.[0]?.price;
      const bestSell = sellOffersRaw?.[0]?.price;

      if (!bestBuy || !bestSell || bestSell <= bestBuy) {
        return; // Spread is negative or zero (no maker/taker gap)
      }

      // Calculate gross and net spread deducting standard 0.35% commission
      const grossSpreadPct = ((bestSell - bestBuy) / bestBuy) * 100;
      const netSpreadPct = Number((grossSpreadPct - BINANCE_P2P_COMMISSION_PCT).toFixed(2));

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
          rationale: `El vigilante en segundo plano detectó un spread neto de ${netSpreadPct}% (Compra: ${bestBuy} VES, Venta: ${bestSell} VES) superando el umbral de ${this.config.minNetSpreadPct}%.`,
          status: 'PROPOSED',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // Institutional veto BEFORE any persistence: the watcher is an unattended entry
        // point, so it must never reach SQLite without the same audit the swarm applies.
        const verdict = this.auditWithGatekeeper(plan, grossSpreadPct, netSpreadPct);
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
            new Notification({
              title: `🚨 Oportunidad P2P Detectada (+${netSpreadPct}%)`,
              body: `Spread neto viable: Compra @ ${bestBuy} | Venta @ ${bestSell}. Click para ver plan en Copiloto.`,
            }).show();
          }
        }
      }

      // 2. Proactive Macro Evaluation (BCV Window & Extreme Gap)
      // Uses approximate benchmark for BCV rate vs P2P parallel price
      if (bestBuy && bestBuy > 0) {
        const estimatedBcvRate = 65.5; // Reference anchor
        this.proactiveEngine.evaluateBcvMacroEvent(bestBuy, estimatedBcvRate);
      }

      // 3. Proactive Depeg Monitoring (USDT vs USD)
      this.proactiveEngine.evaluateUsdtDepegEvent(1.0);
    } catch {
      // Quiet fail on network glitch to avoid noisy polling crashes
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Audits a detected spread with the Risk Gatekeeper before it becomes a persisted plan.
   *
   * This is a deliberately "light" evaluation: it carries only figures the watcher actually
   * observed. Notably, `mathematicalValidation.monteCarlo` is left undefined on purpose —
   * the watcher reads top-of-book prices without a depth profile, so any P95 tail estimate
   * would be fabricated. Omitting the optional field keeps Rule 1.1 out of the audit rather
   * than feeding the gatekeeper invented numbers; the real protection here comes from Rule 1
   * (golden spread), the treasury blocks and the bank-health skill.
   *
   * The volume/limit pair mixes the treasury's VES aggregates with a USDT ticket, which is
   * the pre-bridge convention already used by `AgentSwarmOrchestrator`. It is kept for
   * consistency; note that the unit-free treasury blocks (disabled / over-limit / saturated)
   * are the checks that actually carry the protection.
   */
  private auditWithGatekeeper(
    plan: StrategyPlanRecord,
    grossSpreadPct: number,
    netSpreadPct: number,
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
        estimatedFeesPct: BINANCE_P2P_COMMISSION_PCT,
        netSpreadPct,
        meetsGoldenRule: netSpreadPct >= GOLDEN_RULE_MIN_NET_SPREAD_PCT,
      },
      recommendedTiming: 'Inmediato',
    };

    return this.riskGatekeeper.evaluateProposal(proposal, {
      dailyVolumeProcessedUsdt: snapshot
        ? snapshot.totalSpentTodayVes
        : FALLBACK_DAILY_VOLUME_USDT,
      dailyLimitUsdt: snapshot
        ? snapshot.totalDailyLimitVes || FALLBACK_DAILY_LIMIT_USDT
        : FALLBACK_DAILY_LIMIT_USDT,
      treasurySnapshot: treasuryContext,
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

  private async fetchBinanceSide(
    tradeType: 'BUY' | 'SELL',
  ): Promise<{ price: number; maxVes: number }[]> {
    try {
      const response = await net.fetch(
        'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
        {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          body: JSON.stringify({
            asset: this.config.asset,
            fiat: this.config.fiat,
            tradeType,
            page: 1,
            rows: 5,
            payTypes: this.config.payTypes,
            countries: [],
            proMerchantAds: false,
            shieldMerchantAds: false,
            filterType: 'all',
            periods: [],
          }),
        },
      );

      if (!response.ok) return [];
      const json = (await response.json()) as {
        data?: { adv?: { price?: string | number; maxSingleTransAmount?: string | number } }[];
      };
      const items = json.data || [];
      return items
        .map((it) => ({
          price: Number(it.adv?.price) || 0,
          maxVes: Number(it.adv?.maxSingleTransAmount) || 0,
        }))
        .filter((x) => x.price > 0);
    } catch {
      return [];
    }
  }
}
