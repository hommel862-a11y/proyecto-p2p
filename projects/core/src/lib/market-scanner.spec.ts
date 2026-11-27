import { describe, it, expect } from 'vitest';
import {
  HIGH_DEMAND_TIERS_USDT,
  MAKER_FEE_RATES,
  filterQualifiedCompetitors,
  offerAbsorbsCapital,
  computeHighDemandScan,
  type HighDemandScanOptions,
} from './market-scanner';
import type { BinanceOfferSummary, BinanceP2pMarketDepth } from './binance-p2p';

describe('Market Scanner: Radar de Alta Demanda (Core)', () => {
  const mockOffer = (
    price: number,
    minVes: number,
    maxVes: number,
    finishRate = 95,
    orderCount = 120,
    bank = 'Banesco',
  ): BinanceOfferSummary => ({
    advNo: 'adv-' + Math.random(),
    price,
    merchantName: 'Trader_' + price,
    finishRatePct: finishRate,
    orderCount,
    minVes,
    maxVes,
    payMethods: [bank],
  });

  it('defines tiers starting strictly from 1,000 USDT', () => {
    expect(HIGH_DEMAND_TIERS_USDT[0]).toBe(1000);
    expect(HIGH_DEMAND_TIERS_USDT).toContain(2500);
    expect(HIGH_DEMAND_TIERS_USDT).toContain(5000);
    expect(HIGH_DEMAND_TIERS_USDT).toContain(10000);
  });

  it('includes standard unverified maker fee rate (0.25%) and VIP levels', () => {
    expect(MAKER_FEE_RATES.STANDARD).toBe(0.0025);
    expect(MAKER_FEE_RATES.BRONZE).toBe(0.002);
    expect(MAKER_FEE_RATES.SILVER).toBe(0.00175);
    expect(MAKER_FEE_RATES.GOLD).toBe(0.00125);
  });

  it('filters out ghost competitors with finishRate < 90% or low order count', () => {
    const rawOffers = [
      mockOffer(50.0, 100, 100000, 95, 150), // Qualified
      mockOffer(50.1, 100, 100000, 85, 200), // Ghost: low finish rate
      mockOffer(50.2, 100, 100000, 98, 10), // Ghost: low order count
    ];

    const filtered = filterQualifiedCompetitors(rawOffers);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].price).toBe(50.0);
  });

  it('checks capital absorption accurately for given VES amounts', () => {
    const offer = mockOffer(50.0, 1000, 60000); // Max 60,000 Bs

    // 50,000 Bs fits in [1000, 60000]
    expect(offerAbsorbsCapital(offer, 50000)).toBe(true);
    // 80,000 Bs exceeds maxVes 60,000
    expect(offerAbsorbsCapital(offer, 80000)).toBe(false);
    // 500 Bs is below minVes 1,000
    expect(offerAbsorbsCapital(offer, 500)).toBe(false);
  });

  it('computes accurate high-demand tier scan with micro-undercutting and maker fee deduction', () => {
    // Reference price around 60 VES/USDT
    // 1,000 USDT = ~60,000 VES
    const depth: BinanceP2pMarketDepth = {
      asset: 'USDT',
      fiat: 'VES',
      bestBuyPrice: 59.5,
      bestSellPrice: 60.5,
      spreadVes: 1.0,
      spreadPct: 1.68,
      updatedAt: new Date().toISOString(),
      buyOffers: [
        mockOffer(59.5, 5000, 300000, 98, 300, 'Banesco'), // Competitor buys at 59.50
        mockOffer(59.4, 1000, 500000, 95, 200, 'Banesco'),
      ],
      sellOffers: [
        mockOffer(60.5, 5000, 300000, 96, 250, 'Banesco'), // Competitor sells at 60.50
        mockOffer(60.6, 1000, 500000, 97, 400, 'Banesco'),
      ],
    };

    const options: HighDemandScanOptions = {
      merchantLevel: 'STANDARD', // 0.25% fee
      bankFilter: 'Banesco',
      stepVes: 0.01,
    };

    const result = computeHighDemandScan(depth, options);

    expect(result.merchantLevel).toBe('STANDARD');
    expect(result.makerFeeRatePct).toBe(0.25);
    expect(result.tiers.length).toBe(4);

    const tier1k = result.tiers.find((t) => t.tierUsdt === 1000);
    expect(tier1k).toBeDefined();
    if (!tier1k) return;

    expect(tier1k.isActionable).toBe(true);
    // Micro-undercutting:
    // suggestedBuy = bestCompetitorBuy (59.50) + 0.01 = 59.51
    expect(tier1k.suggestedBuyPrice).toBe(59.51);
    // suggestedSell = bestCompetitorSell (60.50) - 0.01 = 60.49
    expect(tier1k.suggestedSellPrice).toBe(60.49);

    // Gross spread = 60.49 - 59.51 = 0.98 Bs
    expect(tier1k.grossSpreadVes).toBe(0.98);
    // Total Maker fees = 0.25% * 2 = 0.50%
    expect(tier1k.totalFeePct).toBe(0.5);

    // Net spread should be positive and less than gross spread
    expect(tier1k.netSpreadPct).toBeGreaterThan(0);
    expect(tier1k.netSpreadPct).toBeLessThan(tier1k.grossSpreadPct);

    // Best opportunity exists
    expect(result.bestOpportunityTier).not.toBeNull();
  });

  it('marks tier as un-actionable when net spread is negative due to compressed gross spread', () => {
    const tightDepth: BinanceP2pMarketDepth = {
      asset: 'USDT',
      fiat: 'VES',
      bestBuyPrice: 60.0,
      bestSellPrice: 60.1,
      spreadVes: 0.1,
      spreadPct: 0.17,
      updatedAt: new Date().toISOString(),
      buyOffers: [mockOffer(60.0, 1000, 100000)],
      sellOffers: [mockOffer(60.1, 1000, 100000)],
    };

    const result = computeHighDemandScan(tightDepth, { merchantLevel: 'STANDARD' });
    const tier1k = result.tiers.find((t) => t.tierUsdt === 1000);
    expect(tier1k?.isActionable).toBe(false);
    expect(tier1k?.statusNote).toContain('Spread comprimido');
  });

  it('supports BINANCE_TAKER orientation from computeMarketDepth without inverting buy/sell Maker quotes', () => {
    // Real Binance Venezuela semantics in computeMarketDepth:
    // depth.buyOffers (tradeType='BUY' -> makers SELLING USDT, lowest first: 79.45..79.80)
    // depth.sellOffers (tradeType='SELL' -> makers BUYING USDT, highest first: 78.40..78.10)
    const binanceDepth: BinanceP2pMarketDepth = {
      asset: 'USDT',
      fiat: 'VES',
      bestBuyPrice: 79.45,
      bestSellPrice: 78.4,
      spreadVes: -1.05,
      spreadPct: -1.32,
      updatedAt: new Date().toISOString(),
      buyOffers: [
        mockOffer(79.45, 5000, 300000, 98, 400, 'Banesco'),
        mockOffer(79.6, 5000, 300000, 98, 350, 'Banesco'),
      ],
      sellOffers: [
        mockOffer(78.4, 5000, 300000, 98, 400, 'Banesco'),
        mockOffer(78.2, 5000, 300000, 98, 350, 'Banesco'),
      ],
    };

    const result = computeHighDemandScan(binanceDepth, {
      merchantLevel: 'STANDARD',
      bankFilter: 'Banesco',
      stepVes: 0.01,
      bookOrientation: 'BINANCE_TAKER',
    });

    const tier1k = result.tiers.find((t) => t.tierUsdt === 1000);
    expect(tier1k).toBeDefined();
    // Maker BUY competes in sellOffers (78.40 + 0.01 = 78.41)
    expect(tier1k?.suggestedBuyPrice).toBe(78.41);
    // Maker SELL competes in buyOffers (79.45 - 0.01 = 79.44)
    expect(tier1k?.suggestedSellPrice).toBe(79.44);
    expect(tier1k?.isActionable).toBe(true);
    expect(tier1k?.netSpreadPct).toBeGreaterThan(0.5);
  });

  it('preserves leading competitor advNo and advertiserNo on TierOpportunityRow', () => {
    const depth: BinanceP2pMarketDepth = {
      asset: 'USDT',
      fiat: 'VES',
      bestBuyPrice: 79.45,
      bestSellPrice: 78.4,
      spreadVes: -1.05,
      spreadPct: -1.32,
      updatedAt: new Date().toISOString(),
      buyOffers: [
        {
          ...mockOffer(79.45, 5000, 300000, 98, 400, 'Banesco'),
          advNo: '11218246497340923904',
          advertiserNo: 'usrSellLeader1',
        },
      ],
      sellOffers: [
        {
          ...mockOffer(78.4, 5000, 300000, 98, 400, 'Banesco'),
          advNo: '11218246497340923999',
          advertiserNo: 'usrBuyLeader1',
        },
      ],
    };

    const result = computeHighDemandScan(depth, {
      merchantLevel: 'STANDARD',
      bankFilter: 'Banesco',
      bookOrientation: 'BINANCE_TAKER',
    });

    const tier1k = result.tiers.find((t) => t.tierUsdt === 1000);
    expect(tier1k?.bestCompetitorBuyAdvNo).toBe('11218246497340923999');
    expect(tier1k?.bestCompetitorBuyAdvertiserNo).toBe('usrBuyLeader1');
    expect(tier1k?.bestCompetitorSellAdvNo).toBe('11218246497340923904');
    expect(tier1k?.bestCompetitorSellAdvertiserNo).toBe('usrSellLeader1');
  });
});
