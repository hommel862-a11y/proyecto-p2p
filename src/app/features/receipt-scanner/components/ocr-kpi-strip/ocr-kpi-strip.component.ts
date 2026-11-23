import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { OcrKpiSummary } from '../../ocr-ui.models';

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const VES_FORMATTER = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

@Component({
  selector: 'app-ocr-kpi-strip',
  standalone: true,
  imports: [],
  templateUrl: './ocr-kpi-strip.component.html',
  styleUrl: './ocr-kpi-strip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OcrKpiStripComponent {
  readonly summary = input.required<OcrKpiSummary>();

  protected readonly formattedVerifiedUsd = computed<string>(() =>
    USD_FORMATTER.format(this.safeAmount(this.summary().verifiedUsd)),
  );

  protected readonly formattedVerifiedVes = computed<string>(() =>
    VES_FORMATTER.format(this.safeAmount(this.summary().verifiedVes)),
  );

  protected readonly formattedPendingUsd = computed<string>(() =>
    USD_FORMATTER.format(this.safeAmount(this.summary().pendingUsd)),
  );

  protected readonly hasLiveBcvRate = computed<boolean>(() => {
    const rate = this.summary().bcvRate;
    return Number.isFinite(rate) && rate > 0;
  });

  protected readonly clampedSafeRatePct = computed<number>(() => {
    const raw = this.summary().safeRatePct;
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(100, Math.round(raw)));
  });

  private safeAmount(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }
}
