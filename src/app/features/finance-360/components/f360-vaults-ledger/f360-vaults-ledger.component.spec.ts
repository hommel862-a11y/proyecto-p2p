import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { F360VaultsLedgerComponent } from './f360-vaults-ledger.component';
import type {
  AssetVault,
  F360LedgerDeletePayload,
  F360LedgerEditPayload,
  F360LedgerRowItem,
  F360VaultBalanceEditPayload,
  F360VaultReconcilePayload,
  F360VesExposureView,
  VaultReconciliationRecord,
} from '../../f360-ui.models';

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('F360VaultsLedgerComponent', () => {
  let fixture: ComponentFixture<F360VaultsLedgerComponent>;
  let component: F360VaultsLedgerComponent;

  const sampleVaults: AssetVault[] = [
    {
      id: 'v-usd',
      name: 'Zelle Personal',
      channel: 'zelle',
      scope: 'personal',
      currency: 'USD',
      balance: 1200,
      balanceUsdEquivalent: 1200,
      balanceVesEquivalent: 77400,
      updatedAt: '2026-11-18T12:00:00Z',
    },
    {
      id: 'v-usdt',
      name: 'Binance Cold',
      channel: 'crypto',
      scope: 'all',
      currency: 'USDT',
      balance: 800,
      balanceUsdEquivalent: 800,
      balanceVesEquivalent: 51600,
      updatedAt: '2026-11-18T12:00:00Z',
    },
    {
      id: 'v-ves',
      name: 'Banesco Operativo',
      channel: 'bs_bank',
      scope: 'business',
      currency: 'VES',
      balance: 32250,
      balanceUsdEquivalent: 500,
      balanceVesEquivalent: 32250,
      updatedAt: '2026-11-18T12:00:00Z',
    },
    {
      id: 'v-eur',
      name: 'Caja Euros',
      channel: 'cash',
      scope: 'personal',
      currency: 'EUR',
      balance: 300,
      balanceUsdEquivalent: 324,
      balanceVesEquivalent: 20898,
      updatedAt: '2026-11-18T12:00:00Z',
    },
  ];

  const makeRows = (count: number): F360LedgerRowItem[] =>
    Array.from({ length: count }, (_, idx) => {
      const kind = idx % 3 === 0 ? 'income' : idx % 3 === 1 ? 'expense' : 'transfer';
      return {
        id: `row-${idx + 1}`,
        kind,
        title: `Movimiento #${idx + 1}`,
        scope: idx % 2 === 0 ? 'personal' : 'business',
        categoryLabel: kind === 'transfer' ? 'Transferencia FX' : 'Operativo',
        vaultName: kind === 'transfer' ? 'Zelle Personal → Banesco' : 'Zelle Personal',
        vaultId: 'v-usd',
        bcvRateApplied: 64.5,
        referenceNumber: `REF-${1000 + idx}`,
        amountUsd: 50 + idx,
        amountVes: (50 + idx) * 64.5,
        date: `2026-11-${String(28 - (idx % 20)).padStart(2, '0')}`,
        createdAt: `2026-11-18T10:${String(idx % 60).padStart(2, '0')}:00Z`,
        editable: kind !== 'transfer',
      };
    });

  const sampleExposure: F360VesExposureView = {
    vesBalanceTotal: 32250,
    vesEquivalentUsd: 500,
    exposurePct: 17.7,
    rateGapPct: 14.2,
    erosionLoss5PctUsd: 23.8,
    isHighExposure: false,
  };

  const sampleReconciliations: VaultReconciliationRecord[] = [
    {
      id: 'rec-1',
      vaultId: 'v-usd',
      vaultName: 'Zelle Personal',
      currency: 'USD',
      expectedBalance: 1180,
      actualBalance: 1200,
      deltaInCurrency: 20,
      deltaUsd: 20,
      bcvRateApplied: 64.5,
      date: '2026-11-17',
      createdAt: '2026-11-17T18:00:00Z',
    },
  ];

  const setup = (
    overrides: Partial<{
      assets: AssetVault[];
      totalAssetsUsd: number;
      bcvRate: number;
      parallelRate: number;
      eurUsdRate: number;
      vesExposure: F360VesExposureView;
      ledgerRows: F360LedgerRowItem[];
      reconciliations: VaultReconciliationRecord[];
      privacyMode: boolean;
    }> = {},
  ) => {
    TestBed.configureTestingModule({
      imports: [F360VaultsLedgerComponent],
    });

    fixture = TestBed.createComponent(F360VaultsLedgerComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('assets', overrides.assets ?? sampleVaults);
    fixture.componentRef.setInput('totalAssetsUsd', overrides.totalAssetsUsd ?? 2824);
    fixture.componentRef.setInput('bcvRate', overrides.bcvRate ?? 64.5);
    fixture.componentRef.setInput('parallelRate', overrides.parallelRate ?? 73.66);
    fixture.componentRef.setInput('eurUsdRate', overrides.eurUsdRate ?? 1.08);
    fixture.componentRef.setInput('vesExposure', overrides.vesExposure ?? sampleExposure);
    fixture.componentRef.setInput('ledgerRows', overrides.ledgerRows ?? makeRows(22));
    fixture.componentRef.setInput(
      'reconciliations',
      overrides.reconciliations ?? sampleReconciliations,
    );
    fixture.componentRef.setInput('privacyMode', overrides.privacyMode ?? false);

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders Zero-Seed empty state prompting + Crear primera bóveda when assets is empty', () => {
    const { fixture, component } = setup({ assets: [], totalAssetsUsd: 0 });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="vaults-zero-seed-empty"]')).toBeTruthy();
    expect(host.textContent).toContain('Crear primera bóveda');

    let newVaultClicks = 0;
    component.openNewVault.subscribe(() => newVaultClicks++);
    (host.querySelector('[data-testid="zero-seed-create-vault-btn"]') as HTMLButtonElement).click();
    expect(newVaultClicks).toBe(1);
  });

  it('renders tri-monetary vaults with live BCV equivalents, contextual menu actions, inline balance edit, and zero emojis', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('[data-testid^="vault-card-"]').length).toBe(4);
    expect(host.textContent ?? '').not.toMatch(EMOJI_PATTERN);

    // Delete action must stay inside contextual menu
    expect(host.querySelector('[data-testid="vault-action-delete-v-usd"]')).toBeNull();

    const transfers: (string | undefined)[] = [];
    const balanceEdits: F360VaultBalanceEditPayload[] = [];
    const deletes: string[] = [];
    component.openTransfer.subscribe((id) => transfers.push(id));
    component.updateVaultBalance.subscribe((p) => balanceEdits.push(p));
    component.deleteVault.subscribe((id) => deletes.push(id));

    const menuTrigger = host.querySelector('[data-testid="vault-menu-v-usd"]') as HTMLButtonElement;
    menuTrigger.click();
    fixture.detectChanges();

    (host.querySelector('[data-testid="vault-action-transfer-v-usd"]') as HTMLButtonElement).click();
    expect(transfers).toEqual(['v-usd']);

    menuTrigger.click();
    fixture.detectChanges();
    (host.querySelector('[data-testid="vault-action-edit-v-usd"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const balanceInput = host.querySelector(
      '[data-testid="vault-balance-input-v-usd"]',
    ) as HTMLInputElement;
    balanceInput.value = '1350.5';
    balanceInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (host.querySelector('[data-testid="vault-balance-save-v-usd"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(balanceEdits).toEqual([{ vaultId: 'v-usd', balance: 1350.5 }]);

    menuTrigger.click();
    fixture.detectChanges();
    (host.querySelector('[data-testid="vault-action-delete-v-usd"]') as HTMLButtonElement).click();
    expect(deletes).toEqual(['v-usd']);
  });

  it('paginates the double-entry ledger at 15 rows per page without truncating at 18 and filters by type/search', () => {
    const { fixture } = setup({ ledgerRows: makeRows(22) });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('[data-testid^="ledger-row-"]').length).toBe(15);
    expect(host.querySelector('[data-testid="ledger-page-indicator"]')?.textContent).toContain(
      '1 / 2',
    );

    const nextBtn = host.querySelector('[data-testid="ledger-next-page"]') as HTMLButtonElement;
    nextBtn.click();
    fixture.detectChanges();

    expect(host.querySelectorAll('[data-testid^="ledger-row-"]').length).toBe(7);
    expect(host.querySelector('[data-testid="ledger-page-indicator"]')?.textContent).toContain(
      '2 / 2',
    );

    // Filter to transfers only (indices 2,5,8,11,14,17,20 -> 7 items) resets to page 1
    const transferPill = host.querySelector(
      '[data-testid="ledger-filter-transfer"]',
    ) as HTMLButtonElement;
    transferPill.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('[data-testid^="ledger-row-"]').length).toBe(7);

    // Search narrows further
    const searchInput = host.querySelector('#f360-ledger-search') as HTMLInputElement;
    searchInput.value = 'REF-1002';
    searchInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.querySelectorAll('[data-testid^="ledger-row-"]').length).toBe(1);
  });

  it('supports inline movement edit and delete via row contextual menu', () => {
    const { fixture, component } = setup({ ledgerRows: makeRows(4) });
    const host = fixture.nativeElement as HTMLElement;

    const edits: F360LedgerEditPayload[] = [];
    const deletes: F360LedgerDeletePayload[] = [];
    component.updateMovement.subscribe((e) => edits.push(e));
    component.deleteMovement.subscribe((d) => deletes.push(d));

    const menuBtn = host.querySelector('[data-testid="ledger-menu-row-1"]') as HTMLButtonElement;
    menuBtn.click();
    fixture.detectChanges();

    (host.querySelector('[data-testid="ledger-edit-row-1"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const titleInput = host.querySelector(
      '[data-testid="ledger-edit-title-row-1"]',
    ) as HTMLInputElement;
    const amountInput = host.querySelector(
      '[data-testid="ledger-edit-amount-row-1"]',
    ) as HTMLInputElement;
    titleInput.value = 'Venta Corregida';
    titleInput.dispatchEvent(new Event('input'));
    amountInput.value = '88.25';
    amountInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (host.querySelector('[data-testid="ledger-edit-save-row-1"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(edits).toEqual([
      { id: 'row-1', type: 'income', title: 'Venta Corregida', amountUsd: 88.25 },
    ]);

    const menuBtnAfterSave = host.querySelector(
      '[data-testid="ledger-menu-row-1"]',
    ) as HTMLButtonElement;
    menuBtnAfterSave.click();
    fixture.detectChanges();
    (host.querySelector('[data-testid="ledger-delete-row-1"]') as HTMLButtonElement).click();
    expect(deletes).toEqual([{ id: 'row-1', type: 'income' }]);
  });

  it('previews live Arqueo delta (Cuadrado vs discrepancy), emits reconcileVault, and renders reconciliation history', () => {
    const { fixture, component } = setup({ privacyMode: true });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('privacy-active')).toBe(true);
    expect(host.querySelector('.f360-liquid-glass.reconcile-inspector')).toBeTruthy();

    const reconciled: F360VaultReconcilePayload[] = [];
    component.reconcileVault.subscribe((payload) => reconciled.push(payload));

    const actualInput = host.querySelector('#f360-reconcile-actual') as HTMLInputElement;
    // Matches v-usd balance 1200 -> Cuadrado
    actualInput.value = '1200';
    actualInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="reconcile-delta-badge"]')?.textContent).toContain(
      'Cuadrado',
    );

    // Discrepancy (+45)
    actualInput.value = '1245';
    actualInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="reconcile-delta-badge"]')?.textContent).toContain(
      '45',
    );

    const submitBtn = host.querySelector('[data-testid="reconcile-submit-btn"]') as HTMLButtonElement;
    submitBtn.click();
    expect(reconciled).toEqual([{ vaultId: 'v-usd', actualBalance: 1245 }]);

    expect(host.querySelectorAll('[data-testid^="reconcile-history-"]').length).toBe(1);
  });
});
