import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { F360CommandHeaderComponent } from './f360-command-header.component';
import type {
  F360Horizon,
  F360NavTabId,
  F360OverflowActionId,
  F360QuickActionId,
  FinanceScope,
} from '../../f360-ui.models';

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('F360CommandHeaderComponent', () => {
  let fixture: ComponentFixture<F360CommandHeaderComponent>;
  let component: F360CommandHeaderComponent;

  const setup = (
    overrides: Partial<{
      activeScope: FinanceScope;
      activeTab: F360NavTabId;
      horizon: F360Horizon;
      privacyMode: boolean;
      overdueCount: number;
      vaultsCount: number;
      casheaActiveCount: number;
      pymeAlertsCount: number;
      driveSyncing: boolean;
    }> = {},
  ) => {
    TestBed.configureTestingModule({
      imports: [F360CommandHeaderComponent],
    });

    fixture = TestBed.createComponent(F360CommandHeaderComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('activeScope', overrides.activeScope ?? 'all');
    fixture.componentRef.setInput('activeTab', overrides.activeTab ?? 'overview');
    fixture.componentRef.setInput('horizon', overrides.horizon ?? 'month');
    fixture.componentRef.setInput('privacyMode', overrides.privacyMode ?? false);
    fixture.componentRef.setInput('overdueCount', overrides.overdueCount ?? 0);
    fixture.componentRef.setInput('vaultsCount', overrides.vaultsCount ?? 3);
    fixture.componentRef.setInput('casheaActiveCount', overrides.casheaActiveCount ?? 2);
    fixture.componentRef.setInput('pymeAlertsCount', overrides.pymeAlertsCount ?? 1);
    fixture.componentRef.setInput('driveSyncing', overrides.driveSyncing ?? false);

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders liquid glass command bar, scope tablist, single primary CTA, overflow trigger, and 5 monochrome nav pills with zero emojis', () => {
    const { fixture } = setup({ overdueCount: 2, vaultsCount: 4, casheaActiveCount: 3 });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.f360-liquid-glass.command-bar').length).toBe(1);
    expect(host.textContent).toContain('Finanzas 360');
    expect(host.textContent ?? '').not.toMatch(EMOJI_PATTERN);

    const scopeTablist = host.querySelector('[role="tablist"]');
    expect(scopeTablist).toBeTruthy();

    const scopeTabs = host.querySelectorAll('[role="tab"]');
    expect(scopeTabs.length).toBe(3);
    expect(scopeTabs[0].getAttribute('aria-selected')).toBe('true');
    expect(host.textContent).toContain('Consolidado');
    expect(host.textContent).toContain('Personal');
    expect(host.textContent).toContain('Pyme');

    const primaryButtons = host.querySelectorAll('.f360-btn-primary');
    expect(primaryButtons.length).toBe(1);
    expect(primaryButtons[0].textContent).toContain('Registrar');

    const navPills = host.querySelectorAll('.nav-pill');
    expect(navPills.length).toBe(5);
    navPills.forEach((pill) => {
      expect(pill.querySelector('svg')).toBeTruthy();
      expect(pill.textContent ?? '').not.toMatch(EMOJI_PATTERN);
    });

    expect(host.querySelector('[data-testid="nav-tab-overview"]')?.textContent).toContain('2');
    expect(host.querySelector('[data-testid="nav-tab-vaults"]')?.textContent).toContain('4');
    expect(host.querySelector('[data-testid="nav-tab-cashea"]')?.textContent).toContain('3');
  });

  it('emits scopeChange and updates host chameleon scope class', () => {
    const { fixture, component } = setup({ activeScope: 'all' });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('scope-all')).toBe(true);

    const emitted: FinanceScope[] = [];
    component.scopeChange.subscribe((scope) => emitted.push(scope));

    const pymeBtn = host.querySelector('[data-testid="scope-tab-business"]') as HTMLButtonElement;
    pymeBtn.click();
    expect(emitted).toEqual(['business']);

    fixture.componentRef.setInput('activeScope', 'business');
    fixture.detectChanges();
    expect(host.classList.contains('scope-business')).toBe(true);
    expect(pymeBtn.getAttribute('aria-selected')).toBe('true');
  });

  it('emits tabChange and sets aria-current on the active navigation pill', () => {
    const { fixture, component } = setup({ activeTab: 'overview' });
    const host = fixture.nativeElement as HTMLElement;

    const overviewBtn = host.querySelector('[data-testid="nav-tab-overview"]') as HTMLButtonElement;
    expect(overviewBtn.getAttribute('aria-current')).toBe('page');

    const emitted: F360NavTabId[] = [];
    component.tabChange.subscribe((tab) => emitted.push(tab));

    const vaultsBtn = host.querySelector('[data-testid="nav-tab-vaults"]') as HTMLButtonElement;
    vaultsBtn.click();
    expect(emitted).toEqual(['vaults']);
  });

  it('emits openPalette from search trigger pill', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;
    let count = 0;
    component.openPalette.subscribe(() => count++);

    const searchBtn = host.querySelector('[data-testid="f360-search-trigger"]') as HTMLButtonElement;
    expect(searchBtn.textContent).toContain('⌘K');
    searchBtn.click();
    expect(count).toBe(1);
  });

  it('opens horizon popover and emits horizonChange', () => {
    const { fixture, component } = setup({ horizon: 'month' });
    const host = fixture.nativeElement as HTMLElement;
    const changes: F360Horizon[] = [];
    component.horizonChange.subscribe((h) => changes.push(h));

    const trigger = host.querySelector('[data-testid="f360-horizon-trigger"]') as HTMLButtonElement;
    expect(trigger.textContent).toContain('30D');
    trigger.click();
    fixture.detectChanges();

    const yearOpt = host.querySelector('[data-testid="horizon-opt-year"]') as HTMLButtonElement;
    expect(yearOpt).toBeTruthy();
    yearOpt.click();
    fixture.detectChanges();

    expect(changes).toEqual(['year']);
    expect(host.querySelector('[data-testid="horizon-opt-year"]')).toBeNull();
  });

  it('opens + Registrar popover with all quick actions and emits quickAction', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;
    const actions: F360QuickActionId[] = [];
    component.quickAction.subscribe((action) => actions.push(action));

    const trigger = host.querySelector('[data-testid="f360-register-trigger"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const expectedIds: F360QuickActionId[] = [
      'income',
      'expense',
      'transfer',
      'audio',
      'new_vault',
      'new_liability',
      'new_goal',
    ];
    expectedIds.forEach((id) => {
      expect(host.querySelector(`[data-testid="quick-action-${id}"]`)).toBeTruthy();
    });

    (host.querySelector('[data-testid="quick-action-transfer"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(actions).toEqual(['transfer']);
    expect(host.querySelector('[data-testid="quick-action-transfer"]')).toBeNull();
  });

  it('opens overflow popover and emits overflowAction including privacy, demo, drive, export, CSVs, and reset', () => {
    const { fixture, component } = setup({ privacyMode: true });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('privacy-active')).toBe(true);

    const emitted: F360OverflowActionId[] = [];
    component.overflowAction.subscribe((action) => emitted.push(action));

    const trigger = host.querySelector('[data-testid="f360-overflow-trigger"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const expectedIds: F360OverflowActionId[] = [
      'toggle_privacy',
      'load_demo',
      'clear_demo',
      'sync_drive',
      'export_json',
      'restore_json',
      'export_csv_incomes',
      'export_csv_expenses',
      'export_csv_liabilities',
      'request_reset',
    ];
    expectedIds.forEach((id) => {
      expect(host.querySelector(`[data-testid="overflow-action-${id}"]`)).toBeTruthy();
    });

    (host.querySelector('[data-testid="overflow-action-load_demo"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['load_demo']);
  });

  it('closes active popover on Escape key and on outside click', () => {
    const { fixture } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const trigger = host.querySelector('[data-testid="f360-register-trigger"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="quick-action-income"]')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="quick-action-income"]')).toBeNull();

    trigger.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="quick-action-income"]')).toBeTruthy();

    document.body.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="quick-action-income"]')).toBeNull();
  });
});
