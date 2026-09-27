import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BinanceRepricerService,
  REPRICER_EXECUTION_MODES,
  registerRepricerPublisher,
  unregisterRepricerPublisher,
  type RepricerAdPublisher,
} from './binance-repricer.service';
import { ToastService } from './toast.service';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import type { BinanceP2pMarketDepth, RepricerDecision } from '@p2p/core';

/**
 * Two-sided depth with a wide enough spread to clear the default 10 VES floor,
 * so a cycle actually produces an `UPDATE` decision (the log path under test).
 */
const DEPTH: BinanceP2pMarketDepth = {
  asset: 'USDT',
  fiat: 'VES',
  bestBuyPrice: 960,
  bestSellPrice: 985,
  spreadVes: 25,
  spreadPct: 2.6,
  sellOffers: [
    {
      advNo: 'a1',
      price: 985,
      merchantName: 'VendedorUno',
      finishRatePct: 99,
      orderCount: 300,
      minVes: 100,
      maxVes: 20000,
      payMethods: ['Banesco'],
    },
  ],
  buyOffers: [
    {
      advNo: 'b1',
      price: 960,
      merchantName: 'CompradorUno',
      finishRatePct: 99,
      orderCount: 300,
      minVes: 100,
      maxVes: 20000,
      payMethods: ['Banesco'],
    },
  ],
  updatedAt: '2026-09-27T12:00:00.000Z',
};

describe('BinanceRepricerService', () => {
  let svc: BinanceRepricerService;
  const toast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
  const fetchMarketDepth = vi.fn(async (): Promise<BinanceP2pMarketDepth | null> => DEPTH);

  beforeEach(() => {
    toast.success.mockReset();
    toast.info.mockReset();
    toast.error.mockReset();
    toast.warn.mockReset();
    fetchMarketDepth.mockReset();
    fetchMarketDepth.mockResolvedValue(DEPTH);
    unregisterRepricerPublisher();

    const injector = Injector.create({
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: BinanceP2pService, useValue: { fetchMarketDepth } },
        { provide: AccountsService, useValue: { usages: () => [] } },
        BinanceRepricerService,
      ],
    });
    svc = injector.get(BinanceRepricerService);
  });

  afterEach(() => {
    svc.stop();
    unregisterRepricerPublisher();
  });

  describe('modo de ejecución honesto', () => {
    it('arranca en SOLO LECTURA porque no hay publicador registrado', () => {
      expect(svc.executionMode()).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
    });

    it('no puede reportarse en vivo mientras no exista un publicador real', () => {
      // La garantía central del workstream: sin publicador, ninguna etiqueta
      // derivada puede afirmar publicación.
      expect(svc.executionMode()).not.toBe(REPRICER_EXECUTION_MODES.PUBLISHING);
      expect(svc.isPublishing()).toBe(false);
      expect(svc.executionModeLabel()).toBe('SOLO LECTURA — NO PUBLICA');
      expect(svc.executionModeLabel()).not.toMatch(/en vivo/i);
      expect(svc.logPrefix()).toBe('[SOLO LECTURA] ');
      expect(svc.logPrefix()).not.toMatch(/en vivo/i);
    });

    it('el servicio no expone ninguna forma de declarar el modo a mano', () => {
      const api = svc as unknown as Record<string, unknown>;
      expect(api['setDryRun']).toBeUndefined();
      expect(api['isDryRun']).toBeUndefined();
      // El registro solo expone el puerto de escritura, no un booleano.
      expect(Object.keys(api)).not.toContain('isLive');
      expect(Object.keys(api)).not.toContain('setLive');
    });

    it('el detalle explica que calcula y registra precios pero no publica', () => {
      expect(svc.executionModeDetail()).toMatch(/no publica anuncios/i);
      expect(svc.executionModeDetail()).toMatch(/merchant de Binance/i);
    });

    it('reporta el modo real en el toast de activación, sin prometer "en vivo"', () => {
      svc.toggle();

      const message = String(toast.success.mock.calls[0][0]);
      expect(message).toContain('SOLO LECTURA — NO PUBLICA');
      expect(message).toMatch(/no publica anuncios/i);
      expect(message).not.toMatch(/en vivo/i);
      svc.stop();
    });

    it('el log de un ciclo UPDATE no afirma publicación ni "en vivo"', async () => {
      const decision = await svc.executeCycle();

      expect(decision?.action).toBe('UPDATE');
      const entry = svc.logs()[0];
      expect(entry.executionMode).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
      expect(entry.message.startsWith('[SOLO LECTURA] ')).toBe(true);
      expect(entry.message).toMatch(/Precios optimizados/);
      expect(entry.message).not.toMatch(/publica/i);
      expect(entry.message).not.toMatch(/en vivo/i);
    });

    it('cambia a PUBLICANDO solo al registrar un publicador, sin tocar las etiquetas', async () => {
      const publish = vi.fn(async (): Promise<boolean> => true);
      const publisher: RepricerAdPublisher = { publish };
      registerRepricerPublisher(publisher);

      expect(svc.executionMode()).toBe(REPRICER_EXECUTION_MODES.PUBLISHING);
      expect(svc.isPublishing()).toBe(true);
      expect(svc.executionModeLabel()).toBe('PUBLICANDO EN BINANCE');
      expect(svc.logPrefix()).toBe('[PUBLICANDO] ');

      const decision = await svc.executeCycle();

      // El modo solo puede mentir si el ciclo NO delega al publicador: por eso
      // el sello de "publicando" va atado a la llamada real.
      expect(decision?.action).toBe('UPDATE');
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith({
        buyPrice: decision?.suggestedBuyPrice,
        sellPrice: decision?.suggestedSellPrice,
        strategy: 'TOP_1',
      });
      expect(svc.logs()[0].message).toContain('Precios publicados en Binance');
    });

    it('deja constancia cuando el publicador rechaza la escritura', async () => {
      registerRepricerPublisher({ publish: vi.fn(async () => false) });

      await svc.executeCycle();

      expect(svc.logs()[0].message).toContain('Publicación rechazada por el publicador');
    });

    it('vuelve a SOLO LECTURA al quitar el publicador', async () => {
      registerRepricerPublisher({ publish: vi.fn(async () => true) });
      expect(svc.executionMode()).toBe(REPRICER_EXECUTION_MODES.PUBLISHING);

      unregisterRepricerPublisher();

      expect(svc.executionMode()).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
      expect(svc.executionModeLabel()).toBe('SOLO LECTURA — NO PUBLICA');
    });
  });

  describe('funcionalidad existente preservada', () => {
    it('start/stop mueve isActive y el kill-switch corta el ciclo', async () => {
      svc.start();
      expect(svc.isActive()).toBe(true);

      svc.stop();
      expect(svc.isActive()).toBe(false);

      svc.start();
      svc.killSwitch();
      expect(svc.isActive()).toBe(false);
      expect(toast.error).toHaveBeenCalled();
      expect(svc.logs()[0].message).toMatch(/KILL-SWITCH/);
    });

    it('PAUSE por límite bancario diario detiene el bot y registra la razón', async () => {
      // Re-inyecta un service con el cupo excedido: `usages` es del injector.
      const injector = Injector.create({
        providers: [
          { provide: ToastService, useValue: toast },
          { provide: BinanceP2pService, useValue: { fetchMarketDepth } },
          { provide: AccountsService, useValue: { usages: () => [{ isOverLimit: true }] } },
          BinanceRepricerService,
        ],
      });
      const limited = injector.get(BinanceRepricerService);
      limited.start();

      const decision = await limited.executeCycle();

      expect(decision?.action).toBe('PAUSE');
      expect(limited.isActive()).toBe(false);
      expect(limited.logs()[0].action).toBe('PAUSE');
      expect(limited.logs()[0].message).toMatch(/L[ií]mites bancarios/i);
      limited.stop();
    });

    it('no inventa decisiones cuando el libro de mercado no responde', async () => {
      fetchMarketDepth.mockResolvedValue(null);

      expect(await svc.executeCycle()).toBeNull();
      expect(svc.logs()).toHaveLength(0);
    });

    it('setStrategy recalcula el ciclo con la estrategia elegida', async () => {
      svc.start();
      svc.setStrategy('UNDERCUT');
      await Promise.resolve();

      expect(svc.strategy()).toBe('UNDERCUT');
      const decision: RepricerDecision | null = svc.lastDecision();
      expect(decision).not.toBeNull();
      svc.stop();
    });
  });
});
