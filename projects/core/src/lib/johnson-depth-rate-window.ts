// projects/core/src/lib/johnson-depth-rate-window.ts
import type { BinanceP2pMarketDepth } from './binance-p2p';
import { computeTriangulationGap } from './cotizave';
import { roundMoney } from './money';

export interface RateDivergenceInput {
  depth: BinanceP2pMarketDepth;
  bcvRate: number;
  parallelRate: number;
  parallelRateBefore?: number;
  windowMinutes: number;
}

export interface RateDivergenceResult {
  gapVes: number | null;
  gapPct: number | null;
  rateMomentumPct: number;
  signal: 'SELL_WINDOW' | 'BUY_WINDOW' | 'NEUTRAL';
}

/**
 * Ventana de arbitraje P2P vs mercado paralelo.
 * Reutiliza computeTriangulationGap (fuente de verdad del gap, cotizave.ts)
 * y añade el momentum temporal de la tasa paralela (rezago).
 */
export function detectRateDivergence(input: RateDivergenceInput): RateDivergenceResult {
  const { depth, bcvRate, parallelRate, parallelRateBefore, windowMinutes } = input;

  void bcvRate;
  void windowMinutes;

  // binance.bid = bestSellPrice (lo que pagas); other.ask = parallelRate (lo que te pagan)
  const gap = computeTriangulationGap(
    { bid: depth.bestSellPrice },
    { ask: parallelRate },
  );

  const rateMomentumPct =
    parallelRateBefore && parallelRateBefore > 0
      ? roundMoney((parallelRate / parallelRateBefore - 1) * 100, 2)
      : 0;

  let signal: 'SELL_WINDOW' | 'BUY_WINDOW' | 'NEUTRAL' = 'NEUTRAL';
  if (gap.gapPct !== null) {
    if (gap.gapPct >= 2) signal = 'SELL_WINDOW';
    else if (gap.gapPct <= -2) signal = 'BUY_WINDOW';
    else if (rateMomentumPct > 0.5 && gap.gapPct < 1) signal = 'BUY_WINDOW'; // rezago
  }

  return { gapVes: gap.gapVes, gapPct: gap.gapPct, rateMomentumPct, signal };
}
