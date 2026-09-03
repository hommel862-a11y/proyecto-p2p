import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TradeTimerService } from '../../core/trade-timer.service';

@Component({
  selector: 'app-operation-timer-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="trade-timer-card section-group"
      style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; border-left: 4px solid var(--gold);"
    >
      <div style="display: flex; align-items: center; gap: 16px;">
        <div
          class="trade-timer-pulse"
          [class.running]="timer.state() === 'running'"
          [class.paused]="timer.state() === 'paused'"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="width: 26px; height: 26px; color: var(--gold);"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div>
          <span class="section-eyebrow" style="margin: 0 0 4px; padding: 0; border: none;"
            >Cronómetro de Operación</span
          >
          <div
            style="font-family: var(--font-mono); font-size: 1.8rem; font-weight: 700; color: var(--text); line-height: 1;"
          >
            {{ timer.formattedTime() }}
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 10px; align-items: center;">
        @if (timer.state() === 'idle') {
          <button type="button" class="btn btn-primary" (click)="timer.start()">
            Iniciar Cronómetro
          </button>
        } @else if (timer.state() === 'running') {
          <button type="button" class="btn btn-secondary" (click)="timer.pause()">Pausar</button>
          <button type="button" class="btn btn-ghost" (click)="timer.reset()">Reiniciar</button>
        } @else if (timer.state() === 'paused') {
          <button type="button" class="btn btn-primary" (click)="timer.resume()">Reanudar</button>
          <button type="button" class="btn btn-ghost" (click)="timer.reset()">Reiniciar</button>
        }
      </div>
    </div>
  `,
})
export class OperationTimerBannerComponent {
  readonly timer = inject(TradeTimerService);
}
