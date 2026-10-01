import { describe, it, expect } from 'vitest';
import { scanSyntheticStableArbitrageTool } from './scan_synthetic_stable_arbitrage.js';
import { ScanSyntheticStableArbitrageInputSchema } from '../schemas/index.js';

describe('scan_synthetic_stable_arbitrageTool — sin curva medida no hay conteo', () => {
  // The tool used to carry its own `defaultQuotes` (a fixed USDC/VES pair at
  // 85.5 / 86.8) and scan it, reporting `opportunitiesCount` over a curve no
  // scan ever observed. The renderer fallback had already refused to do this;
  // the daemon kept a second copy of the same invented pair.
  it('NO escanea una curva de ejemplo cuando no llega ninguna', () => {
    const input = ScanSyntheticStableArbitrageInputSchema.parse({});

    const result = scanSyntheticStableArbitrageTool.execute(input) as Record<string, unknown>;

    expect(result['opportunitiesCount']).toBeNull();
    expect(result['success']).toBe(false);
    expect(result['reason']).toBe('NO_MEASURED_CURVE');
  });

  it('declara qué fuente falta en vez de devolver un número', () => {
    const input = ScanSyntheticStableArbitrageInputSchema.parse({});

    const result = scanSyntheticStableArbitrageTool.execute(input) as Record<string, unknown>;

    expect(typeof result['requiredSource']).toBe('string');
    expect(String(result['requiredSource'])).toContain('p2pUsdtRateFiat');
  });

  it('escanea la curva que envía el llamante', () => {
    const input = ScanSyntheticStableArbitrageInputSchema.parse({
      pairs: [
        {
          targetAsset: 'USDC',
          spotPair: 'USDCUSDT',
          spotRate: 1,
          spotFeePct: 0.05,
          p2pUsdtRateFiat: 950,
          p2pTargetRateFiat: 968,
          fiatCurrency: 'VES',
          tradingCapitalUsd: 2500,
        },
      ],
    });

    const result = scanSyntheticStableArbitrageTool.execute(input) as Record<string, unknown>;

    expect(result['success']).toBe(true);
    expect(typeof result['opportunitiesCount']).toBe('number');
    expect(Array.isArray(result['opportunities'])).toBe(true);
  });
});