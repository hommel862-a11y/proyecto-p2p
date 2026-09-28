import { describe, it, expect } from 'vitest';
import {
  composeAdDraft,
  filterAntiSpoofingOffers,
  type BankAccountProfile,
} from './ad-auto-composer.js';
import type { BinanceP2pMarketDepth } from './repricer.js';

describe('ad-auto-composer domain engine', () => {
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
        price: 78.5,
        merchantName: 'FakeMaker',
        finishRatePct: 75, // spoofing / low completion
        orderCount: 20,
        minVes: 100,
        maxVes: 500, // micro limit
        payMethods: ['Banesco'],
      },
      {
        advNo: 'b2',
        price: 78.4,
        merchantName: 'ProTrader',
        finishRatePct: 98,
        orderCount: 500,
        minVes: 1000,
        maxVes: 30000,
        payMethods: ['Banesco', 'Pago Móvil'],
      },
    ],
    sellOffers: [
      {
        advNo: 's1',
        price: 79.8,
        merchantName: 'ProSeller',
        finishRatePct: 99,
        orderCount: 800,
        minVes: 1000,
        maxVes: 40000,
        payMethods: ['Mercantil', 'Pago Móvil'],
      },
    ],
  };

  const mockAccounts: BankAccountProfile[] = [
    {
      bankName: 'Banesco',
      dailyLimitVes: 50000,
      currentVolumeVes: 10000,
      status: 'ACTIVE',
      isPagoMovil: true,
    },
    {
      bankName: 'Mercantil',
      dailyLimitVes: 30000,
      currentVolumeVes: 30000,
      status: 'FROZEN_TODAY', // saturated
      isPagoMovil: true,
    },
  ];

  it('filters anti-spoofing offers correctly', () => {
    const filtered = filterAntiSpoofingOffers(mockDepth.buyOffers, 90);
    expect(filtered.length).toBe(1);
    expect(filtered[0].merchantName).toBe('ProTrader');
  });

  it('composes a complete BUY ad draft bound to Banesco available cupo', () => {
    const draft = composeAdDraft({
      side: 'BUY',
      marketDepth: mockDepth,
      activeBankAccounts: mockAccounts,
      strategy: 'UNDERCUT',
      stepVes: 0.05,
      minTicketUsdt: 20,
      merchantName: 'TraderProVZLA',
    });

    expect(draft.side).toBe('BUY');
    expect(draft.asset).toBe('USDT');
    expect(draft.fiat).toBe('VES');
    // Top reputable BUY price is 78.40 + 0.05 step = 78.45
    expect(draft.price).toBe(78.45);
    expect(draft.selectedBank).toBe('Banesco');
    // Banesco available: 50,000 - 10,000 = 40,000 VES
    expect(draft.selectedAccountCupoRemainingVes).toBe(40000);
    expect(draft.maxLimitVes).toBe(40000);
    expect(draft.minLimitVes).toBeGreaterThanOrEqual(1000);
    expect(draft.totalAssetAmountUsdt).toBeCloseTo(40000 / 78.45, 1);
    expect(draft.paymentMethods).toContain('Pago Móvil');
    expect(draft.terms).toContain('Pago Móvil');
    expect(draft.readyToPublish).toBe(true);
    expect(draft.guardrails.antiSpoofingPassed).toBe(true);
    expect(draft.guardrails.bankCapacitySafe).toBe(true);
  });

  it('enforces break-even floor for SELL side draft', () => {
    const draft = composeAdDraft({
      side: 'SELL',
      marketDepth: mockDepth,
      activeBankAccounts: mockAccounts,
      strategy: 'TOP_1',
      stepVes: 0.05,
      breakEvenSellPrice: 80.0, // Floor above market 79.75
    });

    expect(draft.side).toBe('SELL');
    expect(draft.price).toBe(80.0);
    expect(draft.guardrails.breakEvenSafe).toBe(false);
    expect(draft.guardrails.flags).toContain('BREAK_EVEN_FLOOR_APPLIED');
  });

  it('disables readyToPublish when all bank accounts are saturated or disabled', () => {
    const saturatedAccounts: BankAccountProfile[] = [
      {
        bankName: 'Banesco',
        dailyLimitVes: 50000,
        currentVolumeVes: 50000,
        status: 'FROZEN_TODAY',
      },
      {
        bankName: 'Mercantil',
        dailyLimitVes: 30000,
        currentVolumeVes: 30000,
        status: 'DISABLED',
      },
    ];

    const draft = composeAdDraft({
      side: 'BUY',
      marketDepth: mockDepth,
      activeBankAccounts: saturatedAccounts,
    });

    expect(draft.readyToPublish).toBe(false);
    expect(draft.guardrails.bankCapacitySafe).toBe(false);
    expect(draft.guardrails.flags).toContain('NO_ACTIVE_BANK_CAPACITY');
  });
});
