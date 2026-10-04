import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';

@Component({
  selector: 'app-animated-counter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="animated-counter font-mono"
      [class.trend-up]="trend() === 'up'"
      [class.trend-down]="trend() === 'down'"
      [attr.aria-label]="formattedValue()"
    >
      {{ formattedValue() }}
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }
      .animated-counter {
        display: inline-block;
        transition:
          color 0.4s cubic-bezier(0.16, 1, 0.3, 1),
          text-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        font-variant-numeric: tabular-nums;
      }
      .trend-up {
        color: var(--accent, #00d084) !important;
        text-shadow: 0 0 8px rgba(0, 208, 132, 0.35);
      }
      .trend-down {
        color: var(--danger, #ff453a) !important;
        text-shadow: 0 0 8px rgba(255, 69, 58, 0.35);
      }
      @media (prefers-reduced-motion: reduce) {
        .animated-counter {
          transition: none !important;
        }
      }
    `,
  ],
})
export class AnimatedCounterComponent implements OnChanges {
  @Input({ required: true }) value: number = 0;
  @Input() prefix: string = '';
  @Input() suffix: string = '';
  @Input() decimals: number = 2;
  @Input() durationMs: number = 600;

  private readonly hostEl = inject(ElementRef);
  private currentDisplayVal: number = 0;
  private animFrameId: number | null = null;
  private trendTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly formattedValue = signal<string>('0.00');
  readonly trend = signal<'up' | 'down' | 'neutral'>('neutral');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value']) {
      const prev = changes['value'].previousValue;
      const current = changes['value'].currentValue ?? 0;

      if (prev !== undefined && prev !== current) {
        this.triggerTrend(current > prev ? 'up' : 'down');
        this.animateValue(this.currentDisplayVal, current);
      } else {
        this.currentDisplayVal = current;
        this.updateFormatted(current);
      }
    }
  }

  private triggerTrend(direction: 'up' | 'down'): void {
    if (this.trendTimeout) {
      clearTimeout(this.trendTimeout);
    }
    this.trend.set(direction);
    this.trendTimeout = setTimeout(() => {
      this.trend.set('neutral');
    }, 1000);
  }

  private animateValue(start: number, end: number): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }

    // Si el usuario prefiere movimiento reducido, saltamos directo al final
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      this.currentDisplayVal = end;
      this.updateFormatted(end);
      return;
    }

    const startTime = performance.now();
    const duration = this.durationMs;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Easing cúbico hacia afuera
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * easeOut;

      this.currentDisplayVal = current;
      this.updateFormatted(current);

      if (progress < 1) {
        this.animFrameId = requestAnimationFrame(step);
      } else {
        this.currentDisplayVal = end;
        this.updateFormatted(end);
        this.animFrameId = null;
      }
    };

    this.animFrameId = requestAnimationFrame(step);
  }

  private updateFormatted(num: number): void {
    const formatted = new Intl.NumberFormat('es-VE', {
      minimumFractionDigits: this.decimals,
      maximumFractionDigits: this.decimals,
    }).format(num);

    this.formattedValue.set(`${this.prefix}${formatted}${this.suffix ? ' ' + this.suffix : ''}`);
  }
}
