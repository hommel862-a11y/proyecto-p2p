import { describe, it, expect } from 'vitest';
import {
  evaluateAdRepricingTool,
  publishAdPriceTool,
  toggleAdStatusTool,
  auditAdCompetitivenessTool,
} from './index.js';

describe('P2P Ad Automaker / Repricer MCP Tool Suite', () => {
  describe('evaluate_ad_repricing', () => {
    const mockCompetitors = [
      {
        advertiserName: 'SpamMerchant',
        price: 78.5,
        surplusAmount: 10, // low surplus (below 200 USDT)
        finishRate: 0.95,
      },
      {
        advertiserName: 'UnreliableMerchant',
        price: 78.6,
        surplusAmount: 500,
        finishRate: 0.82, // low completion rate (< 90%)
      },
      {
        advertiserName: 'TopMaker1',
        price: 78.7,
        surplusAmount: 1500,
        finishRate: 0.98,
      },
      {
        advertiserName: 'TopMaker2',
        price: 78.8,
        surplusAmount: 800,
        finishRate: 0.95,
      },
    ];

    it('filters out spoofing and low-reputation competitors and sets BUY price correctly', () => {
      const res = evaluateAdRepricingTool.execute({
        side: 'BUY',
        targetRank: 'TOP_1',
        stepVes: 0.05,
        minCompetitorOrderLimitUsdt: 200,
        minCompetitorFinishRatePct: 90,
        competitorOrders: mockCompetitors,
      });

      expect(res.circuitBreakerTriggered).toBe(false);
      expect(res.recommendedAction).toBe('UPDATE_PRICE');
      // Top valid competitor for BUY (sorted descending) is TopMaker2 at 78.80
      expect(res.targetCompetitorPrice).toBe(78.8);
      expect(res.targetCompetitorMerchant).toBe('TopMaker2');
      // BUY step added: 78.80 + 0.05 = 78.85
      expect(res.suggestedPrice).toBe(78.85);
    });

    it('calculates SELL pricing and enforces break-even floor price', () => {
      const sellCompetitors = [
        {
          advertiserName: 'CheapMaker',
          price: 77.0,
          surplusAmount: 1000,
          finishRate: 0.99,
        },
        {
          advertiserName: 'SecondMaker',
          price: 77.5,
          surplusAmount: 1000,
          finishRate: 0.99,
        },
      ];

      // With break-even floor at 77.20, undercut price (77.00 - 0.05 = 76.95) must be clamped to floor
      const res = evaluateAdRepricingTool.execute({
        side: 'SELL',
        targetRank: 'TOP_1',
        stepVes: 0.05,
        breakEvenFloorPrice: 77.2,
        competitorOrders: sellCompetitors,
      });

      expect(res.recommendedAction).toBe('APPLY_BREAK_EVEN_FLOOR');
      expect(res.suggestedPrice).toBe(77.2);
    });

    it('triggers circuit breaker and pauses ad when bank account saturation is 100%', () => {
      const res = evaluateAdRepricingTool.execute({
        side: 'BUY',
        targetRank: 'TOP_1',
        accountSaturationPct: 100,
        competitorOrders: mockCompetitors,
      });

      expect(res.circuitBreakerTriggered).toBe(true);
      expect(res.breakerType).toBe('ACCOUNT_SATURATION');
      expect(res.recommendedAction).toBe('PAUSE_AD');
      expect(res.suggestedPrice).toBeNull();
    });

    it('triggers circuit breaker when BCV intervention is actively underway', () => {
      const res = evaluateAdRepricingTool.execute({
        side: 'BUY',
        targetRank: 'TOP_1',
        bcvInterventionActive: true,
        competitorOrders: mockCompetitors,
      });

      expect(res.circuitBreakerTriggered).toBe(true);
      expect(res.breakerType).toBe('BCV_INTERVENTION');
      expect(res.recommendedAction).toBe('HOLD_OR_WIDEN');
      expect(res.suggestedPrice).toBeNull();
    });
  });

  describe('publish_ad_price', () => {
    it('successfully publishes simulated or live price within safe deviation parameters', () => {
      const res = publishAdPriceTool.execute({
        adId: 'AD-9928192',
        exchange: 'BINANCE_P2P',
        side: 'BUY',
        newPrice: 78.5,
        expectedPreviousPrice: 78.0,
        maxPriceDeviationPct: 3.0,
        dryRun: true,
        rationale: 'Top 1 positioning after microstructural shift',
      });

      expect(res.success).toBe(true);
      expect(res.publishedPrice).toBe(78.5);
      expect(res.dryRun).toBe(true);
      expect(res.status).toBe('SIMULATED_SUCCESS');
      expect(res.auditTrail.guardrailChecked).toBe(true);
      expect(res.auditTrail.signature).toContain('SIG-AD-');
    });

    it('aborts and rejects price update when fat-finger deviation exceeds guardrail threshold', () => {
      const res = publishAdPriceTool.execute({
        adId: 'AD-9928192',
        exchange: 'BINANCE_P2P',
        side: 'BUY',
        newPrice: 85.0, // > 8% jump from 78.0
        expectedPreviousPrice: 78.0,
        maxPriceDeviationPct: 3.0,
        dryRun: false,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('DESVÍO PELIGROSO RECHAZADO');
      expect(res.deviationPct).toBeGreaterThan(3.0);
    });
  });

  describe('toggle_ad_status', () => {
    it('allows pausing and resuming ads with institutional audit reason', () => {
      const pauseRes = toggleAdStatusTool.execute({
        adId: 'AD-1002',
        exchange: 'BINANCE_P2P',
        action: 'PAUSE',
        reason: 'BANK_DAILY_LIMIT_REACHED',
        notes: 'Banesco daily saturation reached 100%',
      });

      expect(pauseRes.success).toBe(true);
      expect(pauseRes.currentStatus).toBe('PAUSED');

      const resumeRes = toggleAdStatusTool.execute({
        adId: 'AD-1002',
        exchange: 'BINANCE_P2P',
        action: 'RESUME',
        reason: 'ACCOUNT_ROTATED',
        notes: 'Switched to Mercantil fresh account',
      });

      expect(resumeRes.success).toBe(true);
      expect(resumeRes.currentStatus).toBe('ACTIVE');
    });

    it('requires human confirmation to permanently CLOSE an ad', () => {
      const res = toggleAdStatusTool.execute({
        adId: 'AD-1002',
        exchange: 'BINANCE_P2P',
        action: 'CLOSE',
        reason: 'ARBITRAGE_SESSION_COMPLETE',
        humanConfirm: false,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('requiere confirmación humana');
    });
  });

  describe('audit_ad_competitiveness', () => {
    const competitors = [
      { merchantName: 'MerchantA', price: 79.0, finishRatePct: 99, maxLimitVes: 50000 },
      { merchantName: 'MerchantB', price: 78.8, finishRatePct: 98, maxLimitVes: 35000 },
      { merchantName: 'MerchantC', price: 78.5, finishRatePct: 95, maxLimitVes: 20000 },
      { merchantName: 'MerchantSpam', price: 78.0, finishRatePct: 70, maxLimitVes: 500 }, // suspicious
    ];

    it('correctly ranks position and alerts when displaced from desired TOP_1', () => {
      // My price is 78.70 on BUY side (79.00 and 78.80 are above me) -> Rank 3
      const res = auditAdCompetitivenessTool.execute({
        adId: 'AD-1002',
        myCurrentPrice: 78.7,
        side: 'BUY',
        competitors,
        desiredRank: 'TOP_1',
      });

      expect(res.currentRank).toBe('TOP_3');
      expect(res.isMeetingTargetRank).toBe(false);
      expect(res.totalCompetitorsAnalyzed).toBe(4);
      expect(res.suspiciousCompetitorsCount).toBe(1);
      expect(res.leaderPrice).toBe(79.0);
    });

    it('reports healthy status when meeting desired rank', () => {
      // My price is 79.10 on BUY side -> Rank 1
      const res = auditAdCompetitivenessTool.execute({
        adId: 'AD-1002',
        myCurrentPrice: 79.1,
        side: 'BUY',
        competitors,
        desiredRank: 'TOP_1',
      });

      expect(res.currentRank).toBe('TOP_1');
      expect(res.isMeetingTargetRank).toBe(true);
      expect(res.assessment).toContain('Posición competitiva saludable');
    });
  });
});
