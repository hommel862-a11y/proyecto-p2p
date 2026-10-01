import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
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
 * `bcvStatus` es la parte del panel que le dice al operador en qué régimen está la
 * ventana de intervención del BCV. Antes publicaba una `probabilityPct` y derivaba
 * `intensity` de ella.
 *
 * Eso era un doble fallo:
 *
 *  1. No hay modelo probabilístico. El calendario del BCV (lunes y jueves,
 *     09:00-13:00 VET) es un horario público; no hay base rate, backtest ni
 *     histórico de intervenciones detrás. Publicar 95% era inventar.
 *
 *  2. Peor: la escalera `prob >= 80 ? 'EXTREME' : ...` leída con `prob === null`
 *     colapsa entera a `'LOW'`. `null >= 80` es `false`, `null >= 60` es `false`,
 *     `null >= 40` es `false`. Es decir: con la subasta abierta el panel decía
 *     "intensidad baja". Fail-silent en la dirección peligrosa, y el typecheck lo
 *     aceptaba sin quejarse.
 *
 * Estos tests fijan las dos propiedades: la ausencia se propaga como ausencia, y la
 * intensidad se lee del calendario, nunca de un porcentaje.
 *
 * El reloj entra por `VenezuelaClock` porque `bcvStatus` es un `computed`: con
 * `new Date()` adentro, Angular memoiza el primer resultado y cambiar la hora del
 * sistema no lo invalida. Con el reloj inyectado cada caso lee su propio instante.
 */

/** Instante UTC que cae en el día/hora VET pedido. VET = UTC-4 fijo. */
function instanteVet(dow: number, horaVet: number): Date {
  // 2026-01-05 fue un lunes (getUTCDay() === 1).
  const base = Date.UTC(2026, 0, 5, horaVet + 4);
  const fecha = new Date(base);
  const delta = (dow - fecha.getUTCDay() + 7) % 7;
  return new Date(base + delta * 86400000);
}

/**
 * @param fijo  Instante que el reloj devuelve siempre. Omitirlo hace que el reloj
 *              lance, que es como se alcanza la rama de error.
 */
function leerEn(dow: number, horaVet: number, fijo: Date | 'lanza' = instanteVet(dow, horaVet)) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      TriangulationIntelligenceService,
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
      {
        provide: VenezuelaClock,
        useValue: {
          now: () => {
            if (fijo === 'lanza') throw new Error('reloj caído');
            return fijo;
          },
        },
      },
    ],
  });

  return TestBed.inject(TriangulationIntelligenceService).bcvStatus();
}

describe('bcvStatus — sin probabilidad inventada', () => {
  it('no publica probabilidad: sin modelo probabilístico no hay porcentaje', () => {
    // Lunes 10:00 VET: la fase del calendario es inequívocamente activa.
    const estado = leerEn(1, 10);
    expect(estado.inWindow).toBe(true);
    expect(estado.probabilityPct).toBeNull();
  });

  it('la intensidad se lee del calendario, no del porcentaje ausente', () => {
    // La escalera rota colapsaba a 'LOW' acá. Con subasta abierta, LOW es
    // exactamente la respuesta que hace daño.
    expect(leerEn(1, 10).intensity).toBe('EXTREME');
  });

  it('PRE_INTERVENTION no se degrada a LOW', () => {
    const estado = leerEn(1, 7);
    expect(estado.inWindow).toBe(false);
    expect(estado.intensity).toBe('HIGH');
    expect(estado.probabilityPct).toBeNull();
  });

  it('la ausencia es ausencia en las cuatro fases del calendario', () => {
    const fases: { dow: number; hora: number; esperado: string }[] = [
      { dow: 1, hora: 10, esperado: 'EXTREME' }, // subasta activa
      { dow: 1, hora: 7, esperado: 'HIGH' }, // pre
      { dow: 2, hora: 10, esperado: 'MEDIUM' }, // post
      { dow: 6, hora: 10, esperado: 'LOW' }, // fuera de subasta
    ];

    for (const { dow, hora, esperado } of fases) {
      const estado = leerEn(dow, hora);
      expect(estado.intensity, `dow=${dow} hora=${hora}`).toBe(esperado);
      expect(estado.probabilityPct, `dow=${dow} hora=${hora}`).toBeNull();
    }
  });

  it('no declara "régimen normal" cuando el calendario dice que no hay subasta', () => {
    const msg = leerEn(6, 10).message;
    expect(msg).not.toMatch(/probabilidad/i);
    expect(msg).not.toMatch(/régimen normal/i);
  });
});

describe('bcvStatus — la ruta de error no inventa un régimen', () => {
  it('no publica probabilidad cuando el reloj falla', () => {
    expect(leerEn(1, 10, 'lanza').probabilityPct).toBeNull();
  });

  it('no declara "régimen normal" cuando el reloj falla', () => {
    // El fallo del reloj no es evidencia de que el mercado esté tranquilo. Decir
    // "régimen normal" sobre una excepción es fabricar un diagnóstico.
    expect(leerEn(1, 10, 'lanza').message).not.toMatch(/régimen normal/i);
  });

  it('deja constancia de que la ventana es indeterminada, no favorable', () => {
    const estado = leerEn(1, 10, 'lanza');
    expect(estado.message).toMatch(/indeterminad/i);
    expect(estado.inWindow).toBe(false);
  });

  it('no marca una-intensity sobre una ventana que no pudo evaluarse', () => {
    // El fallo no autoriza a publicar la escalera de intensidad.
    expect(leerEn(1, 10, 'lanza').intensity).toBe('LOW');
  });
});
