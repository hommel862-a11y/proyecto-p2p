import { analyzeMicrostructurePressure, PRESSURE_PROVENANCE } from '../core/index.js';
import {
  AnalyzeOrderbookPressureInputSchema,
  type AnalyzeOrderbookPressureInput,
} from '../schemas/index.js';

export const analyzeOrderbookPressureTool = {
  name: 'analyze_orderbook_pressure',
  description:
    'Evalúa la microestructura del libro de órdenes P2P, calculando obiRatio [-1,+1], orderbookImbalanceRatio [0,1], gaps de liquidez y riesgo de liquidez fantasma/spoofing.',
  inputSchema: AnalyzeOrderbookPressureInputSchema,
  execute: async (input: AnalyzeOrderbookPressureInput) => {
    const analysis = await analyzeMicrostructurePressure(
      input.fiat,
      input.bidDepthUsdt,
      input.askDepthUsdt,
      input.includeSpoofCheck,
      { asset: input.asset, rows: input.rows },
    );

    const marketRegime =
      analysis.provenance === PRESSURE_PROVENANCE.UNAVAILABLE
        ? 'UNAVAILABLE'
        : (analysis.manipulationRiskScore ?? 0) > 50
          ? 'MANIPULATED_OR_DISPERSION_RISK'
          : analysis.dominantSide === 'BUY_PRESSURE'
            ? 'BULLISH_LOCAL_DEMAND'
            : analysis.dominantSide === 'SELL_PRESSURE'
              ? 'BEARISH_LOCAL_SUPPLY'
              : 'BALANCED_LIQUIDITY';

    return {
      fiat: analysis.fiat,
      asset: analysis.asset,
      bidDepthUsdt: analysis.bidDepthUsdt,
      askDepthUsdt: analysis.askDepthUsdt,
      orderbookImbalanceRatio: analysis.orderbookImbalanceRatio,
      obiRatio: analysis.obiRatio,
      dominantSide: analysis.dominantSide,
      manipulationRiskScore: analysis.manipulationRiskScore,
      phantomLiquidityDetected: analysis.phantomLiquidityDetected,
      pressureVelocity: analysis.pressureVelocity,
      liquidityGaps: analysis.liquidityGaps,
      suspiciousOffersCount: analysis.suspiciousOffersCount,
      provenance: analysis.provenance,
      actionable: analysis.actionable,
      unavailableReason: analysis.unavailableReason,
      expectedSource: analysis.expectedSource,
      actionableInsight: analysis.actionableInsight,
      marketRegime,
    };
  },
};
