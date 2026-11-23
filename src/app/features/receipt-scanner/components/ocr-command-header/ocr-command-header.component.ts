import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  ExpenseCategory,
  FinanceScope,
  IncomeCategory,
  OcrDestinationMode,
  OcrFinancePillar,
  OcrOverflowActionId,
  OcrRoutingState,
  OcrVaultOption,
} from '../../ocr-ui.models';

interface DestinationTabOption {
  readonly id: OcrDestinationMode;
  readonly label: string;
  readonly hint: string;
}

interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

const DESTINATION_OPTIONS: readonly DestinationTabOption[] = [
  { id: 'p2p', label: 'Mesa P2P', hint: 'Arbitraje y libro de operaciones P2P' },
  { id: 'finance360', label: 'Finanzas 360', hint: 'Portafolio aislado personal y Pyme' },
];

const SCOPE_OPTIONS: readonly SelectOption<FinanceScope>[] = [
  { value: 'personal', label: 'Personal (Hogar / Sueldo)' },
  { value: 'business', label: 'Pyme / Negocio' },
];

const PILLAR_OPTIONS: readonly SelectOption<OcrFinancePillar>[] = [
  { value: 'expense', label: 'Gasto / Salida' },
  { value: 'income', label: 'Ingreso / Entrada' },
  { value: 'liability', label: 'Factura por Pagar / Pasivo' },
];

const EXPENSE_CATEGORY_OPTIONS: readonly SelectOption<ExpenseCategory>[] = [
  { value: 'cashea_installment', label: 'Cuota Cashea' },
  { value: 'groceries', label: 'Comida y Mercado' },
  { value: 'transport', label: 'Gasolina / Transporte' },
  { value: 'services', label: 'Servicios Públicos' },
  { value: 'housing', label: 'Vivienda y Alquiler' },
  { value: 'provider_merchandise', label: 'Proveedor / Mercancía' },
  { value: 'payroll', label: 'Nómina de Personal' },
  { value: 'maintenance', label: 'Mantenimiento / Taller' },
  { value: 'other', label: 'Otro Gasto' },
];

const INCOME_CATEGORY_OPTIONS: readonly SelectOption<IncomeCategory>[] = [
  { value: 'business_sale', label: 'Venta Comercial Pyme' },
  { value: 'quote_advance', label: 'Anticipo de Presupuesto' },
  { value: 'salary', label: 'Sueldo / Salario' },
  { value: 'freelance', label: 'Honorarios / Freelance' },
  { value: 'investment', label: 'Rendimiento / Inversión' },
  { value: 'other', label: 'Otro Ingreso' },
];

const DEFAULT_ROUTING: OcrRoutingState = {
  scope: 'personal',
  pillar: 'expense',
  expenseCategory: 'groceries',
  incomeCategory: 'business_sale',
  vaultId: '',
};

@Component({
  selector: 'app-ocr-command-header',
  standalone: true,
  imports: [],
  templateUrl: './ocr-command-header.component.html',
  styleUrl: './ocr-command-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.mode-p2p]': "destinationMode() === 'p2p'",
    '[class.mode-finance360]': "destinationMode() === 'finance360'",
  },
})
export class OcrCommandHeaderComponent {
  readonly destinationMode = input<OcrDestinationMode>('p2p');
  readonly routing = input<OcrRoutingState>(DEFAULT_ROUTING);
  readonly vaults = input<readonly OcrVaultOption[]>([]);
  readonly hasScreenPipe = input<boolean>(false);
  readonly receiptsCount = input<number>(0);
  readonly isProcessing = input<boolean>(false);
  readonly blacklistedCount = input<number>(0);

  readonly destinationModeChange = output<OcrDestinationMode>();
  readonly routingChange = output<OcrRoutingState>();
  readonly openPalette = output<void>();
  readonly triggerCapture = output<void>();
  readonly overflowAction = output<OcrOverflowActionId>();

  protected readonly destinationOptions = DESTINATION_OPTIONS;
  protected readonly scopeOptions = SCOPE_OPTIONS;
  protected readonly pillarOptions = PILLAR_OPTIONS;
  protected readonly expenseCategoryOptions = EXPENSE_CATEGORY_OPTIONS;
  protected readonly incomeCategoryOptions = INCOME_CATEGORY_OPTIONS;
  protected readonly overflowOpen = signal<boolean>(false);

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.overflowOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('.ocr-popover-anchor')) {
      this.overflowOpen.set(false);
    }
  }

  protected selectMode(mode: OcrDestinationMode): void {
    this.overflowOpen.set(false);
    this.destinationModeChange.emit(mode);
  }

  protected toggleOverflow(): void {
    this.overflowOpen.update((open) => !open);
  }

  protected emitOverflowAction(action: OcrOverflowActionId): void {
    this.overflowOpen.set(false);
    this.overflowAction.emit(action);
  }

  protected onScopeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as FinanceScope;
    this.routingChange.emit({ ...this.routing(), scope: value });
  }

  protected onPillarChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as OcrFinancePillar;
    this.routingChange.emit({ ...this.routing(), pillar: value });
  }

  protected onExpenseCategoryChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ExpenseCategory;
    this.routingChange.emit({ ...this.routing(), expenseCategory: value });
  }

  protected onIncomeCategoryChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as IncomeCategory;
    this.routingChange.emit({ ...this.routing(), incomeCategory: value });
  }

  protected onVaultChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.routingChange.emit({ ...this.routing(), vaultId: value });
  }
}
