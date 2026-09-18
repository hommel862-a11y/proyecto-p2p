import { describe, it, expect } from 'vitest';
import {
  GEMINI_FINANCIAL_SKILLS,
  executeFinancialSkill,
} from './agent-skills';

describe('Agent Skills & Function Calling Declarations', () => {
  it('should expose the financial skills schemas for Gemini', () => {
    expect(GEMINI_FINANCIAL_SKILLS.length).toBe(32);
    const names = GEMINI_FINANCIAL_SKILLS.map((s) => s.name);
    expect(names).toContain('scan_triangular_arbitrage');
    expect(names).toContain('predict_bcv_market_intelligence');
    expect(names).toContain('inspect_orderbook_liquidity');
    expect(names).toContain('evaluate_golden_spread');
    expect(names).toContain('build_operator_allocation_plan');
    expect(names).toContain('evaluate_delta_neutral_hedge');
    expect(names).toContain('forecast_market_volatility_2h');
    expect(names).toContain('audit_zk_mesh_threat');
    expect(names).toContain('generate_dispute_dossier');
    expect(names).toContain('simulate_trade_impact');
    expect(names).toContain('calculate_optimal_spread_avellaneda');
    expect(names).toContain('estimate_adverse_selection_vpin');
    expect(names).toContain('compute_optimal_order_slicing_twap_vwap');
    expect(names).toContain('calculate_maker_fill_probability_markov');
    expect(names).toContain('analyze_fx_corridor_efficiency');
    expect(names).toContain('calculate_cross_exchange_basis_spread');
    expect(names).toContain('calculate_convexity_and_gamma_risk');
    expect(names).toContain('model_perpetual_funding_arbitrage');
    expect(names).toContain('optimize_capital_allocation_kelly');
    expect(names).toContain('forecast_central_bank_liquidity_drain');
    expect(names).toContain('monitor_fiat_flight_and_dollarization_velocity');
    expect(names).toContain('simulate_game_theory_nash_repricing');
    // 10 Binance Earn skills
    expect(names).toContain('optimize_idle_capital_simple_earn');
    expect(names).toContain('evaluate_dual_investment_p2p_exit');
    expect(names).toContain('calculate_usdt_fdusd_yield_arbitrage');
    expect(names).toContain('model_launchpool_capital_parking');
    expect(names).toContain('optimize_locked_vs_flexible_liquidity_ladder');
    expect(names).toContain('calculate_earn_yield_vs_p2p_hurdle_rate');
    expect(names).toContain('model_bnb_vault_yield_stacking');
    expect(names).toContain('forecast_flexible_earn_tier_saturation');
    expect(names).toContain('calculate_auto_invest_dca_spread_funnel');
    expect(names).toContain('simulate_earn_instant_redemption_latency');

    // All should have parameters of type OBJECT with properties
    for (const skill of GEMINI_FINANCIAL_SKILLS) {
      expect(skill.parameters.type).toBe('OBJECT');
      expect(Object.keys(skill.parameters.properties).length).toBeGreaterThan(0);
      expect(skill.parameters.required.length).toBeGreaterThan(0);
    }
  });

  it('should execute evaluate_delta_neutral_hedge deterministically', () => {
    const res = executeFinancialSkill('evaluate_delta_neutral_hedge', {
      vesBalance: 200000,
      usdtBalance: 1000,
      currentParallelRate: 80.0,
      vesMaxHoldingTimeMinutes: 45,
      maxAllowedFiatDeltaRatio: 0.15,
    });
    expect(res.success).toBe(true);
    const data = res.data as { metrics: { urgency: string; netDeltaRatio: number }; proposals: unknown[] };
    expect(data.metrics).toBeDefined();
    expect(data.metrics.urgency).not.toBe('NONE');
    expect(data.proposals.length).toBeGreaterThan(0);
  });

  it('should execute forecast_market_volatility_2h deterministically', () => {
    const res = executeFinancialSkill('forecast_market_volatility_2h', {
      currentSpreadPct: 1.5,
      recentTicks: [
        { timestampMs: 1000000, buyPrice: 80, sellPrice: 81.2 },
        { timestampMs: 1003600, buyPrice: 80.5, sellPrice: 82.0 },
      ],
      parallelRate: 82.0,
      bcvRate: 70.0,
    });
    expect(res.success).toBe(true);
    const data = res.data as { volatilityIndex: number; level: string; direction: string };
    expect(data.volatilityIndex).toBeGreaterThanOrEqual(0);
    expect(data.level).toBeDefined();
  });

  it('should execute audit_zk_mesh_threat deterministically', () => {
    const res = executeFinancialSkill('audit_zk_mesh_threat', {
      identifier: 'V-12345678',
    });
    expect(res.success).toBe(true);
    const data = res.data as { blindHash: string; riskStatus: string };
    expect(data.blindHash).toBeDefined();
    expect(data.blindHash.length).toBe(64); // SHA-256
    expect(data.riskStatus).toBe('CLEAN');
  });

  it('should execute generate_dispute_dossier deterministically', () => {
    const res = executeFinancialSkill('generate_dispute_dossier', {
      orderId: 'BNB-998877',
      orderAmountFiat: 85000,
      orderAmountCrypto: 1000,
      counterpartyBinanceName: 'Carlos Trader',
      bankPayerName: 'Maria Perez',
      bankName: 'Banesco',
      bankReference: '0098765432',
    });
    expect(res.success).toBe(true);
    const data = res.data as { appealTextEs: string; appealTextEn: string; timeline: unknown[] };
    expect(data.appealTextEs).toContain('BNB-998877');
    expect(data.appealTextEn).toContain('BNB-998877');
    expect(data.timeline.length).toBeGreaterThan(0);
  });

  it('should execute evaluate_golden_spread deterministically', () => {
    const res = executeFinancialSkill('evaluate_golden_spread', { netSpreadPct: 1.6 });
    expect(res.success).toBe(true);
    expect(res.skillName).toBe('evaluate_golden_spread');
    const data = res.data as { isViable: boolean; alertLevel: string };
    expect(data.isViable).toBe(true);
    expect(data.alertLevel).toBe('GOLDEN_ZONE');

    const lowRes = executeFinancialSkill('evaluate_golden_spread', { netSpreadPct: 0.2 });
    expect(lowRes.success).toBe(true);
    const lowData = lowRes.data as { isViable: boolean; alertLevel: string };
    expect(lowData.isViable).toBe(false);
    expect(lowData.alertLevel).toBe('BELOW_THRESHOLD_PAUSE');
  });

  it('should execute predict_bcv_market_intelligence deterministically', () => {
    const res = executeFinancialSkill('predict_bcv_market_intelligence', {
      parallelRate: 85.0,
      bcvRate: 70.0,
    });
    expect(res.success).toBe(true);
    const data = res.data as { gap: { gapPct: number; riskLevel: string }; recommendation: { action: string } };
    expect(data.gap.gapPct).toBeGreaterThan(20);
    expect(data.recommendation).toBeDefined();
  });

  it('should execute build_operator_allocation_plan deterministically', () => {
    const res = executeFinancialSkill('build_operator_allocation_plan', {
      deskCapitalUsdt: 5000,
      referenceRateVes: 80.0,
      operators: [
        {
          id: 'OP-1',
          name: 'Operador Turno Mañana',
          assignedCapitalUsdt: 2500,
          commissionSplitPct: 25,
          targetDailyCycles: 3,
          active: true,
        },
      ],
    });
    expect(res.success).toBe(true);
    const data = res.data as { totalDeskCapitalUsdt: number; operatorsAllocations: unknown[] };
    expect(data.totalDeskCapitalUsdt).toBe(5000);
    expect(data.operatorsAllocations.length).toBe(1);
  });

  it('should execute simulate_trade_impact deterministically', () => {
    const res = executeFinancialSkill('simulate_trade_impact', {
      targetAmountUsdt: 600,
      side: 'BUY',
      availableOffers: [
        {
          advNo: 'ADV-1',
          price: 84.0,
          surplusAmount: 1000,
          merchantName: 'TraderPro',
          merchantFinishRate: 99,
        },
      ],
    });
    expect(res.success).toBe(true);
    const data = res.data as { isFullyFillable: boolean; totalFilledUsdt: number; bestQuotedPrice: number };
    expect(data.isFullyFillable).toBe(true);
    expect(data.totalFilledUsdt).toBe(600);
    expect(data.bestQuotedPrice).toBe(84.0);
  });

  it('should return error gracefully for unknown skill or missing parameters', () => {
    const unknownRes = executeFinancialSkill('invented_skill', {});
    expect(unknownRes.success).toBe(false);
    expect(unknownRes.error).toContain('Habilidad desconocida');

    const missingArgsRes = executeFinancialSkill('predict_bcv_market_intelligence', {
      parallelRate: 0,
      bcvRate: 0,
    });
    expect(missingArgsRes.success).toBe(false);
    expect(missingArgsRes.error).toContain('requiere parallelRate y bcvRate');
  });

  describe('Execution of Newly Registered Quantitative Skills', () => {
    it('executes calculate_optimal_spread_avellaneda via dispatcher', () => {
      const res = executeFinancialSkill('calculate_optimal_spread_avellaneda', {
        midPrice: 85.0,
        currentInventoryUsdt: 8000,
        targetInventoryUsdt: 5000,
        volatilityDaily: 0.02,
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.reservationPrice).toBeDefined();
      expect(data.optimalBidPrice).toBeDefined();
    });

    it('executes estimate_adverse_selection_vpin via dispatcher', () => {
      const res = executeFinancialSkill('estimate_adverse_selection_vpin', {
        buckets: [{ buyVolume: 5000, sellVolume: 5000, totalVolume: 10000 }],
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.vpinScore).toBe(0);
      expect(data.toxicityClassification).toBe('LOW_RETAIL');
    });

    it('executes compute_optimal_order_slicing_twap_vwap via dispatcher', () => {
      const res = executeFinancialSkill('compute_optimal_order_slicing_twap_vwap', {
        totalAmountUsdt: 8000,
        executionDurationMinutes: 45,
        estimatedMarketVolumePerHourUsdt: 50000,
        currentMidPrice: 85.0,
        algorithm: 'VWAP',
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.totalSlices).toBeGreaterThan(2);
    });

    it('executes analyze_fx_corridor_efficiency via dispatcher', () => {
      const res = executeFinancialSkill('analyze_fx_corridor_efficiency', {
        baseAmountUsdt: 1000,
        corridors: [
          {
            corridorId: 'USDT-COP',
            sourceCurrency: 'USDT',
            targetCurrency: 'COP',
            spotCrossRate: 4200,
            officialParityRate: 4100,
            bankingFrictionPct: 0.4,
            transferLatencyMinutes: 10,
            makerFeePct: 0.1,
          },
        ],
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.recommendedCorridorId).toBe('USDT-COP');
    });

    it('executes optimize_capital_allocation_kelly via dispatcher', () => {
      const res = executeFinancialSkill('optimize_capital_allocation_kelly', {
        totalCapitalUsdt: 10000,
        winRatePct: 75,
        averageProfitPerWinUsdt: 40,
        averageLossPerLossUsdt: 15,
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.optimalTicketSizeUsdt).toBeGreaterThan(500);
    });

    it('executes forecast_central_bank_liquidity_drain via dispatcher', () => {
      const res = executeFinancialSkill('forecast_central_bank_liquidity_drain', {
        dayOfMonth: 15,
        dayOfWeek: 1,
        estimatedSeniatCollectionActive: true,
        weeklyBcvInjectionMillionsUsd: 55,
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.interbankLiquidityLevel).toBe('TIGHT_LIQUIDITY_DRAIN');
    });

    it('executes optimize_idle_capital_simple_earn via dispatcher', () => {
      const res = executeFinancialSkill('optimize_idle_capital_simple_earn', {
        capitalUsdt: 5000,
        tier1LimitUsdt: 500,
        tier1AprPct: 10.0,
        tier2AprPct: 2.5,
        holdingDays: 30,
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.tier1Allocated).toBe(500);
      expect(data.tier2Allocated).toBe(4500);
      expect(data.effectiveBlendedAprPct).toBeGreaterThan(2.5);
    });

    it('executes calculate_earn_yield_vs_p2p_hurdle_rate via dispatcher', () => {
      const res = executeFinancialSkill('calculate_earn_yield_vs_p2p_hurdle_rate', {
        grossP2pSpreadPct: 1.5,
        platformFeePct: 0.1,
        bankingRiskPremiumPct: 0.2,
        fxDevaluationRiskPct: 0.3,
        averageTradeCycleHours: 2,
        simpleEarnAprPct: 4.0,
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.verdict).toBe('OPERATE_P2P');
      expect(data.isP2pProfitableOverEarn).toBe(true);
    });

    it('executes optimize_locked_vs_flexible_liquidity_ladder via dispatcher', () => {
      const res = executeFinancialSkill('optimize_locked_vs_flexible_liquidity_ladder', {
        totalTreasuryUsdt: 20000,
        dailyP2pVolumeUsdt: 5000,
        p2pTurnoverDays: 1,
        flexibleAprPct: 2.5,
        locked30dAprPct: 5.5,
        locked60dAprPct: 8.0,
        safetyBufferPct: 30,
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.flexibleBufferUsdt).toBeGreaterThan(5000);
      expect(data.blendedPortfolioAprPct).toBeGreaterThan(2.5);
    });
  });
});

