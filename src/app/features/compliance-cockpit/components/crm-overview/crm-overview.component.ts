import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  ArmWorkspaceId,
  CrmCashflowColumn,
  CrmDealsStatusRow,
  CrmHealthRecommendation,
  CrmHeroKpiCard,
  CrmOverviewPeriod,
  CrmVelocityBarItem,
} from '../../crm-ui.models';

interface PeriodOption {
  readonly id: CrmOverviewPeriod;
  readonly label: string;
}

interface FunnelStageItem {
  readonly label: string;
  readonly count: number;
  readonly valueLabel: string;
}

interface LedTick {
  readonly index: number;
  readonly tone: 'accent' | 'blue' | 'gold' | 'idle';
}

const OVERVIEW_PERIOD_OPTIONS: readonly PeriodOption[] = [
  { id: 'TODAY', label: 'Hoy' },
  { id: '7D', label: '7D' },
  { id: '30D', label: '30D' },
  { id: 'ALL', label: 'Todo' },
];

const SILO_BADGE_LABELS: Record<ArmWorkspaceId, string> = {
  ARM_B2B: 'ARM B2B',
  P2P_DESK: 'Mesa P2P',
  FINANCE_360: 'Finanzas 360',
};

const LED_TICK_COUNT = 24;

@Component({
  selector: 'app-crm-overview',
  standalone: true,
  imports: [],
  templateUrl: './crm-overview.component.html',
  styleUrl: './crm-overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.silo-b2b]': "activeSilo() === 'ARM_B2B'",
    '[class.silo-p2p]': "activeSilo() === 'P2P_DESK'",
    '[class.silo-360]': "activeSilo() === 'FINANCE_360'",
    '[class.privacy-active]': 'privacyMode()',
  },
})
export class CrmOverviewComponent {
  readonly activeSilo = input<ArmWorkspaceId>('P2P_DESK');
  readonly heroKpis = input<CrmHeroKpiCard[]>([]);
  readonly cashflowColumns = input<CrmCashflowColumn[]>([]);
  readonly velocityBars = input<CrmVelocityBarItem[]>([]);
  readonly totalPipelineVolumeLabel = input<string>('$0.00');
  readonly selectedPeriod = input<CrmOverviewPeriod>('TODAY');
  readonly aiHealthScorePct = input<number>(0);
  readonly aiRecommendations = input<CrmHealthRecommendation[]>([]);
  readonly dealsStatusRows = input<CrmDealsStatusRow[]>([]);
  readonly funnelStages = input<FunnelStageItem[]>([]);
  readonly spreadRateLabel = input<string>('0.00%');
  readonly winRateLabel = input<string>('0%');
  readonly avgCloseLabel = input<string>('—');
  readonly privacyMode = input<boolean>(false);

  readonly kpiDrilldown = output<CrmHeroKpiCard>();
  readonly periodChange = output<CrmOverviewPeriod>();
  readonly askAiStrategist = output<string>();
  readonly recommendationAction = output<CrmHealthRecommendation>();
  readonly openDealDetail = output<CrmDealsStatusRow>();

  protected readonly periodOptions = OVERVIEW_PERIOD_OPTIONS;
  protected readonly strategistPrompt = signal<string>('');

  protected readonly siloLabel = computed<string>(
    () => SILO_BADGE_LABELS[this.activeSilo()],
  );

  protected readonly clampedHealthScore = computed<number>(() =>
    Math.max(0, Math.min(100, Math.round(this.aiHealthScorePct()))),
  );

  protected readonly healthClassification = computed<{
    label: string;
    toneClass: string;
  }>(() => {
    const score = this.clampedHealthScore();
    if (score >= 80) return { label: 'Óptimo', toneClass: 'is-good' };
    if (score >= 55) return { label: 'Atención', toneClass: 'is-warn' };
    return { label: 'Crítico', toneClass: 'is-danger' };
  });

  protected readonly ledSpectrumTicks = computed<readonly LedTick[]>(() => {
    const score = this.clampedHealthScore();
    const activeCount = Math.round((score / 100) * LED_TICK_COUNT);
    const cols = this.cashflowColumns();
    const hasHighlight = cols.some((c) => c.highlighted);

    return Array.from({ length: LED_TICK_COUNT }, (_, index) => {
      if (index >= activeCount) {
        return { index, tone: 'idle' as const };
      }
      if (index < Math.floor(LED_TICK_COUNT * 0.45)) {
        return { index, tone: 'accent' as const };
      }
      if (index < Math.floor(LED_TICK_COUNT * 0.8)) {
        return { index, tone: hasHighlight ? 'blue' : 'accent' };
      }
      return { index, tone: 'gold' as const };
    });
  });

  protected clampPct(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  protected columnHeightPct(index: number, col: CrmCashflowColumn): number {
    if (col.highlighted) return 92;
    const baseHeights = [54, 78, 62, 84, 48];
    return baseHeights[index % baseHeights.length] ?? 60;
  }

  protected onStrategistInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.strategistPrompt.set(target?.value ?? '');
  }

  protected submitStrategistPrompt(event: Event): void {
    event.preventDefault();
    const trimmed = this.strategistPrompt().trim();
    if (!trimmed) return;
    this.askAiStrategist.emit(trimmed);
    this.strategistPrompt.set('');
  }
}
