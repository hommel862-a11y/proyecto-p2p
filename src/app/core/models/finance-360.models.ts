/**
 * Domain Models for Portafolio Financiero, Pyme & Presupuestos 360.
 *
 * Strict Isolation: These models and their persistent store never disturb
 * or couple with the P2P trading ledger (`p2p.operations`).
 */

export type FinanceScope = 'all' | 'personal' | 'business';

export type PaymentChannel =
  | 'zelle'
  | 'bs_bank'
  | 'crypto'
  | 'cash'
  | 'receivable'
  | 'other';

export type IncomeCategory =
  | 'salary'
  | 'p2p_profit'
  | 'business_sale'
  | 'quote_advance'
  | 'freelance'
  | 'investment'
  | 'other';

export type ExpenseCategory =
  // Personal expenses
  | 'housing'
  | 'groceries'
  | 'health'
  | 'services'
  | 'education'
  | 'transport'
  | 'cashea_installment'
  | 'personal_care'
  | 'entertainment'
  // Business / SME expenses
  | 'provider_merchandise'
  | 'payroll'
  | 'rent'
  | 'utilities'
  | 'equipment_capex'
  | 'maintenance'
  | 'marketing'
  | 'taxes'
  | 'other';

export type CurrencyCode = 'USD' | 'VES' | 'USDT' | 'EUR';

export interface TriMonetaryAmount {
  amount_original: number;
  currency: CurrencyCode;
  bcv_rate: number;
  parallel_rate: number;
  amount_usd: number;
  amount_ves: number;
}

/**
 * Helper to compute tri-monetary representations deterministically.
 */
export function computeTriMonetaryAmount(
  amount: number,
  currency: CurrencyCode,
  bcvRate: number,
  parallelRate: number = bcvRate,
): TriMonetaryAmount {
  const safeBcv = bcvRate > 0 ? bcvRate : 1;
  const safeParallel = parallelRate > 0 ? parallelRate : safeBcv;
  let amountUsd = 0;
  let amountVes = 0;

  if (currency === 'USD' || currency === 'USDT') {
    amountUsd = Math.round(amount * 100) / 100;
    amountVes = Math.round(amount * safeBcv * 100) / 100;
  } else if (currency === 'VES') {
    amountVes = Math.round(amount * 100) / 100;
    amountUsd = Math.round((amount / safeBcv) * 100) / 100;
  } else if (currency === 'EUR') {
    // Standard estimation anchored via BCV/Parallel ratio
    amountUsd = Math.round(amount * 1.08 * 100) / 100;
    amountVes = Math.round(amountUsd * safeBcv * 100) / 100;
  }

  return {
    amount_original: amount,
    currency,
    bcv_rate: safeBcv,
    parallel_rate: safeParallel,
    amount_usd: amountUsd,
    amount_ves: amountVes,
  };
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
  dueDate: string; // YYYY-MM-DD
  status: 'pending' | 'partially_paid' | 'paid' | 'overdue';
  amountPaid: number;
  remainingAmount: number;
  notes?: string;
  casheaPlanId?: string;
  providerId?: string;
  createdAt: string;
  updatedAt: string;
}

// -------------------------------------------------------------
// PILAR 3: ENTRADAS (Ingresos, Sueldo, Ganancia Neta P2P)
// -------------------------------------------------------------
export interface IncomeEntry {
  id: string;
  title: string;
  scope: FinanceScope;
  category: IncomeCategory;
  channel: PaymentChannel;
  vaultId?: string;
  triMonetary: TriMonetaryAmount;
  date: string; // YYYY-MM-DD
  referenceNumber?: string;
  notes?: string;
  p2pBridgeMetadata?: {
    operationsCount: number;
    realizedPnlVes: number;
    realizedPnlUsdt: number;
    importedAt: string;
  };
  drawerAllocations?: {
    drawer1Usd: number;
    drawer2Usd: number;
    drawer3Usd: number;
  };
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
  date: string; // YYYY-MM-DD
  referenceNumber?: string;
  notes?: string;
  drawerAllocation?: 'drawer_merchandise' | 'drawer_operations' | 'drawer_capex';
  receiptPdfUrl?: string;
  createdAt: string;
}

// -------------------------------------------------------------
// SUB-MÓDULO 1: CASHEA & FINANCIAMIENTOS
// -------------------------------------------------------------
export type CasheaLevel = 1 | 2 | 3 | 4 | 5;

export interface CasheaInstallment {
  number: number;
  dueDate: string; // YYYY-MM-DD
  amountUsd: number;
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
  totalPriceUsd: number;
  initialPaymentUsd: number;
  initialPercentage: number;
  numberOfInstallments: number;
  installmentAmountUsd: number;
  installmentFrequencyDays: number; // default 14
  startDate: string;
  installments: CasheaInstallment[];
  status: 'active' | 'completed' | 'cancelled';
  createdAt: string;
}

// -------------------------------------------------------------
// SUB-MÓDULO 2: GESTIÓN PYME / NEGOCIO
// -------------------------------------------------------------
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
  laborType: 'commission' | 'm2_rate' | 'daily_fixed' | 'hourly_rate' | 'project_fixed' | 'unit_markup';
  totalMaterialsCostUsd: number;
  subtotalCostUsd: number;
  profitMarginPercent: number;
  technicalWastePercent?: number;
  discountPercent?: number;
  totalPriceUsd: number;
  minimumAdvanceUsd: number; // custom advance (e.g. 50%)
  advancePercent?: number;
  bcvRateApplied: number;
  totalPriceVes: number;
  status: 'draft' | 'sent' | 'approved' | 'rejected' | 'completed';
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
// ESTADO CONSOLIDADO DEL LEDGER 360
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
  lastUpdated: string;
}
