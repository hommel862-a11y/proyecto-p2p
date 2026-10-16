import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Finance360Service } from '../../../../core/finance-360.service';
import { ToastService } from '../../../../core/toast.service';
import type {
  PymeProvider,
  PymeInventoryItem,
  PymeDrawerAllocation,
} from '../../../../core/models/finance-360.models';

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

  readonly activePymeTab = signal<'drawers' | 'providers' | 'inventory'>('drawers');

  // 3-Drawer simulation
  readonly saleConcept = signal<string>('Servicio Latonería y Pintura');
  readonly saleAmount = signal<number | null>(250);
  readonly drawer1Percent = signal<number>(50); // Insumos / Reposición
  readonly drawer2Percent = signal<number>(30); // Operativa & Nómina
  readonly drawer3Percent = signal<number>(20); // Utilidad Neta / CAPEX

  readonly drawerSplit = computed(() => {
    const sale = this.saleAmount() ?? 0;
    const bcv = this.financeService.currentBcvRate();
    const d1 = (sale * this.drawer1Percent()) / 100;
    const d2 = (sale * this.drawer2Percent()) / 100;
    const d3 = (sale * this.drawer3Percent()) / 100;

    return {
      totalUsd: sale,
      totalVes: sale * bcv,
      drawer1: { usd: d1, ves: d1 * bcv },
      drawer2: { usd: d2, ves: d2 * bcv },
      drawer3: { usd: d3, ves: d3 * bcv },
    };
  });

  settleSaleInLedger(): void {
    const amount = this.saleAmount() ?? 0;
    if (amount <= 0) {
      this.toast.warn('Ingresa un monto de venta mayor a cero.');
      return;
    }
    const split = this.drawerSplit();
    this.financeService.settlePymeSaleWithDrawers({
      title: this.saleConcept().trim() || 'Venta Comercial Pyme',
      totalUsd: amount,
      vaultId: 'vault-pyme-caja',
      drawer1Usd: split.drawer1.usd,
      drawer2Usd: split.drawer2.usd,
      drawer3Usd: split.drawer3.usd,
    });
    this.toast.success(
      `🏢 Venta de $${amount} USD asentada en Caja Operativa Pyme con partición de 3 Gavetas.`,
    );
  }

  // New Provider Form
  readonly showAddProviderModal = signal<boolean>(false);
  readonly provName = signal<string>('');
  readonly provCategory = signal<string>('Repuestos y Pinturas');
  readonly provPhone = signal<string>('');
  readonly provBankDetails = signal<string>('');
  readonly provDebt = signal<number | null>(0);
  readonly selectedProviderVaultId = signal<string>('vault-pyme-caja');

  // New Inventory Item Form
  readonly showAddItemModal = signal<boolean>(false);
  readonly itemName = signal<string>('');
  readonly itemCategory = signal<string>('Pintura Automotriz');
  readonly itemStock = signal<number | null>(10);
  readonly itemMinStock = signal<number | null>(5);
  readonly itemCost = signal<number | null>(15);
  readonly itemPrice = signal<number | null>(25);

  readonly providers = computed<PymeProvider[]>(() => {
    return this.financeService.state().providers;
  });

  readonly inventory = computed<PymeInventoryItem[]>(() => {
    return this.financeService.state().inventory;
  });

  readonly totalProviderDebtUsd = computed<number>(() => {
    return this.providers().reduce((acc, p) => acc + p.outstandingDebtUsd, 0);
  });

  readonly inventoryCriticalCount = computed<number>(() => {
    return this.inventory().filter((i) => i.currentStock <= i.minimumStock).length;
  });

  // Providers logic
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

  // Inventory logic
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

  /** Restocks an item by +5 units and records either a Vault Expense or Supplier Credit Liability */
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

  /** Executes a quick expense from one of the 3 Pyme Drawers */
  executeDrawerExpense(drawerNumber: 1 | 2 | 3, amountUsd: number): void {
    if (amountUsd <= 0) return;
    const bcv = this.financeService.currentBcvRate();
    const par = this.financeService.currentParallelRate();
    const today = new Date().toISOString().split('T')[0];

    const config =
      drawerNumber === 1
        ? {
            title: 'Compra Insumos / Reposición (Gaveta 1)',
            category: 'provider_merchandise' as const,
            drawer: 'drawer_merchandise' as const,
          }
        : drawerNumber === 2
          ? {
              title: 'Pago Nómina & Operativa Taller (Gaveta 2)',
              category: 'payroll' as const,
              drawer: 'drawer_operations' as const,
            }
          : {
              title: 'Inversión CAPEX / Retiro Utilidad (Gaveta 3)',
              category: 'equipment_capex' as const,
              drawer: 'drawer_capex' as const,
            };

    this.financeService.addExpense({
      title: config.title,
      scope: 'business',
      category: config.category,
      channel: 'zelle',
      vaultId: 'vault-pyme-caja',
      drawerAllocation: config.drawer,
      triMonetary: {
        amount_original: amountUsd,
        currency: 'USD',
        bcv_rate: bcv,
        parallel_rate: par,
        amount_usd: amountUsd,
        amount_ves: Number((amountUsd * bcv).toFixed(2)),
      },
      date: today,
      notes: `Desembolso auditado desde Gaveta #${drawerNumber} Pyme`,
    });

    this.toast.success(
      `💸 Desembolso de $${amountUsd} USD ejecutado desde Gaveta #${drawerNumber} y asentado en Libro Mayor.`,
    );
  }
}
