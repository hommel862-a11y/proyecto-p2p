import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { capitalFromDailyIncome, toBs, DEFAULT_DAYS_PER_YEAR } from '@p2p/core';

/**
 * C2 — Income calculator. Thin view over {@link capitalFromDailyIncome}: target/APR/days
 * feed pure core math; renders the discipline-ladder table and a VES conversion.
 */
@Component({
  selector: 'app-income-calculator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './income-calculator.html',
})
export class IncomeCalculator {
  readonly targetUsd = signal<number>(20);
  /** APR as a percentage (e.g. 10 = 10%). */
  readonly aprPct = signal<number>(10);
  readonly daysPerYear = signal<number>(DEFAULT_DAYS_PER_YEAR);
  /** optional VES/USDT rate for the Bs conversion. */
  readonly rate = signal<number>(800);

  readonly bands = [8, 10, 15] as const;
  readonly targets = [1, 5, 20] as const;

  readonly result = computed(() => {
    try {
      return capitalFromDailyIncome(this.targetUsd(), this.aprPct() / 100, this.daysPerYear());
    } catch {
      return null;
    }
  });

  readonly annual = computed(() => this.result()?.annual ?? 0);
  readonly capital = computed(() => this.result()?.capital ?? 0);

  readonly capitalBs = computed(() => {
    const r = this.result();
    if (!r) return 0;
    try {
      return toBs(r.capital, this.rate());
    } catch {
      return 0;
    }
  });

  readonly table = computed(() =>
    this.targets.map((target) => ({
      target,
      cells: this.bands.map((band) => {
        try {
          return capitalFromDailyIncome(target, band / 100, this.daysPerYear()).capital;
        } catch {
          return 0;
        }
      }),
    })),
  );
}
