import {
  evaluateMacroBcvRegime,
  type MacroTelemetryInput,
} from '../core/index.js';
import {
  PredictBcvMacroRegimeInputSchema,
  type PredictBcvMacroRegimeInput,
} from '../schemas/index.js';

export const predictBcvMacroRegimeTool = {
  name: 'predict_bcv_macro_regime',
  description:
    'Predice intervenciones del Banco Central de Venezuela (BCV), expansión de brecha cambiaria y directivas defensivas de retención de bolívares.',
  inputSchema: PredictBcvMacroRegimeInputSchema,
  execute: (input: PredictBcvMacroRegimeInput) => {
    const assessment = evaluateMacroBcvRegime({
      bcvOfficialRate: input.bcvOfficialRate,
      parallelMarketRate: input.parallelMarketRate,
      daysSinceLastIntervention: input.daysSinceLastIntervention,
      currentHourOfDayUtcMinus4: input.currentHourOfDayUtcMinus4,
      currentDayOfWeek: input.currentDayOfWeek,
      estimatedWeeklyBcvInjectionUsd: input.estimatedWeeklyBcvInjectionUsd,
    });

    return {
      success: true,
      assessment,
      evaluatedAt: new Date().toISOString(),
    };
  },
};
