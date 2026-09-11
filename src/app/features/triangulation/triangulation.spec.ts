import { describe, it, expect } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Triangulation } from './triangulation';

describe('Triangulation Component', () => {
  let component: Triangulation;
  let fixture: ComponentFixture<Triangulation>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Triangulation],
    }).compileComponents();

    fixture = TestBed.createComponent(Triangulation);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component and initializes with default preset', () => {
    expect(component).toBeTruthy();
    expect(component.presets.length).toBeGreaterThanOrEqual(2);
    expect(component.selectedPresetId()).toBe(component.presets[0].id);
  });

  it('computes triangular arbitrage results reactively', () => {
    const result = component.calculationResult();
    expect(result).toBeTruthy();
    expect(result.steps.length).toBe(3);
    expect(typeof result.netProfit).toBe('number');
    expect(typeof result.roiPct).toBe('number');
  });

  it('updates calculation parameters when changing preset', () => {
    const secondPreset = component.presets[1];
    component.onSelectPreset(secondPreset.id);
    fixture.detectChanges();

    expect(component.selectedPresetId()).toBe(secondPreset.id);
    expect(component.activePreset().id).toBe(secondPreset.id);
    expect(component.calculationResult().initialCurrency).toBe(secondPreset.initialCurrency);
  });
});
