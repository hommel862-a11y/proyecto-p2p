import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { createUnavailableDataSource, type ExchangeLeg, type SpotBookTicker } from '@p2p/core';
import {
  TriangulationIntelligenceService,
  formatLiveRate,
} from './triangulation-intelligence.service';
import { BinanceP2pService } from './binance-p2p.service';
import { CotizaveService } from './cotizave.service';
import { McpService } from './mcp.service';
import { ToastService } from './toast.service';
import { SpotMarketService } from './spot-market.service';

/**
 * Estos tests cubren el reloj del snapshot de mercado, no la matemática del
 * arbitraje. Un snapshot que se estampa con `new Date()` en el momento de la
 * llamada dice "recién cotizado" para un número que puede venir de la caché
 * restaurada del disco: la marca de tiempo pasa a mentir.
 *
 * Y cubren la regla de este módulo: sin dato antes que dato inventado. El
 * snapshot no puede publicar una tasa que no salió de una fuente real, ni
 * aunque la constante esté "cerca" o "redondeada".
 *
 * ── Sobre las claves de los fixtures ──
 * Los fixtures usan las claves que produce `normalizeMarketKey`
 * (`projects/core/src/lib/cotizave.ts`): el market `reference` del API se
 * normaliza a `'oficial'` y `parallel` queda tal cual. La versión anterior de
 * este archivo usaba `bcv` y `paralelo`, que son claves que el parser NO puede
 * emitir, y por eso sus tests pasaban: reproducían el mismo bug que el código
 * que probaban, con lo cual la cobertura era circular.
 */
describe('TriangulationIntelligenceService — procedencia y reloj del snapshot', () => {
  const cotizaveRates = signal<Record<string, { market: string; mid: number }>>({});
  const cotizaveLastFetched = signal<Date | null>(null);
  const cotizaveProvenance = signal<'none' | 'live' | 'restored'>('none');

  let svc: TriangulationIntelligenceService;

  beforeEach(() => {
    cotizaveRates.set({});
    cotizaveLastFetched.set(null);
    cotizaveProvenance.set('none');

    TestBed.configureTestingModule({
      providers: [
        TriangulationIntelligenceService,
        {
          provide: BinanceP2pService,
          useValue: { marketDepth: vi.fn(() => null) },
        },
        {
          provide: CotizaveService,
          useValue: {
            ratesByMarket: cotizaveRates,
            lastFetched: cotizaveLastFetched,
            ratesProvenance: cotizaveProvenance,
            fetchRates: vi.fn(),
          },
        },
        {
          // MCP caído a propósito: el snapshot se arma solo con Cotizave, que es
          // exactamente el caso en el que la marca de tiempo mentía.
          provide: McpService,
          useValue: { testTool: vi.fn(async () => ({ success: false })) },
        },
        {
          provide: ToastService,
          useValue: { show: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
        },
        {
          provide: SpotMarketService,
          useValue: {
            fetchBookTicker: vi.fn(async () => null),
            availability: () => createUnavailableDataSource('Binance Spot', 'Sin datos en test'),
          },
        },
      ],
    });

    svc = TestBed.inject(TriangulationIntelligenceService);
  });

  it('estampa la hora del dato de Cotizave, no la hora de la llamada', async () => {
    const producedAt = new Date('2026-09-29T08:30:00');
    cotizaveRates.set({
      oficial: { market: 'oficial', mid: 857.8876 },
      parallel: { market: 'parallel', mid: 958.580188 },
      binance: { market: 'binance', mid: 82.35 },
    });
    cotizaveLastFetched.set(producedAt);
    cotizaveProvenance.set('restored');

    const snapshot = await svc.fetchLiveMarketRates();

    expect(snapshot.bcvUsd.value).toBe(857.8876);
    // El reloj del snapshot es el del dato que lo alimenta, no el del tick.
    expect(snapshot.timestamp).toBe(producedAt.toLocaleTimeString());
  });

  it('lleva la procedencia de Cotizave al snapshot', async () => {
    cotizaveRates.set({ oficial: { market: 'oficial', mid: 857.8876 } });
    cotizaveLastFetched.set(new Date('2026-09-29T08:30:00'));
    cotizaveProvenance.set('restored');

    const snapshot = await svc.fetchLiveMarketRates();

    expect((snapshot as { provenance?: string }).provenance).toBe('restored');
  });

  it('marca el snapshot como en vivo cuando los datos vienen de la red', async () => {
    const producedAt = new Date('2026-09-29T08:30:00');
    cotizaveRates.set({ oficial: { market: 'oficial', mid: 857.8876 } });
    cotizaveLastFetched.set(producedAt);
    cotizaveProvenance.set('live');

    const snapshot = await svc.fetchLiveMarketRates();

    expect((snapshot as { provenance?: string }).provenance).toBe('live');
    expect(snapshot.timestamp).toBe(producedAt.toLocaleTimeString());
  });

  it('usa la hora actual solo cuando Cotizave no aportó nada al snapshot', async () => {
    // Sin rates de Cotizave no hay dato que fechar: el snapshot es todo
    // ausencia, y atribuirle la procedencia de una fuente que no intervino sería
    // inventar.
    const before = Date.now();
    const snapshot = await svc.fetchLiveMarketRates();
    const after = Date.now();

    expect((snapshot as { provenance?: string }).provenance).toBeUndefined();
    // `toLocaleTimeString()` no es parseable por `new Date()`, así que el reloj se
    // contrasta contra las dos candidatas que cubren el cruce de segundo.
    expect(snapshot.timestamp).toMatch(/^\d{1,2}:\d{2}:\d{2}/);
    expect([before, after].map((t) => new Date(t).toLocaleTimeString())).toContain(
      snapshot.timestamp,
    );
  });

  it('no fecha en el futuro un reloj de Cotizave adelantado por desincronización', async () => {
    cotizaveRates.set({ oficial: { market: 'oficial', mid: 857.8876 } });
    cotizaveLastFetched.set(new Date(Date.now() + 6 * 3_600_000));
    cotizaveProvenance.set('restored');

    const before = Date.now();
    const snapshot = await svc.fetchLiveMarketRates();
    const after = Date.now();

    // Un reloj adelantado del servidor no puede producir un snapshot "de futuro".
    expect([before, after].map((t) => new Date(t).toLocaleTimeString())).toContain(
      snapshot.timestamp,
    );
  });

  it('califica de qué fuente es el reloj cuando el snapshot mezcla piernas', async () => {
    // El snapshot embebe piernas de Binance Y de Cotizave. `provenance` califica
    // la parte de Cotizave, pero `timestamp` sin más se lee como la hora de
    // mercado de TODO el snapshot: el reloj de Cotizave puesto sobre un número de
    // Binance no califica la pierna de Binance.
    const producedAt = new Date('2026-09-29T08:30:00');
    cotizaveRates.set({ oficial: { market: 'oficial', mid: 857.8876 } });
    cotizaveLastFetched.set(producedAt);
    cotizaveProvenance.set('restored');

    const snapshot = await svc.fetchLiveMarketRates();

    expect(snapshot.timestampSource).toBe('cotizave');
    expect(snapshot.timestamp).toBe(producedAt.toLocaleTimeString());
  });

  it('declara el reloj del panel cuando ninguna pierna viene de Cotizave', async () => {
    // Sin Cotizave no hay dato que fechar: el reloj es el del tick, y decirlo
    // evita que un lector lo tome por la hora de un dato de mercado.
    const snapshot = await svc.fetchLiveMarketRates();

    expect(snapshot.timestampSource).toBe('panel');
  });
});

/**
 * El bloque que sigue es la regresión de los cuatro defectos de tasas
 * inventadas. Los valores de fixture salen de una sonda real contra
 * `https://api.cotizave.com/v1/fx/rates`: `reference` 857.8876,
 * `parallel` 958.580188, y siete venues `type:"p2p"`.
 */
describe('TriangulationIntelligenceService — sin dato antes que dato inventado', () => {
  const cotizaveRates = signal<Record<string, { market: string; mid: number }>>({});
  const cotizaveLastFetched = signal<Date | null>(null);
  const cotizaveProvenance = signal<'none' | 'live' | 'restored'>('none');
  const marketDepth = signal<{ bestBuyPrice: number; bestSellPrice: number } | null>(null);
  const mcpResult = signal<Record<string, unknown> | null>(null);

  let svc: TriangulationIntelligenceService;

  /** Tramo mínimo bien formado: para esta suite solo importa `price`. */
  const leg = (fromCurrency: string, toCurrency: string, price: number): ExchangeLeg => ({
    id: `${fromCurrency}-${toCurrency}`,
    fromCurrency,
    toCurrency,
      operationType: 'FIAT_CONVERSION',
    platform: 'test',
    paymentMethod: 'test',
    price,
    isDivision: true,
    feePct: 0,
    fixedFee: 0,
    fixedFeeCurrency: 'USDT',
    estimatedDurationMinutes: 30,
  });

  /** MCP que responde una sola herramienta y falla el resto. */
  const testTool = vi.fn(async (name: string) => {
    if (name === 'get_binance_p2p_orderbook') {
      return mcpResult() ? { success: true, result: mcpResult() } : { success: false };
    }
    return { success: false };
  });

  const spotFetchBookTicker = vi.fn<(_symbol?: string) => Promise<SpotBookTicker | null>>(
    async () => null,
  );

  beforeEach(() => {
    cotizaveRates.set({});
    cotizaveLastFetched.set(new Date('2026-09-29T08:30:00'));
    cotizaveProvenance.set('live');
    marketDepth.set(null);
    mcpResult.set(null);
    testTool.mockClear();
    spotFetchBookTicker.mockReset();
    spotFetchBookTicker.mockImplementation(async () => null);

    TestBed.configureTestingModule({
      providers: [
        TriangulationIntelligenceService,
        {
          provide: BinanceP2pService,
          useValue: { marketDepth: () => marketDepth() },
        },
        {
          provide: CotizaveService,
          useValue: {
            ratesByMarket: cotizaveRates,
            lastFetched: cotizaveLastFetched,
            ratesProvenance: cotizaveProvenance,
            fetchRates: vi.fn(),
          },
        },
        { provide: McpService, useValue: { testTool } },
        {
          provide: ToastService,
          useValue: { show: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
        },
        {
          provide: SpotMarketService,
          useValue: {
            fetchBookTicker: spotFetchBookTicker,
            availability: () => createUnavailableDataSource('Binance Spot', 'Sin datos en test'),
          },
        },
      ],
    });

    svc = TestBed.inject(TriangulationIntelligenceService);
  });

  // ── Defecto 1: las claves que el parser no puede emitir ──

  it('usa el mid real de `oficial` y `parallel` de Cotizave en el snapshot', async () => {
    // Regresión directa del bug de claves. Antes el código leía
    // `rates['bcv']` y `rates['paralelo']`, que `normalizeMarketKey` nunca
    // emite, así que devolvía `undefined`, el guard lo descartaba y el
    // "complemento de Cotizave" no aportaba nada para BCV ni para paralelo.
    // La aserción es sobre el NÚMERO, no sobre que no haya excepción: un
    // `expect(() => ...).not.toThrow()` habría pasado con el bug vivo.
    cotizaveRates.set({
      oficial: { market: 'oficial', mid: 857.8876 },
      parallel: { market: 'parallel', mid: 958.580188 },
      eur_reference: { market: 'eur_reference', mid: 940.123456 },
      binance: { market: 'binance', mid: 82.35 },
    });

    const snapshot = await svc.fetchLiveMarketRates();

    expect(snapshot.bcvUsd.value).toBe(857.8876);
    expect(snapshot.bcvUsd.status).toBe('live');
    expect(snapshot.bcvUsd.source).toBe('Cotizave market `oficial`');

    expect(snapshot.parallelAvg.value).toBe(958.580188);
    expect(snapshot.parallelAvg.status).toBe('live');
    expect(snapshot.parallelAvg.source).toBe('Cotizave market `parallel`');

    expect(snapshot.bcvEur.value).toBe(940.123456);
    expect(snapshot.binanceVesSell.value).toBe(82.35);
  });

  it('calcula la brecha real con BCV y paralelo vivos', async () => {
    // (958.580188 - 857.8876) / 857.8876 = 11.74%
    cotizaveRates.set({
      oficial: { market: 'oficial', mid: 857.8876 },
      parallel: { market: 'parallel', mid: 958.580188 },
    });

    const snapshot = await svc.fetchLiveMarketRates();

    expect(snapshot.rateGapPct.value).toBe(11.74);
    expect(snapshot.rateGapPct.status).toBe('live');
    // La brecha real NO es 16.11: era la constante que se emitía cuando faltaba
    // el dato, y se parece lo suficiente como para pasar por una medida.
    expect(snapshot.rateGapPct.value).not.toBe(16.11);
  });

  it('no confunde una brecha real de cero con la ausencia de dato', async () => {
    // Este es el test que NO podía ser un `toBeFalsy()`: si la brecha no se
    // emitiera, un assertion flojo pasaría igual. Se comprueban los DOS lados de
    // la distinción.
    cotizaveRates.set({
      oficial: { market: 'oficial', mid: 857.8876 },
      parallel: { market: 'parallel', mid: 857.8876 },
    });

    const conDatos = await svc.fetchLiveMarketRates();

    // Lado real: oficial y paralelo iguales es una brecha medida de 0.00%.
    expect(conDatos.rateGapPct.value).toBe(0);
    expect(conDatos.rateGapPct.status).toBe('live');
    expect(conDatos.rateGapPct.value).not.toBeNull();

    // Lado ausente: sin datos, `value` es null y el status lo dice.
    cotizaveRates.set({});
    const sinDatos = await svc.fetchLiveMarketRates();

    expect(sinDatos.rateGapPct.value).toBeNull();
    expect(sinDatos.rateGapPct.status).toBe('unavailable');
    expect(sinDatos.rateGapPct.unavailableReason).toBe('FALTA_BCV_O_PARALELO');
  });

  // ── Defecto 2: las constantes del fallback derivado ──

  it('no emite ninguna brecha cuando no hay BCV ni paralelo', async () => {
    // MCP caído (mock), sin rates de Cotizave, sin profundidad Binance.
    const snapshot = await svc.fetchLiveMarketRates();

    expect(snapshot.bcvUsd.value).toBeNull();
    expect(snapshot.parallelAvg.value).toBeNull();
    expect(snapshot.rateGapPct.value).toBeNull();
    // La ausencia declara DÓNDE habría salido el dato, para que el operador
    // sepa qué reconectar en vez de ver un hueco mudo.
    expect(snapshot.rateGapPct.expectedSource).toBe('derivado de bcvUsd y parallelAvg');
    expect(snapshot.bcvUsd.expectedSource).toContain('oficial');
    expect(snapshot.parallelAvg.expectedSource).toContain('parallel');
  });

  it('deja el cruce COP/VES ausente y no lo sustituye por 51.3', async () => {
    // 51.3 era `copPerUsdt(4250) / binanceVesSell(82.85)` redondeado, o sea las
    // constantes de arranque disfrazadas de un cruce derivado. Con la
    // duplicación de Binance, sin COP/USDT real, el cruce no existe.
    marketDepth.set({ bestBuyPrice: 82.2, bestSellPrice: 82.85 });

    const snapshot = await svc.fetchLiveMarketRates();

    expect(snapshot.binanceVesSell.value).toBe(82.85);
    expect(snapshot.copPerUsdt.value).toBeNull();
    expect(snapshot.copPerVes.value).toBeNull();
    expect(snapshot.copPerVes.status).toBe('unavailable');
    expect(snapshot.copPerVes.unavailableReason).toBe('FALTA_COP_USDT_O_BINANCE_P2P');
  });

  it('arranca sin ninguna tasa publicada, no con constantes de arranque', async () => {
    // El signal inicial se pintaba en el panel antes de la primera llamada de
    // red: BCV 72.45, paralelo 84.12, brecha 16.11, COP/VES 51.3.
    const inicial = svc.liveRates();

    for (const campo of [
      'binanceVesBuy',
      'binanceVesSell',
      'bcvUsd',
      'bcvEur',
      'parallelAvg',
      'rateGapPct',
      'copPerUsdt',
      'copPerVes',
      'zinliUsdPerUsdt',
      'spotUsdcUsdt',
      'spotEurUsdt',
    ] as const) {
      expect(inicial[campo].value, `campo ${campo}`).toBeNull();
      expect(inicial[campo].status, `campo ${campo}`).toBe('unavailable');
    }
    expect(inicial.source).toBe('FALLBACK');
  });

  it('nunca publica 0 como si fuera una tasa', async () => {
    // Una tasa de cambio no puede ser 0. Si un consumidor recibiera 0, no
    // podría distinguirlo de "no hay dato", así que el productor tiene que
    // garantizar que 0 nunca sale de un NIVEL. Los deltas quedan fuera a
    // propósito: una brecha medida de 0.00% sí es un dato válido.
    marketDepth.set({ bestBuyPrice: 0, bestSellPrice: 0 });
    mcpResult.set({ topBuyPrice: 0, topSellPrice: 0 });
    cotizaveRates.set({ oficial: { market: 'oficial', mid: 0 } });

    const snapshot = await svc.fetchLiveMarketRates();

    for (const campo of [
      'binanceVesBuy',
      'binanceVesSell',
      'bcvUsd',
      'bcvEur',
      'parallelAvg',
      'copPerUsdt',
      'copPerVes',
      'zinliUsdPerUsdt',
      'spotUsdcUsdt',
      'spotEurUsdt',
    ] as const) {
      expect(snapshot[campo].value, `campo ${campo}`).not.toBe(0);
      expect(snapshot[campo].value, `campo ${campo}`).toBeNull();
    }
    expect(snapshot.bcvUsd.status).toBe('unavailable');
    expect(snapshot.binanceVesSell.status).toBe('unavailable');
  });

  it('degrada a ausencia un mid no plausible en vez de publicarlo', async () => {
    cotizaveRates.set({
      oficial: { market: 'oficial', mid: Number.NaN },
      parallel: { market: 'parallel', mid: -5 },
    });

    const snapshot = await svc.fetchLiveMarketRates();

    expect(snapshot.bcvUsd.value).toBeNull();
    expect(snapshot.parallelAvg.value).toBeNull();
    expect(snapshot.rateGapPct.value).toBeNull();
  });

  // ── La ausencia tiene que ser legible en el borde del consumidor ──

  it('el formateo del panel dice "no disponible" y nunca un 0', () => {
    expect(formatLiveRate(svc.liveRates().bcvUsd)).toBe('no disponible');
    expect(formatLiveRate(svc.liveRates().bcvUsd, 0)).toBe('no disponible');
  });

  it('no sobreescribe el precio de un tramo cuando su tasa está ausente', async () => {
    // `ExchangeLeg.price` es `number` y no tiene cómo representar "no hay
    // dato". Escribir `null` ahí rompería la matemática del arbitraje, y
    // escribir un 0 publicaría un precio. Lo honesto es no tocar el tramo: queda
    // la suposición declarada del preset, que al menos no se viste de "en vivo".
    //
    // La rama `route-ves-usdt-cop` es POSICIONAL: l1←binanceVesSell,
    // l2←copPerUsdt, l3←copPerVes. Las tres tasas están ausentes en el signal
    // inicial, así que las tres piernas conservan su precio declarado.
    const precioDeclarado = 51.3;
    const [l1, l2, l3] = svc.applyLiveRatesToLegs(
      [leg('VES', 'USDT', 82.2), leg('USDT', 'COP', 4250), leg('COP', 'VES', precioDeclarado)],
      svc.liveRates(),
      'route-ves-usdt-cop',
    );

    expect(l1.price).toBe(82.2);
    expect(l2.price).toBe(4250);
    // El cruce COP/VES no existe: queda el 51.3 DECLARADO del preset, no el 51.3
    // que emitía la constante. Son el mismo número y significados opuestos.
    expect(l3.price).toBe(precioDeclarado);
    expect(svc.liveRates().copPerVes.value).toBeNull();
  });

  it('sincroniza las piernas que sí tienen dato y deja las otras intactas', async () => {
    mcpResult.set({ topBuyPrice: 82.1, topSellPrice: 82.6 });
    const snapshot = await svc.fetchLiveMarketRates();
    expect(snapshot.binanceVesSell.value).toBe(82.6);

    const [l1] = svc.applyLiveRatesToLegs(
      [leg('VES', 'USDT', 1), leg('USDT', 'COP', 1), leg('COP', 'VES', 1)],
      snapshot,
      'route-ves-usdt-cop',
    );

    expect(l1.price).toBe(82.6);
  });

  it('aplica cotizaciones spot reales en tramos de arbitraje sintético cuando están disponibles', async () => {
    spotFetchBookTicker.mockImplementation(async (symbol?: string) => {
      if (symbol === 'USDCUSDT') {
        return {
          symbol: 'USDCUSDT',
          bidPrice: 0.9995,
          bidQty: 10000,
          askPrice: 0.9997,
          askQty: 10000,
          midPrice: 0.9996,
          spread: 0.0002,
          spreadPct: 0.02,
          timestamp: new Date().toISOString(),
        };
      }
      return null;
    });

    const snapshot = await svc.fetchLiveMarketRates();
    expect(snapshot.spotUsdcUsdt.value).toBe(0.9996);
    expect(snapshot.spotUsdcUsdt.status).toBe('live');

    const [l1] = svc.applyLiveRatesToLegs(
      [leg('USDT', 'USDC', 1.0), leg('USDC', 'VES', 83.5), leg('VES', 'USDT', 82.5)],
      snapshot,
      'route-usdt-usdc-ves',
    );

    expect(l1.price).toBe(0.9996);
  });
});
