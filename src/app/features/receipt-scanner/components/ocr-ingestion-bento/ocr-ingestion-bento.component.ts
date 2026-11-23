import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  OcrBatchProgress,
  OcrCounterpartySuggestion,
  OcrIdentityCrossCheck,
} from '../../ocr-ui.models';

const IDLE_PROGRESS: OcrBatchProgress = {
  active: false,
  currentIndex: 0,
  totalFiles: 0,
  progressPct: 0,
  statusLabel: '',
};

const EMPTY_IDENTITY: OcrIdentityCrossCheck = {
  expectedCounterparty: '',
  expectedId: '',
  expectedAmount: null,
};

@Component({
  selector: 'app-ocr-ingestion-bento',
  standalone: true,
  imports: [],
  templateUrl: './ocr-ingestion-bento.component.html',
  styleUrl: './ocr-ingestion-bento.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OcrIngestionBentoComponent {
  readonly hasScreenPipe = input<boolean>(false);
  readonly batchProgress = input<OcrBatchProgress>(IDLE_PROGRESS);
  readonly identityCheck = input<OcrIdentityCrossCheck>(EMPTY_IDENTITY);
  readonly counterpartySuggestions = input<readonly OcrCounterpartySuggestion[]>([]);
  readonly blacklistedCount = input<number>(0);

  readonly filesSelected = output<File[]>();
  readonly screenPipeRequested = output<void>();
  readonly manualTextSubmitted = output<string>();
  readonly identityCheckChange = output<OcrIdentityCrossCheck>();

  protected readonly isDragging = signal<boolean>(false);
  protected readonly manualText = signal<string>('');

  protected readonly clampedProgressPct = computed<number>(() => {
    const raw = this.batchProgress().progressPct;
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(100, Math.round(raw)));
  });

  protected readonly isBlacklistedMatch = computed<boolean>(() => {
    const expected = this.identityCheck().expectedCounterparty.trim().toLowerCase();
    const expectedId = this.identityCheck().expectedId.trim().toLowerCase();
    if (!expected && !expectedId) return false;
    return this.counterpartySuggestions().some(
      (item) =>
        item.isBlacklisted &&
        ((expected.length > 0 && item.name.trim().toLowerCase() === expected) ||
          (expectedId.length > 0 && (item.documentId ?? '').trim().toLowerCase() === expectedId)),
    );
  });

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const fileList = event.dataTransfer?.files;
    if (!fileList || fileList.length === 0) return;
    this.filesSelected.emit(Array.from(fileList));
  }

  protected onFileInputChange(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const fileList = inputEl.files;
    if (!fileList || fileList.length === 0) return;
    this.filesSelected.emit(Array.from(fileList));
    inputEl.value = '';
  }

  protected onManualTextInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.manualText.set(textarea.value);
  }

  protected submitManualText(): void {
    const trimmed = this.manualText().trim();
    if (!trimmed) return;
    this.manualTextSubmitted.emit(trimmed);
    this.manualText.set('');
  }

  protected onExpectedCounterpartyInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const current = this.identityCheck();
    const normalized = value.trim().toLowerCase();
    const matched = this.counterpartySuggestions().find(
      (item) => item.name.trim().toLowerCase() === normalized,
    );
    const nextId =
      matched?.documentId && !current.expectedId.trim() ? matched.documentId : current.expectedId;

    this.identityCheckChange.emit({
      ...current,
      expectedCounterparty: value,
      expectedId: nextId,
    });
  }

  protected onExpectedIdInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.identityCheckChange.emit({
      ...this.identityCheck(),
      expectedId: value,
    });
  }

  protected onExpectedAmountInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const parsed = raw === '' ? null : Number(raw);
    this.identityCheckChange.emit({
      ...this.identityCheck(),
      expectedAmount: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    });
  }
}
