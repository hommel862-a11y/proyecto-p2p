import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { SpoofReport, TradeImpactSimulationResult } from '@p2p/core';
import type {
  HonestVpinReport,
  MicrostructureVolatility2hResult,
} from '../../../../core/microstructure-engine.service';
import {
  VOLATILITY_SOURCE,
  type LiveSpreadQualityResult,
} from '../../../../core/spread-quality.service';
import { SpatialTilt3dDirective } from '../../../../shared/ui/spatial-tilt-3d.directive';

const KPI_GAUGE_RADIUS = 50;
const KPI_GAUGE_ARC_LENGTH = Math.PI * KPI_GAUGE_RADIUS;

const BCV_PHASE_LABELS: Readonly<Record<string, string>> = {
  INTERVENTION_ACTIVE: 'Subasta Activa',
  PRE_INTERVENTION_COMPRESSION: 'Pre-Subasta',
  POST_INTERVENTION_REBOUND: 'Rebote Post-BCV',
  QUIET_ACCUMULATION: 'Acumulación Calma',
};

const VOLATILITY_LEVEL_LABELS: Readonly<Record<string, string>> = {
  LOW: 'CALMA',
  NORMAL: 'ESTABLE',
  ELEVATED: 'ELEVADA',
  EXTREME: 'EXTREMA',
};

const DRIFT_DIRECTION_LABELS: Readonly<Record<string, string>> = {
  EXPANDING: 'EXPANSIVA',
  COMPRESSING: 'COMPRESIVA',
  STABLE: 'NEUTRAL',
};

@Component({
  selector: 'app-microstructure-kpi-strip',
  standalone: true,
  imports: [DecimalPipe, SpatialTilt3dDirective],
  templateUrl: './microstructure-kpi-strip.component.html',
  styleUrl: './microstructure-kpi-strip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MicrostructureKpiStripComponent {
  private static nextId = 0;
  readonly uid = ++MicrostructureKpiStripComponent.nextId;
  readonly gaugeArcLength = KPI_GAUGE_ARC_LENGTH;

  readonly sqsResult = input<LiveSpreadQualityResult | null>(null);
  readonly spoofReport = input<SpoofReport | null>(null);
  readonly vpinReport = input<HonestVpinReport | null>(null);
  readonly tradeImpact = input<TradeImpactSimulationResult | null>(null);
  readonly volatility2h = input<MicrostructureVolatility2hResult | null>(null);
  readonly targetUsdt = input<number>(500);
  readonly side = input<'BUY' | 'SELL'>('SELL');
  readonly bcvRateVes = input<number | null>(null);

  readonly sqsGradientId = computed(() => `micro-sqs-grad-${this.uid}`);

  readonly clampedSqsScore = computed<number>(() => {
    const raw = this.sqsResult()?.score ?? 0;
    if (!Number.isFinite(raw)) return 0;
    return Math.round(Math.max(0, Math.min(100, raw)));
  });

  readonly sqsDashOffset = computed<number>(() => {
    return this.gaugeArcLength * (1 - this.clampedSqsScore() / 100);
  });

  readonly isMeasuredVolatility = computed<boolean>(() => {
    return this.sqsResult()?.volatilitySource === VOLATILITY_SOURCE.MEASURED;
  });

  readonly integrityScore = computed<number>(() => {
    const risk = this.spoofReport()?.manipulationRiskScore ?? 0;
    return Math.max(0, Math.min(100, Math.round(100 - risk)));
  });

  readonly integrityStatus = computed<{ readonly label: string; readonly tone: string }>(() => {
    const score = this.integrityScore();
    if (score >= 80) return { label: 'ORGÁNICO', tone: 'optimal' };
    if (score >= 60) return { label: 'VIGILANCIA', tone: 'healthy' };
    if (score >= 35) return { label: 'ALERTA', tone: 'caution' };
    return { label: 'CRÍTICO', tone: 'toxic' };
  });

  readonly purgedTotalCount = computed<number>(() => {
    const report = this.spoofReport();
    if (!report) return 0;
    return report.spoofBaitCount + report.phantomLiquidityCount;
  });

  readonly vpinBars = computed<readonly number[]>(() => {
    const score = this.vpinReport()?.vpinScore ?? 0.12;
    const base = [0.35, 0.55, 0.42, 0.72, 0.48, 0.85, 0.62, 0.92, 0.58, 0.78];
    const scale = Math.max(0.25, Math.min(1, 0.35 + score));
    return base.map((v) => Math.round(v * scale * 100));
  });

  readonly fillablePct = computed<number>(() => {
    const impact = this.tradeImpact();
    if (!impact || impact.targetAmountUsdt <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((impact.totalFilledUsdt / impact.targetAmountUsdt) * 100)));
  });

  readonly etaSeconds = computed<number>(() => {
    const mins = this.tradeImpact()?.estimatedExecutionTimeMinutes ?? 0;
    if (!Number.isFinite(mins) || mins <= 0) return 0;
    return Math.round(mins * 60);
  });

  readonly bcvGapLabel = computed<{ readonly hasGap: boolean; readonly pctText: string; readonly vesText: string }>(() => {
    const vol = this.volatility2h();
    const gap = vol?.bcvGap;
    if (!gap || !gap.actionable || gap.gapPct === null || gap.gapVes === null || this.bcvRateVes() === null) {
      return { hasGap: false, pctText: 'N/D', vesText: 'Sin tasa BCV medida' };
    }
    return {
      hasGap: true,
      pctText: `${gap.gapPct.toFixed(2)}%`,
      vesText: `${gap.gapVes.toFixed(2)} Bs`,
    };
  });

  readonly volatilityLevelLabel = computed<string>(() => {
    const level = this.volatility2h()?.level ?? 'NORMAL';
    return VOLATILITY_LEVEL_LABELS[level] ?? level;
  });

  readonly driftDirectionLabel = computed<string>(() => {
    const dir = this.volatility2h()?.direction ?? 'STABLE';
    return DRIFT_DIRECTION_LABELS[dir] ?? dir;
  });

  readonly bcvSchedulePhaseLabel = computed<string>(() => {
    const phase = this.volatility2h()?.bcvWindow?.phase ?? 'QUIET_ACCUMULATION';
    return BCV_PHASE_LABELS[phase] ?? phase;
  });
}
