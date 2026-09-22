/**
 * Pure domain logic for P2P Compound Growth Simulation.
 * Models discrete trading cycles, dynamic net margins, reinvestment vs harvest policies,
 * and detects the 'Banking Capacity Wall' where transaction limits are breached.
 * Deterministic, 0 network, 0 external dependencies.
 */

export interface CompoundSimulationInput {
  initialCapitalUsdt: number;
  netMarginPctPerCycle: number; // e.g. 0.9 for 0.9% net per complete cycle
  cyclesPerDay: number; // e.g. 1.5 cycles/day
  operationalDays: number; // e.g. 30, 60, 90 or 180
  reinvestmentRatePct: number; // e.g. 100 for full compound, 50 for 50/50 harvest policy
  dailyBankLimitVes?: number; // Total aggregated daily transfer limit across registered accounts
  referenceRateVes?: number; // Current VES/USDT exchange rate for banking volume conversions
}

export interface DailyProjectionPoint {
  day: number;
  startingCapitalUsdt: number;
  dailyGrossGainUsdt: number;
  reinvestedGainUsdt: number;
  harvestedGainUsdt: number;
  endingCapitalUsdt: number;
  cumulativeHarvestedUsdt: number;
  totalPortfolioValueUsdt: number; // endingCapital + cumulativeHarvested
  dailyVolumeVes: number;
  exceedsBankLimit: boolean;
}

export interface CompoundSimulationResult {
  initialCapitalUsdt: number;
  finalWorkingCapitalUsdt: number;
  totalHarvestedUsdt: number;
  totalPortfolioValueUsdt: number;
  totalNetProfitUsdt: number;
  totalReturnPct: number;
  dailyProjection: DailyProjectionPoint[];
  milestones: {
    day30CapitalUsdt: number;
    day60CapitalUsdt: number;
    day90CapitalUsdt: number;
    day180CapitalUsdt?: number;
  };
  bankingWallAlert?: {
    firstDayExceeded: number;
    capitalAtWallUsdt: number;
    dailyVolumeAtWallVes: number;
    dailyBankLimitVes: number;
    recommendation: string;
  };
}

/**
 * Simulates day-by-day P2P trading cycle growth with reinvestment and banking limit checks.
 */
export function simulateCompoundGrowth(input: CompoundSimulationInput): CompoundSimulationResult {
  const {
    initialCapitalUsdt,
    netMarginPctPerCycle,
    cyclesPerDay,
    operationalDays,
    reinvestmentRatePct,
    dailyBankLimitVes,
    referenceRateVes = 60.0,
  } = input;

  if (initialCapitalUsdt <= 0) {
    throw new Error('initialCapitalUsdt must be greater than 0');
  }
  if (operationalDays <= 0) {
    throw new Error('operationalDays must be greater than 0');
  }

  const marginFraction = Math.max(0, netMarginPctPerCycle) / 100;
  const reinvestFraction = Math.min(100, Math.max(0, reinvestmentRatePct)) / 100;
  const cycles = Math.max(0.1, cyclesPerDay);

  let currentCapital = initialCapitalUsdt;
  let cumulativeHarvested = 0;
  const dailyProjection: DailyProjectionPoint[] = [];

  let wallAlert: CompoundSimulationResult['bankingWallAlert'];

  for (let day = 1; day <= operationalDays; day++) {
    const startingCapital = currentCapital;

    // Daily effective growth factor across N discrete cycles: (1 + margin)^cycles - 1
    const dailyGrowthRate = Math.pow(1 + marginFraction, cycles) - 1;
    const dailyGain = startingCapital * dailyGrowthRate;

    const reinvested = dailyGain * reinvestFraction;
    const harvested = dailyGain * (1 - reinvestFraction);

    cumulativeHarvested += harvested;
    currentCapital = startingCapital + reinvested;

    // Bank volume: 2 transactions per cycle (buy fiat + sell fiat)
    const dailyTurnoverUsdt = startingCapital * 2 * cycles;
    const dailyVolumeVes = dailyTurnoverUsdt * referenceRateVes;

    const exceedsBankLimit = Boolean(dailyBankLimitVes && dailyVolumeVes > dailyBankLimitVes);

    if (exceedsBankLimit && !wallAlert && dailyBankLimitVes) {
      wallAlert = {
        firstDayExceeded: day,
        capitalAtWallUsdt: Math.round(startingCapital),
        dailyVolumeAtWallVes: Math.round(dailyVolumeVes),
        dailyBankLimitVes,
        recommendation:
          'Se requiere habilitar cuentas bancarias adicionales (subcuentas familiares o cuentas jurídicas) para absorber el volumen transaccional sin riesgo de bloqueo.',
      };
    }

    dailyProjection.push({
      day,
      startingCapitalUsdt: startingCapital,
      dailyGrossGainUsdt: dailyGain,
      reinvestedGainUsdt: reinvested,
      harvestedGainUsdt: harvested,
      endingCapitalUsdt: currentCapital,
      cumulativeHarvestedUsdt: cumulativeHarvested,
      totalPortfolioValueUsdt: currentCapital + cumulativeHarvested,
      dailyVolumeVes,
      exceedsBankLimit,
    });
  }

  const getDayCapital = (d: number): number => {
    if (d <= dailyProjection.length) {
      return dailyProjection[d - 1].endingCapitalUsdt;
    }
    return dailyProjection[dailyProjection.length - 1].endingCapitalUsdt;
  };

  const totalPortfolioValue = currentCapital + cumulativeHarvested;
  const totalNetProfit = totalPortfolioValue - initialCapitalUsdt;
  const totalReturnPct = (totalNetProfit / initialCapitalUsdt) * 100;

  return {
    initialCapitalUsdt,
    finalWorkingCapitalUsdt: currentCapital,
    totalHarvestedUsdt: cumulativeHarvested,
    totalPortfolioValueUsdt: totalPortfolioValue,
    totalNetProfitUsdt: totalNetProfit,
    totalReturnPct,
    dailyProjection,
    milestones: {
      day30CapitalUsdt: getDayCapital(30),
      day60CapitalUsdt: getDayCapital(60),
      day90CapitalUsdt: getDayCapital(90),
      ...(operationalDays >= 180 ? { day180CapitalUsdt: getDayCapital(180) } : {}),
    },
    bankingWallAlert: wallAlert,
  };
}
