import { describe, it, expect } from 'vitest';
import {
  scanSyntheticStableArbitrageTool,
  auditDistressedLiquiditySniperTool,
  queryOtcDarkpoolSpreadTool,
  routeFintechPayrollSettlementTool,
  recommendCounterpartyYieldPriceTool,
  processConciergeInquiryTool,
  predictBcvMacroRegimeTool,
  optimizeTreasuryIdleYieldTool,
  executeBrowserOperatorTaskTool,
} from './index.js';

describe('9 High-Impact Strategic Quantitative & Operational MCP Tools', () => {
  // This test used to call the tool with no `pairs` and assert
  // `opportunitiesCount > 0`. It was asserting the bug: the tool carried its own
  // fixed USDC/VES curve (85.5 / 86.8) and scanned it, so a synthetic arbitrage
  // was reported that no scan ever observed. A count over an invented curve is
  // the same fabricated number as a fabricated rate — one layer up.
  it('scan_synthetic_stable_arbitrage no escanea una curva que no le enviaron', () => {
    const res = scanSyntheticStableArbitrageTool.execute({
      minNetSpreadPct: 0.1,
    });
    // Not 0: that would assert "we scanned and found nothing". The count of a
    // search that never happened is null, with the missing source named.
    expect(res.success).toBe(false);
    expect(res.opportunitiesCount).toBeNull();
    expect(res.reason).toBe('NO_MEASURED_CURVE');
    expect(res.requiredSource).toContain('p2pUsdtRateFiat');
  });

  it('scan_synthetic_stable_arbitrage counts only the measured curves it receives', () => {
    const res = scanSyntheticStableArbitrageTool.execute({
      minNetSpreadPct: 0.1,
      pairs: [
        {
          targetAsset: 'USDC',
          spotPair: 'USDCUSDT',
          spotRate: 0.9992,
          spotFeePct: 0.05,
          p2pMakerFeePct: 0,
          transferOrCashFrictionPct: 0,
          p2pUsdtRateFiat: 950,
          p2pTargetRateFiat: 968,
          fiatCurrency: 'VES',
          tradingCapitalUsd: 2500,
        },
      ],
    });
    expect(res.success).toBe(true);
    expect(res.opportunitiesCount).toBeGreaterThan(0);
  });

  it('scan_synthetic_stable_arbitrage blocks unpriced routes instead of defaulting friction', () => {
    const res = scanSyntheticStableArbitrageTool.execute({
      minNetSpreadPct: 0.1,
      pairs: [
        {
          targetAsset: 'EURC',
          spotPair: 'EURCUSDT',
          spotRate: 1.085,
          p2pUsdtRateFiat: 85.0,
          p2pTargetRateFiat: 93.0,
          tradingCapitalUsd: 2000,
          // No cost terms supplied: the depeg is real, the margin is unpriced.
        },
      ],
    });
    expect(res.success).toBe(true);
    expect(res.opportunitiesCount).toBe(1);
    expect(res.opportunities[0].isActionable).toBe(false);
    expect(res.opportunities[0].reason).toBe('MISSING_FRICTION_METRICS');
    expect(res.opportunities[0].projectedProfitUsd).toBe(0);
    expect(res.opportunities[0].missingCostInputs).toEqual([
      'spotFeePct',
      'p2pMakerFeePct',
      'transferOrCashFrictionPct',
    ]);
  });

  it('audit_distressed_liquidity_sniper detects dislocations', () => {
    const res = auditDistressedLiquiditySniperTool.execute({
      ads: [
        {
          advId: 'AD-99',
          merchantName: 'FastSeller',
          orderType: 'SELL',
          price: 80.0,
          availableAmountCrypto: 500,
          minLimitFiat: 1000,
          maxLimitFiat: 40000,
          paymentMethods: ['Banesco'],
        },
      ],
      fairMarketRate: 85.0,
      minDislocationPct: 0.8,
      maxTakerFeePct: 0.1,
    });
    expect(res.success).toBe(true);
    expect(res.frictionMetricsProvided).toBe(true);
    expect(res.snipingOpportunitiesCount).toBeGreaterThan(0);
    expect(res.snipingOpportunities[0].isActionable).toBe(true);
  });

  it('audit_distressed_liquidity_sniper blocks net profit when the fee is unmeasured', () => {
    const res = auditDistressedLiquiditySniperTool.execute({
      ads: [
        {
          advId: 'AD-NOFEE',
          merchantName: 'FastSeller',
          orderType: 'SELL',
          price: 80.0,
          availableAmountCrypto: 500,
          minLimitFiat: 1000,
          maxLimitFiat: 40000,
          paymentMethods: ['Banesco'],
        },
      ],
      fairMarketRate: 85.0,
      minDislocationPct: 0.8,
    });
    expect(res.success).toBe(true);
    expect(res.frictionMetricsProvided).toBe(false);
    expect(res.snipingOpportunitiesCount).toBeGreaterThan(0);
    expect(res.snipingOpportunities[0].isActionable).toBe(false);
    expect(res.snipingOpportunities[0].reason).toBe('MISSING_FRICTION_METRICS');
    expect(res.snipingOpportunities[0].netProfitUsd).toBe(0);
  });

  it('query_otc_darkpool_spread computes venue routes', () => {
    const res = queryOtcDarkpoolSpreadTool.execute({
      volumeUsd: 10000,
      minNetSpreadPct: 1.0,
    });
    expect(res.success).toBe(true);
    expect(res.routesFoundCount).toBeGreaterThan(0);
  });

  it('route_fintech_payroll_settlement calculates payout quote', () => {
    const res = routeFintechPayrollSettlementTool.execute({
      platform: 'DEEL',
      grossAmountUsd: 3500,
      payoutRail: 'VES_PAGO_MOVIL',
      vesRatePerUsd: 85.5,
      clientTier: 'RECURRENT_REMOTE',
      isVerifiedContractor: true,
    });
    expect(res.success).toBe(true);
    expect(res.quote.netProceedsUsd).toBeGreaterThan(0);
    expect(res.quote.netProceedsVes).toBeGreaterThan(0);
  });

  it('recommend_counterparty_yield_price tailors spread and price', () => {
    const res = recommendCounterpartyYieldPriceTool.execute({
      counterpartyId: 'CP-INSTITUTIONAL-1',
      baseMarketRate: 85.0,
      orderType: 'BUY',
      averageReleaseMinutes: 2,
      completedTradesCount: 150,
      disputeCount: 0,
      monthlyVolumeUsd: 25000,
      requestedAmountUsd: 5000,
    });
    expect(res.success).toBe(true);
    expect(res.result.tier).toBe('VIP_INSTITUTIONAL');
    expect(res.result.spreadAdjustmentPct).toBeLessThan(0);
  });

  it('process_concierge_inquiry parses message and produces quote reply', () => {
    const res = processConciergeInquiryTool.execute({
      customerMessage: 'Buenas tardes tienen disponibles 300 USDT a Banesco?',
      deskRatePerUsd: 87.0,
      bankName: 'Banesco',
      bankAccountDetails: '0134-0000-0000-0000',
      quoteValidityMinutes: 15,
    });
    expect(res.success).toBe(true);
    expect(res.parsedInquiry.intent).toBe('QUOTE_REQUEST');
    expect(res.formattedReplyMessage).toContain('87.00');
  });

  it('predict_bcv_macro_regime forecasts central bank intervention regime', () => {
    const res = predictBcvMacroRegimeTool.execute({
      bcvOfficialRate: 80.0,
      parallelMarketRate: 90.0,
      daysSinceLastIntervention: 5,
      currentHourOfDayUtcMinus4: 10,
      currentDayOfWeek: 1,
      estimatedWeeklyBcvInjectionUsd: 55000000,
    });
    expect(res.success).toBe(true);
    expect(res.assessment.regime).toBe('BCV_INTERVENTION_WINDOW');
  });

  it('optimize_treasury_idle_yield allocates off-peak idle balance', () => {
    const res = optimizeTreasuryIdleYieldTool.execute({
      totalUsdtInventory: 20000,
      currentlyCommittedUsdt: 3000,
      marketVelocity: 'LOW_OFFPEAK',
      flexibleApyPct: 11.2,
      minimumSafetyBufferUsd: 2000,
    });
    expect(res.success).toBe(true);
    expect(res.plan.actionDirective).toBe('EXECUTE_SWEEP_DEPOSIT');
    expect(res.plan.recommendedSweepAmountUsd).toBeGreaterThan(0);
  });

  it('execute_browser_operator_task compiles navigation instructions', () => {
    const res = executeBrowserOperatorTaskTool.execute({
      targetSite: 'BANESCO_PANAMA',
      action: 'VERIFY_TRANSFER_REFERENCE',
      referenceToVerify: 'REF-12345678',
      expectedAmount: 1500,
      headless: true,
    });
    expect(res.success).toBe(true);
    expect(res.compiledTask.targetPortal).toBe('BANESCO_PANAMA');
    expect(res.compiledTask.steps.length).toBeGreaterThan(0);
  });
});
