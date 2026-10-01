import { describe, it, expect } from 'vitest';
import { GEMINI_FINANCIAL_SKILLS, executeFinancialSkill } from './agent-skills';

/**
 * Asserts a skill refuses to produce a value when a required measurement is
 * absent, and that the refusal names the source that would have satisfied it.
 */
const mustRefuse = (
  skillName: string,
  args: Record<string, unknown>,
  missingField: string,
) => {
  const res = executeFinancialSkill(skillName, args);
  expect(res.success, `${skillName} no debe tener éxito sin '${missingField}'`).toBe(false);
  expect(res.data).toBeNull();
  expect(res.actionable).toBe(false);
  expect(res.expectedSource).toBeTruthy();
  expect(res.unavailableReason).toBe(`missing_evidence:${missingField}`);
};

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
      // `timeRemainingFraction` se declara explicitamente. Antes esta prueba
      // lo omitia y dependia del `?? 1.0` del dispatcher, es decir fijaba como
      // esperado un pronostico de "sesion completa" que nadie habia medido.
      const res = executeFinancialSkill('calculate_optimal_spread_avellaneda', {
        midPrice: 85.0,
        currentInventoryUsdt: 8000,
        targetInventoryUsdt: 5000,
        volatilityDaily: 0.02,
        timeRemainingFraction: 1.0,
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
          // Antes esta skill estimaba la tasa VES/USD en 85.0 por defecto. La
          // tasa es un hecho del mercado: el test la provee explícitamente.
          vesRatePerUsd: 85.0,
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
          requestedAmountUsd: 1000,
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

      it('refuses predict_bcv_macro_regime instead of defaulting the rates', () => {
        // This used to be `|| 80.0` and `|| 85.0`. With no rates supplied the
        // skill returned a confident regime plus a directive to drain bolivars
        // into USDT, all derived from two numbers nobody measured.
        const res = executeFinancialSkill('predict_bcv_macro_regime', {});

        expect(res.success).toBe(false);
        expect((res as any).data).toBeNull();
        expect((res as any).actionable).toBe(false);
        expect((res as any).unavailableReason).toMatch(/SIN_TASA_EN_VIVO/);
        expect((res as any).expectedSource).toContain('get_bcv_rates');

        // No invented rate and no trade directive may leak into the output.
        // Scoped to the rate fields — a bare "80" would also match a timestamp.
        const serialized = JSON.stringify(res);
        expect(serialized).not.toMatch(/"bcvOfficialRate":\s*\d/);
        expect(serialized).not.toMatch(/"parallelMarketRate":\s*\d/);
        expect(serialized).not.toMatch(/drenar|Drenar/);
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
          parallelRate: 85.0,
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
          activeRate: 85.0,
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

    // -------------------------------------------------------------------
    // Fail-closed: no skill may invent a measured quantity.
    //
    // Every case below used to succeed via a `||` default. A default is not a
    // fallback, it is an assertion about the world made without a source, and
    // several of these numbers drove real directives (liquidate the treasury,
    // size a Kelly bet, forward-fill bank API uptime).
    // -------------------------------------------------------------------
    describe('ausencia de evidencia: ninguna skill fabrica mediciones', () => {
      it('optimize_capital_allocation_kelly no inventa win rate ni historial', () => {
        // Kelly amplifica el edge asumido: un 75% fabricado produce un tamaño de
        // posición fabricado que mueve capital real.
        mustRefuse('optimize_capital_allocation_kelly', {
          totalCapitalUsdt: 10000,
          averageProfitPerWinUsdt: 40,
          averageLossPerLossUsdt: 15,
        }, 'winRatePct');
        mustRefuse('optimize_capital_allocation_kelly', {
          totalCapitalUsdt: 10000,
          winRatePct: 75,
          averageLossPerLossUsdt: 15,
        }, 'averageProfitPerWinUsdt');
        mustRefuse('optimize_capital_allocation_kelly', {}, 'totalCapitalUsdt');
      });

      it('optimize_treasury_idle_yield no inventa saldo ni APY', () => {
        // Un APY de 10.5% inventado produce una directiva de inversión sobre
        // rendimiento fabricado.
        mustRefuse('optimize_treasury_idle_yield', {
          totalUsdtInventory: 20000,
          currentlyCommittedUsdt: 5000,
        }, 'flexibleApyPct');
        mustRefuse('optimize_treasury_idle_yield', {
          currentlyCommittedUsdt: 5000,
          flexibleApyPct: 10.5,
        }, 'totalUsdtInventory');
      });

      it('monitor_service_health_and_fallback no inventa uptime ni latencia', () => {
        // Un monitor que siempre reporta sano da falsa garantía sobre los
        // sistemas que mueven el dinero.
        mustRefuse('monitor_service_health_and_fallback', {
          webSocketLatencyMs: 120,
          dbQueryResponseTimeMs: 15,
          unresolvedErrorsCount: 0,
        }, 'bankApiUptimePct');
        mustRefuse('monitor_service_health_and_fallback', {
          bankApiUptimePct: 99.5,
          dbQueryResponseTimeMs: 15,
          unresolvedErrorsCount: 0,
        }, 'webSocketLatencyMs');
      });

      it('las skills macro no inventan inflación ni inyección BCV', () => {
        mustRefuse('monitor_fiat_flight_and_dollarization_velocity', {
          averageVesHoldingMinutes: 30,
          merchantUsdtAcceptancePct: 80,
        }, 'monthlyInflationEstimatePct');
        mustRefuse('forecast_central_bank_liquidity_drain', {
          dayOfMonth: 15,
          dayOfWeek: 3,
          estimatedSeniatCollectionActive: true,
        }, 'weeklyBcvInjectionMillionsUsd');
      });

      it('execute_preemptive_bcv_drain no inventa probabilidad ni saldo', () => {
        // El peor caso del archivo: `|| 80` producía drainRatio 0.90 y la
        // directiva "drenar el 90% del balance antes del cierre de mesa BCV".
        mustRefuse('execute_preemptive_bcv_drain', {
          currentVesBalance: 850000,
        }, 'bcvInterventionProbabilityPct');
        mustRefuse('execute_preemptive_bcv_drain', {
          bcvInterventionProbabilityPct: 80,
        }, 'currentVesBalance');
      });

      it('un cero legítimo no se confunde con ausencia', () => {
        // El `||` viejo reemplazaba un 0 real por el default. Ahora sobrevive.
        const res = executeFinancialSkill('optimize_capital_allocation_kelly', {
          totalCapitalUsdt: 10000,
          winRatePct: 0,
          averageProfitPerWinUsdt: 40,
          averageLossPerLossUsdt: 15,
        });
        expect(res.success).toBe(true);
      });

      it('una probabilidad provista sigue etiquetada como no calibrada', () => {
        const res = executeFinancialSkill('execute_preemptive_bcv_drain', {
          currentVesBalance: 850000,
          bcvInterventionProbabilityPct: 88,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.probabilityBasis).toBe('HEURISTIC_UNCALIBRATED');
        expect(data.isVerifiedIntervention).toBe(false);
        expect(data.actionable).toBe(false);
        // No debe afirmar un cierre de mesa BCV como hecho.
        expect(data.recommendedAction).not.toMatch(/antes del cierre de mesa/i);
        expect(res.actionable).toBe(false);
      });
    });

    // -------------------------------------------------------------------
    // Lote 1 — precios y tasas de mercado.
    //
    // Un precio de mercado no tiene default legítimo: `|| 85.0` no es un
    // fallback, es una afirmación sobre el mundo. Con 85.0 inventado, un
    // spread, un hedge o una cotización a cliente salían con números que
    // nadie midió.
    // -------------------------------------------------------------------
    describe('lote 1: precios y tasas de mercado sin fuente no se inventan', () => {
      it('evaluate_delta_neutral_hedge no inventa la tasa paralelo', () => {
        mustRefuse('evaluate_delta_neutral_hedge', {
          vesBalance: 200000,
          usdtBalance: 1000,
          vesMaxHoldingTimeMinutes: 45,
        }, 'currentParallelRate');
      });

      it('calculate_optimal_spread_avellaneda no inventa el mid price', () => {
        mustRefuse('calculate_optimal_spread_avellaneda', {
          currentInventoryUsdt: 8000,
          targetInventoryUsdt: 5000,
          volatilityDaily: 0.02,
        }, 'midPrice');
      });

      it('compute_optimal_order_slicing_twap_vwap no inventa el mid price', () => {
        mustRefuse('compute_optimal_order_slicing_twap_vwap', {
          totalAmountUsdt: 8000,
          executionDurationMinutes: 45,
          estimatedMarketVolumePerHourUsdt: 50000,
          algorithm: 'TWAP',
        }, 'currentMidPrice');
      });

      it('calculate_convexity_and_gamma_risk no inventa la tasa spot', () => {
        mustRefuse('calculate_convexity_and_gamma_risk', {
          vesHoldingAmount: 100000,
          expectedDevaluationJumpPct: 15,
          timeHorizonDays: 1,
        }, 'spotParallelRate');
      });

      it('simulate_game_theory_nash_repricing no inventa mi precio', () => {
        mustRefuse('simulate_game_theory_nash_repricing', {
          targetSide: 'BUY',
          topCompetitors: [{ competitorId: 'C1', price: 86.5, availableAmountUsdt: 5000 }],
          minimumSpreadAllowedPct: 0.8,
        }, 'myCurrentPrice');
      });

      it('evaluate_dual_investment_p2p_exit no inventa spot ni strike', () => {
        mustRefuse('evaluate_dual_investment_p2p_exit', {
          strikePrice: 68000,
          durationDays: 7,
          annualizedAprPct: 20.0,
          investedCapitalUsdt: 1000,
        }, 'currentSpotPrice');
        mustRefuse('evaluate_dual_investment_p2p_exit', {
          currentSpotPrice: 65000,
          durationDays: 7,
          annualizedAprPct: 20.0,
          investedCapitalUsdt: 1000,
        }, 'strikePrice');
      });

      it('qualify_direct_lead_and_close no inventa la tasa paralelo', () => {
        mustRefuse('qualify_direct_lead_and_close', {
          leadChannel: 'WHATSAPP',
          estimatedWeeklyVolumeUsdt: 5000,
          paymentMethodPreferred: 'Banesco',
          isKycVerified: true,
          primaryConcern: 'SPEED',
        }, 'currentParallelRate');
      });

      it('generate_social_traffic_funnel no inventa la brecha BCV', () => {
        mustRefuse('generate_social_traffic_funnel', {
          targetAudience: 'RETAIL_SAVERS',
          platform: 'INSTAGRAM',
          educationalTheme: 'INFLATION_HEDGE',
        }, 'currentBcvGapPct');
      });

      it('benchmark_competitor_market_intelligence no inventa nuestro precio', () => {
        mustRefuse('benchmark_competitor_market_intelligence', {
          targetSide: 'BUY',
          ourMinMarginPct: 0.8,
          competitorOffers: [{ advertiserName: 'Rival', price: 87.0, availableAmountUsdt: 3000 }],
        }, 'ourCurrentPrice');
      });

      it('sync_google_sheets_live_ledger no inventa la tasa del trade', () => {
        mustRefuse('sync_google_sheets_live_ledger', {
          tradeDate: '2026-09-18',
          orderId: 'ORD-1',
          counterpartyAlias: 'VipBuyer',
          tradeType: 'SELL',
          cryptoAmountUsdt: 1000,
          fiatAmountVes: 85000,
          platformFeeUsdt: 1.0,
          bankTransferFeeVes: 25.0,
        }, 'exchangeRate');
      });

      it('route_fintech_payroll_settlement no inventa la tasa VES/USD', () => {
        mustRefuse('route_fintech_payroll_settlement', {
          sourcePlatform: 'DEEL',
          amountUsd: 2500,
          targetDestination: 'VES_BANESCO',
        }, 'vesRatePerUsd');
      });

      it('recommend_counterparty_yield_price no inventa la tasa base', () => {
        // El alias `marketBasePrice` debe seguir funcionando como primera opción.
        mustRefuse('recommend_counterparty_yield_price', {
          counterpartyId: 'CP-1',
          orderSide: 'BUY',
          averageReleaseMinutes: 15,
          completedTradesCount: 100,
          disputeCount: 0,
          monthlyVolumeUsd: 10000,
          requestedAmountUsd: 1000,
        }, 'marketBasePrice');
      });

      it('process_concierge_inquiry no inventa la tasa de mesa', () => {
        // Cita a un cliente: un 87.0 inventado viaja directo al WhatsApp.
        mustRefuse('process_concierge_inquiry', {
          message: 'A cuanto tienen la tasa de USDT para comprar 500?',
          currentBcvRate: 80.0,
          currentParallelRate: 86.0,
          deskBuyRate: 85.0,
        }, 'deskSellRate');
      });

      it('execute_maker_laddering_plan no inventa el mid price', () => {
        mustRefuse('execute_maker_laddering_plan', {
          currentInventoryUsdt: 6000,
          targetInventoryUsdt: 5000,
        }, 'midPrice');
      });

      it('enforce_depeg_delta_hedge no inventa el precio de conversión', () => {
        mustRefuse('enforce_depeg_delta_hedge', {
          inventoryVes: 500000,
          hedgeRatioPct: 80,
        }, 'currentPrice');
      });

      it('negotiate_whatsapp_order_intake no inventa la tasa activa', () => {
        mustRefuse('negotiate_whatsapp_order_intake', {
          customerMessage: 'Quiero cambiar 250 USDT a Banesco',
          bankName: 'Banesco',
          accountDetails: '0134-XXXX a nombre de P2P Desk',
        }, 'activeRate');
      });

      it('model_bnb_vault_yield_stacking no inventa el precio de BNB', () => {
        mustRefuse('model_bnb_vault_yield_stacking', {
          bnbAmount: 10,
          simpleEarnAprPct: 1.5,
          activeLaunchpoolsCount: 3,
          averageLaunchpoolAprPct: 12.0,
        }, 'bnbPriceUsdt');
      });

      it('forecast_market_volatility_2h no inventa el spread actual', () => {
        mustRefuse('forecast_market_volatility_2h', {
          recentTicks: [],
          parallelRate: 82.0,
          bcvRate: 70.0,
        }, 'currentSpreadPct');
      });

      it('las tasas provistas siguen calculando igual que antes', () => {
        const res = executeFinancialSkill('execute_maker_laddering_plan', {
          midPrice: 85.0,
          currentInventoryUsdt: 6000,
          targetInventoryUsdt: 5000,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.midPrice).toBe(85.0);
        expect(data.makerQuotes.reservationPrice).toBeLessThan(85.0);
      });
    });

    // -------------------------------------------------------------------
    // Lote 2 — rendimiento publicado por el venue.
    //
    // Un APR es lo que la plataforma PAGA. Fabricarlo es rendimiento
    // inventado: con un 10.0% inventado, la skill repartía capital real
    // entre tiers que no rinden eso, y el operador veía un plan rentable
    // construido sobre una cifra que nadie cobró.
    // -------------------------------------------------------------------
    describe('lote 2: el rendimiento del venue no se inventa', () => {
      const earnBase = {
        capitalUsdt: 5000,
        tier1LimitUsdt: 500,
        holdingDays: 30,
      };

      it('optimize_idle_capital_simple_earn no inventa el APR de los tiers', () => {
        mustRefuse('optimize_idle_capital_simple_earn', { ...earnBase, tier2AprPct: 2.5 }, 'tier1AprPct');
        mustRefuse('optimize_idle_capital_simple_earn', { ...earnBase, tier1AprPct: 10.0 }, 'tier2AprPct');
      });

      it('forecast_flexible_earn_tier_saturation no inventa el APR de los tiers', () => {
        const base = { totalCapitalUsdt: 10000, tier1LimitPerAccountUsdt: 500 };
        mustRefuse('forecast_flexible_earn_tier_saturation', { ...base, tier2AprPct: 2.5 }, 'tier1AprPct');
        mustRefuse('forecast_flexible_earn_tier_saturation', { ...base, tier1AprPct: 10.0 }, 'tier2AprPct');
      });

      it('evaluate_dual_investment_p2p_exit no inventa el APR anualizado', () => {
        mustRefuse('evaluate_dual_investment_p2p_exit', {
          currentSpotPrice: 65000,
          strikePrice: 68000,
          durationDays: 7,
          investedCapitalUsdt: 1000,
        }, 'annualizedAprPct');
      });

      it('calculate_usdt_fdusd_yield_arbitrage no inventa los APR flexibles', () => {
        const base = { usdtBalance: 5000, fdusdBalance: 5000, usdtFdusdMarketRate: 1.0 };
        mustRefuse('calculate_usdt_fdusd_yield_arbitrage', { ...base, fdusdFlexibleAprPct: 7.0 }, 'usdtFlexibleAprPct');
        mustRefuse('calculate_usdt_fdusd_yield_arbitrage', { ...base, usdtFlexibleAprPct: 2.5 }, 'fdusdFlexibleAprPct');
      });

      it('optimize_locked_vs_flexible_liquidity_ladder no inventa los APR de la escalera', () => {
        const base = { totalTreasuryUsdt: 20000, dailyP2pVolumeUsdt: 5000, p2pTurnoverDays: 1 };
        mustRefuse('optimize_locked_vs_flexible_liquidity_ladder', { ...base, locked30dAprPct: 5.5, locked60dAprPct: 8.0 }, 'flexibleAprPct');
        mustRefuse('optimize_locked_vs_flexible_liquidity_ladder', { ...base, flexibleAprPct: 2.5, locked60dAprPct: 8.0 }, 'locked30dAprPct');
        mustRefuse('optimize_locked_vs_flexible_liquidity_ladder', { ...base, flexibleAprPct: 2.5, locked30dAprPct: 5.5 }, 'locked60dAprPct');
      });

      it('calculate_earn_yield_vs_p2p_hurdle_rate no inventa el APR de Simple Earn', () => {
        // La skill compara contra Simple Earn para decidir P2P vs Earn. Con un
        // 4.0% inventado, la veredicto "OPERATE_P2P" puede ser al revés.
        mustRefuse('calculate_earn_yield_vs_p2p_hurdle_rate', {
          grossP2pSpreadPct: 1.5,
          platformFeePct: 0.1,
          bankingRiskPremiumPct: 0.2,
          fxDevaluationRiskPct: 0.3,
          averageTradeCycleHours: 2,
        }, 'simpleEarnAprPct');
      });

      it('model_bnb_vault_yield_stacking no inventa APRs ni Launchpools activos', () => {
        const base = { bnbAmount: 10, bnbPriceUsdt: 600 };
        mustRefuse('model_bnb_vault_yield_stacking', { ...base, activeLaunchpoolsCount: 3, averageLaunchpoolAprPct: 12.0 }, 'simpleEarnAprPct');
        mustRefuse('model_bnb_vault_yield_stacking', { ...base, simpleEarnAprPct: 1.5, averageLaunchpoolAprPct: 12.0 }, 'activeLaunchpoolsCount');
        mustRefuse('model_bnb_vault_yield_stacking', { ...base, simpleEarnAprPct: 1.5, activeLaunchpoolsCount: 3 }, 'averageLaunchpoolAprPct');
      });

      it('model_launchpool_capital_parking no inventa el estado real del pool', () => {
        const base = { capitalUsdt: 5000, launchpoolDurationDays: 4 };
        mustRefuse('model_launchpool_capital_parking', { ...base, dailyRewardPoolTokens: 200000, estimatedTokenListingPriceUsdt: 2.0 }, 'totalPoolStaked');
        mustRefuse('model_launchpool_capital_parking', { ...base, totalPoolStaked: 100000000, estimatedTokenListingPriceUsdt: 2.0 }, 'dailyRewardPoolTokens');
      });

      it('calculate_optimal_spread_avellaneda no inventa la volatilidad', () => {
        mustRefuse('calculate_optimal_spread_avellaneda', {
          midPrice: 85.0,
          currentInventoryUsdt: 8000,
          targetInventoryUsdt: 5000,
        }, 'volatilityDaily');
      });

      it('model_perpetual_funding_arbitrage no inventa el funding rate', () => {
        // El funding es el edge completo del carry. Un 0.01% inventado
        // convierte una operación perdedora en supposedly rentable.
        mustRefuse('model_perpetual_funding_arbitrage', {
          collateralUsdt: 5000,
          holdingPeriodDays: 7,
        }, 'currentFundingRate8hPct');
      });

      it('compute_optimal_order_slicing_twap_vwap no inventa el volumen de mercado', () => {
        mustRefuse('compute_optimal_order_slicing_twap_vwap', {
          totalAmountUsdt: 8000,
          executionDurationMinutes: 45,
          currentMidPrice: 85.0,
          algorithm: 'TWAP',
        }, 'estimatedMarketVolumePerHourUsdt');
      });

      it('los APR provistos siguen calculando igual que antes', () => {
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
      });
    });

    // -------------------------------------------------------------------
    // Lote 3 — track record de terceros.
    //
    // Esta es la peor clase de default: el historial de otro operador decide
    // a quién se le paga y a qué tasa. Un "100 trades, 0 disputas, 15 min"
    // inventado convierte un contraparte desconocido en la de mejor perfil
    // del book y ajusta el precio al alza.
    // -------------------------------------------------------------------
    describe('lote 3: el historial de un tercero no se inventa', () => {
      const counterpartyBase = {
        counterpartyId: 'CP-SLOW-1',
        marketBasePrice: 85.0,
        orderSide: 'BUY',
        requestedAmountUsd: 1000,
      };
      const track = {
        averageReleaseMinutes: 15,
        completedTradesCount: 100,
        disputeCount: 0,
        monthlyVolumeUsd: 10000,
      };

      it('recommend_counterparty_yield_price no inventa el historial', () => {
        mustRefuse('recommend_counterparty_yield_price', {
          ...counterpartyBase,
          ...track,
          averageReleaseMinutes: undefined,
        }, 'averageReleaseMinutes');
        mustRefuse('recommend_counterparty_yield_price', {
          ...counterpartyBase,
          ...track,
          completedTradesCount: undefined,
        }, 'completedTradesCount');
        mustRefuse('recommend_counterparty_yield_price', {
          ...counterpartyBase,
          ...track,
          disputeCount: undefined,
        }, 'disputeCount');
        mustRefuse('recommend_counterparty_yield_price', {
          ...counterpartyBase,
          ...track,
          monthlyVolumeUsd: undefined,
        }, 'monthlyVolumeUsd');
      });

      it('classify_and_price_client_tier no inventa el historial', () => {
        mustRefuse('classify_and_price_client_tier', {
          counterpartyId: 'VIP-TRADER',
          ...track,
          averageReleaseMinutes: undefined,
        }, 'averageReleaseMinutes');
        mustRefuse('classify_and_price_client_tier', {
          counterpartyId: 'VIP-TRADER',
          ...track,
          completedTradesCount: undefined,
        }, 'completedTradesCount');
        mustRefuse('classify_and_price_client_tier', {
          counterpartyId: 'VIP-TRADER',
          ...track,
          disputeCount: undefined,
        }, 'disputeCount');
        mustRefuse('classify_and_price_client_tier', {
          counterpartyId: 'VIP-TRADER',
          ...track,
          monthlyVolumeUsd: undefined,
        }, 'monthlyVolumeUsd');
      });

      it('sin historial no se clasifica a nadie como contraparte de riesgo cero', () => {
        // El `|| 0` viejo de disputas era el más peligroso: 0 disputas
        // significa "nunca disputó", no "no lo sabemos".
        const res = executeFinancialSkill('classify_and_price_client_tier', {
          counterpartyId: 'DESCONOCIDO',
          averageReleaseMinutes: 15,
          completedTradesCount: 100,
          disputeCount: 0,
        });
        expect(res.success).toBe(false);
        expect(res.data).toBeNull();
        expect(JSON.stringify(res)).not.toMatch(/"tier":"[A-Z_]+"/);
      });

      it('un historial real sigue clasificando igual que antes', () => {
        const res = executeFinancialSkill('classify_and_price_client_tier', {
          counterpartyId: 'VIP-TRADER',
          averageReleaseMinutes: 2,
          completedTradesCount: 350,
          disputeCount: 0,
          monthlyVolumeUsd: 45000,
        });
        expect(res.success).toBe(true);
        expect((res.data as any).tier).toBe('VIP_INSTITUTIONAL');
      });
    });

    // -------------------------------------------------------------------
    // Lote 4 — saldos, capital declarado, flujo y costes reales.
    //
    // Un saldo inventado no falla visiblemente: se planifica una operación
    // sobre dinero que el operador no tiene. Peor aún, `|| 0` sobre un saldo
    // produce "no tengo nada", que es una afirmación, no una ausencia.
    // -------------------------------------------------------------------
    describe('lote 4: saldos, capital y costes propios no se inventan', () => {
      it('evaluate_delta_neutral_hedge exige los saldos reales', () => {
        mustRefuse('evaluate_delta_neutral_hedge', {
          usdtBalance: 1000,
          currentParallelRate: 80.0,
          vesMaxHoldingTimeMinutes: 45,
        }, 'vesBalance');
        mustRefuse('evaluate_delta_neutral_hedge', {
          vesBalance: 200000,
          currentParallelRate: 80.0,
          vesMaxHoldingTimeMinutes: 45,
        }, 'usdtBalance');
      });

      it('calculate_optimal_spread_avellaneda exige el inventario declarado', () => {
        mustRefuse('calculate_optimal_spread_avellaneda', {
          midPrice: 85.0,
          targetInventoryUsdt: 5000,
          volatilityDaily: 0.02,
        }, 'currentInventoryUsdt');
        mustRefuse('calculate_optimal_spread_avellaneda', {
          midPrice: 85.0,
          currentInventoryUsdt: 8000,
          volatilityDaily: 0.02,
        }, 'targetInventoryUsdt');
      });

      it('compute_optimal_order_slicing_twap_vwap exige el monto total', () => {
        mustRefuse('compute_optimal_order_slicing_twap_vwap', {
          executionDurationMinutes: 45,
          estimatedMarketVolumePerHourUsdt: 50000,
          currentMidPrice: 85.0,
          algorithm: 'TWAP',
        }, 'totalAmountUsdt');
      });

      it('analyze_fx_corridor_efficiency exige el monto base', () => {
        mustRefuse('analyze_fx_corridor_efficiency', { corridors: [] }, 'baseAmountUsdt');
      });

      it('calculate_cross_exchange_basis_spread exige el capital', () => {
        mustRefuse('calculate_cross_exchange_basis_spread', { platforms: [] }, 'capitalUsdt');
      });

      it('model_perpetual_funding_arbitrage exige el collateral', () => {
        mustRefuse('model_perpetual_funding_arbitrage', {
          currentFundingRate8hPct: 0.035,
          holdingPeriodDays: 7,
        }, 'collateralUsdt');
      });

      it('optimize_idle_capital_simple_earn exige el capital real', () => {
        mustRefuse('optimize_idle_capital_simple_earn', {
          tier1LimitUsdt: 500,
          tier1AprPct: 10.0,
          tier2AprPct: 2.5,
        }, 'capitalUsdt');
      });

      it('evaluate_dual_investment_p2p_exit exige el capital invertido', () => {
        mustRefuse('evaluate_dual_investment_p2p_exit', {
          currentSpotPrice: 65000,
          strikePrice: 68000,
          durationDays: 7,
          annualizedAprPct: 20.0,
        }, 'investedCapitalUsdt');
      });

      it('calculate_usdt_fdusd_yield_arbitrage exige los saldos', () => {
        mustRefuse('calculate_usdt_fdusd_yield_arbitrage', {
          fdusdBalance: 5000,
          usdtFlexibleAprPct: 2.5,
          fdusdFlexibleAprPct: 7.0,
        }, 'usdtBalance');
        mustRefuse('calculate_usdt_fdusd_yield_arbitrage', {
          usdtBalance: 5000,
          usdtFlexibleAprPct: 2.5,
          fdusdFlexibleAprPct: 7.0,
        }, 'fdusdBalance');
      });

      it('model_launchpool_capital_parking exige el capital', () => {
        mustRefuse('model_launchpool_capital_parking', {
          launchpoolDurationDays: 4,
          totalPoolStaked: 100000000,
          dailyRewardPoolTokens: 200000,
        }, 'capitalUsdt');
      });

      it('optimize_locked_vs_flexible_liquidity_ladder exige tesorería y volumen', () => {
        mustRefuse('optimize_locked_vs_flexible_liquidity_ladder', {
          dailyP2pVolumeUsdt: 5000,
          p2pTurnoverDays: 1,
          flexibleAprPct: 2.5,
          locked30dAprPct: 5.5,
          locked60dAprPct: 8.0,
        }, 'totalTreasuryUsdt');
        mustRefuse('optimize_locked_vs_flexible_liquidity_ladder', {
          totalTreasuryUsdt: 20000,
          p2pTurnoverDays: 1,
          flexibleAprPct: 2.5,
          locked30dAprPct: 5.5,
          locked60dAprPct: 8.0,
        }, 'dailyP2pVolumeUsdt');
      });

      it('calculate_earn_yield_vs_p2p_hurdle_rate exige spread, comisión y ciclo reales', () => {
        const base = {
          bankingRiskPremiumPct: 0.2,
          fxDevaluationRiskPct: 0.3,
          simpleEarnAprPct: 4.0,
        };
        mustRefuse('calculate_earn_yield_vs_p2p_hurdle_rate', { ...base, platformFeePct: 0.1, averageTradeCycleHours: 2 }, 'grossP2pSpreadPct');
        mustRefuse('calculate_earn_yield_vs_p2p_hurdle_rate', { ...base, grossP2pSpreadPct: 1.5, averageTradeCycleHours: 2 }, 'platformFeePct');
        mustRefuse('calculate_earn_yield_vs_p2p_hurdle_rate', { ...base, grossP2pSpreadPct: 1.5, platformFeePct: 0.1 }, 'averageTradeCycleHours');
      });

      it('model_bnb_vault_yield_stacking exige la cantidad de BNB', () => {
        mustRefuse('model_bnb_vault_yield_stacking', {
          bnbPriceUsdt: 600,
          simpleEarnAprPct: 1.5,
          activeLaunchpoolsCount: 3,
          averageLaunchpoolAprPct: 12.0,
        }, 'bnbAmount');
      });

      it('forecast_flexible_earn_tier_saturation exige el capital total', () => {
        mustRefuse('forecast_flexible_earn_tier_saturation', {
          tier1LimitPerAccountUsdt: 500,
          tier1AprPct: 10.0,
          tier2AprPct: 2.5,
        }, 'totalCapitalUsdt');
      });

      it('calculate_auto_invest_dca_spread_funnel exige la utilidad real', () => {
        mustRefuse('calculate_auto_invest_dca_spread_funnel', {
          reinvestmentRatioPct: 25,
          targetAsset: 'BTC',
        }, 'monthlyP2pNetProfitUsdt');
      });

      it('simulate_earn_instant_redemption_latency exige el monto a redimir', () => {
        mustRefuse('simulate_earn_instant_redemption_latency', {
          dailyInstantQuotaUsdt: 1000000,
        }, 'redemptionAmountUsdt');
      });

      it('qualify_direct_lead_and_close exige el volumen declarado del cliente', () => {
        mustRefuse('qualify_direct_lead_and_close', {
          leadChannel: 'WHATSAPP',
          paymentMethodPreferred: 'Banesco',
          isKycVerified: true,
          primaryConcern: 'SPEED',
          currentParallelRate: 85.0,
        }, 'estimatedWeeklyVolumeUsdt');
      });

      it('triage_incident_and_escalate exige el monto en riesgo', () => {
        mustRefuse('triage_incident_and_escalate', {
          incidentType: 'BANK_ACCOUNT_HOLD',
          orderId: 'ORD-CRISIS-1',
        }, 'amountAtRiskUsdt');
      });

      it('audit_sop_compliance_enforcement exige el tiempo real de respuesta', () => {
        mustRefuse('audit_sop_compliance_enforcement', {
          orderId: 'ORD-SOP-99',
          accountHolderMatchesDocument: true,
          bankBalanceConfirmedInAvailableFunds: true,
          fundsReleasedBeforeBankVerification: false,
        }, 'responseTimeMinutes');
      });

      it('sync_google_sheets_live_ledger exige montos y costes reales del trade', () => {
        const base = {
          tradeDate: '2026-09-18',
          orderId: 'ORD-1',
          counterpartyAlias: 'VipBuyer',
          tradeType: 'SELL',
          exchangeRate: 85.0,
        };
        mustRefuse('sync_google_sheets_live_ledger', { ...base, fiatAmountVes: 85000, platformFeeUsdt: 1.0, bankTransferFeeVes: 25.0 }, 'cryptoAmountUsdt');
        mustRefuse('sync_google_sheets_live_ledger', { ...base, cryptoAmountUsdt: 1000, platformFeeUsdt: 1.0, bankTransferFeeVes: 25.0 }, 'fiatAmountVes');
        mustRefuse('sync_google_sheets_live_ledger', { ...base, cryptoAmountUsdt: 1000, fiatAmountVes: 85000, bankTransferFeeVes: 25.0 }, 'platformFeeUsdt');
        mustRefuse('sync_google_sheets_live_ledger', { ...base, cryptoAmountUsdt: 1000, fiatAmountVes: 85000, platformFeeUsdt: 1.0 }, 'bankTransferFeeVes');
      });

      it('forecast_cash_flow_and_reconciliation exige la posición real', () => {
        mustRefuse('forecast_cash_flow_and_reconciliation', {
          cryptoExchangeBalancesUsdt: 4500,
          pendingUnsettledOrdersUsdt: 800,
          dailyProjectedVolumeUsdt: 3000,
          averageOperationalExpensesDailyUsdt: 35,
        }, 'fiatBankBalancesTotalUsdtEquiv');
        mustRefuse('forecast_cash_flow_and_reconciliation', {
          fiatBankBalancesTotalUsdtEquiv: 1500,
          pendingUnsettledOrdersUsdt: 800,
          dailyProjectedVolumeUsdt: 3000,
          averageOperationalExpensesDailyUsdt: 35,
        }, 'cryptoExchangeBalancesUsdt');
        mustRefuse('forecast_cash_flow_and_reconciliation', {
          fiatBankBalancesTotalUsdtEquiv: 1500,
          cryptoExchangeBalancesUsdt: 4500,
          dailyProjectedVolumeUsdt: 3000,
          averageOperationalExpensesDailyUsdt: 35,
        }, 'pendingUnsettledOrdersUsdt');
        mustRefuse('forecast_cash_flow_and_reconciliation', {
          fiatBankBalancesTotalUsdtEquiv: 1500,
          cryptoExchangeBalancesUsdt: 4500,
          pendingUnsettledOrdersUsdt: 800,
          averageOperationalExpensesDailyUsdt: 35,
        }, 'dailyProjectedVolumeUsdt');
        mustRefuse('forecast_cash_flow_and_reconciliation', {
          fiatBankBalancesTotalUsdtEquiv: 1500,
          cryptoExchangeBalancesUsdt: 4500,
          pendingUnsettledOrdersUsdt: 800,
          dailyProjectedVolumeUsdt: 3000,
        }, 'averageOperationalExpensesDailyUsdt');
      });

      it('generate_dispute_dossier no arma un dossier con monto cero', () => {
        // `|| 0` producía un dossier completo —referencias, timestamps,
        // auditoría forense— sobre una orden de monto 0.
        const res = executeFinancialSkill('generate_dispute_dossier', {
          orderId: 'BNB-998877',
          counterpartyBinanceName: 'Carlos Trader',
          bankPayerName: 'Maria Perez',
          bankName: 'Banesco',
          bankReference: '0098765432',
        });
        expect(res.success).toBe(false);
        expect(res.data).toBeNull();
        expect(res.unavailableReason).toBe('missing_evidence:orderAmountFiat');
      });

      it('simulate_trade_impact no simula una orden de monto cero', () => {
        mustRefuse('simulate_trade_impact', { side: 'BUY', availableOffers: [] }, 'targetAmountUsdt');
      });

      it('balance_cross_exchange_inventory exige los tres saldos', () => {
        mustRefuse('balance_cross_exchange_inventory', {
          bybitBalanceUsdt: 2000,
          onchainBalanceUsdt: 3000,
        }, 'binanceBalanceUsdt');
        mustRefuse('balance_cross_exchange_inventory', {
          binanceBalanceUsdt: 10000,
          onchainBalanceUsdt: 3000,
        }, 'bybitBalanceUsdt');
        mustRefuse('balance_cross_exchange_inventory', {
          binanceBalanceUsdt: 10000,
          bybitBalanceUsdt: 2000,
        }, 'onchainBalanceUsdt');
      });

      it('enforce_depeg_delta_hedge exige el inventario en VES', () => {
        mustRefuse('enforce_depeg_delta_hedge', {
          currentPrice: 85.0,
          hedgeRatioPct: 80,
        }, 'inventoryVes');
      });

      it('execute_maker_laddering_plan exige el inventario', () => {
        mustRefuse('execute_maker_laddering_plan', {
          midPrice: 85.0,
          targetInventoryUsdt: 5000,
        }, 'currentInventoryUsdt');
        mustRefuse('execute_maker_laddering_plan', {
          midPrice: 85.0,
          currentInventoryUsdt: 6000,
        }, 'targetInventoryUsdt');
      });

      it('audit_chargeback_shield exige el monto real de la operación', () => {
        mustRefuse('audit_chargeback_shield', {
          platform: 'PAYPAL',
          isVerifiedContractor: false,
        }, 'amountUsd');
      });

      it('negotiate_whatsapp_order_intake no cotiza sin monto declarado', () => {
        // Antes: un mensaje sin monto caía en 100 USDT y la skill mandaba una
        // cotización de 8.500 VES a un cliente que nunca pidió ese monto.
        const res = executeFinancialSkill('negotiate_whatsapp_order_intake', {
          customerMessage: 'Hola, buenas tardes, quiero hablar de tasas',
          activeRate: 85.5,
          bankName: 'Banesco',
          accountDetails: '0134-XXXX a nombre de P2P Desk',
        });
        expect(res.success).toBe(false);
        expect(res.data).toBeNull();
        expect(res.unavailableReason).toBe('missing_evidence:detectedAmount');
        expect(JSON.stringify(res)).not.toContain('COTIZACIÓN CONFIRMADA');
      });

      it('quote_instant_remittance_corridor exige el monto a enviar', () => {
        mustRefuse('quote_instant_remittance_corridor', {
          corridorId: 'USD_ZELLE_TO_VES',
          deskSpreadPct: 2.5,
        }, 'sendAmount');
      });

      it('los saldos provistos siguen calculando igual que antes', () => {
        const res = executeFinancialSkill('balance_cross_exchange_inventory', {
          binanceBalanceUsdt: 10000,
          bybitBalanceUsdt: 2000,
          onchainBalanceUsdt: 3000,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.totalInventoryUsdt).toBe(15000);
        expect(data.rebalanceNeeded).toBe(true);
      });
    });

    // -------------------------------------------------------------------
    // Lote 5 — umbral u horizonte elegido por el operador.
    //
    // Acá un default sí es legítimo: es una regla que el operador eligió, no
    // un hecho del mundo. Lo que no es legítimo es que el default se confunda
    // con un cero explícito: un umbral de 0 significa "sin umbral", y el `||`
    // viejo lo traducía a "umbral 0.15".
    // -------------------------------------------------------------------
    describe('lote 5: los umbrales del operador son política, y un 0 explícito se respeta', () => {
      it('enforce_depeg_delta_hedge respeta un hedgeRatioPct de 0', () => {
        const res = executeFinancialSkill('enforce_depeg_delta_hedge', {
          inventoryVes: 500000,
          currentPrice: 85.0,
          hedgeRatioPct: 0,
        });
        expect(res.success).toBe(true);
        const data = res.data as any;
        // "Sin cobertura" es una decisión válida. Con `|| 100` el operador que
        // pidió no cubrir terminaba con una orden de short completa.
        expect(data.hedgeRatioPct).toBe(0);
        expect(data.recommendedShortFuturesUsd).toBe(0);
        expect(data.action).toBe('NO_HEDGE_REQUIRED');
      });

      it('estimate_adverse_selection_vpin respeta un toxicityThreshold de 0', () => {
        const buckets = [{ buyVolume: 5000, sellVolume: 5000, totalVolume: 10000 }];
        const sinUmbral = executeFinancialSkill('estimate_adverse_selection_vpin', {
          buckets,
          toxicityThreshold: 0,
        });
        const conDefault = executeFinancialSkill('estimate_adverse_selection_vpin', { buckets });
        expect((sinUmbral.data as any).toxicBucketCount).toBe(1);
        expect((conDefault.data as any).toxicBucketCount).toBe(0);
      });

      it('audit_and_risk_analytics respeta un timeframeDays de 0', () => {
        const res = executeFinancialSkill('audit_and_risk_analytics', {
          timeframeDays: 0,
          minSpreadThresholdPct: 0.5,
          sampleEvents: [],
          sampleOperations: [],
        });
        expect(res.success).toBe(true);
        expect((res.data as any).timeframeDays).toBe(0);
      });

      it('calculate_maker_fill_probability_markov respeta un horizonte de 0', () => {
        const base = {
          queuePositionIndex: 0,
          queueAheadVolumeUsdt: 1000,
          recentFillVelocityPerMinuteUsdt: 100,
        };
        const cero = executeFinancialSkill('calculate_maker_fill_probability_markov', {
          ...base,
          targetHorizonMinutes: 0,
        });
        const conDefault = executeFinancialSkill('calculate_maker_fill_probability_markov', base);
        expect(cero.success).toBe(true);
        expect(conDefault.success).toBe(true);
        // Un horizonte de 0 minutos no es "15 minutos": es no mirar el fill.
        expect((cero.data as any).fillProbabilityInHorizonPct).toBeLessThan(
          (conDefault.data as any).fillProbabilityInHorizonPct,
        );
      });

      it('audit_distressed_liquidity_sniper respeta un umbral de dislocación de 0', () => {
        const ads = [
          { advId: 'AD-1', merchantName: 'TraderFast', price: 84.5, availableAmountCrypto: 500, minLimitFiat: 1000, maxLimitFiat: 40000, paymentMethods: ['Banesco'], orderType: 'SELL' },
        ];
        const sinUmbral = executeFinancialSkill('audit_distressed_liquidity_sniper', {
          ads,
          fairMarketRate: 85.0,
          side: 'SELL',
          minDislocationPct: 0,
        });
        const conDefault = executeFinancialSkill('audit_distressed_liquidity_sniper', {
          ads,
          fairMarketRate: 85.0,
          side: 'SELL',
        });
        expect((sinUmbral.data as any).snipingOpportunitiesCount).toBe(1);
        expect((conDefault.data as any).snipingOpportunitiesCount).toBe(0);
      });

      it('quote_instant_remittance_corridor respeta un margen de operador de 0', () => {
        const res = executeFinancialSkill('quote_instant_remittance_corridor', {
          corridorId: 'USD_ZELLE_TO_VES',
          sendAmount: 100,
          operatorMarginPct: 0,
          activeRate: 85.0,
        });
        expect(res.success).toBe(true);
        expect((res.data as any).operatorMarginPct).toBe(0);
      });

      it('calculate_earn_yield_vs_p2p_hurdle_rate respeta primas de riesgo en 0', () => {
        const base = {
          grossP2pSpreadPct: 1.5,
          platformFeePct: 0.1,
          averageTradeCycleHours: 2,
          simpleEarnAprPct: 4.0,
        };
        const sinPrimas = executeFinancialSkill('calculate_earn_yield_vs_p2p_hurdle_rate', {
          ...base,
          bankingRiskPremiumPct: 0,
          fxDevaluationRiskPct: 0,
        });
        const conDefault = executeFinancialSkill('calculate_earn_yield_vs_p2p_hurdle_rate', {
          ...base,
        });
        expect(sinPrimas.success).toBe(true);
        expect(conDefault.success).toBe(true);
        expect((sinPrimas.data as any).hourlyP2pReturnPct).toBeGreaterThan(
          (conDefault.data as any).hourlyP2pReturnPct,
        );
      });

      it('calculate_convexity_and_gamma_risk respeta un salto y un horizonte de 0', () => {
        const base = { spotParallelRate: 85.0, vesHoldingAmount: 100000 };
        const cero = executeFinancialSkill('calculate_convexity_and_gamma_risk', {
          ...base,
          expectedDevaluationJumpPct: 0,
          timeHorizonDays: 0,
        });
        const conDefault = executeFinancialSkill('calculate_convexity_and_gamma_risk', base);
        expect(cero.success).toBe(true);
        expect(conDefault.success).toBe(true);
        expect(JSON.stringify(cero.data)).not.toBe(JSON.stringify(conDefault.data));
      });

      it('el default de política sigue aplicándose cuando el operador no dice nada', () => {
        // La ausencia sigue siendo política: estos defaults NO son datos
        // inventados, son umbrales declarados por el sistema.
        const hedge = executeFinancialSkill('enforce_depeg_delta_hedge', {
          inventoryVes: 500000,
          currentPrice: 85.0,
        });
        expect((hedge.data as any).hedgeRatioPct).toBe(100);

        const sniper = executeFinancialSkill('audit_distressed_liquidity_sniper', {
          ads: [
            { advId: 'AD-1', merchantName: 'TraderFast', price: 79.0, availableAmountCrypto: 500, minLimitFiat: 1000, maxLimitFiat: 40000, paymentMethods: ['Banesco'], orderType: 'SELL' },
          ],
          fairMarketRate: 85.0,
          side: 'SELL',
        });
        expect((sniper.data as any).snipingOpportunitiesCount).toBe(1);
      });

      it('un valor no numérico cae al default de política en vez de NaN', () => {
        const res = executeFinancialSkill('enforce_depeg_delta_hedge', {
          inventoryVes: 500000,
          currentPrice: 85.0,
          hedgeRatioPct: 'mucho',
        });
        expect(res.success).toBe(true);
        expect((res.data as any).hedgeRatioPct).toBe(100);
      });
    });

    // -------------------------------------------------------------------
    // Lote 6 — los defaults que la tabla no listó, más dos tasas
    // hardcodeadas que no eran `||` y por eso no aparecían en ningún
    // inventario. Mismo defecto, distinto disfraz: un número inventado
    // esperando que alguien lo copie a WhatsApp o a una disputa de Binance.
    // -------------------------------------------------------------------
    describe('lote 6: montos declarados y tasas que no se inventan', () => {
      it('compute_optimal_order_slicing_twap_vwap respeta una duración de 0', () => {
        const base = {
          totalAmountUsdt: 10000,
          estimatedMarketVolumePerHourUsdt: 50000,
          currentMidPrice: 85.0,
        };
        const sinDuracion = executeFinancialSkill('compute_optimal_order_slicing_twap_vwap', {
          ...base,
          executionDurationMinutes: 0,
        });
        const conDefault = executeFinancialSkill('compute_optimal_order_slicing_twap_vwap', base);
        expect(sinDuracion.success).toBe(true);
        expect(conDefault.success).toBe(true);
        expect((sinDuracion.data as any).sliceIntervalMinutes).toBeLessThan(
          (conDefault.data as any).sliceIntervalMinutes,
        );
      });

      it('calculate_convexity_and_gamma_risk no inventa la posición en VES', () => {
        // Riesgo gamma sobre una posición de 100.000 VES que nadie tiene.
        mustRefuse(
          'calculate_convexity_and_gamma_risk',
          { spotParallelRate: 85.0 },
          'vesHoldingAmount',
        );
      });

      it('query_otc_darkpool_spread no inventa el capital de arbitraje', () => {
        mustRefuse('query_otc_darkpool_spread', { quotes: [] }, 'volumeUsd');
      });

      it('route_fintech_payroll_settlement no inventa la nómina', () => {
        mustRefuse('route_fintech_payroll_settlement', { platform: 'DEEL' }, 'grossAmountUsd');
      });

      it('route_fintech_payroll_settlement acepta el alias amountUsd', () => {
        const res = executeFinancialSkill('route_fintech_payroll_settlement', {
          platform: 'DEEL',
          amountUsd: 2500,
          vesRatePerUsd: 85.0,
        });
        expect(res.success).toBe(true);
      });

      it('recommend_counterparty_yield_price no inventa el monto solicitado', () => {
        mustRefuse(
          'recommend_counterparty_yield_price',
          {
            counterpartyId: 'CP-1',
            baseMarketRate: 85.0,
            averageReleaseMinutes: 10,
            completedTradesCount: 25,
            disputeCount: 0,
            monthlyVolumeUsd: 50000,
          },
          'requestedAmountUsd',
        );
      });

      it('bundle_corporate_b2b_dossier no inventa el monto de la factura', () => {
        mustRefuse(
          'bundle_corporate_b2b_dossier',
          { clientName: 'ACME S.A.', taxId: 'J-12345678-9' },
          'amountUsd',
        );
      });

      it('compile_fast_dispute_evidence no inventa el monto reclamado', () => {
        mustRefuse(
          'compile_fast_dispute_evidence',
          { orderId: 'ORD-1', counterpartyName: 'X', disputeReason: 'Y', parallelRate: 85.0 },
          'claimedAmount',
        );
      });

      it('compile_fast_dispute_evidence no convierte el reclamo con un 85.0 fijo', () => {
        // El 85.0 estaba hardcodeado dividiendo el monto. Sin tasa real, el
        // dossier pericial convertía un reclamo con una tasa que nadie midió.
        mustRefuse(
          'compile_fast_dispute_evidence',
          { orderId: 'ORD-1', counterpartyName: 'X', disputeReason: 'Y', claimedAmount: 45000 },
          'parallelRate',
        );
      });

      it('compile_fast_dispute_evidence convierte con la tasa que le pasan', () => {
        const con90 = executeFinancialSkill('compile_fast_dispute_evidence', {
          orderId: 'ORD-1',
          counterpartyName: 'X',
          disputeReason: 'Y',
          claimedAmount: 45000,
          parallelRate: 90.0,
        });
        const con45 = executeFinancialSkill('compile_fast_dispute_evidence', {
          orderId: 'ORD-1',
          counterpartyName: 'X',
          disputeReason: 'Y',
          claimedAmount: 45000,
          parallelRate: 45.0,
        });
        expect(con90.success).toBe(true);
        expect(con45.success).toBe(true);
        const linea90 = (con90.data as any).timeline[0].description as string;
        const linea45 = (con45.data as any).timeline[0].description as string;
        // 45000 VES / 90 = 500 USDT. Con el 85.0 fijo salía 529.41.
        expect(linea90).toContain('500 USDT');
        expect(linea90).not.toBe(linea45);
      });

      it('quote_instant_remittance_corridor no inventa la tasa destino', () => {
        mustRefuse(
          'quote_instant_remittance_corridor',
          { corridorId: 'USD_ZELLE_TO_VES', sendAmount: 100, deskSpreadPct: 2.5 },
          'activeRate',
        );
      });

      it('quote_instant_remittance_corridor cambia el payout con la tasa que le pasan', () => {
        const con85 = executeFinancialSkill('quote_instant_remittance_corridor', {
          corridorId: 'USD_ZELLE_TO_VES',
          sendAmount: 100,
          deskSpreadPct: 2.5,
          activeRate: 85.0,
        });
        const con90 = executeFinancialSkill('quote_instant_remittance_corridor', {
          corridorId: 'USD_ZELLE_TO_VES',
          sendAmount: 100,
          deskSpreadPct: 2.5,
          activeRate: 90.0,
        });
        expect(con85.success).toBe(true);
        expect(con90.success).toBe(true);
        expect((con85.data as any).destPayoutAmount).not.toBe((con90.data as any).destPayoutAmount);
      });
    });
  });
});
