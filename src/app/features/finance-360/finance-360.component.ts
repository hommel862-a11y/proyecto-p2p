import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Finance360Service } from '../../core/finance-360.service';
import { AccountsService } from '../../core/accounts.service';
import { CotizaveService } from '../../core/cotizave.service';
import { FinanceAiIngestorService } from '../../core/services/finance-ai-ingestor.service';
import { ToastService } from '../../core/toast.service';
import { computeLogSummary } from '@p2p/core';
import {
  type CurrencyCode,
  type ExpenseCategory,
  type FinanceScope,
  type IncomeCategory,
  type PaymentChannel,
  computeTriMonetaryAmount,
} from '../../core/models/finance-360.models';

@Component({
  selector: 'app-finance-360',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './finance-360.component.html',
  styleUrls: ['./finance-360.component.scss'],
})
export class Finance360Component {
  readonly financeService = inject(Finance360Service);
  private readonly accountsService = inject(AccountsService);
  private readonly cotizaveService = inject(CotizaveService);
  private readonly aiIngestor = inject(FinanceAiIngestorService);
  private readonly toast = inject(ToastService);

  /** Active Navigation Tab: 'overview' | 'cashea' | 'pyme' | 'quotes' | 'analytics' */
  readonly activeTab = signal<'overview' | 'cashea' | 'pyme' | 'quotes' | 'analytics'>('overview');

  /** Quick Transaction Modal State */
  readonly quickModalOpen = signal<boolean>(false);
  readonly quickModalType = signal<'expense' | 'income' | 'audio'>('expense');

  // Quick form fields
  readonly formTitle = signal<string>('');
  readonly formAmount = signal<number | null>(null);
  readonly formCurrency = signal<CurrencyCode>('USD');
  readonly formScope = signal<FinanceScope>('personal');
  readonly formExpenseCategory = signal<ExpenseCategory>('groceries');
  readonly formIncomeCategory = signal<IncomeCategory>('salary');
  readonly formVaultId = signal<string>('');
  readonly formNotes = signal<string>('');
  readonly isRecordingAudio = signal<boolean>(false);

  /** Realized P2P profit available today */
  readonly todayP2pSummary = computed(() => {
    const todayOps = this.accountsService.todayOperations();
    return computeLogSummary(todayOps);
  });

  /** Checks if today's P2P profit has already been imported */
  readonly isP2pProfitImportedToday = computed<boolean>(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return this.financeService
      .state()
      .incomes.some((i) => i.id === `p2p-profit-${todayStr}`);
  });

  setScope(scope: FinanceScope): void {
    this.financeService.scope.set(scope);
    this.formScope.set(scope === 'all' ? 'personal' : scope);
  }

  // -------------------------------------------------------------
  // P2P ISOLATED PROFIT IMPORT
  // -------------------------------------------------------------

  triggerP2pImport(): void {
    const currentScope = this.financeService.scope();
    const targetScope = currentScope === 'all' ? 'personal' : currentScope;
    const result = this.financeService.importDailyP2pProfit(targetScope);

    if (result.success) {
      this.toast.success(
        `💰 Profit P2P del día ($${result.profitUsd} USD / Bs ${result.profitVes.toLocaleString()}) importado exitosamente.`,
      );
    } else {
      this.toast.warn(
        'No se detectó ganancia neta positiva en la Mesa P2P hoy para importar.',
      );
    }
  }

  // -------------------------------------------------------------
  // QUICK MODAL OPERATIONS
  // -------------------------------------------------------------

  openQuickModal(type: 'expense' | 'income' | 'audio'): void {
    this.quickModalType.set(type);
    this.formTitle.set('');
    this.formAmount.set(null);
    this.formCurrency.set('USD');
    this.formNotes.set('');
    this.quickModalOpen.set(true);

    if (type === 'audio') {
      this.startVoiceNoteSimulation();
    }
  }

  closeQuickModal(): void {
    this.quickModalOpen.set(false);
    this.isRecordingAudio.set(false);
  }

  saveQuickTransaction(): void {
    const amount = this.formAmount();
    if (!amount || amount <= 0) {
      this.toast.warn('Por favor ingresa un monto válido.');
      return;
    }

    const bcv = this.financeService.currentBcvRate();
    const parallel = this.financeService.currentParallelRate();
    const currency = this.formCurrency();
    const tri = computeTriMonetaryAmount(amount, currency, bcv, parallel);
    const scope = this.formScope();
    const vaultId = this.formVaultId() || undefined;
    const channel: PaymentChannel = currency === 'VES' ? 'bs_bank' : 'cash';
    const date = new Date().toISOString().split('T')[0];

    if (this.quickModalType() === 'expense') {
      const title = this.formTitle().trim() || 'Gasto Rápido';
      this.financeService.addExpense({
        title,
        scope,
        category: this.formExpenseCategory(),
        channel,
        vaultId,
        triMonetary: tri,
        date,
        notes: this.formNotes().trim() || undefined,
      });
      this.toast.success(`Gasto registrado: $${tri.amount_usd} USD`);
    } else {
      const title = this.formTitle().trim() || 'Ingreso Rápido';
      this.financeService.addIncome({
        title,
        scope,
        category: this.formIncomeCategory(),
        channel,
        vaultId,
        triMonetary: tri,
        date,
        notes: this.formNotes().trim() || undefined,
      });
      this.toast.success(`Ingreso registrado: $${tri.amount_usd} USD`);
    }

    this.closeQuickModal();
  }

  startVoiceNoteSimulation(): void {
    this.isRecordingAudio.set(true);
    // Simulates smart listening and auto-classification
    setTimeout(() => {
      if (this.isRecordingAudio()) {
        this.formTitle.set('Gasolina y Transporte');
        this.formAmount.set(15);
        this.formCurrency.set('USD');
        this.formExpenseCategory.set('transport');
        this.formNotes.set('Dictado de voz procesado con IA');
        this.isRecordingAudio.set(false);
        this.toast.success('🎙️ Nota de voz procesada por IA con éxito.');
      }
    }, 2000);
  }

  payQuickLiability(id: string, amountUsd: number): void {
    this.financeService.payLiability(id, amountUsd);
    this.toast.success(`Cuota/Pasivo de $${amountUsd} USD marcado como pagado.`);
  }
}
