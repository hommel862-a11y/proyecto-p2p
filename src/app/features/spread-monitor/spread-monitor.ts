import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { computeSpread, type AmountUnit, type SpreadResult } from '@p2p/core';
import { RisksService } from '../../core/rules';
import { FORMAT_PIPES } from '../../core/format';

/**
 * C1 — Spread monitor. Thin view over {@link computeSpread}: user-entered prices/amount
 * feed pure core math; the favorable/unfavorable banner comes from the live risk-rules config.
 * Supports USDT/VES and EUR/VES pairs and fires a notification when the verdict flips to Favorable.
 */
@Component({
  selector: 'app-spread-monitor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FORMAT_PIPES],
  templateUrl: './spread-monitor.html',
})
export class SpreadMonitor {
  private readonly risks = inject(RisksService);
  private readonly nf = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  readonly buyPrice = signal<number>(800);
  readonly sellPrice = signal<number>(820);
  readonly amount = signal<number>(25);
  /** trading pair: USDT/VES or EUR/VES. */
  readonly pair = signal<'USDT' | 'EUR'>('USDT');
  readonly unit = signal<AmountUnit>('USDT');
  /** seller commission as a percentage (0..0.35). */
  readonly commissionPct = signal<number>(0);
  /** favorable-spread threshold (VES per base unit). */
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
  readonly netVesAfterCommission = computed(() => this.result()?.netVesAfterCommission ?? 0);
  readonly netGainVes = computed(() => this.result()?.netGainVes ?? 0);

  readonly alert = computed<{ kind: 'favorable' | 'unfavorable' | null; message: string }>(() => {
    const r = this.result();
    if (!r) return { kind: null, message: '' };
    const min = this.risks.config().minSpread;
    if (r.unitSpread < min) {
      return {
        kind: 'unfavorable',
        message: `Desfavorable: el spread ${this.nf.format(r.unitSpread)} está por debajo del mínimo ${this.nf.format(min)}`,
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
        message: `Favorable: el spread ${this.nf.format(r.unitSpread)} ≥ umbral ${this.nf.format(this.threshold())}`,
      };
    }
    return { kind: null, message: '' };
  });

  private prevKind: 'favorable' | 'unfavorable' | null = null;

  constructor() {
    effect(() => {
      const kind = this.alert().kind;
      if (kind === 'favorable' && this.prevKind !== 'favorable') {
        this.notify(this.alert().message);
      }
      this.prevKind = kind;
    });
  }

  setUnit(value: string): void {
    this.unit.set(value as AmountUnit);
  }

  setPair(value: string): void {
    const p = value === 'EUR' ? 'EUR' : 'USDT';
    this.pair.set(p);
    if (this.unit() !== 'VES') {
      this.unit.set(p as AmountUnit);
    }
  }

  /** Notify the user when a Favorable opportunity appears (desktop notification when permitted). */
  private notify(msg: string): void {
    try {
      if (typeof Notification !== 'undefined') {
        const fire = () => new Notification('P2P Decisor — Spread favorable', { body: msg });
        if (Notification.permission === 'granted') {
          fire();
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission()
            .then((p) => {
              if (p === 'granted') fire();
            })
            .catch(() => {});
        }
      }
    } catch {
      /* plataforma sin Notification (p. ej. webview de Android) */
    }
  }
}
