import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { Finance360Service, FINANCE_360_STORAGE_KEY } from './finance-360.service';
import { IndexedDbStorageService } from './indexed-db-storage.service';
import { AccountsService } from './accounts.service';
import { AuditLoggerService } from './audit-logger.service';
import { CotizaveService } from './cotizave.service';
import {
  CASHEA_CLUB_TIERS,
  addCalendarDays,
  calendarDaysBetween,
  computeProratedQuoteLines,
  computeTriMonetaryAmount,
  generateFinanceId,
  getDrawerForExpenseCategory,
  parseCalendarDate,
  roundMoney,
  todayVetIso,
  type ExpenseCategory,
  type Finance360LedgerState,
} from './models/finance-360.models';
import type { CotizaveRate, Operation } from '@p2p/core';

describe('Finance360Service (Institutional Accounting Engine v2)', () => {
  let service: Finance360Service;
  let storageMap: Map<string, unknown>;
  let ratesSignal: WritableSignal<Record<string, CotizaveRate>>;
  let mockStorage: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let mockAccounts: {
    todayOperations: ReturnType<typeof vi.fn>;
    accounts: ReturnType<typeof vi.fn>;
  };

  function createService(initialRates?: Record<string, CotizaveRate>): Finance360Service {
    TestBed.resetTestingModule();
    ratesSignal = signal<Record<string, CotizaveRate>>(
      initialRates ?? {
        oficial: { market: 'bcv', type: 'reference', mid: 60.0 },
        parallel: { market: 'parallel', type: 'parallel', mid: 72.0 },
        eur: { market: 'bcv_eur', type: 'reference', mid: 66.0 },
      },
    );

    TestBed.configureTestingModule({
      providers: [
        Finance360Service,
        { provide: IndexedDbStorageService, useValue: mockStorage },
        { provide: AccountsService, useValue: mockAccounts },
        { provide: CotizaveService, useValue: { ratesByMarket: ratesSignal } },
      ],
    });
    return TestBed.inject(Finance360Service);
  }

  beforeEach(() => {
    storageMap = new Map<string, unknown>();

    mockStorage = {
      get: vi.fn(<T>(key: string): T | null => (storageMap.get(key) as T) ?? null),
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

    service = createService();
  });

  describe('Pure Domain Helpers (VET Clock, Rounding, UUIDs, Tri-Monetary, Quote Proration)', () => {
    it('computes todayVetIso strictly in Venezuela UTC-4 regardless of UTC midnight boundary', () => {
      // 2026-05-10 02:30 UTC is 2026-05-09 22:30 VET (UTC-4)
      expect(todayVetIso(new Date('2026-05-10T02:30:00.000Z'))).toBe('2026-05-09');
      // 2026-05-10 04:00 UTC is 2026-05-10 00:00 VET (UTC-4)
      expect(todayVetIso(new Date('2026-05-10T04:00:00.000Z'))).toBe('2026-05-10');
    });

    it('parses YYYY-MM-DD calendar dates without UTC backward weekday shift and adds calendar days cleanly', () => {
      // 2026-05-11 is a Monday (getDay() === 1)
      const parsed = parseCalendarDate('2026-05-11');
      expect(parsed.getFullYear()).toBe(2026);
      expect(parsed.getMonth()).toBe(4);
      expect(parsed.getDate()).toBe(11);
      expect(parsed.getDay()).toBe(1);

      expect(addCalendarDays('2026-05-11', 14)).toBe('2026-05-25');
      expect(addCalendarDays('2026-02-27', 2)).toBe('2026-03-01');
      expect(calendarDaysBetween('2026-05-11', '2026-05-25')).toBe(14);
      expect(calendarDaysBetween('2026-05-25', '2026-05-11')).toBe(-14);
    });

    it('rounds IEEE-754 edge cases safely and generates collision-free IDs in tight loops', () => {
      expect(roundMoney(0.1 + 0.2)).toBe(0.3);
      expect(roundMoney(1.005)).toBe(1.01);
      expect(roundMoney(-1.005)).toBe(-1.01);
      expect(roundMoney(Number.NaN)).toBe(0);

      const ids = new Set<string>();
      for (let i = 0; i < 200; i++) {
        ids.add(generateFinanceId('exp'));
      }
      expect(ids.size).toBe(200);
    });

    it('never coerces missing BCV rate to 1 and honors explicit eurUsdRate in computeTriMonetaryAmount', () => {
      const noBcvUsd = computeTriMonetaryAmount(100, 'USD', 0, 0);
      expect(noBcvUsd.bcv_rate).toBe(0);
      expect(noBcvUsd.amount_usd).toBe(100);
      expect(noBcvUsd.amount_ves).toBe(0);

      const noBcvVes = computeTriMonetaryAmount(6000, 'VES', 0, 0);
      expect(noBcvVes.bcv_rate).toBe(0);
      expect(noBcvVes.amount_ves).toBe(6000);
      expect(noBcvVes.amount_usd).toBe(0);

      const eurWithLiveRate = computeTriMonetaryAmount(100, 'EUR', 60, 72, 1.15);
      expect(eurWithLiveRate.eur_usd_rate).toBe(1.15);
      expect(eurWithLiveRate.amount_usd).toBe(115);
      expect(eurWithLiveRate.amount_ves).toBe(6900);

      const eurFallback = computeTriMonetaryAmount(100, 'EUR', 60, 72);
      expect(eurFallback.eur_usd_rate).toBe(1.08);
      expect(eurFallback.amount_usd).toBe(108);
    });

    it('prorates Client PDF quote lines so proratedTotalUsd sums EXACTLY to totalUsd with waste, profit, discount, IVA & IGTF', () => {
      const result = computeProratedQuoteLines(
        [
          { id: '1', category: 'material', name: 'Pintura 2K', quantity: 3, unit: 'litro', unitCostUsd: 33.33 },
          { id: '2', category: 'labor', name: 'Latonería', quantity: 1, unit: 'global', unitCostUsd: 111.11 },
          { id: '3', category: 'logistics', name: 'Grúa', quantity: 1, unit: 'viaje', unitCostUsd: 27.77 },
        ],
        10, // waste
        25, // profit
        5, // discount
        16, // IVA
        3, // IGTF
      );

      const summed = roundMoney(result.lines.reduce((acc, l) => acc + l.proratedTotalUsd, 0));
      expect(summed).toBe(result.totalUsd);
      expect(result.ivaUsd).toBeGreaterThan(0);
      expect(result.igtfUsd).toBeGreaterThan(0);
    });
  });

  describe('Zero-Seed Policy, Opt-In Demo, Clear Demo & Reset to Zero', () => {
    it('initializes with ZERO fake vaults and ZERO balances in version 2 ledger', () => {
      expect(service.state().version).toBe(2);
      expect(service.assets()).toEqual([]);
      expect(service.totalAssetsUsd()).toBe(0);
      expect(service.netWorthUsd()).toBe(0);
      expect(mockStorage.set).toHaveBeenCalledWith(
        FINANCE_360_STORAGE_KEY,
        expect.objectContaining({ version: 2, assets: [] }),
      );
    });

    it('seeds demo portfolio strictly opt-in, idempotently, without corrupting real user vaults on clearDemoData', () => {
      const realVault = service.addAssetVault({
        name: 'Mi Banesco Real',
        channel: 'bs_bank',
        scope: 'personal',
        currency: 'VES',
        balance: 6000,
        balanceUsdEquivalent: 100,
        balanceVesEquivalent: 6000,
      });

      service.loadDemoPortfolio();
      const firstMovementCount = service.unifiedMovements().length;
      const firstAssetCount = service.state().assets.length;
      expect(firstMovementCount).toBeGreaterThan(0);
      expect(firstAssetCount).toBeGreaterThan(1);

      // Idempotent second call
      service.seedDemoPortfolio();
      expect(service.unifiedMovements().length).toBe(firstMovementCount);
      expect(service.state().assets.length).toBe(firstAssetCount);

      // Pay a demo Cashea installment (creates exp-cashea-*)
      const demoPlan = service.state().casheaPlans.find((p) => p.id === 'cashea-demo-1');
      expect(demoPlan).toBeDefined();
      service.markCasheaInstallmentPaid('cashea-demo-1', 1, 'DEMO-REF-1');

      // Clear demo artifacts completely while keeping real vault untouched
      service.clearDemoData();
      expect(service.state().assets.map((v) => v.id)).toEqual([realVault.id]);
      expect(service.state().assets[0].balance).toBe(6000);
      expect(service.state().incomes).toEqual([]);
      expect(service.state().expenses).toEqual([]);
      expect(service.state().casheaPlans).toEqual([]);
      expect(service.state().transfers ?? []).toEqual([]);
    });

    it('resets ALL collections including assets on resetLedgerToZero', () => {
      service.addAssetVault({
        name: 'Zelle Propio',
        channel: 'zelle',
        scope: 'personal',
        currency: 'USD',
        balance: 250,
        balanceUsdEquivalent: 250,
        balanceVesEquivalent: 0,
      });
      service.loadDemoPortfolio();
      service.resetLedgerToZero();

      expect(service.state().assets).toEqual([]);
      expect(service.state().incomes).toEqual([]);
      expect(service.state().expenses).toEqual([]);
      expect(service.state().liabilities).toEqual([]);
      expect(service.state().casheaPlans).toEqual([]);
      expect(service.state().transfers ?? []).toEqual([]);
      expect(service.state().goals ?? []).toEqual([]);
      expect(service.state().recurringRules ?? []).toEqual([]);
    });
  });

  describe('Live FX Rates (No Invented Fallbacks) & Reactive Vault Equivalents', () => {
    it('returns 0 and false live flags when Cotizave has no rates', () => {
      const offlineService = createService({});
      expect(offlineService.currentBcvRate()).toBe(0);
      expect(offlineService.isBcvRateLive()).toBe(false);
      expect(offlineService.currentParallelRate()).toBe(0);
      expect(offlineService.isParallelRateLive()).toBe(false);
      expect(offlineService.currentEurUsdRate()).toBe(0);
      expect(offlineService.isEurRateLive()).toBe(false);
    });

    it('derives EUR/USD cross-rate from Cotizave EUR/VES and updates vault equivalents reactively', () => {
      // 66 VES/EUR / 60 VES/USD = 1.10 EUR/USD
      expect(service.currentBcvRate()).toBe(60);
      expect(service.isBcvRateLive()).toBe(true);
      expect(service.currentEurUsdRate()).toBe(1.1);
      expect(service.isEurRateLive()).toBe(true);

      service.addAssetVault({
        name: 'Banesco Bs',
        channel: 'bs_bank',
        scope: 'personal',
        currency: 'VES',
        balance: 6000,
        balanceUsdEquivalent: 0,
        balanceVesEquivalent: 6000,
      });
      service.addAssetVault({
        name: 'Cuenta Euros',
        channel: 'other',
        scope: 'personal',
        currency: 'EUR',
        balance: 100,
        balanceUsdEquivalent: 0,
        balanceVesEquivalent: 0,
      });

      // 6000 VES / 60 = 100 USD; 100 EUR * 1.1 = 110 USD -> total 210 USD
      expect(service.totalAssetsUsd()).toBe(210);

      // Now Cotizave rate moves to BCV = 80, EUR = 88 (ratio 1.1)
      ratesSignal.set({
        oficial: { market: 'bcv', type: 'reference', mid: 80.0 },
        parallel: { market: 'parallel', type: 'parallel', mid: 96.0 },
        eur: { market: 'bcv_eur', type: 'reference', mid: 88.0 },
      });

      // 6000 VES / 80 = 75 USD; 100 EUR * 1.1 = 110 USD -> total 185 USD
      expect(service.totalAssetsUsd()).toBe(185);
      const vesVault = service.assets().find((v) => v.currency === 'VES');
      expect(vesVault?.balanceUsdEquivalent).toBe(75);
    });
  });

  describe('Double-Entry Transfers, Duplicate Ref Guard & Historical FX Integrity', () => {
    it('rejects overdraft on asset vaults, allows credit_line overdraft, handles EUR/VES FX, and records paired TransferEntry', () => {
      const zelle = service.addAssetVault({
        name: 'Zelle',
        channel: 'zelle',
        scope: 'personal',
        currency: 'USD',
        balance: 100,
        balanceUsdEquivalent: 100,
        balanceVesEquivalent: 6000,
      });
      const eurVault = service.addAssetVault({
        name: 'Euro Cash',
        channel: 'cash',
        scope: 'personal',
        currency: 'EUR',
        balance: 0,
        balanceUsdEquivalent: 0,
        balanceVesEquivalent: 0,
      });
      const creditVault = service.addAssetVault({
        name: 'Línea TDC',
        channel: 'other',
        scope: 'personal',
        currency: 'USD',
        vaultKind: 'credit_line',
        balance: 0,
        balanceUsdEquivalent: 0,
        balanceVesEquivalent: 0,
      });

      // Overdraft attempt on regular asset vault MUST fail without fabricating money
      const denied = service.transferBetweenVaults(zelle.id, eurVault.id, 150);
      expect(denied.success).toBe(false);
      expect(denied.reason).toBe('INSUFFICIENT_FUNDS');
      expect(service.state().assets.find((v) => v.id === zelle.id)?.balance).toBe(100);
      expect(service.state().assets.find((v) => v.id === eurVault.id)?.balance).toBe(0);

      // Valid USD -> EUR transfer ($110 USD @ 1.10 EUR/USD = 100 EUR; here $55 -> 50 EUR)
      const ok = service.transferBetweenVaults(zelle.id, eurVault.id, 55, 'Cambio a Euros');
      expect(ok.success).toBe(true);
      expect(ok.creditedAmount).toBe(50);
      expect(ok.targetCurrency).toBe('EUR');
      expect(ok.groupId).toBeDefined();
      expect(service.state().assets.find((v) => v.id === zelle.id)?.balance).toBe(45);
      expect(service.state().assets.find((v) => v.id === eurVault.id)?.balance).toBe(50);
      expect(service.state().transfers?.length).toBe(1);
      expect(service.state().transfers?.[0].groupId).toBe(ok.groupId);

      // Credit line vault CAN go negative
      const creditTransfer = service.transferBetweenVaults(creditVault.id, zelle.id, 200);
      expect(creditTransfer.success).toBe(true);
      expect(service.state().assets.find((v) => v.id === creditVault.id)?.balance).toBe(-200);
      expect(service.state().assets.find((v) => v.id === zelle.id)?.balance).toBe(245);
    });

    it('detects duplicate referenceNumber and blocks double-insertion unless allowDuplicateRef is passed', () => {
      const vault = service.addAssetVault({
        name: 'Banesco',
        channel: 'bs_bank',
        scope: 'personal',
        currency: 'USD',
        balance: 500,
        balanceUsdEquivalent: 500,
        balanceVesEquivalent: 30000,
      });

      service.addExpense({
        title: 'Pago Fibra',
        scope: 'personal',
        category: 'services',
        channel: 'bs_bank',
        vaultId: vault.id,
        referenceNumber: 'PM-004455',
        triMonetary: computeTriMonetaryAmount(40, 'USD', 60, 72),
        date: '2026-05-10',
      });

      expect(service.isDuplicateReference('PM-004455', vault.id)).toBe(true);
      expect(service.isDuplicateReference('  pm-004455  ', vault.id)).toBe(true);
      expect(service.isDuplicateReference('', vault.id)).toBe(false);

      // Second call with same referenceNumber should NOT insert duplicate nor double-debit vault
      service.addExpense({
        title: 'Pago Fibra Duplicado',
        scope: 'personal',
        category: 'services',
        channel: 'bs_bank',
        vaultId: vault.id,
        referenceNumber: 'PM-004455',
        triMonetary: computeTriMonetaryAmount(40, 'USD', 60, 72),
        date: '2026-05-10',
      });
      expect(service.state().expenses.length).toBe(1);
      expect(service.state().assets.find((v) => v.id === vault.id)?.balance).toBe(460);

      // Explicit allowDuplicateRef permits insertion
      service.addExpense(
        {
          title: 'Pago Fibra Permitido',
          scope: 'personal',
          category: 'services',
          channel: 'bs_bank',
          vaultId: vault.id,
          referenceNumber: 'PM-004455',
          triMonetary: computeTriMonetaryAmount(10, 'USD', 60, 72),
          date: '2026-05-10',
        },
        { allowDuplicateRef: true },
      );
      expect(service.state().expenses.length).toBe(2);
      expect(service.state().assets.find((v) => v.id === vault.id)?.balance).toBe(450);
    });

    it('preserves historical BCV rates on deleteMovement, updateMovement, and EUR vault operations without drift', () => {
      const vesVault = service.addAssetVault({
        name: 'Banesco Bs',
        channel: 'bs_bank',
        scope: 'personal',
        currency: 'VES',
        balance: 10000,
        balanceUsdEquivalent: 166.67,
        balanceVesEquivalent: 10000,
      });
      const eurVault = service.addAssetVault({
        name: 'Caja EUR',
        channel: 'cash',
        scope: 'personal',
        currency: 'EUR',
        balance: 200,
        balanceUsdEquivalent: 220,
        balanceVesEquivalent: 13200,
      });

      // Expense of 6000 VES when BCV = 60 ($100 USD)
      const vesExp = service.addExpense({
        title: 'Mercado VES',
        scope: 'personal',
        category: 'groceries',
        channel: 'bs_bank',
        vaultId: vesVault.id,
        triMonetary: computeTriMonetaryAmount(6000, 'VES', 60, 72),
        date: '2026-05-10',
      });
      expect(service.state().assets.find((v) => v.id === vesVault.id)?.balance).toBe(4000);

      // Income of $110 USD credited to EUR vault at 1.10 EUR/USD -> +100 EUR (not +110 EUR!)
      service.addIncome({
        title: 'Cliente Europa',
        scope: 'personal',
        category: 'freelance',
        channel: 'cash',
        vaultId: eurVault.id,
        triMonetary: computeTriMonetaryAmount(110, 'USD', 60, 72, 1.1),
        date: '2026-05-10',
      });
      expect(service.state().assets.find((v) => v.id === eurVault.id)?.balance).toBe(300);

      // Now BCV rate jumps from 60 to 90!
      ratesSignal.set({
        oficial: { market: 'bcv', type: 'reference', mid: 90.0 },
        parallel: { market: 'parallel', type: 'parallel', mid: 108.0 },
        eur: { market: 'bcv_eur', type: 'reference', mid: 99.0 },
      });

      // Update movement must preserve frozen historical bcv_rate (60)
      service.updateMovement(vesExp.id, 'expense', { title: 'Mercado VES Editado', amountUsd: 50 });
      const edited = service.state().expenses.find((e) => e.id === vesExp.id);
      expect(edited?.triMonetary.bcv_rate).toBe(60);
      expect(service.state().assets.find((v) => v.id === vesVault.id)?.balance).toBe(7000); // 10000 - 3000 VES

      // Delete movement must reverse exact historical 3000 VES -> back to 10000 VES
      service.deleteMovement(vesExp.id, 'expense');
      expect(service.state().assets.find((v) => v.id === vesVault.id)?.balance).toBe(10000);

      // Reconcile VES vault directly to exact target balance
      const rec = service.reconcileVaultBalance(vesVault.id, 9400);
      expect(rec.success).toBe(true);
      expect(rec.deltaInCurrency).toBe(-600);
      expect(service.state().assets.find((v) => v.id === vesVault.id)?.balance).toBe(9400);
      expect(service.state().vaultReconciliations?.length).toBe(1);
    });

    it('treats Wealth Goal contributions as earmarked reserves (no ExpenseEntry, no false Net Worth drop) with clean withdrawal', () => {
      const zelle = service.addAssetVault({
        name: 'Zelle Ahorro',
        channel: 'zelle',
        scope: 'personal',
        currency: 'USD',
        balance: 1000,
        balanceUsdEquivalent: 1000,
        balanceVesEquivalent: 60000,
      });

      const goal = service.addWealthGoal({
        title: 'Fondo de Emergencia',
        targetAmountUsd: 2000,
        currentAmountUsd: 0,
        scope: 'personal',
      });

      const ok = service.contributeToWealthGoal(goal.id, 300, zelle.id);
      expect(ok).toBe(true);
      expect(service.state().expenses.length).toBe(0); // NEVER inflates burn rate
      expect(service.netWorthUsd()).toBe(1000); // NEVER falsely lowers Net Worth
      expect(service.goals()[0].currentAmountUsd).toBe(300);
      expect(service.earmarkedGoalsUsd()).toBe(300);
      expect(service.freeLiquidAssetsUsd()).toBe(700);
      expect(service.state().transfers?.some((t) => t.kind === 'goal_reserve' && t.goalId === goal.id)).toBe(true);

      // Withdraw cleanly
      const withdrawn = service.withdrawFromWealthGoal(goal.id, 100);
      expect(withdrawn).toBe(true);
      expect(service.goals()[0].currentAmountUsd).toBe(200);
      expect(service.netWorthUsd()).toBe(1000);
      expect(service.state().transfers?.some((t) => t.kind === 'goal_release' && t.goalId === goal.id)).toBe(true);
    });

    it('forces liquidityHealthStatus to critical whenever overdue liabilities exist and clamps payLiability overpayment', () => {
      const zelle = service.addAssetVault({
        name: 'Zelle',
        channel: 'zelle',
        scope: 'personal',
        currency: 'USD',
        balance: 5000,
        balanceUsdEquivalent: 5000,
        balanceVesEquivalent: 300000,
      });

      const pastDueDate = addCalendarDays(todayVetIso(), -5);
      const overdueLiab = service.addLiability({
        title: 'Factura Vencida',
        creditor: 'Cantv',
        scope: 'personal',
        category: 'fixed_service',
        triMonetary: computeTriMonetaryAmount(50, 'USD', 60, 72),
        dueDate: pastDueDate,
        status: 'pending',
        amountPaid: 0,
        remainingAmount: 50,
      });

      expect(service.overdueLiabilities().length).toBe(1);
      expect(service.upcomingLiabilities7Days().some((l) => l.id === overdueLiab.id)).toBe(true);
      expect(service.upcomingLiabilities14Days().some((l) => l.id === overdueLiab.id)).toBe(true);

      // Even with $5000 cash vs $50 debt, overdue debt forces critical!
      const health = service.liquidityHealthStatus();
      expect(health.status).toBe('critical');
      expect(health.overdueCount).toBe(1);
      expect(health.overdueUsd).toBe(50);

      // Attempt overpayment ($200 on $50 liability) must clamp to $50
      const payRes = service.payLiability(overdueLiab.id, 200, zelle.id, true);
      expect(payRes.success).toBe(true);
      expect(payRes.appliedAmountUsd).toBe(50);
      expect(service.state().assets.find((v) => v.id === zelle.id)?.balance).toBe(4950);
      expect(service.overdueLiabilities().length).toBe(0);
      expect(service.liquidityHealthStatus().status).toBe('optimal');
    });
  });

  describe('Cashea 2026 Engine (N1-N6 Araguaney, Dual Line, Anti-Mora, Dual Projector, Collisions & Modo Aliado)', () => {
    it('exposes complete CASHEA_CLUB_TIERS metadata for Levels 1 through 6', () => {
      expect(CASHEA_CLUB_TIERS[1]).toMatchObject({ name: 'Semilla', principalInitialPercent: 60, cotidianaInitialPercent: 50, maxInstallments: 3 });
      expect(CASHEA_CLUB_TIERS[2]).toMatchObject({ name: 'Raíz', principalInitialPercent: 50, cotidianaInitialPercent: 40, requiredSpentUsd: 120, requiredInstallmentsPaid: 5, maxInstallments: 3 });
      expect(CASHEA_CLUB_TIERS[3]).toMatchObject({ name: 'Hoja', principalInitialPercent: 40, cotidianaInitialPercent: 30, requiredSpentUsd: 400, requiredInstallmentsPaid: 10, maxInstallments: 6 });
      expect(CASHEA_CLUB_TIERS[4]).toMatchObject({ name: 'Tronco', principalInitialPercent: 40, cotidianaInitialPercent: 25, requiredSpentUsd: 800, requiredInstallmentsPaid: 20, maxInstallments: 6 });
      expect(CASHEA_CLUB_TIERS[5]).toMatchObject({ name: 'Árbol', principalInitialPercent: 40, cotidianaInitialPercent: 20, requiredSpentUsd: 2000, requiredInstallmentsPaid: 40, maxInstallments: 9 });
      expect(CASHEA_CLUB_TIERS[6]).toMatchObject({ name: 'Araguaney', principalInitialPercent: 40, cotidianaInitialPercent: 20, campaignInitialPercent: 0, requiredSpentUsd: 4000, requiredInstallmentsPaid: 80, maxInstallments: 12 });
    });

    it('calculates Dual Line, Level 6 campaign 0%, flexible initialPercent, firstDueDate VET, vehicular 12-24m, and absorbs rounding pennies', () => {
      // Level 3 Principal: 40% initial -> returns 40 for both initialPercent and initialPercentage, 0.4 for initialFactor
      const l3Principal = service.calculateCasheaBreakdown(100, 3, 3, {
        creditLine: 'principal',
        firstDueDate: '2026-06-01',
      });
      expect(l3Principal.initialPercent).toBe(40);
      expect(l3Principal.initialPercentage).toBe(40);
      expect(l3Principal.initialFactor).toBe(0.4);
      expect(l3Principal.initialPaymentUsd).toBe(40);
      expect(l3Principal.installments.map((i) => i.dueDate)).toEqual(['2026-06-01', '2026-06-15', '2026-06-29']);

      // Level 4 Cotidiana: 25% initial
      const l4Cotidiana = service.calculateCasheaBreakdown(200, 4, 3, { creditLine: 'cotidiana' });
      expect(l4Cotidiana.initialPercent).toBe(25);
      expect(l4Cotidiana.initialPaymentUsd).toBe(50);

      // Level 6 Araguaney with 0% campaign + $100 / 3 rounding penny absorption (33.33 + 33.33 + 33.34 === 100.00)
      const l6Campaign = service.calculateCasheaBreakdown(100, 6, 3, { zeroInitialCampaign: true });
      expect(l6Campaign.initialPercent).toBe(0);
      expect(l6Campaign.initialPaymentUsd).toBe(0);
      const sumInstallments = roundMoney(l6Campaign.installments.reduce((s, i) => s + i.amountUsd, 0));
      expect(sumInstallments).toBe(100);
      expect(l6Campaign.installments[2].amountUsd).toBe(33.34);

      // Vehicular 18 monthly installments
      const vehicular = service.calculateCasheaBreakdown(9000, 6, 18, {
        creditLine: 'vehicular',
        initialPercent: 30,
        firstDueDate: '2026-06-01',
      });
      expect(vehicular.frequencyDays).toBe(30);
      expect(vehicular.installments.length).toBe(18);
      expect(roundMoney(vehicular.installments.reduce((s, i) => s + i.amountUsd, 0))).toBe(6300);
    });

    it('enforces idempotency on markCasheaInstallmentPaid, supports partial abonos, bidirectional payLiability sync, and reverse deleteCasheaPlan', () => {
      const vault = service.addAssetVault({
        name: 'Caja Pyme',
        channel: 'cash',
        scope: 'business',
        currency: 'USD',
        balance: 500,
        balanceUsdEquivalent: 500,
        balanceVesEquivalent: 30000,
      });

      const breakdown = service.calculateCasheaBreakdown(150, 3, 3, { firstDueDate: '2026-06-01' });
      const plan = service.addCasheaPlan({
        productName: 'Taladro Industrial',
        storeName: 'EPA',
        scope: 'business',
        level: 3,
        creditLine: 'principal',
        totalPriceUsd: 150,
        initialPaymentUsd: breakdown.initialPaymentUsd,
        initialPercentage: breakdown.initialPercentage,
        initialPercent: breakdown.initialPercent,
        numberOfInstallments: 3,
        installmentAmountUsd: breakdown.installmentAmountUsd,
        installmentFrequencyDays: 14,
        startDate: '2026-05-18',
        installments: breakdown.installments,
        status: 'active',
      });

      // Installment 1: partial abono $10 then complete remaining $20
      const partialRes = service.recordCasheaPartialPayment(plan.id, 1, 10, 'ABONO-1', vault.id);
      expect(partialRes.success).toBe(true);
      expect(service.state().assets.find((v) => v.id === vault.id)?.balance).toBe(490);

      const firstMark = service.markCasheaInstallmentPaid(plan.id, 1, 'FINAL-1', 60, vault.id);
      expect(firstMark.success).toBe(true);
      expect(firstMark.paidAmountUsd).toBe(20); // Only remaining $20 debited!
      expect(service.state().assets.find((v) => v.id === vault.id)?.balance).toBe(470);
      expect(service.state().expenses[0].scope).toBe('business'); // Respects plan scope!

      // Strict idempotency: marking installment 1 paid a second time MUST NOT double-debit
      const secondMark = service.markCasheaInstallmentPaid(plan.id, 1, 'DUP-1', 60, vault.id);
      expect(secondMark.success).toBe(false);
      expect(secondMark.alreadyPaid).toBe(true);
      expect(service.state().assets.find((v) => v.id === vault.id)?.balance).toBe(470);

      // Bidirectional sync: paying liability for installment #2 via payLiability marks Cashea installment #2 as paid
      service.payLiability(`liab-cashea-${plan.id}-2`, 30, vault.id, true);
      const syncedPlan = service.state().casheaPlans.find((p) => p.id === plan.id);
      expect(syncedPlan?.installments[1].status).toBe('paid');

      // Delete plan with reversePayments restores vault cleanly
      service.deleteCasheaPlan(plan.id, { reversePayments: true });
      expect(service.state().casheaPlans.length).toBe(0);
      expect(service.state().liabilities.filter((l) => l.casheaPlanId === plan.id).length).toBe(0);
      expect(service.state().assets.find((v) => v.id === vault.id)?.balance).toBe(500);
    });

    it('evaluates Anti-Mora health (grace 2d, $4 fee, 7d/14d/28d tiers), Dual Projector & 14D Collisions', () => {
      expect(service.evaluateCasheaInstallmentHealth('2026-05-20', 'pending', '2026-05-10').status).toBe('upcoming');
      expect(service.evaluateCasheaInstallmentHealth('2026-05-12', 'pending', '2026-05-10').status).toBe('due_soon_48h');

      const grace = service.evaluateCasheaInstallmentHealth('2026-05-08', 'pending', '2026-05-10');
      expect(grace.status).toBe('grace_2d');
      expect(grace.inGracePeriod).toBe(true);
      expect(grace.reactivationFeeUsd).toBe(0);

      const overdue7 = service.evaluateCasheaInstallmentHealth('2026-05-02', 'pending', '2026-05-10');
      expect(overdue7.status).toBe('overdue_penalty');
      expect(overdue7.reactivationFeeUsd).toBe(4);
      expect(overdue7.penaltyTier).toBe('7d');

      const overdue14 = service.evaluateCasheaInstallmentHealth('2026-04-25', 'pending', '2026-05-10');
      expect(overdue14.penaltyTier).toBe('14d');

      const overdue28 = service.evaluateCasheaInstallmentHealth('2026-04-10', 'pending', '2026-05-10');
      expect(overdue28.penaltyTier).toBe('28d');

      // Add a recurring rule & liability colliding on 2026-06-01
      service.addLiability({
        title: 'Alquiler',
        creditor: 'Propietario',
        scope: 'personal',
        category: 'fixed_service',
        triMonetary: computeTriMonetaryAmount(200, 'USD', 60, 72),
        dueDate: '2026-06-01',
        status: 'pending',
        amountPaid: 0,
        remainingAmount: 200,
      });
      service.addRecurringRule({
        title: 'Internet Fibra',
        type: 'expense',
        scope: 'personal',
        category: 'services',
        channel: 'zelle',
        currency: 'USD',
        amount: 45,
        frequency: 'monthly',
        nextDueDate: '2026-06-15',
        active: true,
      });

      const collisions = service.detectCasheaCollisions14D(['2026-06-01', '2026-06-15', '2026-06-29']);
      expect(collisions[0].collisionCount).toBe(1);
      expect(collisions[0].totalExistingCommittedUsd).toBe(200);
      expect(collisions[1].collisionCount).toBe(1);
      expect(collisions[1].totalExistingCommittedUsd).toBe(45);
      expect(collisions[2].collisionCount).toBe(0);

      const dual = service.simulateCasheaVsSavings({
        productPriceUsd: 300,
        level: 3,
        installmentsCount: 3,
        biweeklySavingsCapacityUsd: 80,
        firstDueDate: '2026-06-01',
      });
      expect(dual.pathA_savings.biweeklyPeriodsNeeded).toBe(4);
      expect(dual.pathB_cashea.installmentAmountUsd).toBe(60);
      expect(dual.pathB_cashea.canAffordInstallment).toBe(true);
      expect(dual.pathB_cashea.collisionCount).toBe(2);
    });

    it('simulates, registers, and settles Cashea para Negocios (Modo Aliado) exposing FX gap erosion & selling-at-loss risk', () => {
      const sim = service.simulateCasheaMerchantSale({
        grossSaleUsd: 100,
        costOfGoodsUsd: 80,
        mdrPercent: 5,
        useWeeklyAdvance: true,
        weeklyAdvanceFeePercent: 3,
        bcvRate: 60,
        parallelReplacementRate: 78, // 30% gap!
        monthlyMinimumFeeUsd: 100,
        activationFeeUsd: 200,
      });

      // Fees: $5 MDR + $3 advance = $8 -> $92 settled at BCV (5520 Bs) -> at 78 Bs/$ = $70.77 real replacement USD -> profit = -9.23 (LOSS!)
      expect(sim.totalCasheaFeesUsd).toBe(8);
      expect(sim.settlementUsdAtBcv).toBe(92);
      expect(sim.realReplacementUsd).toBe(70.77);
      expect(sim.fxGapErosionUsd).toBe(21.23);
      expect(sim.realNetProfitUsd).toBe(-9.23);
      expect(sim.isSellingAtLoss).toBe(true);
      expect(sim.monthlyBreakEvenVolumeUsd).toBe(2000); // $100 / 5% = $2000

      const pymeVault = service.addAssetVault({
        name: 'Caja Pyme',
        channel: 'bs_bank',
        scope: 'business',
        currency: 'USD',
        balance: 0,
        balanceUsdEquivalent: 0,
        balanceVesEquivalent: 0,
      });

      const sale = service.registerCasheaMerchantSale({
        title: 'Venta Cauchos Rin 15',
        grossSaleUsd: 200,
        costOfGoodsUsd: 110,
        mdrPercent: 4,
        useWeeklyAdvance: false,
        bcvRate: 60,
        parallelReplacementRate: 66,
      });
      expect(sale.status).toBe('pending_settlement');

      const settled = service.settleCasheaMerchantSale(sale.id, pymeVault.id);
      expect(settled.success).toBe(true);
      expect(service.state().assets.find((v) => v.id === pymeVault.id)?.balance).toBe(sale.netReceivableUsd);

      // Idempotent second settle rejected
      const settledAgain = service.settleCasheaMerchantSale(sale.id, pymeVault.id);
      expect(settledAgain.success).toBe(false);
    });
  });

  describe('Pyme 3 Drawers, Unified CxP, Quote Automations, Restore, Recurring Rules & P2P Bridge', () => {
    it('keeps cumulative opening balance in Pyme 3 drawers, maps every ExpenseCategory exhaustively, and NEVER hides negative overdrafts', () => {
      // Every ExpenseCategory must resolve deterministically
      const allCats: ExpenseCategory[] = [
        'housing', 'groceries', 'health', 'services', 'education', 'transport',
        'cashea_installment', 'personal_care', 'entertainment', 'provider_merchandise',
        'payroll', 'rent', 'utilities', 'equipment_capex', 'maintenance', 'marketing', 'taxes', 'other',
      ];
      for (const cat of allCats) {
        expect(['drawer_merchandise', 'drawer_operations', 'drawer_capex']).toContain(
          getDrawerForExpenseCategory(cat),
        );
      }

      const pymeVault = service.addAssetVault({
        name: 'Caja Negocio',
        channel: 'cash',
        scope: 'business',
        currency: 'USD',
        balance: 400,
        openingBalance: 400,
        balanceUsdEquivalent: 400,
        balanceVesEquivalent: 24000,
      });

      // Opening balance 400 -> 200 / 120 / 80. Now record a $200 sale (100 / 60 / 40) -> 300 / 180 / 120!
      service.settlePymeSaleWithDrawers({
        title: 'Servicio Pintura',
        totalUsd: 200,
        vaultId: pymeVault.id,
        drawer1Usd: 100,
        drawer2Usd: 60,
        drawer3Usd: 40,
      });

      // Spend $250 in marketing (business, maps to drawer_operations) -> drawer2 = 180 - 250 = -70 OVERDRAFT!
      service.addExpense({
        title: 'Campaña Meta Ads',
        scope: 'business',
        category: 'marketing',
        channel: 'zelle',
        vaultId: pymeVault.id,
        triMonetary: computeTriMonetaryAmount(250, 'USD', 60, 72),
        date: todayVetIso(),
      });

      const tel = service.pymeDrawersTelemetry();
      expect(tel.drawer1AllocatedUsd).toBe(300);
      expect(tel.drawer2AllocatedUsd).toBe(180);
      expect(tel.drawer3AllocatedUsd).toBe(120);
      expect(tel.opsExpensesUsd).toBe(250);
      expect(tel.drawer2AvailableUsd).toBe(-70); // Overdraft visible, NOT hidden by Math.max(0, ...)
      expect(tel.hasOverdraft).toBe(true);
    });

    it('unifies Provider CxP with Liabilities without double-counting and settles partial payments FIFO', () => {
      const pymeVault = service.addAssetVault({
        name: 'Caja Pyme',
        channel: 'cash',
        scope: 'business',
        currency: 'USD',
        balance: 1000,
        balanceUsdEquivalent: 1000,
        balanceVesEquivalent: 60000,
      });

      const prov = service.addProvider({
        name: 'Pinturas Automotrices C.A.',
        category: 'Pinturas',
        phone: '0414-0001122',
        bankDetails: 'Banesco',
        outstandingDebtUsd: 100,
      });

      // Initial debt automatically generated 1 linked liability
      expect(service.state().liabilities.filter((l) => l.providerId === prov.id).length).toBe(1);
      expect(service.totalLiabilitiesUsd()).toBe(100);

      // Add inventory item and restock on provider_credit ($20 * 5 = $100)
      const item = service.addInventoryItem({
        name: 'Barniz 2K',
        category: 'Pintura',
        currentStock: 2,
        minimumStock: 3,
        optimalStock: 10,
        unitCostUsd: 20,
        sellingPriceUsd: 35,
      });

      const restock = service.restockInventoryWithAccounting({
        itemId: item.id,
        quantityToAdd: 5,
        paymentMode: 'provider_credit',
        providerId: prov.id,
      });
      expect(restock.success).toBe(true);
      expect(service.state().providers.find((p) => p.id === prov.id)?.outstandingDebtUsd).toBe(200);
      expect(service.totalLiabilitiesUsd()).toBe(200); // Single source of truth, ZERO double counting

      // Pay $150 partial payment -> settles first $100 liability fully and $50 of the second!
      service.payProviderWithVault(prov.id, 150, pymeVault.id);
      expect(service.state().providers.find((p) => p.id === prov.id)?.outstandingDebtUsd).toBe(50);
      expect(service.totalLiabilitiesUsd()).toBe(50);
      expect(service.state().assets.find((v) => v.id === pymeVault.id)?.balance).toBe(850);
    });

    it('approves a quote idempotently triggering advance income, receivable tracking, stock deduction, and payroll liability', () => {
      const pymeVault = service.addAssetVault({
        name: 'Caja Taller',
        channel: 'cash',
        scope: 'business',
        currency: 'USD',
        balance: 100,
        balanceUsdEquivalent: 100,
        balanceVesEquivalent: 6000,
      });
      const stockItem = service.addInventoryItem({
        name: 'Pintura Bicapa',
        category: 'Pintura',
        currentStock: 10,
        minimumStock: 2,
        optimalStock: 12,
        unitCostUsd: 25,
        sellingPriceUsd: 40,
      });

      const quote = service.addQuote({
        quoteNumber: 'COT-2026-01',
        clientName: 'María López',
        type: 'automotive_bodywork',
        description: 'Pintura Capot',
        scopeDetails: {},
        materials: [
          {
            name: 'Pintura Bicapa',
            quantity: 3,
            unit: 'cuarto',
            unitCostUsd: 25,
            wasteFactorPercent: 10,
            totalCostUsd: 82.5,
          },
        ],
        laborCostUsd: 80,
        laborType: 'commission',
        totalMaterialsCostUsd: 82.5,
        subtotalCostUsd: 162.5,
        profitMarginPercent: 25,
        totalPriceUsd: 203.13,
        minimumAdvanceUsd: 100,
        advancePercent: 50,
        bcvRateApplied: 60,
        totalPriceVes: 12187.8,
        status: 'draft',
      });

      const approval = service.approveQuoteAndTriggerAutomations(quote.id, pymeVault.id);
      expect(approval.success).toBe(true);
      expect(approval.alreadyApproved).toBe(false);
      expect(approval.advanceIncomeId).toBeDefined();
      expect(approval.receivableUsd).toBe(103.13);
      expect(approval.payrollLiabilityId).toBeDefined();
      expect(approval.deductedInventory).toEqual([
        expect.objectContaining({ itemId: stockItem.id, quantityDeducted: 3, newStock: 7 }),
      ]);
      expect(service.state().assets.find((v) => v.id === pymeVault.id)?.balance).toBe(200);
      expect(service.state().inventory.find((i) => i.id === stockItem.id)?.currentStock).toBe(7);
      expect(service.state().liabilities.find((l) => l.id === approval.payrollLiabilityId)?.remainingAmount).toBe(80);

      // Idempotent second call
      const secondApproval = service.approveQuoteAndTriggerAutomations(quote.id, pymeVault.id);
      expect(secondApproval.success).toBe(false);
      expect(secondApproval.alreadyApproved).toBe(true);
      expect(service.state().inventory.find((i) => i.id === stockItem.id)?.currentStock).toBe(7);
    });

    it('validates restoreLedgerState strictly (rejects NaN / bad schema) and preserves all v2 collections', () => {
      const vault = service.addAssetVault({
        name: 'Vault Original',
        channel: 'zelle',
        scope: 'personal',
        currency: 'USD',
        balance: 300,
        balanceUsdEquivalent: 300,
        balanceVesEquivalent: 18000,
      });

      // Corrupted NaN balance MUST be rejected and preserve previous state
      const badRestore = service.restoreLedgerState({
        version: 2,
        assets: [{ ...vault, balance: Number.NaN }],
        liabilities: [],
        incomes: [],
        expenses: [],
        casheaPlans: [],
        providers: [],
        inventory: [],
        quotes: [],
        lastUpdated: new Date().toISOString(),
      } as Finance360LedgerState);
      expect(badRestore).toBe(false);
      expect(service.state().assets[0].balance).toBe(300);

      // Valid full v2 snapshot round-trip via getSerializableState / applyExternalSnapshot
      service.addWealthGoal({ title: 'Meta 1', targetAmountUsd: 500, currentAmountUsd: 100, scope: 'personal' });
      service.addRecurringRule({
        title: 'Netflix',
        type: 'expense',
        scope: 'personal',
        category: 'entertainment',
        channel: 'zelle',
        currency: 'USD',
        amount: 15,
        frequency: 'monthly',
        nextDueDate: '2026-07-01',
        active: true,
      });
      const snapshot = service.getSerializableState();
      service.resetLedgerToZero();
      expect(service.state().assets.length).toBe(0);

      expect(service.applyExternalSnapshot(snapshot)).toBe(true);
      expect(service.state().assets.length).toBe(1);
      expect(service.state().goals?.length).toBe(1);
      expect(service.state().recurringRules?.length).toBe(1);
    });

    it('materializes due recurring rules idempotently and settles P2P profits with live FX & VET-day idempotency', () => {
      const vault = service.addAssetVault({
        name: 'Binance USDT',
        channel: 'crypto',
        scope: 'business',
        currency: 'USDT',
        balance: 100,
        balanceUsdEquivalent: 100,
        balanceVesEquivalent: 6000,
      });

      // Recurring rule due today
      const today = todayVetIso();
      const rule = service.addRecurringRule({
        title: 'Hosting Mensual',
        type: 'expense',
        scope: 'business',
        category: 'services',
        channel: 'crypto',
        vaultId: vault.id,
        currency: 'USD',
        amount: 20,
        frequency: 'monthly',
        nextDueDate: today,
        active: true,
      });
      const mat1 = service.materializeDueRecurringRules(today);
      expect(mat1.materializedCount).toBe(1);
      expect(service.state().assets.find((v) => v.id === vault.id)?.balance).toBe(80);
      const mat2 = service.materializeDueRecurringRules(today);
      expect(mat2.materializedCount).toBe(0);

      service.toggleRecurringRule(rule.id, false);
      expect(service.state().recurringRules?.find((r) => r.id === rule.id)?.active).toBe(false);
      service.deleteRecurringRule(rule.id);
      expect(service.state().recurringRules?.length).toBe(0);

      // Unified P2P profit settlement with real live rates (60/72) and real vault credit
      const p2p1 = service.settleP2pProfitToFinance360({
        netProfitUsdt: 45.5,
        tradesCount: 6,
        dateIso: today,
        settlementId: `SETTLE-${today}`,
        vaultId: vault.id,
      });
      expect(p2p1.success).toBe(true);
      expect(p2p1.bcvRateApplied).toBe(60);
      expect(p2p1.parallelRateApplied).toBe(72);
      expect(p2p1.profitVes).toBe(2730);
      expect(service.state().assets.find((v) => v.id === vault.id)?.balance).toBe(125.5);

      // Same VET-day replay blocked idempotently
      const p2p2 = service.settleP2pProfitToFinance360({
        netProfitUsdt: 45.5,
        tradesCount: 6,
        dateIso: today,
        settlementId: `SETTLE-${today}`,
        vaultId: vault.id,
      });
      expect(p2p2.success).toBe(false);
      expect(p2p2.alreadySettled).toBe(true);
      expect(service.state().assets.find((v) => v.id === vault.id)?.balance).toBe(125.5);
    });

    it('maintains unidirectional P2P isolation in importDailyP2pProfit', () => {
      const mockBuy: Operation = {
        id: 'op-1',
        timestamp: new Date().toISOString(),
        type: 'buy',
        pair: 'USDT',
        vesAmount: 60000,
        usdtAmount: 1000,
        price: 60,
        merchantNote: 'c1',
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
        merchantNote: 'c2',
        fees: 0,
        bankAccountId: 'b-1',
        errorFree: true,
        notes: '',
      };
      mockAccounts.todayOperations.mockReturnValue([mockBuy, mockSell]);

      const result = service.importDailyP2pProfit('personal', 60);
      expect(result.success).toBe(true);
      expect(result.profitVes).toBe(3000);
      expect(result.profitUsd).toBe(47.62);
      expect(mockStorage.set).not.toHaveBeenCalledWith('p2p.operations', expect.anything());
    });
  });

  describe('T4: Dual-Write SQLite Bridge, Async Hydration & AuditLogger', () => {
    afterEach(() => {
      delete (window as unknown as { electron?: unknown }).electron;
    });

    it('hydrates from IndexedDbStorageService whenReady() when local state was empty at boot', async () => {
      let resolveReady!: () => void;
      const readyPromise = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      const asyncStorage = {
        get: vi.fn(<T>(key: string): T | null => (storageMap.get(key) as T) ?? null),
        set: vi.fn((key: string, val: unknown) => {
          storageMap.set(key, val);
        }),
        remove: vi.fn((key: string) => {
          storageMap.delete(key);
        }),
        whenReady: vi.fn(() => readyPromise),
      };

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          Finance360Service,
          { provide: IndexedDbStorageService, useValue: asyncStorage },
          { provide: AccountsService, useValue: mockAccounts },
          { provide: CotizaveService, useValue: { ratesByMarket: ratesSignal } },
        ],
      });
      const svc = TestBed.inject(Finance360Service);
      expect(svc.assets().length).toBe(0);

      // Simulate IndexedDB finishing async hydration with a persisted vault
      storageMap.set(FINANCE_360_STORAGE_KEY, {
        version: 2,
        assets: [
          {
            id: 'v-idb-1',
            name: 'Zelle Hydrated',
            channel: 'zelle',
            scope: 'personal',
            currency: 'USD',
            balance: 777,
            balanceUsdEquivalent: 777,
            balanceVesEquivalent: 46620,
            updatedAt: '2026-11-18T12:00:00.000Z',
          },
        ],
        liabilities: [],
        incomes: [],
        expenses: [],
        casheaPlans: [],
        providers: [],
        inventory: [],
        quotes: [],
        goals: [],
        lastUpdated: '2026-11-18T12:00:00.000Z',
      } satisfies Finance360LedgerState);

      resolveReady();
      await svc.whenHydrated();

      expect(svc.assets().some((v) => v.id === 'v-idb-1' && v.balance === 777)).toBe(true);
    });

    it('hydrates from Electron SQLite snapshot when available and dual-writes updates to SQLite', async () => {
      const saveSnapshot = vi.fn().mockResolvedValue({ ok: true, updatedAt: '2026-11-18T15:00:00.000Z' });
      const getSnapshot = vi.fn().mockResolvedValue({
        version: 2,
        assets: [
          {
            id: 'v-sqlite-1',
            name: 'Bóveda SQLite',
            channel: 'crypto',
            scope: 'personal',
            currency: 'USDT',
            balance: 1200,
            balanceUsdEquivalent: 1200,
            balanceVesEquivalent: 72000,
            updatedAt: '2026-11-18T14:00:00.000Z',
          },
        ],
        liabilities: [],
        incomes: [],
        expenses: [],
        casheaPlans: [],
        providers: [],
        inventory: [],
        quotes: [],
        goals: [],
        lastUpdated: '2026-11-18T14:00:00.000Z',
      });

      (window as unknown as { electron?: unknown }).electron = {
        finance360: { getSnapshot, saveSnapshot },
      };

      const svc = createService();
      await svc.whenHydrated();

      expect(getSnapshot).toHaveBeenCalledTimes(1);
      expect(svc.assets().some((v) => v.id === 'v-sqlite-1' && v.balance === 1200)).toBe(true);

      svc.addAssetVault({
        name: 'Efectivo Nuevo',
        channel: 'cash',
        scope: 'personal',
        currency: 'USD',
        balance: 250,
        balanceUsdEquivalent: 250,
        balanceVesEquivalent: 15000,
      });

      expect(saveSnapshot).toHaveBeenCalled();
      const lastArg = saveSnapshot.mock.calls[saveSnapshot.mock.calls.length - 1][0] as Finance360LedgerState;
      expect(lastArg.assets.some((v) => v.name === 'Efectivo Nuevo')).toBe(true);
    });

    it('migrates non-empty browser IndexedDB state into empty Electron SQLite without data loss', async () => {
      const saveSnapshot = vi.fn().mockResolvedValue({ ok: true, updatedAt: '2026-11-18T15:00:00.000Z' });
      const getSnapshot = vi.fn().mockResolvedValue(null);

      (window as unknown as { electron?: unknown }).electron = {
        finance360: { getSnapshot, saveSnapshot },
      };

      storageMap.set(FINANCE_360_STORAGE_KEY, {
        version: 1,
        assets: [
          {
            id: 'v-legacy-1',
            name: 'Zelle Legacy',
            channel: 'zelle',
            scope: 'personal',
            currency: 'USD',
            balance: 500,
            balanceUsdEquivalent: 500,
            balanceVesEquivalent: 30000,
            updatedAt: '2026-11-18T10:00:00.000Z',
          },
        ],
        liabilities: [],
        incomes: [],
        expenses: [],
        casheaPlans: [],
        providers: [],
        inventory: [],
        quotes: [],
        goals: [],
        lastUpdated: '2026-11-18T10:00:00.000Z',
      });

      const svc = createService();
      await svc.whenHydrated();

      expect(getSnapshot).toHaveBeenCalledTimes(1);
      expect(saveSnapshot).toHaveBeenCalled();
      const migrated = saveSnapshot.mock.calls[0][0] as Finance360LedgerState;
      expect(migrated.version).toBe(2);
      expect(migrated.assets[0].id).toBe('v-legacy-1');
    });

    it('records critical financial mutations into AuditLoggerService', () => {
      const mockAudit = { log: vi.fn() };
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          Finance360Service,
          { provide: IndexedDbStorageService, useValue: mockStorage },
          { provide: AccountsService, useValue: mockAccounts },
          { provide: CotizaveService, useValue: { ratesByMarket: ratesSignal } },
          { provide: AuditLoggerService, useValue: mockAudit },
        ],
      });
      const svc = TestBed.inject(Finance360Service);

      const v1 = svc.addAssetVault({
        name: 'A',
        channel: 'zelle',
        scope: 'personal',
        currency: 'USD',
        balance: 500,
        balanceUsdEquivalent: 500,
        balanceVesEquivalent: 30000,
      });
      const v2 = svc.addAssetVault({
        name: 'B',
        channel: 'cash',
        scope: 'personal',
        currency: 'USD',
        balance: 100,
        balanceUsdEquivalent: 100,
        balanceVesEquivalent: 6000,
      });
      svc.transferBetweenVaults(v1.id, v2.id, 100, 'Test audit');
      svc.reconcileVaultBalance(v2.id, 210);
      svc.resetLedgerToZero();

      const actions = mockAudit.log.mock.calls.map((c) => c[1]);
      expect(actions).toContain('F360_VAULT_TRANSFER');
      expect(actions).toContain('F360_VAULT_RECONCILE');
      expect(actions).toContain('F360_RESET_LEDGER');
    });
  });
});
