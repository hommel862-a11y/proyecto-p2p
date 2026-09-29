import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdComposerService } from './ad-composer.service';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import { McpAdPublisherService } from './mcp-ad-publisher.service';
import { ToastService } from './toast.service';
import type { BinanceP2pMarketDepth } from '@p2p/core';

describe('AdComposerService', () => {
  let svc: AdComposerService;

  const mockToast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  const mockDepth: BinanceP2pMarketDepth = {
    asset: 'USDT',
    fiat: 'VES',
    bestBuyPrice: 78.5,
    bestSellPrice: 79.8,
    spreadVes: 1.3,
    spreadPct: 1.65,
    updatedAt: new Date().toISOString(),
    buyOffers: [
      {
        advNo: 'b1',
        price: 78.4,
        merchantName: 'TraderPro',
        finishRatePct: 98,
        orderCount: 400,
        minVes: 1000,
        maxVes: 25000,
        payMethods: ['Banesco'],
      },
    ],
    sellOffers: [
      {
        advNo: 's1',
        price: 79.8,
        merchantName: 'SellerPro',
        finishRatePct: 99,
        orderCount: 500,
        minVes: 1000,
        maxVes: 30000,
        payMethods: ['Banesco'],
      },
    ],
  };

  const mockBinance = {
    fetchMarketDepth: vi.fn(async () => mockDepth),
  };

  const mockAccount = {
    id: 'acc-1',
    bankName: 'Banesco',
    bankCode: 'BANESCO',
    rail: 'PAGO_MOVIL' as const,
    accountNumberMasked: '0134***456',
    dailyLimitVes: 50000,
    initialBalanceVes: 50000,
    status: 'ACTIVE' as const,
  };

  const mockAccounts = {
    accounts: () => [mockAccount],
    usages: () => [
      {
        account: mockAccount,
        spentTodayVes: 10000,
        remainingVes: 40000,
        isOverLimit: false,
        isNearLimit: false,
      },
    ],
  };

  const mockPublisher = {
    isEnabled: vi.fn(() => false),
    isDryRun: vi.fn(() => true),
    maxDeviationPct: vi.fn(() => 3.0),
    enablePublishing: vi.fn(),
    publish: vi.fn(async () => true),
  };

  beforeEach(() => {
    mockToast.success.mockReset();
    mockToast.warn.mockReset();
    mockToast.error.mockReset();
    mockBinance.fetchMarketDepth.mockReset();
    mockBinance.fetchMarketDepth.mockResolvedValue(mockDepth);
    mockPublisher.publish.mockReset();
    mockPublisher.publish.mockResolvedValue(true);

    const injector = Injector.create({
      providers: [
        { provide: ToastService, useValue: mockToast },
        { provide: BinanceP2pService, useValue: mockBinance },
        { provide: AccountsService, useValue: mockAccounts },
        { provide: McpAdPublisherService, useValue: mockPublisher },
        AdComposerService,
      ],
    });

    svc = injector.get(AdComposerService);
  });

  it('composes an ad draft and sets reactive signals', async () => {
    svc.side.set('BUY');
    const draft = await svc.composeDraft();

    expect(draft).not.toBeNull();
    expect(draft?.side).toBe('BUY');
    expect(draft?.price).toBe(78.4);
    expect(draft?.selectedBank).toBe('Banesco');
    expect(draft?.maxLimitVes).toBe(40000);
    expect(svc.currentDraft()).toBe(draft);
    expect(svc.readyToPublish()).toBe(true);
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('publishes the staged draft via McpAdPublisher', async () => {
    await svc.composeDraft();
    const success = await svc.publishStagedDraft();

    expect(success).toBe(true);
    expect(mockPublisher.publish).toHaveBeenCalledWith({
      buyPrice: 78.4,
      sellPrice: 0,
      strategy: 'TOP_1',
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('generates formatted clipboard summary', async () => {
    await svc.composeDraft();
    const summary = svc.getClipboardSummary();

    expect(summary).toContain('ANUNCIO P2P (BUY USDT)');
    expect(summary).toContain('78.40 VES');
    expect(summary).toContain('Banesco');
    expect(summary).toContain('TÉRMINOS Y CONDICIONES');
  });
});
