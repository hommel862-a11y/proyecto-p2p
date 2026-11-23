import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { OcrKpiStripComponent } from './ocr-kpi-strip.component';
import type { OcrKpiSummary } from '../../ocr-ui.models';

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

const SAMPLE_SUMMARY: OcrKpiSummary = {
  totalAudited: 18,
  p2pCount: 11,
  finance360Count: 7,
  verifiedUsd: 1425.5,
  verifiedVes: 64147.5,
  bcvRate: 45,
  safeCount: 15,
  warningCount: 2,
  criticalCount: 1,
  safeRatePct: 83,
  pendingCount: 4,
  pendingUsd: 310.25,
  casheaPendingCount: 1,
};

describe('OcrKpiStripComponent', () => {
  let fixture: ComponentFixture<OcrKpiStripComponent>;

  const setup = (overrides: Partial<OcrKpiSummary> = {}) => {
    TestBed.configureTestingModule({
      imports: [OcrKpiStripComponent],
    });

    fixture = TestBed.createComponent(OcrKpiStripComponent);
    fixture.componentRef.setInput('summary', { ...SAMPLE_SUMMARY, ...overrides });
    fixture.detectChanges();
    return fixture;
  };

  it('renders 4 hero KPI bento cards with expected aura tones, tabular numbers, and zero emojis', () => {
    const f = setup();
    const host = f.nativeElement as HTMLElement;

    expect(host.textContent ?? '').not.toMatch(EMOJI_PATTERN);
    const cards = host.querySelectorAll('.ocr-kpi-aura');
    expect(cards.length).toBe(4);
    expect(cards[0].classList.contains('tone-cyan')).toBe(true);
    expect(cards[1].classList.contains('tone-gold')).toBe(true);
    expect(cards[2].classList.contains('tone-emerald')).toBe(true);
    expect(cards[3].classList.contains('tone-warn')).toBe(true);

    expect(host.querySelectorAll('.ocr-tabular').length).toBeGreaterThanOrEqual(4);
  });

  it('displays audited breakdown, verified USD + VES BCV volume, anti-fraud shield, and pending settlement totals', () => {
    const f = setup();
    const host = f.nativeElement as HTMLElement;

    const auditedCard = host.querySelector('[data-testid="ocr-kpi-audited"]') as HTMLElement;
    expect(auditedCard.textContent).toContain('Comprobantes Auditados');
    expect(auditedCard.textContent).toContain('18');
    expect(auditedCard.textContent).toContain('11 P2P');
    expect(auditedCard.textContent).toContain('7 Finanzas 360');

    const volumeCard = host.querySelector('[data-testid="ocr-kpi-volume"]') as HTMLElement;
    expect(volumeCard.textContent).toContain('Volumen Verificado');
    expect(volumeCard.textContent).toContain('1,425.50');
    expect(volumeCard.textContent).toContain('Bs.');
    expect(volumeCard.textContent).toContain('BCV');

    const shieldCard = host.querySelector('[data-testid="ocr-kpi-shield"]') as HTMLElement;
    expect(shieldCard.textContent).toContain('Escudo Anti-Fraude');
    expect(shieldCard.textContent).toContain('83% SAFE');
    expect(shieldCard.textContent).toContain('15 OK');
    expect(shieldCard.textContent).toContain('2 Advertencias');
    expect(shieldCard.textContent).toContain('1 Bloqueados');

    const pendingCard = host.querySelector('[data-testid="ocr-kpi-pending"]') as HTMLElement;
    expect(pendingCard.textContent).toContain('Pendientes de Asentar');
    expect(pendingCard.textContent).toContain('4');
    expect(pendingCard.textContent).toContain('$310.25 USD por conciliar');
    expect(pendingCard.textContent).toContain('1 Cashea');
  });

  it('renders honest "Tasa BCV offline" when bcvRate is 0 or negative', () => {
    const f = setup({ bcvRate: 0, verifiedVes: 0 });
    const host = f.nativeElement as HTMLElement;

    const volumeCard = host.querySelector('[data-testid="ocr-kpi-volume"]') as HTMLElement;
    expect(volumeCard.textContent).toContain('Tasa BCV offline');
    expect(volumeCard.textContent).not.toContain('Bs.');
  });
});
