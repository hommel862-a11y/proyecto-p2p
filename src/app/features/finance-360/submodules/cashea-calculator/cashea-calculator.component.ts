import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Finance360Service } from '../../../../core/finance-360.service';
import { ToastService } from '../../../../core/toast.service';
import type { CasheaPlan, CasheaLevel } from '../../../../core/models/finance-360.models';

@Component({
  selector: 'app-cashea-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cashea-calculator.component.html',
  styleUrls: ['./cashea-calculator.component.scss'],
})
export class CasheaCalculatorComponent {
  readonly financeService = inject(Finance360Service);
  private readonly toast = inject(ToastService);

  // Form State
  readonly itemTitle = signal<string>('');
  readonly storeName = signal<string>('');
  readonly totalAmountUsd = signal<number | null>(150);
  readonly selectedLevel = signal<CasheaLevel>(3);
  readonly totalInstallments = signal<number>(3);
  readonly firstDueDate = signal<string>(
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  );

  /** Real-time calculation based on selected level */
  readonly calculation = computed(() => {
    const total = this.totalAmountUsd() ?? 0;
    const level = this.selectedLevel();
    const count = this.totalInstallments();
    const bcv = this.financeService.currentBcvRate();

    const result = this.financeService.calculateCasheaBreakdown(total, level, count);
    const initialVes = result.initialPaymentUsd * bcv;
    const installmentVes = result.installmentAmountUsd * bcv;
    const totalVes = total * bcv;

    return {
      ...result,
      initialVes,
      installmentVes,
      totalVes,
      bcvRate: bcv,
    };
  });

  /** Projected Due Dates */
  readonly projectedDates = computed<{ number: number; dateStr: string; amountUsd: number; amountVes: number }[]>(() => {
    const calc = this.calculation();
    const startDate = new Date(this.firstDueDate() || Date.now());
    const dates: { number: number; dateStr: string; amountUsd: number; amountVes: number }[] = [];

    for (let i = 0; i < this.totalInstallments(); i++) {
      const dueDate = new Date(startDate);
      dueDate.setDate(dueDate.getDate() + i * 14);
      dates.push({
        number: i + 1,
        dateStr: dueDate.toISOString().split('T')[0],
        amountUsd: calc.installmentAmountUsd,
        amountVes: calc.installmentVes,
      });
    }

    return dates;
  });

  /** Active Plans in Storage */
  readonly activePlans = computed<CasheaPlan[]>(() => {
    return this.financeService.state().casheaPlans;
  });

  setLevel(level: CasheaLevel): void {
    this.selectedLevel.set(level);
  }

  savePlan(): void {
    const title = this.itemTitle().trim() || 'Compra Cashea';
    const store = this.storeName().trim() || 'Comercio Cashea';
    const total = this.totalAmountUsd();

    if (!total || total <= 0) {
      this.toast.warn('Ingresa un monto válido para la compra.');
      return;
    }

    const calc = this.calculation();
    const plan = this.financeService.registerCasheaPlan({
      productName: title,
      storeName: store,
      totalPriceUsd: total,
      initialPaymentUsd: calc.initialPaymentUsd,
      initialPercentage: calc.initialPercentage,
      numberOfInstallments: this.totalInstallments(),
      installmentAmountUsd: calc.installmentAmountUsd,
      installmentFrequencyDays: 14,
      startDate: this.firstDueDate(),
      installments: calc.installments,
      status: 'active',
    });

    this.toast.success(
      `Plan "${plan.productName}" registrado. Se crearon ${plan.numberOfInstallments} cuotas automáticas en Pasivos.`,
    );

    // Reset Form
    this.itemTitle.set('');
    this.storeName.set('');
    this.totalAmountUsd.set(100);
  }

  payNextInstallment(plan: CasheaPlan): void {
    const pendingInst = plan.installments.find((i) => i.status === 'pending');
    if (!pendingInst) {
      this.toast.info('Este plan ya está 100% cancelado.');
      return;
    }

    this.financeService.markCasheaInstallmentPaid(plan.id, pendingInst.number);
    this.toast.success(
      `Cuota #${pendingInst.number} de "${plan.productName}" marcada como pagada.`,
    );
  }

  getPaidCount(plan: CasheaPlan): number {
    return plan.installments.filter((i) => i.status === 'paid').length;
  }
}
