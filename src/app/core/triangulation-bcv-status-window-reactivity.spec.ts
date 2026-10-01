import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@angular/core';
import {
  TriangulationIntelligenceService,
  VenezuelaClock,
} from './triangulation-intelligence.service';
import { BinanceP2pService } from './binance-p2p.service';
import { CotizaveService } from './cotizave.service';
import { McpService } from './mcp.service';
import { ToastService } from './toast.service';

/**
 * La specularidad de `VenezuelaClock` lo hizo testeable, pero no lo hizo
 * REACTIVO — y esa diferencia es la que importa acá.
 *
 * `now()` era un método plano que hacía `return new Date()`. Inyectarlo resolvió el
 * problema de los tests (ahora cada uno fija su instante), pero en la app real no
 * cambió nada: `bcvStatus` es un `computed` que sólo vuelve a evaluarse si una
 * dependencia registrada cambia. Un método no es una dependencia.
 *
 * El sintoma operativo: el panel dice en que regimen esta la ventana de intervencion
 * del BCV (lunes y jueves, 09:00-13:00 VET). Si dejan la app abierta y cruzan las
 * 09:00, el panel sigue diciendo "fuera de ventana critica" con una subasta
 * efectivamente abierta. Y en la direccion inversa tambien: si la dejan abierta y el
 * calendario marca el fin de la subasta, el panel sigue impartiendo la advertencia de
 * una ventana activa que ya cerro.

/** Instante UTC que cae en el día/hora VET pedido. VET = UTC-4 fijo. */
function instanteVet(dow: number, horaVet: number): Date {
  // 2026-01-05 fue un lunes (getUTCDay() === 1).
  const base = Date.UTC(2026, 0, 5, horaVet + 4);
  const fecha = new Date(base);
  const delta = (dow - fecha.getUTCDay() + 7) % 7;
  return new Date(base + delta * 86400000);
}

/**
 * Monta el servicio con el reloj real y el resto de dependencias en dummy. Se pide
 * `useRealClock: true` justamente para no falsear la reactividad.
 */
function montarConRelojReal() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      TriangulationIntelligenceService,
      VenezuelaClock,
      { provide: BinanceP2pService, useValue: { marketDepth: vi.fn(() => null) } },
      {
        provide: CotizaveService,
        useValue: {
          ratesByMarket: signal<Record<string, unknown>>({}),
          lastFetched: signal<Date | string | null>(null),
          ratesProvenance: signal<string>('none'),
          fetchRates: vi.fn(),
        },
      },
      { provide: McpService, useValue: { testTool: vi.fn(async () => ({ success: false })) } },
      {
        provide: ToastService,
        useValue: { show: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
    ],
  });

  return {
    clock: TestBed.inject(VenezuelaClock),
    service: TestBed.inject(TriangulationIntelligenceService),
  };
}

describe('VenezuelaClock — el reloj es una dependencia reactiva, no un método', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(instanteVet(1, 8)); // lunes 08:00 VET: antes de la subasta
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('expone el instante actual como signal, no como método plano', () => {
    const { clock } = montarConRelojReal();

    // Un método no se suscribe a nada. Éste tiene que ser legible como signal para
    // que el `computed` que lo consume pueda invalidarse.
    expect(typeof clock.now).toBe('function');
    // Calling it yields a Date...
    expect(clock.now()).toBeInstanceOf(Date);
    // ...and calling it again with the system clock untouched is the SAME instant,
    // which is what makes it a signal rather than a fresh `new Date()` per read.
    const primera = clock.now();
    const segunda = clock.now();
    expect(segunda).toBe(primera);
  });

  it('el instante avanza con el tiempo, sin que nadie lo pida', async () => {
    const { clock } = montarConRelojReal();

    const antes = clock.now();

    // Cruza las 09:00 VET: arranca la subasta del BCV.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

    const despues = clock.now();
    expect(despues.getTime()).toBeGreaterThan(antes.getTime());
  });

  it('deja de avanzar cuando el reloj se destruye', async () => {
    const { clock } = montarConRelojReal();
    TestBed.resetTestingModule();

    const congelado = clock.now();
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);

    // Un `setInterval` sin limpiar en un servicio `providedIn: 'root'` es una
    // fuga: sobrevive al cierre del inyector y sigue despertando al proceso.
    expect(clock.now().getTime()).toBe(congelado.getTime());
  });
});

describe('bcvStatus — la ventana de intervención se recalcula con el tiempo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(instanteVet(1, 8)); // lunes 08:00 VET
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cruza de fuera de ventana a subasta activa sin tocar nada', async () => {
    const { service } = montarConRelojReal();

    expect(service.bcvStatus().inWindow).toBe(false);
    expect(service.bcvStatus().intensity).not.toBe('EXTREME');

    // 08:00 → 10:00 VET: la subasta del lunes está abierta.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

    // Antes del fix el `computed` devolvía el valor memoizado de las 08:00 para
    // siempre: el panel decía "fuera de ventana" con la subasta abierta.
    expect(service.bcvStatus().inWindow).toBe(true);
    expect(service.bcvStatus().intensity).toBe('EXTREME');
  });

  it('cruza de subasta activa a ventana cerrada', async () => {
    vi.setSystemTime(instanteVet(1, 12)); // lunes 12:00 VET: subasta abierta
    const { service } = montarConRelojReal();

    expect(service.bcvStatus().inWindow).toBe(true);

    // 12:00 → 14:00 VET: la subasta cerró.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

    // La direccion inversa del mismo fallo: seguir impartiendo la advertencia de una
    // ventana activa que ya cerro.
    expect(service.bcvStatus().inWindow).toBe(false);
    expect(service.bcvStatus().intensity).not.toBe('EXTREME');
  });

  it('sigue declarando ausencia de probabilidad después de recalcular', async () => {
    const { service } = montarConRelojReal();

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

    // Que el reloj corra no convierte el calendario en un modelo probabilístico.
    // La escalera de intensidad se sigue leyendo del calendario, nunca del
    // porcentaje.
    expect(service.bcvStatus().probabilityPct).toBeNull();
  });

  it('la intensidad de las cuatro fases no depende de cuántas veces se leyó', async () => {
    const { service } = montarConRelojReal();

    // Lee el mismo instante muchas veces: la respuesta tiene que ser estable.
    const primera = service.bcvStatus();
    for (let i = 0; i < 5; i += 1) service.bcvStatus();
    const ultima = service.bcvStatus();

    expect(ultima).toBe(primera);
  });
});
