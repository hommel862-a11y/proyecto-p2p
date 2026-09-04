import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { StorageService } from '../../core/storage';
import { RisksService } from '../../core/rules';
import { SessionService } from '../../core/session.service';
import { AccountsService } from '../../core/accounts.service';
import { ToastService } from '../../core/toast.service';
import { fmtVes, fmtUsd, FORMAT_PIPES } from '../../core/format';
import {
  computeDashboard,
  computeSessionSummary,
  type Operation,
  type DayActivity,
} from '@p2p/core';

const OPS_KEY = 'p2p.operations';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, ...FORMAT_PIPES],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private readonly storage = inject(StorageService);
  private readonly risks = inject(RisksService);
  private readonly toast = inject(ToastService);
  readonly sessionService = inject(SessionService);
  readonly accountsService = inject(AccountsService);

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

  readonly fmtVes = fmtVes;
  readonly fmtUsd = fmtUsd;
}
