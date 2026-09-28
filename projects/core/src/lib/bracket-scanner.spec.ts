import { describe, it, expect } from 'vitest';
import {
  filterOffersByBracket,
  detectOtcWhaleBlocks,
  CAPITAL_BRACKETS,
} from './bracket-scanner';
import { type BinanceOfferSummary } from './binance-p2p';

describe('BracketScanner & OTC Whale Detector', () => {
  const dummyOffers: BinanceOfferSummary[] = [
    {
      advNo: 'adv-dust',
      price: 89.0,
      minVes: 100,
      maxVes: 500, // < $20 USD (at 70 VES/USD, $20 = 1400 VES)
      finishRatePct: 99,
      orderCount: 150,
      merchantName: 'TraderDust',
      payMethods: ['Pago Movil'],
    },
    {
      advNo: 'adv-inframundo',
      price: 90.0,
      minVes: 5000,
      maxVes: 12000,
      finishRatePct: 98,
      orderCount: 400,
      merchantName: 'TraderFast',
      payMethods: ['Banesco'],
    },
    {
      advNo: 'adv-medio',
      price: 90.5,
      minVes: 50000,
      maxVes: 100000,
      finishRatePct: 97,
      orderCount: 800,
      merchantName: 'TraderMid',
      payMethods: ['Banesco', 'Mercantil'],
    },
    {
      advNo: 'adv-whale',
      price: 91.0,
      minVes: 200000,
      maxVes: 14000000, // 14,000,000 VES / 70 = $200,000 USD (Whale block!)
      finishRatePct: 99.5,
      orderCount: 2500,
      merchantName: 'InstitucionalJRA',
      payMethods: ['Banesco'],
    },
  ];

  it('filters offers accurately for the Inframundo bracket and purges dust orders', () => {
    const res = filterOffersByBracket(dummyOffers, 'INFRAMUNDO', {
      exchangeRateVesPerUsd: 70,
      minSafetyFloorUsd: 20,
    });

    expect(res.bracket.id).toBe('INFRAMUNDO');
    expect(res.purgedDustCount).toBe(1); // adv-dust purged
    expect(res.offers).toHaveLength(1);
    expect(res.offers[0].advNo).toBe('adv-inframundo');
    expect(res.bestPrice).toBe(90.0);
  });

  it('filters offers for the Medio bracket correctly', () => {
    const res = filterOffersByBracket(dummyOffers, 'MEDIO', {
      exchangeRateVesPerUsd: 70,
    });

    expect(res.offers).toHaveLength(1);
    expect(res.offers[0].advNo).toBe('adv-medio');
  });

  it('detects massive OTC whale blocks and recommends market surge anticipation', () => {
    const report = detectOtcWhaleBlocks(dummyOffers, 70, 100000);

    expect(report.whaleDetected).toBe(true);
    expect(report.whaleBlocks).toHaveLength(1);
    expect(report.whaleBlocks[0].merchantName).toBe('InstitucionalJRA');
    expect(report.whaleBlocks[0].estimatedVolumeUsd).toBe(200000);
    expect(report.recommendedAction).toBe('ANTICIPATE_PRICE_SURGE');
  });

  it('triggers PAUSE_BUYS when total whale volume exceeds $250k USD', () => {
    const doubleWhaleOffers: BinanceOfferSummary[] = [
      ...dummyOffers,
      {
        advNo: 'adv-whale-2',
        price: 91.2,
        minVes: 100000,
        maxVes: 10500000, // $150,000 USD
        finishRatePct: 99,
        orderCount: 1500,
        merchantName: 'VanpCapital',
        payMethods: ['Banesco'],
      },
    ];

    const report = detectOtcWhaleBlocks(doubleWhaleOffers, 70, 100000);
    expect(report.whaleDetected).toBe(true);
    expect(report.totalWhaleVolumeUsd).toBe(350000);
    expect(report.recommendedAction).toBe('PAUSE_BUYS_PHANTOM_CORRECTION');
  });
});
