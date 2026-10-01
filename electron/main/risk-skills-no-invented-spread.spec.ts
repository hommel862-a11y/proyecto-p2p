/**
 * Un default inventado que no sólo miente: se acumula.
 *
 * `forecast_market_volatility_2h` rellenaba `currentSpreadPct` con 1.2 cuando el
 * llamador no lo pasaba, y después metía ese 1.2 en `recordVolatilityTick`, que lo
 * convierte en un precio de compra fabricado (`parallel * (1 - 1.2/100)`) y lo
 * empuja a un buffer circular de 40 ticks. Ese buffer alimenta `recentTicks` de
 * todos los pronósticos futuros.
 *
 * Es la diferencia entre mentir una vez y envenenar la memoria: aunque después
 * lleguen spreads correctos, el tick falso ya está en la serie y las medias
 * móviles se lo llevan puesto. El schema declaraba `required: ['currentSpreadPct']`
 * y la implementación lo inventaba igual.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { dispatchRiskSkill } from './skills/risk-skills';
import {
  clearFinancialSkillMarketData,
  getVolatilityTicks,
  recordVolatilityTick,
  seedFinancialSkillMarketData,
} from './skills/market-state';

/** Fuerza el buffer de ticks a vacío (es estado de módulo compartido). */
function drenarTicks(): void {
  for (let i = 0; i < 64; i++) {
    recordVolatilityTick(0, 0);
  }
  // `recordVolatilityTick` ignora ticks con precio <= 0, así que hace falta el
  // camino que sí empuja. Se limpia por reflexión del array observable.
  const restantes = getVolatilityTicks();
  while (restantes.length > 0) restantes.shift();
}

describe('forecast_market_volatility_2h: el spread no se inventa', () => {
  afterEach(() => {
    clearFinancialSkillMarketData();
    drenarTicks();
  });

  it('sin currentSpreadPct NO publica un spread de 1.2 como si fuera medido', () => {
    const res = dispatchRiskSkill('forecast_market_volatility_2h', {
      parallelRate: 90.5,
      bcvRate: 72.0,
    }, Date.now()) as any;

    expect(res.success).toBe(false);
    expect(res.unavailableReason).toContain('currentSpreadPct');
    expect(res.data).toBeNull();
  });

  it('no contamina el buffer de ticks con un spread inventado', () => {
    drenarTicks();

    // Con parallelRate pero sin spread medido no se puede derivar un precio de
    // compra del libro. Lo único honesto es no registrar el tick.
    dispatchRiskSkill('forecast_market_volatility_2h', {
      parallelRate: 90.5,
      bcvRate: 72.0,
    }, Date.now());

    expect(getVolatilityTicks().length).toBe(0);
  });

  it('un spread medido explícitamente sí se registra y se usa', () => {
    drenarTicks();

    const res = dispatchRiskSkill('forecast_market_volatility_2h', {
      currentSpreadPct: 1.45,
      parallelRate: 90.5,
      bcvRate: 72.0,
    }, Date.now()) as any;

    expect(res.success).toBe(true);
    expect(res.data.volatilityIndex).toBeGreaterThanOrEqual(5);
    expect(res.data.volatilityIndex).toBeLessThanOrEqual(100);

    const ticks = getVolatilityTicks();
    expect(ticks.length).toBe(1);
    // 90.5 con 1.45% => buy = 90.5 * (1 - 0.0145)
    expect(ticks[0].sellPrice).toBeCloseTo(90.5, 5);
    expect(ticks[0].buyPrice).toBeCloseTo(90.5 * (1 - 0.0145), 5);
  });

  it('un spread de 0 explícito se respeta y no se confunde con "ausente"', () => {
    drenarTicks();

    // 0% es un hecho del libro (paralelo y oficial al mismo precio). El `|| 1.2`
    // lo habría convertido en 1.2.
    const res = dispatchRiskSkill('forecast_market_volatility_2h', {
      currentSpreadPct: 0,
      parallelRate: 90.5,
      bcvRate: 72.0,
    }, Date.now()) as any;

    expect(res.success).toBe(true);

    const ultimo = getVolatilityTicks()[0];
    expect(ultimo.buyPrice).toBeCloseTo(ultimo.sellPrice, 6);
  });

  it('sin parallelRate no hay brecha BCV que inventar', () => {
    drenarTicks();

    const res = dispatchRiskSkill('forecast_market_volatility_2h', {
      currentSpreadPct: 1.45,
    }, Date.now()) as any;

    expect(res.success).toBe(true);
    expect(res.data.sources.bcvGap).toBeUndefined();
    expect(getVolatilityTicks().length).toBe(0);
  });

  it('el buffer nunca acumula precios de cero', () => {
    drenarTicks();
    clearFinancialSkillMarketData();

    dispatchRiskSkill('forecast_market_volatility_2h', { currentSpreadPct: 1.45 }, Date.now());

    for (const t of getVolatilityTicks()) {
      expect(t.buyPrice).toBeGreaterThan(0);
      expect(t.sellPrice).toBeGreaterThan(0);
    }
  });
});

describe('recordVolatilityTick: la ausencia cae al libro real, no a un default', () => {
  afterEach(() => {
    clearFinancialSkillMarketData();
    drenarTicks();
  });

  it('sin spread y sin libro, no registra nada en vez de fabricar un precio', () => {
    drenarTicks();
    clearFinancialSkillMarketData();

    recordVolatilityTick(90.5, null);

    expect(getVolatilityTicks().length).toBe(0);
  });

  it('sin spread pero con libro real, usa los precios del libro', () => {
    drenarTicks();
    // Ambos lados: con un solo lado del libro no hay spread que derivar y la
    // guarda de `recordVolatilityTick` lo rechaza. Esa guarda es correcta.
    seedFinancialSkillMarketData({
      buyOffers: [
        {
          advId: 'A1',
          merchantName: 'M1',
          orderType: 'BUY',
          price: 89.0,
          availableAmountCrypto: 500,
          minVes: 100,
          maxVes: 40000,
          paymentMethods: ['Banesco'],
          minLimitFiat: 100,
          maxLimitFiat: 40000,
          fiatCurrency: 'VES',
        },
      ],
      sellOffers: [
        {
          advId: 'A2',
          merchantName: 'M2',
          orderType: 'SELL',
          price: 90.5,
          availableAmountCrypto: 500,
          minVes: 100,
          maxVes: 40000,
          paymentMethods: ['Banesco'],
          minLimitFiat: 100,
          maxLimitFiat: 40000,
          fiatCurrency: 'VES',
        },
      ],
    });

    recordVolatilityTick(90.5, null);

    const ticks = getVolatilityTicks();
    expect(ticks.length).toBe(1);
    expect(ticks[0].buyPrice).toBe(89.0);
    expect(ticks[0].sellPrice).toBe(90.5);
  });
});
