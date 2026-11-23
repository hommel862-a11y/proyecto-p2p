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
import { CounterpartyService } from '../../core/counterparty.service';
import { CotizaveService } from '../../core/cotizave.service';
import { Finance360Service } from '../../core/finance-360.service';
import {
  FinanceAiIngestorService,
  type ParsedFinancialDocument,
} from '../../core/services/finance-ai-ingestor.service';
import { CashReceiptGeneratorService } from '../../core/services/cash-receipt-generator.service';
import {
  addCalendarDays,
  computeTriMonetaryAmount,
  roundMoney,
  todayVetIso,
  type CurrencyCode,
  type FinanceScope,
  type ExpenseCategory,
  type IncomeCategory,
  type PaymentChannel,
} from '../../core/models/finance-360.models';
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
  private readonly counterpartyService = inject(CounterpartyService, { optional: true });
  private readonly cotizaveService = inject(CotizaveService);
  readonly finance360Service = inject(Finance360Service);
  private readonly aiIngestor = inject(FinanceAiIngestorService);
  private readonly cashReceiptService = inject(CashReceiptGeneratorService);

  /** Router destination: 'p2p' (Arbitrage Desk) vs 'finance360' (Isolated 360 Portfolio) */
  readonly destinationMode = signal<'p2p' | 'finance360'>('p2p');

  /** Finance 360 routing options */
  readonly financeScope = signal<FinanceScope>('personal');
  readonly financePillar = signal<'expense' | 'income' | 'liability'>('expense');
  readonly financeExpenseCategory = signal<ExpenseCategory>('groceries');
  readonly financeIncomeCategory = signal<IncomeCategory>('business_sale');
  readonly selectedVaultId = signal<string>('');

  readonly isProcessing = signal<boolean>(false);
  readonly progressPct = signal<number>(0);
  readonly progressStatus = signal<string>('');

  readonly manualTextInput = signal<string>('');
  readonly receipts = signal<BankReceiptRecord[]>([]);
  readonly receiptAudits = signal<Map<string, FraudShieldAuditResult>>(new Map());
  readonly aiMetadataByReceiptId = signal<Map<string, ParsedFinancialDocument>>(new Map());
  readonly settledReceiptIds = signal<Set<string>>(new Set());
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
    this.progressStatus.set('Inicializando OCR y Visión IA...');

    try {
      // 1. Local OCR extraction via Tesseract
      const result = await Tesseract.recognize(file, 'spa+eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            this.progressPct.set(Math.round((m.progress || 0) * 80));
            this.progressStatus.set(`Extrayendo texto del comprobante: ${this.progressPct()}%`);
          }
        },
      });

      const extractedText = result.data.text || '';

      // 2. Multimodal AI Analysis with Gemini if destination is finance 360 or if possible
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      const base64 = await base64Promise;

      const base64Clean = base64.includes(',') ? base64.split(',')[1] : base64;

      this.progressPct.set(90);
      this.progressStatus.set('Analizando con IA Multimodal...');

      const aiResult = await this.aiIngestor.analyzeReceiptImage(
        base64Clean,
        file.type || 'image/jpeg',
        extractedText,
      );

      // Auto-prefill 360 categories if suggested by AI
      if (aiResult) {
        if (aiResult.isCashea) {
          this.destinationMode.set('finance360');
          this.financeScope.set('personal');
          this.financePillar.set('expense');
          this.financeExpenseCategory.set('cashea_installment');
        } else if (aiResult.scope) {
          this.financeScope.set(aiResult.scope === 'all' ? 'personal' : aiResult.scope);
          this.financePillar.set(aiResult.pillar);
          if (aiResult.pillar === 'income' && aiResult.incomeCategory) {
            this.financeIncomeCategory.set(aiResult.incomeCategory);
          } else if (aiResult.expenseCategory) {
            this.financeExpenseCategory.set(aiResult.expenseCategory);
          }
        }
      }

      this.ingestReceiptText(extractedText, aiResult);
      this.toast.success('Comprobante digitalizado y analizado con éxito.');
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

  private ingestReceiptText(text: string, aiMeta?: ParsedFinancialDocument | null): void {
    const currentOps: Operation[] = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    const knownRefs = currentOps
      .map((o: Operation) => {
        const match = (o.notes + ' ' + o.merchantNote).match(
          /(?:ref|comprobante|id|#)[:\s#]*([A-Za-z0-9-]+)/i,
        );
        return match ? match[1] : '';
      })
      .filter((r: string) => r.length > 0);

    const parsedBase = parseBankReceiptText(text, {
      knownReferences: knownRefs,
      expectedCounterpartyName: this.expectedCounterparty().trim() || undefined,
    });

    const mergedAmount =
      (!parsedBase.amount || parsedBase.amount <= 0) && aiMeta && aiMeta.amount > 0
        ? aiMeta.amount
        : parsedBase.amount;
    const isSyntheticRef =
      !parsedBase.reference ||
      parsedBase.reference === 'N/A' ||
      parsedBase.reference === 'SIN-REF' ||
      /^REF-\d{6}$/.test(parsedBase.reference);
    const mergedReference =
      isSyntheticRef && aiMeta?.referenceNumber ? aiMeta.referenceNumber : parsedBase.reference;
    const mergedCurrency: BankReceiptRecord['currency'] =
      aiMeta?.currency === 'USD' || aiMeta?.currency === 'VES'
        ? aiMeta.currency
        : parsedBase.currency;
    const mergedBeneficiary = parsedBase.beneficiaryName || aiMeta?.entityName || undefined;

    const parsed: BankReceiptRecord = {
      ...parsedBase,
      amount: mergedAmount,
      reference: mergedReference,
      currency: mergedCurrency,
      beneficiaryName: mergedBeneficiary,
    };

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
    if (aiMeta) {
      this.aiMetadataByReceiptId.update((map) => {
        const next = new Map(map);
        next.set(parsed.id, aiMeta);
        return next;
      });
    }
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
    this.aiMetadataByReceiptId.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
    this.settledReceiptIds.update((set) => {
      const next = new Set(set);
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
    this.aiMetadataByReceiptId.set(new Map());
    this.settledReceiptIds.set(new Set());
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

  /**
   * Settles a parsed bank receipt to the P2P operation ledger with bank/counterparty matching.
   */
  settleToLedger(record: BankReceiptRecord): void {
    try {
      const now = new Date().toISOString();
      const activeAccounts = this.accountsService
        .accounts()
        .filter((a) => a.bankCode === record.bank && a.status !== 'DISABLED');
      const prefersMobile = /pago\s*m[oó]vil|pagomovil/i.test(record.rawText || '');
      const matchedAccount =
        activeAccounts.find((a) =>
          prefersMobile ? a.rail === 'PAGO_MOVIL' : a.rail === 'TRANSFERENCIA',
        ) ?? activeAccounts[0];

      const matchedCounterparty =
        (record.payerId ? this.counterpartyService?.findByQuery(record.payerId) : undefined) ??
        (record.payerName ? this.counterpartyService?.findByQuery(record.payerName) : undefined);

      let liveRate = 0;
      if (this.cotizaveService.ratesProvenance() !== 'none') {
        const rates = this.cotizaveService.ratesByMarket();
        for (const key of ['binance', 'parallel', 'oficial']) {
          const entry = rates[key];
          if (!entry) continue;
          const candidate =
            entry.mid && entry.mid > 0
              ? entry.mid
              : entry.ask && entry.bid
                ? (entry.ask + entry.bid) / 2
                : entry.ask || entry.bid || 0;
          if (candidate > 0) {
            liveRate = Math.round(candidate * 100) / 100;
            break;
          }
        }
      }

      const vesAmount =
        record.currency === 'VES'
          ? record.amount
          : liveRate > 0
            ? Math.round(record.amount * liveRate * 100) / 100
            : 0;
      const usdtAmount =
        record.currency === 'USD'
          ? record.amount
          : liveRate > 0
            ? Math.round((record.amount / liveRate) * 10000) / 10000
            : 0;

      const newOp: Operation = {
        id: crypto.randomUUID(),
        timestamp: now,
        type: record.currency === 'VES' ? 'sell' : 'buy',
        pair: 'USDT',
        vesAmount,
        usdtAmount,
        price: liveRate,
        merchantNote: `Comprobante ${record.bankDisplayName} Ref: ${record.reference}`,
        fees: 0,
        notes: `[Comprobante OCR] ${record.payerName ? 'Pagador: ' + record.payerName : ''} ${record.payerId ? '(' + record.payerId + ')' : ''} | Beneficiario: ${record.beneficiaryName || 'N/A'}`,
        errorFree: !record.antiTriangulationAlert && !record.isDuplicate,
        bankAccountId: matchedAccount?.id,
        counterpartyId: matchedCounterparty?.id,
        payerName: record.payerName,
        receiptReference: record.reference,
      };

      const rawOps = this.storage.get<Operation[]>(OPS_KEY);
      const currentOps: Operation[] = Array.isArray(rawOps) ? rawOps : [];
      this.storage.set(OPS_KEY, [...currentOps, newOp]);
      this.accountsService.refreshLedger();

      this.toast.success(`⚡ Comprobante Ref #${record.reference} asentado en la Mesa P2P.`);
    } catch {
      this.toast.error('Error al asentar el comprobante en la bitácora P2P.');
    }
  }

  /**
   * Settles to Finance 360 Portfolio with live frozen rate, Cashea installment linking,
   * duplicate-settlement protection, and strict isolation from P2P.
   */
  settleToFinance360(
    record: BankReceiptRecord,
    options?: { allowDuplicateOverride?: boolean },
  ): void {
    try {
      const aiMeta = this.aiMetadataByReceiptId().get(record.id);
      const reference = (aiMeta?.referenceNumber || record.reference || '').trim();
      const vaultId = this.selectedVaultId() || undefined;
      const allowDuplicate = Boolean(options?.allowDuplicateOverride);

      if (!allowDuplicate) {
        if (this.settledReceiptIds().has(record.id)) {
          this.toast.warn('Este comprobante ya fue asentado en Finanzas 360.');
          return;
        }
        if (
          reference &&
          reference !== 'N/A' &&
          this.finance360Service.isDuplicateReference(reference, vaultId)
        ) {
          this.toast.warn(
            `La referencia #${reference} ya existe en Finanzas 360. Usa sobrescritura explícita si deseas duplicarla.`,
          );
          return;
        }
      }

      const bcv = this.finance360Service.currentBcvRate();
      const par = this.finance360Service.currentParallelRate();
      const currency = this.resolveFinance360Currency(record, aiMeta);
      const effectiveAmount = record.amount > 0 ? record.amount : (aiMeta?.amount ?? 0);
      const pillar = this.financePillar();
      const scope = this.financeScope();
      const channel: PaymentChannel =
        currency === 'VES' ? 'bs_bank' : currency === 'USDT' ? 'crypto' : 'cash';
      const dateIso =
        aiMeta?.date && /^\d{4}-\d{2}-\d{2}$/.test(aiMeta.date)
          ? aiMeta.date
          : record.timestamp && /^\d{4}-\d{2}-\d{2}/.test(record.timestamp)
            ? record.timestamp.slice(0, 10)
            : todayVetIso();

      const isCashea = Boolean(
        aiMeta?.isCashea ||
          this.financeExpenseCategory() === 'cashea_installment' ||
          /cashea/i.test(record.rawText || ''),
      );

      if (isCashea && pillar === 'expense') {
        const activePlans = (this.finance360Service.state().casheaPlans ?? []).filter(
          (p) => p.status === 'active',
        );
        const searchHaystack =
          `${aiMeta?.title ?? ''} ${aiMeta?.entityName ?? ''} ${record.rawText ?? ''}`.toLowerCase();
        const matchedPlan =
          activePlans.find(
            (p) =>
              searchHaystack.includes(p.productName.toLowerCase()) ||
              searchHaystack.includes(p.storeName.toLowerCase()),
          ) ?? activePlans.find((p) => p.installments.some((inst) => inst.status !== 'paid'));

        if (matchedPlan) {
          const unpaid = matchedPlan.installments.filter((inst) => inst.status !== 'paid');
          const targetInstallment =
            (aiMeta?.casheaInstallmentNumber
              ? unpaid.find((inst) => inst.number === aiMeta.casheaInstallmentNumber)
              : undefined) ??
            unpaid.find((inst) => Math.abs(inst.amountUsd - effectiveAmount) <= 0.5) ??
            unpaid[0];

          if (targetInstallment) {
            this.finance360Service.markCasheaInstallmentPaid(
              matchedPlan.id,
              targetInstallment.number,
              reference || undefined,
              bcv,
              vaultId,
            );
            this.settledReceiptIds.update((set) => new Set(set).add(record.id));
            this.toast.success(
              `Cuota #${targetInstallment.number} de Cashea (${matchedPlan.productName}) conciliada en Finanzas 360.`,
            );
            return;
          }
        }
      }

      const tri = computeTriMonetaryAmount(effectiveAmount, currency, bcv, par);
      const title =
        aiMeta?.title?.trim() ||
        `${record.bankDisplayName}: Ref #${reference || 'N/A'} (${record.payerName || 'Pago recibido'})`;

      if (pillar === 'expense') {
        this.finance360Service.addExpense(
          {
            title,
            scope,
            category: this.financeExpenseCategory(),
            channel,
            vaultId,
            triMonetary: tri,
            date: dateIso,
            referenceNumber: reference || undefined,
            notes: `Asentado desde Scanner OCR. Beneficiario: ${record.beneficiaryName || 'N/A'}`,
          },
          { allowDuplicateRef: allowDuplicate },
        );
        this.toast.success(`Gasto ($${tri.amount_usd} USD) asentado en Finanzas 360.`);
      } else if (pillar === 'income') {
        this.finance360Service.addIncome(
          {
            title,
            scope,
            category: this.financeIncomeCategory(),
            channel,
            vaultId,
            triMonetary: tri,
            date: dateIso,
            referenceNumber: reference || undefined,
            notes: `Asentado desde Scanner OCR. Pagador: ${record.payerName || 'N/A'}`,
          },
          { allowDuplicateRef: allowDuplicate },
        );
        this.toast.success(`Ingreso ($${tri.amount_usd} USD) asentado en Finanzas 360.`);
      } else {
        this.finance360Service.addLiability({
          title,
          creditor: record.beneficiaryName || record.bankDisplayName,
          scope,
          category: 'other',
          triMonetary: tri,
          dueDate: addCalendarDays(dateIso, 14),
          status: 'pending',
          amountPaid: 0,
          remainingAmount: tri.amount_usd,
          notes: 'Factura/Pasivo pendiente asentado desde Scanner.',
        });
        this.toast.success(`Pasivo pendiente ($${tri.amount_usd} USD) agendado a 14 días.`);
      }

      this.settledReceiptIds.update((set) => new Set(set).add(record.id));
    } catch {
      this.toast.error('Error al asentar en el Portafolio 360.');
    }
  }

  private resolveFinance360Currency(
    record: BankReceiptRecord,
    aiMeta?: ParsedFinancialDocument,
  ): CurrencyCode {
    if (aiMeta?.currency && ['USD', 'VES', 'USDT', 'EUR'].includes(aiMeta.currency)) {
      return aiMeta.currency;
    }
    const raw = record.rawText || '';
    if (/\bEUR\b|€/i.test(raw)) return 'EUR';
    if (/\bUSDT\b/i.test(raw)) return 'USDT';
    if (record.currency === 'USD') return 'USD';
    return 'VES';
  }

  /**
   * Generates and prints an internal cash receipt using live BCV rate and configurable business profile.
   */
  generateCashReceipt(record: BankReceiptRecord): void {
    const aiMeta = this.aiMetadataByReceiptId().get(record.id);
    const bcv = this.finance360Service.currentBcvRate();
    const currency = this.resolveFinance360Currency(record, aiMeta);
    const amountVes =
      currency === 'VES' ? roundMoney(record.amount) : bcv > 0 ? roundMoney(record.amount * bcv) : 0;
    const amountUsd =
      currency === 'USD' || currency === 'USDT'
        ? roundMoney(record.amount)
        : currency === 'VES'
          ? bcv > 0
            ? roundMoney(record.amount / bcv)
            : 0
          : roundMoney(record.amount);
    const bizName = this.finance360Service.pymeProfile().businessName?.trim() || 'Mi Negocio';

    this.cashReceiptService.printReceipt({
      receiptNumber: this.cashReceiptService.generateReceiptNumber(),
      date: todayVetIso(),
      payerName: record.payerName || 'Cliente Particular',
      payerIdDoc: record.payerId || undefined,
      receiverName: record.beneficiaryName || bizName,
      concept: `Pago por ${record.bankDisplayName} - Ref #${record.reference}`,
      amountUsd,
      amountVes,
      bcvRateApplied: bcv,
      paymentMethod: `${record.bankDisplayName} (Ref: ${record.reference})`,
      scope: this.financeScope(),
      businessName: this.financeScope() === 'business' ? bizName : undefined,
    });
  }
}
