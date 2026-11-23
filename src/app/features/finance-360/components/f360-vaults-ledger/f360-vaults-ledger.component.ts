import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  AssetVault,
  F360LedgerDeletePayload,
  F360LedgerEditPayload,
  F360LedgerFilter,
  F360LedgerRowItem,
  F360VaultBalanceEditPayload,
  F360VaultReconcilePayload,
  F360VesExposureView,
  FinanceScope,
  VaultReconciliationRecord,
} from '../../f360-ui.models';

interface FilterOption {
  readonly id: F360LedgerFilter;
  readonly label: string;
}

interface ReconcilePreview {
  readonly hasInput: boolean;
  readonly isBalanced: boolean;
  readonly deltaInCurrency: number;
  readonly deltaUsd: number;
  readonly badgeLabel: string;
  readonly tone: 'emerald' | 'cyan' | 'danger' | 'neutral';
}

const FILTER_OPTIONS: readonly FilterOption[] = [
  { id: 'all', label: 'Todos' },
  { id: 'income', label: 'Ingresos' },
  { id: 'expense', label: 'Egresos' },
  { id: 'transfer', label: 'Transferencias' },
];

const SCOPE_LABELS: Record<FinanceScope, string> = {
  all: 'Consolidado',
  personal: 'Personal',
  business: 'Pyme',
};

const PAGE_SIZE = 15;

@Component({
  selector: 'app-f360-vaults-ledger',
  standalone: true,
  imports: [],
  templateUrl: './f360-vaults-ledger.component.html',
  styleUrl: './f360-vaults-ledger.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.scope-all]': "activeScope() === 'all'",
    '[class.scope-personal]': "activeScope() === 'personal'",
    '[class.scope-business]': "activeScope() === 'business'",
    '[class.privacy-active]': 'privacyMode()',
  },
})
export class F360VaultsLedgerComponent {
  readonly activeScope = input<FinanceScope>('all');
  readonly assets = input<readonly AssetVault[]>([]);
  readonly totalAssetsUsd = input<number>(0);
  readonly bcvRate = input<number>(0);
  readonly parallelRate = input<number>(0);
  readonly eurUsdRate = input<number>(0);
  readonly vesExposure = input<F360VesExposureView>({
    vesBalanceTotal: 0,
    vesEquivalentUsd: 0,
    exposurePct: 0,
    rateGapPct: 0,
    erosionLoss5PctUsd: 0,
    isHighExposure: false,
  });
  readonly ledgerRows = input<readonly F360LedgerRowItem[]>([]);
  readonly reconciliations = input<readonly VaultReconciliationRecord[]>([]);
  readonly privacyMode = input<boolean>(false);

  readonly openNewVault = output<void>();
  readonly openTransfer = output<string | undefined>();
  readonly updateVaultBalance = output<F360VaultBalanceEditPayload>();
  readonly deleteVault = output<string>();
  readonly updateMovement = output<F360LedgerEditPayload>();
  readonly deleteMovement = output<F360LedgerDeletePayload>();
  readonly reconcileVault = output<F360VaultReconcilePayload>();

  protected readonly filterOptions = FILTER_OPTIONS;
  protected readonly pageSize = PAGE_SIZE;

  // Contextual menus
  protected readonly openVaultMenuId = signal<string | null>(null);
  protected readonly openRowMenuId = signal<string | null>(null);

  // Inline vault balance edit state
  protected readonly editingVaultId = signal<string | null>(null);
  protected readonly editingVaultBalanceText = signal<string>('');

  // Ledger filters & pagination
  protected readonly activeFilter = signal<F360LedgerFilter>('all');
  protected readonly searchQuery = signal<string>('');
  protected readonly currentPage = signal<number>(1);

  // Inline movement edit state
  protected readonly editingRowId = signal<string | null>(null);
  protected readonly editingRowType = signal<'income' | 'expense'>('expense');
  protected readonly editingRowTitle = signal<string>('');
  protected readonly editingRowAmountText = signal<string>('');

  // Arqueo & Reconciliation inspector state
  protected readonly selectedReconcileVaultId = signal<string>('');
  protected readonly reconcileActualText = signal<string>('');

  protected readonly hardCurrencyPct = computed<number>(() => {
    const exp = this.vesExposure().exposurePct;
    if (this.assets().length === 0) return 0;
    return Math.max(0, Math.min(100, Number((100 - exp).toFixed(1))));
  });

  protected readonly vesExposureClampedPct = computed<number>(() => {
    if (this.assets().length === 0) return 0;
    return Math.max(0, Math.min(100, Number(this.vesExposure().exposurePct.toFixed(1))));
  });

  protected readonly rateGapDisplay = computed<string>(() => {
    if (this.bcvRate() <= 0) return 'Tasa BCV offline';
    if (this.parallelRate() <= 0) return 'Paralelo offline';
    return `${this.vesExposure().rateGapPct.toFixed(1)}%`;
  });

  protected readonly filteredRows = computed<readonly F360LedgerRowItem[]>(() => {
    const filter = this.activeFilter();
    const query = this.searchQuery().trim().toLowerCase();

    return this.ledgerRows().filter((row) => {
      if (filter !== 'all' && row.kind !== filter) return false;
      if (query) {
        const haystack =
          `${row.title} ${row.categoryLabel} ${row.vaultName} ${row.referenceNumber ?? ''} ${row.notes ?? ''}`.toLowerCase();
        return haystack.includes(query);
      }
      return true;
    });
  });

  protected readonly totalPages = computed<number>(() =>
    Math.max(1, Math.ceil(this.filteredRows().length / PAGE_SIZE)),
  );

  protected readonly safeCurrentPage = computed<number>(() =>
    Math.min(this.currentPage(), this.totalPages()),
  );

  protected readonly paginatedRows = computed<readonly F360LedgerRowItem[]>(() => {
    const page = this.safeCurrentPage();
    const start = (page - 1) * PAGE_SIZE;
    return this.filteredRows().slice(start, start + PAGE_SIZE);
  });

  protected readonly pageRangeLabel = computed<string>(() => {
    const total = this.filteredRows().length;
    if (total === 0) return '0 registros';
    const start = (this.safeCurrentPage() - 1) * PAGE_SIZE + 1;
    const end = Math.min(total, start + PAGE_SIZE - 1);
    return `Mostrando ${start}–${end} de ${total}`;
  });

  protected readonly effectiveReconcileVault = computed<AssetVault | null>(() => {
    const vaults = this.assets();
    if (vaults.length === 0) return null;
    const selectedId = this.selectedReconcileVaultId();
    return vaults.find((v) => v.id === selectedId) ?? vaults[0];
  });

  protected readonly reconcilePreview = computed<ReconcilePreview>(() => {
    const vault = this.effectiveReconcileVault();
    const raw = this.reconcileActualText().trim();
    if (!vault || raw === '') {
      return {
        hasInput: false,
        isBalanced: false,
        deltaInCurrency: 0,
        deltaUsd: 0,
        badgeLabel: 'Ingresa saldo real',
        tone: 'neutral',
      };
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return {
        hasInput: false,
        isBalanced: false,
        deltaInCurrency: 0,
        deltaUsd: 0,
        badgeLabel: 'Monto inválido',
        tone: 'danger',
      };
    }

    const delta = Number((parsed - vault.balance).toFixed(2));
    const bcv = this.bcvRate();
    const eurUsd = this.eurUsdRate() > 0 ? this.eurUsdRate() : 0;
    const deltaUsd =
      vault.currency === 'VES'
        ? bcv > 0
          ? Number((delta / bcv).toFixed(2))
          : 0
        : vault.currency === 'EUR'
          ? eurUsd > 0
            ? Number((delta * eurUsd).toFixed(2))
            : 0
          : delta;

    if (Math.abs(delta) < 0.005) {
      return {
        hasInput: true,
        isBalanced: true,
        deltaInCurrency: 0,
        deltaUsd: 0,
        badgeLabel: 'Cuadrado · 0.00',
        tone: 'emerald',
      };
    }

    const sign = delta > 0 ? '+' : '-';
    const absStr = this.formatAmount(Math.abs(delta));
    return {
      hasInput: true,
      isBalanced: false,
      deltaInCurrency: delta,
      deltaUsd,
      badgeLabel: `${delta > 0 ? 'Sobrante' : 'Faltante'} ${sign}${absStr} ${vault.currency}`,
      tone: delta > 0 ? 'cyan' : 'danger',
    };
  });

  protected readonly recentReconciliations = computed<readonly VaultReconciliationRecord[]>(() =>
    this.reconciliations().slice(0, 6),
  );

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.openVaultMenuId.set(null);
    this.openRowMenuId.set(null);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('.f360-menu-anchor')) {
      this.openVaultMenuId.set(null);
      this.openRowMenuId.set(null);
    }
  }

  protected toggleVaultMenu(vaultId: string): void {
    this.openRowMenuId.set(null);
    this.openVaultMenuId.update((curr) => (curr === vaultId ? null : vaultId));
  }

  protected startVaultReconcile(vault: AssetVault): void {
    this.openVaultMenuId.set(null);
    this.selectedReconcileVaultId.set(vault.id);
    this.reconcileActualText.set(String(vault.balance));
  }

  protected startEditVaultBalance(vault: AssetVault): void {
    this.openVaultMenuId.set(null);
    this.editingVaultId.set(vault.id);
    this.editingVaultBalanceText.set(String(vault.balance));
  }

  protected onVaultBalanceInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.editingVaultBalanceText.set(target?.value ?? '');
  }

  protected saveVaultBalance(vault: AssetVault): void {
    const parsed = Number(this.editingVaultBalanceText());
    if (!Number.isFinite(parsed) || parsed < 0) return;
    this.updateVaultBalance.emit({
      vaultId: vault.id,
      balance: Number(parsed.toFixed(2)),
    });
    this.editingVaultId.set(null);
  }

  protected cancelVaultBalanceEdit(): void {
    this.editingVaultId.set(null);
    this.editingVaultBalanceText.set('');
  }

  protected handleVaultTransfer(vaultId: string): void {
    this.openVaultMenuId.set(null);
    this.openTransfer.emit(vaultId);
  }

  protected handleDeleteVault(vaultId: string): void {
    this.openVaultMenuId.set(null);
    this.deleteVault.emit(vaultId);
  }

  protected selectFilter(filter: F360LedgerFilter): void {
    this.activeFilter.set(filter);
    this.currentPage.set(1);
    this.openRowMenuId.set(null);
  }

  protected onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.searchQuery.set(target?.value ?? '');
    this.currentPage.set(1);
  }

  protected prevPage(): void {
    this.currentPage.update((page) => Math.max(1, page - 1));
  }

  protected nextPage(): void {
    this.currentPage.update((page) => Math.min(this.totalPages(), page + 1));
  }

  protected toggleRowMenu(rowId: string): void {
    this.openVaultMenuId.set(null);
    this.openRowMenuId.update((curr) => (curr === rowId ? null : rowId));
  }

  protected startEditRow(row: F360LedgerRowItem): void {
    if (row.kind === 'transfer') return;
    this.openRowMenuId.set(null);
    this.editingRowId.set(row.id);
    this.editingRowType.set(row.kind);
    this.editingRowTitle.set(row.title);
    this.editingRowAmountText.set(String(row.amountUsd));
  }

  protected onEditRowTitleInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.editingRowTitle.set(target?.value ?? '');
  }

  protected onEditRowAmountInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.editingRowAmountText.set(target?.value ?? '');
  }

  protected saveRowEdit(): void {
    const id = this.editingRowId();
    const title = this.editingRowTitle().trim();
    const amount = Number(this.editingRowAmountText());
    if (!id || !title || !Number.isFinite(amount) || amount <= 0) return;

    this.updateMovement.emit({
      id,
      type: this.editingRowType(),
      title,
      amountUsd: Number(amount.toFixed(2)),
    });
    this.editingRowId.set(null);
  }

  protected cancelRowEdit(): void {
    this.editingRowId.set(null);
  }

  protected handleDeleteRow(row: F360LedgerRowItem): void {
    if (row.kind === 'transfer') return;
    this.openRowMenuId.set(null);
    this.deleteMovement.emit({
      id: row.id,
      type: row.kind,
    });
  }

  protected onReconcileVaultChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const nextId = target?.value ?? '';
    this.selectedReconcileVaultId.set(nextId);
    this.reconcileActualText.set('');
  }

  protected onReconcileActualInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.reconcileActualText.set(target?.value ?? '');
  }

  protected submitReconciliation(event: Event): void {
    event.preventDefault();
    const vault = this.effectiveReconcileVault();
    const preview = this.reconcilePreview();
    if (!vault || !preview.hasInput) return;

    const actual = Number(this.reconcileActualText());
    if (!Number.isFinite(actual) || actual < 0) return;

    this.reconcileVault.emit({
      vaultId: vault.id,
      actualBalance: Number(actual.toFixed(2)),
    });
    this.reconcileActualText.set('');
  }

  protected focusFirstVaultReconcile(): void {
    const first = this.effectiveReconcileVault();
    if (first) {
      this.selectedReconcileVaultId.set(first.id);
    }
  }

  protected vaultSharePercent(vault: AssetVault): number {
    const total = this.totalAssetsUsd();
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((vault.balanceUsdEquivalent / total) * 100)));
  }

  protected vaultEquivalentLabel(vault: AssetVault): string {
    const bcv = this.bcvRate();
    if (vault.currency === 'VES') {
      if (bcv <= 0) return 'Tasa BCV offline';
      return `≈ $${this.formatAmount(vault.balance / bcv)} USD`;
    }
    if (vault.currency === 'EUR') {
      const usdStr = `≈ $${this.formatAmount(vault.balanceUsdEquivalent)} USD`;
      if (bcv <= 0) return `${usdStr} · BCV offline`;
      return `${usdStr} · Bs ${this.formatAmount(vault.balanceUsdEquivalent * bcv)}`;
    }
    if (bcv <= 0) return 'Tasa BCV offline';
    return `≈ Bs ${this.formatAmount(vault.balance * bcv)} BCV`;
  }

  protected scopeLabel(scope: FinanceScope): string {
    return SCOPE_LABELS[scope] ?? scope;
  }

  protected currencyClass(vault: AssetVault): string {
    return `curr-${vault.currency.toLowerCase()}`;
  }

  protected formatAmount(value: number): string {
    const safe = Number.isFinite(value) ? value : 0;
    return safe.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
