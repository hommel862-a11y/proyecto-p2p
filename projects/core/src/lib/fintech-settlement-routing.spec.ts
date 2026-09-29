import { describe, it, expect } from 'vitest';
import {
  calculateFintechSettlementQuote,
  type FintechSettlementRequest,
} from './fintech-settlement-routing';

describe('FintechSettlementRouting Engine', () => {
  it('calculates Deel settlement for remote contractor with low fee and immediate release', () => {
    const req: FintechSettlementRequest = {
      platform: 'DEEL',
      grossAmountUsd: 3500,
      payoutRail: 'USDT_TRC20',
      clientTier: 'RECURRENT_REMOTE',
      isVerifiedContractor: true,
    };

    const quote = calculateFintechSettlementQuote(req);
    expect(quote.chargebackRiskTier).toBe('LOW');
    expect(quote.holdHoursRequired).toBe(0);
    expect(quote.deskCommissionPct).toBe(3.9);
    expect(quote.netProceedsUsd).toBeCloseTo(3363.5, 1);
    expect(quote.formattedClientProposal).toContain('LIQUIDACIÓN NÓMINA');
  });

  it('imposes hold hours and risk surcharge for high-risk PayPal transfers', () => {
    const req: FintechSettlementRequest = {
      platform: 'PAYPAL',
      grossAmountUsd: 1000,
      payoutRail: 'VES_PAGO_MOVIL',
      vesRatePerUsd: 85.0,
    };

    const quote = calculateFintechSettlementQuote(req);
    expect(quote.chargebackRiskTier).toBe('HIGH_HOLD_REQUIRED');
    expect(quote.holdHoursRequired).toBe(24);
    expect(quote.deskCommissionPct).toBeGreaterThan(5.5);
    expect(quote.netProceedsVes).toBeDefined();
    expect(quote.netProceedsVes).toBeGreaterThan(0);
  });
});
