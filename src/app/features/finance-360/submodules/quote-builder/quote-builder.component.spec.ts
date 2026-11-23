import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QuoteBuilderComponent } from './quote-builder.component';
import { Finance360Service } from '../../../../core/finance-360.service';
import { IndexedDbStorageService } from '../../../../core/indexed-db-storage.service';
import { AccountsService } from '../../../../core/accounts.service';
import { CotizaveService } from '../../../../core/cotizave.service';
import { ToastService } from '../../../../core/toast.service';
import { roundMoney } from '../../../../core/models/finance-360.models';
import type { CotizaveRate } from '@p2p/core';

describe('QuoteBuilderComponent (Institutional Multi-Industry Prorated PDF & Automation)', () => {
  let fixture: ComponentFixture<QuoteBuilderComponent>;
  let component: QuoteBuilderComponent;
  let financeService: Finance360Service;
  let toastService: ToastService;
  let ratesSignal: WritableSignal<Record<string, CotizaveRate>>;
  let storageMap: Map<string, unknown>;

  function setup(initialRates?: Record<string, CotizaveRate>): void {
    TestBed.resetTestingModule();
    storageMap = new Map<string, unknown>();
    ratesSignal = signal<Record<string, CotizaveRate>>(
      initialRates ?? {
        oficial: { market: 'bcv', type: 'reference', mid: 60.0 },
        parallel: { market: 'parallel', type: 'parallel', mid: 72.0 },
      },
    );

    TestBed.configureTestingModule({
      imports: [QuoteBuilderComponent],
      providers: [
        Finance360Service,
        ToastService,
        {
          provide: IndexedDbStorageService,
          useValue: {
            get: vi.fn(<T>(key: string): T | null => (storageMap.get(key) as T) ?? null),
            set: vi.fn((key: string, val: unknown) => {
              storageMap.set(key, val);
            }),
            remove: vi.fn((key: string) => {
              storageMap.delete(key);
            }),
          },
        },
        {
          provide: AccountsService,
          useValue: {
            todayOperations: vi.fn().mockReturnValue([]),
            accounts: vi.fn().mockReturnValue([]),
          },
        },
        {
          provide: CotizaveService,
          useValue: { ratesByMarket: ratesSignal },
        },
      ],
    });

    financeService = TestBed.inject(Finance360Service);
    toastService = TestBed.inject(ToastService);
    vi.spyOn(toastService, 'success');
    vi.spyOn(toastService, 'warn');
    vi.spyOn(toastService, 'info');

    fixture = TestBed.createComponent(QuoteBuilderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads and updates configurable pymeProfile with zero hardcoded HOMEL 360 SERVICES or J-40812345-0', () => {
    component.toggleProfileEditor();
    component.profileBusinessName.set('Taller Andino C.A.');
    component.profileTaxIdRif.set('J-50199887-4');
    component.profilePhone.set('0424-9001122');
    component.profileAddress.set('Av. Libertador, Caracas');
    component.profileDefaultIva.set(16);
    component.profileDefaultIgtf.set(3);
    component.saveBusinessProfile();
    fixture.detectChanges();

    expect(financeService.pymeProfile().businessName).toBe('Taller Andino C.A.');
    expect(financeService.pymeProfile().rif).toBe('J-50199887-4');

    component.openPreview('client');
    fixture.detectChanges();

    const previewText = fixture.nativeElement.textContent as string;
    expect(previewText).toContain('Taller Andino C.A.');
    expect(previewText).toContain('J-50199887-4');
    expect(previewText).not.toContain('HOMEL 360 SERVICES');
    expect(previewText).not.toContain('J-40812345-0');
  });

  it('prorates Client PDF lines so their exact cent sum equals totalUsd with IVA/IGTF/waste/margin/discount', () => {
    component.lineItems.set([
      { id: 'l-1', category: 'material', name: 'Pintura Bicapa', quantity: 3, unit: 'unid', unitCostUsd: 33.33 },
      { id: 'l-2', category: 'labor', name: 'Latonería', quantity: 2, unit: 'jornadas', unitCostUsd: 45.5 },
      { id: 'l-3', category: 'logistics', name: 'Traslado Grúa', quantity: 1, unit: 'viaje', unitCostUsd: 27.1 },
    ]);
    component.technicalWastePercent.set(10);
    component.profitMarginPercent.set(27);
    component.discountPercent.set(7);
    component.applyIva.set(true);
    component.ivaPercent.set(16);
    component.applyIgtf.set(true);
    component.igtfPercent.set(3);
    fixture.detectChanges();

    const prorated = component.proratedQuote();
    const rowSum = roundMoney(
      prorated.lines.reduce((acc, line) => acc + line.proratedTotalUsd, 0),
    );
    expect(rowSum).toBe(prorated.totalUsd);
    expect(prorated.ivaUsd).toBeGreaterThan(0);
    expect(prorated.igtfUsd).toBeGreaterThan(0);

    // Client preview must render prorated totals, not raw internal cost
    component.openPreview('client');
    fixture.detectChanges();
    const sheetText = (fixture.nativeElement.querySelector('.quote-print-sheet') as HTMLElement)
      .textContent as string;
    expect(sheetText).toContain(prorated.lines[0].proratedTotalUsd.toFixed(2));
    expect(sheetText).toContain(prorated.totalUsd.toFixed(2));
  });

  it('supports jornadas unit, immutable item updates, dual laborType engine, and below-cost discount warning', () => {
    expect(component.unitOptions).toContain('jornadas');

    // Immutable name update does not mutate previous object reference
    const beforeItems = component.lineItems();
    const firstBefore = beforeItems[0];
    component.updateItemName(firstBefore, 'Barniz Ultra HS');
    expect(firstBefore.name).not.toBe('Barniz Ultra HS');
    expect(component.lineItems()[0].name).toBe('Barniz Ultra HS');

    // Dual labor engine: commission 25% over raw materials ($100) -> $25 labor
    component.lineItems.set([
      { id: 'm-1', category: 'material', name: 'Material Base', quantity: 2, unit: 'unid', unitCostUsd: 50 },
    ]);
    component.laborType.set('commission');
    component.laborRateValue.set(25);
    fixture.detectChanges();
    expect(component.proratedQuote().totalLaborUsd).toBe(25);

    // Dual labor engine: m2_rate (30 m² × $8/m²) -> $240 labor
    component.laborType.set('m2_rate');
    component.laborUnits.set(30);
    component.laborRateValue.set(8);
    fixture.detectChanges();
    expect(component.proratedQuote().totalLaborUsd).toBe(240);

    // Below-cost discount warning when totalUsd < subtotalCostUsd
    component.profitMarginPercent.set(10);
    component.discountPercent.set(40);
    component.applyIva.set(false);
    component.applyIgtf.set(false);
    fixture.detectChanges();
    expect(component.isBelowCost()).toBe(true);
    expect(fixture.nativeElement.querySelector('.below-cost-alert')).toBeTruthy();
  });

  it('preserves 0% advance cleanly without 50% fallback and freezes bcvRateApplied in WhatsApp summary', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    });

    component.clientName.set('Inversiones Norte');
    component.advancePercent.set(0);
    fixture.detectChanges();

    expect(component.currentQuoteTotals().advancePct).toBe(0);
    expect(component.currentQuoteTotals().advanceUsd).toBe(0);
    expect(component.costCoveringAdvanceUsd()).toBe(component.proratedQuote().subtotalCostUsd);

    component.saveCurrentQuote();
    const saved = financeService.state().quotes[0];
    expect(saved.advancePercent).toBe(0);
    expect(saved.minimumAdvanceUsd).toBe(0);
    expect(saved.bcvRateApplied).toBe(60);

    // Live BCV jumps to 95 after quote was issued -> WhatsApp for saved quote MUST use frozen rate 60
    ratesSignal.set({
      oficial: { market: 'bcv', type: 'reference', mid: 95.0 },
      parallel: { market: 'parallel', type: 'parallel', mid: 110.0 },
    });
    fixture.detectChanges();

    await component.copyQuoteForWhatsApp(saved);
    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    const copied = writeTextSpy.mock.calls[0][0] as string;
    expect(copied).toContain('60.00');
    expect(copied).not.toContain('95.00');
    expect(copied).toContain('0%');
    expect(copied).toContain('$0.00 USD');
  });

  it('reopens saved quote into builder and triggers approveQuoteAndTriggerAutomations with selected real vault', () => {
    const bizVault = financeService.addAssetVault({
      name: 'Banesco Negocio USD',
      channel: 'zelle',
      scope: 'business',
      currency: 'USD',
      balance: 200,
      balanceUsdEquivalent: 200,
      balanceVesEquivalent: 12000,
    });
    financeService.addInventoryItem({
      name: 'Insumos de Pintura 2K',
      sku: 'PINT-2K',
      category: 'Pintura',
      currentStock: 10,
      minimumStock: 2,
      optimalStock: 10,
      unitCostUsd: 35,
      sellingPriceUsd: 55,
    });

    component.clientName.set('Cliente Automatizado');
    component.projectTitle.set('Pintura Puerta Derecha');
    component.lineItems.set([
      { id: 'mat-1', category: 'material', name: 'Insumos de Pintura 2K', quantity: 2, unit: 'unid', unitCostUsd: 35 },
      { id: 'lab-1', category: 'labor', name: 'Pintor Especialista', quantity: 1, unit: 'jornadas', unitCostUsd: 60 },
    ]);
    component.laborType.set('project_fixed');
    component.advancePercent.set(50);
    component.saveCurrentQuote();

    const saved = financeService.state().quotes[0];

    // Mutate builder and then reopen saved quote -> restores exact state
    component.clientName.set('Otro Cliente');
    component.advancePercent.set(10);
    component.reopenSavedQuote(saved);
    fixture.detectChanges();
    expect(component.clientName()).toBe('Cliente Automatizado');
    expect(component.advancePercent()).toBe(50);
    expect(component.editingQuoteId()).toBe(saved.id);

    // Approve & Automate with real vault picker
    component.selectedSettlementVaultId.set(bizVault.id);
    component.approveAndAutomateQuote(saved);
    fixture.detectChanges();

    const approved = financeService.state().quotes.find((q) => q.id === saved.id)!;
    expect(approved.status).toBe('approved');
    expect(approved.advanceIncomeId).toBeDefined();
    expect(approved.payrollLiabilityId).toBeDefined();
    expect(financeService.state().inventory[0].currentStock).toBe(8);
    expect(financeService.state().assets.find((v) => v.id === bizVault.id)!.balance).toBeGreaterThan(200);
  });

  it('routes PDF export through window.electron.finance360.exportPdf when running in Electron', async () => {
    const exportPdfMock = vi.fn().mockResolvedValue({
      ok: true,
      base64: btoa('%PDF-1.4 mock'),
      filename: 'presupuesto-test.pdf',
    });
    const originalElectron = (window as unknown as Record<string, unknown>)['electron'];
    (window as unknown as Record<string, unknown>)['electron'] = {
      finance360: { exportPdf: exportPdfMock },
    };

    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-pdf');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    try {
      component.openPreview('client');
      await component.exportQuotePdf();

      expect(exportPdfMock).toHaveBeenCalledTimes(1);
      const callArg = exportPdfMock.mock.calls[0][0] as { html: string; filename: string };
      expect(callArg.html).toContain('<!DOCTYPE html>');
      expect(callArg.filename).toMatch(/\.pdf$/);
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalled();
    } finally {
      (window as unknown as Record<string, unknown>)['electron'] = originalElectron;
    }
  });
});
