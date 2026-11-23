import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FinanceAnalyticsComponent } from './finance-analytics.component';
import { Finance360Service } from '../../../core/finance-360.service';
import { FinanceForecasterService } from '../../../core/services/finance-forecaster.service';
import { IndexedDbStorageService } from '../../../core/indexed-db-storage.service';
import { AccountsService } from '../../../core/accounts.service';
import { CotizaveService } from '../../../core/cotizave.service';
import {
  addCalendarDays,
  computeTriMonetaryAmount,
  todayVetIso,
  type ExpenseCategory,
  type IncomeCategory,
} from '../../../core/models/finance-360.models';
import type { CotizaveRate } from '@p2p/core';

describe('FinanceAnalyticsComponent (Spatial Liquid Glass v2)', () => {
  let fixture: ComponentFixture<FinanceAnalyticsComponent>;
  let component: FinanceAnalyticsComponent;
  let financeService: Finance360Service;
  let ratesSignal: WritableSignal<Record<string, CotizaveRate>>;
  let storageMap: Map<string, unknown>;

  function setup(initialRates?: Record<string, CotizaveRate>): void {
    TestBed.resetTestingModule();
    storageMap = new Map<string, unknown>();
    ratesSignal = signal<Record<string, CotizaveRate>>(
      initialRates ?? {
        oficial: { market: 'bcv', type: 'reference', mid: 60.0 },
        parallel: { market: 'parallel', type: 'parallel', mid: 72.0 },
        eur: { market: 'bcv_eur', type: 'reference', mid: 66.0 },
      },
    );

    TestBed.configureTestingModule({
      imports: [FinanceAnalyticsComponent],
      providers: [
        Finance360Service,
        FinanceForecasterService,
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
    fixture = TestBed.createComponent(FinanceAnalyticsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function seedIncome(daysAgo: number, amountUsd: number, category: IncomeCategory = 'salary'): void {
    const date = addCalendarDays(todayVetIso(), -daysAgo);
    financeService.addIncome({
      title: `Ingreso ${daysAgo}d`,
      scope: 'personal',
      category,
      channel: 'zelle',
      triMonetary: computeTriMonetaryAmount(amountUsd, 'USD', 60, 72),
      date,
    });
  }

  function seedExpense(daysAgo: number, amountUsd: number, category: ExpenseCategory = 'groceries'): void {
    const date = addCalendarDays(todayVetIso(), -daysAgo);
    financeService.addExpense({
      title: `Gasto ${daysAgo}d`,
      scope: 'personal',
      category,
      channel: 'cash',
      triMonetary: computeTriMonetaryAmount(amountUsd, 'USD', 60, 72),
      date,
    });
  }

  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters KPIs, P&L and category breakdown strictly by selected horizon (day/week/month/quarter/year)', () => {
    seedIncome(0, 100, 'business_sale');
    seedIncome(4, 200, 'p2p_profit');
    seedIncome(20, 400, 'salary');
    seedIncome(60, 500, 'freelance');
    seedIncome(200, 1000, 'investment');

    seedExpense(0, 20, 'groceries');
    seedExpense(5, 50, 'transport');
    seedExpense(18, 130, 'provider_merchandise');
    seedExpense(55, 300, 'housing');
    seedExpense(180, 600, 'equipment_capex');

    // Default horizon: month (30D)
    expect(component.selectedHorizon()).toBe('month');
    expect(component.executiveKpis().totalIncomeUsd).toBe(700);
    expect(component.executiveKpis().totalExpenseUsd).toBe(200);
    expect(component.periodPnL().p2pIsolatedProfitUsd).toBe(200);
    expect(component.periodPnL().directCostsCogsUsd).toBe(130);
    expect(component.categoryBreakdown().length).toBe(3);

    // Horizon: day (Hoy)
    component.setHorizon('day');
    expect(component.executiveKpis().totalIncomeUsd).toBe(100);
    expect(component.executiveKpis().totalExpenseUsd).toBe(20);
    expect(component.categoryBreakdown().map((c) => c.category)).toEqual(['groceries']);

    // Horizon: week (7D)
    component.setHorizon('week');
    expect(component.executiveKpis().totalIncomeUsd).toBe(300);
    expect(component.executiveKpis().totalExpenseUsd).toBe(70);

    // Horizon: quarter (90D)
    component.setHorizon('quarter');
    expect(component.executiveKpis().totalIncomeUsd).toBe(1200);
    expect(component.executiveKpis().totalExpenseUsd).toBe(500);

    // Horizon: year (12M) via external input signal
    fixture.componentRef.setInput('horizon', 'year');
    fixture.detectChanges();
    expect(component.selectedHorizon()).toBe('year');
    expect(component.executiveKpis().totalIncomeUsd).toBe(2200);
    expect(component.executiveKpis().totalExpenseUsd).toBe(1100);
  });

  it('renders an honest empty state with zero synthetic projections when liquidity or spending history is absent', () => {
    // 1. Zero-Seed empty state
    expect(component.hasProjectionData()).toBe(false);
    const emptyText = fixture.nativeElement.textContent as string;
    expect(emptyText).toContain(
      'Registra movimientos o activos para proyectar tu cono de liquidez real',
    );
    expect(fixture.nativeElement.querySelector('.trajectory-svg')).toBeNull();
    // Legacy demo button must not exist in analytics
    expect(emptyText).not.toContain('Simular Datos Ejecutivos');

    // 2. Positive assets with zero spending history must still stay honest (no fake dailyBurn || 18)
    financeService.addAssetVault({
      name: 'Zelle USD',
      channel: 'zelle',
      scope: 'personal',
      currency: 'USD',
      balance: 600,
      balanceUsdEquivalent: 600,
      balanceVesEquivalent: 36000,
    });
    fixture.detectChanges();
    expect(component.hasProjectionData()).toBe(false);
    expect(fixture.nativeElement.querySelector('.trajectory-svg')).toBeNull();

    // 3. Once real spending history exists, render SVG with preserveAspectRatio="xMidYMid meet"
    seedExpense(2, 90, 'groceries');
    fixture.detectChanges();
    expect(component.hasProjectionData()).toBe(true);

    const svgEl = fixture.nativeElement.querySelector('.trajectory-svg') as SVGElement | null;
    expect(svgEl).not.toBeNull();
    expect(svgEl?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');

    // Interactive point hover tooltip
    const proj = component.runwayProjectionSvg();
    expect(proj.forecastPoints.length).toBeGreaterThan(0);
    component.setHoveredPoint(proj.forecastPoints[1].id);
    fixture.detectChanges();
    expect(component.hoveredPoint()?.id).toBe(proj.forecastPoints[1].id);
  });

  it('includes USD, USDT, VES, and EUR vaults using real balanceUsdEquivalent in currencyDonutSegments', () => {
    // BCV = 60, EUR = 66 Bs => EUR/USD = 1.10
    financeService.addAssetVault({
      name: 'Cuenta USD',
      channel: 'zelle',
      scope: 'personal',
      currency: 'USD',
      balance: 400,
      balanceUsdEquivalent: 400,
      balanceVesEquivalent: 24000,
    });
    financeService.addAssetVault({
      name: 'Binance USDT',
      channel: 'crypto',
      scope: 'personal',
      currency: 'USDT',
      balance: 200,
      balanceUsdEquivalent: 200,
      balanceVesEquivalent: 12000,
    });
    financeService.addAssetVault({
      name: 'Banesco Bs',
      channel: 'bs_bank',
      scope: 'personal',
      currency: 'VES',
      balance: 12000, // $200 USD at BCV 60
      balanceUsdEquivalent: 200,
      balanceVesEquivalent: 12000,
    });
    financeService.addAssetVault({
      name: 'Bóveda Euros',
      channel: 'cash',
      scope: 'personal',
      currency: 'EUR',
      balance: 200, // $220 USD at 1.10 EUR/USD
      balanceUsdEquivalent: 220,
      balanceVesEquivalent: 13200,
    });
    fixture.detectChanges();

    const segments = component.currencyDonutSegments();
    expect(segments.length).toBe(4);
    const eurSegment = segments.find((s) => s.currency === 'EUR');
    const vesSegment = segments.find((s) => s.currency === 'VES');
    expect(eurSegment).toBeDefined();
    expect(eurSegment?.amountUsd).toBe(220);
    expect(vesSegment?.amountUsd).toBe(200);
  });

  it('supports BCV stress quick presets (+10%, +20%, Igualar Paralelo) and shows Tasa BCV offline when rate is 0', () => {
    financeService.addAssetVault({
      name: 'Banco Bs',
      channel: 'bs_bank',
      scope: 'personal',
      currency: 'VES',
      balance: 6000,
      balanceUsdEquivalent: 100,
      balanceVesEquivalent: 6000,
    });
    fixture.detectChanges();

    component.setStressRateMultiplier(1.2);
    expect(component.activeSimulatedBcvRate()).toBe(72);
    expect(component.bcvStressSimulation().devaluationPct).toBe(20);

    component.setStressRateMultiplier(1.1);
    expect(component.activeSimulatedBcvRate()).toBe(66);

    component.matchParallelRateInStress();
    expect(component.activeSimulatedBcvRate()).toBe(72);

    // Offline BCV must display honest offline state instead of invented 60.0
    setup({});
    expect(component.isBcvLive()).toBe(false);
    expect(component.activeSimulatedBcvRate()).toBe(0);
    const htmlText = fixture.nativeElement.textContent as string;
    expect(htmlText).toContain('Tasa BCV offline');
  });

  it('masks monetary figures when privacyMode input is true and exposes VET heatmap + CFO signals', () => {
    financeService.addAssetVault({
      name: 'Zelle USD',
      channel: 'zelle',
      scope: 'personal',
      currency: 'USD',
      balance: 1250,
      balanceUsdEquivalent: 1250,
      balanceVesEquivalent: 75000,
    });
    seedIncome(1, 500, 'salary');
    seedExpense(0, 75, 'groceries');

    fixture.detectChanges();
    expect(component.weeklyHeatmap().length).toBe(7);
    expect(component.peakSpendingDay()?.totalSpentUsd).toBe(75);
    expect(component.cfoInsights().length).toBeGreaterThan(0);

    fixture.componentRef.setInput('privacyMode', true);
    fixture.detectChanges();
    const maskedText = fixture.nativeElement.textContent as string;
    expect(maskedText).toContain('••••');
    expect(maskedText).not.toContain('$500.00');
  });
});
