import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { SpreadMonitor } from './spread-monitor';
import { RisksService } from '../../core/rules';
import { P2P_STORAGE } from '../../core/storage';
import { MemoryStorage } from '../../core/memory-storage';
import { CotizaveService } from '../../core/cotizave.service';
import { CredentialStoreService } from '../../core/credential-store.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import type { BinanceP2pMarketDepth } from '@p2p/core';

const DEFAULT_RISK = {
  minSpread: 15,
  maxConcurrentOps: 3,
  maxRiskPerTradePct: 1,
  dailyLossCapPct: 4,
  maxConsecutiveErrors: 3,
  apiStatus: 'ok' as const,
};

const LIVE_DEPTH: BinanceP2pMarketDepth = {
  asset: 'USDT',
  fiat: 'VES',
  bestBuyPrice: 815,
  bestSellPrice: 820,
  spreadVes: 5,
  spreadPct: 0.61,
  buyOffers: [],
  sellOffers: [],
  updatedAt: '2026-09-29T12:00:00.000Z',
};

describe('SpreadMonitor', () => {
  let fixture: ComponentFixture<SpreadMonitor>;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      imports: [SpreadMonitor],
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
    TestBed.inject(RisksService).save({ ...DEFAULT_RISK });
  });

  function create(): ComponentFixture<SpreadMonitor> {
    return TestBed.createComponent(SpreadMonitor);
  }

  it('Scenario A (verified): buy 800 / sell 820 / 25 USDT => +500 Bs, favorable alert', () => {
    const f = create();
    const c = f.componentInstance;
    c.buyPrice.set(800);
    c.sellPrice.set(820);
    c.amount.set(25);
    c.unit.set('USDT');
    c.commissionPct.set(0);
    c.threshold.set(15);
    f.detectChanges();

    expect(c.usdtReceived()).toBe(25);
    expect(c.vesReceived()).toBe(20500);
    expect(c.unitSpread()).toBe(20);
    expect(c.gainVes()).toBe(500);
    expect(c.netVesAfterCommission()).toBe(20500);
    expect(c.alert().kind).toBe('favorable');
    expect(f.nativeElement.textContent).toContain('500');
    expect(f.nativeElement.textContent).toContain('Favorable');
  }, 15000);

  it('Scenario D (commission 0.35%): net VES = 20,500 * (1 - 0.0035) = 20,428.25', () => {
    const f = create();
    const c = f.componentInstance;
    c.buyPrice.set(800);
    c.sellPrice.set(820);
    c.amount.set(25);
    c.unit.set('USDT');
    c.commissionPct.set(0.35);
    f.detectChanges();
    expect(c.netVesAfterCommission()).toBe(20428.25);
  });

  it('Scenario B (VES input): VES 20,000 => 25 USDT received, 20,500 VES received', () => {
    const f = create();
    const c = f.componentInstance;
    c.buyPrice.set(800);
    c.sellPrice.set(820);
    c.amount.set(20000);
    c.unit.set('VES');
    f.detectChanges();
    expect(c.usdtReceived()).toBe(25);
    expect(c.vesReceived()).toBe(20500);
  });

  it('unfavorable alert when unit spread < risk-rules minSpread', () => {
    const f = create();
    const c = f.componentInstance;
    TestBed.inject(RisksService).save({ ...DEFAULT_RISK, minSpread: 25 });
    c.buyPrice.set(800);
    c.sellPrice.set(820);
    c.amount.set(25);
    c.unit.set('USDT');
    f.detectChanges();
    expect(c.unitSpread()).toBe(20);
    expect(c.alert().kind).toBe('unfavorable');
    expect(f.nativeElement.textContent).toContain('Desfavorable');
  });

  it('Scenario E (invalid): zero/negative price => error message, no result', () => {
    const f = create();
    const c = f.componentInstance;
    c.buyPrice.set(0);
    c.sellPrice.set(820);
    c.amount.set(25);
    c.unit.set('USDT');
    f.detectChanges();
    expect(c.result()).toBeNull();
    expect(c.error()).not.toBeNull();
    expect(f.nativeElement.textContent).toContain('número positivo');
  });

  it('clampMoney template helper collapses NaN/negative entries to 0', () => {
    const f = create();
    const c = f.componentInstance;
    expect(c.clampMoney(Number.NaN)).toBe(0);
    expect(c.clampMoney(-1)).toBe(0);
    expect(c.clampMoney(820)).toBe(820);
  });

  it('toggleMcpConsole expands and collapses the Apple Dynamic Island drawer', () => {
    const f = create();
    const c = f.componentInstance;
    expect(c.mcpConsoleExpanded()).toBe(false);
    c.toggleMcpConsole();
    expect(c.mcpConsoleExpanded()).toBe(true);
    c.toggleMcpConsole();
    expect(c.mcpConsoleExpanded()).toBe(false);
  });
});

/**
 * `CotizaveService.apiKey()` se hidrata de forma ASÍNCRONA desde la bóveda de
 * credenciales. Preguntar la key una sola vez en `ngOnInit` era una carrera: se
 * ganaba o se perdía según cuándo llegara el microtask, y perder significaba
 * auto-refresh apagado para toda la sesión, con la cache envejeciendo en silencio.
 */
describe('SpreadMonitor · arranque del auto-refresh de Cotizave', () => {
  let mem: MemoryStorage;
  let fixture: ComponentFixture<SpreadMonitor>;

  function mount(storedKey: string | null): void {
    mem = new MemoryStorage();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SpreadMonitor],
      providers: [
        { provide: P2P_STORAGE, useValue: mem },
        {
          provide: CredentialStoreService,
          useValue: {
            getCotizaveApiKey: vi.fn(async () => storedKey),
            setCotizaveApiKey: vi.fn(async () => undefined),
          },
        },
      ],
    });
    TestBed.inject(RisksService).save({ ...DEFAULT_RISK });
    fixture = TestBed.createComponent(SpreadMonitor);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('arranca el auto-refresh aunque la key llegue despues de ngOnInit', async () => {
    mount('stored-key');
    const cotizave = TestBed.inject(CotizaveService);
    // Se espía ANTES del primer detectChanges: ngOnInit corre ahí.
    const startSpy = vi.spyOn(cotizave, 'startAutoRefresh').mockImplementation(() => undefined);

    fixture.detectChanges();
    // En este punto la key todavía no llegó: es exactamente la carrera.
    expect(cotizave.apiKey()).toBe('');

    await vi.waitFor(() => expect(cotizave.apiKey()).toBe('stored-key'));
    fixture.detectChanges();

    expect(startSpy).toHaveBeenCalled();
  });

  it('no arranca el auto-refresh sin key', async () => {
    mount(null);
    const cotizave = TestBed.inject(CotizaveService);
    const startSpy = vi.spyOn(cotizave, 'startAutoRefresh').mockImplementation(() => undefined);
    const stopSpy = vi.spyOn(cotizave, 'stopAutoRefresh').mockImplementation(() => undefined);

    fixture.detectChanges();
    // Un ciclo extra para que no dependa del orden de microtasks.
    await Promise.resolve();
    fixture.detectChanges();

    expect(startSpy).not.toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
  });
});

/**
 * Los gaps de la tabla de triangulación se calculan sobre `ratesByMarket()`, que
 * no dice de dónde salió. `rate.updated_at` es el sello del upstream POR TASA y
 * llega `undefined` cuando Cotizave lo omite, así que no puede servir como reloj
 * del fetch: sin edad y procedencia, un número restaurado del disco se ve
 * igual que uno recién descargado.
 */
describe('SpreadMonitor · linaje de Cotizave en la triangulacion', () => {
  let mem: MemoryStorage;
  let fixture: ComponentFixture<SpreadMonitor>;

  function mount(
    overrides?: {
      provenance?: 'live' | 'restored';
      /** Cotizave sin datos: sin reloj y sin tasas, que es el estado real de `none`. */
      noData?: boolean;
    },
  ): void {
    mem = new MemoryStorage();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SpreadMonitor],
      providers: [
        { provide: P2P_STORAGE, useValue: mem },
        {
          provide: CredentialStoreService,
          useValue: {
            getCotizaveApiKey: vi.fn(async () => 'stored-key'),
            setCotizaveApiKey: vi.fn(async () => undefined),
          },
        },
        {
          provide: BinanceP2pService,
          useValue: {
            marketDepth: () => LIVE_DEPTH,
            lastFetched: () => new Date('2026-09-29T12:00:00.000Z'),
            selectedBank: () => 'Banesco',
            setBankFilter: vi.fn(),
            fetchMarketDepth: vi.fn(async () => null),
            startAutoRefresh: vi.fn(),
            stopAutoRefresh: vi.fn(),
            autoRefresh: () => false,
            selectedPair: () => 'USDT',
            currentBank: signal('Banesco'),
            offers: signal([]),
            ads: signal([]),
            loading: signal(false),
            error: signal(null),
          },
        },
        {
          provide: CotizaveService,
          useValue: {
            apiKey: signal('test-key'),
            loading: signal(false),
            error: signal(null),
            // `none` sin tasas es el estado real del servicio; dejar una tasa
            // puesta con procedencia `none` sería un estado imposible y el test
            // probaría el stub, no el componente.
            ratesByMarket: signal(
              overrides?.noData
                ? {}
                : { bcv: { market: 'bcv', type: 'oficial', ask: 36.5, bid: 36.2, mid: 36.35 } },
            ),
            lastFetched: signal(overrides?.noData ? null : new Date(Date.now() - 20 * 60_000)),
            ratesProvenance: signal(overrides?.noData ? 'none' : (overrides?.provenance ?? 'restored')),
            autoRefresh: signal(false),
            startAutoRefresh: vi.fn(),
            stopAutoRefresh: vi.fn(),
            fetchRates: vi.fn(),
            setApiKey: vi.fn(),
            circuitBreaker: { getState: () => 'CLOSED', options: {} },
          },
        },
      ],
    });
    TestBed.inject(RisksService).save({ ...DEFAULT_RISK });
    fixture = TestBed.createComponent(SpreadMonitor);
  }

  it('cada fila de la triangulacion lleva la procedencia y la edad del fetch', () => {
    mount();
    fixture.detectChanges();
    const rows = fixture.componentInstance.triangulationData();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].provenance).toBe('restored');
    expect(rows[0].dataAge).toContain('hace 20 min');
  });

  it('la plantilla muestra el linaje de Cotizave sobre la tabla de triangulacion', () => {
    mount();
    // La tabla vive dentro de un sub-tab que arranca en otro valor.
    fixture.componentInstance.analyticsSubTab.set('triangulation');
    fixture.detectChanges();

    const text = String(fixture.nativeElement.textContent);
    expect(text).toMatch(/restaurada del disco/i);
    expect(text).toMatch(/hace 20 min/i);
  });

  it('no inventa un linaje cuando Cotizave no tiene datos', () => {
    mount({ noData: true });
    fixture.componentInstance.analyticsSubTab.set('triangulation');
    fixture.detectChanges();

    // Sin datos de Cotizave la tabla no se renderiza, así que no puede haber
    // una línea de procedencia afirmandon que la tasa es de Cotizave.
    expect(fixture.componentInstance.triangulationLineage()).toBeNull();
    expect(String(fixture.nativeElement.textContent)).not.toMatch(/Cotizave (en vivo|restaurada)/i);
  });
});
