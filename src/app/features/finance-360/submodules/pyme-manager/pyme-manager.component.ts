import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Finance360Service } from '../../../../core/finance-360.service';
import { ToastService } from '../../../../core/toast.service';
import {
  CURRENCY_CODE,
  PYME_DRAWER_KEY,
  RECURRING_FREQUENCY,
  calendarDaysBetween,
  getDrawerForExpenseCategory,
  roundMoney,
  todayVetIso,
  type AssetVault,
  type CasheaMerchantSale,
  type CasheaMerchantSaleSimulation,
  type CurrencyCode,
  type ExpenseCategory,
  type ExpenseEntry,
  type IncomeCategory,
  type LiabilityItem,
  type PymeDrawerKey,
  type PymeInventoryItem,
  type PymeProvider,
  type RecurringFrequency,
  type RecurringRule,
} from '../../../../core/models/finance-360.models';

export const PYME_TAB = {
  DRAWERS: 'drawers',
  PROVIDERS: 'providers',
  INVENTORY: 'inventory',
  RECURRING: 'recurring',
  CASHEA_ALLY: 'cashea_ally',
} as const;
export type PymeTab = (typeof PYME_TAB)[keyof typeof PYME_TAB];

export const PYME_INFLOW_TYPE = {
  SALE: 'sale',
  CAPITAL_INJECTION: 'capital_injection',
} as const;
export type PymeInflowType = (typeof PYME_INFLOW_TYPE)[keyof typeof PYME_INFLOW_TYPE];

export const RECURRING_RULE_TYPE = {
  EXPENSE: 'expense',
  LIABILITY: 'liability',
  INCOME: 'income',
} as const;
export type RecurringRuleType = (typeof RECURRING_RULE_TYPE)[keyof typeof RECURRING_RULE_TYPE];

export interface DrawerPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly d1: number;
  readonly d2: number;
  readonly d3: number;
}

export interface DrawerAuditMeta {
  readonly drawerKey: PymeDrawerKey;
  readonly label: string;
  readonly toneClass: 'tone-cyan' | 'tone-warn' | 'tone-emerald';
}

export interface ProviderUnifiedRow {
  readonly provider: PymeProvider;
  readonly unifiedDebtUsd: number;
  readonly linkedOpenCount: number;
  readonly hasOverdue: boolean;
  readonly earliestDueDate: string | null;
}

export interface CasheaMdrPreset {
  readonly id: string;
  readonly label: string;
  readonly mdrPercent: number;
}

export interface CategoryOption {
  readonly value: ExpenseCategory | IncomeCategory;
  readonly label: string;
}

const DRAWER_PRESETS: readonly DrawerPreset[] = [
  {
    id: 'workshop',
    label: 'Taller / Comercio',
    description: '50% Insumos · 30% Operativa · 20% Utilidad',
    d1: 50,
    d2: 30,
    d3: 20,
  },
  {
    id: 'services',
    label: 'Servicios / Nómina',
    description: '20% Insumos · 60% Operativa · 20% Utilidad',
    d1: 20,
    d2: 60,
    d3: 20,
  },
  {
    id: 'production',
    label: 'Obras / Materiales',
    description: '60% Insumos · 25% Operativa · 15% Utilidad',
    d1: 60,
    d2: 25,
    d3: 15,
  },
  {
    id: 'custom',
    label: 'Personalizado',
    description: 'Distribución porcentual a medida',
    d1: 34,
    d2: 33,
    d3: 33,
  },
];

const CASHEA_MDR_PRESETS: readonly CasheaMdrPreset[] = [
  { id: 'supermarket', label: 'Supermercado', mdrPercent: 3 },
  { id: 'retail', label: 'Retail / Taller', mdrPercent: 4 },
  { id: 'restaurant', label: 'Restaurante', mdrPercent: 5 },
  { id: 'online', label: 'Comercio Online', mdrPercent: 6 },
];

const BUSINESS_EXPENSE_CATEGORIES: readonly CategoryOption[] = [
  { value: 'payroll', label: 'Nómina de Personal' },
  { value: 'rent', label: 'Alquiler Comercial' },
  { value: 'utilities', label: 'Servicios Locales (Luz / Internet)' },
  { value: 'services', label: 'Servicios Operativos' },
  { value: 'provider_merchandise', label: 'Reposición / Proveedor' },
  { value: 'maintenance', label: 'Mantenimiento / Taller' },
  { value: 'taxes', label: 'Impuestos y Tributos' },
  { value: 'marketing', label: 'Marketing y Publicidad' },
  { value: 'equipment_capex', label: 'Equipos / CAPEX' },
  { value: 'other', label: 'Otro Gasto Operativo' },
];

const BUSINESS_INCOME_CATEGORIES: readonly CategoryOption[] = [
  { value: 'business_sale', label: 'Venta Comercial Recurrente' },
  { value: 'freelance', label: 'Iguala / Honorarios' },
  { value: 'other', label: 'Otro Ingreso Comercial' },
];

@Component({
  selector: 'app-pyme-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pyme-manager.component.html',
  styleUrls: ['./pyme-manager.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.privacy-active]': 'privacyMode()',
  },
})
export class PymeManagerComponent {
  readonly financeService = inject(Finance360Service);
  private readonly toast = inject(ToastService);

  readonly privacyMode = input<boolean>(false);

  readonly drawerPresets = DRAWER_PRESETS;
  readonly mdrPresets = CASHEA_MDR_PRESETS;
  readonly currencyOptions: readonly CurrencyCode[] = [
    CURRENCY_CODE.USD,
    CURRENCY_CODE.VES,
    CURRENCY_CODE.USDT,
    CURRENCY_CODE.EUR,
  ];

  // Navigation & Opt-In Cashea Ally
  readonly activePymeTab = signal<PymeTab>(PYME_TAB.DRAWERS);

  readonly casheaAllyEnabled = computed<boolean>(
    () => this.financeService.pymeProfile().casheaAllyModeEnabled,
  );

  readonly effectiveActiveTab = computed<PymeTab>(() => {
    const tab = this.activePymeTab();
    if (tab === PYME_TAB.CASHEA_ALLY && !this.casheaAllyEnabled()) {
      return PYME_TAB.DRAWERS;
    }
    return tab;
  });

  // Real Vaults (zero hardcoded ghost IDs)
  readonly availableVaults = computed<readonly AssetVault[]>(() =>
    this.financeService.state().assets,
  );

  readonly liquidVaults = computed<readonly AssetVault[]>(() =>
    this.availableVaults().filter((v) => v.channel !== 'receivable'),
  );

  readonly targetVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.liquidVaults,
    computation: (vaults, prev) => this.resolveDefaultVaultId(vaults, prev?.value),
  });

  readonly payrollVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.liquidVaults,
    computation: (vaults, prev) => this.resolveDefaultVaultId(vaults, prev?.value),
  });

  readonly disburseVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.liquidVaults,
    computation: (vaults, prev) => this.resolveDefaultVaultId(vaults, prev?.value),
  });

  readonly selectedProviderVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.liquidVaults,
    computation: (vaults, prev) => this.resolveDefaultVaultId(vaults, prev?.value),
  });

  readonly restockVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.liquidVaults,
    computation: (vaults, prev) => this.resolveDefaultVaultId(vaults, prev?.value),
  });

  readonly recVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.liquidVaults,
    computation: (vaults, prev) => this.resolveDefaultVaultId(vaults, prev?.value),
  });

  readonly casheaSettleVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.liquidVaults,
    computation: (vaults, prev) => this.resolveDefaultVaultId(vaults, prev?.value),
  });

  // -------------------------------------------------------------
  // TAB 1: 3-DRAWER FIREWALL
  // -------------------------------------------------------------
  readonly inflowType = signal<PymeInflowType>(PYME_INFLOW_TYPE.SALE);
  readonly saleConcept = signal<string>('');
  readonly saleAmount = signal<number | null>(250);
  readonly activePreset = signal<string>('workshop');
  readonly drawer1Percent = signal<number>(50);
  readonly drawer2Percent = signal<number>(30);
  readonly drawer3Percent = signal<number>(20);

  readonly percentSum = computed<number>(
    () =>
      Number(this.drawer1Percent() || 0) +
      Number(this.drawer2Percent() || 0) +
      Number(this.drawer3Percent() || 0),
  );

  readonly drawerSplit = computed(() => {
    const sale = Math.max(0, Number(this.saleAmount() ?? 0));
    const bcv = this.financeService.currentBcvRate();
    const d1 = roundMoney((sale * (this.drawer1Percent() || 0)) / 100);
    const d2 = roundMoney((sale * (this.drawer2Percent() || 0)) / 100);
    const d3 = roundMoney(sale - d1 - d2);

    return {
      totalUsd: roundMoney(sale),
      totalVes: bcv > 0 ? roundMoney(sale * bcv) : 0,
      drawer1: { usd: d1, ves: bcv > 0 ? roundMoney(d1 * bcv) : 0 },
      drawer2: { usd: d2, ves: bcv > 0 ? roundMoney(d2 * bcv) : 0 },
      drawer3: { usd: d3, ves: bcv > 0 ? roundMoney(d3 * bcv) : 0 },
    };
  });

  readonly recentDrawerMovements = computed<readonly ExpenseEntry[]>(() => {
    const businessVaultIds = new Set(
      this.financeService
        .state()
        .assets.filter((a) => a.scope === 'business')
        .map((a) => a.id),
    );
    return this.financeService
      .state()
      .expenses.filter(
        (e) =>
          Boolean(e.drawerAllocation) ||
          e.scope === 'business' ||
          (e.vaultId ? businessVaultIds.has(e.vaultId) : false),
      )
      .slice(0, 12);
  });

  // Payroll Modal State (fixed default matching <select> options)
  readonly showPayrollModal = signal<boolean>(false);
  readonly payrollEmployeeName = signal<string>('');
  readonly payrollPeriod = signal<string>('Quincena 1');
  readonly payrollAmountUsd = signal<number | null>(null);
  readonly payrollRef = signal<string>('');
  readonly payrollNotes = signal<string>('');

  // General Drawer Disbursement Modal State
  readonly showDisbursementModal = signal<boolean>(false);
  readonly disburseDrawer = signal<1 | 2 | 3>(1);
  readonly disburseTitle = signal<string>('');
  readonly disburseCategory = signal<ExpenseCategory>('provider_merchandise');
  readonly disburseAmountUsd = signal<number | null>(null);
  readonly disburseRef = signal<string>('');
  readonly disburseNotes = signal<string>('');

  // -------------------------------------------------------------
  // TAB 2: PROVIDERS CxP (UNIFIED WITH LIABILITIES)
  // -------------------------------------------------------------
  readonly showAddProviderModal = signal<boolean>(false);
  readonly provName = signal<string>('');
  readonly provCategory = signal<string>('Insumos y Repuestos');
  readonly provPhone = signal<string>('');
  readonly provBankDetails = signal<string>('');
  readonly provDebt = signal<number | null>(0);
  readonly providerPaymentDrafts = signal<Record<string, number | null>>({});

  readonly providers = computed<readonly PymeProvider[]>(
    () => this.financeService.state().providers,
  );

  readonly providerRows = computed<readonly ProviderUnifiedRow[]>(() => {
    const today = todayVetIso();
    const openLiabilities = this.financeService
      .state()
      .liabilities.filter((l) => l.status !== 'paid');

    return this.providers().map((provider) => {
      const linked = openLiabilities.filter((l) => l.providerId === provider.id);
      const unifiedDebtUsd =
        linked.length > 0
          ? roundMoney(linked.reduce((sum, l) => sum + l.remainingAmount, 0))
          : roundMoney(provider.outstandingDebtUsd);

      const sortedDates = linked
        .map((l) => l.dueDate)
        .filter((d) => Boolean(d))
        .sort((a, b) => calendarDaysBetween(b, a));

      const hasOverdue = linked.some(
        (l) => l.status === 'overdue' || calendarDaysBetween(today, l.dueDate) < 0,
      );

      return {
        provider,
        unifiedDebtUsd,
        linkedOpenCount: linked.length,
        hasOverdue,
        earliestDueDate: sortedDates[0] ?? null,
      };
    });
  });

  readonly totalProviderDebtUsd = computed<number>(() =>
    roundMoney(this.providerRows().reduce((acc, row) => acc + row.unifiedDebtUsd, 0)),
  );

  // -------------------------------------------------------------
  // TAB 3: INVENTORY SEMÁFORO & COLD MERCHANDISE
  // -------------------------------------------------------------
  readonly showItemModal = signal<boolean>(false);
  readonly editingItemId = signal<string | null>(null);
  readonly itemName = signal<string>('');
  readonly itemSku = signal<string>('');
  readonly itemCategory = signal<string>('Insumos Generales');
  readonly itemStock = signal<number | null>(10);
  readonly itemMinStock = signal<number | null>(4);
  readonly itemOptimalStock = signal<number | null>(12);
  readonly itemCost = signal<number | null>(15);
  readonly itemPrice = signal<number | null>(25);

  readonly showRestockModal = signal<boolean>(false);
  readonly restockTargetItem = signal<PymeInventoryItem | null>(null);
  readonly restockQuantity = signal<number | null>(5);
  readonly restockMode = signal<'vault' | 'provider_credit'>('vault');

  readonly restockProviderId = linkedSignal<readonly PymeProvider[], string>({
    source: this.providers,
    computation: (providers, prev) => {
      if (prev?.value && providers.some((p) => p.id === prev.value)) {
        return prev.value;
      }
      return providers[0]?.id ?? '';
    },
  });

  readonly inventory = computed<readonly PymeInventoryItem[]>(
    () => this.financeService.state().inventory,
  );

  readonly inventoryOptimalCount = computed<number>(
    () => this.inventory().filter((i) => i.currentStock > i.minimumStock).length,
  );

  readonly inventoryLowCount = computed<number>(
    () =>
      this.inventory().filter((i) => i.currentStock > 0 && i.currentStock <= i.minimumStock).length,
  );

  readonly inventoryCriticalCount = computed<number>(
    () => this.inventory().filter((i) => i.currentStock <= 0).length,
  );

  readonly coldInventoryItems = computed<readonly PymeInventoryItem[]>(() => {
    this.inventory();
    return this.financeService.getColdInventoryItems(45);
  });

  readonly coldInventoryIds = computed<ReadonlySet<string>>(
    () => new Set(this.coldInventoryItems().map((item) => item.id)),
  );

  // -------------------------------------------------------------
  // TAB 4: RECURRING RULES ENGINE
  // -------------------------------------------------------------
  readonly showRecurringForm = signal<boolean>(false);
  readonly recTitle = signal<string>('');
  readonly recType = signal<RecurringRuleType>(RECURRING_RULE_TYPE.EXPENSE);
  readonly recCategory = signal<ExpenseCategory | IncomeCategory>('rent');
  readonly recFrequency = signal<RecurringFrequency>(RECURRING_FREQUENCY.MONTHLY);
  readonly recCurrency = signal<CurrencyCode>(CURRENCY_CODE.USD);
  readonly recAmount = signal<number | null>(null);
  readonly recNextDueDate = signal<string>(todayVetIso());
  readonly recNotes = signal<string>('');

  readonly recurringRules = computed<readonly RecurringRule[]>(() =>
    this.financeService.recurringRules(),
  );

  readonly activeRecurringCount = computed<number>(
    () => this.recurringRules().filter((r) => r.active).length,
  );

  readonly dueRecurringCount = computed<number>(() => {
    const today = todayVetIso();
    return this.recurringRules().filter(
      (r) => r.active && calendarDaysBetween(r.nextDueDate, today) >= 0,
    ).length;
  });

  readonly availableRecurringCategories = computed<readonly CategoryOption[]>(() =>
    this.recType() === RECURRING_RULE_TYPE.INCOME
      ? BUSINESS_INCOME_CATEGORIES
      : BUSINESS_EXPENSE_CATEGORIES,
  );

  // -------------------------------------------------------------
  // TAB 5 (OPT-IN): CASHEA PARA NEGOCIOS (MODO ALIADO)
  // -------------------------------------------------------------
  readonly allySaleTitle = signal<string>('Venta Retail Cashea');
  readonly allyCustomerName = signal<string>('');
  readonly allyGrossSaleUsd = signal<number | null>(100);
  readonly allyCostOfGoodsUsd = signal<number | null>(65);
  readonly allyMdrPercent = signal<number>(4);
  readonly allyUseWeeklyAdvance = signal<boolean>(false);
  readonly allyWeeklyAdvancePercent = signal<number>(3);
  readonly allyBcvOverride = signal<number | null>(null);
  readonly allyParallelOverride = signal<number | null>(null);
  readonly allyMonthlyMinimumUsd = signal<number>(100);
  readonly allyActivationFeeUsd = signal<number>(100);

  readonly effectiveAllyBcvRate = computed<number>(() => {
    const custom = this.allyBcvOverride();
    if (typeof custom === 'number' && Number.isFinite(custom) && custom > 0) {
      return custom;
    }
    return this.financeService.currentBcvRate();
  });

  readonly effectiveAllyParallelRate = computed<number>(() => {
    const custom = this.allyParallelOverride();
    if (typeof custom === 'number' && Number.isFinite(custom) && custom > 0) {
      return custom;
    }
    return this.financeService.currentParallelRate();
  });

  readonly casheaAllySimulation = computed<CasheaMerchantSaleSimulation>(() =>
    this.financeService.simulateCasheaMerchantSale({
      grossSaleUsd: Math.max(0, Number(this.allyGrossSaleUsd() ?? 0)),
      costOfGoodsUsd: Math.max(0, Number(this.allyCostOfGoodsUsd() ?? 0)),
      mdrPercent: Math.max(0, Number(this.allyMdrPercent() ?? 0)),
      useWeeklyAdvance: this.allyUseWeeklyAdvance(),
      weeklyAdvanceFeePercent: this.allyWeeklyAdvancePercent(),
      bcvRate: this.effectiveAllyBcvRate(),
      parallelReplacementRate: this.effectiveAllyParallelRate(),
      monthlyMinimumFeeUsd: Math.max(0, Number(this.allyMonthlyMinimumUsd() ?? 100)),
      activationFeeUsd: Math.max(0, Number(this.allyActivationFeeUsd() ?? 0)),
    }),
  );

  readonly merchantSales = computed<readonly CasheaMerchantSale[]>(() =>
    this.financeService.casheaMerchantSales(),
  );

  readonly pendingMerchantSalesStats = computed(() => {
    const pending = this.merchantSales().filter((s) => s.status === 'pending_settlement');
    const settled = this.merchantSales().filter((s) => s.status === 'settled');
    return {
      pendingCount: pending.length,
      pendingReceivableUsd: roundMoney(pending.reduce((sum, s) => sum + s.netReceivableUsd, 0)),
      settledCount: settled.length,
      settledTotalUsd: roundMoney(settled.reduce((sum, s) => sum + s.netReceivableUsd, 0)),
    };
  });

  // -------------------------------------------------------------
  // NAVIGATION & OPT-IN TOGGLE
  // -------------------------------------------------------------

  selectTab(tab: PymeTab): void {
    if (tab === PYME_TAB.CASHEA_ALLY && !this.casheaAllyEnabled()) {
      this.activePymeTab.set(PYME_TAB.DRAWERS);
      return;
    }
    this.activePymeTab.set(tab);
  }

  toggleCasheaAllyMode(enabled: boolean): void {
    this.financeService.updatePymeProfile({ casheaAllyModeEnabled: enabled });
    if (!enabled && this.activePymeTab() === PYME_TAB.CASHEA_ALLY) {
      this.activePymeTab.set(PYME_TAB.DRAWERS);
    }
    this.toast.info(
      enabled
        ? 'Modo Aliado Cashea habilitado en Gestión Pyme.'
        : 'Modo Aliado Cashea desactivado.',
    );
  }

  onCasheaAllySwitchChange(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    if (el) this.toggleCasheaAllyMode(el.checked);
  }

  onWeeklyAdvanceToggle(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    if (el) this.allyUseWeeklyAdvance.set(el.checked);
  }

  // -------------------------------------------------------------
  // DRAWERS ACTIONS
  // -------------------------------------------------------------

  applyPreset(preset: DrawerPreset): void {
    this.activePreset.set(preset.id);
    this.drawer1Percent.set(preset.d1);
    this.drawer2Percent.set(preset.d2);
    this.drawer3Percent.set(preset.d3);
  }

  setCustomPercent(drawer: 1 | 2 | 3, value: number): void {
    this.activePreset.set('custom');
    const clamped = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    if (drawer === 1) this.drawer1Percent.set(clamped);
    if (drawer === 2) this.drawer2Percent.set(clamped);
    if (drawer === 3) this.drawer3Percent.set(clamped);
  }

  settleSaleInLedger(): void {
    const amount = Number(this.saleAmount() ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.toast.warn('Ingrese un monto mayor a cero.');
      return;
    }
    if (this.percentSum() !== 100) {
      this.toast.warn(
        `La suma de las 3 gavetas debe ser exactamente 100% (actual: ${this.percentSum()}%).`,
      );
      return;
    }

    const split = this.drawerSplit();
    const isInjection = this.inflowType() === PYME_INFLOW_TYPE.CAPITAL_INJECTION;
    const vaultId = this.targetVaultId() || undefined;
    const vaultName = this.getVaultName(vaultId);

    const defaultTitle = isInjection
      ? 'Aporte de Capital a 3 Gavetas'
      : 'Venta Comercial Pyme';
    const title = this.saleConcept().trim() || defaultTitle;

    this.financeService.settlePymeSaleWithDrawers({
      title,
      totalUsd: split.totalUsd,
      vaultId,
      drawer1Usd: split.drawer1.usd,
      drawer2Usd: split.drawer2.usd,
      drawer3Usd: split.drawer3.usd,
      isInitialInjection: isInjection,
    });

    this.saleConcept.set('');
    this.toast.success(
      isInjection
        ? `Aporte de $${split.totalUsd.toFixed(2)} USD acreditado en ${vaultName} y distribuido en 3 Gavetas.`
        : `Venta de $${split.totalUsd.toFixed(2)} USD acreditada en ${vaultName} y distribuida en 3 Gavetas.`,
    );
  }

  openPayrollModal(suggestedAmount?: number): void {
    if (suggestedAmount !== undefined && suggestedAmount > 0) {
      this.payrollAmountUsd.set(suggestedAmount);
    }
    this.showPayrollModal.set(true);
  }

  closePayrollModal(): void {
    this.showPayrollModal.set(false);
  }

  confirmPayrollDisbursement(): void {
    const employee = this.payrollEmployeeName().trim();
    const amount = Number(this.payrollAmountUsd() ?? 0);
    if (!employee) {
      this.toast.warn('Ingrese el nombre o cargo del colaborador.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      this.toast.warn('Ingrese un monto de nómina mayor a cero.');
      return;
    }

    const vaultId = this.payrollVaultId();
    const live = this.financeService.pymeDrawersTelemetry();
    if (amount > live.drawer2AvailableUsd) {
      this.toast.warn(
        `Sobregiro en Gaveta 2: el pago ($${amount.toFixed(2)} USD) supera el disponible actual (${this.formatSignedUsd(live.drawer2AvailableUsd)} USD).`,
      );
    }

    this.financeService.executePayrollExpense({
      employeeName: employee,
      amountUsd: amount,
      vaultId,
      period: this.payrollPeriod(),
      notes: this.payrollNotes().trim() || undefined,
      referenceNumber: this.payrollRef().trim() || undefined,
    });

    this.toast.success(
      `Nómina de $${amount.toFixed(2)} USD a ${employee} liquidada desde ${this.getVaultName(vaultId)}.`,
    );

    this.payrollEmployeeName.set('');
    this.payrollAmountUsd.set(null);
    this.payrollRef.set('');
    this.payrollNotes.set('');
    this.showPayrollModal.set(false);
  }

  openDisbursementModal(drawer: 1 | 2 | 3, defaultAmount?: number): void {
    this.disburseDrawer.set(drawer);
    this.disburseAmountUsd.set(defaultAmount ?? null);
    if (drawer === 1) {
      this.disburseTitle.set('Compra de Insumos / Reposición');
      this.disburseCategory.set('provider_merchandise');
    } else if (drawer === 2) {
      this.disburseTitle.set('Gasto Operativo / Servicios Fijos');
      this.disburseCategory.set('services');
    } else {
      this.disburseTitle.set('Inversión CAPEX / Retiro Socios');
      this.disburseCategory.set('equipment_capex');
    }
    this.showDisbursementModal.set(true);
  }

  closeDisbursementModal(): void {
    this.showDisbursementModal.set(false);
  }

  confirmDisbursement(): void {
    const title = this.disburseTitle().trim();
    const amount = Number(this.disburseAmountUsd() ?? 0);
    const drawer = this.disburseDrawer();
    if (!title) {
      this.toast.warn('Ingrese el concepto del desembolso.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      this.toast.warn('Ingrese un monto mayor a cero.');
      return;
    }

    const vaultId = this.disburseVaultId();
    this.financeService.executeDrawerDisbursement({
      drawer,
      title,
      amountUsd: amount,
      vaultId,
      category: this.disburseCategory(),
      notes: this.disburseNotes().trim() || undefined,
      referenceNumber: this.disburseRef().trim() || undefined,
    });

    this.toast.success(
      `Desembolso de $${amount.toFixed(2)} USD registrado en Gaveta ${drawer} (${this.getVaultName(vaultId)}).`,
    );

    this.disburseTitle.set('');
    this.disburseAmountUsd.set(null);
    this.disburseRef.set('');
    this.disburseNotes.set('');
    this.showDisbursementModal.set(false);
  }

  getDrawerAuditMeta(exp: ExpenseEntry): DrawerAuditMeta {
    const drawerKey: PymeDrawerKey =
      exp.drawerAllocation ?? getDrawerForExpenseCategory(exp.category);
    if (drawerKey === PYME_DRAWER_KEY.MERCHANDISE) {
      return {
        drawerKey,
        label: 'Gaveta 1 · Insumos',
        toneClass: 'tone-cyan',
      };
    }
    if (drawerKey === PYME_DRAWER_KEY.CAPEX) {
      return {
        drawerKey,
        label: 'Gaveta 3 · CAPEX',
        toneClass: 'tone-emerald',
      };
    }
    return {
      drawerKey,
      label: 'Gaveta 2 · Operativa',
      toneClass: 'tone-warn',
    };
  }

  // -------------------------------------------------------------
  // PROVIDERS CxP ACTIONS
  // -------------------------------------------------------------

  getProviderUnifiedDebtUsd(providerId: string): number {
    const row = this.providerRows().find((r) => r.provider.id === providerId);
    return row ? row.unifiedDebtUsd : 0;
  }

  getProviderPaymentAmount(providerId: string): number | null {
    return this.providerPaymentDrafts()[providerId] ?? null;
  }

  setProviderPaymentAmount(providerId: string, amount: number | null): void {
    this.providerPaymentDrafts.update((drafts) => ({
      ...drafts,
      [providerId]: amount,
    }));
  }

  saveProvider(): void {
    const name = this.provName().trim();
    if (!name) {
      this.toast.warn('Ingrese el nombre del proveedor.');
      return;
    }

    this.financeService.addProvider({
      name,
      category: this.provCategory().trim() || 'General',
      phone: this.provPhone().trim() || 'No especificado',
      bankDetails: this.provBankDetails().trim() || 'Transferencia / Pago Móvil',
      outstandingDebtUsd: Math.max(0, Number(this.provDebt() ?? 0)),
    });

    this.toast.success(`Proveedor "${name}" registrado y conciliado con Pasivos.`);
    this.provName.set('');
    this.provPhone.set('');
    this.provBankDetails.set('');
    this.provDebt.set(0);
    this.showAddProviderModal.set(false);
  }

  submitCustomProviderPayment(provider: PymeProvider): void {
    const unifiedDebt = this.getProviderUnifiedDebtUsd(provider.id);
    const amount = Number(this.getProviderPaymentAmount(provider.id) ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.toast.warn('Ingrese un monto de abono válido mayor a cero.');
      return;
    }
    if (amount > unifiedDebt) {
      this.toast.warn(
        `El abono ($${amount.toFixed(2)}) excede la deuda conciliada ($${unifiedDebt.toFixed(2)} USD).`,
      );
      return;
    }
    this.payProviderDebt(provider, amount);
    this.setProviderPaymentAmount(provider.id, null);
  }

  settleProviderFullDebt(provider: PymeProvider): void {
    const unifiedDebt = this.getProviderUnifiedDebtUsd(provider.id);
    if (unifiedDebt <= 0) {
      this.toast.info('Este proveedor no tiene saldo pendiente.');
      return;
    }
    this.payProviderDebt(provider, unifiedDebt);
    this.setProviderPaymentAmount(provider.id, null);
  }

  payProviderDebt(provider: PymeProvider, amountUsd: number): void {
    const unifiedDebt = this.getProviderUnifiedDebtUsd(provider.id);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > unifiedDebt) {
      this.toast.warn('Monto de abono inválido.');
      return;
    }

    const vaultId = this.selectedProviderVaultId() || undefined;
    this.financeService.payProviderWithVault(provider.id, amountUsd, vaultId);
    const remaining = this.getProviderUnifiedDebtUsd(provider.id);

    this.toast.success(
      `Abono de $${amountUsd.toFixed(2)} USD a ${provider.name} debitado de ${this.getVaultName(vaultId)}. Restante: $${remaining.toFixed(2)} USD.`,
    );
  }

  deleteProvider(provider: PymeProvider): void {
    this.financeService.deleteProvider(provider.id);
    this.toast.info(`Proveedor "${provider.name}" eliminado.`);
  }

  // -------------------------------------------------------------
  // INVENTORY ACTIONS
  // -------------------------------------------------------------

  openAddItemModal(): void {
    this.editingItemId.set(null);
    this.itemName.set('');
    this.itemSku.set('');
    this.itemCategory.set('Insumos Generales');
    this.itemStock.set(10);
    this.itemMinStock.set(4);
    this.itemOptimalStock.set(12);
    this.itemCost.set(15);
    this.itemPrice.set(25);
    this.showItemModal.set(true);
  }

  openEditItemModal(item: PymeInventoryItem): void {
    this.editingItemId.set(item.id);
    this.itemName.set(item.name);
    this.itemSku.set(item.sku ?? '');
    this.itemCategory.set(item.category);
    this.itemStock.set(item.currentStock);
    this.itemMinStock.set(item.minimumStock);
    this.itemOptimalStock.set(item.optimalStock);
    this.itemCost.set(item.unitCostUsd);
    this.itemPrice.set(item.sellingPriceUsd);
    this.showItemModal.set(true);
  }

  closeItemModal(): void {
    this.showItemModal.set(false);
    this.editingItemId.set(null);
  }

  saveInventoryItem(): void {
    const name = this.itemName().trim();
    if (!name) {
      this.toast.warn('Ingrese la descripción del artículo.');
      return;
    }

    const minStock = Math.max(0, Number(this.itemMinStock() ?? 0));
    const optimalRaw = Number(this.itemOptimalStock() ?? minStock * 2);
    const optimalStock = Math.max(minStock, optimalRaw);
    const payload = {
      name,
      sku: this.itemSku().trim() || undefined,
      category: this.itemCategory().trim() || 'General',
      currentStock: Math.max(0, Number(this.itemStock() ?? 0)),
      minimumStock: minStock,
      optimalStock,
      unitCostUsd: Math.max(0, Number(this.itemCost() ?? 0)),
      sellingPriceUsd: Math.max(0, Number(this.itemPrice() ?? 0)),
    };

    const editId = this.editingItemId();
    if (editId) {
      this.financeService.updateInventoryItem(editId, payload);
      this.toast.success(`Artículo "${name}" actualizado.`);
    } else {
      this.financeService.addInventoryItem(payload);
      this.toast.success(`Artículo "${name}" registrado en inventario.`);
    }

    this.closeItemModal();
  }

  adjustStock(item: PymeInventoryItem, delta: number): void {
    const newStock = Math.max(0, roundMoney(item.currentStock + delta, 2));
    this.financeService.updateInventoryItem(item.id, { currentStock: newStock });
  }

  openRestockModal(item: PymeInventoryItem, mode: 'vault' | 'provider_credit'): void {
    this.restockTargetItem.set(item);
    this.restockMode.set(mode);
    this.restockQuantity.set(Math.max(1, item.optimalStock - item.currentStock));
    this.showRestockModal.set(true);
  }

  closeRestockModal(): void {
    this.showRestockModal.set(false);
    this.restockTargetItem.set(null);
  }

  confirmRestockModal(): void {
    const item = this.restockTargetItem();
    const qty = Number(this.restockQuantity() ?? 0);
    if (!item || !Number.isFinite(qty) || qty <= 0) {
      this.toast.warn('Ingrese una cantidad válida a reponer.');
      return;
    }
    this.restockItem(item, this.restockMode(), qty);
    this.closeRestockModal();
  }

  restockItem(
    item: PymeInventoryItem,
    mode: 'vault' | 'provider_credit',
    explicitQty?: number,
  ): void {
    const qtyToAdd =
      explicitQty !== undefined && explicitQty > 0
        ? explicitQty
        : Math.max(5, item.optimalStock - item.currentStock);

    if (mode === 'provider_credit') {
      const selectedProvId = this.restockProviderId();
      if (this.providers().length === 0) {
        this.toast.warn(
          'Registre al menos un proveedor en Proveedores CxP antes de reponer a crédito.',
        );
        return;
      }
      if (!selectedProvId) {
        this.toast.warn('Seleccione explícitamente el proveedor para la reposición a crédito.');
        return;
      }
      const res = this.financeService.restockInventoryWithAccounting({
        itemId: item.id,
        quantityToAdd: qtyToAdd,
        paymentMode: 'provider_credit',
        providerId: selectedProvId,
      });
      if (res.success) {
        const provName =
          this.providers().find((p) => p.id === selectedProvId)?.name ?? 'Proveedor';
        this.toast.success(
          `Stock de "${item.name}" repuesto (+${qtyToAdd} u. → ${res.newStock}) a crédito con ${provName} ($${res.totalCostUsd.toFixed(2)} USD).`,
        );
      }
      return;
    }

    const vaultId = this.restockVaultId() || undefined;
    const res = this.financeService.restockInventoryWithAccounting({
      itemId: item.id,
      quantityToAdd: qtyToAdd,
      paymentMode: 'vault',
      vaultId,
    });

    if (res.success) {
      this.toast.success(
        `Stock de "${item.name}" repuesto (+${qtyToAdd} u. → ${res.newStock}) desde ${this.getVaultName(vaultId)} ($${res.totalCostUsd.toFixed(2)} USD).`,
      );
    }
  }

  deleteInventoryItem(item: PymeInventoryItem): void {
    this.financeService.deleteInventoryItem(item.id);
    this.toast.info(`Artículo "${item.name}" eliminado del catálogo.`);
  }

  // -------------------------------------------------------------
  // RECURRING RULES ACTIONS
  // -------------------------------------------------------------

  setRecurringType(type: RecurringRuleType): void {
    this.recType.set(type);
    const defaultCat =
      type === RECURRING_RULE_TYPE.INCOME ? 'business_sale' : 'rent';
    this.recCategory.set(defaultCat);
  }

  saveRecurringRule(): void {
    const title = this.recTitle().trim();
    const amount = Number(this.recAmount() ?? 0);
    if (!title) {
      this.toast.warn('Ingrese un nombre descriptivo para la regla recurrente.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      this.toast.warn('Ingrese un monto mayor a cero.');
      return;
    }

    const vaultId = this.recVaultId() || undefined;
    const vault = vaultId ? this.availableVaults().find((v) => v.id === vaultId) : undefined;

    this.financeService.addRecurringRule({
      title,
      type: this.recType(),
      scope: 'business',
      category: this.recCategory(),
      channel: vault?.channel ?? 'bs_bank',
      vaultId,
      currency: this.recCurrency(),
      amount,
      frequency: this.recFrequency(),
      nextDueDate: this.recNextDueDate() || todayVetIso(),
      active: true,
      notes: this.recNotes().trim() || undefined,
    });

    this.toast.success(`Regla recurrente "${title}" programada correctamente.`);
    this.recTitle.set('');
    this.recAmount.set(null);
    this.recNotes.set('');
    this.showRecurringForm.set(false);
  }

  toggleRecurringRule(ruleId: string): void {
    this.financeService.toggleRecurringRule(ruleId);
  }

  deleteRecurringRule(ruleId: string): void {
    this.financeService.deleteRecurringRule(ruleId);
    this.toast.info('Regla recurrente eliminada.');
  }

  materializeDueRulesNow(): void {
    const result = this.financeService.materializeDueRecurringRules();
    if (result.materializedCount > 0) {
      this.toast.success(
        `Se aplicaron ${result.materializedCount} regla(s) vencida(s) al Libro Mayor.`,
      );
    } else {
      this.toast.info('No hay reglas recurrentes vencidas pendientes para hoy.');
    }
  }

  isRuleDueTodayOrPast(rule: RecurringRule): boolean {
    return rule.active && calendarDaysBetween(rule.nextDueDate, todayVetIso()) >= 0;
  }

  getFrequencyLabel(freq: RecurringFrequency): string {
    if (freq === RECURRING_FREQUENCY.WEEKLY) return 'Semanal';
    if (freq === RECURRING_FREQUENCY.BIWEEKLY) return 'Quincenal';
    return 'Mensual';
  }

  // -------------------------------------------------------------
  // CASHEA ALLY ACTIONS
  // -------------------------------------------------------------

  applyMdrPreset(preset: CasheaMdrPreset): void {
    this.allyMdrPercent.set(preset.mdrPercent);
  }

  registerAllySale(): void {
    const gross = Number(this.allyGrossSaleUsd() ?? 0);
    if (!Number.isFinite(gross) || gross <= 0) {
      this.toast.warn('Ingrese un precio de venta válido mayor a cero.');
      return;
    }

    const sale = this.financeService.registerCasheaMerchantSale({
      title: this.allySaleTitle().trim() || 'Venta Cashea Aliado',
      customerName: this.allyCustomerName().trim() || undefined,
      grossSaleUsd: gross,
      costOfGoodsUsd: Math.max(0, Number(this.allyCostOfGoodsUsd() ?? 0)),
      mdrPercent: Math.max(0, Number(this.allyMdrPercent() ?? 0)),
      useWeeklyAdvance: this.allyUseWeeklyAdvance(),
      weeklyAdvanceFeePercent: this.allyWeeklyAdvancePercent(),
      bcvRate: this.effectiveAllyBcvRate(),
      parallelReplacementRate: this.effectiveAllyParallelRate(),
      monthlyMinimumFeeUsd: Math.max(0, Number(this.allyMonthlyMinimumUsd() ?? 100)),
      activationFeeUsd: Math.max(0, Number(this.allyActivationFeeUsd() ?? 0)),
    });

    this.allyCustomerName.set('');
    this.toast.success(
      `Venta Aliado "${sale.title}" registrada. Corte estimado: ${sale.expectedSettlementDate} ($${sale.netReceivableUsd.toFixed(2)} USD netos).`,
    );
  }

  settleAllySale(saleId: string): void {
    const vaultId = this.casheaSettleVaultId() || undefined;
    const res = this.financeService.settleCasheaMerchantSale(saleId, vaultId);
    if (!res.success) {
      this.toast.warn('No se pudo liquidar el corte seleccionado.');
      return;
    }
    this.toast.success(
      `Corte Cashea Aliado liquidado en ${this.getVaultName(vaultId)} y distribuido en las 3 Gavetas.`,
    );
  }

  // -------------------------------------------------------------
  // SHARED FORMATTERS & HELPERS
  // -------------------------------------------------------------

  getVaultName(vaultId?: string): string {
    if (!vaultId) return 'Flujo Directo';
    const vault = this.availableVaults().find((v) => v.id === vaultId);
    return vault ? vault.name : 'Bóveda no disponible';
  }

  formatSignedUsd(amount: number): string {
    const safe = Number.isFinite(amount) ? amount : 0;
    const abs = Math.abs(safe).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return safe < 0 ? `-$${abs}` : `$${abs}`;
  }

  formatSignedVes(amount: number): string {
    const safe = Number.isFinite(amount) ? amount : 0;
    const abs = Math.abs(safe).toLocaleString('es-VE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return safe < 0 ? `-Bs ${abs}` : `Bs ${abs}`;
  }

  private resolveDefaultVaultId(
    vaults: readonly AssetVault[],
    previousValue?: string,
  ): string {
    if (previousValue && vaults.some((v) => v.id === previousValue)) {
      return previousValue;
    }
    const preferredBusiness = vaults.find((v) => v.scope === 'business');
    if (preferredBusiness) return preferredBusiness.id;
    return vaults[0]?.id ?? '';
  }

  protected trackLiabilityById(_idx: number, item: LiabilityItem): string {
    return item.id;
  }
}
