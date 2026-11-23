import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { OcrCommandHeaderComponent } from './ocr-command-header.component';
import type {
  OcrDestinationMode,
  OcrOverflowActionId,
  OcrRoutingState,
  OcrVaultOption,
} from '../../ocr-ui.models';

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

const DEFAULT_ROUTING: OcrRoutingState = {
  scope: 'personal',
  pillar: 'expense',
  expenseCategory: 'groceries',
  incomeCategory: 'business_sale',
  vaultId: '',
};

const SAMPLE_VAULTS: readonly OcrVaultOption[] = [
  { id: 'v-1', name: 'Banesco Bs', currency: 'VES' },
  { id: 'v-2', name: 'Zelle Personal', currency: 'USD' },
];

describe('OcrCommandHeaderComponent', () => {
  let fixture: ComponentFixture<OcrCommandHeaderComponent>;
  let component: OcrCommandHeaderComponent;

  const setup = (
    overrides: Partial<{
      destinationMode: OcrDestinationMode;
      routing: OcrRoutingState;
      vaults: readonly OcrVaultOption[];
      hasScreenPipe: boolean;
      receiptsCount: number;
      isProcessing: boolean;
      blacklistedCount: number;
    }> = {},
  ) => {
    TestBed.configureTestingModule({
      imports: [OcrCommandHeaderComponent],
    });

    fixture = TestBed.createComponent(OcrCommandHeaderComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('destinationMode', overrides.destinationMode ?? 'p2p');
    fixture.componentRef.setInput('routing', overrides.routing ?? DEFAULT_ROUTING);
    fixture.componentRef.setInput('vaults', overrides.vaults ?? SAMPLE_VAULTS);
    fixture.componentRef.setInput('hasScreenPipe', overrides.hasScreenPipe ?? false);
    fixture.componentRef.setInput('receiptsCount', overrides.receiptsCount ?? 2);
    fixture.componentRef.setInput('isProcessing', overrides.isProcessing ?? false);
    fixture.componentRef.setInput('blacklistedCount', overrides.blacklistedCount ?? 0);

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders liquid glass command bar, mode tablist, search trigger, single primary CTA, overflow trigger, and zero emojis', () => {
    const { fixture } = setup();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.ocr-liquid-glass.command-bar').length).toBe(1);
    expect(host.textContent).toContain('Comprobantes & OCR Forense');
    expect(host.textContent ?? '').not.toMatch(EMOJI_PATTERN);
    expect(host.querySelector('.brand-emblem svg')).toBeTruthy();

    const tablist = host.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    const tabs = host.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain('Mesa P2P');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].textContent).toContain('Finanzas 360');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');

    const searchBtn = host.querySelector('[data-testid="ocr-search-trigger"]') as HTMLButtonElement;
    expect(searchBtn).toBeTruthy();
    expect(searchBtn.textContent).toContain('Buscar referencia, pagador, banco...');
    expect(searchBtn.querySelector('kbd')?.textContent).toContain('⌘K');

    const primaryButtons = host.querySelectorAll('.ocr-btn-primary');
    expect(primaryButtons.length).toBe(1);
    expect(primaryButtons[0].getAttribute('data-testid')).toBe('ocr-primary-capture');
    expect(primaryButtons[0].textContent).toContain('+ Capturar / Pegar');

    expect(host.querySelector('[data-testid="ocr-overflow-trigger"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="ocr-f360-routing-bar"]')).toBeNull();
  });

  it('emits destinationModeChange and switches host mode class', () => {
    const { fixture, component } = setup({ destinationMode: 'p2p' });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('mode-p2p')).toBe(true);

    const emitted: OcrDestinationMode[] = [];
    component.destinationModeChange.subscribe((mode) => emitted.push(mode));

    const f360Tab = host.querySelector('[data-testid="ocr-mode-finance360"]') as HTMLButtonElement;
    f360Tab.click();
    expect(emitted).toEqual(['finance360']);

    fixture.componentRef.setInput('destinationMode', 'finance360');
    fixture.detectChanges();
    expect(host.classList.contains('mode-finance360')).toBe(true);
    expect(f360Tab.getAttribute('aria-selected')).toBe('true');
  });

  it('emits openPalette and triggerCapture from search pill and primary CTA', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    let paletteClicks = 0;
    let captureClicks = 0;
    component.openPalette.subscribe(() => paletteClicks++);
    component.triggerCapture.subscribe(() => captureClicks++);

    (host.querySelector('[data-testid="ocr-search-trigger"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="ocr-primary-capture"]') as HTMLButtonElement).click();

    expect(paletteClicks).toBe(1);
    expect(captureClicks).toBe(1);
  });

  it('toggles overflow popover, conditionally renders Screen Pipe, emits overflowAction, and closes on Escape/outside click', () => {
    const { fixture, component } = setup({ hasScreenPipe: true, receiptsCount: 3 });
    const host = fixture.nativeElement as HTMLElement;
    const emitted: OcrOverflowActionId[] = [];
    component.overflowAction.subscribe((action) => emitted.push(action));

    const trigger = host.querySelector('[data-testid="ocr-overflow-trigger"]') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="ocr-overflow-screen_pipe"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="ocr-overflow-export_csv"]')).toBeTruthy();
    const clearBtn = host.querySelector(
      '[data-testid="ocr-overflow-clear_session"]',
    ) as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    expect(clearBtn.classList.contains('is-danger')).toBe(true);

    (host.querySelector('[data-testid="ocr-overflow-export_csv"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['export_csv']);
    expect(host.querySelector('[data-testid="ocr-overflow-export_csv"]')).toBeNull();

    // Reopen and close with Escape
    trigger.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="ocr-overflow-screen_pipe"]')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="ocr-overflow-screen_pipe"]')).toBeNull();

    // Reopen and close with outside click
    trigger.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="ocr-overflow-screen_pipe"]')).toBeTruthy();
    document.body.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="ocr-overflow-screen_pipe"]')).toBeNull();
  });

  it('hides Screen Pipe when hasScreenPipe is false and disables export/clear when receiptsCount is 0', () => {
    const { fixture } = setup({ hasScreenPipe: false, receiptsCount: 0 });
    const host = fixture.nativeElement as HTMLElement;

    (host.querySelector('[data-testid="ocr-overflow-trigger"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="ocr-overflow-screen_pipe"]')).toBeNull();
    expect(
      (host.querySelector('[data-testid="ocr-overflow-export_csv"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (host.querySelector('[data-testid="ocr-overflow-clear_session"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('shows Finance 360 routing bar only in finance360 mode, switches expense/income categories with #finance-income-category, and emits routingChange', () => {
    const { fixture, component } = setup({
      destinationMode: 'finance360',
      routing: { ...DEFAULT_ROUTING, pillar: 'expense' },
    });
    const host = fixture.nativeElement as HTMLElement;
    const emitted: OcrRoutingState[] = [];
    component.routingChange.subscribe((next) => emitted.push(next));

    const bar = host.querySelector('[data-testid="ocr-f360-routing-bar"]');
    expect(bar).toBeTruthy();
    expect(host.querySelector('label[for="ocr-f360-scope"]')).toBeTruthy();
    expect(host.querySelector('label[for="ocr-f360-pillar"]')).toBeTruthy();
    expect(host.querySelector('label[for="ocr-f360-expense-category"]')).toBeTruthy();
    expect(host.querySelector('label[for="ocr-f360-vault"]')).toBeTruthy();

    const pillarSelect = host.querySelector('#ocr-f360-pillar') as HTMLSelectElement;
    pillarSelect.value = 'income';
    pillarSelect.dispatchEvent(new Event('change'));
    expect(emitted.at(-1)?.pillar).toBe('income');

    // Update routing input to income and verify #finance-income-category & aria-label
    fixture.componentRef.setInput('routing', { ...DEFAULT_ROUTING, pillar: 'income' });
    fixture.detectChanges();

    const incomeSelect = host.querySelector('#finance-income-category') as HTMLSelectElement;
    expect(incomeSelect).toBeTruthy();
    expect(incomeSelect.getAttribute('aria-label')).toBe('Categoría de ingreso');
    expect(host.querySelector('label[for="finance-income-category"]')).toBeTruthy();

    incomeSelect.value = 'salary';
    incomeSelect.dispatchEvent(new Event('change'));
    expect(emitted.at(-1)?.incomeCategory).toBe('salary');

    const vaultSelect = host.querySelector('#ocr-f360-vault') as HTMLSelectElement;
    vaultSelect.value = 'v-2';
    vaultSelect.dispatchEvent(new Event('change'));
    expect(emitted.at(-1)?.vaultId).toBe('v-2');
  });
});
