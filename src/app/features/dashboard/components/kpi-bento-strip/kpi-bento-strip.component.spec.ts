import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { KpiBentoStripComponent } from './kpi-bento-strip.component';

describe('KpiBentoStripComponent', () => {
  let fixture: ComponentFixture<KpiBentoStripComponent>;
  let component: KpiBentoStripComponent;

  const setupComponent = (inputs: Partial<{
    pnlVes: number;
    pnlUsdt: number;
    operations: number;
    zeroErrorStreak: number;
    exposureUsd: number;
    dailyTarget: number;
    dailyProgress: number;
    dailyDrawdownPct: number;
    remainingDailyTargetUsdt: number;
    editingDailyTarget: boolean;
    dailyTargetDraft: number;
    dailyTargetPresets: readonly number[];
    activePlanCycles: number | null;
    activePlanSellPrice: number | null;
    vesSparkline: readonly number[];
    usdtSparkline: readonly number[];
    opsSparkline: readonly number[];
  }> = {}) => {
    TestBed.configureTestingModule({
      imports: [KpiBentoStripComponent],
    });

    fixture = TestBed.createComponent(KpiBentoStripComponent);
    component = fixture.componentInstance;

    // Set required inputs
    fixture.componentRef.setInput('pnlVes', inputs.pnlVes ?? 1250.5);
    fixture.componentRef.setInput('pnlUsdt', inputs.pnlUsdt ?? 45.2);
    fixture.componentRef.setInput('operations', inputs.operations ?? 8);

    // Set optional inputs if provided
    if (inputs.zeroErrorStreak !== undefined) {
      fixture.componentRef.setInput('zeroErrorStreak', inputs.zeroErrorStreak);
    }
    if (inputs.exposureUsd !== undefined) {
      fixture.componentRef.setInput('exposureUsd', inputs.exposureUsd);
    }
    if (inputs.dailyTarget !== undefined) {
      fixture.componentRef.setInput('dailyTarget', inputs.dailyTarget);
    }
    if (inputs.dailyProgress !== undefined) {
      fixture.componentRef.setInput('dailyProgress', inputs.dailyProgress);
    }
    if (inputs.dailyDrawdownPct !== undefined) {
      fixture.componentRef.setInput('dailyDrawdownPct', inputs.dailyDrawdownPct);
    }
    if (inputs.remainingDailyTargetUsdt !== undefined) {
      fixture.componentRef.setInput('remainingDailyTargetUsdt', inputs.remainingDailyTargetUsdt);
    }
    if (inputs.editingDailyTarget !== undefined) {
      fixture.componentRef.setInput('editingDailyTarget', inputs.editingDailyTarget);
    }
    if (inputs.dailyTargetDraft !== undefined) {
      fixture.componentRef.setInput('dailyTargetDraft', inputs.dailyTargetDraft);
    }
    if (inputs.dailyTargetPresets !== undefined) {
      fixture.componentRef.setInput('dailyTargetPresets', inputs.dailyTargetPresets);
    }
    if (inputs.activePlanCycles !== undefined) {
      fixture.componentRef.setInput('activePlanCycles', inputs.activePlanCycles);
    }
    if (inputs.activePlanSellPrice !== undefined) {
      fixture.componentRef.setInput('activePlanSellPrice', inputs.activePlanSellPrice);
    }
    if (inputs.vesSparkline !== undefined) {
      fixture.componentRef.setInput('vesSparkline', inputs.vesSparkline);
    }
    if (inputs.usdtSparkline !== undefined) {
      fixture.componentRef.setInput('usdtSparkline', inputs.usdtSparkline);
    }
    if (inputs.opsSparkline !== undefined) {
      fixture.componentRef.setInput('opsSparkline', inputs.opsSparkline);
    }

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders 4 KPI Bento cards with spatial 3D tilt directives and layer depth classes', () => {
    const { fixture } = setupComponent();
    const cards = fixture.nativeElement.querySelectorAll('.apple-kpi-card');
    expect(cards.length).toBe(4);

    cards.forEach((card: HTMLElement) => {
      expect(card.classList.contains('spatial-tilt-3d')).toBe(true);
    });

    const floatElements = fixture.nativeElement.querySelectorAll('.spatial-z-float');
    expect(floatElements.length).toBeGreaterThanOrEqual(4);

    const midElements = fixture.nativeElement.querySelectorAll('.spatial-z-mid');
    expect(midElements.length).toBeGreaterThanOrEqual(4);
  });

  it('Card 1 (VES) displays Ganancia Neta (VES), animated counter, sparkline and emits navigateStats on click', () => {
    const { fixture, component } = setupComponent({ pnlVes: 3450.75 });
    const card1 = fixture.nativeElement.querySelectorAll('.apple-kpi-card')[0] as HTMLElement;

    expect(card1.textContent).toContain('Ganancia Neta (VES)');
    expect(card1.textContent).toContain('🇻🇪');
    expect(card1.classList.contains('kpi-glow-accent')).toBe(true);

    const sparklineSvg = card1.querySelector('svg.kpi-sparkline-svg');
    expect(sparklineSvg).toBeTruthy();
    const path = sparklineSvg?.querySelector('path.sparkline-line');
    expect(path?.getAttribute('d')).toBeTruthy();

    let navigated = false;
    component.navigateStats.subscribe(() => {
      navigated = true;
    });

    card1.click();
    expect(navigated).toBe(true);
  });

  it('Card 2 (USDT) displays Ganancia Neta (USDT), negative glow on loss and emits navigateStats on click', () => {
    const { fixture, component } = setupComponent({ pnlUsdt: -15.4 });
    const card2 = fixture.nativeElement.querySelectorAll('.apple-kpi-card')[1] as HTMLElement;

    expect(card2.textContent).toContain('Ganancia Neta (USDT)');
    expect(card2.textContent).toContain('₮');
    expect(card2.classList.contains('kpi-glow-danger')).toBe(true);

    let navigated = false;
    component.navigateStats.subscribe(() => {
      navigated = true;
    });

    card2.click();
    expect(navigated).toBe(true);
  });

  it('Card 3 (Operaciones) displays streak pill, orders count, formatted exposure and emits navigateLog', () => {
    const { fixture, component } = setupComponent({
      operations: 14,
      zeroErrorStreak: 5,
      exposureUsd: 1250,
    });
    const card3 = fixture.nativeElement.querySelectorAll('.apple-kpi-card')[2] as HTMLElement;

    expect(card3.textContent).toContain('Operaciones Hoy');
    expect(card3.textContent).toContain('Racha 5');
    expect(card3.textContent).toContain('14');
    expect(card3.textContent).toContain('órdenes');
    expect(card3.textContent).toContain('1.250');

    let navigated = false;
    component.navigateLog.subscribe(() => {
      navigated = true;
    });

    card3.click();
    expect(navigated).toBe(true);
  });

  it('Card 4 (Meta Diaria) renders radial progress ring with dashoffset and target badge', () => {
    const { fixture, component } = setupComponent({
      dailyTarget: 50,
      dailyProgress: 75,
      remainingDailyTargetUsdt: 12.5,
    });
    const card4 = fixture.nativeElement.querySelectorAll('.apple-kpi-card')[3] as HTMLElement;

    expect(card4.textContent).toContain('Meta Diaria de Ingresos');
    expect(card4.textContent).toContain('50 USDT');
    expect(card4.textContent).toContain('75%');
    expect(card4.textContent).toContain('Faltan 12,50 ₮');

    const radialCircle = card4.querySelector('circle.radial-ring-progress') as SVGCircleElement;
    expect(radialCircle).toBeTruthy();
    const dashoffset = parseFloat(radialCircle.getAttribute('stroke-dashoffset') || '0');
    // Circumference = 2 * PI * 24 ~= 150.8, at 75% progress offset is ~37.7
    expect(dashoffset).toBeLessThan(150);
    expect(dashoffset).toBeGreaterThan(0);

    let navigated = false;
    component.navigateIncome.subscribe(() => {
      navigated = true;
    });

    card4.click();
    expect(navigated).toBe(true);
  });

  it('Card 4 shows meta lograda when remainingDailyTargetUsdt <= 0', () => {
    const { fixture } = setupComponent({
      dailyProgress: 110,
      remainingDailyTargetUsdt: 0,
    });
    const card4 = fixture.nativeElement.querySelectorAll('.apple-kpi-card')[3] as HTMLElement;
    expect(card4.textContent).toContain('¡Meta Lograda!');
  });

  it('Card 4 shows pinned title and cycles when activePlanCycles is set', () => {
    const { fixture } = setupComponent({
      activePlanCycles: 3,
      activePlanSellPrice: 68.4,
    });
    const card4 = fixture.nativeElement.querySelectorAll('.apple-kpi-card')[3] as HTMLElement;
    expect(card4.textContent).toContain('Meta Diaria Fijada');
    expect(card4.textContent).toContain('3 vueltas @ 68,40 Bs');
  });

  it('Card 4 shows drawdown alert when dailyDrawdownPct > 0', () => {
    const { fixture } = setupComponent({
      pnlUsdt: -25,
      dailyDrawdownPct: 18,
    });
    const card4 = fixture.nativeElement.querySelectorAll('.apple-kpi-card')[3] as HTMLElement;
    expect(card4.textContent).toContain('18% DD');
    expect(card4.textContent).toContain('Drawdown activo');
  });

  it('Card 4 emits openTargetEditor on edit pencil click without navigating to income', () => {
    const { fixture, component } = setupComponent({ editingDailyTarget: false });
    const editBtn = fixture.nativeElement.querySelector('.btn-inline-edit-target') as HTMLButtonElement;

    let editorOpened = false;
    let incomeNavigated = false;

    component.openTargetEditor.subscribe(() => {
      editorOpened = true;
    });
    component.navigateIncome.subscribe(() => {
      incomeNavigated = true;
    });

    editBtn.click();
    expect(editorOpened).toBe(true);
    expect(incomeNavigated).toBe(false);
  });

  it('Card 4 in editing mode renders preset chips, allows custom draft input, save and cancel', () => {
    const { fixture, component } = setupComponent({
      editingDailyTarget: true,
      dailyTargetDraft: 45,
      dailyTargetPresets: [25, 50, 100, 200],
    });

    const editor = fixture.nativeElement.querySelector('.inline-target-editor');
    expect(editor).toBeTruthy();

    const presetChips = editor.querySelectorAll('.preset-chip') as NodeListOf<HTMLButtonElement>;
    expect(presetChips.length).toBe(4);

    let savedPreset: number | undefined;
    component.saveTarget.subscribe((payload: { preset?: number; event?: Event }) => {
      savedPreset = payload.preset;
    });

    presetChips[1].click(); // Click $50 preset
    expect(savedPreset).toBe(50);

    let draftChanged: number | undefined;
    component.targetDraftChange.subscribe((val: number) => {
      draftChanged = val;
    });

    const input = editor.querySelector('input.target-mini-input') as HTMLInputElement;
    input.value = '75';
    input.dispatchEvent(new Event('input'));
    expect(draftChanged).toBe(75);

    let cancelled = false;
    component.cancelTargetEditor.subscribe(() => {
      cancelled = true;
    });

    const cancelBtn = editor.querySelector('button.btn-cancel-target') as HTMLButtonElement;
    cancelBtn.click();
    expect(cancelled).toBe(true);
  });
});
