import {
  scanSyntheticStableCurves,
  type StableCrossQuote,
} from '../core/index.js';
import {
  ScanSyntheticStableArbitrageInputSchema,
  type ScanSyntheticStableArbitrageInput,
} from '../schemas/index.js';

export const scanSyntheticStableArbitrageTool = {
  name: 'scan_synthetic_stable_arbitrage',
  description:
    'Rastrea oportunidades de arbitraje sintético entre pares de stablecoins (USDT/USDC/FDUSD/EURC/PYUSD) y los libros P2P locales (VES/COP).',
  inputSchema: ScanSyntheticStableArbitrageInputSchema,
  execute: (input: ScanSyntheticStableArbitrageInput) => {
    const pairs = (input.pairs as StableCrossQuote[]) || [];
    const minNetSpreadPct = input.minNetSpreadPct ?? 0.15;

    const defaultQuotes: StableCrossQuote[] = [
      {
        targetAsset: 'USDC',
        spotPair: 'USDCUSDT',
        spotRate: 0.9992,
        spotFeePct: 0.05,
        p2pUsdtRateFiat: 85.5,
        p2pTargetRateFiat: 86.8,
        fiatCurrency: 'VES',
        tradingCapitalUsd: 2500,
      },
      {
        targetAsset: 'FDUSD',
        spotPair: 'FDUSDUSDT',
        spotRate: 0.9998,
        spotFeePct: 0.0,
        p2pUsdtRateFiat: 85.5,
        p2pTargetRateFiat: 86.4,
        fiatCurrency: 'VES',
        tradingCapitalUsd: 2500,
      },
    ];

    const quotesToEvaluate = pairs.length > 0 ? pairs : defaultQuotes;
    const opportunities = scanSyntheticStableCurves(quotesToEvaluate, minNetSpreadPct);

    return {
      success: true,
      opportunitiesCount: opportunities.length,
      opportunities,
      evaluatedAt: new Date().toISOString(),
    };
  },
};
