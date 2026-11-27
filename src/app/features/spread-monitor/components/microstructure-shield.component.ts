import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { type AccountUsage, type MarketDataPoint } from '@p2p/core';
import { AccountsService } from '../../../core/accounts.service';
import { AudioAlertsService } from '../../../core/audio-alerts.service';
import { BinanceExecutionBridgeService } from '../../../core/binance-execution-bridge.service';
import { BinanceP2pService, type BinanceFreshnessStatus } from '../../../core/binance-p2p.service';
import { HOTKEY_ACTIONS, HotkeysService } from '../../../core/hotkeys.service';
import { MarketHistoryService } from '../../../core/market-history.service';
import {
  MicrostructureEngineService,
  TRAP_SEVERITIES,
  type MicrostructureDeskPayload,
  type MicrostructureRepricerPayload,
} from '../../../core/microstructure-engine.service';
import { ToastService } from '../../../core/toast.service';
import { MicrostructureAuditTableComponent } from './microstructure/microstructure-audit-table.component';
import { MicrostructureKpiStripComponent } from './microstructure/microstructure-kpi-strip.component';
import { MicrostructureOrderbookLadderComponent } from './microstructure/microstructure-orderbook-ladder.component';
import { MicrostructureQuantAdvisorComponent } from './microstructure/microstructure-quant-advisor.component';
import {
  BANK_FILTER_OPTIONS,
  TICKET_PRESETS_USDT,
  type BankQuotaPill,
  type BankSaturationWarning,
  type MicrostructureApplyPriceEvent,
  type MicrostructureOperateBracketEvent,
  type MicrostructureTakeOfferEvent,
  type MicrostructureTelegramPayload,
  type MicrostructureWhatIfPreview,
} from './microstructure/microstructure.types';

export type {
  BankQuotaPill,
  BankSaturationWarning,
  MicrostructureApplyPriceEvent,
  MicrostructureOperateBracketEvent,
  MicrostructureTakeOfferEvent,
  MicrostructureTelegramPayload,
  MicrostructureWhatIfPreview,
};

function computeBankPoolQuotaPct(usages: readonly AccountUsage[], bankCode: string): number {
  if (usages.length === 0) return 0;
  const active = usages.filter((u) => u.account.status !== 'DISABLED');
  const source = active.length > 0 ? active : usages;

  let matching: readonly AccountUsage[];
  if (bankCode === 'ALL') {
    matching = source;
  } else if (bankCode === 'PAGO_MOVIL') {
    matching = source.filter((u) => u.account.rail === 'PAGO_MOVIL');
  } else {
    matching = source.filter((u) => u.account.bankCode === bankCode);
  }

  if (matching.length === 0) return 0;
  const avg = matching.reduce((sum, u) => sum + u.consumedLimitPct, 0) / matching.length;
  return Math.round(avg);
}

function formatAgeLabel(ageMs: number | null, status: BinanceFreshnessStatus): string {
  if (status === 'OFFLINE' || ageMs === null || !Number.isFinite(ageMs)) {
    return 'Sin señal';
  }
  const secs = Math.max(0, Math.round(ageMs / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  return `${mins}m`;
}

@Component({
  selector: 'app-microstructure-shield',
  standalone: true,
  imports: [
    MicrostructureKpiStripComponent,
    MicrostructureOrderbookLadderComponent,
    MicrostructureQuantAdvisorComponent,
    MicrostructureAuditTableComponent,
  ],
  templateUrl: './microstructure-shield.component.html',
  styleUrl: './microstructure-shield.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MicrostructureShield {
  readonly engine = inject(MicrostructureEngineService);
  private readonly binance = inject(BinanceP2pService);
  private readonly accounts = inject(AccountsService);
  private readonly marketHistory = inject(MarketHistoryService, { optional: true });
  private readonly audioAlerts = inject(AudioAlertsService, { optional: true });
  private readonly executionBridge = inject(BinanceExecutionBridgeService, { optional: true });
  private readonly hotkeys = inject(HotkeysService, { optional: true });
  private readonly toast = inject(ToastService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  // Optional inputs — `<app-microstructure-shield />` works standalone with engine defaults
  readonly liveBreakEvenSellPrice = input<number | null>(null);
  readonly currentInventoryUsdt = input<number | null>(null);
  readonly targetInventoryUsdt = input<number | null>(null);
  readonly bcvRateVes = input<number | null>(null);
  readonly splitDrawerOpen = input<boolean>(false);

  // Outputs for SpreadMonitor / Repricer / Ad Studio / Telegram integration
  readonly applyPrice = output<MicrostructureApplyPriceEvent>();
  readonly takeOffer = output<MicrostructureTakeOfferEvent>();
  readonly applyToDesk = output<MicrostructureDeskPayload>();
  readonly sendToRepricer = output<MicrostructureRepricerPayload>();
  readonly openAdStudio = output<MicrostructureDeskPayload>();
  readonly sendTelegramAlert = output<MicrostructureTelegramPayload>();
  readonly hoverWhatIf = output<MicrostructureWhatIfPreview | null>();
  readonly togglePinnedDrawer = output<void>();

  readonly ticketPresets = TICKET_PRESETS_USDT;
  readonly activeWhatIf = signal<MicrostructureWhatIfPreview | null>(null);
  readonly selectiveAudioEnabled = signal<boolean>(true);

  private hasObservedAudioBaseline = false;
  private lastTrapAlerted = false;
  private lastSaturationAlerted = false;
  private lastOptimalAlerted = false;

  readonly selectedBank = computed<string>(() => this.binance.selectedBank());
  readonly freshnessStatus = this.engine.freshnessStatus;

  readonly isExecutionLocked = computed<boolean>(() => {
    const status = this.freshnessStatus();
    return status === 'STALE' || status === 'OFFLINE';
  });

  readonly isLoading = computed<boolean>(() => {
    const candidate = (this.binance as unknown as { loading?: () => boolean }).loading;
    return typeof candidate === 'function' ? candidate() : false;
  });

  readonly freshnessAgeLabel = computed<string>(() => {
    const status = this.freshnessStatus();
    const ageFn = (this.binance as unknown as { depthAgeMs?: () => number | null }).depthAgeMs;
    if (typeof ageFn === 'function') {
      return formatAgeLabel(ageFn(), status);
    }
    const fetchedAt = this.binance.lastFetched?.() ?? null;
    const fallbackAge = fetchedAt ? Math.max(0, Date.now() - fetchedAt.getTime()) : null;
    return formatAgeLabel(fallbackAge, status);
  });

  readonly isAudioMuted = computed<boolean>(() => {
    return (this.audioAlerts?.isMuted?.() ?? false) || !this.selectiveAudioEnabled();
  });

  readonly historyPoints = computed<readonly MarketDataPoint[]>(() => {
    if (!this.marketHistory) return [];
    return this.marketHistory.getFilteredPoints(this.selectedBank());
  });

  readonly bankQuotaPills = computed<readonly BankQuotaPill[]>(() => {
    const usages = this.accounts.treasurySummary().accountsUsage;
    const current = this.selectedBank();

    return BANK_FILTER_OPTIONS.map((opt) => {
      const quotaPct = computeBankPoolQuotaPct(usages, opt.code);
      return {
        code: opt.code,
        label: opt.label,
        quotaPct,
        isWarning: quotaPct > 85 && quotaPct < 100,
        isCritical: quotaPct >= 100,
        isActive: current.toUpperCase() === opt.code,
      };
    });
  });

  readonly saturationWarning = computed<BankSaturationWarning | null>(() => {
    const pills = this.bankQuotaPills();
    const activePill = pills.find((p) => p.isActive) ?? pills[0];
    if (!activePill || activePill.quotaPct <= 85) {
      return null;
    }

    const candidates = pills.filter(
      (p) => p.code !== 'ALL' && p.code !== activePill.code && p.quotaPct < activePill.quotaPct,
    );
    const rotationAccount = this.accounts.rotationRecommendation?.();
    const recFromService = rotationAccount
      ? candidates.find((p) => p.code === rotationAccount.bankCode)
      : undefined;
    const sorted = [...candidates].sort((a, b) => a.quotaPct - b.quotaPct);
    const healthiest = recFromService ?? sorted[0];

    if (!healthiest) return null;

    return {
      bankCode: activePill.code,
      bankLabel: activePill.label,
      quotaPct: activePill.quotaPct,
      recommendedBankCode: healthiest.code,
      recommendedBankLabel: healthiest.label,
      recommendedQuotaPct: healthiest.quotaPct,
    };
  });

  readonly ladderBuyOffers = computed(() => {
    const rows = this.engine.enrichedBuyOffers();
    return this.engine.verifiedProOnly()
      ? rows.filter((r) => r.isVerifiedPro && !r.isBlockedCounterparty)
      : rows;
  });

  readonly ladderSellOffers = computed(() => {
    const rows = this.engine.enrichedSellOffers();
    return this.engine.verifiedProOnly()
      ? rows.filter((r) => r.isVerifiedPro && !r.isBlockedCounterparty)
      : rows;
  });

  constructor() {
    this.setupInputSyncEffects();
    this.setupSelectiveAudioEffect();
    this.registerHotkeys();
  }

  private setupInputSyncEffects(): void {
    effect(() => {
      const val = this.liveBreakEvenSellPrice();
      if (val !== null && Number.isFinite(val) && val >= 0) {
        this.engine.liveBreakEvenSellPrice.set(val);
      }
    });

    effect(() => {
      const current = this.currentInventoryUsdt();
      if (current !== null && Number.isFinite(current) && current >= 0) {
        this.engine.currentInventoryUsdt.set(current);
      }
    });

    effect(() => {
      const target = this.targetInventoryUsdt();
      if (target !== null && Number.isFinite(target) && target > 0) {
        this.engine.targetInventoryUsdt.set(target);
      }
    });

    effect(() => {
      const bcv = this.bcvRateVes();
      if (bcv !== null && Number.isFinite(bcv) && bcv > 0) {
        this.engine.bcvRateVes.set(bcv);
      }
    });
  }

  private setupSelectiveAudioEffect(): void {
    effect(() => {
      const trap = this.engine.makerVsTakerComparison().apparentVsCleanSpreadTrap;
      const sqs = this.engine.sqsResult();
      const warning = this.saturationWarning();

      const severeTrap =
        trap.isTrap &&
        (trap.severity === TRAP_SEVERITIES.HIGH || trap.severity === TRAP_SEVERITIES.CRITICAL);
      const isSaturated = warning !== null;
      const isOptimal = sqs?.verdict === 'OPTIMAL';

      if (!this.hasObservedAudioBaseline) {
        this.hasObservedAudioBaseline = true;
        this.lastTrapAlerted = severeTrap;
        this.lastSaturationAlerted = isSaturated;
        this.lastOptimalAlerted = isOptimal;
        return;
      }

      if (!this.isAudioMuted()) {
        if (severeTrap && !this.lastTrapAlerted) {
          this.audioAlerts?.playKillSwitchAlert?.();
        } else if (isSaturated && !this.lastSaturationAlerted) {
          this.audioAlerts?.playSudebanWarningTone?.();
        } else if (isOptimal && !this.lastOptimalAlerted) {
          this.audioAlerts?.playOpportunityAlert?.();
        }
      }

      this.lastTrapAlerted = severeTrap;
      this.lastSaturationAlerted = isSaturated;
      this.lastOptimalAlerted = isOptimal;
    });
  }

  private registerHotkeys(): void {
    if (!this.hotkeys) return;
    const unsubs = [
      this.hotkeys.register(HOTKEY_ACTIONS.TOGGLE_CLEAN_MODE, () => {
        this.toggleCleanMode();
      }),
      this.hotkeys.register(HOTKEY_ACTIONS.BRACKET_1, () => {
        this.engine.selectedBracket.set('INFRAMUNDO');
      }),
      this.hotkeys.register(HOTKEY_ACTIONS.BRACKET_2, () => {
        this.engine.selectedBracket.set('MEDIO');
      }),
      this.hotkeys.register(HOTKEY_ACTIONS.BRACKET_3, () => {
        this.engine.selectedBracket.set('INSTITUCIONAL');
      }),
      this.hotkeys.register(HOTKEY_ACTIONS.APPLY_MAKER_OPTIMAL, () => {
        this.onApplyMakerOptimal();
      }),
      this.hotkeys.register(HOTKEY_ACTIONS.APPLY_TAKER_VWAP, () => {
        this.onApplyTakerVwap();
      }),
    ];

    this.destroyRef.onDestroy(() => {
      for (const unsub of unsubs) {
        unsub();
      }
    });
  }

  forceScan(): void {
    void this.binance.fetchMarketDepth('USDT', 'VES');
    this.toast?.info('Sincronizando libro L2 Binance P2P...');
  }

  selectBank(bankCode: string): void {
    this.binance.setBankFilter(bankCode);
  }

  rotateToHealthiestBank(): void {
    const warning = this.saturationWarning();
    if (!warning) return;
    this.binance.setBankFilter(warning.recommendedBankCode);
    this.toast?.info(
      `Rotado a ${warning.recommendedBankLabel} (${warning.recommendedQuotaPct}% cupo SUDEBAN).`,
      'Rotación Bancaria',
    );
  }

  setTargetUsdt(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.engine.targetUsdt.set(Math.round(amount));
  }

  onTicketInputChange(rawValue: string): void {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed) && parsed >= 20) {
      this.engine.targetUsdt.set(Math.round(parsed));
    }
  }

  toggleCleanMode(): void {
    this.engine.cleanModeEnabled.update((v) => !v);
  }

  toggleVerifiedPro(): void {
    this.engine.verifiedProOnly.update((v) => !v);
  }

  toggleAudioAlerts(): void {
    if (this.audioAlerts?.toggleMute) {
      this.audioAlerts.toggleMute();
    } else {
      this.selectiveAudioEnabled.update((v) => !v);
    }
  }

  onHoverRow(preview: MicrostructureWhatIfPreview | null): void {
    this.activeWhatIf.set(preview);
    this.hoverWhatIf.emit(preview);
  }

  onFixLadderPrice(event: MicrostructureApplyPriceEvent): void {
    if (this.isExecutionLocked()) return;
    this.applyPrice.emit(event);
    if (!this.isAudioMuted()) {
      this.audioAlerts?.playConfirmationTone?.();
    }
  }

  onTakeOffer(event: MicrostructureTakeOfferEvent): void {
    this.takeOffer.emit(event);
    void this.executionBridge?.executeOfferAction({
      action: event.side,
      offer: {
        advNo: event.offer.advNo,
        advertiserNo: event.offer.advertiserNo,
        merchantName: event.offer.merchantName,
        price: event.offer.price,
        surplusAmount: event.offer.surplusAmount,
        minVes: event.offer.minVes,
        maxVes: event.offer.maxVes,
        buyerKycLimit: event.offer.buyerKycLimit,
        buyerRegDaysLimit: event.offer.buyerRegDaysLimit,
        buyerBtcPositionLimit: event.offer.buyerBtcPositionLimit,
        takerAdditionalKycRequired: event.offer.takerAdditionalKycRequired,
        payMethods: event.offer.payMethods,
      },
      expectedPrice: event.offer.price,
      targetUsdt: this.engine.targetUsdt(),
      bank: this.selectedBank() !== 'ALL' ? this.selectedBank() : undefined,
      preferAdvertiser: event.preferAdvertiser,
    });
  }

  onOperateBracket(event: MicrostructureOperateBracketEvent): void {
    if (this.isExecutionLocked()) return;
    this.engine.selectedBracket.set(event.bracketId);
    this.applyPrice.emit({
      side: event.side,
      price: event.price,
      source: `BRACKET_${event.bracketId}`,
    });
  }

  onApplyMakerOptimal(): void {
    if (this.isExecutionLocked()) return;
    const cmp = this.engine.makerVsTakerComparison();
    const side = this.engine.selectedSide();
    const price = side === 'BUY' ? cmp.makerBuyPrice : cmp.makerSellPrice;
    if (price <= 0) return;

    this.applyPrice.emit({ side, price, source: 'HOTKEY_MAKER_OPTIMAL' });
    this.applyToDesk.emit(cmp.deskPayload);
  }

  onApplyTakerVwap(): void {
    if (this.isExecutionLocked()) return;
    const vwap = this.engine.tradeImpact().effectiveVwapPrice;
    const side = this.engine.selectedSide();
    if (vwap <= 0) return;

    this.applyPrice.emit({ side, price: vwap, source: 'HOTKEY_TAKER_VWAP' });
    this.applyToDesk.emit({
      ...this.engine.makerVsTakerComparison().deskPayload,
      customPriceVes: vwap,
      sourceLabel: 'Microestructura L2 · VWAP Taker',
    });
  }

  onApplyToDesk(): void {
    if (this.isExecutionLocked()) return;
    const payload = this.engine.makerVsTakerComparison().deskPayload;
    this.applyToDesk.emit(payload);
    if (!this.isAudioMuted()) {
      this.audioAlerts?.playConfirmationTone?.();
    }
  }

  onSendToRepricer(): void {
    if (this.isExecutionLocked()) return;
    const payload = this.engine.makerVsTakerComparison().repricerPayload;
    this.sendToRepricer.emit(payload);
    if (!this.isAudioMuted()) {
      this.audioAlerts?.playConfirmationTone?.();
    }
  }

  onOpenAdStudio(): void {
    if (this.isExecutionLocked()) return;
    const payload = this.engine.makerVsTakerComparison().deskPayload;
    this.openAdStudio.emit(payload);
  }

  onSendTelegramAlert(): void {
    const sqs = this.engine.sqsResult();
    const cmp = this.engine.makerVsTakerComparison();
    const trap = cmp.apparentVsCleanSpreadTrap;
    const bank = this.selectedBank();
    const target = this.engine.targetUsdt();

    const summaryText = [
      `Microestructura L2 (${bank} · $${target} USDT)`,
      `SQS: ${sqs ? `${Math.round(sqs.score)}/100 (${sqs.verdictLabel})` : 'N/D'}`,
      `Spread Limpio: ${trap.cleanSpreadPct.toFixed(2)}% (Aparente: ${trap.apparentSpreadPct.toFixed(2)}%)`,
      `Modo: ${cmp.recommendedMode} | C: ${cmp.makerBuyPrice.toFixed(2)} Bs / V: ${cmp.makerSellPrice.toFixed(2)} Bs`,
      trap.isTrap ? `ALERTA: ${trap.message}` : '',
    ]
      .filter((line) => line.length > 0)
      .join(' | ');

    this.sendTelegramAlert.emit({
      title: `Pulso Microestructura L2 · ${bank}`,
      sqsScore: sqs ? Math.round(sqs.score) : null,
      verdictLabel: sqs?.verdictLabel ?? 'Sin datos',
      cleanSpreadPct: trap.cleanSpreadPct,
      apparentSpreadPct: trap.apparentSpreadPct,
      isTrap: trap.isTrap,
      trapMessage: trap.message,
      recommendedMode: cmp.recommendedMode,
      makerBuyPrice: cmp.makerBuyPrice,
      makerSellPrice: cmp.makerSellPrice,
      bankFilter: bank,
      targetUsdt: target,
      summaryText,
    });
  }

  onToggleSplitDrawer(): void {
    this.togglePinnedDrawer.emit();
  }
}
