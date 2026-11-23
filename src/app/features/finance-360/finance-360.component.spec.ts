import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Finance360Component } from './finance-360.component';
import { Finance360Service } from '../../core/finance-360.service';
import { HotkeysService } from '../../core/hotkeys.service';
import { FinanceDriveSyncService } from '../../core/services/finance-drive-sync.service';
import { VoiceDictationService } from '../../core/voice-dictation.service';
import { F360_NAV_TAB_ID } from './f360-ui.models';

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('Finance360Component', () => {
  let fixture: ComponentFixture<Finance360Component>;
  let component: Finance360Component;
  let financeService: Finance360Service;
  let hotkeys: HotkeysService;

  beforeEach(async () => {
    if (typeof globalThis.localStorage?.clear === 'function') {
      globalThis.localStorage.clear();
    }

    await TestBed.configureTestingModule({
      imports: [Finance360Component],
    }).compileComponents();

    financeService = TestBed.inject(Finance360Service);
    financeService.resetLedgerToZero();
    hotkeys = TestBed.inject(HotkeysService);

    fixture = TestBed.createComponent(Finance360Component);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the modular command header and Zero-Seed overview with zero emojis', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-f360-command-header')).toBeTruthy();
    expect(host.querySelector('app-f360-overview')).toBeTruthy();
    expect(host.querySelector('[data-testid="f360-mobile-fab"]')).toBeTruthy();
    expect(host.textContent ?? '').not.toMatch(EMOJI_PATTERN);
  });

  it('switches cleanly across all 5 navigation tabs including Pyme vs Quotes subtabs', () => {
    const host = fixture.nativeElement as HTMLElement;

    component.selectTab(F360_NAV_TAB_ID.VAULTS);
    fixture.detectChanges();
    expect(host.querySelector('app-f360-vaults-ledger')).toBeTruthy();

    component.selectTab(F360_NAV_TAB_ID.ANALYTICS);
    fixture.detectChanges();
    expect(host.querySelector('app-finance-analytics')).toBeTruthy();

    component.selectTab(F360_NAV_TAB_ID.CASHEA);
    fixture.detectChanges();
    expect(host.querySelector('app-cashea-calculator')).toBeTruthy();

    component.selectTab(F360_NAV_TAB_ID.PYME_QUOTES);
    fixture.detectChanges();
    expect(host.querySelector('app-pyme-manager')).toBeTruthy();
    expect(host.querySelector('app-quote-builder')).toBeNull();

    (host.querySelector('[data-testid="subtab-quotes"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelector('app-quote-builder')).toBeTruthy();
    expect(host.querySelector('app-pyme-manager')).toBeNull();
  });

  it('overrides global Ctrl+K via HotkeysService.registerScopedPalette without collision and closes on Escape', () => {
    const ctrlK = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    window.dispatchEvent(ctrlK);
    fixture.detectChanges();

    expect(component.scopedPaletteOpen()).toBe(true);
    expect(hotkeys.isPaletteOpen()).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="f360-scoped-palette"]'),
    ).toBeTruthy();

    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(esc);
    fixture.detectChanges();

    expect(component.scopedPaletteOpen()).toBe(false);
  });

  it('requires typing RESET before enabling destructive portfolio reset', () => {
    financeService.addAssetVault({
      name: 'Zelle Prueba',
      channel: 'zelle',
      scope: 'personal',
      currency: 'USD',
      balance: 250,
      balanceUsdEquivalent: 250,
      balanceVesEquivalent: 0,
    });
    expect(financeService.assets().length).toBe(1);

    component.handleOverflowAction('request_reset');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const confirmBtn = host.querySelector(
      '[data-testid="f360-reset-confirm-btn"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    component.resetConfirmText.set('borrar');
    fixture.detectChanges();
    expect(confirmBtn.disabled).toBe(true);

    component.resetConfirmText.set('RESET');
    fixture.detectChanges();
    expect(confirmBtn.disabled).toBe(false);

    confirmBtn.click();
    fixture.detectChanges();

    expect(component.resetConfirmModalOpen()).toBe(false);
    expect(financeService.assets().length).toBe(0);
  });

  it('toggles privacy mode class on host and propagates Drive sync overflow action', () => {
    const driveSync = TestBed.inject(FinanceDriveSyncService);
    const syncSpy = vi.spyOn(driveSync, 'triggerCloudSync').mockResolvedValue({
      success: false,
      mode: 'disconnected',
      filesCount: 0,
      targetFolder: '/HOMEL_360',
      timestamp: new Date().toISOString(),
    });

    expect((fixture.nativeElement as HTMLElement).classList.contains('privacy-active')).toBe(false);
    component.handleOverflowAction('toggle_privacy');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).classList.contains('privacy-active')).toBe(true);

    component.handleOverflowAction('sync_drive');
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it('blocks duplicate reference numbers when saving quick transactions', () => {
    const vault = financeService.addAssetVault({
      name: 'Banesco Test',
      channel: 'bs_bank',
      scope: 'personal',
      currency: 'USD',
      balance: 500,
      balanceUsdEquivalent: 500,
      balanceVesEquivalent: 0,
    });

    component.openQuickModal('expense');
    component.formTitle.set('Pago Internet');
    component.formAmount.set(30);
    component.formCurrency.set('USD');
    component.formVaultId.set(vault.id);
    component.formReferenceNumber.set('REF-99001');
    component.saveQuickTransaction();

    expect(financeService.state().expenses.length).toBe(1);

    component.openQuickModal('expense');
    component.formTitle.set('Pago Internet Duplicado');
    component.formAmount.set(30);
    component.formCurrency.set('USD');
    component.formVaultId.set(vault.id);
    component.formReferenceNumber.set('REF-99001');
    component.saveQuickTransaction();

    expect(financeService.state().expenses.length).toBe(1);
    const voice = TestBed.inject(VoiceDictationService);
    expect(voice.isListening()).toBe(false);
  });
});
