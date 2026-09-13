import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateSpreadTool,
  evaluateTradeRiskTool,
  simulateTradeImpactTool,
  consultZkMarketMeshTool,
  forecastVolatilityWindowTool,
  calculateDeltaNeutralHedgeTool,
  triggerKillswitchTool,
  addOperationEntryTool,
} from './tools/index.js';
import { resetKillswitchForTesting } from './tools/trigger_killswitch.js';
import { auditService } from './policy/audit.js';
import { rateLimiter } from './policy/permissions.js';

describe('P2P MCP Server Suite', () => {
  beforeEach(() => {
    resetKillswitchForTesting();
  });

  describe('Tools: Quantitative & Financial Engines', () => {
    it('calculate_spread computes gross and net spread accurately', () => {
      const res = calculateSpreadTool.execute({
        buyPrice: 85.0,
        sellPrice: 86.5,
        makerFeePct: 0.1,
        takerFeePct: 0.1,
      });

      expect(res.unitSpread).toBeCloseTo(1.5);
      expect(res.netSpreadPercent).toBeGreaterThan(1.0);
      expect(res.isGoldenSpread).toBe(true);
      expect(res.recommendation).toBe('VIABLE_INSTITUCIONAL');
    });

    it('evaluate_trade_risk executes the 6 safety rules deterministically', () => {
      const safeTrade = evaluateTradeRiskTool.execute({
        tradeAmountUsdt: 500,
        currentCapitalUsdt: 5000,
        fiatCurrency: 'VES',
        counterpartyScore: 95,
      });

      expect(safeTrade.decision).toBe('ALLOW');
      expect(safeTrade.isCounterpartyAcceptable).toBe(true);

      const riskyTrade = evaluateTradeRiskTool.execute({
        tradeAmountUsdt: 2500, // 50% of capital -> exceeds 20% limit
        currentCapitalUsdt: 5000,
        fiatCurrency: 'VES',
        counterpartyScore: 40,
      });

      expect(riskyTrade.decision).toBe('DENY');
      expect(riskyTrade.violations.length).toBeGreaterThan(0);
    });

    it('simulate_trade_impact detects daily exposure breaches', () => {
      const sim = simulateTradeImpactTool.execute({
        proposedTradeAmountUsdt: 1200,
        currentExposureUsdt: 1000,
        maxDailyExposureLimitUsdt: 2000,
        consecutiveLosses: 0,
      });

      expect(sim.limitExceeded).toBe(true);
      expect(sim.projectedExposureUsdt).toBe(2200);
      expect(sim.wouldTrigger).toContain('DAILY_EXPOSURE_LIMIT_EXCEEDED');
      expect(sim.verdict).toBe('REQUIRES_REDUCTION');
    });

    it('consult_zk_market_mesh preserves zero-knowledge and queries blind hashes', () => {
      const query = consultZkMarketMeshTool.execute({
        rawIdentifier: 'V-18293041',
      });

      expect(query.blindHash).toHaveLength(64);
      expect(query.privacyGuaranteed).toBe(true);
      expect(query.verdict).toBe('CLEAR_NO_FEDERATED_FLAGS');
    });

    it('forecast_volatility_window evaluates BCV cycles and market spread dynamics', () => {
      const forecast = forecastVolatilityWindowTool.execute({
        parallelRate: 88.5,
        bcvRate: 72.0,
        currentSpreadPct: 1.4,
        askDepthUsdt: 6000,
        bidDepthUsdt: 3000,
      });

      expect(forecast.gapPct).toBeGreaterThan(20);
      expect(forecast.spreadDynamic).toBeDefined();
      expect(forecast.suggestedAction).toBeDefined();
    });

    it('calculate_delta_neutral_hedge calculates required short coverage for VES', () => {
      const hedge = calculateDeltaNeutralHedgeTool.execute({
        vesBalance: 88500,
        usdtReferencePrice: 88.5,
        targetHedgePct: 100,
      });

      expect(hedge.usdtValueEquivalent).toBe(1000);
      expect(hedge.requiredShortHedgeUsdt).toBe(1000);
      expect(hedge.projectedLossIfUnhedged5PctUsd).toBe(50);
    });
  });

  describe('Tools: Human-in-the-Loop & Audit Safety', () => {
    it('trigger_killswitch requests human confirmation challenge token when humanConfirm is false', () => {
      const unconfirmed = triggerKillswitchTool.execute({
        reason: 'Volatilidad anómala en paralelo',
        source: 'AI_AGENT',
        humanConfirm: false,
      });

      expect(unconfirmed.triggered).toBe(false);
      expect(unconfirmed.requiresHumanConfirmation).toBe(true);
      expect(unconfirmed.challengeToken).toBeDefined();

      const confirmed = triggerKillswitchTool.execute({
        reason: 'Volatilidad anómala en paralelo',
        source: 'AI_AGENT',
        humanConfirm: true,
      });

      expect(confirmed.triggered).toBe(true);
      expect(confirmed.verdict).toBe('ALL_OPERATIONS_FROZEN_SUCCESSFULLY');
    });

    it('add_operation_entry protects ledger writes behind human confirmation', () => {
      const unconfirmed = addOperationEntryTool.execute({
        side: 'buy',
        vesAmount: 88500,
        usdtAmount: 1000,
        price: 88.5,
        humanConfirm: false,
      });

      expect(unconfirmed.recorded).toBe(false);
      expect(unconfirmed.requiresHumanConfirmation).toBe(true);

      const confirmed = addOperationEntryTool.execute({
        side: 'buy',
        vesAmount: 88500,
        usdtAmount: 1000,
        price: 88.5,
        humanConfirm: true,
      });

      expect(confirmed.recorded).toBe(true);
      expect(confirmed.orderId).toContain('ORD-MCP-');
    });

    it('auditService records deterministic SHA-256 hashes of inputs and outputs', () => {
      const record = auditService.record({
        toolName: 'calculate_spread',
        input: { buyPrice: 80, sellPrice: 82 },
        output: { netSpreadPercent: 2.5 },
      });

      expect(record.inputHash).toHaveLength(64);
      expect(record.outputHash).toHaveLength(64);
      expect(record.toolName).toBe('calculate_spread');
      expect(auditService.getRecentAuditEntries()).toContain(record);
    });

    it('rateLimiter prevents spamming the tools beyond threshold', () => {
      const tool = 'test_heavy_tool';
      expect(rateLimiter.checkLimit(tool, 2)).toBe(true);
      expect(rateLimiter.checkLimit(tool, 2)).toBe(true);
      expect(rateLimiter.checkLimit(tool, 2)).toBe(false);
    });
  });
});
