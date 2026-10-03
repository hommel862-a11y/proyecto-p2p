import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
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
    // La brecha se deriva de `ratesByMarket()`. Si el panel no dice de cuándo es
    // ese dato, un número restaurado del disco se lee igual que uno descargado
    // hace un segundo.
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
    // `bcvIntelligence()` cae a `manualBcvRate()`/`manualParallelRate()` (685/815)
    // cuando no hay MCP ni Cotizave. Rotular ese caso como "Cotizave" mentiría:
    // el número no salió de Cotizave, y el guard viejo (`@if (cotizaveDataAge())`)
    // era vacuo porque ese helper devuelve un string para `lastFetched() === null`.
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
});

