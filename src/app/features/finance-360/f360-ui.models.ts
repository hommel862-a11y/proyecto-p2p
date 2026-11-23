import type {
  AssetVault,
  CurrencyCode,
  FinanceScope,
  LiabilityItem,
  TransferEntry,
  VaultReconciliationRecord,
  WealthGoal,
} from '../../core/models/finance-360.models';
import type { UnifiedMovementItem } from '../../core/finance-360.service';

export const F360_NAV_TAB_ID = {
  OVERVIEW: 'overview',
  VAULTS: 'vaults',
  ANALYTICS: 'analytics',
  CASHEA: 'cashea',
  PYME_QUOTES: 'pyme_quotes',
} as const;
export type F360NavTabId = (typeof F360_NAV_TAB_ID)[keyof typeof F360_NAV_TAB_ID];

export const F360_HORIZON = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  QUARTER: 'quarter',
  YEAR: 'year',
} as const;
export type F360Horizon = (typeof F360_HORIZON)[keyof typeof F360_HORIZON];

export const F360_QUICK_ACTION_ID = {
  INCOME: 'income',
  EXPENSE: 'expense',
  TRANSFER: 'transfer',
  AUDIO: 'audio',
  NEW_VAULT: 'new_vault',
  NEW_LIABILITY: 'new_liability',
  NEW_GOAL: 'new_goal',
  IMPORT_P2P: 'import_p2p',
} as const;
export type F360QuickActionId = (typeof F360_QUICK_ACTION_ID)[keyof typeof F360_QUICK_ACTION_ID];

export const F360_OVERFLOW_ACTION_ID = {
  TOGGLE_PRIVACY: 'toggle_privacy',
  LOAD_DEMO: 'load_demo',
  CLEAR_DEMO: 'clear_demo',
  SYNC_DRIVE: 'sync_drive',
  EXPORT_JSON: 'export_json',
  RESTORE_JSON: 'restore_json',
  EXPORT_CSV_INCOMES: 'export_csv_incomes',
  EXPORT_CSV_EXPENSES: 'export_csv_expenses',
  EXPORT_CSV_LIABILITIES: 'export_csv_liabilities',
  REQUEST_RESET: 'request_reset',
} as const;
export type F360OverflowActionId =
  (typeof F360_OVERFLOW_ACTION_ID)[keyof typeof F360_OVERFLOW_ACTION_ID];

export const F360_KPI_TONE = {
  CYAN: 'cyan',
  EMERALD: 'emerald',
  VIOLET: 'violet',
  GOLD: 'gold',
  DANGER: 'danger',
  WARN: 'warn',
} as const;
export type F360KpiTone = (typeof F360_KPI_TONE)[keyof typeof F360_KPI_TONE];

export const F360_PNL_TONE = {
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  NEUTRAL: 'neutral',
  HIGHLIGHT: 'highlight',
} as const;
export type F360PnlTone = (typeof F360_PNL_TONE)[keyof typeof F360_PNL_TONE];

export const F360_UPCOMING_STATUS = {
  OVERDUE: 'overdue',
  UPCOMING: 'upcoming',
  PAID: 'paid',
} as const;
export type F360UpcomingStatus = (typeof F360_UPCOMING_STATUS)[keyof typeof F360_UPCOMING_STATUS];

export const F360_LIQUIDITY_STATUS = {
  OPTIMAL: 'optimal',
  WARNING: 'warning',
  CRITICAL: 'critical',
} as const;
export type F360LiquidityStatus =
  (typeof F360_LIQUIDITY_STATUS)[keyof typeof F360_LIQUIDITY_STATUS];

export const F360_ACTIVITY_KIND = {
  INCOME: 'income',
  EXPENSE: 'expense',
  TRANSFER: 'transfer',
} as const;
export type F360ActivityKind = (typeof F360_ACTIVITY_KIND)[keyof typeof F360_ACTIVITY_KIND];

export const F360_LEDGER_FILTER = {
  ALL: 'all',
  INCOME: 'income',
  EXPENSE: 'expense',
  TRANSFER: 'transfer',
} as const;
export type F360LedgerFilter = (typeof F360_LEDGER_FILTER)[keyof typeof F360_LEDGER_FILTER];

export interface F360HeroKpiCard {
  readonly id: string;
  readonly label: string;
  readonly primaryValue: string;
  readonly secondaryLabel: string;
  readonly deltaLabel?: string;
  readonly tone: F360KpiTone;
  readonly sparkline?: readonly number[];
  readonly targetTab?: F360NavTabId;
  readonly isSensitive?: boolean;
}

export interface F360CashflowSeriesPoint {
  readonly id: string;
  readonly dateIso: string;
  readonly label: string;
  readonly incomeUsd: number;
  readonly expenseUsd: number;
  readonly netUsd?: number;
}

export interface F360PnlLine {
  readonly id: string;
  readonly label: string;
  readonly amountUsd: number;
  readonly sharePct?: number;
  readonly tone: F360PnlTone;
  readonly sublabel?: string;
}

export interface F360OverviewUpcomingItem {
  readonly id: string;
  readonly title: string;
  readonly creditor: string;
  readonly dueDate: string;
  readonly daysDelta: number;
  readonly remainingUsd: number;
  readonly status: F360UpcomingStatus;
  readonly category: LiabilityItem['category'];
  readonly scope: FinanceScope;
  readonly rawLiability?: LiabilityItem;
}

export interface F360LiquiditySummary {
  readonly status: F360LiquidityStatus;
  readonly ratioPct: number;
  readonly due14DaysUsd: number;
  readonly liquidUsd: number;
  readonly overdueUsd: number;
  readonly overdueCount: number;
  readonly detailLabel?: string;
}

export interface F360LedgerRowItem {
  readonly id: string;
  readonly kind: F360ActivityKind;
  readonly title: string;
  readonly scope: FinanceScope;
  readonly categoryLabel: string;
  readonly vaultName: string;
  readonly vaultId?: string;
  readonly bcvRateApplied: number;
  readonly referenceNumber?: string;
  readonly amountUsd: number;
  readonly amountVes: number;
  readonly currency?: CurrencyCode;
  readonly date: string;
  readonly createdAt: string;
  readonly notes?: string;
  readonly editable?: boolean;
}

export interface F360VesExposureView {
  readonly vesBalanceTotal: number;
  readonly vesEquivalentUsd: number;
  readonly exposurePct: number;
  readonly rateGapPct: number;
  readonly erosionLoss5PctUsd: number;
  readonly isHighExposure: boolean;
}

export interface F360LedgerEditPayload {
  readonly id: string;
  readonly type: 'income' | 'expense';
  readonly title: string;
  readonly amountUsd: number;
}

export interface F360LedgerDeletePayload {
  readonly id: string;
  readonly type: 'income' | 'expense';
}

export interface F360VaultBalanceEditPayload {
  readonly vaultId: string;
  readonly balance: number;
}

export interface F360VaultReconcilePayload {
  readonly vaultId: string;
  readonly actualBalance: number;
}

export type {
  AssetVault,
  CurrencyCode,
  FinanceScope,
  LiabilityItem,
  TransferEntry,
  UnifiedMovementItem,
  VaultReconciliationRecord,
  WealthGoal,
};
