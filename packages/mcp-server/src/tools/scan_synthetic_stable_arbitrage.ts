import {
  scanSyntheticStableCurves,
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
    const minNetSpreadPct = input.minNetSpreadPct ?? 0.15;

    // No `defaultQuotes`. The renderer fallback already refused to scan an
    // invented curve (see `mcp-fallbacks.ts`); this daemon side kept a second
    // copy of a fixed USDC/VES pair (85.5 / 86.8) and reported
    // `opportunitiesCount` over it — an arbitrage synthetic no scan ever
    // observed. `0` would be just as false, since it asserts "we scanned and
    // found nothing". Without a measured curve there is no count.
    const pairs = input.pairs ?? [];
    if (pairs.length === 0) {
      return {
        success: false,
        opportunities: [],
        opportunitiesCount: null,
        reason: 'NO_MEASURED_CURVE',
        requiredSource:
          'Measured spot rate and measured P2P VES rate per route (spotPair, spotRate, p2pUsdtRateFiat, p2pTargetRateFiat)',
        evaluatedAt: new Date().toISOString(),
      };
    }

    const opportunities = scanSyntheticStableCurves(pairs, minNetSpreadPct);

    return {
      success: true,
      opportunitiesCount: opportunities.length,
      opportunities,
      evaluatedAt: new Date().toISOString(),
    };
  },
};
