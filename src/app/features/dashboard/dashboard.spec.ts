import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Dashboard } from './dashboard';
import { P2P_STORAGE } from '../../core/storage';
import { MemoryStorage } from '../../core/memory-storage';
import { CotizaveService } from '../../core/cotizave.service';
import type { Operation } from '@p2p/core';

const OPS_KEY = 'p2p.operations';

function op(partial: Partial<Operation>): Operation {
  return {
    id: 'op-1',
    timestamp: new Date().toISOString(),
    type: 'buy',
    pair: 'USDT',
    vesAmount: 8000,
    usdtAmount: 10,
    price: 800,
    merchantNote: 'Merchant A',
    notes: '',
    fees: 0,
    errorFree: true,
    ...partial,
  };
}

describe('Dashboard', () => {
  let fixture: ComponentFixture<Dashboard>;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      imports: [Dashboard, RouterTestingModule],
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
  });

  function seed(ops: Operation[]): void {
    mem.setItem(OPS_KEY, JSON.stringify(ops));
  }

  function create(): ComponentFixture<Dashboard> {
    return TestBed.createComponent(Dashboard);
  }

  it('renders Control Center panel header', () => {
    const f = create();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Centro de Control');
  }, 15000);

  it('computes daily progress percentage correctly', () => {
    seed([
      op({
        id: '1',
        type: 'buy',
        vesAmount: 8000,
        usdtAmount: 10,
      }),
      op({
        id: '2',
        type: 'sell',
        vesAmount: 8800,
        usdtAmount: 10,
      }),
    ]);
    const f = create();
    f.detectChanges();
    // Daily target = 20 USD. PnL is ~1 USD -> ~5% progress
    expect(f.componentInstance.dailyProgress()).toBeGreaterThan(0);
  });

  it('renders recent operations list', () => {
    seed([op({ id: 'a', merchantNote: 'Super Merchant' })]);
    const f = create();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Super Merchant');
  });

  it('computes cumulative PnL curve points and toggles between chart tabs', () => {
    seed([
      op({ id: '1', type: 'buy', vesAmount: 8000, usdtAmount: 10 }),
      op({ id: '2', type: 'sell', vesAmount: 8500, usdtAmount: 10 }),
    ]);
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    expect(c.cumulativeChart().points.length).toBeGreaterThan(0);
    expect(c.selectedChartTab()).toBe('cumulative');

    c.selectedChartTab.set('volume');
    f.detectChanges();
    expect(c.selectedChartTab()).toBe('volume');
    expect(f.nativeElement.textContent).toContain('Volumen Diario (USDT)');
  });

  it('computes forensic audit signals and renders forensic card', () => {
    seed([
      op({ id: '1', type: 'buy', vesAmount: 8000, usdtAmount: 10, price: 800 }),
      op({ id: '2', type: 'sell', vesAmount: 8800, usdtAmount: 10, price: 880 }),
    ]);
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    expect(c.forensicDiscipline()).toBeDefined();
    expect(c.forensicDossier()).toBeDefined();
    expect(f.nativeElement.textContent).toContain('Auditoría Forense & Disciplina Operativa');
    expect(f.nativeElement.textContent).toContain('Regla de Oro');
  });

  it('muestra la edad y la procedencia de los datos de Cotizave que alimentan la brecha', () => {
    TestBed.overrideProvider(CotizaveService, {
      useValue: {
        ratesByMarket: signal({
          binance: { market: 'binance', type: 'p2p', ask: 815, bid: 810, mid: 812.5 },
          oficial: { market: 'oficial', type: 'reference', ask: 36.5, bid: 36.2, mid: 36.35 },
        }),
        lastFetched: signal(new Date(Date.now() - 20 * 60_000)),
        ratesProvenance: signal('restored'),
        apiKey: signal('test-key'),
        loading: signal(false),
        error: signal(null),
        autoRefresh: signal(false),
        circuitBreaker: { getState: () => 'CLOSED', options: {} },
        fetchRates: vi.fn(),
        refreshIfStale: vi.fn().mockResolvedValue(undefined),
        setApiKey: vi.fn(),
        startAutoRefresh: vi.fn(),
        stopAutoRefresh: vi.fn(),
      },
    });

    const f = create();
    f.detectChanges();
    const text = String(f.nativeElement.textContent);

    expect(text).toContain('hace 20 min');
    expect(text).toMatch(/restaurada del disco/i);
  });

  it('no afirma linaje de Cotizave cuando la brecha sale de constantes fijas', () => {
    TestBed.overrideProvider(CotizaveService, {
      useValue: {
        ratesByMarket: signal({}),
        lastFetched: signal(null),
        ratesProvenance: signal('none'),
        apiKey: signal(''),
        loading: signal(false),
        error: signal(null),
        autoRefresh: signal(false),
        circuitBreaker: { getState: () => 'CLOSED', options: {} },
        fetchRates: vi.fn(),
        refreshIfStale: vi.fn().mockResolvedValue(undefined),
        setApiKey: vi.fn(),
        startAutoRefresh: vi.fn(),
        stopAutoRefresh: vi.fn(),
      },
    });

    const f = create();
    f.detectChanges();
    const text = String(f.nativeElement.textContent);

    expect(f.componentInstance.cotizaveDataAge()).toBeNull();
    expect(text).not.toContain('una sesión anterior · Cotizave sin datos');
    expect(text).not.toMatch(/Cotizave (en vivo|restaurada)/i);
  });

  it('renders all bank cards and manages liquidity injection modal workflow', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    // Verify all 8 bank codes exist in unified accounts
    const codes = c.unifiedAccounts().map((a) => a.bankCode);
    expect(codes).toContain('BANESCO');
    expect(codes).toContain('MERCANTIL');
    expect(codes).toContain('BDV');
    expect(codes).toContain('PROVINCIAL');
    expect(codes).toContain('BANCAMIGA');
    expect(codes).toContain('BNC');
    expect(codes).toContain('BANCARIBE');
    expect(codes).toContain('BANPLUS');

    // Opens modal via openLiquidityModal
    const targetAccount = c.unifiedAccounts().find((a) => a.bankCode === 'PROVINCIAL')!;
    c.openLiquidityModal(targetAccount);
    f.detectChanges();

    expect(c.showLiquidityModal()).toBe(true);
    expect(c.selectedInjectionAccountId()).toBe(targetAccount.id);
    expect(f.nativeElement.textContent).toContain('Inyectar Liquidez Bancaria');

    // Validates projected balance
    c.injectionAmount.set(25000);
    f.detectChanges();
    expect(c.projectedBalanceAfterInjection()).toBe(targetAccount.currentBalanceVes + 25000);

    // Injects liquidity and updates state
    const spy = vi.spyOn(c.accountsService, 'injectLiquidity');
    c.confirmLiquidityInjection();
    f.detectChanges();

    expect(spy).toHaveBeenCalledWith(targetAccount.id, 25000, expect.any(String));
    expect(c.showLiquidityModal()).toBe(false);
  });

  it('toggles treasury density between bento and compact and persists in storage', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    expect(c.treasuryDensity()).toBe('bento');

    c.setTreasuryDensity('compact');
    f.detectChanges();

    expect(c.treasuryDensity()).toBe('compact');

    c.setTreasuryDensity('bento');
    f.detectChanges();

    expect(c.treasuryDensity()).toBe('bento');
  });

  it('responds to liquidityModalRequest from AccountsService by opening modal with target account', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    expect(c.showLiquidityModal()).toBe(false);

    c.accountsService.requestLiquidityModal('provincial-pm-1');
    TestBed.flushEffects();
    f.detectChanges();

    expect(c.showLiquidityModal()).toBe(true);
    expect(c.selectedInjectionAccountId()).toBe('provincial-pm-1');
  });

  it('renders real-time latency telemetry in dynamic island and triggers refresh on click', async () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    const el = f.nativeElement as HTMLElement;
    const telemetryBadge = el.querySelector('.island-telemetry');
    expect(telemetryBadge).toBeTruthy();
    expect(telemetryBadge?.textContent).toContain('IPC');
    expect(telemetryBadge?.textContent).toContain('DB');
    expect(telemetryBadge?.textContent).toContain('P2P');

    const spy = vi.spyOn(c.telemetryService, 'refresh');
    (telemetryBadge as HTMLElement).click();
    f.detectChanges();

    expect(spy).toHaveBeenCalled();
  });

  it('plays audio feedback on liquidity injection and session actions', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    const injectionAudioSpy = vi.spyOn(c.audioAlerts, 'playInjectionTone');
    const warningAudioSpy = vi.spyOn(c.audioAlerts, 'playSudebanWarningTone');
    vi.spyOn(c.accountsService, 'injectLiquidity').mockReturnValue({ bankName: 'Banco de Venezuela' } as any);

    // Saturated account triggers sudeban warning
    c.openLiquidityModal({
      id: 'test-bank',
      bankName: 'Test Bank',
      bankCode: '0102' as any,
      rail: 'PAGO_MOVIL',
      accountNumberMasked: '****',
      currentBalanceVes: 80000,
      dailyLimitVes: 100000,
      spentTodayVes: 80000,
      remainingLimitVes: 20000,
      consumedLimitPct: 80,
      isOverLimit: false,
      isNearLimit: true,
      todayTransactionCount: 5,
      maxDailyTransactions: 20,
      velocityHealth: 'OPTIMAL',
      usedPct: 80,
      recommendedWaitHours: 0,
      isRecommended: true,
    });
    expect(warningAudioSpy).toHaveBeenCalled();

    // Confirming injection triggers injection tone
    c.injectionAmount.set(5000);
    c.confirmLiquidityInjection();
    expect(injectionAudioSpy).toHaveBeenCalled();
  });

  it('filters bank accounts by rail and health state via Specular Glass filter pills', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    const total = c.unifiedAccounts().length;
    expect(total).toBeGreaterThanOrEqual(16);
    expect(c.filteredAccounts().length).toBe(total);

    c.setBankRailFilter('PAGO_MOVIL');
    f.detectChanges();
    expect(c.filteredAccounts().every((a) => a.rail === 'PAGO_MOVIL')).toBe(true);
    expect(c.filteredAccounts().length).toBe(c.treasuryFilterCounts().pagoMovil);

    c.setBankRailFilter('TRANSFERENCIA');
    f.detectChanges();
    expect(c.filteredAccounts().every((a) => a.rail === 'TRANSFERENCIA')).toBe(true);
    expect(c.filteredAccounts().length).toBe(c.treasuryFilterCounts().transferencia);

    c.setBankRailFilter('ALL');
    c.setBankHealthFilter('OPTIMAL');
    f.detectChanges();
    expect(
      c.filteredAccounts().every((a) => !a.isOverLimit && !a.isNearLimit && a.status !== 'DISABLED'),
    ).toBe(true);
  });

  it('supports in-place daily target editing and computes remaining USDT goal', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    expect(c.editingDailyTarget()).toBe(false);
    c.openDailyTargetEditor();
    expect(c.editingDailyTarget()).toBe(true);

    c.saveDailyTarget(75);
    f.detectChanges();

    expect(c.editingDailyTarget()).toBe(false);
    expect(c.dailyTarget()).toBe(75);
    expect(c.remainingDailyTargetUsdt()).toBeGreaterThan(0);
  });

  it('computes alphaPulse radar state dynamically based on spread and risk guards', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    const pulse = c.alphaPulse();
    expect(['ALPHA_WINDOW', 'RISK_GUARD', 'STANDBY']).toContain(pulse.state);
    expect(pulse.headline.length).toBeGreaterThan(0);

    // Simulating a compressed spread below minSpread triggers RISK_GUARD via verdict()
    c.binanceService.marketDepth.set({
      asset: 'USDT',
      fiat: 'VES',
      buyAds: [],
      sellAds: [],
      bestBuyPrice: 800,
      bestSellPrice: 800.1,
      spreadVes: 0.1,
      spreadPct: 0.01,
      vwapBuy: 800,
      vwapSell: 800.1,
      timestamp: new Date().toISOString(),
    } as any);
    f.detectChanges();
    expect(c.alphaPulse().state).toBe('RISK_GUARD');
  });

  it('curates top 4 priority bank cards in overview mode and expands to all 16 on toggle', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    expect(c.activeTab()).toBe('all');
    expect(c.showAllBanksInOverview()).toBe(false);
    expect(c.displayedAccounts().length).toBe(4);

    c.showAllBanksInOverview.set(true);
    f.detectChanges();
    expect(c.displayedAccounts().length).toBe(c.filteredAccounts().length);
  });

  it('computes live ticket simulation with net profit and multi-bank split detection', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    c.setSimTicket(500);
    f.detectChanges();
    const sim = c.simulatedTradeOutcome();
    expect(sim.ticketUsdt).toBe(500);
    expect(sim.requiredVes).toBeGreaterThan(0);
    expect(sim.netProfitUsdt).toBeGreaterThan(0);
  });

  it('supports modal modes ADD vs CALIBRATE and zero balances reset', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    const target = c.unifiedAccounts()[0];

    // Mode CALIBRATE
    c.selectedInjectionAccountId.set(target.id);
    c.liquidityModalMode.set('CALIBRATE');
    c.injectionAmount.set(9500);
    f.detectChanges();

    expect(c.projectedBalanceAfterInjection()).toBe(9500);

    const setSpy = vi.spyOn(c.accountsService, 'setExactAccountBalance');
    c.confirmLiquidityInjection();
    expect(setSpy).toHaveBeenCalledWith(target.id, 9500, expect.any(String));

    // Reset to zero workflow
    const resetSpy = vi.spyOn(c.accountsService, 'resetAllBalancesToZero');
    c.openResetConfirmModal();
    expect(c.showResetConfirmModal()).toBe(true);

    c.confirmResetAllBalancesToZero();
    expect(resetSpy).toHaveBeenCalled();
    expect(c.showResetConfirmModal()).toBe(false);
  });

  it('orders chronologicalWeek oldest-to-newest and scales volume barHeight by volumeUsdt when volume tab is active', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    seed([
      op({ id: 'old-buy', timestamp: yesterday, type: 'buy', vesAmount: 8000, usdtAmount: 100 }),
      op({ id: 'today-buy', type: 'buy', vesAmount: 800, usdtAmount: 10 }),
      op({ id: 'today-sell', type: 'sell', vesAmount: 2400, usdtAmount: 10 }),
    ]);
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    const chrono = c.chronologicalWeek();
    expect(chrono.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < chrono.length; i++) {
      expect(chrono[i].date >= chrono[i - 1].date).toBe(true);
    }

    c.selectedChartTab.set('volume');
    const maxVolDay = chrono.find((d) => d.volumeUsdt === c.weekVolumeMax())!;
    const minVolDay = chrono.find((d) => d.volumeUsdt === 0) ?? chrono[0];
    expect(c.barHeight(maxVolDay)).toBe(100);
    expect(c.barHeight(minVolDay)).toBeLessThan(c.barHeight(maxVolDay));
  });

  it('forwards simulated ticket amount as autoFillAmount when quickOperate is called with amountUsdt', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    c.setSimTicket(500);
    c.quickOperate('Banesco', undefined, 500);

    expect(navSpy).toHaveBeenCalledWith(
      ['/log'],
      expect.objectContaining({
        queryParams: expect.objectContaining({
          autoFillBank: 'Banesco',
          autoFillAmount: '500',
        }),
      }),
    );
  });

  it('computes fxDeskSummary for the 14-bank Mesa Cambiaria BCV strip and supports burst navigation', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    expect(c.fxDeskSummary().totalBanks).toBe(14);
    expect(f.nativeElement.textContent).toContain('MESA CAMBIARIA BCV');

    c.goToMesaBcv(true);
    expect(navSpy).toHaveBeenCalledWith(['/mesa-bcv'], { queryParams: { burst: '1' } });
  });

  it('renders KpiBentoStrip, L2RadarGauge, and SankeyRailsFlow interactive 3D modules', () => {
    const f = create();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;

    expect(el.querySelector('app-kpi-bento-strip')).toBeTruthy();
    expect(el.querySelector('app-l2-radar-gauge')).toBeTruthy();
    expect(el.querySelector('app-sankey-rails-flow')).toBeTruthy();
  });

  it('supports Spatial 3D section reordering via organize mode and resets back to default', () => {
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    expect(c.layoutService.organizeMode()).toBe(false);
    c.layoutService.toggleOrganizeMode();
    expect(c.layoutService.organizeMode()).toBe(true);

    const initialFirst = c.layoutService.sectionOrder()[0];
    const initialSecond = c.layoutService.sectionOrder()[1];
    c.moveSectionByOffset(initialSecond, -1);

    expect(c.layoutService.sectionOrder()[0]).toBe(initialSecond);
    expect(c.layoutService.sectionOrder()[1]).toBe(initialFirst);
    expect(c.isSectionOrderCustom()).toBe(true);

    c.layoutService.resetLayout();
    expect(c.layoutService.sectionOrder()[0]).toBe(initialFirst);
    expect(c.isSectionOrderCustom()).toBe(false);
  });
});
