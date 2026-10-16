import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Finance360Service } from '../../../../core/finance-360.service';
import { ToastService } from '../../../../core/toast.service';
import type {
  PymeProvider,
  PymeInventoryItem,
  ExpenseEntry,
} from '../../../../core/models/finance-360.models';

export interface DrawerPreset {
  id: string;
  label: string;
  description: string;
  d1: number;
  d2: number;
  d3: number;
}

@Component({
  selector: 'app-pyme-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pyme-manager.component.html',
  styleUrls: ['./pyme-manager.component.scss'],
})
export class PymeManagerComponent {
  readonly financeService = inject(Finance360Service);
  private readonly toast = inject(ToastService);
  readonly Math = Math;

  readonly activePymeTab = signal<'drawers' | 'providers' | 'inventory'>('drawers');

  // Inflow (Sale vs Injection) configuration
  readonly inflowType = signal<'sale' | 'capital_injection'>('sale');
  readonly saleConcept = signal<string>('Servicio Latonería y Pintura');
  readonly saleAmount = signal<number | null>(250);
  readonly targetVaultId = signal<string>('vault-pyme-caja');

  // Drawer Presets
  readonly drawerPresets: DrawerPreset[] = [
    {
      id: 'workshop',
      label: '🛠️ Taller / Comercio',
      description: '50% Insumos · 30% Nómina · 20% Utilidad',
      d1: 50,
      d2: 30,
      d3: 20,
    },
    {
      id: 'services',
      label: '💼 Servicios / Nómina',
      description: '20% Insumos · 60% Nómina · 20% Utilidad',
      d1: 20,
      d2: 60,
      d3: 20,
    },
    {
      id: 'production',
      label: '🏗️ Obras / Materiales',
      description: '60% Insumos · 25% Nómina · 15% Utilidad',
      d1: 60,
      d2: 25,
      d3: 15,
    },
    {
      id: 'custom',
      label: '⚙️ Personalizado',
      description: 'Distribución porcentual a medida',
      d1: 34,
      d2: 33,
      d3: 33,
    },
  ];

  readonly activePreset = signal<string>('workshop');
  readonly drawer1Percent = signal<number>(50); // Insumos / Reposición
  readonly drawer2Percent = signal<number>(30); // Operativa & Nómina
  readonly drawer3Percent = signal<number>(20); // Utilidad Neta / CAPEX

  readonly percentSum = computed(() => {
    return (
      Number(this.drawer1Percent() || 0) +
      Number(this.drawer2Percent() || 0) +
      Number(this.drawer3Percent() || 0)
    );
  });

  readonly drawerSplit = computed(() => {
    const sale = this.saleAmount() ?? 0;
    const bcv = this.financeService.currentBcvRate();
    const d1 = (sale * (this.drawer1Percent() || 0)) / 100;
    const d2 = (sale * (this.drawer2Percent() || 0)) / 100;
    const d3 = (sale * (this.drawer3Percent() || 0)) / 100;

    return {
      totalUsd: sale,
      totalVes: sale * bcv,
      drawer1: { usd: d1, ves: d1 * bcv },
      drawer2: { usd: d2, ves: d2 * bcv },
      drawer3: { usd: d3, ves: d3 * bcv },
    };
  });

  applyPreset(preset: DrawerPreset): void {
    this.activePreset.set(preset.id);
    this.drawer1Percent.set(preset.d1);
    this.drawer2Percent.set(preset.d2);
    this.drawer3Percent.set(preset.d3);
  }

  setCustomPercent(drawer: 1 | 2 | 3, value: number): void {
    this.activePreset.set('custom');
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    if (drawer === 1) this.drawer1Percent.set(clamped);
    if (drawer === 2) this.drawer2Percent.set(clamped);
    if (drawer === 3) this.drawer3Percent.set(clamped);
  }

  settleSaleInLedger(): void {
    const amount = this.saleAmount() ?? 0;
    if (amount <= 0) {
      this.toast.warn('Ingresa un monto mayor a cero.');
      return;
    }
    if (this.percentSum() !== 100) {
      this.toast.warn(
        `La suma de las 3 gavetas debe ser exactamente 100% (actual: ${this.percentSum()}%). Ajustá los porcentajes.`,
      );
      return;
    }

    const split = this.drawerSplit();
    const isInjection = this.inflowType() === 'capital_injection';
    const targetVault = this.targetVaultId() || 'vault-pyme-caja';
    const vaultName =
      this.financeService.state().assets.find((v) => v.id === targetVault)?.name ||
      'Caja Operativa Pyme';

    const defaultTitle = isInjection
      ? 'Aporte / Fondeo Directo a Gavetas'
      : 'Venta Comercial Pyme';
    const title = this.saleConcept().trim() || defaultTitle;

    this.financeService.settlePymeSaleWithDrawers({
      title,
      totalUsd: amount,
      vaultId: targetVault,
      drawer1Usd: split.drawer1.usd,
      drawer2Usd: split.drawer2.usd,
      drawer3Usd: split.drawer3.usd,
      isInitialInjection: isInjection,
    });

    this.toast.success(
      isInjection
        ? `💰 Inyección de $${amount} USD acreditada en "${vaultName}" y asignada a las 3 Gavetas.`
        : `🏢 Venta de $${amount} USD acreditada en "${vaultName}" y particionada en las 3 Gavetas.`,
    );
  }

  // -------------------------------------------------------------
  // MODAL: PAGO DE NÓMINA (GAVETA 2)
  // -------------------------------------------------------------
  readonly showPayrollModal = signal<boolean>(false);
  readonly payrollEmployeeName = signal<string>('');
  readonly payrollPeriod = signal<string>('Quincena');
  readonly payrollAmountUsd = signal<number | null>(null);
  readonly payrollVaultId = signal<string>('vault-pyme-caja');
  readonly payrollRef = signal<string>('');
  readonly payrollNotes = signal<string>('');

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
    const amount = this.payrollAmountUsd() ?? 0;
    if (!employee) {
      this.toast.warn('Ingresa el nombre o cargo del colaborador.');
      return;
    }
    if (amount <= 0) {
      this.toast.warn('Ingresa un monto de nómina mayor a cero.');
      return;
    }

    const vaultId = this.payrollVaultId() || 'vault-pyme-caja';
    const live = this.financeService.pymeDrawersTelemetry();

    if (amount > live.drawer2AvailableUsd) {
      this.toast.warn(
        `⚠️ Alerta: El monto ($${amount} USD) excede el Fondo Disponible en Gaveta 2 ($${live.drawer2AvailableUsd} USD). Se registrará sobregiro operativo auditado.`,
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

    const vaultName =
      this.financeService.state().assets.find((v) => v.id === vaultId)?.name || 'Caja';

    this.toast.success(
      `👥 Nómina de $${amount} USD a "${employee}" liquidada desde "${vaultName}" y debitada de Gaveta 2.`,
    );

    this.payrollEmployeeName.set('');
    this.payrollAmountUsd.set(null);
    this.payrollRef.set('');
    this.payrollNotes.set('');
    this.showPayrollModal.set(false);
  }

  // -------------------------------------------------------------
  // MODAL: DESEMBOLSO GENERAL DE GAVETA (1, 2 ó 3)
  // -------------------------------------------------------------
  readonly showDisbursementModal = signal<boolean>(false);
  readonly disburseDrawer = signal<1 | 2 | 3>(1);
  readonly disburseTitle = signal<string>('');
  readonly disburseAmountUsd = signal<number | null>(null);
  readonly disburseVaultId = signal<string>('vault-pyme-caja');
  readonly disburseRef = signal<string>('');
  readonly disburseNotes = signal<string>('');

  openDisbursementModal(drawer: 1 | 2 | 3, defaultAmount?: number): void {
    this.disburseDrawer.set(drawer);
    this.disburseAmountUsd.set(defaultAmount ?? null);
    if (drawer === 1) {
      this.disburseTitle.set('Compra Insumos / Reposición Stock');
    } else if (drawer === 2) {
      this.disburseTitle.set('Pago Servicio Local / Gastos Fijos');
    } else {
      this.disburseTitle.set('Inversión CAPEX / Retiro Socios');
    }
    this.showDisbursementModal.set(true);
  }

  closeDisbursementModal(): void {
    this.showDisbursementModal.set(false);
  }

  confirmDisbursement(): void {
    const title = this.disburseTitle().trim();
    const amount = this.disburseAmountUsd() ?? 0;
    const drawer = this.disburseDrawer();
    if (!title) {
      this.toast.warn('Ingresa el concepto del desembolso.');
      return;
    }
    if (amount <= 0) {
      this.toast.warn('Ingresa un monto mayor a cero.');
      return;
    }

    const vaultId = this.disburseVaultId() || 'vault-pyme-caja';
    this.financeService.executeDrawerDisbursement({
      drawer,
      title,
      amountUsd: amount,
      vaultId,
      notes: this.disburseNotes().trim() || undefined,
      referenceNumber: this.disburseRef().trim() || undefined,
    });

    const vaultName =
      this.financeService.state().assets.find((v) => v.id === vaultId)?.name || 'Caja';

    this.toast.success(
      `💸 Desembolso de $${amount} USD ("${title}") debitado de "${vaultName}" y Gaveta #${drawer}.`,
    );

    this.disburseTitle.set('');
    this.disburseAmountUsd.set(null);
    this.disburseRef.set('');
    this.disburseNotes.set('');
    this.showDisbursementModal.set(false);
  }

  // Quick fallback drawer expense
  executeDrawerExpense(drawerNumber: 1 | 2 | 3, amountUsd: number): void {
    this.openDisbursementModal(drawerNumber, amountUsd);
  }

  // -------------------------------------------------------------
  // MOVIMIENTOS RECIENTES DE LAS GAVETAS (AUDITORÍA)
  // -------------------------------------------------------------
  readonly recentDrawerMovements = computed<ExpenseEntry[]>(() => {
    return this.financeService
      .state()
      .expenses.filter(
        (e) =>
          !!e.drawerAllocation ||
          (e.scope === 'business' &&
            [
              'payroll',
              'provider_merchandise',
              'equipment_capex',
              'services',
              'rent',
              'utilities',
              'maintenance',
            ].includes(e.category)),
      )
      .slice(0, 8);
  });

  getVaultName(vaultId?: string): string {
    if (!vaultId) return 'Caja Pyme';
    const vault = this.financeService.state().assets.find((v) => v.id === vaultId);
    return vault ? vault.name : 'Caja Pyme';
  }

  // -------------------------------------------------------------
  // DIRECTORY: PROVIDERS
  // -------------------------------------------------------------
  readonly showAddProviderModal = signal<boolean>(false);
  readonly provName = signal<string>('');
  readonly provCategory = signal<string>('Repuestos y Pinturas');
  readonly provPhone = signal<string>('');
  readonly provBankDetails = signal<string>('');
  readonly provDebt = signal<number | null>(0);
  readonly selectedProviderVaultId = signal<string>('vault-pyme-caja');

  readonly providers = computed<PymeProvider[]>(() => {
    return this.financeService.state().providers;
  });

  readonly totalProviderDebtUsd = computed<number>(() => {
    return this.providers().reduce((acc, p) => acc + p.outstandingDebtUsd, 0);
  });

  saveProvider(): void {
    const name = this.provName().trim();
    if (!name) {
      this.toast.warn('Ingresa el nombre del proveedor.');
      return;
    }

    this.financeService.addProvider({
      name,
      category: this.provCategory(),
      phone: this.provPhone().trim() || 'No especificado',
      bankDetails: this.provBankDetails().trim() || 'Pago Móvil / Transferencia',
      outstandingDebtUsd: this.provDebt() ?? 0,
    });

    this.toast.success(`Proveedor "${name}" registrado correctamente.`);
    this.provName.set('');
    this.provPhone.set('');
    this.provBankDetails.set('');
    this.provDebt.set(0);
    this.showAddProviderModal.set(false);
  }

  payProviderDebt(provider: PymeProvider, amountUsd: number): void {
    if (amountUsd <= 0 || amountUsd > provider.outstandingDebtUsd) {
      this.toast.warn('Monto de abono inválido.');
      return;
    }

    const vaultId = this.selectedProviderVaultId() || undefined;
    const updatedDebt = Math.max(0, Number((provider.outstandingDebtUsd - amountUsd).toFixed(2)));
    this.financeService.payProviderWithVault(provider.id, amountUsd, vaultId);
    const vaultName =
      this.financeService.state().assets.find((v) => v.id === vaultId)?.name ||
      'Caja Operativa Pyme';

    this.toast.success(
      `🚚 Pago de $${amountUsd} USD a ${provider.name} debitado de "${vaultName}" y asentado en Libro Mayor. Restante: $${updatedDebt} USD.`,
    );
  }

  deleteProvider(prov: PymeProvider): void {
    this.financeService.deleteProvider(prov.id);
    this.toast.info(`Proveedor "${prov.name}" eliminado.`);
  }

  // -------------------------------------------------------------
  // INVENTORY: SEMÁFORO
  // -------------------------------------------------------------
  readonly showAddItemModal = signal<boolean>(false);
  readonly itemName = signal<string>('');
  readonly itemCategory = signal<string>('Pintura Automotriz');
  readonly itemStock = signal<number | null>(10);
  readonly itemMinStock = signal<number | null>(5);
  readonly itemCost = signal<number | null>(15);
  readonly itemPrice = signal<number | null>(25);

  readonly inventory = computed<PymeInventoryItem[]>(() => {
    return this.financeService.state().inventory;
  });

  readonly inventoryCriticalCount = computed<number>(() => {
    return this.inventory().filter((i) => i.currentStock <= i.minimumStock).length;
  });

  saveInventoryItem(): void {
    const name = this.itemName().trim();
    if (!name) {
      this.toast.warn('Ingresa la descripción del artículo.');
      return;
    }

    const cost = this.itemCost() ?? 0;
    const price = this.itemPrice() ?? 0;
    const minStock = this.itemMinStock() ?? 5;

    this.financeService.addInventoryItem({
      name,
      category: this.itemCategory(),
      currentStock: this.itemStock() ?? 0,
      minimumStock: minStock,
      optimalStock: minStock * 2,
      unitCostUsd: cost,
      sellingPriceUsd: price,
    });

    this.toast.success(`Artículo "${name}" añadido al catálogo.`);
    this.itemName.set('');
    this.showAddItemModal.set(false);
  }

  adjustStock(item: PymeInventoryItem, delta: number): void {
    const newStock = Math.max(0, item.currentStock + delta);
    this.financeService.updateInventoryItem(item.id, {
      currentStock: newStock,
    });
  }

  restockItem(item: PymeInventoryItem, mode: 'vault' | 'provider_credit'): void {
    const qtyToAdd = Math.max(5, item.optimalStock - item.currentStock);
    const res = this.financeService.restockInventoryWithAccounting({
      itemId: item.id,
      quantityToAdd: qtyToAdd,
      paymentMode: mode,
      vaultId: this.selectedProviderVaultId() || 'vault-pyme-caja',
    });

    if (res.success) {
      if (mode === 'vault') {
        this.toast.success(
          `📦 Stock de "${item.name}" repuesto (+${qtyToAdd} u. → ${res.newStock}). Egreso de $${res.totalCostUsd} USD asentado en Libro Mayor.`,
        );
      } else {
        this.toast.success(
          `🚚 Stock de "${item.name}" repuesto (+${qtyToAdd} u. → ${res.newStock}) a crédito ($${res.totalCostUsd} USD agendados en Pasivos a 14 días).`,
        );
      }
    }
  }

  deleteInventoryItem(item: PymeInventoryItem): void {
    this.financeService.deleteInventoryItem(item.id);
    this.toast.info(`Artículo "${item.name}" eliminado del catálogo.`);
  }
}
