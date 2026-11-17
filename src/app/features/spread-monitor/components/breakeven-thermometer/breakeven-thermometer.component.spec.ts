import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BreakevenThermometerComponent,
  type BreakevenRoiStep,
  type BreakevenSplitItem,
} from './breakeven-thermometer.component';

const SAMPLE_LADDER: readonly BreakevenRoiStep[] = [
  { roiPct: 0, priceVes: 80.5, profitVes: 0, profitUsdt: 0 },
  { roiPct: 0.5, priceVes: 80.9, profitVes: 400, profitUsdt: 5 },
  { roiPct: 1.0, priceVes: 81.31, profitVes: 810, profitUsdt: 10 },
  { roiPct: 1.5, priceVes: 81.72, profitVes: 1220, profitUsdt: 15 },
  { roiPct: 2.2, priceVes: 82.29, profitVes: 1790, profitUsdt: 22 },
];

const SAMPLE_SPLITS: readonly BreakevenSplitItem[] = [
  {
    bankName: 'Banesco',
    rail: 'Pago Móvil',
    allocationUsdt: 4000,
    capacityPct: 40,
    safeTickets: 8,
  },
  {
    bankName: 'Mercantil',
    rail: 'Transferencia',
    allocationUsdt: 3500,
    capacityPct: 35,
    safeTickets: 7,
  },
  {
    bankName: 'BDV',
    rail: 'Biopago / P2P',
    allocationUsdt: 2500,
    capacityPct: 25,
    safeTickets: 5,
  },
];

describe('BreakevenThermometerComponent', () => {
  let fixture: ComponentFixture<BreakevenThermometerComponent>;
  let component: BreakevenThermometerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BreakevenThermometerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BreakevenThermometerComponent);
    component = fixture.componentInstance;
  });

  it('renders dual Spatial 3D hero boxes with Piso Breakeven and Precio Objetivo +ROI%', () => {
    fixture.componentRef.setInput('floorPriceVes', 80.5);
    fixture.componentRef.setInput('targetPriceVes', 81.31);
    fixture.componentRef.setInput('targetRoiPct', 1.0);
    fixture.componentRef.setInput('netProfitVes', 810);
    fixture.componentRef.setInput('netProfitUsdt', 10);
    fixture.componentRef.setInput('cycleMode', 'SELL_INVENTORY');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const tiltBoxes = host.querySelectorAll('.spatial-tilt-3d');
    expect(tiltBoxes.length).toBe(2);
    expect(host.querySelectorAll('.spatial-z-mid').length).toBeGreaterThanOrEqual(2);
    expect(host.querySelectorAll('.spatial-z-float').length).toBeGreaterThanOrEqual(2);

    const text = host.textContent ?? '';
    expect(text).toContain('Piso Breakeven');
    expect(text).toContain('Precio Objetivo');
    expect(text).toContain('+1%');
    expect(text).toContain('80,50');
    expect(text).toContain('81,31');
    expect(text).toContain('810,00 Bs');
    expect(text).toContain('10,00 USDT');
  });

  it('activates SpatialTilt3dDirective CSS variables on pointermove inside hero box', () => {
    fixture.componentRef.setInput('floorPriceVes', 80);
    fixture.componentRef.setInput('targetPriceVes', 82);
    fixture.detectChanges();

    const box = fixture.nativeElement.querySelector('.be-hero-box') as HTMLElement;
    expect(box).toBeTruthy();
    box.getBoundingClientRect = () =>
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

    box.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 160, clientY: 20, pointerType: 'mouse' }),
    );
    expect(box.style.getPropertyValue('--tilt-active')).toBe('1');
    expect(box.style.getPropertyValue('--mx')).toBe('80%');
    expect(box.style.getPropertyValue('--my')).toBe('20%');
  });

  it('adapts labels cleanly in REPLENISH_BUY cycleMode', () => {
    fixture.componentRef.setInput('cycleMode', 'REPLENISH_BUY');
    fixture.componentRef.setInput('floorPriceVes', 82.0);
    fixture.componentRef.setInput('targetPriceVes', 80.5);
    fixture.componentRef.setInput('bestAskVes', 80.4);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Techo Breakeven');
    expect(text).toContain('Recompra Objetivo');
  });

  it('avoids division by zero in Termómetro de Mercado en Vivo when min === max', () => {
    fixture.componentRef.setInput('floorPriceVes', 80);
    fixture.componentRef.setInput('targetPriceVes', 80);
    fixture.componentRef.setInput('bestBidVes', 80);
    fixture.componentRef.setInput('bestAskVes', 80);
    fixture.detectChanges();

    const markers = component.thermometerMarkers();
    expect(markers.length).toBe(4);
    for (const marker of markers) {
      expect(Number.isFinite(marker.positionPct)).toBe(true);
      expect(Number.isNaN(marker.positionPct)).toBe(false);
      expect(marker.positionPct).toBe(50);
    }

    const markerEls = (fixture.nativeElement as HTMLElement).querySelectorAll('.be-thermo-marker');
    expect(markerEls.length).toBe(4);
  });

  it('normalizes thermometer 0-100% positions for Piso, Bid L2, Ask L2, and Tu Meta and omits null L2 quotes', () => {
    fixture.componentRef.setInput('floorPriceVes', 75);
    fixture.componentRef.setInput('bestBidVes', 77.5);
    fixture.componentRef.setInput('bestAskVes', 80);
    fixture.componentRef.setInput('targetPriceVes', 85);
    fixture.detectChanges();

    const allMarkers = component.thermometerMarkers();
    expect(allMarkers.map((m) => m.label)).toEqual(['Piso', 'Bid L2', 'Ask L2', 'Tu Meta']);
    expect(allMarkers.find((m) => m.id === 'floor')?.positionPct).toBe(0);
    expect(allMarkers.find((m) => m.id === 'bid')?.positionPct).toBe(25);
    expect(allMarkers.find((m) => m.id === 'ask')?.positionPct).toBe(50);
    expect(allMarkers.find((m) => m.id === 'target')?.positionPct).toBe(100);

    const legendText =
      (fixture.nativeElement as HTMLElement).querySelector('.be-thermo-legend')?.textContent ?? '';
    expect(legendText).toContain('Piso');
    expect(legendText).toContain('Bid L2');
    expect(legendText).toContain('Ask L2');
    expect(legendText).toContain('Tu Meta');

    // Now set Bid L2 and Ask L2 to null -> only Piso and Tu Meta remain
    fixture.componentRef.setInput('bestBidVes', null);
    fixture.componentRef.setInput('bestAskVes', null);
    fixture.detectChanges();

    const reducedMarkers = component.thermometerMarkers();
    expect(reducedMarkers.map((m) => m.label)).toEqual(['Piso', 'Tu Meta']);
    expect(reducedMarkers.find((m) => m.id === 'floor')?.positionPct).toBe(0);
    expect(reducedMarkers.find((m) => m.id === 'target')?.positionPct).toBe(100);
  });

  it('renders 5-row clickable Escalera ROI table, highlights active targetRoiPct, and emits selectRoiTarget', () => {
    fixture.componentRef.setInput('roiLadder', SAMPLE_LADDER);
    fixture.componentRef.setInput('targetRoiPct', 1.0);
    fixture.detectChanges();

    const emitSpy = vi.spyOn(component.selectRoiTarget, 'emit');
    const host = fixture.nativeElement as HTMLElement;
    const rows = host.querySelectorAll<HTMLTableRowElement>('.be-ladder-row');
    expect(rows.length).toBe(5);

    expect(rows[2].classList.contains('is-active')).toBe(true);
    expect(rows[0].classList.contains('is-active')).toBe(false);

    rows[4].click();
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith(2.2);

    rows[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(emitSpy).toHaveBeenCalledWith(0.5);
  });

  it('keeps Split Multi-Banco ($10k) drawer collapsed by default and toggles via glass pill button', () => {
    fixture.componentRef.setInput('multiBankSplits', SAMPLE_SPLITS);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(component.splitExpanded()).toBe(false);
    expect(host.querySelector('.be-split-drawer')).toBeNull();

    const pillBtn = host.querySelector<HTMLButtonElement>('.be-split-pill');
    expect(pillBtn).toBeTruthy();
    expect(pillBtn?.textContent).toContain('Split Multi-Banco (3 bancos)');
    expect(pillBtn?.getAttribute('aria-expanded')).toBe('false');

    pillBtn?.click();
    fixture.detectChanges();

    expect(component.splitExpanded()).toBe(true);
    expect(pillBtn?.getAttribute('aria-expanded')).toBe('true');

    const drawer = host.querySelector('.be-split-drawer');
    expect(drawer).toBeTruthy();
    const drawerText = drawer?.textContent ?? '';
    expect(drawerText).toContain('Split Multi-Banco ($10k)');
    expect(drawerText).toContain('Banesco');
    expect(drawerText).toContain('Pago Móvil');
    expect(drawerText).toContain('Mercantil');
    expect(drawerText).toContain('BDV');
    expect(drawerText).toContain('40%');
    expect(drawerText).toContain('8 tickets');

    pillBtn?.click();
    fixture.detectChanges();
    expect(component.splitExpanded()).toBe(false);
    expect(host.querySelector('.be-split-drawer')).toBeNull();
  });

  it('emits launchTrade when clicking ⚡ Despachar Ciclo al Registro CTA', () => {
    fixture.detectChanges();
    const launchSpy = vi.spyOn(component.launchTrade, 'emit');

    const cta = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.be-dispatch-cta',
    );
    expect(cta).toBeTruthy();
    expect(cta?.textContent).toContain('⚡ Despachar Ciclo al Registro');

    cta?.click();
    expect(launchSpy).toHaveBeenCalledTimes(1);
  });
});
