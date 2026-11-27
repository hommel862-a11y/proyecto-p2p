import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  P2PRadarService,
  BANK_PRESETS,
  RADAR_BANK_LABELS,
  RADAR_METHOD_TO_BANK_CODE,
  resolveRadarFiat,
  type BankPresetId,
  type AutoRefreshIntervalSec,
} from '../../core/p2p-radar.service';
import { AccountsService } from '../../core/accounts.service';
import { AudioAlertsService } from '../../core/audio-alerts.service';
import { BinanceExecutionBridgeService } from '../../core/binance-execution-bridge.service';
import { ToastService } from '../../core/toast.service';
import {
  type P2PUserTier,
  type MakerMerchantLevel,
  type ExecutionMode,
  type CleanRadarOffer,
  type RadarCleanBook,
  type ArbitrageRoute,
  type BotDetectionResult,
  type MarketTrendResult,
  RADAR_VOLUME_BRACKETS,
  calculateArbitrageCycle,
  resolveMakerFeeRatio,
} from '@p2p/core';
import type {
  BankSudebanHealthView,
  EnrichedOfferRow,
  MatrixRouteFilter,
  RadarBankFeeRow,
  RadarBankGroup,
  RadarBankViewModel,
  RadarBotReportRow,
  RadarCockpitTab,
  RadarCockpitViewInput,
  RadarDensityMode,
  RadarHeroKpiSummary,
  RadarRejectedOfferRow,
  RadarViewMode,
  TacticalPriceStrategy,
} from './p2p-radar-ui.models';
import { RadarCommandHeaderComponent } from './components/radar-command-header/radar-command-header.component';
import { RadarKpiStripComponent } from './components/radar-kpi-strip/radar-kpi-strip.component';
import { RadarBooksGridComponent } from './components/radar-books-grid/radar-books-grid.component';
import { RadarTacticalCockpitComponent } from './components/radar-tactical-cockpit/radar-tactical-cockpit.component';
import { RadarMatrixViewComponent } from './components/radar-matrix-view/radar-matrix-view.component';
import { RadarForensicViewComponent } from './components/radar-forensic-view/radar-forensic-view.component';
import { RadarOpportunityTickerComponent } from './components/radar-opportunity-ticker/radar-opportunity-ticker.component';

export type {
  RadarViewMode,
  RadarDensityMode,
  MatrixRouteFilter,
  TacticalPriceStrategy,
  RadarCockpitTab,
  EnrichedOfferRow,
  BankSudebanHealthView,
  RadarBankViewModel,
} from './p2p-radar-ui.models';

@Component({
  selector: 'app-p2p-radar',
  standalone: true,
  imports: [
    DecimalPipe,
    RadarCommandHeaderComponent,
    RadarKpiStripComponent,
    RadarBooksGridComponent,
    RadarTacticalCockpitComponent,
    RadarMatrixViewComponent,
    RadarForensicViewComponent,
    RadarOpportunityTickerComponent,
  ],
  templateUrl: './p2p-radar.component.html',
  styleUrl: './p2p-radar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class P2PRadarComponent implements OnInit, OnDestroy {
  readonly radarService = inject(P2PRadarService);
  private readonly accountsService = inject(AccountsService, { optional: true });
  private readonly audioAlerts = inject(AudioAlertsService);
  private readonly executionBridge = inject(BinanceExecutionBridgeService, { optional: true });
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });

  readonly bankLabels = RADAR_BANK_LABELS;
  readonly volumeBrackets = RADAR_VOLUME_BRACKETS;
  readonly availableBanks = Object.keys(RADAR_BANK_LABELS);

  readonly bankGroups: readonly RadarBankGroup[] = [
    {
      id: 'TOP_VES',
      label: 'Top Líderes VES',
      banks: ['Banesco', 'Mercantil', 'SpecificBank', 'PagoMovil'],
    },
    {
      id: 'COMMERCIAL_VES',
      label: 'Banca Comercial',
      banks: ['BBVA', 'BNC', 'Bancaribe', 'Banplus'],
    },
    {
      id: 'USD_RAILS',
      label: 'Rieles USD',
      banks: ['BanescoPanama', 'Zinli'],
    },
  ];

  readonly cleanModalOpen = signal<boolean>(false);
  readonly paramsDrawerOpen = signal<boolean>(false);
  readonly soundAlertsActive = signal<boolean>(!(this.audioAlerts?.isMuted?.() ?? false));
  readonly currentTickerIndex = signal<number>(0);
  readonly copiedTarget = signal<string | null>(null);

  readonly activeViewMode = signal<RadarViewMode>('BOOKS');
  readonly booksDensityMode = signal<RadarDensityMode>('COMFORT');
  readonly routeFilterMode = signal<MatrixRouteFilter>('ALL');
  readonly cockpitTab = signal<RadarCockpitTab>('SIMULATOR');

  readonly simBuyBank = signal<string>('Banesco');
  readonly simSellBank = signal<string>('Banesco');
  readonly simBuyPrice = signal<number>(0);
  readonly simSellPrice = signal<number>(0);

  readonly modalMaxPayTime = signal<number>(15);
  readonly modalMinFinishRate = signal<number>(92);
  readonly modalMinOrders = signal<number>(30);
  readonly modalMaxOutlierDevPct = signal<number>(0.8);

  private tickerTimer: ReturnType<typeof setInterval> | null = null;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAlertedRouteId: string | null = null;

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.cleanModalOpen()) {
      this.closeCleanModal();
      return;
    }
    if (this.paramsDrawerOpen()) {
      this.paramsDrawerOpen.set(false);
    }
  }

  readonly activeBanks = computed(() => this.radarService.activePaymentMethods());

  readonly activePreset = computed<BankPresetId | 'CUSTOM'>(() => {
    const current = this.radarService.activePaymentMethods();
    if (current.length === 0) return 'CLEAR';
    const top = BANK_PRESETS.TOP_VES;
    if (current.length === top.length && top.every((b) => current.includes(b))) return 'TOP_VES';
    const all = BANK_PRESETS.ALL_VES;
    if (current.length === all.length && all.every((b) => current.includes(b))) return 'ALL_VES';
    const exp = BANK_PRESETS.EXPANDED;
    if (current.length === exp.length && exp.every((b) => current.includes(b))) return 'EXPANDED';
    return 'CUSTOM';
  });

  readonly filteredMatrixRoutes = computed<ArbitrageRoute[]>(() => {
    const routes = this.radarService.allRoutes();
    const filter = this.routeFilterMode();
    if (filter === 'MONOBANK') return routes.filter((r) => !r.isInterbank);
    if (filter === 'INTERBANK') return routes.filter((r) => r.isInterbank);
    if (filter === 'VIABLE') return routes.filter((r) => r.metrics.isViable);
    return [...routes];
  });

  readonly simulatedMetrics = computed(() => {
    const buy = this.simBuyPrice();
    const sell = this.simSellPrice();
    const isInterbank = this.simBuyBank() !== this.simSellBank();
    const friction = isInterbank ? this.radarService.interbankFrictionPct() : 0;

    return this.radarService.simulateArbitrage(buy, sell, {
      fiatFrictionPct: friction,
    });
  });

  readonly bankHealthMap = computed<Map<string, BankSudebanHealthView>>(() => {
    const map = new Map<string, BankSudebanHealthView>();
    const usages = this.accountsService?.usages();
    if (!usages || usages.length === 0) return map;

    for (const [methodKey, code] of Object.entries(RADAR_METHOD_TO_BANK_CODE)) {
      if (!code) continue;
      const matching = usages.filter((u) => {
        if (methodKey === 'PagoMovil') return u.account.rail === 'PAGO_MOVIL';
        if (methodKey === 'BanescoPanama') {
          return /panam[aá]/i.test(u.account.bankName);
        }
        if (methodKey === 'Zinli') {
          return /zinli/i.test(u.account.bankName);
        }
        return u.account.bankCode === code;
      });
      if (matching.length === 0) continue;

      const active = matching.filter((u) => u.account.status !== 'DISABLED');
      if (active.length === 0) {
        map.set(methodKey, { label: 'Cuenta Pausada', isBlocked: true, statusClass: 'blocked' });
        continue;
      }
      const best = active.find((u) => !u.isOverLimit && !u.isNearLimit);
      if (best) {
        map.set(methodKey, { label: 'SUDEBAN Óptimo', isBlocked: false, statusClass: 'optimal' });
        continue;
      }
      const near = active.find((u) => !u.isOverLimit);
      if (near) {
        map.set(methodKey, { label: 'Cupo >= 80%', isBlocked: false, statusClass: 'warn' });
      } else {
        map.set(methodKey, { label: 'Tope Diario', isBlocked: true, statusClass: 'blocked' });
      }
    }
    return map;
  });

  readonly booksViewModels = computed<Map<string, RadarBankViewModel>>(() => {
    const books = this.radarService.radarBooks();
    const trends = this.radarService.marketTrends();
    const bots = this.radarService.botReports();
    const healthMap = this.bankHealthMap();
    const density = this.booksDensityMode();
    const offerCap = density === 'COMPACT' ? 3 : 6;
    const result = new Map<string, RadarBankViewModel>();

    for (const payMethod of this.activeBanks()) {
      const buyBook = books.get(`${payMethod}_BUY`);
      const sellBook = books.get(`${payMethod}_SELL`);
      const sellTrend = trends.get(`${payMethod}_SELL`);
      const buyBots = bots.get(`${payMethod}_BUY`) ?? [];
      const sellBots = bots.get(`${payMethod}_SELL`) ?? [];

      const buyBotMap = new Map<string, BotDetectionResult>(
        buyBots.map((b) => [b.advertiserNo, b]),
      );
      const sellBotMap = new Map<string, BotDetectionResult>(
        sellBots.map((b) => [b.advertiserNo, b]),
      );

      const buyOffers = buyBook?.cleanOffers ?? [];
      const sellOffers = sellBook?.cleanOffers ?? [];

      const maxBuySurplus = Math.max(1, ...buyOffers.slice(0, offerCap).map((o) => o.surplusAmount));
      const maxSellSurplus = Math.max(1, ...sellOffers.slice(0, offerCap).map((o) => o.surplusAmount));

      const buyTopOffers: EnrichedOfferRow[] = buyOffers.slice(0, offerCap).map((offer) => ({
        offer,
        bot: buyBotMap.get(offer.advertiserNo),
        depthPct: Math.min(100, Math.round((offer.surplusAmount / maxBuySurplus) * 100)),
      }));

      const sellTopOffers: EnrichedOfferRow[] = sellOffers.slice(0, offerCap).map((offer) => ({
        offer,
        bot: sellBotMap.get(offer.advertiserNo),
        depthPct: Math.min(100, Math.round((offer.surplusAmount / maxSellSurplus) * 100)),
      }));

      const buyLiquidity = buyOffers.reduce((sum, o) => sum + o.surplusAmount, 0);
      const sellLiquidity = sellOffers.reduce((sum, o) => sum + o.surplusAmount, 0);

      const topSell = sellBook?.effectiveTopPrice ?? null;
      const topBuy = buyBook?.effectiveTopPrice ?? null;
      let intraSpreadVes: number | null = null;
      let intraSpreadPct: number | null = null;
      if (topSell !== null && topBuy !== null && topBuy > 0) {
        intraSpreadVes = topSell - topBuy;
        intraSpreadPct = (intraSpreadVes / topBuy) * 100;
      }

      const sellFree = sellBook?.freeAdvertiserCount ?? sellOffers.filter((o) => !o.isVerifiedCompetitor).length;
      const openCount = sellBook?.openTakerCount ?? sellOffers.filter((o) => o.takerEligibility !== 'RESTRICTED').length;

      result.set(payMethod, {
        payMethod,
        buyBook,
        sellBook,
        sellTrend,
        buyLiquidity,
        sellLiquidity,
        buyTopOffers,
        sellTopOffers,
        intraSpreadVes,
        intraSpreadPct,
        sudebanHealth: healthMap.get(payMethod) ?? null,
        buyMerchantWallPct: buyBook?.merchantWallPct ?? 0,
        sellMerchantWallPct: sellBook?.merchantWallPct ?? 0,
        freeAdvertisersCount: sellFree,
        openTakerOffersCount: openCount,
      });
    }

    return result;
  });

  readonly currentTickerRoute = computed<ArbitrageRoute | null>(() => {
    const routes = this.radarService.topRoutes();
    if (routes.length === 0) return null;
    const idx = this.currentTickerIndex() % routes.length;
    return routes[idx] ?? null;
  });

  readonly feeScheduleRows = computed<readonly RadarBankFeeRow[]>(() => {
    const level = this.radarService.merchantLevel();
    const userTier = this.radarService.userTier();
    const makerRatio = resolveMakerFeeRatio(userTier, undefined, level);
    const makerPct = makerRatio * 100;
    const frictionDefault = this.radarService.interbankFrictionPct();
    const vms = this.booksViewModels();
    const healthMap = this.bankHealthMap();

    return this.availableBanks.map((payMethod) => {
      const vm = vms.get(payMethod);
      const fiat = resolveRadarFiat(payMethod, 'VES');
      return {
        payMethod,
        label: this.bankLabels[payMethod] || payMethod,
        fiat,
        interbankFrictionPct: fiat === 'VES' ? frictionDefault : 0,
        makerFeePct: makerPct,
        hybridCombinedFeePct: makerPct,
        merchantWallPct: vm?.sellMerchantWallPct ?? 0,
        openTakerCount: vm?.openTakerOffersCount ?? 0,
        health: vm?.sudebanHealth ?? healthMap.get(payMethod) ?? null,
      };
    });
  });

  readonly heroKpiSummary = computed<RadarHeroKpiSummary>(() => {
    const bestRoute = this.radarService.bestRoute();
    const allRoutes = this.radarService.allRoutes();
    const vms = this.booksViewModels();

    let lowestWallBank: RadarHeroKpiSummary['lowestWallBank'] = null;
    for (const vm of vms.values()) {
      if (!vm.sellBook && !vm.buyBook) continue;
      const avgWall = (vm.buyMerchantWallPct + vm.sellMerchantWallPct) / 2;
      if (!lowestWallBank || avgWall < lowestWallBank.wallPct) {
        lowestWallBank = {
          payMethod: vm.payMethod,
          label: this.bankLabels[vm.payMethod] || vm.payMethod,
          wallPct: avgWall,
          freeCount: vm.freeAdvertisersCount,
        };
      }
    }

    let hybridEdgeRoute: ArbitrageRoute | null = null;
    let hybridDeltaPct = 0;
    for (const r of allRoutes) {
      if (r.optimalHybridNetSpreadPct !== undefined) {
        const delta = Math.max(0, r.optimalHybridNetSpreadPct - r.metrics.netSpreadPct);
        if (!hybridEdgeRoute || delta > hybridDeltaPct) {
          hybridEdgeRoute = r;
          hybridDeltaPct = delta;
        }
      }
    }

    return {
      bestRoute,
      lowestWallBank,
      hybridEdgeRoute,
      hybridDeltaPct,
      cleanOffersTotal: this.radarService.totalCleanOffers(),
      botsDetectedCount: this.radarService.totalBotsDetected(),
      rejectedCount: this.radarService.allRejectedOffers().length,
      samplesCount: this.radarService.bufferSampleCount(),
    };
  });

  readonly cockpitViewInput = computed<RadarCockpitViewInput>(() => ({
    merchantLevel: this.radarService.merchantLevel(),
    userTier: this.radarService.userTier(),
    executionMode: this.radarService.executionMode(),
    operatingCapitalUsdt: this.radarService.operatingCapitalUsdt(),
    targetNetMarginPct: this.radarService.targetNetMarginPct(),
    simBuyBank: this.simBuyBank(),
    simSellBank: this.simSellBank(),
    simBuyPrice: this.simBuyPrice(),
    simSellPrice: this.simSellPrice(),
    metrics: this.simulatedMetrics(),
    activeRoute: this.radarService.bestRoute(),
    currentMakerFeePct: this.radarService.currentMakerFeePct(),
    volumeBracket: this.radarService.selectedBracket(),
    bankLabels: this.bankLabels,
    dailyCyclesCount: this.radarService.dailyConsolidated().totalCycles,
    dailyProfitUsdt: this.radarService.dailyConsolidated().totalNetProfitUsdt,
    feeRows: this.feeScheduleRows(),
  }));

  readonly mappedBotRows = computed<readonly RadarBotReportRow[]>(() =>
    this.radarService.allDetectedBots().map((entry) => ({
      bookKey: `${entry.payMethod}_${entry.side}`,
      bank: entry.payMethod,
      side: entry.side,
      bot: entry,
    })),
  );

  readonly mappedRejectedRows = computed<readonly RadarRejectedOfferRow[]>(() =>
    this.radarService.allRejectedOffers().map((entry) => ({
      bookKey: `${entry.payMethod}_${entry.side}`,
      bank: entry.payMethod,
      side: entry.side,
      offer: entry,
    })),
  );

  readonly formatRejectionReasonBound = (reason: string): string =>
    this.formatRejectionReason(reason);

  ngOnInit(): void {
    const cfg = this.radarService.cleanConfig();
    this.modalMaxPayTime.set(cfg.maxPayTimeMinutes);
    this.modalMinFinishRate.set(cfg.minMonthFinishRate);
    this.modalMinOrders.set(cfg.minMonthOrderCount);
    this.modalMaxOutlierDevPct.set(cfg.outlierDeviationPct);

    const params = this.route?.snapshot?.queryParamMap;
    const queryBank = params?.get('bank');
    if (queryBank && this.availableBanks.includes(queryBank)) {
      if (!this.radarService.activePaymentMethods().includes(queryBank)) {
        this.radarService.togglePaymentMethod(queryBank);
      }
      this.simBuyBank.set(queryBank);
      this.simSellBank.set(queryBank);
    }
    const queryCap = Number(params?.get('capital'));
    if (Number.isFinite(queryCap) && queryCap > 0) {
      this.radarService.setOperatingCapital(queryCap);
    }

    this.initSimulatorFromBestRoute();

    this.tickerTimer = setInterval(() => {
      const routes = this.radarService.topRoutes();
      if (routes.length > 0) {
        this.currentTickerIndex.update((curr) => (curr + 1) % routes.length);
        this.checkSoundAlert(routes[0]);
      }
    }, 8000);
  }

  ngOnDestroy(): void {
    if (this.tickerTimer) {
      clearInterval(this.tickerTimer);
      this.tickerTimer = null;
    }
    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
    this.radarService.stopAutoRefresh();
  }

  async scanRadar(): Promise<void> {
    const books = await this.radarService.scanRadar();
    if (books.size > 0) {
      this.initSimulatorFromBestRoute();
      const best = this.radarService.bestRoute();
      if (best) {
        this.checkSoundAlert(best);
      }
    }
  }

  setAutoRefresh(seconds: AutoRefreshIntervalSec): void {
    this.radarService.setAutoRefreshInterval(seconds);
    if (seconds > 0) {
      this.toast.info(`Radar Live Stream activado cada ${seconds}s.`);
    } else {
      this.toast.info('Radar en modo escaneo manual.');
    }
  }

  setViewMode(mode: RadarViewMode): void {
    this.activeViewMode.set(mode);
  }

  toggleDensityMode(): void {
    this.booksDensityMode.update((m) => (m === 'COMFORT' ? 'COMPACT' : 'COMFORT'));
  }

  setRouteFilter(filter: MatrixRouteFilter): void {
    this.routeFilterMode.set(filter);
  }

  setCockpitTab(tab: RadarCockpitTab): void {
    this.cockpitTab.set(tab);
  }

  toggleParamsDrawer(): void {
    this.paramsDrawerOpen.update((v) => !v);
  }

  setMerchantLevel(level: MakerMerchantLevel): void {
    this.radarService.setMerchantLevel(level);
  }

  setUserTier(tier: P2PUserTier): void {
    this.radarService.setUserTier(tier);
  }

  setExcludeMerchantCompetitors(exclude: boolean): void {
    this.radarService.setExcludeMerchantCompetitors(exclude);
  }

  setRequireOpenTakerOffers(requireOpen: boolean): void {
    this.radarService.setRequireOpenTakerOffers(requireOpen);
  }

  setExecutionMode(mode: ExecutionMode): void {
    this.radarService.setExecutionMode(mode);
  }

  setVolumeBracket(bracketId: string): void {
    this.radarService.setVolumeBracket(bracketId);
  }

  toggleBank(bankKey: string): void {
    this.radarService.togglePaymentMethod(bankKey);
  }

  setBankPreset(preset: BankPresetId): void {
    this.radarService.setBankPreset(preset);
  }

  onCapitalChange(val: number): void {
    this.radarService.setOperatingCapital(val);
  }

  onMarginTargetChange(val: number): void {
    this.radarService.setTargetNetMargin(val);
  }

  onInterbankFrictionChange(val: number): void {
    this.radarService.setInterbankFriction(val);
  }

  selectOfferForSimulation(bank: string, side: 'BUY' | 'SELL', offer: CleanRadarOffer): void {
    if (side === 'BUY') {
      this.simBuyBank.set(bank);
      this.simBuyPrice.set(offer.price);
    } else {
      this.simSellBank.set(bank);
      this.simSellPrice.set(offer.price);
    }
    this.cockpitTab.set('SIMULATOR');
    this.toast.info(
      `Tasa cargada: ${side === 'BUY' ? 'Compra' : 'Venta'} @ ${offer.price.toFixed(2)} (${this.bankLabels[bank] || bank})`,
    );
  }

  loadRouteIntoSimulator(route: ArbitrageRoute): void {
    this.simSellBank.set(route.sourceBank);
    this.simSellPrice.set(route.sellPrice);
    this.simBuyBank.set(route.targetBank);
    this.simBuyPrice.set(route.buyPrice);
    this.cockpitTab.set('SIMULATOR');
    this.toast.success(
      `Ruta cargada: ${this.bankLabels[route.sourceBank] || route.sourceBank} -> ${this.bankLabels[route.targetBank] || route.targetBank}`,
    );
  }

  executeRadarOffer(
    bank: string,
    side: 'BUY' | 'SELL',
    offer: CleanRadarOffer,
    preferAdvertiser = false,
  ): void {
    this.selectOfferForSimulation(bank, side, offer);
    void this.executionBridge?.executeOfferAction({
      action: side,
      offer: {
        advNo: offer.advNo,
        advertiserNo: offer.advertiserNo,
        nickName: offer.nickName,
        price: offer.price,
        surplusAmount: offer.surplusAmount,
        minVes: offer.minSingleTransAmount,
        maxVes: offer.maxSingleTransAmount,
        buyerKycLimit: offer.buyerKycLimit,
        buyerRegDaysLimit: offer.buyerRegDaysLimit,
        buyerBtcPositionLimit: offer.buyerBtcPositionLimit,
        takerAdditionalKycRequired: offer.takerAdditionalKycRequired,
        payMethods: offer.payMethods,
      },
      expectedPrice: offer.price,
      targetUsdt: this.radarService.operatingCapitalUsdt(),
      bank: this.bankLabels[bank] || bank,
      preferAdvertiser,
    });
  }

  executeMatrixRouteLeg(route: ArbitrageRoute, leg: 'BUY' | 'SELL'): void {
    this.loadRouteIntoSimulator(route);
    const bank = leg === 'BUY' ? route.targetBank : route.sourceBank;
    const advNo = leg === 'BUY' ? route.buyLegAdvNo : route.sellLegAdvNo;
    const advertiserNo = leg === 'BUY' ? route.buyLegAdvertiserNo : route.sellLegAdvertiserNo;
    const nickName = leg === 'BUY' ? route.buyLegNickName : route.sellLegNickName;
    const price = leg === 'BUY' ? route.buyPrice : route.sellPrice;
    const book = this.getBook(bank, leg);
    const liveOffer = book?.cleanOffers.find((o) => o.advNo === advNo) ?? book?.cleanOffers[0];

    void this.executionBridge?.executeOfferAction({
      action: leg,
      offer: {
        advNo: liveOffer?.advNo ?? advNo,
        advertiserNo: liveOffer?.advertiserNo ?? advertiserNo,
        nickName: liveOffer?.nickName ?? nickName ?? 'Anunciante Líder',
        price: liveOffer?.price ?? price,
        surplusAmount: liveOffer?.surplusAmount,
        minVes: liveOffer?.minSingleTransAmount,
        maxVes: liveOffer?.maxSingleTransAmount,
        buyerKycLimit: liveOffer?.buyerKycLimit,
        buyerRegDaysLimit: liveOffer?.buyerRegDaysLimit,
        buyerBtcPositionLimit: liveOffer?.buyerBtcPositionLimit,
        takerAdditionalKycRequired: liveOffer?.takerAdditionalKycRequired,
        payMethods: liveOffer?.payMethods,
      },
      expectedPrice: price,
      targetUsdt: this.radarService.operatingCapitalUsdt(),
      bank: this.bankLabels[bank] || bank,
    });
  }

  inspectForensicBot(row: RadarBotReportRow): void {
    void this.executionBridge?.executeOfferAction({
      action: row.side,
      offer: {
        advertiserNo: row.bot.advertiserNo,
        nickName: row.bot.nickName,
        price: row.bot.recommendedCounterPrice ?? 1,
      },
      bank: this.bankLabels[row.bank] || row.bank,
      preferAdvertiser: true,
    });
  }

  inspectForensicRejectedOffer(row: RadarRejectedOfferRow, preferAdvertiser = false): void {
    const { offer, side, bank } = row;
    void this.executionBridge?.executeOfferAction({
      action: side,
      offer: {
        advNo: offer.advNo,
        advertiserNo: offer.advertiserNo,
        nickName: offer.nickName,
        price: offer.price,
        surplusAmount: offer.surplusAmount,
        minVes: offer.minSingleTransAmount,
        maxVes: offer.maxSingleTransAmount,
      },
      bank: this.bankLabels[bank] || bank,
      preferAdvertiser,
    });
  }

  swapSimulatorBanks(): void {
    const prevBuyBank = this.simBuyBank();
    const prevSellBank = this.simSellBank();
    const prevBuyPrice = this.simBuyPrice();
    const prevSellPrice = this.simSellPrice();

    this.simBuyBank.set(prevSellBank);
    this.simSellBank.set(prevBuyBank);

    if (prevSellPrice > 0 || prevBuyPrice > 0) {
      const targetBuyTop = this.getBook(prevSellBank, 'BUY')?.effectiveTopPrice ?? prevSellPrice;
      const targetSellTop = this.getBook(prevBuyBank, 'SELL')?.effectiveTopPrice ?? prevBuyPrice;
      this.simBuyPrice.set(targetBuyTop);
      this.simSellPrice.set(targetSellTop);
    }
  }

  onSimPriceChange(side: 'BUY' | 'SELL', rawValue: unknown): void {
    if (rawValue === '' || rawValue === null || rawValue === undefined) return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const rounded = Math.round(parsed * 100) / 100;
    if (side === 'BUY') {
      this.simBuyPrice.set(rounded);
    } else {
      this.simSellPrice.set(rounded);
    }
  }

  nudgeSimPrice(side: 'BUY' | 'SELL', delta: number): void {
    if (side === 'BUY') {
      const next = Math.max(0.01, Math.round((this.simBuyPrice() + delta) * 100) / 100);
      this.simBuyPrice.set(next);
    } else {
      const next = Math.max(0.01, Math.round((this.simSellPrice() + delta) * 100) / 100);
      this.simSellPrice.set(next);
    }
  }

  applyTacticalPosition(side: 'BUY' | 'SELL', strategy: TacticalPriceStrategy): void {
    const bank = side === 'BUY' ? this.simBuyBank() : this.simSellBank();
    const book = this.getBook(bank, side);
    const trend = this.getTrend(bank, side);
    const bots = this.getBots(bank, side);

    let targetPrice: number | null = null;

    if (strategy === 'TOP1') {
      targetPrice = book?.effectiveTopPrice ?? null;
    } else if (strategy === 'BEAT_TICK') {
      const top = book?.effectiveTopPrice ?? 0;
      if (top > 0) {
        targetPrice = Math.round((side === 'BUY' ? top + 0.01 : top - 0.01) * 100) / 100;
      }
    } else if (strategy === 'VWAP') {
      if (trend && trend.currentVWAP > 0) {
        targetPrice = Math.round(trend.currentVWAP * 100) / 100;
      }
    } else if (strategy === 'ANTI_BOT') {
      const botWithLimit = bots.find((b) => b.recommendedCounterPrice !== null);
      if (botWithLimit && botWithLimit.recommendedCounterPrice !== null) {
        targetPrice = botWithLimit.recommendedCounterPrice;
      } else {
        targetPrice = book?.effectiveTopPrice ?? null;
      }
    }

    if (targetPrice !== null && targetPrice > 0) {
      if (side === 'BUY') this.simBuyPrice.set(targetPrice);
      else this.simSellPrice.set(targetPrice);
      this.toast.info(`Posición ${strategy} aplicada en ${side}: ${targetPrice.toFixed(2)}`);
    } else {
      this.toast.warn(`No hay datos suficientes en ${this.bankLabels[bank] || bank} para estrategia ${strategy}.`);
    }
  }

  copyRateToClipboard(rate: number, label: string): void {
    const formatted = rate.toFixed(2);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(formatted);
    }
    this.copiedTarget.set(label);
    this.toast.info(`Tasa copiada (${label}): ${formatted}`);
    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
    }
    this.copiedTimer = setTimeout(() => {
      this.copiedTarget.set(null);
      this.copiedTimer = null;
    }, 2000);
  }

  copyMakerAdCard(): void {
    const metrics = this.simulatedMetrics();
    const buyBankLabel = this.bankLabels[this.simBuyBank()] || this.simBuyBank();
    const sellBankLabel = this.bankLabels[this.simSellBank()] || this.simSellBank();
    const text = [
      `FICHA TÁCTICA RADAR P2P (${this.radarService.merchantLevel()} · ${this.radarService.executionMode()})`,
      `• Compra (${buyBankLabel}): ${this.simBuyPrice().toFixed(2)}`,
      `• Venta (${sellBankLabel}): ${this.simSellPrice().toFixed(2)}`,
      `• Break-Even Venta: ${metrics.breakEvenSellPrice.toFixed(2)} | Target (+${this.radarService.targetNetMarginPct()}%): ${metrics.targetSellPrice.toFixed(2)}`,
      `• Spread Neto: ${metrics.netSpreadPct >= 0 ? '+' : ''}${metrics.netSpreadPct.toFixed(2)}% (+$${metrics.netProfitUsdt.toFixed(2)} USDT sobre $${this.radarService.operatingCapitalUsdt()} USDT)`,
    ].join('\n');

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      this.toast.success('Ficha táctica Maker copiada al portapapeles.');
    }
  }

  toggleSoundAlerts(): void {
    const next = !this.soundAlertsActive();
    this.soundAlertsActive.set(next);
    this.audioAlerts?.toggleMute?.();
    if (next) {
      this.audioAlerts.playOpportunityAlert();
      this.toast.info('Alertas sonoras activadas.');
    } else {
      this.toast.warn('Alertas sonoras silenciadas.');
    }
  }

  recordCurrentSimulatedCycle(): void {
    const metrics = this.simulatedMetrics();
    const buyPrice = this.simBuyPrice();
    const sellPrice = this.simSellPrice();

    if (buyPrice <= 0 || sellPrice <= 0) {
      this.toast.warn('Ingresa tasas válidas de compra y venta antes de registrar el ciclo.');
      return;
    }

    this.radarService.recordCompletedCycle({
      sourceBank: this.simSellBank(),
      targetBank: this.simBuyBank(),
      executionMode: this.radarService.executionMode(),
      capitalUsdt: this.radarService.operatingCapitalUsdt(),
      buyPrice,
      sellPrice,
      netSpreadPct: metrics.netSpreadPct,
      netProfitUsdt: metrics.netProfitUsdt,
      netProfitFiat: metrics.netProfitFiat,
      notes: `Venta en ${this.bankLabels[this.simSellBank()] || this.simSellBank()} @ ${sellPrice.toFixed(2)} | Compra en ${this.bankLabels[this.simBuyBank()] || this.simBuyBank()} @ ${buyPrice.toFixed(2)}`,
    });
  }

  dispatchSimulatedToCrm(): void {
    const buyPrice = this.simBuyPrice();
    const sellPrice = this.simSellPrice();
    const metrics = this.simulatedMetrics();

    if (buyPrice <= 0 || sellPrice <= 0) {
      this.toast.warn('Configura tasas válidas en el simulador antes de enviar al CRM.');
      return;
    }

    this.radarService.dispatchRouteToCrmPipeline({
      sourceBank: this.simSellBank(),
      targetBank: this.simBuyBank(),
      buyPrice,
      sellPrice,
      capitalUsdt: this.radarService.operatingCapitalUsdt(),
      netProfitUsdt: metrics.netProfitUsdt,
    });
  }

  openCrmPipeline(): void {
    void this.router?.navigate(['/compliance-cockpit']);
  }

  copyDailySummaryToClipboard(): void {
    const summary = this.radarService.dailyConsolidated();
    if (summary.totalCycles === 0) {
      this.toast.warn('No hay ciclos completados registrados el día de hoy.');
      return;
    }

    const text = [
      `RESUMEN DIARIO ARBITRAJE P2P [${summary.dateKey}]`,
      `──────────────────────────────────────────────`,
      `• Ciclos Completados: ${summary.totalCycles} (${summary.monobankCyclesCount} monobanco, ${summary.interbankCyclesCount} interbancario)`,
      `• Volumen Operado: $${summary.totalTurnoverUsdt.toLocaleString('es-VE', { minimumFractionDigits: 2 })} USDT`,
      `• Ganancia Neta Total: +$${summary.totalNetProfitUsdt.toFixed(2)} USDT`,
      `• Rentabilidad Media: +${summary.averageNetSpreadPct.toFixed(2)}% por ciclo`,
      `• Nivel Operador: ${this.radarService.merchantLevel()} (${this.radarService.executionMode()})`,
    ].join('\n');

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      this.toast.success('Resumen diario consolidado copiado al portapapeles.');
    }
  }

  toggleHudBridge(): void {
    const nextState = this.radarService.toggleHudBroadcasting();
    this.toast.info(nextState ? 'HUD Extension Bridge ACTIVADO' : 'HUD Extension Bridge PAUSADO');
  }

  openCleanModal(): void {
    const cfg = this.radarService.cleanConfig();
    this.modalMaxPayTime.set(cfg.maxPayTimeMinutes);
    this.modalMinFinishRate.set(cfg.minMonthFinishRate);
    this.modalMinOrders.set(cfg.minMonthOrderCount);
    this.modalMaxOutlierDevPct.set(cfg.outlierDeviationPct);
    this.cleanModalOpen.set(true);
  }

  closeCleanModal(): void {
    this.cleanModalOpen.set(false);
  }

  onModalNumericChange(
    field: 'payTime' | 'finishRate' | 'minOrders' | 'outlierDev',
    event: Event,
  ): void {
    const raw = (event.target as HTMLInputElement | null)?.value;
    if (raw === '' || raw === null || raw === undefined) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    if (field === 'payTime') this.modalMaxPayTime.set(parsed);
    else if (field === 'finishRate') this.modalMinFinishRate.set(Math.min(100, parsed));
    else if (field === 'minOrders') this.modalMinOrders.set(Math.floor(parsed));
    else this.modalMaxOutlierDevPct.set(parsed);
  }

  saveCleanModalSettings(): void {
    this.radarService.updateCleanConfig({
      maxPayTimeMinutes: this.resolveCleanNumber(this.modalMaxPayTime(), 15, 1),
      minMonthFinishRate: Math.min(100, this.resolveCleanNumber(this.modalMinFinishRate(), 92, 0)),
      minMonthOrderCount: Math.floor(this.resolveCleanNumber(this.modalMinOrders(), 30, 0)),
      outlierDeviationPct: this.resolveCleanNumber(this.modalMaxOutlierDevPct(), 0.8, 0),
    });
    this.closeCleanModal();
    this.toast.success('Configuración Clean Mode guardada y libros recalculados.');
  }

  getBook(bank: string, side: 'BUY' | 'SELL'): RadarCleanBook | undefined {
    return this.radarService.radarBooks().get(`${bank}_${side}`);
  }

  getTrend(bank: string, side: 'BUY' | 'SELL'): MarketTrendResult | undefined {
    return this.radarService.marketTrends().get(`${bank}_${side}`);
  }

  getBots(bank: string, side: 'BUY' | 'SELL'): BotDetectionResult[] {
    return this.radarService.botReports().get(`${bank}_${side}`) ?? [];
  }

  isOfferBot(bank: string, side: 'BUY' | 'SELL', offer: CleanRadarOffer): BotDetectionResult | undefined {
    return this.getBots(bank, side).find((b) => b.advertiserNo === offer.advertiserNo);
  }

  getBookCleanLiquidityUsdt(bank: string, side: 'BUY' | 'SELL'): number {
    const book = this.getBook(bank, side);
    if (!book) return 0;
    return book.cleanOffers.reduce((sum, offer) => sum + offer.surplusAmount, 0);
  }

  getOfferDepthPct(bank: string, side: 'BUY' | 'SELL', surplusUsdt: number): number {
    const book = this.getBook(bank, side);
    if (!book || book.cleanOffers.length === 0) return 0;
    const maxSurplus = Math.max(
      1,
      ...book.cleanOffers.slice(0, 6).map((o) => o.surplusAmount),
    );
    return Math.min(100, Math.round((surplusUsdt / maxSurplus) * 100));
  }

  formatRejectionReason(reason: string): string {
    switch (reason) {
      case 'MANIPULACION_DETECTADA':
        return 'Señuelo / Outlier Top #1';
      case 'LIQUIDITY_TRAP':
        return 'Trampa de Baja Liquidez';
      case 'PAY_TIME_EXCEEDED':
        return 'Ventana Pago Lenta (>Límite)';
      case 'LOW_FINISH_RATE':
        return 'Baja Finalización (<Mín)';
      case 'LOW_ORDER_COUNT':
        return 'Pocas Órdenes / Cuenta Nueva';
      case 'TAKER_RESTRICTED':
        return 'Candado Taker (KYC / Reg / BTC)';
      case 'MERCHANT_COMPETITOR_FILTERED':
        return 'Competidor Verificado Filtrado';
      default:
        return reason;
    }
  }

  calculateCyclePreview(buyPrice: number, sellPrice: number, isInterbank: boolean): number {
    const res = calculateArbitrageCycle({
      buyPrice,
      sellPrice,
      capitalUsdt: this.radarService.operatingCapitalUsdt(),
      mode: this.radarService.executionMode(),
      userTier: this.radarService.userTier(),
      merchantLevel: this.radarService.merchantLevel(),
      fiatFrictionPct: isInterbank ? this.radarService.interbankFrictionPct() : 0,
      targetNetMarginPct: this.radarService.targetNetMarginPct(),
    });
    return res.netSpreadPct;
  }

  private resolveCleanNumber(raw: unknown, fallback: number, min: number): number {
    if (raw === '' || raw === null || raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
  }

  private initSimulatorFromBestRoute(): void {
    const best = this.radarService.bestRoute();
    if (best && this.simBuyPrice() === 0 && this.simSellPrice() === 0) {
      this.simSellBank.set(best.sourceBank);
      this.simSellPrice.set(best.sellPrice);
      this.simBuyBank.set(best.targetBank);
      this.simBuyPrice.set(best.buyPrice);
    }
  }

  private checkSoundAlert(route: ArbitrageRoute): void {
    if (!this.soundAlertsActive()) return;

    const targetMargin = this.radarService.targetNetMarginPct();
    if (route.metrics.netSpreadPct < targetMargin) {
      if (this.lastAlertedRouteId === route.routeId) {
        this.lastAlertedRouteId = null;
      }
      return;
    }

    if (this.lastAlertedRouteId !== route.routeId) {
      this.lastAlertedRouteId = route.routeId;
      this.audioAlerts.playOpportunityAlert();
    }
  }
}
