import { roundMoney } from '../core/index.js';
import {
  EvaluateFxDeskPlanInputSchema,
  type EvaluateFxDeskPlanInput,
} from '../schemas/index.js';

export const MCP_FX_BANK_IDS = {
  BDV: 'BDV',
  BANCAMIGA: 'BANCAMIGA',
  BANESCO: 'BANESCO',
  MERCANTIL: 'MERCANTIL',
  PROVINCIAL: 'PROVINCIAL',
  BNC: 'BNC',
  BANCARIBE: 'BANCARIBE',
  BANPLUS: 'BANPLUS',
  BICENTENARIO: 'BICENTENARIO',
  TESORO: 'TESORO',
  EXTERIOR: 'EXTERIOR',
  PLAZA: 'PLAZA',
  BFC: 'BFC',
  CIEN_BANCO: 'CIEN_BANCO',
} as const;

export type McpFxBankId = (typeof MCP_FX_BANK_IDS)[keyof typeof MCP_FX_BANK_IDS];

export type McpFxExitRail = 'INTL_DEBIT_CARD' | 'INTERNAL_USD_P2P' | 'CASH_WITHDRAWAL_OTC';

interface McpFxBankProfile {
  readonly id: McpFxBankId;
  readonly abaCode: string;
  readonly name: string;
  readonly shortName: string;
  readonly tier: 'TIER_1_LIDER' | 'TIER_2_COMERCIAL' | 'TIER_3_NICHO';
  readonly bankFxFeePct: number;
  readonly rateSafetyBufferPct: number;
  readonly minLotUsd: number;
  readonly lotStepUsd: number;
  readonly maxTicketUsd: number;
  readonly primaryExitRail: McpFxExitRail;
  readonly exitRailFrictionPct: number;
}

const VENEZUELAN_FX_BANKS_MCP: readonly McpFxBankProfile[] = [
  { id: 'BDV', abaCode: '0102', name: 'Banco de Venezuela (BDV)', shortName: 'BDV', tier: 'TIER_1_LIDER', bankFxFeePct: 0.25, rateSafetyBufferPct: 0.5, minLotUsd: 10, lotStepUsd: 5, maxTicketUsd: 1000, primaryExitRail: 'INTERNAL_USD_P2P', exitRailFrictionPct: 1.2 },
  { id: 'BANCAMIGA', abaCode: '0172', name: 'Bancamiga Banco Universal', shortName: 'Bancamiga', tier: 'TIER_1_LIDER', bankFxFeePct: 0.5, rateSafetyBufferPct: 0.5, minLotUsd: 20, lotStepUsd: 10, maxTicketUsd: 2000, primaryExitRail: 'INTL_DEBIT_CARD', exitRailFrictionPct: 1.5 },
  { id: 'BANESCO', abaCode: '0134', name: 'Banesco Banco Universal', shortName: 'Banesco', tier: 'TIER_1_LIDER', bankFxFeePct: 0.25, rateSafetyBufferPct: 0.5, minLotUsd: 20, lotStepUsd: 10, maxTicketUsd: 1500, primaryExitRail: 'INTERNAL_USD_P2P', exitRailFrictionPct: 1.5 },
  { id: 'MERCANTIL', abaCode: '0105', name: 'Mercantil Banco Universal', shortName: 'Mercantil', tier: 'TIER_1_LIDER', bankFxFeePct: 0.25, rateSafetyBufferPct: 0.5, minLotUsd: 20, lotStepUsd: 10, maxTicketUsd: 1500, primaryExitRail: 'INTL_DEBIT_CARD', exitRailFrictionPct: 1.4 },
  { id: 'PROVINCIAL', abaCode: '0108', name: 'BBVA Provincial', shortName: 'Provincial', tier: 'TIER_2_COMERCIAL', bankFxFeePct: 0.25, rateSafetyBufferPct: 0.5, minLotUsd: 20, lotStepUsd: 10, maxTicketUsd: 1200, primaryExitRail: 'CASH_WITHDRAWAL_OTC', exitRailFrictionPct: 1.8 },
  { id: 'BNC', abaCode: '0191', name: 'Banco Nacional de Crédito (BNC)', shortName: 'BNC', tier: 'TIER_2_COMERCIAL', bankFxFeePct: 0.3, rateSafetyBufferPct: 0.5, minLotUsd: 25, lotStepUsd: 5, maxTicketUsd: 2000, primaryExitRail: 'INTL_DEBIT_CARD', exitRailFrictionPct: 1.5 },
  { id: 'BANCARIBE', abaCode: '0114', name: 'Bancaribe', shortName: 'Bancaribe', tier: 'TIER_2_COMERCIAL', bankFxFeePct: 0.35, rateSafetyBufferPct: 0.5, minLotUsd: 20, lotStepUsd: 10, maxTicketUsd: 1000, primaryExitRail: 'INTL_DEBIT_CARD', exitRailFrictionPct: 1.6 },
  { id: 'BANPLUS', abaCode: '0174', name: 'Banplus Banco Universal', shortName: 'Banplus', tier: 'TIER_2_COMERCIAL', bankFxFeePct: 0.3, rateSafetyBufferPct: 0.5, minLotUsd: 50, lotStepUsd: 10, maxTicketUsd: 2500, primaryExitRail: 'INTERNAL_USD_P2P', exitRailFrictionPct: 1.5 },
  { id: 'BICENTENARIO', abaCode: '0175', name: 'Banco Digital de los Trabajadores (Bicentenario)', shortName: 'Bicentenario', tier: 'TIER_2_COMERCIAL', bankFxFeePct: 0.25, rateSafetyBufferPct: 0.6, minLotUsd: 10, lotStepUsd: 5, maxTicketUsd: 800, primaryExitRail: 'INTL_DEBIT_CARD', exitRailFrictionPct: 1.8 },
  { id: 'TESORO', abaCode: '0163', name: 'Banco del Tesoro', shortName: 'Tesoro', tier: 'TIER_3_NICHO', bankFxFeePct: 0.25, rateSafetyBufferPct: 0.6, minLotUsd: 10, lotStepUsd: 5, maxTicketUsd: 800, primaryExitRail: 'INTL_DEBIT_CARD', exitRailFrictionPct: 1.8 },
  { id: 'EXTERIOR', abaCode: '0115', name: 'Banco Exterior', shortName: 'Exterior', tier: 'TIER_3_NICHO', bankFxFeePct: 0.35, rateSafetyBufferPct: 0.5, minLotUsd: 25, lotStepUsd: 5, maxTicketUsd: 1500, primaryExitRail: 'INTL_DEBIT_CARD', exitRailFrictionPct: 1.6 },
  { id: 'PLAZA', abaCode: '0138', name: 'Banco Plaza', shortName: 'Plaza', tier: 'TIER_3_NICHO', bankFxFeePct: 0.35, rateSafetyBufferPct: 0.5, minLotUsd: 30, lotStepUsd: 10, maxTicketUsd: 1500, primaryExitRail: 'CASH_WITHDRAWAL_OTC', exitRailFrictionPct: 1.8 },
  { id: 'BFC', abaCode: '0151', name: 'BFC Banco Fondo Común', shortName: 'BFC', tier: 'TIER_3_NICHO', bankFxFeePct: 0.35, rateSafetyBufferPct: 0.5, minLotUsd: 20, lotStepUsd: 10, maxTicketUsd: 1000, primaryExitRail: 'INTL_DEBIT_CARD', exitRailFrictionPct: 1.7 },
  { id: 'CIEN_BANCO', abaCode: '0156', name: '100% Banco', shortName: '100% Banco', tier: 'TIER_3_NICHO', bankFxFeePct: 0.4, rateSafetyBufferPct: 0.5, minLotUsd: 20, lotStepUsd: 10, maxTicketUsd: 1000, primaryExitRail: 'CASH_WITHDRAWAL_OTC', exitRailFrictionPct: 1.9 },
];

const GENERIC_BANK_STOP_WORDS = new Set([
  'BANCO',
  'UNIVERSAL',
  'COMERCIAL',
  'DIGITAL',
  'DE',
  'DEL',
  'EN',
  'LINEA',
]);

function resolveMcpFxBankId(raw?: string): McpFxBankId | null {
  if (!raw) return null;
  const clean = raw
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!clean || GENERIC_BANK_STOP_WORDS.has(clean)) return null;

  for (const bank of VENEZUELAN_FX_BANKS_MCP) {
    const shortNorm = bank.shortName.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const fullNorm = bank.name.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (bank.id === clean || bank.abaCode === clean || shortNorm === clean || fullNorm === clean) {
      return bank.id;
    }
  }
  if (clean.includes('100%') || clean.includes('100 %') || clean.includes('100X100') || clean === '100' || clean.includes('CIEN')) {
    return 'CIEN_BANCO';
  }
  if (clean.includes('BANCAMIGA')) return 'BANCAMIGA';
  if (clean.includes('BANESCO')) return 'BANESCO';
  if (clean.includes('MERCANTIL') || clean.includes('MONY')) return 'MERCANTIL';
  if (clean.includes('PROVINCIAL') || clean.includes('BBVA')) return 'PROVINCIAL';
  if (clean.includes('BNC')) return 'BNC';
  if (clean.includes('BANCARIBE')) return 'BANCARIBE';
  if (clean.includes('BANPLUS')) return 'BANPLUS';
  if (clean.includes('BICENTENARIO') || clean.includes('BDT')) return 'BICENTENARIO';
  if (clean.includes('TESORO')) return 'TESORO';
  if (clean.includes('EXTERIOR')) return 'EXTERIOR';
  if (clean.includes('PLAZA')) return 'PLAZA';
  if (clean.includes('BFC') || clean.includes('FONDO COMUN')) return 'BFC';
  if (clean.includes('VENEZUELA') || clean.includes('BANVENEZ')) return 'BDV';
  return null;
}

function evaluateVetWindow(now: Date) {
  const vetShifted = new Date(now.getTime() - 4 * 3600 * 1000);
  const vetDayOfWeek = vetShifted.getUTCDay();
  const vetHour = vetShifted.getUTCHours();
  const vetMinute = vetShifted.getUTCMinutes();
  const mins = vetHour * 60 + vetMinute;
  const vetTimeFormatted = `${String(vetHour).padStart(2, '0')}:${String(vetMinute).padStart(2, '0')} VET`;

  if (vetDayOfWeek === 0 || vetDayOfWeek === 6) {
    return { isWindowOpen: false, regime: 'CLOSED_OFF_HOURS', vetDayOfWeek, vetTimeFormatted };
  }
  if (mins >= 510 && mins <= 780) {
    const isBcvDay = vetDayOfWeek === 1 || vetDayOfWeek === 4;
    return {
      isWindowOpen: true,
      regime: isBcvDay ? 'BCV_INTERVENTION_LIVE' : 'RETAIL_MENUDEO_OPEN',
      vetDayOfWeek,
      vetTimeFormatted,
    };
  }
  if (mins > 780 && mins <= 930) {
    return { isWindowOpen: true, regime: 'AFTERNOON_PACTO_EXTENSION', vetDayOfWeek, vetTimeFormatted };
  }
  if (mins >= 450 && mins < 510) {
    return { isWindowOpen: false, regime: 'PRE_OPEN_PREP', vetDayOfWeek, vetTimeFormatted };
  }
  return { isWindowOpen: false, regime: 'CLOSED_OFF_HOURS', vetDayOfWeek, vetTimeFormatted };
}

function computeLot(deployableVes: number, bcvRateVes: number, bank: McpFxBankProfile, feePct: number) {
  if (deployableVes <= 0 || bcvRateVes <= 0) {
    return { orderUsd: 0, principalVes: 0, bankFeeVes: 0, totalDebitVes: 0, safetyBufferVes: 0 };
  }
  const effectiveVesPerUsd = bcvRateVes * (1 + (feePct + bank.rateSafetyBufferPct) / 100);
  const cappedUsd = Math.min(deployableVes / effectiveVesPerUsd, bank.maxTicketUsd);
  if (cappedUsd < bank.minLotUsd) {
    return { orderUsd: 0, principalVes: 0, bankFeeVes: 0, totalDebitVes: 0, safetyBufferVes: 0 };
  }
  const step = Math.max(1, bank.lotStepUsd);
  const steppedUsd = Math.floor(cappedUsd / step) * step;
  if (steppedUsd < bank.minLotUsd) {
    return { orderUsd: 0, principalVes: 0, bankFeeVes: 0, totalDebitVes: 0, safetyBufferVes: 0 };
  }
  const principalVes = roundMoney(steppedUsd * bcvRateVes, 2);
  const bankFeeVes = roundMoney(principalVes * (feePct / 100), 2);
  const totalDebitVes = roundMoney(principalVes + bankFeeVes, 2);
  const safetyBufferVes = roundMoney(Math.max(0, deployableVes - totalDebitVes), 2);
  return { orderUsd: steppedUsd, principalVes, bankFeeVes, totalDebitVes, safetyBufferVes };
}

export interface FxAccountSliceSummary {
  readonly accountId: string;
  readonly accountName: string;
  readonly orderUsd: number;
  readonly principalVes: number;
  readonly bankFeeVes: number;
  readonly totalDebitVes: number;
}

export interface FxDeskMcpTicket {
  readonly bankId: McpFxBankId;
  readonly shortName: string;
  readonly abaCode: string;
  readonly modality: 'MENUDEO_BCV' | 'MESA_CAMBIO_PACTO' | 'TAQUILLA_EFECTIVO_OTC';
  readonly recommendedOrderUsd: number;
  readonly effectiveBankFeePct: number;
  readonly estimatedBankFeeVes: number;
  readonly estimatedVesDebit: number;
  readonly reservedSafetyBufferVes: number;
  readonly igtfPct: number;
  readonly exitRail: McpFxExitRail;
  readonly exitRailFrictionPct: number;
  readonly netUsdtAfterExitRail: number;
  readonly projectedP2pReturnVes: number | null;
  readonly projectedNetProfitVes: number | null;
  readonly projectedNetRoiPct: number | null;
  readonly isViableOrder: boolean;
  readonly blockReason: string | null;
  readonly accountAllocations: readonly FxAccountSliceSummary[];
}

export const evaluateFxDeskPlanTool = {
  name: 'evaluate_fx_desk_plan',
  description:
    'Evalúa el plan institucional de Mesa Cambiaria / Menudeo BCV sobre los 14 bancos venezolanos en horario America/Caracas (UTC-04:00): calcula lotes anti-rechazo (1x comisión bancaria), IGTF 3% vs 0% taquilla efectivo OTC, aislamiento por cuenta sin sobregiro y retorno neto en USDT/VES. Falla cerrado si faltan tasas reales o capital.',
  inputSchema: EvaluateFxDeskPlanInputSchema,
  execute: (input: EvaluateFxDeskPlanInput) => {
    const evalDate = input.evaluationTimestampIso
      ? new Date(input.evaluationTimestampIso)
      : new Date();
    const window = evaluateVetWindow(evalDate);

    const unmeasuredInputs: string[] = [];
    if (typeof input.bcvOfficialRateVes !== 'number' || input.bcvOfficialRateVes <= 0) {
      unmeasuredInputs.push('bcvOfficialRateVes');
    }
    if (typeof input.p2pSellRateVes !== 'number' || input.p2pSellRateVes <= 0) {
      unmeasuredInputs.push('p2pSellRateVes');
    }
    const hasAccounts = Array.isArray(input.accounts) && input.accounts.length > 0;
    const hasCapital = typeof input.capitalVes === 'number' && input.capitalVes > 0;
    if (!hasAccounts && !hasCapital) {
      unmeasuredInputs.push('capitalVes');
    }

    if (unmeasuredInputs.length > 0) {
      return {
        actionable: false,
        verdict: 'UNAVAILABLE' as const,
        unavailableReason: `missing_evidence:${unmeasuredInputs[0]}`,
        unmeasuredInputs,
        window,
        summary: {
          bcvOfficialRateVes: input.bcvOfficialRateVes ?? null,
          p2pSellRateVes: input.p2pSellRateVes ?? null,
          grossGapVes: null,
          grossGapPct: null,
          totalDeployableVes: 0,
          totalRecommendedUsd: 0,
          totalNetUsdt: 0,
          totalProjectedNetProfitVes: null,
          averageNetRoiPct: null,
        },
        tickets: [] as FxDeskMcpTicket[],
      };
    }

    const bcvRate = roundMoney(input.bcvOfficialRateVes!, 2);
    const p2pRate = roundMoney(input.p2pSellRateVes!, 2);
    const modality = input.modality ?? 'MENUDEO_BCV';
    const configuredIgtfPct = roundMoney(input.igtfPct ?? 3, 2);
    const p2pExitFeePct = input.p2pExitFeePct ?? 0.25;
    const filterBankId = resolveMcpFxBankId(input.bankFilter);
    const fluidSet = new Set(
      (input.confirmedFluidBanks ?? [])
        .map((b) => resolveMcpFxBankId(b))
        .filter((b): b is McpFxBankId => b !== null),
    );
    const depletedSet = new Set(
      (input.depletedBanks ?? [])
        .map((b) => resolveMcpFxBankId(b))
        .filter((b): b is McpFxBankId => b !== null),
    );

    const candidateBanks = filterBankId
      ? VENEZUELAN_FX_BANKS_MCP.filter((b) => b.id === filterBankId)
      : VENEZUELAN_FX_BANKS_MCP;

    let remainingPoolVes =
      input.allocationMode === 'DISTRIBUTE_TOTAL' && hasCapital ? input.capitalVes! : 0;

    let totalDeployableVes = 0;
    let totalRecommendedUsd = 0;
    let totalNetUsdt = 0;
    let totalProjectedNetProfitVes = 0;

    const tickets: FxDeskMcpTicket[] = candidateBanks.map((bank) => {
      const effectiveBankFeePct =
        modality === 'MESA_CAMBIO_PACTO' ? Math.max(0.5, bank.bankFxFeePct) : bank.bankFxFeePct;
      const exitRail: McpFxExitRail =
        modality === 'TAQUILLA_EFECTIVO_OTC' ? 'CASH_WITHDRAWAL_OTC' : bank.primaryExitRail;
      const exitRailFrictionPct =
        modality === 'TAQUILLA_EFECTIVO_OTC' ? 1.8 : bank.exitRailFrictionPct;
      const igtfPct = exitRail === 'CASH_WITHDRAWAL_OTC' ? 0 : configuredIgtfPct;

      const matchedAccounts = (input.accounts ?? []).filter((acc) => {
        if (acc.paymentRail === 'PAGO_MOVIL') return false;
        const resolved = resolveMcpFxBankId(acc.bankCode) ?? resolveMcpFxBankId(acc.bankName);
        return resolved === bank.id || acc.accountNumberMasked?.startsWith(bank.abaCode);
      });

      const accountAllocations: FxAccountSliceSummary[] = [];
      let lot = { orderUsd: 0, principalVes: 0, bankFeeVes: 0, totalDebitVes: 0, safetyBufferVes: 0 };
      let blockReason: string | null = null;

      if (depletedSet.has(bank.id)) {
        blockReason = 'Marcado sin cupo recientemente (en enfriamiento)';
      } else if (hasAccounts) {
        if (matchedAccounts.length === 0) {
          blockReason = 'Sin cuenta TRANSFERENCIA vinculada';
        } else {
          for (const acc of matchedAccounts) {
            if (acc.isOverMonthlyLimit) continue;
            const remDaily = acc.remainingDailyLimitVes ?? acc.availableBalanceVes;
            const cap = Math.min(acc.availableBalanceVes, remDaily);
            const accLot = computeLot(cap, bcvRate, bank, effectiveBankFeePct);
            if (accLot.orderUsd >= bank.minLotUsd && accLot.totalDebitVes <= acc.availableBalanceVes) {
              accountAllocations.push({
                accountId: acc.id,
                accountName: acc.bankName,
                orderUsd: accLot.orderUsd,
                principalVes: accLot.principalVes,
                bankFeeVes: accLot.bankFeeVes,
                totalDebitVes: accLot.totalDebitVes,
              });
            }
          }
          if (accountAllocations.length > 0) {
            lot = {
              orderUsd: accountAllocations.reduce((s, a) => s + a.orderUsd, 0),
              principalVes: roundMoney(accountAllocations.reduce((s, a) => s + a.principalVes, 0), 2),
              bankFeeVes: roundMoney(accountAllocations.reduce((s, a) => s + a.bankFeeVes, 0), 2),
              totalDebitVes: roundMoney(accountAllocations.reduce((s, a) => s + a.totalDebitVes, 0), 2),
              safetyBufferVes: 0,
            };
          } else {
            blockReason = `Saldo individual insuficiente para lote mínimo de $${bank.minLotUsd} USD`;
          }
        }
      } else if (hasCapital) {
        const budget =
          input.allocationMode === 'DISTRIBUTE_TOTAL' ? remainingPoolVes : input.capitalVes!;
        lot = computeLot(budget, bcvRate, bank, effectiveBankFeePct);
        if (lot.orderUsd >= bank.minLotUsd && input.allocationMode === 'DISTRIBUTE_TOTAL') {
          remainingPoolVes = roundMoney(Math.max(0, remainingPoolVes - lot.totalDebitVes), 2);
        } else if (lot.orderUsd < bank.minLotUsd) {
          blockReason = `Capital insuficiente para lote mínimo de $${bank.minLotUsd} USD`;
        }
      }

      const estimatedIgtfUsd =
        lot.orderUsd > 0 ? roundMoney(lot.orderUsd * (igtfPct / 100), 2) : 0;
      const estimatedRailFeeUsd =
        lot.orderUsd > 0 ? roundMoney(lot.orderUsd * (exitRailFrictionPct / 100), 2) : 0;
      const netUsdtAfterExitRail =
        lot.orderUsd > 0
          ? roundMoney(Math.max(0, lot.orderUsd - estimatedIgtfUsd - estimatedRailFeeUsd), 2)
          : 0;
      const projectedP2pReturnVes =
        netUsdtAfterExitRail > 0
          ? roundMoney(netUsdtAfterExitRail * p2pRate * (1 - p2pExitFeePct / 100), 2)
          : null;
      const projectedNetProfitVes =
        projectedP2pReturnVes !== null && lot.totalDebitVes > 0
          ? roundMoney(projectedP2pReturnVes - lot.totalDebitVes, 2)
          : null;
      const projectedNetRoiPct =
        projectedNetProfitVes !== null && lot.totalDebitVes > 0
          ? roundMoney((projectedNetProfitVes / lot.totalDebitVes) * 100, 2)
          : null;

      const isViableOrder =
        blockReason === null &&
        lot.orderUsd >= bank.minLotUsd &&
        projectedNetProfitVes !== null &&
        projectedNetProfitVes > 0;

      if (isViableOrder && projectedNetProfitVes !== null) {
        totalDeployableVes = roundMoney(totalDeployableVes + lot.totalDebitVes, 2);
        totalRecommendedUsd = roundMoney(totalRecommendedUsd + lot.orderUsd, 2);
        totalNetUsdt = roundMoney(totalNetUsdt + netUsdtAfterExitRail, 2);
        totalProjectedNetProfitVes = roundMoney(
          totalProjectedNetProfitVes + projectedNetProfitVes,
          2,
        );
      }

      return {
        bankId: bank.id,
        shortName: bank.shortName,
        abaCode: bank.abaCode,
        modality,
        recommendedOrderUsd: lot.orderUsd,
        effectiveBankFeePct,
        estimatedBankFeeVes: lot.bankFeeVes,
        estimatedVesDebit: lot.totalDebitVes,
        reservedSafetyBufferVes: lot.safetyBufferVes,
        igtfPct,
        exitRail,
        exitRailFrictionPct,
        netUsdtAfterExitRail,
        projectedP2pReturnVes,
        projectedNetProfitVes,
        projectedNetRoiPct,
        isViableOrder,
        blockReason: isViableOrder
          ? null
          : blockReason ?? (fluidSet.has(bank.id) ? null : 'Retorno neto negativo tras fricción e IGTF'),
        accountAllocations,
      };
    });

    const grossGapVes = roundMoney(p2pRate - bcvRate, 2);
    const grossGapPct = roundMoney(((p2pRate - bcvRate) / bcvRate) * 100, 2);
    const averageNetRoiPct =
      totalDeployableVes > 0
        ? roundMoney((totalProjectedNetProfitVes / totalDeployableVes) * 100, 2)
        : null;

    return {
      actionable: totalRecommendedUsd > 0,
      verdict: totalRecommendedUsd > 0 ? ('VIABLE_PLAN' as const) : ('NO_VIABLE_TICKETS' as const),
      unavailableReason: null,
      unmeasuredInputs: [] as string[],
      window,
      summary: {
        bcvOfficialRateVes: bcvRate,
        p2pSellRateVes: p2pRate,
        grossGapVes,
        grossGapPct,
        totalDeployableVes,
        totalRecommendedUsd,
        totalNetUsdt,
        totalProjectedNetProfitVes,
        averageNetRoiPct,
      },
      tickets,
    };
  },
};
