import { describe, it, expect } from 'vitest';
import {
  evaluateSnipingOpportunity,
  scanOrderbookSnipingOpportunities,
  type P2pOrderbookAdItem,
} from './orderbook-sniper';

describe('OrderbookSniper Engine', () => {
  const fairPrice = 85.0;

  it('detects a distressed SELL ad priced below fair market price', () => {
    const distressedAd: P2pOrderbookAdItem = {
      advId: 'ADV-101',
      merchantName: 'TraderUrgente',
      orderType: 'SELL',
      price: 82.5, // 2.94% cheaper than 85.0
      availableAmountCrypto: 1000,
      minLimitFiat: 500,
      maxLimitFiat: 82500,
      paymentMethods: ['Banesco', 'Pago Móvil'],
    };

    const alert = evaluateSnipingOpportunity(distressedAd, {
      fairMarketPrice: fairPrice,
      maxTakerFeePct: 0.1,
    });
    expect(alert).not.toBeNull();
    expect(alert?.advId).toBe('ADV-101');
    expect(alert?.priceDivergencePct).toBeCloseTo(2.94, 1);
    expect(alert?.netProfitUsd).toBeGreaterThan(25);
    expect(alert?.isActionable).toBe(true);
    expect(alert?.recommendedAction).toBe('SNIPE_IMMEDIATELY');
  });

  it('flags extreme fat-finger anomalies with PROCEED_WITH_CAUTION', () => {
    const fatFingerAd: P2pOrderbookAdItem = {
      advId: 'ADV-FAT',
      merchantName: 'ErrorMerchant',
      orderType: 'SELL',
      price: 75.0, // > 11% divergence
      availableAmountCrypto: 2000,
      minLimitFiat: 100,
      maxLimitFiat: 150000,
      paymentMethods: ['Mercantil'],
    };

    const alert = evaluateSnipingOpportunity(fatFingerAd, {
      fairMarketPrice: fairPrice,
      maxTakerFeePct: 0.1,
    });
    expect(alert).not.toBeNull();
    expect(alert?.recommendedAction).toBe('PROCEED_WITH_CAUTION');
    expect(alert?.riskRationale).toContain('Desvío extremo');
  });

  it('never declares isActionable without an explicit taker fee', () => {
    const ad: P2pOrderbookAdItem = {
      advId: 'ADV-NOFEE',
      merchantName: 'TraderSinFeeConocida',
      orderType: 'SELL',
      price: 82.5,
      availableAmountCrypto: 1000,
      minLimitFiat: 500,
      maxLimitFiat: 82500,
      paymentMethods: ['Banesco', 'Pago Móvil'],
    };

    // maxTakerFeePct omitted: the price gap is real, the net margin is unknown.
    const alert = evaluateSnipingOpportunity(ad, { fairMarketPrice: fairPrice });
    expect(alert).not.toBeNull();
    expect(alert?.isActionable).toBe(false);
    expect(alert?.reason).toBe('MISSING_FRICTION_METRICS');
    expect(alert?.takerFeePct).toBeNull();
    expect(alert?.netYieldPct).toBeNull();
    expect(alert?.netProfitUsd).toBe(0);
    expect(alert?.recommendedAction).not.toBe('SNIPE_IMMEDIATELY');
    expect(alert?.riskRationale).toContain('fricción desconocida');
  });

  it('ignores dust orders below the minimum liquidity floor', () => {
    const dustAd: P2pOrderbookAdItem = {
      advId: 'ADV-DUST',
      merchantName: 'DustAccount',
      orderType: 'SELL',
      price: 80.0,
      availableAmountCrypto: 15, // Less than $50 floor
      minLimitFiat: 100,
      maxLimitFiat: 1200,
      paymentMethods: ['Pago Móvil'],
    };

    const alert = evaluateSnipingOpportunity(dustAd, { fairMarketPrice: fairPrice, minLiquidityFloorUsd: 50 });
    expect(alert).toBeNull();
  });

  it('scans and ranks multiple ads by net profit descending', () => {
    const ads: P2pOrderbookAdItem[] = [
      {
        advId: 'A1',
        merchantName: 'Normal',
        orderType: 'SELL',
        price: 85.0,
        availableAmountCrypto: 500,
        minLimitFiat: 100,
        maxLimitFiat: 5000,
        paymentMethods: ['Banesco'],
      },
      {
        advId: 'A2',
        merchantName: 'SmallSnipe',
        orderType: 'SELL',
        price: 83.0, // ~2.35%
        availableAmountCrypto: 500,
        minLimitFiat: 100,
        maxLimitFiat: 5000,
        paymentMethods: ['Banesco'],
      },
      {
        advId: 'A3',
        merchantName: 'BigSnipe',
        orderType: 'SELL',
        price: 83.0, // ~2.35%
        availableAmountCrypto: 3000,
        minLimitFiat: 100,
        maxLimitFiat: 30000,
        paymentMethods: ['Banesco'],
      },
    ];

    const alerts = scanOrderbookSnipingOpportunities(ads, {
      fairMarketPrice: fairPrice,
      maxTakerFeePct: 0.1,
    });
    expect(alerts).toHaveLength(2);
    expect(alerts[0].advId).toBe('A3'); // Higher profit first
    expect(alerts[1].advId).toBe('A2');
  });
});
