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
import { BybitP2pService } from '../../core/bybit-p2p.service';
import type { BinanceP2pMarketDepth, CotizaveRate } from '@p2p/core';

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
            getBybitCredentials: vi.fn(async () => null),
            setBybitCredentials: vi.fn(async () => undefined),
            // El componente inyecta `BybitP2pService`, que al construirse pide
            // sus credenciales. Sin esto el servicio real lanza un `TypeError`
            // diferido que ensucia el run entero con errores no manejados.
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
            getBybitCredentials: vi.fn(async () => null),
            setBybitCredentials: vi.fn(async () => undefined),
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
          // Este bloque no prueba brechas, pero el componente ahora inyecta
          // Bybit, asi que el servicio real no puede quedar sin sustituir.
          provide: BybitP2pService,
          useValue: {
            configured: signal(false),
            mode: signal('demo' as const),
            statusText: signal(''),
            loading: signal(false),
            lastFetched: signal<Date | null>(null),
            buyPrice: signal(808.5),
            sellPrice: signal(813),
            bestSellOffer: signal(null),
            bestBuyOffer: signal(null),
            refresh: vi.fn(),
            saveCredentials: vi.fn(),
            clearCredentials: vi.fn(),
            setDemoPrices: vi.fn(),
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

/**
 * "Solo brechas ejecutables".
 *
 * El counterfactual está en el comentario de cada caso: estos tests se
 * escribieron PRIMERO contra el código sin arreglar, usando solo la superficie
 * publica, y fallaron asi:
 *
 *   - brecha hacia adelante: `expected null to be 1`
 *   - brecha inversa:       `expected null to be 10`
 *   - fila de Bybit en demo: `expected 'bybit---- --  -- Sin brecha' to match /demo/i`
 *   - fila de bitget:        `expected 'bitget---- --  -- Sin brecha' to contain '959,20'`
 *   - BCV:                   `expected 'oficial---- --  -- Sin brecha' to match /referencia/i`
 *   - unico venue con brecha: `expected [] to deeply equal [ 'bybit' ]`
 *
 * La razon de fondo: el payload real de `GET /v1/fx/rates` (con `X-API-Key`)
 * devuelve SOLO `mid` por tasa. No hay `ask` ni `bid` en ninguna parte. El
 * codigo anterior restaba `rate.bid` (siempre `undefined`) contra el libro de
 * Binance, asi que la tabla mostraba `--` en todas partes y ninguna brecha,
 * mientras la fila seellia como si sus numeros fueran comparables.
 */
describe('SpreadMonitor · solo brechas ejecutables (Binance <-> Bybit)', () => {
  let fixture: ComponentFixture<SpreadMonitor>;

  /**
   * Payload real de `/v1/fx/rates`: cada tasa trae `mid` y nada mas. Las claves
   * son las que produce `normalizeMarketKey`: `reference` ya llega como
   * `oficial` y el paralelo como `parallel`.
   */
  const REAL_RATES: Record<string, CotizaveRate> = {
    binance: { market: 'binance', type: 'p2p', mid: 812.4 },
    oficial: { market: 'oficial', type: 'reference', mid: 857.8876 },
    parallel: { market: 'parallel', type: 'parallel', mid: 958.58 },
    bybit: { market: 'bybit', type: 'p2p', mid: 813.1 },
    bitget: { market: 'bitget', type: 'p2p', mid: 959.2 },
    okx: { market: 'okx', type: 'p2p', mid: 812.9 },
    saldo: { market: 'saldo', type: 'p2p', mid: 811.7 },
  };

  const LIVE_BYBIT = {
    mode: 'live' as const,
    /** Lo que se PAGA en Bybit. */
    payPrice: 810,
    /** Lo que se RECIBE en Bybit. */
    receivePrice: 816,
    lastFetched: new Date('2026-09-29T12:00:10.000Z'),
    offers: true,
  };

  /** Estado real de arranque: modo demo, con los defaults 808.5 / 813.0 escritos a mano. */
  const DEMO_BYBIT = {
    mode: 'demo' as const,
    payPrice: 808.5,
    receivePrice: 813.0,
    lastFetched: null,
    offers: false,
  };

  function bybitStub(state: typeof DEMO_BYBIT | typeof LIVE_BYBIT) {
    return {
      configured: signal(state.mode === 'live'),
      mode: signal(state.mode),
      statusText: signal(''),
      loading: signal(false),
      lastFetched: signal<Date | null>(state.lastFetched),
      // Defaults reales del servicio. El gate NO debe tocarlos: son constantes
      // de demo escritas a mano y no un libro de ordenes.
      buyPrice: signal(state.payPrice),
      sellPrice: signal(state.receivePrice),
      bestSellOffer: signal(state.offers ? { price: state.payPrice, id: 's1' } : null),
      bestBuyOffer: signal(state.offers ? { price: state.receivePrice, id: 'b1' } : null),
      refresh: vi.fn(),
      saveCredentials: vi.fn(),
      clearCredentials: vi.fn(),
      setDemoPrices: vi.fn(),
    };
  }

  function mount(opts: {
    depth?: BinanceP2pMarketDepth | null;
    bybit: typeof DEMO_BYBIT | typeof LIVE_BYBIT;
    rates?: Record<string, CotizaveRate>;
  }): ComponentFixture<SpreadMonitor> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SpreadMonitor],
      providers: [
        { provide: P2P_STORAGE, useValue: new MemoryStorage() },
        {
          provide: CredentialStoreService,
          useValue: {
            getCotizaveApiKey: vi.fn(async () => 'stored-key'),
            setCotizaveApiKey: vi.fn(async () => undefined),
            getBybitCredentials: vi.fn(async () => null),
            setBybitCredentials: vi.fn(async () => undefined),
          },
        },
        {
          provide: BinanceP2pService,
          useValue: {
            marketDepth: () => (opts.depth === undefined ? LIVE_DEPTH : opts.depth),
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
        { provide: BybitP2pService, useValue: bybitStub(opts.bybit) },
        {
          provide: CotizaveService,
          useValue: {
            apiKey: signal('test-key'),
            loading: signal(false),
            error: signal(null),
            ratesByMarket: signal(opts.rates ?? REAL_RATES),
            lastFetched: signal(new Date(Date.now() - 3 * 60_000)),
            ratesProvenance: signal('live'),
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
    fixture.componentInstance.analyticsSubTab.set('triangulation');
    fixture.detectChanges();
    return fixture;
  }

  function row(market: string) {
    return fixture.componentInstance.triangulationData().find((r) => r.market === market);
  }

  function rowText(market: string): string {
    const tr = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'),
    ).find((el) => (el.textContent ?? '').toLowerCase().includes(market));
    return String(tr?.textContent ?? '');
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con dos libros en vivo, la brecha hacia adelante es real', () => {
    mount({ bybit: LIVE_BYBIT });
    // 816 (se recibe en Bybit) - 815 (se paga en Binance) = 1.00
    expect(row('bybit')?.gapForward.gapVes).toBe(1);
  });

  it('con dos libros en vivo, la brecha inversa también es real', () => {
    mount({ bybit: LIVE_BYBIT });
    // 820 (se recibe en Binance) - 810 (se paga en Bybit) = 10.00
    expect(row('bybit')?.gapReverse.gapVes).toBe(10);
  });

  it('solo el venue con dos libros puede emitir una brecha', () => {
    mount({ bybit: LIVE_BYBIT });
    const conBrecha = fixture.componentInstance
      .triangulationData()
      .filter((r) => r.gapForward.gapVes !== null || r.gapReverse.gapVes !== null)
      .map((r) => r.market);
    expect(conBrecha).toEqual(['bybit']);
  });

  it('Bybit en modo demo no produce ninguna brecha', () => {
    mount({ bybit: DEMO_BYBIT });
    expect(row('bybit')?.gapForward.gapVes).toBeNull();
    expect(row('bybit')?.gapReverse.gapVes).toBeNull();
  });

  it('la fila de Bybit en demo DICE que la cotización no es en vivo', () => {
    mount({ bybit: DEMO_BYBIT });
    // El defecto original mostraba `bybit---- --  -- Sin brecha`: dos gaps
    // ausentes y un chip "Sin brecha" que no distingue "no aplica" de
    // "todavia no llego el dato".
    expect(rowText('bybit')).toMatch(/demo/i);
  });

  it('un venue solo-Cotizave no tiene ninguna brecha', () => {
    mount({ bybit: DEMO_BYBIT });
    expect(row('bitget')?.gapForward.gapVes).toBeNull();
    expect(row('bitget')?.gapReverse.gapVes).toBeNull();
  });

  it('un venue solo-Cotizave muestra su mid y se declara ANCLA, sin brecha', () => {
    mount({ bybit: DEMO_BYBIT });
    const text = rowText('bitget');
    // El mid real de bitget es 959.2 y antes se renderizaba como `--`.
    expect(text).toContain('959,20');
    expect(text).toMatch(/ancla/i);
    expect(text).not.toMatch(/OPORTUNIDAD/);
  });

  it('BCV y paralelo se declaran tasas de referencia, no arbitraje', () => {
    mount({ bybit: DEMO_BYBIT });
    const oficial = rowText('oficial');
    const parallel = rowText('parallel');
    expect(oficial).toMatch(/referencia/i);
    expect(parallel).toMatch(/referencia/i);
    expect(oficial).not.toMatch(/OPORTUNIDAD/);
    expect(parallel).not.toMatch(/OPORTUNIDAD/);
  });

  it('lastFetched sin ofertas NO habilita la brecha', () => {
    // El caso peligroso: el modo es `live` y hay reloj, pero no hay las dos
    // puntas. Los defaults 808.5 / 813.0 siguen ahi y NO pueden ser la brecha.
    mount({
      bybit: {
        mode: 'live',
        payPrice: 808.5,
        receivePrice: 813.0,
        lastFetched: new Date('2026-09-29T12:00:10.000Z'),
        offers: false,
      },
    });
    expect(row('bybit')?.gapForward.gapVes).toBeNull();
    expect(row('bybit')?.gapReverse.gapVes).toBeNull();
  });

  it('sin libro de Binance no hay brecha ejecutable', () => {
    mount({ depth: null, bybit: LIVE_BYBIT });
    expect(row('bybit')?.gapForward.gapVes).toBeNull();
    expect(row('bybit')?.gapReverse.gapVes).toBeNull();
  });

  it('sin libro de Binance la tabla conserva los datos que SÍ existen', () => {
    // El defecto original devolvia `[]` sin profundidad de Binance, así que
    // bitget, oficial y parallel desaparecian de la pantalla. Esos mids son
    // ciertos; lo que no hay es con quien cruzarlos.
    mount({ depth: null, bybit: DEMO_BYBIT });
    const rows = fixture.componentInstance.triangulationData();
    expect(rows.find((r) => r.market === 'bitget')?.mid).toBe(959.2);
    expect(rowText('bitget')).toContain('959,20');
  });

  describe('Radar de Alta Demanda (Apple Pro)', () => {
    it('renderiza la estructura Apple Pro y controles ejecutivos en modo high_demand', () => {
      mount({ depth: LIVE_DEPTH, bybit: DEMO_BYBIT });
      const c = fixture.componentInstance;
      c.activeMode.set('high_demand');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.apple-radar-panel')).toBeTruthy();
      expect(el.querySelector('.apple-pro-badge')?.textContent).toContain('Apple Pro Edition');
      expect(el.querySelector('.apple-radar-select')).toBeTruthy();
      expect(el.querySelector('.apple-radar-refresh-btn')).toBeTruthy();
    });

    it('renderiza el estado vacio Apple Pro cuando no hay tramos disponibles', () => {
      mount({ depth: null, bybit: DEMO_BYBIT });
      const c = fixture.componentInstance;
      c.activeMode.set('high_demand');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.apple-radar-empty')).toBeTruthy();
      expect(el.querySelector('.apple-btn-sync')).toBeTruthy();
    });

    it('renderiza tarjetas Apple Pro y destaca la Mayor Oportunidad cuando hay ofertas institucionales', () => {
      const depthWithInstitutionalOffers: BinanceP2pMarketDepth = {
        asset: 'USDT',
        fiat: 'VES',
        bestBuyPrice: 800,
        bestSellPrice: 830,
        spreadVes: 30,
        spreadPct: 3.75,
        buyOffers: [
          {
            advNo: '101',
            price: 800,
            merchantName: 'BanqueroPro',
            finishRatePct: 98,
            orderCount: 150,
            minVes: 1000,
            maxVes: 10000000,
            payMethods: ['Banesco'],
          },
        ],
        sellOffers: [
          {
            advNo: '202',
            price: 830,
            merchantName: 'LiquidezTop',
            finishRatePct: 99,
            orderCount: 200,
            minVes: 1000,
            maxVes: 10000000,
            payMethods: ['Banesco'],
          },
        ],
        updatedAt: '2026-10-05T20:00:00.000Z',
      };

      mount({ depth: depthWithInstitutionalOffers, bybit: DEMO_BYBIT });
      const c = fixture.componentInstance;
      c.activeMode.set('high_demand');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const cards = el.querySelectorAll('.apple-tier-card');
      expect(cards.length).toBeGreaterThan(0);
      expect(el.querySelector('.tier-best-opportunity')).toBeTruthy();
      expect(el.querySelector('.apple-opportunity-tag')).toBeTruthy();
      expect(el.querySelector('.apple-net-box')).toBeTruthy();
      expect(el.querySelector('.apple-btn-apply')).toBeTruthy();
    });
  });
});
