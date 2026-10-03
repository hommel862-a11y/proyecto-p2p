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
  getBcvRatesTool,
  getParallelRatesTool,
  calculateRateGapTool,
  checkBcvInterventionWindowTool,
  autofillTradeReferenceTool,
  getBinanceP2POrderbookTool,
  detectUsdtDepegTool,
  recommendCompetitivePricingTool,
  analyzeOrderbookPressureTool,
  stressTestPortfolioTool,
  rebalanceCapitalAllocationTool,
  auditCounterpartyExposureTool,
  projectCompoundRunwayTool,
} from './tools/index.js';
import { ratesResources, cryptoResources, portfolioResources } from './resources/index.js';
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
        // Engine state is caller-reported. Without these the tool answers
        // INSUFFICIENT_DATA instead of guessing a clean day.
        currentSpreadPct: 1.25,
        openOps: 1,
        dailyLossPct: 0.4,
        consecutiveErrors: 0,
      });

      expect(safeTrade.decision).toBe('ALLOW');
      expect(safeTrade.isCounterpartyAcceptable).toBe(true);
      expect(safeTrade.unmeasuredInputs).toEqual([]);

      const riskyTrade = evaluateTradeRiskTool.execute({
        tradeAmountUsdt: 2500, // 50% of capital -> exceeds 20% limit
        currentCapitalUsdt: 5000,
        fiatCurrency: 'VES',
        // 95, not 40: this case exists to exercise rule 1. A counterparty of 40 is
        // now refused by the counterparty gate before the engine runs, which is the
        // correct precedence but would leave rule 1 untested here.
        counterpartyScore: 95,
        currentSpreadPct: 1.25,
        openOps: 1,
        dailyLossPct: 0.4,
        consecutiveErrors: 0,
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
        // `currentSpreadPct` used to be passed here. The handler never read it, so
        // the caller's "real" spread was discarded while the schema advertised a
        // `1.2` default for it. The spread is derived from the two rates above.
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

  describe('Phase 2 Tools: Venezuelan Rates & BCV Monitoring', () => {
    it('get_bcv_rates publishes no official rate when there is no live feed', async () => {
      // This used to assert `usd > 0` and `source === 'BCV_OFFICIAL_FEED'`. That
      // locked in a hardcoded 68.45 presented as an official BCV publication.
      const res = await getBcvRatesTool.execute({ cacheFallback: true });

      expect(res.usd).toBeNull();
      expect(res.eur).toBeNull();
      expect(res.effectiveDate).toBeNull();
      expect(res.source).not.toBe('BCV_OFFICIAL_FEED');
      expect(res.provenance).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
      expect(res.actionable).toBe(false);
      // No invented number leaks into the description either.
      expect(JSON.stringify(res)).not.toContain('68.45');
    });

    it('get_parallel_rates only publishes monitors it actually read', async () => {
      // This used to assert `sourcesCount >= 3` and `averageMid > 70`, which the
      // four hardcoded quotes satisfied offline and nothing else could.
      //
      // The feed is now wired to Binance P2P for real, so `sourcesCount` depends
      // on whether the endpoint answered. The invariant that must hold either way
      // is stronger than any fixed count: a monitor is published only if it was
      // read, it says so, and the summary is derived from it rather than asserted.
      const res = await getParallelRatesTool.execute({});

      const sources = Object.values(res.sources) as Array<{
        source: string;
        sourceLabel: string;
        ask: number;
        bid: number;
        mid: number;
      }>;

      // Every published monitor was really read and is labelled LIVE. A monitor
      // the daemon did not poll cannot appear here.
      for (const s of sources) {
        expect(s.sourceLabel).toBe('LIVE');
        expect(s.source).toBeTruthy();
        expect(s.ask).toBeGreaterThan(0);
        expect(s.bid).toBeGreaterThan(0);
        expect(s.ask).toBeGreaterThanOrEqual(s.bid);
      }

      if (res.sourcesCount > 0) {
        expect(res.provenance).toBe('LIVE');
        expect(res.summary.averageMid).not.toBeNull();
        // The summary is computed from the sources, not invented alongside them.
        const midFromSources =
          sources.reduce((acc, s) => acc + s.mid, 0) / sources.length;
        expect(res.summary.averageMid).toBeCloseTo(
          Math.round(midFromSources * 100) / 100,
          2,
        );
      } else {
        // No reading, no number, and the absence says which source would fix it.
        expect(res.provenance).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
        expect(res.summary.averageMid).toBeNull();
        expect(res.summary.highestAsk).toBeNull();
        expect(res.summary.lowestBid).toBeNull();
        expect(res.summary.dispersionPct).toBeNull();
        expect(res.expectedSource).toBeTruthy();
      }

      expect(res.actionable).toBe(false);
    });

    it('calculate_rate_gap accurately identifies gap and risk zones', () => {
      // Normal gap (~15%)
      const normal = calculateRateGapTool.execute({
        parallelRate: 78.7,
        bcvRate: 68.45,
      });
      expect(normal.gapPct).toBeCloseTo(14.97, 1);
      expect(normal.zone).toBe('NORMAL');
      expect(normal.distortionRisk).toBe('MEDIUM');

      // Elevated / critical gap (>35%)
      const critical = calculateRateGapTool.execute({
        parallelRate: 98.0,
        bcvRate: 68.45,
      });
      expect(critical.gapPct).toBeGreaterThan(35);
      expect(critical.zone).toBe('CRITICAL_DISPERSION');
      expect(critical.distortionRisk).toBe('EXTREME');
      expect(critical.isDistortionCritical).toBe(true);
      expect(critical.arbitrageOpportunity).toBe(true);
    });

    it('check_bcv_intervention_window evaluates the banking schedule but invents no probability', async () => {
      // Monday 10:30 AM VET is 14:30 UTC
      const mondayAuction = await checkBcvInterventionWindowTool.execute({
        testTimestamp: '2026-09-14T14:30:00.000Z',
      });

      // The calendar is observable, so the phase is legitimately derived — but
      // "inside the scheduled window" is not proof the BCV intervened.
      expect(mondayAuction.phase).toBe('INTERVENTION_ACTIVE');
      expect(mondayAuction.isInterventionActive).toBe(true);
      expect(mondayAuction.isVerifiedIntervention).toBe(false);
      expect(mondayAuction.tradingDirectives).toContain('VENTANA DE SUBASTA PROGRAMADA');
      // The directive must not claim the BCV placed currency.
      expect(mondayAuction.tradingDirectives).not.toContain('INTERVENCIÓN EN CURSO');

      // The probability is not: 95/85/80/75 came from the day and hour, with no
      // model, no history and no intervention record behind them.
      expect(mondayAuction.probabilityPct).toBeNull();
      expect(mondayAuction.probabilityBasis).toBe('NO_MODEL');
      expect(mondayAuction.actionable).toBe(false);

      // Sunday 10:00 AM VET is 14:00 UTC (Quiet accumulation)
      const sundayOff = await checkBcvInterventionWindowTool.execute({
        testTimestamp: '2026-09-13T14:00:00.000Z',
      });
      expect(sundayOff.isInterventionActive).toBe(false);
      expect(sundayOff.probabilityPct).toBeNull();
    });

    it('autofill_trade_reference optimizes ticket pricing for BUY and SELL sides', () => {
      const buyOrder = autofillTradeReferenceTool.execute({
        side: 'BUY',
        targetMarginPct: 1.5,
        fallbackRate: 80.0,
      });

      expect(buyOrder.side).toBe('BUY');
      expect(buyOrder.suggestedPrice).toBe(78.8); // 80 * (1 - 0.015)
      expect(buyOrder.suggestedPrice).toBeLessThan(buyOrder.referenceMidRate);

      const sellOrder = autofillTradeReferenceTool.execute({
        side: 'SELL',
        targetMarginPct: 1.5,
        fallbackRate: 80.0,
      });

      expect(sellOrder.side).toBe('SELL');
      expect(sellOrder.suggestedPrice).toBe(81.2); // 80 * (1 + 0.015)
      expect(sellOrder.suggestedPrice).toBeGreaterThan(sellOrder.referenceMidRate);
    });
  });

  describe('Phase 2 Resources: Rates Endpoints', () => {
    it('ratesResources expose bcv, parallel, and gap-analysis endpoints', async () => {
      const bcvResource = ratesResources.find((r) => r.uri === 'p2p://rates/bcv');
      expect(bcvResource).toBeDefined();
      const bcvData = (await bcvResource?.read()) as any;
      // The endpoint exists and declares its absence rather than inventing a rate.
      expect(bcvData.provenance).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
      expect(bcvData.usd).toBeNull();

      const parallelResource = ratesResources.find((r) => r.uri === 'p2p://rates/parallel');
      expect(parallelResource).toBeDefined();
      const parallelData = (await parallelResource?.read()) as any;
      expect(parallelData.sources).toEqual({});
      expect(parallelData.summary.averageMid).toBeNull();

      const gapResource = ratesResources.find((r) => r.uri === 'p2p://rates/gap-analysis');
      expect(gapResource).toBeDefined();
      const gapData = (await gapResource?.read()) as any;
      // Without a real BCV rate there is no gap to report, and no probability.
      expect(gapData.gap.gapPct).toBeNull();
      expect(gapData.gap.zone).toBe('UNAVAILABLE');
      expect(gapData.gap.actionable).toBe(false);
      expect(gapData.window.probabilityPct).toBeNull();
    });
  });

  describe('Phase 3 Tools: Crypto Market Data & Microstructure', () => {
    it('get_binance_p2p_orderbook parses top bids, asks, spread and liquidity depth', () => {
      const ob = getBinanceP2POrderbookTool.execute({ fiat: 'VES', asset: 'USDT', rows: 5 });

      expect(ob.fiat).toBe('VES');
      expect(ob.asset).toBe('USDT');
      expect(ob.topBuyPrice).toBeGreaterThan(70);
      expect(ob.topSellPrice).toBeGreaterThan(ob.topBuyPrice);
      expect(ob.spreadVes).toBeGreaterThan(0);
      expect(ob.totalBuyDepthUsdt).toBeGreaterThan(0);
      expect(ob.totalSellDepthUsdt).toBeGreaterThan(0);
      expect(ob.buyOffersCount).toBe(5);
      expect(ob.sellOffersCount).toBe(5);
    });

    it('detect_usdt_depeg monitors parity deviations and alerts on critical depegs', async () => {
      // Normal pegged state ($1.000)
      const normal = await detectUsdtDepegTool.execute({ spotUsdtPrice: 1.0, thresholdPct: 0.2 });
      expect(normal.status).toBe('PEGGED');
      expect(normal.isDepegged).toBe(false);
      expect(normal.riskSeverity).toBe('NONE');

      // Depeg discount ($0.988 -> -1.2%)
      const discount = await detectUsdtDepegTool.execute({ spotUsdtPrice: 0.988, thresholdPct: 0.2 });
      expect(discount.status).toBe('DEPEG_DISCOUNT');
      expect(discount.isDepegged).toBe(true);
      expect(discount.riskSeverity).toBe('CRITICAL');
      expect(discount.isEmergencyActionRequired).toBe(true);

      // Depeg premium ($1.008 -> +0.8%)
      const premium = await detectUsdtDepegTool.execute({ spotUsdtPrice: 1.008, thresholdPct: 0.2 });
      expect(premium.status).toBe('DEPEG_PREMIUM');
      expect(premium.isDepegged).toBe(true);
      expect(premium.arbitrageOpportunity).toBe(true);
    });

    it('detect_usdt_depeg consulta ticker spot en vivo o declara ausencia sin inventar 1.0', async () => {
      const result = await detectUsdtDepegTool.execute({});
      if (result.spotUsdtPrice !== null) {
        expect(result.spotUsdtPrice).toBeGreaterThan(0.5);
        expect(result.spotUsdtPrice).toBeLessThan(1.5);
        expect(result.source).toMatch(/binance|kraken/i);
      } else {
        expect(result.status).toBe('UNAVAILABLE_NO_LIVE_FEED');
        expect(result.actionable).toBe(false);
        expect(result.unavailableReason).toBe('missing_evidence:spotUsdtPrice');
      }
    });

    it('recommend_competitive_pricing positions Maker ads optimally with safety boundaries', () => {
      // BUY TOP_1 (outcompete highest bidder)
      const buyTop1 = recommendCompetitivePricingTool.execute({
        side: 'BUY',
        strategy: 'TOP_1',
        stepVes: 0.05,
        targetMarginPct: 1.0,
      });
      expect(buyTop1.suggestedPrice).toBe(buyTop1.competitorPrice + 0.05);
      expect(buyTop1.isWithinSafeBoundaries).toBe(true);

      // SELL TOP_1 (outcompete lowest ask)
      const sellTop1 = recommendCompetitivePricingTool.execute({
        side: 'SELL',
        strategy: 'TOP_1',
        stepVes: 0.05,
        targetMarginPct: 1.0,
      });
      expect(sellTop1.suggestedPrice).toBe(sellTop1.competitorPrice - 0.05);

      // Break-even enforcement (cannot sell below 80.00 if competitor is at 79.80)
      const constrainedSell = recommendCompetitivePricingTool.execute({
        side: 'SELL',
        strategy: 'TOP_1',
        stepVes: 0.01,
        breakEvenPrice: 80.0,
      });
      expect(constrainedSell.suggestedPrice).toBe(80.0);
      expect(constrainedSell.isWithinSafeBoundaries).toBe(false);
      expect(constrainedSell.advice).toContain('ADVERTENCIA');
    });

    it('analyze_orderbook_pressure calculates depth imbalances and flags spoofing disparity', () => {
      // Strong buy pressure
      const buyPressure = analyzeOrderbookPressureTool.execute({
        fiat: 'VES',
        bidDepthUsdt: 25000,
        askDepthUsdt: 10000,
        includeSpoofCheck: false,
      });
      expect(buyPressure.dominantSide).toBe('BUY_PRESSURE');
      expect(buyPressure.orderbookImbalanceRatio).toBeGreaterThan(0.58);

      // Spoofing disparity (bid depth 4x ask depth with spoof check enabled)
      const spoofAlert = analyzeOrderbookPressureTool.execute({
        fiat: 'VES',
        bidDepthUsdt: 45000,
        askDepthUsdt: 9000,
        includeSpoofCheck: true,
      });
      expect(spoofAlert.phantomLiquidityDetected).toBe(true);
      expect(spoofAlert.manipulationRiskScore).toBeGreaterThan(50);
      expect(spoofAlert.marketRegime).toBe('MANIPULATED_OR_DISPERSION_RISK');
    });
  });

  describe('Phase 3 Resources: Crypto Endpoints', () => {
    it('cryptoResources expose binance-p2p depth and spot volatility endpoints', async () => {
      const depthResource = cryptoResources.find((r) => r.uri === 'p2p://market/binance-p2p/depth');
      expect(depthResource).toBeDefined();
      const depthData = (await depthResource?.read()) as any;
      expect(depthData.totalLiquidityUsdt).toBeGreaterThan(0);
      expect(depthData.buyOffers.length).toBeGreaterThan(0);

      const spotResource = cryptoResources.find((r) => r.uri === 'p2p://market/spot/volatility');
      expect(spotResource).toBeDefined();
      const spotData = (await spotResource?.read()) as any;
      if (spotData.spotUsdtPrice !== null) {
        expect(spotData.spotUsdtPrice).toBeCloseTo(1.0, 1);
        expect(typeof spotData.status).toBe('string');
        expect(spotData.source).not.toBe('NONE');
      } else {
        expect(spotData.status).toBe('UNAVAILABLE_NO_LIVE_FEED');
        expect(spotData.source).toBe('NONE');
      }
    });
  });

  describe('Phase 4 Tools: Portfolio Management & Risk Stress Testing', () => {
    it('stress_test_portfolio models devaluations and calculates solvency drawdowns', () => {
      const stress = stressTestPortfolioTool.execute({
        usdtCapital: 6000,
        vesCapital: 200000,
        referenceRate: 80.0,
        devaluationScenariosPct: [5, 10, 20],
        hedgedPct: 0,
      });

      expect(stress.baselinePortfolioValueUsdt).toBe(8500); // 6000 + 200000/80 = 8500
      expect(stress.vesExposureUsdt).toBe(2500);
      expect(stress.scenariosCount).toBe(3);
      expect(stress.scenarios[0]!.lossUsdt).toBeLessThan(stress.scenarios[2]!.lossUsdt);
      expect(stress.recommendedHedgeUsdt).toBe(2500);
      expect(stress.institutionalSummary).toBeDefined();
    });

    it('rebalance_capital_allocation produces weighted custodian allocations and anti-pitufeo limits', () => {
      const plan = rebalanceCapitalAllocationTool.execute({
        totalCapitalUsdt: 12000,
        riskMode: 'BALANCED',
        hourOfDay: 10,
      });

      expect(plan.totalCapitalUsdt).toBe(12000);
      expect(plan.allocations.length).toBeGreaterThanOrEqual(4);
      expect(plan.activeChannelsCount).toBeGreaterThanOrEqual(3);
      expect(plan.dynamicLimits.minTicketUsdt).toBeGreaterThan(0);
      expect(plan.dynamicLimits.maxTicketUsdt).toBeGreaterThan(plan.dynamicLimits.minTicketUsdt);
      expect(plan.rebalanceOrders.length).toBeGreaterThanOrEqual(1);
    });

    it('audit_counterparty_exposure flags volume concentration and anti-triangulation alerts', () => {
      const audit = auditCounterpartyExposureTool.execute({
        historicalTradesCount: 30,
        maxConcentrationPct: 20.0,
      });

      expect(audit.totalTradesAudited).toBe(30);
      expect(audit.uniqueCounterpartiesCount).toBeGreaterThan(0);
      expect(audit.concentration.topCounterpartySharePct).toBeGreaterThan(0);
      expect(audit.flaggedCounterpartiesCount).toBeGreaterThan(0);
      expect(audit.recommendations.length).toBeGreaterThan(0);
    });

    it('project_compound_runway calculates multi-cycle growth and warns on banking capacity walls', () => {
      const runway = projectCompoundRunwayTool.execute({
        initialCapitalUsdt: 4000,
        netMarginPctPerCycle: 0.9,
        cyclesPerDay: 1.5,
        operationalDays: 60,
        reinvestmentRatePct: 100,
        monthlyFixedExpensesUsdt: 350,
        dailyBankLimitVes: 1000000,
      });

      expect(runway.projectedFinalCapitalUsdt).toBeGreaterThan(runway.initialCapitalUsdt);
      expect(runway.totalReturnPct).toBeGreaterThan(0);
      expect(runway.milestones.day30CapitalUsdt).toBeGreaterThan(runway.initialCapitalUsdt);
      expect(runway.monthlyRunwayCoverageMonths).toBeGreaterThan(1);
      expect(runway.hasReachedBankingWall).toBe(true);
      expect(runway.bankingWallAlert?.recommendation).toContain('límite bancario');
    });
  });

  describe('Phase 4 Resources: Portfolio Endpoints', () => {
    it('portfolioResources expose stress scenarios and allocation distribution', async () => {
      const stressResource = portfolioResources.find(
        (r) => r.uri === 'p2p://portfolio/stress-scenarios',
      );
      expect(stressResource).toBeDefined();
      const stressData = (await stressResource?.read()) as any;
      expect(stressData.scenarios.length).toBe(3);
      expect(stressData.baselineValueUsdt).toBeGreaterThan(0);

      const allocResource = portfolioResources.find((r) => r.uri === 'p2p://portfolio/allocation');
      expect(allocResource).toBeDefined();
      const allocData = (await allocResource?.read()) as any;
      expect(allocData.totalCapitalUsdt).toBeGreaterThan(0);
      expect(allocData.allocations.length).toBeGreaterThan(0);
    });
  });
});
