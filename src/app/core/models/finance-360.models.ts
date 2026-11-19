/**
 * Domain Models for Portafolio Financiero, Pyme & Presupuestos 360.
 *
 * Strict Isolation: These models and their persistent store never disturb
 * or couple with the P2P trading ledger (`p2p.operations`).
 */

export const FINANCE_SCOPE = {
  ALL: 'all',
  PERSONAL: 'personal',
  BUSINESS: 'business',
} as const;
export type FinanceScope = (typeof FINANCE_SCOPE)[keyof typeof FINANCE_SCOPE];

export const PAYMENT_CHANNEL = {
  ZELLE: 'zelle',
  BS_BANK: 'bs_bank',
  CRYPTO: 'crypto',
  CASH: 'cash',
  RECEIVABLE: 'receivable',
  OTHER: 'other',
} as const;
export type PaymentChannel = (typeof PAYMENT_CHANNEL)[keyof typeof PAYMENT_CHANNEL];

export const INCOME_CATEGORY = {
  SALARY: 'salary',
  P2P_PROFIT: 'p2p_profit',
  BUSINESS_SALE: 'business_sale',
  QUOTE_ADVANCE: 'quote_advance',
  FREELANCE: 'freelance',
  INVESTMENT: 'investment',
  OTHER: 'other',
} as const;
export type IncomeCategory = (typeof INCOME_CATEGORY)[keyof typeof INCOME_CATEGORY];

export const EXPENSE_CATEGORY = {
  // Personal expenses
  HOUSING: 'housing',
  GROCERIES: 'groceries',
  HEALTH: 'health',
  SERVICES: 'services',
  EDUCATION: 'education',
  TRANSPORT: 'transport',
  CASHEA_INSTALLMENT: 'cashea_installment',
  PERSONAL_CARE: 'personal_care',
  ENTERTAINMENT: 'entertainment',
  // Business / SME expenses
  PROVIDER_MERCHANDISE: 'provider_merchandise',
  PAYROLL: 'payroll',
  RENT: 'rent',
  UTILITIES: 'utilities',
  EQUIPMENT_CAPEX: 'equipment_capex',
  MAINTENANCE: 'maintenance',
  MARKETING: 'marketing',
  TAXES: 'taxes',
  OTHER: 'other',
} as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORY)[keyof typeof EXPENSE_CATEGORY];

export const CURRENCY_CODE = {
  USD: 'USD',
  VES: 'VES',
  USDT: 'USDT',
  EUR: 'EUR',
} as const;
export type CurrencyCode = (typeof CURRENCY_CODE)[keyof typeof CURRENCY_CODE];

export const PYME_DRAWER_KEY = {
  MERCHANDISE: 'drawer_merchandise',
  OPERATIONS: 'drawer_operations',
  CAPEX: 'drawer_capex',
} as const;
export type PymeDrawerKey = (typeof PYME_DRAWER_KEY)[keyof typeof PYME_DRAWER_KEY];

export const VAULT_KIND = {
  ASSET: 'asset',
  CREDIT_LINE: 'credit_line',
} as const;
export type VaultKind = (typeof VAULT_KIND)[keyof typeof VAULT_KIND];

// -------------------------------------------------------------
// DETERMINISTIC VET (UTC-4) CLOCK, ROUNDING & UUID HELPERS
// -------------------------------------------------------------

const VET_UTC_OFFSET_MS = -4 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
let fallbackIdCounter = 0;

/**
 * Returns the current calendar date in Venezuela Time (VET, UTC-4) as `YYYY-MM-DD`.
 */
export function todayVetIso(now: Date = new Date()): string {
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

/**
 * Parses a calendar date (`YYYY-MM-DD` or ISO prefix) into a local noon Date
 * so weekday and day-of-month queries never shift backward under UTC-4.
 */
export function parseCalendarDate(iso: string): Date {
  const parts = extractIsoDateParts(iso);
  if (!parts) {
    const fallbackParts = extractIsoDateParts(todayVetIso())!;
    return new Date(fallbackParts[0], fallbackParts[1] - 1, fallbackParts[2], 12, 0, 0, 0);
  }
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}

/**
 * Adds a signed integer number of calendar days to a `YYYY-MM-DD` string in pure calendar arithmetic.
 */
export function addCalendarDays(iso: string, days: number): string {
  const parts = extractIsoDateParts(iso) ?? extractIsoDateParts(todayVetIso())!;
  const safeDays = Number.isFinite(days) ? Math.trunc(days) : 0;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + safeDays));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Adds a signed integer number of calendar months to a `YYYY-MM-DD` string, clamping month-end days.
 */
export function addCalendarMonths(iso: string, months: number): string {
  const parts = extractIsoDateParts(iso) ?? extractIsoDateParts(todayVetIso())!;
  const safeMonths = Number.isFinite(months) ? Math.trunc(months) : 0;
  const targetYearMonth = new Date(Date.UTC(parts[0], parts[1] - 1 + safeMonths, 1));
  const targetYear = targetYearMonth.getUTCFullYear();
  const targetMonth = targetYearMonth.getUTCMonth();
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(parts[2], lastDayOfTargetMonth);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

/**
 * Returns the exact signed calendar day difference (`toIso - fromIso`).
 * Positive when `toIso` is after `fromIso`; negative when `toIso` is before `fromIso`.
 */
export function calendarDaysBetween(fromIso: string, toIso: string): number {
  const fromParts = extractIsoDateParts(fromIso);
  const toParts = extractIsoDateParts(toIso);
  if (!fromParts || !toParts) return 0;
  const fromUtc = Date.UTC(fromParts[0], fromParts[1] - 1, fromParts[2]);
  const toUtc = Date.UTC(toParts[0], toParts[1] - 1, toParts[2]);
  return Math.round((toUtc - fromUtc) / DAY_MS);
}

/**
 * IEEE-754 safe monetary rounding. Normalizes non-finite values and `-0` to `0`.
 */
export function roundMoney(val: number, decimals = 2): number {
  if (!Number.isFinite(val)) return 0;
  const safeDecimals = Math.max(0, Math.min(8, Math.trunc(decimals)));
  const factor = Math.pow(10, safeDecimals);
  const rounded =
    (Math.sign(val) * Math.round((Math.abs(val) + Number.EPSILON) * factor)) / factor;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Generates collision-free domain identifiers backed by `crypto.randomUUID()`.
 */
export function generateFinanceId(prefix: string): string {
  const cleanPrefix = prefix.trim() || 'f360';
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${cleanPrefix}-${cryptoObj.randomUUID()}`;
  }
  fallbackIdCounter += 1;
  const entropy = Math.random().toString(36).slice(2, 10);
  return `${cleanPrefix}-${Date.now()}-${fallbackIdCounter}-${entropy}`;
}

// -------------------------------------------------------------
// TRI-MONETARY ENGINE (ZERO INVENTED RATES)
// -------------------------------------------------------------

export interface TriMonetaryAmount {
  amount_original: number;
  currency: CurrencyCode;
  bcv_rate: number;
  parallel_rate: number;
  eur_usd_rate?: number;
  amount_usd: number;
  amount_ves: number;
}

/**
 * Computes deterministic tri-monetary representations.
 * - Never coerces `bcvRate <= 0` to `1` ("Sin dato antes que dato inventado").
 * - For `EUR`, honors explicit positive `eurUsdRate` and only falls back to `1.08` when omitted or non-positive.
 */
export function computeTriMonetaryAmount(
  amount: number,
  currency: CurrencyCode,
  bcvRate: number,
  parallelRate = bcvRate,
  eurUsdRate?: number,
): TriMonetaryAmount {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const safeBcv = Number.isFinite(bcvRate) && bcvRate > 0 ? bcvRate : 0;
  const safeParallel = Number.isFinite(parallelRate) && parallelRate > 0 ? parallelRate : safeBcv;
  const explicitEurUsd =
    typeof eurUsdRate === 'number' && Number.isFinite(eurUsdRate) && eurUsdRate > 0
      ? eurUsdRate
      : undefined;

  let amountUsd = 0;
  let amountVes = 0;
  let resolvedEurUsd: number | undefined = explicitEurUsd;

  if (currency === 'USD' || currency === 'USDT') {
    amountUsd = roundMoney(safeAmount);
    amountVes = safeBcv > 0 ? roundMoney(safeAmount * safeBcv) : 0;
  } else if (currency === 'VES') {
    amountVes = roundMoney(safeAmount);
    amountUsd = safeBcv > 0 ? roundMoney(safeAmount / safeBcv) : 0;
  } else if (currency === 'EUR') {
    resolvedEurUsd = explicitEurUsd ?? 1.08;
    amountUsd = roundMoney(safeAmount * resolvedEurUsd);
    amountVes = safeBcv > 0 ? roundMoney(amountUsd * safeBcv) : 0;
  }

  const result: TriMonetaryAmount = {
    amount_original: roundMoney(safeAmount),
    currency,
    bcv_rate: safeBcv,
    parallel_rate: safeParallel,
    amount_usd: amountUsd,
    amount_ves: amountVes,
  };

  if (resolvedEurUsd !== undefined) {
    result.eur_usd_rate = resolvedEurUsd;
  }

  return result;
}

// -------------------------------------------------------------
// EXHAUSTIVE PYME 3-DRAWER CATEGORY ROUTING
// -------------------------------------------------------------

export const EXPENSE_CATEGORY_DRAWER_MAP: Record<ExpenseCategory, PymeDrawerKey> = {
  provider_merchandise: 'drawer_merchandise',
  equipment_capex: 'drawer_capex',
  payroll: 'drawer_operations',
  rent: 'drawer_operations',
  utilities: 'drawer_operations',
  services: 'drawer_operations',
  maintenance: 'drawer_operations',
  marketing: 'drawer_operations',
  taxes: 'drawer_operations',
  transport: 'drawer_operations',
  housing: 'drawer_operations',
  groceries: 'drawer_operations',
  health: 'drawer_operations',
  education: 'drawer_operations',
  cashea_installment: 'drawer_operations',
  personal_care: 'drawer_operations',
  entertainment: 'drawer_operations',
  other: 'drawer_operations',
};

export function getDrawerForExpenseCategory(category: ExpenseCategory): PymeDrawerKey {
  return EXPENSE_CATEGORY_DRAWER_MAP[category] ?? 'drawer_operations';
}

// -------------------------------------------------------------
// PILAR 1: ACTIVOS (Bóvedas de Liquidez y Patrimonio)
// -------------------------------------------------------------
export interface AssetVault {
  id: string;
  name: string;
  channel: PaymentChannel;
  scope: FinanceScope;
  currency: CurrencyCode;
  vaultKind?: VaultKind;
  openingBalance?: number;
  balance: number;
  balanceUsdEquivalent: number;
  balanceVesEquivalent: number;
  bankCode?: string;
  accountNumberMasked?: string;
  isFixedAsset?: boolean;
  icon?: string;
  updatedAt: string;
}

// -------------------------------------------------------------
// PILAR 2: PASIVOS (Deudas, Cuotas Cashea, Facturas Proveedores)
// -------------------------------------------------------------
export interface LiabilityItem {
  id: string;
  title: string;
  creditor: string;
  scope: FinanceScope;
  category: 'cashea' | 'provider' | 'loan' | 'fixed_service' | 'tax' | 'other';
  triMonetary: TriMonetaryAmount;
  dueDate: string; // YYYY-MM-DD (VET)
  status: 'pending' | 'partially_paid' | 'paid' | 'overdue';
  amountPaid: number;
  remainingAmount: number;
  notes?: string;
  casheaPlanId?: string;
  casheaLine?: CasheaCreditLine;
  providerId?: string;
  transferGroupId?: string;
  goalId?: string;
  quoteId?: string;
  createdAt: string;
  updatedAt: string;
}

// -------------------------------------------------------------
// PILAR 3: ENTRADAS (Ingresos, Sueldo, Ganancia Neta P2P)
// -------------------------------------------------------------
export interface P2pBridgeMetadata {
  operationsCount: number;
  realizedPnlVes: number;
  realizedPnlUsdt: number;
  importedAt: string;
}

export interface IncomeDrawerAllocations {
  drawer1Usd: number;
  drawer2Usd: number;
  drawer3Usd: number;
}

export interface IncomeEntry {
  id: string;
  title: string;
  scope: FinanceScope;
  category: IncomeCategory;
  channel: PaymentChannel;
  vaultId?: string;
  triMonetary: TriMonetaryAmount;
  date: string; // YYYY-MM-DD (VET)
  referenceNumber?: string;
  notes?: string;
  transferGroupId?: string;
  goalId?: string;
  quoteId?: string;
  casheaLine?: CasheaCreditLine;
  p2pBridgeMetadata?: P2pBridgeMetadata;
  drawerAllocations?: IncomeDrawerAllocations;
  receiptPdfUrl?: string;
  createdAt: string;
}

// -------------------------------------------------------------
// PILAR 4: SALIDAS (Gastos Operativos, Personales y Pyme)
// -------------------------------------------------------------
export interface ExpenseEntry {
  id: string;
  title: string;
  scope: FinanceScope;
  category: ExpenseCategory;
  channel: PaymentChannel;
  vaultId?: string;
  liabilityId?: string;
  triMonetary: TriMonetaryAmount;
  date: string; // YYYY-MM-DD (VET)
  referenceNumber?: string;
  notes?: string;
  transferGroupId?: string;
  goalId?: string;
  quoteId?: string;
  casheaLine?: CasheaCreditLine;
  drawerAllocation?: PymeDrawerKey;
  receiptPdfUrl?: string;
  createdAt: string;
}

// -------------------------------------------------------------
// DOUBLE-ENTRY TRANSFERS, RECURRING RULES & RECONCILIATIONS
// -------------------------------------------------------------
export const TRANSFER_KIND = {
  VAULT_TRANSFER: 'vault_transfer',
  GOAL_RESERVE: 'goal_reserve',
  GOAL_RELEASE: 'goal_release',
} as const;
export type TransferKind = (typeof TRANSFER_KIND)[keyof typeof TRANSFER_KIND];

export interface TransferEntry {
  id: string;
  groupId: string;
  fromVaultId: string;
  toVaultId: string;
  sourceCurrency: CurrencyCode;
  targetCurrency: CurrencyCode;
  sourceAmount: number;
  creditedAmount: number;
  amountUsd: number;
  bcvRateApplied: number;
  eurUsdRateApplied?: number;
  date: string; // YYYY-MM-DD (VET)
  kind: TransferKind;
  goalId?: string;
  notes?: string;
  createdAt: string;
}

export const RECURRING_FREQUENCY = {
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly',
} as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCY)[keyof typeof RECURRING_FREQUENCY];

export interface RecurringRule {
  id: string;
  title: string;
  type: 'income' | 'expense' | 'liability';
  scope: FinanceScope;
  category: IncomeCategory | ExpenseCategory;
  channel: PaymentChannel;
  vaultId?: string;
  currency: CurrencyCode;
  amount: number;
  frequency: RecurringFrequency;
  nextDueDate: string; // YYYY-MM-DD (VET)
  lastMaterializedDate?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
}

export interface VaultReconciliationRecord {
  id: string;
  vaultId: string;
  vaultName: string;
  currency: CurrencyCode;
  expectedBalance: number;
  actualBalance: number;
  deltaInCurrency: number;
  deltaUsd: number;
  bcvRateApplied: number;
  movementId?: string;
  date: string; // YYYY-MM-DD (VET)
  createdAt: string;
}

// -------------------------------------------------------------
// SUB-MÓDULO 1: CASHEA 2026 (N1-N6 ARAGUANEY, DUAL LINE & MODO ALIADO)
// -------------------------------------------------------------
export const CASHEA_LEVEL = {
  SEMILLA: 1,
  RAIZ: 2,
  HOJA: 3,
  TRONCO: 4,
  ARBOL: 5,
  ARAGUANEY: 6,
} as const;
export type CasheaLevel = (typeof CASHEA_LEVEL)[keyof typeof CASHEA_LEVEL];

export const CASHEA_CREDIT_LINE = {
  PRINCIPAL: 'principal',
  COTIDIANA: 'cotidiana',
  VEHICULAR: 'vehicular',
} as const;
export type CasheaCreditLine = (typeof CASHEA_CREDIT_LINE)[keyof typeof CASHEA_CREDIT_LINE];

export interface CasheaClubTierMeta {
  level: CasheaLevel;
  name: string;
  principalInitialPercent: number;
  cotidianaInitialPercent: number;
  campaignInitialPercent?: number;
  requiredSpentUsd: number;
  requiredInstallmentsPaid: number;
  maxInstallments: number;
  supportedInstallments: readonly number[];
}

export const CASHEA_CLUB_TIERS: Record<CasheaLevel, CasheaClubTierMeta> = {
  1: {
    level: 1,
    name: 'Semilla',
    principalInitialPercent: 60,
    cotidianaInitialPercent: 50,
    requiredSpentUsd: 0,
    requiredInstallmentsPaid: 0,
    maxInstallments: 3,
    supportedInstallments: [1, 3],
  },
  2: {
    level: 2,
    name: 'Raíz',
    principalInitialPercent: 50,
    cotidianaInitialPercent: 40,
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
  },
};

export interface CasheaUserProfile {
  level: CasheaLevel;
  principalLimitUsd: number;
  principalUsedUsd: number;
  cotidianaLimitUsd: number;
  cotidianaUsedUsd: number;
  cumulativeSpentUsd: number;
  paidInstallmentsCount: number;
  lastRecalculationDate?: string;
  nextRecalculationDate?: string;
  clubPoints?: number;
  updatedAt: string;
}

export interface CasheaInstallment {
  number: number;
  dueDate: string; // YYYY-MM-DD (VET)
  amountUsd: number;
  amountPaidUsd?: number;
  penaltyFeeUsd?: number;
  status: 'pending' | 'paid' | 'overdue';
  paidAt?: string;
  paidVes?: number;
  bcvRateApplied?: number;
  paymentReference?: string;
}

export interface CasheaPlan {
  id: string;
  productName: string;
  storeName: string;
  scope?: FinanceScope;
  level?: CasheaLevel;
  creditLine?: CasheaCreditLine;
  totalPriceUsd: number;
  initialPaymentUsd: number;
  initialPercentage: number;
  initialPercent?: number;
  initialExpenseId?: string;
  initialVaultId?: string;
  numberOfInstallments: number;
  installmentAmountUsd: number;
  installmentFrequencyDays: number; // default 14 (or 30 for vehicular)
  startDate: string;
  installments: CasheaInstallment[];
  status: 'active' | 'completed' | 'cancelled';
  createdAt: string;
}

export const CASHEA_HEALTH_STATUS = {
  PAID: 'paid',
  UPCOMING: 'upcoming',
  DUE_SOON_48H: 'due_soon_48h',
  GRACE_2D: 'grace_2d',
  OVERDUE_PENALTY: 'overdue_penalty',
} as const;
export type CasheaHealthStatus = (typeof CASHEA_HEALTH_STATUS)[keyof typeof CASHEA_HEALTH_STATUS];

export const CASHEA_PENALTY_TIER = {
  NONE: 'none',
  TIER_7D: '7d',
  TIER_14D: '14d',
  TIER_28D: '28d',
} as const;
export type CasheaPenaltyTier = (typeof CASHEA_PENALTY_TIER)[keyof typeof CASHEA_PENALTY_TIER];

export interface CasheaInstallmentHealth {
  status: CasheaHealthStatus;
  daysUntilDue: number;
  daysOverdue: number;
  inGracePeriod: boolean;
  reactivationFeeUsd: number;
  penaltyTier: CasheaPenaltyTier;
  clubPointsImpact: string;
}

export interface CasheaMerchantSaleInput {
  title?: string;
  customerName?: string;
  date?: string;
  settlementDays?: number;
  grossSaleUsd: number;
  costOfGoodsUsd: number;
  mdrPercent: number;
  useWeeklyAdvance?: boolean;
  weeklyAdvanceFeePercent?: number;
  bcvRate: number;
  parallelReplacementRate: number;
  monthlyMinimumFeeUsd?: number;
  activationFeeUsd?: number;
}

export interface CasheaMerchantSaleSimulation {
  grossSaleUsd: number;
  costOfGoodsUsd: number;
  mdrPercent: number;
  mdrFeeUsd: number;
  weeklyAdvanceFeePercent: number;
  weeklyAdvanceFeeUsd: number;
  totalCasheaFeesUsd: number;
  settlementUsdAtBcv: number;
  settlementVes: number;
  realReplacementUsd: number;
  fxGapPercent: number;
  fxGapErosionUsd: number;
  realNetProfitUsd: number;
  realNetMarginPercent: number;
  isSellingAtLoss: boolean;
  monthlyMinimumFeeUsd: number;
  activationFeeUsd: number;
  monthlyBreakEvenVolumeUsd: number;
  profitBreakEvenVolumeUsd: number;
  surchargeProhibitionWarning: string;
}

export interface CasheaMerchantSale {
  id: string;
  title: string;
  customerName?: string;
  saleDate: string;
  expectedSettlementDate: string;
  settledAt?: string;
  status: 'pending_settlement' | 'settled' | 'cancelled';
  grossSaleUsd: number;
  costOfGoodsUsd: number;
  mdrPercent: number;
  mdrFeeUsd: number;
  weeklyAdvanceFeePercent: number;
  weeklyAdvanceFeeUsd: number;
  bcvRateApplied: number;
  parallelRateApplied: number;
  fxGapErosionUsd: number;
  netReceivableUsd: number;
  realNetProfitUsd: number;
  isSellingAtLoss: boolean;
  settledVaultId?: string;
  incomeEntryId?: string;
  notes?: string;
  createdAt: string;
}

// -------------------------------------------------------------
// SUB-MÓDULO 2: GESTIÓN PYME / NEGOCIO
// -------------------------------------------------------------
export interface PymeBusinessProfile {
  businessName: string;
  rif?: string;
  phone?: string;
  email?: string;
  address?: string;
  defaultDrawer1Percent: number;
  defaultDrawer2Percent: number;
  defaultDrawer3Percent: number;
  defaultIvaPercent?: number;
  defaultIgtfPercent?: number;
  casheaAllyModeEnabled: boolean;
  casheaAllyMdrPercent?: number;
  casheaAllyMonthlyMinimumUsd?: number;
  casheaAllyActivationFeeUsd?: number;
  updatedAt: string;
}

export interface PymeProvider {
  id: string;
  name: string;
  category: string;
  phone: string;
  bankDetails: string;
  outstandingDebtUsd: number;
  createdAt: string;
}

export interface PymeInventoryItem {
  id: string;
  name: string;
  sku?: string;
  category: string;
  currentStock: number;
  minimumStock: number;
  optimalStock: number;
  unitCostUsd: number;
  sellingPriceUsd: number;
  status: 'optimal' | 'low' | 'depleted';
  lastSoldAt?: string;
  updatedAt: string;
}

export interface PymeDrawerAllocation {
  drawerMerchandise: number; // Fondo de Reposición de Mercancía
  drawerOperations: number; // Gastos Operativos y Nómina
  drawerProfitCapex: number; // Utilidad Neta y Mejoras / Reinversión
}

// -------------------------------------------------------------
// SUB-MÓDULO 3: GENERADOR DE PRESUPUESTOS MULTI-INDUSTRIA
// -------------------------------------------------------------
export type QuoteType =
  | 'automotive_bodywork'
  | 'construction_m2'
  | 'tech_services'
  | 'commerce_retail'
  | 'gastronomy_events'
  | 'custom_universal';

export type QuoteItemCategory = 'material' | 'labor' | 'logistics';

export interface QuoteLineItem {
  id: string;
  category: QuoteItemCategory;
  name: string;
  quantity: number;
  unit: string;
  unitCostUsd: number;
}

export interface MaterialRecipeItem {
  name: string;
  quantity: number;
  unit: string;
  unitCostUsd: number;
  wasteFactorPercent: number; // e.g. 10 for +10% waste
  totalCostUsd: number;
}

export interface ProratedQuoteLine {
  id: string;
  category: QuoteItemCategory;
  name: string;
  quantity: number;
  unit: string;
  rawUnitCostUsd: number;
  rawTotalUsd: number;
  proratedNetTotalUsd: number;
  proratedUnitPriceUsd: number;
  proratedTotalUsd: number;
}

export interface ProratedQuoteResult {
  lines: ProratedQuoteLine[];
  rawMaterialsUsd: number;
  wasteUsd: number;
  totalMaterialsUsd: number;
  totalLaborUsd: number;
  totalLogisticsUsd: number;
  subtotalCostUsd: number;
  profitUsd: number;
  grossTotalUsd: number;
  discountUsd: number;
  netBeforeTaxUsd: number;
  ivaUsd: number;
  igtfUsd: number;
  totalUsd: number;
}

/**
 * Pure commercial proration helper for Client PDF quotes.
 * Distributes waste, margin, discount, IVA, and IGTF proportionally across visible line items
 * and absorbs rounding residuals into the final active line so `sum(proratedTotalUsd) === totalUsd` strictly.
 */
export function computeProratedQuoteLines(
  lineItems: readonly QuoteLineItem[],
  wastePct = 0,
  profitPct = 0,
  discountPct = 0,
  ivaPct = 0,
  igtfPct = 0,
): ProratedQuoteResult {
  const safeWaste = Math.max(0, Number.isFinite(wastePct) ? wastePct : 0);
  const safeProfit = Math.max(0, Number.isFinite(profitPct) ? profitPct : 0);
  const safeDiscount = Math.max(0, Math.min(100, Number.isFinite(discountPct) ? discountPct : 0));
  const safeIva = Math.max(0, Number.isFinite(ivaPct) ? ivaPct : 0);
  const safeIgtf = Math.max(0, Number.isFinite(igtfPct) ? igtfPct : 0);

  let rawMaterialsUsd = 0;
  let totalLaborUsd = 0;
  let totalLogisticsUsd = 0;

  const baseEntries = lineItems.map((item) => {
    const qty = Math.max(0, Number.isFinite(item.quantity) ? item.quantity : 0);
    const unitCost = Math.max(0, Number.isFinite(item.unitCostUsd) ? item.unitCostUsd : 0);
    const rawTotal = roundMoney(qty * unitCost);
    if (item.category === 'material') rawMaterialsUsd += rawTotal;
    else if (item.category === 'labor') totalLaborUsd += rawTotal;
    else totalLogisticsUsd += rawTotal;

    const effectiveWeight =
      item.category === 'material' ? rawTotal * (1 + safeWaste / 100) : rawTotal;
    return { item, qty, unitCost, rawTotal, effectiveWeight };
  });

  rawMaterialsUsd = roundMoney(rawMaterialsUsd);
  totalLaborUsd = roundMoney(totalLaborUsd);
  totalLogisticsUsd = roundMoney(totalLogisticsUsd);

  const wasteUsd = roundMoney((rawMaterialsUsd * safeWaste) / 100);
  const totalMaterialsUsd = roundMoney(rawMaterialsUsd + wasteUsd);
  const subtotalCostUsd = roundMoney(totalMaterialsUsd + totalLaborUsd + totalLogisticsUsd);
  const profitUsd = roundMoney((subtotalCostUsd * safeProfit) / 100);
  const grossTotalUsd = roundMoney(subtotalCostUsd + profitUsd);
  const discountUsd = roundMoney((grossTotalUsd * safeDiscount) / 100);
  const netBeforeTaxUsd = Math.max(0, roundMoney(grossTotalUsd - discountUsd));
  const ivaUsd = roundMoney((netBeforeTaxUsd * safeIva) / 100);
  const igtfUsd = roundMoney(((netBeforeTaxUsd + ivaUsd) * safeIgtf) / 100);
  const totalUsd = roundMoney(netBeforeTaxUsd + ivaUsd + igtfUsd);

  const totalWeight = baseEntries.reduce((sum, entry) => sum + entry.effectiveWeight, 0);
  let lastPositiveIdx = -1;
  for (let idx = baseEntries.length - 1; idx >= 0; idx--) {
    if (baseEntries[idx].effectiveWeight > 0) {
      lastPositiveIdx = idx;
      break;
    }
  }
  if (lastPositiveIdx === -1 && baseEntries.length > 0) {
    lastPositiveIdx = baseEntries.length - 1;
  }

  let runningNet = 0;
  let runningTotal = 0;

  const lines: ProratedQuoteLine[] = baseEntries.map((entry, idx) => {
    const share =
      totalWeight > 0
        ? entry.effectiveWeight / totalWeight
        : baseEntries.length > 0
          ? 1 / baseEntries.length
          : 0;

    let proratedNet = roundMoney(netBeforeTaxUsd * share);
    let proratedTotal = roundMoney(totalUsd * share);

    if (idx === lastPositiveIdx) {
      proratedNet = roundMoney(netBeforeTaxUsd - runningNet);
      proratedTotal = roundMoney(totalUsd - runningTotal);
    } else if (entry.effectiveWeight > 0 || totalWeight === 0) {
      runningNet = roundMoney(runningNet + proratedNet);
      runningTotal = roundMoney(runningTotal + proratedTotal);
    } else {
      proratedNet = 0;
      proratedTotal = 0;
    }

    const proratedUnitPrice = entry.qty > 0 ? roundMoney(proratedTotal / entry.qty, 4) : 0;

    return {
      id: entry.item.id,
      category: entry.item.category,
      name: entry.item.name,
      quantity: entry.qty,
      unit: entry.item.unit,
      rawUnitCostUsd: entry.unitCost,
      rawTotalUsd: entry.rawTotal,
      proratedNetTotalUsd: proratedNet,
      proratedUnitPriceUsd: proratedUnitPrice,
      proratedTotalUsd: proratedTotal,
    };
  });

  return {
    lines,
    rawMaterialsUsd,
    wasteUsd,
    totalMaterialsUsd,
    totalLaborUsd,
    totalLogisticsUsd,
    subtotalCostUsd,
    profitUsd,
    grossTotalUsd,
    discountUsd,
    netBeforeTaxUsd,
    ivaUsd,
    igtfUsd,
    totalUsd,
  };
}

export interface BudgetQuote {
  id: string;
  quoteNumber: string;
  clientName: string;
  clientPhone?: string;
  clientDoc?: string;
  type: QuoteType;
  description: string;
  scopeDetails: Record<string, unknown>;
  materials: MaterialRecipeItem[];
  lineItems?: QuoteLineItem[];
  laborCostUsd: number;
  logisticsCostUsd?: number;
  laborType:
    | 'commission'
    | 'm2_rate'
    | 'daily_fixed'
    | 'hourly_rate'
    | 'project_fixed'
    | 'unit_markup';
  totalMaterialsCostUsd: number;
  subtotalCostUsd: number;
  profitMarginPercent: number;
  technicalWastePercent?: number;
  discountPercent?: number;
  ivaPercent?: number;
  igtfPercent?: number;
  ivaAmountUsd?: number;
  igtfAmountUsd?: number;
  totalPriceUsd: number;
  minimumAdvanceUsd: number; // custom advance (e.g. 50%)
  advancePercent?: number;
  bcvRateApplied: number;
  totalPriceVes: number;
  status: 'draft' | 'sent' | 'approved' | 'rejected' | 'completed';
  approvedAt?: string;
  advanceIncomeId?: string;
  receivableVaultId?: string;
  payrollLiabilityId?: string;
  version?: number;
  clientPdfUrl?: string;
  internalPdfUrl?: string;
  createdAt: string;
}

export interface WealthGoal {
  id: string;
  title: string;
  targetAmountUsd: number;
  currentAmountUsd: number;
  scope: FinanceScope;
  deadline?: string;
  category?: 'emergency' | 'equipment' | 'savings' | 'real_estate' | 'other';
  icon?: string;
  createdAt: string;
}

// -------------------------------------------------------------
// ESTADO CONSOLIDADO DEL LEDGER 360 (v2)
// -------------------------------------------------------------
export interface Finance360LedgerState {
  version: number;
  assets: AssetVault[];
  liabilities: LiabilityItem[];
  incomes: IncomeEntry[];
  expenses: ExpenseEntry[];
  casheaPlans: CasheaPlan[];
  providers: PymeProvider[];
  inventory: PymeInventoryItem[];
  quotes: BudgetQuote[];
  goals?: WealthGoal[];
  transfers?: TransferEntry[];
  casheaProfile?: CasheaUserProfile;
  casheaMerchantSales?: CasheaMerchantSale[];
  recurringRules?: RecurringRule[];
  pymeProfile?: PymeBusinessProfile;
  vaultReconciliations?: VaultReconciliationRecord[];
  lastUpdated: string;
}
