import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReceiptScanner } from './receipt-scanner';
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
import { McpService } from '../../core/mcp.service';
import { HotkeysService } from '../../core/hotkeys.service';
import { ReceiptOcrPipelineService } from '../../core/services/receipt-ocr-pipeline.service';
import type { BankReceiptRecord, Counterparty, Operation } from '@p2p/core';
import type { AssetVault, CasheaPlan } from '../../core/models/finance-360.models';

vi.mock('tesseract.js', () => ({
  default: {
    recognize: vi.fn(),
  },
}));

import Tesseract from 'tesseract.js';

function makeCasheaPlan(overrides: Partial<CasheaPlan> = {}): CasheaPlan {
  return {
    id: 'cashea-plan-1',
    productName: 'Taladro Percutor Bosch',
    storeName: 'EPA',
    scope: 'personal',
    level: 4,
    creditLine: 'principal',
    totalPriceUsd: 150,
    initialPaymentUsd: 60,
    initialPercentage: 40,
    numberOfInstallments: 3,
    installmentAmountUsd: 30,
    installmentFrequencyDays: 14,
    startDate: '2026-11-01',
    status: 'active',
    createdAt: '2026-11-01T12:00:00.000Z',
    installments: [
      { number: 1, dueDate: '2026-11-15', amountUsd: 30, status: 'paid', paidAt: '2026-11-14T12:00:00.000Z' },
      { number: 2, dueDate: '2026-11-29', amountUsd: 30, status: 'pending' },
      { number: 3, dueDate: '2026-12-13', amountUsd: 30, status: 'pending' },
    ],
    ...overrides,
  };
}

function makeBankReceipt(overrides: Partial<BankReceiptRecord> = {}): BankReceiptRecord {
  return {
    id: 'rec-100',
    reference: '88442211',
    amount: 1200,
    currency: 'VES',
    bank: 'BANESCO',
    bankDisplayName: 'Banesco Banco Universal',
    payerName: 'Carlos Mendoza',
    payerId: 'V-19283746',
    beneficiaryName: 'Ferreteria Central',
    rawText: 'Banesco Pago Movil Bs 1200 Ref 88442211',
    confidenceScore: 0.9,
    ...overrides,
  };
}

describe('ReceiptScanner (Finanzas 360 AI, Cashea & Anti-Duplicate Hardening)', () => {
  let component: ReceiptScanner;
  let toastMock: {
    success: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
  let aiIngestorMock: {
    analyzeReceiptImage: ReturnType<typeof vi.fn>;
    parseWithHeuristics: ReturnType<typeof vi.fn>;
  };
  let cashReceiptMock: {
    generateReceiptNumber: ReturnType<typeof vi.fn>;
    printReceipt: ReturnType<typeof vi.fn>;
  };
  let finance360Mock: {
    assets: ReturnType<typeof signal<AssetVault[]>>;
    state: ReturnType<typeof signal<{ casheaPlans: CasheaPlan[] }>>;
    pymeProfile: ReturnType<typeof signal<{ businessName: string }>>;
    currentBcvRate: ReturnType<typeof signal<number>>;
    currentParallelRate: ReturnType<typeof signal<number>>;
    isDuplicateReference: ReturnType<typeof vi.fn>;
    addExpense: ReturnType<typeof vi.fn>;
    addIncome: ReturnType<typeof vi.fn>;
    addLiability: ReturnType<typeof vi.fn>;
    markCasheaInstallmentPaid: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    toastMock = {
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    aiIngestorMock = {
      analyzeReceiptImage: vi.fn(),
      parseWithHeuristics: vi.fn().mockImplementation((text: string, bcvRate: number) => ({
        title: /cashea/i.test(text) ? 'Cuota Cashea' : 'Comprobante procesado',
        amount: 30,
        currency: 'USD',
        bcvRateApplied: bcvRate,
        scope: 'personal',
        pillar: 'expense',
        expenseCategory: /cashea/i.test(text) ? 'cashea_installment' : 'other',
        channel: 'cash',
        date: '2026-11-22',
        isCashea: /cashea/i.test(text),
        confidence: 0.7,
      })),
    };

    cashReceiptMock = {
      generateReceiptNumber: vi.fn().mockReturnValue('REC-20261122-1234'),
      printReceipt: vi.fn(),
    };

    finance360Mock = {
      assets: signal<AssetVault[]>([
        {
          id: 'vault-bs-1',
          name: 'Banesco Bs',
          channel: 'bs_bank',
          scope: 'personal',
          currency: 'VES',
          balance: 50000,
          balanceUsdEquivalent: 1000,
          balanceVesEquivalent: 50000,
          updatedAt: '2026-11-22T00:00:00.000Z',
        },
        {
          id: 'vault-usd-1',
          name: 'Caja USD',
          channel: 'cash',
          scope: 'business',
          currency: 'USD',
          balance: 500,
          balanceUsdEquivalent: 500,
          balanceVesEquivalent: 25000,
          updatedAt: '2026-11-22T00:00:00.000Z',
        },
      ]),
      state: signal<{ casheaPlans: CasheaPlan[] }>({
        casheaPlans: [makeCasheaPlan()],
      }),
      pymeProfile: signal({ businessName: 'Taller Automotriz El Progreso C.A.' }),
      currentBcvRate: signal<number>(50),
      currentParallelRate: signal<number>(62),
      isDuplicateReference: vi.fn().mockReturnValue(false),
      addExpense: vi.fn(),
      addIncome: vi.fn(),
      addLiability: vi.fn(),
      markCasheaInstallmentPaid: vi.fn().mockReturnValue({
        success: true,
        alreadyPaid: false,
        paidAmountUsd: 30,
      }),
    };

    TestBed.configureTestingModule({
      imports: [ReceiptScanner],
      providers: [
        { provide: StorageService, useValue: { get: vi.fn().mockReturnValue([]), set: vi.fn() } },
        { provide: ToastService, useValue: toastMock },
        { provide: AccountsService, useValue: { accounts: signal([]), refreshLedger: vi.fn() } },
        { provide: CounterpartyService, useValue: { findByQuery: vi.fn().mockReturnValue(undefined) } },
        {
          provide: CotizaveService,
          useValue: {
            ratesByMarket: signal({}),
            ratesProvenance: signal('none'),
          },
        },
        { provide: Finance360Service, useValue: finance360Mock },
        { provide: FinanceAiIngestorService, useValue: aiIngestorMock },
        { provide: CashReceiptGeneratorService, useValue: cashReceiptMock },
      ],
    });

    const fixture = TestBed.createComponent(ReceiptScanner);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('consumes FinanceAiIngestorService fields, stores aiMetadataByReceiptId, and merges missing receipt data', async () => {
    vi.mocked(Tesseract.recognize).mockResolvedValue({
      data: { text: 'Comprobante Cashea borroso sin monto claro' },
    } as never);

    const aiDoc: ParsedFinancialDocument = {
      title: 'Pago Cuota 2 Taladro Percutor Bosch',
      amount: 30,
      currency: 'USD',
      bcvRateApplied: 50,
      scope: 'personal',
      pillar: 'expense',
      expenseCategory: 'cashea_installment',
      channel: 'bs_bank',
      referenceNumber: 'CSH-998877',
      entityName: 'EPA',
      date: '2026-11-22',
      isCashea: true,
      casheaInstallmentNumber: 2,
      confidence: 0.96,
    };
    aiIngestorMock.analyzeReceiptImage.mockResolvedValue(aiDoc);

    const fakeFile = new File(['dummy-image'], 'cashea.png', { type: 'image/png' });
    await component.processImageFile(fakeFile);

    expect(component.destinationMode()).toBe('finance360');
    expect(component.financeExpenseCategory()).toBe('cashea_installment');
    expect(component.receipts().length).toBe(1);

    const rec = component.receipts()[0];
    expect(rec.amount).toBe(30);
    expect(rec.reference).toBe('CSH-998877');

    const storedMeta = component.aiMetadataByReceiptId().get(rec.id);
    expect(storedMeta).toEqual(aiDoc);
  });

  it('links a Cashea receipt to an active Cashea plan installment via markCasheaInstallmentPaid without double-recording an orphan expense', () => {
    const rec = makeBankReceipt({
      id: 'rec-cashea-2',
      reference: 'CSH-776655',
      amount: 30,
      currency: 'USD',
      rawText: 'Cashea pago cuota 2 Taladro Percutor Bosch Ref CSH-776655',
    });
    const aiMeta: ParsedFinancialDocument = {
      title: 'Cuota 2 Cashea',
      amount: 30,
      currency: 'USD',
      bcvRateApplied: 50,
      scope: 'personal',
      pillar: 'expense',
      expenseCategory: 'cashea_installment',
      channel: 'bs_bank',
      referenceNumber: 'CSH-776655',
      entityName: 'EPA',
      date: '2026-11-22',
      isCashea: true,
      casheaInstallmentNumber: 2,
      confidence: 0.95,
    };

    component.destinationMode.set('finance360');
    component.selectedVaultId.set('vault-bs-1');
    component.receipts.set([rec]);
    component.aiMetadataByReceiptId.set(new Map([[rec.id, aiMeta]]));

    component.settleToFinance360(rec);

    // Exact Finance360Service.markCasheaInstallmentPaid signature:
    // (planId, installmentNumber, paymentRef, bcvRateApplied, debitVaultId)
    expect(finance360Mock.markCasheaInstallmentPaid).toHaveBeenCalledWith(
      'cashea-plan-1',
      2,
      'CSH-776655',
      50,
      'vault-bs-1',
    );
    expect(finance360Mock.addExpense).not.toHaveBeenCalled();
    expect(component.settledReceiptIds().has(rec.id)).toBe(true);
  });

  it('blocks duplicate settlement when clicked twice or when reference already exists in ledger unless explicitly overridden', () => {
    const rec = makeBankReceipt({ id: 'rec-dup-1', reference: 'REF-554433' });
    component.destinationMode.set('finance360');
    component.financePillar.set('expense');
    component.receipts.set([rec]);

    // First settle succeeds
    component.settleToFinance360(rec);
    expect(finance360Mock.addExpense).toHaveBeenCalledTimes(1);
    expect(component.settledReceiptIds().has('rec-dup-1')).toBe(true);

    // Second settle on same receipt ID is blocked
    component.settleToFinance360(rec);
    expect(finance360Mock.addExpense).toHaveBeenCalledTimes(1);
    expect(toastMock.warn).toHaveBeenCalled();

    // New receipt ID with reference already present in Finance 360 ledger is also blocked
    finance360Mock.isDuplicateReference.mockReturnValue(true);
    const rescanned = makeBankReceipt({ id: 'rec-dup-2', reference: 'REF-554433' });
    component.settleToFinance360(rescanned);
    expect(finance360Mock.addExpense).toHaveBeenCalledTimes(1);

    // Explicit override allows settlement
    component.settleToFinance360(rescanned, { allowDuplicateOverride: true });
    expect(finance360Mock.addExpense).toHaveBeenCalledTimes(2);
    expect(finance360Mock.addExpense).toHaveBeenLastCalledWith(
      expect.objectContaining({ referenceNumber: 'REF-554433' }),
      { allowDuplicateRef: true },
    );
  });

  it('never invents 60.0 or * 1.15 FX fallback when rates are offline (0) in settleToFinance360 and generateCashReceipt', () => {
    finance360Mock.currentBcvRate.set(0);
    finance360Mock.currentParallelRate.set(0);

    const rec = makeBankReceipt({
      id: 'rec-offline-1',
      reference: 'OFF-101',
      amount: 500,
      currency: 'VES',
    });

    component.destinationMode.set('finance360');
    component.financePillar.set('expense');
    component.settleToFinance360(rec);

    expect(finance360Mock.addExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        triMonetary: expect.objectContaining({
          bcv_rate: 0,
          parallel_rate: 0,
          amount_usd: 0,
          amount_ves: 500,
        }),
      }),
      expect.anything(),
    );

    component.generateCashReceipt(rec);
    expect(cashReceiptMock.printReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        bcvRateApplied: 0,
        amountUsd: 0,
        amountVes: 500,
      }),
    );
  });

  it('preserves EUR and USDT currencies, uses VET date (UTC-4), and uses pymeProfile().businessName', () => {
    // 2026-11-23T02:30:00Z is 2026-11-22 22:30 in VET (UTC-4)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T02:30:00.000Z'));

    const eurRec = makeBankReceipt({
      id: 'rec-eur-1',
      reference: 'EUR-9001',
      amount: 100,
      currency: 'VES', // fallback from BankReceiptRecord union
      beneficiaryName: undefined,
      rawText: 'Transferencia SEPA 100 EUR Ref EUR-9001',
    });
    const eurAiMeta: ParsedFinancialDocument = {
      title: 'Pago licencia software EUR',
      amount: 100,
      currency: 'EUR',
      bcvRateApplied: 50,
      scope: 'business',
      pillar: 'expense',
      expenseCategory: 'services',
      channel: 'other',
      referenceNumber: 'EUR-9001',
      date: '',
      isCashea: false,
      confidence: 0.92,
    };

    component.destinationMode.set('finance360');
    component.financeScope.set('business');
    component.financePillar.set('expense');
    component.aiMetadataByReceiptId.set(new Map([[eurRec.id, eurAiMeta]]));

    component.settleToFinance360(eurRec);

    expect(finance360Mock.addExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-11-22',
        triMonetary: expect.objectContaining({
          currency: 'EUR',
          amount_original: 100,
        }),
      }),
      expect.anything(),
    );

    component.generateCashReceipt(eurRec);
    expect(cashReceiptMock.printReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-11-22',
        receiverName: 'Taller Automotriz El Progreso C.A.',
        businessName: 'Taller Automotriz El Progreso C.A.',
      }),
    );
  });

  it('renders income category selector in template when financePillar is set to income', () => {
    const fixture = TestBed.createComponent(ReceiptScanner);
    const cmp = fixture.componentInstance;
    cmp.destinationMode.set('finance360');
    cmp.financePillar.set('income');
    fixture.detectChanges();

    const incomeSelect = fixture.nativeElement.querySelector(
      'select[aria-label="Categoría de ingreso"], #finance-income-category',
    ) as HTMLSelectElement | null;
    expect(incomeSelect).not.toBeNull();
    expect(incomeSelect?.textContent).toContain('Venta');
  });
});

describe('ReceiptScanner (O5 Modular Cockpit, Blacklist, SHA-256, Batch, Inline Edit, P2P Guard & Drive)', () => {
  let component: ReceiptScanner;
  let storageStore: Record<string, unknown>;
  let toastMock: {
    success: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
  let pipelineMock: {
    preprocessReceiptImage: ReturnType<typeof vi.fn>;
    loadSession: ReturnType<typeof vi.fn>;
    saveSession: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
    computeSha256: ReturnType<typeof vi.fn>;
    findDuplicateByHash: ReturnType<typeof vi.fn>;
  };
  let mcpMock: {
    hasNativeTransport: ReturnType<typeof vi.fn>;
    testTool: ReturnType<typeof vi.fn>;
  };
  let registeredTogglePalette: (() => void) | null;
  let registeredEscape: (() => boolean) | null;
  let unregisterPaletteSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    storageStore = { 'p2p.operations': [] };
    registeredTogglePalette = null;
    registeredEscape = null;
    unregisterPaletteSpy = vi.fn();

    toastMock = {
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    pipelineMock = {
      preprocessReceiptImage: vi.fn().mockResolvedValue({
        processedDataUrl: 'data:image/png;base64,PROC',
        thumbnailDataUrl: 'data:image/jpeg;base64,THUMB_123',
        originalDataUrl: 'data:image/png;base64,ORIG',
        width: 800,
        height: 1200,
        wasDarkModeInverted: false,
        sha256Hash: 'a'.repeat(64),
        canvasApplied: true,
      }),
      loadSession: vi.fn().mockResolvedValue([]),
      saveSession: vi.fn(),
      clearSession: vi.fn(),
      computeSha256: vi.fn().mockResolvedValue('a'.repeat(64)),
      findDuplicateByHash: vi.fn().mockReturnValue(undefined),
    };

    mcpMock = {
      hasNativeTransport: vi.fn().mockReturnValue(false),
      testTool: vi.fn().mockResolvedValue({ success: true, executionTimeMs: 42 }),
    };

    const blockedCounterparties: Counterparty[] = [
      {
        id: 'cp-blocked',
        alias: 'Estafador_VIP',
        realName: 'Carlos Fraude Alerta',
        documentId: 'V-19888999',
        reputation: 'BLOCKED',
        notes: 'Triangulación confirmada',
        createdAt: '2026-02-28',
      },
    ];

    TestBed.configureTestingModule({
      imports: [ReceiptScanner],
      providers: [
        {
          provide: StorageService,
          useValue: {
            get: vi.fn((key: string) => storageStore[key]),
            set: vi.fn((key: string, val: unknown) => {
              storageStore[key] = val;
            }),
          },
        },
        { provide: ToastService, useValue: toastMock },
        { provide: AccountsService, useValue: { accounts: signal([]), refreshLedger: vi.fn() } },
        {
          provide: CounterpartyService,
          useValue: {
            counterparties: signal<Counterparty[]>(blockedCounterparties),
            findByQuery: vi.fn().mockReturnValue(undefined),
          },
        },
        {
          provide: CotizaveService,
          useValue: {
            ratesByMarket: signal({ binance: { mid: 52, ask: 52.5, bid: 51.5 } }),
            ratesProvenance: signal('live'),
          },
        },
        {
          provide: Finance360Service,
          useValue: {
            assets: signal<AssetVault[]>([]),
            state: signal({ casheaPlans: [], incomes: [], expenses: [] }),
            pymeProfile: signal({ businessName: 'Pyme Test' }),
            currentBcvRate: signal<number>(50),
            currentParallelRate: signal<number>(60),
            isDuplicateReference: vi.fn().mockReturnValue(false),
            addExpense: vi.fn(),
            addIncome: vi.fn(),
            addLiability: vi.fn(),
            markCasheaInstallmentPaid: vi.fn(),
          },
        },
        {
          provide: FinanceAiIngestorService,
          useValue: {
            analyzeReceiptImage: vi.fn().mockResolvedValue(null),
            parseWithHeuristics: vi.fn(),
          },
        },
        {
          provide: CashReceiptGeneratorService,
          useValue: {
            generateReceiptNumber: vi.fn().mockReturnValue('REC-1'),
            printReceipt: vi.fn(),
          },
        },
        { provide: ReceiptOcrPipelineService, useValue: pipelineMock },
        { provide: McpService, useValue: mcpMock },
        {
          provide: HotkeysService,
          useValue: {
            registerScopedPalette: vi.fn(
              (onToggle: () => void, onEsc?: () => boolean) => {
                registeredTogglePalette = onToggle;
                registeredEscape = onEsc ?? null;
                return unregisterPaletteSpy;
              },
            ),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ReceiptScanner);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('flags BLACKLISTED_ENTITY (CRITICAL) when receipt payerId matches a BLOCKED CounterpartyService record', () => {
    component.processManualText(
      'Banesco Pago Movil Bs 1500,00 Ref 88221144 Pagador: Carlos Fraude Alerta CI V-19888999',
    );
    expect(component.receipts().length).toBe(1);
    const rec = component.receipts()[0];
    const audit = component.receiptAudits().get(rec.id);

    expect(audit?.riskLevel).toBe('CRITICAL');
    expect(audit?.flags).toContain('BLACKLISTED_ENTITY');
  });

  it('detects duplicate images by SHA-256 hash and processes multi-file batches sequentially', async () => {
    vi.mocked(Tesseract.recognize)
      .mockResolvedValueOnce({ data: { text: 'Banesco Bs 500 Ref 11223344' } } as never)
      .mockResolvedValueOnce({ data: { text: 'Banesco Bs 500 Ref 11223344' } } as never);

    const f1 = new File(['img1'], 'cap1.png', { type: 'image/png' });
    const f2 = new File(['img1'], 'cap2.png', { type: 'image/png' });
    await component.processImageFiles([f1, f2]);

    expect(component.receipts().length).toBe(2);
    expect(component.receipts()[0].isDuplicate).toBe(true);
    expect(toastMock.warn).toHaveBeenCalledWith(expect.stringContaining('SHA-256'));
    expect(pipelineMock.saveSession).toHaveBeenCalled();
  });

  it('recalculates forensic audit live when editing a receipt in Split-View Inspector', () => {
    component.expectedCounterparty.set('Maria Rodriguez');
    component.expectedAmount.set(2000);
    component.processManualText(
      'Banesco Pago Movil Bs 1000,00 Ref 99887766 Pagador: Desconocido Uno',
    );

    const original = component.receipts()[0];
    component.openInspector(original);
    const beforeScore = component.selectedReceiptAudit()?.overallScore ?? 0;

    component.onInspectorReceiptUpdated({
      ...original,
      payerName: 'Maria Rodriguez',
      amount: 2000,
    });

    const afterAudit = component.selectedReceiptAudit();
    expect(component.receipts()[0].payerName).toBe('Maria Rodriguez');
    expect(afterAudit).not.toBeNull();
    expect(afterAudit?.overallScore ?? 100).toBeLessThan(beforeScore);
  });

  it('enforces P2P duplicate settlement guard and attaches compressed thumbnail to Operation', () => {
    const rec = makeBankReceipt({ id: 'rec-p2p-1', reference: '77665544' });
    component.receipts.set([rec]);
    component.thumbnailsByReceiptId.set(new Map([[rec.id, 'data:image/jpeg;base64,THUMB_P2P']]));

    component.settleToLedger(rec);
    const opsAfterFirst = storageStore['p2p.operations'] as Operation[];
    expect(opsAfterFirst.length).toBe(1);
    expect(opsAfterFirst[0].receiptImage).toBe('data:image/jpeg;base64,THUMB_P2P');

    // Duplicate blocked by settled ID
    component.settleToLedger(rec);
    expect((storageStore['p2p.operations'] as Operation[]).length).toBe(1);
    expect(toastMock.warn).toHaveBeenCalled();

    // Duplicate blocked by reference even on new receipt ID
    const dupRec = makeBankReceipt({ id: 'rec-p2p-2', reference: '77665544' });
    component.settleToLedger(dupRec);
    expect((storageStore['p2p.operations'] as Operation[]).length).toBe(1);

    // Explicit override succeeds
    component.settleToLedger(dupRec, { allowDuplicateOverride: true });
    expect((storageStore['p2p.operations'] as Operation[]).length).toBe(2);
  });

  it('reports Google Drive backup honestly (DISCONNECTED vs LIVE native MCP)', async () => {
    const rec = makeBankReceipt({ id: 'rec-drive-1', reference: 'DRV-1001' });
    component.receipts.set([rec]);

    // Disconnected web mode: must NOT fake success
    mcpMock.hasNativeTransport.mockReturnValue(false);
    await component.backupReceiptToDrive(rec);
    expect(mcpMock.testTool).not.toHaveBeenCalled();
    expect(component.driveBackedUpIds().has(rec.id)).toBe(false);
    expect(toastMock.warn).toHaveBeenCalledWith(expect.stringContaining('DISCONNECTED'));

    // Connected native Electron MCP mode: calls gdrive_backup_receipt and marks backed up
    mcpMock.hasNativeTransport.mockReturnValue(true);
    await component.backupReceiptToDrive(rec);
    expect(mcpMock.testTool).toHaveBeenCalledWith(
      'gdrive_backup_receipt',
      expect.objectContaining({ tradeId: 'DRV-1001' }),
    );
    expect(component.driveBackedUpIds().has(rec.id)).toBe(true);
  });

  it('registers scoped Ctrl+K palette via HotkeysService and closes cleanly on Escape', () => {
    expect(registeredTogglePalette).not.toBeNull();
    expect(component.isPaletteOpen()).toBe(false);

    registeredTogglePalette?.();
    expect(component.isPaletteOpen()).toBe(true);

    const handled = registeredEscape?.();
    expect(handled).toBe(true);
    expect(component.isPaletteOpen()).toBe(false);
  });
});
