// projects/core/src/lib/johnson-depth-rate-window.spec.ts
import { describe, it, expect } from 'vitest';
import { detectRateDivergence } from './johnson-depth-rate-window';
import type { BinanceP2pMarketDepth } from './binance-p2p';

function midDepth(p2pBuy: number, p2pSell: number): BinanceP2pMarketDepth {
  return {
    asset: 'USDT',
    fiat: 'VES',
    bestBuyPrice: p2pBuy,
    bestSellPrice: p2pSell,
    spreadVes: p2pSell - p2pBuy,
    spreadPct: 0.25,
    updatedAt: new Date().toISOString(),
    buyOffers: [],
    sellOffers: [],
  };
}

describe('detectRateDivergence', () => {
  it('Binance cobra menos que el paralelo paga => SELL_WINDOW', () => {
    // compras USDT a 100; el paralelo te paga 103 => gapPct +3
    const res = detectRateDivergence({
      depth: midDepth(99, 100),
      bcvRate: 102,
      parallelRate: 103,
      windowMinutes: 5,
    });
    expect(res.gapPct).toBeCloseTo(3, 1);
    expect(res.signal).toBe('SELL_WINDOW');
  });

  it('Binance cobra más que el paralelo paga => BUY_WINDOW', () => {
    const res = detectRateDivergence({
      depth: midDepth(99, 100),
      bcvRate: 98,
      parallelRate: 97,
      windowMinutes: 5,
    });
    expect(res.gapPct).toBeCloseTo(-3, 1);
    expect(res.signal).toBe('BUY_WINDOW');
  });

  it('dentro de rango => NEUTRAL', () => {
    const res = detectRateDivergence({
      depth: midDepth(99, 100),
      bcvRate: 100,
      parallelRate: 100.5,
      windowMinutes: 5,
    });
    expect(res.signal).toBe('NEUTRAL');
  });

  it('tasa sube y el P2P no ajusta => BUY_WINDOW por rezago', () => {
    const res = detectRateDivergence({
      depth: midDepth(100, 101),
      bcvRate: 102,
      parallelRate: 102,
      parallelRateBefore: 100,
      windowMinutes: 5,
    });
    expect(res.rateMomentumPct).toBeCloseTo(2, 1);
    expect(res.signal).toBe('BUY_WINDOW');
  });

  it('depth vacío => NEUTRAL seguro (computeTriangulationGap devuelve null)', () => {
    const res = detectRateDivergence({
      depth: midDepth(0, 0),
      bcvRate: 100,
      parallelRate: 100,
      windowMinutes: 5,
    });
    expect(res.gapPct).toBeNull();
    expect(res.signal).toBe('NEUTRAL');
  });
});
