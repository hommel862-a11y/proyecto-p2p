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

export const FX_DESK_MODALITIES = {
  MENUDEO_BCV: 'MENUDEO_BCV',
  MESA_CAMBIO_PACTO: 'MESA_CAMBIO_PACTO',
  TAQUILLA_EFECTIVO_OTC: 'TAQUILLA_EFECTIVO_OTC',
} as const;

export type FxDeskModality = (typeof FX_DESK_MODALITIES)[keyof typeof FX_DESK_MODALITIES];

export const FX_WINDOW_REGIMES = {
  BCV_INTERVENTION_LIVE: 'BCV_INTERVENTION_LIVE',
  RETAIL_MENUDEO_OPEN: 'RETAIL_MENUDEO_OPEN',
  AFTERNOON_PACTO_EXTENSION: 'AFTERNOON_PACTO_EXTENSION',
  PRE_OPEN_PREP: 'PRE_OPEN_PREP',
  CLOSED_OFF_HOURS: 'CLOSED_OFF_HOURS',
} as const;

export type FxWindowRegime = (typeof FX_WINDOW_REGIMES)[keyof typeof FX_WINDOW_REGIMES];

export interface FxWindowEvaluation {
  readonly isWindowOpen: boolean;
  readonly regime: FxWindowRegime;
  readonly label: string;
  readonly vetDayOfWeek: number;
  readonly vetHour: number;
  readonly vetMinute: number;
  readonly vetTimeFormatted: string;
}

/** Standard Venezuelan Impuesto a las Grandes Transacciones Financieras (3.00%) on foreign-currency electronic debits. */
export const VEN_DEFAULT_IGTF_PCT = 3.0;

export type FxExitRailType =
  | 'INTL_DEBIT_CARD'
  | 'INTERNAL_USD_P2P'
  | 'CASH_WITHDRAWAL_OTC';

export interface FxExitRailOption {
  readonly id: FxExitRailType;
  readonly label: string;
  readonly shortLabel: string;
  readonly defaultFrictionPct: number;
  readonly appliesIgtfByDefault: boolean;
}

export const FX_EXIT_RAIL_OPTIONS: readonly FxExitRailOption[] = [
  {
    id: 'INTL_DEBIT_CARD',
    label: 'Tarjeta Mastercard/Visa Débito Internacional ➔ USDT',
    shortLabel: '💳 Tarjeta Intl (1.5% + IGTF)',
    defaultFrictionPct: 1.5,
    appliesIgtfByDefault: true,
  },
  {
    id: 'INTERNAL_USD_P2P',
    label: 'Cuenta Verde / Transferencia Divisas ➔ P2P Interno',
    shortLabel: '🔄 P2P Divisas (1.2% + IGTF)',
    defaultFrictionPct: 1.2,
    appliesIgtfByDefault: true,
  },
  {
    id: 'CASH_WITHDRAWAL_OTC',
    label: 'Retiro Taquilla Efectivo USD ➔ OTC P2P',
    shortLabel: '💵 Efectivo OTC (1.8% · 0% IGTF)',
    defaultFrictionPct: 1.8,
    appliesIgtfByDefault: false,
  },
];

export type BankLiquiditySignalState =
  | 'CONFIRMED_FLUID'
  | 'WINDOW_OPEN'
  | 'COOLDOWN_DEPLETED'
  | 'STANDBY';

export type FxCapitalAllocationMode = 'PER_BANK' | 'DISTRIBUTE_TOTAL';

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

export interface FxAccountTicketAllocation {
  readonly accountId: string;
  readonly accountName: string;
  readonly accountNumberMasked: string;
  readonly availableBalanceVes: number;
  readonly remainingDailyLimitVes: number;
  readonly orderUsd: number;
  readonly principalVes: number;
  readonly bankFeeVes: number;
  readonly totalDebitVes: number;
  readonly safetyBufferVes: number;
}

export interface FxBankOrderTicket {
  readonly bank: FxBankDeskProfile;
  readonly modality: FxDeskModality;
  readonly linkedAccountId: string | null;
  readonly linkedAccountName: string | null;
  readonly accountAllocations: readonly FxAccountTicketAllocation[];
  readonly availableBalanceVes: number;
  readonly remainingDailyLimitVes: number;
  readonly consumedDailyLimitPct: number;
  readonly todayTxCount: number;
  readonly maxDailyTxCount: number;
  readonly sudebanHealth: 'OPTIMAL' | 'WARNING' | 'BLOCKED_LIMIT';
  readonly signalState: BankLiquiditySignalState;
  /** Exact rounded USD amount recommended to request in the bank portal so it does not reject. */
  readonly recommendedOrderUsd: number;
  /** Effective banking FX fee percentage applied for the selected modality (e.g. 0.25% Menudeo vs 0.50% Pacto). */
  readonly effectiveBankFeePct: number;
  /** Estimated VES debited by the bank (principal + effectiveBankFeePct, counted exactly once). */
  readonly estimatedVesDebit: number;
  /** Estimated bank commission in VES. */
  readonly estimatedBankFeeVes: number;
  /** VES buffer kept untouched in account to prevent intraday rate-shift bounce. */
  readonly reservedSafetyBufferVes: number;
  /** Venezuelan IGTF percentage applied on the exit leg (3.0% on electronic FX rails, 0% on OTC cash). */
  readonly igtfPct: number;
  /** Estimated USD deducted by Venezuelan IGTF on the exit leg. */
  readonly estimatedIgtfUsd: number;
  /** Estimated USD deducted by exit rail gateway/OTC friction (excluding IGTF). */
  readonly estimatedRailFeeUsd: number;
  /** Combined exit friction percentage (igtfPct + activeExitRailFrictionPct). */
  readonly totalExitFrictionPct: number;
  /** Equivalent net USDT received after IGTF and primary exit rail friction. */
  readonly netUsdtAfterExitRail: number;
  readonly activeExitRail: FxExitRailType;
  readonly activeExitRailLabel: string;
  readonly activeExitRailFrictionPct: number;
  /** Projected VES returned when selling the net USDT on P2P at `p2pSellRateVes`. */
  readonly projectedP2pReturnVes: number | null;
  /** Projected net profit in VES after all banking, IGTF, and exit rail frictions. */
  readonly projectedNetProfitVes: number | null;
  /** Projected net ROI percentage on this ticket. */
  readonly projectedNetRoiPct: number | null;
  readonly isViableOrder: boolean;
  readonly blockReason: string | null;
  /** Composite priority score used to rank banks and order the Morning Burst queue. */
  readonly executionScore: number;
}

export interface FxDeskEvaluationInput {
  readonly bcvOfficialRateVes: number | null;
  readonly p2pSellRateVes: number | null;
  /** Venezuelan FX desk execution modality (defaults to `MENUDEO_BCV`). */
  readonly modality?: FxDeskModality;
  /** Venezuelan IGTF tax percentage on digital foreign-currency exits (defaults to 3.0%; 0% on OTC cash). */
  readonly igtfPct?: number;
  /** Optional simulated VES capital per bank when no account is linked or when `useSimulatedCapital` is true. */
  readonly simulatedCapitalVes?: number;
  /** Forces evaluation against `simulatedCapitalVes` even when real accounts are linked (pure What-If simulator). */
  readonly useSimulatedCapital?: boolean;
  /** Whether `simulatedCapitalVes` applies per bank (default) or is distributed across banks as a single total pool. */
  readonly capitalAllocationMode?: FxCapitalAllocationMode;
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
 * Selects the primary eligible bank account for FX Mesa de Cambio operations,
 * strictly prioritizing `TRANSFERENCIA` accounts over `PAGO_MOVIL` (since retail FX
 * purchases execute via bank transfer accounts, not Pago Móvil), sorted by highest balance.
 */
export function selectPrimaryFxBankAccount(
  profile: FxBankDeskProfile,
  accounts: readonly BankAccount[],
  usages?: readonly AccountUsage[],
): {
  account: BankAccount | null;
  usage: AccountUsage | null;
  eligibleAccounts: BankAccount[];
  eligibleUsages: AccountUsage[];
} {
  const matched = matchAccountsForFxBank(profile, accounts);
  const transferAccounts = matched.filter((a) => a.rail === 'TRANSFERENCIA');
  const eligibleAccounts = transferAccounts.length > 0 ? transferAccounts : matched;

  const usageMap = new Map<string, AccountUsage>((usages ?? []).map((u) => [u.account.id, u]));
  const eligibleUsages = eligibleAccounts
    .map((a) => usageMap.get(a.id))
    .filter((u): u is AccountUsage => u !== undefined)
    .sort((a, b) => b.currentBalanceVes - a.currentBalanceVes);

  const sortedAccounts = [...eligibleAccounts].sort((a, b) => {
    const uA = usageMap.get(a.id)?.currentBalanceVes ?? a.initialBalanceVes;
    const uB = usageMap.get(b.id)?.currentBalanceVes ?? b.initialBalanceVes;
    return uB - uA;
  });

  const primaryUsage = eligibleUsages[0] ?? null;
  const primaryAccount = primaryUsage?.account ?? sortedAccounts[0] ?? null;

  return {
    account: primaryAccount,
    usage: primaryUsage,
    eligibleAccounts: sortedAccounts,
    eligibleUsages,
  };
}

/**
 * Evaluates the live Venezuelan banking FX window in canonical `America/Caracas` (`UTC-04:00`).
 * Never activates on Sunday nights, midnight, or weekends, and properly keeps Tuesday, Wednesday,
 * and Friday retail banking hours (`08:30–13:00 VET`) open alongside Mon/Thu BCV intervention days.
 */
export function evaluateVenezuelanFxWindow(now: Date = new Date()): FxWindowEvaluation {
  const vetShifted = new Date(now.getTime() - 4 * 3600 * 1000);
  const vetDayOfWeek = vetShifted.getUTCDay(); // 0=Sun .. 6=Sat
  const vetHour = vetShifted.getUTCHours();
  const vetMinute = vetShifted.getUTCMinutes();
  const minutesOfDay = vetHour * 60 + vetMinute;
  const vetTimeFormatted = `${String(vetHour).padStart(2, '0')}:${String(vetMinute).padStart(2, '0')} VET`;

  if (vetDayOfWeek === 0 || vetDayOfWeek === 6) {
    return {
      isWindowOpen: false,
      regime: FX_WINDOW_REGIMES.CLOSED_OFF_HOURS,
      label: `Fin de semana bancario (${vetTimeFormatted})`,
      vetDayOfWeek,
      vetHour,
      vetMinute,
      vetTimeFormatted,
    };
  }

  // Morning prime window: 08:30 to 13:00 VET (510 to 780 mins)
  if (minutesOfDay >= 510 && minutesOfDay <= 780) {
    const isBcvDay = vetDayOfWeek === 1 || vetDayOfWeek === 4;
    return {
      isWindowOpen: true,
      regime: isBcvDay
        ? FX_WINDOW_REGIMES.BCV_INTERVENTION_LIVE
        : FX_WINDOW_REGIMES.RETAIL_MENUDEO_OPEN,
      label: isBcvDay
        ? `Intervención BCV Activa · 08:30–13:00 (${vetTimeFormatted})`
        : `Ventana Menudeo & Mesa Activa · 08:30–13:00 (${vetTimeFormatted})`,
      vetDayOfWeek,
      vetHour,
      vetMinute,
      vetTimeFormatted,
    };
  }

  // Afternoon corporate pacto & reload extension: 13:01 to 15:30 VET (781 to 930 mins)
  if (minutesOfDay > 780 && minutesOfDay <= 930) {
    return {
      isWindowOpen: true,
      regime: FX_WINDOW_REGIMES.AFTERNOON_PACTO_EXTENSION,
      label: `Extensión Vespertina Pacto/Recargas · 13:00–15:30 (${vetTimeFormatted})`,
      vetDayOfWeek,
      vetHour,
      vetMinute,
      vetTimeFormatted,
    };
  }

  // Pre-open preparation: 07:30 to 08:29 VET (450 to 509 mins) -> NOT active yet!
  if (minutesOfDay >= 450 && minutesOfDay < 510) {
    return {
      isWindowOpen: false,
      regime: FX_WINDOW_REGIMES.PRE_OPEN_PREP,
      label: `Pre-Apertura Bancaria · Abre 08:30 VET (${vetTimeFormatted})`,
      vetDayOfWeek,
      vetHour,
      vetMinute,
      vetTimeFormatted,
    };
  }

  return {
    isWindowOpen: false,
    regime: FX_WINDOW_REGIMES.CLOSED_OFF_HOURS,
    label: `Mesa Cerrada · Horario Hábil Lun–Vie 08:30 VET (${vetTimeFormatted})`,
    vetDayOfWeek,
    vetHour,
    vetMinute,
    vetTimeFormatted,
  };
}

/**
 * Computes the exact anti-rejection USD order size for a given VES budget and bank rule profile.
 */
export function computeAntiRejectionUsdLot(
  deployableVes: number,
  bcvRateVes: number,
  profile: FxBankDeskProfile,
  overrideBankFeePct?: number,
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

  const feePct =
    typeof overrideBankFeePct === 'number' && Number.isFinite(overrideBankFeePct) && overrideBankFeePct >= 0
      ? overrideBankFeePct
      : profile.bankFxFeePct;

  const totalMultiplier = 1 + (feePct + profile.rateSafetyBufferPct) / 100;
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
  const bankFeeVes = roundMoney(principalVes * (feePct / 100), 2);
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
  const modality: FxDeskModality = input.modality ?? FX_DESK_MODALITIES.MENUDEO_BCV;
  const configuredIgtfPct =
    typeof input.igtfPct === 'number' && Number.isFinite(input.igtfPct) && input.igtfPct >= 0
      ? roundMoney(input.igtfPct, 2)
      : VEN_DEFAULT_IGTF_PCT;
  const simulatedCap =
    typeof input.simulatedCapitalVes === 'number' && input.simulatedCapitalVes > 0
      ? input.simulatedCapitalVes
      : 0;
  const useSimulatedOverride = Boolean(input.useSimulatedCapital);
  const allocationMode: FxCapitalAllocationMode = input.capitalAllocationMode ?? 'PER_BANK';

  interface BankPrep {
    bank: FxBankDeskProfile;
    eligibleAccounts: BankAccount[];
    primaryAcc: BankAccount | null;
    primaryUsage: AccountUsage | null;
    velocity: AccountVelocityStatus | undefined;
    realBalanceVes: number;
    effectiveBankFeePct: number;
    sudebanHealth: 'OPTIMAL' | 'WARNING' | 'BLOCKED_LIMIT';
    signalState: BankLiquiditySignalState;
    activeExitRail: FxExitRailType;
    activeExitRailLabel: string;
    activeExitRailFrictionPct: number;
    effectiveIgtfPct: number;
    totalExitFrictionPct: number;
    remainingDailyLimitVes: number;
    consumedDailyLimitPct: number;
    todayTxCount: number;
    maxDailyTxCount: number;
    preAllocPriority: number;
  }

  const preps: BankPrep[] = VENEZUELAN_FX_BANKS.map((bank) => {
    const selection = selectPrimaryFxBankAccount(bank, accounts, usages);
    const primaryAcc = useSimulatedOverride ? null : selection.account;
    const primaryUsage = useSimulatedOverride ? null : selection.usage;
    const eligibleAccounts = useSimulatedOverride ? [] : selection.eligibleAccounts;
    const velocity = primaryAcc ? velocityMap.get(primaryAcc.id) : undefined;

    const realBalanceVes = roundMoney(
      eligibleAccounts.reduce((sum, acc) => {
        const u = usageMap.get(acc.id);
        return sum + Math.max(0, u ? u.currentBalanceVes : acc.initialBalanceVes);
      }, 0),
      2,
    );

    const effectiveBankFeePct =
      modality === FX_DESK_MODALITIES.MESA_CAMBIO_PACTO
        ? Math.max(0.5, bank.bankFxFeePct)
        : bank.bankFxFeePct;

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

    const overrideRailId = input.exitRailOverrides?.[bank.id];
    const modalityForcedOtc =
      !overrideRailId && modality === FX_DESK_MODALITIES.TAQUILLA_EFECTIVO_OTC
        ? 'CASH_WITHDRAWAL_OTC'
        : undefined;
    const targetRailId = overrideRailId ?? modalityForcedOtc;
    const overrideRail = targetRailId
      ? FX_EXIT_RAIL_OPTIONS.find((r) => r.id === targetRailId)
      : undefined;
    const defaultRailMeta = FX_EXIT_RAIL_OPTIONS.find((r) => r.id === bank.primaryExitRail);

    const activeExitRail = overrideRail ? overrideRail.id : bank.primaryExitRail;
    const activeExitRailLabel = overrideRail ? overrideRail.label : bank.primaryExitRailLabel;
    const activeExitRailFrictionPct = overrideRail
      ? overrideRail.defaultFrictionPct
      : bank.exitRailFrictionPct;
    const appliesIgtf = overrideRail
      ? overrideRail.appliesIgtfByDefault
      : (defaultRailMeta?.appliesIgtfByDefault ?? activeExitRail !== 'CASH_WITHDRAWAL_OTC');
    const effectiveIgtfPct = appliesIgtf ? configuredIgtfPct : 0;
    const totalExitFrictionPct = Math.min(
      99,
      roundMoney(effectiveIgtfPct + activeExitRailFrictionPct, 2),
    );

    const remainingDailyLimitVes = primaryUsage
      ? primaryUsage.account.dailyLimitVes > 0
        ? primaryUsage.remainingLimitVes
        : realBalanceVes
      : simulatedCap;

    const signalWeight =
      signalState === 'CONFIRMED_FLUID'
        ? 500
        : signalState === 'WINDOW_OPEN'
          ? 250
          : signalState === 'STANDBY'
            ? 100
            : -500;
    const tierWeight =
      bank.tier === 'TIER_1_LIDER' ? 30 : bank.tier === 'TIER_2_COMERCIAL' ? 15 : 0;
    const totalCostPct = effectiveBankFeePct + totalExitFrictionPct;
    const preAllocPriority =
      sudebanHealth === 'BLOCKED_LIMIT' || signalState === 'COOLDOWN_DEPLETED'
        ? -1000
        : signalWeight + tierWeight - totalCostPct * 10 - consumedDailyLimitPct * 0.5;

    return {
      bank,
      eligibleAccounts,
      primaryAcc,
      primaryUsage,
      velocity,
      realBalanceVes,
      effectiveBankFeePct,
      sudebanHealth,
      signalState,
      activeExitRail,
      activeExitRailLabel,
      activeExitRailFrictionPct,
      effectiveIgtfPct,
      totalExitFrictionPct,
      remainingDailyLimitVes,
      consumedDailyLimitPct,
      todayTxCount,
      maxDailyTxCount,
      preAllocPriority,
    };
  });

  // In DISTRIBUTE_TOTAL mode, greedily assign slices of `simulatedCap` to top-ranked eligible banks
  // without cloning unviable sub-minimum balances or ignoring 0 Bs linked accounts.
  const distributedBudgetByBank = new Map<FxInterventionBankId, number>();
  if (allocationMode === 'DISTRIBUTE_TOTAL' && simulatedCap > 0) {
    let remainingPoolVes = simulatedCap;
    const ranked = [...preps].sort((a, b) => b.preAllocPriority - a.preAllocPriority);
    for (const prep of ranked) {
      if (remainingPoolVes <= 0) {
        distributedBudgetByBank.set(prep.bank.id, 0);
        continue;
      }
      if (prep.sudebanHealth === 'BLOCKED_LIMIT' || prep.signalState === 'COOLDOWN_DEPLETED') {
        distributedBudgetByBank.set(prep.bank.id, 0);
        continue;
      }
      // If real accounts exist and we are NOT in pure simulator mode, respect real account funding
      if (!useSimulatedOverride && accounts.length > 0 && prep.primaryAcc !== null && prep.realBalanceVes <= 0) {
        distributedBudgetByBank.set(prep.bank.id, 0);
        continue;
      }
      const realCap =
        !useSimulatedOverride && prep.primaryAcc !== null ? prep.realBalanceVes : remainingPoolVes;
      const dailyLimitCap =
        prep.primaryUsage && prep.primaryUsage.account.dailyLimitVes > 0
          ? prep.primaryUsage.remainingLimitVes
          : remainingPoolVes;
      const bankBudget = roundMoney(
        Math.max(0, Math.min(remainingPoolVes, dailyLimitCap, realCap)),
        2,
      );

      if (bcvRate !== null && bankBudget > 0) {
        const probeLot = computeAntiRejectionUsdLot(
          bankBudget,
          bcvRate,
          prep.bank,
          prep.effectiveBankFeePct,
        );
        if (probeLot.orderUsd >= prep.bank.minLotUsd && probeLot.totalDebitVes > 0) {
          const neededWithBuffer = roundMoney(
            Math.min(
              bankBudget,
              probeLot.principalVes *
                (1 + (prep.effectiveBankFeePct + prep.bank.rateSafetyBufferPct) / 100) +
                0.01,
            ),
            2,
          );
          distributedBudgetByBank.set(prep.bank.id, neededWithBuffer);
          remainingPoolVes = roundMoney(Math.max(0, remainingPoolVes - probeLot.totalDebitVes), 2);
          continue;
        }
      }
      distributedBudgetByBank.set(prep.bank.id, 0);
    }
  }

  let totalDeployableVes = 0;
  let totalRecommendedUsd = 0;
  let totalNetUsdt = 0;
  let totalProjectedReturnVes = 0;
  let totalProjectedNetProfitVes = 0;

  const tickets: FxBankOrderTicket[] = preps.map((prep) => {
    const {
      bank,
      eligibleAccounts,
      primaryAcc,
      primaryUsage,
      realBalanceVes,
      effectiveBankFeePct,
      sudebanHealth,
      signalState,
      activeExitRail,
      activeExitRailLabel,
      activeExitRailFrictionPct,
      effectiveIgtfPct,
      totalExitFrictionPct,
      consumedDailyLimitPct,
      todayTxCount,
      maxDailyTxCount,
    } = prep;

    // When real accounts are passed (`accounts.length > 0`) and `useSimulatedCapital` is false,
    // linked accounts use their real balance and unlinked banks stay at 0 Bs unless `accounts.length === 0`.
    const availableBalanceVes = roundMoney(
      allocationMode === 'DISTRIBUTE_TOTAL'
        ? (distributedBudgetByBank.get(bank.id) ?? 0)
        : primaryAcc !== null
          ? realBalanceVes
          : accounts.length === 0 || useSimulatedOverride
            ? simulatedCap
            : 0,
      2,
    );

    const remainingDailyLimitVes = primaryUsage
      ? primaryUsage.account.dailyLimitVes > 0
        ? primaryUsage.remainingLimitVes
        : availableBalanceVes
      : availableBalanceVes;

    // Per-account isolation: compute discrete anti-rejection lots per eligible account
    // so multiple accounts of the same bank NEVER sum sub-minimum balances or overdraft primaryAcc.
    const accountAllocations: FxAccountTicketAllocation[] = [];
    let lot = { orderUsd: 0, principalVes: 0, bankFeeVes: 0, totalDebitVes: 0, safetyBufferVes: 0 };

    if (
      bcvRate !== null &&
      sudebanHealth !== 'BLOCKED_LIMIT' &&
      signalState !== 'COOLDOWN_DEPLETED' &&
      availableBalanceVes > 0
    ) {
      if (eligibleAccounts.length > 0) {
        let remainingBankCapVes = availableBalanceVes;
        for (const acc of eligibleAccounts) {
          if (remainingBankCapVes <= 0) break;
          const u = usageMap.get(acc.id);
          const vel = velocityMap.get(acc.id);
          const accBlocked =
            (u?.isOverLimit ?? false) ||
            (u?.isOverMonthlyLimit ?? false) ||
            vel?.velocityHealth === 'SATURATED';
          if (accBlocked) continue;

          const accBalance = Math.max(0, roundMoney(u ? u.currentBalanceVes : acc.initialBalanceVes, 2));
          const accRemDaily = u
            ? acc.dailyLimitVes > 0
              ? u.remainingLimitVes
              : accBalance
            : acc.dailyLimitVes > 0
              ? acc.dailyLimitVes
              : accBalance;
          const accDeployable = Math.min(accBalance, Math.max(0, accRemDaily), remainingBankCapVes);
          if (accDeployable <= 0) continue;

          const accLot = computeAntiRejectionUsdLot(
            accDeployable,
            bcvRate,
            bank,
            effectiveBankFeePct,
          );
          if (accLot.orderUsd >= bank.minLotUsd && accLot.totalDebitVes <= accBalance) {
            accountAllocations.push({
              accountId: acc.id,
              accountName: acc.bankName,
              accountNumberMasked: acc.accountNumberMasked,
              availableBalanceVes: accBalance,
              remainingDailyLimitVes: roundMoney(accRemDaily, 2),
              orderUsd: accLot.orderUsd,
              principalVes: accLot.principalVes,
              bankFeeVes: accLot.bankFeeVes,
              totalDebitVes: accLot.totalDebitVes,
              safetyBufferVes: accLot.safetyBufferVes,
            });
            remainingBankCapVes = roundMoney(Math.max(0, remainingBankCapVes - accLot.totalDebitVes), 2);
          }
        }

        if (accountAllocations.length > 0) {
          lot = {
            orderUsd: accountAllocations.reduce((s, a) => s + a.orderUsd, 0),
            principalVes: roundMoney(
              accountAllocations.reduce((s, a) => s + a.principalVes, 0),
              2,
            ),
            bankFeeVes: roundMoney(
              accountAllocations.reduce((s, a) => s + a.bankFeeVes, 0),
              2,
            ),
            totalDebitVes: roundMoney(
              accountAllocations.reduce((s, a) => s + a.totalDebitVes, 0),
              2,
            ),
            safetyBufferVes: roundMoney(
              accountAllocations.reduce((s, a) => s + a.safetyBufferVes, 0),
              2,
            ),
          };
        }
      } else {
        const deployableForBank = Math.min(
          availableBalanceVes,
          remainingDailyLimitVes > 0 || primaryUsage
            ? Math.max(0, remainingDailyLimitVes)
            : availableBalanceVes,
        );
        lot = computeAntiRejectionUsdLot(deployableForBank, bcvRate, bank, effectiveBankFeePct);
      }
    }

    const estimatedIgtfUsd =
      lot.orderUsd > 0 ? roundMoney(lot.orderUsd * (effectiveIgtfPct / 100), 2) : 0;
    const estimatedRailFeeUsd =
      lot.orderUsd > 0 ? roundMoney(lot.orderUsd * (activeExitRailFrictionPct / 100), 2) : 0;
    const netUsdtAfterExitRail =
      lot.orderUsd > 0
        ? roundMoney(Math.max(0, lot.orderUsd - estimatedIgtfUsd - estimatedRailFeeUsd), 2)
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
      blockReason =
        accounts.length > 0 && primaryAcc === null && !useSimulatedOverride
          ? 'Sin cuenta TRANSFERENCIA vinculada'
          : 'Sin saldo VES asignado';
    } else if (lot.orderUsd < bank.minLotUsd) {
      blockReason = `Saldo individual insuficiente para lote mínimo de $${bank.minLotUsd} USD`;
    }

    const isViableOrder =
      blockReason === null &&
      lot.orderUsd >= bank.minLotUsd &&
      (projectedNetProfitVes === null || projectedNetProfitVes > 0);

    const signalBonus =
      signalState === 'CONFIRMED_FLUID'
        ? 300
        : signalState === 'WINDOW_OPEN'
          ? 150
          : signalState === 'COOLDOWN_DEPLETED'
            ? -500
            : 0;
    const roiContribution = (projectedNetRoiPct ?? 0) * 5;
    const executionScore = roundMoney(
      (isViableOrder ? 1000 : 0) + signalBonus + roiContribution - consumedDailyLimitPct,
      2,
    );

    if (isViableOrder) {
      totalDeployableVes = roundMoney(totalDeployableVes + lot.totalDebitVes, 2);
      totalRecommendedUsd = roundMoney(totalRecommendedUsd + lot.orderUsd, 2);
      totalNetUsdt = roundMoney(totalNetUsdt + netUsdtAfterExitRail, 2);
      if (projectedP2pReturnVes !== null && projectedNetProfitVes !== null) {
        totalProjectedReturnVes = roundMoney(totalProjectedReturnVes + projectedP2pReturnVes, 2);
        totalProjectedNetProfitVes = roundMoney(totalProjectedNetProfitVes + projectedNetProfitVes, 2);
      }
    }

    const effectivePrimaryAcc = accountAllocations[0] ?? null;

    return {
      bank,
      modality,
      linkedAccountId: effectivePrimaryAcc?.accountId ?? primaryAcc?.id ?? null,
      linkedAccountName: effectivePrimaryAcc?.accountName ?? primaryAcc?.bankName ?? null,
      accountAllocations,
      availableBalanceVes,
      remainingDailyLimitVes: roundMoney(remainingDailyLimitVes, 2),
      consumedDailyLimitPct: roundMoney(consumedDailyLimitPct, 1),
      todayTxCount,
      maxDailyTxCount,
      sudebanHealth,
      signalState,
      recommendedOrderUsd: lot.orderUsd,
      effectiveBankFeePct,
      estimatedVesDebit: lot.totalDebitVes,
      estimatedBankFeeVes: lot.bankFeeVes,
      reservedSafetyBufferVes: lot.safetyBufferVes,
      igtfPct: effectiveIgtfPct,
      estimatedIgtfUsd,
      estimatedRailFeeUsd,
      totalExitFrictionPct,
      netUsdtAfterExitRail,
      activeExitRail,
      activeExitRailLabel,
      activeExitRailFrictionPct,
      projectedP2pReturnVes,
      projectedNetProfitVes,
      projectedNetRoiPct,
      isViableOrder,
      blockReason,
      executionScore,
    };
  });

  tickets.sort((a, b) => b.executionScore - a.executionScore);

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
 * Parses Venezuelan (`1.250,50`), US (`1,250.50`), and plain decimal (`62.45` / `62,45`) numeric strings.
 * Prevents 1000x truncation on Venezuelan bank receipts formatted as `USD 1.000,00`.
 */
export function parseVenezuelanMoneyString(raw?: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, '');
  if (!cleaned) return null;

  let normalized = cleaned;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      // Venezuelan / European: 1.250,50 -> 1250.50
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US / International: 1,250.50 -> 1250.50
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    // Only commas: check if thousands (1,000,000) vs decimal (62,45 or 1250,00)
    if (/^\d{1,3}(?:,\d{3})+$/.test(cleaned) && !cleaned.endsWith(',00')) {
      normalized = cleaned.replace(/,/g, '');
    } else {
      normalized = cleaned.replace(',', '.');
    }
  } else if (lastDot > -1) {
    // Only dots: check if Venezuelan integer thousands (1.000 or 1.250.000)
    if (/^\d{1,3}(?:\.\d{3})+$/.test(cleaned)) {
      normalized = cleaned.replace(/\./g, '');
    }
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const GENERIC_BANK_STOP_WORDS = new Set([
  'BANCO',
  'UNIVERSAL',
  'COMERCIAL',
  'DIGITAL',
  'DE',
  'DEL',
  'LA',
  'LOS',
  'EN',
  'LINEA',
  'LÍNEA',
  'CA',
  'C.A',
  'C.A.',
  'SACA',
]);

/**
 * Resolves a user-provided bank string (e.g. "bdv", "100% Banco", "0102") to an FxInterventionBankId.
 * Rejects generic stop-words like `"Banco"` so they never collide with `BANCO DE VENEZUELA (BDV)`.
 */
export function resolveFxInterventionBankId(raw?: string | null): FxInterventionBankId | null {
  if (!raw) return null;
  const clean = raw
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!clean || GENERIC_BANK_STOP_WORDS.has(clean)) return null;

  for (const bank of VENEZUELAN_FX_BANKS) {
    const shortNorm = bank.shortName
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const fullNorm = bank.name
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (
      bank.id === clean ||
      bank.abaCode === clean ||
      shortNorm === clean ||
      fullNorm === clean
    ) {
      return bank.id;
    }
  }

  // Ordered unambiguous aliases (100% checked before generic substrings)
  if (clean.includes('100%') || clean.includes('100 %') || clean.includes('100X100') || clean === '100' || clean.includes('CIEN')) {
    return 'CIEN_BANCO';
  }
  if (clean.includes('BANCAMIGA')) return 'BANCAMIGA';
  if (clean.includes('BANESCO')) return 'BANESCO';
  if (clean.includes('MERCANTIL') || clean.includes('MONY')) return 'MERCANTIL';
  if (clean.includes('PROVINCIAL') || clean.includes('BBVA') || clean.includes('PROVINET')) return 'PROVINCIAL';
  if (clean.includes('BNC') || clean.includes('NACIONAL DE CREDITO')) return 'BNC';
  if (clean.includes('BANCARIBE')) return 'BANCARIBE';
  if (clean.includes('BANPLUS')) return 'BANPLUS';
  if (clean.includes('BICENTENARIO') || clean.includes('TRABAJADORES') || clean.includes('BDT')) return 'BICENTENARIO';
  if (clean.includes('TESORO')) return 'TESORO';
  if (clean.includes('EXTERIOR') || clean.includes('NEXO')) return 'EXTERIOR';
  if (clean.includes('PLAZA')) return 'PLAZA';
  if (clean.includes('BFC') || clean.includes('FONDO COMUN')) return 'BFC';
  if (clean.includes('VENEZUELA') || clean.includes('BANVENEZ') || clean.includes('BDVENLINEA')) return 'BDV';

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
    if (upper.includes('100%') || upper.includes('100X100')) {
      bankId = 'CIEN_BANCO';
    } else if (upper.includes('BANCO DE VENEZUELA') || upper.includes('BDVENLINEA')) {
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

  const usdMatch = text.match(/(?:USD|\$|US\$)\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)/i);
  const usdAmount = usdMatch ? parseVenezuelanMoneyString(usdMatch[1]) : null;

  const rateMatch = text.match(
    /(?:TASA(?:\s+DE\s+CAMBIO|\s+BCV)?|TIPO\s+DE\s+CAMBIO|BCV)\s*[:=]?\s*(?:BS\.?\s*)?([0-9]{2,4}[.,][0-9]{2,4})/i,
  );
  const bcvRateVes = rateMatch ? parseVenezuelanMoneyString(rateMatch[1]) : null;

  return {
    isFxPurchase: true,
    bankId,
    usdAmount,
    bcvRateVes,
  };
}
