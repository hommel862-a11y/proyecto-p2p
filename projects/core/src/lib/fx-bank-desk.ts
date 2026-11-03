/**
 * Pure Domain Engine for Venezuelan Banking FX Intervention & Retail Exchange Desk (Mesa de Cambio / Menudeo BCV).
 *
 * Models 14 public and private Venezuelan banking institutions, computes anti-rejection purchase order lots
 * (accounting for banking commission, intraday FX rate buffer, minimum lot size, and step multiples),
 * evaluates SUDEBAN account velocity and daily/monthly headroom, and calculates net arbitrage returns
 * across the three settlement exit rails into USDT.
 *
 * Invariants:
 * - Pure TypeScript, zero external dependencies, no Angular, no DOM, no network.
 * - Never invents rates: when BCV or P2P rates are missing or non-positive, returns `actionable: false`
 *   with an explicit `unavailableReason` and `null` rate-dependent metrics.
 */

import { roundMoney } from './money';
import type { BankAccount, AccountUsage, BankCode } from './accounts';
import type { AccountVelocityStatus } from './account-velocity';

export type FxInterventionBankId =
  | 'BDV'
  | 'BANESCO'
  | 'BANCAMIGA'
  | 'MERCANTIL'
  | 'PROVINCIAL'
  | 'BNC'
  | 'BANCARIBE'
  | 'BANPLUS'
  | 'BICENTENARIO'
  | 'TESORO'
  | 'EXTERIOR'
  | 'PLAZA'
  | 'BFC'
  | 'CIEN_BANCO';

export type BankOwnershipSector = 'ESTADO' | 'PRIVADO';

export type BankInterventionTier = 'TIER_1_LIDER' | 'TIER_2_COMERCIAL' | 'TIER_3_NICHO';

export type FxExitRailType =
  | 'INTL_DEBIT_CARD'
  | 'INTERNAL_USD_P2P'
  | 'CASH_WITHDRAWAL_OTC';

export interface FxExitRailOption {
  readonly id: FxExitRailType;
  readonly label: string;
  readonly shortLabel: string;
  readonly defaultFrictionPct: number;
}

export const FX_EXIT_RAIL_OPTIONS: readonly FxExitRailOption[] = [
  {
    id: 'INTL_DEBIT_CARD',
    label: 'Tarjeta Mastercard/Visa Débito Internacional ➔ USDT',
    shortLabel: '💳 Tarjeta Intl (1.5%)',
    defaultFrictionPct: 1.5,
  },
  {
    id: 'INTERNAL_USD_P2P',
    label: 'Cuenta Verde / Transferencia Divisas ➔ P2P Interno',
    shortLabel: '🔄 P2P Divisas (1.2%)',
    defaultFrictionPct: 1.2,
  },
  {
    id: 'CASH_WITHDRAWAL_OTC',
    label: 'Retiro Taquilla Efectivo USD ➔ OTC P2P',
    shortLabel: '💵 Efectivo OTC (1.8%)',
    defaultFrictionPct: 1.8,
  },
];

export type BankLiquiditySignalState =
  | 'CONFIRMED_FLUID'
  | 'WINDOW_OPEN'
  | 'COOLDOWN_DEPLETED'
  | 'STANDBY';

export interface FxBankDeskProfile {
  readonly id: FxInterventionBankId;
  readonly coreBankCode: BankCode;
  readonly abaCode: string;
  readonly name: string;
  readonly shortName: string;
  readonly sector: BankOwnershipSector;
  readonly tier: BankInterventionTier;
  readonly portalUrl: string;
  readonly mechanismLabel: string;
  readonly typicalWindowLabel: string;
  /** Exchange desk / retail FX commission percentage (e.g. 0.25 means 0.25%). */
  readonly bankFxFeePct: number;
  /** Intraday safety buffer percentage reserved to avoid insufficient-funds rejection (e.g. 0.50%). */
  readonly rateSafetyBufferPct: number;
  /** Minimum USD amount accepted by the bank portal per ticket. */
  readonly minLotUsd: number;
  /** Required USD step multiple to avoid backend validation rejection (e.g. 1, 5, 10, 20). */
  readonly lotStepUsd: number;
  /** Maximum retail ticket size per operation in USD. */
  readonly maxTicketUsd: number;
  /** Recommended anti-WAF retry interval in seconds when portal is congested. */
  readonly antiWafCooldownSec: number;
  /** Primary recommended settlement rail to convert bank USD into USDT. */
  readonly primaryExitRail: FxExitRailType;
  readonly primaryExitRailLabel: string;
  /** Friction percentage when converting bank USD to USDT via the primary exit rail (e.g. 1.50%). */
  readonly exitRailFrictionPct: number;
  readonly antiBlockTips: readonly string[];
}

export const VENEZUELAN_FX_BANKS: readonly FxBankDeskProfile[] = [
  {
    id: 'BDV',
    coreBankCode: 'BDV',
    abaCode: '0102',
    name: 'Banco de Venezuela (BDV)',
    shortName: 'BDV',
    sector: 'ESTADO',
    tier: 'TIER_1_LIDER',
    portalUrl: 'https://bdvenlinea.banvenez.com/',
    mechanismLabel: 'BDVEnLínea · Divisas / Menudeo & Intervención',
    typicalWindowLabel: 'Lun a Vie · 08:30 a 12:30 VET',
    bankFxFeePct: 0.25,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 10,
    lotStepUsd: 5,
    maxTicketUsd: 1000,
    antiWafCooldownSec: 15,
    primaryExitRail: 'INTERNAL_USD_P2P',
    primaryExitRailLabel: 'Tarjeta Digital / Retiro / P2P Divisas',
    exitRailFrictionPct: 1.2,
    antiBlockTips: [
      'Solicitar montos cerrados en múltiplos de $5 o $10 sin centavos.',
      'Mantener al menos +0.75% de saldo libre en Bs sobre el monto calculado.',
      'No abrir BDVEnLínea en navegador y app móvil simultáneamente.',
    ],
  },
  {
    id: 'BANCAMIGA',
    coreBankCode: 'BANCAMIGA',
    abaCode: '0172',
    name: 'Bancamiga Banco Universal',
    shortName: 'Bancamiga',
    sector: 'PRIVADO',
    tier: 'TIER_1_LIDER',
    portalUrl: 'https://www.bancamiga.com/',
    mechanismLabel: 'Bancamiga en Línea · Mesa de Cambio & Apoyo',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 13:00 VET',
    bankFxFeePct: 0.5,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 20,
    lotStepUsd: 10,
    maxTicketUsd: 2000,
    antiWafCooldownSec: 12,
    primaryExitRail: 'INTL_DEBIT_CARD',
    primaryExitRailLabel: 'Tarjeta Mastercard Débito Internacional ➔ USDT',
    exitRailFrictionPct: 1.5,
    antiBlockTips: [
      'Activar candado virtual de la tarjeta solo al momento de fondear el exchange.',
      'Pedir lotes cerrados en múltiplos de $10 USD en Apoyo/Menudeo.',
    ],
  },
  {
    id: 'BANESCO',
    coreBankCode: 'BANESCO',
    abaCode: '0134',
    name: 'Banesco Banco Universal',
    shortName: 'Banesco',
    sector: 'PRIVADO',
    tier: 'TIER_1_LIDER',
    portalUrl: 'https://www.banesconline.com/mantis/WebSite/login.aspx',
    mechanismLabel: 'BanescOnline · Cuenta Verde (Menudeo / Mesa)',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 13:30 VET',
    bankFxFeePct: 0.25,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 20,
    lotStepUsd: 10,
    maxTicketUsd: 1500,
    antiWafCooldownSec: 15,
    primaryExitRail: 'INTERNAL_USD_P2P',
    primaryExitRailLabel: 'Cuenta Verde / Retiro Taquilla ➔ OTC P2P',
    exitRailFrictionPct: 1.5,
    antiBlockTips: [
      'Asegurar que el saldo en Bs provenga de fondos reposados (evitar cadena de pagos móviles previos).',
      'Respetar cadencia de 15s entre intentos si la mesa reporta alta demanda.',
    ],
  },
  {
    id: 'MERCANTIL',
    coreBankCode: 'MERCANTIL',
    abaCode: '0105',
    name: 'Mercantil Banco Universal',
    shortName: 'Mercantil',
    sector: 'PRIVADO',
    tier: 'TIER_1_LIDER',
    portalUrl: 'https://www30.mercantilbanco.com/',
    mechanismLabel: 'Mercantil en Línea · Operaciones Moneda Extranjera',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 12:45 VET',
    bankFxFeePct: 0.25,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 20,
    lotStepUsd: 10,
    maxTicketUsd: 1500,
    antiWafCooldownSec: 14,
    primaryExitRail: 'INTL_DEBIT_CARD',
    primaryExitRailLabel: 'Tarjeta Débito Mony / Divisas ➔ P2P',
    exitRailFrictionPct: 1.4,
    antiBlockTips: [
      'Verificar afiliación previa de cuenta en moneda extranjera antes de las 09:00 AM.',
      'Usar múltiplos de $10 USD para máxima tasa de cruce en menudeo.',
    ],
  },
  {
    id: 'PROVINCIAL',
    coreBankCode: 'PROVINCIAL',
    abaCode: '0108',
    name: 'BBVA Provincial',
    shortName: 'Provincial',
    sector: 'PRIVADO',
    tier: 'TIER_2_COMERCIAL',
    portalUrl: 'https://www.provincial.com/',
    mechanismLabel: 'Provinet Web / App · Compra de Divisas',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 13:00 VET',
    bankFxFeePct: 0.25,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 20,
    lotStepUsd: 10,
    maxTicketUsd: 1200,
    antiWafCooldownSec: 15,
    primaryExitRail: 'CASH_WITHDRAWAL_OTC',
    primaryExitRailLabel: 'Transferencia Divisas / Retiro ➔ USDT',
    exitRailFrictionPct: 1.8,
    antiBlockTips: [
      'Tener generador de token digital sincronizado en la app Provinet.',
    ],
  },
  {
    id: 'BNC',
    coreBankCode: 'BNC',
    abaCode: '0191',
    name: 'Banco Nacional de Crédito (BNC)',
    shortName: 'BNC',
    sector: 'PRIVADO',
    tier: 'TIER_2_COMERCIAL',
    portalUrl: 'https://www.bncenlinea.com/',
    mechanismLabel: 'BNCNET · Mesa de Cambio & Menudeo',
    typicalWindowLabel: 'Lun a Vie · 08:45 a 13:00 VET',
    bankFxFeePct: 0.3,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 25,
    lotStepUsd: 5,
    maxTicketUsd: 2000,
    antiWafCooldownSec: 12,
    primaryExitRail: 'INTL_DEBIT_CARD',
    primaryExitRailLabel: 'Tarjeta BNC MasterCard Internacional ➔ USDT',
    exitRailFrictionPct: 1.5,
    antiBlockTips: [
      'BNC presenta excelente fluidez los lunes y jueves tras inyección BCV.',
    ],
  },
  {
    id: 'BANCARIBE',
    coreBankCode: 'BANCARIBE',
    abaCode: '0114',
    name: 'Bancaribe',
    shortName: 'Bancaribe',
    sector: 'PRIVADO',
    tier: 'TIER_2_COMERCIAL',
    portalUrl: 'https://www.bancaribe.com.ve/',
    mechanismLabel: 'Mi Conexión Bancaribe · Divisas',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 12:30 VET',
    bankFxFeePct: 0.35,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 20,
    lotStepUsd: 10,
    maxTicketUsd: 1000,
    antiWafCooldownSec: 15,
    primaryExitRail: 'INTL_DEBIT_CARD',
    primaryExitRailLabel: 'Tarjeta Débito Internacional ➔ P2P',
    exitRailFrictionPct: 1.6,
    antiBlockTips: [
      'Operar preferiblemente antes de las 11:00 AM VET.',
    ],
  },
  {
    id: 'BANPLUS',
    coreBankCode: 'BANPLUS',
    abaCode: '0174',
    name: 'Banplus Banco Universal',
    shortName: 'Banplus',
    sector: 'PRIVADO',
    tier: 'TIER_2_COMERCIAL',
    portalUrl: 'https://www.banplus.com/',
    mechanismLabel: 'Banplus On Line · Divisas Plus',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 13:00 VET',
    bankFxFeePct: 0.3,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 50,
    lotStepUsd: 10,
    maxTicketUsd: 2500,
    antiWafCooldownSec: 14,
    primaryExitRail: 'INTERNAL_USD_P2P',
    primaryExitRailLabel: 'Transferencia Divisas Plus / OTC',
    exitRailFrictionPct: 1.5,
    antiBlockTips: [
      'Excelente tasa de aprobación para tickets medios ($100 a $500 USD).',
    ],
  },
  {
    id: 'BICENTENARIO',
    coreBankCode: 'OTRO',
    abaCode: '0175',
    name: 'Banco Digital de los Trabajadores (Bicentenario)',
    shortName: 'Bicentenario',
    sector: 'ESTADO',
    tier: 'TIER_2_COMERCIAL',
    portalUrl: 'https://www.bdt.com.ve/',
    mechanismLabel: 'BDT en Línea · Compra de Divisas',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 12:00 VET',
    bankFxFeePct: 0.25,
    rateSafetyBufferPct: 0.6,
    minLotUsd: 10,
    lotStepUsd: 5,
    maxTicketUsd: 800,
    antiWafCooldownSec: 18,
    primaryExitRail: 'INTL_DEBIT_CARD',
    primaryExitRailLabel: 'Tarjeta Débito / Retiro ➔ P2P',
    exitRailFrictionPct: 1.8,
    antiBlockTips: [
      'Solicitar montos pequeños/medianos ($20 - $200 USD) en horas de la mañana.',
    ],
  },
  {
    id: 'TESORO',
    coreBankCode: 'OTRO',
    abaCode: '0163',
    name: 'Banco del Tesoro',
    shortName: 'Tesoro',
    sector: 'ESTADO',
    tier: 'TIER_3_NICHO',
    portalUrl: 'https://www.bt.com.ve/',
    mechanismLabel: 'Tesoro en Línea · Mesa de Cambio',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 12:00 VET',
    bankFxFeePct: 0.25,
    rateSafetyBufferPct: 0.6,
    minLotUsd: 10,
    lotStepUsd: 5,
    maxTicketUsd: 800,
    antiWafCooldownSec: 18,
    primaryExitRail: 'INTL_DEBIT_CARD',
    primaryExitRailLabel: 'Tarjeta Débito Plus Divisas ➔ P2P',
    exitRailFrictionPct: 1.8,
    antiBlockTips: [
      'Usar sesión web de escritorio para evitar timeouts en hora pico.',
    ],
  },
  {
    id: 'EXTERIOR',
    coreBankCode: 'OTRO',
    abaCode: '0115',
    name: 'Banco Exterior',
    shortName: 'Exterior',
    sector: 'PRIVADO',
    tier: 'TIER_3_NICHO',
    portalUrl: 'https://www.bancoexterior.com/',
    mechanismLabel: 'Exterior NEXO · Operaciones Cambiarias',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 12:30 VET',
    bankFxFeePct: 0.35,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 25,
    lotStepUsd: 5,
    maxTicketUsd: 1500,
    antiWafCooldownSec: 15,
    primaryExitRail: 'INTL_DEBIT_CARD',
    primaryExitRailLabel: 'Tarjeta Internacional Exterior ➔ USDT',
    exitRailFrictionPct: 1.6,
    antiBlockTips: [
      'Pactar temprano en los días de intervención cambiaria (lunes y jueves).',
    ],
  },
  {
    id: 'PLAZA',
    coreBankCode: 'OTRO',
    abaCode: '0138',
    name: 'Banco Plaza',
    shortName: 'Plaza',
    sector: 'PRIVADO',
    tier: 'TIER_3_NICHO',
    portalUrl: 'https://www.bancoplaza.com/',
    mechanismLabel: 'Tu Plaza en Línea · Divisas',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 13:00 VET',
    bankFxFeePct: 0.35,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 30,
    lotStepUsd: 10,
    maxTicketUsd: 1500,
    antiWafCooldownSec: 15,
    primaryExitRail: 'CASH_WITHDRAWAL_OTC',
    primaryExitRailLabel: 'Custodia / Retiro Divisas ➔ OTC',
    exitRailFrictionPct: 1.8,
    antiBlockTips: [
      'Ideal para diversificar volumen cuando las cuentas Tier 1 alcanzan el 75% de uso.',
    ],
  },
  {
    id: 'BFC',
    coreBankCode: 'OTRO',
    abaCode: '0151',
    name: 'BFC Banco Fondo Común',
    shortName: 'BFC',
    sector: 'PRIVADO',
    tier: 'TIER_3_NICHO',
    portalUrl: 'https://www.bfc.com.ve/',
    mechanismLabel: 'BFC en Línea · Compra Moneda Extranjera',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 12:30 VET',
    bankFxFeePct: 0.35,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 20,
    lotStepUsd: 10,
    maxTicketUsd: 1000,
    antiWafCooldownSec: 15,
    primaryExitRail: 'INTL_DEBIT_CARD',
    primaryExitRailLabel: 'Tarjeta Internacional BFC ➔ P2P',
    exitRailFrictionPct: 1.7,
    antiBlockTips: [
      'Colocar órdenes sin decimales en la ventana matutina.',
    ],
  },
  {
    id: 'CIEN_BANCO',
    coreBankCode: 'OTRO',
    abaCode: '0156',
    name: '100% Banco',
    shortName: '100% Banco',
    sector: 'PRIVADO',
    tier: 'TIER_3_NICHO',
    portalUrl: 'https://www.100x100banco.com/',
    mechanismLabel: '100% Internet · Mesa de Cambio',
    typicalWindowLabel: 'Lun a Vie · 09:00 a 12:30 VET',
    bankFxFeePct: 0.4,
    rateSafetyBufferPct: 0.5,
    minLotUsd: 20,
    lotStepUsd: 10,
    maxTicketUsd: 1000,
    antiWafCooldownSec: 15,
    primaryExitRail: 'CASH_WITHDRAWAL_OTC',
    primaryExitRailLabel: 'Retiro / Transferencia Divisas ➔ P2P',
    exitRailFrictionPct: 1.9,
    antiBlockTips: [
      'Verificar disponibilidad en el primer corte de las 09:15 AM VET.',
    ],
  },
];

export interface FxBankOrderTicket {
  readonly bank: FxBankDeskProfile;
  readonly linkedAccountId: string | null;
  readonly linkedAccountName: string | null;
  readonly availableBalanceVes: number;
  readonly remainingDailyLimitVes: number;
  readonly consumedDailyLimitPct: number;
  readonly todayTxCount: number;
  readonly maxDailyTxCount: number;
  readonly sudebanHealth: 'OPTIMAL' | 'WARNING' | 'BLOCKED_LIMIT';
  readonly signalState: BankLiquiditySignalState;
  /** Exact rounded USD amount recommended to request in the bank portal so it does not reject. */
  readonly recommendedOrderUsd: number;
  /** Estimated VES debited by the bank (principal + bankFxFeePct). */
  readonly estimatedVesDebit: number;
  /** Estimated bank commission in VES. */
  readonly estimatedBankFeeVes: number;
  /** VES buffer kept untouched in account to prevent intraday rate-shift bounce. */
  readonly reservedSafetyBufferVes: number;
  /** Equivalent net USDT received after primary exit rail friction. */
  readonly netUsdtAfterExitRail: number;
  readonly activeExitRail: FxExitRailType;
  readonly activeExitRailLabel: string;
  readonly activeExitRailFrictionPct: number;
  /** Projected VES returned when selling the net USDT on P2P at `p2pSellRateVes`. */
  readonly projectedP2pReturnVes: number | null;
  /** Projected net profit in VES after all banking and exit rail frictions. */
  readonly projectedNetProfitVes: number | null;
  /** Projected net ROI percentage on this ticket. */
  readonly projectedNetRoiPct: number | null;
  readonly isViableOrder: boolean;
  readonly blockReason: string | null;
}

export interface FxDeskEvaluationInput {
  readonly bcvOfficialRateVes: number | null;
  readonly p2pSellRateVes: number | null;
  /** Optional simulated VES capital per bank when no account is linked or when simulating a custom injection. */
  readonly simulatedCapitalVes?: number;
  readonly accounts?: readonly BankAccount[];
  readonly usages?: readonly AccountUsage[];
  readonly velocities?: readonly AccountVelocityStatus[];
  /** Banks manually reported as fluid in the current session. */
  readonly confirmedFluidBanks?: readonly FxInterventionBankId[];
  /** Banks manually marked as depleted/no-quota in the last 30 minutes. */
  readonly depletedBanks?: readonly FxInterventionBankId[];
  readonly isBcvWindowOpen?: boolean;
  /** P2P maker/taker fee percentage on the final USDT->VES leg (default 0.25%). */
  readonly p2pExitFeePct?: number;
  /** Optional per-bank exit rail overrides chosen by the operator. */
  readonly exitRailOverrides?: Partial<Record<FxInterventionBankId, FxExitRailType>>;
}

export interface FxDeskEvaluationPlan {
  readonly actionable: boolean;
  readonly unavailableReason: string | null;
  readonly bcvOfficialRateVes: number | null;
  readonly p2pSellRateVes: number | null;
  readonly grossGapVes: number | null;
  readonly grossGapPct: number | null;
  readonly totalDeployableVes: number;
  readonly totalRecommendedUsd: number;
  readonly totalNetUsdt: number;
  readonly totalProjectedReturnVes: number | null;
  readonly totalProjectedNetProfitVes: number | null;
  readonly averageNetRoiPct: number | null;
  readonly tickets: readonly FxBankOrderTicket[];
  readonly timestamp: string;
}

/**
 * Matches a bank profile against user accounts by `bankCode`, ABA prefix, or name substring (for OTRO banks).
 * Never matches on `bankCode === 'OTRO'` alone to avoid cross-bank collisions among extended banks.
 */
export function matchAccountsForFxBank(
  profile: FxBankDeskProfile,
  accounts: readonly BankAccount[],
): BankAccount[] {
  const active = accounts.filter((a) => a.status !== 'DISABLED');
  const keyword = profile.shortName.toLowerCase();
  if (profile.coreBankCode !== 'OTRO') {
    return active.filter(
      (a) =>
        a.bankCode === profile.coreBankCode ||
        a.accountNumberMasked?.startsWith(profile.abaCode) ||
        a.bankName.toLowerCase().includes(keyword),
    );
  }
  return active.filter(
    (a) =>
      a.accountNumberMasked?.startsWith(profile.abaCode) ||
      a.bankName.toLowerCase().includes(keyword) ||
      a.id.toLowerCase().includes(profile.id.toLowerCase()),
  );
}

/**
 * Computes the exact anti-rejection USD order size for a given VES budget and bank rule profile.
 */
export function computeAntiRejectionUsdLot(
  deployableVes: number,
  bcvRateVes: number,
  profile: FxBankDeskProfile,
): {
  orderUsd: number;
  principalVes: number;
  bankFeeVes: number;
  totalDebitVes: number;
  safetyBufferVes: number;
} {
  if (!Number.isFinite(deployableVes) || deployableVes <= 0 || !Number.isFinite(bcvRateVes) || bcvRateVes <= 0) {
    return { orderUsd: 0, principalVes: 0, bankFeeVes: 0, totalDebitVes: 0, safetyBufferVes: 0 };
  }

  const totalMultiplier = 1 + (profile.bankFxFeePct + profile.rateSafetyBufferPct) / 100;
  const effectiveVesPerUsd = bcvRateVes * totalMultiplier;
  const rawMaxUsd = deployableVes / effectiveVesPerUsd;
  const cappedUsd = Math.min(rawMaxUsd, profile.maxTicketUsd);

  if (cappedUsd < profile.minLotUsd) {
    return { orderUsd: 0, principalVes: 0, bankFeeVes: 0, totalDebitVes: 0, safetyBufferVes: 0 };
  }

  const step = Math.max(1, profile.lotStepUsd);
  const steppedUsd = Math.floor(cappedUsd / step) * step;

  if (steppedUsd < profile.minLotUsd) {
    return { orderUsd: 0, principalVes: 0, bankFeeVes: 0, totalDebitVes: 0, safetyBufferVes: 0 };
  }

  const principalVes = roundMoney(steppedUsd * bcvRateVes, 2);
  const bankFeeVes = roundMoney(principalVes * (profile.bankFxFeePct / 100), 2);
  const totalDebitVes = roundMoney(principalVes + bankFeeVes, 2);
  const safetyBufferVes = roundMoney(Math.max(0, deployableVes - totalDebitVes), 2);

  return {
    orderUsd: steppedUsd,
    principalVes,
    bankFeeVes,
    totalDebitVes,
    safetyBufferVes,
  };
}

/**
 * Evaluates all 14 Venezuelan banks and produces a complete, anti-rejection FX purchase plan.
 * Fails closed when `bcvOfficialRateVes` or `p2pSellRateVes` is missing/invalid.
 */
export function evaluateFxBankDeskPlan(input: FxDeskEvaluationInput): FxDeskEvaluationPlan {
  const nowIso = new Date().toISOString();
  const hasBcv =
    typeof input.bcvOfficialRateVes === 'number' &&
    Number.isFinite(input.bcvOfficialRateVes) &&
    input.bcvOfficialRateVes > 0;
  const hasP2p =
    typeof input.p2pSellRateVes === 'number' &&
    Number.isFinite(input.p2pSellRateVes) &&
    input.p2pSellRateVes > 0;

  const bcvRate = hasBcv ? roundMoney(input.bcvOfficialRateVes!, 2) : null;
  const p2pRate = hasP2p ? roundMoney(input.p2pSellRateVes!, 2) : null;

  let unavailableReason: string | null = null;
  if (!hasBcv && !hasP2p) {
    unavailableReason = 'Faltan la tasa oficial BCV y la tasa P2P de liquidación.';
  } else if (!hasBcv) {
    unavailableReason = 'Falta la tasa oficial BCV en vivo.';
  } else if (!hasP2p) {
    unavailableReason = 'Falta la tasa P2P de liquidación en vivo.';
  }

  const grossGapVes = bcvRate !== null && p2pRate !== null ? roundMoney(p2pRate - bcvRate, 2) : null;
  const grossGapPct =
    bcvRate !== null && p2pRate !== null && bcvRate > 0
      ? roundMoney(((p2pRate - bcvRate) / bcvRate) * 100, 2)
      : null;

  const accounts = input.accounts ?? [];
  const usages = input.usages ?? [];
  const velocities = input.velocities ?? [];
  const usageMap = new Map<string, AccountUsage>(usages.map((u) => [u.account.id, u]));
  const velocityMap = new Map<string, AccountVelocityStatus>(velocities.map((v) => [v.accountId, v]));
  const fluidSet = new Set<FxInterventionBankId>(input.confirmedFluidBanks ?? []);
  const depletedSet = new Set<FxInterventionBankId>(input.depletedBanks ?? []);
  const p2pExitFeePct = input.p2pExitFeePct ?? 0.25;
  const simulatedCap =
    typeof input.simulatedCapitalVes === 'number' && input.simulatedCapitalVes > 0
      ? input.simulatedCapitalVes
      : 0;

  let totalDeployableVes = 0;
  let totalRecommendedUsd = 0;
  let totalNetUsdt = 0;
  let totalProjectedReturnVes = 0;
  let totalProjectedNetProfitVes = 0;

  const tickets: FxBankOrderTicket[] = VENEZUELAN_FX_BANKS.map((bank) => {
    const matched = matchAccountsForFxBank(bank, accounts);
    // Prefer TRANSFERENCIA account for FX desk, or highest available balance
    const matchedUsages = matched
      .map((a) => usageMap.get(a.id))
      .filter((u): u is AccountUsage => u !== undefined)
      .sort((a, b) => b.currentBalanceVes - a.currentBalanceVes);

    const primaryUsage = matchedUsages[0];
    const primaryAcc = primaryUsage?.account ?? matched[0] ?? null;
    const velocity = primaryAcc ? velocityMap.get(primaryAcc.id) : undefined;

    const realBalanceVes = matchedUsages.reduce((s, u) => s + Math.max(0, u.currentBalanceVes), 0);
    const availableBalanceVes = roundMoney(
      realBalanceVes > 0 ? realBalanceVes : simulatedCap,
      2,
    );

    const remainingDailyLimitVes = primaryUsage
      ? primaryUsage.account.dailyLimitVes > 0
        ? primaryUsage.remainingLimitVes
        : availableBalanceVes
      : availableBalanceVes;

    const consumedDailyLimitPct = primaryUsage ? primaryUsage.consumedLimitPct : 0;
    const todayTxCount = velocity?.todayTransactionCount ?? 0;
    const maxDailyTxCount = velocity?.maxDailyTransactions ?? primaryAcc?.maxDailyTransactions ?? 15;

    let sudebanHealth: 'OPTIMAL' | 'WARNING' | 'BLOCKED_LIMIT' = 'OPTIMAL';
    if (
      (primaryUsage && primaryUsage.isOverLimit) ||
      (primaryUsage && primaryUsage.isOverMonthlyLimit) ||
      velocity?.velocityHealth === 'SATURATED'
    ) {
      sudebanHealth = 'BLOCKED_LIMIT';
    } else if (
      (primaryUsage && primaryUsage.isNearLimit) ||
      (primaryUsage && primaryUsage.isNearMonthlyLimit) ||
      velocity?.velocityHealth === 'MODERATE' ||
      velocity?.velocityHealth === 'REST_RECOMMENDED'
    ) {
      sudebanHealth = 'WARNING';
    }

    let signalState: BankLiquiditySignalState = 'STANDBY';
    if (depletedSet.has(bank.id)) {
      signalState = 'COOLDOWN_DEPLETED';
    } else if (fluidSet.has(bank.id)) {
      signalState = 'CONFIRMED_FLUID';
    } else if (input.isBcvWindowOpen) {
      signalState = 'WINDOW_OPEN';
    }

    const deployableForBank =
      sudebanHealth === 'BLOCKED_LIMIT' || signalState === 'COOLDOWN_DEPLETED'
        ? 0
        : Math.min(availableBalanceVes, remainingDailyLimitVes > 0 ? remainingDailyLimitVes : availableBalanceVes);

    const lot =
      bcvRate !== null && deployableForBank > 0
        ? computeAntiRejectionUsdLot(deployableForBank, bcvRate, bank)
        : { orderUsd: 0, principalVes: 0, bankFeeVes: 0, totalDebitVes: 0, safetyBufferVes: 0 };

    const overrideRailId = input.exitRailOverrides?.[bank.id];
    const overrideRail = overrideRailId
      ? FX_EXIT_RAIL_OPTIONS.find((r) => r.id === overrideRailId)
      : undefined;
    const activeExitRail = overrideRail ? overrideRail.id : bank.primaryExitRail;
    const activeExitRailLabel = overrideRail ? overrideRail.label : bank.primaryExitRailLabel;
    const activeExitRailFrictionPct = overrideRail
      ? overrideRail.defaultFrictionPct
      : bank.exitRailFrictionPct;

    const netUsdtAfterExitRail =
      lot.orderUsd > 0
        ? roundMoney(lot.orderUsd * (1 - activeExitRailFrictionPct / 100), 2)
        : 0;

    const projectedP2pReturnVes =
      p2pRate !== null && netUsdtAfterExitRail > 0
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

    let blockReason: string | null = null;
    if (bcvRate === null) {
      blockReason = 'Sin tasa BCV en vivo';
    } else if (signalState === 'COOLDOWN_DEPLETED') {
      blockReason = 'Marcado sin cupo recientemente (en enfriamiento)';
    } else if (sudebanHealth === 'BLOCKED_LIMIT') {
      blockReason = 'Límite diario/mensual o velocidad SUDEBAN al tope';
    } else if (availableBalanceVes <= 0) {
      blockReason = 'Sin saldo VES asignado';
    } else if (lot.orderUsd < bank.minLotUsd) {
      blockReason = `Saldo insuficiente para lote mínimo de $${bank.minLotUsd} USD`;
    }

    const isViableOrder =
      blockReason === null &&
      lot.orderUsd >= bank.minLotUsd &&
      (projectedNetProfitVes === null || projectedNetProfitVes > 0);

    if (isViableOrder) {
      totalDeployableVes = roundMoney(totalDeployableVes + lot.totalDebitVes, 2);
      totalRecommendedUsd = roundMoney(totalRecommendedUsd + lot.orderUsd, 2);
      totalNetUsdt = roundMoney(totalNetUsdt + netUsdtAfterExitRail, 2);
      if (projectedP2pReturnVes !== null && projectedNetProfitVes !== null) {
        totalProjectedReturnVes = roundMoney(totalProjectedReturnVes + projectedP2pReturnVes, 2);
        totalProjectedNetProfitVes = roundMoney(totalProjectedNetProfitVes + projectedNetProfitVes, 2);
      }
    }

    return {
      bank,
      linkedAccountId: primaryAcc?.id ?? null,
      linkedAccountName: primaryAcc?.bankName ?? null,
      availableBalanceVes,
      remainingDailyLimitVes: roundMoney(remainingDailyLimitVes, 2),
      consumedDailyLimitPct: roundMoney(consumedDailyLimitPct, 1),
      todayTxCount,
      maxDailyTxCount,
      sudebanHealth,
      signalState,
      recommendedOrderUsd: lot.orderUsd,
      estimatedVesDebit: lot.totalDebitVes,
      estimatedBankFeeVes: lot.bankFeeVes,
      reservedSafetyBufferVes: lot.safetyBufferVes,
      netUsdtAfterExitRail,
      activeExitRail,
      activeExitRailLabel,
      activeExitRailFrictionPct,
      projectedP2pReturnVes,
      projectedNetProfitVes,
      projectedNetRoiPct,
      isViableOrder,
      blockReason,
    };
  });

  const averageNetRoiPct =
    bcvRate !== null && p2pRate !== null && totalDeployableVes > 0
      ? roundMoney((totalProjectedNetProfitVes / totalDeployableVes) * 100, 2)
      : null;

  return {
    actionable: bcvRate !== null && p2pRate !== null && totalRecommendedUsd > 0,
    unavailableReason,
    bcvOfficialRateVes: bcvRate,
    p2pSellRateVes: p2pRate,
    grossGapVes,
    grossGapPct,
    totalDeployableVes,
    totalRecommendedUsd,
    totalNetUsdt,
    totalProjectedReturnVes: bcvRate !== null && p2pRate !== null ? totalProjectedReturnVes : null,
    totalProjectedNetProfitVes: bcvRate !== null && p2pRate !== null ? totalProjectedNetProfitVes : null,
    averageNetRoiPct,
    tickets,
    timestamp: nowIso,
  };
}

/**
 * Resolves a user-provided bank string (e.g. "bdv", "bancamiga", "0102") to an FxInterventionBankId.
 */
export function resolveFxInterventionBankId(raw?: string | null): FxInterventionBankId | null {
  if (!raw) return null;
  const clean = raw.trim().toUpperCase();
  for (const bank of VENEZUELAN_FX_BANKS) {
    if (
      bank.id === clean ||
      bank.abaCode === clean ||
      bank.shortName.toUpperCase() === clean ||
      bank.name.toUpperCase().includes(clean)
    ) {
      return bank.id;
    }
  }
  if (clean.includes('VENEZUELA')) return 'BDV';
  if (clean.includes('100')) return 'CIEN_BANCO';
  if (clean.includes('FONDO') || clean.includes('COMUN')) return 'BFC';
  if (clean.includes('TRABAJADORES') || clean.includes('BDT')) return 'BICENTENARIO';
  return null;
}

/**
 * Inspects OCR-extracted receipt text to detect whether a receipt corresponds to a
 * Venezuelan bank FX purchase (Mesa de Cambio / Menudeo / Intervención Cambiaria).
 */
export function detectFxInterventionReceipt(
  rawText: string,
  bankHint?: string | null,
): {
  readonly isFxPurchase: boolean;
  readonly bankId: FxInterventionBankId | null;
  readonly usdAmount: number | null;
  readonly bcvRateVes: number | null;
} {
  const text = (rawText || '').trim();
  const upper = text.toUpperCase();
  const fxKeywords = [
    'COMPRA DE DIVISAS',
    'MESA DE CAMBIO',
    'INTERVENCION CAMBIARIA',
    'INTERVENCIÓN CAMBIARIA',
    'MENUDEO',
    'OPERACION CAMBIARIA',
    'OPERACIÓN CAMBIARIA',
    'DIVISAS PLUS',
    'COMPRA MONEDA EXTRANJERA',
  ];
  const isFxPurchase = fxKeywords.some((kw) => upper.includes(kw));
  if (!isFxPurchase) {
    return { isFxPurchase: false, bankId: null, usdAmount: null, bcvRateVes: null };
  }

  let bankId = resolveFxInterventionBankId(bankHint);
  if (!bankId) {
    if (upper.includes('BANCO DE VENEZUELA') || upper.includes('BDVENLINEA')) {
      bankId = 'BDV';
    } else {
      for (const bank of VENEZUELAN_FX_BANKS) {
        if (
          upper.includes(bank.shortName.toUpperCase()) ||
          upper.includes(bank.name.toUpperCase())
        ) {
          bankId = bank.id;
          break;
        }
      }
    }
  }

  const usdMatch = text.match(/(?:USD|\$|US\$)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i);
  const usdAmount = usdMatch
    ? Number.parseFloat(usdMatch[1].replace(',', '.'))
    : null;

  const rateMatch = text.match(/(?:TASA|CAMBIO|BCV)\s*[:=]?\s*(?:BS\.?\s*)?([0-9]{2,3}[.,][0-9]{2,4})/i);
  const bcvRateVes = rateMatch
    ? Number.parseFloat(rateMatch[1].replace(',', '.'))
    : null;

  return {
    isFxPurchase: true,
    bankId,
    usdAmount: usdAmount && Number.isFinite(usdAmount) && usdAmount > 0 ? usdAmount : null,
    bcvRateVes: bcvRateVes && Number.isFinite(bcvRateVes) && bcvRateVes > 0 ? bcvRateVes : null,
  };
}
