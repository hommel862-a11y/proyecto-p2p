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
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  VENEZUELAN_FX_BANKS,
  FX_DESK_MODALITIES,
  FX_EXIT_RAIL_OPTIONS,
  VEN_DEFAULT_IGTF_PCT,
  evaluateFxBankDeskPlan,
  evaluateVenezuelanFxWindow,
  getBcvMarketIntelligence,
  getVenezuelaTodayOperations,
  resolveFxInterventionBankId,
  roundMoney,
  selectPrimaryFxBankAccount,
  type FxBankDeskProfile,
  type FxBankOrderTicket,
  type FxCapitalAllocationMode,
  type FxDeskEvaluationPlan,
  type FxDeskModality,
  type FxExitRailType,
  type FxInterventionBankId,
} from '@p2p/core';
import { AccountsService } from '../../core/accounts.service';
import { CotizaveService, describeCotizaveProvenance } from '../../core/cotizave.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { TelegramWorkerService } from '../../core/telegram-worker.service';
import { AudioAlertsService } from '../../core/audio-alerts.service';
import { ToastService } from '../../core/toast.service';
import { FxKpiStripComponent } from './components/fx-kpi-strip.component';
import { FxTicketInspectorComponent } from './components/fx-ticket-inspector.component';
import { FxSettlementLedgerCardComponent } from './components/fx-settlement-ledger-card.component';

export const FX_SECTOR_FILTERS = {
  ALL: 'ALL',
  VIABLE: 'VIABLE',
  ESTADO: 'ESTADO',
  PRIVADO: 'PRIVADO',
} as const;

export type FxSectorFilter = (typeof FX_SECTOR_FILTERS)[keyof typeof FX_SECTOR_FILTERS];

function isFxExitRailType(val: string): val is FxExitRailType {
  return FX_EXIT_RAIL_OPTIONS.some((opt) => opt.id === val);
}

@Component({
  selector: 'app-fx-bank-desk',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DecimalPipe,
    RouterLink,
    FxKpiStripComponent,
    FxTicketInspectorComponent,
    FxSettlementLedgerCardComponent,
  ],
  templateUrl: './fx-bank-desk.component.html',
  styleUrls: ['./fx-bank-desk.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FxBankDeskComponent implements OnInit, OnDestroy {
  readonly accountsService = inject(AccountsService);
  readonly cotizave = inject(CotizaveService);
  readonly binance = inject(BinanceP2pService);
  readonly telegram = inject(TelegramWorkerService);
  private readonly audioAlerts = inject(AudioAlertsService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);

  readonly allBanks = VENEZUELAN_FX_BANKS;
  readonly exitRailOptions = FX_EXIT_RAIL_OPTIONS;
  readonly modalities = FX_DESK_MODALITIES;

  readonly modalityOptions: readonly { id: FxDeskModality; label: string }[] = [
    { id: FX_DESK_MODALITIES.MENUDEO_BCV, label: 'Menudeo BCV (0.25%)' },
    { id: FX_DESK_MODALITIES.MESA_CAMBIO_PACTO, label: 'Mesa de Cambio (Pacto)' },
    { id: FX_DESK_MODALITIES.TAQUILLA_EFECTIVO_OTC, label: 'Taquilla Efectivo (0% IGTF)' },
  ];

  // ─── Interactive Cockpit Controls ──────────────────────────────────────
  readonly sectorFilter = signal<FxSectorFilter>('ALL');
  readonly simulatedCapitalVes = signal<number>(120000);
  readonly simulatorMode = signal<boolean>(false);
  readonly showSimDrawer = signal<boolean>(false);
  readonly capitalPresetsVes: readonly number[] = [50000, 120000, 250000, 500000];
  readonly showRateOverrides = signal<boolean>(false);
  readonly manualBcvOverride = signal<number | null>(null);
  readonly manualP2pOverride = signal<number | null>(null);
  readonly hasManualRates = computed<boolean>(
    () => this.manualBcvOverride() !== null || this.manualP2pOverride() !== null,
  );
  readonly soundEnabled = signal<boolean>(true);
  readonly isSendingTelegram = signal<boolean>(false);
  readonly copiedBankId = signal<FxInterventionBankId | null>(null);
  readonly selectedBankId = signal<FxInterventionBankId | null>(null);

  /** Morning Burst Sequential Execution Queue ("Ráfaga Matutina"). */
  readonly burstQueueActive = signal<boolean>(false);
  readonly burstQueueIndex = signal<number>(0);

  /** Per-bank anti-WAF countdown seconds remaining after clicking portal launch. */
  readonly wafCooldownRemaining = signal<Partial<Record<FxInterventionBankId, number>>>({});
  private wafInterval: ReturnType<typeof setInterval> | null = null;

  // ─── Live & Fallback Rate Resolution (Executable Taker Sell Bid Priority) ─
  readonly liveBcvRate = computed<number | null>(() => {
    const manual = this.manualBcvOverride();
    if (manual !== null && Number.isFinite(manual) && manual > 0) return manual;
    const rates = this.cotizave.ratesByMarket();
    const mid = rates['bcv']?.mid ?? rates['oficial']?.mid ?? null;
    return mid && mid > 0 ? roundMoney(mid, 2) : null;
  });

  readonly liveP2pRate = computed<number | null>(() => {
    const manual = this.manualP2pOverride();
    if (manual !== null && Number.isFinite(manual) && manual > 0) return manual;
    const depth = this.binance.marketDepth();
    if (depth?.bestSellPrice && depth.bestSellPrice > 0) return roundMoney(depth.bestSellPrice, 2);
    if (depth?.bestBuyPrice && depth.bestBuyPrice > 0) return roundMoney(depth.bestBuyPrice, 2);
    const rates = this.cotizave.ratesByMarket();
    const bid = rates['binance']?.bid ?? rates['binance']?.ask ?? null;
    return bid && bid > 0 ? roundMoney(bid, 2) : null;
  });

  readonly bcvProvenanceLabel = computed<string>(() => {
    if (this.manualBcvOverride() !== null) return 'Manual Operador';
    return describeCotizaveProvenance(this.cotizave.ratesProvenance());
  });

  readonly bcvIntelligence = computed(() => {
    const bcv = this.liveBcvRate();
    const p2p = this.liveP2pRate();
    return getBcvMarketIntelligence(p2p, bcv);
  });

  readonly fxWindow = computed(() => evaluateVenezuelanFxWindow());
  readonly isWindowActive = computed<boolean>(() => this.fxWindow().isWindowOpen);

  readonly capitalAllocationMode = signal<FxCapitalAllocationMode>('PER_BANK');
  readonly isRefreshingFeeds = signal(false);
  readonly ledgerVersion = signal(0);

  // ─── Master FX Evaluation Plan (14 Banks) ──────────────────────────────
  readonly evaluationPlan = computed<FxDeskEvaluationPlan>(() => {
    return evaluateFxBankDeskPlan({
      bcvOfficialRateVes: this.liveBcvRate(),
      p2pSellRateVes: this.liveP2pRate(),
      modality: this.telegram.fxModality(),
      igtfPct: this.telegram.fxIgtfPct(),
      simulatedCapitalVes: this.simulatedCapitalVes(),
      useSimulatedCapital: this.simulatorMode(),
      capitalAllocationMode: this.capitalAllocationMode(),
      accounts: this.accountsService.accounts(),
      usages: this.accountsService.usages(),
      velocities: this.accountsService.accountVelocities(),
      confirmedFluidBanks: this.telegram.fxFluidBanks(),
      depletedBanks: this.telegram.fxDepletedBanks(),
      isBcvWindowOpen: this.isWindowActive(),
      exitRailOverrides: this.telegram.fxExitRailOverrides(),
    });
  });

  readonly selectedInspectorTicket = computed<FxBankOrderTicket | null>(() => {
    const tickets = this.evaluationPlan().tickets;
    const explicitId = this.selectedBankId();
    if (explicitId) {
      const found = tickets.find((t) => t.bank.id === explicitId);
      if (found) return found;
    }
    return tickets[0] ?? null;
  });

  readonly linkedTransferAccountsCount = computed<number>(
    () =>
      this.accountsService
        .accounts()
        .filter((a) => a.status !== 'DISABLED' && a.rail === 'TRANSFERENCIA').length,
  );

  readonly feedFreshnessLabel = computed<string>(() => {
    const bcvTs = this.cotizave.lastFetched();
    const p2pTs = this.binance.lastFetched();
    const fmt = (d: Date | null) =>
      d
        ? d.toLocaleTimeString('es-VE', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Caracas',
          })
        : 'pendiente';
    return `BCV ${fmt(bcvTs)} · P2P ${fmt(p2pTs)}`;
  });

  readonly settledTodayByBank = computed<
    Record<string, { usd: number; netUsdt: number; count: number }>
  >(() => {
    this.ledgerVersion();
    this.accountsService.usages();
    const ops = this.accountsService.rawOperations();
    const todayOps = getVenezuelaTodayOperations(ops);
    const accounts = this.accountsService.accounts();
    const summary: Record<string, { usd: number; netUsdt: number; count: number }> = {};

    for (const op of todayOps) {
      if (op.type !== 'buy' || !op.merchantNote?.startsWith('MESA_BCV:')) continue;
      const bodyAfterPrefix = op.merchantNote.slice('MESA_BCV:'.length);
      const usdMatch = bodyAfterPrefix.match(/:USD=([0-9]+(?:\.[0-9]+)?)/);
      const bankPart = bodyAfterPrefix.split(':USD=')[0].split('(')[0].trim();

      let bankId = resolveFxInterventionBankId(bankPart);
      if (!bankId && op.bankAccountId) {
        const linked = accounts.find((a) => a.id === op.bankAccountId);
        if (linked) {
          bankId = resolveFxInterventionBankId(linked.bankCode || linked.bankName);
        }
      }
      if (!bankId) continue;

      const purchasedUsd = usdMatch ? Number.parseFloat(usdMatch[1]) : op.usdtAmount;
      const prev = summary[bankId] ?? { usd: 0, netUsdt: 0, count: 0 };
      summary[bankId] = {
        usd: roundMoney(prev.usd + (Number.isFinite(purchasedUsd) ? purchasedUsd : op.usdtAmount), 2),
        netUsdt: roundMoney(prev.netUsdt + op.usdtAmount, 2),
        count: prev.count + 1,
      };
    }

    return summary;
  });

  readonly totalSettledToday = computed<{
    totalUsd: number;
    totalNetUsdt: number;
    opsCount: number;
  }>(() => {
    const entries = Object.values(this.settledTodayByBank());
    return entries.reduce(
      (acc, cur) => ({
        totalUsd: roundMoney(acc.totalUsd + cur.usd, 2),
        totalNetUsdt: roundMoney(acc.totalNetUsdt + cur.netUsdt, 2),
        opsCount: acc.opsCount + cur.count,
      }),
      { totalUsd: 0, totalNetUsdt: 0, opsCount: 0 },
    );
  });

  readonly viableTickets = computed<readonly FxBankOrderTicket[]>(() =>
    this.evaluationPlan().tickets.filter((t) => t.isViableOrder),
  );

  readonly currentBurstTicket = computed<FxBankOrderTicket | null>(() => {
    const list = this.viableTickets();
    if (list.length === 0) return null;
    const idx = Math.min(this.burstQueueIndex(), list.length - 1);
    return list[idx] ?? null;
  });

  readonly filteredTickets = computed<readonly FxBankOrderTicket[]>(() => {
    const tickets = this.evaluationPlan().tickets;
    const filter = this.sectorFilter();
    if (filter === 'ESTADO') return tickets.filter((t) => t.bank.sector === 'ESTADO');
    if (filter === 'PRIVADO') return tickets.filter((t) => t.bank.sector === 'PRIVADO');
    if (filter === 'VIABLE') return tickets.filter((t) => t.isViableOrder);
    return tickets;
  });

  readonly stateBanksCount = computed(
    () => this.allBanks.filter((b) => b.sector === 'ESTADO').length,
  );
  readonly privateBanksCount = computed(
    () => this.allBanks.filter((b) => b.sector === 'PRIVADO').length,
  );
  readonly viableTicketsCount = computed(
    () => this.evaluationPlan().tickets.filter((t) => t.isViableOrder).length,
  );

  ngOnInit(): void {
    void this.cotizave.refreshIfStale().catch(() => {});
    void this.telegram.refreshFxSettlementsFromSqlite?.().catch(() => {});
    if (!this.binance.marketDepth()) {
      void this.binance.fetchMarketDepth('USDT', 'VES', true).catch(() => {});
    }
    if (this.route.snapshot.queryParamMap.get('burst') === '1' && this.viableTickets().length > 0) {
      this.startMorningBurstRound();
    }
    this.wafInterval = setInterval(() => {
      const current = this.wafCooldownRemaining();
      const keys = Object.keys(current) as FxInterventionBankId[];
      if (keys.length === 0) return;
      const next: Partial<Record<FxInterventionBankId, number>> = {};
      for (const k of keys) {
        const val = (current[k] ?? 0) - 1;
        if (val > 0) next[k] = val;
      }
      this.wafCooldownRemaining.set(next);
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.wafInterval) {
      clearInterval(this.wafInterval);
      this.wafInterval = null;
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleBurstKeyboardShortcuts(event: KeyboardEvent): void {
    if (!this.burstQueueActive()) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
      return;
    }
    const burst = this.currentBurstTicket();
    if (!burst) return;

    if (event.code === 'Space') {
      event.preventDefault();
      this.copyOrderLotUsd(burst);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.settleAndAdvanceBurst(burst);
    } else if (event.key === 'e' || event.key === 'E') {
      event.preventDefault();
      this.skipDepletedAndAdvanceBurst(burst);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.stopMorningBurstRound();
    }
  }

  setModality(modality: FxDeskModality): void {
    this.telegram.setFxModality(modality);
  }

  toggleIgtfExemption(): void {
    const next = this.telegram.fxIgtfPct() > 0 ? 0 : VEN_DEFAULT_IGTF_PCT;
    this.telegram.setFxIgtfPct(next);
  }

  toggleSound(): void {
    this.soundEnabled.update((v) => !v);
  }

  toggleSimulatorMode(): void {
    const next = !this.simulatorMode();
    this.simulatorMode.set(next);
    if (next) this.showSimDrawer.set(true);
  }

  selectBankForInspector(bankId: FxInterventionBankId): void {
    this.selectedBankId.set(bankId);
  }

  setSectorFilter(filter: FxSectorFilter): void {
    this.sectorFilter.set(filter);
  }

  onSectorTabKeydown(event: KeyboardEvent): void {
    const order: readonly FxSectorFilter[] = ['ALL', 'VIABLE', 'ESTADO', 'PRIVADO'];
    const idx = order.indexOf(this.sectorFilter());
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.sectorFilter.set(order[(idx + 1) % order.length]);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.sectorFilter.set(order[(idx - 1 + order.length) % order.length]);
    }
  }

  useTotalTreasuryBalance(): void {
    const total = this.accountsService.treasurySummary().totalBalanceVes;
    if (total > 0) {
      this.simulatedCapitalVes.set(Math.round(total));
      this.simulatorMode.set(true);
      this.toast.info(
        `Simulador ajustado a tu liquidez total en cuentas: Bs. ${total.toLocaleString('es-VE')}`,
        '🏛️ Tesorería Sincronizada',
      );
    }
  }

  applyDemoRatesIfOffline(): void {
    if (this.liveBcvRate() === null) this.manualBcvOverride.set(62.45);
    if (this.liveP2pRate() === null) this.manualP2pOverride.set(84.1);
    this.toast.info(
      'Tasas de referencia activadas en modo contingencia. Puedes editarlas arriba en cualquier momento.',
      '⚡ Contingencia Activada',
    );
  }

  clearManualOverrides(): void {
    this.manualBcvOverride.set(null);
    this.manualP2pOverride.set(null);
    void this.cotizave.fetchRates();
  }

  copyOrderLotUsd(ticket: FxBankOrderTicket): void {
    const amountStr = String(ticket.recommendedOrderUsd);
    navigator.clipboard?.writeText(amountStr).catch(() => {});
    this.copiedBankId.set(ticket.bank.id);
    setTimeout(() => {
      if (this.copiedBankId() === ticket.bank.id) {
        this.copiedBankId.set(null);
      }
    }, 2000);
    this.toast.success(
      `Monto exacto $${amountStr} USD copiado (Múltiplo de $${ticket.bank.lotStepUsd} sin centavos para evitar rechazo en ${ticket.bank.shortName}).`,
      '📋 Lote Anti-Rechazo Copiado',
    );
  }

  launchBankPortal(ticket: FxBankOrderTicket, event?: MouseEvent): void {
    const rem = this.wafCooldownRemaining()[ticket.bank.id] ?? 0;
    if (rem > 0) {
      event?.preventDefault();
      this.toast.warn(
        `Espera ${rem}s antes de reintentar en ${ticket.bank.shortName} para evitar bloqueo preventivo de sesión (WAF).`,
        '🛡️ Cadencia Anti-Bloqueo Activa',
      );
      return;
    }

    if (typeof window !== 'undefined') {
      window.open(ticket.bank.portalUrl, '_blank', 'noopener,noreferrer');
    }

    if (ticket.recommendedOrderUsd > 0) {
      navigator.clipboard?.writeText(String(ticket.recommendedOrderUsd)).catch(() => {});
    }

    this.wafCooldownRemaining.update((curr) => ({
      ...curr,
      [ticket.bank.id]: ticket.bank.antiWafCooldownSec,
    }));

    this.toast.info(
      `Portal ${ticket.bank.shortName} abierto. Lote sugerido ($${ticket.recommendedOrderUsd} USD) copiado al portapapeles.`,
      '🚀 Mesa de Cambio Abierta',
    );
  }

  toggleFluidSignal(bankId: FxInterventionBankId): void {
    const isFluid = this.telegram.fxFluidBanks().includes(bankId);
    if (isFluid) {
      this.telegram.markFxBankDepleted(bankId);
      this.toast.warn(
        `${bankId} marcado sin cupo temporalmente. La ruta redistribuyó el capital.`,
        '🚫 Banco en Enfriamiento',
      );
    } else {
      this.telegram.markFxBankFluid(bankId);
      if (this.soundEnabled()) {
        this.audioAlerts.playOpportunityAlert();
      }
      this.toast.success(
        `¡Fluidez activa marcada en ${bankId}! Priorizado en el plan y en Telegram.`,
        '🟢 Fluidez Confirmada',
      );
    }
  }

  setCapitalAllocationMode(mode: FxCapitalAllocationMode): void {
    this.capitalAllocationMode.set(mode);
  }

  async refreshLiveFeeds(): Promise<void> {
    if (this.isRefreshingFeeds()) return;
    this.isRefreshingFeeds.set(true);
    try {
      await Promise.allSettled([
        this.cotizave.fetchRates(),
        this.binance.fetchMarketDepth('USDT', 'VES', false),
      ]);
      const bcvOk = this.liveBcvRate() !== null;
      const p2pOk = this.liveP2pRate() !== null;
      if (bcvOk && p2pOk) {
        this.toast.success(
          'Tasas BCV y profundidad Binance P2P actualizadas.',
          '🔄 Feeds Sincronizados',
        );
      } else {
        this.toast.warn(
          'Sincronización parcial: verificá tu conexión si falta alguna tasa.',
          '⚠️ Feeds Incompletos',
        );
      }
    } finally {
      this.isRefreshingFeeds.set(false);
    }
  }

  settlePurchaseInFifo(ticket: FxBankOrderTicket): void {
    if (ticket.recommendedOrderUsd <= 0) {
      this.toast.warn(
        'No hay un lote válido calculado para registrar en este banco.',
        '⚠️ Monto Inválido',
      );
      return;
    }
    const bcv = this.liveBcvRate() ?? undefined;
    const res = this.telegram.settleFxBankPurchase(
      ticket.bank.id,
      ticket.recommendedOrderUsd,
      bcv,
      {
        modality: this.telegram.fxModality(),
        igtfPct: this.telegram.fxIgtfPct(),
        channel: 'DESKTOP_UI',
        allowUnlinkedSimulation: this.simulatorMode(),
      },
    );
    if (res) {
      this.ledgerVersion.update((v) => v + 1);
      if (this.soundEnabled()) {
        this.audioAlerts.playOpportunityAlert();
      }
      this.toast.success(
        `Pacto asentado en contabilidad FIFO y SQLite (${res.summary}).`,
        '✅ Compra Registrada en FIFO',
      );
    } else {
      this.toast.warn(
        'Bloqueado: verificá tasa BCV activa y contar con una cuenta TRANSFERENCIA vinculada con saldo suficiente.',
        '⚠️ Pacto No Registrado',
      );
    }
  }

  quickLinkBankAccount(bank: FxBankDeskProfile): void {
    const targetBalanceVes = Math.max(0, Math.round(this.simulatedCapitalVes()));
    const existing = selectPrimaryFxBankAccount(
      bank,
      this.accountsService.accounts(),
      this.accountsService.usages(),
    ).account;

    if (existing) {
      this.accountsService.setExactAccountBalance(
        existing.id,
        targetBalanceVes,
        'Calibración desde Mesa Cambiaria BCV',
      );
      this.toast.success(
        `Saldo de ${existing.bankName} calibrado a Bs. ${targetBalanceVes.toLocaleString('es-VE')}.`,
        '🏦 Saldo Bancario Calibrado',
      );
      return;
    }

    this.accountsService.addAccount({
      bankName: `${bank.shortName} Mesa Divisas`,
      bankCode: bank.coreBankCode,
      rail: 'TRANSFERENCIA',
      accountNumberMasked: `${bank.abaCode}-***0001`,
      dailyLimitVes: 250000,
      initialBalanceVes: targetBalanceVes,
    });
    this.toast.success(
      `Cuenta de ${bank.name} vinculada a tu tesorería con Bs. ${targetBalanceVes.toLocaleString('es-VE')}.`,
      '🏦 Cuenta Vinculada en 1 Clic',
    );
  }

  async pushPlanToTelegram(bankId?: FxInterventionBankId): Promise<void> {
    this.isSendingTelegram.set(true);
    try {
      const res = await this.telegram.sendFxDeskPlanAlert(this.evaluationPlan(), bankId);
      if (res.ok) {
        this.toast.success(
          'Alerta interactiva con botones firmados de 1 uso enviada a tu Telegram privado.',
          '📲 Despachado a Telegram Sentinel',
        );
      } else {
        this.toast.warn(res.error || 'No se pudo enviar a Telegram.', '⚠️ Telegram No Vinculado');
      }
    } finally {
      this.isSendingTelegram.set(false);
    }
  }

  onChangeExitRail(bankId: FxInterventionBankId, railId: string): void {
    if (!isFxExitRailType(railId)) return;
    this.telegram.setFxExitRailOverride(bankId, railId);
    this.toast.info(
      `Riel de salida actualizado para ${bankId}. Ganancia e IGTF recalculados.`,
      '🔄 Riel de Liquidación Actualizado',
    );
  }

  depletedMinutesRemaining(bankId: FxInterventionBankId): number {
    const exp = this.telegram.fxDepletedExpiryMap()[bankId];
    if (!exp) return 30;
    return Math.max(1, Math.ceil((exp - Date.now()) / 60_000));
  }

  startMorningBurstRound(): void {
    const list = this.viableTickets();
    if (list.length === 0) {
      this.toast.warn(
        'Activa tasas o vincula capital en cuentas TRANSFERENCIA para tener bancos viables en la cola.',
        '⚡ Ráfaga sin Bancos Listos',
      );
      return;
    }
    this.burstQueueIndex.set(0);
    this.burstQueueActive.set(true);
    const first = list[0];
    if (first) {
      this.selectedBankId.set(first.bank.id);
      if (first.recommendedOrderUsd > 0) {
        this.copyOrderLotUsd(first);
      }
    }
  }

  advanceBurstRound(): void {
    const list = this.viableTickets();
    if (list.length === 0) {
      this.burstQueueActive.set(false);
      return;
    }
    const nextIdx = this.burstQueueIndex() + 1;
    if (nextIdx >= list.length) {
      this.burstQueueActive.set(false);
      this.burstQueueIndex.set(0);
      this.toast.success(
        'Completaste el recorrido de todos los bancos viables de la ronda.',
        '🏁 Ronda Matutina Completada',
      );
      return;
    }
    this.burstQueueIndex.set(nextIdx);
    const nextTicket = list[nextIdx];
    if (nextTicket) {
      this.selectedBankId.set(nextTicket.bank.id);
      if (nextTicket.recommendedOrderUsd > 0) {
        this.copyOrderLotUsd(nextTicket);
      }
    }
  }

  settleAndAdvanceBurst(ticket: FxBankOrderTicket): void {
    this.settlePurchaseInFifo(ticket);
    this.advanceBurstRound();
  }

  skipDepletedAndAdvanceBurst(ticket: FxBankOrderTicket): void {
    this.telegram.markFxBankDepleted(ticket.bank.id);
    this.toast.warn(
      `${ticket.bank.shortName} en enfriamiento por 30m. Pasando al siguiente banco viable.`,
      '⏭️ Banco Saltado (30m)',
    );
    const list = this.viableTickets();
    if (list.length === 0) {
      this.burstQueueActive.set(false);
      return;
    }
    const idx = Math.min(this.burstQueueIndex(), list.length - 1);
    this.burstQueueIndex.set(idx);
    const current = list[idx];
    if (current) {
      this.selectedBankId.set(current.bank.id);
      if (current.recommendedOrderUsd > 0) {
        this.copyOrderLotUsd(current);
      }
    }
  }

  stopMorningBurstRound(): void {
    this.burstQueueActive.set(false);
  }
}
