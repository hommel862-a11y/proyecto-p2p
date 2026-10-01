import { describe, it, expect } from 'vitest';
import { ScanSyntheticStableArbitrageInputSchema } from '../schemas/index.js';
import type { StableCrossQuote } from '../core/index.js';

describe('ScanSyntheticStableArbitrageInputSchema — el contrato de la curva', () => {
  // The caller sends the shape the engine actually consumes. The schema used to
  // describe a different object entirely (`sourceAsset` / `reverseExchangeRate` /
  // `reverseFeePct`), so this real payload was rejected at the boundary.
  const realQuote: StableCrossQuote = {
    targetAsset: 'USDC',
    spotPair: 'USDCUSDT',
    spotRate: 1,
    spotFeePct: 0.05,
    p2pUsdtRateFiat: 950,
    p2pTargetRateFiat: 968,
    fiatCurrency: 'VES',
    tradingCapitalUsd: 2500,
  };

  it('acepta la forma que el motor realmente consume', () => {
    const parsed = ScanSyntheticStableArbitrageInputSchema.parse({ pairs: [realQuote] });

    expect(parsed.pairs).toHaveLength(1);
    expect(parsed.pairs![0]!.spotPair).toBe('USDCUSDT');
    expect(parsed.pairs![0]!.p2pUsdtRateFiat).toBe(950);
  });

  // If the phantom shape still validates, then the boundary is describing a
  // currency pair engine instead of a synthetic-stable curve engine, and every
  // `spotRate`/`p2pUsdtRateFiat` read downstream would be `undefined`.
  it('RECHAZA la forma fantasma del engine de pares de divisa', () => {
    const phantom = {
      sourceAsset: 'USD',
      targetAsset: 'VES',
      exchangeRate: 950,
      feePct: 0,
      reverseExchangeRate: 0.00105,
      reverseFeePct: 0,
    };

    const result = ScanSyntheticStableArbitrageInputSchema.safeParse({ pairs: [phantom] });

    expect(result.success).toBe(false);
  });

  it('no acepta una curva con spotRate ausente: sin medición no hay curva', () => {
    const { spotRate: _dropped, ...withoutSpotRate } = realQuote;

    const result = ScanSyntheticStableArbitrageInputSchema.safeParse({ pairs: [withoutSpotRate] });

    expect(result.success).toBe(false);
  });

  it('no acepta una curva con la tasa P2P ausente: sin medición no hay curva', () => {
    const { p2pUsdtRateFiat: _dropped, ...withoutUsdtRate } = realQuote;

    const result = ScanSyntheticStableArbitrageInputSchema.safeParse({ pairs: [withoutUsdtRate] });

    expect(result.success).toBe(false);
  });

  it('no acepta una curva sin par spot: el par es la identidad de la ruta', () => {
    const { spotPair: _dropped, ...withoutPair } = realQuote;

    const result = ScanSyntheticStableArbitrageInputSchema.safeParse({ pairs: [withoutPair] });

    expect(result.success).toBe(false);
  });
});