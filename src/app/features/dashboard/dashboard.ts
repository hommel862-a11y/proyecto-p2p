import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { StorageService } from '../../core/storage';
import { RisksService } from '../../core/rules';
import { SessionService } from '../../core/session.service';
import { AccountsService } from '../../core/accounts.service';
import { ToastService } from '../../core/toast.service';
import { fmtVes, fmtUsd, FORMAT_PIPES } from '../../core/format';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { CotizaveService } from '../../core/cotizave.service';
import {
  computeDashboard,
  computeSessionSummary,
  getBcvMarketIntelligence,
  type Operation,
  type DayActivity,
  type AccountVelocityHealth,
  type BcvMarketIntelligence,
} from '@p2p/core';

const OPS_KEY = 'p2p.operations';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, ...FORMAT_PIPES],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly router = inject(Router);
  private readonly storage = inject(StorageService);
  private readonly risks = inject(RisksService);
  private readonly toast = inject(ToastService);
  readonly sessionService = inject(SessionService);
  readonly accountsService = inject(AccountsService);
  readonly binanceService = inject(BinanceP2pService);
  readonly cotizaveService = inject(CotizaveService);

  readonly manualBcvRate = signal<number>(685.0);
  readonly manualParallelRate = signal<number>(815.0);

  readonly bcvIntelligence = computed<BcvMarketIntelligence>(() => {
    const depth = this.binanceService.marketDepth();
    const rates = this.cotizaveService.ratesByMarket();
    const parallel = depth?.bestBuyPrice || rates['binance']?.ask || this.manualParallelRate();
    const bcv = rates['bcv']?.mid || rates['oficial']?.mid || this.manualBcvRate();
    return getBcvMarketIntelligence(parallel, bcv);
  });

  /** Daily income target (USD) — read from income calculator storage if available. */
  readonly dailyTarget = signal<number>(this.storage.get<number>('p2p.daily-target') ?? 20);

  /** State for closing session modal */
  readonly showCloseModal = signal<boolean>(false);
  readonly closeDisciplineRating = signal<number>(5);
  readonly closeNotes = signal<string>('');

  private readonly ops = computed<Operation[]>(() => this.storage.get<Operation[]>(OPS_KEY) ?? []);

  readonly dashboard = computed(() => computeDashboard(this.ops()));

  /** Risk engine live verdict from sample state. */
  readonly verdict = computed(() => this.risks.evaluate(this.risks.sampleState()));

  /** Daily transaction velocity per account (SUDEBAN rotation awareness). */
  readonly accountVelocities = computed(() => this.accountsService.accountVelocities());
  /** Accounts at or near their daily transaction threshold. */
  readonly velocityAlerts = computed(() => this.accountsService.velocityAlerts());
  /** Best account to rotate to today, if any. */
  readonly rotationRecommendation = computed(() => this.accountsService.rotationRecommendation());

  /** Semáforo background CSS var per velocity health (no hardcoded colors). */
  readonly velocityHealthVar: Record<AccountVelocityHealth, string> = {
    OPTIMAL: 'var(--accent)',
    MODERATE: 'var(--warn)',
    REST_RECOMMENDED: 'var(--gold)',
    SATURATED: 'var(--danger)',
  };

  /** Human-readable label per velocity health. */
  readonly velocityHealthLabel: Record<AccountVelocityHealth, string> = {
    OPTIMAL: 'Óptima',
    MODERATE: 'Moderada',
    REST_RECOMMENDED: 'Descanso recomendado',
    SATURATED: 'Saturada',
  };

  /** Progress toward daily target (0–100). */
  readonly dailyProgress = computed(() => {
    const target = this.dailyTarget();
    if (target <= 0) return 0;
    const pnlUsdt = Math.abs(this.dashboard().today.pnlUsdt);
    return Math.min(100, Math.round((pnlUsdt / target) * 100));
  });

  /** Max PnL across the 7-day week for chart bar scaling. */
  readonly weekMax = computed(() => {
    const week = this.dashboard().week;
    const max = Math.max(...week.map((d) => Math.abs(d.pnlVes)), 1);
    return max;
  });

  /** Active chart view: cumulative equity curve vs daily volume */
  readonly selectedChartTab = signal<'cumulative' | 'volume'>('cumulative');

  readonly hoveredPoint = signal<{
    date: string;
    label: string;
    value: string;
    subvalue?: string;
    x: number;
    y: number;
  } | null>(null);

  /** Cumulative PnL curve calculation for high-res SVG chart */
  readonly cumulativeChart = computed(() => {
    const week = this.dashboard().week;
    if (week.length === 0) {
      return { points: [], lineD: '', areaD: '', baselineY: 100, minVal: 0, maxVal: 0 };
    }

    let cum = 0;
    const series = week.map((w) => {
      cum += w.pnlVes;
      return {
        date: w.date,
        shortDate: this.shortDate(w.date),
        dailyPnl: w.pnlVes,
        cumulativePnl: cum,
        volumeUsdt: w.volumeUsdt,
        operations: w.operations,
      };
    });

    const values = series.map((s) => s.cumulativePnl);
    const minVal = Math.min(0, ...values);
    const maxVal = Math.max(1, ...values);
    const range = maxVal - minVal || 1;

    const W = 600;
    const H = 180;
    const padX = 40;
    const padY = 25;
    const plotW = W - padX * 2;
    const plotH = H - padY * 2;

    const points = series.map((s, i) => {
      const x = padX + (plotW / Math.max(series.length - 1, 1)) * i;
      const normY = (s.cumulativePnl - minVal) / range;
      const y = padY + plotH * (1 - normY);
      return { ...s, x, y };
    });

    const lineD = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');
    const firstP = points[0];
    const lastP = points[points.length - 1];
    const baselineNorm = (0 - minVal) / range;
    const baselineY = padY + plotH * (1 - baselineNorm);
    const areaD = `${lineD} L ${lastP.x} ${baselineY} L ${firstP.x} ${baselineY} Z`;

    return { points, lineD, areaD, baselineY, minVal, maxVal };
  });

  barHeight(day: DayActivity): number {
    const max = this.weekMax();
    return Math.max(4, Math.round((Math.abs(day.pnlVes) / max) * 100));
  }

  shortDate(dateKey: string): string {
    const parts = dateKey.split('-');
    if (parts.length < 3) return dateKey;
    return `${parts[2]}/${parts[1]}`;
  }

  decisionLabel(d: string): string {
    const map: Record<string, string> = { ALLOW: 'PERMITIR', DENY: 'DENEGAR', PAUSE: 'PAUSAR' };
    return map[d] ?? d;
  }

  decisionClass(d: string): string {
    const map: Record<string, string> = { ALLOW: 'allow', DENY: 'deny', PAUSE: 'pause' };
    return map[d] ?? '';
  }

  readonly Math = Math;

  readonly activeSessionSummary = computed(() => {
    const s = this.sessionService.activeSession();
    if (!s) return null;
    return computeSessionSummary(s, this.ops());
  });

  startSession(): void {
    this.sessionService.startSession({ targetOps: 5 });
    this.toast.success(
      'Sesión de trading abierta. Las operaciones se vincularán a esta jornada.',
      'Sesión Iniciada',
    );
  }

  openCloseModal(): void {
    this.showCloseModal.set(true);
  }

  cancelCloseModal(): void {
    this.showCloseModal.set(false);
  }

  confirmCloseSession(): void {
    const closed = this.sessionService.closeSession({
      disciplineRating: this.closeDisciplineRating(),
      notes: this.closeNotes(),
    });
    this.showCloseModal.set(false);
    this.closeNotes.set('');
    if (closed) {
      this.toast.info(
        'Sesión cerrada y registrada en el historial de estadísticas.',
        'Sesión Cerrada',
      );
    }
  }

  formatDuration(ms?: number): string {
    if (!ms || ms <= 0) return '0m';
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  /** KPIs → historical performance view. */
  goToStats(): void {
    this.router.navigate(['/stats']);
  }

  /** Daily target / income projection → income calculator. */
  goToIncome(): void {
    this.router.navigate(['/income']);
  }

  /** Session KPIs → live trading terminal. */
  goToSpread(): void {
    this.router.navigate(['/spread']);
  }

  /** Velocity chip → operation log filtered by that bank (forward-compat query param). */
  goToBankLog(bankKey: string): void {
    this.router.navigate(['/log'], { queryParams: { bank: bankKey } });
  }

  /** Chart bar → stats calendar for that day (forward-compat query param). */
  goToDay(day: string): void {
    this.router.navigate(['/stats'], { queryParams: { day } });
  }

  /** Risk verdict → risk rules editor. */
  goToRisk(): void {
    this.router.navigate(['/risk']);
  }

  /** Recent operation row → full operation log. */
  goToLog(): void {
    this.router.navigate(['/log']);
  }

  bcvZoneBadge(zone: string): { label: string; class: string } {
    switch (zone) {
      case 'CRITICAL_DISPERSION':
        return { label: 'DISPERSIÓN CRÍTICA (>35%)', class: 'badge-danger' };
      case 'ELEVATED':
        return { label: 'BRECHA ELEVADA (25-35%)', class: 'badge-warning' };
      case 'COMPRESSED':
        return { label: 'BRECHA COMPRIMIDA (<10%)', class: 'badge-accent' };
      default:
        return { label: 'RANGO NORMAL (10-25%)', class: 'badge-accent' };
    }
  }

  bcvPhaseBadge(phase: string): { label: string; class: string } {
    switch (phase) {
      case 'INTERVENTION_ACTIVE':
        return { label: '🔴 INYECCIÓN ACTIVA EN BANCA', class: 'badge-danger' };
      case 'PRE_INTERVENTION_COMPRESSION':
        return { label: '🟡 PRE-INTERVENCIÓN (ESPERA)', class: 'badge-warning' };
      case 'POST_INTERVENTION_REBOUND':
        return { label: '🟢 VENTANA DE REBOTE (48H)', class: 'badge-success' };
      default:
        return { label: '⚪ ACUMULACIÓN TRANQUILA', class: 'badge-accent' };
    }
  }

  readonly fmtVes = fmtVes;
  readonly fmtUsd = fmtUsd;
}
