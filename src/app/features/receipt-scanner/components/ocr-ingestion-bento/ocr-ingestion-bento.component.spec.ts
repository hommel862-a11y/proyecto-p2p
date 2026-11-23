import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { OcrIngestionBentoComponent } from './ocr-ingestion-bento.component';
import type {
  OcrBatchProgress,
  OcrCounterpartySuggestion,
  OcrIdentityCrossCheck,
} from '../../ocr-ui.models';

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

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

const SUGGESTIONS: readonly OcrCounterpartySuggestion[] = [
  { id: 'cp-1', name: 'Carlos Mendoza', documentId: 'V-19442011', isBlacklisted: false },
  { id: 'cp-2', name: 'Cuenta Sospechosa', documentId: 'V-99999999', isBlacklisted: true },
];

describe('OcrIngestionBentoComponent', () => {
  let fixture: ComponentFixture<OcrIngestionBentoComponent>;
  let component: OcrIngestionBentoComponent;

  const setup = (
    overrides: Partial<{
      hasScreenPipe: boolean;
      batchProgress: OcrBatchProgress;
      identityCheck: OcrIdentityCrossCheck;
      counterpartySuggestions: readonly OcrCounterpartySuggestion[];
      blacklistedCount: number;
    }> = {},
  ) => {
    TestBed.configureTestingModule({
      imports: [OcrIngestionBentoComponent],
    });

    fixture = TestBed.createComponent(OcrIngestionBentoComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('hasScreenPipe', overrides.hasScreenPipe ?? false);
    fixture.componentRef.setInput('batchProgress', overrides.batchProgress ?? IDLE_PROGRESS);
    fixture.componentRef.setInput('identityCheck', overrides.identityCheck ?? EMPTY_IDENTITY);
    fixture.componentRef.setInput(
      'counterpartySuggestions',
      overrides.counterpartySuggestions ?? SUGGESTIONS,
    );
    fixture.componentRef.setInput('blacklistedCount', overrides.blacklistedCount ?? 3);

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders 3-column bento cards (01 · Lote, 02 · SMS, 03 · Escudo) with accessible labels and zero emojis', () => {
    const { fixture } = setup({ blacklistedCount: 5 });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent ?? '').not.toMatch(EMOJI_PATTERN);
    expect(host.querySelectorAll('.ocr-content-card').length).toBe(3);
    expect(host.textContent).toContain('01 · Lote');
    expect(host.textContent).toContain('02 · SMS');
    expect(host.textContent).toContain('03 · Escudo');
    expect(host.textContent).toContain('Ctrl+V');

    const fileInput = host.querySelector('[data-testid="ocr-file-input"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.multiple).toBe(true);
    expect(fileInput.accept).toBe('image/*');

    expect(host.querySelector('label[for="ocr-manual-sms"]')).toBeTruthy();
    expect(host.querySelector('label[for="ocr-expected-counterparty"]')).toBeTruthy();
    expect(host.querySelector('label[for="ocr-expected-id"]')).toBeTruthy();
    expect(host.querySelector('label[for="ocr-expected-amount"]')).toBeTruthy();

    const badge = host.querySelector('[data-testid="ocr-blacklist-badge"]') as HTMLElement;
    expect(badge.textContent).toContain('Lista Negra Activa (5 registros)');
  });

  it('emits filesSelected with multiple files from file input change and drag-and-drop', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const emitted: File[][] = [];
    component.filesSelected.subscribe((files) => emitted.push(files));

    const f1 = new File(['a'], 'receipt-1.png', { type: 'image/png' });
    const f2 = new File(['b'], 'receipt-2.jpg', { type: 'image/jpeg' });

    const fileInput = host.querySelector('[data-testid="ocr-file-input"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [f1, f2],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));
    expect(emitted.length).toBe(1);
    expect(emitted[0].map((f) => f.name)).toEqual(['receipt-1.png', 'receipt-2.jpg']);

    const dropzone = host.querySelector('[data-testid="ocr-dropzone"]') as HTMLButtonElement;
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [f2, f1] },
    });
    dropzone.dispatchEvent(dropEvent);
    expect(emitted.length).toBe(2);
    expect(emitted[1].map((f) => f.name)).toEqual(['receipt-2.jpg', 'receipt-1.png']);
  });

  it('shows Screen Pipe quick button only when hasScreenPipe is true and emits screenPipeRequested', () => {
    const { fixture, component } = setup({ hasScreenPipe: false });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="ocr-bento-screen-pipe"]')).toBeNull();

    fixture.componentRef.setInput('hasScreenPipe', true);
    fixture.detectChanges();

    let requested = 0;
    component.screenPipeRequested.subscribe(() => requested++);
    const spBtn = host.querySelector('[data-testid="ocr-bento-screen-pipe"]') as HTMLButtonElement;
    expect(spBtn).toBeTruthy();
    spBtn.click();
    expect(requested).toBe(1);
  });

  it('renders live batchProgress bar when active', () => {
    const { fixture } = setup({
      batchProgress: {
        active: true,
        currentIndex: 2,
        totalFiles: 5,
        progressPct: 40,
        statusLabel: 'Analizando comprobante 2 de 5...',
      },
    });
    const host = fixture.nativeElement as HTMLElement;

    const progressEl = host.querySelector('[data-testid="ocr-batch-progress"]') as HTMLElement;
    expect(progressEl).toBeTruthy();
    expect(progressEl.textContent).toContain('2 / 5');
    expect(progressEl.textContent).toContain('40%');
    expect(progressEl.textContent).toContain('Analizando comprobante 2 de 5...');
  });

  it('submits trimmed SMS text via manualTextSubmitted and clears textarea', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const submitted: string[] = [];
    component.manualTextSubmitted.subscribe((text) => submitted.push(text));

    const submitBtn = host.querySelector('[data-testid="ocr-submit-sms"]') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    const textarea = host.querySelector('#ocr-manual-sms') as HTMLTextAreaElement;
    textarea.value = '  BDV Pago Movil Bs. 1200,00 ref 99887766  ';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(submitBtn.disabled).toBe(false);
    submitBtn.click();
    fixture.detectChanges();

    expect(submitted).toEqual(['BDV Pago Movil Bs. 1200,00 ref 99887766']);
    expect(textarea.value).toBe('');
  });

  it('renders counterparty datalist suggestions and emits identityCheckChange on edits', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const options = host.querySelectorAll('#ocr-counterparty-suggestions option');
    expect(options.length).toBe(2);

    const emitted: OcrIdentityCrossCheck[] = [];
    component.identityCheckChange.subscribe((next) => emitted.push(next));

    const nameInput = host.querySelector('#ocr-expected-counterparty') as HTMLInputElement;
    nameInput.value = 'Carlos Mendoza';
    nameInput.dispatchEvent(new Event('input'));

    expect(emitted.at(-1)).toEqual({
      expectedCounterparty: 'Carlos Mendoza',
      expectedId: 'V-19442011',
      expectedAmount: null,
    });

    const amountInput = host.querySelector('#ocr-expected-amount') as HTMLInputElement;
    amountInput.value = '250.50';
    amountInput.dispatchEvent(new Event('input'));
    expect(emitted.at(-1)?.expectedAmount).toBe(250.5);
  });
});
