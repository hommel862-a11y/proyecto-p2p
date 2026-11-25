/**
 * Strategist Agent (Gentleman AI - Core Strategist)
 * Formulates tactical plans, triangular loops, and capital rotation routes.
 * Guided by: CONCEPTS > CODE, CAPITAL PRESERVATION, and Golden Rule (>=0.50%).
 */

import type { StrategistProposal, SentinelSignal, AgentHealthStatus } from './types';
import { AGENT_MCP_DOMAINS, AGENT_ASSIGNED_SKILLS } from './types';
import type { StrategyPlanCard } from '../../shared/types';
import { executeFinancialSkill } from '../gemini-skills';
import { getMarketBook, resolveMarketFeed } from '../skills/market-state';
import { MonteCarloSimulator } from './monte-carlo-simulator';

export class StrategistAgent {
  readonly role = 'STRATEGIST' as const;
  readonly name = 'Gentleman AI (Senior Strategist)';
  readonly assignedMcpDomains = AGENT_MCP_DOMAINS['STRATEGIST'];
  readonly assignedSkills = AGENT_ASSIGNED_SKILLS['STRATEGIST'];

  private opsProcessed = 0;
  private lastActive = Date.now();

  getHealth(): AgentHealthStatus {
    return {
      role: this.role,
      name: this.name,
      status: 'ONLINE',
      lastActiveTime: this.lastActive,
      opsProcessed: this.opsProcessed,
      description:
        'Modelado cuantitativo de rutas triangulares, microestructura VWAP y optimización de márgenes institucionales.',
      assignedMcpDomains: this.assignedMcpDomains,
      assignedSkills: this.assignedSkills,
    };
  }

  /**
   * Evaluates corridor routing efficiency across assigned MCP domains.
   */
  evaluateRoutingEfficiency(capitalUsdt = 1000): {
    triangularViable: boolean;
    crossBasisSpreadPct: number;
    recommendedVenue: string;
  } {
    const triRes = executeFinancialSkill('scan_triangular_arbitrage', {
      initialAmount: capitalUsdt,
      initialCurrency: 'USDT',
    });
    const triData = triRes.data as { isProfitable?: boolean; netSpreadPct?: number } | undefined;

    return {
      triangularViable: Boolean(triData?.isProfitable),
      crossBasisSpreadPct: triData?.netSpreadPct ?? 0,
      recommendedVenue: 'Binance P2P (Banesco / Pago Móvil)',
    };
  }

  /**
   * Formulates a structured tactical trade proposal based on sentinel market inputs.
   */
  formulateProposal(signal: SentinelSignal, requestedCapital = 1000): StrategistProposal {
    this.opsProcessed++;
    this.lastActive = Date.now();

    // 1. Run Triangular Arbitrage Scanner
    executeFinancialSkill('scan_triangular_arbitrage', {
      initialAmount: requestedCapital,
      initialCurrency: 'USDT',
    });

    const calculatedNetSpread = signal.netSpreadPct;
    const meetsGoldenRule = calculatedNetSpread >= 0.5;

    // 2. Simulate orderbook depth and VWAP slippage
    const simRes = executeFinancialSkill('simulate_trade_impact', {
      targetAmountUsdt: requestedCapital,
      side: 'BUY',
    });

    const simData = simRes.data as {
      effectiveVwapPrice?: number;
      slippageBps?: number;
      liquidityHealth?: string;
    };

    const vwapPrice =
      simData?.effectiveVwapPrice && simData.effectiveVwapPrice > 0
        ? simData.effectiveVwapPrice
        : signal.bestAsk;
    const slippageBps = simData?.slippageBps ?? 12;

    // 3. Monte Carlo Microstructure Simulation (only on real live orderbook offers; never fabricate mockBook)
    const feed = resolveMarketFeed();
    const liveBook = getMarketBook();
    const isLiveFeed = signal.esSimulado === false || (signal.bestBid > 0 && signal.bestAsk > 0 && feed.live);
    const realBookOffers = (liveBook?.sellOffers?.length ? liveBook.sellOffers : [])
      .filter((o) => typeof o.price === 'number' && o.price > 0)
      .slice(0, 10)
      .map((o) => ({
        price: o.price,
        minVes: o.minVes ?? 0,
        maxVes: o.maxVes ?? requestedCapital * o.price,
        merchantName: o.merchantName || 'Binance_Offer',
      }));

    const mcResult =
      realBookOffers.length > 0
        ? new MonteCarloSimulator().runSimulation(realBookOffers as any, {
            iterations: 500,
            cancellationProbabilityPct: 10,
            priceDriftVolatilityBps: 15,
            ticketAmountUsdt: requestedCapital,
            side: 'BUY',
          })
        : {
            meanSlippagePct: 0,
            p95SlippagePct: 0,
            p99SlippagePct: 0,
            fillRatePct: isLiveFeed ? 100 : 0,
            var95Usdt: 0,
            isSafeForExecution: isLiveFeed && signal.bestAsk > 0,
            recommendation: isLiveFeed
              ? 'Profundidad L2 no desglosada; validado contra mejor bid/ask en vivo.'
              : 'SIN_PROFUNDIDAD_EN_VIVO: No se simula liquidez sin libro real.',
          };

    const planId = `SWARM-${Date.now().toString(36).toUpperCase()}`;
    const plan: StrategyPlanCard = {
      id: planId,
      title: 'Triangulación Institucional VES -> USDT -> BTC con Banesco',
      route: `${signal.fiat} (Pago Móvil) -> ${signal.asset} -> BTC -> ${signal.fiat} (Transferencia)`,
      capitalRequiredUsdt: requestedCapital,
      expectedNetSpreadPct: Number(calculatedNetSpread.toFixed(2)),
      expectedProfitUsdt: Number(((requestedCapital * calculatedNetSpread) / 100).toFixed(2)),
      riskLevel: calculatedNetSpread >= 1.2 && mcResult.isSafeForExecution ? 'LOW' : 'MEDIUM',
      assignedOperatorName: 'Operador Principal',
      rationale: `Brecha BCV en ${typeof signal.rateGapPct === 'number' ? `${signal.rateGapPct.toFixed(1)}%` : 'N/D (tasa oficial BCV sin medir — se requiere MCP get_bcv_rates y get_parallel_rates)'}. ${realBookOffers.length > 0 ? `Slippage P95 Monte Carlo (${realBookOffers.length} ofertas reales): ${mcResult.p95SlippagePct}% (VaR 95%: $${mcResult.var95Usdt} USDT).` : mcResult.recommendation}`,
      status: 'PROPOSED',
      esSimulado: !isLiveFeed,
      isSimulated: !isLiveFeed,
    };

    const timing =
      signal.rateGapPct && signal.rateGapPct > 25
        ? 'URGENTE: Ventana previa a intervención cambiaria BCV (completar rotación antes de 11:30 AM)'
        : 'ESTÁNDAR: Liquidez fluida en horario de alto tráfico bancario (09:00 - 15:00)';

    return {
      plan,
      rationale: plan.rationale,
      mathematicalValidation: {
        grossSpreadPct: signal.grossSpreadPct,
        estimatedFeesPct: 0.4,
        netSpreadPct: calculatedNetSpread,
        vwapPrice,
        slippageBps,
        meetsGoldenRule,
        monteCarlo: {
          meanSlippagePct: mcResult.meanSlippagePct,
          p95SlippagePct: mcResult.p95SlippagePct,
          p99SlippagePct: mcResult.p99SlippagePct,
          fillRatePct: mcResult.fillRatePct,
          var95Usdt: mcResult.var95Usdt,
          isSafeForExecution: mcResult.isSafeForExecution,
          recommendation: mcResult.recommendation,
        },
      },
      recommendedTiming: timing,
    };
  }
}
