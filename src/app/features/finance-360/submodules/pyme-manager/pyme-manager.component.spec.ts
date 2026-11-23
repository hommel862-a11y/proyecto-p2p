import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PymeManagerComponent } from './pyme-manager.component';
import { Finance360Service } from '../../../../core/finance-360.service';
import { IndexedDbStorageService } from '../../../../core/indexed-db-storage.service';
import { AccountsService } from '../../../../core/accounts.service';
import { CotizaveService } from '../../../../core/cotizave.service';
import { ToastService } from '../../../../core/toast.service';
import {
  addCalendarDays,
  computeTriMonetaryAmount,
  todayVetIso,
} from '../../../../core/models/finance-360.models';
import type { CotizaveRate } from '@p2p/core';

describe('PymeManagerComponent (Institutional 3-Drawers, CxP, Inventory, Recurring & Opt-In Cashea Ally)', () => {
  let fixture: ComponentFixture<PymeManagerComponent>;
  let component: PymeManagerComponent;
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
        parallel: { market: 'parallel', type: 'parallel', mid: 78.0 },
      },
    );

    TestBed.configureTestingModule({
      imports: [PymeManagerComponent],
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

    fixture = TestBed.createComponent(PymeManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides Cashea Aliado tab by default and reveals it only when opt-in toggle is enabled', () => {
    const initialTabs = fixture.nativeElement.querySelectorAll('[role="tab"]') as NodeListOf<HTMLButtonElement>;
    expect(initialTabs.length).toBe(4);
    expect(fixture.nativeElement.textContent as string).not.toContain('Cashea Aliado');

    // Enable Cashea Ally opt-in
    component.toggleCasheaAllyMode(true);
    fixture.detectChanges();

    expect(financeService.pymeProfile().casheaAllyModeEnabled).toBe(true);
    const expandedTabs = fixture.nativeElement.querySelectorAll('[role="tab"]') as NodeListOf<HTMLButtonElement>;
    expect(expandedTabs.length).toBe(5);
    expect(expandedTabs[4].textContent).toContain('Cashea Aliado');

    // Activate 5th tab, then disable opt-in -> safely falls back to drawers
    component.selectTab('cashea_ally');
    fixture.detectChanges();
    expect(component.activePymeTab()).toBe('cashea_ally');

    component.toggleCasheaAllyMode(false);
    fixture.detectChanges();
    expect(component.activePymeTab()).toBe('drawers');
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]').length).toBe(4);
  });

  it('displays real negative drawer overdrafts without clamping to $0, fixes payrollPeriod default, and maps audit badges via getDrawerForExpenseCategory', () => {
    // Zero vaults initially: must never default to ghost 'vault-pyme-caja'
    expect(component.targetVaultId()).toBe('');
    expect(component.payrollPeriod()).toBe('Quincena 1');

    const bizVault = financeService.addAssetVault({
      name: 'Caja Taller USD',
      channel: 'cash',
      scope: 'business',
      currency: 'USD',
      openingBalance: 0,
      balance: 300,
      balanceUsdEquivalent: 300,
      balanceVesEquivalent: 18000,
    });
    fixture.detectChanges();
    expect(component.targetVaultId()).toBe(bizVault.id);

    // Record a $100 sale (50/30/20 -> $50 D1, $30 D2, $20 D3)
    component.saleConcept.set('Servicio Pintura General');
    component.saleAmount.set(100);
    component.settleSaleInLedger();

    // Pay $120 payroll from Drawer 2 -> creates real -$90.00 overdraft
    component.payrollEmployeeName.set('Luis Medina');
    component.payrollAmountUsd.set(120);
    component.confirmPayrollDisbursement();

    // Also add rent & equipment_capex expenses without explicit drawerAllocation
    financeService.addExpense({
      title: 'Alquiler Galpón',
      scope: 'business',
      category: 'rent',
      channel: 'cash',
      vaultId: bizVault.id,
      triMonetary: computeTriMonetaryAmount(40, 'USD', 60, 78),
      date: todayVetIso(),
    });
    financeService.addExpense({
      title: 'Compresor Industrial',
      scope: 'business',
      category: 'equipment_capex',
      channel: 'cash',
      vaultId: bizVault.id,
      triMonetary: computeTriMonetaryAmount(15, 'USD', 60, 78),
      date: todayVetIso(),
    });
    fixture.detectChanges();

    const telemetry = financeService.pymeDrawersTelemetry();
    expect(telemetry.drawer2AvailableUsd).toBe(-130);
    expect(telemetry.hasOverdraft).toBe(true);

    const htmlText = fixture.nativeElement.textContent as string;
    expect(htmlText).toContain('-$130.00');
    expect(fixture.nativeElement.querySelector('.drawer-card.is-overdraft')).toBeTruthy();

    // Verify audit badges map 'rent' -> Drawer 2 (not Drawer 3 CAPEX)
    const rentExp = financeService.state().expenses.find((e) => e.category === 'rent')!;
    const capexExp = financeService.state().expenses.find((e) => e.category === 'equipment_capex')!;
    expect(component.getDrawerAuditMeta(rentExp).drawerKey).toBe('drawer_operations');
    expect(component.getDrawerAuditMeta(capexExp).drawerKey).toBe('drawer_capex');
  });

  it('reconciles unified CxP provider debt from linked liabilities and supports custom partial payment + full settlement', () => {
    const bizVault = financeService.addAssetVault({
      name: 'Zelle Comercial',
      channel: 'zelle',
      scope: 'business',
      currency: 'USD',
      openingBalance: 0,
      balance: 500,
      balanceUsdEquivalent: 500,
      balanceVesEquivalent: 30000,
    });

    const prov = financeService.addProvider({
      name: 'Pinturas Automotrices C.A.',
      category: 'Pinturas y Solventes',
      phone: '0414-0001122',
      bankDetails: 'Banesco 0134',
      outstandingDebtUsd: 200,
    });

    component.selectTab('providers');
    fixture.detectChanges();

    expect(component.getProviderUnifiedDebtUsd(prov.id)).toBe(200);
    expect(component.totalProviderDebtUsd()).toBe(200);

    // Custom partial payment of $75
    component.setProviderPaymentAmount(prov.id, 75);
    component.submitCustomProviderPayment(prov);
    fixture.detectChanges();

    expect(component.getProviderUnifiedDebtUsd(prov.id)).toBe(125);
    const updatedVaultAfterPartial = financeService.state().assets.find((v) => v.id === bizVault.id)!;
    expect(updatedVaultAfterPartial.balance).toBe(425);

    // Full settlement button ("Liquidar Total")
    component.settleProviderFullDebt(prov);
    fixture.detectChanges();

    expect(component.getProviderUnifiedDebtUsd(prov.id)).toBe(0);
    const linkedLiability = financeService.state().liabilities.find((l) => l.providerId === prov.id)!;
    expect(linkedLiability.status).toBe('paid');
  });

  it('tracks Inventory Semaphore counters, cold merchandise >45d alert, SKU/edit, and explicit provider selection on restock', () => {
    const provA = financeService.addProvider({
      name: 'Proveedor A',
      category: 'Insumos',
      phone: '0412-1111111',
      bankDetails: 'Mercantil',
      outstandingDebtUsd: 0,
    });
    const provB = financeService.addProvider({
      name: 'Proveedor B',
      category: 'Insumos',
      phone: '0412-2222222',
      bankDetails: 'Banesco',
      outstandingDebtUsd: 0,
    });

    const optimalItem = financeService.addInventoryItem({
      name: 'Barniz HS 2K',
      sku: 'BRN-2K',
      category: 'Pintura',
      currentStock: 12,
      minimumStock: 4,
      optimalStock: 15,
      unitCostUsd: 20,
      sellingPriceUsd: 35,
      lastSoldAt: addCalendarDays(todayVetIso(), -60),
    });
    const lowItem = financeService.addInventoryItem({
      name: 'Lija 1500',
      sku: 'LIJ-1500',
      category: 'Abrasivos',
      currentStock: 3,
      minimumStock: 5,
      optimalStock: 12,
      unitCostUsd: 2,
      sellingPriceUsd: 5,
    });
    financeService.addInventoryItem({
      name: 'Thinner Acrílico',
      sku: 'THN-01',
      category: 'Solventes',
      currentStock: 0,
      minimumStock: 3,
      optimalStock: 10,
      unitCostUsd: 10,
      sellingPriceUsd: 18,
    });

    component.selectTab('inventory');
    fixture.detectChanges();

    expect(component.inventoryOptimalCount()).toBe(1);
    expect(component.inventoryLowCount()).toBe(1);
    expect(component.inventoryCriticalCount()).toBe(1);
    expect(component.coldInventoryItems().map((i) => i.id)).toContain(optimalItem.id);
    expect(fixture.nativeElement.textContent as string).toContain('Mercancía Fría');

    // Edit existing item including SKU
    component.openEditItemModal(optimalItem);
    component.itemSku.set('BRN-2K-PRO');
    component.itemPrice.set(42);
    component.saveInventoryItem();
    const edited = financeService.state().inventory.find((i) => i.id === optimalItem.id)!;
    expect(edited.sku).toBe('BRN-2K-PRO');
    expect(edited.sellingPriceUsd).toBe(42);

    // Explicit provider B selection on credit restock (must NOT silently charge provA)
    component.restockProviderId.set(provB.id);
    component.restockItem(lowItem, 'provider_credit', 10);
    fixture.detectChanges();

    expect(component.getProviderUnifiedDebtUsd(provA.id)).toBe(0);
    expect(component.getProviderUnifiedDebtUsd(provB.id)).toBe(20);
  });

  it('creates, toggles, deletes, and materializes due recurring rules', () => {
    const vault = financeService.addAssetVault({
      name: 'Caja Pyme',
      channel: 'cash',
      scope: 'business',
      currency: 'USD',
      balance: 400,
      balanceUsdEquivalent: 400,
      balanceVesEquivalent: 24000,
    });

    component.selectTab('recurring');
    fixture.detectChanges();

    component.recTitle.set('Alquiler Local Comercial');
    component.recType.set('expense');
    component.recCategory.set('rent');
    component.recFrequency.set('monthly');
    component.recCurrency.set('USD');
    component.recAmount.set(150);
    component.recNextDueDate.set(todayVetIso());
    component.recVaultId.set(vault.id);
    component.saveRecurringRule();
    fixture.detectChanges();

    expect(component.recurringRules().length).toBe(1);
    const createdRule = component.recurringRules()[0];

    component.materializeDueRulesNow();
    fixture.detectChanges();

    expect(
      financeService.state().expenses.some((e) => e.title === 'Alquiler Local Comercial'),
    ).toBe(true);

    component.toggleRecurringRule(createdRule.id);
    expect(component.recurringRules()[0].active).toBe(false);

    component.deleteRecurringRule(createdRule.id);
    expect(component.recurringRules().length).toBe(0);
  });

  it('simulates Cashea Aliado net margin with red loss warning, registers ally sale, and settles weekly cut into 3 drawers', () => {
    const vault = financeService.addAssetVault({
      name: 'Cuenta Pyme USD',
      channel: 'zelle',
      scope: 'business',
      currency: 'USD',
      balance: 100,
      balanceUsdEquivalent: 100,
      balanceVesEquivalent: 6000,
    });

    component.toggleCasheaAllyMode(true);
    component.selectTab('cashea_ally');
    fixture.detectChanges();

    // Configure sale at a real loss due to BCV (60) vs Parallel (78) + 4% MDR + 3% weekly advance
    component.allySaleTitle.set('Kit Frenos Cerámicos');
    component.allyGrossSaleUsd.set(100);
    component.allyCostOfGoodsUsd.set(80);
    component.allyMdrPercent.set(4);
    component.allyUseWeeklyAdvance.set(true);
    component.allyWeeklyAdvancePercent.set(3);
    component.allyMonthlyMinimumUsd.set(100);
    component.allyActivationFeeUsd.set(100);
    fixture.detectChanges();

    const sim = component.casheaAllySimulation();
    expect(sim.isSellingAtLoss).toBe(true);
    expect(sim.realNetProfitUsd).toBeLessThan(0);
    expect(sim.monthlyBreakEvenVolumeUsd).toBe(2500);
    expect(fixture.nativeElement.querySelector('.ally-loss-alert')).toBeTruthy();
    expect(fixture.nativeElement.textContent as string).toContain('prohibido');

    // Register & settle sale into real vault -> allocates into 3 Drawers
    component.registerAllySale();
    fixture.detectChanges();
    const pendingSale = financeService.casheaMerchantSales()[0];
    expect(pendingSale).toBeDefined();
    expect(pendingSale.status).toBe('pending_settlement');

    component.casheaSettleVaultId.set(vault.id);
    component.settleAllySale(pendingSale.id);
    fixture.detectChanges();

    const settledSale = financeService.casheaMerchantSales().find((s) => s.id === pendingSale.id)!;
    expect(settledSale.status).toBe('settled');
    expect(financeService.pymeDrawersTelemetry().drawer1AllocatedUsd).toBeGreaterThan(0);
  });

  it('applies privacy-active host class when privacyMode input is true', () => {
    fixture.componentRef.setInput('privacyMode', true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).classList.contains('privacy-active')).toBe(true);
  });
});
