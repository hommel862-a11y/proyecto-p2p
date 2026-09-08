import { ChangeDetectionStrategy, Component, input } from '@angular/core';

const KPI_TONE = {
  NEUTRAL: 'neutral',
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
} as const;

type UiKpiTone = (typeof KPI_TONE)[keyof typeof KPI_TONE];

/**
 * KPI block reusing the app's `.stat-tile.out` chrome. Renders a label and projects
 * the value via `<ng-content/>`, applying a positive/negative tone when requested.
 */
@Component({
  selector: 'app-ui-kpi',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stat-tile out">
      <span class="stat-label">{{ label() }}</span>
      <span
        class="stat-value"
        [class.positive]="tone() === 'positive'"
        [class.negative]="tone() === 'negative'"
      >
        <ng-content />
      </span>
    </div>
  `,
})
export class UiKpi {
  readonly label = input.required<string>();
  readonly tone = input<UiKpiTone>(KPI_TONE.NEUTRAL);
}
