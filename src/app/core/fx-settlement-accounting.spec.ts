import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { TelegramWorkerService } from './telegram-worker.service';
import { AccountsService } from './accounts.service';
import { StorageService } from './storage';
import { AuditLoggerService } from './audit-logger.service';
import { CotizaveService } from './cotizave.service';
import { BinanceP2pService } from './binance-p2p.service';
import { BinanceRepricerService } from './binance-repricer.service';
import { MarketHistoryService } from './market-history.service';
import { CredentialStoreService } from './credential-store.service';
import { ToastService } from './toast.service';
import { DecisionJournalService } from './decision-journal.service';
import { FinanceTelegramBridgeService } from './services/finance-telegram-bridge.service';
import { FinanceAiIngestorService } from './services/finance-ai-ingestor.service';
import { VoiceDictationService } from './voice-dictation.service';
import { P2PRadarService } from './p2p-radar.service';
import { SecureVaultService } from './secure-vault.service';
import { computeFifoAccounting, OPS_KEY, type BankAccount, type Operation } from '@p2p/core';

describe('TelegramWorkerService — FX Settlement Accounting, Multi-Account Split & Anti-Replay', () => {
  let worker: TelegramWorkerService;
  let accountsService: AccountsService;
  let store: Record<string, unknown>;
  let auditSpy: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    store = {};
    const mockStorage = {
      get: vi.fn((k: string) => store[k] ?? null),
      set: vi.fn((k: string, v: unknown) => {
        store[k] = v;
      }),
      remove: vi.fn((k: string) => {
        delete store[k];
      }),
    };
    auditSpy = { log: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        TelegramWorkerService,
        AccountsService,
        { provide: StorageService, useValue: mockStorage },
        { provide: AuditLoggerService, useValue: auditSpy },
        {
          provide: CotizaveService,
          useValue: {
            ratesByMarket: signal({ bcv: { mid: 62.5 } }),
            refreshIfStale: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: BinanceP2pService,
          useValue: {
            marketDepth: signal({ bestBuyPrice: 84.5, bestSellPrice: 84.1, spreadPct: 0.4, spreadVes: 0.4 }),
            lastFetched: signal(new Date()),
          },
        },
        {
          provide: BinanceRepricerService,
          useValue: {
            isActive: signal(false),
            currentBuyAdPrice: signal(0),
            currentSellAdPrice: signal(0),
            executionModeLabel: signal('READ_ONLY'),
            executionModeDetail: signal('Read only'),
          },
        },
        { provide: MarketHistoryService, useValue: { getRecentTicks: vi.fn().mockReturnValue([]) } },
        {
          provide: CredentialStoreService,
          useValue: {
            getTelegramConfig: vi.fn().mockResolvedValue({ botToken: '', chatId: '', alertsEnabled: false }),
          },
        },
        { provide: ToastService, useValue: { success: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
        { provide: DecisionJournalService, useValue: { availability: { degraded: false } } },
        { provide: FinanceTelegramBridgeService, useValue: { setTelegramWorker: vi.fn() } },
        { provide: FinanceAiIngestorService, useValue: {} },
        { provide: VoiceDictationService, useValue: {} },
        { provide: P2PRadarService, useValue: {} },
        { provide: SecureVaultService, useValue: { getSecret: vi.fn().mockResolvedValue(null), storeSecret: vi.fn().mockResolvedValue(undefined) } },
      ],
    });

    accountsService = TestBed.inject(AccountsService);
    worker = TestBed.inject(TelegramWorkerService);
  });

  it('starts with empty fxFluidBanks (zero fake pre-fluid banks on boot)', () => {
    expect(worker.fxFluidBanks()).toEqual([]);
  });

  it('counts bankFeeVes EXACTLY ONCE in both bank account usage and FIFO PnL (B-01 fix)', () => {
    const bdvAcc: BankAccount = {
      id: 'bdv-tr-main',
      bankName: 'BDV Transferencia',
      bankCode: 'BDV',
      rail: 'TRANSFERENCIA',
      accountNumberMasked: '0102-***1092',
      dailyLimitVes: 250000,
      initialBalanceVes: 100000,
    };
    store['p2p.bank-accounts'] = [bdvAcc];
    // Re-create accounts state with the custom account
    accountsService.accounts.set([bdvAcc]);

    // Buy $1,000 USD at BCV 62.50 -> principal = 62,500.00 Bs, 0.25% fee = 156.25 Bs -> totalDebit = 62,656.25 Bs
    const res = worker.settleFxBankPurchase('BDV', 1000, 62.5, {
      idempotencyKey: 'test-1x-fee',
    });
    expect(res).not.toBeNull();
    expect(res!.operation.vesAmount).toBe(62500);
    expect(res!.operation.fees).toBe(156.25);
    expect(res!.operation.merchantNote).toContain('USD=1000');

    // Account balance MUST decrease by 62,656.25 Bs (1x fee), NEVER 62,812.50 Bs (2x fee)!
    const usage = accountsService.usages()[0];
    expect(usage.spentTodayVes).toBe(62656.25);
    expect(usage.currentBalanceVes).toBe(37343.75);

    // FIFO accounting: sell the exact netUsdt received for 80,000 Bs (0 sell fee)
    const netUsdt = res!.operation.usdtAmount;
    const sellOp: Operation = {
      id: 'sell-1',
      timestamp: new Date().toISOString(),
      type: 'sell',
      pair: 'USDT',
      vesAmount: 80000,
      usdtAmount: netUsdt,
      price: Number((80000 / netUsdt).toFixed(2)),
      merchantNote: 'SELL_P2P',
      fees: 0,
      notes: '',
      errorFree: true,
    };
    const fifo = computeFifoAccounting([res!.operation, sellOp]);
    // Realized PnL MUST equal 80,000 - 62,500 - 156.25 = 17,343.75 Bs (exact 1x fee!)
    expect(fifo.realizedPnlVes).toBeCloseTo(17343.75, 2);
    expect(auditSpy.log).toHaveBeenCalledWith(
      'DATA_MUTATION',
      'FX_SETTLEMENT_BOOKED',
      expect.objectContaining({ bankId: 'BDV', purchasedUsd: 1000, totalDebitVes: 62656.25 }),
      'info',
    );

    // Replay with same idempotencyKey must be rejected
    const replay = worker.settleFxBankPurchase('BDV', 1000, 62.5, {
      idempotencyKey: 'test-1x-fee',
    });
    expect(replay).toBeNull();
  });

  it('splits multi-account settlements without overdrafting primaryAcc and blocks unlinked banks', () => {
    const banA: BankAccount = {
      id: 'ban-a',
      bankName: 'Banesco Jurídica A',
      bankCode: 'BANESCO',
      rail: 'TRANSFERENCIA',
      accountNumberMasked: '0134-***4821',
      dailyLimitVes: 200000,
      initialBalanceVes: 51200,
    };
    const banB: BankAccount = {
      id: 'ban-b',
      bankName: 'Banesco Natural B',
      bankCode: 'BANESCO',
      rail: 'TRANSFERENCIA',
      accountNumberMasked: '0134-***9104',
      dailyLimitVes: 200000,
      initialBalanceVes: 25900,
    };
    accountsService.accounts.set([banA, banB]);

    // Unlinked bank (CIEN_BANCO has no account) must return null (no phantom FIFO!)
    expect(worker.settleFxBankPurchase('CIEN_BANCO', 100, 62.45)).toBeNull();

    // $1,200 USD at Banesco @ 62.45 (~75,127.35 Bs) splits into $800 on banA + $400 on banB!
    const splitRes = worker.settleFxBankPurchase('BANESCO', 1200, 62.45);
    expect(splitRes).not.toBeNull();
    expect(splitRes!.operations.length).toBe(2);

    const usages = accountsService.usages();
    expect(usages[0].currentBalanceVes).toBeGreaterThanOrEqual(0);
    expect(usages[1].currentBalanceVes).toBeGreaterThanOrEqual(0);

    // Verify OPS_KEY has 2 clean operations
    const savedOps = store[OPS_KEY] as Operation[];
    expect(savedOps.length).toBe(2);
  });
});
