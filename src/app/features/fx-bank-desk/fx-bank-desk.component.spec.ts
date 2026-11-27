import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { FxBankDeskComponent } from './fx-bank-desk.component';
import { AccountsService } from '../../core/accounts.service';
import { CotizaveService } from '../../core/cotizave.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { TelegramWorkerService, type FxSettlementLedgerEntry } from '../../core/telegram-worker.service';
import { AudioAlertsService } from '../../core/audio-alerts.service';
import { ToastService } from '../../core/toast.service';
import { FX_DESK_MODALITIES, type BankAccount, type Operation } from '@p2p/core';

describe('FxBankDeskComponent — Spatial Liquid Glass v2.0 Cockpit', () => {
  let fixture: ComponentFixture<FxBankDeskComponent>;
  let component: FxBankDeskComponent;
  let mockModality = signal<'MENUDEO_BCV' | 'MESA_CAMBIO_PACTO' | 'TAQUILLA_EFECTIVO_OTC'>(
    FX_DESK_MODALITIES.MENUDEO_BCV,
  );
  let mockIgtf = signal<number>(3.0);
  let mockFluid = signal<string[]>([]);
  let mockDepleted = signal<string[]>([]);
  let mockRails = signal<Record<string, string>>({});
  let mockHistory = signal<FxSettlementLedgerEntry[]>([]);
  let mockRawOps = signal<Operation[]>([]);

  const mockAccounts: BankAccount[] = [
    {
      id: 'bancamiga-tr-1',
      bankName: 'Bancamiga Transferencia',
      bankCode: 'BANCAMIGA',
      rail: 'TRANSFERENCIA',
      accountNumberMasked: '0172-***8841',
      dailyLimitVes: 300000,
      initialBalanceVes: 96400,
    },
    {
      id: 'banesco-tr-1',
      bankName: 'Banesco Jurídica A',
      bankCode: 'BANESCO',
      rail: 'TRANSFERENCIA',
      accountNumberMasked: '0134-***4821',
      dailyLimitVes: 250000,
      initialBalanceVes: 51200,
    },
    {
      id: 'banesco-tr-2',
      bankName: 'Banesco Natural B',
      bankCode: 'BANESCO',
      rail: 'TRANSFERENCIA',
      accountNumberMasked: '0134-***9104',
      dailyLimitVes: 250000,
      initialBalanceVes: 25900,
    },
  ];

  beforeEach(async () => {
    mockModality = signal(FX_DESK_MODALITIES.MENUDEO_BCV);
    mockIgtf = signal(3.0);
    mockFluid = signal(['BANCAMIGA', 'BANESCO']);
    mockDepleted = signal([]);
    mockRails = signal({});
    mockHistory = signal([]);
    mockRawOps = signal([]);

    await TestBed.configureTestingModule({
      imports: [FxBankDeskComponent],
      providers: [
        provideRouter([]),
        {
          provide: AccountsService,
          useValue: {
            accounts: signal(mockAccounts),
            rawOperations: mockRawOps,
            usages: computedMockUsages(mockAccounts),
            accountVelocities: signal([]),
            treasurySummary: signal({
              totalBalanceVes: 173500,
              totalSpentTodayVes: 0,
              totalReceivedTodayVes: 0,
              totalSpentThisMonthVes: 0,
              accountsUsage: [],
              nearLimitCount: 0,
              overLimitCount: 0,
              nearMonthlyLimitCount: 0,
              overMonthlyLimitCount: 0,
            }),
            setExactAccountBalance: vi.fn(),
            addAccount: vi.fn(),
          },
        },
        {
          provide: CotizaveService,
          useValue: {
            ratesByMarket: signal({ bcv: { mid: 62.45 } }),
            ratesProvenance: signal('live'),
            lastFetched: signal(new Date('2026-11-26T13:40:00.000Z')),
            refreshIfStale: vi.fn().mockResolvedValue(undefined),
            fetchRates: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: BinanceP2pService,
          useValue: {
            // Note: bestBuyPrice (85.90) != bestSellPrice (84.10) — v2 MUST prioritize bestSellPrice (Taker sell bid)!
            marketDepth: signal({
              bestBuyPrice: 85.9,
              bestSellPrice: 84.1,
              spreadPct: 2.1,
              spreadVes: 1.8,
            }),
            lastFetched: signal(new Date('2026-11-26T13:41:00.000Z')),
            fetchMarketDepth: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: TelegramWorkerService,
          useValue: {
            fxFluidBanks: mockFluid,
            fxDepletedBanks: mockDepleted,
            fxDepletedExpiryMap: signal({}),
            fxExitRailOverrides: mockRails,
            fxModality: mockModality,
            fxIgtfPct: mockIgtf,
            fxSettlementHistory: mockHistory,
            setFxModality: vi.fn((m) => mockModality.set(m)),
            setFxIgtfPct: vi.fn((p) => mockIgtf.set(p)),
            markFxBankFluid: vi.fn(),
            markFxBankDepleted: vi.fn(),
            setFxExitRailOverride: vi.fn((b, r) => mockRails.update((c) => ({ ...c, [b]: r }))),
            settleFxBankPurchase: vi.fn().mockReturnValue({
              operation: { id: 'fx-1' },
              operations: [{ id: 'fx-1' }],
              summary: 'Bancamiga: $1500 USD -> +1432.50 USDT',
            }),
            sendFxDeskPlanAlert: vi.fn().mockResolvedValue({ ok: true }),
            refreshFxSettlementsFromSqlite: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AudioAlertsService, useValue: { playOpportunityAlert: vi.fn() } },
        {
          provide: ToastService,
          useValue: { success: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FxBankDeskComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders Layer 1 Liquid Glass dock, 4 Finanzas-360 KPI Aura cards, 14-bank matrix, and Atomic Inspector', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.fx-liquid-glass')).toBeTruthy();
    expect(el.querySelectorAll('.fx-kpi-aura').length).toBe(4);
    expect(el.querySelector('app-fx-ticket-inspector')).toBeTruthy();
    expect(component.evaluationPlan().tickets.length).toBe(14);
  });

  it('prioritizes Binance executable Taker sell bid (bestSellPrice 84.10) over Maker ask (85.90)', () => {
    expect(component.liveP2pRate()).toBe(84.1);
  });

  it('switches between the 3 Venezuelan FX modalities and toggles 3% IGTF exemption', () => {
    component.setModality(FX_DESK_MODALITIES.TAQUILLA_EFECTIVO_OTC);
    fixture.detectChanges();
    expect(mockModality()).toBe('TAQUILLA_EFECTIVO_OTC');
    const otcBancamiga = component
      .evaluationPlan()
      .tickets.find((t) => t.bank.id === 'BANCAMIGA')!;
    expect(otcBancamiga.igtfPct).toBe(0);

    component.setModality(FX_DESK_MODALITIES.MENUDEO_BCV);
    component.toggleIgtfExemption();
    fixture.detectChanges();
    expect(mockIgtf()).toBe(0);
  });

  it('separates purchased bank USD from post-friction net USDT in totalSettledToday (B-09 fix)', () => {
    const nowIso = new Date().toISOString();
    mockRawOps.set([
      {
        id: 'op-fx-today',
        timestamp: nowIso,
        type: 'buy',
        pair: 'USDT',
        vesAmount: 62450,
        usdtAmount: 955, // net after 4.5% IGTF + rail friction
        price: 65.39,
        merchantNote: 'MESA_BCV:Bancamiga:USD=1000',
        fees: 156.13,
        notes: '',
        errorFree: true,
        bankAccountId: 'bancamiga-tr-1',
      },
    ]);
    fixture.detectChanges();

    const settled = component.totalSettledToday();
    expect(settled.totalUsd).toBe(1000);
    expect(settled.totalNetUsdt).toBe(955);
    expect(settled.opsCount).toBe(1);
  });

  it('supports accessible ARIA tablist filtering and selecting multi-account split tickets into Inspector', () => {
    component.selectBankForInspector('BANESCO');
    fixture.detectChanges();
    const selected = component.selectedInspectorTicket();
    expect(selected).not.toBeNull();
    expect(selected!.bank.id).toBe('BANESCO');
    expect(selected!.accountAllocations.length).toBe(2);

    const el = fixture.nativeElement as HTMLElement;
    const tablist = el.querySelector('[role="tablist"]');
    const tabpanel = el.querySelector('[role="tabpanel"]');
    expect(tablist).toBeTruthy();
    expect(tabpanel).toBeTruthy();
  });
});

function computedMockUsages(accounts: BankAccount[]) {
  return signal(
    accounts.map((account) => ({
      account,
      spentTodayVes: 0,
      receivedTodayVes: 0,
      currentBalanceVes: account.initialBalanceVes,
      consumedLimitPct: 0,
      remainingLimitVes: account.dailyLimitVes,
      isNearLimit: false,
      isOverLimit: false,
      spentThisMonthVes: 0,
      consumedMonthlyLimitPct: 0,
      isNearMonthlyLimit: false,
      isOverMonthlyLimit: false,
    })),
  );
}
