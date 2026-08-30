import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { computeLogSummary, clampNonNegative, type Operation } from '@p2p/core';
import { StorageService } from '../../core/storage';
import { FORMAT_PIPES } from '../../core/format';

const OPS_KEY = 'p2p.operations';

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
      o.type === 'buy' ? 'compra' : 'venta',
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

type OpDraft = Omit<Operation, 'id' | 'timestamp'>;

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
};

/**
 * C3 — Operation log + PnL panel. Stores records via {@link StorageService}; PnL/capital/
 * exposure/streak all come from the pure {@link computeLogSummary} in `@p2p/core`.
 */
@Component({
  selector: 'app-operation-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FORMAT_PIPES],
  templateUrl: './operation-log.html',
})
export class OperationLog {
  private readonly storage = inject(StorageService);

  readonly operations = signal<Operation[]>(this.load());
  readonly pairFilter = signal<'all' | 'USDT' | 'EUR'>('all');
  /** Non-blocking persistence error message, shown in the template; null when all is well. */
  readonly error = signal<string | null>(null);

  readonly visibleOps = computed(() => {
    const f = this.pairFilter();
    const ops = this.operations();
    return f === 'all' ? ops : ops.filter((o) => o.pair === f);
  });

  readonly summary = computed(() => computeLogSummary(this.visibleOps()));

  setPairFilter(p: 'all' | 'USDT' | 'EUR'): void {
    this.pairFilter.set(p);
  }
  readonly form = signal<OpDraft>({ ...EMPTY_DRAFT });

  /** Template helper: collapse NaN/empty/negative money entries to 0. */
  clampMoney(v: number): number {
    return clampNonNegative(v);
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
      this.error.set('No se pudo guardar en el dispositivo: ' + (e as Error).message);
    }
  }

  add(): void {
    const draft = this.form();
    const next: Operation[] = [
      ...this.operations(),
      {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...draft,
        // Money sanitation: never persist NaN/negative amounts into the ledger.
        vesAmount: clampNonNegative(draft.vesAmount),
        usdtAmount: clampNonNegative(draft.usdtAmount),
        price: clampNonNegative(draft.price),
        fees: clampNonNegative(draft.fees),
      },
    ];
    this.operations.set(next);
    this.persist(next);
    this.form.set({ ...EMPTY_DRAFT });
  }

  remove(id: string): void {
    const next = this.operations().filter((o) => o.id !== id);
    this.operations.set(next);
    this.persist(next);
  }

  /** Serialize the current ledger to a backup JSON string. */
  serializeBackup(): string {
    return JSON.stringify(
      {
        app: 'p2p-decisor',
        version: 1,
        exportedAt: new Date().toISOString(),
        operations: this.operations(),
      },
      null,
      2,
    );
  }

  /** Parse a backup string into operations, validating shape. Throws on invalid input. */
  parseBackup(text: string): Operation[] {
    const parsed = JSON.parse(text);
    const ops = Array.isArray(parsed) ? parsed : parsed?.operations;
    if (!Array.isArray(ops)) throw new Error('el archivo no tiene operaciones');
    return ops
      .filter(
        (o: Partial<Operation>) => o && typeof o === 'object' && 'type' in o && 'timestamp' in o,
      )
      .map((o: Partial<Operation>) => ({ ...o, pair: o.pair === 'EUR' ? 'EUR' : 'USDT' })) as Operation[];
  }

  /** Download the operation ledger as a JSON backup file. */
  downloadBackup(): void {
    const blob = new Blob([this.serializeBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `p2p-operaciones-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Download the currently filtered operations as an Excel-friendly CSV ledger. */
  downloadCsv(): void {
    const csv = buildOperationsCsv(this.visibleOps());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `p2p-operaciones-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Import operations from a backup file, replacing the current ledger after validation. */
  importFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const clean = this.parseBackup(String(reader.result));
        this.operations.set(clean);
        this.storage.set(OPS_KEY, clean);
        input.value = '';
      } catch (e) {
        alert('No se pudo importar el respaldo: ' + (e as Error).message);
      }
    };
    reader.readAsText(file);
  }

  patchForm(patch: Partial<OpDraft>): void {
    this.form.set({ ...this.form(), ...patch });
  }
}
