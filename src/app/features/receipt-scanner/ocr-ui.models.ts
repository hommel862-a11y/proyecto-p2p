import type {
  CurrencyCode,
  ExpenseCategory,
  FinanceScope,
  IncomeCategory,
} from '../../core/models/finance-360.models';

export type { CurrencyCode, ExpenseCategory, FinanceScope, IncomeCategory };

export type OcrDestinationMode = 'p2p' | 'finance360';

export type OcrRiskFilter =
  | 'all'
  | 'safe'
  | 'warning'
  | 'critical'
  | 'pending'
  | 'settled';

export type OcrOverflowActionId = 'screen_pipe' | 'export_csv' | 'clear_session';

export type OcrFinancePillar = 'expense' | 'income' | 'liability';

export interface OcrVaultOption {
  readonly id: string;
  readonly name: string;
  readonly currency: CurrencyCode;
}

export interface OcrKpiSummary {
  totalAudited: number;
  p2pCount: number;
  finance360Count: number;
  verifiedUsd: number;
  verifiedVes: number;
  bcvRate: number;
  safeCount: number;
  warningCount: number;
  criticalCount: number;
  safeRatePct: number;
  pendingCount: number;
  pendingUsd: number;
  casheaPendingCount: number;
}

export interface OcrBatchProgress {
  active: boolean;
  currentIndex: number;
  totalFiles: number;
  progressPct: number;
  statusLabel: string;
}

export interface OcrCounterpartySuggestion {
  id: string;
  name: string;
  documentId?: string;
  isBlacklisted: boolean;
}

export interface OcrRoutingState {
  scope: FinanceScope;
  pillar: OcrFinancePillar;
  expenseCategory: ExpenseCategory;
  incomeCategory: IncomeCategory;
  vaultId: string;
}

export interface OcrIdentityCrossCheck {
  expectedCounterparty: string;
  expectedId: string;
  expectedAmount: number | null;
}
