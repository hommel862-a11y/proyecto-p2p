import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FinanceTelegramBridgeService,
  TELEGRAM_MESSENGER,
  type TelegramMessenger,
} from './finance-telegram-bridge.service';
import { Finance360Service } from '../finance-360.service';
import { VoiceDictationService } from '../voice-dictation.service';
import { ToastService } from '../toast.service';
import { AgentStudioService, MCP_SKILL_CATALOG, FINANCE_360_SPECIALIST_PRESETS } from '../agent-studio.service';
import type { AssetVault, CasheaPlan } from '../models/finance-360.models';
import type { ParsedFinancialDocument } from './finance-ai-ingestor.service';

function createMockVaults(): AssetVault[] {
  return [
    {
      id: 'vault-usd-personal',
      name: 'Efectivo Personal USD',
      channel: 'cash',
      scope: 'personal',
      currency: 'USD',
      balance: 400,
      balanceUsdEquivalent: 400,
      balanceVesEquivalent: 24000,
      updatedAt: '2026-11-22T00:00:00.000Z',
    },
    {
      id: 'vault-usd-pyme',
      name: 'Caja Taller Pyme USD',
      channel: 'cash',
      scope: 'business',
      currency: 'USD',
      balance: 1200,
      balanceUsdEquivalent: 1200,
      balanceVesEquivalent: 72000,
      updatedAt: '2026-11-22T00:00:00.000Z',
    },
    {
      id: 'vault-ves-bank',
      name: 'Banesco Bs',
      channel: 'bs_bank',
      scope: 'all',
      currency: 'VES',
      balance: 60000,
      balanceUsdEquivalent: 1000,
      balanceVesEquivalent: 60000,
      updatedAt: '2026-11-22T00:00:00.000Z',
    },
  ];
}

function createMockCasheaPlan(): CasheaPlan {
  return {
    id: 'plan-cashea-42',
    productName: 'Nevera Mabe',
    storeName: 'Daka',
    scope: 'personal',
    level: 6,
    creditLine: 'principal',
    totalPriceUsd: 300,
    initialPaymentUsd: 120,
    initialPercentage: 40,
    numberOfInstallments: 3,
    installmentAmountUsd: 60,
    installmentFrequencyDays: 14,
    startDate: '2026-11-01',
    status: 'active',
    createdAt: '2026-11-01T10:00:00.000Z',
    installments: [
      { number: 1, dueDate: '2026-11-15', amountUsd: 60, status: 'paid' },
      { number: 2, dueDate: '2026-11-29', amountUsd: 60, status: 'pending' },
      { number: 3, dueDate: '2026-12-13', amountUsd: 60, status: 'pending' },
    ],
  };
}

describe('FinanceTelegramBridgeService', () => {
  let service: FinanceTelegramBridgeService;
  let mockFinance: {
    currentBcvRate: ReturnType<typeof vi.fn>;
    currentParallelRate: ReturnType<typeof vi.fn>;
    assets: ReturnType<typeof vi.fn>;
    state: ReturnType<typeof vi.fn>;
    isDuplicateReference: ReturnType<typeof vi.fn>;
    addExpense: ReturnType<typeof vi.fn>;
    addIncome: ReturnType<typeof vi.fn>;
    calculateCasheaBreakdown: ReturnType<typeof vi.fn>;
    registerCasheaPlan: ReturnType<typeof vi.fn>;
    markCasheaInstallmentPaid: ReturnType<typeof vi.fn>;
    netWorthUsd: ReturnType<typeof vi.fn>;
    netWorthVes: ReturnType<typeof vi.fn>;
    totalAssetsUsd: ReturnType<typeof vi.fn>;
    totalLiabilitiesUsd: ReturnType<typeof vi.fn>;
    liquidityHealthStatus: ReturnType<typeof vi.fn>;
    upcomingLiabilities7Days: ReturnType<typeof vi.fn>;
  };
  let mockTelegram: { sendTelegramMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockFinance = {
      currentBcvRate: vi.fn().mockReturnValue(60),
      currentParallelRate: vi.fn().mockReturnValue(65),
      assets: vi.fn().mockReturnValue(createMockVaults()),
      state: vi.fn().mockReturnValue({ casheaPlans: [createMockCasheaPlan()] }),
      isDuplicateReference: vi.fn().mockReturnValue(false),
      addExpense: vi.fn(),
      addIncome: vi.fn(),
      calculateCasheaBreakdown: vi.fn().mockReturnValue({
        initialPercentage: 40,
        initialPaymentUsd: 60,
        installmentAmountUsd: 30,
        installments: [],
      }),
      registerCasheaPlan: vi.fn().mockReturnValue({
        id: 'plan-1',
        productName: 'Taladro',
        numberOfInstallments: 3,
      }),
      markCasheaInstallmentPaid: vi.fn().mockReturnValue({
        success: true,
        alreadyPaid: false,
        paidAmountUsd: 60,
      }),
      netWorthUsd: vi.fn().mockReturnValue(5000),
      netWorthVes: vi.fn().mockReturnValue(300000),
      totalAssetsUsd: vi.fn().mockReturnValue(6000),
      totalLiabilitiesUsd: vi.fn().mockReturnValue(1000),
      liquidityHealthStatus: vi.fn().mockReturnValue({ status: 'optimal', label: 'Salud Óptima' }),
      upcomingLiabilities7Days: vi.fn().mockReturnValue([]),
    };

    mockTelegram = {
      sendTelegramMessage: vi.fn().mockResolvedValue(true),
    };

    TestBed.configureTestingModule({
      providers: [
        FinanceTelegramBridgeService,
        VoiceDictationService,
        {
          provide: ToastService,
          useValue: { success: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
        { provide: Finance360Service, useValue: mockFinance },
        { provide: TELEGRAM_MESSENGER, useValue: mockTelegram as TelegramMessenger },
      ],
    });

    service = TestBed.inject(FinanceTelegramBridgeService);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('should parse and register #gasto correctly with matched real vault and VET date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T02:30:00.000Z')); // VET: 2026-11-22

    const res = service.processInboundTelegramCommand(
      '#gasto 20 USD Gasolina para el taller pyme',
      { authorized: true, chatId: 12345 },
    );
    expect(res.success).toBe(true);
    expect(res.action).toBe('expense');
    expect(mockFinance.addExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Gasolina para el taller',
        scope: 'business',
        category: 'transport',
        vaultId: 'vault-usd-pyme',
        date: '2026-11-22',
      }),
    );
  });

  it('should parse and register #ingreso correctly with matched real vault', () => {
    const res = service.processInboundTelegramCommand('#ingreso 120 USD Cobro de presupuesto pyme');
    expect(res.success).toBe(true);
    expect(res.action).toBe('income');
    expect(mockFinance.addIncome).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Cobro de presupuesto',
        scope: 'business',
        category: 'business_sale',
        vaultId: 'vault-usd-pyme',
      }),
    );
  });

  it('should parse and calculate #cashea breakdown for levels 1..6 including Level 6 Araguaney', () => {
    const res = service.processInboundTelegramCommand('#cashea 150 6 Nevera Mabe');
    expect(res.success).toBe(true);
    expect(res.action).toBe('cashea');
    expect(mockFinance.calculateCasheaBreakdown).toHaveBeenCalledWith(150, 6, 3);
    expect(mockFinance.registerCasheaPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        productName: 'Nevera Mabe',
        level: 6,
      }),
    );
    expect(res.replyText).toContain('Nivel 6');
  });

  it('rejects NaN, zero, negative amounts, or out-of-range levels in #cashea without mutating ledger', () => {
    for (const badCmd of [
      '#cashea abc 3 Nevera',
      '#cashea -50 3 Nevera',
      '#cashea 0 3 Nevera',
      '#cashea 150 7 Nevera',
      '#cashea 150 0 Nevera',
    ]) {
      const res = service.processInboundTelegramCommand(badCmd);
      expect(res.success).toBe(false);
      expect(res.action).toBe('cashea');
    }
    expect(mockFinance.calculateCasheaBreakdown).not.toHaveBeenCalled();
    expect(mockFinance.registerCasheaPlan).not.toHaveBeenCalled();
  });

  it('should return financial summary report on #resumen and /360', () => {
    for (const cmd of ['#resumen', '#360', '/finanzas', '/360']) {
      const res = service.processInboundTelegramCommand(cmd);
      expect(res.success).toBe(true);
      expect(res.action).toBe('summary');
      expect(res.replyText).toContain('RESUMEN EJECUTIVO FINANZAS 360');
      expect(res.replyText).toContain('$5000.00 USD');
    }
  });

  it('denies unauthorized callers fail-closed without mutating ledger across text, voice, and photo', () => {
    const deniedText = service.processInboundTelegramCommand('#gasto 50 USD Cafe', {
      authorized: false,
      chatId: 999,
    });
    expect(deniedText.success).toBe(false);

    const deniedVoice = service.ingestVoiceTranscript('Gasté 25 dólares en gasolina', {
      authorized: false,
    });
    expect(deniedVoice.success).toBe(false);

    const deniedPhoto = service.ingestPhotoReceipt(
      {
        title: 'Pago',
        amount: 30,
        currency: 'USD',
        bcvRateApplied: 60,
        scope: 'personal',
        pillar: 'expense',
        channel: 'cash',
        date: '2026-11-22',
        isCashea: false,
        confidence: 0.9,
      },
      '#gasto',
      { authorized: false },
    );
    expect(deniedPhoto.success).toBe(false);

    expect(mockFinance.addExpense).not.toHaveBeenCalled();
    expect(mockFinance.addIncome).not.toHaveBeenCalled();
    expect(mockFinance.markCasheaInstallmentPaid).not.toHaveBeenCalled();
  });

  it('escapes MarkdownV2 reserved characters in dynamic user text safely', () => {
    const res = service.processInboundTelegramCommand(
      '#gasto 45 USD Compra_Repuesto (A+B) [v2.0] - 100%! pyme',
    );
    expect(res.success).toBe(true);
    expect(res.replyText).toContain('Compra\\_Repuesto \\(A\\+B\\) \\[v2\\.0\\] \\- 100%\\!');
  });

  it('ingests valid Spanish voice transcripts and refuses unrecognized audio without inventing expenses', () => {
    const expenseRes = service.ingestVoiceTranscript('Gasté 25 dólares en gasolina', {
      authorized: true,
    });
    expect(expenseRes.success).toBe(true);
    expect(expenseRes.action).toBe('expense');
    expect(mockFinance.addExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'transport',
        vaultId: 'vault-usd-personal',
      }),
    );

    const incomeRes = service.ingestVoiceTranscript('Cobré 120 USD venta taller pyme', {
      authorized: true,
    });
    expect(incomeRes.success).toBe(true);
    expect(incomeRes.action).toBe('income');
    expect(mockFinance.addIncome).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'business',
        category: 'business_sale',
        vaultId: 'vault-usd-pyme',
      }),
    );

    const callsBeforeNoise = mockFinance.addExpense.mock.calls.length;
    const noiseRes = service.ingestVoiceTranscript('Hola buenas tardes nos vemos a las 5', {
      authorized: true,
    });
    expect(noiseRes.success).toBe(false);
    expect(noiseRes.action).toBe('unknown');
    expect(mockFinance.addExpense).toHaveBeenCalledTimes(callsBeforeNoise);
  });

  it('ingests Cashea photo receipts via markCasheaInstallmentPaid and blocks duplicate references', () => {
    const casheaDoc: ParsedFinancialDocument = {
      title: 'Cuota 2 Nevera Mabe',
      amount: 60,
      currency: 'USD',
      bcvRateApplied: 60,
      scope: 'personal',
      pillar: 'expense',
      expenseCategory: 'cashea_installment',
      channel: 'bs_bank',
      referenceNumber: 'CSH-2026-002',
      entityName: 'Daka',
      date: '2026-11-22',
      isCashea: true,
      casheaInstallmentNumber: 2,
      confidence: 0.95,
    };

    const res = service.ingestPhotoReceipt(casheaDoc, '#cashea', { authorized: true });
    expect(res.success).toBe(true);
    expect(res.action).toBe('cashea');
    expect(mockFinance.markCasheaInstallmentPaid).toHaveBeenCalledWith(
      'plan-cashea-42',
      2,
      'CSH-2026-002',
      60,
      'vault-usd-personal',
    );
    expect(mockFinance.addExpense).not.toHaveBeenCalled();

    // Duplicate reference guard
    mockFinance.isDuplicateReference.mockReturnValue(true);
    const dupRes = service.ingestPhotoReceipt(
      { ...casheaDoc, isCashea: false, expenseCategory: 'groceries' },
      '#gasto',
      { authorized: true },
    );
    expect(dupRes.success).toBe(false);
    expect(mockFinance.addExpense).not.toHaveBeenCalled();
  });

  it('should dispatch daily briefing to Telegram when credentials provided', async () => {
    const success = await service.sendDailyBriefingToTelegram('token-123', 'chat-456');
    expect(success).toBe(true);
    expect(mockTelegram.sendTelegramMessage).toHaveBeenCalledWith(
      'token-123',
      'chat-456',
      expect.stringContaining('RESUMEN EJECUTIVO FINANZAS 360'),
    );
  });

  it('should return false if credentials missing when dispatching briefing', async () => {
    const success = await service.sendDailyBriefingToTelegram();
    expect(success).toBe(false);
  });

  it('exposes FINANCE_360 category with all f360_* and treasury skills plus 6 Finanzas 360 / Pyme specialist presets in AgentStudioService', () => {
    const f360Skills = MCP_SKILL_CATALOG.filter((s) => s.category === 'FINANCE_360');
    expect(f360Skills.map((s) => s.id)).toEqual([
      'f360_get_treasury_summary',
      'f360_analyze_cashea_capacity',
      'f360_simulate_cashea_ally_margin',
      'f360_check_pyme_drawers_and_stock',
      'f360_generate_quote_estimate',
      'f360_audit_overdue_and_runway',
      'optimize_treasury_idle_yield',
      'rebalance_capital_allocation',
    ]);

    const presetIds = FINANCE_360_SPECIALIST_PRESETS.map((p) => p.id);
    expect(presetIds).toEqual(
      expect.arrayContaining([
        'finance-cfo',
        'quote-architect',
        'pyme-payroll-agent',
        'pyme-providers-agent',
        'pyme-stock-agent',
        'pyme-capex-agent',
      ]),
    );
    expect(AgentStudioService).toBeDefined();
  });
});
