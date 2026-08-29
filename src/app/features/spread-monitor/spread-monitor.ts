import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { computeSpread, type AmountUnit, type SpreadResult } from '@p2p/core';
import { RisksService } from '../../core/rules';

/**
 * C1 — Spread monitor. Thin view over {@link computeSpread}: user-entered prices/amount
 * feed pure core math; the favorable/unfavorable banner comes from the live risk-rules config.
 */
@Component({
  selector: 'app-spread-monitor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spread-monitor.html',
})
export class SpreadMonitor {
  private readonly risks = inject(RisksService);

  readonly buyPrice = signal<number>(800);
  readonly sellPrice = signal<number>(820);
  readonly amount = signal<number>(25);
  readonly unit = signal<AmountUnit>('USDT');
  /** seller commission as a percentage (0..0.35). */
  readonly commissionPct = signal<number>(0);
  /** favorable-spread threshold (VES/USDT). */
  readonly threshold = signal<number>(15);

  readonly result = computed<SpreadResult | null>(() => {
    try {
      return computeSpread(
        this.buyPrice(),
        this.sellPrice(),
        this.amount(),
        this.unit(),
        this.commissionPct() / 100,
      );
    } catch {
      return null;
    }
  });

  readonly error = computed<string | null>(() => {
    try {
      computeSpread(
        this.buyPrice(),
        this.sellPrice(),
        this.amount(),
        this.unit(),
        this.commissionPct() / 100,
      );
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  });

  readonly usdtReceived = computed(() => this.result()?.usdtReceived ?? 0);
  readonly vesReceived = computed(() => this.result()?.vesReceived ?? 0);
  readonly unitSpread = computed(() => this.result()?.unitSpread ?? 0);
  readonly gainVes = computed(() => this.result()?.gainVes ?? 0);
  readonly netVesAfterCommission = computed(
    () => this.result()?.netVesAfterCommission ?? 0,
  );

  readonly alert = computed<{ kind: 'favorable' | 'unfavorable' | null; message: string }>(() => {
    const r = this.result();
    if (!r) return { kind: null, message: '' };
    const min = this.risks.config().minSpread;
    if (r.unitSpread < min) {
      return {
        kind: 'unfavorable',
        message: `Unfavorable: spread ${r.unitSpread.toFixed(2)} is below minimum ${min}`,
      };
    }
    const verdict = this.risks.evaluate({
      currentSpread: r.unitSpread,
      minSpread: min,
      openOps: 0,
      tradeRiskPct: 0,
      dailyLossPct: 0,
      consecutiveErrors: 0,
    });
    if (verdict.decision === 'ALLOW' && r.unitSpread >= this.threshold()) {
      return {
        kind: 'favorable',
        message: `Favorable: spread ${r.unitSpread.toFixed(2)} ≥ threshold ${this.threshold()}`,
      };
    }
    return { kind: null, message: '' };
  });

  setUnit(value: string): void {
    this.unit.set(value === 'VES' ? 'VES' : 'USDT');
  }
}
