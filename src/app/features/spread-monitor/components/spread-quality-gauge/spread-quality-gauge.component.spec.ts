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

  describe('Vista B — 4-Factor SQS Breakdown, Causal Explainability & Hover What-If (S1, S3, S4)', () => {
    it('renders 4 SQS factor bars with exact weights, highlights weakestFactor, and preserves strictly 3 .cta-btn elements', () => {
      fixture.componentRef.setInput('qualityScore', 74);
      fixture.componentRef.setInput('roiPct', 1.15);
      fixture.componentRef.setInput('factors', {
        netMarginScore: 76,
        safetyScore: 52,
        velocityScore: 95,
        limitHealthScore: 84,
      });
      fixture.componentRef.setInput('weakestFactor', 'safety');
      fixture.componentRef.setInput('volatility4hPct', 0.88);
      fixture.componentRef.setInput('volatilitySource', 'MEASURED');
      fixture.componentRef.setInput('accountUsagePct', 32);
      fixture.componentRef.setInput('bankLabel', 'Banesco');
      fixture.componentRef.setInput('scoreSourceLabel', 'Mercado en vivo');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const factorRows = el.querySelectorAll('.sqs-factor-row');
      expect(factorRows.length).toBe(4);

      const text = el.textContent ?? '';
      expect(text).toContain('Margen Neto');
      expect(text).toContain('35%');
      expect(text).toContain('Seguridad / Volatilidad');
      expect(text).toContain('25%');
      expect(text).toContain('Velocidad Bancaria');
      expect(text).toContain('Salud Límite SUDEBAN');
      expect(text).toContain('15%');
      expect(text).toContain('0.88%');
      expect(text).toContain('32%');
      expect(text).toContain('Banesco');
      expect(text).toContain('Mercado en vivo');

      const weakestRows = el.querySelectorAll('.sqs-factor-row.is-weakest');
      expect(weakestRows.length).toBe(1);
      expect(weakestRows[0].textContent).toContain('Seguridad / Volatilidad');

      const fills = el.querySelectorAll('.sqs-factor-fill');
      expect(fills.length).toBe(4);
      expect((fills[1] as HTMLElement).style.transform).toContain('scaleX(0.52)');

      expect(el.querySelectorAll('.cta-btn').length).toBe(3);
    });

    it('renders causalHint and .sqs-corrective-btn (without .cta-btn) and emits applyCorrectiveAction with weakestFactor', () => {
      const actionSpy = vi.fn();
      component.applyCorrectiveAction.subscribe(actionSpy);

      fixture.componentRef.setInput('qualityScore', 58);
      fixture.componentRef.setInput('weakestFactor', 'netMargin');
      fixture.componentRef.setInput(
        'causalHint',
        'Margen neto comprimido por comisiones o fricción interbancaria; evaluar Maker mismo banco.',
      );
      fixture.componentRef.setInput('correctiveActionLabel', 'Cambiar a Maker');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('evaluar Maker mismo banco');

      const correctiveBtn = el.querySelector('.sqs-corrective-btn') as HTMLButtonElement | null;
      expect(correctiveBtn).not.toBeNull();
      expect(correctiveBtn?.classList.contains('cta-btn')).toBe(false);
      expect(correctiveBtn?.textContent).toContain('Cambiar a Maker');
      expect(el.querySelectorAll('.cta-btn').length).toBe(3);

      correctiveBtn?.click();
      expect(actionSpy).toHaveBeenCalledTimes(1);
      expect(actionSpy).toHaveBeenCalledWith('netMargin');
    });

    it('renders Hover What-If previewScore delta and Top-3 bank pills when provided', () => {
      fixture.componentRef.setInput('qualityScore', 79);
      fixture.componentRef.setInput('previewScore', 91);
      fixture.componentRef.setInput('previewRoiDeltaPct', 0.34);
      fixture.componentRef.setInput('topBanks', [
        { bankCode: 'BANESCO', label: 'Banesco', score: 92, roiPct: 1.68 },
        { bankCode: 'MERCANTIL', label: 'Mercantil', score: 88, roiPct: 1.45 },
        { bankCode: 'BDV', label: 'BDV', score: 81, roiPct: 1.12 },
      ]);
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const previewEl = el.querySelector('.what-if-preview-pill');
      expect(previewEl).not.toBeNull();
      expect(previewEl?.textContent).toContain('79');
      expect(previewEl?.textContent).toContain('91');
      expect(previewEl?.textContent).toContain('+0.34%');

      const bankPills = el.querySelectorAll('.top-bank-pill');
      expect(bankPills.length).toBe(3);
      expect(bankPills[0].textContent).toContain('Banesco');
      expect(bankPills[0].textContent).toContain('92');
      expect(bankPills[0].textContent).toContain('+1.68%');

      // Handles boundary previewScore = 0 and negative ROI delta without hiding pill
      fixture.componentRef.setInput('previewScore', 0);
      fixture.componentRef.setInput('previewRoiDeltaPct', -0.45);
      fixture.detectChanges();
      const updatedPreview = el.querySelector('.what-if-preview-pill');
      expect(updatedPreview).not.toBeNull();
      expect(updatedPreview?.textContent).toContain('79 → 0');
      expect(updatedPreview?.textContent).toContain('-0.45%');
    });
  });
});
