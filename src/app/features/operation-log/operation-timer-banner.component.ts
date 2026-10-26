import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TradeTimerService } from '../../core/trade-timer.service';

@Component({
  selector: 'app-operation-timer-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="apple-lot-card lot-open"
      style="padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;"
    >
      <div style="display: flex; align-items: center; gap: 12px;">
        <div
          class="trade-timer-pulse"
          [class.running]="timer.state() === 'running'"
          [class.paused]="timer.state() === 'paused'"
          style="width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="width: 20px; height: 20px; color: var(--gold);"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div>
          <span
            style="display: block; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 2px;"
            >Cronómetro SLA</span
          >
          <div
            style="font-family: var(--font-mono); font-size: 1.35rem; font-weight: 800; color: var(--text); line-height: 1;"
          >
            {{ timer.formattedTime() }}
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
        @if (timer.state() === 'idle') {
          <button
            type="button"
            class="apple-pill-btn apple-btn-gold"
            style="padding: 5px 12px; font-size: 0.74rem;"
            (click)="timer.start()"
          >
            ▶ Iniciar
          </button>
        } @else if (timer.state() === 'running') {
          <button
            type="button"
            class="apple-pill-btn apple-btn-secondary"
            style="padding: 5px 11px; font-size: 0.74rem;"
            (click)="timer.pause()"
          >
            ⏸ Pausar
          </button>
          <button
            type="button"
            class="apple-pill-btn apple-btn-danger"
            style="padding: 5px 11px; font-size: 0.74rem;"
            (click)="timer.reset()"
          >
            ↺ Reiniciar
          </button>
        } @else if (timer.state() === 'paused') {
          <button
            type="button"
            class="apple-pill-btn apple-btn-accent"
            style="padding: 5px 11px; font-size: 0.74rem;"
            (click)="timer.resume()"
          >
            ▶ Reanudar
          </button>
          <button
            type="button"
            class="apple-pill-btn apple-btn-danger"
            style="padding: 5px 11px; font-size: 0.74rem;"
            (click)="timer.reset()"
          >
            ↺ Reiniciar
          </button>
        }
      </div>
    </div>
  `,
})
export class OperationTimerBannerComponent {
  readonly timer = inject(TradeTimerService);
}
