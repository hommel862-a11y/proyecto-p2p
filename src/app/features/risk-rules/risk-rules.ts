import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RisksService, type RiskConfig } from '../../core/rules';

/**
 * C4 — Risk-rules config view. Edits the 6 safety-barrier rules; the live engine verdict
 * (ALLOW/DENY/PAUSE) is computed by {@link RisksService#evaluate} over the current config.
 */
@Component({
  selector: 'app-risk-rules',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './risk-rules.html',
})
export class RiskRules {
  private readonly risks = inject(RisksService);

  readonly config = this.risks.config;
  readonly draft = signal<RiskConfig>({ ...this.risks.config() });

  readonly verdict = computed(() => this.risks.evaluate(this.risks.sampleState()));

  save(): void {
    this.risks.save({ ...this.draft() });
  }

  reset(): void {
    this.risks.reset();
    this.draft.set({ ...this.risks.config() });
  }

  patch(p: Partial<RiskConfig>): void {
    this.draft.set({ ...this.draft(), ...p });
  }
}
