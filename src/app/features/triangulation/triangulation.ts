import { Component, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  calculateTriangularArbitrage,
  DEFAULT_TRIANGULAR_PRESETS,
  type TriangularRoutePreset,
  type ExchangeLeg,
  type TriangularArbitrageResult,
  type Operation,
} from '@p2p/core';
import { StorageService } from '../../core/storage';
import { ToastService } from '../../core/toast.service';
import { AccountsService } from '../../core/accounts.service';
import {
  TriangulationIntelligenceService,
  type McpTacticalReport,
} from '../../core/triangulation-intelligence.service';

const OPS_KEY = 'p2p.operations';

@Component({
  selector: 'app-triangulation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './triangulation.html',
  styleUrls: ['./triangulation.scss'],
})
export class Triangulation implements OnInit, OnDestroy {
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);
  private readonly accountsService = inject(AccountsService);
  readonly intelligence = inject(TriangulationIntelligenceService);

  readonly presets = DEFAULT_TRIANGULAR_PRESETS;
  readonly selectedPresetId = signal<string>(this.presets[0].id);

  readonly initialAmount = signal<number>(10000);
  readonly isSettling = signal<boolean>(false);
  readonly lastSettledId = signal<string | null>(null);

  // Auto-Sync en vivo cada 30 segundos
  readonly autoSync = signal<boolean>(false);
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;

  // Flight Plan (Checklist de ejecución de 3 tramos)
  readonly step1Done = signal<boolean>(false);
  readonly step2Done = signal<boolean>(false);
  readonly step3Done = signal<boolean>(false);

  // Editable legs based on the active preset
  readonly activePreset = computed<TriangularRoutePreset>(() => {
    const found = this.presets.find((p) => p.id === this.selectedPresetId());
    return found ?? this.presets[0];
  });

  // Local state for the 3 legs to allow live what-if parameter tuning
  readonly leg1Price = signal<number>(this.presets[0].legs[0].price);
  readonly leg1Fee = signal<number>(this.presets[0].legs[0].feePct);
  readonly leg1BankingFee = signal<number>(this.presets[0].legs[0].bankingFeePct ?? 0);

  readonly leg2Price = signal<number>(this.presets[0].legs[1].price);
  readonly leg2Fee = signal<number>(this.presets[0].legs[1].feePct);
  readonly leg2BankingFee = signal<number>(this.presets[0].legs[1].bankingFeePct ?? 0);

  readonly leg3Price = signal<number>(this.presets[0].legs[2].price);
  readonly leg3Fee = signal<number>(this.presets[0].legs[2].feePct);
  readonly leg3BankingFee = signal<number>(this.presets[0].legs[2].bankingFeePct ?? 0);

  /**
   * Scanner Matrix: Computes live arbitrage for all preset routes simultaneously using real MCP rates
   */
  readonly scannedRoutes = computed<TriangularArbitrageResult[]>(() => {
    const rates = this.intelligence.liveRates();
    return this.presets.map((p) => {
      const amount = p.initialCurrency === 'USDT' ? 1000 : 50000;
      const liveLegs = this.intelligence.applyLiveRatesToLegs(
        [{ ...p.legs[0] }, { ...p.legs[1] }, { ...p.legs[2] }],
        rates,
        p.id,
      );
      return calculateTriangularArbitrage(p.id, p.name, amount, liveLegs);
    });
  });

  /**
   * Identifies the Golden Route (highest hourly ROI with positive profitability, or highest net ROI)
   */
  readonly goldenRouteId = computed<string>(() => {
    const routes = this.scannedRoutes();
    if (!routes || routes.length === 0) return this.presets[0].id;

    const profitable = routes.filter((r) => r.isProfitable);
    if (profitable.length > 0) {
      const best = [...profitable].sort((a, b) => b.hourlyRoiPct - a.hourlyRoiPct)[0];
      return best.routeId;
    }

    const highest = [...routes].sort((a, b) => b.roiPct - a.roiPct)[0];
    return highest.routeId;
  });

  readonly calculationResult = computed<TriangularArbitrageResult>(() => {
    const p = this.activePreset();

    const leg1: ExchangeLeg = {
      ...p.legs[0],
      price: Math.max(0.000001, this.leg1Price()),
      feePct: Math.max(0, this.leg1Fee()),
      bankingFeePct: Math.max(0, this.leg1BankingFee()),
    };

    const leg2: ExchangeLeg = {
      ...p.legs[1],
      price: Math.max(0.000001, this.leg2Price()),
      feePct: Math.max(0, this.leg2Fee()),
      bankingFeePct: Math.max(0, this.leg2BankingFee()),
    };

    const leg3: ExchangeLeg = {
      ...p.legs[2],
      price: Math.max(0.000001, this.leg3Price()),
      feePct: Math.max(0, this.leg3Fee()),
      bankingFeePct: Math.max(0, this.leg3BankingFee()),
    };

    return calculateTriangularArbitrage(p.id, p.name, Math.max(0, this.initialAmount()), [
      leg1,
      leg2,
      leg3,
    ]);
  });

  /**
   * MCP Strategic Tactical Assessment
   */
  readonly tacticalReport = computed<McpTacticalReport>(() => {
    return this.intelligence.generateTacticalReport(this.calculationResult());
  });

  /**
   * Identifies the primary friction or bottleneck leg in the cycle.
   */
  readonly bottleneckInfo = computed<{ legNumber: number; reason: string }>(() => {
    const res = this.calculationResult();
    const fees = res.steps.map((s, idx) => ({
      legNumber: idx + 1,
      totalFee: s.percentageFeeAmount + s.fixedFeeAmount + s.bankingFeeAmount,
    }));
    const worstFee = [...fees].sort((a, b) => b.totalFee - a.totalFee)[0];
    return {
      legNumber: worstFee.legNumber,
      reason: `Mayor consumo de comisiones y fricción bancaria en el Tramo ${worstFee.legNumber}.`,
    };
  });

  readonly flightPlanProgressPct = computed<number>(() => {
    let count = 0;
    if (this.step1Done()) count++;
    if (this.step2Done()) count++;
    if (this.step3Done()) count++;
    return Math.round((count / 3) * 100);
  });

  ngOnInit(): void {
    // Sincronización automática de mercado inmediata al iniciar
    void this.syncRatesWithMcp(true);
  }

  ngOnDestroy(): void {
    this.stopAutoSync();
  }

  toggleAutoSync(): void {
    const next = !this.autoSync();
    this.autoSync.set(next);
    if (next) {
      this.toast.info('Sincronización en vivo activada (cada 30s).', 'MCP Stream');
      this.autoSyncTimer = setInterval(() => {
        if (this.autoSync() && !this.intelligence.isSyncingMarket()) {
          void this.syncRatesWithMcp(true);
        }
      }, 30000);
    } else {
      this.stopAutoSync();
      this.toast.info('Sincronización automática pausada.', 'MCP Stream');
    }
  }

  stopAutoSync(): void {
    this.autoSync.set(false);
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }

  onSelectPreset(presetId: string): void {
    this.selectedPresetId.set(presetId);
    const p = this.activePreset();
    const rates = this.intelligence.liveRates();
    const liveLegs = this.intelligence.applyLiveRatesToLegs(
      [{ ...p.legs[0] }, { ...p.legs[1] }, { ...p.legs[2] }],
      rates,
      p.id,
    );

    this.leg1Price.set(liveLegs[0].price);
    this.leg1Fee.set(liveLegs[0].feePct);
    this.leg1BankingFee.set(liveLegs[0].bankingFeePct ?? 0);

    this.leg2Price.set(liveLegs[1].price);
    this.leg2Fee.set(liveLegs[1].feePct);
    this.leg2BankingFee.set(liveLegs[1].bankingFeePct ?? 0);

    this.leg3Price.set(liveLegs[2].price);
    this.leg3Fee.set(liveLegs[2].feePct);
    this.leg3BankingFee.set(liveLegs[2].bankingFeePct ?? 0);

    if (p.initialCurrency === 'USDT') {
      this.initialAmount.set(1000);
    } else {
      this.initialAmount.set(50000);
    }

    this.resetFlightPlan();
  }

  setQuickAmount(amount: number): void {
    this.initialAmount.set(amount);
  }

  toggleStep(step: 1 | 2 | 3): void {
    if (step === 1) this.step1Done.update((v) => !v);
    if (step === 2) this.step2Done.update((v) => !v);
    if (step === 3) this.step3Done.update((v) => !v);
  }

  resetFlightPlan(): void {
    this.step1Done.set(false);
    this.step2Done.set(false);
    this.step3Done.set(false);
  }

  async syncRatesWithMcp(silent = false): Promise<void> {
    const p = this.activePreset();
    const legs: [ExchangeLeg, ExchangeLeg, ExchangeLeg] = [
      { ...p.legs[0], price: this.leg1Price(), feePct: this.leg1Fee(), bankingFeePct: this.leg1BankingFee() },
      { ...p.legs[1], price: this.leg2Price(), feePct: this.leg2Fee(), bankingFeePct: this.leg2BankingFee() },
      { ...p.legs[2], price: this.leg3Price(), feePct: this.leg3Fee(), bankingFeePct: this.leg3BankingFee() },
    ];

    const updated = await this.intelligence.syncLiveRates(legs, p.id);
    if (updated) {
      this.leg1Price.set(updated[0].price);
      this.leg2Price.set(updated[1].price);
      this.leg3Price.set(updated[2].price);
    }
  }

  applyLivePricesToCurrentRoute(): void {
    const p = this.activePreset();
    const rates = this.intelligence.liveRates();
    const liveLegs = this.intelligence.applyLiveRatesToLegs(
      [{ ...p.legs[0] }, { ...p.legs[1] }, { ...p.legs[2] }],
      rates,
      p.id,
    );
    this.leg1Price.set(liveLegs[0].price);
    this.leg2Price.set(liveLegs[1].price);
    this.leg3Price.set(liveLegs[2].price);
    this.toast.info('Precios en vivo de MCP aplicados al tramo actual.', 'Precios en Vivo');
  }

  copyCycleSummary(): void {
    const res = this.calculationResult();
    const report = this.tacticalReport();
    const text = `🚀 [PLAN DE VUELO - TRIANGULACIÓN P2P]
Ruta: ${res.routeName} (${res.initialCurrency})
Monto Inicial: ${res.initialAmount.toLocaleString()} ${res.initialCurrency}
Monto Final: ${res.finalAmount.toLocaleString()} ${res.initialCurrency}
Retorno Neto: ${res.netProfit > 0 ? '+' : ''}${res.netProfit.toFixed(2)} ${res.initialCurrency} (ROI: ${res.roiPct.toFixed(2)}% | ${res.hourlyRoiPct.toFixed(2)}%/h)
Duración Estimada: ${res.totalDurationMinutes} min | Breakeven T3: ${res.breakevenPriceLeg3.toFixed(4)}
Riesgo: ${res.riskLevel} (${res.riskReasons.join('; ')})
BCV Status: ${report.bcvRisk.message}
Hedge: ${report.hedgeAdvice.needed ? report.hedgeAdvice.reason : 'No requerido'}`;

    void navigator.clipboard.writeText(text);
    this.toast.info('Resumen copiado al portapapeles.', 'Plan de Vuelo');
  }

  /**
   * 1-Click Settle to Ledger: Records the 3 executed legs directly into the Operation Log
   * and refreshes treasury signals across accounts.
   */
  settleCycleToLedger(): void {
    const res = this.calculationResult();
    if (!res || res.steps.length < 3) return;

    this.isSettling.set(true);
    const cycleTag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const now = new Date().toISOString();

    try {
      const opsToInsert: Operation[] = res.steps.map((step, idx) => {
        const isVesLeg = step.fromCurrency === 'VES' || step.toCurrency === 'VES';
        const isUsdtLeg = step.fromCurrency === 'USDT' || step.toCurrency === 'USDT';

        const opType: 'buy' | 'sell' | 'assign' =
          step.fromCurrency === 'USDT' && step.toCurrency === 'VES'
            ? 'sell'
            : step.fromCurrency === 'VES' && step.toCurrency === 'USDT'
              ? 'buy'
              : 'assign';

        const vesAmount = isVesLeg
          ? step.fromCurrency === 'VES'
            ? step.inputAmount
            : step.outputAmount
          : 0;

        const usdtAmount = isUsdtLeg
          ? step.fromCurrency === 'USDT'
            ? step.inputAmount
            : step.outputAmount
          : step.outputAmount;

        return {
          id: crypto.randomUUID(),
          timestamp: now,
          type: opType,
          pair: 'USDT',
          vesAmount: Math.round(vesAmount * 100) / 100,
          usdtAmount: Math.round(usdtAmount * 100) / 100,
          price: step.price,
          merchantNote: `Ciclo #${cycleTag}: ${step.platform} (${step.paymentMethod})`,
          fees:
            Math.round(
              (step.percentageFeeAmount + step.bankingFeeAmount + step.fixedFeeAmount) * 100,
            ) / 100,
          notes: `[Triangulación ${res.routeName}] Tramo ${idx + 1}/3: ${step.fromCurrency} ➔ ${step.toCurrency} | PnL Ciclo: ${res.netProfit > 0 ? '+' : ''}${res.netProfit.toFixed(2)} ${res.initialCurrency} (ROI ${res.roiPct.toFixed(2)}%)`,
          errorFree: true,
          durationMs: (step.effectiveRate ? 1 : 0) * 60000,
        };
      });

      const currentOps: Operation[] = this.storage.get<Operation[]>(OPS_KEY) ?? [];
      const nextOps = [...currentOps, ...opsToInsert];
      this.storage.set(OPS_KEY, nextOps);
      this.accountsService.refreshLedger();

      this.lastSettledId.set(cycleTag);
      this.toast.success(
        `⚡ Ciclo #${cycleTag} asentado en Bitácora (+${res.netProfit.toFixed(2)} ${res.initialCurrency} PnL).`,
      );
      this.step1Done.set(true);
      this.step2Done.set(true);
      this.step3Done.set(true);
    } catch {
      this.toast.error('Error al asentar el ciclo en la bitácora contable.');
    } finally {
      this.isSettling.set(false);
    }
  }
}
