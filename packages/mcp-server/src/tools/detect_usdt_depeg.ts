import { detectUsdtDepegParity } from '../core/index.js';
import { DetectUsdtDepegInputSchema, type DetectUsdtDepegInput } from '../schemas/index.js';
import { fetchLiveUsdtSpotReading } from './usdt-spot-reader.js';

export const detectUsdtDepegTool = {
  name: 'detect_usdt_depeg',
  description:
    'Monitorea la paridad global de USDT respecto al USD fiat ($1.000), alertando sobre despegues por descuento o prima y riesgos de desconfianza sistémica. Si no se provee precio spot, consulta los tickers públicos de Binance o Kraken en vivo. Sin feed ni precio, declara ausencia sin inventar paridad.',
  inputSchema: DetectUsdtDepegInputSchema,
  execute: async (input: DetectUsdtDepegInput) => {
    let price: number | null = null;
    let source = 'INPUT_PARAMETER';

    if (
      typeof input.spotUsdtPrice === 'number' &&
      Number.isFinite(input.spotUsdtPrice) &&
      input.spotUsdtPrice > 0
    ) {
      price = input.spotUsdtPrice;
    } else {
      const live = await fetchLiveUsdtSpotReading();
      if (live !== null) {
        price = live.price;
        source = live.source;
      }
    }

    if (price === null) {
      return {
        spotUsdtPrice: null,
        parityDeviationPct: null,
        status: 'UNAVAILABLE_NO_LIVE_FEED' as const,
        isDepegged: null,
        thresholdPct: input.thresholdPct,
        arbitrageOpportunity: false,
        riskSeverity: 'NONE' as const,
        recommendation:
          'Sin lectura de precio spot USDT/USD en vivo. No se afirma paridad.',
        isEmergencyActionRequired: false,
        actionable: false,
        source: 'NONE',
        expectedSource: 'Binance (USDCUSDT) o Kraken (USDTUSD) ticker spot público',
        unavailableReason: 'missing_evidence:spotUsdtPrice',
      };
    }

    const evalResult = detectUsdtDepegParity(price, input.thresholdPct);

    return {
      spotUsdtPrice: evalResult.spotUsdtPrice,
      parityDeviationPct: evalResult.parityDeviationPct,
      status: evalResult.status,
      isDepegged: evalResult.isDepegged,
      thresholdPct: evalResult.thresholdPct,
      arbitrageOpportunity: evalResult.arbitrageOpportunity,
      riskSeverity: evalResult.riskSeverity,
      recommendation: evalResult.recommendation,
      isEmergencyActionRequired:
        evalResult.riskSeverity === 'CRITICAL' || evalResult.riskSeverity === 'HIGH',
      actionable: true,
      source,
    };
  },
};

