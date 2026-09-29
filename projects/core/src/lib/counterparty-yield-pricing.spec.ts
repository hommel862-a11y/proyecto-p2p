import { describe, it, expect } from 'vitest';
import {
  calculateDynamicCounterpartyPricing,
  classifyCounterpartyTier,
  type DynamicPricingRequest,
} from './counterparty-yield-pricing';

describe('CounterpartyYieldPricing Engine', () => {
  it('identifies VIP_INSTITUTIONAL client and offers a volume discount', () => {
    const req: DynamicPricingRequest = {
      metrics: {
        counterpartyId: 'trader-vip-99',
        averageReleaseMinutes: 2.1,
        completedTradesCount: 40,
        disputeCount: 0,
        monthlyVolumeUsd: 25000,
      },
      baseMarketRate: 85.0,
      orderType: 'SELL',
      requestedAmountUsd: 5000,
    };

    const res = calculateDynamicCounterpartyPricing(req);
    expect(res.tier).toBe('VIP_INSTITUTIONAL');
    expect(res.spreadAdjustmentPct).toBeLessThan(0);
    expect(res.recommendedMaxExposureUsd).toBe(50000);
  });

  it('imposes a friction surcharge on slow counterparties (>20 mins)', () => {
    const req: DynamicPricingRequest = {
      metrics: {
        counterpartyId: 'slow-trader-01',
        averageReleaseMinutes: 28,
        completedTradesCount: 15,
        disputeCount: 0,
        monthlyVolumeUsd: 3000,
      },
      baseMarketRate: 85.0,
      orderType: 'SELL',
      requestedAmountUsd: 1000,
    };

    const res = calculateDynamicCounterpartyPricing(req);
    expect(res.tier).toBe('SLOW_OR_FRICTIONAL');
    expect(res.spreadAdjustmentPct).toBeGreaterThan(1.0);
    expect(res.adjustedRate).toBeGreaterThan(85.0);
  });

  it('classifies accounts with dispute history as HIGH_RISK_SURCHARGE', () => {
    const tier = classifyCounterpartyTier({
      counterpartyId: 'dispute-user',
      averageReleaseMinutes: 5,
      completedTradesCount: 5,
      disputeCount: 2,
      monthlyVolumeUsd: 500,
    });
    expect(tier).toBe('HIGH_RISK_SURCHARGE');
  });
});
