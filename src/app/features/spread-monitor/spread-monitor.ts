import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import {
  computeSpread,
  calculateBreakEven,
  clampNonNegative,
  type AmountUnit,
  type SpreadResult,
  type BreakEvenResult,
} from '@p2p/core';
import { RisksService } from '../../core/rules';
import { ToastService } from '../../core/toast.service';
import { FORMAT_PIPES } from '../../core/format';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

import { Router } from '@angular/router';
import { TradeTimerService, type TradePreset } from '../../core/trade-timer.service';
import { DatePipe } from '@angular/common';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { BinanceRepricerService } from '../../core/binance-repricer.service';
import { HotkeysService } from '../../core/hotkeys.service';
import { AccountsService } from '../../core/accounts.service';
import { MarketHistoryService } from '../../core/market-history.service';
import { AudioAlertsService } from '../../core/audio-alerts.service';
import { SpreadQualityService } from '../../core/spread-quality.service';

/**
 * C1 — Spread monitor. Thin view over {@link computeSpread}: user-entered prices/amount
 * feed pure core math; the favorable/unfavorable banner comes from the live risk-rules config.
 * Supports USDT/VES and EUR/VES pairs and fires a notification when the verdict flips to Favorable.
 */
@Component({
  selector: 'app-spread-monitor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ...FORMAT_PIPES],
  templateUrl: './spread-monitor.html',
  styleUrl: './spread-monitor.scss',
})
export class SpreadMonitor implements OnInit {
  private readonly router = inject(Router);
  private readonly timer = inject(TradeTimerService);
  private readonly risks = inject(RisksService);
  private readonly toast = inject(ToastService);
  private readonly hotkeys = inject(HotkeysService);
  readonly binance = inject(BinanceP2pService);
  readonly repricer = inject(BinanceRepricerService);
  readonly accountsService = inject(AccountsService);
  readonly marketHistory = inject(MarketHistoryService);
  readonly audioAlerts = inject(AudioAlertsService);
  readonly spreadQuality = inject(SpreadQualityService);
  protected readonly Math = Math;

  selectBank(bankKey: string): void {
    this.binance.setBankFilter(bankKey);
    void this.syncBinancePrices();
  }

  private readonly nf = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  /** Active mode: standard arbitrage scanner, break-even & maker ad pricing, or repricer bot */
  readonly activeMode = signal<'spread' | 'breakeven' | 'repricer'>('spread');

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

  /** Break-Even & Maker Ad specific parameters */
  readonly buyFeePct = signal<number>(0);
  readonly sellFeePct = signal<number>(0.2);
  readonly bankFeesVes = signal<number>(0);
  readonly targetRoiPct = signal<number>(1.5);

  readonly breakEvenResult = computed<BreakEvenResult>(() => {
    return calculateBreakEven({
      buyPrice: this.buyPrice(),
      amount: this.amount(),
      buyFeeRate: this.buyFeePct() / 100,
      sellFeeRate: this.sellFeePct() / 100,
      fixedBankFeesVes: this.bankFeesVes(),
      targetRoiPct: this.targetRoiPct(),
    });
  });

  applyTargetSellPrice(): void {
    const target = this.breakEvenResult().targetSellPrice;
    this.sellPrice.set(target);
    this.activeMode.set('spread');
    this.toast.success(
      `Precio de venta fijado en ${this.nf.format(target)} VES/${this.pair()} para ${this.targetRoiPct()}% ROI.`,
      'Anuncio Maker Configurado',
    );
  }

  async syncBinancePrices(): Promise<void> {
    const depth = await this.binance.fetchMarketDepth(this.pair(), 'VES');
    if (depth && depth.bestBuyPrice > 0 && depth.bestSellPrice > 0) {
      this.buyPrice.set(depth.bestBuyPrice);
      this.sellPrice.set(depth.bestSellPrice);

      this.marketHistory.recordSnapshot({
        pair: this.pair(),
        bank: this.binance.selectedBank(),
        bestBuyPrice: depth.bestBuyPrice,
        bestSellPrice: depth.bestSellPrice,
        spreadVes: depth.spreadVes,
        spreadPct: depth.spreadPct,
      });

      this.toast.success(
        `Precios sincronizados con Binance P2P (${this.binance.selectedBank()}): Compra ${depth.bestBuyPrice} Bs / Venta ${depth.bestSellPrice} Bs.`,
        'Mercado en Vivo',
      );
    }
  }

  applyBinancePrices(): void {
    const depth = this.binance.marketDepth();
    if (depth && depth.bestBuyPrice > 0 && depth.bestSellPrice > 0) {
      this.buyPrice.set(depth.bestBuyPrice);
      this.sellPrice.set(depth.bestSellPrice);
      this.toast.success(
        `Precios aplicados: Compra ${depth.bestBuyPrice} Bs / Venta ${depth.bestSellPrice} Bs.`,
        'Precios Actualizados',
      );
    } else {
      void this.syncBinancePrices();
    }
  }

  /** Template helper: collapse NaN/empty/negative money entries to 0. */
  clampMoney(v: number): number {
    return clampNonNegative(v);
  }

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
        this.audioAlerts.playOpportunityAlert();
      }
      this.prevKind = kind;
    });

    this.hotkeys.register('SYNC', () => {
      void this.syncBinancePrices();
    });
    this.hotkeys.register('FETCH_MARKET', () => {
      void this.syncBinancePrices();
    });
  }

  getSparklinePoints(): string {
    const points = this.marketHistory.getFilteredPoints(this.binance.selectedBank());
    if (points.length < 2) return '';
    const spreads = points.map((p) => p.spreadVes);
    const min = Math.min(...spreads);
    const max = Math.max(...spreads);
    const range = max - min || 1;
    const width = 280;
    const height = 44;
    return points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * width;
        const y = height - ((p.spreadVes - min) / range) * (height - 10) - 5;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  ngOnInit(): void {
    if (!this.binance.marketDepth()) {
      void this.syncBinancePrices();
    }
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

  startDirectTrade(type: 'buy' | 'sell'): void {
    const res = this.result();
    if (!res) return;

    const isBuy = type === 'buy';
    const price = isBuy ? this.buyPrice() : this.sellPrice();
    const usdtAmount = res.usdtReceived;
    const vesAmount = isBuy ? res.usdtReceived * price : res.vesReceived;

    const preset: TradePreset = {
      pair: this.pair(),
      type,
      price,
      usdtAmount: Number(usdtAmount.toFixed(6)),
      vesAmount: Number(vesAmount.toFixed(2)),
      merchantNote: `Arbitraje ${this.pair()} (Spread: ${this.nf.format(res.unitSpread)} Bs)`,
    };

    this.timer.start(preset);
    this.toast.info('Cronómetro iniciado. Datos precargados en el registro.', 'Trade Despachado');
    this.router.navigate(['/log']);
  }

  /** Notify the user when a Favorable opportunity appears (native on Android, web Notification on desktop, and in-app toast). */
  private notify(msg: string): void {
    const title = 'P2P Decisor — Spread favorable';
    this.toast.success(msg, 'Oportunidad de Arbitraje');

    try {
      if (Capacitor.isNativePlatform()) {
        const schedule = () =>
          LocalNotifications.schedule({
            notifications: [{ title, body: msg, id: Math.floor(Math.random() * 100000) }],
          }).catch(() => {
            /* ignore notification scheduling failure */
          });
        LocalNotifications.checkPermissions()
          .then((p) => {
            if (p.display === 'granted') schedule();
            else
              LocalNotifications.requestPermissions()
                .then((r) => {
                  if (r.display === 'granted') schedule();
                })
                .catch(() => {
                  /* ignore permission request rejection */
                });
          })
          .catch(() => {
            /* ignore permission check rejection */
          });
        return;
      }
      if (typeof Notification !== 'undefined') {
        const fire = () => new Notification(title, { body: msg });
        if (Notification.permission === 'granted') {
          fire();
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission()
            .then((p) => {
              if (p === 'granted') fire();
            })
            .catch(() => {
              /* ignore notification request rejection */
            });
        }
      }
    } catch {
      /* plataforma sin notificaciones */
    }
  }
}
