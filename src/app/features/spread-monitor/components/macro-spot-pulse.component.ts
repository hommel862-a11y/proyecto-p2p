import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
  type OnDestroy,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { SpotMarketService } from '../../../core/spot-market.service';
import { DecisionJournalService } from '../../../core/decision-journal.service';
import type { MarketSnapshot, Spot24hTicker } from '@p2p/core';

export interface MacroSparklinePoint {
  x: number;
  y: number;
}

export interface MacroAlertItem {
  id: string;
  asset: string;
  severity: 'WARNING' | 'CRITICAL' | 'INFO';
  title: string;
  detail: string;
  badge: string;
}

@Component({
  selector: 'app-macro-spot-pulse',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './macro-spot-pulse.component.html',
  styleUrl: './macro-spot-pulse.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MacroSpotPulseComponent implements OnInit, OnDestroy {
  readonly spotMarket = inject(SpotMarketService);
  private readonly journal = inject(DecisionJournalService);

  readonly autoRefreshActive = signal<boolean>(true);
  readonly snapshots = signal<MarketSnapshot[]>([]);
  readonly loadingHistory = signal<boolean>(false);
  private refreshIntervalId: ReturnType<typeof setInterval> | null = null;

  // Selected asset for interactive chart inspection
  readonly selectedAsset = signal<'BTCUSDT' | 'SOLUSDT' | 'USDCUSDT'>('BTCUSDT');

  // Computed Spot assets
  readonly btc = computed(() => this.spotMarket.btcTicker());
  readonly sol = computed(() => this.spotMarket.solTicker());
  readonly usdc = computed(() => this.spotMarket.usdcTicker());

  // Institutional risk alerts: USDC depeg/wide-spread and BTC/SOL abnormal intraday volatility
  readonly macroAlerts = computed<MacroAlertItem[]>(() => {
    const alerts: MacroAlertItem[] = [];

    const u = this.usdc();
    if (u) {
      if (Math.abs(u.midPrice - 1.0) >= 0.005) {
        alerts.push({
          id: 'usdc-depeg',
          asset: 'USDCUSDT',
          severity: 'CRITICAL',
          title: 'Despeg de Paridad USDC/USDT',
          detail: `Mid-price despegado en $${u.midPrice.toFixed(4)} (desvío ≥ 50 bps de $1.00)`,
          badge: 'DEPEG CRÍTICO',
        });
      }
      if (u.spreadPct >= 0.05) {
        alerts.push({
          id: 'usdc-spread',
          asset: 'USDCUSDT',
          severity: 'WARNING',
          title: 'Spread Spot USDC Anormal',
          detail: `Spread entre puntas en ${u.spreadPct.toFixed(3)}% (umbral ≥ 50 bps)`,
          badge: 'SPREAD ANORMAL',
        });
      }
    }

    const b = this.btc();
    if (b && Math.abs(b.priceChangePct24h) >= 5.0) {
      alerts.push({
        id: 'btc-volatility',
        asset: 'BTCUSDT',
        severity: 'WARNING',
        title: 'Alta Volatilidad Intradía BTC',
        detail: `Variación 24h brusca: ${b.priceChangePct24h >= 0 ? '+' : ''}${b.priceChangePct24h.toFixed(2)}%`,
        badge: 'VOLATILIDAD MACRO',
      });
    }

    const s = this.sol();
    if (s && Math.abs(s.priceChangePct24h) >= 7.5) {
      alerts.push({
        id: 'sol-volatility',
        asset: 'SOLUSDT',
        severity: 'WARNING',
        title: 'Alta Volatilidad Intradía SOL',
        detail: `Variación 24h brusca: ${s.priceChangePct24h >= 0 ? '+' : ''}${s.priceChangePct24h.toFixed(2)}%`,
        badge: 'VOLATILIDAD MACRO',
      });
    }

    return alerts;
  });

  hasAlert(asset: 'BTCUSDT' | 'SOLUSDT' | 'USDCUSDT'): boolean {
    return this.macroAlerts().some((a) => a.asset === asset);
  }

  // Historic sparkline points for the selected asset based on SQLite market_snapshots
  readonly sparklinePath = computed<string>(() => {
    const list = this.snapshots();
    if (list.length < 2) return '';

    const asset = this.selectedAsset();
    const values: number[] = [];

    for (const s of list) {
      let val: number | undefined;
      if (asset === 'BTCUSDT') val = s.btcUsdt;
      else if (asset === 'SOLUSDT') val = s.solUsdt;
      else if (asset === 'USDCUSDT') val = s.usdcUsdt;

      if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
        values.push(val);
      }
    }

    if (values.length < 2) return '';

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const width = 360;
    const height = 64;
    const padding = 6;

    const points = values.map((val, index) => {
      const x = padding + (index / (values.length - 1)) * (width - padding * 2);
      const normalizedY = (val - min) / range;
      const y = height - padding - normalizedY * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return points.join(' ');
  });

  readonly selectedStats = computed<{ min: number; max: number; current: number; count: number }>(() => {
    const list = this.snapshots();
    const asset = this.selectedAsset();
    const values: number[] = [];

    for (const s of list) {
      let val: number | undefined;
      if (asset === 'BTCUSDT') val = s.btcUsdt;
      else if (asset === 'SOLUSDT') val = s.solUsdt;
      else if (asset === 'USDCUSDT') val = s.usdcUsdt;

      if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
        values.push(val);
      }
    }

    if (values.length === 0) {
      const live =
        asset === 'BTCUSDT' ? this.btc()?.lastPrice :
        asset === 'SOLUSDT' ? this.sol()?.lastPrice :
        this.usdc()?.lastPrice;
      const cur = live ?? 0;
      return { min: cur, max: cur, current: cur, count: 0 };
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const current = values[values.length - 1];
    return { min, max, current, count: values.length };
  });

  ngOnInit(): void {
    void this.refreshData();
    // Refresh feed every 15s when active
    this.refreshIntervalId = setInterval(() => {
      if (this.autoRefreshActive()) {
        void this.refreshData();
      }
    }, 15000);
  }

  ngOnDestroy(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  toggleAutoRefresh(): void {
    this.autoRefreshActive.update((v) => !v);
  }

  selectAsset(asset: 'BTCUSDT' | 'SOLUSDT' | 'USDCUSDT'): void {
    this.selectedAsset.set(asset);
  }

  async refreshData(): Promise<void> {
    try {
      // 1. Fetch live 24h tickers batch for BTC, SOL, USDC
      await this.spotMarket.fetchCoreBasket();

      // 2. Load recent snapshots from SQLite to populate time series
      this.loadingHistory.set(true);
      const host = globalThis as unknown as {
        electron?: { db?: { listMarketSnapshots?: (filter?: unknown) => Promise<MarketSnapshot[]> } };
        p2p?: { db?: { listMarketSnapshots?: (filter?: unknown) => Promise<MarketSnapshot[]> } };
      };

      const fetcher = host.p2p?.db?.listMarketSnapshots ?? host.electron?.db?.listMarketSnapshots;
      if (typeof fetcher === 'function') {
        const raw = await fetcher({ limit: 40 });
        if (Array.isArray(raw)) {
          // Snapshots are loaded in ascending chronological order for chart display
          const sorted = [...raw].sort((a, b) => a.fetchedAt - b.fetchedAt);
          this.snapshots.set(sorted);
        }
      }
    } catch (err) {
      console.warn('[MacroSpotPulse] Error refreshing spot/snapshots:', err);
    } finally {
      this.loadingHistory.set(false);
    }
  }
}
