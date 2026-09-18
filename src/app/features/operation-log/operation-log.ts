import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  computeLogSummary,
  clampNonNegative,
  OPS_KEY,
  clampMoney as sharedClampMoney,
  type Operation,
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
import {
  assessCounterpartyRisk,
  type Counterparty,
  type AntiTriangulationAssessment,
} from '@p2p/core';
import { OperationFormComponent, type OpDraft } from './operation-form.component';
import { OperationTableComponent } from './operation-table.component';
import { BackupPanelComponent } from './backup-panel.component';
import { OperationTimerBannerComponent } from './operation-timer-banner.component';
import { McpService } from '../../core/mcp.service';

/** CSV header row (es-VE) for the operation-ledger export. */
export const CSV_HEADER =
  'Fecha/Hora;Tipo;Par;Monto VES;Monto USDT;Precio;Comisiones;Sin errores;Comercio;Notas';

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
  /** Non-blocking persistence error message, shown in the template; null when all is well. */
  readonly error = signal<string | null>(null);

  /** Modals confirmation state */
  readonly pendingDeleteId = signal<string | null>(null);
  readonly pendingImportOps = signal<Operation[] | null>(null);

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
  }

  readonly visibleOps = computed(() => {
    const f = this.pairFilter();
    const ops = this.operations();
    return f === 'all' ? ops : ops.filter((o) => o.pair === f);
  });

  readonly summary = computed(() => computeLogSummary(this.visibleOps()));

  setPairFilter(p: 'all' | 'USDT' | 'EUR'): void {
    this.pairFilter.set(p);
  }

  readonly filteredOperations = computed(() => {
    const bank = this.selectedBank();
    if (!bank) return this.operations();
    const ops = this.operations();
    const matchingAccounts = this.accountsService.accounts().filter((a) => a.bankName === bank);
    const matchingAccountIds = matchingAccounts.map((a) => a.id);
    return ops.filter((o) => matchingAccountIds.includes(o.bankAccountId ?? ''));
  });

  readonly displayOperations = computed(() => {
    const pair = this.pairFilter();
    const baseOps = this.filteredOperations();
    return pair === 'all' ? baseOps : baseOps.filter((o) => o.pair === pair);
  });

  clearBankFilter(): void {
    this.selectedBank.set(null);
    this.router.navigate(['/log']);
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

  add(): void {
    const draft = this.form();
    const durationMs = this.timer.state() !== 'idle' ? this.timer.stop() : undefined;
    const activeSession = this.sessionService.activeSession();

    const newOp: Operation = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...draft,
      // Money sanitation: never persist NaN/negative amounts into the ledger.
      vesAmount: clampNonNegative(draft.vesAmount),
      usdtAmount: clampNonNegative(draft.usdtAmount),
      price: clampNonNegative(draft.price),
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

  /** Parse a backup string into operations, validating shape strictly. Throws on invalid input. */
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

        return {
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

  /** Sincroniza las operaciones más recientes con Google Sheets mediante MCP */
  async syncAllToGoogleSheets(): Promise<void> {
    const list = this.operations();
    if (list.length === 0) {
      this.toast.info('No hay operaciones registradas para sincronizar.');
      return;
    }

    const latest = list[0];
    try {
      const res = await this.mcpService.gsheetsSyncTrade({
        trade: {
          id: latest.id,
          timestamp: latest.timestamp,
          side: latest.type === 'buy' ? 'BUY' : 'SELL',
          bank: latest.merchantNote || 'Pago Móvil',
          rate: latest.price,
          vesAmount: latest.vesAmount,
          usdtAmount: latest.usdtAmount,
          grossSpreadPct: 0,
          netProfitUsdt: 0,
          counterparty: latest.notes || 'Anónimo',
          referenceNumber: 'N/A',
          status: 'COMPLETED',
        },
      });

      if (res.success) {
        this.toast.success('Operación sincronizada exitosamente con Google Sheets (MCP).');
        this.audit.log(
          'DATA_BACKUP',
          'Sincronización con Google Sheets',
          { opId: latest.id },
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
