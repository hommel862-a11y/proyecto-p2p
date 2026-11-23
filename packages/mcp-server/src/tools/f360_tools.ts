import {
  F360GetTreasurySummaryInputSchema,
  F360AnalyzeCasheaCapacityInputSchema,
  F360SimulateCasheaAllyMarginInputSchema,
  F360CheckPymeDrawersAndStockInputSchema,
  F360GenerateQuoteEstimateInputSchema,
  F360AuditOverdueAndRunwayInputSchema,
  type F360GetTreasurySummaryInput,
  type F360AnalyzeCasheaCapacityInput,
  type F360SimulateCasheaAllyMarginInput,
  type F360CheckPymeDrawersAndStockInput,
  type F360GenerateQuoteEstimateInput,
  type F360AuditOverdueAndRunwayInput,
} from '../schemas/index.js';

// ---------------------------------------------------------------------------
// Shared Pure Helpers (VET UTC-4 Calendar & IEEE-754 Safe Money Rounding)
// ---------------------------------------------------------------------------

const VET_UTC_OFFSET_MS = -4 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

function roundMoney(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const safeDecimals = Math.max(0, Math.min(8, Math.trunc(decimals)));
  const factor = Math.pow(10, safeDecimals);
  const rounded =
    (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * factor)) / factor;
  return rounded === 0 ? 0 : rounded;
}

function todayVetIso(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + VET_UTC_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractIsoDateParts(iso: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return [year, month, day];
}

function normalizeVetDate(iso?: string): string {
  if (iso && extractIsoDateParts(iso)) {
    return iso.trim().slice(0, 10);
  }
  return todayVetIso();
}

function addCalendarDays(iso: string, days: number): string {
  const parts = extractIsoDateParts(iso) ?? extractIsoDateParts(todayVetIso())!;
  const safeDays = Number.isFinite(days) ? Math.trunc(days) : 0;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + safeDays));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calendarDaysBetween(fromIso: string, toIso: string): number {
  const fromParts = extractIsoDateParts(fromIso);
  const toParts = extractIsoDateParts(toIso);
  if (!fromParts || !toParts) return 0;
  const fromUtc = Date.UTC(fromParts[0], fromParts[1] - 1, fromParts[2]);
  const toUtc = Date.UTC(toParts[0], toParts[1] - 1, toParts[2]);
  return Math.round((toUtc - fromUtc) / DAY_MS);
}

// ---------------------------------------------------------------------------
// Cashea 2026 Club Cashea Más N1–N6 Policy Table
// ---------------------------------------------------------------------------

interface CasheaTierPolicy {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  name: string;
  principalInitialPercent: number;
  cotidianaInitialPercent: number;
  campaignInitialPercent?: number;
  requiredSpentUsd: number;
  requiredInstallmentsPaid: number;
  maxInstallments: number;
  supportedInstallments: readonly number[];
  extendedInstallmentMinTicketUsd?: Partial<Record<number, number>>;
}

const CASHEA_2026_TIERS: Record<1 | 2 | 3 | 4 | 5 | 6, CasheaTierPolicy> = {
  1: {
    level: 1,
    name: 'Semilla',
    principalInitialPercent: 60,
    cotidianaInitialPercent: 60,
    requiredSpentUsd: 0,
    requiredInstallmentsPaid: 0,
    maxInstallments: 3,
    supportedInstallments: [1, 3],
  },
  2: {
    level: 2,
    name: 'Raíz',
    principalInitialPercent: 50,
    cotidianaInitialPercent: 50,
    requiredSpentUsd: 120,
    requiredInstallmentsPaid: 5,
    maxInstallments: 3,
    supportedInstallments: [1, 3],
  },
  3: {
    level: 3,
    name: 'Hoja',
    principalInitialPercent: 40,
    cotidianaInitialPercent: 30,
    requiredSpentUsd: 400,
    requiredInstallmentsPaid: 10,
    maxInstallments: 6,
    supportedInstallments: [1, 3, 6],
    extendedInstallmentMinTicketUsd: { 6: 700 },
  },
  4: {
    level: 4,
    name: 'Tronco',
    principalInitialPercent: 40,
    cotidianaInitialPercent: 25,
    requiredSpentUsd: 800,
    requiredInstallmentsPaid: 20,
    maxInstallments: 6,
    supportedInstallments: [1, 3, 6],
    extendedInstallmentMinTicketUsd: { 6: 700 },
  },
  5: {
    level: 5,
    name: 'Árbol',
    principalInitialPercent: 40,
    cotidianaInitialPercent: 20,
    requiredSpentUsd: 2000,
    requiredInstallmentsPaid: 40,
    maxInstallments: 9,
    supportedInstallments: [1, 3, 6, 9],
    extendedInstallmentMinTicketUsd: { 6: 700, 9: 850 },
  },
  6: {
    level: 6,
    name: 'Araguaney',
    principalInitialPercent: 40,
    cotidianaInitialPercent: 20,
    campaignInitialPercent: 0,
    requiredSpentUsd: 4000,
    requiredInstallmentsPaid: 80,
    maxInstallments: 12,
    supportedInstallments: [1, 3, 6, 9, 12],
    extendedInstallmentMinTicketUsd: { 6: 700, 9: 850, 12: 1000 },
  },
};

function evaluateCasheaInstallmentAntiMora(
  dueDate: string,
  status: 'pending' | 'paid' | 'overdue',
  todayVet: string,
) {
  if (status === 'paid') {
    return {
      healthStatus: 'paid' as const,
      daysUntilDue: 0,
      daysOverdue: 0,
      inGracePeriod: false,
      reactivationFeeUsd: 0,
      penaltyTier: 'none' as const,
      clubPointsImpact: 'Cuota saldada al día.',
    };
  }

  const daysUntilDue = calendarDaysBetween(todayVet, dueDate);
  if (daysUntilDue > 2) {
    return {
      healthStatus: 'upcoming' as const,
      daysUntilDue,
      daysOverdue: 0,
      inGracePeriod: false,
      reactivationFeeUsd: 0,
      penaltyTier: 'none' as const,
      clubPointsImpact: 'Al día sin riesgo de penalización.',
    };
  }

  if (daysUntilDue >= 0) {
    return {
      healthStatus: 'due_soon_48h' as const,
      daysUntilDue,
      daysOverdue: 0,
      inGracePeriod: false,
      reactivationFeeUsd: 0,
      penaltyTier: 'none' as const,
      clubPointsImpact: 'Vencimiento dentro de las próximas 48 horas.',
    };
  }

  const daysOverdue = Math.abs(daysUntilDue);
  if (daysOverdue <= 2) {
    return {
      healthStatus: 'grace_2d' as const,
      daysUntilDue,
      daysOverdue,
      inGracePeriod: true,
      reactivationFeeUsd: 0,
      penaltyTier: 'none' as const,
      clubPointsImpact: 'Período de gracia de 2 días activo (sin cargo de reactivación).',
    };
  }

  if (daysOverdue >= 28) {
    return {
      healthStatus: 'overdue_penalty' as const,
      daysUntilDue,
      daysOverdue,
      inGracePeriod: false,
      reactivationFeeUsd: 4,
      penaltyTier: '28d' as const,
      clubPointsImpact:
        'Mora crítica >= 28 días: cargo de reactivación de $4 USD y riesgo de suspensión de línea.',
    };
  }

  if (daysOverdue >= 14) {
    return {
      healthStatus: 'overdue_penalty' as const,
      daysUntilDue,
      daysOverdue,
      inGracePeriod: false,
      reactivationFeeUsd: 4,
      penaltyTier: '14d' as const,
      clubPointsImpact:
        'Mora >= 14 días: cargo de reactivación de $4 USD y descenso de nivel en Club Cashea Más.',
    };
  }

  if (daysOverdue >= 7) {
    return {
      healthStatus: 'overdue_penalty' as const,
      daysUntilDue,
      daysOverdue,
      inGracePeriod: false,
      reactivationFeeUsd: 4,
      penaltyTier: '7d' as const,
      clubPointsImpact:
        'Mora >= 7 días: cargo de reactivación de $4 USD y pérdida de puntos Club Cashea Más.',
    };
  }

  return {
    healthStatus: 'overdue_penalty' as const,
    daysUntilDue,
    daysOverdue,
    inGracePeriod: false,
    reactivationFeeUsd: 4,
    penaltyTier: 'none' as const,
    clubPointsImpact: 'Período de gracia vencido: aplica cargo de reactivación de $4 USD por cuota.',
  };
}

// ---------------------------------------------------------------------------
// TOOL 1: f360_get_treasury_summary
// ---------------------------------------------------------------------------

export const f360GetTreasurySummaryTool = {
  name: 'f360_get_treasury_summary',
  description:
    'Calcula el resumen consolidado de tesorería Finanzas 360 (Patrimonio Neto USD/VES sin tasas FX inventadas, liquidez vs activos fijos, exposición VES, brecha cambiaria, pasivos vencidos y semáforo de liquidez a 14 días).',
  inputSchema: F360GetTreasurySummaryInputSchema,
  execute: (rawInput: F360GetTreasurySummaryInput) => {
    const input = F360GetTreasurySummaryInputSchema.parse(rawInput);
    const referenceDateVet = normalizeVetDate(input.referenceDateIso);

    const safeBcv =
      typeof input.bcvRate === 'number' && Number.isFinite(input.bcvRate) && input.bcvRate > 0
        ? input.bcvRate
        : 0;
    const safeParallel =
      typeof input.parallelRate === 'number' &&
      Number.isFinite(input.parallelRate) &&
      input.parallelRate > 0
        ? input.parallelRate
        : 0;
    const safeEurUsd =
      typeof input.eurUsdRate === 'number' &&
      Number.isFinite(input.eurUsdRate) &&
      input.eurUsdRate > 0
        ? input.eurUsdRate
        : 0;

    const scopedVaults =
      input.scope === 'all'
        ? input.vaults
        : input.vaults.filter((v) => !v.scope || v.scope === 'all' || v.scope === input.scope);

    const scopedLiabilities =
      input.scope === 'all'
        ? input.liabilities
        : input.liabilities.filter((l) => !l.scope || l.scope === 'all' || l.scope === input.scope);

    const missingFxRates: string[] = [];
    if (safeBcv <= 0) missingFxRates.push('BCV');
    if (safeParallel <= 0) missingFxRates.push('PARALLEL');

    let totalAssetsUsd = 0;
    let liquidAssetsUsd = 0;
    let fixedAssetsUsd = 0;
    let vesAssetsUsd = 0;
    let unvaluedVesBalance = 0;
    let unvaluedEurBalance = 0;

    const currencyBreakdown = {
      USD: { nativeBalance: 0, usdEquivalent: 0 },
      USDT: { nativeBalance: 0, usdEquivalent: 0 },
      VES: { nativeBalance: 0, usdEquivalent: 0 },
      EUR: { nativeBalance: 0, usdEquivalent: 0 },
    };

    for (const vault of scopedVaults) {
      const balance = Number.isFinite(vault.balance) ? vault.balance : 0;
      let usdEq = 0;

      if (vault.currency === 'USD' || vault.currency === 'USDT') {
        usdEq = roundMoney(balance);
      } else if (vault.currency === 'VES') {
        if (safeBcv > 0) {
          usdEq = roundMoney(balance / safeBcv);
          vesAssetsUsd += usdEq;
        } else {
          unvaluedVesBalance += balance;
        }
      } else if (vault.currency === 'EUR') {
        if (safeEurUsd > 0) {
          usdEq = roundMoney(balance * safeEurUsd);
        } else {
          unvaluedEurBalance += balance;
          if (!missingFxRates.includes('EUR_USD')) {
            missingFxRates.push('EUR_USD');
          }
        }
      }

      currencyBreakdown[vault.currency].nativeBalance = roundMoney(
        currencyBreakdown[vault.currency].nativeBalance + balance,
      );
      currencyBreakdown[vault.currency].usdEquivalent = roundMoney(
        currencyBreakdown[vault.currency].usdEquivalent + usdEq,
      );

      totalAssetsUsd += usdEq;
      if (vault.isFixedAsset || vault.channel === 'receivable') {
        fixedAssetsUsd += usdEq;
      } else {
        liquidAssetsUsd += usdEq;
      }
    }

    totalAssetsUsd = roundMoney(totalAssetsUsd);
    liquidAssetsUsd = roundMoney(liquidAssetsUsd);
    fixedAssetsUsd = roundMoney(fixedAssetsUsd);
    vesAssetsUsd = roundMoney(vesAssetsUsd);
    unvaluedVesBalance = roundMoney(unvaluedVesBalance);
    unvaluedEurBalance = roundMoney(unvaluedEurBalance);

    const unpaidLiabilities = scopedLiabilities.filter((l) => l.status !== 'paid');
    const totalLiabilitiesUsd = roundMoney(
      unpaidLiabilities.reduce((sum, l) => sum + l.remainingAmountUsd, 0),
    );

    const overdueItems = unpaidLiabilities.filter(
      (l) => l.status === 'overdue' || calendarDaysBetween(referenceDateVet, l.dueDate) < 0,
    );
    const overdueCount = overdueItems.length;
    const overdueUsd = roundMoney(overdueItems.reduce((sum, l) => sum + l.remainingAmountUsd, 0));

    const due14DaysItems = unpaidLiabilities.filter(
      (l) =>
        l.status === 'overdue' || calendarDaysBetween(referenceDateVet, l.dueDate) <= 14,
    );
    const due14DaysCount = due14DaysItems.length;
    const due14DaysUsd = roundMoney(
      due14DaysItems.reduce((sum, l) => sum + l.remainingAmountUsd, 0),
    );

    const netWorthUsd = roundMoney(totalAssetsUsd - totalLiabilitiesUsd);
    const netWorthVes = safeBcv > 0 ? roundMoney(netWorthUsd * safeBcv) : 0;
    const vesExposurePct =
      totalAssetsUsd > 0 ? roundMoney((vesAssetsUsd / totalAssetsUsd) * 100, 2) : 0;
    const fxRateGapPct =
      safeBcv > 0 && safeParallel > 0
        ? roundMoney(((safeParallel - safeBcv) / safeBcv) * 100, 2)
        : null;

    let liquidityHealth: {
      status: 'optimal' | 'warning' | 'critical';
      label: string;
      ratio: number;
      coverageMultiple: number | null;
    };

    if (overdueCount > 0) {
      const coverage = due14DaysUsd > 0 ? liquidAssetsUsd / due14DaysUsd : 0;
      liquidityHealth = {
        status: 'critical',
        label: `Mora activa (${overdueCount} pasivo${overdueCount > 1 ? 's' : ''} vencido${overdueCount > 1 ? 's' : ''} por $${overdueUsd.toFixed(2)} USD).`,
        ratio: Math.max(5, Math.min(45, Math.round(coverage * 25))),
        coverageMultiple: due14DaysUsd > 0 ? roundMoney(coverage, 2) : null,
      };
    } else if (due14DaysUsd <= 0) {
      liquidityHealth = {
        status: 'optimal',
        label: 'Liquidez sólida sin compromisos inmediatos en los próximos 14 días.',
        ratio: 100,
        coverageMultiple: null,
      };
    } else {
      const coverage = liquidAssetsUsd / due14DaysUsd;
      if (coverage >= 2.0) {
        liquidityHealth = {
          status: 'optimal',
          label: `Liquidez sólida (cubre ${roundMoney(coverage, 1)}x los compromisos a 14 días).`,
          ratio: Math.min(100, Math.round(coverage * 50)),
          coverageMultiple: roundMoney(coverage, 2),
        };
      } else if (coverage >= 1.0) {
        liquidityHealth = {
          status: 'warning',
          label: `Liquidez ajustada (cubre ${Math.round(coverage * 100)}% de los próximos 14 días).`,
          ratio: Math.round(coverage * 50),
          coverageMultiple: roundMoney(coverage, 2),
        };
      } else {
        liquidityHealth = {
          status: 'critical',
          label: `Déficit proyectado a 14 días (faltan $${roundMoney(due14DaysUsd - liquidAssetsUsd).toFixed(2)} USD).`,
          ratio: Math.max(10, Math.round(coverage * 50)),
          coverageMultiple: roundMoney(coverage, 2),
        };
      }
    }

    return {
      scope: input.scope,
      referenceDateVet,
      vaultsCount: scopedVaults.length,
      liabilitiesCount: unpaidLiabilities.length,
      totalAssetsUsd,
      liquidAssetsUsd,
      fixedAssetsUsd,
      totalLiabilitiesUsd,
      netWorthUsd,
      netWorthVes,
      vesAssetsUsd,
      vesExposurePct,
      unvaluedVesBalance,
      unvaluedEurBalance,
      overdueCount,
      overdueUsd,
      due14DaysCount,
      due14DaysUsd,
      liquidityHealth,
      rates: {
        bcvRate: safeBcv,
        parallelRate: safeParallel,
        eurUsdRate: safeEurUsd,
        isBcvRateLive: safeBcv > 0,
        isParallelRateLive: safeParallel > 0,
        isEurUsdRateLive: safeEurUsd > 0,
        fxRateGapPct,
        missingFxRates,
      },
      currencyBreakdown,
    };
  },
};

// ---------------------------------------------------------------------------
// TOOL 2: f360_analyze_cashea_capacity
// ---------------------------------------------------------------------------

export const f360AnalyzeCasheaCapacityTool = {
  name: 'f360_analyze_cashea_capacity',
  description:
    'Analiza capacidad de compra bajo reglas Cashea 2026 Club Cashea Más N1–N6 (Araguaney), líneas Principal/Cotidiana/Vehicular, Inicial Flexible, Proyector Dual (Ahorro vs Cashea), detector de colisiones 14D y referencia Anti-Mora.',
  inputSchema: F360AnalyzeCasheaCapacityInputSchema,
  execute: (rawInput: F360AnalyzeCasheaCapacityInput) => {
    const input = F360AnalyzeCasheaCapacityInputSchema.parse(rawInput);
    const tierKey = input.level as 1 | 2 | 3 | 4 | 5 | 6;
    const tier = CASHEA_2026_TIERS[tierKey];
    const policyWarnings: string[] = [];

    const price = roundMoney(input.productPriceUsd);
    const safeBcv =
      typeof input.bcvRate === 'number' && Number.isFinite(input.bcvRate) && input.bcvRate > 0
        ? input.bcvRate
        : 0;

    // 1. Minimum initial percentage per line & campaign rule
    let minimumInitialPercent: number;
    if (input.creditLine === 'cotidiana') {
      minimumInitialPercent = tier.cotidianaInitialPercent;
      if (input.zeroInitialCampaign) {
        policyWarnings.push(
          'La campaña de 0% inicial aplica exclusivamente en Nivel 6 Araguaney sobre Línea Principal (no aplica en Línea Cotidiana).',
        );
      }
    } else if (input.creditLine === 'vehicular') {
      minimumInitialPercent = tier.principalInitialPercent;
      if (input.zeroInitialCampaign) {
        policyWarnings.push(
          'La campaña de 0% inicial no aplica para Línea Vehicular; se aplica el mínimo del nivel.',
        );
      }
    } else {
      // principal
      if (input.zeroInitialCampaign) {
        if (tier.level === 6) {
          minimumInitialPercent = tier.campaignInitialPercent ?? 0;
        } else {
          minimumInitialPercent = tier.principalInitialPercent;
          policyWarnings.push(
            `La campaña de 0% inicial es exclusiva de Nivel 6 (Araguaney); en Nivel ${tier.level} (${tier.name}) el mínimo es ${tier.principalInitialPercent}%.`,
          );
        }
      } else {
        minimumInitialPercent = tier.principalInitialPercent;
      }
    }

    // 2. Inicial Flexible validation (>= minimum)
    let effectiveInitialPercent = minimumInitialPercent;
    if (typeof input.customInitialPercent === 'number') {
      const requestedInitial = roundMoney(input.customInitialPercent, 2);
      if (requestedInitial < minimumInitialPercent) {
        policyWarnings.push(
          `Inicial Flexible (${requestedInitial}%) no puede ser inferior al mínimo exigido (${minimumInitialPercent}%) para Nivel ${tier.level} (${tier.name}). Se aplicó ${minimumInitialPercent}%.`,
        );
        effectiveInitialPercent = minimumInitialPercent;
      } else {
        effectiveInitialPercent = requestedInitial;
      }
    }

    // 3. Installments & frequency validation
    let frequencyDays = 14;
    let installmentsCount = input.installmentsCount;
    let isInstallmentPlanEligible = true;
    let eligibleMaxInstallments = tier.maxInstallments;

    if (input.creditLine === 'vehicular') {
      frequencyDays = 30;
      eligibleMaxInstallments = 24;
      if (installmentsCount < 12 || installmentsCount > 24) {
        const clamped = Math.max(12, Math.min(24, installmentsCount));
        policyWarnings.push(
          `La Línea Vehicular opera con plazos mensuales de 12 a 24 cuotas; se ajustó de ${installmentsCount} a ${clamped} cuotas.`,
        );
        installmentsCount = clamped;
      }
    } else if (input.creditLine === 'cotidiana') {
      eligibleMaxInstallments = 3;
      if (installmentsCount > 3) {
        isInstallmentPlanEligible = false;
        policyWarnings.push(
          `La Línea Cotidiana admite hasta 3 cuotas quincenales (se solicitaron ${installmentsCount}).`,
        );
      }
    } else {
      // Principal line: verify tier max & Modo Más Cuotas ticket thresholds
      if (installmentsCount > tier.maxInstallments) {
        isInstallmentPlanEligible = false;
        policyWarnings.push(
          `Nivel ${tier.level} (${tier.name}) permite hasta ${tier.maxInstallments} cuotas en Línea Principal (se solicitaron ${installmentsCount}).`,
        );
      }
      if (installmentsCount >= 12 && price < 1000) {
        isInstallmentPlanEligible = false;
        policyWarnings.push(
          'El plan de 12 cuotas en Nivel 6 Araguaney requiere un ticket mínimo de $1,000 USD.',
        );
      } else if (installmentsCount >= 9 && price < 850) {
        isInstallmentPlanEligible = false;
        policyWarnings.push(
          'El plan de 9 cuotas (Nivel 5+) requiere un ticket mínimo de $850 USD.',
        );
      } else if (installmentsCount >= 6 && price < 700) {
        isInstallmentPlanEligible = false;
        policyWarnings.push(
          'El plan de 6 cuotas (Nivel 3+) requiere un ticket mínimo de $700 USD.',
        );
      }
    }

    // 4. Schedule calculation with exact cent reconciliation
    const initialPaymentUsd = roundMoney((price * effectiveInitialPercent) / 100);
    const financedAmountUsd = Math.max(0, roundMoney(price - initialPaymentUsd));
    const baseInstallment = installmentsCount > 0 ? roundMoney(financedAmountUsd / installmentsCount) : 0;

    const startDateVet = normalizeVetDate(input.startDateIso);
    const firstDueDateVet = input.firstDueDateIso
      ? normalizeVetDate(input.firstDueDateIso)
      : addCalendarDays(startDateVet, frequencyDays);

    const installments: Array<{
      number: number;
      dueDate: string;
      amountUsd: number;
      amountVes: number;
    }> = [];

    for (let i = 1; i <= installmentsCount; i++) {
      const dueDate = addCalendarDays(firstDueDateVet, (i - 1) * frequencyDays);
      const amountUsd =
        financedAmountUsd <= 0
          ? 0
          : i === installmentsCount
            ? roundMoney(financedAmountUsd - baseInstallment * (installmentsCount - 1))
            : baseInstallment;
      installments.push({
        number: i,
        dueDate,
        amountUsd,
        amountVes: safeBcv > 0 ? roundMoney(amountUsd * safeBcv) : 0,
      });
    }

    const finalInstallmentAmountUsd =
      installments[installments.length - 1]?.amountUsd ?? 0;

    // 5. Biweekly/periodic collision detection
    const collisions = installments.map((inst) => {
      const matched = input.existingDueDatesUsd.filter(
        (existing) =>
          Math.abs(calendarDaysBetween(inst.dueDate, existing.dueDate)) <= input.collisionWindowDays,
      );
      const totalExistingUsd = roundMoney(matched.reduce((s, m) => s + m.amountUsd, 0));
      const count = matched.length;
      const severity: 'none' | 'medium' | 'high' =
        count === 0 ? 'none' : count >= 2 || totalExistingUsd >= 150 ? 'high' : 'medium';

      return {
        installmentNumber: inst.number,
        dueDate: inst.dueDate,
        newInstallmentUsd: inst.amountUsd,
        existingCommittedUsd: totalExistingUsd,
        combinedWindowExposureUsd: roundMoney(inst.amountUsd + totalExistingUsd),
        collisionCount: count,
        severity,
        collidingItems: matched.map((m) => ({
          dueDate: m.dueDate,
          amountUsd: m.amountUsd,
          label: m.label ?? 'Compromiso previo',
        })),
      };
    });

    const totalCollisionCount = collisions.reduce((sum, c) => sum + c.collisionCount, 0);
    const totalCollisionExposureUsd = roundMoney(
      collisions.reduce((sum, c) => sum + c.existingCommittedUsd, 0),
    );

    // 6. Dual Projector: Path A (Cash Savings) vs Path B (Cashea)
    const capacity = roundMoney(input.biweeklySavingsCapacityUsd);
    const biweeklyPeriodsNeeded = capacity > 0 ? Math.ceil(price / capacity) : null;
    const daysUntilPurchase = biweeklyPeriodsNeeded !== null ? biweeklyPeriodsNeeded * 14 : null;
    const projectedCashPriceUsd =
      input.expectedBiweeklyInflationPct > 0 &&
      biweeklyPeriodsNeeded !== null &&
      biweeklyPeriodsNeeded > 0
        ? roundMoney(
            price * Math.pow(1 + input.expectedBiweeklyInflationPct / 100, biweeklyPeriodsNeeded),
          )
        : price;

    // For vehicular (30-day cadence), compare against monthly savings capacity (2 * biweekly)
    const periodSavingsCapacity = frequencyDays >= 28 ? roundMoney(capacity * 2) : capacity;
    const canAffordInstallment =
      periodSavingsCapacity > 0 && baseInstallment <= periodSavingsCapacity;
    const biweeklySurplusAfterInstallmentUsd = roundMoney(
      periodSavingsCapacity - baseInstallment,
    );

    // Optional credit line limit check
    const availableCreditUsd =
      typeof input.creditLimitUsd === 'number'
        ? roundMoney(Math.max(0, input.creditLimitUsd - (input.usedCreditUsd ?? 0)))
        : null;
    const withinCreditLimit =
      availableCreditUsd !== null ? financedAmountUsd <= availableCreditUsd : null;

    if (withinCreditLimit === false) {
      policyWarnings.push(
        `El monto financiado ($${financedAmountUsd.toFixed(2)} USD) supera el cupo disponible ($${availableCreditUsd?.toFixed(2)} USD).`,
      );
    }

    let recommendation: 'cashea_viable' | 'save_cash_recommended' | 'stretch_warning';
    let rationale: string;

    if (withinCreditLimit === false || !isInstallmentPlanEligible) {
      recommendation = 'save_cash_recommended';
      rationale =
        'El plan solicitado incumple requisitos de cupo o elegibilidad de cuotas. Ajusta la inicial flexible, el número de cuotas o acumula ahorro en efectivo.';
    } else if (!canAffordInstallment) {
      recommendation = 'save_cash_recommended';
      rationale = `La cuota ($${baseInstallment.toFixed(2)} USD) supera la capacidad de ahorro del período ($${periodSavingsCapacity.toFixed(2)} USD). Conviene ahorrar en efectivo o aumentar la inicial.`;
    } else if (
      totalCollisionCount > 0 ||
      biweeklySurplusAfterInstallmentUsd < baseInstallment * 0.25
    ) {
      recommendation = 'stretch_warning';
      rationale = `La cuota es cubrible, pero existen ${totalCollisionCount} colisión(es) con compromisos previos ($${totalCollisionExposureUsd.toFixed(2)} USD) o margen ajustado. Evalúa desplazar la fecha de compra.`;
    } else {
      recommendation = 'cashea_viable';
      rationale = `Financiamiento viable sin intereses con excedente de $${biweeklySurplusAfterInstallmentUsd.toFixed(2)} USD por período y cero colisiones detectadas.`;
    }

    return {
      tier: {
        level: tier.level,
        name: tier.name,
        principalInitialPercent: tier.principalInitialPercent,
        cotidianaInitialPercent: tier.cotidianaInitialPercent,
        campaignInitialPercent: tier.campaignInitialPercent ?? null,
        requiredSpentUsd: tier.requiredSpentUsd,
        requiredInstallmentsPaid: tier.requiredInstallmentsPaid,
        maxInstallments: tier.maxInstallments,
        supportedInstallments: [...tier.supportedInstallments],
      },
      creditLine: input.creditLine,
      minimumInitialPercent,
      effectiveInitialPercent,
      isInstallmentPlanEligible,
      eligibleMaxInstallments,
      withinCreditLimit,
      availableCreditUsd,
      policyWarnings,
      pathA_savings: {
        biweeklyPeriodsNeeded,
        daysUntilPurchase,
        projectedCashPriceUsd,
        debtRisk: 'none' as const,
      },
      pathB_cashea: {
        initialPaymentUsd,
        initialPaymentVes: safeBcv > 0 ? roundMoney(initialPaymentUsd * safeBcv) : 0,
        financedAmountUsd,
        installmentAmountUsd: baseInstallment,
        installmentAmountVes: safeBcv > 0 ? roundMoney(baseInstallment * safeBcv) : 0,
        finalInstallmentAmountUsd,
        installmentsCount,
        frequencyDays,
        canAffordInstallment,
        biweeklySurplusAfterInstallmentUsd,
        collisionCount: totalCollisionCount,
        totalCollisionExposureUsd,
        collisions,
        installments,
      },
      recommendation,
      rationale,
      antiMoraReference: {
        gracePeriodDays: 2,
        reactivationFeeUsdPerInstallment: 4,
        penaltyTiersDays: [7, 14, 28],
        clubImpactSummary:
          'Cashea otorga 2 días calendario de gracia sin recargo. A partir del día 3 de mora aplica un cargo fijo de reactivación de $4 USD por cuota vencida y penalizaciones escalonadas en Club Cashea Más a los 7, 14 y 28 días.',
      },
    };
  },
};

// ---------------------------------------------------------------------------
// TOOL 3: f360_simulate_cashea_ally_margin
// ---------------------------------------------------------------------------

export const f360SimulateCasheaAllyMarginTool = {
  name: 'f360_simulate_cashea_ally_margin',
  description:
    'Simula el margen neto real de una venta Pyme como Aliado Cashea: comisión MDR (2–6%), adelanto semanal opcional (2–4%), erosión por brecha cambiaria BCV vs reposición, punto de equilibrio mensual ($100/mes) y advertencia contractual.',
  inputSchema: F360SimulateCasheaAllyMarginInputSchema,
  execute: (rawInput: F360SimulateCasheaAllyMarginInput) => {
    const input = F360SimulateCasheaAllyMarginInputSchema.parse(rawInput);

    const salePriceUsd = roundMoney(input.salePriceUsd);
    const costOfGoodsUsd = roundMoney(input.costOfGoodsUsd);
    const mdrPercent = roundMoney(input.mdrPercent, 2);
    const effectiveAdvanceFeePercent = input.useWeeklyAdvance
      ? roundMoney(input.weeklyAdvanceFeePercent, 2)
      : 0;

    const grossProfitUsd = roundMoney(salePriceUsd - costOfGoodsUsd);
    const grossMarginPct =
      salePriceUsd > 0 ? roundMoney((grossProfitUsd / salePriceUsd) * 100, 2) : 0;

    const mdrFeeUsd = roundMoney((salePriceUsd * mdrPercent) / 100);
    const weeklyAdvanceFeeUsd = roundMoney((salePriceUsd * effectiveAdvanceFeePercent) / 100);
    const totalCasheaFeesUsd = roundMoney(mdrFeeUsd + weeklyAdvanceFeeUsd);

    const settlementUsdAtBcv = Math.max(0, roundMoney(salePriceUsd - totalCasheaFeesUsd));

    const safeBcv =
      typeof input.bcvRate === 'number' && Number.isFinite(input.bcvRate) && input.bcvRate > 0
        ? input.bcvRate
        : 0;
    const safeParallel =
      typeof input.parallelRate === 'number' &&
      Number.isFinite(input.parallelRate) &&
      input.parallelRate > 0
        ? input.parallelRate
        : 0;

    const hasBothFxRates = safeBcv > 0 && safeParallel > 0;
    const settlementVes = safeBcv > 0 ? roundMoney(settlementUsdAtBcv * safeBcv) : 0;

    let realReplacementUsd = settlementUsdAtBcv;
    let fxGapPct: number | null = null;
    let fxGapErosionUsd = 0;

    if (hasBothFxRates) {
      fxGapPct = roundMoney(((safeParallel - safeBcv) / safeBcv) * 100, 2);
      if (safeParallel > safeBcv) {
        realReplacementUsd = roundMoney(settlementVes / safeParallel);
        fxGapErosionUsd = roundMoney(Math.max(0, settlementUsdAtBcv - realReplacementUsd));
      }
    }

    const realNetProfitUsd = roundMoney(realReplacementUsd - costOfGoodsUsd);
    const realNetMarginPct =
      salePriceUsd > 0 ? roundMoney((realNetProfitUsd / salePriceUsd) * 100, 2) : 0;
    const isSellingAtLoss = realNetProfitUsd < 0;

    const monthlyMinimumFeeUsd = roundMoney(input.monthlyMinimumFeeUsd);
    const activationFeeUsd = roundMoney(input.activationFeeUsd);
    const breakEvenMonthlySalesForMinimumFeeUsd =
      mdrPercent > 0 ? roundMoney(monthlyMinimumFeeUsd / (mdrPercent / 100)) : 0;
    const breakEvenMonthlySalesForTotalFixedCostsUsd =
      realNetMarginPct > 0
        ? roundMoney((monthlyMinimumFeeUsd + activationFeeUsd) / (realNetMarginPct / 100))
        : null;

    let projectedMonthlyMdrUsd: number | null = null;
    let monthlyMinimumShortfallUsd: number | null = null;
    let coversMonthlyMinimum: boolean | null = null;

    if (typeof input.monthlyVolumeUsd === 'number') {
      projectedMonthlyMdrUsd = roundMoney((input.monthlyVolumeUsd * mdrPercent) / 100);
      monthlyMinimumShortfallUsd = roundMoney(
        Math.max(0, monthlyMinimumFeeUsd - projectedMonthlyMdrUsd),
      );
      coversMonthlyMinimum = projectedMonthlyMdrUsd >= monthlyMinimumFeeUsd;
    }

    const minimumTicketUsd = 25;
    const belowMinimumTicket = salePriceUsd < minimumTicketUsd;

    return {
      salePriceUsd,
      costOfGoodsUsd,
      grossProfitUsd,
      grossMarginPct,
      mdrPercent,
      mdrFeeUsd,
      useWeeklyAdvance: input.useWeeklyAdvance,
      weeklyAdvanceFeePercent: effectiveAdvanceFeePercent,
      weeklyAdvanceFeeUsd,
      totalCasheaFeesUsd,
      settlementUsdAtBcv,
      settlementVes,
      fxRatesMissing: !hasBothFxRates,
      bcvRateApplied: safeBcv || null,
      parallelRateApplied: safeParallel || null,
      fxGapPct,
      fxGapErosionUsd,
      realReplacementUsd,
      realNetProfitUsd,
      realNetMarginPct,
      isSellingAtLoss,
      monthlyMinimumFeeUsd,
      activationFeeUsd,
      breakEvenMonthlySalesForMinimumFeeUsd,
      breakEvenMonthlySalesForTotalFixedCostsUsd,
      projectedMonthlyMdrUsd,
      monthlyMinimumShortfallUsd,
      coversMonthlyMinimum,
      minimumTicketUsd,
      belowMinimumTicket,
      policyWarning:
        'Política de Aliados Cashea: el contrato prohíbe aplicar recargos o precios superiores frente a pagos en efectivo/contado. Además, el ticket mínimo operativo por compra es de $25 USD.',
    };
  },
};

// ---------------------------------------------------------------------------
// TOOL 4: f360_check_pyme_drawers_and_stock
// ---------------------------------------------------------------------------

function routeCategoryToPymeDrawer(
  category: string,
): 'drawer1_replenishment' | 'drawer2_operations' | 'drawer3_profit' {
  const norm = category.trim().toLowerCase();
  if (
    norm === 'provider_merchandise' ||
    norm === 'merchandise' ||
    norm === 'inventory' ||
    norm === 'reposicion'
  ) {
    return 'drawer1_replenishment';
  }
  if (
    norm === 'equipment_capex' ||
    norm === 'capex' ||
    norm === 'profit_distribution' ||
    norm === 'reinvestment'
  ) {
    return 'drawer3_profit';
  }
  return 'drawer2_operations';
}

export const f360CheckPymeDrawersAndStockTool = {
  name: 'f360_check_pyme_drawers_and_stock',
  description:
    'Evalúa las 3 Gavetas Pyme preservando sobregiros negativos reales, el semáforo de inventario (agotado, stock bajo y mercancía fría > 45 días) y las obligaciones CxP con proveedores.',
  inputSchema: F360CheckPymeDrawersAndStockInputSchema,
  execute: (rawInput: F360CheckPymeDrawersAndStockInput) => {
    const input = F360CheckPymeDrawersAndStockInputSchema.parse(rawInput);
    const referenceDateVet = normalizeVetDate(input.referenceDateIso);

    const pct = input.drawerPercentages;
    const pctSum =
      pct.drawer1_replenishment + pct.drawer2_operations + pct.drawer3_profit || 100;
    const r1 = pct.drawer1_replenishment / pctSum;
    const r2 = pct.drawer2_operations / pctSum;
    const r3 = pct.drawer3_profit / pctSum;

    let d1Allocated = input.openingCapitalUsd * r1;
    let d2Allocated = input.openingCapitalUsd * r2;
    let d3Allocated = input.openingCapitalUsd * r3;

    for (const inc of input.businessIncomes) {
      if (inc.drawerAllocations) {
        d1Allocated += inc.drawerAllocations.drawer1Usd;
        d2Allocated += inc.drawerAllocations.drawer2Usd;
        d3Allocated += inc.drawerAllocations.drawer3Usd;
      } else {
        d1Allocated += inc.amountUsd * r1;
        d2Allocated += inc.amountUsd * r2;
        d3Allocated += inc.amountUsd * r3;
      }
    }

    let d1Spent = 0;
    let d2Spent = 0;
    let d3Spent = 0;

    for (const exp of input.businessExpenses) {
      const targetDrawer = exp.drawer ?? routeCategoryToPymeDrawer(exp.category);
      if (targetDrawer === 'drawer1_replenishment') d1Spent += exp.amountUsd;
      else if (targetDrawer === 'drawer3_profit') d3Spent += exp.amountUsd;
      else d2Spent += exp.amountUsd;
    }

    const buildDrawer = (allocated: number, spent: number) => {
      const allocatedUsd = roundMoney(allocated);
      const spentUsd = roundMoney(spent);
      // Preserve real negative overdrafts — NEVER clamp with Math.max(0, ...)
      const balanceUsd = roundMoney(allocatedUsd - spentUsd);
      const isOverdrawn = balanceUsd < 0;
      const overdraftUsd = isOverdrawn ? roundMoney(Math.abs(balanceUsd)) : 0;
      return { allocatedUsd, spentUsd, balanceUsd, isOverdrawn, overdraftUsd };
    };

    const drawers = {
      drawer1_replenishment: buildDrawer(d1Allocated, d1Spent),
      drawer2_operations: buildDrawer(d2Allocated, d2Spent),
      drawer3_profit: buildDrawer(d3Allocated, d3Spent),
    };

    const anyOverdraft =
      drawers.drawer1_replenishment.isOverdrawn ||
      drawers.drawer2_operations.isOverdrawn ||
      drawers.drawer3_profit.isOverdrawn;

    const totalNetCashUsd = roundMoney(
      drawers.drawer1_replenishment.balanceUsd +
        drawers.drawer2_operations.balanceUsd +
        drawers.drawer3_profit.balanceUsd,
    );

    // Inventory Semaphore
    const auditedInventory = input.inventory.map((item) => {
      const daysSinceLastSale =
        typeof item.daysSinceLastSale === 'number'
          ? item.daysSinceLastSale
          : item.lastSoldAt
            ? Math.max(0, calendarDaysBetween(item.lastSoldAt, referenceDateVet))
            : null;

      const isOutOfStock = item.currentStock <= 0;
      const isLowStock = item.currentStock > 0 && item.currentStock <= item.minimumStock;
      const isColdStock =
        item.currentStock > 0 &&
        daysSinceLastSale !== null &&
        daysSinceLastSale > input.coldStockThresholdDays;

      const semaphore: 'out_of_stock' | 'low_stock' | 'cold_stock' | 'optimal' = isOutOfStock
        ? 'out_of_stock'
        : isLowStock
          ? 'low_stock'
          : isColdStock
            ? 'cold_stock'
            : 'optimal';

      const stockValueCostUsd = roundMoney(Math.max(0, item.currentStock) * item.unitCostUsd);

      return {
        id: item.id,
        name: item.name,
        currentStock: item.currentStock,
        minimumStock: item.minimumStock,
        daysSinceLastSale,
        semaphore,
        isColdStock,
        stockValueCostUsd,
      };
    });

    const outOfStockItems = auditedInventory.filter((i) => i.semaphore === 'out_of_stock');
    const lowStockItems = auditedInventory.filter((i) => i.semaphore === 'low_stock');
    const coldStockItems = auditedInventory.filter((i) => i.isColdStock);
    const coldStockImmobilizedCapitalUsd = roundMoney(
      coldStockItems.reduce((sum, i) => sum + i.stockValueCostUsd, 0),
    );
    const totalInventoryCostUsd = roundMoney(
      auditedInventory.reduce((sum, i) => sum + i.stockValueCostUsd, 0),
    );

    // Provider CxP Audit
    const unpaidProviders = input.providers
      .filter((p) => p.outstandingDebtUsd > 0)
      .map((p) => {
        const isOverdue = p.dueDate ? calendarDaysBetween(referenceDateVet, p.dueDate) < 0 : false;
        const daysOverdue =
          p.dueDate && isOverdue ? Math.abs(calendarDaysBetween(referenceDateVet, p.dueDate)) : 0;
        return {
          id: p.id,
          name: p.name,
          outstandingDebtUsd: roundMoney(p.outstandingDebtUsd),
          dueDate: p.dueDate ?? null,
          isOverdue,
          daysOverdue,
        };
      });

    const totalProviderDebtUsd = roundMoney(
      unpaidProviders.reduce((sum, p) => sum + p.outstandingDebtUsd, 0),
    );
    const overdueProvidersCount = unpaidProviders.filter((p) => p.isOverdue).length;
    const canDrawer1CoverProviders =
      drawers.drawer1_replenishment.balanceUsd >= totalProviderDebtUsd;
    const replenishmentCoverageGapUsd = canDrawer1CoverProviders
      ? 0
      : roundMoney(totalProviderDebtUsd - Math.max(0, drawers.drawer1_replenishment.balanceUsd));

    const overallHealth: 'optimal' | 'warning' | 'critical' =
      anyOverdraft || overdueProvidersCount > 0 || outOfStockItems.length > 0
        ? 'critical'
        : lowStockItems.length > 0 || coldStockItems.length > 0 || !canDrawer1CoverProviders
          ? 'warning'
          : 'optimal';

    return {
      referenceDateVet,
      overallHealth,
      totalNetCashUsd,
      drawers,
      inventorySummary: {
        totalItemsCount: auditedInventory.length,
        totalInventoryCostUsd,
        outOfStockCount: outOfStockItems.length,
        lowStockCount: lowStockItems.length,
        coldStockCount: coldStockItems.length,
        coldStockThresholdDays: input.coldStockThresholdDays,
        coldStockImmobilizedCapitalUsd,
        items: auditedInventory,
      },
      providersSummary: {
        unpaidProvidersCount: unpaidProviders.length,
        overdueProvidersCount,
        totalProviderDebtUsd,
        canDrawer1CoverProviders,
        replenishmentCoverageGapUsd,
        unpaidProviders,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// TOOL 5: f360_generate_quote_estimate
// ---------------------------------------------------------------------------

export const f360GenerateQuoteEstimateTool = {
  name: 'f360_generate_quote_estimate',
  description:
    'Calcula presupuestos multi-industria (taller, construcción, servicios) con modo dual de mano de obra, merma técnica (+10%), IVA/IGTF, resguardo contra descuentos bajo costo, anticipo desde 0% y líneas cliente prorrateadas al centavo exacto sin exponer margen interno.',
  inputSchema: F360GenerateQuoteEstimateInputSchema,
  execute: (rawInput: F360GenerateQuoteEstimateInput) => {
    const input = F360GenerateQuoteEstimateInputSchema.parse(rawInput);

    const effectiveWastePct =
      typeof input.technicalWastePercent === 'number'
        ? input.technicalWastePercent
        : input.includeTechnicalWaste
          ? 10
          : 0;

    let rawMaterialsUsd = 0;
    let lineItemsLaborUsd = 0;
    let totalLogisticsUsd = 0;

    const weightedItems = input.lineItems.map((item, idx) => {
      const rawTotal = roundMoney(item.quantity * item.unitCostUsd);
      if (item.category === 'material') rawMaterialsUsd += rawTotal;
      else if (item.category === 'labor') lineItemsLaborUsd += rawTotal;
      else totalLogisticsUsd += rawTotal;

      const weight =
        item.category === 'material' ? rawTotal * (1 + effectiveWastePct / 100) : rawTotal;
      return {
        id: item.id ?? `item-${idx + 1}`,
        category: item.category,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        rawTotal,
        weight,
      };
    });

    rawMaterialsUsd = roundMoney(rawMaterialsUsd);
    lineItemsLaborUsd = roundMoney(lineItemsLaborUsd);
    totalLogisticsUsd = roundMoney(totalLogisticsUsd);

    const wasteUsd = roundMoney((rawMaterialsUsd * effectiveWastePct) / 100);
    const totalMaterialsUsd = roundMoney(rawMaterialsUsd + wasteUsd);

    let modeLaborUsd = 0;
    if (input.laborMode === 'percentage') {
      modeLaborUsd = roundMoney((totalMaterialsUsd * input.laborPercentage) / 100);
    } else if (input.laborMode === 'per_m2' || input.laborMode === 'daily_rate') {
      modeLaborUsd = roundMoney(input.laborUnits * input.laborUnitRateUsd);
    } else if (input.laborMode === 'fixed') {
      modeLaborUsd = roundMoney(input.laborUnitRateUsd);
    }

    const totalLaborUsd = roundMoney(lineItemsLaborUsd + modeLaborUsd);
    const subtotalCostUsd = roundMoney(totalMaterialsUsd + totalLaborUsd + totalLogisticsUsd);
    const profitUsd = roundMoney((subtotalCostUsd * input.profitMarginPercent) / 100);
    const grossTotalUsd = roundMoney(subtotalCostUsd + profitUsd);
    const discountUsd = roundMoney((grossTotalUsd * input.discountPercent) / 100);
    const netBeforeTaxUsd = Math.max(0, roundMoney(grossTotalUsd - discountUsd));

    const isBelowCost = netBeforeTaxUsd < subtotalCostUsd;
    const belowCostDeficitUsd = isBelowCost ? roundMoney(subtotalCostUsd - netBeforeTaxUsd) : 0;
    const maxSafeDiscountPercent =
      grossTotalUsd > 0
        ? roundMoney(((grossTotalUsd - subtotalCostUsd) / grossTotalUsd) * 100, 2)
        : 0;

    const effectiveIvaPct = input.applyIva ? input.ivaPercent : 0;
    const effectiveIgtfPct = input.applyIgtf ? input.igtfPercent : 0;
    const ivaUsd = roundMoney((netBeforeTaxUsd * effectiveIvaPct) / 100);
    const igtfUsd = roundMoney(((netBeforeTaxUsd + ivaUsd) * effectiveIgtfPct) / 100);
    const finalTotalUsd = roundMoney(netBeforeTaxUsd + ivaUsd + igtfUsd);

    const safeBcv =
      typeof input.bcvRate === 'number' && Number.isFinite(input.bcvRate) && input.bcvRate > 0
        ? input.bcvRate
        : 0;
    const finalTotalVes = safeBcv > 0 ? roundMoney(finalTotalUsd * safeBcv) : 0;

    const advanceAmountUsd =
      input.advancePercent === 0 ? 0 : roundMoney((finalTotalUsd * input.advancePercent) / 100);
    const balanceDueUsd = roundMoney(finalTotalUsd - advanceAmountUsd);

    // Prorate finalTotalUsd across visible client lines so sum === finalTotalUsd to the exact cent
    // without leaking internal unitCostUsd, profitUsd, or modeLaborUsd.
    const totalWeight = weightedItems.reduce((sum, entry) => sum + entry.weight, 0);
    let lastActiveIdx = -1;
    for (let i = weightedItems.length - 1; i >= 0; i--) {
      const entry = weightedItems[i];
      if (entry && entry.weight > 0) {
        lastActiveIdx = i;
        break;
      }
    }
    if (lastActiveIdx === -1 && weightedItems.length > 0) {
      lastActiveIdx = weightedItems.length - 1;
    }

    let runningClientTotal = 0;
    const clientLines = weightedItems.map((entry, idx) => {
      const share =
        totalWeight > 0
          ? entry.weight / totalWeight
          : weightedItems.length > 0
            ? 1 / weightedItems.length
            : 0;

      let clientLineTotalUsd: number;
      if (idx === lastActiveIdx) {
        clientLineTotalUsd = roundMoney(finalTotalUsd - runningClientTotal);
      } else if (entry.weight > 0 || totalWeight === 0) {
        clientLineTotalUsd = roundMoney(finalTotalUsd * share);
        runningClientTotal = roundMoney(runningClientTotal + clientLineTotalUsd);
      } else {
        clientLineTotalUsd = 0;
      }

      const clientUnitPriceUsd =
        entry.quantity > 0 ? roundMoney(clientLineTotalUsd / entry.quantity, 4) : 0;

      return {
        id: entry.id,
        name: entry.name,
        quantity: entry.quantity,
        unit: entry.unit,
        clientUnitPriceUsd,
        clientLineTotalUsd,
      };
    });

    return {
      industry: input.industry,
      laborMode: input.laborMode,
      discountGuard: {
        isBelowCost,
        belowCostDeficitUsd,
        maxSafeDiscountPercent,
        belowCostWarning: isBelowCost
          ? `Alerta de descuento bajo costo: el precio neto ($${netBeforeTaxUsd.toFixed(2)} USD) está $${belowCostDeficitUsd.toFixed(2)} USD por debajo del costo directo ($${subtotalCostUsd.toFixed(2)} USD). El descuento máximo sin pérdida es ${maxSafeDiscountPercent}%.`
          : null,
      },
      clientFacingQuote: {
        clientLines,
        netBeforeTaxUsd,
        ivaPercent: effectiveIvaPct,
        ivaUsd,
        igtfPercent: effectiveIgtfPct,
        igtfUsd,
        finalTotalUsd,
        finalTotalVes,
        advancePercent: input.advancePercent,
        advanceAmountUsd,
        balanceDueUsd,
      },
      internalBreakdown: {
        rawMaterialsUsd,
        technicalWastePercent: effectiveWastePct,
        wasteUsd,
        totalMaterialsUsd,
        lineItemsLaborUsd,
        modeLaborUsd,
        totalLaborUsd,
        totalLogisticsUsd,
        subtotalCostUsd,
        profitMarginPercent: input.profitMarginPercent,
        profitUsd,
        grossTotalUsd,
        discountPercent: input.discountPercent,
        discountUsd,
        netBeforeTaxUsd,
        ivaUsd,
        igtfUsd,
        finalTotalUsd,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// TOOL 6: f360_audit_overdue_and_runway
// ---------------------------------------------------------------------------

export const f360AuditOverdueAndRunwayTool = {
  name: 'f360_audit_overdue_and_runway',
  description:
    'Audita bajo calendario VET (UTC-4) pasivos vencidos, cuotas Cashea en gracia o penalización ($4/cuota), tasa de consumo diaria/mensual exclusivamente sobre gastos reales (sin consumo sintético) y runway real en días y meses.',
  inputSchema: F360AuditOverdueAndRunwayInputSchema,
  execute: (rawInput: F360AuditOverdueAndRunwayInput) => {
    const input = F360AuditOverdueAndRunwayInputSchema.parse(rawInput);
    const referenceDateVet = normalizeVetDate(input.referenceDateIso);

    // 1. Overdue liabilities under VET calendar
    const overdueLiabilitiesList = input.liabilities
      .filter((l) => l.status !== 'paid')
      .filter((l) => l.status === 'overdue' || calendarDaysBetween(referenceDateVet, l.dueDate) < 0)
      .map((l) => ({
        id: l.id,
        title: l.title,
        dueDate: l.dueDate,
        remainingAmountUsd: roundMoney(l.remainingAmountUsd),
        daysOverdue: Math.max(0, calendarDaysBetween(l.dueDate, referenceDateVet)),
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    const overdueLiabilitiesTotalUsd = roundMoney(
      overdueLiabilitiesList.reduce((sum, l) => sum + l.remainingAmountUsd, 0),
    );

    // 2. Cashea installments Anti-Mora audit under VET calendar
    const auditedInstallments = input.casheaInstallments.map((inst) => {
      const antiMora = evaluateCasheaInstallmentAntiMora(
        inst.dueDate,
        inst.status,
        referenceDateVet,
      );
      return {
        planId: inst.planId ?? null,
        productName: inst.productName ?? null,
        installmentNumber: inst.installmentNumber,
        dueDate: inst.dueDate,
        amountUsd: roundMoney(inst.amountUsd),
        ...antiMora,
      };
    });

    const inGraceItems = auditedInstallments.filter((i) => i.healthStatus === 'grace_2d');
    const overduePenaltyItems = auditedInstallments.filter(
      (i) => i.healthStatus === 'overdue_penalty',
    );
    const totalCasheaOverduePrincipalUsd = roundMoney(
      [...inGraceItems, ...overduePenaltyItems].reduce((sum, i) => sum + i.amountUsd, 0),
    );
    const totalReactivationFeesUsd = roundMoney(
      overduePenaltyItems.reduce((sum, i) => sum + i.reactivationFeeUsd, 0),
    );
    const totalCasheaExposureWithFeesUsd = roundMoney(
      totalCasheaOverduePrincipalUsd + totalReactivationFeesUsd,
    );

    // 3. Burn rate strictly from actual expense history inside [referenceDate - burnWindowDays, referenceDate]
    const windowExpenses = input.expenses.filter((exp) => {
      const daysAgo = calendarDaysBetween(exp.date, referenceDateVet);
      return daysAgo >= 0 && daysAgo < input.burnWindowDays;
    });
    const windowExpensesTotalUsd = roundMoney(
      windowExpenses.reduce((sum, exp) => sum + exp.amountUsd, 0),
    );

    const immediateObligationsUsd = roundMoney(
      overdueLiabilitiesTotalUsd + totalCasheaExposureWithFeesUsd,
    );
    const netLiquidAfterOverdueUsd = roundMoney(input.liquidAssetsUsd - immediateObligationsUsd);

    let burnAndRunway: {
      hasBurnEvidence: boolean;
      burnWindowDays: number;
      expensesCountInWindow: number;
      totalExpensesInWindowUsd: number;
      dailyBurnRateUsd: number | null;
      monthlyBurnRateUsd: number | null;
      runwayDays: number | null;
      runwayMonths: number | null;
      netRunwayDaysAfterOverdue: number | null;
      runwayStatus: 'UNAVAILABLE_NO_EXPENSE_HISTORY' | 'CRITICAL' | 'WARNING' | 'HEALTHY';
    };

    if (windowExpenses.length === 0 || windowExpensesTotalUsd <= 0) {
      burnAndRunway = {
        hasBurnEvidence: false,
        burnWindowDays: input.burnWindowDays,
        expensesCountInWindow: windowExpenses.length,
        totalExpensesInWindowUsd: windowExpensesTotalUsd,
        dailyBurnRateUsd: null,
        monthlyBurnRateUsd: null,
        runwayDays: null,
        runwayMonths: null,
        netRunwayDaysAfterOverdue: null,
        runwayStatus: 'UNAVAILABLE_NO_EXPENSE_HISTORY',
      };
    } else {
      const dailyBurnRateUsd = roundMoney(windowExpensesTotalUsd / input.burnWindowDays, 2);
      const monthlyBurnRateUsd = roundMoney(dailyBurnRateUsd * 30, 2);
      const runwayDays =
        dailyBurnRateUsd > 0 ? roundMoney(input.liquidAssetsUsd / dailyBurnRateUsd, 1) : null;
      const runwayMonths =
        monthlyBurnRateUsd > 0 ? roundMoney(input.liquidAssetsUsd / monthlyBurnRateUsd, 2) : null;
      const netRunwayDaysAfterOverdue =
        dailyBurnRateUsd > 0
          ? roundMoney(Math.max(0, netLiquidAfterOverdueUsd) / dailyBurnRateUsd, 1)
          : null;

      const runwayStatus: 'CRITICAL' | 'WARNING' | 'HEALTHY' =
        overdueLiabilitiesList.length > 0 ||
        overduePenaltyItems.length > 0 ||
        (runwayDays !== null && runwayDays < 30)
          ? 'CRITICAL'
          : runwayDays !== null && runwayDays < 90
            ? 'WARNING'
            : 'HEALTHY';

      burnAndRunway = {
        hasBurnEvidence: true,
        burnWindowDays: input.burnWindowDays,
        expensesCountInWindow: windowExpenses.length,
        totalExpensesInWindowUsd: windowExpensesTotalUsd,
        dailyBurnRateUsd,
        monthlyBurnRateUsd,
        runwayDays,
        runwayMonths,
        netRunwayDaysAfterOverdue,
        runwayStatus,
      };
    }

    return {
      referenceDateVet,
      liquidAssetsUsd: roundMoney(input.liquidAssetsUsd),
      immediateObligationsUsd,
      netLiquidAfterOverdueUsd,
      overdueLiabilities: {
        count: overdueLiabilitiesList.length,
        totalUsd: overdueLiabilitiesTotalUsd,
        items: overdueLiabilitiesList,
      },
      casheaAudit: {
        totalInstallmentsAudited: auditedInstallments.length,
        inGraceCount: inGraceItems.length,
        overduePenaltyCount: overduePenaltyItems.length,
        totalCasheaOverduePrincipalUsd,
        totalReactivationFeesUsd,
        totalCasheaExposureWithFeesUsd,
        installments: auditedInstallments,
      },
      burnAndRunway,
    };
  },
};
