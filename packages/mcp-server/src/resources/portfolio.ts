/**
 * Portfolio & Risk Resources — Endpoints de lectura de escenarios de estrés y asignación bancaria para agentes IA.
 */

import { runPortfolioStressTest, computePortfolioRebalance } from '../core/index.js';

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: () => Promise<unknown> | unknown;
}

export const portfolioResources: McpResource[] = [
  {
    uri: 'p2p://portfolio/stress-scenarios',
    name: 'Escenarios de Estrés Cambiario (Drawdown VES)',
    description: 'Simulación matricial de pérdidas proyectadas y drawdowns ante devaluaciones del 5%, 10% y 20% del bolívar',
    mimeType: 'application/json',
    read: () => {
      const stress = runPortfolioStressTest({
        usdtCapital: 5000,
        vesCapital: 150000,
        referenceRate: 79.5,
        devaluationScenariosPct: [5, 10, 20],
        hedgedPct: 0,
      });

      return {
        timestamp: new Date().toISOString(),
        baselineValueUsdt: stress.baselinePortfolioValueUsdt,
        vesExposureUsdt: stress.vesExposureUsdt,
        vesExposurePct: stress.vesExposurePct,
        scenarios: stress.scenarios,
        recommendedHedgeUsdt: stress.recommendedHedgeUsdt,
        institutionalSummary: stress.institutionalSummary,
      };
    },
  },
  {
    uri: 'p2p://portfolio/allocation',
    name: 'Distribución de Capital por Custodio y Banco',
    description: 'Asignación porcentual recomendada entre Binance P2P, Banesco, Mercantil y fondos de reserva institucional',
    mimeType: 'application/json',
    read: () => {
      const plan = computePortfolioRebalance({
        totalCapitalUsdt: 10000,
        referenceRate: 79.5,
        riskMode: 'BALANCED',
      });

      return {
        timestamp: new Date().toISOString(),
        totalCapitalUsdt: plan.totalCapitalUsdt,
        riskMode: plan.riskMode,
        allocations: plan.allocations,
        dynamicLimits: plan.dynamicLimits,
        advisoryNotice: plan.advisoryNotice,
      };
    },
  },
];
