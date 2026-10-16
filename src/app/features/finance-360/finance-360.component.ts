import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Finance360Service, type UnifiedMovementItem } from '../../core/finance-360.service';
import { AccountsService } from '../../core/accounts.service';
import { CotizaveService } from '../../core/cotizave.service';
import { FinanceAiIngestorService } from '../../core/services/finance-ai-ingestor.service';
import { FinanceDriveSyncService } from '../../core/services/finance-drive-sync.service';
import { ToastService } from '../../core/toast.service';
import { computeLogSummary } from '@p2p/core';
import {
  type AssetVault,
  type CurrencyCode,
  type ExpenseCategory,
  type FinanceScope,
  type IncomeCategory,
  type PaymentChannel,
  type LiabilityItem,
  type WealthGoal,
  computeTriMonetaryAmount,
} from '../../core/models/finance-360.models';
import { FinanceAnalyticsComponent } from './components/finance-analytics.component';
import { CasheaCalculatorComponent } from './submodules/cashea-calculator/cashea-calculator.component';
import { PymeManagerComponent } from './submodules/pyme-manager/pyme-manager.component';
import { QuoteBuilderComponent } from './submodules/quote-builder/quote-builder.component';

@Component({
  selector: 'app-finance-360',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FinanceAnalyticsComponent,
    CasheaCalculatorComponent,
    PymeManagerComponent,
    QuoteBuilderComponent,
  ],
  templateUrl: './finance-360.component.html',
  styleUrls: ['./finance-360.component.scss'],
})
export class Finance360Component {
  readonly financeService = inject(Finance360Service);
  readonly driveSync = inject(FinanceDriveSyncService);
  private readonly accountsService = inject(AccountsService);
  private readonly cotizaveService = inject(CotizaveService);
  private readonly aiIngestor = inject(FinanceAiIngestorService);
  private readonly toast = inject(ToastService);

  /** Active Navigation Tab: 'overview' | 'cashea' | 'pyme' | 'quotes' | 'analytics' */
  readonly activeTab = signal<'overview' | 'cashea' | 'pyme' | 'quotes' | 'analytics'>('overview');

  /** Ledger filter state */
  readonly movementFilter = signal<'all' | 'income' | 'expense'>('all');
  readonly movementSearch = signal<string>('');

  /** Quick Transaction Modal State */
  readonly quickModalOpen = signal<boolean>(false);
  readonly quickModalType = signal<'expense' | 'income' | 'audio'>('expense');
  readonly smartCommandText = signal<string>('');

  // Quick form fields
  readonly formTitle = signal<string>('');
  readonly formAmount = signal<number | null>(null);
  readonly formCurrency = signal<CurrencyCode>('USD');
  readonly formScope = signal<FinanceScope>('personal');
  readonly formExpenseCategory = signal<ExpenseCategory>('groceries');
  readonly formIncomeCategory = signal<IncomeCategory>('salary');
  readonly formVaultId = signal<string>('');
  readonly formReferenceNumber = signal<string>('');
  readonly formNotes = signal<string>('');
  readonly isRecordingAudio = signal<boolean>(false);
  readonly isScanningReceipt = signal<boolean>(false);
  readonly scannedReceiptName = signal<string>('');

  /** Vault Modals State (Transfer, Create, Adjust Balance) */
  readonly transferModalOpen = signal<boolean>(false);
  readonly transferFromId = signal<string>('');
  readonly transferToId = signal<string>('');
  readonly transferAmount = signal<number | null>(null);

  readonly newVaultModalOpen = signal<boolean>(false);
  readonly newVaultName = signal<string>('');
  readonly newVaultCurrency = signal<CurrencyCode>('USD');
  readonly newVaultBalance = signal<number | null>(0);
  readonly newVaultScope = signal<FinanceScope>('personal');
  readonly newVaultChannel = signal<PaymentChannel>('zelle');

  readonly editingVaultId = signal<string | null>(null);
  readonly editingVaultBalance = signal<number | null>(null);
  readonly reconcilingVaultId = signal<string | null>(null);
  readonly reconcileActualBalance = signal<number | null>(null);

  /** Movement Inline Editing State */
  readonly editingMovementId = signal<string | null>(null);
  readonly editingMovementTitle = signal<string>('');
  readonly editingMovementAmountUsd = signal<number | null>(null);

  /** Venezuelan Bank Fee Switch (0%, +0.3% Pago Móvil, +3% IGTF) */
  readonly feeRatePct = signal<0 | 0.3 | 3>(0);

  /** Wealth Goals State */
  readonly newGoalModalOpen = signal<boolean>(false);
  readonly newGoalTitle = signal<string>('');
  readonly newGoalTargetUsd = signal<number | null>(null);
  readonly newGoalCurrentUsd = signal<number | null>(0);
  readonly newGoalDeadline = signal<string>('');
  readonly newGoalCategory = signal<'emergency' | 'equipment' | 'savings' | 'real_estate' | 'other'>('emergency');
  readonly contributeGoalModalOpen = signal<boolean>(false);
  readonly targetGoalForContribution = signal<WealthGoal | null>(null);
  readonly contributeAmountUsd = signal<number | null>(50);
  readonly contributeVaultId = signal<string>('vault-zelle');

  /** Manual Liability Creation & Payment Vault State */
  readonly newLiabilityModalOpen = signal<boolean>(false);
  readonly liabTitle = signal<string>('');
  readonly liabCreditor = signal<string>('');
  readonly liabAmountUsd = signal<number | null>(null);
  readonly liabDueDate = signal<string>(
    new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  );
  readonly liabCategory = signal<'cashea' | 'provider' | 'loan' | 'fixed_service' | 'tax' | 'other'>(
    'fixed_service',
  );
  readonly liabScope = signal<FinanceScope>('personal');
  readonly selectedLiabilityVaultId = signal<string>('vault-zelle');

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

  /** Solvency & Asset vs Liability visual ratio (0 - 100%) */
  readonly solvencyRatioPercent = computed<number>(() => {
    const assets = this.financeService.totalAssetsUsd();
    const liabilities = this.financeService.totalLiabilitiesUsd();
    const total = assets + liabilities;
    if (total <= 0) return 100;
    return Math.round((assets / total) * 100);
  });

  /** Filtered unified movements for the ledger feed */
  readonly filteredMovements = computed<UnifiedMovementItem[]>(() => {
    const all = this.financeService.unifiedMovements();
    const typeFilter = this.movementFilter();
    const query = this.movementSearch().trim().toLowerCase();

    return all.filter((m) => {
      if (typeFilter !== 'all' && m.type !== typeFilter) return false;
      if (query) {
        const haystack = `${m.title} ${m.categoryLabel} ${m.vaultName} ${m.notes ?? ''}`.toLowerCase();
        return haystack.includes(query);
      }
      return true;
    });
  });

  /** Preview conversion for vault transfer modal */
  readonly transferPreview = computed(() => {
    const fromId = this.transferFromId();
    const toId = this.transferToId();
    const amount = this.transferAmount() ?? 0;
    if (!fromId || !toId || amount <= 0) return null;

    const vaults = this.financeService.state().assets;
    const fromVault = vaults.find((v) => v.id === fromId);
    const toVault = vaults.find((v) => v.id === toId);
    if (!fromVault || !toVault) return null;

    const bcv = this.financeService.currentBcvRate();
    const amountUsd = fromVault.currency === 'VES' ? amount / (bcv > 0 ? bcv : 1) : amount;
    const targetCredit = toVault.currency === 'VES' ? amountUsd * bcv : amountUsd;

    return {
      fromVault,
      toVault,
      targetCredit: Number(targetCredit.toFixed(2)),
      bcv,
    };
  });

  setScope(scope: FinanceScope): void {
    this.financeService.scope.set(scope);
    this.formScope.set(scope === 'all' ? 'personal' : scope);
  }

  /** Returns an icon badge for a vault based on its channel and currency */
  getVaultIcon(vault: AssetVault): string {
    if (vault.channel === 'zelle') return '💳';
    if (vault.channel === 'bs_bank' || vault.currency === 'VES') return '🏦';
    if (vault.channel === 'crypto' || vault.currency === 'USDT') return '🪙';
    if (vault.scope === 'business') return '🏢';
    return '💵';
  }

  /** Converts a vault balance to its opposite reference currency */
  getVaultEquivalentLabel(vault: AssetVault): string {
    const bcv = this.financeService.currentBcvRate();
    if (vault.currency === 'VES') {
      const usd = bcv > 0 ? vault.balance / bcv : 0;
      return `≈ $${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
    }
    const ves = vault.balance * bcv;
    return `≈ Bs ${ves.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /** Gets the USD share percentage of a vault relative to total assets */
  getVaultSharePercent(vault: AssetVault): number {
    const totalUsd = this.financeService.totalAssetsUsd();
    if (totalUsd <= 0) return 0;
    const bcv = this.financeService.currentBcvRate();
    const vaultUsd = vault.currency === 'VES' ? (bcv > 0 ? vault.balance / bcv : 0) : vault.balance;
    return Math.min(100, Math.round((vaultUsd / totalUsd) * 100));
  }

  // -------------------------------------------------------------
  // VAULT OPERATIONS (TRANSFER, ADJUST, CREATE)
  // -------------------------------------------------------------

  openTransferModal(defaultFromVaultId?: string): void {
    const vaults = this.financeService.assets();
    if (vaults.length < 2) {
      this.toast.warn('Necesitas al menos 2 bóvedas en este ámbito para transferir fondos.');
      return;
    }
    const fromId = defaultFromVaultId || vaults[0].id;
    const toVault = vaults.find((v) => v.id !== fromId) || vaults[0];
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
        `🔄 Transferencia ejecutada: acreditados ${res.targetCurrency} ${res.creditedAmount.toLocaleString()}.`,
      );
      this.transferModalOpen.set(false);
    } else {
      this.toast.warn('Verifica la bóveda de origen/destino y el monto a transferir.');
    }
  }

  startEditVaultBalance(vault: AssetVault): void {
    this.editingVaultId.set(vault.id);
    this.editingVaultBalance.set(vault.balance);
  }

  saveVaultBalance(vault: AssetVault): void {
    const newBal = this.editingVaultBalance();
    if (newBal === null || newBal < 0) {
      this.toast.warn('Ingresa un saldo válido mayor o igual a cero.');
      return;
    }
    const rounded = Number(newBal.toFixed(2));
    const bcv = this.financeService.currentBcvRate();
    const balanceUsdEquivalent =
      vault.currency === 'VES' ? (bcv > 0 ? Number((rounded / bcv).toFixed(2)) : 0) : rounded;
    const balanceVesEquivalent =
      vault.currency === 'VES' ? rounded : Number((rounded * bcv).toFixed(2));

    this.financeService.updateAssetVault(vault.id, {
      balance: rounded,
      balanceUsdEquivalent,
      balanceVesEquivalent,
    });
    this.editingVaultId.set(null);
    this.toast.success(`Saldo de "${vault.name}" actualizado a ${vault.currency} ${rounded.toLocaleString()}.`);
  }

  cancelEditVaultBalance(): void {
    this.editingVaultId.set(null);
    this.editingVaultBalance.set(null);
  }

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
    const balance = Math.max(0, this.newVaultBalance() ?? 0);
    const bcv = this.financeService.currentBcvRate();
    const channel: PaymentChannel =
      currency === 'VES' ? 'bs_bank' : currency === 'USDT' ? 'crypto' : this.newVaultChannel();

    this.financeService.addAssetVault({
      name,
      channel,
      scope: this.newVaultScope(),
      currency,
      balance,
      balanceUsdEquivalent: currency === 'VES' ? (bcv > 0 ? Number((balance / bcv).toFixed(2)) : 0) : balance,
      balanceVesEquivalent: currency === 'VES' ? balance : Number((balance * bcv).toFixed(2)),
    });
    this.newVaultModalOpen.set(false);
    this.toast.success(`Bóveda "${name}" (${currency}) creada exitosamente.`);
  }

  deleteVault(vault: AssetVault): void {
    this.financeService.deleteAssetVault(vault.id);
    this.toast.info(`Bóveda "${vault.name}" eliminada.`);
  }

  startReconcileVault(vault: AssetVault): void {
    this.reconcilingVaultId.set(vault.id);
    this.reconcileActualBalance.set(vault.balance);
  }

  saveReconcileVault(vault: AssetVault): void {
    const actualBal = this.reconcileActualBalance();
    if (actualBal === null || actualBal < 0) {
      this.toast.warn('Ingresa un saldo real auditado válido.');
      return;
    }
    const res = this.financeService.reconcileVaultBalance(vault.id, actualBal);
    this.reconcilingVaultId.set(null);
    this.reconcileActualBalance.set(null);
    if (res.deltaInCurrency === 0) {
      this.toast.info(`⚖️ Arqueo de "${vault.name}": Saldo auditado coincide exactamente. Sin descuadre.`);
    } else {
      const sign = res.deltaInCurrency > 0 ? '+' : '';
      this.toast.success(
        `⚖️ Arqueo de "${vault.name}" completado: Ajuste de ${sign}${res.deltaInCurrency.toLocaleString()} ${vault.currency} asentado en Libro Mayor.`,
      );
    }
  }

  cancelReconcileVault(): void {
    this.reconcilingVaultId.set(null);
    this.reconcileActualBalance.set(null);
  }

  // -------------------------------------------------------------
  // DEMO PORTFOLIO SEEDER, PURGE & TOTAL RESET
  // -------------------------------------------------------------

  loadDemoPortfolio(): void {
    this.financeService.seedDemoPortfolio();
    this.toast.success(
      '✨ Portafolio Demo Ejecutivo cargado: ingresos, gastos, Cashea, metas y pasivos listos para explorar.',
    );
  }

  clearDemoPortfolio(): void {
    this.financeService.clearDemoData();
    this.toast.info('🧹 Datos de demostración eliminados. Tus registros reales se mantienen.');
  }

  resetFullPortfolio(): void {
    this.financeService.resetLedgerToZero();
    this.toast.warn('🔄 Portafolio reiniciado a cero: todas las bóvedas, movimientos y pasivos han sido vaciados.');
  }

  // -------------------------------------------------------------
  // MOVEMENT EDIT & DELETION
  // -------------------------------------------------------------

  startEditMovement(item: UnifiedMovementItem): void {
    this.editingMovementId.set(item.id);
    this.editingMovementTitle.set(item.title);
    this.editingMovementAmountUsd.set(item.amountUsd);
  }

  saveEditMovement(item: UnifiedMovementItem): void {
    const newTitle = this.editingMovementTitle().trim();
    const newAmount = this.editingMovementAmountUsd();
    if (!newTitle || !newAmount || newAmount <= 0) {
      this.toast.warn('Ingresa un título y un monto válido en USD.');
      return;
    }

    this.financeService.updateMovement(item.id, item.type, {
      title: newTitle,
      amountUsd: newAmount,
    });

    this.editingMovementId.set(null);
    this.editingMovementTitle.set('');
    this.editingMovementAmountUsd.set(null);
    this.toast.success(`Movimiento "${newTitle}" ($${newAmount} USD) actualizado correctamente.`);
  }

  cancelEditMovement(): void {
    this.editingMovementId.set(null);
    this.editingMovementTitle.set('');
    this.editingMovementAmountUsd.set(null);
  }

  removeMovement(item: UnifiedMovementItem): void {
    this.financeService.deleteMovement(item.id, item.type);
    this.toast.info(`Movimiento "${item.title}" eliminado y saldo de bóveda revertido.`);
  }

  deleteLiabilityItem(item: LiabilityItem): void {
    this.financeService.deleteLiability(item.id);
    this.toast.info(`Compromiso "${item.title}" eliminado del calendario.`);
  }

  // -------------------------------------------------------------
  // WEALTH GOALS & RESERVE FUNDS
  // -------------------------------------------------------------

  openNewGoalModal(): void {
    this.newGoalTitle.set('');
    this.newGoalTargetUsd.set(null);
    this.newGoalCurrentUsd.set(0);
    this.newGoalDeadline.set(
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    );
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
      targetAmountUsd: target,
      currentAmountUsd: Math.max(0, this.newGoalCurrentUsd() ?? 0),
      scope: currentScope === 'all' ? 'personal' : currentScope,
      deadline: this.newGoalDeadline(),
      category: this.newGoalCategory(),
    });

    this.newGoalModalOpen.set(false);
    this.toast.success(`🎯 Meta patrimonial "${title}" ($${target} USD) creada.`);
  }

  deleteGoal(goal: WealthGoal): void {
    this.financeService.deleteWealthGoal(goal.id);
    this.toast.info(`Meta "${goal.title}" eliminada.`);
  }

  openContributeGoalModal(goal: WealthGoal): void {
    this.targetGoalForContribution.set(goal);
    this.contributeAmountUsd.set(50);
    const vaults = this.financeService.assets();
    this.contributeVaultId.set(vaults.length > 0 ? vaults[0].id : '');
    this.contributeGoalModalOpen.set(true);
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

    this.contributeGoalModalOpen.set(false);
    this.targetGoalForContribution.set(null);
    if (success) {
      const newTotal = goal.currentAmountUsd + amount;
      if (newTotal >= goal.targetAmountUsd) {
        this.toast.success(`🎉 ¡Felicidades! Meta "${goal.title}" alcanzada al 100%.`);
      } else {
        this.toast.success(`💰 Aporte de $${amount} USD registrado a favor de "${goal.title}".`);
      }
    }
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
  // QUICK MODAL & NATURAL LANGUAGE AI PARSER
  // -------------------------------------------------------------

  openQuickModal(type: 'expense' | 'income' | 'audio'): void {
    this.quickModalType.set(type);
    this.formTitle.set('');
    this.formAmount.set(null);
    this.formCurrency.set('USD');
    this.formReferenceNumber.set('');
    this.formNotes.set('');
    this.feeRatePct.set(0);
    this.smartCommandText.set('');
    this.scannedReceiptName.set('');
    this.isScanningReceipt.set(false);
    const vaults = this.financeService.assets();
    this.formVaultId.set(vaults.length > 0 ? vaults[0].id : '');
    this.quickModalOpen.set(true);

    if (type === 'audio') {
      this.startVoiceNoteSimulation();
    }
  }

  closeQuickModal(): void {
    this.quickModalOpen.set(false);
    this.isRecordingAudio.set(false);
    this.isScanningReceipt.set(false);
  }

  /** Handles image/receipt file selection for Gemini Vision / Heuristic OCR */
  async onReceiptFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.processReceiptFile(file);
    input.value = '';
  }

  /** Handles Ctrl+V clipboard paste of a receipt screenshot inside the modal */
  async onReceiptPaste(event: ClipboardEvent): Promise<void> {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
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

      const matchingVault = this.financeService
        .assets()
        .find((v) => v.currency === parsed.currency);
      if (matchingVault) {
        this.formVaultId.set(matchingVault.id);
      }

      this.formNotes.set(
        `Comprobante procesado por Visión IA (${file.name || 'imagen'})${parsed.referenceNumber ? ' · Ref: ' + parsed.referenceNumber : ''}`,
      );

      this.toast.success('📸 Comprobante analizado con éxito. Verifica los datos extraídos.');
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

  parseNaturalLanguageCommand(): void {
    const raw = this.smartCommandText().trim();
    if (!raw) {
      this.toast.warn('Escribe o dicta una frase como: "Gasté 25$ en gasolina por Pago Móvil"');
      return;
    }

    const bcv = this.financeService.currentBcvRate();
    const parsed = this.aiIngestor.parseWithHeuristics(raw, bcv);
    const lower = raw.toLowerCase();

    // Also extract plain integer/decimal numbers if regex missed simple "25$"
    let detectedAmount = parsed.amount;
    if (detectedAmount <= 0) {
      const simpleNum = raw.match(/(\d+(?:[.,]\d+)?)/);
      if (simpleNum) {
        detectedAmount = parseFloat(simpleNum[1].replace(',', '.')) || 0;
      }
    }

    if (
      lower.includes('cobré') ||
      lower.includes('cobre') ||
      lower.includes('recibí') ||
      lower.includes('ingreso') ||
      lower.includes('sueldo') ||
      lower.includes('venta')
    ) {
      this.quickModalType.set('income');
      if (lower.includes('venta') || lower.includes('taller')) {
        this.formIncomeCategory.set('business_sale');
        this.formScope.set('business');
      } else if (lower.includes('presupuesto') || lower.includes('anticipo')) {
        this.formIncomeCategory.set('quote_advance');
      } else {
        this.formIncomeCategory.set('salary');
      }
    } else {
      this.quickModalType.set('expense');
      this.formExpenseCategory.set(parsed.expenseCategory || 'other');
      this.formScope.set(parsed.scope);
    }

    if (detectedAmount > 0) {
      this.formAmount.set(detectedAmount);
    }
    this.formCurrency.set(parsed.currency);
    if (parsed.referenceNumber) {
      this.formReferenceNumber.set(parsed.referenceNumber);
    }
    const cleanTitle = raw
      .replace(/(?:gast[eé]|pagu[eé]|cobr[eé]|recib[ií]|en|por)\s+/gi, '')
      .replace(/\d+(?:[.,]\d+)?\s*(?:\$|usd|bs\.?|ves|dólares|bolívares)?/gi, '')
      .trim();
    this.formTitle.set(cleanTitle ? cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1) : parsed.title);
    this.formNotes.set(`Comando inteligente IA: "${raw}"`);

    const matchingVault = this.financeService
      .assets()
      .find((v) => v.currency === parsed.currency);
    if (matchingVault) {
      this.formVaultId.set(matchingVault.id);
    }

    this.toast.success('✨ Comando analizado y clasificado automáticamente.');
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
    const feePct = this.feeRatePct();
    let finalAmount = amount;
    let feeNote = '';

    if ((this.quickModalType() === 'expense' || this.quickModalType() === 'audio') && feePct > 0) {
      const feeAmount = Number(((amount * feePct) / 100).toFixed(2));
      finalAmount = Number((amount + feeAmount).toFixed(2));
      const feeLabel = feePct === 0.3 ? 'Pago Móvil (+0.3%)' : 'IGTF (+3.0%)';
      feeNote = ` · [Comisión Bancaria: ${feeLabel} +${currency} ${feeAmount.toLocaleString()}]`;
    }

    const tri = computeTriMonetaryAmount(finalAmount, currency, bcv, parallel);
    const scope = this.formScope();
    const vaultId = this.formVaultId() || undefined;
    const referenceNumber = this.formReferenceNumber().trim() || undefined;
    const channel: PaymentChannel =
      currency === 'VES' ? 'bs_bank' : currency === 'USDT' ? 'crypto' : 'zelle';
    const date = new Date().toISOString().split('T')[0];

    if (this.quickModalType() === 'expense' || this.quickModalType() === 'audio') {
      const title = this.formTitle().trim() || 'Gasto Rápido';
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
      this.toast.success(`Gasto registrado: $${tri.amount_usd} USD${feeNote ? ' (incluye comisión)' : ''}`);
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
        referenceNumber,
        notes: this.formNotes().trim() || undefined,
      });
      this.toast.success(`Ingreso registrado: $${tri.amount_usd} USD`);
    }

    this.closeQuickModal();
  }

  startVoiceNoteSimulation(): void {
    this.isRecordingAudio.set(true);
    setTimeout(() => {
      if (this.isRecordingAudio()) {
        const samplePhrase = 'Gasté 25$ en gasolina y transporte pagando por Pago Móvil';
        this.smartCommandText.set(samplePhrase);
        this.parseNaturalLanguageCommand();
        this.isRecordingAudio.set(false);
      }
    }, 1600);
  }

  // -------------------------------------------------------------
  // MANUAL LIABILITY CREATOR & VAULT-LINKED SETTLEMENT
  // -------------------------------------------------------------

  openNewLiabilityModal(): void {
    this.liabTitle.set('');
    this.liabCreditor.set('');
    this.liabAmountUsd.set(null);
    this.liabDueDate.set(
      new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    );
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
    this.toast.success(`⏳ Compromiso "${title}" ($${amount} USD) agendado en el calendario.`);
  }

  payQuickLiability(id: string, amountUsd: number): void {
    const debitVaultId = this.selectedLiabilityVaultId() || undefined;
    this.financeService.payLiability(id, amountUsd, debitVaultId, true);
    const vaultName =
      this.financeService.state().assets.find((v) => v.id === debitVaultId)?.name ||
      'Registro Contable';
    this.toast.success(
      `✅ Pasivo de $${amountUsd} USD liquidado desde "${vaultName}" y asentado en el Libro Mayor.`,
    );
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
      this.toast.error('No se pudo leer el archivo de respaldo.');
    } finally {
      input.value = '';
    }
  }

  downloadCsvExport(type: 'expenses' | 'incomes' | 'liabilities'): void {
    this.driveSync.downloadCsv(type);
  }
}
