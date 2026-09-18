import { simulateCompoundGrowthRunway } from '../core/index.js';
import {
  ProjectCompoundRunwayInputSchema,
  type ProjectCompoundRunwayInput,
} from '../schemas/index.js';

export const projectCompoundRunwayTool = {
  name: 'project_compound_runway',
  description:
    'Proyecta el crecimiento compuesto del capital P2P, hitos a 30/60/90 días, cobertura de gastos operativos y detecta el "muro de capacidad bancaria" diaria.',
  inputSchema: ProjectCompoundRunwayInputSchema,
  execute: (input: ProjectCompoundRunwayInput) => {
    const sim = simulateCompoundGrowthRunway({
      initialCapitalUsdt: input.initialCapitalUsdt,
      netMarginPctPerCycle: input.netMarginPctPerCycle,
      cyclesPerDay: input.cyclesPerDay,
      operationalDays: input.operationalDays,
      reinvestmentRatePct: input.reinvestmentRatePct,
      monthlyFixedExpensesUsdt: input.monthlyFixedExpensesUsdt,
      dailyBankLimitVes: input.dailyBankLimitVes,
    });

    return {
      initialCapitalUsdt: sim.initialCapitalUsdt,
      projectedFinalCapitalUsdt: sim.projectedFinalCapitalUsdt,
      totalNetProfitUsdt: sim.totalNetProfitUsdt,
      totalReturnPct: sim.totalReturnPct,
      operationalDays: sim.operationalDays,
      milestones: sim.milestones,
      bankingWallAlert: sim.bankingWallAlert,
      monthlyRunwayCoverageMonths: sim.monthlyRunwayCoverageMonths,
      hasReachedBankingWall: Boolean(sim.bankingWallAlert),
      executiveSummary: sim.executiveSummary,
    };
  },
};
