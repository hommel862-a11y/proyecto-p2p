import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  computeLogSummary,
  clampNonNegative,
  roundMoney,
  OPS_KEY,
  clampMoney as sharedClampMoney,
  assessCounterpartyRisk,
  parseBinanceCsvFills,
  parseBankNotification,
  executeDesktopRpaReconciliation,
  syncGoogleSheetsLiveLedger,
  getTodayOperations,
  type Operation,
  type Counterparty,
  type AntiTriangulationAssessment,
  type DesktopRpaResult,
} from '@p2p/core';
import { CommonModule } from '@angular/common';
import { StorageService } from '../../core/storage';
import { ToastService } from '../../core/toast.service';
import { AuditLoggerService } from '../../core/audit-logger.service';
import { TradeTimerService } from '../../core/trade-timer.service';
import { SessionService } from '../../core/session.service';
import { AccountsService } from '../../core/accounts.service';
import { CounterpartyService } from '../../core/counterparty.service';
import { FORMAT_PIPES } from '../../core/format';
import { OperationFormComponent, type OpDraft } from './operation-form.component';
import { OperationTableComponent } from './operation-table.component';
import { BackupPanelComponent } from './backup-panel.component';
import { OperationTimerBannerComponent } from './operation-timer-banner.component';
import { InvoiceModalComponent } from './invoice-modal.component';
import { McpService } from '../../core/mcp.service';

/** CSV header row (es-VE) for the operation-ledger export. */
export const CSV_HEADER =
  'Fecha/Hora;Tipo;Par;Monto VES;Monto USDT;Precio;Comisiones;Sin errores;Comercio;Notas';

/** Extended accounting CSV header row with bank, payer ID, counterparty, and duration. */
export const EXTENDED_CSV_HEADER =
  'Fecha/Hora;Tipo;Par;Monto VES;Monto USDT;Precio;Comisiones;Cuenta Bancaria;Titular/Cédula;Contraparte CRM;Duración (s);Sin errores;Comercio;Notas';

/** Wrap a CSV field in double quotes if it contains `;`, `"`, `\n` or `\r` (doubling embedded quotes). */
function csvQuote(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialize operations to an Excel/es-VE-friendly CSV. Emits a UTF-8 BOM (`\uFEFF`), uses `;`
 * as the field delimiter, CRLF line endings, and proper CSV quoting. Pure — unit-testable.
 */
export function buildOperationsCsv(ops: readonly Operation[]): string {
  const rows = ops.map((o) =>
    [
      o.timestamp,
      o.type === 'buy' ? 'compra' : o.type === 'sell' ? 'venta' : 'asignación',
      o.pair,
      o.vesAmount,
      o.usdtAmount,
      o.price,
      o.fees,
      o.errorFree ? 'sí' : 'no',
      o.merchantNote,
      o.notes,
    ]
      .map(csvQuote)
      .join(';'),
  );
  return `\uFEFF${[CSV_HEADER, ...rows].join('\r\n')}\r\n`;
}

export function buildExtendedOperationsCsv(
  ops: readonly Operation[],
  resolveAccountName: (id?: string) => string,
  resolveCounterpartyName: (id?: string) => string,
): string {
  const rows = ops.map((o) =>
    [
      o.timestamp,
      o.type === 'buy' ? 'compra' : o.type === 'sell' ? 'venta' : 'asignación',
      o.pair,
      o.vesAmount,
      o.usdtAmount,
      o.price,
      o.fees,
      resolveAccountName(o.bankAccountId),
      o.payerName ?? '',
      resolveCounterpartyName(o.counterpartyId),
      o.durationMs ? Math.round(o.durationMs / 1000) : '',
      o.errorFree ? 'sí' : 'no',
      o.merchantNote,
      o.notes,
    ]
      .map(csvQuote)
      .join(';'),
  );
  return `\uFEFF${[EXTENDED_CSV_HEADER, ...rows].join('\r\n')}\r\n`;
}

function extractBankRefToken(text?: string): string {
  if (!text) return '';
  const explicit = text.match(/(?:ref(?:erencia)?[:.\s#-]*)([0-9]{5,14})/i);
  if (explicit) return explicit[1];
  const standalone = text.match(/\b([0-9]{6,14})\b/);
  return standalone ? standalone[1] : '';
}

const EMPTY_DRAFT: OpDraft = {
  type: 'buy',
  pair: 'USDT',
  vesAmount: 0,
  usdtAmount: 0,
  price: 0,
  merchantNote: '',
  fees: 0,
  notes: '',
  errorFree: false,
  bankAccountId: '',
  counterpartyId: '',
  payerName: '',
};

/**
 * C3 — Operation log + PnL panel. Stores records via {@link StorageService}; PnL/capital/
 * exposure/streak all come from the pure {@link computeLogSummary} in `@p2p/core`.
 */
@Component({
  selector: 'app-operation-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FORMAT_PIPES,
    OperationFormComponent,
    OperationTableComponent,
    BackupPanelComponent,
    OperationTimerBannerComponent,
    InvoiceModalComponent,
  ],
  templateUrl: './operation-log.html',
})
export class OperationLog {
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);
  private readonly audit = inject(AuditLoggerService);
  readonly timer = inject(TradeTimerService);
  readonly sessionService = inject(SessionService);
  readonly accountsService = inject(AccountsService);
  readonly crmService = inject(CounterpartyService);
  readonly mcpService = inject(McpService);

  readonly mcpLedgerSynced = signal<boolean>(true);
  readonly selectedBank = signal<string | null>(null);

  private readonly router = inject(Router);

  readonly operations = signal<Operation[]>(this.load());
  readonly pairFilter = signal<'all' | 'USDT' | 'EUR'>('all');
  readonly typeFilter = signal<'all' | 'buy' | 'sell' | 'assign'>('all');
  readonly searchQuery = signal<string>('');
  readonly onlyTodayFilter = signal<boolean>(false);
  readonly onlyActiveSessionFilter = signal<boolean>(false);

  /** Non-blocking persistence error message, shown in the template; null when all is well. */
  readonly error = signal<string | null>(null);

  /** Modals & Panels state */
  readonly pendingDeleteId = signal<string | null>(null);
  readonly pendingImportOps = signal<Operation[] | null>(null);
  readonly showInvoiceModal = signal<boolean>(false);
  readonly showFifoDetails = signal<boolean>(false);
  readonly showRpaModal = signal<boolean>(false);
  readonly editingOpId = signal<string | null>(null);

  /** RPA Batch Reconciler state */
  readonly rpaRawStatements = signal<string>('');
  readonly rpaResult = signal<DesktopRpaResult | null>(null);

  /** Shift Session target input */
  readonly targetOpsDraft = signal<number>(20);

  readonly form = signal<OpDraft>({ ...EMPTY_DRAFT });

  /** Treasury assignment form state */
  readonly showTreasuryAssign = signal(false);
  readonly assignDraft = signal<{
    vesAmount: number;
    bankAccountId: string;
    notes: string;
    errorFree: boolean;
  }>({
    vesAmount: 0,
    bankAccountId: '',
    notes: '',
    errorFree: true,
  });

  readonly selectedAccountUsage = computed(() => {
    const accId = this.form().bankAccountId;
    if (!accId) return null;
    return this.accountsService.usages().find((u) => u.account.id === accId) ?? null;
  });

  readonly limitExceededWarning = computed(() => {
    const f = this.form();
    if (f.type !== 'buy' || !f.bankAccountId) return null;
    const usage = this.selectedAccountUsage();
    if (!usage || usage.account.dailyLimitVes === 0) return null;
    const cost = f.vesAmount + f.fees;
    if (cost > usage.remainingLimitVes) {
      return `Atención: Esta compra (${cost.toLocaleString('es-VE')} Bs) supera el cupo diario restante (${usage.remainingLimitVes.toLocaleString('es-VE')} Bs) de ${usage.account.bankName}.`;
    }
    return null;
  });

  readonly duplicateRefWarning = computed<string | null>(() => {
    const f = this.form();
    const candidateRef =
      extractBankRefToken(f.merchantNote) || extractBankRefToken(f.notes);
    if (!candidateRef) return null;

    const currentEditId = this.editingOpId();
    const existing = this.operations().find((o) => {
      if (currentEditId && o.id === currentEditId) return false;
      const r1 = extractBankRefToken(o.merchantNote);
      const r2 = extractBankRefToken(o.notes);
      return r1 === candidateRef || r2 === candidateRef;
    });

    if (existing) {
      return `La referencia bancaria #${candidateRef} ya fue registrada en una operación previa (${existing.timestamp.slice(0, 16).replace('T', ' ')} por ${existing.vesAmount.toLocaleString('es-VE')} Bs). Verifica que no sea un comprobante repetido.`;
    }
    return null;
  });

  readonly selectedCounterparty = computed<Counterparty | null>(() => {
    const id = this.form().counterpartyId;
    if (!id) return null;
    return this.crmService.getById(id) ?? null;
  });

  readonly antiTriangulation = computed<AntiTriangulationAssessment>(() => {
    return assessCounterpartyRisk(this.selectedCounterparty(), this.form().payerName);
  });

  constructor() {
    const router = inject(Router);
    const url = router.parseUrl(router.url);
    const bankParam = url.queryParams['bank'];
    if (bankParam) {
      this.selectedBank.set(bankParam);
    }
    const preset = this.timer.consumePendingPreset();
    if (preset) {
      this.form.set({
        ...EMPTY_DRAFT,
        type: preset.type,
        pair: preset.pair,
        price: preset.price,
        vesAmount: preset.vesAmount,
        usdtAmount: preset.usdtAmount,
        merchantNote: preset.merchantNote ?? '',
      });
    }

    const autoFillAmount = Number(url.queryParams['autoFillAmount']);
    const autoFillRef = url.queryParams['autoFillRef'];
    const autoFillBank = url.queryParams['autoFillBank'];
    const autoFillPayer = url.queryParams['autoFillPayer'];
    const autoFillPayerId = url.queryParams['autoFillPayerId'];

    if (autoFillAmount > 0 || autoFillRef) {
      this.form.set({
        ...EMPTY_DRAFT,
        vesAmount: autoFillAmount || 0,
        merchantNote: autoFillRef ? `Ref: ${autoFillRef}` : '',
        payerName: autoFillPayer || '',
        notes: [
          autoFillBank ? `Banco: ${autoFillBank}` : '',
          autoFillPayer ? `Pagador: ${autoFillPayer}` : '',
          autoFillPayerId ? `Cédula: ${autoFillPayerId}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      });
      this.toast.info('Formulario de operación prellenado desde el comprobante.');
    }
  }

  readonly filteredOperations = computed(() => {
    let ops = this.operations();

    // 1. Bank filter
    const bank = this.selectedBank();
    if (bank) {
      const matchingAccounts = this.accountsService
        .accounts()
        .filter((a) => a.bankName === bank || a.bankCode === bank);
      const matchingAccountIds = matchingAccounts.map((a) => a.id);
      ops = ops.filter(
        (o) =>
          matchingAccountIds.includes(o.bankAccountId ?? '') ||
          o.merchantNote?.toLowerCase().includes(bank.toLowerCase()),
      );
    }

    // 2. Type filter
    const t = this.typeFilter();
    if (t !== 'all') {
      ops = ops.filter((o) => o.type === t);
    }

    // 3. Only Today filter
    if (this.onlyTodayFilter()) {
      ops = getTodayOperations(ops);
    }

    // 4. Active Session filter
    if (this.onlyActiveSessionFilter()) {
      const activeId = this.sessionService.activeSession()?.id;
      if (activeId) {
        ops = ops.filter((o) => o.sessionId === activeId);
      }
    }

    // 5. Search query filter
    const q = this.searchQuery().trim().toLowerCase();
    if (q) {
      ops = ops.filter((o) => {
        const accName = this.accountsService.getAccountById(o.bankAccountId ?? '')?.bankName ?? '';
        const cpAlias = this.crmService.getById(o.counterpartyId ?? '')?.alias ?? '';
        return (
          o.merchantNote?.toLowerCase().includes(q) ||
          o.notes?.toLowerCase().includes(q) ||
          o.payerName?.toLowerCase().includes(q) ||
          accName.toLowerCase().includes(q) ||
          cpAlias.toLowerCase().includes(q) ||
          String(o.vesAmount).includes(q) ||
          String(o.usdtAmount).includes(q) ||
          String(o.price).includes(q)
        );
      });
    }

    return ops;
  });

  readonly visibleOps = computed(() => {
    const f = this.pairFilter();
    const baseOps = this.filteredOperations();
    return f === 'all' ? baseOps : baseOps.filter((o) => o.pair === f);
  });

  readonly displayOperations = computed(() => this.visibleOps());

  readonly summary = computed(() => computeLogSummary(this.visibleOps()));

  readonly activeSessionOpsCount = computed(() => {
    const active = this.sessionService.activeSession();
    if (!active) return 0;
    return this.operations().filter((o) => o.sessionId === active.id).length;
  });

  readonly activeSessionProgressPct = computed(() => {
    const active = this.sessionService.activeSession();
    if (!active || !active.targetOps || active.targetOps <= 0) return 0;
    return Math.min(100, Math.round((this.activeSessionOpsCount() / active.targetOps) * 100));
  });

  setPairFilter(p: 'all' | 'USDT' | 'EUR'): void {
    this.pairFilter.set(p);
  }

  setTypeFilter(t: 'all' | 'buy' | 'sell' | 'assign'): void {
    this.typeFilter.set(t);
  }

  setSearchQuery(q: string): void {
    this.searchQuery.set(q);
  }

  toggleOnlyToday(): void {
    this.onlyTodayFilter.update((v) => !v);
  }

  toggleActiveSessionFilter(): void {
    this.onlyActiveSessionFilter.update((v) => !v);
  }

  toggleFifoDetails(): void {
    this.showFifoDetails.update((v) => !v);
  }

  clearBankFilter(): void {
    this.selectedBank.set(null);
    this.router.navigate(['/log']);
  }

  startShiftSession(): void {
    const target = Math.max(1, clampNonNegative(this.targetOpsDraft()));
    this.sessionService.startSession({ targetOps: target });
    this.toast.success(`Turno iniciado (Meta: ${target} operaciones).`, 'Control de Turno');
  }

  closeShiftSession(): void {
    const closed = this.sessionService.closeSession({
      disciplineRating: this.summary().zeroErrorStreak >= 5 ? 5 : 4,
    });
    if (closed) {
      this.onlyActiveSessionFilter.set(false);
      this.toast.info('Turno de operaciones finalizado y auditado.', 'Fin de Turno');
    }
  }

  prepareLiquidateOpenInventory(): void {
    const fifo = this.summary().fifo;
    if (fifo.openInventoryAmount <= 0) return;

    const exitPrice = roundMoney(fifo.openInventoryAvgPriceVes * 1.01, 2);
    const amountUsdt = roundMoney(fifo.openInventoryAmount, 4);
    const totalVes = roundMoney(amountUsdt * exitPrice, 2);

    this.form.set({
      ...EMPTY_DRAFT,
      type: 'sell',
      pair: 'USDT',
      usdtAmount: amountUsdt,
      price: exitPrice,
      vesAmount: totalVes,
      merchantNote: 'Liquidación de inventario abierto FIFO (+1%)',
    });
    this.toast.info(
      `Inventario abierto (${amountUsdt} USDT) cargado para venta a tasa ${exitPrice} Bs (+1% sobre costo FIFO).`,
      'Liquidación FIFO',
    );
  }

  /** Template helper: collapse NaN/empty/negative money entries to 0. */
  clampMoney(v: number): number {
    return sharedClampMoney(v);
  }

  private load(): Operation[] {
    return this.storage.get<Operation[]>(OPS_KEY) ?? [];
  }

  reload(): void {
    this.operations.set(this.load());
  }

  /** Persist the current ledger, surfacing a non-blocking error if the backend fails. */
  private persist(next: Operation[]): void {
    try {
      this.storage.set(OPS_KEY, next);
      this.error.set(null);
    } catch (e) {
      // Keep the in-memory state so the UI stays consistent for this session; just warn.
      const msg = 'No se pudo guardar en el almacenamiento local: ' + (e as Error).message;
      this.error.set(msg);
      this.toast.error(msg);
    }
    // Keep treasury/velocity derivations fresh after any ledger write (add, assign, remove, restore).
    this.accountsService.refreshLedger();
  }

  /**
   * UI submission handler with strict coherence validation and edit-in-place support.
   */
  submitFromUi(): void {
    const draft = this.form();
    const ves = clampNonNegative(draft.vesAmount);
    const usdt = clampNonNegative(draft.usdtAmount);
    const price = clampNonNegative(draft.price);

    if (ves <= 0 && usdt <= 0) {
      this.toast.error(
        'Ingresa un monto válido en VES o USDT antes de registrar la operación.',
        'Datos Incompletos',
      );
      return;
    }

    if (this.duplicateRefWarning()) {
      this.toast.error(
        'Operación retenida: La referencia bancaria ingresada ya existe en el libro mayor.',
        'Escudo Anti-Replay',
      );
      return;
    }

    const editId = this.editingOpId();
    if (editId) {
      this.saveEditedOperation(editId);
      return;
    }

    this.add();
  }

  add(): void {
    const draft = this.form();
    const durationMs = this.timer.state() !== 'idle' ? this.timer.stop() : undefined;
    const activeSession = this.sessionService.activeSession();

    let vesAmount = clampNonNegative(draft.vesAmount);
    let usdtAmount = clampNonNegative(draft.usdtAmount);
    let price = clampNonNegative(draft.price);

    // Auto-complete missing third leg if 2 legs are positive
    if (price > 0 && vesAmount > 0 && usdtAmount === 0) {
      usdtAmount = Number((vesAmount / price).toFixed(6));
    } else if (price > 0 && usdtAmount > 0 && vesAmount === 0) {
      vesAmount = roundMoney(usdtAmount * price, 2);
    } else if (vesAmount > 0 && usdtAmount > 0 && price === 0) {
      price = roundMoney(vesAmount / usdtAmount, 2);
    }

    const newOp: Operation = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...draft,
      // Money sanitation: never persist NaN/negative amounts into the ledger.
      vesAmount,
      usdtAmount,
      price,
      fees: clampNonNegative(draft.fees),
      durationMs,
      sessionId: activeSession?.id,
      bankAccountId: draft.bankAccountId ? draft.bankAccountId : undefined,
      counterpartyId: draft.counterpartyId ? draft.counterpartyId : undefined,
      payerName: draft.payerName?.trim() ? draft.payerName.trim() : undefined,
    };

    if (this.selectedCounterparty()?.reputation === 'BLOCKED') {
      this.toast.error(
        'Operación bloqueada: La contraparte está en la lista negra.',
        'Seguridad Anti-Fraude',
      );
      return;
    }

    const next: Operation[] = [...this.operations(), newOp];
    this.operations.set(next);
    this.persist(next);
    this.form.set({ ...EMPTY_DRAFT });

    this.toast.success(
      `Operación de ${newOp.type === 'buy' ? 'compra' : 'venta'} (${newOp.pair}) registrada con éxito.`,
    );

    // Herramienta MCP: add_operation_entry (Local cryptographically audited ledger)
    if (newOp.type === 'buy' || newOp.type === 'sell') {
      void this.mcpService
        .addOperationEntry({
          side: newOp.type,
          vesAmount: newOp.vesAmount,
          usdtAmount: newOp.usdtAmount,
          price: newOp.price,
          notes: newOp.merchantNote || newOp.notes,
          humanConfirm: true,
        })
        .then((res) => {
          if (res.success) {
            this.mcpLedgerSynced.set(true);
          }
        });
    }

    this.audit.log(
      'DATA_MUTATION',
      'Operación registrada',
      {
        id: newOp.id,
        type: newOp.type,
        pair: newOp.pair,
        vesAmount: newOp.vesAmount,
        usdtAmount: newOp.usdtAmount,
      },
      'info',
    );
  }

  cloneOperation(op: Operation): void {
    this.editingOpId.set(null);
    this.form.set({
      type: op.type === 'assign' ? 'buy' : op.type,
      pair: op.pair,
      vesAmount: op.vesAmount,
      usdtAmount: op.usdtAmount,
      price: op.price,
      fees: op.fees,
      merchantNote: op.merchantNote,
      notes: op.notes,
      errorFree: op.errorFree,
      bankAccountId: op.bankAccountId ?? '',
      counterpartyId: op.counterpartyId ?? '',
      payerName: op.payerName ?? '',
    });
    this.toast.info(
      'Operación clonada en el formulario. Ajusta el monto o referencia y registra.',
      'Clonado Rápido',
    );
  }

  startEditOperation(op: Operation): void {
    this.editingOpId.set(op.id);
    this.form.set({
      type: op.type === 'assign' ? 'buy' : op.type,
      pair: op.pair,
      vesAmount: op.vesAmount,
      usdtAmount: op.usdtAmount,
      price: op.price,
      fees: op.fees,
      merchantNote: op.merchantNote,
      notes: op.notes,
      errorFree: op.errorFree,
      bankAccountId: op.bankAccountId ?? '',
      counterpartyId: op.counterpartyId ?? '',
      payerName: op.payerName ?? '',
    });
    this.toast.info('Editando operación seleccionada.', 'Modo Edición');
  }

  cancelEditOperation(): void {
    this.editingOpId.set(null);
    this.form.set({ ...EMPTY_DRAFT });
  }

  private saveEditedOperation(editId: string): void {
    const draft = this.form();
    const next = this.operations().map((existing) => {
      if (existing.id !== editId) return existing;
      return {
        ...existing,
        ...draft,
        vesAmount: clampNonNegative(draft.vesAmount),
        usdtAmount: clampNonNegative(draft.usdtAmount),
        price: clampNonNegative(draft.price),
        fees: clampNonNegative(draft.fees),
        bankAccountId: draft.bankAccountId ? draft.bankAccountId : undefined,
        counterpartyId: draft.counterpartyId ? draft.counterpartyId : undefined,
        payerName: draft.payerName?.trim() ? draft.payerName.trim() : undefined,
      };
    });

    this.operations.set(next);
    this.persist(next);
    this.editingOpId.set(null);
    this.form.set({ ...EMPTY_DRAFT });

    this.toast.success('Operación actualizada correctamente en el libro mayor.', 'Edición Guardada');
    this.audit.log('DATA_MUTATION', 'Operación editada', { id: editId }, 'info');
  }

  addAssign(): void {
    const draft = this.assignDraft();
    if (draft.vesAmount <= 0) {
      this.toast.error('Ingresa un monto VES válido para la asignación.');
      return;
    }
    if (!draft.bankAccountId) {
      this.toast.error('Selecciona una cuenta bancaria destino.');
      return;
    }

    const newOp: Operation = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'assign',
      pair: 'USDT',
      vesAmount: clampNonNegative(draft.vesAmount),
      usdtAmount: 0,
      price: 0,
      merchantNote: 'Asignación de tesorería',
      fees: 0,
      notes: draft.notes,
      errorFree: draft.errorFree,
      bankAccountId: draft.bankAccountId,
    };

    const next: Operation[] = [...this.operations(), newOp];
    this.operations.set(next);
    this.persist(next);
    this.assignDraft.set({ vesAmount: 0, bankAccountId: '', notes: '', errorFree: true });
    this.showTreasuryAssign.set(false);

    this.toast.success(
      `Asignación de tesorería (${newOp.vesAmount.toLocaleString('es-VE')} Bs) registrada en ${this.accountsService.getAccountById(newOp.bankAccountId!)?.bankName ?? 'cuenta'}.`,
    );
    this.audit.log(
      'DATA_MUTATION',
      'Asignación de tesorería',
      { id: newOp.id, vesAmount: newOp.vesAmount, bankAccountId: newOp.bankAccountId },
      'info',
    );
  }

  toggleTreasuryAssign(): void {
    this.showTreasuryAssign.update((v) => !v);
  }

  selectCounterparty(id: string): void {
    const cp = this.crmService.getById(id);
    if (cp) {
      this.patchForm({
        counterpartyId: cp.id,
        merchantNote: this.form().merchantNote || cp.alias,
      });
    } else {
      this.patchForm({ counterpartyId: '' });
    }
  }

  requestRemove(id: string): void {
    this.pendingDeleteId.set(id);
  }

  confirmRemove(): void {
    const id = this.pendingDeleteId();
    if (!id) return;
    this.remove(id);
    this.pendingDeleteId.set(null);
  }

  cancelRemove(): void {
    this.pendingDeleteId.set(null);
  }

  remove(id: string): void {
    const target = this.operations().find((o) => o.id === id);
    const next = this.operations().filter((o) => o.id !== id);
    this.operations.set(next);
    this.persist(next);

    this.toast.info('Operación eliminada del registro.');
    this.audit.log('DATA_MUTATION', 'Operación eliminada', { id, target }, 'info');
  }

  /** Serialize the current ledger to a backup JSON string. */
  serializeBackup(): string {
    return JSON.stringify(
      {
        app: 'p2p-decisor',
        version: 1,
        exportedAt: new Date().toISOString(),
        operationsCount: this.operations().length,
        operations: this.operations(),
      },
      null,
      2,
    );
  }

  /**
   * Parse a backup string into operations, validating shape strictly and preserving
   * all institutional metadata fields (bankAccountId, counterpartyId, payerName, durationMs, sessionId).
   */
  parseBackup(text: string): Operation[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('El archivo no es un JSON válido.');
    }

    const ops = Array.isArray(parsed) ? parsed : (parsed as { operations?: unknown })?.operations;

    if (!Array.isArray(ops)) {
      throw new Error('El archivo no contiene un arreglo de operaciones válido.');
    }

    return ops
      .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
      .map((o) => {
        const rawType = String(o['type'] || 'buy');
        const type: Operation['type'] =
          rawType === 'sell' ? 'sell' : rawType === 'assign' ? 'assign' : 'buy';
        const rawPair = String(o['pair'] || 'USDT');
        const pair: 'USDT' | 'EUR' = rawPair === 'EUR' ? 'EUR' : 'USDT';

        const base: Operation = {
          id: typeof o['id'] === 'string' && o['id'] ? o['id'] : crypto.randomUUID(),
          timestamp:
            typeof o['timestamp'] === 'string' && o['timestamp']
              ? o['timestamp']
              : new Date().toISOString(),
          type,
          pair,
          vesAmount: clampNonNegative(Number(o['vesAmount']) || 0),
          usdtAmount: clampNonNegative(Number(o['usdtAmount']) || 0),
          price: clampNonNegative(Number(o['price']) || 0),
          fees: clampNonNegative(Number(o['fees']) || 0),
          merchantNote: String(o['merchantNote'] || ''),
          notes: String(o['notes'] || ''),
          errorFree: Boolean(o['errorFree']),
        };

        if ('durationMs' in o) {
          base.durationMs =
            typeof o['durationMs'] === 'number' ? clampNonNegative(o['durationMs']) : undefined;
        }
        if ('sessionId' in o) {
          base.sessionId = typeof o['sessionId'] === 'string' ? o['sessionId'] : undefined;
        }
        if ('bankAccountId' in o) {
          base.bankAccountId =
            typeof o['bankAccountId'] === 'string' && o['bankAccountId']
              ? o['bankAccountId']
              : undefined;
        }
        if ('counterpartyId' in o) {
          base.counterpartyId =
            typeof o['counterpartyId'] === 'string' && o['counterpartyId']
              ? o['counterpartyId']
              : undefined;
        }
        if ('payerName' in o) {
          base.payerName =
            typeof o['payerName'] === 'string' && o['payerName'] ? o['payerName'] : undefined;
        }
        if ('operatorId' in o && typeof o['operatorId'] === 'string') {
          base.operatorId = o['operatorId'];
        }
        if ('operatorName' in o && typeof o['operatorName'] === 'string') {
          base.operatorName = o['operatorName'];
        }

        return base;
      });
  }

  /** Download the operation ledger as a JSON backup file. */
  downloadBackup(): void {
    const count = this.operations().length;
    const blob = new Blob([this.serializeBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `p2p-operaciones-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this.toast.success(`Respaldo JSON exportado (${count} operaciones).`);
    this.audit.log('DATA_BACKUP', 'Exportación de respaldo JSON', { count }, 'info');
  }

  /** Download the currently filtered operations as an Excel-friendly CSV ledger. */
  downloadCsv(): void {
    const ops = this.visibleOps();
    const csv = buildOperationsCsv(ops);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `p2p-operaciones-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    this.toast.success(`Archivo CSV exportado (${ops.length} filas).`);
    this.audit.log('DATA_BACKUP', 'Exportación CSV', { count: ops.length }, 'info');
  }

  /** Download the extended accounting CSV including bank account, payer ID, CRM counterparty and duration. */
  downloadExtendedCsv(): void {
    const ops = this.visibleOps();
    const csv = buildExtendedOperationsCsv(
      ops,
      (accId) => (accId ? (this.accountsService.getAccountById(accId)?.bankName ?? '') : ''),
      (cpId) => (cpId ? (this.crmService.getById(cpId)?.alias ?? '') : ''),
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `p2p-auditoria-contable-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    this.toast.success(`CSV Contable Completo exportado (${ops.length} filas).`);
    this.audit.log('DATA_BACKUP', 'Exportación CSV Contable Completo', { count: ops.length }, 'info');
  }

  /**
   * Direct ingestion of official Binance P2P CSV export files with automatic deduplication.
   */
  importBinanceCsvFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const fills = parseBinanceCsvFills(String(reader.result));
        const completed = fills.filter((f) => f.status === 'COMPLETED' && f.filledAmountUsdt > 0);

        if (completed.length === 0) {
          this.toast.warn('No se encontraron órdenes COMPLETED válidas en el CSV de Binance.');
          input.value = '';
          return;
        }

        const existingOps = this.operations();
        const existingNotes = new Set<string>();
        for (const op of existingOps) {
          if (op.merchantNote) existingNotes.add(op.merchantNote);
          if (op.notes) existingNotes.add(op.notes);
          existingNotes.add(op.id);
        }

        const importedOps: Operation[] = [];
        let skipped = 0;

        for (const fill of completed) {
          const isDuplicate = Array.from(existingNotes).some(
            (txt) => fill.orderNumber && txt.includes(fill.orderNumber),
          );
          if (isDuplicate) {
            skipped++;
            continue;
          }

          importedOps.push({
            id: crypto.randomUUID(),
            timestamp: new Date(fill.createdAt).toISOString(),
            type: fill.side === 'SELL' ? 'sell' : 'buy',
            pair: fill.asset === 'EUR' ? 'EUR' : 'USDT',
            vesAmount: clampNonNegative(fill.totalFiat),
            usdtAmount: clampNonNegative(fill.filledAmountUsdt),
            price: clampNonNegative(fill.filledPrice),
            fees: roundMoney(fill.commissionUsdt * fill.filledPrice, 2),
            merchantNote: fill.counterpartyNickname
              ? `${fill.counterpartyNickname} (Orden #${fill.orderNumber})`
              : `Binance #${fill.orderNumber}`,
            notes: `Importado desde CSV Binance P2P — Orden: ${fill.orderNumber}`,
            errorFree: true,
          });
        }

        if (importedOps.length > 0) {
          const merged = [...existingOps, ...importedOps].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          );
          this.operations.set(merged);
          this.persist(merged);
          this.toast.success(
            `Se importaron ${importedOps.length} órdenes de Binance P2P (${skipped} duplicadas omitidas).`,
            'Ingesta Binance P2P',
          );
          this.audit.log(
            'DATA_RESTORE',
            'Importación CSV Binance P2P',
            { imported: importedOps.length, skipped },
            'info',
          );
        } else {
          this.toast.info(
            `Todas las órdenes del CSV (${skipped}) ya estaban registradas en el libro mayor.`,
            'Sin Novedades',
          );
        }
        input.value = '';
      } catch (err) {
        this.toast.error('Error al procesar CSV de Binance: ' + (err as Error).message);
        input.value = '';
      }
    };
    reader.readAsText(file);
  }

  /**
   * Batch RPA Reconciliation of pasted bank statements against the operation ledger.
   */
  runRpaBatchReconciliation(): void {
    const raw = this.rpaRawStatements().trim();
    if (!raw) {
      this.toast.warn('Pega al menos una línea de notificación o movimiento bancario.');
      return;
    }

    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsedStatements = lines
      .map((line, idx) => {
        const p = parseBankNotification(line);
        return {
          referenceNumber: p.reference || `SIN-REF-${idx + 1}`,
          amount: p.amountVes,
          beneficiaryOrPayer: p.senderId || 'Desconocido',
          timestamp: p.timestamp,
          bankName: p.bankName,
        };
      })
      .filter((s) => s.amount > 0);

    if (parsedStatements.length === 0) {
      this.toast.error('No se detectaron montos en Bs válidos en el texto pegado.');
      return;
    }

    const registeredP2pOrders = this.operations()
      .filter((o) => o.type !== 'assign')
      .map((o) => ({
        orderId: o.id,
        expectedBankReference:
          extractBankRefToken(o.merchantNote) || extractBankRefToken(o.notes) || o.id,
        expectedAmountFiat: o.vesAmount,
        counterpartyRealName: o.payerName || o.merchantNote || 'Cliente',
      }));

    const result = executeDesktopRpaReconciliation({
      bankName: parsedStatements[0]?.bankName || 'Banca Nacional',
      rawBankStatements: parsedStatements,
      registeredP2pOrders,
    });

    this.rpaResult.set(result);
    this.toast.info(
      `Conciliación RPA: ${result.matchedTransactionsCount}/${result.totalStatementsParsed} movimientos conciliados (${result.autoReconciliationRatePct}%).`,
      'Auditoría RPA',
    );
  }

  loadOrphanDiscrepancyIntoForm(disc: { referenceNumber: string; bankAmount: number }): void {
    this.showRpaModal.set(false);
    this.patchForm({
      vesAmount: disc.bankAmount,
      merchantNote: `Ref: ${disc.referenceNumber}`,
    });
    this.toast.info(
      `Abono huérfano (Ref: ${disc.referenceNumber} por ${disc.bankAmount.toLocaleString('es-VE')} Bs) cargado en el formulario.`,
    );
  }

  /** Read and stage operations from a backup file, asking for user confirmation. */
  importFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const clean = this.parseBackup(String(reader.result));
        this.pendingImportOps.set(clean);
        input.value = '';
      } catch (e) {
        this.toast.error('No se pudo importar el respaldo: ' + (e as Error).message);
        input.value = '';
      }
    };
    reader.readAsText(file);
  }

  confirmImport(): void {
    const ops = this.pendingImportOps();
    if (!ops) return;

    this.operations.set(ops);
    this.persist(ops);
    this.pendingImportOps.set(null);

    this.toast.success(`Respaldo restaurado con éxito: ${ops.length} operaciones cargadas.`);
    this.audit.log('DATA_RESTORE', 'Restauración de respaldo JSON', { count: ops.length }, 'warn');
  }

  cancelImport(): void {
    this.pendingImportOps.set(null);
  }

  patchForm(patch: Partial<OpDraft>): void {
    this.form.set({ ...this.form(), ...patch });
  }

  /** Sincroniza las operaciones más recientes con Google Sheets mediante MCP calculando métricas FIFO reales */
  async syncAllToGoogleSheets(): Promise<void> {
    const list = this.operations().filter((o) => o.type === 'buy' || o.type === 'sell');
    if (list.length === 0) {
      this.toast.info('No hay operaciones comerciales registradas para sincronizar.');
      return;
    }

    const latest = list[list.length - 1];
    const fifo = this.summary().fifo;
    const matchedRecord = fifo.matches.find(
      (m) => m.closingOpId === latest.id || m.openingOpId === latest.id,
    );

    const sheetCalc = syncGoogleSheetsLiveLedger({
      tradeDate: latest.timestamp.slice(0, 10),
      orderId: latest.id,
      counterpartyAlias: latest.merchantNote || 'Cliente P2P',
      tradeType: latest.type === 'buy' ? 'BUY' : 'SELL',
      cryptoAmountUsdt: latest.usdtAmount,
      fiatAmountVes: latest.vesAmount,
      exchangeRate: latest.price,
      platformFeeUsdt: latest.price > 0 ? latest.fees / latest.price : 0,
      bankTransferFeeVes: latest.fees,
    });

    const netProfitUsdt = matchedRecord
      ? matchedRecord.grossPnlUsdt
      : sheetCalc.calculatedGrossProfitUsdt;
    const grossSpreadPct =
      matchedRecord && matchedRecord.openingPriceVes > 0
        ? roundMoney(
            ((matchedRecord.closingPriceVes - matchedRecord.openingPriceVes) /
              matchedRecord.openingPriceVes) *
              100,
            2,
          )
        : sheetCalc.calculatedNetMarginPct;

    try {
      const res = await this.mcpService.gsheetsSyncTrade({
        trade: {
          id: latest.id,
          timestamp: latest.timestamp,
          side: latest.type === 'buy' ? 'BUY' : 'SELL',
          bank:
            this.accountsService.getAccountById(latest.bankAccountId ?? '')?.bankName ||
            latest.merchantNote ||
            'Pago Móvil',
          rate: latest.price,
          vesAmount: latest.vesAmount,
          usdtAmount: latest.usdtAmount,
          grossSpreadPct,
          netProfitUsdt,
          counterparty: latest.payerName || latest.merchantNote || 'Verificado',
          referenceNumber: extractBankRefToken(latest.merchantNote) || 'N/A',
          status: 'COMPLETED',
        },
      });

      if (res.success) {
        this.toast.success(
          `Operación sincronizada con Google Sheets (Spread: ${grossSpreadPct}% · PnL: ${netProfitUsdt} USDT).`,
        );
        this.audit.log(
          'DATA_BACKUP',
          'Sincronización con Google Sheets',
          { opId: latest.id, grossSpreadPct, netProfitUsdt },
          'info',
        );
      } else {
        this.toast.warn('No se pudo completar la sincronización con Google Sheets.');
      }
    } catch {
      this.toast.warn('Error al invocar Google Sheets MCP.');
    }
  }

  /** Respalda el snapshot contable en Google Drive mediante MCP */
  async backupLedgerToGoogleDrive(): Promise<void> {
    try {
      const payload = this.serializeBackup();
      const res = await this.mcpService.gdriveSyncDbBackup({
        backupType: 'ledger_json',
        dataPayload: payload,
      });

      if (res.success) {
        this.toast.success('Snapshot del Ledger respaldado exitosamente en Google Drive (MCP).');
        this.audit.log(
          'DATA_BACKUP',
          'Respaldo en Google Drive',
          { opsCount: this.operations().length },
          'info',
        );
      } else {
        this.toast.warn('No se pudo completar el respaldo en Google Drive.');
      }
    } catch {
      this.toast.warn('Error al invocar Google Drive MCP.');
    }
  }
}
