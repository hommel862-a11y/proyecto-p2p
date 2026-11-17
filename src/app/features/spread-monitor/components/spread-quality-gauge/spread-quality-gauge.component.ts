import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { SpatialTilt3dDirective } from '../../../../shared/ui/spatial-tilt-3d.directive';

export interface CompoundCycleItem {
  readonly label: string;
  readonly netVes: number;
  readonly netUsdt: number;
}

const GAUGE_RADIUS = 96;
const GAUGE_CENTER_X = 130;
const GAUGE_CENTER_Y = 130;

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

  // Inputs
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

  // Outputs
  readonly startBuyTrade = output<void>();
  readonly startSellTrade = output<void>();
  readonly openAdStudio = output<void>();

  // Computed state
  readonly clampedScore = computed<number>(() => {
    const raw = this.qualityScore();
    if (!Number.isFinite(raw)) {
      return 0;
    }
    return Math.round(Math.max(0, Math.min(100, raw)));
  });

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

  onStartBuy(): void {
    this.startBuyTrade.emit();
  }

  onStartSell(): void {
    this.startSellTrade.emit();
  }

  onOpenAdStudio(): void {
    this.openAdStudio.emit();
  }
}
