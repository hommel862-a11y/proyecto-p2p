import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { TriangulationIntelligenceService } from './triangulation-intelligence.service';
import { BinanceP2pService } from './binance-p2p.service';
import { CotizaveService } from './cotizave.service';
import { McpService } from './mcp.service';
import { ToastService } from './toast.service';

/**
 * Estos tests cubren el reloj del snapshot de mercado, no la matemática del
 * arbitraje. Un snapshot que se estampa con `new Date()` en el momento de la
 * llamada dice "recién cotizado" para un número que puede venir de la caché
 * restaurada del disco: la marca de tiempo pasa a mentir.
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
          useValue: { show: vi.fn(), error: vi.fn() },
        },
      ],
    });

    svc = TestBed.inject(TriangulationIntelligenceService);
  });

  it('estampa la hora del dato de Cotizave, no la hora de la llamada', async () => {
    const producedAt = new Date('2026-09-29T08:30:00');
    cotizaveRates.set({
      bcv: { market: 'bcv', mid: 36.1 },
      paralelo: { market: 'paralelo', mid: 36.9 },
      binance: { market: 'binance', mid: 36.6 },
    });
    cotizaveLastFetched.set(producedAt);
    cotizaveProvenance.set('restored');

    const snapshot = await svc.fetchLiveMarketRates();

    expect(snapshot.bcvUsd).toBe(36.1);
    // El reloj del snapshot es el del dato que lo alimenta, no el del tick.
    expect(snapshot.timestamp).toBe(producedAt.toLocaleTimeString());
  });

  it('lleva la procedencia de Cotizave al snapshot', async () => {
    cotizaveRates.set({ bcv: { market: 'bcv', mid: 36.1 } });
    cotizaveLastFetched.set(new Date('2026-09-29T08:30:00'));
    cotizaveProvenance.set('restored');

    const snapshot = await svc.fetchLiveMarketRates();

    expect((snapshot as { provenance?: string }).provenance).toBe('restored');
  });

  it('marca el snapshot como en vivo cuando los datos viennent de la red', async () => {
    const producedAt = new Date('2026-09-29T08:30:00');
    cotizaveRates.set({ bcv: { market: 'bcv', mid: 36.1 } });
    cotizaveLastFetched.set(producedAt);
    cotizaveProvenance.set('live');

    const snapshot = await svc.fetchLiveMarketRates();

    expect((snapshot as { provenance?: string }).provenance).toBe('live');
    expect(snapshot.timestamp).toBe(producedAt.toLocaleTimeString());
  });

  it('usa la hora actual solo cuando Cotizave no aportó nada al snapshot', async () => {
    // Sin rates de Cotizave no hay dato que fechar: el snapshot es todo defaults,
    // y atribuirle la procedencia de una fuente que no intervino sería inventar.
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
    cotizaveRates.set({ bcv: { market: 'bcv', mid: 36.1 } });
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
    cotizaveRates.set({ bcv: { market: 'bcv', mid: 36.1 } });
    cotizaveLastFetched.set(producedAt);
    cotizaveProvenance.set('restored');

    const snapshot = await svc.fetchLiveMarketRates();

    expect(snapshot.timestampSource).toBe('cotizave');
    expect(snapshot.timestamp).toBe(producedAt.toLocaleTimeString());
  });

  it('declara el reloj del panel cuando ninguna pierna viene de Cotizave', async () => {
    // Sin Cotizave el snapshot es defaults + MCP: el reloj es el del tick, y
    // decirlo evita que un lector lo tome por la hora de un dato de mercado.
    const snapshot = await svc.fetchLiveMarketRates();

    expect(snapshot.timestampSource).toBe('panel');
  });
});
