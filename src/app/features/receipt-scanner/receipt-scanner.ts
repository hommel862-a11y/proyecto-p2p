import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
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
import { McpService } from '../../core/mcp.service';
import { HotkeysService } from '../../core/hotkeys.service';
import {
  FinanceAiIngestorService,
  type ParsedFinancialDocument,
} from '../../core/services/finance-ai-ingestor.service';
import { CashReceiptGeneratorService } from '../../core/services/cash-receipt-generator.service';
import {
  ReceiptOcrPipelineService,
  type PersistedOcrSessionItem,
} from '../../core/services/receipt-ocr-pipeline.service';
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
import {
  type OcrBatchProgress,
  type OcrCounterpartySuggestion,
  type OcrDestinationMode,
  type OcrFinancePillar,
  type OcrIdentityCrossCheck,
  type OcrKpiSummary,
  type OcrOverflowActionId,
  type OcrRiskFilter,
  type OcrRoutingState,
  type OcrVaultOption,
} from './ocr-ui.models';
import { OcrCommandHeaderComponent } from './components/ocr-command-header/ocr-command-header.component';
import { OcrKpiStripComponent } from './components/ocr-kpi-strip/ocr-kpi-strip.component';
import { OcrIngestionBentoComponent } from './components/ocr-ingestion-bento/ocr-ingestion-bento.component';
import { OcrForensicInspectorComponent } from './components/ocr-forensic-inspector/ocr-forensic-inspector.component';
import Tesseract from 'tesseract.js';

const OPS_KEY = 'p2p.operations';

interface OcrFilterOption {
  readonly id: OcrRiskFilter;
  readonly label: string;
}

interface OcrPaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly run: () => void;
}

const FILTER_OPTIONS: readonly OcrFilterOption[] = [
  { id: 'all', label: 'Todos' },
  { id: 'safe', label: 'Verificados' },
  { id: 'warning', label: 'Revisión' },
  { id: 'critical', label: 'Críticos' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'settled', label: 'Asentados' },
];

@Component({
  selector: 'app-receipt-scanner',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    OcrCommandHeaderComponent,
    OcrKpiStripComponent,
    OcrIngestionBentoComponent,
    OcrForensicInspectorComponent,
  ],
  templateUrl: './receipt-scanner.html',
  styleUrls: ['./receipt-scanner.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.mode-p2p]': "destinationMode() === 'p2p'",
    '[class.mode-finance360]': "destinationMode() === 'finance360'",
  },
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
  private readonly pipeline = inject(ReceiptOcrPipelineService);
  private readonly mcpService = inject(McpService, { optional: true });
  private readonly hotkeysService = inject(HotkeysService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  private readonly quickFileInput = viewChild<ElementRef<HTMLInputElement>>('ocrQuickFileInput');

  /** Router destination: 'p2p' (Arbitrage Desk) vs 'finance360' (Isolated 360 Portfolio) */
  readonly destinationMode = signal<OcrDestinationMode>('p2p');

  /** Finance 360 routing options */
  readonly financeScope = signal<FinanceScope>('personal');
  readonly financePillar = signal<OcrFinancePillar>('expense');
  readonly financeExpenseCategory = signal<ExpenseCategory>('groceries');
  readonly financeIncomeCategory = signal<IncomeCategory>('business_sale');
  readonly selectedVaultId = signal<string>('');

  readonly isProcessing = signal<boolean>(false);
  readonly progressPct = signal<number>(0);
  readonly progressStatus = signal<string>('');
  readonly batchCurrentIndex = signal<number>(0);
  readonly batchTotalFiles = signal<number>(0);

  readonly manualTextInput = signal<string>('');
  readonly receipts = signal<BankReceiptRecord[]>([]);
  readonly receiptAudits = signal<Map<string, FraudShieldAuditResult>>(new Map());
  readonly aiMetadataByReceiptId = signal<Map<string, ParsedFinancialDocument>>(new Map());
  readonly thumbnailsByReceiptId = signal<Map<string, string>>(new Map());
  readonly imageHashByReceiptId = signal<Map<string, string>>(new Map());
  readonly settledReceiptIds = signal<Set<string>>(new Set());
  readonly settledP2pReceiptIds = signal<Set<string>>(new Set());
  readonly driveBackedUpIds = signal<Set<string>>(new Set());
  readonly backingUpDriveId = signal<string | null>(null);

  readonly selectedAudit = signal<FraudShieldAuditResult | null>(null);
  readonly selectedReceiptId = signal<string | null>(null);

  readonly expectedCounterparty = signal<string>('');
  readonly expectedId = signal<string>('');
  readonly expectedAmount = signal<number | null>(null);
  readonly isDragging = signal<boolean>(false);
  readonly hasScreenPipe = signal<boolean>(
    typeof window !== 'undefined' &&
      !!(window as unknown as { electron?: { screenPipe?: unknown } }).electron?.screenPipe,
  );

  readonly activeFilter = signal<OcrRiskFilter>('all');
  readonly searchQuery = signal<string>('');
  readonly openRowMenuId = signal<string | null>(null);
  readonly isPaletteOpen = signal<boolean>(false);
  readonly paletteQuery = signal<string>('');

  protected readonly filterOptions = FILTER_OPTIONS;

  readonly routingState = computed<OcrRoutingState>(() => ({
    scope: this.financeScope(),
    pillar: this.financePillar(),
    expenseCategory: this.financeExpenseCategory(),
    incomeCategory: this.financeIncomeCategory(),
    vaultId: this.selectedVaultId(),
  }));

  readonly vaultOptions = computed<readonly OcrVaultOption[]>(() => {
    const assets = this.finance360Service.assets?.() ?? [];
    return assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      currency: asset.currency,
    }));
  });

  readonly identityCheck = computed<OcrIdentityCrossCheck>(() => ({
    expectedCounterparty: this.expectedCounterparty(),
    expectedId: this.expectedId(),
    expectedAmount: this.expectedAmount(),
  }));

  readonly batchProgress = computed<OcrBatchProgress>(() => ({
    active: this.isProcessing(),
    currentIndex: this.batchCurrentIndex(),
    totalFiles: this.batchTotalFiles(),
    progressPct: this.progressPct(),
    statusLabel: this.progressStatus(),
  }));

  readonly counterpartySuggestions = computed<readonly OcrCounterpartySuggestion[]>(() => {
    const list = this.counterpartyService?.counterparties?.() ?? [];
    return list.map((cp) => ({
      id: cp.id,
      name: cp.realName || cp.alias,
      documentId: cp.documentId,
      isBlacklisted: cp.reputation === 'BLOCKED',
    }));
  });

  readonly blacklistedEntities = computed<{
    ids: string[];
    references: string[];
    count: number;
  }>(() => {
    const list = this.counterpartyService?.counterparties?.() ?? [];
    const blocked = list.filter((cp) => cp.reputation === 'BLOCKED');
    const ids = blocked
      .flatMap((cp) => [cp.documentId, cp.realName, cp.alias])
      .map((entry) => (entry ?? '').trim())
      .filter((entry) => entry.length > 0);
    return {
      ids,
      references: [],
      count: blocked.length,
    };
  });

  readonly selectedReceipt = computed<BankReceiptRecord | null>(() => {
    const id = this.selectedReceiptId();
    if (!id) return null;
    return this.receipts().find((r) => r.id === id) ?? null;
  });

  readonly selectedReceiptAudit = computed<FraudShieldAuditResult | null>(() => {
    const id = this.selectedReceiptId();
    if (id) {
      return this.receiptAudits().get(id) ?? this.selectedAudit();
    }
    return this.selectedAudit();
  });

  readonly selectedThumbnailDataUrl = computed<string | null>(() => {
    const id = this.selectedReceiptId();
    if (!id) return null;
    return this.thumbnailsByReceiptId().get(id) ?? null;
  });

  readonly selectedImageHash = computed<string | null>(() => {
    const id = this.selectedReceiptId();
    if (!id) return null;
    return this.imageHashByReceiptId().get(id) ?? null;
  });

  readonly selectedIsSettled = computed<boolean>(() => {
    const id = this.selectedReceiptId();
    if (!id) return false;
    return this.destinationMode() === 'finance360'
      ? this.settledReceiptIds().has(id)
      : this.settledP2pReceiptIds().has(id);
  });

  readonly selectedIsDriveBackedUp = computed<boolean>(() => {
    const id = this.selectedReceiptId();
    return id ? this.driveBackedUpIds().has(id) : false;
  });

  readonly selectedIsBackingUpDrive = computed<boolean>(() => {
    const id = this.selectedReceiptId();
    return Boolean(id && this.backingUpDriveId() === id);
  });

  readonly selectedCasheaMatchLabel = computed<string | null>(() => {
    const rec = this.selectedReceipt();
    if (!rec) return null;
    const aiMeta = this.aiMetadataByReceiptId().get(rec.id);
    const isCashea = Boolean(
      aiMeta?.isCashea || rec.bank === 'CASHEA' || /cashea/i.test(rec.rawText || ''),
    );
    if (!isCashea) return null;
    const activePlans = (this.finance360Service.state?.()?.casheaPlans ?? []).filter(
      (p) => p.status === 'active',
    );
    if (activePlans.length === 0) return 'Comprobante Cashea detectado';
    const haystack =
      `${aiMeta?.title ?? ''} ${aiMeta?.entityName ?? ''} ${rec.rawText ?? ''}`.toLowerCase();
    const matched =
      activePlans.find(
        (p) =>
          haystack.includes(p.productName.toLowerCase()) ||
          haystack.includes(p.storeName.toLowerCase()),
      ) ?? activePlans[0];
    const nextInst = matched.installments.find((i) => i.status !== 'paid');
    return nextInst
      ? `Cashea: ${matched.productName} · Cuota #${nextInst.number}`
      : `Cashea: ${matched.productName}`;
  });

  readonly kpiSummary = computed<OcrKpiSummary>(() => {
    const list = this.receipts();
    const audits = this.receiptAudits();
    const settledF360 = this.settledReceiptIds();
    const settledP2p = this.settledP2pReceiptIds();
    const aiMap = this.aiMetadataByReceiptId();
    const bcv = this.finance360Service.currentBcvRate?.() ?? 0;

    let safeCount = 0;
    let warningCount = 0;
    let criticalCount = 0;
    let verifiedUsd = 0;
    let verifiedVes = 0;
    let pendingCount = 0;
    let pendingUsd = 0;
    let casheaPendingCount = 0;

    for (const rec of list) {
      const audit = audits.get(rec.id);
      const level = audit?.riskLevel ?? 'WARNING';
      if (level === 'SAFE') safeCount++;
      else if (level === 'CRITICAL') criticalCount++;
      else warningCount++;

      const usdVal = this.estimateUsdEquivalent(rec, bcv);
      const vesVal = this.estimateVesEquivalent(rec, bcv);
      if (level === 'SAFE') {
        verifiedUsd += usdVal;
        verifiedVes += vesVal;
      }

      const isSettled = settledF360.has(rec.id) || settledP2p.has(rec.id);
      if (!isSettled) {
        pendingCount++;
        pendingUsd += usdVal;
        const aiMeta = aiMap.get(rec.id);
        if (aiMeta?.isCashea || rec.bank === 'CASHEA' || /cashea/i.test(rec.rawText || '')) {
          casheaPendingCount++;
        }
      }
    }

    const totalAudited = list.length;
    const safeRatePct = totalAudited > 0 ? Math.round((safeCount / totalAudited) * 100) : 0;

    return {
      totalAudited,
      p2pCount: settledP2p.size,
      finance360Count: settledF360.size,
      verifiedUsd: roundMoney(verifiedUsd),
      verifiedVes: roundMoney(verifiedVes),
      bcvRate: bcv,
      safeCount,
      warningCount,
      criticalCount,
      safeRatePct,
      pendingCount,
      pendingUsd: roundMoney(pendingUsd),
      casheaPendingCount,
    };
  });

  readonly filteredReceipts = computed<readonly BankReceiptRecord[]>(() => {
    const filter = this.activeFilter();
    const query = this.searchQuery().trim().toLowerCase();
    const audits = this.receiptAudits();
    const settledF360 = this.settledReceiptIds();
    const settledP2p = this.settledP2pReceiptIds();

    return this.receipts().filter((rec) => {
      const audit = audits.get(rec.id);
      const isSettled = settledF360.has(rec.id) || settledP2p.has(rec.id);

      if (filter === 'safe' && audit?.riskLevel !== 'SAFE') return false;
      if (filter === 'warning' && audit?.riskLevel !== 'WARNING') return false;
      if (filter === 'critical' && audit?.riskLevel !== 'CRITICAL') return false;
      if (filter === 'pending' && isSettled) return false;
      if (filter === 'settled' && !isSettled) return false;

      if (!query) return true;
      const haystack = [
        rec.bankDisplayName,
        rec.bank,
        rec.reference,
        rec.payerName ?? '',
        rec.payerId ?? '',
        rec.beneficiaryName ?? '',
        rec.currency,
        String(rec.amount),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  });

  readonly paletteCommands = computed<readonly OcrPaletteCommand[]>(() => {
    const q = this.paletteQuery().trim().toLowerCase();
    const commands: OcrPaletteCommand[] = [
      {
        id: 'capture-files',
        label: 'Capturar o subir comprobantes (Lote)',
        hint: 'PNG, JPG, WebP',
        run: () => this.triggerFileCapture(),
      },
      {
        id: 'mode-p2p',
        label: 'Cambiar destino a Mesa P2P',
        hint: 'Arbitraje y bitácora P2P',
        run: () => this.onDestinationModeChange('p2p'),
      },
      {
        id: 'mode-f360',
        label: 'Cambiar destino a Finanzas 360',
        hint: 'Portafolio aislado personal y Pyme',
        run: () => this.onDestinationModeChange('finance360'),
      },
      {
        id: 'filter-critical',
        label: 'Filtrar comprobantes con riesgo Crítico',
        hint: 'Escudo Anti-Fraude',
        run: () => this.setFilter('critical'),
      },
      {
        id: 'filter-pending',
        label: 'Filtrar comprobantes Pendientes por asentar',
        hint: 'Cola operativa',
        run: () => this.setFilter('pending'),
      },
      {
        id: 'filter-all',
        label: 'Mostrar todos los comprobantes',
        hint: 'Limpiar filtros',
        run: () => {
          this.setFilter('all');
          this.searchQuery.set('');
        },
      },
      {
        id: 'export-csv',
        label: 'Exportar comprobantes a Excel (CSV seguro)',
        hint: 'Sanitizado contra fórmulas',
        run: () => this.exportToExcel(),
      },
      {
        id: 'recompute',
        label: 'Recalcular auditoría forense completa',
        hint: 'Lista Negra + Cruce P2P/360',
        run: () => {
          this.recomputeAudits();
          this.toast.info('Auditoría forense recalculada.');
        },
      },
    ];

    if (this.hasScreenPipe()) {
      commands.splice(1, 0, {
        id: 'screen-pipe',
        label: 'Capturar pantalla con Screen Pipe',
        hint: 'Electron Desktop',
        run: () => void this.captureWithScreenPipe(),
      });
    }

    if (!q) return commands;
    return commands.filter(
      (cmd) => cmd.label.toLowerCase().includes(q) || cmd.hint.toLowerCase().includes(q),
    );
  });

  constructor() {
    const unregisterPalette = this.hotkeysService?.registerScopedPalette(
      () => this.togglePalette(),
      () => {
        if (this.isPaletteOpen()) {
          this.closePalette();
          return true;
        }
        if (this.selectedReceiptId()) {
          this.closeInspector();
          return true;
        }
        if (this.openRowMenuId()) {
          this.openRowMenuId.set(null);
          return true;
        }
        return false;
      },
    );

    if (unregisterPalette) {
      this.destroyRef.onDestroy(() => unregisterPalette());
    }

    void this.hydratePersistedSession();
  }

  /**
   * Listen for clipboard paste (Ctrl+V) across the window.
   */
  @HostListener('window:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      event.preventDefault();
      if (imageFiles.length === 1) {
        void this.processImageFile(imageFiles[0]);
      } else {
        void this.processImageFiles(imageFiles);
      }
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('.ocr-row-menu-anchor')) {
      this.openRowMenuId.set(null);
    }
  }

  onDestinationModeChange(mode: OcrDestinationMode): void {
    this.destinationMode.set(mode);
  }

  onRoutingChange(routing: OcrRoutingState): void {
    this.financeScope.set(routing.scope);
    this.financePillar.set(routing.pillar);
    this.financeExpenseCategory.set(routing.expenseCategory);
    this.financeIncomeCategory.set(routing.incomeCategory);
    this.selectedVaultId.set(routing.vaultId);
  }

  onIdentityCheckChange(identity: OcrIdentityCrossCheck): void {
    this.expectedCounterparty.set(identity.expectedCounterparty);
    this.expectedId.set(identity.expectedId);
    this.expectedAmount.set(identity.expectedAmount);
    this.recomputeAudits();
  }

  onOverflowAction(action: OcrOverflowActionId): void {
    if (action === 'screen_pipe') {
      void this.captureWithScreenPipe();
    } else if (action === 'export_csv') {
      this.exportToExcel();
    } else if (action === 'clear_session') {
      this.clearReceipts();
      this.toast.info('Sesión de comprobantes limpiada.');
    }
  }

  triggerFileCapture(): void {
    this.quickFileInput()?.nativeElement.click();
  }

  togglePalette(): void {
    this.isPaletteOpen.update((open) => !open);
    if (this.isPaletteOpen()) {
      this.paletteQuery.set('');
    }
  }

  closePalette(): void {
    this.isPaletteOpen.set(false);
    this.paletteQuery.set('');
  }

  runPaletteCommand(cmd: OcrPaletteCommand): void {
    this.closePalette();
    cmd.run();
  }

  setFilter(filter: OcrRiskFilter): void {
    this.activeFilter.set(filter);
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  toggleRowMenu(receiptId: string): void {
    this.openRowMenuId.update((current) => (current === receiptId ? null : receiptId));
  }

  openInspector(record: BankReceiptRecord): void {
    this.openRowMenuId.set(null);
    this.selectedReceiptId.set(record.id);
    this.selectedAudit.set(this.receiptAudits().get(record.id) ?? null);
  }

  closeInspector(): void {
    this.selectedReceiptId.set(null);
    this.selectedAudit.set(null);
  }

  onInspectorReceiptUpdated(updated: BankReceiptRecord): void {
    this.receipts.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
    const audit = this.evaluateReceiptFraud(updated, updated.id);
    this.receiptAudits.update((map) => {
      const next = new Map(map);
      next.set(updated.id, audit);
      return next;
    });
    if (this.selectedReceiptId() === updated.id) {
      this.selectedAudit.set(audit);
    }
    this.persistSession();
  }

  onInspectorSettleRequested(payload: {
    receipt: BankReceiptRecord;
    mode: OcrDestinationMode;
  }): void {
    if (payload.mode === 'finance360') {
      this.settleToFinance360(payload.receipt);
    } else {
      this.settleToLedger(payload.receipt);
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
      void this.processImageFiles(Array.from(files));
    }
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      void this.processImageFiles(Array.from(input.files));
      input.value = '';
    }
  }

  async processImageFiles(files: readonly File[]): Promise<void> {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      this.toast.error('Por favor selecciona archivos de imagen válidos (PNG, JPG, WebP).');
      return;
    }

    if (imageFiles.length === 1) {
      await this.processImageFile(imageFiles[0]);
      return;
    }

    this.batchTotalFiles.set(imageFiles.length);
    for (let i = 0; i < imageFiles.length; i++) {
      this.batchCurrentIndex.set(i + 1);
      await this.processImageFile(imageFiles[i], true);
    }
    this.batchCurrentIndex.set(0);
    this.batchTotalFiles.set(0);
    this.toast.success(`Lote de ${imageFiles.length} comprobantes procesado.`);
  }

  async processImageFile(file: File, isBatchItem = false): Promise<void> {
    this.isProcessing.set(true);
    if (!isBatchItem) {
      this.batchCurrentIndex.set(1);
      this.batchTotalFiles.set(1);
    }
    this.progressPct.set(8);
    this.progressStatus.set('Pre-procesando imagen (Canvas 2x + SHA-256)...');

    try {
      const preprocessed = await this.pipeline.preprocessReceiptImage(file);
      const existingDupId = this.findDuplicateHashReceiptId(preprocessed.sha256Hash);
      if (existingDupId) {
        const dupRec = this.receipts().find((r) => r.id === existingDupId);
        this.toast.warn(
          `Imagen duplicada detectada (SHA-256 coincide con Ref #${dupRec?.reference || existingDupId.slice(-6)}).`,
        );
      }

      const ocrSource: File | string = preprocessed.canvasApplied
        ? preprocessed.processedDataUrl
        : file;

      this.progressPct.set(18);
      this.progressStatus.set(
        preprocessed.wasDarkModeInverted
          ? 'Modo oscuro invertido. Extrayendo texto OCR...'
          : 'Extrayendo texto OCR local...',
      );

      // 1. Local OCR extraction via Tesseract
      const result = await Tesseract.recognize(ocrSource, 'spa+eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            this.progressPct.set(18 + Math.round((m.progress || 0) * 62));
            this.progressStatus.set(`Extrayendo texto del comprobante: ${this.progressPct()}%`);
          }
        },
      });

      const extractedText = result.data.text || '';

      // 2. Multimodal AI Analysis with Gemini
      const dataUrl = preprocessed.originalDataUrl || '';
      const base64Clean = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

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

      this.ingestReceiptText(extractedText, aiResult, {
        thumbnailDataUrl: preprocessed.thumbnailDataUrl || undefined,
        imageHash: preprocessed.sha256Hash || undefined,
        isHashDuplicate: Boolean(existingDupId),
      });

      if (!isBatchItem) {
        this.toast.success('Comprobante digitalizado y analizado con éxito.');
      }
    } catch {
      this.toast.error('Error al ejecutar el reconocimiento OCR local.');
    } finally {
      this.isProcessing.set(false);
      this.progressPct.set(0);
      this.progressStatus.set('');
      if (!isBatchItem) {
        this.batchCurrentIndex.set(0);
        this.batchTotalFiles.set(0);
      }
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
    this.batchCurrentIndex.set(1);
    this.batchTotalFiles.set(1);
    this.progressPct.set(15);
    this.progressStatus.set('Capturando pantalla en tiempo real (Screen Pipe)...');

    try {
      const captureResult = await electron.screenPipe.capture();
      if (!captureResult?.dataUrl) {
        this.toast.error('No se pudo capturar la pantalla. Verifica los permisos.');
        return;
      }

      const preprocessed = await this.pipeline.preprocessReceiptImage(captureResult.dataUrl);
      const existingDupId = this.findDuplicateHashReceiptId(preprocessed.sha256Hash);
      if (existingDupId) {
        this.toast.warn('Captura duplicada detectada mediante huella SHA-256.');
      }

      this.progressPct.set(35);
      this.progressStatus.set('Procesando OCR local de alta resolución...');

      const ocrSource = preprocessed.canvasApplied
        ? preprocessed.processedDataUrl
        : captureResult.dataUrl;

      const result = await Tesseract.recognize(ocrSource, 'spa+eng', {
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

      this.ingestReceiptText(extractedText, null, {
        thumbnailDataUrl: preprocessed.thumbnailDataUrl || captureResult.dataUrl,
        imageHash: preprocessed.sha256Hash || undefined,
        isHashDuplicate: Boolean(existingDupId),
      });
      this.toast.success('Comprobante capturado e indexado vía Screen Pipe.');
    } catch {
      this.toast.error('Error al ejecutar el flujo Screen Pipe.');
    } finally {
      this.isProcessing.set(false);
      this.progressPct.set(0);
      this.progressStatus.set('');
      this.batchCurrentIndex.set(0);
      this.batchTotalFiles.set(0);
    }
  }

  processManualText(explicitText?: string): void {
    const text = (explicitText ?? this.manualTextInput()).trim();
    if (!text) {
      this.toast.warn('Ingresa el texto o mensaje del comprobante bancario.');
      return;
    }

    this.ingestReceiptText(text);
    this.manualTextInput.set('');
    this.toast.success('Texto bancario procesado correctamente.');
  }

  private ingestReceiptText(
    text: string,
    aiMeta?: ParsedFinancialDocument | null,
    mediaMeta?: {
      thumbnailDataUrl?: string;
      imageHash?: string;
      isHashDuplicate?: boolean;
    },
  ): void {
    const knownRefs = this.buildKnownReferences();

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
      aiMeta?.currency && ['USD', 'VES', 'USDT', 'EUR'].includes(aiMeta.currency)
        ? aiMeta.currency
        : parsedBase.currency;
    const mergedBeneficiary = parsedBase.beneficiaryName || aiMeta?.entityName || undefined;

    const parsed: BankReceiptRecord = {
      ...parsedBase,
      amount: mergedAmount,
      reference: mergedReference,
      currency: mergedCurrency,
      beneficiaryName: mergedBeneficiary,
      isDuplicate: Boolean(parsedBase.isDuplicate || mediaMeta?.isHashDuplicate),
    };

    const audit = this.evaluateReceiptFraud(parsed);

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
    if (mediaMeta?.thumbnailDataUrl) {
      this.thumbnailsByReceiptId.update((map) => {
        const next = new Map(map);
        next.set(parsed.id, mediaMeta.thumbnailDataUrl!);
        return next;
      });
    }
    if (mediaMeta?.imageHash) {
      this.imageHashByReceiptId.update((map) => {
        const next = new Map(map);
        next.set(parsed.id, mediaMeta.imageHash!);
        return next;
      });
    }

    this.persistSession();
  }

  recomputeAudits(): void {
    const audits = new Map<string, FraudShieldAuditResult>();
    for (const rec of this.receipts()) {
      audits.set(rec.id, this.evaluateReceiptFraud(rec, rec.id));
    }
    this.receiptAudits.set(audits);

    const activeId = this.selectedReceiptId();
    if (activeId) {
      this.selectedAudit.set(audits.get(activeId) ?? null);
    }
  }

  getDossierForAudit(audit: FraudShieldAuditResult): DisputeDossier | null {
    const rec =
      (this.selectedReceiptId()
        ? this.receipts().find((r) => r.id === this.selectedReceiptId())
        : undefined) ?? this.receipts().find((r) => audit.orderId.endsWith(r.id.slice(-6)));
    if (!rec) return null;
    return buildDisputeDossier({
      orderId: audit.orderId,
      orderAmountFiat: rec.amount,
      orderAmountCrypto: 0,
      fiatCurrency: rec.currency || 'VES',
      cryptoAsset: 'USDT',
      counterpartyBinanceName: audit.nameMatch.normalizedA || this.expectedCounterparty().trim() || 'Contraparte',
      counterpartyBinanceIdDoc: this.expectedId().trim() || rec.payerId || undefined,
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
          'Reclamo formal copiado. Listo para pegar en el soporte de Binance/Bybit.',
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
      .then(() => this.toast.success('Expediente formal de arbitraje (Español) copiado.'))
      .catch(() => this.toast.error('Error al copiar al portapapeles.'));
  }

  copyDossierEn(audit: FraudShieldAuditResult): void {
    const dossier = this.getDossierForAudit(audit);
    if (!dossier) return;
    navigator.clipboard
      .writeText(dossier.appealTextEn)
      .then(() => this.toast.success('Formal Arbitration Appeal Dossier (English) copied.'))
      .catch(() => this.toast.error('Error copying to clipboard.'));
  }

  copyChatWarning(audit: FraudShieldAuditResult): void {
    const dossier = this.getDossierForAudit(audit);
    if (!dossier) return;
    navigator.clipboard
      .writeText(dossier.chatResponses.thirdPartyWarning)
      .then(() => this.toast.success('Mensaje de advertencia para el chat copiado.'))
      .catch(() => this.toast.error('Error al copiar al portapapeles.'));
  }

  copyRefundInstructions(audit: FraudShieldAuditResult): void {
    const dossier = this.getDossierForAudit(audit);
    if (!dossier) return;
    navigator.clipboard
      .writeText(dossier.chatResponses.refundInstructions)
      .then(() => this.toast.success('Instrucciones de devolución y cancelación copiadas.'))
      .catch(() => this.toast.error('Error al copiar al portapapeles.'));
  }

  removeReceipt(id: string): void {
    this.openRowMenuId.set(null);
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
    this.thumbnailsByReceiptId.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
    this.imageHashByReceiptId.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
    this.settledReceiptIds.update((set) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });
    this.settledP2pReceiptIds.update((set) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });
    this.driveBackedUpIds.update((set) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });
    if (this.selectedReceiptId() === id || this.selectedAudit()?.orderId.endsWith(id.slice(-6))) {
      this.closeInspector();
    }
    this.persistSession();
  }

  clearReceipts(): void {
    this.openRowMenuId.set(null);
    this.receipts.set([]);
    this.receiptAudits.set(new Map());
    this.aiMetadataByReceiptId.set(new Map());
    this.thumbnailsByReceiptId.set(new Map());
    this.imageHashByReceiptId.set(new Map());
    this.settledReceiptIds.set(new Set());
    this.settledP2pReceiptIds.set(new Set());
    this.driveBackedUpIds.set(new Set());
    this.closeInspector();
    this.pipeline.clearSession();
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
   * Settles a parsed bank receipt to the P2P operation ledger with bank/counterparty matching,
   * duplicate settlement guard, and compressed thumbnail attachment.
   */
  settleToLedger(
    record: BankReceiptRecord,
    options?: { allowDuplicateOverride?: boolean },
  ): void {
    try {
      const allowDuplicate = Boolean(options?.allowDuplicateOverride);
      const rawOps = this.storage.get<Operation[]>(OPS_KEY);
      const currentOps: Operation[] = Array.isArray(rawOps) ? rawOps : [];
      const refClean = (record.reference || '').trim();

      if (!allowDuplicate) {
        if (this.settledP2pReceiptIds().has(record.id)) {
          this.toast.warn('Este comprobante ya fue asentado en la Mesa P2P.');
          return;
        }
        if (
          refClean &&
          refClean !== 'N/A' &&
          refClean !== 'SIN-REF' &&
          currentOps.some(
            (op) =>
              (op.receiptReference ?? '').trim().toLowerCase() === refClean.toLowerCase() ||
              (op.merchantNote ?? '').toLowerCase().includes(refClean.toLowerCase()),
          )
        ) {
          this.toast.warn(
            `La referencia #${refClean} ya existe en la Mesa P2P. Usa sobrescritura explícita si deseas duplicarla.`,
          );
          return;
        }
      }

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

      const liveRate = this.resolveLiveP2pRate();

      const vesAmount =
        record.currency === 'VES'
          ? record.amount
          : liveRate > 0
            ? Math.round(record.amount * liveRate * 100) / 100
            : 0;
      const usdtAmount =
        record.currency === 'USD' || record.currency === 'USDT'
          ? record.amount
          : liveRate > 0
            ? Math.round((record.amount / liveRate) * 10000) / 10000
            : 0;

      const thumbnail = this.thumbnailsByReceiptId().get(record.id);

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
        ...(thumbnail ? { receiptImage: thumbnail } : {}),
      };

      this.storage.set(OPS_KEY, [...currentOps, newOp]);
      this.accountsService.refreshLedger();
      this.settledP2pReceiptIds.update((set) => new Set(set).add(record.id));
      this.persistSession();

      this.toast.success(`Comprobante Ref #${record.reference} asentado en la Mesa P2P.`);
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
          record.bank === 'CASHEA' ||
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
            this.persistSession();
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
      this.persistSession();
    } catch {
      this.toast.error('Error al asentar en el Portafolio 360.');
    }
  }

  /**
   * Honest Google Drive backup via Electron native MCP transport (`gdrive_backup_receipt`).
   * Never simulates or fakes backup when running disconnected from native MCP.
   */
  async backupReceiptToDrive(record: BankReceiptRecord): Promise<void> {
    this.openRowMenuId.set(null);
    if (!this.mcpService?.hasNativeTransport()) {
      this.toast.warn(
        'Respaldo a Google Drive no disponible (MCP DISCONNECTED). Conecta la app de escritorio Electron.',
      );
      return;
    }

    const thumbnail = this.thumbnailsByReceiptId().get(record.id);
    const fallbackBytes = new TextEncoder().encode(record.rawText || record.reference);
    let fallbackBinary = '';
    for (const byte of fallbackBytes) {
      fallbackBinary += String.fromCharCode(byte);
    }
    const imageData = thumbnail || btoa(fallbackBinary);
    const isJpeg = Boolean(thumbnail?.startsWith('data:image/jpeg'));
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    const fileExt = isJpeg ? 'jpg' : 'png';
    const bcv = this.finance360Service.currentBcvRate?.() ?? 0;

    this.backingUpDriveId.set(record.id);
    try {
      const response = await this.mcpService.testTool('gdrive_backup_receipt', {
        tradeId: record.reference || record.id,
        imageData,
        mimeType,
        bank: record.bankDisplayName,
        counterparty: record.payerName || record.beneficiaryName || 'Contraparte Desconocida',
        amountVes: this.estimateVesEquivalent(record, bcv),
        amountUsdt: this.estimateUsdEquivalent(record, bcv),
        timestamp: record.timestamp || new Date().toISOString(),
        fileName: `comprobante_${record.bank.toLowerCase()}_${record.reference || record.id}.${fileExt}`,
      });

      if (response.success) {
        this.driveBackedUpIds.update((set) => new Set(set).add(record.id));
        this.persistSession();
        this.toast.success(`Comprobante Ref #${record.reference} respaldado en Google Drive.`);
      } else {
        this.toast.error(
          response.error || 'No se pudo respaldar el comprobante en Google Drive.',
        );
      }
    } catch {
      this.toast.error('Error de comunicación con Google Drive vía MCP.');
    } finally {
      this.backingUpDriveId.set(null);
    }
  }

  /**
   * Generates and prints an internal cash receipt using live BCV rate and configurable business profile.
   */
  generateCashReceipt(record: BankReceiptRecord): void {
    this.openRowMenuId.set(null);
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

  isReceiptSettledInActiveMode(receiptId: string): boolean {
    return this.destinationMode() === 'finance360'
      ? this.settledReceiptIds().has(receiptId)
      : this.settledP2pReceiptIds().has(receiptId);
  }

  riskToneClass(level?: FraudShieldAuditResult['riskLevel']): string {
    if (level === 'SAFE') return 'tone-emerald';
    if (level === 'CRITICAL') return 'tone-danger';
    return 'tone-warn';
  }

  riskLabel(level?: FraudShieldAuditResult['riskLevel']): string {
    if (level === 'SAFE') return 'Verificado';
    if (level === 'CRITICAL') return 'Crítico';
    return 'Revisión';
  }

  private evaluateReceiptFraud(
    rec: BankReceiptRecord,
    excludeReceiptId?: string,
  ): FraudShieldAuditResult {
    const knownRefs = this.buildKnownReferences(excludeReceiptId);
    const blacklist = this.blacklistedEntities();
    return evaluateFraudRisk({
      orderId: `ORD-${rec.id.slice(-6)}`,
      orderAmount: this.expectedAmount() || rec.amount,
      orderCurrency: rec.currency || 'VES',
      advertiserVerifiedName:
        this.expectedCounterparty().trim() || rec.payerName || 'Contraparte Binance',
      advertiserIdDocument: this.expectedId().trim() || undefined,
      receipt: rec,
      knownReferences: knownRefs,
      blacklistedIds: blacklist.ids,
      blacklistedReferences: blacklist.references,
    });
  }

  private buildKnownReferences(excludeReceiptId?: string): string[] {
    const refs = new Set<string>();

    // 1. P2P operations ledger
    const currentOps: Operation[] = this.storage.get<Operation[]>(OPS_KEY) ?? [];
    for (const op of currentOps) {
      if (op.receiptReference && op.receiptReference.trim().length > 0) {
        refs.add(op.receiptReference.trim());
      }
      const match = `${op.notes ?? ''} ${op.merchantNote ?? ''}`.match(
        /(?:ref|comprobante|id|#)[:\s#]*([A-Za-z0-9-]+)/i,
      );
      if (match?.[1]) {
        refs.add(match[1].trim());
      }
    }

    // 2. Finance 360 ledger (incomes + expenses)
    const f360State = this.finance360Service.state?.() as
      | {
          incomes?: { referenceNumber?: string }[];
          expenses?: { referenceNumber?: string }[];
        }
      | undefined;
    for (const entry of f360State?.incomes ?? []) {
      if (entry.referenceNumber?.trim()) refs.add(entry.referenceNumber.trim());
    }
    for (const entry of f360State?.expenses ?? []) {
      if (entry.referenceNumber?.trim()) refs.add(entry.referenceNumber.trim());
    }

    // 3. Other receipts in current OCR session
    for (const rec of this.receipts()) {
      if (excludeReceiptId && rec.id === excludeReceiptId) continue;
      if (rec.reference && rec.reference !== 'N/A' && rec.reference !== 'SIN-REF') {
        refs.add(rec.reference.trim());
      }
    }

    return Array.from(refs);
  }

  private findDuplicateHashReceiptId(sha256Hash: string): string | null {
    const normalized = sha256Hash.trim().toLowerCase();
    if (!normalized) return null;
    for (const [receiptId, hash] of this.imageHashByReceiptId().entries()) {
      if (hash.trim().toLowerCase() === normalized) {
        return receiptId;
      }
    }
    return null;
  }

  private resolveLiveP2pRate(): number {
    if (this.cotizaveService.ratesProvenance() === 'none') {
      return 0;
    }
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
        return Math.round(candidate * 100) / 100;
      }
    }
    return 0;
  }

  private estimateUsdEquivalent(rec: BankReceiptRecord, bcvRate: number): number {
    if (rec.currency === 'USD' || rec.currency === 'USDT' || rec.currency === 'EUR') {
      return rec.amount;
    }
    if (rec.currency === 'VES' && bcvRate > 0) {
      return rec.amount / bcvRate;
    }
    return 0;
  }

  private estimateVesEquivalent(rec: BankReceiptRecord, bcvRate: number): number {
    if (rec.currency === 'VES') {
      return rec.amount;
    }
    if ((rec.currency === 'USD' || rec.currency === 'USDT' || rec.currency === 'EUR') && bcvRate > 0) {
      return rec.amount * bcvRate;
    }
    return 0;
  }

  private resolveFinance360Currency(
    record: BankReceiptRecord,
    aiMeta?: ParsedFinancialDocument,
  ): CurrencyCode {
    if (aiMeta?.currency && ['USD', 'VES', 'USDT', 'EUR'].includes(aiMeta.currency)) {
      return aiMeta.currency;
    }
    const raw = record.rawText || '';
    if (/\bEUR\b|€/i.test(raw) || record.currency === 'EUR') return 'EUR';
    if (/\bUSDT\b/i.test(raw) || record.currency === 'USDT') return 'USDT';
    if (record.currency === 'USD') return 'USD';
    return 'VES';
  }

  private async hydratePersistedSession(): Promise<void> {
    try {
      const items = await this.pipeline.loadSession();
      if (items.length === 0 || this.receipts().length > 0) {
        return;
      }

      const loadedReceipts: BankReceiptRecord[] = [];
      const aiMap = new Map<string, ParsedFinancialDocument>();
      const thumbMap = new Map<string, string>();
      const hashMap = new Map<string, string>();
      const settledF360 = new Set<string>();
      const settledP2p = new Set<string>();
      const driveSet = new Set<string>();

      for (const item of items) {
        loadedReceipts.push(item.receipt);
        if (item.aiMeta) aiMap.set(item.receipt.id, item.aiMeta);
        if (item.thumbnailDataUrl) thumbMap.set(item.receipt.id, item.thumbnailDataUrl);
        if (item.imageHash) hashMap.set(item.receipt.id, item.imageHash);
        if (item.settledF360) settledF360.add(item.receipt.id);
        if (item.settledP2p) settledP2p.add(item.receipt.id);
        if (item.driveBackedUp) driveSet.add(item.receipt.id);
      }

      this.receipts.set(loadedReceipts);
      this.aiMetadataByReceiptId.set(aiMap);
      this.thumbnailsByReceiptId.set(thumbMap);
      this.imageHashByReceiptId.set(hashMap);
      this.settledReceiptIds.set(settledF360);
      this.settledP2pReceiptIds.set(settledP2p);
      this.driveBackedUpIds.set(driveSet);
      this.recomputeAudits();
    } catch {
      // Non-blocking session hydration
    }
  }

  private persistSession(): void {
    const aiMap = this.aiMetadataByReceiptId();
    const thumbMap = this.thumbnailsByReceiptId();
    const hashMap = this.imageHashByReceiptId();
    const settledF360 = this.settledReceiptIds();
    const settledP2p = this.settledP2pReceiptIds();
    const driveSet = this.driveBackedUpIds();
    const now = new Date().toISOString();

    const items: PersistedOcrSessionItem[] = this.receipts().map((receipt) => ({
      receipt,
      aiMeta: aiMap.get(receipt.id) ?? null,
      thumbnailDataUrl: thumbMap.get(receipt.id),
      imageHash: hashMap.get(receipt.id),
      settledF360: settledF360.has(receipt.id),
      settledP2p: settledP2p.has(receipt.id),
      driveBackedUp: driveSet.has(receipt.id),
      savedAt: now,
    }));

    this.pipeline.saveSession(items);
  }
}
