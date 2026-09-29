import { describe, it, expect } from 'vitest';
import { GEMINI_FINANCIAL_SKILLS, executeFinancialSkill } from './agent-skills';

describe('Agent Skills & Function Calling Declarations', () => {
  it('should expose the financial skills schemas for Gemini', () => {
    expect(GEMINI_FINANCIAL_SKILLS.length).toBe(63);
    const names = GEMINI_FINANCIAL_SKILLS.map((s) => s.name);
    expect(names).toContain('audit_and_risk_analytics');
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
    // 10 Operations Workflow skills
    expect(names).toContain('qualify_direct_lead_and_close');
    expect(names).toContain('generate_social_traffic_funnel');
    expect(names).toContain('benchmark_competitor_market_intelligence');
    expect(names).toContain('orchestrate_workspace_sync');
    expect(names).toContain('execute_desktop_rpa_reconciliation');
    expect(names).toContain('monitor_service_health_and_fallback');
    expect(names).toContain('triage_incident_and_escalate');
    expect(names).toContain('audit_sop_compliance_enforcement');
    expect(names).toContain('sync_google_sheets_live_ledger');
    expect(names).toContain('forecast_cash_flow_and_reconciliation');
    // 20 Strategic Operational Skills
    expect(names).toContain('scan_synthetic_stable_arbitrage');
    expect(names).toContain('audit_distressed_liquidity_sniper');
    expect(names).toContain('query_otc_darkpool_spread');
    expect(names).toContain('route_fintech_payroll_settlement');
    expect(names).toContain('recommend_counterparty_yield_price');
    expect(names).toContain('process_concierge_inquiry');
    expect(names).toContain('predict_bcv_macro_regime');
    expect(names).toContain('optimize_treasury_idle_yield');
    expect(names).toContain('compile_browser_operator_task');
    expect(names).toContain('execute_maker_laddering_plan');
    expect(names).toContain('balance_cross_exchange_inventory');
    expect(names).toContain('enforce_depeg_delta_hedge');
    expect(names).toContain('audit_chargeback_shield');
    expect(names).toContain('classify_and_price_client_tier');
    expect(names).toContain('negotiate_whatsapp_order_intake');
    expect(names).toContain('bundle_corporate_b2b_dossier');
    expect(names).toContain('compile_fast_dispute_evidence');
    expect(names).toContain('quote_instant_remittance_corridor');
    expect(names).toContain('execute_preemptive_bcv_drain');
    expect(names).toContain('evaluate_emergency_killswitch');

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
    const data = res.data as {
      metrics: { urgency: string; netDeltaRatio: number };
      proposals: unknown[];
    };
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
    const data = res.data as {
      gap: { gapPct: number; riskLevel: string };
      recommendation: { action: string };
    };
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
    const data = res.data as {
      isFullyFillable: boolean;
      totalFilledUsdt: number;
      bestQuotedPrice: number;
    };
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

    it('executes qualify_direct_lead_and_close via dispatcher', () => {
      const res = executeFinancialSkill('qualify_direct_lead_and_close', {
        leadChannel: 'WHATSAPP',
        estimatedWeeklyVolumeUsdt: 5000,
        paymentMethodPreferred: 'Banesco',
        isKycVerified: true,
        primaryConcern: 'SPEED',
        currentParallelRate: 85.0,
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.leadTier).toBe('VIP_COMMERCIAL');
      expect(data.actionProtocol).toBe('ONBOARD_IMMEDIATELY');
    });

    it('executes triage_incident_and_escalate via dispatcher', () => {
      const res = executeFinancialSkill('triage_incident_and_escalate', {
        incidentType: 'BANK_ACCOUNT_HOLD',
        amountAtRiskUsdt: 3500,
        orderId: 'ORD-CRISIS-1',
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.severityLevel).toBe('P1_CRITICAL');
      expect(data.requiresHumanHandoff).toBe(true);
    });

    it('executes audit_sop_compliance_enforcement via dispatcher', () => {
      const res = executeFinancialSkill('audit_sop_compliance_enforcement', {
        orderId: 'ORD-SOP-99',
        accountHolderMatchesDocument: true,
        bankBalanceConfirmedInAvailableFunds: true,
        responseTimeMinutes: 4,
        fundsReleasedBeforeBankVerification: false,
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.isCompliant).toBe(true);
      expect(data.disciplinaryAction).toBe('NONE');
    });

    it('executes audit_and_risk_analytics via dispatcher', () => {
      const res = executeFinancialSkill('audit_and_risk_analytics', {
        timeframeDays: 7,
        minSpreadThresholdPct: 0.5,
        sampleEvents: [
          { timestamp: '2026-09-19T11:00:00Z', severity: 'error', action: 'SECURITY_ALERT' },
        ],
        sampleOperations: [
          { timestamp: '2026-09-19T10:00:00Z', netSpreadPct: 1.15, cryptoAmount: 500 },
          { timestamp: '2026-09-19T12:00:00Z', netSpreadPct: 0.85, cryptoAmount: 1200 },
        ],
      });
      expect(res.success).toBe(true);
      const data = res.data as any;
      expect(data.timeframeDays).toBe(7);
      expect(data.dossier).toBeDefined();
      expect(data.dossier.operatorStanding).toBe('DISCIPLINED');
      expect(data.dossier.goldenRuleComplianceScore).toBe(100);
      expect(data.dossier.disciplineAudit.compliantOperationsCount).toBe(2);
    });

    describe('20 Strategic Operational Skills execution', () => {
      it('executes scan_synthetic_stable_arbitrage via dispatcher', () => {
        const res = executeFinancialSkill('scan_synthetic_stable_arbitrage', {
          pairs: [
            { sourceAsset: 'USDT', targetAsset: 'USDC', exchangeRate: 0.9985, feePct: 0.05, reverseExchangeRate: 1.002, reverseFeePct: 0.05 },
          ],
          minNetSpreadPct: 0.1,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.opportunities).toBeDefined();
      });

      it('executes audit_distressed_liquidity_sniper via dispatcher', () => {
        const res = executeFinancialSkill('audit_distressed_liquidity_sniper', {
          ads: [
            { advId: 'AD-1', merchantName: 'TraderFast', price: 79.0, availableAmountCrypto: 500, minLimitFiat: 1000, maxLimitFiat: 40000, paymentMethods: ['Banesco'], orderType: 'SELL' },
          ],
          fairMarketRate: 85.0,
          side: 'SELL',
          minDislocationPct: 0.8,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.snipingOpportunitiesCount).toBeGreaterThan(0);
      });

      it('executes query_otc_darkpool_spread via dispatcher', () => {
        const res = executeFinancialSkill('query_otc_darkpool_spread', {
          quotes: [
            { venueId: 'V1', venueName: 'Binance P2P', venueType: 'BINANCE_P2P', currencyPair: 'USDT/VES', buyRate: 84.5, sellRate: 86.0, minTradeVolumeUsd: 100, maxTradeVolumeUsd: 10000 },
            { venueId: 'V2', venueName: 'Caracas Cash Desk', venueType: 'PHYSICAL_CASH_DESK', currencyPair: 'USDT/VES', buyRate: 83.0, sellRate: 88.0, minTradeVolumeUsd: 1000, maxTradeVolumeUsd: 50000 },
          ],
          volumeUsd: 10000,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.routes).toBeDefined();
        expect(data.volumeUsd).toBe(10000);
      });

      it('executes route_fintech_payroll_settlement via dispatcher', () => {
        const res = executeFinancialSkill('route_fintech_payroll_settlement', {
          sourcePlatform: 'DEEL',
          amountUsd: 2500,
          targetDestination: 'VES_BANESCO',
          urgency: 'HIGH',
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.netProceedsUsd).toBeGreaterThan(0);
        expect(data.chargebackRiskTier).toBeDefined();
      });

      it('executes recommend_counterparty_yield_price via dispatcher', () => {
        const res = executeFinancialSkill('recommend_counterparty_yield_price', {
          counterpartyId: 'CP-SLOW-1',
          marketBasePrice: 85.0,
          orderSide: 'BUY',
          averageReleaseMinutes: 28,
          completedTradesCount: 15,
          disputeCount: 2,
          monthlyVolumeUsd: 3000,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.tier).toBe('HIGH_RISK_SURCHARGE');
        expect(data.adjustedRate).toBeLessThan(85.0);
      });

      it('executes process_concierge_inquiry via dispatcher', () => {
        const res = executeFinancialSkill('process_concierge_inquiry', {
          message: 'Hola buenas tardes a cuanto tienen la tasa de USDT para comprar 500?',
          currentBcvRate: 80.0,
          currentParallelRate: 86.0,
          deskBuyRate: 85.0,
          deskSellRate: 87.0,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.parsedInquiry.intent).toBe('QUOTE_REQUEST');
        expect(data.formattedReplyMessage).toContain('87.00');
      });

      it('executes predict_bcv_macro_regime via dispatcher', () => {
        const res = executeFinancialSkill('predict_bcv_macro_regime', {
          bcvOfficialRate: 80.0,
          parallelRate: 92.0,
          daysSinceLastIntervention: 6,
          estimatedInterventionAmountUsd: 60000000,
          currentHourVET: 10,
          currentDayOfWeek: 1,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.regime).toBe('BCV_INTERVENTION_WINDOW');
        expect(data.interventionProbabilityPct).toBeGreaterThan(50);
      });

      it('executes optimize_treasury_idle_yield via dispatcher', () => {
        const res = executeFinancialSkill('optimize_treasury_idle_yield', {
          totalTreasuryUsdt: 25000,
          operationalReserveUsdt: 5000,
          minYieldApyPct: 4.0,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.availableIdleUsdt).toBe(20000);
        expect(data.projectedMonthlyInterestUsd).toBeGreaterThan(0);
      });

      it('executes compile_browser_operator_task via dispatcher', () => {
        const res = executeFinancialSkill('compile_browser_operator_task', {
          targetSite: 'BANESCO_PANAMA',
          action: 'VERIFY_TRANSFER_REFERENCE',
          referenceToVerify: 'TX-998877',
          expectedAmount: 1250,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.taskId).toContain('TASK-NAV');
        expect(data.steps.length).toBeGreaterThan(0);
      });

      it('executes execute_maker_laddering_plan via dispatcher', () => {
        const res = executeFinancialSkill('execute_maker_laddering_plan', {
          midPrice: 85.0,
          currentInventoryUsdt: 6000,
          targetInventoryUsdt: 5000,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.makerQuotes).toBeDefined();
        expect(data.makerQuotes.reservationPrice).toBeLessThan(85.0);
      });

      it('executes balance_cross_exchange_inventory via dispatcher', () => {
        const res = executeFinancialSkill('balance_cross_exchange_inventory', {
          binanceBalanceUsdt: 10000,
          bybitBalanceUsdt: 2000,
          onchainBalanceUsdt: 3000,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.rebalanceNeeded).toBe(true);
        expect(data.rebalanceInstructions.length).toBeGreaterThan(0);
      });

      it('executes enforce_depeg_delta_hedge via dispatcher', () => {
        const res = executeFinancialSkill('enforce_depeg_delta_hedge', {
          inventoryVes: 500000,
          currentPrice: 85.0,
          hedgeRatioPct: 80,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.action).toBe('OPEN_SHORT_PERP_HEDGE');
        expect(data.recommendedShortFuturesUsd).toBeGreaterThan(0);
      });

      it('executes audit_chargeback_shield via dispatcher', () => {
        const res = executeFinancialSkill('audit_chargeback_shield', {
          platform: 'PAYPAL',
          amountUsd: 1500,
          isVerifiedContractor: false,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.riskLevel).toBe('HIGH');
        expect(data.verdict).toBe('REJECT_OR_ESCROW_48H');
      });

      it('executes classify_and_price_client_tier via dispatcher', () => {
        const res = executeFinancialSkill('classify_and_price_client_tier', {
          counterpartyId: 'VIP-TRADER',
          averageReleaseMinutes: 2,
          completedTradesCount: 350,
          disputeCount: 0,
          monthlyVolumeUsd: 45000,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.tier).toBe('VIP_INSTITUTIONAL');
      });

      it('executes negotiate_whatsapp_order_intake via dispatcher', () => {
        const res = executeFinancialSkill('negotiate_whatsapp_order_intake', {
          customerMessage: 'Quiero cambiar 250 USDT a Banesco',
          activeRate: 85.5,
          bankName: 'Banesco',
          accountDetails: '0134-XXXX-XXXX-XXXX a nombre de P2P Desk',
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.orderAmountUsdt).toBe(250);
        expect(data.confirmationMessage).toContain('COTIZACIÓN CONFIRMADA');
      });

      it('executes bundle_corporate_b2b_dossier via dispatcher', () => {
        const res = executeFinancialSkill('bundle_corporate_b2b_dossier', {
          clientName: 'ACME Latam Corp',
          taxId: 'J-12345678-9',
          amountUsd: 12000,
          serviceCategory: 'SOFTWARE_LICENSING',
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.status).toBe('COMPLIANCE_READY');
        expect(data.complianceChecklist.length).toBeGreaterThan(0);
      });

      it('executes compile_fast_dispute_evidence via dispatcher', () => {
        const res = executeFinancialSkill('compile_fast_dispute_evidence', {
          orderId: 'ORD-DISPUTE-999',
          counterpartyName: 'SuspectSeller',
          disputeReason: 'Pago no liberado tras transferencia confirmada',
          claimedAmount: 45000,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.caseId).toContain('ORD-DISPUTE-999');
        expect(data.severity).toBe('CRITICAL');
      });

      it('executes quote_instant_remittance_corridor via dispatcher', () => {
        const res = executeFinancialSkill('quote_instant_remittance_corridor', {
          corridorId: 'USD_ZELLE_TO_VES',
          sendAmount: 100,
          deskSpreadPct: 2.5,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.whatsappFormattedMessage).toBeDefined();
        expect(data.destPayoutAmount).toBeGreaterThan(0);
      });

      it('executes execute_preemptive_bcv_drain via dispatcher', () => {
        const res = executeFinancialSkill('execute_preemptive_bcv_drain', {
          currentVesBalance: 850000,
          bcvInterventionProbabilityPct: 88,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.urgency).toBe('CRITICAL');
        expect(data.recommendedDrainVes).toBeGreaterThan(700000);
      });

      it('executes evaluate_emergency_killswitch via dispatcher', () => {
        const res = executeFinancialSkill('evaluate_emergency_killswitch', {
          reason: 'Divergencia anómala del spread > 15%',
          anomalySeverity: 'CRITICAL',
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.killswitchActivated).toBe(true);
        expect(data.actionsTriggered).toContain('PAUSE_ALL_P2P_ADS');
      });
    });
  });
});
