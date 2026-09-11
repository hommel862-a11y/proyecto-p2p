// projects/core/src/lib/johnson-depth.spec.ts
import { describe, it, expect } from 'vitest';
import { computeVolumeWeightedPrice } from './johnson-depth';
import type { BinanceOfferSummary } from './binance-p2p';

function makeOffers(prices: number[], maxVesEach: number, finishRate = 100): BinanceOfferSummary[] {
  return prices.map((price, i) => ({
    advNo: `adv-${i}`,
    price,
    merchantName: `M${i}`,
    finishRatePct: finishRate,
    orderCount: 10,
    minVes: 100,
    maxVes: maxVesEach >= 10000 && prices[0] > 0 ? Math.round((maxVesEach / prices[0]) * price) : maxVesEach,
    payMethods: ['Banesco'],
  }));
}

describe('computeVolumeWeightedPrice', () => {
  it('compra: pondera por volumen disponible y usa el mejor precio primero', () => {
    const offers = makeOffers([800, 820], 500 * 800); // 2 vendedores: 500 y 500 USDT
    const res = computeVolumeWeightedPrice(offers, 'BUY', 600);
    expect(res.fillableUsdt).toBe(600);
    expect(res.price).toBeCloseTo(803.33, 2);
  });

  it('venta: usa el precio más alto primero (compradores)', () => {
    const offers = makeOffers([800, 825], 500 * 800);
    const res = computeVolumeWeightedPrice(offers, 'SELL', 300);
    expect(res.fillableUsdt).toBe(300);
    expect(res.price).toBe(825);
  });

  it('si no alcanza el objetivo, devuelve el fillable real (liquidez insuficiente)', () => {
    const offers = makeOffers([800], 100 * 800);
    const res = computeVolumeWeightedPrice(offers, 'BUY', 500);
    expect(res.fillableUsdt).toBe(100);
    expect(res.price).toBe(800);
  });

  it('con ofertas vacías devuelve price 0 y fillable 0', () => {
    const res = computeVolumeWeightedPrice([], 'BUY', 500);
    expect(res.price).toBe(0);
    expect(res.fillableUsdt).toBe(0);
  });

  it('respeta maxVes por oferta (no sobrepasa el tope de cada comerciante)', () => {
    const many = Array.from({ length: 4 }, (_, i) => ({
      advNo: `a${i}`,
      price: 800,
      merchantName: `M${i}`,
      finishRatePct: 100,
      orderCount: 5,
      minVes: 50,
      maxVes: 50 * 800,
      payMethods: ['Banesco'],
    }));
    const res = computeVolumeWeightedPrice(many, 'BUY', 500);
    expect(res.fillableUsdt).toBe(200); // 4 ofertas * 50 USDT
  });

  it('rechaza ofertas con precio outlier (anti-manipulación)', () => {
    // 2 ofertas normales + 1 absurda (precio 10x) que no debe distorsionar
    const offers = [...makeOffers([800, 810], 500 * 800), makeOffers([8000], 50 * 8000)[0]];
    const res = computeVolumeWeightedPrice(offers, 'BUY', 900);
    expect(res.fillableUsdt).toBe(900); // la outlier queda fuera por filtro de mediana
    expect(res.price).toBeGreaterThan(800);
    expect(res.price).toBeLessThan(810); // el precio promedio no se infla a miles
  });

  it('filtra por finishRatePct mínimo (anti-fake) cuando se pide', () => {
    const buenos = makeOffers([810, 820], 500 * 810, 98);
    const malos = makeOffers([800], 500 * 800, 40); // barato pero con 40% de culminación
    const offers = [...buenos, ...malos];
    const sinFiltro = computeVolumeWeightedPrice(offers, 'BUY', 1000, {});
    const conFiltro = computeVolumeWeightedPrice(offers, 'BUY', 1000, { minFinishRatePct: 90 });
    expect(sinFiltro.fillableUsdt).toBe(1000);
    expect(conFiltro.fillableUsdt).toBe(1000); // mismo volumen total...
    expect(conFiltro.price).toBeGreaterThan(sinFiltro.price); // ...pero el barato fake ya no pesa
    expect(conFiltro.price).toBeCloseTo((500 * 810 + 500 * 820) / 1000, 2);
  });
});
