import { runPortfolioStressTest } from '../core/index.js';
import { StressTestPortfolioInputSchema, type StressTestPortfolioInput } from '../schemas/index.js';

export const stressTestPortfolioTool = {
  name: 'stress_test_portfolio',
  description:
    'Evalúa la resiliencia del capital P2P ante devaluaciones del bolívar o saltos del paralelo (5%, 10%, 20%), calculando drawdowns proyectados y cobertura Delta-Neutral necesaria.',
  inputSchema: StressTestPortfolioInputSchema,
  execute: (input: StressTestPortfolioInput) => {
    const result = runPortfolioStressTest({
      usdtCapital: input.usdtCapital,
      vesCapital: input.vesCapital,
      referenceRate: input.referenceRate,
      devaluationScenariosPct: input.devaluationScenariosPct,
      hedgedPct: input.hedgedPct,
    });

    return {
      baselinePortfolioValueUsdt: result.baselinePortfolioValueUsdt,
      vesExposureUsdt: result.vesExposureUsdt,
      vesExposurePct: result.vesExposurePct,
      hedgedPct: result.hedgedPct,
      unhedgedVesAmount: result.unhedgedVesAmount,
      scenariosCount: result.scenarios.length,
      scenarios: result.scenarios,
      recommendedHedgeUsdt: result.recommendedHedgeUsdt,
      institutionalSummary: result.institutionalSummary,
    };
  },
};
