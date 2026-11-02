import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  VENEZUELAN_FX_BANKS,
  evaluateFxBankDeskPlan,
  getBcvMarketIntelligence,
  roundMoney,
  type FxBankDeskProfile,
  type FxBankOrderTicket,
  type FxDeskEvaluationPlan,
  type FxInterventionBankId,
} from '@p2p/core';
import { AccountsService } from '../../core/accounts.service';
import { CotizaveService, describeCotizaveProvenance } from '../../core/cotizave.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { TelegramWorkerService } from '../../core/telegram-worker.service';
import { AudioAlertsService } from '../../core/audio-alerts.service';
import { ToastService } from '../../core/toast.service';

export type FxSectorFilter = 'ALL' | 'ESTADO' | 'PRIVADO' | 'VIABLE';

@Component({
  selector: 'app-fx-bank-desk',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
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

  readonly allBanks = VENEZUELAN_FX_BANKS;

  // ─── Interactive Cockpit Controls ──────────────────────────────────────
  readonly sectorFilter = signal<FxSectorFilter>('ALL');
  readonly simulatedCapitalVes = signal<number>(120000);
  readonly manualBcvOverride = signal<number | null>(null);
  readonly manualP2pOverride = signal<number | null>(null);
  readonly soundEnabled = signal<boolean>(true);
  readonly isSendingTelegram = signal<boolean>(false);
  readonly copiedBankId = signal<FxInterventionBankId | null>(null);
  readonly selectedBankGuide = signal<FxBankDeskProfile | null>(null);

  /** Per-bank anti-WAF countdown seconds remaining after clicking portal launch. */
  readonly wafCooldownRemaining = signal<Partial<Record<FxInterventionBankId, number>>>({});
  private wafInterval: ReturnType<typeof setInterval> | null = null;

  // ─── Live & Fallback Rate Resolution ───────────────────────────────────
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
    if (depth?.bestBuyPrice && depth.bestBuyPrice > 0) return roundMoney(depth.bestBuyPrice, 2);
    if (depth?.bestSellPrice && depth.bestSellPrice > 0) return roundMoney(depth.bestSellPrice, 2);
    const rates = this.cotizave.ratesByMarket();
    const ask = rates['binance']?.ask ?? rates['binance']?.bid ?? null;
    return ask && ask > 0 ? roundMoney(ask, 2) : null;
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

  readonly isWindowActive = computed<boolean>(() => {
    const phase = this.bcvIntelligence().window.phase;
    return phase === 'INTERVENTION_ACTIVE' || phase === 'PRE_INTERVENTION_COMPRESSION';
  });

  // ─── Master FX Evaluation Plan (14 Banks) ──────────────────────────────
  readonly evaluationPlan = computed<FxDeskEvaluationPlan>(() => {
    return evaluateFxBankDeskPlan({
      bcvOfficialRateVes: this.liveBcvRate(),
      p2pSellRateVes: this.liveP2pRate(),
      simulatedCapitalVes: this.simulatedCapitalVes(),
      accounts: this.accountsService.accounts(),
      usages: this.accountsService.usages(),
      velocities: this.accountsService.accountVelocities(),
      confirmedFluidBanks: this.telegram.fxFluidBanks(),
      depletedBanks: this.telegram.fxDepletedBanks(),
      isBcvWindowOpen: this.isWindowActive(),
    });
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
    void this.cotizave.fetchRates();
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

  setSectorFilter(filter: FxSectorFilter): void {
    this.sectorFilter.set(filter);
  }

  useTotalTreasuryBalance(): void {
    const total = this.accountsService.treasurySummary().totalBalanceVes;
    if (total > 0) {
      this.simulatedCapitalVes.set(Math.round(total));
      this.toast.info(
        `Simulador ajustado a tu liquidez total en cuentas: Bs. ${total.toLocaleString('es-VE')}`,
        '🏛️ Tesorería Sincronizada',
      );
    }
  }

  applyDemoRatesIfOffline(): void {
    if (this.liveBcvRate() === null) this.manualBcvOverride.set(62.45);
    if (this.liveP2pRate() === null) this.manualP2pOverride.set(84.2);
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
    navigator.clipboard?.writeText(amountStr).catch(() => {
      /* ignore clipboard error */
    });
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

  launchBankPortal(ticket: FxBankOrderTicket): void {
    const rem = this.wafCooldownRemaining()[ticket.bank.id] ?? 0;
    if (rem > 0) {
      this.toast.warn(
        `Espera ${rem}s antes de reintentar en ${ticket.bank.shortName} para evitar bloqueo preventivo de sesión (WAF).`,
        '🛡️ Cadencia Anti-Bloqueo Activa',
      );
      return;
    }

    if (ticket.recommendedOrderUsd > 0) {
      navigator.clipboard?.writeText(String(ticket.recommendedOrderUsd)).catch(() => {
        /* ignore */
      });
    }

    this.wafCooldownRemaining.update((curr) => ({
      ...curr,
      [ticket.bank.id]: ticket.bank.antiWafCooldownSec,
    }));

    if (typeof window !== 'undefined') {
      window.open(ticket.bank.portalUrl, '_blank', 'noopener,noreferrer');
    }

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
    );
    if (res) {
      if (this.soundEnabled()) {
        this.audioAlerts.playOpportunityAlert();
      }
      this.toast.success(
        `Pacto asentado en contabilidad FIFO (${res.summary}). Saldo bancario actualizado.`,
        '✅ Compra Registrada en FIFO',
      );
    }
  }

  quickLinkBankAccount(bank: FxBankDeskProfile): void {
    this.accountsService.addAccount({
      bankName: `${bank.shortName} Mesa Divisas`,
      bankCode: bank.coreBankCode,
      rail: 'TRANSFERENCIA',
      accountNumberMasked: `${bank.abaCode}-***0001`,
      dailyLimitVes: 250000,
      initialBalanceVes: this.simulatedCapitalVes(),
    });
    this.toast.success(
      `Cuenta de ${bank.name} vinculada a tu tesorería con Bs. ${this.simulatedCapitalVes().toLocaleString('es-VE')}.`,
      '🏦 Cuenta Vinculada en 1 Clic',
    );
  }

  async pushPlanToTelegram(bankId?: FxInterventionBankId): Promise<void> {
    this.isSendingTelegram.set(true);
    try {
      const res = await this.telegram.sendFxDeskPlanAlert(this.evaluationPlan(), bankId);
      if (res.ok) {
        this.toast.success(
          'Alerta interactiva con deep-links y botones FIFO enviada a tu Telegram.',
          '📲 Despachado a Telegram Sentinel',
        );
      } else {
        this.toast.warn(res.error || 'No se pudo enviar a Telegram.', '⚠️ Telegram No Vinculado');
      }
    } finally {
      this.isSendingTelegram.set(false);
    }
  }
}
