import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';
import {
  type CompoundCycleItem,
  SpreadQualityGaugeComponent,
} from './spread-quality-gauge.component';

describe('SpreadQualityGaugeComponent', () => {
  let component: SpreadQualityGaugeComponent;
  let fixture: ComponentFixture<SpreadQualityGaugeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpreadQualityGaugeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SpreadQualityGaugeComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('Spatial 3D & Layout Structure (S1, S3)', () => {
    it('should include spatial depth elements (.spatial-z-mid and .spatial-z-float)', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const midLayers = compiled.querySelectorAll('.spatial-z-mid');
      const floatLayers = compiled.querySelectorAll('.spatial-z-float');

      expect(midLayers.length).toBeGreaterThan(0);
      expect(floatLayers.length).toBeGreaterThan(0);
    });

    it('should render exactly ONE semicircular SVG gauge', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const svgGauges = compiled.querySelectorAll('svg.spread-quality-gauge-svg');

      expect(svgGauges.length).toBe(1);
    });

    it('should configure SVG linear gradient with required semantic stops', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const gradient = compiled.querySelector('linearGradient');

      expect(gradient).not.toBeNull();
      const stops = gradient?.querySelectorAll('stop');
      expect(stops?.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Bimonetary Metrics Readout (S1)', () => {
    it('should render Ganancia Neta Estimada, bimonetary figures, unit spread, and ROI badge', () => {
      fixture.componentRef.setInput('hasResult', true);
      fixture.componentRef.setInput('gainVes', 1250.75);
      fixture.componentRef.setInput('gainUsdt', 28.5);
      fixture.componentRef.setInput('netVesAfterCommission', 1210.25);
      fixture.componentRef.setInput('unitSpreadVes', 1.85);
      fixture.componentRef.setInput('roiPct', 3.45);
      fixture.componentRef.setInput('isFavorable', true);
      fixture.componentRef.setInput('verdictLabel', 'Favorable');
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Ganancia Neta Estimada');
      expect(text).toContain('Spread unitario');
      expect(text).toContain('1,250.75');
      expect(text).toContain('28.50');
      expect(text).toContain('1,210.25');
      expect(text).toContain('1.85');
      expect(text).toContain('3.45%');
    });

    it('should apply favorable/unfavorable styles based on isFavorable input', () => {
      fixture.componentRef.setInput('isFavorable', true);
      fixture.componentRef.setInput('verdictLabel', 'Favorable');
      fixture.detectChanges();

      const verdictBadge = fixture.nativeElement.querySelector('.verdict-pill');
      expect(verdictBadge).not.toBeNull();
      expect(verdictBadge.textContent).toContain('Favorable');
      expect(verdictBadge.classList.contains('tone-favorable')).toBe(true);

      fixture.componentRef.setInput('isFavorable', false);
      fixture.componentRef.setInput('verdictLabel', 'Desfavorable');
      fixture.detectChanges();

      expect(verdictBadge.textContent).toContain('Desfavorable');
      expect(verdictBadge.classList.contains('tone-unfavorable')).toBe(true);
    });
  });

  describe('Gauge Needle & Score Clamping (S1, S3)', () => {
    it('should clamp quality score between 0 and 100', () => {
      fixture.componentRef.setInput('qualityScore', 140);
      fixture.detectChanges();
      expect(component.clampedScore()).toBe(100);

      fixture.componentRef.setInput('qualityScore', -20);
      fixture.detectChanges();
      expect(component.clampedScore()).toBe(0);

      fixture.componentRef.setInput('qualityScore', 78.6);
      fixture.detectChanges();
      expect(component.clampedScore()).toBe(79);
    });

    it('should compute needle degrees correctly from score', () => {
      fixture.componentRef.setInput('qualityScore', 0);
      fixture.detectChanges();
      expect(component.needleDeg()).toBe(-90);

      fixture.componentRef.setInput('qualityScore', 50);
      fixture.detectChanges();
      expect(component.needleDeg()).toBe(0);

      fixture.componentRef.setInput('qualityScore', 100);
      fixture.detectChanges();
      expect(component.needleDeg()).toBe(90);
    });

    it('should render score readout with /100', () => {
      fixture.componentRef.setInput('qualityScore', 82);
      fixture.detectChanges();

      const scoreEl = fixture.nativeElement.querySelector('.gauge-score-row');
      expect(scoreEl?.textContent).toContain('82');
      expect(scoreEl?.textContent).toContain('/100');
    });
  });

  describe('Compound Cycles Projection Grid (S1)', () => {
    const mockCycles: readonly CompoundCycleItem[] = [
      { label: '1x', netVes: 1200, netUsdt: 25 },
      { label: '3x', netVes: 3700, netUsdt: 77 },
      { label: '5x', netVes: 6300, netUsdt: 131 },
      { label: '10x', netVes: 13500, netUsdt: 281 },
    ];

    it('should render 4 projection tiles when compoundCycles is provided', () => {
      fixture.componentRef.setInput('compoundCycles', mockCycles);
      fixture.detectChanges();

      const tiles = fixture.nativeElement.querySelectorAll('.compound-cycle-tile');
      expect(tiles.length).toBe(4);

      const firstTile = tiles[0];
      expect(firstTile.textContent).toContain('1x');
      expect(firstTile.textContent).toContain('1,200.00');
      expect(firstTile.textContent).toContain('25.00');
    });

    it('should handle empty compound cycles gracefully', () => {
      fixture.componentRef.setInput('compoundCycles', []);
      fixture.detectChanges();

      const tiles = fixture.nativeElement.querySelectorAll('.compound-cycle-tile');
      expect(tiles.length).toBe(0);
    });
  });

  describe('CTA Buttons & Outputs (S1, S3)', () => {
    it('should render all 3 CTA buttons with exact action labels', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const buttons = compiled.querySelectorAll('.cta-btn');

      expect(buttons.length).toBe(3);
      const text = compiled.textContent;
      expect(text).toContain('Iniciar Compra');
      expect(text).toContain('Iniciar Venta (Log)');
      expect(text).toContain('Anuncio 360°');
    });

    it('should emit startBuyTrade when clicking Iniciar Compra button', () => {
      const emitSpy = vi.fn();
      component.startBuyTrade.subscribe(emitSpy);
      fixture.detectChanges();

      const buyBtn = fixture.debugElement.query(By.css('.btn-buy'));
      expect(buyBtn).not.toBeNull();
      buyBtn.nativeElement.click();

      expect(emitSpy).toHaveBeenCalledTimes(1);
    });

    it('should emit startSellTrade when clicking Iniciar Venta button', () => {
      const emitSpy = vi.fn();
      component.startSellTrade.subscribe(emitSpy);
      fixture.detectChanges();

      const sellBtn = fixture.debugElement.query(By.css('.btn-sell'));
      expect(sellBtn).not.toBeNull();
      sellBtn.nativeElement.click();

      expect(emitSpy).toHaveBeenCalledTimes(1);
    });

    it('should emit openAdStudio when clicking Anuncio 360° button', () => {
      const emitSpy = vi.fn();
      component.openAdStudio.subscribe(emitSpy);
      fixture.detectChanges();

      const adBtn = fixture.debugElement.query(By.css('.btn-ad-studio'));
      expect(adBtn).not.toBeNull();
      adBtn.nativeElement.click();

      expect(emitSpy).toHaveBeenCalledTimes(1);
    });
  });
});
