import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RisksService, type RiskConfig } from '../../core/rules';
import { clampNonNegative, clampAtLeast } from '@p2p/core';

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

  /** trading pair context for the spread threshold label (USDT/VES or EUR/VES). */
  readonly pair = signal<'USDT' | 'EUR'>('USDT');
  setPair(value: string): void {
    this.pair.set(value === 'EUR' ? 'EUR' : 'USDT');
  }

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

  /** Template helpers: sanitize number-input entries before they reach the draft. */
  clampMoney(v: number): number {
    return clampNonNegative(v);
  }
  clampCount(v: number): number {
    return Math.round(clampAtLeast(v, 1));
  }

  private readonly REASON_LABELS: Record<string, string> = {
    'api-failure': 'fallo de API',
    'daily loss cap exceeded': 'tope de pérdida diaria superado',
    'consecutive errors limit reached': 'límite de errores consecutivos alcanzado',
    'max concurrent operations reached': 'máximo de operaciones concurrentes alcanzado',
    'spread below minimum': 'spread por debajo del mínimo',
    'risk per trade exceeded': 'riesgo por operación superado',
    'ok': 'dentro de límites',
  };

  decisionLabel(d: string): string {
    return d === 'ALLOW' ? 'PERMITIR' : d === 'DENY' ? 'DENEGAR' : 'PAUSAR';
  }

  reasonLabel(r: string): string {
    return this.REASON_LABELS[r] ?? r;
  }
}
