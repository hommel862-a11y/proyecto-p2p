import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Triangulation } from './triangulation';
import { TriangulationIntelligenceService } from '../../core/triangulation-intelligence.service';
import { StorageService } from '../../core/storage';

describe('Triangulation Component', () => {
  let component: Triangulation;
  let fixture: ComponentFixture<Triangulation>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Triangulation],
      providers: [TriangulationIntelligenceService, StorageService],
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

  it('evaluates MCP tactical report and BCV risk', () => {
    const report = component.tacticalReport();
    expect(report).toBeTruthy();
    expect(typeof report.executionAllowed).toBe('boolean');
    expect(report.bcvRisk).toBeDefined();
    expect(report.hedgeAdvice).toBeDefined();
  });

  it('tracks flight plan progress and toggles steps', () => {
    expect(component.flightPlanProgressPct()).toBe(0);

    component.toggleStep(1);
    expect(component.step1Done()).toBe(true);
    expect(component.flightPlanProgressPct()).toBe(33);

    component.toggleStep(2);
    expect(component.step2Done()).toBe(true);
    expect(component.flightPlanProgressPct()).toBe(67);

    component.toggleStep(3);
    expect(component.step3Done()).toBe(true);
    expect(component.flightPlanProgressPct()).toBe(100);

    component.resetFlightPlan();
    expect(component.flightPlanProgressPct()).toBe(0);
    expect(component.step1Done()).toBe(false);
  });

  it('allows quick capital selection', () => {
    component.setQuickAmount(2500);
    expect(component.initialAmount()).toBe(2500);
  });

  it('settles a profitable cycle to the Ledger', () => {
    // Ensure profit
    component.leg1Price.set(80);
    component.leg2Price.set(4200);
    component.leg3Price.set(0.02);
    fixture.detectChanges();

    component.settleCycleToLedger();
    expect(component.lastSettledId()).toBeTruthy();
    expect(component.step1Done()).toBe(true);
    expect(component.step2Done()).toBe(true);
    expect(component.step3Done()).toBe(true);
  });

  it('identifies bottleneck in the cycle', () => {
    const bottleneck = component.bottleneckInfo();
    expect(bottleneck).toBeTruthy();
    expect([1, 2, 3]).toContain(bottleneck.legNumber);
  });
});
