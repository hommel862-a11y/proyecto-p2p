import { Directive, ElementRef, HostListener, inject, input } from '@angular/core';

/**
 * Adds GPU-accelerated CSS 3D spatial tilt and cursor-tracking specular sheen
 * via CSS custom properties (`--tilt-rx`, `--tilt-ry`, `--mx`, `--my`, `--tilt-active`).
 * Automatically degrades when disabled or when `prefers-reduced-motion: reduce` is active.
 */
@Directive({
  selector: '[appSpatialTilt3d]',
  standalone: true,
  host: {
    class: 'spatial-tilt-3d',
  },
})
export class SpatialTilt3dDirective {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly tiltMaxDeg = input<number>(5);
  readonly tiltDisabled = input<boolean>(false);

  @HostListener('pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (this.tiltDisabled() || this.prefersReducedMotion()) {
      return;
    }

    const el = this.host.nativeElement;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const normX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const normY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const maxDeg = Math.max(0, this.tiltMaxDeg());

    // Tilt away from the cursor gently around the card's center axis.
    const rotateY = ((normX - 0.5) * 2 * maxDeg).toFixed(2);
    const rotateX = ((0.5 - normY) * 2 * maxDeg).toFixed(2);

    el.style.setProperty('--tilt-active', '1');
    el.style.setProperty('--tilt-rx', `${rotateX}deg`);
    el.style.setProperty('--tilt-ry', `${rotateY}deg`);
    el.style.setProperty('--mx', `${Math.round(normX * 100)}%`);
    el.style.setProperty('--my', `${Math.round(normY * 100)}%`);
  }

  @HostListener('pointerleave')
  @HostListener('pointercancel')
  onPointerReset(): void {
    const el = this.host.nativeElement;
    el.style.setProperty('--tilt-active', '0');
    el.style.setProperty('--tilt-rx', '0deg');
    el.style.setProperty('--tilt-ry', '0deg');
  }

  private prefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
