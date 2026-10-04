import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AnimatedCounterComponent } from './animated-counter';

describe('AnimatedCounterComponent', () => {
  let component: AnimatedCounterComponent;
  let fixture: ComponentFixture<AnimatedCounterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnimatedCounterComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AnimatedCounterComponent);
    component = fixture.componentInstance;
  });

  it('renders initial value formatted according to es-VE locale', () => {
    component.value = 12500.5;
    component.suffix = 'VES';
    component.ngOnChanges({
      value: new SimpleChange(undefined, 12500.5, true),
    });
    fixture.detectChanges();

    expect(component.formattedValue()).toContain('12.500,50');
    expect(component.formattedValue()).toContain('VES');
  });

  it('triggers upward trend highlight when value increases', () => {
    component.value = 1000;
    component.ngOnChanges({
      value: new SimpleChange(undefined, 1000, true),
    });

    component.value = 1500;
    component.ngOnChanges({
      value: new SimpleChange(1000, 1500, false),
    });

    expect(component.trend()).toBe('up');
  });

  it('triggers downward trend highlight when value decreases', () => {
    component.value = 2000;
    component.ngOnChanges({
      value: new SimpleChange(undefined, 2000, true),
    });

    component.value = 1200;
    component.ngOnChanges({
      value: new SimpleChange(2000, 1200, false),
    });

    expect(component.trend()).toBe('down');
  });
});
