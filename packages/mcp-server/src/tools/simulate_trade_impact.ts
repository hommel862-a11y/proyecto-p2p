import { SimulateTradeImpactInputSchema, type SimulateTradeImpactInput } from '../schemas/index.js';

export const simulateTradeImpactTool = {
  name: 'simulate_trade_impact',
  description:
    'Simula el impacto de una orden en la exposición acumulada y alerta si violaría límites diarios.',
  inputSchema: SimulateTradeImpactInputSchema,
  execute: (input: SimulateTradeImpactInput) => {
    // The dangerous default in this tool was `maxDailyExposureLimitUsdt: 2000`
    // combined with `currentExposureUsdt: 0`. Together they made any order under
    // $2,000 look safe on an empty portfolio — and the tool said
    // `SAFE_TO_EXECUTE`, which is a licence to move money, not a reading.
    //
    // Exposure arithmetic on an unknown operand is not a measurement either, so a
    // missing operand yields `null` rather than treating the portfolio as empty.
    const exposure = input.currentExposureUsdt;
    const limit = input.maxDailyExposureLimitUsdt;
    const hasExposure = exposure != null;
    const hasLimit = limit != null;

    const projectedExposure = hasExposure ? exposure + input.proposedTradeAmountUsdt : null;

    const limitExceeded =
      projectedExposure != null && limit != null ? projectedExposure > limit : null;

    const exposureUtilizationPct =
      projectedExposure != null && limit != null && limit > 0
        ? Number(((projectedExposure / limit) * 100).toFixed(1))
        : null;

    const wouldTrigger: string[] = [];
    if (limitExceeded === true) {
      wouldTrigger.push('DAILY_EXPOSURE_LIMIT_EXCEEDED');
    }
    // Measured from real input, so this rule fires on its own merits. Suppressing it
    // because the limit is missing would be over-correcting: a known rule about
    // known data still holds.
    if (input.consecutiveLosses >= 3) {
      wouldTrigger.push('MAX_CONSECUTIVE_LOSSES_TRIGGERED');
    }

    const maxSafeRemainingUsdt =
      limit != null && exposure != null ? Math.max(0, limit - exposure) : null;

    // Which absence blocks the simulation, in the order a caller would have to fix
    // them: a limit nobody chose is the one that produced the bogus green light.
    let unavailableReason: string | null = null;
    if (!hasLimit) {
      unavailableReason = 'missing_evidence:maxDailyExposureLimit';
    } else if (!hasExposure) {
      unavailableReason = 'missing_evidence:currentExposure';
    }

    return {
      // Null passes through as null. A `0` here would assert the book is empty.
      currentExposureUsdt: input.currentExposureUsdt ?? null,
      projectedExposureUsdt: projectedExposure,
      exposureUtilizationPct,
      limitExceeded,
      maxSafeRemainingUsdt,
      wouldTrigger,
      // A known trigger on measured input is still a real finding even when the
      // simulation as a whole could not run — `REQUIRES_REDUCTION` is a refusal to
      // grow, which is the safe direction.
      verdict:
        unavailableReason != null && wouldTrigger.length === 0
          ? ('UNAVAILABLE' as const)
          : wouldTrigger.length === 0
            ? ('SAFE_TO_EXECUTE' as const)
            : ('REQUIRES_REDUCTION' as const),
      unmeasuredInputs: [...(hasExposure ? [] : ['currentExposureUsdt']),
        ...(hasLimit ? [] : ['maxDailyExposureLimitUsdt'])],
      // Authorising an order needs the limit measured. Note this is false whenever
      // `verdict` is `REQUIRES_REDUCTION` too — that verdict is actionable in the
      // sense of "here is what to do about it", and it is never a green light.
      actionable: unavailableReason == null,
      unavailableReason,
      suggestedAction:
        unavailableReason != null
          ? `Sin simulacion de impacto: ${unavailableReason}.`
          : limitExceeded
            ? 'Reducir el tamano de la orden o esperar a que baje la exposicion'
            : 'La orden cabe dentro del limite diario medido',
    };
  },
};
