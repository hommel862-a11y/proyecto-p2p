import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { BankReceiptRecord, FraudShieldAuditResult } from '@p2p/core';
import type { OcrDestinationMode } from '../../ocr-ui.models';
import { OcrForensicInspectorComponent } from './ocr-forensic-inspector.component';

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

const SAMPLE_RECEIPT: BankReceiptRecord = {
  id: 'rcpt-001',
  reference: '004829173645',
  amount: 4500.5,
  currency: 'VES',
  bank: 'BANESCO',
  bankDisplayName: 'Banesco Banco Universal',
  payerName: 'Carlos Eduardo Perez',
  payerId: 'V-19842310',
  beneficiaryName: 'Inversiones Finanzas 360 CA',
  timestamp: '2026-11-23 10:15',
  rawText: 'BANESCO PAGO MOVIL REF 004829173645 MONTO BS 4.500,50',
  confidenceScore: 0.94,
};

const SAMPLE_AUDIT_CRITICAL: FraudShieldAuditResult = {
  orderId: 'ORD-9921',
  overallScore: 86,
  riskLevel: 'CRITICAL',
  recommendation: 'LOCK_AND_DISPUTE',
  flags: ['BLACKLISTED_ENTITY', 'THIRD_PARTY_PAYER', 'AMOUNT_MISMATCH'],
  nameMatch: {
    score: 0.32,
    isMatch: false,
    normalizedA: 'CARLOS EDUARDO PEREZ',
    normalizedB: 'MARIA GOMEZ',
    matchedTokens: [],
    missingTokens: ['MARIA', 'GOMEZ'],
  },
  referenceValidation: {
    isValid: true,
    bank: 'BANESCO',
    reference: '004829173645',
    expectedFormat: '10-12 dígitos',
  },
  amountDifference: 25.5,
  summaryHeadline: 'Alerta crítica: entidad en lista negra y pago de tercero detectado',
  auditDetails: ['Coincidencia en lista negra local'],
  disputeTemplateText: 'Dispute dossier text',
};

const SAMPLE_AUDIT_SAFE: FraudShieldAuditResult = {
  orderId: 'ORD-1002',
  overallScore: 6,
  riskLevel: 'SAFE',
  recommendation: 'AUTO_RELEASE_OK',
  flags: [],
  nameMatch: {
    score: 0.98,
    isMatch: true,
    normalizedA: 'CARLOS EDUARDO PEREZ',
    normalizedB: 'CARLOS PEREZ',
    matchedTokens: ['CARLOS', 'PEREZ'],
    missingTokens: [],
  },
  referenceValidation: {
    isValid: true,
    bank: 'BANESCO',
    reference: '004829173645',
    expectedFormat: '10-12 dígitos',
  },
  amountDifference: 0,
  summaryHeadline: 'Comprobante verificado sin alertas forenses',
  auditDetails: [],
  disputeTemplateText: '',
};

describe('OcrForensicInspectorComponent', () => {
  let fixture: ComponentFixture<OcrForensicInspectorComponent>;
  let component: OcrForensicInspectorComponent;

  const setup = (
    overrides: Partial<{
      receipt: BankReceiptRecord;
      audit: FraudShieldAuditResult | null;
      thumbnailDataUrl: string | null;
      imageHash: string | null;
      destinationMode: OcrDestinationMode;
      isSettled: boolean;
      isDriveBackedUp: boolean;
      isBackingUpDrive: boolean;
      casheaMatchLabel: string | null;
    }> = {},
  ) => {
    TestBed.configureTestingModule({
      imports: [OcrForensicInspectorComponent],
    });

    fixture = TestBed.createComponent(OcrForensicInspectorComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('receipt', overrides.receipt ?? SAMPLE_RECEIPT);
    fixture.componentRef.setInput(
      'audit',
      overrides.audit !== undefined ? overrides.audit : SAMPLE_AUDIT_CRITICAL,
    );
    fixture.componentRef.setInput(
      'thumbnailDataUrl',
      overrides.thumbnailDataUrl !== undefined
        ? overrides.thumbnailDataUrl
        : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );
    fixture.componentRef.setInput(
      'imageHash',
      overrides.imageHash !== undefined
        ? overrides.imageHash
        : 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    );
    fixture.componentRef.setInput('destinationMode', overrides.destinationMode ?? 'p2p');
    fixture.componentRef.setInput('isSettled', overrides.isSettled ?? false);
    fixture.componentRef.setInput('isDriveBackedUp', overrides.isDriveBackedUp ?? false);
    fixture.componentRef.setInput('isBackingUpDrive', overrides.isBackingUpDrive ?? false);
    fixture.componentRef.setInput('casheaMatchLabel', overrides.casheaMatchLabel ?? null);

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders accessible split-view dialog, semantic backdrop button, zero emojis, and hybrid engine footer with SHA-256 chip', () => {
    const { fixture } = setup({ casheaMatchLabel: 'Match Cuota #2 · Taladro Bosch' });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent ?? '').not.toMatch(EMOJI_PATTERN);
    expect(host.querySelector('button.ocr-modal-backdrop[type="button"]')).toBeTruthy();
    expect(host.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();
    expect(host.textContent).toContain('Motor Híbrido: Canvas 2x + Tesseract + Visión IA');
    expect(host.textContent).toContain('SHA-256');
    expect(host.textContent).toContain('a1b2c3d4');
    expect(host.textContent).toContain('Match Cuota #2 · Taladro Bosch');

    const labels = Array.from(host.querySelectorAll('label[for]'));
    expect(labels.length).toBeGreaterThanOrEqual(8);
    for (const label of labels) {
      const targetId = label.getAttribute('for');
      expect(targetId).toBeTruthy();
      expect(host.querySelector(`#${targetId}`)).toBeTruthy();
    }
  });

  it('controls zoom (100/150/200%), +90deg rotation, auto-contrast, and dark-invert filters on the receipt image', () => {
    const { fixture } = setup();
    const host = fixture.nativeElement as HTMLElement;
    const img = host.querySelector('[data-testid="ocr-inspector-image"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.style.transform).toContain('scale(1)');
    expect(img.style.transform).toContain('rotate(0deg)');

    (host.querySelector('[data-testid="ocr-zoom-150"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(img.style.transform).toContain('scale(1.5)');

    (host.querySelector('[data-testid="ocr-zoom-200"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(img.style.transform).toContain('scale(2)');

    const rotateBtn = host.querySelector('[data-testid="ocr-rotate-btn"]') as HTMLButtonElement;
    rotateBtn.click();
    fixture.detectChanges();
    expect(img.style.transform).toContain('rotate(90deg)');

    rotateBtn.click();
    rotateBtn.click();
    rotateBtn.click();
    fixture.detectChanges();
    expect(img.style.transform).toContain('rotate(0deg)');

    const contrastBtn = host.querySelector('[data-testid="ocr-contrast-btn"]') as HTMLButtonElement;
    contrastBtn.click();
    fixture.detectChanges();
    expect(img.style.filter).toContain('contrast(1.35) brightness(1.05)');

    const invertBtn = host.querySelector('[data-testid="ocr-invert-btn"]') as HTMLButtonElement;
    invertBtn.click();
    fixture.detectChanges();
    expect(img.style.filter).toContain('contrast(1.35) brightness(1.05)');
    expect(img.style.filter).toContain('invert(1) hue-rotate(180deg)');
  });

  it('renders monospace rawText fallback card when thumbnailDataUrl is null', () => {
    const { fixture } = setup({ thumbnailDataUrl: null, imageHash: null });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="ocr-inspector-image"]')).toBeNull();
    const rawCard = host.querySelector('[data-testid="ocr-raw-text-fallback"]');
    expect(rawCard).toBeTruthy();
    expect(rawCard?.textContent).toContain(SAMPLE_RECEIPT.rawText);
    expect(host.querySelector('[data-testid="ocr-sha256-chip"]')).toBeNull();
  });

  it('renders forensic risk verdict card with score, headline, flag pills, and 3 check tiles', () => {
    const { fixture } = setup({ audit: SAMPLE_AUDIT_CRITICAL });
    const host = fixture.nativeElement as HTMLElement;

    const verdictCard = host.querySelector('[data-testid="ocr-verdict-card"]');
    expect(verdictCard?.classList.contains('tone-danger')).toBe(true);
    expect(verdictCard?.textContent).toContain('86');
    expect(verdictCard?.textContent).toContain(SAMPLE_AUDIT_CRITICAL.summaryHeadline);
    expect(host.querySelector('[data-flag="BLACKLISTED_ENTITY"]')).toBeTruthy();
    expect(host.querySelector('[data-flag="THIRD_PARTY_PAYER"]')).toBeTruthy();
    expect(host.textContent).toContain('32%');
    expect(host.textContent).toContain('25.50');

    fixture.componentRef.setInput('audit', SAMPLE_AUDIT_SAFE);
    fixture.detectChanges();
    expect(verdictCard?.classList.contains('tone-emerald')).toBe(true);
    expect(verdictCard?.textContent).toContain('98%');
  });

  it('exposes all 21 BankType options, 5 currencies, emits receiptUpdated on every field edit, and syncs on new receipt input', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const bankSelect = host.querySelector('#ocr-insp-bank') as HTMLSelectElement;
    expect(bankSelect.options.length).toBe(21);
    const bankValues = Array.from(bankSelect.options).map((opt) => opt.value);
    expect(bankValues).toContain('ZELLE');
    expect(bankValues).toContain('WALLY');
    expect(bankValues).toContain('BINANCE_PAY');
    expect(bankValues).toContain('CASHEA');
    expect(bankValues).toContain('FACEBANK');
    expect(bankValues).toContain('BANESCO_PANAMA');
    expect(bankValues).toContain('MERCANTIL_PANAMA');
    expect(bankValues).toContain('PAGO_MOVIL_C2P');

    const currencySelect = host.querySelector('#ocr-insp-currency') as HTMLSelectElement;
    const currencies = Array.from(currencySelect.options).map((opt) => opt.value);
    expect(currencies).toEqual(['VES', 'USD', 'USDT', 'EUR', 'COP']);

    const updates: BankReceiptRecord[] = [];
    component.receiptUpdated.subscribe((rec) => updates.push(rec));

    bankSelect.value = 'ZELLE';
    bankSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(updates[updates.length - 1].bank).toBe('ZELLE');
    expect(updates[updates.length - 1].bankDisplayName).toBe('Zelle');

    const refInput = host.querySelector('#ocr-insp-reference') as HTMLInputElement;
    refInput.value = 'ZLL-99887766';
    refInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(updates[updates.length - 1].reference).toBe('ZLL-99887766');

    const amountInput = host.querySelector('#ocr-insp-amount') as HTMLInputElement;
    amountInput.value = '125.75';
    amountInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(updates[updates.length - 1].amount).toBe(125.75);

    const payerInput = host.querySelector('#ocr-insp-payer-name') as HTMLInputElement;
    payerInput.value = 'Maria Gomez';
    payerInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(updates[updates.length - 1].payerName).toBe('Maria Gomez');

    const newReceipt: BankReceiptRecord = {
      ...SAMPLE_RECEIPT,
      id: 'rcpt-002',
      reference: '999000111222',
      bank: 'CASHEA',
      bankDisplayName: 'Cashea',
    };
    fixture.componentRef.setInput('receipt', newReceipt);
    fixture.detectChanges();
    expect(component.draftReceipt().id).toBe('rcpt-002');
    expect(component.draftReceipt().reference).toBe('999000111222');
  });

  it('emits dossier, warning, refund, PDF, Drive, settle, and close outputs properly', () => {
    const { fixture, component } = setup({ destinationMode: 'finance360' });
    const host = fixture.nativeElement as HTMLElement;

    const events: string[] = [];
    component.copyDossierEs.subscribe(() => events.push('es'));
    component.copyDossierEn.subscribe(() => events.push('en'));
    component.copyChatWarning.subscribe(() => events.push('warn'));
    component.copyRefundInstructions.subscribe(() => events.push('refund'));
    component.generatePdfReceipt.subscribe(() => events.push('pdf'));
    component.backupToDrive.subscribe(() => events.push('drive'));
    component.settleRequested.subscribe((payload) => events.push(`settle:${payload.mode}`));
    component.closed.subscribe(() => events.push('closed'));

    (host.querySelector('[data-testid="ocr-btn-dossier-es"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="ocr-btn-dossier-en"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="ocr-btn-chat-warning"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="ocr-btn-refund"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="ocr-btn-pdf"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="ocr-btn-drive"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="ocr-btn-settle"]') as HTMLButtonElement).click();

    expect(events).toEqual([
      'es',
      'en',
      'warn',
      'refund',
      'pdf',
      'drive',
      'settle:finance360',
    ]);

    fixture.componentRef.setInput('isSettled', true);
    fixture.componentRef.setInput('isDriveBackedUp', true);
    fixture.detectChanges();

    const settleBtn = host.querySelector('[data-testid="ocr-btn-settle"]') as HTMLButtonElement;
    expect(settleBtn.disabled).toBe(true);
    expect(settleBtn.textContent).toContain('Ya Asentado');

    const driveBtn = host.querySelector('[data-testid="ocr-btn-drive"]') as HTMLButtonElement;
    expect(driveBtn.disabled).toBe(true);
    expect(driveBtn.textContent).toContain('En Drive');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    (host.querySelector('button.ocr-modal-backdrop') as HTMLButtonElement).click();
    expect(events.filter((e) => e === 'closed').length).toBe(2);
  });
});
