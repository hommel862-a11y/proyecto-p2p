import { analyzeMicrostructurePressure } from '../core/index.js';
import { AnalyzeOrderbookPressureInputSchema, type AnalyzeOrderbookPressureInput } from '../schemas/index.js';

export const analyzeOrderbookPressureTool = {
  name: 'analyze_orderbook_pressure',
  description: 'Evalúa la microestructura del libro de órdenes P2P, calculando el ratio de desbalance entre oferta y demanda, velocidad de presión y riesgo de liquidez fantasma/spoofing.',
  inputSchema: AnalyzeOrderbookPressureInputSchema,
  execute: (input: AnalyzeOrderbookPressureInput) => {
    const analysis = analyzeMicrostructurePressure(
      input.fiat,
      input.bidDepthUsdt,
      input.askDepthUsdt,
      input.includeSpoofCheck,
    );

    return {
      fiat: analysis.fiat,
      bidDepthUsdt: analysis.bidDepthUsdt,
      askDepthUsdt: analysis.askDepthUsdt,
      orderbookImbalanceRatio: analysis.orderbookImbalanceRatio,
      dominantSide: analysis.dominantSide,
      manipulationRiskScore: analysis.manipulationRiskScore,
      phantomLiquidityDetected: analysis.phantomLiquidityDetected,
      pressureVelocity: analysis.pressureVelocity,
      actionableInsight: analysis.actionableInsight,
      marketRegime:
        analysis.manipulationRiskScore > 50
          ? 'MANIPULATED_OR_DISPERSION_RISK'
          : analysis.dominantSide === 'BUY_PRESSURE'
            ? 'BULLISH_LOCAL_DEMAND'
            : analysis.dominantSide === 'SELL_PRESSURE'
              ? 'BEARISH_LOCAL_SUPPLY'
              : 'BALANCED_LIQUIDITY',
    };
  },
};
