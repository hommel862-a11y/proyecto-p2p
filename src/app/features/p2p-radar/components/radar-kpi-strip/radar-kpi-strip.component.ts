import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { ArbitrageRoute } from '@p2p/core';
import type { RadarHeroKpiSummary } from '../../p2p-radar-ui.models';

const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

@Component({
  selector: 'app-radar-kpi-strip',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './radar-kpi-strip.component.html',
  styleUrl: './radar-kpi-strip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadarKpiStripComponent {
  readonly summary = input.required<RadarHeroKpiSummary>();
  readonly bankLabels = input.required<Record<string, string>>();
  readonly loading = input.required<boolean>();

  readonly loadRoute = output<ArbitrageRoute>();
  readonly openHybridMode = output<void>();
  readonly openForensicView = output<void>();

  readonly ringRadius = RING_RADIUS;
  readonly ringCircumference = RING_CIRCUMFERENCE;

  readonly freeSharePct = computed(() => {
    const bank = this.summary().lowestWallBank;
    if (!bank) return 100;
    return Math.max(0, Math.min(100, Math.round(100 - bank.wallPct)));
  });

  readonly freeShareOffset = computed(() => {
    const pct = this.freeSharePct();
    return this.ringCircumference - (pct / 100) * this.ringCircumference;
  });

  bankName(key: string): string {
    return this.bankLabels()[key] || key;
  }
}
