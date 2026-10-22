import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  P2PRadarService,
  RADAR_BANK_LABELS,
  BANK_PRESETS,
  type BankPresetId,
} from '../../core/p2p-radar.service';
import { AudioAlertsService } from '../../core/audio-alerts.service';
import { ToastService } from '../../core/toast.service';
import {
  type P2PUserTier,
  type ExecutionMode,
  type CleanRadarOffer,
  type RadarCleanBook,
  type ArbitrageRoute,
  type BotDetectionResult,
  type MarketTrendResult,
  RADAR_VOLUME_BRACKETS,
} from '@p2p/core';

@Component({
  selector: 'app-p2p-radar',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './p2p-radar.component.html',
  styleUrls: ['./p2p-radar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class P2PRadarComponent implements OnInit, OnDestroy {
  readonly radarService = inject(P2PRadarService);
  private readonly audioAlerts = inject(AudioAlertsService);
  private readonly toast = inject(ToastService);

  readonly bankLabels = RADAR_BANK_LABELS;
  readonly volumeBrackets = RADAR_VOLUME_BRACKETS;
  readonly availableBanks = Object.keys(RADAR_BANK_LABELS);

  readonly bankGroups = [
    {
      id: 'TOP_VES',
      label: 'Top Líderes',
      banks: ['Banesco', 'Mercantil', 'SpecificBank', 'PagoMovil'],
    },
    {
      id: 'COMMERCIAL_VES',
      label: 'Banca Comercial',
      banks: ['BBVA', 'BNC', 'Bancaribe', 'Banplus'],
    },
    {
      id: 'INTL_USD',
      label: 'Divisas / Fintech',
      banks: ['BanescoPanama', 'Zinli'],
    },
  ];

  // ─── Component Local State ─────────────────────────────────────────
  readonly cleanModalOpen = signal<boolean>(false);
  readonly soundAlertsActive = signal<boolean>(true);
  readonly currentTickerIndex = signal<number>(0);
  readonly copiedTarget = signal<string | null>(null);

  // Interactive Simulator inputs
  readonly simBuyBank = signal<string>('Banesco');
  readonly simSellBank = signal<string>('Banesco');
  readonly simBuyPrice = signal<number>(0);
  readonly simSellPrice = signal<number>(0);

  // Modal temporary values for Clean Mode tuning
  readonly modalMaxPayTime = signal<number>(15);
  readonly modalMinFinishRate = signal<number>(92);
  readonly modalMinOrders = signal<number>(30);
  readonly modalMaxOutlierDevPct = signal<number>(0.8);

  private tickerTimer: ReturnType<typeof setInterval> | null = null;
  private lastAlertedRouteId: string | null = null;

  // ─── Computed Properties ───────────────────────────────────────────
  readonly activeBanks = computed(() => this.radarService.activePaymentMethods());

  readonly activePreset = computed<BankPresetId | 'CUSTOM'>(() => {
    const current = this.radarService.activePaymentMethods();
    if (current.length === 0) return 'CLEAR';
    const top = BANK_PRESETS.TOP_VES;
    if (current.length === top.length && top.every((b) => current.includes(b))) {
      return 'TOP_VES';
    }
    const all = BANK_PRESETS.ALL_VES;
    if (current.length === all.length && all.every((b) => current.includes(b))) {
      return 'ALL_VES';
    }
    const exp = BANK_PRESETS.EXPANDED;
    if (current.length === exp.length && exp.every((b) => current.includes(b))) {
      return 'EXPANDED';
    }
    return 'CUSTOM';
  });

  readonly simulatedMetrics = computed(() => {
    const buy = this.simBuyPrice();
    const sell = this.simSellPrice();
    const buyBank = this.simBuyBank();
    const sellBank = this.simSellBank();
    const isInterbank = buyBank !== sellBank;
    const friction = isInterbank ? this.radarService.interbankFrictionPct() : 0;

    return this.radarService.simulateArbitrage(buy, sell, {
      fiatFrictionPct: friction,
    });
  });

  readonly currentTickerRoute = computed<ArbitrageRoute | null>(() => {
    const routes = this.radarService.topRoutes();
    if (routes.length === 0) return null;
    const idx = this.currentTickerIndex() % routes.length;
    return routes[idx] ?? null;
  });

  ngOnInit(): void {
    // Sync modal values with active clean config
    const cfg = this.radarService.cleanConfig();
    this.modalMaxPayTime.set(cfg.maxPayTimeMinutes);
    this.modalMinFinishRate.set(cfg.minMonthFinishRate);
    this.modalMinOrders.set(cfg.minMonthOrderCount);
    this.modalMaxOutlierDevPct.set(cfg.outlierDeviationPct);

    // Initial scan if books are empty
    if (this.radarService.radarBooks().size === 0) {
      this.scanRadar();
    } else {
      this.initSimulatorFromBestRoute();
    }

    // Auto-rotative ticker every 8 seconds
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
  }

  // ─── Actions ───────────────────────────────────────────────────────
  async scanRadar(): Promise<void> {
    const books = await this.radarService.scanRadar();
    if (books.size > 0) {
      this.initSimulatorFromBestRoute();
    }
  }

  setUserTier(tier: P2PUserTier): void {
    this.radarService.setUserTier(tier);
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

  // ─── Interactive Simulator ─────────────────────────────────────────
  selectOfferForSimulation(bank: string, side: 'BUY' | 'SELL', offer: CleanRadarOffer): void {
    if (side === 'BUY') {
      this.simBuyBank.set(bank);
      this.simBuyPrice.set(offer.price);
    } else {
      this.simSellBank.set(bank);
      this.simSellPrice.set(offer.price);
    }
    this.toast.info(`Cargado ${offer.price.toFixed(2)} VES (${this.bankLabels[bank] || bank} ${side}) en simulador`);
  }

  loadRouteIntoSimulator(route: ArbitrageRoute): void {
    this.simSellBank.set(route.sourceBank);
    this.simSellPrice.set(route.sellPrice);
    this.simBuyBank.set(route.targetBank);
    this.simBuyPrice.set(route.buyPrice);
    this.toast.success(`Ruta ${route.sourceBank} ➔ ${route.targetBank} cargada en simulador`);
  }

  copyRateToClipboard(rate: number, label: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(rate.toFixed(2));
      this.copiedTarget.set(label);
      this.toast.info(`Tasa copiada: ${rate.toFixed(2)} VES`);
      setTimeout(() => {
        if (this.copiedTarget() === label) {
          this.copiedTarget.set(null);
        }
      }, 2500);
    }
  }

  toggleSoundAlerts(): void {
    const next = !this.soundAlertsActive();
    this.soundAlertsActive.set(next);
    if (next) {
      this.audioAlerts.playOpportunityAlert();
      this.toast.info('Alertas sonoras activadas.');
    } else {
      this.toast.warn('Alertas sonoras silenciadas.');
    }
  }

  // ─── Phase 5: Cycle Recording & Daily Journal ──────────────────────
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

  copyDailySummaryToClipboard(): void {
    const summary = this.radarService.dailyConsolidated();
    if (summary.totalCycles === 0) {
      this.toast.warn('No hay ciclos completados registrados el día de hoy.');
      return;
    }

    const text = [
      `📊 RESUMEN DIARIO ARBITRAJE P2P [${summary.dateKey}]`,
      `──────────────────────────────────────────────`,
      `• Ciclos Completados: ${summary.totalCycles} (${summary.monobankCyclesCount} monobanco, ${summary.interbankCyclesCount} interbancario)`,
      `• Volumen Operado: $${summary.totalTurnoverUsdt.toFixed(2)} USDT`,
      `• Ganancia Neta Total: +$${summary.totalNetProfitUsdt.toFixed(2)} USDT (+Bs ${summary.totalNetProfitFiat.toFixed(2)})`,
      `• Spread Neto Promedio: +${summary.averageNetSpreadPct.toFixed(2)}%`,
      `• Mejor Spread del Día: +${summary.bestSpreadPct.toFixed(2)}%`,
      `──────────────────────────────────────────────`,
      `Generado por P2P Decisor - Terminal Cuantitativa`,
    ].join('\n');

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      this.toast.success('Resumen diario consolidado copiado al portapapeles.');
    }
  }

  toggleHudBridge(): void {
    this.radarService.toggleHudBroadcasting();
  }

  // ─── Modal Clean Mode Management ───────────────────────────────────
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

  saveCleanModalSettings(): void {
    this.radarService.updateCleanConfig({
      maxPayTimeMinutes: Number(this.modalMaxPayTime()) || 15,
      minMonthFinishRate: Number(this.modalMinFinishRate()) || 92,
      minMonthOrderCount: Number(this.modalMinOrders()) || 30,
      outlierDeviationPct: Number(this.modalMaxOutlierDevPct()) || 0.8,
    });
    this.cleanModalOpen.set(false);
    this.toast.success('Reglas de Modo Limpio actualizadas y libros re-filtrados.');
  }

  // ─── Helpers ───────────────────────────────────────────────────────
  getBook(bank: string, side: 'BUY' | 'SELL'): RadarCleanBook | undefined {
    return this.radarService.radarBooks().get(`${bank}_${side}`);
  }

  getTrend(bank: string, side: 'BUY' | 'SELL'): MarketTrendResult | undefined {
    return this.radarService.getTrendForBook(bank, side);
  }

  getBots(bank: string, side: 'BUY' | 'SELL'): BotDetectionResult[] {
    return this.radarService.getBotsForBook(bank, side);
  }

  isOfferBot(bank: string, side: 'BUY' | 'SELL', offer: CleanRadarOffer): BotDetectionResult | undefined {
    const bots = this.getBots(bank, side);
    return bots.find((b) => b.advertiserNo === offer.advertiserNo);
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
    if (
      route.metrics.netSpreadPct >= targetMargin &&
      route.routeId !== this.lastAlertedRouteId
    ) {
      this.lastAlertedRouteId = route.routeId;
      this.audioAlerts.playOpportunityAlert();
    }
  }
}
