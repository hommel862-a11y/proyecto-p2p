/**
 * Exchange & Macro Intelligence Agent (ExchangeIntelAgent).
 * Dedicated to cross-venue orderbook comparison (Binance vs Bybit vs El Dorado),
 * VIP maker/taker fee matrix optimization, perpetual funding rates for hedging,
 * and Central Bank of Venezuela (BCV) intervention window analytics.
 */

import type { AgentHealthStatus } from './types';
import { AGENT_MCP_DOMAINS, AGENT_ASSIGNED_SKILLS } from './types';
import { executeFinancialSkill } from '../gemini-skills';

export interface CrossVenueSpreadComparison {
  binancePrice?: number;
  bybitPrice?: number;
  elDoradoPrice?: number;
  bestBuyVenue: string;
  bestSellVenue: string;
  grossSpreadPct: number;
  netSpreadPct: number;
  makerTakerDeductionPct: number;
  isViable: boolean;
  recommendedRoute: string;
}

export class ExchangeIntelAgent {
  readonly role = 'EXCHANGE_INTEL' as const;
  readonly name = 'Exchange & Macro Intelligence Agent';
  readonly assignedMcpDomains = AGENT_MCP_DOMAINS['EXCHANGE_INTEL'];
  readonly assignedSkills = AGENT_ASSIGNED_SKILLS['EXCHANGE_INTEL'];

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
        'Inteligencia multimercado: arbitraje espacial Binance/Bybit/El Dorado, funding rates de perpetuos y política cambiaria BCV.',
      assignedMcpDomains: this.assignedMcpDomains,
      assignedSkills: this.assignedSkills,
    };
  }

  /**
   * Compares spatial basis spreads across supported P2P exchanges (Binance, Bybit, El Dorado).
   */
  compareCrossVenueSpreads(params: {
    asset?: string;
    fiat?: string;
    targetAmountUsdt?: number;
    binanceRate?: number;
    bybitRate?: number;
    elDoradoRate?: number;
  }): CrossVenueSpreadComparison {
    this.opsProcessed++;
    this.lastActive = Date.now();

    const {
      asset = 'USDT',
      fiat = 'VES',
      targetAmountUsdt = 1000,
      binanceRate,
      bybitRate,
      elDoradoRate,
    } = params;

    // Use skill dispatcher to compute mathematical basis spread
    const skillResult = executeFinancialSkill('calculate_cross_exchange_basis_spread', {
      buyPlatform: 'Binance P2P',
      sellPlatform: 'El Dorado P2P',
      asset,
      fiat,
      buyPrice: binanceRate,
      sellPrice: elDoradoRate,
      capitalUsdt: targetAmountUsdt,
    });

    const data = skillResult.data as {
      netSpreadPct?: number;
      grossSpreadPct?: number;
      buyPrice?: number;
      sellPrice?: number;
      isProfitable?: boolean;
    } | undefined;

    const bRate = binanceRate ?? data?.buyPrice;
    const dRate = elDoradoRate ?? data?.sellPrice;
    const byRate = bybitRate;

    // Calculate best venues
    const venues = [
      { name: 'Binance P2P', rate: bRate },
      { name: 'Bybit P2P', rate: byRate },
      { name: 'El Dorado P2P', rate: dRate },
    ].filter((v) => typeof v.rate === 'number' && v.rate > 0);

    let bestBuy = venues[0]?.name || 'Binance P2P';
    let bestSell = venues[1]?.name || 'El Dorado P2P';
    let minRate = venues[0]?.rate ?? 0;
    let maxRate = venues[0]?.rate ?? 0;

    for (const v of venues) {
      if (v.rate! < minRate || minRate === 0) {
        minRate = v.rate!;
        bestBuy = v.name;
      }
      if (v.rate! > maxRate) {
        maxRate = v.rate!;
        bestSell = v.name;
      }
    }

    const grossSpread = minRate > 0 ? ((maxRate - minRate) / minRate) * 100 : 0;
    const feeDeduction = 0.25; // Combined maker + taker + transfer fee estimate
    const netSpread = Math.max(0, grossSpread - feeDeduction);

    return {
      binancePrice: bRate,
      bybitPrice: byRate,
      elDoradoPrice: dRate,
      bestBuyVenue: bestBuy,
      bestSellVenue: bestSell,
      grossSpreadPct: Number(grossSpread.toFixed(2)),
      netSpreadPct: Number(netSpread.toFixed(2)),
      makerTakerDeductionPct: feeDeduction,
      isViable: netSpread >= 0.5,
      recommendedRoute: `Comprar en ${bestBuy} @ ${minRate > 0 ? minRate.toFixed(2) : 'N/D'} ➔ Vender en ${bestSell} @ ${maxRate > 0 ? maxRate.toFixed(2) : 'N/D'}`,
    };
  }

  /**
   * Evaluates macro regime and BCV intervention timing window.
   */
  evaluateBcvMacroWindow(bcvRate?: number, parallelRate?: number): {
    isInterventionActive: boolean;
    windowStatus: string;
    gapPct: number;
    recommendedAction: string;
  } {
    this.opsProcessed++;
    this.lastActive = Date.now();

    const now = new Date();
    const utcHours = now.getUTCHours();
    const vzlaHours = (utcHours - 4 + 24) % 24; // VZLA is UTC-4
    const vzlaMinutes = now.getUTCMinutes();
    const timeDec = vzlaHours + vzlaMinutes / 60;

    // Window: 10:00 AM - 11:30 AM VZLA
    const isInterventionActive = timeDec >= 10.0 && timeDec <= 11.5;

    let gapPct = 0;
    if (bcvRate && parallelRate && bcvRate > 0) {
      gapPct = ((parallelRate - bcvRate) / bcvRate) * 100;
    }

    let recommendedAction = 'Operar con flujo normal.';
    if (isInterventionActive) {
      recommendedAction =
        'Ventana de inyección BCV activa: precaución con compras de gran volumen en bolívares debido a posible contracción temporal del paralelo.';
    } else if (gapPct > 20) {
      recommendedAction =
        'Brecha cambiaria superior al 20%: alta demanda de divisas; priorizar posiciones cortas en VES y retención de inventario en USDT.';
    }

    return {
      isInterventionActive,
      windowStatus: isInterventionActive
        ? '🚨 VENTANA BCV ACTIVA (10:00 - 11:30 AM)'
        : 'CERRADA (Fuera de horario de intervención)',
      gapPct: Number(gapPct.toFixed(2)),
      recommendedAction,
    };
  }
}
