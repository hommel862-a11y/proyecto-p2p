import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  OnDestroy,
  signal,
} from '@angular/core';
import {
  computeSpread,
  calculateBreakEven,
  clampNonNegative,
  computeTriangulationGap,
  type AmountUnit,
  type SpreadResult,
  type BreakEvenResult,
  type P2PRole,
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
import { CotizaveService } from '../../core/cotizave.service';

interface TradingWindow {
  id: string;
  label: string;
  dayRange: string;
  timeWindow: string;
  type: 'BUY' | 'SELL';
  rationale: string;
}

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
export class SpreadMonitor implements OnInit, OnDestroy {
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
  readonly cotizave = inject(CotizaveService);
  protected readonly Math = Math;

  readonly triangulationThresholdVes = signal<number>(2);

  readonly triangulationData = computed(() => {
    const depth = this.binance.marketDepth();
    const rates = this.cotizave.ratesByMarket();
    if (!depth || Object.keys(rates).length === 0) return [];

    // Binance P2P orientation:
    // depth.bestBuyPrice  = lowest seller ask  → price user PAYS to buy USDT on Binance
    // depth.bestSellPrice = highest buyer bid   → price user RECEIVES when selling USDT on Binance
    //
    // For "comprar en Binance, vender en otro exchange":
    //   binance.bid  = depth.bestBuyPrice  (what user pays on Binance)
    //   other.ask    = other buyer's bid    (what user receives on other exchange)
    //
    // For "comprar en otro, vender en Binance":
    //   binance.ask  = depth.bestSellPrice (what user receives when selling on Binance)
    //   other.bid    = other seller's ask   (what user pays on other exchange)

    return Object.entries(rates)
      .filter(([market]) => market !== 'binance')
      .map(([market, rate]) => {
        const gapForward = computeTriangulationGap({ bid: depth.bestBuyPrice }, { ask: rate.bid });
        const gapReverse = computeTriangulationGap({ bid: rate.bid }, { ask: depth.bestSellPrice });
        return {
          market,
          ask: rate.ask,
          bid: rate.bid,
          mid: rate.mid,
          updated_at: rate.updated_at,
          gapForward,
          gapReverse,
        };
      });
  });

  readonly triangulationAlert = computed(() => {
    const data = this.triangulationData();
    const thr = this.triangulationThresholdVes();
    let best: { market: string; gapVes: number } | null = null;

    for (const row of data) {
      if (row.gapForward.gapVes != null && row.gapForward.gapVes >= thr) {
        if (!best || row.gapForward.gapVes > best.gapVes) {
          best = { market: row.market, gapVes: row.gapForward.gapVes };
        }
      }
      if (row.gapReverse.gapVes != null && row.gapReverse.gapVes >= thr) {
        if (!best || row.gapReverse.gapVes > best.gapVes) {
          best = { market: row.market, gapVes: row.gapReverse.gapVes };
        }
      }
    }

    return { hasAlert: best !== null, best };
  });

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
  /** role deployed on the buy leg: MAKER pays fee, TAKER is free. */
  readonly buyRole = signal<P2PRole>('TAKER');
  /** role deployed on the sell leg: MAKER pays fee, TAKER is free. */
  readonly sellRole = signal<P2PRole>('TAKER');
  /** minimum net spread (%) required to operate (guard threshold). */
  readonly minSpreadGuardPct = signal<number>(0.6);

  /** Effective fee drag on the spread footprint: MAKER legs burn +0.25% each. */
  readonly effectiveFeeDragPct = computed<number>(() => {
    const makers = (this.buyRole() === 'MAKER' ? 1 : 0) + (this.sellRole() === 'MAKER' ? 1 : 0);
    return makers === 2 ? 0.5 : makers === 1 ? 0.25 : 0;
  });

  /** SQS evaluated with the selected buy/sell roles (backed by the live engine). */
  readonly marketQuality = computed(() =>
    this.spreadQuality.currentMarketQuality(this.buyRole(), this.sellRole())(),
  );

  /** Trading guard: operar / alerta / no operar per net spread vs threshold. */
  readonly guardStatus = computed<'ok' | 'warn' | 'noop'>(() => {
    const sqs = this.marketQuality();
    if (!sqs) return 'noop';
    const net = sqs.netSpreadPct;
    if (net >= this.minSpreadGuardPct()) return 'ok';
    if (net > 0) return 'warn';
    return 'noop';
  });

  readonly guardText = computed<string>(() => {
    const sqs = this.marketQuality();
    if (!sqs) return 'Sin datos de mercado en vivo.';
    const net = sqs.netSpreadPct;
    const thr = this.minSpreadGuardPct();
    const mode = `${this.buyRole()}/${this.sellRole()}`;
    if (net >= thr) {
      return `Spread ${net.toFixed(2)}% ≥ ${thr.toFixed(2)}% — operar en modo ${mode}`;
    }
    if (net > 0) {
      return `Spread ${net.toFixed(2)}% < umbral ${thr.toFixed(2)}% — margen insuficiente (${mode})`;
    }
    return `Spread ${net.toFixed(2)}% negativo — NO operar en modo ${mode}`;
  });

  /** Fixed reference windows for strategic buying/selling (trading calendar). */
  readonly tradingWindows: readonly TradingWindow[] = [
    {
      id: 'lun-mie-buy',
      label: 'Compra estratégica',
      dayRange: 'Lunes a Miércoles',
      timeWindow: '2:00 PM – 4:00 PM',
      type: 'BUY',
      rationale: 'Oferta alta: precios de compra más bajos del día.',
    },
    {
      id: 'jue-vie-sell',
      label: 'Venta estratégica',
      dayRange: 'Jueves a Viernes',
      timeWindow: '8:00 AM – 10:00 AM',
      type: 'SELL',
      rationale: 'Demanda alta: mejores precios de venta.',
    },
    {
      id: 'jueves-pre-quincena',
      label: 'Jueves pre-quincena',
      dayRange: 'Jueves',
      timeWindow: 'Pre-quincena (15 y 30/31)',
      type: 'SELL',
      rationale: 'Demanda elevada por pago de quincena.',
    },
    {
      id: 'finde-brecha',
      label: 'Fin de semana',
      dayRange: 'Sábado y Domingo',
      timeWindow: 'Todo el día',
      type: 'SELL',
      rationale: 'Brecha 25-32% vs tasa BCV: diferencial abultado.',
    },
  ];

  /** Current clock, refreshed every minute to drive the active-window highlight. */
  readonly now = signal<Date>(new Date());
  private nowTimerId: number | null = null;

  /** Id of the trading window that `now` falls into (Lun/Mié 14-16, Jue/Vie 8-10). */
  readonly activeWindowId = computed<string | null>(() => {
    const d = this.now();
    const day = d.getDay();
    const minutes = d.getHours() * 60 + d.getMinutes();
    const monOrWed = day === 1 || day === 3;
    if (monOrWed && minutes >= 14 * 60 && minutes < 16 * 60) return 'lun-mie-buy';
    const thuOrFri = day === 4 || day === 5;
    if (thuOrFri && minutes >= 8 * 60 && minutes < 10 * 60) return 'jue-vie-sell';
    return null;
  });

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

  /** Recommended ad limits (Sebastian Labastidas rule: filter micro-orders to preserve daily banking limits). */
  readonly recommendedMakerLimits = computed(() => {
    const price = this.buyPrice() > 0 ? this.buyPrice() : 800;
    const volCrypto = this.amount() > 0 ? this.amount() : 50;
    const totalVes = price * volCrypto;
    // Minimum ticket threshold: equivalent to at least $30 to protect from 1-5 USD micro-orders
    const minTicketUsd = 30;
    const minTicketVes = Math.round(minTicketUsd * price);
    const maxTicketVes = Math.round(totalVes);

    return {
      minTicketUsd,
      minTicketVes,
      maxTicketVes,
      tip: `Configura tu anuncio con mínimo ${minTicketVes.toLocaleString('es-VE')} Bs (~$30) para evitar que órdenes pequeñas agoten tus 15 transferencias diarias.`,
    };
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
    const [depth] = await Promise.allSettled([
      this.binance.fetchMarketDepth(this.pair(), 'VES'),
      this.cotizave.apiKey() ? this.cotizave.fetchRates() : Promise.resolve(),
    ]);

    const marketDepth = depth.status === 'fulfilled' ? depth.value : null;
    if (marketDepth && marketDepth.bestBuyPrice > 0 && marketDepth.bestSellPrice > 0) {
      this.buyPrice.set(marketDepth.bestBuyPrice);
      this.sellPrice.set(marketDepth.bestSellPrice);

      this.marketHistory.recordSnapshot({
        pair: this.pair(),
        bank: this.binance.selectedBank(),
        bestBuyPrice: marketDepth.bestBuyPrice,
        bestSellPrice: marketDepth.bestSellPrice,
        spreadVes: marketDepth.spreadVes,
        spreadPct: marketDepth.spreadPct,
      });

      this.toast.success(
        `Precios sincronizados con Binance P2P (${this.binance.selectedBank()}): Compra ${marketDepth.bestBuyPrice} Bs / Venta ${marketDepth.bestSellPrice} Bs.`,
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
    this.now.set(new Date());
    this.nowTimerId = window.setInterval(() => this.now.set(new Date()), 60_000);
    if (!this.binance.marketDepth()) {
      void this.syncBinancePrices();
    }
    if (this.cotizave.apiKey() && this.activeMode() !== 'repricer') {
      this.cotizave.startAutoRefresh();
    }
  }

  ngOnDestroy(): void {
    if (this.nowTimerId !== null) {
      window.clearInterval(this.nowTimerId);
      this.nowTimerId = null;
    }
    this.cotizave.stopAutoRefresh();
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
