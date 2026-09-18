import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { StorageService } from '../../core/storage';
import { SessionService } from '../../core/session.service';
import { AccountsService } from '../../core/accounts.service';
import { CounterpartyService } from '../../core/counterparty.service';
import { fmtVes, fmtUsd } from '../../core/format';
import {
  computeStats,
  aggregateSessions,
  generateComplianceStatement,
  buildCalendarMonthView,
  OPS_KEY,
  formatDuration as sharedFormatDuration,
  type Operation,
  type PeriodKind,
  type PeriodStat,
  type SessionSummary,
  type ComplianceReportMetadata,
  type ComplianceStatement,
  type CalendarMonthView,
  type CalendarDayStat,
} from '@p2p/core';
import { UiCard } from '../../shared/ui/ui-card';
import { UiPanelHeader } from '../../shared/ui/ui-panel-header';
import { UiToolbarSegmented } from '../../shared/ui/ui-toolbar-segmented';
import { UiChip } from '../../shared/ui/ui-chip';
import { McpService } from '../../core/mcp.service';

export type ExtendedPeriodKind = PeriodKind | 'session' | 'calendar';

/** Local UI-view key (component-scoped), following the app-wide `p2p.*` storage pattern. */
const STATS_UI_KEY = 'p2p.stats.ui';

const PERIODS: readonly ExtendedPeriodKind[] = ['day', 'month', 'quarter', 'session', 'calendar'];
const PAIR_FILTERS: readonly ('all' | 'USDT' | 'EUR')[] = ['all', 'USDT', 'EUR'];

interface StatsUiState {
  period: ExtendedPeriodKind;
  pairFilter: 'all' | 'USDT' | 'EUR';
}

function sanitizeStatsUi(raw: StatsUiState | null): StatsUiState | null {
  if (!raw) return null;
  const period = PERIODS.includes(raw.period) ? raw.period : null;
  const pairFilter = PAIR_FILTERS.includes(raw.pairFilter) ? raw.pairFilter : null;
  if (!period || !pairFilter) return null;
  return { period, pairFilter };
}

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule, UiCard, UiPanelHeader, UiToolbarSegmented, UiChip],
  templateUrl: './stats.html',
})
export class Stats {
  private readonly storage = inject(StorageService);
  private readonly sessionService = inject(SessionService);
  readonly accountsService = inject(AccountsService);
  readonly crmService = inject(CounterpartyService);
  readonly mcpService = inject(McpService);

  // MCP Tool: stress_test_portfolio
  readonly mcpStressResult = signal<{
    baselinePortfolioValueUsdt?: number;
    totalPortfolioValueUsdt?: number;
    scenarios?: {
      devaluationPct?: number;
      lossUsdt?: number;
      unhedgedLossUsdt?: number;
    }[];
  } | null>(null);
  readonly mcpStressTesting = signal<boolean>(false);
  readonly stressUsdtCapital = signal<number>(2500);
  readonly stressVesCapital = signal<number>(150000);
  readonly stressRefRate = signal<number>(800);

  // MCP Tool: audit_counterparty_exposure
  readonly mcpCounterpartyAuditResult = signal<{
    status?: string;
    uniqueCounterpartiesCount?: number;
  } | null>(null);
  readonly mcpAuditing = signal<boolean>(false);

  firstRender = true;
  dayAppliedFromParam = false;
  dayParamDate = '';

  private readonly restoredUi: StatsUiState | null = sanitizeStatsUi(
    this.storage.get<StatsUiState>(STATS_UI_KEY),
  );

  readonly period = signal<ExtendedPeriodKind>(this.restoredUi?.period ?? 'day');
  readonly pairFilter = signal<'all' | 'USDT' | 'EUR'>(this.restoredUi?.pairFilter ?? 'all');

  constructor() {
    const router = inject(Router);
    const url = router.parseUrl(router.url);
    const dayParam = url.queryParams['day'];
    if (dayParam) {
      const parts = dayParam.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
          this.calendarYear.set(year);
          this.calendarMonth.set(month);
          this.dayAppliedFromParam = true;
          this.dayParamDate = dayParam;
        }
      }
    }
  }

  private readonly persistEffect = effect(() => {
    if (this.firstRender) {
      this.firstRender = false;
      return;
    }
    this.storage.set(STATS_UI_KEY, { period: this.period(), pairFilter: this.pairFilter() });
  });

  /** Compliance statement generation state */
  readonly showComplianceModal = signal<boolean>(false);
  readonly complianceMeta = signal<ComplianceReportMetadata>({
    operatorName: 'Operador P2P Independiente',
    documentId: 'V-00.000.000',
    economicActivity: 'Intercambio y corretaje de criptoactivos en plataforma P2P',
    targetBank: 'Banesco Banco Universal',
    targetAccountNumber: '',
  });
  readonly complianceStartDate = signal<string>('');
  readonly complianceEndDate = signal<string>('');

  readonly complianceStatement = computed<ComplianceStatement>(() => {
    const ops = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    const accounts = this.accountsService.accounts();
    const counterparties = this.crmService.counterparties();
    return generateComplianceStatement(ops, accounts, counterparties, this.complianceMeta(), {
      startDate: this.complianceStartDate() || undefined,
      endDate: this.complianceEndDate() || undefined,
    });
  });

  private readonly summary = computed(() =>
    computeStats(this.storage.get<Operation[]>(OPS_KEY) ?? [], this.pairFilter()),
  );

  readonly rows = computed<PeriodStat[]>(() => {
    const s = this.summary();
    if (this.period() === 'day') return s.daily;
    if (this.period() === 'month') return s.monthly;
    return s.quarterly;
  });

  readonly totals = computed(() => {
    const d = this.summary().daily;
    return {
      operations: d.reduce((a, p) => a + p.operations, 0),
      pnlVes: d.reduce((a, p) => a + p.pnlVes, 0),
      volumeUsdt: d.reduce((a, p) => a + p.volumeUsdt, 0),
      fees: d.reduce((a, p) => a + p.fees, 0),
    };
  });

  readonly sessionSummaries = computed<SessionSummary[]>(() => {
    const sessions = this.sessionService.sessions();
    const ops = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    return aggregateSessions(sessions, ops);
  });

  /** Calendar Bitácora state */
  readonly calendarYear = signal<number>(new Date().getUTCFullYear());
  readonly calendarMonth = signal<number>(new Date().getUTCMonth() + 1);
  readonly selectedCalendarDay = signal<CalendarDayStat | null>(null);

  readonly calendarMonthView = computed<CalendarMonthView>(() => {
    const ops = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    return buildCalendarMonthView(ops, this.calendarYear(), this.calendarMonth(), 60.0);
  });

  readonly selectedDayOps = computed<Operation[]>(() => {
    const day = this.selectedCalendarDay();
    if (!day) return [];
    const ops = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    return ops.filter((o) => {
      const d = new Date(o.timestamp);
      if (Number.isNaN(d.getTime())) return false;
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      return dateStr === day.date;
    });
  });

  prevMonth(): void {
    if (this.calendarMonth() === 1) {
      this.calendarMonth.set(12);
      this.calendarYear.update((y) => y - 1);
    } else {
      this.calendarMonth.update((m) => m - 1);
    }
    this.selectedCalendarDay.set(null);
  }

  nextMonth(): void {
    if (this.calendarMonth() === 12) {
      this.calendarMonth.set(1);
      this.calendarYear.update((y) => y + 1);
    } else {
      this.calendarMonth.update((m) => m + 1);
    }
    this.selectedCalendarDay.set(null);
  }

  selectDay(day: CalendarDayStat | null): void {
    if (!day) return;
    this.selectedCalendarDay.set(day);
  }

  setPeriod(p: ExtendedPeriodKind): void {
    this.period.set(p);
  }

  setPairFilter(p: 'all' | 'USDT' | 'EUR'): void {
    this.pairFilter.set(p);
  }

  clearDayFilter(): void {
    this.selectedCalendarDay.set(null);
    this.calendarYear.set(new Date().getUTCFullYear());
    this.calendarMonth.set(new Date().getUTCMonth() + 1);
  }

  formatDuration(ms: number): string {
    return sharedFormatDuration(ms);
  }

  formatRating(stars?: number): string {
    if (!stars || stars <= 0) return '—';
    return '⭐'.repeat(Math.min(5, Math.max(1, stars)));
  }

  patchComplianceMeta(partial: Partial<ComplianceReportMetadata>): void {
    this.complianceMeta.update((curr) => ({ ...curr, ...partial }));
  }

  openComplianceModal(): void {
    this.showComplianceModal.set(true);
  }

  closeComplianceModal(): void {
    this.showComplianceModal.set(false);
  }

  printComplianceReport(): void {
    window.print();
  }

  async runStressTest(): Promise<void> {
    this.mcpStressTesting.set(true);
    try {
      const res = await this.mcpService.stressTestPortfolio({
        usdtCapital: this.stressUsdtCapital(),
        vesCapital: this.stressVesCapital(),
        referenceRate: this.stressRefRate(),
        devaluationScenariosPct: [10, 20, 35],
      });
      if (res.success && res.result) {
        this.mcpStressResult.set(
          res.result as NonNullable<ReturnType<typeof this.mcpStressResult>>,
        );
      }
    } catch (err) {
      console.error('[Stats] Error executing stress test:', err);
    } finally {
      this.mcpStressTesting.set(false);
    }
  }

  async runCounterpartyAudit(): Promise<void> {
    this.mcpAuditing.set(true);
    try {
      const res = await this.mcpService.auditCounterpartyExposure({
        maxConcentrationPct: 20,
      });
      if (res.success && res.result) {
        this.mcpCounterpartyAuditResult.set(
          res.result as NonNullable<ReturnType<typeof this.mcpCounterpartyAuditResult>>,
        );
      }
    } catch (err) {
      console.error('[Stats] Error auditing counterparties:', err);
    } finally {
      this.mcpAuditing.set(false);
    }
  }

  // Shared es-VE money formatters (byte-identical to the `ves`/`usdt` pipes).
  readonly fmtVes = fmtVes;
  readonly fmtUsd = fmtUsd;
  // Whole-number counts render without forced decimals — es-VE formatting kept identical.
  readonly fmtNum = (v: number): string => v.toLocaleString('es-VE', { maximumFractionDigits: 2 });
}
