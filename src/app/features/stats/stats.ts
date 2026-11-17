import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { StorageService } from '../../core/storage';
import { SessionService } from '../../core/session.service';
import { AccountsService } from '../../core/accounts.service';
import { CounterpartyService } from '../../core/counterparty.service';
import { CotizaveService } from '../../core/cotizave.service';
import { P2PRadarService } from '../../core/p2p-radar.service';
import { DecisionJournalService } from '../../core/decision-journal.service';
import { ToastService } from '../../core/toast.service';
import { fmtVes, fmtUsd } from '../../core/format';
import {
  computeStats,
  aggregateSessions,
  generateComplianceStatement,
  buildCalendarMonthView,
  computeFifoAccounting,
  auditTradingDisciplineAndSpreadCompliance,
  analyzeHourlyRiskDistribution,
  operationsToCsv,
  downloadReport,
  formatDuration as sharedFormatDuration,
  type Operation,
  type PeriodKind,
  type PeriodStat,
  type SessionSummary,
  type ComplianceReportMetadata,
  type ComplianceStatement,
  type CalendarMonthView,
  type CalendarDayStat,
  type FifoAccountingSummary,
  type ForensicOperationRecord,
  type SpreadDisciplineResult,
} from '@p2p/core';
import { UiCard } from '../../shared/ui/ui-card';
import { UiPanelHeader } from '../../shared/ui/ui-panel-header';
import { UiToolbarSegmented } from '../../shared/ui/ui-toolbar-segmented';
import { UiChip } from '../../shared/ui/ui-chip';
import { McpService } from '../../core/mcp.service';

export type ExtendedPeriodKind = PeriodKind | 'session' | 'calendar';
export type StatsWorkspaceTab = 'overview' | 'calendar' | 'session' | 'periods' | 'stress';

/** Local UI-view key (component-scoped), following the app-wide `p2p.*` storage pattern. */
const STATS_UI_KEY = 'p2p.stats.ui';
const COMPLIANCE_META_KEY = 'p2p.stats.compliance-meta';

const DEFAULT_COMPLIANCE_META: ComplianceReportMetadata = {
  operatorName: 'Operador P2P Independiente',
  documentId: 'V-00.000.000',
  economicActivity: 'Intercambio y corretaje de criptoactivos en plataforma P2P',
  targetBank: 'Banesco Banco Universal',
  targetAccountNumber: '',
};

const PERIODS: readonly ExtendedPeriodKind[] = ['day', 'month', 'quarter', 'session', 'calendar'];
const WORKSPACE_TABS: readonly StatsWorkspaceTab[] = [
  'overview',
  'calendar',
  'session',
  'periods',
  'stress',
];
const PAIR_FILTERS: readonly ('all' | 'USDT' | 'EUR')[] = ['all', 'USDT', 'EUR'];

const BANK_PALETTE = ['#30d158', '#22d3ee', '#ffd60a', '#0a84ff', '#ff9f0a', '#94a3b8'] as const;

interface StatsUiState {
  period: ExtendedPeriodKind;
  pairFilter: 'all' | 'USDT' | 'EUR';
  workspaceTab?: StatsWorkspaceTab;
}

export interface LiveMarketRateInfo {
  rate: number | null;
  source: 'cotizave' | 'radar' | 'none';
  label: string;
}

export interface BankSliceViewModel {
  key: string;
  label: string;
  count: number;
  volumeUsdt: number;
  sharePct: number;
  color: string;
  dashArray: string;
  dashOffset: number;
}

export interface FlowPointViewModel {
  period: string;
  shortLabel: string;
  pnlVes: number;
  cumPnlVes: number;
  volumeUsdt: number;
  barHeightPct: number;
  isPositive: boolean;
  svgX: number;
  svgY: number;
}

export interface ComplianceTelemetrySnapshot {
  totalOps: number;
  ocrCount: number;
  ocrCoveragePct: number | null;
  errorFreePct: number | null;
  topCounterpartyAlias: string | null;
  topCounterpartySharePct: number | null;
  maxBankUsagePct: number;
  compositeScore: number | null;
  verdictLabel: 'CONFORME' | 'ALERTA' | 'SIN DATOS';
}

function sanitizeStatsUi(raw: StatsUiState | null): StatsUiState | null {
  if (!raw) return null;
  const period = PERIODS.includes(raw.period) ? raw.period : null;
  const pairFilter = PAIR_FILTERS.includes(raw.pairFilter) ? raw.pairFilter : null;
  if (!period || !pairFilter) return null;
  const workspaceTab =
    raw.workspaceTab && WORKSPACE_TABS.includes(raw.workspaceTab)
      ? raw.workspaceTab
      : period === 'calendar'
        ? 'calendar'
        : period === 'session'
          ? 'session'
          : 'overview';
  return { period, pairFilter, workspaceTab };
}

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule, UiCard, UiPanelHeader, UiToolbarSegmented, UiChip],
  templateUrl: './stats.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Stats {
  private readonly storage = inject(StorageService);
  private readonly sessionService = inject(SessionService);
  readonly accountsService = inject(AccountsService);
  readonly crmService = inject(CounterpartyService);
  readonly mcpService = inject(McpService);
  private readonly cotizaveService = inject(CotizaveService, { optional: true });
  private readonly radarService = inject(P2PRadarService, { optional: true });
  readonly journalService = inject(DecisionJournalService, { optional: true });
  private readonly toast = inject(ToastService, { optional: true });

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
  readonly mcpStressError = signal<string | null>(null);
  readonly stressUsdtCapital = signal<number>(2500);
  readonly stressVesCapital = signal<number>(150000);
  readonly stressRefRate = signal<number>(800);

  // MCP Tool: audit_counterparty_exposure
  readonly mcpCounterpartyAuditResult = signal<{
    status?: string;
    complianceVerdict?: string;
    uniqueCounterpartiesCount?: number | null;
    counterpartyRiskScore?: number | null;
    flaggedCounterpartiesCount?: number | null;
    isSafeForInstitutionalTrading?: boolean | null;
    unavailableReason?: string;
    recommendations?: string[] | null;
  } | null>(null);
  readonly mcpAuditing = signal<boolean>(false);
  readonly mcpAuditError = signal<string | null>(null);

  firstRender = true;
  dayAppliedFromParam = false;
  dayParamDate = '';

  private readonly restoredUi: StatsUiState | null = sanitizeStatsUi(
    this.storage.get<StatsUiState>(STATS_UI_KEY),
  );

  readonly period = signal<ExtendedPeriodKind>(this.restoredUi?.period ?? 'day');
  readonly pairFilter = signal<'all' | 'USDT' | 'EUR'>(this.restoredUi?.pairFilter ?? 'all');
  readonly bankFilter = signal<string>('');
  readonly workspaceTab = signal<StatsWorkspaceTab>(this.restoredUi?.workspaceTab ?? 'overview');

  /** Calendar Bitácora state (initialized before query-param resolution). */
  readonly calendarYear = signal<number>(new Date().getUTCFullYear());
  readonly calendarMonth = signal<number>(new Date().getUTCMonth() + 1);
  readonly selectedCalendarDay = signal<CalendarDayStat | null>(null);

  /** Compliance statement generation state */
  readonly showComplianceModal = signal<boolean>(false);
  readonly complianceBankAccountId = signal<string>('');
  readonly complianceMeta = signal<ComplianceReportMetadata>({
    ...DEFAULT_COMPLIANCE_META,
    ...(this.storage.get<Partial<ComplianceReportMetadata>>(COMPLIANCE_META_KEY) ?? {}),
  });
  readonly complianceStartDate = signal<string>('');
  readonly complianceEndDate = signal<string>('');

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
        if (!isNaN(year) && !isNaN(month) && !isNaN(day) && month >= 1 && month <= 12) {
          this.calendarYear.set(year);
          this.calendarMonth.set(month);
          this.dayAppliedFromParam = true;
          this.dayParamDate = dayParam;
          this.period.set('calendar');
          this.workspaceTab.set('calendar');
          const match = this.calendarMonthView().days.find((d) => d?.date === dayParam) ?? null;
          if (match) {
            this.selectedCalendarDay.set(match);
          }
        }
      }
    }
  }

  private readonly persistEffect = effect(() => {
    if (this.firstRender) {
      this.firstRender = false;
      return;
    }
    this.storage.set(STATS_UI_KEY, {
      period: this.period(),
      pairFilter: this.pairFilter(),
      workspaceTab: this.workspaceTab(),
    });
  });

  /** Live operation ledger backed reactively by AccountsService.rawOperations(). */
  readonly rawOperations = computed<Operation[]>(() => {
    const raw = this.accountsService.rawOperations();
    return Array.isArray(raw) ? raw : [];
  });

  /** Filtered trading operations (`buy`/`sell` only, respecting pair and optional bank filters). */
  readonly filteredOps = computed<Operation[]>(() => {
    const pair = this.pairFilter();
    const bankId = this.bankFilter();
    return this.rawOperations().filter(
      (o) =>
        (o.type === 'buy' || o.type === 'sell') &&
        (pair === 'all' || o.pair === pair) &&
        (!bankId || o.bankAccountId === bankId),
    );
  });

  /** Live reference VES rate without fabricated constants (returns null when unavailable/expired). */
  readonly liveMarketRate = computed<LiveMarketRateInfo>(() => {
    if (this.cotizaveService && this.cotizaveService.ratesProvenance() !== 'none') {
      const rates = this.cotizaveService.ratesByMarket();
      const keys =
        this.pairFilter() === 'EUR'
          ? ['eur_reference', 'binance', 'parallel', 'oficial']
          : ['binance', 'parallel', 'oficial'];
      for (const k of keys) {
        const entry = rates[k];
        if (!entry) continue;
        const val =
          entry.mid && entry.mid > 0
            ? entry.mid
            : entry.ask && entry.bid
              ? (entry.ask + entry.bid) / 2
              : entry.ask || entry.bid || 0;
        if (val > 0) {
          return { rate: val, source: 'cotizave', label: `CotizaVe (${k})` };
        }
      }
    }

    const hud = this.radarService?.lastHudPayload();
    if (hud?.bestRoute) {
      const rate = hud.bestRoute.buyPrice > 0 ? hud.bestRoute.buyPrice : hud.bestRoute.sellPrice;
      if (rate > 0) {
        return { rate, source: 'radar', label: 'Radar L2' };
      }
    }

    return { rate: null, source: 'none', label: 'Sin tasa en vivo' };
  });

  readonly complianceStatement = computed<ComplianceStatement>(() => {
    const ops = this.filteredOps();
    const accounts = this.accountsService.accounts();
    const counterparties = this.crmService.counterparties();
    return generateComplianceStatement(ops, accounts, counterparties, this.complianceMeta(), {
      startDate: this.complianceStartDate() || undefined,
      endDate: this.complianceEndDate() || undefined,
      bankAccountId: this.complianceBankAccountId() || undefined,
      pair: this.pairFilter(),
    });
  });

  private readonly summary = computed(() => computeStats(this.filteredOps(), 'all'));

  readonly fifoSummary = computed<FifoAccountingSummary>(() =>
    computeFifoAccounting(this.filteredOps()),
  );

  /** Golden Rule discipline evaluated strictly over closed FIFO trade pairs (NOT_ASSESSED when empty). */
  readonly spreadDiscipline = computed<SpreadDisciplineResult>(() => {
    const ops = this.filteredOps();
    const fifo = this.fifoSummary();
    if (fifo.matches.length === 0) {
      return auditTradingDisciplineAndSpreadCompliance([], 0.5);
    }
    const opById = new Map(ops.map((o) => [o.id, o]));
    const forensicOps: ForensicOperationRecord[] = [];
    for (const m of fifo.matches) {
      if (m.openingPriceVes <= 0 || m.closingPriceVes <= 0) continue;
      const closeOp = opById.get(m.closingOpId);
      const openOp = opById.get(m.openingOpId);
      const spreadPct = ((m.closingPriceVes - m.openingPriceVes) / m.openingPriceVes) * 100;
      forensicOps.push({
        id: m.closingOpId,
        timestamp: closeOp?.timestamp ?? openOp?.timestamp ?? new Date().toISOString(),
        side: closeOp?.type,
        cryptoAmount: m.matchedAmount,
        fiatAmount: m.matchedAmount * m.closingPriceVes,
        price: m.closingPriceVes,
        netSpreadPct: Number(spreadPct.toFixed(4)),
        errorFree: (closeOp?.errorFree ?? true) && (openOp?.errorFree ?? true),
      });
    }
    return auditTradingDisciplineAndSpreadCompliance(forensicOps, 0.5);
  });

  readonly hourlyRisk = computed(() => {
    const ops = this.filteredOps();
    const events = ops
      .filter((o) => !o.errorFree || o.price <= 0)
      .map((o) => ({
        id: o.id,
        timestamp: o.timestamp,
        severity: !o.errorFree ? 'error' : 'warn',
        action: o.type,
      }));
    return analyzeHourlyRiskDistribution(events);
  });

  readonly complianceTelemetry = computed<ComplianceTelemetrySnapshot>(() => {
    const ops = this.filteredOps();
    const usages = this.accountsService.usages();
    const velocities = this.accountsService.accountVelocities();
    const maxLimitPct = usages.reduce(
      (max, u) => (u.consumedLimitPct > max ? Math.round(u.consumedLimitPct) : max),
      0,
    );
    const maxVelocityPct = velocities.reduce(
      (max, v) => (v.usedPct > max ? Math.round(v.usedPct) : max),
      0,
    );
    const maxBankUsagePct = Math.max(maxLimitPct, maxVelocityPct);

    if (ops.length === 0) {
      return {
        totalOps: 0,
        ocrCount: 0,
        ocrCoveragePct: null,
        errorFreePct: null,
        topCounterpartyAlias: null,
        topCounterpartySharePct: null,
        maxBankUsagePct,
        compositeScore: null,
        verdictLabel: 'SIN DATOS',
      };
    }

    const ocrCount = ops.filter((o) => Boolean(o.receiptReference?.trim())).length;
    const errorFreeCount = ops.filter((o) => o.errorFree).length;
    const ocrCoveragePct = Math.round((ocrCount / ops.length) * 100);
    const errorFreePct = Math.round((errorFreeCount / ops.length) * 100);

    // Counterparty volume concentration computed solely from actual traded operations
    const cpMap = new Map(this.crmService.counterparties().map((c) => [c.id, c.alias]));
    const byCp = new Map<string, number>();
    let totalVol = 0;
    for (const op of ops) {
      const alias =
        (op.counterpartyId ? cpMap.get(op.counterpartyId) : undefined) ||
        op.payerName?.trim() ||
        op.merchantNote?.trim() ||
        'Sin identificar';
      const vol = Number(op.usdtAmount) || 0;
      totalVol += vol;
      byCp.set(alias, (byCp.get(alias) ?? 0) + vol);
    }

    let topCounterpartyAlias: string | null = null;
    let topVol = 0;
    for (const [alias, vol] of byCp.entries()) {
      if (vol > topVol) {
        topVol = vol;
        topCounterpartyAlias = alias;
      }
    }
    const topCounterpartySharePct = totalVol > 0 ? Math.round((topVol / totalVol) * 100) : null;

    const disc = this.spreadDiscipline();
    const disciplineScore =
      disc.assessmentStatus === 'ASSESSED' && disc.complianceRatePct !== null
        ? disc.complianceRatePct
        : errorFreePct;
    const compositeScore = Math.round(
      errorFreePct * 0.45 + disciplineScore * 0.35 + ocrCoveragePct * 0.2,
    );

    return {
      totalOps: ops.length,
      ocrCount,
      ocrCoveragePct,
      errorFreePct,
      topCounterpartyAlias,
      topCounterpartySharePct,
      maxBankUsagePct,
      compositeScore,
      verdictLabel: compositeScore >= 75 ? 'CONFORME' : 'ALERTA',
    };
  });

  readonly bankBreakdown = computed<BankSliceViewModel[]>(() => {
    const ops = this.filteredOps();
    if (ops.length === 0) return [];
    const accountsMap = new Map(this.accountsService.accounts().map((a) => [a.id, a]));
    const groups = new Map<string, { label: string; count: number; volumeUsdt: number }>();

    for (const op of ops) {
      const acc = op.bankAccountId ? accountsMap.get(op.bankAccountId) : undefined;
      const isBcv = op.merchantNote?.startsWith('MESA_BCV:') || op.notes?.includes('MESA_BCV:');
      const key = acc ? acc.id : isBcv ? 'mesa-bcv' : 'unassigned';
      const label = acc ? acc.bankName : isBcv ? 'Mesa BCV' : 'Sin Asignar';
      const prev = groups.get(key) ?? { label, count: 0, volumeUsdt: 0 };
      prev.count += 1;
      prev.volumeUsdt += Number(op.usdtAmount) || 0;
      groups.set(key, prev);
    }

    const total = Array.from(groups.values()).reduce((s, g) => s + g.volumeUsdt, 0);
    const circumference = 2 * Math.PI * 42;
    let offsetAcc = 0;

    return Array.from(groups.entries())
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => b.volumeUsdt - a.volumeUsdt)
      .slice(0, 6)
      .map((g, idx) => {
        const sharePct = total > 0 ? Math.round((g.volumeUsdt / total) * 100) : 0;
        const arcLen = total > 0 ? (g.volumeUsdt / total) * circumference : 0;
        const slice: BankSliceViewModel = {
          key: g.key,
          label: g.label,
          count: g.count,
          volumeUsdt: g.volumeUsdt,
          sharePct,
          color: BANK_PALETTE[idx % BANK_PALETTE.length],
          dashArray: `${arcLen.toFixed(2)} ${circumference.toFixed(2)}`,
          dashOffset: -offsetAcc,
        };
        offsetAcc += arcLen;
        return slice;
      });
  });

  readonly flowSeries = computed<{
    points: FlowPointViewModel[];
    polylinePoints: string;
    areaPath: string;
  }>(() => {
    const source = [...this.summary().daily].reverse().slice(-14);
    if (source.length === 0) {
      return { points: [], polylinePoints: '', areaPath: '' };
    }
    const maxAbsPnl = Math.max(1, ...source.map((r) => Math.abs(r.pnlVes)));
    let running = 0;
    const cumValues = source.map((r) => {
      running += r.pnlVes;
      return running;
    });
    const minCum = Math.min(0, ...cumValues);
    const maxCum = Math.max(1, ...cumValues);
    const rangeCum = Math.max(1, maxCum - minCum);

    const width = 420;
    const height = 140;
    const padX = 18;
    const padY = 16;
    const usableW = width - padX * 2;
    const usableH = height - padY * 2;

    const points: FlowPointViewModel[] = source.map((r, i) => {
      const cumPnlVes = cumValues[i];
      const svgX =
        source.length === 1 ? width / 2 : padX + (i / (source.length - 1)) * usableW;
      const svgY = padY + (1 - (cumPnlVes - minCum) / rangeCum) * usableH;
      return {
        period: r.period,
        shortLabel: r.period.slice(5),
        pnlVes: r.pnlVes,
        cumPnlVes,
        volumeUsdt: r.volumeUsdt,
        barHeightPct: Math.max(8, Math.round((Math.abs(r.pnlVes) / maxAbsPnl) * 100)),
        isPositive: r.pnlVes >= 0,
        svgX: Math.round(svgX * 10) / 10,
        svgY: Math.round(svgY * 10) / 10,
      };
    });

    const polylinePoints = points.map((p) => `${p.svgX},${p.svgY}`).join(' ');
    const baseY = height - padY;
    const areaPath =
      points.length > 0
        ? `M ${points[0].svgX},${baseY} L ${points.map((p) => `${p.svgX},${p.svgY}`).join(' L ')} L ${points[points.length - 1].svgX},${baseY} Z`
        : '';

    return { points, polylinePoints, areaPath };
  });

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
    return aggregateSessions(sessions, this.filteredOps());
  });

  readonly calendarMonthView = computed<CalendarMonthView>(() => {
    const refRate = this.liveMarketRate().rate ?? 0;
    return buildCalendarMonthView(
      this.filteredOps(),
      this.calendarYear(),
      this.calendarMonth(),
      refRate,
    );
  });

  readonly selectedDayOps = computed<Operation[]>(() => {
    const day = this.selectedCalendarDay();
    if (!day) return [];
    return this.filteredOps().filter((o) => {
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

  setWorkspaceTab(tab: StatsWorkspaceTab): void {
    this.workspaceTab.set(tab);
    if (tab === 'calendar') {
      this.period.set('calendar');
    } else if (tab === 'session') {
      this.period.set('session');
    } else if (this.period() === 'calendar' || this.period() === 'session') {
      this.period.set('day');
    }
  }

  setPeriod(p: ExtendedPeriodKind): void {
    this.period.set(p);
    if (p === 'calendar') {
      this.workspaceTab.set('calendar');
    } else if (p === 'session') {
      this.workspaceTab.set('session');
    }
  }

  setPairFilter(p: 'all' | 'USDT' | 'EUR'): void {
    this.pairFilter.set(p);
  }

  setBankFilter(bankId: string): void {
    this.bankFilter.set(bankId);
  }

  clearDayFilter(): void {
    this.dayAppliedFromParam = false;
    this.dayParamDate = '';
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
    this.complianceMeta.update((curr) => {
      const next = { ...curr, ...partial };
      this.storage.set(COMPLIANCE_META_KEY, next);
      return next;
    });
  }

  selectComplianceBankAccount(accountId: string): void {
    this.complianceBankAccountId.set(accountId);
    if (!accountId) return;
    const acc = this.accountsService.getAccountById(accountId);
    if (acc) {
      this.patchComplianceMeta({
        targetBank: acc.bankName,
        targetAccountNumber: acc.accountNumberMasked,
      });
    }
  }

  syncLiveCapitalToStress(): void {
    const usages = this.accountsService.usages();
    const totalVes = usages.reduce((sum, u) => sum + Math.max(0, u.currentBalanceVes), 0);
    if (totalVes > 0) {
      this.stressVesCapital.set(Math.round(totalVes * 100) / 100);
    }
    const openUsdt = Math.max(0, this.fifoSummary().openInventoryAmount);
    if (openUsdt > 0) {
      this.stressUsdtCapital.set(Math.round(openUsdt * 100) / 100);
    }
    const liveRate = this.liveMarketRate().rate;
    if (liveRate && liveRate > 0) {
      this.stressRefRate.set(Math.round(liveRate * 100) / 100);
    }
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

  exportFilteredCsv(): void {
    const ops = this.filteredOps();
    if (ops.length === 0) {
      this.toast?.info('No hay operaciones para exportar en CSV.');
      return;
    }
    const csv = operationsToCsv(ops, true);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadReport(csv, `p2p-auditoria-${stamp}.csv`, 'text/csv;charset=utf-8;');
    this.toast?.success('Extracto de auditoría CSV descargado.');
  }

  async runStressTest(): Promise<void> {
    this.mcpStressError.set(null);
    if (this.stressRefRate() <= 0) {
      const msg = 'Ingresa una tasa de referencia mayor a 0 Bs para simular estrés.';
      this.mcpStressError.set(msg);
      this.toast?.error(msg);
      return;
    }
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
      } else {
        const msg = res.error || 'No se pudo completar el stress test cambiario.';
        this.mcpStressError.set(msg);
        this.toast?.error(msg);
      }
    } catch (err) {
      console.error('[Stats] Error executing stress test:', err);
      const msg = 'Error inesperado al ejecutar stress test cambiario.';
      this.mcpStressError.set(msg);
      this.toast?.error(msg);
    } finally {
      this.mcpStressTesting.set(false);
    }
  }

  async runCounterpartyAudit(): Promise<void> {
    this.mcpAuditError.set(null);
    this.mcpAuditing.set(true);
    try {
      const opsCount = this.filteredOps().length;
      const topAlias = this.complianceTelemetry().topCounterpartyAlias ?? undefined;
      const res = await this.mcpService.auditCounterpartyExposure({
        counterpartyAlias: topAlias,
        historicalTradesCount: opsCount,
        maxConcentrationPct: 20,
      });
      if (res.success && res.result) {
        this.mcpCounterpartyAuditResult.set(
          res.result as NonNullable<ReturnType<typeof this.mcpCounterpartyAuditResult>>,
        );
      } else {
        const msg = res.error || 'No se pudo auditar exposición de contrapartes.';
        this.mcpAuditError.set(msg);
        this.toast?.error(msg);
      }
    } catch (err) {
      console.error('[Stats] Error auditing counterparties:', err);
      const msg = 'Error inesperado al auditar exposición de contrapartes.';
      this.mcpAuditError.set(msg);
      this.toast?.error(msg);
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
