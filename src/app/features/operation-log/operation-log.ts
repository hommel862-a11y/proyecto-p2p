import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { computeLogSummary, type Operation } from '@p2p/core';
import { StorageService } from '../../core/storage';

const OPS_KEY = 'p2p.operations';

type OpDraft = Omit<Operation, 'id' | 'timestamp'>;

const EMPTY_DRAFT: OpDraft = {
  type: 'buy',
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
  templateUrl: './operation-log.html',
})
export class OperationLog {
  private readonly storage = inject(StorageService);

  readonly operations = signal<Operation[]>(this.load());
  readonly summary = computed(() => computeLogSummary(this.operations()));
  readonly form = signal<OpDraft>({ ...EMPTY_DRAFT });

  private load(): Operation[] {
    return this.storage.get<Operation[]>(OPS_KEY) ?? [];
  }

  reload(): void {
    this.operations.set(this.load());
  }

  add(): void {
    const draft = this.form();
    const next: Operation[] = [
      ...this.operations(),
      {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...draft,
      },
    ];
    this.operations.set(next);
    this.storage.set(OPS_KEY, next);
    this.form.set({ ...EMPTY_DRAFT });
  }

  remove(id: string): void {
    const next = this.operations().filter((o) => o.id !== id);
    this.operations.set(next);
    this.storage.set(OPS_KEY, next);
  }

  exportAll(): string {
    return this.storage.exportAll();
  }

  importAll(json: string): void {
    this.storage.importAll(json);
    this.reload();
  }

  patchForm(patch: Partial<OpDraft>): void {
    this.form.set({ ...this.form(), ...patch });
  }
}
