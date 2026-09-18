import { Component, signal, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  parseBankReceiptText,
  exportReceiptsToCSV,
  evaluateFraudRisk,
  buildDisputeDossier,
  type FraudShieldAuditResult,
  type BankReceiptRecord,
  type Operation,
  type DisputeDossier,
} from '@p2p/core';
import { StorageService } from '../../core/storage';
import { ToastService } from '../../core/toast.service';
import { AccountsService } from '../../core/accounts.service';
import Tesseract from 'tesseract.js';

const OPS_KEY = 'p2p.operations';

@Component({
  selector: 'app-receipt-scanner',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './receipt-scanner.html',
  styleUrls: ['./receipt-scanner.scss'],
})
export class ReceiptScanner {
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);
  private readonly accountsService = inject(AccountsService);

  readonly isProcessing = signal<boolean>(false);
  readonly progressPct = signal<number>(0);
  readonly progressStatus = signal<string>('');

  readonly manualTextInput = signal<string>('');
  readonly receipts = signal<BankReceiptRecord[]>([]);
  readonly receiptAudits = signal<Map<string, FraudShieldAuditResult>>(new Map());
  readonly selectedAudit = signal<FraudShieldAuditResult | null>(null);

  readonly expectedCounterparty = signal<string>('');
  readonly expectedId = signal<string>('');
  readonly expectedAmount = signal<number | null>(null);
  readonly isDragging = signal<boolean>(false);
  readonly hasScreenPipe = signal<boolean>(
    typeof window !== 'undefined' &&
      !!(window as unknown as { electron?: { screenPipe?: unknown } }).electron?.screenPipe,
  );

  /**
   * Listen for clipboard paste (Ctrl+V) across the window.
   * If an image is pasted, immediately run OCR.
   * If text is pasted, parse it as receipt text.
   */
  @HostListener('window:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          this.processImageFile(file);
          return;
        }
      }
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        this.processImageFile(file);
      } else {
        this.toast.error('Por favor suelta un archivo de imagen (PNG, JPG, WebP).');
      }
    }
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.processImageFile(input.files[0]);
    }
  }

  async processImageFile(file: File): Promise<void> {
    this.isProcessing.set(true);
    this.progressPct.set(10);
    this.progressStatus.set('Inicializando OCR en segundo plano...');

    try {
      const result = await Tesseract.recognize(file, 'spa+eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            this.progressPct.set(Math.round((m.progress || 0) * 100));
            this.progressStatus.set(`Extrayendo texto del comprobante: ${this.progressPct()}%`);
          }
        },
      });

      const extractedText = result.data.text;
      if (!extractedText || extractedText.trim().length === 0) {
        this.toast.error('No se pudo detectar texto legible en la imagen.');
        return;
      }

      this.ingestReceiptText(extractedText);
      this.toast.success('Comprobante analizado con éxito.');
    } catch {
      this.toast.error('Error al ejecutar el reconocimiento OCR local.');
    } finally {
      this.isProcessing.set(false);
      this.progressPct.set(0);
      this.progressStatus.set('');
    }
  }

  async captureWithScreenPipe(): Promise<void> {
    const electron = (
      window as unknown as {
        electron?: {
          screenPipe?: {
            capture: (
              sourceId?: string,
            ) => Promise<{ dataUrl: string; timestampMs: number } | null>;
          };
        };
      }
    ).electron;

    if (!electron?.screenPipe) {
      this.toast.warn(
        'La captura Screen Pipe solo está disponible en el ejecutable de escritorio Electron.',
      );
      return;
    }

    this.isProcessing.set(true);
    this.progressPct.set(15);
    this.progressStatus.set('Capturando pantalla en tiempo real (Screen Pipe)...');

    try {
      const captureResult = await electron.screenPipe.capture();
      if (!captureResult?.dataUrl) {
        this.toast.error('No se pudo capturar la pantalla. Verifica los permisos.');
        return;
      }

      this.progressPct.set(35);
      this.progressStatus.set('Procesando OCR local de alta resolución...');

      const result = await Tesseract.recognize(captureResult.dataUrl, 'spa+eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            this.progressPct.set(35 + Math.round((m.progress || 0) * 65));
            this.progressStatus.set(`Extrayendo texto del comprobante: ${this.progressPct()}%`);
          }
        },
      });

      const extractedText = result.data.text;
      if (!extractedText || extractedText.trim().length === 0) {
        this.toast.error('No se detectó texto legible en la captura de pantalla.');
        return;
      }

      this.ingestReceiptText(extractedText);
      this.toast.success('⚡ Comprobante capturado e indexado vía Screen Pipe.');
    } catch {
      this.toast.error('Error al ejecutar el flujo Screen Pipe.');
    } finally {
      this.isProcessing.set(false);
      this.progressPct.set(0);
      this.progressStatus.set('');
    }
  }

  processManualText(): void {
    const text = this.manualTextInput().trim();
    if (!text) {
      this.toast.warn('Ingresa el texto o mensaje del comprobante bancario.');
      return;
    }

    this.ingestReceiptText(text);
    this.manualTextInput.set('');
    this.toast.success('Texto bancario procesado correctamente.');
  }

  private ingestReceiptText(text: string): void {
    const currentOps: Operation[] = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    const knownRefs = currentOps
      .map((o: Operation) => {
        const match = (o.notes + ' ' + o.merchantNote).match(
          /(?:ref|comprobante|id|#)[:\s#]*([A-Za-z0-9-]+)/i,
        );
        return match ? match[1] : '';
      })
      .filter((r: string) => r.length > 0);

    const parsed = parseBankReceiptText(text, {
      knownReferences: knownRefs,
      expectedCounterpartyName: this.expectedCounterparty().trim() || undefined,
    });

    const audit = evaluateFraudRisk({
      orderId: `ORD-${Date.now().toString().slice(-6)}`,
      orderAmount: this.expectedAmount() || parsed.amount,
      orderCurrency: (parsed.currency as 'VES' | 'COP' | 'USD') || 'VES',
      advertiserVerifiedName:
        this.expectedCounterparty().trim() || parsed.payerName || 'Contraparte Binance',
      advertiserIdDocument: this.expectedId().trim() || undefined,
      receipt: parsed,
      knownReferences: knownRefs,
    });

    this.receipts.update((list) => [parsed, ...list]);
    this.receiptAudits.update((map) => {
      const next = new Map(map);
      next.set(parsed.id, audit);
      return next;
    });
  }

  recomputeAudits(): void {
    const currentOps: Operation[] = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    const knownRefs = currentOps
      .map((o: Operation) => {
        const match = (o.notes + ' ' + o.merchantNote).match(
          /(?:ref|comprobante|id|#)[:\s#]*([A-Za-z0-9-]+)/i,
        );
        return match ? match[1] : '';
      })
      .filter((r: string) => r.length > 0);

    const audits = new Map<string, FraudShieldAuditResult>();
    for (const r of this.receipts()) {
      const audit = evaluateFraudRisk({
        orderId: `ORD-${r.id.slice(-6)}`,
        orderAmount: this.expectedAmount() || r.amount,
        orderCurrency: (r.currency as 'VES' | 'COP' | 'USD') || 'VES',
        advertiserVerifiedName:
          this.expectedCounterparty().trim() || r.payerName || 'Contraparte Binance',
        advertiserIdDocument: this.expectedId().trim() || undefined,
        receipt: r,
        knownReferences: knownRefs,
      });
      audits.set(r.id, audit);
    }
    this.receiptAudits.set(audits);
  }

  getDossierForAudit(audit: FraudShieldAuditResult): DisputeDossier | null {
    const rec = this.receipts().find((r) => audit.orderId.endsWith(r.id.slice(-6)));
    if (!rec) return null;
    return buildDisputeDossier({
      orderId: audit.orderId,
      orderAmountFiat: rec.amount,
      orderAmountCrypto: 0,
      fiatCurrency: rec.currency || 'VES',
      cryptoAsset: 'USDT',
      counterpartyBinanceName: audit.nameMatch.normalizedB || 'Contraparte',
      counterpartyBinanceIdDoc: rec.payerId || undefined,
      bankPayerName: rec.payerName || undefined,
      bankPayerIdDoc: rec.payerId || undefined,
      bankName: rec.bankDisplayName,
      bankReference: rec.reference,
      bankPaymentTimestamp: rec.timestamp ? new Date(rec.timestamp).getTime() : Date.now(),
      orderCreatedTimestamp: Date.now() - 300000,
      fraudAudit: audit,
    });
  }

  copyDisputeClaim(audit: FraudShieldAuditResult): void {
    if (!audit.disputeTemplateText) return;
    navigator.clipboard
      .writeText(audit.disputeTemplateText)
      .then(() => {
        this.toast.success(
          '📋 Reclamo formal copiado. Listo para pegar en el soporte de Binance/Bybit.',
        );
      })
      .catch(() => {
        this.toast.error('No se pudo copiar el texto al portapapeles.');
      });
  }

  copyDossierEs(audit: FraudShieldAuditResult): void {
    const dossier = this.getDossierForAudit(audit);
    const text = dossier ? dossier.appealTextEs : audit.disputeTemplateText;
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => this.toast.success('📋 Expediente formal de arbitraje (Español) copiado.'))
      .catch(() => this.toast.error('Error al copiar al portapapeles.'));
  }

  copyDossierEn(audit: FraudShieldAuditResult): void {
    const dossier = this.getDossierForAudit(audit);
    if (!dossier) return;
    navigator.clipboard
      .writeText(dossier.appealTextEn)
      .then(() => this.toast.success('📋 Formal Arbitration Appeal Dossier (English) copied.'))
      .catch(() => this.toast.error('Error copying to clipboard.'));
  }

  copyChatWarning(audit: FraudShieldAuditResult): void {
    const dossier = this.getDossierForAudit(audit);
    if (!dossier) return;
    navigator.clipboard
      .writeText(dossier.chatResponses.thirdPartyWarning)
      .then(() => this.toast.success('💬 Mensaje de advertencia para el chat copiado.'))
      .catch(() => this.toast.error('Error al copiar al portapapeles.'));
  }

  copyRefundInstructions(audit: FraudShieldAuditResult): void {
    const dossier = this.getDossierForAudit(audit);
    if (!dossier) return;
    navigator.clipboard
      .writeText(dossier.chatResponses.refundInstructions)
      .then(() => this.toast.success('💸 Instrucciones de devolución y cancelación copiadas.'))
      .catch(() => this.toast.error('Error al copiar al portapapeles.'));
  }

  removeReceipt(id: string): void {
    this.receipts.update((list) => list.filter((r) => r.id !== id));
    this.receiptAudits.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
    if (this.selectedAudit()?.orderId.endsWith(id.slice(-6))) {
      this.selectedAudit.set(null);
    }
  }

  clearReceipts(): void {
    this.receipts.set([]);
    this.receiptAudits.set(new Map());
    this.selectedAudit.set(null);
  }

  exportToExcel(): void {
    const list = this.receipts();
    if (list.length === 0) {
      this.toast.warn('No hay comprobantes para exportar.');
      return;
    }

    try {
      const csv = exportReceiptsToCSV(list);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comprobantes_p2p_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this.toast.success('Archivo Excel (CSV UTF-8) descargado.');
    } catch {
      this.toast.error('Error al generar la descarga del archivo Excel.');
    }
  }

  settleToLedger(record: BankReceiptRecord): void {
    try {
      const now = new Date().toISOString();
      const newOp: Operation = {
        id: crypto.randomUUID(),
        timestamp: now,
        type: record.currency === 'VES' ? 'sell' : 'buy',
        pair: 'USDT',
        vesAmount: record.currency === 'VES' ? record.amount : 0,
        usdtAmount: record.currency === 'USD' ? record.amount : 0,
        price: 0,
        merchantNote: `Comprobante ${record.bankDisplayName} Ref: ${record.reference}`,
        fees: 0,
        notes: `[Comprobante OCR] ${record.payerName ? 'Pagador: ' + record.payerName : ''} ${record.payerId ? '(' + record.payerId + ')' : ''} | Beneficiario: ${record.beneficiaryName || 'N/A'}`,
        errorFree: !record.antiTriangulationAlert && !record.isDuplicate,
      };

      const currentOps: Operation[] = this.storage.get<Operation[]>(OPS_KEY) ?? [];
      this.storage.set(OPS_KEY, [newOp, ...currentOps]);
      this.accountsService.refreshLedger();

      this.toast.success(`⚡ Comprobante Ref #${record.reference} asentado en la Bitácora.`);
    } catch {
      this.toast.error('Error al asentar el comprobante en la bitácora.');
    }
  }
}
