import {
  computeSpread,
  evaluate,
  type RuleContext,
  predictBcvIntervention,
  getBcvMarketIntelligence,
  generateBlindHash,
  DEFAULT_ZK_SALT_DOMAIN,
  simulateCompoundGrowth,
  buildPortfolioAllocationPlan,
  scanSyntheticStableCurves,
  scanOrderbookSnipingOpportunities,
  aggregateDarkPoolOpportunities,
  calculateFintechSettlementQuote,
  calculateDynamicCounterpartyPricing,
  parseCustomerChatMessage,
  generateConciergeReply,
  evaluateMacroBcvRegime,
  calculateTreasuryYieldAllocation,
  compileBrowserOperatorTask,
} from '@p2p/core';

export interface McpFallbackAvailability {
  readonly degraded: boolean;
  readonly reason: string;
}

export const MCP_FALLBACK_DEGRADED_REASON =
  'El entorno web no cuenta con conexión al daemon MCP de Electron ni APIs bancarias o de exchange en vivo. ' +
  'Las respuestas son simulaciones referenciales y ninguna recomendación financiera es ejecutable automáticamente.';

const DEGRADED_MCP_AVAILABILITY: McpFallbackAvailability = Object.freeze({
  degraded: true,
  reason: MCP_FALLBACK_DEGRADED_REASON,
});

/**
 * Simula la ejecución de herramientas MCP en modo web cuando no hay conexión nativa de Electron.
 */
export function simulateMcpTool(
  toolName: string,
  args: unknown,
  executionTimeMs: number,
): Record<string, unknown> {
  let simulatedResult: Record<string, unknown> = {
    toolName,
    status: 'OK',
    simulated: true,
    actionable: false,
    availability: DEGRADED_MCP_AVAILABILITY,
    args,
    message: `Ejecución de prueba simulada localmente en ${executionTimeMs} ms (modo degradado).`,
  };

  if (toolName === 'calculate_spread') {
    const buyPrice = Number((args as any)?.buyPrice ?? 78.5);
    const sellPrice = Number((args as any)?.sellPrice ?? 79.8);
    const makerFee = Number((args as any)?.makerFeePct ?? 0.35);
    const takerFee = Number((args as any)?.takerFeePct ?? 0);
    const totalFeeRate = (makerFee + takerFee) / 100;
    const spread = computeSpread(buyPrice, sellPrice, 100, 'USDT', totalFeeRate);
    const unitSpread = spread.unitSpread;
    const grossSpreadPercent = (unitSpread / buyPrice) * 100;
    const netSpreadPercent = (spread.netGainVes / (buyPrice * 100)) * 100;
    const isGolden = netSpreadPercent >= 0.5;
    simulatedResult = {
      ...simulatedResult,
      unitSpread: Number(unitSpread.toFixed(4)),
      grossSpreadPercent: Number(grossSpreadPercent.toFixed(2)),
      netGainVes: Number(spread.netGainVes.toFixed(2)),
      netSpreadPercent: Number(netSpreadPercent.toFixed(2)),
      isGoldenSpread: isGolden,
      recommendation: isGolden ? 'VIABLE_INSTITUCIONAL' : 'SPREAD_SUB_OPTIMAL',
    };
  } else if (toolName === 'evaluate_trade_risk') {
    const tradeAmount = Number((args as any)?.tradeAmountUsdt ?? 500);
    const capital = Number((args as any)?.currentCapitalUsdt ?? 5000);
    const score = Number((args as any)?.counterpartyScore ?? 98);
    const tradeRiskPct = (tradeAmount / capital) * 100;
    // The spread is an observed market value. Without a caller-supplied reading the
    // MIN_SPREAD rule cannot be evaluated, so we declare absence instead of inventing a
    // spread that would silently clear the rule.
    const observedSpread = (args as any)?.currentSpreadPct;
    const hasObservedSpread = observedSpread !== undefined && Number(observedSpread) > 0;
    const ctx: RuleContext = {
      currentSpread: hasObservedSpread ? Number(observedSpread) : Number.NaN,
      minSpread: 0.5,
      openOps: 1,
      tradeRiskPct,
      dailyLossPct: 0,
      consecutiveErrors: score < 50 ? 2 : 0,
      maxRiskPerTradePct: 20,
    };
    const recommendedMaxUsdt = (capital * (ctx.maxRiskPerTradePct ?? 20)) / 100;

    if (!hasObservedSpread) {
      simulatedResult = {
        ...simulatedResult,
        decision: 'INSUFFICIENT_DATA',
        reason: 'MISSING_CURRENT_SPREAD',
        currentSpreadPct: null,
        tradeRiskPct: Number(tradeRiskPct.toFixed(2)),
        recommendedSizeUsdt: null,
        isCounterpartyAcceptable: null,
        violations: ['MISSING_CURRENT_SPREAD'],
        actionable: false,
      };
    } else {
      const verdict = evaluate(ctx);
      simulatedResult = {
        ...simulatedResult,
        decision: verdict.decision,
        reason: verdict.reason,
        currentSpreadPct: Number(observedSpread),
        tradeRiskPct: Number(tradeRiskPct.toFixed(2)),
        recommendedSizeUsdt: Math.min(tradeAmount, recommendedMaxUsdt),
        isCounterpartyAcceptable: score >= 70,
        violations: verdict.decision !== 'ALLOW' ? [verdict.reason] : [],
        actionable: false,
      };
    }
  } else if (toolName === 'simulate_trade_impact') {
    const currentExposure = Number((args as any)?.currentExposureUsdt ?? 400);
    const proposedTrade = Number((args as any)?.proposedTradeAmountUsdt ?? 600);
    const maxLimit = Number((args as any)?.maxDailyExposureLimitUsdt ?? 2500);
    const losses = Number((args as any)?.consecutiveLosses ?? 0);
    const projected = currentExposure + proposedTrade;
    const limitExceeded = projected > maxLimit;
    const utilization = Number(((projected / maxLimit) * 100).toFixed(1));
    const triggers: string[] = [];
    if (limitExceeded) triggers.push('DAILY_EXPOSURE_LIMIT_EXCEEDED');
    if (losses >= 3) triggers.push('MAX_CONSECUTIVE_LOSSES_TRIGGERED');
    simulatedResult = {
      ...simulatedResult,
      currentExposureUsdt: currentExposure,
      projectedExposureUsdt: projected,
      exposureUtilizationPct: utilization,
      limitExceeded,
      maxSafeRemainingUsdt: Math.max(0, maxLimit - currentExposure),
      wouldTrigger: triggers,
      verdict: triggers.length === 0 ? 'SIMULATED_WITHIN_LIMITS' : 'REQUIRES_REDUCTION',
      actionable: false,
    };
  } else if (toolName === 'consult_zk_market_mesh') {
    const rawId = String((args as any)?.rawIdentifier ?? 'V-18456789');
    const salt = String((args as any)?.saltDomain ?? DEFAULT_ZK_SALT_DOMAIN);
    const blindHash = generateBlindHash(rawId, salt);
    simulatedResult = {
      ...simulatedResult,
      blindHash,
      isFlagged: false,
      threatCategory: null,
      severity: null,
      confidenceScore: 0,
      confirmationsCount: 0,
      // No mesh was contacted, so anonymity cannot be attested. Absence, not a guarantee.
      privacyGuaranteed: false,
      verdict: 'NO_MESH_CONNECTION_UNVERIFIED',
      actionable: false,
    };
  } else if (toolName === 'forecast_volatility_window') {
    const parallel = Number((args as any)?.parallelRate ?? 84.12);
    const bcv = Number((args as any)?.bcvRate ?? 72.45);
    const bcvIntel = getBcvMarketIntelligence(parallel, bcv);
    const isInWindow = bcvIntel.window.phase === 'INTERVENTION_ACTIVE';
    const bidDepth = Number((args as any)?.bidDepthUsdt ?? 9500);
    const askDepth = Number((args as any)?.askDepthUsdt ?? 8000);
    const depthRatio = bidDepth > 0 ? askDepth / bidDepth : 1;
    let spreadDynamic: 'EXPANSION_LIKELY' | 'COMPRESSION_RISK' | 'STABLE' = 'STABLE';
    if (isInWindow && depthRatio < 0.8) {
      spreadDynamic = 'COMPRESSION_RISK';
    } else if (bcvIntel.gap.gapPct > 18) {
      spreadDynamic = 'EXPANSION_LIKELY';
    }
    simulatedResult = {
      ...simulatedResult,
      gapPct: Number(bcvIntel.gap.gapPct.toFixed(2)),
      isInBcvInterventionWindow: isInWindow,
      bcvPhase: bcvIntel.window.phase,
      hoursUntilIntervention: bcvIntel.window.hoursUntilIntervention,
      tacticalRecommendation: bcvIntel.recommendation.action,
      spreadDynamic,
      suggestedAction:
        spreadDynamic === 'COMPRESSION_RISK'
          ? 'Liquidar inventario con rapidez para evitar compresión de márgenes'
          : spreadDynamic === 'EXPANSION_LIKELY'
            ? 'Ampliar spread visible y capturar margen en puntas'
            : 'Operar con volumen normal',
    };
  } else if (toolName === 'calculate_delta_neutral_hedge') {
    const vesBal = Number((args as any)?.vesBalance ?? 120000);
    const refPrice = Number((args as any)?.usdtReferencePrice ?? 84.12);
    const targetHedge = Number((args as any)?.targetHedgePct ?? 100);
    const usdtVal = vesBal / refPrice;
    const reqHedge = (usdtVal * targetHedge) / 100;
    simulatedResult = {
      ...simulatedResult,
      vesBalance: vesBal,
      usdtReferencePrice: refPrice,
      usdtValueEquivalent: Number(usdtVal.toFixed(2)),
      targetHedgePct: targetHedge,
      requiredShortHedgeUsdt: Number(reqHedge.toFixed(2)),
      projectedLossIfUnhedged5PctUsd: Number((usdtVal * 0.05).toFixed(2)),
      recommendedInstrument: 'Perpetual Futures 1x Short o Aave Variable Debt',
      humanInTheLoopNotice:
        'Requiere confirmación explícita del operador antes de abrir posición en protocolo de derivados.',
    };
  } else if (toolName === 'trigger_killswitch') {
    const reason = String((args as any)?.reason ?? 'Parada de emergencia');
    const source = String((args as any)?.source ?? 'UI');
    const humanConfirm = Boolean((args as any)?.humanConfirm);
    if (!humanConfirm) {
      simulatedResult = {
        ...simulatedResult,
        triggered: false,
        requiresHumanConfirmation: true,
        challengeToken: 'CHALLENGE_KILLSWITCH_' + Math.random().toString(36).substring(7),
        message: 'Acción crítica protegida. Reenvía con humanConfirm: true.',
      };
    } else {
      simulatedResult = {
        ...simulatedResult,
        triggered: true,
        timestamp: Date.now(),
        reason,
        source,
        verdict: 'ALL_OPERATIONS_FROZEN_SUCCESSFULLY',
      };
    }
  } else if (toolName === 'add_operation_entry') {
    const side = (args as any)?.side ?? 'buy';
    const vesAmount = Number((args as any)?.vesAmount ?? 8200);
    const usdtAmount = Number((args as any)?.usdtAmount ?? 100);
    const price = Number((args as any)?.price ?? 82.0);
    const humanConfirm = Boolean((args as any)?.humanConfirm);
    if (!humanConfirm) {
      simulatedResult = {
        ...simulatedResult,
        recorded: false,
        requiresHumanConfirmation: true,
        challengeToken: 'CHALLENGE_LEDGER_' + Math.random().toString(36).substring(7),
        message: 'Acción de escritura en Ledger protegida. Reenvía con humanConfirm: true.',
      };
    } else {
      const orderId = `ORD-MCP-${Date.now().toString(36).toUpperCase()}`;
      simulatedResult = {
        ...simulatedResult,
        recorded: true,
        orderId,
        timestamp: new Date().toISOString(),
        side,
        vesAmount,
        usdtAmount,
        price,
        auditStatus: 'LEDGER_ENTRY_COMMITTED_IMMUTABLE',
        cryptographicReceiptHash: 'hash_' + Math.random().toString(36).substring(7),
      };
    }
  } else if (toolName === 'get_bcv_rates') {
    simulatedResult = {
      ...simulatedResult,
      usd: 72.45,
      eur: 78.6,
      cny: 10.15,
      rub: 0.78,
      effectiveDate: new Date().toISOString().slice(0, 10),
      source: 'BCV Oficial',
      isFallback: false,
    };
  } else if (toolName === 'get_parallel_rates') {
    simulatedResult = {
      ...simulatedResult,
      enparalelovzla: 84.2,
      cotizave: 84.05,
      criptonoticias: 84.1,
      average: 84.12,
      spreadOverBcvPct: 16.11,
    };
  } else if (toolName === 'calculate_rate_gap') {
    const offBcv = Number((args as any)?.bcvRate ?? 72.45);
    const parAvg = Number((args as any)?.parallelRate ?? 84.12);
    const gapVes = Math.round((parAvg - offBcv) * 100) / 100;
    const gapPct = Math.round(((parAvg - offBcv) / offBcv) * 10000) / 100;
    simulatedResult = {
      ...simulatedResult,
      officialBcv: offBcv,
      parallelAverage: parAvg,
      gapVes,
      gapPct,
      riskClassification:
        gapPct > 20
          ? 'SEVERE_DISTORTION'
          : gapPct > 10
            ? 'MODERATE_DISTORTION'
            : 'NORMAL_EQUILIBRIUM',
    };
  } else if (toolName === 'check_bcv_intervention_window') {
    const evalDate = (args as any)?.testTimestamp
      ? new Date((args as any).testTimestamp)
      : new Date();
    const windowInfo = predictBcvIntervention(evalDate);
    const isInterventionActive = windowInfo.phase === 'INTERVENTION_ACTIVE';
    simulatedResult = {
      ...simulatedResult,
      evaluatedTimestamp: evalDate.toISOString(),
      vetDayOfWeek: windowInfo.vetDayOfWeek,
      vetHour: windowInfo.vetHour,
      phase: windowInfo.phase,
      probabilityPct: windowInfo.probabilityPct,
      isInterventionActive,
      nextExpectedIntervention: windowInfo.nextExpectedIntervention,
      hoursUntilIntervention: windowInfo.hoursUntilIntervention,
      rationale: windowInfo.rationale,
      tradingDirectives: isInterventionActive
        ? 'INTERVENCIÓN EN CURSO: El BCV está colocando divisas. Esperar dip o cotizar spreads amplios ante compresión.'
        : windowInfo.phase === 'PRE_INTERVENTION_COMPRESSION'
          ? 'VENTANA PRE-INTERVENCIÓN: Expectativa de inyección. Acelerar venta de USDT en máximos antes de la apertura bancaria.'
          : windowInfo.phase === 'POST_INTERVENTION_REBOUND'
            ? 'VENTANA POST-INTERVENCIÓN: Divisas absorbidas por la banca. Prepararse para rebote del paralelo.'
            : 'MERCADO LIBRE: Flujo estándar sin influencia directa de subasta cambiaria.',
    };
  } else if (toolName === 'autofill_trade_reference') {
    const side = ((args as any)?.side ?? 'BUY') as 'BUY' | 'SELL';
    const targetMargin = Number((args as any)?.targetMarginPct ?? 1.2);
    const fallbackRate = Number((args as any)?.fallbackRate ?? 84.12);
    const marginVes = Math.round(fallbackRate * (targetMargin / 100) * 100) / 100;
    const suggestedPrice =
      side === 'BUY'
        ? Math.round((fallbackRate - marginVes) * 100) / 100
        : Math.round((fallbackRate + marginVes) * 100) / 100;
    simulatedResult = {
      ...simulatedResult,
      side,
      referenceMidRate: fallbackRate,
      targetMarginPct: targetMargin,
      suggestedPrice,
      marginVes,
      executionAdvice:
        side === 'BUY'
          ? 'Publicar orden de compra por debajo del punto medio para capturar margen taker.'
          : 'Publicar orden de venta por encima del punto medio.',
      formattedSummary: `${side} USDT @ ${suggestedPrice.toFixed(2)} VES (Mid: ${fallbackRate.toFixed(2)}, Margen: ${targetMargin}%)`,
    };
  } else if (toolName === 'get_binance_p2p_orderbook') {
    simulatedResult = {
      ...simulatedResult,
      fiat: (args as any)?.fiat ?? 'VES',
      asset: (args as any)?.asset ?? 'USDT',
      timestamp: new Date().toISOString(),
      topBuyPrice: (args as any)?.fiat === 'COP' ? 4210 : 82.2,
      topSellPrice: (args as any)?.fiat === 'COP' ? 4250 : 82.85,
      spreadVes: (args as any)?.fiat === 'COP' ? 40 : 0.65,
      spreadPct: (args as any)?.fiat === 'COP' ? 0.95 : 0.79,
      totalBuyDepthUsdt: 21600,
      totalSellDepthUsdt: 24500,
      buyOffersCount: 5,
      sellOffersCount: 5,
    };
  } else if (toolName === 'detect_usdt_depeg') {
    const spotPrice = Number((args as any)?.spotUsdtPrice ?? 0.9992);
    const threshold = Number((args as any)?.thresholdPct ?? 0.2);
    const devPct = Math.round(Math.abs(spotPrice - 1.0) * 10000) / 100;
    const isDepegged = devPct >= threshold;
    simulatedResult = {
      ...simulatedResult,
      spotUsdtPrice: spotPrice,
      parityDeviationPct: devPct,
      status: isDepegged ? (spotPrice < 1.0 ? 'DEPEG_DISCOUNT' : 'DEPEG_PREMIUM') : 'PEGGED_NORMAL',
      isDepegged,
      thresholdPct: threshold,
      arbitrageOpportunity: isDepegged,
      riskSeverity: devPct > 1.0 ? 'CRITICAL' : isDepegged ? 'HIGH' : 'LOW',
      recommendation: isDepegged
        ? 'Monitorear reservas y limitar exposición overnight en USDT.'
        : 'Paridad estable dentro de tolerancia.',
      isEmergencyActionRequired: devPct > 1.0,
    };
  } else if (toolName === 'recommend_competitive_pricing') {
    const recSide = ((args as any)?.side ?? 'BUY') as 'BUY' | 'SELL';
    const recStrategy = (args as any)?.strategy ?? 'TOP_1';
    const stepVes = Number((args as any)?.stepVes ?? 0.05);
    const marginPct = Number((args as any)?.targetMarginPct ?? 1.15);
    const breakEven = Number((args as any)?.breakEvenPrice ?? 82.5);
    const marketMid = Number((args as any)?.currentMarketMid ?? 84.12);
    const compPrice = recSide === 'BUY' ? marketMid - 0.5 : marketMid + 0.5;
    const suggPrice = recSide === 'BUY' ? compPrice + stepVes : compPrice - stepVes;
    simulatedResult = {
      ...simulatedResult,
      side: recSide,
      strategy: recStrategy,
      suggestedPrice: Number(suggPrice.toFixed(2)),
      competitorPrice: Number(compPrice.toFixed(2)),
      stepVes,
      targetMarginPct: marginPct,
      marginVes: Number(Math.abs(suggPrice - breakEven).toFixed(2)),
      isWithinSafeBoundaries: suggPrice >= breakEven,
      advice: `Colocar anuncio ${recSide} a ${suggPrice.toFixed(2)} VES para liderar libro de órdenes.`,
      executionSummary: `Colocar anuncio ${recSide} a ${suggPrice.toFixed(2)} VES (${recStrategy} vs competidor en ${compPrice.toFixed(2)} VES)`,
    };
  } else if (toolName === 'analyze_orderbook_pressure') {
    const fiat = (args as any)?.fiat ?? 'VES';
    const bidDepth = Number((args as any)?.bidDepthUsdt ?? 18000);
    const askDepth = Number((args as any)?.askDepthUsdt ?? 14000);
    const total = bidDepth + askDepth;
    const ratio = total > 0 ? Math.round((bidDepth / total) * 1000) / 1000 : 0.5;
    const dominantSide =
      ratio >= 0.58 ? 'BUY_PRESSURE' : ratio <= 0.42 ? 'SELL_PRESSURE' : 'BALANCED';
    simulatedResult = {
      ...simulatedResult,
      fiat,
      bidDepthUsdt: bidDepth,
      askDepthUsdt: askDepth,
      orderbookImbalanceRatio: ratio,
      dominantSide,
      manipulationRiskScore: 15,
      phantomLiquidityDetected: false,
      pressureVelocity: ratio >= 0.68 || ratio <= 0.32 ? 'ACCELERATING' : 'NEUTRAL',
      actionableInsight:
        dominantSide === 'BUY_PRESSURE'
          ? 'Fuerte demanda de compra en libro.'
          : dominantSide === 'SELL_PRESSURE'
            ? 'Presión de venta en libro.'
            : 'Libro equilibrado.',
      marketRegime:
        dominantSide === 'BUY_PRESSURE'
          ? 'BULLISH_LOCAL_DEMAND'
          : dominantSide === 'SELL_PRESSURE'
            ? 'BEARISH_LOCAL_SUPPLY'
            : 'BALANCED_LIQUIDITY',
    };
  } else if (toolName === 'stress_test_portfolio') {
    const usdtCapital = Number((args as any)?.usdtCapital ?? 8000);
    const vesCapital = Number((args as any)?.vesCapital ?? 160000);
    const refRate = Number((args as any)?.referenceRate ?? 84.12);
    const hedgedPct = Number((args as any)?.hedgedPct ?? 50);
    const vesExpUsdt = Math.round((vesCapital / refRate) * 100) / 100;
    const baseValUsdt = Math.round((usdtCapital + vesExpUsdt) * 100) / 100;
    const scenarios = [5, 10, 20].map((d) => {
      const newRate = Math.round(refRate * (1 + d / 100) * 100) / 100;
      const loss =
        Math.round(
          ((vesCapital * (1 - hedgedPct / 100)) / refRate -
            (vesCapital * (1 - hedgedPct / 100)) / newRate) *
            100,
        ) / 100;
      return {
        devaluationPct: d,
        newRate,
        lossUsdt: loss,
        postStressPortfolioValueUsdt: Math.round((baseValUsdt - loss) * 100) / 100,
        portfolioDrawdownPct: Math.round((loss / baseValUsdt) * 10000) / 100,
        solvencyStatus: loss > baseValUsdt * 0.08 ? 'CRITICAL_EQUITY_RISK' : 'HEALTHY',
      };
    });
    simulatedResult = {
      ...simulatedResult,
      baselinePortfolioValueUsdt: baseValUsdt,
      vesExposureUsdt: vesExpUsdt,
      vesExposurePct: Math.round((vesExpUsdt / baseValUsdt) * 10000) / 100,
      hedgedPct,
      unhedgedVesAmount: vesCapital * (1 - hedgedPct / 100),
      scenariosCount: scenarios.length,
      scenarios,
      recommendedHedgeUsdt: Math.round(vesExpUsdt * (1 - hedgedPct / 100) * 100) / 100,
      institutionalSummary: `Exposición a VES: $${vesExpUsdt} USDT. Cobertura actual: ${hedgedPct}%.`,
    };
  } else if (toolName === 'rebalance_capital_allocation') {
    const totalCap = Number((args as any)?.totalCapitalUsdt ?? 10000);
    const refRate = Number((args as any)?.referenceRate ?? 84.12);
    const plan = buildPortfolioAllocationPlan(totalCap, [], refRate);
    simulatedResult = {
      ...simulatedResult,
      totalCapitalUsdt: plan.totalCapitalUsdt,
      referenceRate: plan.referenceRateVes,
      riskMode: (args as any)?.riskMode ?? 'BALANCED',
      allocations: plan.allocations,
      dynamicLimits: plan.limitsRecommendation,
      strategicNotes: plan.strategicNotes,
      activeChannelsCount: plan.allocations.length,
    };
  } else if (toolName === 'audit_counterparty_exposure') {
    const alias = (args as any)?.counterpartyAlias ?? null;
    const count = (args as any)?.historicalTradesCount ?? null;
    // No counterparty ledger is reachable here. Emitting a risk score or an approval
    // verdict would be fabricated KYC, so we report the absence instead.
    simulatedResult = {
      ...simulatedResult,
      totalTradesAudited: count,
      uniqueCounterpartiesCount: null,
      counterpartyRiskScore: null,
      concentration: {
        topCounterpartyAlias: alias,
        topCounterpartyVolumeUsdt: null,
        topCounterpartySharePct: null,
        exceedsSafeLimit: null,
      },
      flaggedCounterpartiesCount: null,
      flaggedCounterparties: null,
      complianceVerdict: 'UNVERIFIED_NO_COUNTERPARTY_LEDGER',
      recommendations: null,
      isSafeForInstitutionalTrading: null,
      unavailableReason: 'NO_COUNTERPARTY_LEDGER',
      actionable: false,
    };
  } else if (toolName === 'project_compound_runway') {
    const initCap = Number((args as any)?.initialCapitalUsdt ?? 5000);
    const netMargin = Number((args as any)?.netMarginPctPerCycle ?? 0.9);
    const cycles = Number((args as any)?.cyclesPerDay ?? 2);
    const days = Number((args as any)?.operationalDays ?? 30);
    const reinvest = Number((args as any)?.reinvestmentRatePct ?? 100);
    const fixedExp = Number((args as any)?.monthlyFixedExpensesUsdt ?? 200);
    const dailyLimit = (args as any)?.dailyBankLimitVes
      ? Number((args as any).dailyBankLimitVes)
      : undefined;
    const runway = simulateCompoundGrowth({
      initialCapitalUsdt: initCap,
      netMarginPctPerCycle: netMargin,
      cyclesPerDay: cycles,
      operationalDays: days,
      reinvestmentRatePct: reinvest,
      dailyBankLimitVes: dailyLimit,
      referenceRateVes: 84.12,
    });
    const coverageMonths =
      fixedExp > 0 ? Number((runway.totalNetProfitUsdt / fixedExp).toFixed(1)) : 12;
    simulatedResult = {
      ...simulatedResult,
      initialCapitalUsdt: runway.initialCapitalUsdt,
      projectedFinalCapitalUsdt: runway.finalWorkingCapitalUsdt,
      totalNetProfitUsdt: runway.totalNetProfitUsdt,
      totalReturnPct: runway.totalReturnPct,
      operationalDays: days,
      milestones: runway.milestones,
      bankingWallAlert: runway.bankingWallAlert,
      monthlyRunwayCoverageMonths: coverageMonths,
      hasReachedBankingWall: Boolean(runway.bankingWallAlert),
      executiveSummary: `Proyección a ${days} días: Capital proyectado $${runway.finalWorkingCapitalUsdt.toLocaleString()} USDT (+${runway.totalReturnPct}%). Ganancia neta: $${runway.totalNetProfitUsdt.toLocaleString()} USDT. Cobertura de gastos: ${coverageMonths} meses.`,
    };
  } else if (toolName === 'gdrive_backup_receipt') {
    const tradeId = String((args as any)?.tradeId ?? 'ORD-DEMO-01');
    const counterparty = String((args as any)?.counterparty ?? 'Anónimo');
    const ext = (args as any)?.mimeType === 'application/pdf' ? 'pdf' : 'png';
    const fileName = (args as any)?.fileName ?? `Receipt_${tradeId}_${counterparty}.${ext}`;
    const simId = `1gDrive_${Date.now().toString(36)}`;
    simulatedResult = {
      ...simulatedResult,
      success: true,
      fileId: simId,
      fileName,
      folderPath: 'P2P_Receipts/2026-09',
      webViewLink: `https://drive.google.com/file/d/${simId}/view`,
      downloadLink: `https://drive.google.com/uc?id=${simId}&export=download`,
      tradeId,
      counterparty,
      mode: 'SIMULATED',
      syncedAt: new Date().toISOString(),
      message: `Comprobante ${fileName} respaldado en Google Drive.`,
    };
  } else if (toolName === 'gsheets_sync_trade') {
    const trade = (args as any)?.trade ?? {};
    const sheetName = String((args as any)?.sheetName ?? 'Operaciones P2P');
    // No Sheets connection exists in this environment. A hardcoded ID would point at a
    // spreadsheet that does not exist and invite the agent to "open" it.
    const spreadsheetId = (args as any)?.spreadsheetId ?? null;
    simulatedResult = {
      ...simulatedResult,
      success: false,
      spreadsheetId,
      sheetName,
      updatedRange: null,
      updatedRows: 0,
      spreadsheetUrl: null,
      mode: 'SIMULATED',
      syncedTrade: {
        id: trade.id ?? null,
        side: trade.side ?? null,
        rate: trade.rate ?? null,
        usdtAmount: trade.usdtAmount ?? null,
        vesAmount: trade.vesAmount ?? null,
        netProfitUsdt: trade.netProfitUsdt ?? null,
        counterparty: trade.counterparty ?? null,
      },
      unavailableReason: 'NO_GOOGLE_SHEETS_CONNECTION',
      message: 'No se pudo sincronizar: no hay conexión con Google Sheets en este entorno.',
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'gdrive_sync_db_backup') {
    const backupType = String((args as any)?.backupType ?? 'ledger_json');
    const simId = `1gDrive_backup_${Date.now().toString(36)}`;
    simulatedResult = {
      ...simulatedResult,
      success: true,
      fileId: simId,
      fileName: `p2p_backup_${backupType}_${new Date().toISOString().slice(0, 10)}.json`,
      backupType,
      encrypted: Boolean((args as any)?.encrypt),
      sizeBytes: 15420,
      webViewLink: `https://drive.google.com/file/d/${simId}/view`,
      mode: 'SIMULATED',
      backupTimestamp: new Date().toISOString(),
      message: `Respaldo ${backupType} sincronizado en Google Drive.`,
    };
  } else if (toolName === 'screen_wallet_address') {
    const addr = String((args as any)?.address ?? 'TYDzsYUEpvnYmQk4zGP9sWWcTEd36GunL');
    const net = String((args as any)?.network ?? 'TRC20');
    simulatedResult = {
      ...simulatedResult,
      address: addr,
      network: net,
      riskScore: null,
      riskLevel: 'UNVERIFIED_OFFLINE',
      recommendation: 'MANUAL_COMPLIANCE_REVIEW_REQUIRED',
      flags: ['NO_LIVE_AML_FEED'],
      sanctionedMatch: null,
      actionable: false,
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'inspect_tx_taint') {
    const tx = String((args as any)?.txHash ?? 'e4d909c290d0fb1ca068ffaddf22cbd0d0c35');
    simulatedResult = {
      ...simulatedResult,
      txHash: tx,
      chain: (args as any)?.chain ?? 'TRON',
      taintPercentage: null,
      directHopToMixer: null,
      clusterAttribution: 'UNINSPECTED_OFFLINE_FALLBACK',
      isClean: null,
      compliancePass: false,
      actionable: false,
      inspectionTimestamp: new Date().toISOString(),
    };
  } else if (toolName === 'fetch_cross_exchange_spread') {
    const fiat = String((args as any)?.fiat ?? 'VES');
    const baseRate = fiat === 'VES' ? 79.2 : 4250;
    simulatedResult = {
      ...simulatedResult,
      fiat,
      asset: 'USDT',
      paymentMethod: (args as any)?.paymentMethod ?? 'Pago Movil',
      exchanges: [
        {
          exchange: 'Binance P2P',
          buyRate: Number((baseRate * 0.992).toFixed(2)),
          sellRate: Number((baseRate * 1.012).toFixed(2)),
          spreadPct: 2.02,
          activeMerchants: 48,
        },
        {
          exchange: 'Bybit P2P',
          buyRate: Number((baseRate * 0.988).toFixed(2)),
          sellRate: Number((baseRate * 1.015).toFixed(2)),
          spreadPct: 2.73,
          activeMerchants: 22,
        },
        {
          exchange: 'OKX P2P',
          buyRate: Number((baseRate * 0.994).toFixed(2)),
          sellRate: Number((baseRate * 1.009).toFixed(2)),
          spreadPct: 1.51,
          activeMerchants: 15,
        },
        {
          exchange: 'KuCoin P2P',
          buyRate: Number((baseRate * 0.985).toFixed(2)),
          sellRate: Number((baseRate * 1.018).toFixed(2)),
          spreadPct: 3.35,
          activeMerchants: 9,
        },
      ],
      crossArbitrageOpportunity: {
        buyOn: 'KuCoin P2P',
        buyPrice: Number((baseRate * 0.985).toFixed(2)),
        sellOn: 'Bybit P2P',
        sellPrice: Number((baseRate * 1.015).toFixed(2)),
        netSpreadPct: 3.05,
        isViable: false,
        actionable: false,
        unverifiedNotice: 'Precios referenciales generados localmente. Requiere conexión en vivo para validar viabilidad de ejecución.',
        estimatedProfitPer1000Usdt: 0,
      },
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'verify_inbound_transfer') {
    const ref = (args as any)?.referenceNumber ? String((args as any).referenceNumber) : 'REF-UNVERIFIED';
    simulatedResult = {
      ...simulatedResult,
      referenceNumber: ref,
      amountVes: (args as any)?.amountVes ? Number((args as any).amountVes) : 0,
      bankCode: (args as any)?.bankCode ?? '0102',
      status: 'UNVERIFIED_NO_BANK_CONNECTION',
      reconciledInMs: 0,
      bankResponseCode: null,
      senderCedulaValidated: false,
      senderPhoneValidated: false,
      ledgerReceiptId: null,
      recommendation: 'DO_NOT_RELEASE_AWAITING_MANUAL_VERIFICATION',
      actionable: false,
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'compile_dispute_dossier') {
    const ord = String((args as any)?.orderId ?? 'ORD-2026-99128');
    simulatedResult = {
      ...simulatedResult,
      orderId: ord,
      dossierStatus: 'DOSSIER_COMPILED_READY_FOR_SUBMISSION',
      sha256Digest: `dossier_sha256_${Date.now()}_${ord.slice(-6)}`,
      disputeReason: (args as any)?.disputeReason ?? 'THIRD_PARTY_PAYMENT',
      recommendedAppealStatement:
        'La contraparte realizó el pago desde una cuenta bancaria a nombre de un tercero no titular...',
      evidenceMetadata: {
        orderId: ord,
        counterparty: (args as any)?.counterpartyNick ?? 'TraderNick',
        fiatAmountVes: Number((args as any)?.amountVes ?? 67320),
        cryptoAmountUsdt: Number((args as any)?.amountUsdt ?? 850),
        bankReference: (args as any)?.bankReference ?? 'REF-987123',
        chatLogSummaryIncluded: true,
        bankingProofTimestamp: new Date().toISOString(),
      },
      exportFormat: 'PDF_A_COMPLIANT',
      resolutionProbabilityPct: 98.4,
    };
  } else if (toolName === 'evaluate_account_saturation') {
    const bId = String((args as any)?.bankId ?? 'banesco_01');
    const cur = Number((args as any)?.currentDailyVes ?? 450000);
    const lim = Number((args as any)?.dailyLimitVes ?? 500000);
    const inc = Number((args as any)?.incomingAmountVes ?? 0);
    const proj = cur + inc;
    const sat = Number(((proj / lim) * 100).toFixed(2));
    simulatedResult = {
      ...simulatedResult,
      bankId: bId,
      currentDailyVes: cur,
      projectedDailyVes: proj,
      dailyLimitVes: lim,
      saturationPercentage: sat,
      remainingQuotaVes: Math.max(0, lim - proj),
      hourlyOps: Number((args as any)?.hourlyTransactionCount ?? 4),
      riskLevel: sat >= 90 ? 'CRITICAL' : sat >= 75 ? 'ELEVATED' : 'SAFE',
      recommendBankRotation: sat >= 80,
      reason:
        sat >= 80
          ? 'Alerta de saturación de cupo bancario superior al 80%.'
          : 'Cuenta en umbrales seguros.',
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'dispatch_order_instructions') {
    const ord = String((args as any)?.orderId ?? 'ORD-55182');
    simulatedResult = {
      ...simulatedResult,
      orderId: ord,
      channel: (args as any)?.channel ?? 'TELEGRAM',
      recipientContact: (args as any)?.recipientContact ?? '@TraderVIP',
      dispatchStatus: 'SENT_SUCCESSFULLY',
      deliveredAt: new Date().toISOString(),
      formattedPayloadPreview: `⚡ ORDEN P2P #${ord} - Pago a Banesco`,
      actionId: `MSG-${Date.now()}`,
    };
  } else if (toolName === 'lookup_counterparty_reputation') {
    const doc = String((args as any)?.documentId ?? 'V-20123456');
    simulatedResult = {
      ...simulatedResult,
      documentId: doc,
      blindHash: `zk_hash_${doc.slice(-4)}_mock`,
      trustScore: null,
      isBlacklisted: null,
      riskLevel: 'UNVERIFIED_OFFLINE',
      historicalIncidents: [],
      recommendation: 'VERIFICATION_UNAVAILABLE_PROCEED_WITH_CAUTION',
      actionable: false,
      consultedAt: new Date().toISOString(),
    };
  } else if (toolName === 'check_bank_operational_status') {
    simulatedResult = {
      ...simulatedResult,
      networkStatus: 'ALL_SYSTEMS_OPERATIONAL',
      pauseTradingDirective: false,
      affectedBanks: [],
      averageSettlementLatencyMinutes: 0.9,
      bankDetails: [
        {
          bankCode: '0102',
          bankName: 'Banco de Venezuela (BDV)',
          status: 'OPERATIONAL',
          settlementLatencyMinutes: 1.2,
        },
        {
          bankCode: '0134',
          bankName: 'Banesco Banco Universal',
          status: 'OPERATIONAL',
          settlementLatencyMinutes: 0.8,
        },
        {
          bankCode: '0105',
          bankName: 'Mercantil Banco',
          status: 'OPERATIONAL',
          settlementLatencyMinutes: 0.9,
        },
        {
          bankCode: 'PAGO_MOVIL',
          bankName: 'Suiche Pago Móvil Interbancario',
          status: 'OPERATIONAL',
          settlementLatencyMinutes: 0.5,
        },
      ],
      operationalAdvice:
        'Todos los canales bancarios y Pago Móvil operan con óptima liquidez y acreditación inmediata.',
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'check_counterparty_blacklist') {
    const ced = String((args as any)?.cedula ?? '');
    const isBlacklisted = ced.includes('28999888');
    simulatedResult = {
      ...simulatedResult,
      isFlagged: isBlacklisted,
      riskLevel: isBlacklisted ? 'CRITICAL' : 'CLEAN',
      decision: isBlacklisted ? 'IMMEDIATE_BLOCK_TRANSACTION' : 'CLEAN_TO_PROCEED',
      totalMatchesFound: isBlacklisted ? 1 : 0,
      matchedRecords: isBlacklisted
        ? [
            {
              matchedOn: 'CEDULA',
              identifier: 'V-28999888',
              suspectName: 'Pedro Fraude',
              category: 'TRIANGULATION_SCAM',
              notes: 'Reportado por estafa de triangulación.',
              reportedAt: '2026-08-15T10:00:00Z',
            },
          ]
        : [],
      actionRequired: isBlacklisted
        ? 'ALERTA ROJA: Detener de inmediato el envío de Pago Móvil. Coincidencia en lista negra.'
        : 'Contraparte limpia de coincidencias en la lista negra interna.',
      auditTimestamp: new Date().toISOString(),
    };
  } else if (toolName === 'register_blacklisted_entity') {
    const hConf = Boolean((args as any)?.humanConfirm);
    if (!hConf) {
      simulatedResult = {
        ...simulatedResult,
        status: 'CHALLENGE_REQUIRED',
        message: 'Se requiere confirmación humana explícita (humanConfirm: true).',
        challengeToken: `CHL-BL-${Date.now()}`,
      };
    } else {
      simulatedResult = {
        ...simulatedResult,
        status: 'REGISTERED_SUCCESSFULLY',
        blacklistEntryId: `BL-${Date.now()}-REC`,
        identifierType: (args as any)?.identifierType ?? 'CEDULA',
        identifierValue: (args as any)?.identifierValue ?? 'V-11223344',
        counterpartyName: (args as any)?.counterpartyName ?? 'Desconocido',
        fraudCategory: (args as any)?.fraudCategory ?? 'TRIANGULATION_SCAM',
        registeredAt: new Date().toISOString(),
        actionSummary: 'Entidad blindada en la base de datos local para bloqueo automático.',
      };
    }
  } else if (toolName === 'send_multichannel_alert') {
    simulatedResult = {
      ...simulatedResult,
      alertId: `ALT-${Date.now()}`,
      channel: (args as any)?.channel ?? 'TELEGRAM',
      priority: (args as any)?.priority ?? 'ALERT',
      deliveryStatus: 'DISPATCHED_TO_QUEUE',
      deliveredAt: new Date().toISOString(),
      renderedPayloadPreview: `⚡ *${(args as any)?.title ?? 'ALERTA'}*\n${(args as any)?.messageMarkdown ?? ''}`,
      summary: 'Alerta enviada exitosamente por el canal configurado.',
    };
  } else if (toolName === 'process_remote_sentinel_command') {
    const raw = String((args as any)?.rawText ?? 'Registra compra de 500 USDT a 41.50 en Banesco');
    simulatedResult = {
      ...simulatedResult,
      commandType: 'LEDGER_TRANSACTION',
      action: 'ADD_OPERATION_ENTRY',
      status: 'SIMULATED_LOCAL_PARSE',
      ledgerImpact: false,
      actionable: false,
      transactionDetail: {
        ledgerId: `LEDGER-REMOTE-${Date.now()}`,
        side: raw.toLowerCase().includes('venta') ? 'sell' : 'buy',
        usdtAmount: 500,
        ratePrice: 41.5,
        vesTotal: 20750,
        bank: 'Banesco',
        recordedAt: new Date().toISOString(),
      },
      summary: 'Comando interpretado localmente sin persistencia en base de datos SQLite (modo degradado).',
      rawText: raw,
    };
  } else if (toolName === 'audit_payment_proof_ocr') {
    const ocr = String((args as any)?.ocrRawText ?? '');
    const expAmt = Number((args as any)?.expectedAmountVes ?? 12500);
    simulatedResult = {
      ...simulatedResult,
      orderId: (args as any)?.orderId ?? 'ORD-P2P-101',
      verdict: 'SIMULATED_LOCAL_PREVIEW',
      isSafeToRelease: false,
      actionable: false,
      extractedData: {
        reference: ocr ? 'PARSED_FROM_OCR' : 'NO_REFERENCE',
        amountVes: expAmt,
        bank: (args as any)?.expectedBank ?? 'BANESCO',
        payerCedula: (args as any)?.expectedPayerIdDoc ?? 'V-UNVERIFIED',
      },
      expectedData: {
        amountVes: expAmt,
        bank: (args as any)?.expectedBank ?? 'BANESCO',
        payerIdDoc: (args as any)?.expectedPayerIdDoc ?? 'V-UNVERIFIED',
      },
      discrepancies: ['MODO SIMULACIÓN LOCAL: Requiere auditoría humana obligatoria antes de liberar fondos.'],
      actionAdvice: 'MODO SIMULACIÓN LOCAL: Requiere auditoría humana obligatoria antes de liberar fondos.',
      auditTimestamp: new Date().toISOString(),
    };
  } else if (toolName === 'evaluate_ad_repricing') {
    const side = (args as any)?.side ?? 'BUY';
    const targetRank = (args as any)?.targetRank ?? 'TOP_1';
    const stepVes = Number((args as any)?.stepVes ?? 0.05);
    const suggestedPrice = side === 'BUY' ? 78.85 : 79.95;
    simulatedResult = {
      ...simulatedResult,
      recommendedAction: 'UPDATE_PRICE',
      side,
      targetRank,
      suggestedPrice,
      targetCompetitorPrice: side === 'BUY' ? 78.8 : 80.0,
      targetCompetitorMerchant: 'MarketMakerPro',
      stepVes,
      minSpreadPct: 0.5,
      breakEvenFloorPrice: 0,
      circuitBreakerTriggered: false,
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'publish_ad_price') {
    const adId = (args as any)?.adId ?? 'AD-1001';
    const exchange = (args as any)?.exchange ?? 'BINANCE_P2P';
    const newPrice = Number((args as any)?.newPrice ?? 78.85);
    const dryRun = Boolean((args as any)?.dryRun ?? true);
    simulatedResult = {
      ...simulatedResult,
      success: true,
      adId,
      exchange,
      publishedPrice: newPrice,
      dryRun,
      status: dryRun ? 'SIMULATED_SUCCESS' : 'PUBLISHED_LIVE',
      rationale: (args as any)?.rationale ?? 'Ajuste automatizado por microestructura MCP',
      timestamp: new Date().toISOString(),
      auditTrail: {
        guardrailChecked: true,
        maxPriceDeviationPct: 3.0,
        signature: `SIG-AD-${adId.slice(-6)}-${Date.now()}`,
      },
    };
  } else if (toolName === 'toggle_ad_status') {
    const adId = (args as any)?.adId ?? 'AD-1001';
    const exchange = (args as any)?.exchange ?? 'BINANCE_P2P';
    const action = (args as any)?.action ?? 'PAUSE';
    const reason = (args as any)?.reason ?? 'MANUAL_OVERRIDE';
    const stateMap: Record<string, string> = { PAUSE: 'PAUSED', RESUME: 'ACTIVE', CLOSE: 'CLOSED' };
    simulatedResult = {
      ...simulatedResult,
      success: true,
      adId,
      exchange,
      previousAction: action,
      currentStatus: stateMap[action] ?? 'PAUSED',
      triggerReason: reason,
      timestamp: new Date().toISOString(),
      actionSummary: `Anuncio ${adId} en ${exchange} conmutado a ${stateMap[action] ?? 'PAUSED'} debido a ${reason}.`,
    };
  } else if (toolName === 'audit_ad_competitiveness') {
    const adId = (args as any)?.adId ?? 'AD-1001';
    const myCurrentPrice = Number((args as any)?.myCurrentPrice ?? 78.85);
    simulatedResult = {
      ...simulatedResult,
      adId,
      myCurrentPrice,
      currentRank: 'TOP_1',
      desiredRank: (args as any)?.desiredRank ?? 'TOP_1',
      isMeetingTargetRank: true,
      totalCompetitorsAnalyzed: 10,
      suspiciousCompetitorsCount: 0,
      priceGapWithLeader: 0,
      leaderPrice: myCurrentPrice,
      leaderMerchant: 'Self',
      assessment: 'Posición competitiva saludable (TOP_1).',
      timestamp: new Date().toISOString(),
    };
  } else if (toolName === 'scan_synthetic_stable_arbitrage') {
    const pairs = (args as any)?.pairs ?? [
      {
        targetAsset: 'USDC',
        spotPair: 'USDCUSDT',
        spotRate: 0.9992,
        spotFeePct: 0.05,
        p2pUsdtRateFiat: 85.5,
        p2pTargetRateFiat: 86.8,
        fiatCurrency: 'VES',
        tradingCapitalUsd: 2500,
      },
    ];
    const minNetSpreadPct = Number((args as any)?.minNetSpreadPct ?? 0.15);
    const opportunities = scanSyntheticStableCurves(pairs, minNetSpreadPct);
    simulatedResult = {
      ...simulatedResult,
      opportunitiesCount: opportunities.length,
      opportunities,
      evaluatedAt: new Date().toISOString(),
    };
  } else if (toolName === 'audit_distressed_liquidity_sniper') {
    const ads = (args as any)?.ads ?? [
      {
        advId: 'AD-SNIPER-1',
        merchantName: 'DistressedSeller',
        orderType: 'SELL',
        price: 80.5,
        availableAmountCrypto: 800,
        minLimitFiat: 1000,
        maxLimitFiat: 64000,
        paymentMethods: ['Banesco'],
        fiatCurrency: 'VES',
      },
    ];
    const fairMarketRate = Number((args as any)?.fairMarketRate ?? 85.5);
    const minDislocationPct = Number((args as any)?.minDislocationPct ?? 0.8);
    const snipingOpportunities = scanOrderbookSnipingOpportunities(ads, {
      fairMarketPrice: fairMarketRate,
      minProfitThresholdPct: minDislocationPct,
    });
    simulatedResult = {
      ...simulatedResult,
      fairMarketRate,
      snipingOpportunitiesCount: snipingOpportunities.length,
      snipingOpportunities,
      evaluatedAt: new Date().toISOString(),
    };
  } else if (toolName === 'query_otc_darkpool_spread') {
    const volumeUsd = Number((args as any)?.volumeUsd ?? 10000);
    const minNetSpreadPct = Number((args as any)?.minNetSpreadPct ?? 1.2);
    const quotes = (args as any)?.quotes ?? [
      {
        venueId: 'BINANCE_P2P',
        venueName: 'Binance P2P',
        venueType: 'BINANCE_P2P',
        currencyPair: 'USDT/VES',
        buyRate: 85.2,
        sellRate: 86.8,
        makerFeePct: 0.1,
        takerFeePct: 0.1,
      },
      {
        venueId: 'CCS_CASH_DESK',
        venueName: 'Caracas Cash Desk',
        venueType: 'PHYSICAL_CASH_DESK',
        currencyPair: 'USDT/VES',
        buyRate: 83.5,
        sellRate: 88.5,
        transferOrCashFrictionPct: 0.5,
      },
    ];
    const routes = aggregateDarkPoolOpportunities(quotes, {
      capitalUsd: volumeUsd,
      minNetSpreadPct,
    });
    simulatedResult = {
      ...simulatedResult,
      volumeTestedUsd: volumeUsd,
      routesFoundCount: routes.length,
      routes,
      evaluatedAt: new Date().toISOString(),
    };
  } else if (toolName === 'route_fintech_payroll_settlement') {
    const platform = (args as any)?.platform ?? (args as any)?.sourcePlatform ?? 'DEEL';
    const grossAmountUsd = Number((args as any)?.grossAmountUsd ?? (args as any)?.amountUsd ?? 2500);
    const payoutRail = (args as any)?.payoutRail ?? 'VES_PAGO_MOVIL';
    const vesRatePerUsd = Number((args as any)?.vesRatePerUsd ?? 85.5);
    const clientTier = (args as any)?.clientTier ?? 'RECURRENT_REMOTE';
    const isVerifiedContractor = Boolean((args as any)?.isVerifiedContractor ?? true);
    const quote = calculateFintechSettlementQuote({
      platform,
      grossAmountUsd,
      payoutRail,
      vesRatePerUsd,
      clientTier,
      isVerifiedContractor,
    });
    simulatedResult = {
      ...simulatedResult,
      quote,
      evaluatedAt: new Date().toISOString(),
    };
  } else if (toolName === 'recommend_counterparty_yield_price') {
    const counterpartyId = String((args as any)?.counterpartyId ?? 'CP-VIP-1');
    const baseMarketRate = Number((args as any)?.baseMarketRate ?? (args as any)?.marketBasePrice ?? 85.5);
    const orderType = ((args as any)?.orderType ?? 'BUY') as 'BUY' | 'SELL';
    const averageReleaseMinutes = Number((args as any)?.averageReleaseMinutes ?? 2.5);
    const completedTradesCount = Number((args as any)?.completedTradesCount ?? 120);
    const disputeCount = Number((args as any)?.disputeCount ?? 0);
    const monthlyVolumeUsd = Number((args as any)?.monthlyVolumeUsd ?? 30000);
    const requestedAmountUsd = Number((args as any)?.requestedAmountUsd ?? 3000);
    const pricing = calculateDynamicCounterpartyPricing({
      metrics: {
        counterpartyId,
        averageReleaseMinutes,
        completedTradesCount,
        disputeCount,
        monthlyVolumeUsd,
      },
      baseMarketRate,
      orderType,
      requestedAmountUsd,
    });
    simulatedResult = {
      ...simulatedResult,
      result: pricing,
      evaluatedAt: new Date().toISOString(),
    };
  } else if (toolName === 'process_concierge_inquiry') {
    const customerMessage = String((args as any)?.customerMessage ?? (args as any)?.message ?? 'Buenas tardes a como tienen la tasa de USDT?');
    const deskRatePerUsd = Number((args as any)?.deskRatePerUsd ?? (args as any)?.deskSellRate ?? 87.0);
    const bankName = String((args as any)?.bankName ?? 'Banesco');
    const bankAccountDetails = String((args as any)?.bankAccountDetails ?? '0134-XXXX-XXXX-XXXX');
    const parsed = parseCustomerChatMessage(customerMessage);
    const reply = generateConciergeReply(parsed, {
      deskRatePerUsd,
      bankName,
      bankAccountDetails,
      quoteValidityMinutes: 15,
    });
    simulatedResult = {
      ...simulatedResult,
      ...reply,
      processedAt: new Date().toISOString(),
    };
  } else if (toolName === 'predict_bcv_macro_regime') {
    const bcvOfficialRate = Number((args as any)?.bcvOfficialRate ?? 80.0);
    const parallelMarketRate = Number((args as any)?.parallelMarketRate ?? (args as any)?.parallelRate ?? 91.5);
    const daysSinceLastIntervention = Number((args as any)?.daysSinceLastIntervention ?? 4);
    const currentHourOfDayUtcMinus4 = Number((args as any)?.currentHourOfDayUtcMinus4 ?? 10);
    const currentDayOfWeek = Number((args as any)?.currentDayOfWeek ?? 1);
    const estimatedWeeklyBcvInjectionUsd = Number((args as any)?.estimatedWeeklyBcvInjectionUsd ?? 50000000);
    const assessment = evaluateMacroBcvRegime({
      bcvOfficialRate,
      parallelMarketRate,
      daysSinceLastIntervention,
      currentHourOfDayUtcMinus4,
      currentDayOfWeek,
      estimatedWeeklyBcvInjectionUsd,
    });
    simulatedResult = {
      ...simulatedResult,
      assessment,
      evaluatedAt: new Date().toISOString(),
    };
  } else if (toolName === 'optimize_treasury_idle_yield') {
    const totalUsdtInventory = Number((args as any)?.totalUsdtInventory ?? 25000);
    const currentlyCommittedUsdt = Number((args as any)?.currentlyCommittedUsdt ?? 4000);
    const marketVelocity = (args as any)?.marketVelocity ?? 'LOW_OFFPEAK';
    const flexibleApyPct = Number((args as any)?.flexibleApyPct ?? 10.5);
    const minimumSafetyBufferUsd = Number((args as any)?.minimumSafetyBufferUsd ?? 2500);
    const plan = calculateTreasuryYieldAllocation({
      totalUsdtInventory,
      currentlyCommittedUsdt,
      marketVelocity,
      flexibleApyPct,
      minimumSafetyBufferUsd,
    });
    simulatedResult = {
      ...simulatedResult,
      plan,
      evaluatedAt: new Date().toISOString(),
    };
  } else if (toolName === 'execute_browser_operator_task') {
    const targetSite = (args as any)?.targetSite ?? 'BANESCO_PANAMA';
    const action = (args as any)?.action ?? 'VERIFY_TRANSFER_REFERENCE';
    const referenceToVerify = (args as any)?.referenceToVerify ?? 'REF-998877';
    const expectedAmount = Number((args as any)?.expectedAmount ?? 1250);
    const compiledTask = compileBrowserOperatorTask({
      targetSite,
      action,
      referenceToVerify,
      expectedAmount,
      headless: true,
    });
    simulatedResult = {
      ...simulatedResult,
      compiledTask,
      executionStatus: 'TASK_COMPILED_READY_FOR_AGENT_RUNNER',
      evaluatedAt: new Date().toISOString(),
    };
  }

  return simulatedResult;
}
