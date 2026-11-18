import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CrmOverviewComponent } from './crm-overview.component';
import type {
  CrmCashflowColumn,
  CrmDealsStatusRow,
  CrmHealthRecommendation,
  CrmHeroKpiCard,
  CrmOverviewPeriod,
  CrmVelocityBarItem,
} from '../../crm-ui.models';

describe('CrmOverviewComponent', () => {
  let fixture: ComponentFixture<CrmOverviewComponent>;
  let component: CrmOverviewComponent;

  const sampleKpis: CrmHeroKpiCard[] = [
    { id: 'kpi-1', label: 'Ganancia Neta Hoy', value: '$142.50', deltaLabel: '+12.4%', tone: 'emerald', subtext: '4 cierres', targetNav: 'PIPELINE' },
    { id: 'kpi-2', label: 'Volumen Pipeline', value: '$4,820.00', deltaLabel: '8 tratos', tone: 'cyan', subtext: 'En tránsito', targetNav: 'PIPELINE' },
    { id: 'kpi-3', label: 'Saldo Bóveda', value: '$910.00', deltaLabel: 'Saludable', tone: 'amber', subtext: '3 rieles activos', targetNav: 'CONTACTS_RAILS' },
    { id: 'kpi-4', label: 'Autopilot ARM', value: '91%', deltaLabel: '2 HITL', tone: 'violet', subtext: 'Precisión hoy', targetNav: 'AUDIT_SYSTEM' },
  ];

  const sampleCashflow: CrmCashflowColumn[] = [
    { id: 'c1', label: 'Cotizado', valueFormatted: '$1,200', sublabel: '3 tratos' },
    { id: 'c2', label: 'Tránsito', valueFormatted: '$1,950', sublabel: '4 tratos', highlighted: true },
    { id: 'c3', label: 'Verificar', valueFormatted: '$640', sublabel: '2 tratos' },
    { id: 'c4', label: 'Liquidado', valueFormatted: '$1,030', sublabel: '5 tratos' },
    { id: 'c5', label: 'Corte', valueFormatted: '$142', sublabel: 'Neto' },
  ];

  const sampleVelocity: CrmVelocityBarItem[] = [
    { id: 'v1', label: 'Venta USDT Directa', formattedValue: '$2,900', ratioPct: 68, tone: 'emerald' },
    { id: 'v2', label: 'Arbitraje Multi-Banco', formattedValue: '$1,420', ratioPct: 44, tone: 'cyan' },
    { id: 'v3', label: 'Tasa Vencida / Riesgo', formattedValue: '$500', ratioPct: 18, tone: 'danger' },
  ];

  const sampleRecommendations: CrmHealthRecommendation[] = [
    { id: 'r1', label: 'Revisar 2 cotizaciones con TTL vencido', impactBadge: '+$38.00', tone: 'amber', actionId: 'FILTER_EXPIRED' },
    { id: 'r2', label: 'Balancear riel Banesco (82% cupo)', impactBadge: 'Escudo', tone: 'blue', actionId: 'OPEN_RAILS' },
  ];

  const sampleRows: CrmDealsStatusRow[] = [
    {
      id: 'DL-101',
      counterparty: 'Inversiones Norte CA',
      lastContactLabel: 'Hace 4m',
      ownerLabel: 'Agente P2P',
      ownerInitials: 'AP',
      statusLabel: 'En Tránsito',
      statusTone: 'transit',
      dealValueFormatted: '$1,250.00',
    },
    {
      id: 'DL-102',
      counterparty: 'Carlos Mendoza',
      lastContactLabel: 'Hace 18m',
      ownerLabel: 'Mesa Pro',
      ownerInitials: 'MP',
      statusLabel: 'Liquidado',
      statusTone: 'won',
      dealValueFormatted: '$640.00',
    },
  ];

  const setup = () => {
    TestBed.configureTestingModule({
      imports: [CrmOverviewComponent],
    });

    fixture = TestBed.createComponent(CrmOverviewComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('activeSilo', 'P2P_DESK');
    fixture.componentRef.setInput('heroKpis', sampleKpis);
    fixture.componentRef.setInput('cashflowColumns', sampleCashflow);
    fixture.componentRef.setInput('velocityBars', sampleVelocity);
    fixture.componentRef.setInput('totalPipelineVolumeLabel', '$4,820.00');
    fixture.componentRef.setInput('selectedPeriod', 'TODAY');
    fixture.componentRef.setInput('aiHealthScorePct', 88);
    fixture.componentRef.setInput('aiRecommendations', sampleRecommendations);
    fixture.componentRef.setInput('dealsStatusRows', sampleRows);
    fixture.componentRef.setInput('funnelStages', [
      { label: 'Cotizado', count: 3, valueLabel: '$1,200' },
      { label: 'Liquidado', count: 5, valueLabel: '$1,030' },
    ]);
    fixture.componentRef.setInput('spreadRateLabel', '2.15%');
    fixture.componentRef.setInput('winRateLabel', '74%');
    fixture.componentRef.setInput('avgCloseLabel', '14m');
    fixture.componentRef.setInput('privacyMode', false);

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders 4 KPI aura cards without liquid glass on content cards and emits kpiDrilldown', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.crm-liquid-glass').length).toBe(0);
    const kpis = host.querySelectorAll('.crm-kpi-aura');
    expect(kpis.length).toBe(4);
    expect(kpis[0].classList.contains('tone-emerald')).toBe(true);

    const emitted: CrmHeroKpiCard[] = [];
    component.kpiDrilldown.subscribe((card) => emitted.push(card));

    (kpis[1] as HTMLButtonElement).click();
    expect(emitted).toEqual([sampleKpis[1]]);
  });

  it('renders Cashflow & Treasury Spectrum with 5 columns, LED spectrum, and embedded AI Strategist prompt', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const cols = host.querySelectorAll('[data-testid="cashflow-col"]');
    expect(cols.length).toBe(5);
    expect(cols[1].classList.contains('is-highlighted')).toBe(true);
    expect(host.querySelectorAll('[data-testid="led-tick"]').length).toBeGreaterThanOrEqual(12);

    const prompts: string[] = [];
    component.askAiStrategist.subscribe((q) => prompts.push(q));

    const input = host.querySelector('[data-testid="ai-strategist-input"]') as HTMLInputElement;
    const submitBtn = host.querySelector('[data-testid="ai-strategist-submit"]') as HTMLButtonElement;

    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    submitBtn.click();
    expect(prompts).toEqual([]);

    input.value = '¿Qué riel tiene mejor cupo hoy?';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    submitBtn.click();
    fixture.detectChanges();

    expect(prompts).toEqual(['¿Qué riel tiene mejor cupo hoy?']);
    expect(input.value).toBe('');
  });

  it('renders Deal Type & Velocity bars and emits periodChange when period pills are clicked', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const bars = host.querySelectorAll('[data-testid="velocity-bar"]');
    expect(bars.length).toBe(3);
    expect(host.textContent).toContain('2.15%');
    expect(host.textContent).toContain('74%');
    expect(host.textContent).toContain('14m');

    const periods: CrmOverviewPeriod[] = [];
    component.periodChange.subscribe((p) => periods.push(p));

    const pill7d = host.querySelector('[data-testid="period-pill-7D"]') as HTMLButtonElement;
    pill7d.click();
    expect(periods).toEqual(['7D']);
  });

  it('renders AI Health Score recommendations and Deals Status hairline table rows', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('88%');
    const recs = host.querySelectorAll('[data-testid="health-rec-btn"]');
    expect(recs.length).toBe(2);

    const emittedRecs: CrmHealthRecommendation[] = [];
    component.recommendationAction.subscribe((r) => emittedRecs.push(r));
    (recs[0] as HTMLButtonElement).click();
    expect(emittedRecs).toEqual([sampleRecommendations[0]]);

    const table = host.querySelector('table.crm-hairline-table');
    expect(table).toBeTruthy();
    const rows = host.querySelectorAll('[data-testid="deals-status-row"]');
    expect(rows.length).toBe(2);

    const emittedDeals: CrmDealsStatusRow[] = [];
    component.openDealDetail.subscribe((row) => emittedDeals.push(row));

    const triggerBtn = host.querySelector('[data-testid="deals-status-open-DL-101"]') as HTMLButtonElement;
    triggerBtn.click();
    expect(emittedDeals).toEqual([sampleRows[0]]);

    fixture.componentRef.setInput('privacyMode', true);
    fixture.detectChanges();
    expect(host.classList.contains('privacy-active')).toBe(true);
  });
});
