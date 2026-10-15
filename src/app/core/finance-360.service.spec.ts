import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Finance360Service, FINANCE_360_STORAGE_KEY } from './finance-360.service';
import { IndexedDbStorageService } from './indexed-db-storage.service';
import { AccountsService } from './accounts.service';
import { CotizaveService } from './cotizave.service';
import type { Operation } from '@p2p/core';

describe('Finance360Service (Isolation & Tri-monetary Ledger)', () => {
  let service: Finance360Service;
  let storageMap: Map<string, unknown>;
  let mockStorage: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let mockAccounts: {
    todayOperations: ReturnType<typeof vi.fn>;
    accounts: ReturnType<typeof vi.fn>;
  };
  let mockCotizave: {
    ratesByMarket: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    storageMap = new Map<string, unknown>();

    mockStorage = {
      get: vi.fn(<T>(key: string): T | null => {
        return (storageMap.get(key) as T) ?? null;
      }),
      set: vi.fn((key: string, val: unknown) => {
        storageMap.set(key, val);
      }),
      remove: vi.fn((key: string) => {
        storageMap.delete(key);
      }),
    };

    mockAccounts = {
      todayOperations: vi.fn().mockReturnValue([]),
      accounts: vi.fn().mockReturnValue([]),
    };

    mockCotizave = {
      ratesByMarket: vi.fn().mockReturnValue({
        oficial: { market: 'bcv', type: 'reference', mid: 60.0 },
        parallel: { market: 'parallel', type: 'parallel', mid: 70.0 },
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        Finance360Service,
        { provide: IndexedDbStorageService, useValue: mockStorage },
        { provide: AccountsService, useValue: mockAccounts },
        { provide: CotizaveService, useValue: mockCotizave },
      ],
    });

    service = TestBed.inject(Finance360Service);
  });

  it('should initialize with default vaults and store them in isolated key', () => {
    expect(service).toBeTruthy();
    expect(mockStorage.set).toHaveBeenCalledWith(
      FINANCE_360_STORAGE_KEY,
      expect.objectContaining({
        version: 1,
      }),
    );
    expect(service.assets().length).toBeGreaterThan(0);
  });

  it('should calculate tri-monetary net worth properly based on BCV rate', () => {
    // Default assets: Zelle ($500), Cash ($300), Pyme ($450) = $1250 USD
    // Banesco (4500 VES / 60 = $75 USD) -> Total Assets = $1325 USD
    const totalAssets = service.totalAssetsUsd();
    expect(totalAssets).toBe(1325);
    expect(service.totalLiabilitiesUsd()).toBe(0);
    expect(service.netWorthUsd()).toBe(1325);
    expect(service.netWorthVes()).toBe(1325 * 60);
  });

  describe('Golden Rule: P2P Mesa Isolation & Unidirectional Bridge', () => {
    it('should NOT import profit if today operations have zero or negative PnL', () => {
      mockAccounts.todayOperations.mockReturnValue([]);

      const result = service.importDailyP2pProfit('personal');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('NO_POSITIVE_PROFIT');
      expect(service.incomes().length).toBe(0);
    });

    it('should import strictly positive realized profit as a clean income entry without touching p2p.operations', () => {
      const mockBuy: Operation = {
        id: 'op-1',
        timestamp: new Date().toISOString(),
        type: 'buy',
        pair: 'USDT',
        vesAmount: 60000,
        usdtAmount: 1000,
        price: 60,
        merchantNote: 'counterparty 1',
        fees: 0,
        bankAccountId: 'b-1',
        errorFree: true,
        notes: '',
      };

      const mockSell: Operation = {
        id: 'op-2',
        timestamp: new Date().toISOString(),
        type: 'sell',
        pair: 'USDT',
        vesAmount: 63000,
        usdtAmount: 1000,
        price: 63,
        merchantNote: 'counterparty 2',
        fees: 0,
        bankAccountId: 'b-1',
        errorFree: true,
        notes: '',
      };

      mockAccounts.todayOperations.mockReturnValue([mockBuy, mockSell]);

      const result = service.importDailyP2pProfit('personal', 60.0);
      expect(result.success).toBe(true);
      expect(result.profitVes).toBe(3000); // 63000 - 60000 = 3000 VES
      expect(result.profitUsd).toBe(47.62); // 3000 VES / 63 sell price = 47.62 USD

      const incomes = service.incomes();
      expect(incomes.length).toBe(1);
      expect(incomes[0].category).toBe('p2p_profit');
      expect(incomes[0].triMonetary.amount_usd).toBe(50);
      expect(incomes[0].p2pBridgeMetadata?.realizedPnlVes).toBe(3000);
      expect(incomes[0].p2pBridgeMetadata?.operationsCount).toBe(2);

      // Verify that p2p.operations was never touched or written to
      expect(mockStorage.set).not.toHaveBeenCalledWith('p2p.operations', expect.anything());
    });
  });

  describe('Cashea Engine & 14-Day Calendar', () => {
    it('should calculate initial payment and installments by Cashea level', () => {
      // Level 3 = 40% initial. $100 total -> $40 initial, $60 financed in 3 installments of $20
      const schedule = service.calculateCasheaSchedule(100, 3, 3);
      expect(schedule.initialPercentage).toBe(0.4);
      expect(schedule.initialPaymentUsd).toBe(40);
      expect(schedule.installmentAmountUsd).toBe(20);
      expect(schedule.installments.length).toBe(3);
    });

    it('should register a Cashea plan, generate matching liabilities, and mark installment paid', () => {
      const schedule = service.calculateCasheaSchedule(200, 3, 3);
      const plan = service.addCasheaPlan({
        productName: 'Smart TV 43"',
        storeName: 'Daka',
        totalPriceUsd: 200,
        initialPaymentUsd: schedule.initialPaymentUsd,
        initialPercentage: schedule.initialPercentage,
        numberOfInstallments: 3,
        installmentAmountUsd: schedule.installmentAmountUsd,
        installmentFrequencyDays: 14,
        startDate: new Date().toISOString().split('T')[0],
        installments: schedule.installments,
        status: 'active',
      });

      expect(plan.id).toBeDefined();
      expect(service.state().casheaPlans.length).toBe(1);

      // 3 matching liabilities created
      const casheaLiabs = service.liabilities().filter((l) => l.category === 'cashea');
      expect(casheaLiabs.length).toBe(3);

      // Mark first installment as paid
      service.markCasheaInstallmentPaid(plan.id, 1, 'PAGOMOVIL-9988');

      const updatedPlan = service.state().casheaPlans[0];
      expect(updatedPlan.installments[0].status).toBe('paid');
      expect(updatedPlan.installments[0].paymentReference).toBe('PAGOMOVIL-9988');

      const updatedLiab = service.liabilities().find(
        (l) => l.id === `liab-cashea-${plan.id}-1`,
      );
      expect(updatedLiab?.status).toBe('paid');
      expect(updatedLiab?.remainingAmount).toBe(0);
    });
  });

  describe('Pyme & Quotes', () => {
    it('should register providers, inventory items, and quotes', () => {
      const prov = service.addProvider({
        name: 'Distribuidora Automotriz Caracas',
        category: 'Pintura y Repuestos',
        phone: '0414-1112233',
        bankDetails: 'Banesco 0134-xxx',
        outstandingDebtUsd: 150,
      });
      expect(prov.id).toBeDefined();
      expect(service.state().providers.length).toBe(1);

      const inv = service.addInventoryItem({
        name: 'Transparente Poliuretano 2:1',
        category: 'Pintura',
        currentStock: 5,
        minimumStock: 2,
        optimalStock: 10,
        unitCostUsd: 22,
        sellingPriceUsd: 35,
      });
      expect(inv.status).toBe('optimal');

      const quote = service.addQuote({
        quoteNumber: 'COT-001',
        clientName: 'Carlos Mendoza',
        type: 'automotive_bodywork',
        description: 'Pintura y latonería de capot y parachoque',
        scopeDetails: { panels: 2, paintType: 'Bicapa' },
        materials: [
          {
            name: 'Pintura Bicapa',
            quantity: 1,
            unit: 'cuarto',
            unitCostUsd: 25,
            wasteFactorPercent: 10,
            totalCostUsd: 27.5,
          },
        ],
        laborCostUsd: 80,
        laborType: 'commission',
        totalMaterialsCostUsd: 27.5,
        subtotalCostUsd: 107.5,
        profitMarginPercent: 30,
        totalPriceUsd: 139.75,
        minimumAdvanceUsd: 67.5, // 100% materials + 50% labor
        bcvRateApplied: 60,
        totalPriceVes: 139.75 * 60,
        status: 'draft',
      });
      expect(quote.id).toBeDefined();
      expect(service.state().quotes.length).toBe(1);
    });
  });
});
