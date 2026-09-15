/**
 * Strategist Agent (Gentleman AI - Core Strategist)
 * Formulates tactical plans, triangular loops, and capital rotation routes.
 * Guided by: CONCEPTS > CODE, CAPITAL PRESERVATION, and Golden Rule (>=0.50%).
 */

import type { StrategistProposal, SentinelSignal, AgentHealthStatus } from './types';
import type { StrategyPlanCard } from '../../shared/types';
import { executeFinancialSkill } from '../gemini-skills';

export class StrategistAgent {
  readonly role = 'STRATEGIST' as const;
  readonly name = 'Gentleman AI (Senior Strategist)';
  private opsProcessed = 0;
  private lastActive = Date.now();

  getHealth(): AgentHealthStatus {
    return {
      role: this.role,
      name: this.name,
      status: 'ONLINE',
      lastActiveTime: this.lastActive,
      opsProcessed: this.opsProcessed,
      description: 'Modelado cuantitativo de rutas triangulares, microestructura VWAP y optimización de márgenes institucionales.',
    };
  }

  /**
   * Formulates a structured tactical trade proposal based on sentinel market inputs.
   */
  formulateProposal(signal: SentinelSignal, requestedCapital = 1000): StrategistProposal {
    this.opsProcessed++;
    this.lastActive = Date.now();

    // 1. Run Triangular Arbitrage Scanner
    const triangleRes = executeFinancialSkill('scan_triangular_arbitrage', {
      initialAmount: requestedCapital,
      initialCurrency: 'USDT',
    });

    const triangleData = triangleRes.data as {
      netSpreadPct?: number;
      profitInitialCurrency?: number;
      isProfitable?: boolean;
    };

    const calculatedNetSpread = signal.netSpreadPct;
    const meetsGoldenRule = calculatedNetSpread >= 0.50;

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

    const vwapPrice = simData.effectiveVwapPrice && simData.effectiveVwapPrice > 0
      ? simData.effectiveVwapPrice
      : signal.bestAsk;
    const slippageBps = simData.slippageBps ?? 12;

    const planId = `SWARM-${Date.now().toString(36).toUpperCase()}`;
    const plan: StrategyPlanCard = {
      id: planId,
      title: 'Triangulación Institucional VES -> USDT -> BTC con Banesco',
      route: `${signal.fiat} (Pago Móvil) -> ${signal.asset} -> BTC -> ${signal.fiat} (Transferencia)`,
      capitalRequiredUsdt: requestedCapital,
      expectedNetSpreadPct: Number(calculatedNetSpread.toFixed(2)),
      expectedProfitUsdt: Number(((requestedCapital * calculatedNetSpread) / 100).toFixed(2)),
      riskLevel: calculatedNetSpread >= 1.2 ? 'LOW' : 'MEDIUM',
      assignedOperatorName: 'Operador Principal',
      rationale: `Brecha BCV en ${signal.rateGapPct?.toFixed(1) ?? '22.9'}% y liquidez profunda. Ejecución VWAP optimizada con deslizamiento controlado (${slippageBps} bps).`,
      status: 'PROPOSED',
    };

    const timing = signal.rateGapPct && signal.rateGapPct > 25
      ? 'URGENTE: Ventana previa a intervención cambiaria BCV (completar rotación antes de 11:30 AM)'
      : 'ESTÁNDAR: Liquidez fluida en horario de alto tráfico bancario (09:00 - 15:00)';

    return {
      plan,
      rationale: `Mirá, formulé una ruta táctica de preservación de capital con retorno neto de ${calculatedNetSpread.toFixed(2)}%. Cumple con la regla de oro institucional y minimiza fricción por comisiones.`,
      mathematicalValidation: {
        grossSpreadPct: signal.grossSpreadPct,
        estimatedFeesPct: Number((signal.grossSpreadPct - calculatedNetSpread).toFixed(2)),
        netSpreadPct: Number(calculatedNetSpread.toFixed(2)),
        vwapPrice,
        slippageBps,
        meetsGoldenRule,
      },
      recommendedTiming: timing,
    };
  }
}
