import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { F360OverviewComponent } from './f360-overview.component';
import type {
  F360CashflowSeriesPoint,
  F360Horizon,
  F360LedgerRowItem,
  F360LiquiditySummary,
  F360NavTabId,
  F360OverviewUpcomingItem,
  F360PnlLine,
  F360QuickActionId,
  WealthGoal,
} from '../../f360-ui.models';

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('F360OverviewComponent', () => {
  let fixture: ComponentFixture<F360OverviewComponent>;
  let component: F360OverviewComponent;

  const sampleSeries: F360CashflowSeriesPoint[] = [
    { id: 'p1', dateIso: '2026-11-10', label: '10 Nov', incomeUsd: 420, expenseUsd: 180 },
    { id: 'p2', dateIso: '2026-11-12', label: '12 Nov', incomeUsd: 650, expenseUsd: 240 },
    { id: 'p3', dateIso: '2026-11-15', label: '15 Nov', incomeUsd: 510, expenseUsd: 310 },
  ];

  const samplePnl: F360PnlLine[] = [
    { id: 'op', label: 'Ingresos Operativos', amountUsd: 1450, tone: 'positive' },
    { id: 'p2p', label: 'Profit P2P Aislado', amountUsd: 130, tone: 'positive' },
    { id: 'cogs', label: 'Costos Directos', amountUsd: 350, tone: 'negative' },
    { id: 'fixed', label: 'Gastos Fijos', amountUsd: 380, tone: 'negative' },
    { id: 'net', label: 'Utilidad Neta', amountUsd: 850, sharePct: 53.8, tone: 'highlight' },
  ];

  const sampleUpcoming: F360OverviewUpcomingItem[] = [
    {
      id: 'liab-overdue',
      title: 'Cuota Cashea Laptop',
      creditor: 'Cashea',
      dueDate: '2026-11-16',
      daysDelta: -3,
      remainingUsd: 75,
      status: 'overdue',
      category: 'cashea',
      scope: 'personal',
    },
    {
      id: 'liab-upcoming',
      title: 'Internet Fibra',
      creditor: 'ISP Local',
      dueDate: '2026-11-24',
      daysDelta: 5,
      remainingUsd: 45,
      status: 'upcoming',
      category: 'fixed_service',
      scope: 'business',
    },
  ];

  const sampleActivity: F360LedgerRowItem[] = [
    {
      id: 'act-1',
      kind: 'income',
      title: 'Honorarios Consultoría',
      scope: 'personal',
      categoryLabel: 'Honorarios',
      vaultName: 'Zelle Personal',
      bcvRateApplied: 64.5,
      amountUsd: 450,
      amountVes: 29025,
      date: '2026-11-18',
      createdAt: '2026-11-18T14:00:00Z',
    },
    {
      id: 'act-2',
      kind: 'expense',
      title: 'Mercado Semanal',
      scope: 'personal',
      categoryLabel: 'Comida y Mercado',
      vaultName: 'Banco Venezuela',
      bcvRateApplied: 64.5,
      amountUsd: 120,
      amountVes: 7740,
      date: '2026-11-17',
      createdAt: '2026-11-17T10:00:00Z',
    },
    {
      id: 'act-3',
      kind: 'transfer',
      title: 'Traspaso Zelle a VES',
      scope: 'all',
      categoryLabel: 'Transferencia FX',
      vaultName: 'Zelle → Banesco',
      bcvRateApplied: 64.5,
      amountUsd: 200,
      amountVes: 12900,
      date: '2026-11-16',
      createdAt: '2026-11-16T09:00:00Z',
    },
  ];

  const sampleGoals: WealthGoal[] = [
    {
      id: 'goal-1',
      title: 'Fondo de Emergencia',
      targetAmountUsd: 2000,
      currentAmountUsd: 800,
      scope: 'personal',
      category: 'emergency',
      createdAt: '2026-10-01T12:00:00Z',
    },
  ];

  const setup = (
    overrides: Partial<{
      horizon: F360Horizon;
      privacyMode: boolean;
      netWorthUsd: number;
      netWorthVes: number;
      bcvRate: number;
      periodIncomeUsd: number;
      periodExpenseUsd: number;
      periodExpenseCount: number;
      liquidity: F360LiquiditySummary;
      cashflowSeries: F360CashflowSeriesPoint[];
      pnlLines: F360PnlLine[];
      todayP2pProfitUsd: number;
      isP2pImportedToday: boolean;
      upcomingItems: F360OverviewUpcomingItem[];
      recentActivity: F360LedgerRowItem[];
      goals: WealthGoal[];
    }> = {},
  ) => {
    TestBed.configureTestingModule({
      imports: [F360OverviewComponent],
    });

    fixture = TestBed.createComponent(F360OverviewComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('horizon', overrides.horizon ?? 'month');
    fixture.componentRef.setInput('privacyMode', overrides.privacyMode ?? false);
    fixture.componentRef.setInput('netWorthUsd', overrides.netWorthUsd ?? 4250);
    fixture.componentRef.setInput('netWorthVes', overrides.netWorthVes ?? 274125);
    fixture.componentRef.setInput('bcvRate', overrides.bcvRate ?? 64.5);
    fixture.componentRef.setInput('periodIncomeUsd', overrides.periodIncomeUsd ?? 1580);
    fixture.componentRef.setInput('periodExpenseUsd', overrides.periodExpenseUsd ?? 730);
    fixture.componentRef.setInput('periodExpenseCount', overrides.periodExpenseCount ?? 11);
    fixture.componentRef.setInput(
      'liquidity',
      overrides.liquidity ?? {
        status: 'critical',
        ratioPct: 35,
        due14DaysUsd: 120,
        liquidUsd: 900,
        overdueUsd: 75,
        overdueCount: 1,
        detailLabel: 'Mora activa (1 pasivo vencido)',
      },
    );
    fixture.componentRef.setInput('cashflowSeries', overrides.cashflowSeries ?? sampleSeries);
    fixture.componentRef.setInput('pnlLines', overrides.pnlLines ?? samplePnl);
    fixture.componentRef.setInput('todayP2pProfitUsd', overrides.todayP2pProfitUsd ?? 42.5);
    fixture.componentRef.setInput('isP2pImportedToday', overrides.isP2pImportedToday ?? false);
    fixture.componentRef.setInput('upcomingItems', overrides.upcomingItems ?? sampleUpcoming);
    fixture.componentRef.setInput('recentActivity', overrides.recentActivity ?? sampleActivity);
    fixture.componentRef.setInput('goals', overrides.goals ?? sampleGoals);

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders 4 hero KPI bento cards with BCV live value, overdue liquidity badge, and zero emojis', () => {
    const { fixture } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const kpiCards = host.querySelectorAll('.f360-kpi-aura');
    expect(kpiCards.length).toBe(4);
    expect(host.textContent).toContain('Patrimonio Neto');
    expect(host.textContent).toContain('Flujo Neto');
    expect(host.textContent).toContain('Egresos');
    expect(host.textContent).toContain('Liquidez 14D');
    expect(host.textContent).toContain('BCV');
    expect(host.textContent).toContain('Crítica');
    expect(host.querySelector('[data-testid="liquidity-overdue-badge"]')?.textContent).toContain('1');
    expect(host.textContent ?? '').not.toMatch(EMOJI_PATTERN);
  });

  it('shows honest Tasa BCV offline state when bcvRate is 0 and never invents a conversion', () => {
    const { fixture } = setup({ bcvRate: 0, netWorthVes: 0 });
    const host = fixture.nativeElement as HTMLElement;
    const netWorthCard = host.querySelector('[data-testid="kpi-net-worth"]');
    expect(netWorthCard?.textContent).toContain('Tasa BCV offline');
  });

  it('renders interactive dual-spline cashflow chart tooltip on hover and clean empty state when series is empty', () => {
    const { fixture } = setup();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="cashflow-svg"]')).toBeTruthy();
    const secondPointBtn = host.querySelector('[data-testid="cashflow-point-1"]') as HTMLButtonElement;
    secondPointBtn.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    const tooltip = host.querySelector('[data-testid="cashflow-tooltip"]');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toContain('12 Nov');
    expect(tooltip?.textContent).toContain('650');

    fixture.componentRef.setInput('cashflowSeries', []);
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="cashflow-svg"]')).toBeNull();
    expect(host.querySelector('[data-testid="cashflow-empty"]')).toBeTruthy();
  });

  it('renders structured P&L statement with highlighted Utilidad Neta footer row', () => {
    const { fixture } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const pnlCard = host.querySelector('[data-testid="pnl-card"]');
    expect(pnlCard?.textContent).toContain('Ingresos Operativos');
    expect(pnlCard?.textContent).toContain('Profit P2P Aislado');
    expect(pnlCard?.textContent).toContain('Costos Directos');
    expect(pnlCard?.textContent).toContain('Gastos Fijos');
    expect(pnlCard?.querySelector('[data-testid="pnl-net-row"]')?.textContent).toContain(
      'Utilidad Neta',
    );
  });

  it('emits quickAction from 2x2 quick action cards and shows Mesa aislada when P2P profit is 0', () => {
    const { fixture, component } = setup({ todayP2pProfitUsd: 0 });
    const host = fixture.nativeElement as HTMLElement;
    const actions: F360QuickActionId[] = [];
    component.quickAction.subscribe((a) => actions.push(a));

    const p2pCard = host.querySelector('[data-testid="quick-action-p2p"]') as HTMLButtonElement;
    expect(p2pCard.textContent).toContain('Mesa aislada · $0');

    (host.querySelector('[data-testid="quick-action-movement"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="quick-action-transfer"]') as HTMLButtonElement).click();
    p2pCard.click();
    (host.querySelector('[data-testid="quick-action-audio"]') as HTMLButtonElement).click();

    expect(actions).toEqual(['expense', 'transfer', 'import_p2p', 'audio']);
  });

  it('shows both overdue (Vencido badge) and upcoming 14D obligations with contextual action menu', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const overdueBadge = host.querySelector('[data-testid="upcoming-badge-liab-overdue"]');
    expect(overdueBadge?.textContent).toContain('Vencido');
    expect(host.textContent).toContain('Internet Fibra');

    const paid: F360OverviewUpcomingItem[] = [];
    const deleted: F360OverviewUpcomingItem[] = [];
    component.payLiability.subscribe((item) => paid.push(item));
    component.deleteLiability.subscribe((item) => deleted.push(item));

    const menuBtn = host.querySelector(
      '[data-testid="upcoming-menu-liab-overdue"]',
    ) as HTMLButtonElement;
    menuBtn.click();
    fixture.detectChanges();

    (host.querySelector('[data-testid="upcoming-pay-liab-overdue"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(paid.map((p) => p.id)).toEqual(['liab-overdue']);

    menuBtn.click();
    fixture.detectChanges();
    (
      host.querySelector('[data-testid="upcoming-delete-liab-overdue"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(deleted.map((d) => d.id)).toEqual(['liab-overdue']);
  });

  it('renders recent activity directional feed and navigates to vaults via Ver libro completo', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const rows = host.querySelectorAll('[data-testid^="activity-row-"]');
    expect(rows.length).toBe(3);

    const tabs: F360NavTabId[] = [];
    component.navigateTab.subscribe((t) => tabs.push(t));

    const viewAllBtn = host.querySelector('[data-testid="view-full-ledger-btn"]') as HTMLButtonElement;
    viewAllBtn.click();
    expect(tabs).toEqual(['vaults']);
  });

  it('renders wealth goals strip with Abonar and hides delete inside contextual menu, plus privacy mode class', () => {
    const { fixture, component } = setup({ privacyMode: true });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.classList.contains('privacy-active')).toBe(true);
    expect(host.querySelectorAll('.privacy-mask').length).toBeGreaterThan(0);

    // Delete must NOT be exposed directly before opening contextual menu
    expect(host.querySelector('[data-testid="goal-delete-goal-1"]')).toBeNull();

    const contributed: WealthGoal[] = [];
    const deleted: WealthGoal[] = [];
    component.contributeGoal.subscribe((g) => contributed.push(g));
    component.deleteGoal.subscribe((g) => deleted.push(g));

    (host.querySelector('[data-testid="goal-contribute-goal-1"]') as HTMLButtonElement).click();
    expect(contributed.map((g) => g.id)).toEqual(['goal-1']);

    (host.querySelector('[data-testid="goal-menu-goal-1"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (host.querySelector('[data-testid="goal-delete-goal-1"]') as HTMLButtonElement).click();
    expect(deleted.map((g) => g.id)).toEqual(['goal-1']);
  });
});
