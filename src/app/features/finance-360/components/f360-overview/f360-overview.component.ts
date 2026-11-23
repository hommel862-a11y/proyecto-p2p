import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  F360CashflowSeriesPoint,
  F360Horizon,
  F360LedgerRowItem,
  F360LiquiditySummary,
  F360NavTabId,
  F360OverviewUpcomingItem,
  F360PnlLine,
  F360QuickActionId,
  FinanceScope,
  WealthGoal,
} from '../../f360-ui.models';

interface ChartCoordinatePoint {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly dateIso: string;
  readonly incomeUsd: number;
  readonly expenseUsd: number;
  readonly netUsd: number;
  readonly x: number;
  readonly xPct: number;
  readonly yIncome: number;
  readonly yExpense: number;
}

interface ChartGridLine {
  readonly y: number;
  readonly label: string;
}

interface SparklineGeometry {
  readonly linePath: string;
  readonly areaPath: string;
}

const HORIZON_BADGE_LABELS: Record<F360Horizon, string> = {
  day: 'Hoy',
  week: '7 días',
  month: '30 días',
  quarter: '90 días',
  year: '12 meses',
};

const CHART_WIDTH = 640;
const CHART_HEIGHT = 210;
const PAD_LEFT = 46;
const PAD_RIGHT = 18;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;
const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function buildSmoothPath(coords: readonly { x: number; y: number }[]): string {
  if (coords.length === 0) return '';
  if (coords.length === 1) {
    return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  }
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const curr = coords[i];
    const next = coords[i + 1];
    const ctrlX = ((curr.x + next.x) / 2).toFixed(1);
    d += ` C ${ctrlX} ${curr.y.toFixed(1)}, ${ctrlX} ${next.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }
  return d;
}

function buildSparkline(values: readonly number[]): SparklineGeometry {
  const w = 112;
  const h = 32;
  const pad = 3;
  if (values.length < 2) {
    const midY = (h / 2).toFixed(1);
    return {
      linePath: `M 0 ${midY} L ${w} ${midY}`,
      areaPath: `M 0 ${midY} L ${w} ${midY} L ${w} ${h} L 0 ${h} Z`,
    };
  }
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = maxVal - minVal || 1;
  const coords = values.map((val, idx) => ({
    x: (idx / (values.length - 1)) * w,
    y: h - pad - ((val - minVal) / span) * (h - pad * 2),
  }));
  const linePath = buildSmoothPath(coords);
  const lastX = coords[coords.length - 1].x.toFixed(1);
  const firstX = coords[0].x.toFixed(1);
  return {
    linePath,
    areaPath: `${linePath} L ${lastX} ${h} L ${firstX} ${h} Z`,
  };
}

@Component({
  selector: 'app-f360-overview',
  standalone: true,
  imports: [],
  templateUrl: './f360-overview.component.html',
  styleUrl: './f360-overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.scope-all]': "activeScope() === 'all'",
    '[class.scope-personal]': "activeScope() === 'personal'",
    '[class.scope-business]': "activeScope() === 'business'",
    '[class.privacy-active]': 'privacyMode()',
  },
})
export class F360OverviewComponent {
  readonly activeScope = input<FinanceScope>('all');
  readonly horizon = input<F360Horizon>('month');
  readonly privacyMode = input<boolean>(false);

  readonly netWorthUsd = input<number>(0);
  readonly netWorthVes = input<number>(0);
  readonly bcvRate = input<number>(0);
  readonly netWorthSparkline = input<readonly number[]>([]);

  readonly periodIncomeUsd = input<number>(0);
  readonly periodExpenseUsd = input<number>(0);
  readonly periodExpenseCount = input<number>(0);

  readonly liquidity = input<F360LiquiditySummary>({
    status: 'optimal',
    ratioPct: 100,
    due14DaysUsd: 0,
    liquidUsd: 0,
    overdueUsd: 0,
    overdueCount: 0,
    detailLabel: 'Sin compromisos inmediatos a 14 días',
  });

  readonly cashflowSeries = input<readonly F360CashflowSeriesPoint[]>([]);
  readonly pnlLines = input<readonly F360PnlLine[]>([]);
  readonly todayP2pProfitUsd = input<number>(0);
  readonly isP2pImportedToday = input<boolean>(false);
  readonly upcomingItems = input<readonly F360OverviewUpcomingItem[]>([]);
  readonly recentActivity = input<readonly F360LedgerRowItem[]>([]);
  readonly goals = input<readonly WealthGoal[]>([]);

  readonly quickAction = output<F360QuickActionId>();
  readonly navigateTab = output<F360NavTabId>();
  readonly payLiability = output<F360OverviewUpcomingItem>();
  readonly deleteLiability = output<F360OverviewUpcomingItem>();
  readonly contributeGoal = output<WealthGoal>();
  readonly deleteGoal = output<WealthGoal>();

  protected readonly ringRadius = RING_RADIUS;
  protected readonly ringCircumference = RING_CIRCUMFERENCE;
  protected readonly chartWidth = CHART_WIDTH;
  protected readonly chartHeight = CHART_HEIGHT;

  protected readonly hoveredPointIndex = signal<number | null>(null);
  protected readonly openUpcomingMenuId = signal<string | null>(null);
  protected readonly openGoalMenuId = signal<string | null>(null);

  protected readonly horizonBadge = computed<string>(() => HORIZON_BADGE_LABELS[this.horizon()]);

  protected readonly periodNetUsd = computed<number>(
    () => this.periodIncomeUsd() - this.periodExpenseUsd(),
  );

  protected readonly savingsRateLabel = computed<string>(() => {
    const inc = this.periodIncomeUsd();
    if (inc <= 0) return 'Sin ingresos en el periodo';
    const pct = ((inc - this.periodExpenseUsd()) / inc) * 100;
    return `Ahorro ${pct.toFixed(1)}%`;
  });

  protected readonly netWorthVesLabel = computed<string>(() => {
    const bcv = this.bcvRate();
    if (!Number.isFinite(bcv) || bcv <= 0) return 'Tasa BCV offline';
    const ves = this.netWorthVes() > 0 || this.netWorthUsd() === 0
      ? this.netWorthVes()
      : this.netWorthUsd() * bcv;
    return `Bs ${this.formatAmount(ves)} BCV`;
  });

  protected readonly liquidityStatusLabel = computed<string>(() => {
    const status = this.liquidity().status;
    if (status === 'optimal') return 'Blindada';
    if (status === 'warning') return 'Ajustada';
    return 'Crítica';
  });

  protected readonly liquidityToneClass = computed<string>(() => {
    const status = this.liquidity().status;
    if (status === 'optimal') return 'tone-gold';
    if (status === 'warning') return 'tone-warn';
    return 'tone-danger';
  });

  protected readonly liquidityRingOffset = computed<number>(() => {
    const pct = Math.max(0, Math.min(100, this.liquidity().ratioPct));
    return RING_CIRCUMFERENCE * (1 - pct / 100);
  });

  protected readonly netWorthSpark = computed<SparklineGeometry>(() => {
    const custom = this.netWorthSparkline();
    if (custom.length >= 2) return buildSparkline(custom);
    const series = this.cashflowSeries();
    if (series.length >= 2) {
      let running = 0;
      const cumulative = series.map((pt) => {
        running += pt.incomeUsd - pt.expenseUsd;
        return running;
      });
      return buildSparkline(cumulative);
    }
    return buildSparkline([]);
  });

  protected readonly netFlowSpark = computed<SparklineGeometry>(() =>
    buildSparkline(this.cashflowSeries().map((pt) => pt.incomeUsd - pt.expenseUsd)),
  );

  protected readonly expenseSpark = computed<SparklineGeometry>(() =>
    buildSparkline(this.cashflowSeries().map((pt) => pt.expenseUsd)),
  );

  protected readonly hasCashflowData = computed<boolean>(() =>
    this.cashflowSeries().some((pt) => pt.incomeUsd > 0 || pt.expenseUsd > 0),
  );

  protected readonly chartPoints = computed<readonly ChartCoordinatePoint[]>(() => {
    const series = this.cashflowSeries();
    if (series.length === 0) return [];
    const maxVal = Math.max(
      1,
      ...series.map((pt) => Math.max(pt.incomeUsd, pt.expenseUsd)),
    );
    const plotW = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
    const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

    return series.map((pt, index) => {
      const ratioX = series.length === 1 ? 0.5 : index / (series.length - 1);
      const x = PAD_LEFT + ratioX * plotW;
      const yIncome = PAD_TOP + plotH - (Math.max(0, pt.incomeUsd) / maxVal) * plotH;
      const yExpense = PAD_TOP + plotH - (Math.max(0, pt.expenseUsd) / maxVal) * plotH;
      return {
        index,
        id: pt.id,
        label: pt.label,
        dateIso: pt.dateIso,
        incomeUsd: pt.incomeUsd,
        expenseUsd: pt.expenseUsd,
        netUsd: pt.netUsd ?? pt.incomeUsd - pt.expenseUsd,
        x,
        xPct: (x / CHART_WIDTH) * 100,
        yIncome,
        yExpense,
      };
    });
  });

  protected readonly chartGridLines = computed<readonly ChartGridLine[]>(() => {
    const series = this.cashflowSeries();
    if (series.length === 0) return [];
    const maxVal = Math.max(
      1,
      ...series.map((pt) => Math.max(pt.incomeUsd, pt.expenseUsd)),
    );
    const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
    return [0, 0.5, 1].map((step) => {
      const value = maxVal * (1 - step);
      return {
        y: PAD_TOP + plotH * step,
        label: value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${Math.round(value)}`,
      };
    });
  });

  protected readonly incomeLinePath = computed<string>(() =>
    buildSmoothPath(this.chartPoints().map((p) => ({ x: p.x, y: p.yIncome }))),
  );

  protected readonly incomeAreaPath = computed<string>(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    const baseline = CHART_HEIGHT - PAD_BOTTOM;
    const line = this.incomeLinePath();
    return `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${baseline} L ${pts[0].x.toFixed(1)} ${baseline} Z`;
  });

  protected readonly expenseLinePath = computed<string>(() =>
    buildSmoothPath(this.chartPoints().map((p) => ({ x: p.x, y: p.yExpense }))),
  );

  protected readonly expenseAreaPath = computed<string>(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    const baseline = CHART_HEIGHT - PAD_BOTTOM;
    const line = this.expenseLinePath();
    return `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${baseline} L ${pts[0].x.toFixed(1)} ${baseline} Z`;
  });

  protected readonly activeTooltipPoint = computed<ChartCoordinatePoint | null>(() => {
    const idx = this.hoveredPointIndex();
    if (idx === null) return null;
    return this.chartPoints()[idx] ?? null;
  });

  protected readonly effectivePnlLines = computed<readonly F360PnlLine[]>(() => {
    const provided = this.pnlLines();
    if (provided.length > 0) return provided;
    const inc = this.periodIncomeUsd();
    const exp = this.periodExpenseUsd();
    const net = inc - exp;
    return [
      { id: 'op', label: 'Ingresos Operativos', amountUsd: inc, tone: 'positive' },
      { id: 'p2p', label: 'Profit P2P Aislado', amountUsd: 0, tone: 'neutral' },
      { id: 'cogs', label: 'Costos Directos', amountUsd: 0, tone: 'negative' },
      { id: 'fixed', label: 'Gastos Fijos', amountUsd: exp, tone: 'negative' },
      {
        id: 'net',
        label: 'Utilidad Neta',
        amountUsd: net,
        sharePct: inc > 0 ? (net / inc) * 100 : 0,
        tone: 'highlight',
      },
    ];
  });

  protected readonly pnlBodyLines = computed<readonly F360PnlLine[]>(() =>
    this.effectivePnlLines().filter((line) => line.tone !== 'highlight'),
  );

  protected readonly pnlFooterLine = computed<F360PnlLine | null>(() => {
    const lines = this.effectivePnlLines();
    return lines.find((line) => line.tone === 'highlight') ?? lines[lines.length - 1] ?? null;
  });

  protected readonly p2pQuickLabel = computed<string>(() => {
    const profit = this.todayP2pProfitUsd();
    if (profit <= 0) return 'Mesa aislada · $0';
    if (this.isP2pImportedToday()) {
      return `Importado hoy · +$${this.formatAmount(profit)}`;
    }
    return `+$${this.formatAmount(profit)} USD hoy`;
  });

  protected readonly visibleActivity = computed<readonly F360LedgerRowItem[]>(() =>
    this.recentActivity().slice(0, 6),
  );

  protected readonly totalEarmarkedGoalsUsd = computed<number>(() =>
    this.goals().reduce((sum, goal) => sum + goal.currentAmountUsd, 0),
  );

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.openUpcomingMenuId.set(null);
    this.openGoalMenuId.set(null);
    this.hoveredPointIndex.set(null);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('.f360-row-menu-anchor')) {
      this.openUpcomingMenuId.set(null);
      this.openGoalMenuId.set(null);
    }
  }

  protected setHoveredPoint(index: number | null): void {
    this.hoveredPointIndex.set(index);
  }

  protected toggleUpcomingMenu(id: string): void {
    this.openGoalMenuId.set(null);
    this.openUpcomingMenuId.update((current) => (current === id ? null : id));
  }

  protected handlePayLiability(item: F360OverviewUpcomingItem): void {
    this.openUpcomingMenuId.set(null);
    this.payLiability.emit(item);
  }

  protected handleDeleteLiability(item: F360OverviewUpcomingItem): void {
    this.openUpcomingMenuId.set(null);
    this.deleteLiability.emit(item);
  }

  protected toggleGoalMenu(id: string): void {
    this.openUpcomingMenuId.set(null);
    this.openGoalMenuId.update((current) => (current === id ? null : id));
  }

  protected handleDeleteGoal(goal: WealthGoal): void {
    this.openGoalMenuId.set(null);
    this.deleteGoal.emit(goal);
  }

  protected goalProgressPct(goal: WealthGoal): number {
    if (goal.targetAmountUsd <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((goal.currentAmountUsd / goal.targetAmountUsd) * 100)));
  }

  protected upcomingDueBadge(item: F360OverviewUpcomingItem): string {
    if (item.status === 'overdue' || item.daysDelta < 0) {
      const days = Math.abs(item.daysDelta);
      return days > 0 ? `Vencido · ${days}d` : 'Vencido';
    }
    if (item.daysDelta === 0) return 'Vence hoy';
    return `En ${item.daysDelta}d`;
  }

  protected formatAmount(value: number): string {
    const safe = Number.isFinite(value) ? value : 0;
    return safe.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  protected formatSignedUsd(value: number): string {
    const safe = Number.isFinite(value) ? value : 0;
    const sign = safe > 0 ? '+' : safe < 0 ? '-' : '';
    return `${sign}$${this.formatAmount(Math.abs(safe))}`;
  }
}
