import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CrmCommandHeaderComponent } from './crm-command-header.component';
import type { ArmWorkspaceId, CrmPrimaryNavId } from '../../crm-ui.models';

describe('CrmCommandHeaderComponent', () => {
  let fixture: ComponentFixture<CrmCommandHeaderComponent>;
  let component: CrmCommandHeaderComponent;

  const setup = (
    overrides: Partial<{
      activeSilo: ArmWorkspaceId;
      activeNav: CrmPrimaryNavId;
      gatewayStatus: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED';
      privacyMode: boolean;
      pipelineCount: number;
      inboxCount: number;
      pendingApprovalsCount: number;
      dailyProfitTodayUsdt: number;
      isTodaySettled: boolean;
      liveReplacementRate: number;
      conversionRatePct: number;
      railsSummaryLabel: string;
    }> = {},
  ) => {
    TestBed.configureTestingModule({
      imports: [CrmCommandHeaderComponent],
    });

    fixture = TestBed.createComponent(CrmCommandHeaderComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('activeSilo', overrides.activeSilo ?? 'P2P_DESK');
    fixture.componentRef.setInput('activeNav', overrides.activeNav ?? 'OVERVIEW');
    fixture.componentRef.setInput('gatewayStatus', overrides.gatewayStatus ?? 'CONNECTED');
    fixture.componentRef.setInput('privacyMode', overrides.privacyMode ?? false);
    fixture.componentRef.setInput('pipelineCount', overrides.pipelineCount ?? 5);
    fixture.componentRef.setInput('inboxCount', overrides.inboxCount ?? 3);
    fixture.componentRef.setInput('pendingApprovalsCount', overrides.pendingApprovalsCount ?? 2);
    fixture.componentRef.setInput('dailyProfitTodayUsdt', overrides.dailyProfitTodayUsdt ?? 48.5);
    fixture.componentRef.setInput('isTodaySettled', overrides.isTodaySettled ?? false);
    fixture.componentRef.setInput('liveReplacementRate', overrides.liveReplacementRate ?? 84.25);
    fixture.componentRef.setInput('conversionRatePct', overrides.conversionRatePct ?? 64);
    fixture.componentRef.setInput('railsSummaryLabel', overrides.railsSummaryLabel ?? '3/4');

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders a single liquid glass command bar with 3-silo capsule, 5 monochrome nav pills, and utility cluster', () => {
    const { fixture } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const glassBars = host.querySelectorAll('.crm-liquid-glass.command-bar');
    expect(glassBars.length).toBe(1);

    const siloButtons = host.querySelectorAll('.silo-pill');
    expect(siloButtons.length).toBe(3);
    expect(host.textContent).toContain('ARM B2B');
    expect(host.textContent).toContain('Mesa P2P');
    expect(host.textContent).toContain('Finanzas 360');

    const navButtons = host.querySelectorAll('.nav-pill');
    expect(navButtons.length).toBe(5);
    navButtons.forEach((btn) => {
      expect(btn.querySelector('svg')).toBeTruthy();
      expect(btn.textContent ?? '').not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    });

    expect(host.querySelector('[data-testid="nav-pill-PIPELINE"]')?.textContent).toContain('5');
    expect(host.querySelector('[data-testid="nav-pill-INBOX_STUDIO"]')?.textContent).toContain('3');
  });

  it('emits siloChange and updates host silo class when switching silos', () => {
    const { fixture, component } = setup({ activeSilo: 'ARM_B2B' });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('silo-b2b')).toBe(true);

    const emitted: ArmWorkspaceId[] = [];
    component.siloChange.subscribe((val) => emitted.push(val));

    const financeBtn = host.querySelector('[data-testid="silo-btn-FINANCE_360"]') as HTMLButtonElement;
    financeBtn.click();
    expect(emitted).toEqual(['FINANCE_360']);

    fixture.componentRef.setInput('activeSilo', 'FINANCE_360');
    fixture.detectChanges();
    expect(host.classList.contains('silo-360')).toBe(true);
  });

  it('emits navChange and highlights the active pill with high contrast state', () => {
    const { fixture, component } = setup({ activeNav: 'OVERVIEW' });
    const host = fixture.nativeElement as HTMLElement;

    const overviewBtn = host.querySelector('[data-testid="nav-pill-OVERVIEW"]') as HTMLButtonElement;
    expect(overviewBtn.classList.contains('is-active')).toBe(true);

    const emitted: CrmPrimaryNavId[] = [];
    component.navChange.subscribe((val) => emitted.push(val));

    const pipelineBtn = host.querySelector('[data-testid="nav-pill-PIPELINE"]') as HTMLButtonElement;
    pipelineBtn.click();
    expect(emitted).toEqual(['PIPELINE']);
  });

  it('emits openPalette and gatewayClick from trailing utility cluster', () => {
    const { fixture, component } = setup({ gatewayStatus: 'CONNECTING' });
    const host = fixture.nativeElement as HTMLElement;

    let paletteCalls = 0;
    let gatewayCalls = 0;
    component.openPalette.subscribe(() => paletteCalls++);
    component.gatewayClick.subscribe(() => gatewayCalls++);

    const searchBtn = host.querySelector('[data-testid="cmd-search-btn"]') as HTMLButtonElement;
    const gatewayBtn = host.querySelector('[data-testid="cmd-gateway-btn"]') as HTMLButtonElement;

    expect(gatewayBtn.classList.contains('is-connecting')).toBe(true);
    searchBtn.click();
    gatewayBtn.click();

    expect(paletteCalls).toBe(1);
    expect(gatewayCalls).toBe(1);
  });

  it('toggles overflow popover for Privacy and #SETTLE actions', () => {
    const { fixture, component } = setup({
      activeSilo: 'P2P_DESK',
      dailyProfitTodayUsdt: 120.75,
      isTodaySettled: false,
      privacyMode: false,
    });
    const host = fixture.nativeElement as HTMLElement;

    let privacyCalls = 0;
    let settleCalls = 0;
    component.togglePrivacy.subscribe(() => privacyCalls++);
    component.settleProfit.subscribe(() => settleCalls++);

    const overflowTrigger = host.querySelector('[data-testid="cmd-overflow-btn"]') as HTMLButtonElement;
    overflowTrigger.click();
    fixture.detectChanges();

    const privacyBtn = host.querySelector('[data-testid="overflow-privacy-btn"]') as HTMLButtonElement;
    const settleBtn = host.querySelector('[data-testid="overflow-settle-btn"]') as HTMLButtonElement;
    expect(privacyBtn).toBeTruthy();
    expect(settleBtn).toBeTruthy();
    expect(settleBtn.disabled).toBe(false);

    privacyBtn.click();
    fixture.detectChanges();
    expect(privacyCalls).toBe(1);

    overflowTrigger.click();
    fixture.detectChanges();
    const settleBtnReopened = host.querySelector('[data-testid="overflow-settle-btn"]') as HTMLButtonElement;
    settleBtnReopened.click();
    expect(settleCalls).toBe(1);

    fixture.componentRef.setInput('isTodaySettled', true);
    overflowTrigger.click();
    fixture.detectChanges();
    const settledBtn = host.querySelector('[data-testid="overflow-settle-btn"]') as HTMLButtonElement;
    expect(settledBtn.disabled).toBe(true);
    expect(settledBtn.textContent).toContain('#SETTLE');
  });

  it('opens + Nuevo split menu and emits quickCreate options', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;
    const created: ('NEW_DEAL' | 'NEW_CONTACT' | 'NEW_BANK' | 'NEW_CHAT')[] = [];
    component.quickCreate.subscribe((val) => created.push(val));

    const splitToggle = host.querySelector('[data-testid="quick-create-toggle"]') as HTMLButtonElement;
    splitToggle.click();
    fixture.detectChanges();

    const contactItem = host.querySelector('[data-testid="quick-create-NEW_CONTACT"]') as HTMLButtonElement;
    contactItem.click();
    fixture.detectChanges();
    expect(created).toEqual(['NEW_CONTACT']);

    splitToggle.click();
    fixture.detectChanges();
    const bankItem = host.querySelector('[data-testid="quick-create-NEW_BANK"]') as HTMLButtonElement;
    bankItem.click();
    expect(created).toEqual(['NEW_CONTACT', 'NEW_BANK']);
  });
});
