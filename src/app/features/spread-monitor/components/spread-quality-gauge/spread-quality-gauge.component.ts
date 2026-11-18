import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { SpreadQualityFactorKey, SpreadQualityResult } from '@p2p/core';
import { SpatialTilt3dDirective } from '../../../../shared/ui/spatial-tilt-3d.directive';

export interface CompoundCycleItem {
  readonly label: string;
  readonly netVes: number;
  readonly netUsdt: number;
}

export interface TopBankGaugeItem {
  readonly bankCode: string;
  readonly label: string;
  readonly score: number;
  readonly roiPct: number;
}

export const SQS_FACTOR_TONE = {
  OPTIMAL: 'optimal',
  HEALTHY: 'healthy',
  CAUTION: 'caution',
  TOXIC: 'toxic',
} as const;

export type SqsFactorTone = (typeof SQS_FACTOR_TONE)[keyof typeof SQS_FACTOR_TONE];

export interface SqsFactorBarView {
  readonly key: SpreadQualityFactorKey;
  readonly label: string;
  readonly weightLabel: string;
  readonly score: number;
  readonly scaleX: number;
  readonly metricText: string | null;
  readonly sourceTag: string | null;
  readonly tone: SqsFactorTone;
  readonly isWeakest: boolean;
}

const GAUGE_RADIUS = 96;
const GAUGE_CENTER_X = 130;
const GAUGE_CENTER_Y = 130;

function clampScoreValue(raw: number | null | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(100, raw)));
}

function resolveFactorTone(score: number): SqsFactorTone {
  if (score >= 80) return SQS_FACTOR_TONE.OPTIMAL;
  if (score >= 60) return SQS_FACTOR_TONE.HEALTHY;
  if (score >= 40) return SQS_FACTOR_TONE.CAUTION;
  return SQS_FACTOR_TONE.TOXIC;
}

function formatVolatilitySourceTag(source: string | null): string | null {
  const trimmed = source?.trim();
  if (!trimmed) return null;
  if (trimmed === 'MEASURED') return 'Medida';
  if (trimmed === 'DEFAULT_INSUFFICIENT_HISTORY') return 'Ref.';
  return trimmed;
}

@Component({
  selector: 'app-spread-quality-gauge',
  standalone: true,
  imports: [DecimalPipe, SpatialTilt3dDirective],
  templateUrl: './spread-quality-gauge.component.html',
  styleUrl: './spread-quality-gauge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpreadQualityGaugeComponent {
  private static nextInstanceId = 0;

  readonly uid = ++SpreadQualityGaugeComponent.nextInstanceId;
  readonly gaugeArcLength = Math.PI * GAUGE_RADIUS;

  // Backward-compatible primary inputs
  readonly gainVes = input<number>(0);
  readonly gainUsdt = input<number>(0);
  readonly netVesAfterCommission = input<number>(0);
  readonly unitSpreadVes = input<number>(0);
  readonly roiPct = input<number>(0);
  readonly qualityScore = input<number>(0);
  readonly isFavorable = input<boolean>(false);
  readonly verdictLabel = input<string>('Desfavorable');
  readonly hasResult = input<boolean>(false);
  readonly compoundCycles = input<readonly CompoundCycleItem[]>([]);

  // Vista B SQS Breakdown, Causal Explainability & Hover What-If inputs
  readonly factors = input<SpreadQualityResult['factors'] | null>(null);
  readonly weakestFactor = input<SpreadQualityFactorKey | null>(null);
  readonly causalHint = input<string | null>(null);
  readonly correctiveActionLabel = input<string | null>(null);
  readonly volatility4hPct = input<number | null>(null);
  readonly volatilitySource = input<string | null>(null);
  readonly accountUsagePct = input<number | null>(null);
  readonly bankLabel = input<string | null>(null);
  readonly scoreSourceLabel = input<string | null>(null);
  readonly previewScore = input<number | null>(null);
  readonly previewRoiDeltaPct = input<number | null>(null);
  readonly topBanks = input<readonly TopBankGaugeItem[]>([]);

  // Outputs
  readonly startBuyTrade = output<void>();
  readonly startSellTrade = output<void>();
  readonly openAdStudio = output<void>();
  readonly applyCorrectiveAction = output<SpreadQualityFactorKey>();

  // Computed gauge geometry & score state
  readonly clampedScore = computed<number>(() => clampScoreValue(this.qualityScore()));

  readonly gaugeDashOffset = computed<number>(() => {
    return this.gaugeArcLength * (1 - this.clampedScore() / 100);
  });

  readonly needleDeg = computed<number>(() => {
    return (this.clampedScore() / 100) * 180 - 90;
  });

  readonly gaugeTip = computed<{ x: number; y: number }>(() => {
    const alpha = (1 - this.clampedScore() / 100) * Math.PI;
    return {
      x: Number((GAUGE_CENTER_X + GAUGE_RADIUS * Math.cos(alpha)).toFixed(2)),
      y: Number((GAUGE_CENTER_Y - GAUGE_RADIUS * Math.sin(alpha)).toFixed(2)),
    };
  });

  readonly gradientId = computed<string>(() => `spread-gauge-grad-${this.uid}`);
  readonly glowFilterId = computed<string>(() => `spread-gauge-glow-${this.uid}`);

  readonly clampedPreviewScore = computed<number | null>(() => {
    const raw = this.previewScore();
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return null;
    }
    return clampScoreValue(raw);
  });

  readonly effectiveWeakestFactor = computed<SpreadQualityFactorKey | null>(() => {
    const explicit = this.weakestFactor();
    if (explicit) return explicit;

    const factorScores = this.factors();
    if (!factorScores) return null;

    const entries: { key: SpreadQualityFactorKey; val: number }[] = [
      { key: 'netMargin', val: clampScoreValue(factorScores.netMarginScore) },
      { key: 'safety', val: clampScoreValue(factorScores.safetyScore) },
      { key: 'velocity', val: clampScoreValue(factorScores.velocityScore) },
      { key: 'limitHealth', val: clampScoreValue(factorScores.limitHealthScore) },
    ];
    return entries.reduce((min, cur) => (cur.val < min.val ? cur : min), entries[0]).key;
  });

  readonly factorBars = computed<readonly SqsFactorBarView[]>(() => {
    const f = this.factors();
    if (!f) return [];

    const weakest = this.effectiveWeakestFactor();
    const roi = this.roiPct();
    const roiMetric = Number.isFinite(roi)
      ? `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`
      : null;

    const vol = this.volatility4hPct();
    const volMetric =
      typeof vol === 'number' && Number.isFinite(vol) ? `${vol.toFixed(2)}%` : null;

    const usage = this.accountUsagePct();
    const usageMetric =
      typeof usage === 'number' && Number.isFinite(usage)
        ? `${Math.round(Math.max(0, Math.min(100, usage)))}% uso`
        : null;

    const bankMetric = this.bankLabel()?.trim() || null;

    const specs: {
      key: SpreadQualityFactorKey;
      label: string;
      weightLabel: string;
      rawScore: number;
      metricText: string | null;
      sourceTag: string | null;
    }[] = [
      {
        key: 'netMargin',
        label: 'Margen Neto',
        weightLabel: '35%',
        rawScore: f.netMarginScore,
        metricText: roiMetric,
        sourceTag: null,
      },
      {
        key: 'safety',
        label: 'Seguridad / Volatilidad',
        weightLabel: '25%',
        rawScore: f.safetyScore,
        metricText: volMetric,
        sourceTag: formatVolatilitySourceTag(this.volatilitySource()),
      },
      {
        key: 'velocity',
        label: 'Velocidad Bancaria',
        weightLabel: '25%',
        rawScore: f.velocityScore,
        metricText: bankMetric,
        sourceTag: null,
      },
      {
        key: 'limitHealth',
        label: 'Salud Límite SUDEBAN',
        weightLabel: '15%',
        rawScore: f.limitHealthScore,
        metricText: usageMetric,
        sourceTag: null,
      },
    ];

    return specs.map((spec) => {
      const score = clampScoreValue(spec.rawScore);
      return {
        key: spec.key,
        label: spec.label,
        weightLabel: spec.weightLabel,
        score,
        scaleX: score / 100,
        metricText: spec.metricText,
        sourceTag: spec.sourceTag,
        tone: resolveFactorTone(score),
        isWeakest: weakest === spec.key,
      };
    });
  });

  readonly visibleTopBanks = computed<readonly TopBankGaugeItem[]>(() => {
    return this.topBanks().slice(0, 3);
  });

  onStartBuy(): void {
    this.startBuyTrade.emit();
  }

  onStartSell(): void {
    this.startSellTrade.emit();
  }

  onOpenAdStudio(): void {
    this.openAdStudio.emit();
  }

  onApplyCorrectiveAction(): void {
    this.applyCorrectiveAction.emit(this.effectiveWeakestFactor() ?? 'netMargin');
  }
}
