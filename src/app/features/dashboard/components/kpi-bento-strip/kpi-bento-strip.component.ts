import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SpatialTilt3dDirective } from '../../../../shared/ui/spatial-tilt-3d.directive';
import { AnimatedCounterComponent } from '../../../../shared/ui/animated-counter';

interface SparklineData {
  line: string;
  area: string;
}

@Component({
  selector: 'app-kpi-bento-strip',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SpatialTilt3dDirective,
    AnimatedCounterComponent,
  ],
  templateUrl: './kpi-bento-strip.component.html',
  styleUrl: './kpi-bento-strip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiBentoStripComponent {
  // Required Inputs
  readonly pnlVes = input.required<number>();
  readonly pnlUsdt = input.required<number>();
  readonly operations = input.required<number>();

  // Optional Inputs with defaults
  readonly zeroErrorStreak = input<number>(0);
  readonly exposureUsd = input<number>(0);
  readonly dailyTarget = input<number>(35);
  readonly dailyProgress = input<number>(0);
  readonly dailyDrawdownPct = input<number>(0);
  readonly remainingDailyTargetUsdt = input<number>(0);
  readonly editingDailyTarget = input<boolean>(false);
  readonly dailyTargetDraft = input<number>(35);
  readonly dailyTargetPresets = input<readonly number[]>([25, 50, 100, 200]);
  readonly activePlanCycles = input<number | null>(null);
  readonly activePlanSellPrice = input<number | null>(null);
  readonly vesSparkline = input<readonly number[]>([20, 35, 30, 50, 48, 70, 85]);
  readonly usdtSparkline = input<readonly number[]>([15, 25, 40, 38, 60, 75, 92]);
  readonly opsSparkline = input<readonly number[]>([2, 4, 3, 6, 5, 8, 9]);

  // Outputs
  readonly navigateStats = output<void>();
  readonly navigateLog = output<void>();
  readonly navigateIncome = output<void>();
  readonly openTargetEditor = output<Event | undefined>();
  readonly saveTarget = output<{ preset?: number; event?: Event }>();
  readonly cancelTargetEditor = output<Event | undefined>();
  readonly targetDraftChange = output<number>();

  // Radial Ring Constants (Radius 24px -> Circumference ~150.8px)
  readonly RING_RADIUS = 24;
  readonly RING_CIRCUMFERENCE = 150.8;

  // Computed Sparkline Paths
  readonly vesSparklinePaths = computed<SparklineData>(() =>
    this.buildSparkline(this.vesSparkline(), 120, 32),
  );

  readonly usdtSparklinePaths = computed<SparklineData>(() =>
    this.buildSparkline(this.usdtSparkline(), 120, 32),
  );

  readonly opsSparklinePaths = computed<SparklineData>(() =>
    this.buildSparkline(this.opsSparkline(), 120, 32),
  );

  // Computed Radial Ring Offsets
  readonly radialProgressOffset = computed<number>(() => {
    const progress = Math.max(0, Math.min(100, this.dailyProgress()));
    return +(this.RING_CIRCUMFERENCE * (1 - progress / 100)).toFixed(2);
  });

  readonly radialDrawdownOffset = computed<number>(() => {
    const dd = Math.max(0, Math.min(100, this.dailyDrawdownPct()));
    return +(this.RING_CIRCUMFERENCE * (1 - dd / 100)).toFixed(2);
  });

  // Formatted exposure text ($1.250 or $0)
  readonly formattedExposure = computed<string>(() => {
    const num = this.exposureUsd();
    const formatted = new Intl.NumberFormat('es-VE', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
    return `$${formatted}`;
  });

  formatPrice(price: number | null): string {
    if (price === null || price === undefined) return '0,00';
    return new Intl.NumberFormat('es-VE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  }

  formatRemaining(amount: number): string {
    return new Intl.NumberFormat('es-VE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  onCardClick(cardIndex: number): void {
    switch (cardIndex) {
      case 1:
      case 2:
        this.navigateStats.emit();
        break;
      case 3:
        this.navigateLog.emit();
        break;
      case 4:
        if (!this.editingDailyTarget()) {
          this.navigateIncome.emit();
        }
        break;
    }
  }

  onOpenTargetEditor(event: Event): void {
    event.stopPropagation();
    this.openTargetEditor.emit(event);
  }

  onPresetClick(preset: number, event: Event): void {
    event.stopPropagation();
    this.saveTarget.emit({ preset, event });
  }

  onSaveCustom(event: Event): void {
    event.stopPropagation();
    this.saveTarget.emit({ event });
  }

  onCancelEditor(event: Event): void {
    event.stopPropagation();
    this.cancelTargetEditor.emit(event);
  }

  onDraftChange(value: number): void {
    this.targetDraftChange.emit(value);
  }

  private buildSparkline(data: readonly number[], width = 120, height = 32): SparklineData {
    if (!data || data.length === 0) {
      return { line: '', area: '' };
    }
    if (data.length === 1) {
      const y = height / 2;
      return {
        line: `M 0,${y} L ${width},${y}`,
        area: `M 0,${y} L ${width},${y} L ${width},${height} L 0,${height} Z`,
      };
    }
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padY = 4;
    const usableH = height - padY * 2;
    const stepX = width / (data.length - 1);

    const pts = data.map((val, idx) => {
      const x = +(idx * stepX).toFixed(1);
      const y = +(height - padY - ((val - min) / range) * usableH).toFixed(1);
      return { x, y };
    });

    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
    const area = `${line} L ${width},${height} L 0,${height} Z`;

    return { line, area };
  }
}
