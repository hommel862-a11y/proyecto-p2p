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
  F360Horizon,
  F360NavTabId,
  F360OverflowActionId,
  F360QuickActionId,
  FinanceScope,
} from '../../f360-ui.models';

export const F360_HEADER_POPOVER = {
  HORIZON: 'horizon',
  REGISTER: 'register',
  OVERFLOW: 'overflow',
} as const;
type HeaderPopover = (typeof F360_HEADER_POPOVER)[keyof typeof F360_HEADER_POPOVER] | null;

interface ScopeTabOption {
  readonly id: FinanceScope;
  readonly label: string;
  readonly hint: string;
}

interface HorizonOption {
  readonly id: F360Horizon;
  readonly shortLabel: string;
  readonly fullLabel: string;
}

interface NavPillOption {
  readonly id: F360NavTabId;
  readonly label: string;
}

interface QuickActionOption {
  readonly id: F360QuickActionId;
  readonly label: string;
  readonly hint: string;
}

interface OverflowActionOption {
  readonly id: F360OverflowActionId;
  readonly label: string;
  readonly group: 'view' | 'data' | 'export' | 'danger';
}

const SCOPE_OPTIONS: readonly ScopeTabOption[] = [
  { id: 'all', label: 'Consolidado', hint: 'Patrimonio total personal y Pyme' },
  { id: 'personal', label: 'Personal', hint: 'Finanzas personales y hogar' },
  { id: 'business', label: 'Pyme', hint: 'Operación comercial y gavetas' },
];

const HORIZON_OPTIONS: readonly HorizonOption[] = [
  { id: 'day', shortLabel: 'Hoy', fullLabel: 'Hoy (VET)' },
  { id: 'week', shortLabel: '7D', fullLabel: 'Últimos 7 días' },
  { id: 'month', shortLabel: '30D', fullLabel: 'Últimos 30 días' },
  { id: 'quarter', shortLabel: '90D', fullLabel: 'Últimos 90 días' },
  { id: 'year', shortLabel: '12M', fullLabel: 'Últimos 12 meses' },
];

const NAV_OPTIONS: readonly NavPillOption[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'vaults', label: 'Bóvedas & Libro' },
  { id: 'analytics', label: 'CFO & Analítica' },
  { id: 'cashea', label: 'Cashea 14D' },
  { id: 'pyme_quotes', label: 'Pyme & Presupuestos' },
];

const QUICK_ACTION_OPTIONS: readonly QuickActionOption[] = [
  { id: 'income', label: 'Ingreso', hint: 'Sueldo, venta o honorarios' },
  { id: 'expense', label: 'Gasto', hint: 'Egreso operativo o personal' },
  { id: 'transfer', label: 'Transferencia FX', hint: 'Partida doble entre bóvedas' },
  { id: 'audio', label: 'Dictar / IA', hint: 'Nota de voz o recibo OCR' },
  { id: 'new_vault', label: 'Nueva Bóveda', hint: 'Cuenta USD, USDT, VES o EUR' },
  { id: 'new_liability', label: 'Nuevo Pasivo', hint: 'Deuda, servicio o proveedor' },
  { id: 'new_goal', label: 'Nueva Meta', hint: 'Fondo blindado etiquetado' },
];

const OVERFLOW_ACTION_OPTIONS: readonly OverflowActionOption[] = [
  { id: 'toggle_privacy', label: 'Privacidad', group: 'view' },
  { id: 'load_demo', label: 'Cargar Demo', group: 'data' },
  { id: 'clear_demo', label: 'Limpiar Demo', group: 'data' },
  { id: 'sync_drive', label: 'Sincronizar Drive', group: 'data' },
  { id: 'export_json', label: 'Exportar JSON', group: 'export' },
  { id: 'restore_json', label: 'Restaurar JSON', group: 'export' },
  { id: 'export_csv_incomes', label: 'CSV Ingresos', group: 'export' },
  { id: 'export_csv_expenses', label: 'CSV Gastos', group: 'export' },
  { id: 'export_csv_liabilities', label: 'CSV Pasivos', group: 'export' },
  { id: 'request_reset', label: 'Resetear Portafolio', group: 'danger' },
];

@Component({
  selector: 'app-f360-command-header',
  standalone: true,
  imports: [],
  templateUrl: './f360-command-header.component.html',
  styleUrl: './f360-command-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.scope-all]': "activeScope() === 'all'",
    '[class.scope-personal]': "activeScope() === 'personal'",
    '[class.scope-business]': "activeScope() === 'business'",
    '[class.privacy-active]': 'privacyMode()',
  },
})
export class F360CommandHeaderComponent {
  readonly activeScope = input<FinanceScope>('all');
  readonly activeTab = input<F360NavTabId>('overview');
  readonly horizon = input<F360Horizon>('month');
  readonly privacyMode = input<boolean>(false);
  readonly overdueCount = input<number>(0);
  readonly vaultsCount = input<number>(0);
  readonly casheaActiveCount = input<number>(0);
  readonly pymeAlertsCount = input<number>(0);
  readonly driveSyncing = input<boolean>(false);

  readonly scopeChange = output<FinanceScope>();
  readonly tabChange = output<F360NavTabId>();
  readonly horizonChange = output<F360Horizon>();
  readonly openPalette = output<void>();
  readonly quickAction = output<F360QuickActionId>();
  readonly overflowAction = output<F360OverflowActionId>();

  protected readonly scopeOptions = SCOPE_OPTIONS;
  protected readonly horizonOptions = HORIZON_OPTIONS;
  protected readonly navOptions = NAV_OPTIONS;
  protected readonly quickActionOptions = QUICK_ACTION_OPTIONS;
  protected readonly overflowActionOptions = OVERFLOW_ACTION_OPTIONS;
  protected readonly activePopover = signal<HeaderPopover>(null);

  protected readonly activeHorizonLabel = computed<string>(() => {
    const current = this.horizon();
    return HORIZON_OPTIONS.find((item) => item.id === current)?.shortLabel ?? '30D';
  });

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.activePopover.set(null);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('.f360-popover-anchor')) {
      this.activePopover.set(null);
    }
  }

  protected selectScope(scope: FinanceScope): void {
    this.activePopover.set(null);
    this.scopeChange.emit(scope);
  }

  protected selectTab(tab: F360NavTabId): void {
    this.activePopover.set(null);
    this.tabChange.emit(tab);
  }

  protected togglePopover(target: Exclude<HeaderPopover, null>): void {
    this.activePopover.update((current) => (current === target ? null : target));
  }

  protected selectHorizon(horizon: F360Horizon): void {
    this.activePopover.set(null);
    this.horizonChange.emit(horizon);
  }

  protected triggerQuickAction(action: F360QuickActionId): void {
    this.activePopover.set(null);
    this.quickAction.emit(action);
  }

  protected triggerOverflowAction(action: F360OverflowActionId): void {
    this.activePopover.set(null);
    this.overflowAction.emit(action);
  }

  protected navBadgeFor(tabId: F360NavTabId): number {
    if (tabId === 'overview') return this.overdueCount();
    if (tabId === 'vaults') return this.vaultsCount();
    if (tabId === 'cashea') return this.casheaActiveCount();
    if (tabId === 'pyme_quotes') return this.pymeAlertsCount();
    return 0;
  }

  protected isDangerBadge(tabId: F360NavTabId): boolean {
    return tabId === 'overview' && this.overdueCount() > 0;
  }

  protected overflowLabelFor(option: OverflowActionOption): string {
    if (option.id === 'toggle_privacy') {
      return this.privacyMode() ? 'Privacidad activa (mostrar)' : 'Privacidad (ocultar saldos)';
    }
    if (option.id === 'sync_drive' && this.driveSyncing()) {
      return 'Sincronizando Drive...';
    }
    return option.label;
  }
}
