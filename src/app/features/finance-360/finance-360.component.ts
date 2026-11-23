import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { computeLogSummary } from '@p2p/core';
import { AccountsService } from '../../core/accounts.service';
import { Finance360Service } from '../../core/finance-360.service';
import { HotkeysService } from '../../core/hotkeys.service';
import { FinanceAiIngestorService } from '../../core/services/finance-ai-ingestor.service';
import { FinanceDriveSyncService } from '../../core/services/finance-drive-sync.service';
import { FinanceForecasterService } from '../../core/services/finance-forecaster.service';
import { ToastService } from '../../core/toast.service';
import { VoiceDictationService } from '../../core/voice-dictation.service';
import {
  addCalendarDays,
  calendarDaysBetween,
  computeTriMonetaryAmount,
  parseCalendarDate,
  roundMoney,
  todayVetIso,
  type AssetVault,
  type CurrencyCode,
  type ExpenseCategory,
  type FinanceScope,
  type IncomeCategory,
  type LiabilityItem,
  type PaymentChannel,
  type WealthGoal,
} from '../../core/models/finance-360.models';
import {
  F360_HORIZON,
  F360_NAV_TAB_ID,
  type F360CashflowSeriesPoint,
  type F360Horizon,
  type F360LedgerDeletePayload,
  type F360LedgerEditPayload,
  type F360LedgerRowItem,
  type F360LiquiditySummary,
  type F360NavTabId,
  type F360OverflowActionId,
  type F360OverviewUpcomingItem,
  type F360PnlLine,
  type F360QuickActionId,
  type F360VaultBalanceEditPayload,
  type F360VaultReconcilePayload,
  type F360VesExposureView,
} from './f360-ui.models';
import { F360CommandHeaderComponent } from './components/f360-command-header/f360-command-header.component';
import { F360OverviewComponent } from './components/f360-overview/f360-overview.component';
import { F360VaultsLedgerComponent } from './components/f360-vaults-ledger/f360-vaults-ledger.component';
import { FinanceAnalyticsComponent } from './components/finance-analytics.component';
import { CasheaCalculatorComponent } from './submodules/cashea-calculator/cashea-calculator.component';
import { PymeManagerComponent } from './submodules/pyme-manager/pyme-manager.component';
import { QuoteBuilderComponent } from './submodules/quote-builder/quote-builder.component';

const PRIVACY_STORAGE_KEY = 'p2p.finance360.privacy_mode';

export const F360_PYME_SUBTAB = {
  PYME: 'pyme',
  QUOTES: 'quotes',
} as const;
export type F360PymeSubTab = (typeof F360_PYME_SUBTAB)[keyof typeof F360_PYME_SUBTAB];

export interface F360ScopedCommand {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly hint?: string;
  readonly run: () => void;
}

interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

const EXPENSE_CATEGORY_OPTIONS: readonly SelectOption<ExpenseCategory>[] = [
  { value: 'groceries', label: 'Comida y Mercado' },
  { value: 'housing', label: 'Vivienda y Alquiler' },
  { value: 'transport', label: 'Gasolina y Transporte' },
  { value: 'services', label: 'Servicios Básicos' },
  { value: 'health', label: 'Salud y Medicina' },
  { value: 'education', label: 'Educación' },
  { value: 'personal_care', label: 'Cuidado Personal' },
  { value: 'entertainment', label: 'Entretenimiento' },
  { value: 'cashea_installment', label: 'Cuota Cashea' },
  { value: 'provider_merchandise', label: 'Proveedores / Mercancía' },
  { value: 'payroll', label: 'Nómina de Personal' },
  { value: 'rent', label: 'Alquiler Comercial' },
  { value: 'utilities', label: 'Servicios Locales' },
  { value: 'maintenance', label: 'Mantenimiento / Taller' },
  { value: 'equipment_capex', label: 'Equipos / CAPEX' },
  { value: 'marketing', label: 'Marketing y Publicidad' },
  { value: 'taxes', label: 'Impuestos y Tributos' },
  { value: 'other', label: 'Otro Egreso' },
];

const INCOME_CATEGORY_OPTIONS: readonly SelectOption<IncomeCategory>[] = [
  { value: 'salary', label: 'Sueldo / Salario' },
  { value: 'business_sale', label: 'Venta Comercial Pyme' },
  { value: 'quote_advance', label: 'Anticipo de Presupuesto' },
  { value: 'freelance', label: 'Honorarios / Freelance' },
  { value: 'p2p_profit', label: 'Ganancia Mesa P2P' },
  { value: 'investment', label: 'Rendimiento / Inversión' },
  { value: 'other', label: 'Otro Ingreso' },
];

const CURRENCY_OPTIONS: readonly CurrencyCode[] = ['USD', 'VES', 'USDT', 'EUR'];

const CHANNEL_OPTIONS: readonly SelectOption<PaymentChannel>[] = [
  { value: 'zelle', label: 'Zelle / Banco USD' },
  { value: 'bs_bank', label: 'Banco Nacional VES / Pago Móvil' },
  { value: 'crypto', label: 'Binance / Billetera USDT' },
  { value: 'cash', label: 'Efectivo Físico' },
  { value: 'receivable', label: 'Cuenta por Cobrar (CxC)' },
  { value: 'other', label: 'Otro Canal' },
];

const LIABILITY_CATEGORY_OPTIONS: readonly SelectOption<LiabilityItem['category']>[] = [
  { value: 'fixed_service', label: 'Servicio Fijo / Hogar' },
  { value: 'provider', label: 'Proveedor Comercial (CxP)' },
  { value: 'cashea', label: 'Cuota Cashea' },
  { value: 'loan', label: 'Préstamo / Financiamiento' },
  { value: 'tax', label: 'Impuesto / Tributo' },
  { value: 'other', label: 'Otro Compromiso' },
];

const GOAL_CATEGORY_OPTIONS: readonly SelectOption<NonNullable<WealthGoal['category']>>[] = [
  { value: 'emergency', label: 'Fondo de Emergencia' },
  { value: 'equipment', label: 'Equipos / Herramientas' },
  { value: 'savings', label: 'Ahorro Patrimonial' },
  { value: 'real_estate', label: 'Inmueble / Local' },
  { value: 'other', label: 'Otra Meta' },
];

function readSavedPrivacyMode(): boolean {
  try {
    if (
      typeof globalThis.localStorage !== 'undefined' &&
      typeof globalThis.localStorage?.getItem === 'function'
    ) {
      return globalThis.localStorage.getItem(PRIVACY_STORAGE_KEY) === 'true';
    }
  } catch {
    // Ignore storage access errors in restricted sandboxes
  }
  return false;
}

function persistPrivacyMode(enabled: boolean): void {
  try {
    if (
      typeof globalThis.localStorage !== 'undefined' &&
      typeof globalThis.localStorage?.setItem === 'function'
    ) {
      globalThis.localStorage.setItem(PRIVACY_STORAGE_KEY, String(enabled));
    }
  } catch {
    // Ignore storage access errors
  }
}

function formatShortDateLabel(isoDate: string): string {
  if (/^\d{4}-\d{2}$/.test(isoDate)) {
    const [year, month] = isoDate.split('-');
    return `${month}/${year.slice(2)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    const [, month, day] = isoDate.split('-');
    return `${day}/${month}`;
  }
  return isoDate;
}

@Component({
  selector: 'app-finance-360',
  standalone: true,
  imports: [
    FormsModule,
    F360CommandHeaderComponent,
    F360OverviewComponent,
    F360VaultsLedgerComponent,
    FinanceAnalyticsComponent,
    CasheaCalculatorComponent,
    PymeManagerComponent,
    QuoteBuilderComponent,
  ],
  templateUrl: './finance-360.component.html',
  styleUrl: './finance-360.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.scope-all]': "financeService.scope() === 'all'",
    '[class.scope-personal]': "financeService.scope() === 'personal'",
    '[class.scope-business]': "financeService.scope() === 'business'",
    '[class.privacy-active]': 'privacyMode()',
  },
})
export class Finance360Component {
  readonly financeService = inject(Finance360Service);
  readonly driveSync = inject(FinanceDriveSyncService);
  readonly voice = inject(VoiceDictationService);
  private readonly forecaster = inject(FinanceForecasterService);
  private readonly accountsService = inject(AccountsService);
  private readonly aiIngestor = inject(FinanceAiIngestorService);
  private readonly hotkeys = inject(HotkeysService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute, { optional: true });

  private readonly restoreJsonInput = viewChild<ElementRef<HTMLInputElement>>('restoreJsonInput');
  private readonly paletteSearchInput = viewChild<ElementRef<HTMLInputElement>>('paletteSearchInput');

  protected readonly expenseCategoryOptions = EXPENSE_CATEGORY_OPTIONS;
  protected readonly incomeCategoryOptions = INCOME_CATEGORY_OPTIONS;
  protected readonly currencyOptions = CURRENCY_OPTIONS;
  protected readonly channelOptions = CHANNEL_OPTIONS;
  protected readonly liabilityCategoryOptions = LIABILITY_CATEGORY_OPTIONS;
  protected readonly goalCategoryOptions = GOAL_CATEGORY_OPTIONS;

  // Navigation, Horizon & Privacy State
  readonly activeTab = signal<F360NavTabId>(F360_NAV_TAB_ID.OVERVIEW);
  readonly pymeSubTab = signal<F360PymeSubTab>(F360_PYME_SUBTAB.PYME);
  readonly selectedHorizon = signal<F360Horizon>(F360_HORIZON.MONTH);
  readonly privacyMode = signal<boolean>(readSavedPrivacyMode());
  readonly mobileFabOpen = signal<boolean>(false);

  // Scoped Ctrl+K Palette State
  readonly scopedPaletteOpen = signal<boolean>(false);
  readonly scopedPaletteQuery = signal<string>('');
  readonly scopedPaletteIndex = signal<number>(0);

  // Quick Transaction & AI/Voice Modal State
  readonly quickModalOpen = signal<boolean>(false);
  readonly quickModalType = signal<'expense' | 'income' | 'audio'>('expense');
  readonly smartCommandText = signal<string>('');
  readonly formTitle = signal<string>('');
  readonly formAmount = signal<number | null>(null);
  readonly formCurrency = signal<CurrencyCode>('USD');
  readonly formScope = signal<FinanceScope>('personal');
  readonly formExpenseCategory = signal<ExpenseCategory>('groceries');
  readonly formIncomeCategory = signal<IncomeCategory>('salary');
  readonly formReferenceNumber = signal<string>('');
  readonly formNotes = signal<string>('');
  readonly feeRatePct = signal<0 | 0.3 | 3>(0);
  readonly isScanningReceipt = signal<boolean>(false);
  readonly scannedReceiptName = signal<string>('');
  readonly lastVoiceBadges = signal<readonly string[]>([]);

  // Double-Entry FX Transfer Modal State
  readonly transferModalOpen = signal<boolean>(false);
  readonly transferFromId = signal<string>('');
  readonly transferToId = signal<string>('');
  readonly transferAmount = signal<number | null>(null);

  // New Vault Modal State
  readonly newVaultModalOpen = signal<boolean>(false);
  readonly newVaultName = signal<string>('');
  readonly newVaultCurrency = signal<CurrencyCode>('USD');
  readonly newVaultBalance = signal<number | null>(0);
  readonly newVaultScope = signal<FinanceScope>('personal');
  readonly newVaultChannel = signal<PaymentChannel>('zelle');

  // New Liability & Pay Liability Modals
  readonly newLiabilityModalOpen = signal<boolean>(false);
  readonly liabTitle = signal<string>('');
  readonly liabCreditor = signal<string>('');
  readonly liabAmountUsd = signal<number | null>(null);
  readonly liabDueDate = signal<string>(addCalendarDays(todayVetIso(), 5));
  readonly liabCategory = signal<LiabilityItem['category']>('fixed_service');
  readonly liabScope = signal<FinanceScope>('personal');

  readonly payLiabilityModalOpen = signal<boolean>(false);
  readonly targetLiabilityForPayment = signal<F360OverviewUpcomingItem | null>(null);
  readonly payLiabilityAmountUsd = signal<number | null>(null);

  // Wealth Goal Modals
  readonly newGoalModalOpen = signal<boolean>(false);
  readonly newGoalTitle = signal<string>('');
  readonly newGoalTargetUsd = signal<number | null>(null);
  readonly newGoalCurrentUsd = signal<number | null>(0);
  readonly newGoalDeadline = signal<string>(addCalendarDays(todayVetIso(), 90));
  readonly newGoalCategory = signal<WealthGoal['category']>('emergency');

  readonly contributeGoalModalOpen = signal<boolean>(false);
  readonly targetGoalForContribution = signal<WealthGoal | null>(null);
  readonly contributeAmountUsd = signal<number | null>(50);

  // Typed Reset Confirmation Modal
  readonly resetConfirmModalOpen = signal<boolean>(false);
  readonly resetConfirmText = signal<string>('');

  // Dynamic Real Vault Selections (Zero hardcoded ghost vault IDs)
  readonly liquidVaults = computed<readonly AssetVault[]>(() =>
    this.financeService.assets().filter((v) => v.channel !== 'receivable'),
  );

  readonly formVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.liquidVaults,
    computation: (vaults, prev) => {
      if (prev?.value && vaults.some((v) => v.id === prev.value)) return prev.value;
      return vaults[0]?.id ?? '';
    },
  });

  readonly contributeVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.liquidVaults,
    computation: (vaults, prev) => {
      if (prev?.value && vaults.some((v) => v.id === prev.value)) return prev.value;
      return vaults[0]?.id ?? '';
    },
  });

  readonly payLiabilityVaultId = linkedSignal<readonly AssetVault[], string>({
    source: this.liquidVaults,
    computation: (vaults, prev) => {
      if (prev?.value && vaults.some((v) => v.id === prev.value)) return prev.value;
      return vaults[0]?.id ?? '';
    },
  });

  // -------------------------------------------------------------
  // HEADER BADGES & AGGREGATED VIEW MODELS
  // -------------------------------------------------------------

  readonly driveSyncing = computed<boolean>(() => this.driveSync.syncStatus() === 'syncing');

  readonly overdueCount = computed<number>(() => this.financeService.overdueLiabilities().length);

  readonly vaultsCount = computed<number>(() => this.financeService.assets().length);

  readonly casheaActiveCount = computed<number>(
    () => this.financeService.state().casheaPlans.filter((p) => p.status === 'active').length,
  );

  readonly pymeAlertsCount = computed<number>(() => {
    const state = this.financeService.state();
    const lowStock = state.inventory.filter(
      (item) => item.status === 'low' || item.status === 'depleted',
    ).length;
    const coldStock = this.financeService.getColdInventoryItems().length;
    const drawers = this.financeService.pymeDrawersTelemetry();
    const overdraftDrawers =
      (drawers.drawer1AvailableUsd < 0 ? 1 : 0) +
      (drawers.drawer2AvailableUsd < 0 ? 1 : 0) +
      (drawers.drawer3AvailableUsd < 0 ? 1 : 0);
    const overdueProviders = this.financeService
      .overdueLiabilities()
      .filter((l) => l.category === 'provider').length;
    return lowStock + coldStock + overdraftDrawers + overdueProviders;
  });

  readonly periodPnlReport = computed(() =>
    this.forecaster.computePeriodPnL(
      this.financeService.incomes(),
      this.financeService.expenses(),
      this.selectedHorizon(),
    ),
  );

  readonly overviewPnlLines = computed<readonly F360PnlLine[]>(() => {
    const pnl = this.periodPnlReport();
    return [
      {
        id: 'op-income',
        label: 'Ingresos Operativos',
        amountUsd: pnl.operatingIncomeUsd,
        tone: 'positive',
      },
      {
        id: 'p2p-profit',
        label: 'Profit P2P Aislado',
        amountUsd: pnl.p2pIsolatedProfitUsd,
        tone: pnl.p2pIsolatedProfitUsd > 0 ? 'positive' : 'neutral',
      },
      {
        id: 'cogs',
        label: 'Costos Directos (COGS)',
        amountUsd: -pnl.directCostsCogsUsd,
        tone: 'negative',
      },
      {
        id: 'fixed',
        label: 'Gastos Fijos y Operativos',
        amountUsd: -pnl.fixedExpensesUsd,
        tone: 'negative',
      },
      {
        id: 'net-profit',
        label: 'Utilidad Neta',
        amountUsd: pnl.netProfitUsd,
        sharePct: pnl.savingsRatePercent,
        tone: 'highlight',
      },
    ];
  });

  readonly overviewCashflowSeries = computed<readonly F360CashflowSeriesPoint[]>(() => {
    const horizon = this.selectedHorizon();
    const incomes = this.forecaster.filterByHorizon(this.financeService.incomes(), horizon);
    const expenses = this.forecaster.filterByHorizon(this.financeService.expenses(), horizon);

    if (incomes.length === 0 && expenses.length === 0) {
      return [];
    }

    const bucketByMonth = horizon === F360_HORIZON.YEAR;
    const buckets = new Map<string, { incomeUsd: number; expenseUsd: number }>();

    const keyForDate = (dateIso: string): string =>
      bucketByMonth ? dateIso.slice(0, 7) : dateIso.slice(0, 10);

    for (const inc of incomes) {
      const key = keyForDate(inc.date);
      const curr = buckets.get(key) ?? { incomeUsd: 0, expenseUsd: 0 };
      curr.incomeUsd = roundMoney(curr.incomeUsd + inc.triMonetary.amount_usd);
      buckets.set(key, curr);
    }

    for (const exp of expenses) {
      const key = keyForDate(exp.date);
      const curr = buckets.get(key) ?? { incomeUsd: 0, expenseUsd: 0 };
      curr.expenseUsd = roundMoney(curr.expenseUsd + exp.triMonetary.amount_usd);
      buckets.set(key, curr);
    }

    const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a.localeCompare(b));
    const boundedKeys = sortedKeys.slice(-14);

    return boundedKeys.map((key) => {
      const val = buckets.get(key) ?? { incomeUsd: 0, expenseUsd: 0 };
      return {
        id: `cf-${key}`,
        dateIso: key,
        label: formatShortDateLabel(key),
        incomeUsd: val.incomeUsd,
        expenseUsd: val.expenseUsd,
        netUsd: roundMoney(val.incomeUsd - val.expenseUsd),
      };
    });
  });

  readonly overviewLiquiditySummary = computed<F360LiquiditySummary>(() => {
    const health = this.financeService.liquidityHealthStatus();
    return {
      status: health.status,
      ratioPct: health.ratio,
      due14DaysUsd: health.due14DaysUsd,
      liquidUsd: health.liquidUsd,
      overdueUsd: health.overdueUsd,
      overdueCount: health.overdueCount,
      detailLabel: health.label,
    };
  });

  readonly overviewUpcomingItems = computed<readonly F360OverviewUpcomingItem[]>(() => {
    const today = todayVetIso();
    return this.financeService.upcomingLiabilities14Days().map((item) => {
      const daysDelta = calendarDaysBetween(today, item.dueDate);
      const status =
        item.status === 'paid'
          ? 'paid'
          : item.status === 'overdue' || daysDelta < 0
            ? 'overdue'
            : 'upcoming';
      return {
        id: item.id,
        title: item.title,
        creditor: item.creditor,
        dueDate: item.dueDate,
        daysDelta,
        remainingUsd: item.remainingAmount,
        status,
        category: item.category,
        scope: item.scope,
        rawLiability: item,
      };
    });
  });

  readonly vesExposureView = computed<F360VesExposureView>(() => {
    const tel = this.financeService.vesExposureTelemetry();
    return {
      vesBalanceTotal: tel.vesBalanceTotal,
      vesEquivalentUsd: tel.vesEquivalentUsd,
      exposurePct: tel.exposurePct,
      rateGapPct: tel.rateGapPct,
      erosionLoss5PctUsd: tel.erosionLoss5PctUsd,
      isHighExposure: tel.isHighExposure,
    };
  });

  readonly ledgerRows = computed<readonly F360LedgerRowItem[]>(() => {
    const activeScope = this.financeService.scope();
    const state = this.financeService.state();
    const vaultMap = new Map(state.assets.map((v) => [v.id, v]));
    const refByIncomeId = new Map(state.incomes.map((i) => [i.id, i.referenceNumber]));
    const refByExpenseId = new Map(state.expenses.map((e) => [e.id, e.referenceNumber]));

    const movementRows: F360LedgerRowItem[] = this.financeService.unifiedMovements().map((m) => ({
      id: m.id,
      kind: m.type,
      title: m.title,
      scope: m.scope,
      categoryLabel: m.categoryLabel,
      vaultName: m.vaultName,
      vaultId: m.vaultId,
      bcvRateApplied: m.bcvRateApplied,
      referenceNumber:
        m.type === 'income' ? refByIncomeId.get(m.id) : refByExpenseId.get(m.id),
      amountUsd: m.amountUsd,
      amountVes: m.amountVes,
      currency: m.triMonetary.currency,
      date: m.date,
      createdAt: m.createdAt,
      notes: m.notes,
      editable: true,
    }));

    const transferRows: F360LedgerRowItem[] = this.financeService
      .transfers()
      .filter((tr) => {
        if (activeScope === 'all') return true;
        const fromVault = vaultMap.get(tr.fromVaultId);
        const toVault = vaultMap.get(tr.toVaultId);
        return (
          fromVault?.scope === activeScope ||
          toVault?.scope === activeScope ||
          fromVault?.scope === 'all' ||
          toVault?.scope === 'all'
        );
      })
      .map((tr) => {
        const fromVault = vaultMap.get(tr.fromVaultId);
        const toVault = vaultMap.get(tr.toVaultId);
        const fromName = fromVault?.name ?? 'Bóveda origen';
        const toName = toVault?.name ?? 'Bóveda destino';
        const scope: FinanceScope = fromVault?.scope ?? toVault?.scope ?? 'personal';
        return {
          id: tr.id,
          kind: 'transfer',
          title: `Transferencia ${fromName} -> ${toName}`,
          scope,
          categoryLabel: 'Transferencia FX',
          vaultName: `${fromName} -> ${toName}`,
          vaultId: tr.fromVaultId,
          bcvRateApplied: tr.bcvRateApplied,
          referenceNumber: tr.groupId,
          amountUsd: tr.amountUsd,
          amountVes: tr.bcvRateApplied > 0 ? roundMoney(tr.amountUsd * tr.bcvRateApplied) : 0,
          currency: tr.sourceCurrency,
          date: tr.date,
          createdAt: tr.createdAt,
          notes: tr.notes,
          editable: false,
        };
      });

    return [...movementRows, ...transferRows].sort((a, b) => {
      const dateDiff = parseCalendarDate(b.date).getTime() - parseCalendarDate(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  });

  readonly todayP2pSummary = computed(() => {
    const todayOps = this.accountsService.todayOperations();
    return computeLogSummary(todayOps);
  });

  readonly isP2pProfitImportedToday = computed<boolean>(() => {
    const todayStr = todayVetIso();
    return this.financeService
      .state()
      .incomes.some((i) => i.id === `p2p-profit-${todayStr}` || i.id === `p2p-settlement-${todayStr}`);
  });

  readonly transferPreview = computed(() => {
    const fromId = this.transferFromId();
    const toId = this.transferToId();
    const amount = this.transferAmount() ?? 0;
    if (!fromId || !toId || fromId === toId || amount <= 0) return null;

    const vaults = this.financeService.state().assets;
    const fromVault = vaults.find((v) => v.id === fromId);
    const toVault = vaults.find((v) => v.id === toId);
    if (!fromVault || !toVault) return null;

    const bcv = this.financeService.currentBcvRate();
    const eurUsd = this.financeService.currentEurUsdRate();

    const needsBcv = fromVault.currency === 'VES' || toVault.currency === 'VES';
    const needsEur = fromVault.currency === 'EUR' || toVault.currency === 'EUR';
    if ((needsBcv && bcv <= 0) || (needsEur && eurUsd <= 0)) {
      return {
        fromVault,
        toVault,
        targetCredit: 0,
        bcv,
        missingRate: true,
        insufficientFunds: amount > fromVault.balance,
      };
    }

    const amountUsd =
      fromVault.currency === 'VES'
        ? amount / bcv
        : fromVault.currency === 'EUR'
          ? amount * eurUsd
          : amount;

    const targetCredit =
      toVault.currency === 'VES'
        ? amountUsd * bcv
        : toVault.currency === 'EUR'
          ? amountUsd / eurUsd
          : amountUsd;

    return {
      fromVault,
      toVault,
      targetCredit: roundMoney(targetCredit),
      bcv,
      missingRate: false,
      insufficientFunds: amount > fromVault.balance,
    };
  });

  readonly canConfirmReset = computed<boolean>(
    () => this.resetConfirmText().trim().toUpperCase() === 'RESET',
  );

  // -------------------------------------------------------------
  // SCOPED CTRL+K PALETTE COMMANDS
  // -------------------------------------------------------------

  readonly scopedCommands = computed<readonly F360ScopedCommand[]>(() => [
    {
      id: 'act-expense',
      label: 'Registrar Gasto Rápido',
      group: 'Acciones Rápidas',
      hint: 'Egreso',
      run: () => this.openQuickModal('expense'),
    },
    {
      id: 'act-income',
      label: 'Registrar Ingreso',
      group: 'Acciones Rápidas',
      hint: 'Ingreso',
      run: () => this.openQuickModal('income'),
    },
    {
      id: 'act-audio',
      label: 'Dictar Movimiento por Voz / OCR IA',
      group: 'Acciones Rápidas',
      hint: 'Alt+V',
      run: () => this.openQuickModal('audio'),
    },
    {
      id: 'act-transfer',
      label: 'Transferencia FX entre Bóvedas',
      group: 'Acciones Rápidas',
      hint: 'Partida doble',
      run: () => this.openTransferModal(),
    },
    {
      id: 'act-vault',
      label: 'Crear Nueva Bóveda',
      group: 'Acciones Rápidas',
      hint: 'USD/VES/USDT/EUR',
      run: () => this.openNewVaultModal(),
    },
    {
      id: 'act-liability',
      label: 'Agendar Pasivo / Compromiso',
      group: 'Acciones Rápidas',
      hint: 'Calendario 14D',
      run: () => this.openNewLiabilityModal(),
    },
    {
      id: 'act-goal',
      label: 'Crear Meta Patrimonial Blindada',
      group: 'Acciones Rápidas',
      hint: 'Reserva',
      run: () => this.openNewGoalModal(),
    },
    {
      id: 'nav-overview',
      label: 'Ir a Overview Patrimonial',
      group: 'Vistas Finanzas 360',
      hint: 'Tab 1',
      run: () => this.selectTab(F360_NAV_TAB_ID.OVERVIEW),
    },
    {
      id: 'nav-vaults',
      label: 'Ir a Bóvedas & Libro Mayor',
      group: 'Vistas Finanzas 360',
      hint: 'Tab 2',
      run: () => this.selectTab(F360_NAV_TAB_ID.VAULTS),
    },
    {
      id: 'nav-analytics',
      label: 'Ir a CFO & Analítica Predictiva',
      group: 'Vistas Finanzas 360',
      hint: 'Tab 3',
      run: () => this.selectTab(F360_NAV_TAB_ID.ANALYTICS),
    },
    {
      id: 'nav-cashea',
      label: 'Ir a Cashea 14D (Niveles 1–6 Araguaney)',
      group: 'Vistas Finanzas 360',
      hint: 'Tab 4',
      run: () => this.selectTab(F360_NAV_TAB_ID.CASHEA),
    },
    {
      id: 'nav-pyme',
      label: 'Ir a Pyme 3 Gavetas & Modo Aliado',
      group: 'Vistas Finanzas 360',
      hint: 'Tab 5',
      run: () => {
        this.selectTab(F360_NAV_TAB_ID.PYME_QUOTES);
        this.pymeSubTab.set(F360_PYME_SUBTAB.PYME);
      },
    },
    {
      id: 'nav-quotes',
      label: 'Ir a Constructor de Presupuestos (Doble PDF)',
      group: 'Vistas Finanzas 360',
      hint: 'Tab 5',
      run: () => {
        this.selectTab(F360_NAV_TAB_ID.PYME_QUOTES);
        this.pymeSubTab.set(F360_PYME_SUBTAB.QUOTES);
      },
    },
    {
      id: 'scope-all',
      label: 'Ámbito: Consolidado (Personal + Pyme)',
      group: 'Ámbito y Seguridad',
      run: () => this.setScope('all'),
    },
    {
      id: 'scope-personal',
      label: 'Ámbito: Personal',
      group: 'Ámbito y Seguridad',
      run: () => this.setScope('personal'),
    },
    {
      id: 'scope-business',
      label: 'Ámbito: Pyme / Comercial',
      group: 'Ámbito y Seguridad',
      run: () => this.setScope('business'),
    },
    {
      id: 'util-privacy',
      label: this.privacyMode() ? 'Desactivar Modo Privacidad' : 'Activar Modo Privacidad',
      group: 'Ámbito y Seguridad',
      run: () => this.togglePrivacyMode(),
    },
    {
      id: 'util-drive',
      label: 'Sincronizar Respaldo en Google Drive',
      group: 'Ámbito y Seguridad',
      run: () => void this.syncToGoogleDrive(),
    },
    {
      id: 'util-export',
      label: 'Exportar Respaldo Maestro JSON',
      group: 'Ámbito y Seguridad',
      run: () => this.downloadJsonBackup(),
    },
  ]);

  readonly filteredScopedCommands = computed<readonly F360ScopedCommand[]>(() => {
    const query = this.scopedPaletteQuery().trim().toLowerCase();
    const list = this.scopedCommands();
    if (!query) return list;
    return list.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(query) ||
        cmd.group.toLowerCase().includes(query) ||
        (cmd.hint ?? '').toLowerCase().includes(query),
    );
  });

  constructor() {
    const unregisterPalette = this.hotkeys.registerScopedPalette(
      () => this.toggleScopedPalette(),
      () => this.handleScopedEscape(),
    );
    this.destroyRef.onDestroy(() => {
      unregisterPalette();
      this.voice.stopListening();
    });

    effect(() => {
      if (this.scopedPaletteOpen()) {
        this.scopedPaletteQuery.set('');
        this.scopedPaletteIndex.set(0);
        queueMicrotask(() => {
          try {
            this.paletteSearchInput()?.nativeElement.focus();
          } catch {
            // Focus is best-effort
          }
        });
      }
    });

    this.route?.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const tabParam = params.get('tab');
        if (tabParam) {
          this.applyRouteTabParam(tabParam);
        }
        const actionParam = params.get('action');
        if (actionParam) {
          this.applyRouteActionParam(actionParam);
        }
      });
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(event: KeyboardEvent): void {
    if (event.altKey && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      this.openQuickModal('audio');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && this.quickModalOpen()) {
      event.preventDefault();
      this.saveQuickTransaction();
    }
  }

  // -------------------------------------------------------------
  // ROUTING, HEADER & PALETTE HANDLERS
  // -------------------------------------------------------------

  private applyRouteTabParam(tabParam: string): void {
    const norm = tabParam.toLowerCase();
    if (norm === 'overview') this.activeTab.set(F360_NAV_TAB_ID.OVERVIEW);
    else if (norm === 'vaults') this.activeTab.set(F360_NAV_TAB_ID.VAULTS);
    else if (norm === 'analytics') this.activeTab.set(F360_NAV_TAB_ID.ANALYTICS);
    else if (norm === 'cashea') this.activeTab.set(F360_NAV_TAB_ID.CASHEA);
    else if (norm === 'pyme') {
      this.activeTab.set(F360_NAV_TAB_ID.PYME_QUOTES);
      this.pymeSubTab.set(F360_PYME_SUBTAB.PYME);
    } else if (norm === 'quotes') {
      this.activeTab.set(F360_NAV_TAB_ID.PYME_QUOTES);
      this.pymeSubTab.set(F360_PYME_SUBTAB.QUOTES);
    } else if (norm === 'pyme_quotes') {
      this.activeTab.set(F360_NAV_TAB_ID.PYME_QUOTES);
    }
  }

  private applyRouteActionParam(actionParam: string): void {
    const norm = actionParam.toLowerCase();
    if (norm === 'expense') this.openQuickModal('expense');
    else if (norm === 'income') this.openQuickModal('income');
    else if (norm === 'audio') this.openQuickModal('audio');
    else if (norm === 'sync_drive') void this.syncToGoogleDrive();
  }

  setScope(scope: FinanceScope): void {
    this.financeService.scope.set(scope);
    this.formScope.set(scope === 'all' ? 'personal' : scope);
  }

  selectTab(tab: F360NavTabId): void {
    this.activeTab.set(tab);
    this.mobileFabOpen.set(false);
  }

  selectHorizon(horizon: F360Horizon): void {
    this.selectedHorizon.set(horizon);
  }

  togglePrivacyMode(): void {
    this.privacyMode.update((curr) => {
      const next = !curr;
      persistPrivacyMode(next);
      return next;
    });
  }

  toggleScopedPalette(): void {
    this.mobileFabOpen.set(false);
    this.scopedPaletteOpen.update((open) => !open);
  }

  closeScopedPalette(): void {
    this.scopedPaletteOpen.set(false);
  }

  onScopedPaletteInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.scopedPaletteQuery.set(target?.value ?? '');
    this.scopedPaletteIndex.set(0);
  }

  onScopedPaletteArrowDown(event: Event): void {
    event.preventDefault();
    const max = this.filteredScopedCommands().length - 1;
    if (max < 0) return;
    this.scopedPaletteIndex.update((i) => (i >= max ? 0 : i + 1));
  }

  onScopedPaletteArrowUp(event: Event): void {
    event.preventDefault();
    const max = this.filteredScopedCommands().length - 1;
    if (max < 0) return;
    this.scopedPaletteIndex.update((i) => (i <= 0 ? max : i - 1));
  }

  onScopedPaletteEnter(event: Event): void {
    event.preventDefault();
    const cmd = this.filteredScopedCommands()[this.scopedPaletteIndex()];
    if (cmd) this.executeScopedCommand(cmd);
  }

  executeScopedCommand(cmd: F360ScopedCommand): void {
    this.closeScopedPalette();
    cmd.run();
  }

  private handleScopedEscape(): boolean {
    if (this.scopedPaletteOpen()) {
      this.closeScopedPalette();
      return true;
    }
    if (this.resetConfirmModalOpen()) {
      this.closeResetConfirmModal();
      return true;
    }
    if (this.quickModalOpen()) {
      this.closeQuickModal();
      return true;
    }
    if (this.transferModalOpen()) {
      this.transferModalOpen.set(false);
      return true;
    }
    if (this.newVaultModalOpen()) {
      this.newVaultModalOpen.set(false);
      return true;
    }
    if (this.newLiabilityModalOpen()) {
      this.newLiabilityModalOpen.set(false);
      return true;
    }
    if (this.payLiabilityModalOpen()) {
      this.closePayLiabilityModal();
      return true;
    }
    if (this.newGoalModalOpen()) {
      this.newGoalModalOpen.set(false);
      return true;
    }
    if (this.contributeGoalModalOpen()) {
      this.closeContributeGoalModal();
      return true;
    }
    if (this.mobileFabOpen()) {
      this.mobileFabOpen.set(false);
      return true;
    }
    return false;
  }

  handleQuickAction(action: F360QuickActionId): void {
    this.mobileFabOpen.set(false);
    switch (action) {
      case 'income':
        this.openQuickModal('income');
        break;
      case 'expense':
        this.openQuickModal('expense');
        break;
      case 'audio':
        this.openQuickModal('audio');
        break;
      case 'transfer':
        this.openTransferModal();
        break;
      case 'new_vault':
        this.openNewVaultModal();
        break;
      case 'new_liability':
        this.openNewLiabilityModal();
        break;
      case 'new_goal':
        this.openNewGoalModal();
        break;
      case 'import_p2p':
        this.triggerP2pImport();
        break;
    }
  }

  handleOverflowAction(action: F360OverflowActionId): void {
    switch (action) {
      case 'toggle_privacy':
        this.togglePrivacyMode();
        break;
      case 'load_demo':
        this.loadDemoPortfolio();
        break;
      case 'clear_demo':
        this.clearDemoPortfolio();
        break;
      case 'sync_drive':
        void this.syncToGoogleDrive();
        break;
      case 'export_json':
        this.downloadJsonBackup();
        break;
      case 'restore_json':
        this.restoreJsonInput()?.nativeElement.click();
        break;
      case 'export_csv_incomes':
        this.downloadCsvExport('incomes');
        break;
      case 'export_csv_expenses':
        this.downloadCsvExport('expenses');
        break;
      case 'export_csv_liabilities':
        this.downloadCsvExport('liabilities');
        break;
      case 'request_reset':
        this.openResetConfirmModal();
        break;
    }
  }

  // -------------------------------------------------------------
  // VAULT & LEDGER DELEGATED HANDLERS
  // -------------------------------------------------------------

  openNewVaultModal(): void {
    this.newVaultName.set('');
    this.newVaultCurrency.set('USD');
    this.newVaultBalance.set(0);
    const currentScope = this.financeService.scope();
    this.newVaultScope.set(currentScope === 'all' ? 'personal' : currentScope);
    this.newVaultChannel.set('zelle');
    this.newVaultModalOpen.set(true);
  }

  saveNewVault(): void {
    const name = this.newVaultName().trim();
    if (!name) {
      this.toast.warn('Ingresa el nombre de la bóveda o cuenta.');
      return;
    }
    const currency = this.newVaultCurrency();
    const balance = roundMoney(Math.max(0, this.newVaultBalance() ?? 0));
    const bcv = this.financeService.currentBcvRate();
    const eurUsd = this.financeService.currentEurUsdRate();
    const channel: PaymentChannel =
      currency === 'VES' ? 'bs_bank' : currency === 'USDT' ? 'crypto' : this.newVaultChannel();

    const balanceUsdEquivalent =
      currency === 'VES'
        ? bcv > 0
          ? roundMoney(balance / bcv)
          : 0
        : currency === 'EUR'
          ? eurUsd > 0
            ? roundMoney(balance * eurUsd)
            : 0
          : balance;

    const balanceVesEquivalent =
      currency === 'VES' ? balance : bcv > 0 ? roundMoney(balanceUsdEquivalent * bcv) : 0;

    this.financeService.addAssetVault({
      name,
      channel,
      scope: this.newVaultScope(),
      currency,
      balance,
      balanceUsdEquivalent,
      balanceVesEquivalent,
    });
    this.newVaultModalOpen.set(false);
    this.toast.success(`Bóveda "${name}" (${currency}) creada exitosamente.`);
  }

  handleUpdateVaultBalance(payload: F360VaultBalanceEditPayload): void {
    const vault = this.financeService.state().assets.find((v) => v.id === payload.vaultId);
    if (!vault) return;
    if (!Number.isFinite(payload.balance) || payload.balance < 0) {
      this.toast.warn('Ingresa un saldo válido mayor o igual a cero.');
      return;
    }
    const rounded = roundMoney(payload.balance);
    const bcv = this.financeService.currentBcvRate();
    const eurUsd = this.financeService.currentEurUsdRate();
    const balanceUsdEquivalent =
      vault.currency === 'VES'
        ? bcv > 0
          ? roundMoney(rounded / bcv)
          : 0
        : vault.currency === 'EUR'
          ? eurUsd > 0
            ? roundMoney(rounded * eurUsd)
            : 0
          : rounded;
    const balanceVesEquivalent =
      vault.currency === 'VES' ? rounded : bcv > 0 ? roundMoney(balanceUsdEquivalent * bcv) : 0;

    this.financeService.updateAssetVault(vault.id, {
      balance: rounded,
      balanceUsdEquivalent,
      balanceVesEquivalent,
    });
    this.toast.success(
      `Saldo de "${vault.name}" actualizado a ${vault.currency} ${rounded.toLocaleString('en-US')}.`,
    );
  }

  handleDeleteVault(vaultId: string): void {
    const vault = this.financeService.state().assets.find((v) => v.id === vaultId);
    this.financeService.deleteAssetVault(vaultId);
    this.toast.info(`Bóveda "${vault?.name ?? vaultId}" eliminada.`);
  }

  handleReconcileVault(payload: F360VaultReconcilePayload): void {
    const vault = this.financeService.state().assets.find((v) => v.id === payload.vaultId);
    if (!vault) return;
    const res = this.financeService.reconcileVaultBalance(vault.id, payload.actualBalance);
    if (res.deltaInCurrency === 0) {
      this.toast.info(`Arqueo de "${vault.name}": saldo cuadrado sin descuadres.`);
    } else {
      const sign = res.deltaInCurrency > 0 ? '+' : '';
      this.toast.success(
        `Arqueo de "${vault.name}" asentado: ajuste de ${sign}${res.deltaInCurrency.toLocaleString('en-US')} ${vault.currency}.`,
      );
    }
  }

  handleUpdateMovement(payload: F360LedgerEditPayload): void {
    this.financeService.updateMovement(payload.id, payload.type, {
      title: payload.title,
      amountUsd: payload.amountUsd,
    });
    this.toast.success(
      `Movimiento "${payload.title}" ($${payload.amountUsd.toFixed(2)} USD) actualizado.`,
    );
  }

  handleDeleteMovement(payload: F360LedgerDeletePayload): void {
    this.financeService.deleteMovement(payload.id, payload.type);
    this.toast.info('Movimiento eliminado y saldo de bóveda revertido.');
  }

  openTransferModal(defaultFromVaultId?: string): void {
    const vaults = this.financeService.assets();
    if (vaults.length < 2) {
      this.toast.warn('Necesitas al menos 2 bóvedas en este ámbito para transferir fondos.');
      return;
    }
    const fromId =
      defaultFromVaultId && vaults.some((v) => v.id === defaultFromVaultId)
        ? defaultFromVaultId
        : vaults[0].id;
    const toVault = vaults.find((v) => v.id !== fromId) ?? vaults[0];
    this.transferFromId.set(fromId);
    this.transferToId.set(toVault.id);
    this.transferAmount.set(null);
    this.transferModalOpen.set(true);
  }

  executeVaultTransfer(): void {
    const amount = this.transferAmount() ?? 0;
    const res = this.financeService.transferBetweenVaults(
      this.transferFromId(),
      this.transferToId(),
      amount,
    );
    if (res.success) {
      this.toast.success(
        `Transferencia ejecutada: acreditados ${res.targetCurrency} ${res.creditedAmount.toLocaleString('en-US')}.`,
      );
      this.transferModalOpen.set(false);
    } else if (res.reason === 'INSUFFICIENT_FUNDS') {
      this.toast.error('Fondos insuficientes en la bóveda origen. No se permiten sobregiros.');
    } else if (res.reason === 'MISSING_FX_RATE') {
      this.toast.warn('Tasa FX en vivo no disponible para esta conversión de divisas.');
    } else {
      this.toast.warn('Verifica la bóveda de origen/destino y el monto a transferir.');
    }
  }

  // -------------------------------------------------------------
  // LIABILITIES & WEALTH GOALS
  // -------------------------------------------------------------

  openNewLiabilityModal(): void {
    this.liabTitle.set('');
    this.liabCreditor.set('');
    this.liabAmountUsd.set(null);
    this.liabDueDate.set(addCalendarDays(todayVetIso(), 5));
    const currentScope = this.financeService.scope();
    this.liabScope.set(currentScope === 'all' ? 'personal' : currentScope);
    this.liabCategory.set(currentScope === 'business' ? 'provider' : 'fixed_service');
    this.newLiabilityModalOpen.set(true);
  }

  saveNewLiability(): void {
    const title = this.liabTitle().trim();
    const amount = this.liabAmountUsd();
    if (!title || !amount || amount <= 0) {
      this.toast.warn('Ingresa el concepto del compromiso y un monto válido en USD.');
      return;
    }

    const bcv = this.financeService.currentBcvRate();
    const parallel = this.financeService.currentParallelRate();
    const tri = computeTriMonetaryAmount(amount, 'USD', bcv, parallel);

    this.financeService.addLiability({
      title,
      creditor: this.liabCreditor().trim() || 'Compromiso Programado',
      scope: this.liabScope(),
      category: this.liabCategory(),
      triMonetary: tri,
      dueDate: this.liabDueDate(),
      status: 'pending',
      amountPaid: 0,
      remainingAmount: amount,
    });

    this.newLiabilityModalOpen.set(false);
    this.toast.success(`Compromiso "${title}" ($${amount.toFixed(2)} USD) agendado.`);
  }

  openPayLiabilityModal(item: F360OverviewUpcomingItem): void {
    this.targetLiabilityForPayment.set(item);
    this.payLiabilityAmountUsd.set(item.remainingUsd);
    this.payLiabilityModalOpen.set(true);
  }

  closePayLiabilityModal(): void {
    this.payLiabilityModalOpen.set(false);
    this.targetLiabilityForPayment.set(null);
  }

  confirmPayLiability(): void {
    const item = this.targetLiabilityForPayment();
    const amount = this.payLiabilityAmountUsd();
    if (!item || !amount || amount <= 0) {
      this.toast.warn('Ingresa un monto de pago válido en USD.');
      return;
    }
    const debitVaultId = this.payLiabilityVaultId() || undefined;
    const result = this.financeService.payLiability(item.id, amount, debitVaultId, true);
    this.closePayLiabilityModal();

    if (result.success) {
      const vaultName =
        this.financeService.state().assets.find((v) => v.id === debitVaultId)?.name ??
        'Registro Contable';
      this.toast.success(
        `Pago de $${result.appliedAmountUsd.toFixed(2)} USD aplicado a "${item.title}" desde "${vaultName}".`,
      );
    } else {
      this.toast.warn('No se pudo aplicar el pago a este pasivo.');
    }
  }

  handleDeleteLiability(item: F360OverviewUpcomingItem): void {
    this.financeService.deleteLiability(item.id);
    this.toast.info(`Compromiso "${item.title}" eliminado del calendario.`);
  }

  openNewGoalModal(): void {
    this.newGoalTitle.set('');
    this.newGoalTargetUsd.set(null);
    this.newGoalCurrentUsd.set(0);
    this.newGoalDeadline.set(addCalendarDays(todayVetIso(), 90));
    this.newGoalCategory.set('emergency');
    this.newGoalModalOpen.set(true);
  }

  saveNewGoal(): void {
    const title = this.newGoalTitle().trim();
    const target = this.newGoalTargetUsd();
    if (!title || !target || target <= 0) {
      this.toast.warn('Ingresa el nombre y un monto meta válido en USD.');
      return;
    }

    const currentScope = this.financeService.scope();
    this.financeService.addWealthGoal({
      title,
      targetAmountUsd: roundMoney(target),
      currentAmountUsd: roundMoney(Math.max(0, this.newGoalCurrentUsd() ?? 0)),
      scope: currentScope === 'all' ? 'personal' : currentScope,
      deadline: this.newGoalDeadline(),
      category: this.newGoalCategory(),
    });

    this.newGoalModalOpen.set(false);
    this.toast.success(`Meta patrimonial "${title}" ($${target.toFixed(2)} USD) creada.`);
  }

  openContributeGoalModal(goal: WealthGoal): void {
    this.targetGoalForContribution.set(goal);
    this.contributeAmountUsd.set(50);
    this.contributeGoalModalOpen.set(true);
  }

  closeContributeGoalModal(): void {
    this.contributeGoalModalOpen.set(false);
    this.targetGoalForContribution.set(null);
  }

  saveGoalContribution(): void {
    const goal = this.targetGoalForContribution();
    const amount = this.contributeAmountUsd();
    if (!goal || !amount || amount <= 0) {
      this.toast.warn('Ingresa un monto de aporte válido.');
      return;
    }

    const success = this.financeService.contributeToWealthGoal(
      goal.id,
      amount,
      this.contributeVaultId() || undefined,
    );
    this.closeContributeGoalModal();

    if (success) {
      const newTotal = goal.currentAmountUsd + amount;
      if (newTotal >= goal.targetAmountUsd) {
        this.toast.success(`Meta "${goal.title}" alcanzada al 100%.`);
      } else {
        this.toast.success(`Reserva de $${amount.toFixed(2)} USD asignada a "${goal.title}".`);
      }
    } else {
      this.toast.warn('No se pudo reservar el fondo para esta meta.');
    }
  }

  handleDeleteGoal(goal: WealthGoal): void {
    this.financeService.deleteWealthGoal(goal.id);
    this.toast.info(`Meta "${goal.title}" eliminada.`);
  }

  // -------------------------------------------------------------
  // QUICK TRANSACTION, VOICE & VISION OCR
  // -------------------------------------------------------------

  openQuickModal(type: 'expense' | 'income' | 'audio'): void {
    this.quickModalType.set(type);
    this.formTitle.set('');
    this.formAmount.set(null);
    this.formCurrency.set('USD');
    const currentScope = this.financeService.scope();
    this.formScope.set(currentScope === 'all' ? 'personal' : currentScope);
    this.formReferenceNumber.set('');
    this.formNotes.set('');
    this.feeRatePct.set(0);
    this.smartCommandText.set('');
    this.scannedReceiptName.set('');
    this.isScanningReceipt.set(false);
    this.lastVoiceBadges.set([]);
    this.quickModalOpen.set(true);

    if (type === 'audio') {
      void this.startVoiceDictation();
    }
  }

  closeQuickModal(): void {
    this.quickModalOpen.set(false);
    this.voice.stopListening();
    this.isScanningReceipt.set(false);
  }

  async onReceiptFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.processReceiptFile(file);
    input.value = '';
  }

  async onReceiptPaste(event: ClipboardEvent): Promise<void> {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          await this.processReceiptFile(file);
          return;
        }
      }
    }
  }

  private async processReceiptFile(file: File): Promise<void> {
    this.isScanningReceipt.set(true);
    this.scannedReceiptName.set(file.name || 'Captura de Comprobante');

    try {
      const base64DataUrl = await this.readFileAsDataUrl(file);
      const base64Clean = base64DataUrl.includes(',')
        ? base64DataUrl.split(',')[1]
        : base64DataUrl;

      const parsed = await this.aiIngestor.analyzeReceiptImage(
        base64Clean,
        file.type || 'image/jpeg',
        `${file.name} ${this.smartCommandText()}`,
      );

      this.quickModalType.set(parsed.pillar === 'income' ? 'income' : 'expense');
      this.formTitle.set(parsed.title || 'Comprobante Escaneado');
      if (parsed.amount > 0) {
        this.formAmount.set(parsed.amount);
      }
      this.formCurrency.set(parsed.currency);
      this.formScope.set(parsed.scope === 'all' ? 'personal' : parsed.scope);

      if (parsed.pillar === 'income' && parsed.incomeCategory) {
        this.formIncomeCategory.set(parsed.incomeCategory);
      } else if (parsed.expenseCategory) {
        this.formExpenseCategory.set(parsed.expenseCategory);
      }

      if (parsed.referenceNumber) {
        this.formReferenceNumber.set(parsed.referenceNumber);
      }

      const matchingVault = this.liquidVaults().find((v) => v.currency === parsed.currency);
      if (matchingVault) {
        this.formVaultId.set(matchingVault.id);
      }

      this.formNotes.set(
        `Comprobante procesado por Visión IA (${file.name || 'imagen'})${parsed.referenceNumber ? ' · Ref: ' + parsed.referenceNumber : ''}`,
      );
      this.toast.success('Comprobante analizado. Verifica los datos extraídos antes de guardar.');
    } catch {
      this.toast.warn('No se pudo leer la imagen del comprobante. Ingresa el monto manualmente.');
    } finally {
      this.isScanningReceipt.set(false);
    }
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  async startVoiceDictation(): Promise<void> {
    const startResult = await this.voice.startListening('finance360', (transcript) => {
      this.smartCommandText.set(transcript);
      this.parseNaturalLanguageCommand();
    });
    if (startResult.status === 'error' || startResult.status === 'no_api_key') {
      this.toast.warn(
        startResult.error ||
          'No se pudo iniciar la captura de voz. Puedes escribir el comando manualmente.',
      );
    }
  }

  toggleVoiceInModal(): void {
    if (this.voice.isListening()) {
      this.voice.stopListening();
    } else {
      void this.startVoiceDictation();
    }
  }

  parseNaturalLanguageCommand(): void {
    const raw = this.smartCommandText().trim();
    if (!raw) {
      this.toast.warn('Escribe o dicta una frase como: "Gasté 25 dólares en gasolina por Pago Móvil"');
      return;
    }

    const bcv = this.financeService.currentBcvRate();
    const voiceParsed = this.voice.parseFinance360Command(raw, bcv);
    this.lastVoiceBadges.set(voiceParsed.summaryBadges);

    this.quickModalType.set(voiceParsed.pillar);
    if (voiceParsed.amount > 0) {
      this.formAmount.set(voiceParsed.amount);
    }
    this.formCurrency.set(voiceParsed.currency);
    this.formScope.set(voiceParsed.scope);

    if (voiceParsed.pillar === 'income') {
      this.formIncomeCategory.set(voiceParsed.incomeCategory);
    } else {
      this.formExpenseCategory.set(voiceParsed.expenseCategory);
    }

    if (voiceParsed.feeRatePct > 0) {
      this.feeRatePct.set(voiceParsed.feeRatePct);
    }
    if (voiceParsed.referenceNumber) {
      this.formReferenceNumber.set(voiceParsed.referenceNumber);
    }

    this.formTitle.set(voiceParsed.title);
    this.formNotes.set(`Comando Inteligente: "${raw}"`);

    const allVaults = this.liquidVaults();
    let matchedVault: AssetVault | undefined;

    if (voiceParsed.vaultHint === 'zelle') {
      matchedVault = allVaults.find((v) => v.channel === 'zelle');
    } else if (voiceParsed.vaultHint === 'bs_bank') {
      matchedVault = allVaults.find((v) => v.currency === 'VES' || v.channel === 'bs_bank');
    } else if (voiceParsed.vaultHint === 'crypto') {
      matchedVault = allVaults.find((v) => v.currency === 'USDT' || v.channel === 'crypto');
    } else if (voiceParsed.vaultHint === 'pyme') {
      matchedVault = allVaults.find((v) => v.scope === 'business');
    } else if (voiceParsed.vaultHint === 'cash') {
      matchedVault = allVaults.find((v) => v.channel === 'cash');
    }

    if (!matchedVault) {
      matchedVault = allVaults.find((v) => v.currency === voiceParsed.currency);
    }
    if (matchedVault) {
      this.formVaultId.set(matchedVault.id);
    }

    this.toast.success(
      `Comando clasificado (${voiceParsed.summaryBadges.join(' · ') || 'Listo'}).`,
      'Finanzas 360',
    );
  }

  saveQuickTransaction(): void {
    const amount = this.formAmount();
    if (!amount || amount <= 0) {
      this.toast.warn('Por favor ingresa un monto válido mayor a cero.');
      return;
    }

    const vaultId = this.formVaultId() || undefined;
    const referenceNumber = this.formReferenceNumber().trim() || undefined;
    if (referenceNumber && this.financeService.isDuplicateReference(referenceNumber, vaultId)) {
      this.toast.warn(
        `La referencia "${referenceNumber}" ya fue registrada en esta bóveda. Verifica para evitar duplicados.`,
      );
      return;
    }

    const bcv = this.financeService.currentBcvRate();
    const parallel = this.financeService.currentParallelRate();
    const eurUsd = this.financeService.currentEurUsdRate();
    const currency = this.formCurrency();
    const feePct = this.feeRatePct();
    let finalAmount = amount;
    let feeNote = '';

    if ((this.quickModalType() === 'expense' || this.quickModalType() === 'audio') && feePct > 0) {
      const feeAmount = roundMoney((amount * feePct) / 100);
      finalAmount = roundMoney(amount + feeAmount);
      const feeLabel = feePct === 0.3 ? 'Pago Móvil (+0.3%)' : 'IGTF (+3.0%)';
      feeNote = ` · [Comisión Bancaria: ${feeLabel} +${currency} ${feeAmount.toLocaleString('en-US')}]`;
    }

    const tri = computeTriMonetaryAmount(finalAmount, currency, bcv, parallel, eurUsd);
    const scope = this.formScope();
    const channel: PaymentChannel =
      currency === 'VES' ? 'bs_bank' : currency === 'USDT' ? 'crypto' : 'zelle';
    const date = todayVetIso();

    if (this.quickModalType() === 'expense' || this.quickModalType() === 'audio') {
      const title = this.formTitle().trim() || 'Gasto Operativo';
      this.financeService.addExpense({
        title,
        scope,
        category: this.formExpenseCategory(),
        channel,
        vaultId,
        triMonetary: tri,
        date,
        referenceNumber,
        notes: (this.formNotes().trim() + feeNote).trim() || undefined,
      });
      this.toast.success(
        `Gasto registrado: $${tri.amount_usd.toFixed(2)} USD${feeNote ? ' (incluye comisión)' : ''}.`,
      );
    } else {
      const title = this.formTitle().trim() || 'Ingreso Registrado';
      this.financeService.addIncome({
        title,
        scope,
        category: this.formIncomeCategory(),
        channel,
        vaultId,
        triMonetary: tri,
        date,
        referenceNumber,
        notes: this.formNotes().trim() || undefined,
      });
      this.toast.success(`Ingreso registrado: $${tri.amount_usd.toFixed(2)} USD.`);
    }

    this.closeQuickModal();
  }

  // -------------------------------------------------------------
  // P2P BRIDGE, DEMO, BACKUP & TYPED RESET
  // -------------------------------------------------------------

  triggerP2pImport(): void {
    const currentScope = this.financeService.scope();
    const targetScope = currentScope === 'all' ? 'personal' : currentScope;
    const result = this.financeService.importDailyP2pProfit(targetScope);

    if (result.success) {
      this.toast.success(
        `Profit P2P del día ($${result.profitUsd.toFixed(2)} USD) importado al portafolio 360.`,
      );
    } else {
      this.toast.warn('No se detectó ganancia neta positiva en la Mesa P2P hoy para importar.');
    }
  }

  loadDemoPortfolio(): void {
    this.financeService.loadDemoPortfolio();
    this.toast.success('Portafolio Demo cargado para exploración.');
  }

  clearDemoPortfolio(): void {
    this.financeService.clearDemoData();
    this.toast.info('Registros de demostración eliminados. Tus datos reales se mantienen.');
  }

  openResetConfirmModal(): void {
    this.resetConfirmText.set('');
    this.resetConfirmModalOpen.set(true);
  }

  closeResetConfirmModal(): void {
    this.resetConfirmModalOpen.set(false);
    this.resetConfirmText.set('');
  }

  confirmResetPortfolio(): void {
    if (!this.canConfirmReset()) {
      this.toast.warn('Escribe RESET exactamente para confirmar el reinicio total.');
      return;
    }
    this.financeService.resetLedgerToZero();
    this.closeResetConfirmModal();
    this.toast.warn('Portafolio reiniciado a cero (estado Zero-Seed).');
  }

  async syncToGoogleDrive(): Promise<void> {
    await this.driveSync.triggerCloudSync();
  }

  downloadJsonBackup(): void {
    this.driveSync.downloadMasterLedgerJson();
  }

  async onRestoreJsonSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const rawText = await file.text();
      this.driveSync.restoreFromJsonString(rawText);
    } catch {
      this.toast.error('No se pudo leer el archivo de respaldo JSON.');
    } finally {
      input.value = '';
    }
  }

  downloadCsvExport(type: 'expenses' | 'incomes' | 'liabilities'): void {
    this.driveSync.downloadCsv(type);
  }

  toggleMobileFab(): void {
    this.mobileFabOpen.update((open) => !open);
  }
}
