import { describe, it, expect } from 'vitest';
import {
  parseBinanceP2pItems,
  computeMarketDepth,
  filterOffersByPayMethod,
  buildBinanceSearchPayload,
} from './binance-p2p';

describe('Binance P2P Market Depth Engine', () => {
  const mockBuyResponse = {
    data: [
      {
        adv: {
          advNo: 'adv-buy-1',
          price: '802.50',
          minSingleTransAmount: '500',
          maxSingleTransAmount: '15000',
          tradeMethods: [{ tradeMethodName: 'Banesco' }, { tradeMethodName: 'PagoMovil' }],
        },
        advertiser: {
          nickName: 'TraderVzla_Top',
          monthOrderCount: 450,
          monthFinishRate: 0.98,
        },
      },
      {
        adv: {
          advNo: 'adv-buy-2',
          price: '805.00',
          minSingleTransAmount: '1000',
          maxSingleTransAmount: '50000',
          tradeMethods: [{ tradeMethodName: 'Mercantil' }],
        },
        advertiser: {
          nickName: 'CaracasCrypto',
          monthOrderCount: 120,
          monthFinishRate: 0.95,
        },
      },
    ],
  };

  const mockSellResponse = {
    data: [
      {
        adv: {
          advNo: 'adv-sell-1',
          price: '822.00',
          minSingleTransAmount: '2000',
          maxSingleTransAmount: '80000',
          tradeMethods: [{ tradeMethodName: 'Banesco' }],
        },
        advertiser: {
          nickName: 'MerchantVip',
          monthOrderCount: 890,
          monthFinishRate: 0.99,
        },
      },
      {
        adv: {
          advNo: 'adv-sell-2',
          price: '826.50',
          minSingleTransAmount: '500',
          maxSingleTransAmount: '20000',
          tradeMethods: [{ tradeMethodName: 'PagoMovil' }],
        },
        advertiser: {
          nickName: 'FastPay',
          monthOrderCount: 300,
          monthFinishRate: 0.97,
        },
      },
    ],
  };

  it('builds valid standard Binance search payload', () => {
    const payload = buildBinanceSearchPayload('USDT', 'VES', 'BUY', 'Banesco', 10);
    expect(payload.asset).toBe('USDT');
    expect(payload.fiat).toBe('VES');
    expect(payload.tradeType).toBe('BUY');
    expect(payload.payTypes).toEqual(['Banesco']);
    expect(payload.rows).toBe(10);
  });

  it('parses raw items and cleans money values', () => {
    const parsed = parseBinanceP2pItems(mockBuyResponse);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].price).toBe(802.5);
    expect(parsed[0].merchantName).toBe('TraderVzla_Top');
    expect(parsed[0].finishRatePct).toBe(98);
    expect(parsed[0].payMethods).toContain('Banesco');
  });

  it('filters offers by payment method correctly', () => {
    const parsed = parseBinanceP2pItems(mockBuyResponse);
    const banescoOnly = filterOffersByPayMethod(parsed, 'Banesco');
    expect(banescoOnly).toHaveLength(1);
    expect(banescoOnly[0].merchantName).toBe('TraderVzla_Top');

    const all = filterOffersByPayMethod(parsed, 'ALL');
    expect(all).toHaveLength(2);
  });

  it('computes live market depth and spread metrics accurately', () => {
    const depth = computeMarketDepth(mockBuyResponse, mockSellResponse, 'USDT', 'VES');

    // Lowest buy: 802.50
    expect(depth.bestBuyPrice).toBe(802.5);
    // Highest sell: 826.50
    expect(depth.bestSellPrice).toBe(826.5);
    // Spread = 826.50 - 802.50 = 24.00 VES
    expect(depth.spreadVes).toBe(24);
    // Spread % = (24 / 802.5) * 100 = 2.99%
    expect(depth.spreadPct).toBe(2.99);
    expect(depth.buyOffers).toHaveLength(2);
    expect(depth.sellOffers).toHaveLength(2);
  });

  it('computes payment-method specific spread for Banesco', () => {
    const depth = computeMarketDepth(mockBuyResponse, mockSellResponse, 'USDT', 'VES', 'Banesco');

    // Banesco buy: 802.50
    expect(depth.bestBuyPrice).toBe(802.5);
    // Banesco sell: 822.00 (adv-sell-1 has Banesco, adv-sell-2 has PagoMovil)
    expect(depth.bestSellPrice).toBe(822);
    // Spread: 822 - 802.5 = 19.50 VES
    expect(depth.spreadVes).toBe(19.5);
  });

  it('preserves fullBuyOffers and fullSellOffers (up to 20 sorted) while keeping 5-row top slices and discarding NaN prices', () => {
    const manyBuys = {
      data: Array.from({ length: 12 }, (_, idx) => ({
        adv: {
          advNo: `b-${idx}`,
          price: String(812 - idx), // deliberately reverse order: 812 down to 801
          minSingleTransAmount: '500',
          maxSingleTransAmount: '25000',
          tradeMethods: [{ tradeMethodName: 'Banesco' }],
        },
        advertiser: { nickName: `MakerB${idx}`, monthOrderCount: 100, monthFinishRate: 0.98 },
      })).concat([
        {
          adv: {
            advNo: 'b-nan',
            price: 'NaN',
            minSingleTransAmount: '500',
            maxSingleTransAmount: '25000',
            tradeMethods: [{ tradeMethodName: 'Banesco' }],
          },
          advertiser: { nickName: 'Broken', monthOrderCount: 10, monthFinishRate: 0.9 },
        },
      ]),
    };
    const manySells = {
      data: Array.from({ length: 12 }, (_, idx) => ({
        adv: {
          advNo: `s-${idx}`,
          price: String(780 + idx), // deliberately ascending: 780 up to 791
          minSingleTransAmount: '500',
          maxSingleTransAmount: '25000',
          tradeMethods: [{ tradeMethodName: 'Banesco' }],
        },
        advertiser: { nickName: `MakerS${idx}`, monthOrderCount: 100, monthFinishRate: 0.98 },
      })),
    };

    const depth = computeMarketDepth(manyBuys, manySells, 'USDT', 'VES');
    expect(depth.buyOffers).toHaveLength(5);
    expect(depth.sellOffers).toHaveLength(5);
    expect(depth.fullBuyOffers).toHaveLength(12);
    expect(depth.fullSellOffers).toHaveLength(12);
    // fullBuyOffers sorted ascending (cheapest asks first)
    expect(depth.fullBuyOffers?.[0].price).toBe(801);
    expect(depth.fullBuyOffers?.[11].price).toBe(812);
    // fullSellOffers sorted descending (highest bids first)
    expect(depth.fullSellOffers?.[0].price).toBe(791);
    expect(depth.fullSellOffers?.[11].price).toBe(780);
  });
});
