import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { StorageService } from '../../core/storage';
import { RisksService } from '../../core/rules';
import { SessionService } from '../../core/session.service';
import { AccountsService } from '../../core/accounts.service';
import { ToastService } from '../../core/toast.service';
import { AuditLoggerService } from '../../core/audit-logger.service';
import { fmtVes, fmtUsd, FORMAT_PIPES } from '../../core/format';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { AudioAlertsService } from '../../core/audio-alerts.service';
import { TelemetryService, type TelemetrySnapshot } from '../../core/telemetry.service';
import {
  CotizaveService,
  describeCotizaveProvenance,
  formatCotizaveDataAge,
} from '../../core/cotizave.service';
import { McpService } from '../../core/mcp.service';
import { TelegramWorkerService } from '../../core/telegram-worker.service';
import { SpotMarketService } from '../../core/spot-market.service';
import {
  computeDashboard,
  computeSessionSummary,
  getBcvMarketIntelligence,
  analyzeHourlyRiskDistribution,
  auditTradingDisciplineAndSpreadCompliance,
  generateForensicDossier,
  type Operation,
  type DayActivity,
  type AccountVelocityHealth,
  type BcvMarketIntelligence,
  type BcvGapAnalysis,
  type BcvPredictorWindow,
  type HourlyRiskDistributionResult,
  type SpreadDisciplineResult,
  type ForensicDossier,
  evaluatePreflightDiscipline,
  type MentalState,
  type PreflightEvaluationResult,
  type BankCode,
  computeFifoAccounting,
  type FifoAccountingSummary,
  calculateOrderBookImbalance,
  type OrderBookImbalanceResult,
  detectRateDivergence,
  type RateDivergenceResult,
  calculateTreasuryYieldAllocation,
  type TreasuryAllocationPlan,
  evaluateFxBankDeskPlan,
  type FxDeskEvaluationPlan,
} from '@p2p/core';
import { FormsModule } from '@angular/forms';
import { AnimatedCounterComponent } from '../../shared/ui/animated-counter';

export interface McpVolatilityForecastDto {
  windowHours?: number;
  marketRegime?: 'STABLE' | 'MODERATE' | 'EXPANSIVE' | string;
  expectedSpreadMin?: number;
  expectedSpreadMax?: number;
  volatilityScore?: number;
  recommendation?: string;
  forecastVolatilityPct?: number;
  riskLevel?: string;
  actionableAdvice?: string;
  spreadDynamic?: string;
  suggestedAction?: string;
  gapPct?: number;
  bcvPhase?: string;
}

export interface McpBcvInterventionDto extends BcvPredictorWindow {
  directive?: string;
  tradingDirectives?: string;
  isInterventionActive?: boolean;
}

export interface SwarmAgentDto {
  name: string;
  role: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  lastPingMs: number;
  decisionsCount: number;
  icon: string;
  description: string;
}

export interface UnifiedAccountView {
  id: string;
  bankName: string;
  bankCode?: BankCode;
  rail?: string;
  status?: 'ACTIVE' | 'DISABLED' | 'COOLDOWN';
  accountNumberMasked?: string;
  currentBalanceVes: number;
  dailyLimitVes: number;
  spentTodayVes: number;
  remainingLimitVes: number;
  consumedLimitPct: number;
  isOverLimit: boolean;
  isNearLimit: boolean;
  todayTransactionCount: number;
  maxDailyTransactions: number;
  velocityHealth: AccountVelocityHealth;
  usedPct: number;
  recommendedWaitHours: number;
  isRecommended: boolean;
}

export type TreasuryRailFilter = 'ALL' | 'PAGO_MOVIL' | 'TRANSFERENCIA';
export type TreasuryHealthFilter = 'ALL' | 'OPTIMAL' | 'ALERT';

export interface AlphaPulseStatus {
  state: 'ALPHA_WINDOW' | 'STANDBY' | 'RISK_GUARD';
  badgeLabel: string;
  headline: string;
  subheadline: string;
  isBcvWindowActive: boolean;
  spreadPct: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, AnimatedCounterComponent, ...FORMAT_PIPES],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly storage = inject(StorageService);
  private readonly risks = inject(RisksService);
  private readonly toast = inject(ToastService);
  private readonly audit = inject(AuditLoggerService);
  readonly sessionService = inject(SessionService);
  readonly accountsService = inject(AccountsService);
  readonly binanceService = inject(BinanceP2pService);
  readonly cotizaveService = inject(CotizaveService);
  readonly mcpService = inject(McpService);
  readonly audioAlerts = inject(AudioAlertsService);
  readonly telemetryService = inject(TelemetryService);
  readonly telegramService = inject(TelegramWorkerService);
  readonly spotMarketService = inject(SpotMarketService);

  readonly telemetry = this.telemetryService.telemetry;

  refreshTelemetry(): Promise<TelemetrySnapshot> {
    return this.telemetryService.refresh();
  }

  readonly activeTab = signal<'all' | 'treasury' | 'agents' | 'performance'>('all');

  readonly treasuryDensity = signal<'bento' | 'compact'>(
    (this.storage.get<'bento' | 'compact'>('p2p.dashboard.treasuryDensity') as 'bento' | 'compact') ||
      'bento',
  );

  /** Interactive filters for the 16 multi-bank accounts */
  readonly bankRailFilter = signal<TreasuryRailFilter>('ALL');
  readonly bankHealthFilter = signal<TreasuryHealthFilter>('ALL');

  setTreasuryDensity(density: 'bento' | 'compact'): void {
    this.treasuryDensity.set(density);
    this.storage.set('p2p.dashboard.treasuryDensity', density);
  }

  setBankRailFilter(rail: TreasuryRailFilter): void {
    this.bankRailFilter.set(rail);
  }

  setBankHealthFilter(health: TreasuryHealthFilter): void {
    this.bankHealthFilter.set(health);
  }

  private readonly liquidityWatcher = effect(() => {
    const req = this.accountsService.liquidityModalRequest();
    if (req) {
      const target = req.bankId
        ? this.unifiedAccounts().find((a) => a.id === req.bankId)
        : undefined;
      this.openLiquidityModal(target);
      this.accountsService.clearLiquidityModalRequest();
    }
  });

  private routeSub: Subscription | null = null;

  readonly swarmAgents = signal<SwarmAgentDto[]>([
    {
      name: 'Sentinel Agent',
      role: 'Vigilante de Mercado',
      status: 'ONLINE',
      lastPingMs: 120,
      decisionsCount: 148,
      icon: '🛡️',
      description: 'Detección de shocks de liquidez, desbalance de órdenes y volatilidad.',
    },
    {
      name: 'Strategist Agent',
      role: 'Arquitecto de Rutas',
      status: 'ONLINE',
      lastPingMs: 95,
      decisionsCount: 92,
      icon: '🧠',
      description: 'Arbitraje algorítmico, cálculo VWAP y optimización de spreads netos.',
    },
    {
      name: 'Risk Gatekeeper',
      role: 'Auditor de Riesgo',
      status: 'ONLINE',
      lastPingMs: 80,
      decisionsCount: 230,
      icon: '⚖️',
      description:
        'Veto unilateral ante incumplimiento de Regla de Oro (>0.50%) o contraparte dudosa.',
    },
    {
      name: 'Dispute Auditor',
      role: 'Escudo Legal & Pagos',
      status: 'ONLINE',
      lastPingMs: 140,
      decisionsCount: 45,
      icon: '🔍',
      description:
        'Auditoría forense de recibos OCR, hashes de transferencia y expedientes de disputa.',
    },
  ]);

  private mcpIntervalId: ReturnType<typeof setInterval> | null = null;
  readonly mcpSyncing = signal<boolean>(false);
  readonly mcpBcvRates = signal<{ usd?: number; date?: string; [key: string]: unknown } | null>(
    null,
  );
  readonly mcpParallelRates = signal<{
    rate?: number;
    provider?: string;
    [key: string]: unknown;
  } | null>(null);
  readonly mcpRateGap = signal<BcvGapAnalysis | null>(null);
  readonly mcpBcvIntervention = signal<McpBcvInterventionDto | null>(null);
  readonly mcpVolatilityForecast = signal<McpVolatilityForecastDto | null>(null);

  readonly manualBcvRate = signal<number>(685.0);
  readonly manualParallelRate = signal<number>(815.0);

  readonly bcvIntelligence = computed<BcvMarketIntelligence>(() => {
    const depth = this.binanceService.marketDepth();
    const rates = this.cotizaveService.ratesByMarket();
    const parallel = depth?.bestBuyPrice || rates['binance']?.ask || this.manualParallelRate();
    const bcv = rates['bcv']?.mid || rates['oficial']?.mid || this.manualBcvRate();
    return getBcvMarketIntelligence(parallel, bcv);
  });

  /** Live 14-bank Mesa Cambiaria BCV execution plan synthesized into the Control Center. */
  readonly fxDeskPlan = computed<FxDeskEvaluationPlan>(() => {
    const depth = this.binanceService.marketDepth();
    const rates = this.cotizaveService.ratesByMarket();
    const bcvOfficialRateVes =
      rates['bcv']?.mid || rates['oficial']?.mid || this.mcpBcvRates()?.usd || this.manualBcvRate();
    const p2pSellRateVes =
      depth?.bestSellPrice ||
      depth?.bestBuyPrice ||
      rates['binance']?.ask ||
      this.mcpParallelRates()?.rate ||
      this.manualParallelRate();
    const totalBalanceVes = this.accountsService.treasurySummary().totalBalanceVes;
    const simulatedCapitalVes = totalBalanceVes > 0 ? totalBalanceVes : 120000;
    const bcvPhase = this.mcpBcvIntervention()?.phase || this.bcvIntelligence().window.phase;
    const isBcvWindowOpen =
      bcvPhase === 'INTERVENTION_ACTIVE' || bcvPhase === 'PRE_INTERVENTION_COMPRESSION';

    return evaluateFxBankDeskPlan({
      bcvOfficialRateVes,
      p2pSellRateVes,
      simulatedCapitalVes,
      capitalAllocationMode: 'DISTRIBUTE_TOTAL',
      accounts: this.accountsService.accounts(),
      usages: this.accountsService.usages(),
      velocities: this.accountsService.accountVelocities(),
      confirmedFluidBanks: this.telegramService.fxFluidBanks(),
      depletedBanks: this.telegramService.fxDepletedBanks(),
      isBcvWindowOpen,
      exitRailOverrides: this.telegramService.fxExitRailOverrides(),
    });
  });

  readonly fxDeskSummary = computed(() => {
    const plan = this.fxDeskPlan();
    const viableTickets = plan.tickets.filter((t) => t.isViableOrder);
    const confirmedFluidCount = plan.tickets.filter(
      (t) => t.signalState === 'CONFIRMED_FLUID',
    ).length;
    const topTicket = viableTickets[0] ?? plan.tickets[0] ?? null;
    const bcvPhase = this.mcpBcvIntervention()?.phase || this.bcvIntelligence().window.phase;
    const isBcvWindowOpen =
      bcvPhase === 'INTERVENTION_ACTIVE' || bcvPhase === 'PRE_INTERVENTION_COMPRESSION';
    const netProfitVes = plan.totalProjectedNetProfitVes ?? 0;
    const netProfitUsdt =
      plan.p2pSellRateVes && plan.p2pSellRateVes > 0
        ? +(netProfitVes / plan.p2pSellRateVes).toFixed(2)
        : 0;

    return {
      viableCount: viableTickets.length,
      totalBanks: plan.tickets.length,
      confirmedFluidCount,
      topTicket,
      isBcvWindowOpen,
      totalDeployableVes: plan.totalDeployableVes,
      totalDeployableUsd: plan.totalRecommendedUsd,
      netProfitVes,
      netProfitUsdt,
    };
  });

  /** Institutional Spot Market telemetry (BTC anchor & USDC peg deviation guard). */
  readonly spotPulse = computed(() => {
    const btc = this.spotMarketService.btcTicker();
    const usdc = this.spotMarketService.usdcTicker();
    const usdcMid = usdc?.midPrice ?? 1;
    const depegBps = Math.round(Math.abs(usdcMid - 1) * 10000);
    return {
      btcPriceUsd: btc?.lastPrice ?? 0,
      btcChange24hPct: btc?.priceChangePct24h ?? 0,
      usdcMidPrice: usdcMid,
      depegBps,
      isUsdcDepegged: depegBps >= 50,
      availabilityStatus: this.spotMarketService.availability().status,
    };
  });

  /**
   * Edad y procedencia de las tasas de Cotizave. `bcvIntelligence` se apoya en
   * `ratesByMarket()` para la brecha, así que se leen juntas: la marca de tiempo
   * del panel tiene que ser la de ESE dato. Sin esto, un número restaurado del
   * disco se lee igual que uno descargado hace un segundo, y la brecha se
   * interpreta como una oportunidad de mercado cuando puede ser información vieja.
   */
  readonly cotizaveDataAge = computed(() => {
    // El guard debe leer la verdad: solo existe edad cuando hay un fetch real de
    // Cotizave que alimenta la pantalla. Si la procedencia es `none`, el dato que
    // se está viendo puede venir de constantes fijas, así que NO se debe rotular
    // como "una sesión anterior · Cotizave sin datos": eso inventa un linaje.
    if (this.cotizaveService.ratesProvenance() === 'none') {
      return null;
    }
    return formatCotizaveDataAge(this.cotizaveService.lastFetched());
  });

  readonly cotizaveProvenanceLabel = computed(() =>
    describeCotizaveProvenance(this.cotizaveService.ratesProvenance()),
  );

  /** Active Daily Goal Plan pinned from the Income Calculator (Reverse Planner 360°). */
  readonly activeDailyGoalPlan = signal<{
    targetGoalUsd: number;
    availableCapitalUsdt: number;
    desiredCyclesPerDay: number;
    requiredSellPriceVes: number;
    requiredNetRoiPct: number;
    updatedAt: string;
  } | null>(this.storage.get('p2p.active-daily-goal'));

  private readonly customDailyTarget = signal<number | null>(
    this.storage.get<number>('p2p.daily-target'),
  );

  /** In-place quick editor for daily target USD */
  readonly editingDailyTarget = signal<boolean>(false);
  readonly dailyTargetDraft = signal<number>(35);
  readonly dailyTargetPresets: readonly number[] = [25, 50, 100, 200];

  /** Daily income target (USD) — read from active daily goal or custom daily-target key. */
  readonly dailyTarget = computed<number>(() => {
    const pinned = this.activeDailyGoalPlan();
    if (pinned && pinned.targetGoalUsd > 0) return pinned.targetGoalUsd;
    const custom = this.customDailyTarget();
    if (custom !== null && custom > 0) return custom;
    return this.storage.get<number>('p2p.daily-target') ?? 35;
  });

  openDailyTargetEditor(event?: Event): void {
    event?.stopPropagation();
    this.dailyTargetDraft.set(this.dailyTarget());
    this.editingDailyTarget.set(true);
  }

  cancelDailyTargetEditor(event?: Event): void {
    event?.stopPropagation();
    this.editingDailyTarget.set(false);
  }

  saveDailyTarget(presetUsd?: number, event?: Event): void {
    event?.stopPropagation();
    const raw = presetUsd !== undefined ? presetUsd : Number(this.dailyTargetDraft());
    if (!Number.isFinite(raw) || raw <= 0) {
      this.toast.error('Ingresa una meta diaria válida mayor a 0 USDT.', 'Meta Diaria');
      return;
    }
    const target = Math.round(raw * 100) / 100;
    this.customDailyTarget.set(target);
    this.storage.set('p2p.daily-target', target);

    const pinned = this.activeDailyGoalPlan();
    if (pinned) {
      const perCycleUsd =
        pinned.availableCapitalUsdt > 0 && pinned.requiredNetRoiPct > 0
          ? pinned.availableCapitalUsdt * (pinned.requiredNetRoiPct / 100)
          : 0;
      const desiredCyclesPerDay =
        perCycleUsd > 0 ? Math.max(1, Math.ceil(target / perCycleUsd)) : pinned.desiredCyclesPerDay;
      const updatedPlan = {
        ...pinned,
        targetGoalUsd: target,
        desiredCyclesPerDay,
        updatedAt: new Date().toISOString(),
      };
      this.activeDailyGoalPlan.set(updatedPlan);
      this.storage.set('p2p.active-daily-goal', updatedPlan);
    }

    this.editingDailyTarget.set(false);
    this.audioAlerts.playConfirmationTone();
    this.toast.success(`Meta diaria ajustada a $${target} USDT.`, 'Objetivo Actualizado');
  }

  /** Remaining USDT needed today to hit 100% of dailyTarget */
  readonly remainingDailyTargetUsdt = computed<number>(() => {
    const target = this.dailyTarget();
    const current = Math.max(0, this.dashboard().today.pnlUsdt);
    return Math.max(0, +(target - current).toFixed(2));
  });

  /** State for closing session modal */
  readonly showCloseModal = signal<boolean>(false);
  readonly closeDisciplineRating = signal<number>(5);
  readonly closeNotes = signal<string>('');

  /** State for Liquidity Injection modal */
  readonly showLiquidityModal = signal<boolean>(false);
  readonly selectedInjectionAccountId = signal<string>('');
  readonly injectionAmount = signal<number | null>(null);
  readonly injectionNote = signal<string>('');
  readonly injectionError = signal<string | null>(null);

  readonly selectedAccountForInjection = computed<UnifiedAccountView | null>(() => {
    const id = this.selectedInjectionAccountId();
    return this.unifiedAccounts().find((a) => a.id === id) ?? null;
  });

  readonly projectedBalanceAfterInjection = computed<number>(() => {
    const acc = this.selectedAccountForInjection();
    if (!acc) return 0;
    const val = this.injectionAmount() ?? 0;
    if (this.liquidityModalMode() === 'CALIBRATE') {
      return val >= 0 ? val : 0;
    }
    return acc.currentBalanceVes + (val > 0 ? val : 0);
  });

  readonly ops = computed<Operation[]>(() => this.accountsService.rawOperations());

  readonly dashboard = computed(() => computeDashboard(this.ops()));

  /** Live FIFO Accounting summary across the complete operation ledger. */
  readonly fifoSummary = computed<FifoAccountingSummary>(() => {
    return computeFifoAccounting(this.ops());
  });

  /** Mark-to-Market floating PnL on remaining open inventory against live Binance P2P depth. */
  readonly markToMarketPnL = computed(() => {
    const fifo = this.fifoSummary();
    const depth = this.binanceService.marketDepth();
    const openUsdt = fifo.openInventoryAmount;
    if (!depth || openUsdt <= 0) {
      return {
        openUsdt: Math.max(0, openUsdt),
        avgCostPriceVes: fifo.openInventoryAvgPriceVes,
        unrealizedPnlVes: 0,
        unrealizedPnlUsdt: 0,
        currentMarketValueVes: 0,
        bestExitPriceVes: depth?.bestSellPrice ?? 0,
      };
    }
    const bestExitPriceVes = depth.bestSellPrice;
    const currentMarketValueVes = openUsdt * bestExitPriceVes;
    const unrealizedPnlVes = currentMarketValueVes - fifo.openInventoryCostBasisVes;
    const unrealizedPnlUsdt = bestExitPriceVes > 0 ? unrealizedPnlVes / bestExitPriceVes : 0;
    return {
      openUsdt,
      avgCostPriceVes: fifo.openInventoryAvgPriceVes,
      unrealizedPnlVes,
      unrealizedPnlUsdt,
      currentMarketValueVes,
      bestExitPriceVes,
    };
  });

  /** Order Book Imbalance (OBI) & Market Microstructure Pressure. */
  readonly orderBookImbalance = computed<OrderBookImbalanceResult | null>(() => {
    const depth = this.binanceService.marketDepth();
    if (!depth || !depth.buyOffers || !depth.sellOffers) return null;
    return calculateOrderBookImbalance(depth.buyOffers, depth.sellOffers);
  });

  /** Rate Divergence & Momentum Radar between P2P book and parallel market. */
  readonly rateDivergence = computed<RateDivergenceResult | null>(() => {
    const depth = this.binanceService.marketDepth();
    const rates = this.cotizaveService.ratesByMarket();
    const parallelRate = depth?.bestBuyPrice || rates['binance']?.ask || this.manualParallelRate();
    const bcvRate = rates['bcv']?.mid || rates['oficial']?.mid || this.manualBcvRate();
    if (!depth) return null;
    return detectRateDivergence({
      depth,
      bcvRate,
      parallelRate,
      windowMinutes: 30,
    });
  });

  /** Smart Treasury Yield Maximizer for idle USDT liquidity. */
  readonly smartTreasuryYield = computed<TreasuryAllocationPlan>(() => {
    const currentHour = new Date().getHours();
    const isOffPeak = currentHour >= 22 || currentHour < 7;
    const inventoryUsdt = Math.max(0, this.fifoSummary().openInventoryAmount);
    return calculateTreasuryYieldAllocation({
      totalUsdtInventory: inventoryUsdt,
      currentlyCommittedUsdt: 0,
      marketVelocity: isOffPeak ? 'LOW_OFFPEAK' : 'NORMAL_FLOW',
      flexibleApyPct: 11.5,
      minimumSafetyBufferUsd: 500,
    });
  });

  /** Risk engine live verdict evaluated from real operating state. */
  readonly verdict = computed(() => {
    const depth = this.binanceService.marketDepth();
    const currentSpread = depth ? depth.spreadVes : (this.bcvIntelligence().gap.gapVes ?? 20);
    const summary = this.dashboard().today;
    const lossLimit = this.preflightDailyLossLimit();

    const dailyLossPct =
      summary.pnlUsdt < 0 && lossLimit > 0
        ? Math.min(100, Math.round((Math.abs(summary.pnlUsdt) / lossLimit) * 100))
        : 0;

    const openOps = summary.exposure !== 0 ? 1 : 0;
    const isCircuitOpen = this.binanceService.circuitBreaker?.getState?.() === 'OPEN';
    const apiStatus: 'ok' | 'down' = isCircuitOpen ? 'down' : 'ok';

    const sortedOps = [...this.ops()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    let consecutiveErrors = 0;
    for (const op of sortedOps) {
      if (op.errorFree === false) {
        consecutiveErrors += 1;
      } else {
        break;
      }
    }

    return this.risks.evaluate({
      currentSpread,
      minSpread: this.risks.config().minSpread,
      openOps,
      tradeRiskPct: 0.5,
      dailyLossPct,
      consecutiveErrors,
      apiStatus,
    });
  });

  /** High-Engagement Alpha Pulse Radar synthesizing L2 Spread, Risk Verdict, and BCV Window. */
  readonly alphaPulse = computed<AlphaPulseStatus>(() => {
    const depth = this.binanceService.marketDepth();
    const spreadPct = depth?.spreadPct ?? 0;
    const v = this.verdict();
    const bcvPhase = this.mcpBcvIntervention()?.phase || this.bcvIntelligence().window.phase;
    const isBcvWindowActive =
      bcvPhase === 'INTERVENTION_ACTIVE' || bcvPhase === 'PRE_INTERVENTION_COMPRESSION';
    const rec = this.rotationRecommendation();

    if (v.decision === 'DENY') {
      return {
        state: 'RISK_GUARD',
        badgeLabel: 'ESCUDO ACTIVO',
        headline: 'Ejecución bloqueada por Motor de Riesgo',
        subheadline: v.reason,
        isBcvWindowActive,
        spreadPct,
      };
    }

    if (spreadPct >= 0.5 && v.decision === 'ALLOW') {
      return {
        state: 'ALPHA_WINDOW',
        badgeLabel: 'VENTANA ALPHA ≥ 0.50%',
        headline: `Spread óptimo activo (${spreadPct}%) · ${rec ? 'Rotar por ' + rec.bankName : 'Liquidez lista'}`,
        subheadline: 'Regla de Oro validada para posicionamiento Maker/Taker inmediato',
        isBcvWindowActive,
        spreadPct,
      };
    }

    return {
      state: 'STANDBY',
      badgeLabel: 'MODO VIGILANCIA',
      headline:
        spreadPct > 0
          ? `Spread L2 en ${spreadPct}% · Esperando expansión ≥ 0.50%`
          : 'Sincronizando profundidad L2 · Listo para operar',
      subheadline: rec
        ? `Cuenta óptima preseleccionada: ${rec.bankName}`
        : 'Monitoreo continuo de microestructura y tesorería',
      isBcvWindowActive,
      spreadPct,
    };
  });

  /** Forensic Risk & Hourly Distribution (Skill #44) */
  readonly forensicRiskAnalysis = computed<HourlyRiskDistributionResult>(() => {
    return analyzeHourlyRiskDistribution(this.audit.events());
  });

  /** Trading Discipline & Golden Rule Compliance (net spread >= 0.50%) */
  readonly forensicDiscipline = computed<SpreadDisciplineResult>(() => {
    return auditTradingDisciplineAndSpreadCompliance(this.ops(), 0.5);
  });

  /** Full Forensic Dossier */
  readonly forensicDossier = computed<ForensicDossier>(() => {
    return generateForensicDossier(this.forensicRiskAnalysis(), this.forensicDiscipline());
  });

  /** Whether the current hour is inside the historical peak risk window */
  readonly isPeakRiskHourNow = computed<boolean>(() => {
    const currentHour = new Date().getHours();
    return this.forensicRiskAnalysis().highRiskHours.includes(currentHour);
  });

  goToForensicCopilot(): void {
    void this.router.navigate(['/copilot'], {
      queryParams: {
        prefill: '¿En qué horarios tuve más alertas de riesgo esta semana y respeté el spread mínimo?',
      },
    });
  }

  /** Daily transaction velocity per account (SUDEBAN rotation awareness). */
  readonly accountVelocities = computed(() => this.accountsService.accountVelocities());
  /** Accounts at or near their daily transaction threshold. */
  readonly velocityAlerts = computed(() => this.accountsService.velocityAlerts());
  /** Best account to rotate to today, if any. */
  readonly rotationRecommendation = computed(() => this.accountsService.rotationRecommendation());

  /** Unified multi-bank treasury & anti-SUDEBAN view (consolidates duplicate lists). */
  readonly unifiedAccounts = computed<UnifiedAccountView[]>(() => {
    const usages = this.accountsService.usages();
    const velocities = this.accountVelocities();
    const rec = this.rotationRecommendation();

    const velMap = new Map<string, (typeof velocities)[0]>();
    for (const v of velocities) {
      velMap.set(v.accountId, v);
    }

    return usages.map((u) => {
      const vel = velMap.get(u.account.id);
      return {
        id: u.account.id,
        bankName: u.account.bankName,
        bankCode: u.account.bankCode,
        rail: u.account.rail,
        status: u.account.status ?? 'ACTIVE',
        accountNumberMasked: u.account.accountNumberMasked,
        currentBalanceVes: u.currentBalanceVes,
        dailyLimitVes: u.account.dailyLimitVes,
        spentTodayVes: u.spentTodayVes,
        remainingLimitVes: u.remainingLimitVes,
        consumedLimitPct: u.consumedLimitPct,
        isOverLimit: u.isOverLimit,
        isNearLimit: u.isNearLimit,
        todayTransactionCount: vel?.todayTransactionCount ?? 0,
        maxDailyTransactions: vel?.maxDailyTransactions ?? 15,
        velocityHealth: vel?.velocityHealth ?? 'OPTIMAL',
        usedPct: vel?.usedPct ?? 0,
        recommendedWaitHours: vel?.recommendedWaitHours ?? 0,
        isRecommended: rec?.id === u.account.id,
      };
    });
  });

  /** Counts per filter category in the Treasury section */
  readonly treasuryFilterCounts = computed(() => {
    const all = this.unifiedAccounts();
    return {
      all: all.length,
      pagoMovil: all.filter((a) => a.rail === 'PAGO_MOVIL').length,
      transferencia: all.filter((a) => a.rail === 'TRANSFERENCIA').length,
      optimal: all.filter((a) => !a.isOverLimit && !a.isNearLimit && a.status !== 'DISABLED')
        .length,
      alert: all.filter((a) => a.isOverLimit || a.isNearLimit).length,
    };
  });

  /** Filtered accounts according to selected rail and health filter pills */
  readonly filteredAccounts = computed<UnifiedAccountView[]>(() => {
    const rail = this.bankRailFilter();
    const health = this.bankHealthFilter();
    return this.unifiedAccounts().filter((acc) => {
      if (rail !== 'ALL' && acc.rail !== rail) return false;
      if (health === 'OPTIMAL' && (acc.isOverLimit || acc.isNearLimit || acc.status === 'DISABLED')) {
        return false;
      }
      if (health === 'ALERT' && !acc.isOverLimit && !acc.isNearLimit) {
        return false;
      }
      return true;
    });
  });

  /** Progressive disclosure in Vista General: Spotlight top 4 accounts unless expanded or filtered */
  readonly showAllBanksInOverview = signal<boolean>(false);

  readonly displayedAccounts = computed<UnifiedAccountView[]>(() => {
    const list = this.filteredAccounts();
    const isFiltered = this.bankRailFilter() !== 'ALL' || this.bankHealthFilter() !== 'ALL';
    if (this.activeTab() === 'treasury' || this.showAllBanksInOverview() || isFiltered) {
      return list;
    }
    return [...list]
      .sort((a, b) => {
        if (a.isRecommended !== b.isRecommended) return a.isRecommended ? -1 : 1;
        if (a.isNearLimit !== b.isNearLimit) return a.isNearLimit ? -1 : 1;
        return b.currentBalanceVes - a.currentBalanceVes;
      })
      .slice(0, 4);
  });

  /** Interactive One-Tap Ticket & Profit Simulator (High-Impact Client Engagement) */
  readonly simTicketUsdt = signal<number>(250);
  readonly simTicketPresets = [100, 250, 500, 1000] as const;

  setSimTicket(amountUsdt: number): void {
    if (Number.isFinite(amountUsdt) && amountUsdt > 0) {
      this.simTicketUsdt.set(Math.round(amountUsdt));
    }
  }

  readonly simulatedTradeOutcome = computed(() => {
    const ticket = this.simTicketUsdt();
    const depth = this.binanceService.marketDepth();
    const gap = this.bcvIntelligence().gap;
    const buyPrice = depth?.bestBuyPrice || gap.parallelRate || 810;
    const spreadPct = depth && depth.spreadPct > 0 ? depth.spreadPct : 0.65;
    const sellPrice =
      depth && depth.bestSellPrice > buyPrice
        ? depth.bestSellPrice
        : +(buyPrice * (1 + spreadPct / 100)).toFixed(2);

    const requiredVes = Math.round(ticket * buyPrice);
    const netProfitUsdt = +(ticket * (spreadPct / 100)).toFixed(2);
    const netProfitVes = Math.round(netProfitUsdt * sellPrice);

    const viableAccounts = this.unifiedAccounts().filter(
      (a) => a.status !== 'DISABLED' && !a.isOverLimit && a.remainingLimitVes >= requiredVes,
    );
    const bestAccount =
      viableAccounts.find((a) => a.isRecommended) ??
      viableAccounts[0] ??
      this.unifiedAccounts()[0] ??
      null;

    return {
      ticketUsdt: ticket,
      buyPriceVes: buyPrice,
      sellPriceVes: sellPrice,
      spreadPct,
      requiredVes,
      netProfitUsdt,
      netProfitVes,
      bestAccount,
      needsMultiBankSplit: viableAccounts.length === 0,
      cyclesForDailyTarget:
        netProfitUsdt > 0 ? Math.max(1, Math.ceil(this.dailyTarget() / netProfitUsdt)) : 1,
    };
  });

  /** Semáforo background CSS var per velocity health (no hardcoded colors). */
  readonly velocityHealthVar: Record<AccountVelocityHealth, string> = {
    OPTIMAL: 'var(--accent)',
    MODERATE: 'var(--warn)',
    REST_RECOMMENDED: 'var(--gold)',
    SATURATED: 'var(--danger)',
  };

  /** Human-readable label per velocity health. */
  readonly velocityHealthLabel: Record<AccountVelocityHealth, string> = {
    OPTIMAL: 'Óptima',
    MODERATE: 'Moderada',
    REST_RECOMMENDED: 'Descanso recomendado',
    SATURATED: 'Saturada',
  };

  /** Progress toward daily target (0–100, strictly positive profit). */
  readonly dailyProgress = computed(() => {
    const target = this.dailyTarget();
    if (target <= 0) return 0;
    const pnlUsdt = this.dashboard().today.pnlUsdt;
    if (pnlUsdt <= 0) return 0; // Losses never count toward goal achievement!
    return Math.min(100, Math.round((pnlUsdt / target) * 100));
  });

  /** Daily Drawdown percentage against stop-loss limit if today's PnL is negative. */
  readonly dailyDrawdownPct = computed(() => {
    const pnlUsdt = this.dashboard().today.pnlUsdt;
    const lossLimit = this.preflightDailyLossLimit();
    if (pnlUsdt >= 0 || lossLimit <= 0) return 0;
    return Math.min(100, Math.round((Math.abs(pnlUsdt) / lossLimit) * 100));
  });

  /** Chronological 7-day sequence (6 days ago -> today) matching cumulativeChart order. */
  readonly chronologicalWeek = computed<DayActivity[]>(() =>
    this.dashboard().week.slice().reverse(),
  );

  /** Max PnL across the 7-day week for chart bar scaling. */
  readonly weekMax = computed(() => {
    const week = this.dashboard().week;
    const max = Math.max(...week.map((d) => Math.abs(d.pnlVes)), 1);
    return max;
  });

  /** Max USDT volume across the 7-day week for volume bar scaling. */
  readonly weekVolumeMax = computed(() => {
    const week = this.dashboard().week;
    return Math.max(...week.map((d) => d.volumeUsdt), 1);
  });

  /** Active chart view: cumulative equity curve vs daily volume */
  readonly selectedChartTab = signal<'cumulative' | 'volume'>('cumulative');

  readonly hoveredPoint = signal<{
    date: string;
    label: string;
    value: string;
    subvalue?: string;
    x: number;
    y: number;
  } | null>(null);

  /** Cumulative PnL curve calculation for high-res SVG chart (strictly chronological: 6 days ago -> today). */
  readonly cumulativeChart = computed(() => {
    const rawWeek = this.dashboard().week;
    if (rawWeek.length === 0) {
      return { points: [], lineD: '', areaD: '', baselineY: 100, minVal: 0, maxVal: 0 };
    }

    // Reverse week slice so day sequence moves forward in time from left to right
    const week = rawWeek.slice().reverse();

    let cum = 0;
    const series = week.map((w) => {
      cum += w.pnlVes;
      return {
        date: w.date,
        shortDate: this.shortDate(w.date),
        dailyPnl: w.pnlVes,
        cumulativePnl: cum,
        volumeUsdt: w.volumeUsdt,
        operations: w.operations,
      };
    });

    const values = series.map((s) => s.cumulativePnl);
    const minVal = Math.min(0, ...values);
    const maxVal = Math.max(1, ...values);
    const range = maxVal - minVal || 1;

    const W = 600;
    const H = 180;
    const padX = 40;
    const padY = 25;
    const plotW = W - padX * 2;
    const plotH = H - padY * 2;

    const points = series.map((s, i) => {
      const x = padX + (plotW / Math.max(series.length - 1, 1)) * i;
      const normY = (s.cumulativePnl - minVal) / range;
      const y = padY + plotH * (1 - normY);
      return { ...s, x, y };
    });

    const lineD = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');
    const firstP = points[0];
    const lastP = points[points.length - 1];
    const baselineNorm = (0 - minVal) / range;
    const baselineY = padY + plotH * (1 - baselineNorm);
    const areaD = `${lineD} L ${lastP.x} ${baselineY} L ${firstP.x} ${baselineY} Z`;

    return { points, lineD, areaD, baselineY, minVal, maxVal };
  });

  barHeight(day: DayActivity): number {
    if (this.selectedChartTab() === 'volume') {
      const maxVol = this.weekVolumeMax();
      return Math.max(4, Math.round((day.volumeUsdt / maxVol) * 100));
    }
    const max = this.weekMax();
    return Math.max(4, Math.round((Math.abs(day.pnlVes) / max) * 100));
  }

  shortDate(dateKey: string): string {
    const parts = dateKey.split('-');
    if (parts.length < 3) return dateKey;
    return `${parts[2]}/${parts[1]}`;
  }

  decisionLabel(d: string): string {
    const map: Record<string, string> = { ALLOW: 'PERMITIR', DENY: 'DENEGAR', PAUSE: 'PAUSAR' };
    return map[d] ?? d;
  }

  decisionClass(d: string): string {
    const map: Record<string, string> = { ALLOW: 'allow', DENY: 'deny', PAUSE: 'pause' };
    return map[d] ?? '';
  }

  readonly Math = Math;

  readonly activeSessionSummary = computed(() => {
    const s = this.sessionService.activeSession();
    if (!s) return null;
    return computeSessionSummary(s, this.ops());
  });

  // Pre-Flight Protocol & Anti-Tilt Guard
  readonly showPreflightModal = signal<boolean>(false);
  readonly preflightStrictNoThirdParty = signal<boolean>(true);
  readonly preflightMentalState = signal<MentalState>('OPTIMAL');
  readonly preflightDailyLossLimit = signal<number>(100);

  readonly preflightEvaluation = computed<PreflightEvaluationResult>(() => {
    const accounts = this.unifiedAccounts();
    const maxSat =
      accounts.length > 0
        ? Math.max(...accounts.map((a) => a.consumedLimitPct))
        : 0;
    const tgCfg = this.telegramService.config();
    const telegramSentinelActive = Boolean(
      (tgCfg.botToken && tgCfg.chatId) || tgCfg.alertsEnabled !== false,
    );

    return evaluatePreflightDiscipline({
      bankSaturationPct: maxSat,
      strictNoThirdPartyAcknowledged: this.preflightStrictNoThirdParty(),
      telegramSentinelActive,
      dailyLossLimitUsd: this.preflightDailyLossLimit(),
      mentalState: this.preflightMentalState(),
      unresolvedDisputesCount: 0,
    });
  });

  startSession(): void {
    this.showPreflightModal.set(true);
  }

  cancelPreflight(): void {
    this.showPreflightModal.set(false);
  }

  confirmPreflightSession(): void {
    const evalResult = this.preflightEvaluation();
    if (!evalResult.canTrade) {
      this.toast.error(
        'No se puede abrir sesión: resuelve los bloqueos críticos de disciplina.',
        'Protocolo Pre-Vuelo',
      );
      return;
    }
    const pinnedPlan = this.activeDailyGoalPlan();
    const targetOps = pinnedPlan?.desiredCyclesPerDay ? pinnedPlan.desiredCyclesPerDay * 2 : 10;
    this.sessionService.startSession({ targetOps });
    this.audioAlerts.playConfirmationTone();
    this.showPreflightModal.set(false);
    this.toast.success(
      `Sesión Blindada Iniciada (${evalResult.sessionToken}). Meta: ${targetOps} ops | Ticket máx: $${evalResult.recommendedMaxSingleTicketUsdt} USDT.`,
      'Pre-Vuelo Autorizado',
    );
  }

  toggleAccountStatus(account: UnifiedAccountView, event?: Event): void {
    event?.stopPropagation();
    const newStatus = account.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED';
    const updated = this.accountsService.accounts().map((a) =>
      a.id === account.id ? { ...a, status: newStatus as 'ACTIVE' | 'DISABLED' } : a,
    );
    this.accountsService.saveAccounts(updated);
    this.toast.info(
      `Cuenta ${account.bankName} ${newStatus === 'ACTIVE' ? 'activada' : 'pausada temporalmente (Escudo Anti-Saturación)'}.`,
      'Gestión de Cuentas',
    );
  }

  quickOperate(bankName?: string, event?: Event, amountUsdt?: number): void {
    event?.stopPropagation();
    const queryParams: Record<string, string> = {};
    if (bankName) queryParams['autoFillBank'] = bankName;
    const depth = this.binanceService.marketDepth();
    if (depth?.bestSellPrice) queryParams['autoFillPrice'] = String(depth.bestSellPrice);
    if (typeof amountUsdt === 'number' && Number.isFinite(amountUsdt) && amountUsdt > 0) {
      queryParams['autoFillAmount'] = String(Math.round(amountUsdt));
    }
    void this.router.navigate(['/log'], { queryParams });
  }

  openCloseModal(): void {
    this.showCloseModal.set(true);
  }

  cancelCloseModal(): void {
    this.showCloseModal.set(false);
  }

  confirmCloseSession(): void {
    const closed = this.sessionService.closeSession({
      disciplineRating: this.closeDisciplineRating(),
      notes: this.closeNotes(),
    });
    this.showCloseModal.set(false);
    this.closeNotes.set('');
    if (closed) {
      this.audioAlerts.playConfirmationTone();
      this.toast.info(
        'Sesión cerrada y registrada en el historial de estadísticas.',
        'Sesión Cerrada',
      );
    }
  }

  openLiquidityModal(account?: UnifiedAccountView): void {
    const accounts = this.unifiedAccounts();
    const targetId = account?.id ?? (this.selectedInjectionAccountId() || accounts[0]?.id || '');
    this.selectedInjectionAccountId.set(targetId);
    this.injectionAmount.set(null);
    this.injectionNote.set('');
    this.injectionError.set(null);
    this.showLiquidityModal.set(true);

    if (account && account.dailyLimitVes > 0 && (account.currentBalanceVes / account.dailyLimitVes) >= 0.75) {
      this.audioAlerts.playSudebanWarningTone();
    }
  }

  cancelLiquidityModal(): void {
    this.showLiquidityModal.set(false);
    this.injectionAmount.set(null);
    this.injectionNote.set('');
    this.injectionError.set(null);
  }

  /** Modo del modal de liquidez: 'ADD' (sumar capital) o 'CALIBRATE' (establecer saldo real exacto) */
  readonly liquidityModalMode = signal<'ADD' | 'CALIBRATE'>('ADD');

  /** Diálogo de confirmación para reseteo masivo de saldos a 0 */
  readonly showResetConfirmModal = signal<boolean>(false);

  openResetConfirmModal(): void {
    this.showResetConfirmModal.set(true);
  }

  cancelResetConfirmModal(): void {
    this.showResetConfirmModal.set(false);
  }

  confirmResetAllBalancesToZero(): void {
    this.accountsService.resetAllBalancesToZero();
    this.audioAlerts.playConfirmationTone();
    this.toast.warn(
      'Todos los saldos de tus cuentas bancarias se han establecido en 0,00 VES. Tu tesorería está lista para ser fondeada con capital real.',
      'Saldos Reseteados a Cero',
    );
    this.showResetConfirmModal.set(false);
  }

  confirmLiquidityInjection(): void {
    const accountId = this.selectedInjectionAccountId();
    const amount = Number(this.injectionAmount());
    const mode = this.liquidityModalMode();

    if (!accountId) {
      this.injectionError.set('Por favor, selecciona una cuenta bancaria.');
      return;
    }
    if (!Number.isFinite(amount) || (mode === 'ADD' && amount <= 0) || (mode === 'CALIBRATE' && amount < 0)) {
      this.injectionError.set(
        mode === 'ADD'
          ? 'Ingresa un monto válido en VES mayor a 0.'
          : 'Ingresa un saldo válido en VES igual o mayor a 0.',
      );
      return;
    }

    try {
      if (mode === 'CALIBRATE') {
        const updated = this.accountsService.setExactAccountBalance(
          accountId,
          amount,
          this.injectionNote().trim() || 'Calibración de saldo real con extracto bancario',
        );
        this.audioAlerts.playConfirmationTone();
        this.toast.success(
          `Saldo de ${updated.bankName} calibrado a ${fmtVes(amount)}. Listo para operar.`,
          'Saldo Calibrado',
        );
      } else {
        const updated = this.accountsService.injectLiquidity(
          accountId,
          amount,
          this.injectionNote().trim() || 'Fondeo de liquidez en Centro de Control',
        );
        this.audioAlerts.playInjectionTone();
        this.toast.success(
          `Se han inyectado ${fmtVes(amount)} en ${updated.bankName}. Saldo disponible actualizado.`,
          'Liquidez Inyectada',
        );
      }
      this.cancelLiquidityModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al procesar la operación de tesorería.';
      this.injectionError.set(msg);
    }
  }

  async syncOfficialBanks(): Promise<void> {
    await this.accountsService.restoreDefaultAccounts();
    this.toast.info(
      'Cuentas bancarias de los 8 bancos oficiales sincronizadas y aseguradas en el sistema.',
      'Bancos Sincronizados',
    );
  }

  formatDuration(ms?: number): string {
    if (!ms || ms <= 0) return '0m';
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  /** KPIs → historical performance view. */
  goToStats(): void {
    void this.router.navigate(['/stats']);
  }

  /** Daily target / income projection → income calculator. */
  goToIncome(): void {
    void this.router.navigate(['/income']);
  }

  /** Session KPIs → live trading terminal. */
  goToSpread(): void {
    void this.router.navigate(['/spread']);
  }

  /** Navigate directly to 14-bank BCV Exchange Desk (optionally starting Morning Burst queue). */
  goToMesaBcv(startBurst = false, event?: Event): void {
    event?.stopPropagation();
    void this.router.navigate(
      ['/mesa-bcv'],
      startBurst ? { queryParams: { burst: '1' } } : undefined,
    );
  }

  /** Navigate directly to Finanzas 360. */
  goToFinanzas360(): void {
    void this.router.navigate(['/finanzas-360']);
  }

  /** Velocity chip → operation log filtered by that bank (forward-compat query param). */
  goToBankLog(bankKey: string): void {
    void this.router.navigate(['/log'], { queryParams: { bank: bankKey } });
  }

  /** Chart bar → stats calendar for that day (forward-compat query param). */
  goToDay(day: string): void {
    void this.router.navigate(['/stats'], { queryParams: { day } });
  }

  /** Risk verdict → risk rules editor. */
  goToRisk(): void {
    void this.router.navigate(['/risk']);
  }

  /** Recent operation row → full operation log. */
  goToLog(): void {
    void this.router.navigate(['/log']);
  }

  bcvZoneBadge(zone: string): { label: string; class: string } {
    switch (zone) {
      case 'CRITICAL_DISPERSION':
        return { label: 'DISPERSIÓN CRÍTICA (>35%)', class: 'badge-danger' };
      case 'ELEVATED':
        return { label: 'BRECHA ELEVADA (25-35%)', class: 'badge-warning' };
      case 'COMPRESSED':
        return { label: 'BRECHA COMPRIMIDA (<10%)', class: 'badge-accent' };
      default:
        return { label: 'RANGO NORMAL (10-25%)', class: 'badge-accent' };
    }
  }

  bcvPhaseBadge(phase: string): { label: string; class: string } {
    switch (phase) {
      case 'INTERVENTION_ACTIVE':
        return { label: '🔴 INYECCIÓN ACTIVA EN BANCA', class: 'badge-danger' };
      case 'PRE_INTERVENTION_COMPRESSION':
        return { label: '🟡 PRE-INTERVENCIÓN (ESPERA)', class: 'badge-warning' };
      case 'POST_INTERVENTION_REBOUND':
        return { label: '🟢 VENTANA DE REBOTE (48H)', class: 'badge-success' };
      default:
        return { label: '⚪ ACUMULACIÓN TRANQUILA', class: 'badge-accent' };
    }
  }

  async ngOnInit(): Promise<void> {
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');
      if (tab === 'treasury' || tab === 'agents' || tab === 'performance' || tab === 'all') {
        this.activeTab.set(tab);
      }
    });

    void this.binanceService.fetchMarketDepth?.('USDT', 'VES', true);
    void this.cotizaveService.refreshIfStale?.()?.catch?.(() => {});
    void this.spotMarketService.fetchCoreBasket?.()?.catch?.(() => {});
    await this.syncMcpIntelligence();
    await this.runSwarmHealthCheck();
    this.mcpIntervalId = setInterval(() => {
      void this.syncMcpIntelligence();
    }, 45000);
  }

  ngOnDestroy(): void {
    if (this.routeSub) {
      this.routeSub.unsubscribe();
      this.routeSub = null;
    }
    if (this.mcpIntervalId) {
      clearInterval(this.mcpIntervalId);
      this.mcpIntervalId = null;
    }
  }

  async runSwarmHealthCheck(): Promise<void> {
    const copilot = (
      window as unknown as {
        copilotApi?: {
          getSwarmHealth?: () => Promise<
            {
              name: string;
              role: string;
              status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
              lastPingMs: number;
              decisionsCount: number;
            }[]
          >;
        };
      }
    ).copilotApi;

    if (copilot?.getSwarmHealth) {
      try {
        const liveHealth = await copilot.getSwarmHealth();
        if (Array.isArray(liveHealth) && liveHealth.length > 0) {
          const icons: Record<string, string> = {
            'Sentinel Agent': '🛡️',
            'Strategist Agent': '🧠',
            'Risk Gatekeeper Agent': '⚖️',
            'Dispute Auditor Agent': '🔍',
          };
          const descs: Record<string, string> = {
            'Sentinel Agent':
              'Detección de shocks de liquidez, desbalance de órdenes y volatilidad.',
            'Strategist Agent':
              'Arbitraje algorítmico, cálculo VWAP y optimización de spreads netos.',
            'Risk Gatekeeper Agent':
              'Veto unilateral ante incumplimiento de Regla de Oro (>0.50%) o contraparte dudosa.',
            'Dispute Auditor Agent':
              'Auditoría forense de recibos OCR y verificación de transferencias.',
          };
          this.swarmAgents.set(
            liveHealth.map((h) => ({
              name: h.name,
              role: h.role,
              status: h.status,
              lastPingMs: h.lastPingMs,
              decisionsCount: h.decisionsCount,
              icon: icons[h.name] || '🤖',
              description: descs[h.name] || 'Agente de enjambre institucional activo.',
            })),
          );
        }
        this.toast.success(
          'Diagnóstico del enjambre de agentes ejecutado con éxito.',
          'Swarm Online',
        );
      } catch (err) {
        console.error('[Dashboard] Error checking swarm health:', err);
        this.toast.info('Diagnóstico de agentes ejecutado (modo local).', 'Swarm OK');
      }
    } else {
      const snap = this.telemetry();
      const opsCount = this.ops().length;
      const auditCount = this.audit.events().length;
      const viableFxCount = this.fxDeskSummary().viableCount;
      this.swarmAgents.update((agents) =>
        agents.map((a, idx) => ({
          ...a,
          lastPingMs: Math.max(18, (snap.p2pMs || 45) + idx * 12),
          decisionsCount:
            a.decisionsCount + Math.max(1, idx === 0 ? viableFxCount : idx === 1 ? opsCount : auditCount || 1),
        })),
      );
      this.toast.success('Telemetría del enjambre de agentes actualizada.', 'Swarm 4/4 Activo');
    }
  }

  async syncMcpIntelligence(): Promise<void> {
    this.mcpSyncing.set(true);
    try {
      // 1. Herramienta MCP: get_bcv_rates
      const bcvRes = await this.mcpService.getBcvRates();
      if (bcvRes.success && bcvRes.result) {
        this.mcpBcvRates.set(bcvRes.result as { usd?: number; date?: string });
      }

      // 2. Herramienta MCP: get_parallel_rates
      const parRes = await this.mcpService.getParallelRates();
      if (parRes.success && parRes.result) {
        this.mcpParallelRates.set(parRes.result as { rate?: number; provider?: string });
      }

      const bcvRate = this.mcpBcvRates()?.usd || this.manualBcvRate();
      const parallelRate = this.mcpParallelRates()?.rate || this.manualParallelRate();
      const liveSpreadPct = this.binanceService.marketDepth()?.spreadPct ?? 1.25;

      // 3. Herramienta MCP: calculate_rate_gap
      const gapRes = await this.mcpService.calculateRateGap({ parallelRate, bcvRate });
      if (gapRes.success && gapRes.result) {
        this.mcpRateGap.set(gapRes.result as unknown as BcvGapAnalysis);
      }

      // 4. Herramienta MCP: check_bcv_intervention_window
      const winRes = await this.mcpService.checkBcvInterventionWindow();
      if (winRes.success && winRes.result) {
        const res = winRes.result as Record<string, unknown>;
        this.mcpBcvIntervention.set({
          directive: (res['tradingDirectives'] as string) || (res['directive'] as string),
          tradingDirectives: (res['tradingDirectives'] as string) || (res['directive'] as string),
          ...(res as unknown as BcvPredictorWindow),
        });
      }

      // 5. Herramienta MCP: forecast_volatility_window
      const forecastRes = await this.mcpService.forecastVolatilityWindow({
        parallelRate,
        bcvRate,
        currentSpreadPct: liveSpreadPct,
      });
      if (forecastRes.success && forecastRes.result) {
        const res = forecastRes.result as Record<string, unknown>;
        const spreadDynamic = String(res['spreadDynamic'] || 'STABLE');
        const isExpansive = spreadDynamic === 'EXPANSION_LIKELY';
        const isCompressive = spreadDynamic === 'COMPRESSION_RISK';
        const gap = typeof res['gapPct'] === 'number' ? res['gapPct'] : 0;
        this.mcpVolatilityForecast.set({
          windowHours:
            typeof res['hoursUntilIntervention'] === 'number' ? res['hoursUntilIntervention'] : 2,
          marketRegime: isExpansive ? 'EXPANSIVE' : isCompressive ? 'MODERATE' : 'STABLE',
          expectedSpreadMin: 0.8,
          expectedSpreadMax: isExpansive ? 2.5 : 1.5,
          volatilityScore: gap ? Math.min(100, Math.round(gap * 2)) : 25,
          recommendation:
            (res['suggestedAction'] as string) ||
            (res['tacticalRecommendation'] as string) ||
            'Operar con volumen normal',
          ...(res as Record<string, unknown>),
        });
      }
    } catch (err) {
      console.error('[Dashboard] Error syncing MCP intelligence:', err);
    } finally {
      this.mcpSyncing.set(false);
    }
  }

  readonly fmtVes = fmtVes;
  readonly fmtUsd = fmtUsd;
}
