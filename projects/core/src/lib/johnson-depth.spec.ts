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
    maxVes:
      maxVesEach >= 10000 && prices[0] > 0
        ? Math.round((maxVesEach / prices[0]) * price)
        : maxVesEach,
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

import {
  calculateDepthQuality,
  calculateLiquidityScore,
  determineSignal,
  DEFAULT_JOHNSON_REQUIREMENTS,
} from './johnson-depth';

const REQUIRED = DEFAULT_JOHNSON_REQUIREMENTS;

function makeDepth(bestBuy: number, bestSell: number, buyVolUsdt: number, sellVolUsdt: number) {
  return {
    asset: 'USDT',
    fiat: 'VES',
    bestBuyPrice: bestBuy,
    bestSellPrice: bestSell,
    spreadVes: bestSell - bestBuy,
    spreadPct: ((bestSell - bestBuy) / bestBuy) * 100,
    updatedAt: new Date().toISOString(),
    buyOffers: [
      {
        advNo: 'b0',
        price: bestBuy,
        merchantName: 'B0',
        finishRatePct: 100,
        orderCount: 5,
        minVes: 100,
        maxVes: buyVolUsdt * bestBuy,
        payMethods: ['Banesco'],
      },
    ],
    sellOffers: [
      {
        advNo: 's0',
        price: bestSell,
        merchantName: 'S0',
        finishRatePct: 100,
        orderCount: 5,
        minVes: 100,
        maxVes: sellVolUsdt * bestSell,
        payMethods: ['Banesco'],
      },
    ],
  } as const as any;
}

describe('calculateDepthQuality', () => {
  it('mercado equilibrado y rentable => score alto', () => {
    const depth = makeDepth(800, 825, 1000, 1000);
    expect(calculateDepthQuality(depth, REQUIRED)).toBeGreaterThanOrEqual(80);
  });

  it('sin precios => score 0', () => {
    const depth = makeDepth(0, 0, 1000, 1000);
    expect(calculateDepthQuality(depth, REQUIRED)).toBe(0);
  });

  it('spread enorme castiga el score', () => {
    const good = makeDepth(800, 805, 1000, 1000);
    const bad = makeDepth(800, 900, 1000, 1000);
    expect(calculateDepthQuality(bad, REQUIRED)).toBeLessThan(
      calculateDepthQuality(good, REQUIRED),
    );
  });
});

describe('calculateLiquidityScore', () => {
  it('liquidez abundante => 100', () => {
    const depth = makeDepth(800, 825, 2000, 2000);
    expect(calculateLiquidityScore(depth, REQUIRED)).toBe(100);
  });

  it('liquidez nula => 0', () => {
    const depth = makeDepth(800, 825, 0, 0);
    expect(calculateLiquidityScore(depth, REQUIRED)).toBe(0);
  });
});

describe('determineSignal', () => {
  it('spread menor al mínimo => AVOID siempre', () => {
    const depth = makeDepth(800, 800.1, 5000, 5000);
    expect(determineSignal(depth, 95, 100, REQUIRED)).toBe('AVOID');
  });

  it('calidad alta + spread sano + liquidez => STRONG_BUY', () => {
    const depth = makeDepth(800, 825, 2000, 2000);
    expect(determineSignal(depth, 90, 100, REQUIRED)).toBe('STRONG_BUY');
  });

  it('calidad media => BUY', () => {
    const depth = makeDepth(800, 825, 2000, 2000);
    expect(determineSignal(depth, 65, 100, REQUIRED)).toBe('BUY');
  });

  it('liquidez insuficiente => AVOID', () => {
    const depth = makeDepth(800, 825, 0, 0);
    expect(determineSignal(depth, 90, 0, REQUIRED)).toBe('AVOID');
  });
});

import { computeBankProfits, buildJohnsonMarketQuality } from './johnson-depth';

function makeBankDepth(
  buyPrice: number,
  sellPrice: number,
  buyVolUsdt: number,
  sellVolUsdt: number,
) {
  return {
    asset: 'USDT',
    fiat: 'VES',
    bestBuyPrice: buyPrice,
    bestSellPrice: sellPrice,
    spreadVes: sellPrice - buyPrice,
    spreadPct: ((sellPrice - buyPrice) / buyPrice) * 100,
    updatedAt: new Date().toISOString(),
    buyOffers: [
      {
        advNo: 'b0',
        price: buyPrice,
        merchantName: 'B0',
        finishRatePct: 100,
        orderCount: 5,
        minVes: 100,
        maxVes: buyVolUsdt * buyPrice,
        payMethods: ['Banesco'],
      },
    ],
    sellOffers: [
      {
        advNo: 's0',
        price: sellPrice,
        merchantName: 'S0',
        finishRatePct: 100,
        orderCount: 5,
        minVes: 100,
        maxVes: sellVolUsdt * sellPrice,
        payMethods: ['Banesco'],
      },
    ],
  } as const as any;
}

describe('computeBankProfits', () => {
  it('calcula ganancia NETA: compra 500 USDT barato y vende caro, sin fees (TAKER, mismo banco)', () => {
    const depth = makeBankDepth(800, 825, 1000, 1000);
    const profits = computeBankProfits(depth, ['ALL'], REQUIRED);
    expect(profits).toHaveLength(1);
    const [p] = profits;
    expect(p.fillableUsdt).toBe(500); // targetUsdt default
    expect(p.grossProfitVes).toBeCloseTo(500 * 25, 0);
    expect(p.binanceFeeUsdt).toBe(0); // TAKER
    expect(p.bankFeesVes).toBe(0); // mismo banco, no interbank
    expect(p.netGainVes).toBeCloseTo(500 * 25, 0);
    expect(p.roiCyclePct).toBeCloseTo((12500 / 400000) * 100, 2); // 3.125%
    expect(p.effectiveFeeDragPct).toBeCloseTo(0, 2);
    expect(p.isSafe).toBe(true); // >= 0.50%
  });

  it('sin input válido produce fila cero sin lanzar excepción (computeArbitrageCycle guarda)', () => {
    const depth = { ...makeBankDepth(0, 0, 0, 0), buyOffers: [], sellOffers: [] } as const as any;
    expect(() => computeBankProfits(depth, ['ALL'], REQUIRED)).not.toThrow();
    const [p] = computeBankProfits(depth, ['ALL'], REQUIRED);
    expect(p.netGainVes).toBe(0);
    expect(p.isSafe).toBe(false);
  });

  it('ordena por ganancia neta descendente', () => {
    const depth = {
      ...makeBankDepth(800, 825, 1000, 1000),
      buyOffers: [
        {
          advNo: 'b0',
          price: 800,
          merchantName: 'B0',
          finishRatePct: 100,
          orderCount: 5,
          minVes: 100,
          maxVes: 1000 * 800,
          payMethods: ['Banesco'],
        },
        {
          advNo: 'b1',
          price: 810,
          merchantName: 'B1',
          finishRatePct: 100,
          orderCount: 5,
          minVes: 100,
          maxVes: 1000 * 810,
          payMethods: ['PagoMovil'],
        },
      ],
      sellOffers: [
        {
          advNo: 's0',
          price: 825,
          merchantName: 'S0',
          finishRatePct: 100,
          orderCount: 5,
          minVes: 100,
          maxVes: 1000 * 825,
          payMethods: ['Banesco', 'PagoMovil'],
        },
      ],
    } as const as any;

    const profits = computeBankProfits(depth, ['BANESCO', 'PAGO_MOVIL'], REQUIRED);
    expect(profits[0].bankKey).toBe('BANESCO'); // compra 800 => mayor ganancia
    expect(profits[0].netGainVes).toBeGreaterThan(profits[1].netGainVes);
    expect(profits[1].bankCode).toBe('OTRO'); // PAGO_MOVIL no es banco -> fees OTRO (D4)
  });

  it('si no hay liquidez suficiente el fillable baja y la ganancia es proporcional', () => {
    const depth = makeBankDepth(800, 825, 100, 1000); // solo 100 USDT comprables
    const [p] = computeBankProfits(depth, ['ALL'], REQUIRED);
    expect(p.fillableUsdt).toBe(100);
  });
});

describe('buildJohnsonMarketQuality', () => {
  it('integra scoring + mejor banco (neto) + timestamp', () => {
    const depth = makeBankDepth(800, 825, 2000, 2000);
    const q = buildJohnsonMarketQuality(depth, ['BANESCO', 'ALL'], REQUIRED);
    expect(q.depthScore).toBeGreaterThan(0);
    expect(q.liquidityScore).toBeGreaterThan(0);
    expect(q.spreadVes).toBe(25);
    expect(q.spreadPct).toBeGreaterThan(0);
    expect(q.bestBank).not.toBeNull();
    expect(q.bankProfits.length).toBeGreaterThan(0);
    expect(q.bankProfits[0].netGainVes).toBeGreaterThan(0);
    expect(q.timestamp).toBeGreaterThan(0);
  });

  it('con depth vacío la recomendación es AVOID y no lanza', () => {
    const depth = { ...makeBankDepth(0, 0, 0, 0), buyOffers: [], sellOffers: [] } as const as any;
    const q = buildJohnsonMarketQuality(depth, ['ALL'], REQUIRED);
    expect(q.recommendation).toBe('AVOID');
    expect(q.bankProfits[0].netGainVes).toBe(0);
  });
});
