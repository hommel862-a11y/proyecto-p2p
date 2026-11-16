import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SpatialTilt3dDirective } from './spatial-tilt-3d.directive';

@Component({
  standalone: true,
  imports: [SpatialTilt3dDirective],
  template: `<div
    class="test-card"
    appSpatialTilt3d
    [tiltMaxDeg]="6"
    [tiltDisabled]="disabled()"
  >
    Card
  </div>`,
})
class HostComponent {
  readonly disabled = signal(false);
}

describe('SpatialTilt3dDirective', () => {
  it('updates CSS 3D tilt variables on pointermove and resets on pointerleave', () => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.test-card') as HTMLElement;
    card.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 100,
        right: 200,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    card.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 180, clientY: 10, pointerType: 'mouse' }),
    );

    expect(card.style.getPropertyValue('--tilt-active')).toBe('1');
    expect(card.style.getPropertyValue('--mx')).toBe('90%');
    expect(card.style.getPropertyValue('--my')).toBe('10%');
    expect(card.style.getPropertyValue('--tilt-ry')).not.toBe('0deg');

    card.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(card.style.getPropertyValue('--tilt-active')).toBe('0');
    expect(card.style.getPropertyValue('--tilt-rx')).toBe('0deg');
    expect(card.style.getPropertyValue('--tilt-ry')).toBe('0deg');
  });

  it('does not activate tilt when tiltDisabled is true', () => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.test-card') as HTMLElement;
    card.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 100,
        right: 200,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    card.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 180, clientY: 10, pointerType: 'mouse' }),
    );
    expect(card.style.getPropertyValue('--tilt-active')).not.toBe('1');
  });
});
