import { Component, signal, computed, inject } from '@angular/core';
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

const OPS_KEY = 'p2p.operations';

@Component({
  selector: 'app-triangulation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './triangulation.html',
  styleUrls: ['./triangulation.scss'],
})
export class Triangulation {
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);
  private readonly accountsService = inject(AccountsService);

  readonly presets = DEFAULT_TRIANGULAR_PRESETS;
  readonly selectedPresetId = signal<string>(this.presets[0].id);

  readonly initialAmount = signal<number>(10000);
  readonly isSettling = signal<boolean>(false);
  readonly lastSettledId = signal<string | null>(null);

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
   * Scanner Matrix: Computes live arbitrage for all preset routes simultaneously
   */
  readonly scannedRoutes = computed<TriangularArbitrageResult[]>(() => {
    return this.presets.map((p) => {
      const amount = p.initialCurrency === 'USDT' ? 1000 : 50000;
      return calculateTriangularArbitrage(p.id, p.name, amount, p.legs);
    });
  });

  /**
   * Identifies the Golden Route (highest hourly ROI with positive profitability, or highest net ROI)
   */
  readonly goldenRouteId = computed<string>(() => {
    const routes = this.scannedRoutes();
    if (!routes || routes.length === 0) return this.presets[0].id;

    // Filter profitable routes first
    const profitable = routes.filter((r) => r.isProfitable);
    if (profitable.length > 0) {
      const best = [...profitable].sort((a, b) => b.hourlyRoiPct - a.hourlyRoiPct)[0];
      return best.routeId;
    }

    // Otherwise route with highest net ROI
    const highest = [...routes].sort((a, b) => b.roiPct - a.roiPct)[0];
    return highest.routeId;
  });

  onSelectPreset(presetId: string): void {
    this.selectedPresetId.set(presetId);
    const p = this.activePreset();
    this.leg1Price.set(p.legs[0].price);
    this.leg1Fee.set(p.legs[0].feePct);
    this.leg1BankingFee.set(p.legs[0].bankingFeePct ?? 0);

    this.leg2Price.set(p.legs[1].price);
    this.leg2Fee.set(p.legs[1].feePct);
    this.leg2BankingFee.set(p.legs[1].bankingFeePct ?? 0);

    this.leg3Price.set(p.legs[2].price);
    this.leg3Fee.set(p.legs[2].feePct);
    this.leg3BankingFee.set(p.legs[2].bankingFeePct ?? 0);

    if (p.initialCurrency === 'USDT') {
      this.initialAmount.set(1000);
    } else {
      this.initialAmount.set(50000);
    }
  }

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
    } catch {
      this.toast.error('Error al asentar el ciclo en la bitácora contable.');
    } finally {
      this.isSettling.set(false);
    }
  }
}
