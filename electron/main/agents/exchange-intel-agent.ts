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
      fiat = 'VES',
      targetAmountUsdt = 1000,
      binanceRate,
      bybitRate,
      elDoradoRate,
    } = params;

    const venues = [
      { name: 'Binance P2P', rate: binanceRate },
      { name: 'Bybit P2P', rate: bybitRate },
      { name: 'El Dorado P2P', rate: elDoradoRate },
    ].filter(
      (v): v is { name: string; rate: number } =>
        typeof v.rate === 'number' && Number.isFinite(v.rate) && v.rate > 0,
    );

    if (venues.length < 2) {
      const onlyVenue = venues[0];
      return {
        binancePrice: venues.find((v) => v.name === 'Binance P2P')?.rate,
        bybitPrice: venues.find((v) => v.name === 'Bybit P2P')?.rate,
        elDoradoPrice: venues.find((v) => v.name === 'El Dorado P2P')?.rate,
        bestBuyVenue: onlyVenue?.name ?? 'UNAVAILABLE',
        bestSellVenue: 'UNAVAILABLE',
        grossSpreadPct: 0,
        netSpreadPct: 0,
        makerTakerDeductionPct: 0,
        isViable: false,
        recommendedRoute: onlyVenue
          ? `Cotización única en ${onlyVenue.name} @ ${onlyVenue.rate.toFixed(2)}: se requieren al menos 2 plataformas con tasa válida para arbitraje espacial.`
          : 'UNAVAILABLE: sin cotizaciones válidas de múltiples plataformas para comparar.',
      };
    }

    const platforms = venues.map((venue) => ({
      platformName: venue.name,
      fiatCurrency: fiat,
      bestBidPrice: venue.rate,
      bestAskPrice: venue.rate,
      availableDepthUsdt: targetAmountUsdt,
      internalTransferFeeUsdt: 0,
    }));

    const skillResult = executeFinancialSkill('calculate_cross_exchange_basis_spread', {
      capitalUsdt: targetAmountUsdt,
      platforms,
    });

    const data = skillResult.success
      ? (skillResult.data as
          | {
              buyPlatform?: string;
              sellPlatform?: string;
              buyPrice?: number;
              sellPrice?: number;
              grossSpreadPct?: number;
              netSpreadPct?: number;
              isExecutable?: boolean;
            }
          | undefined)
      : undefined;

    let bestBuy = venues[0].name;
    let bestSell = venues[0].name;
    let minRate = venues[0].rate;
    let maxRate = venues[0].rate;

    for (const v of venues) {
      if (v.rate < minRate) {
        minRate = v.rate;
        bestBuy = v.name;
      }
      if (v.rate > maxRate) {
        maxRate = v.rate;
        bestSell = v.name;
      }
    }

    if (data?.buyPlatform && typeof data.buyPrice === 'number' && data.buyPrice > 0) {
      bestBuy = data.buyPlatform;
      minRate = data.buyPrice;
    }
    if (data?.sellPlatform && typeof data.sellPrice === 'number' && data.sellPrice > 0) {
      bestSell = data.sellPlatform;
      maxRate = data.sellPrice;
    }

    const fallbackGross = minRate > 0 ? ((maxRate - minRate) / minRate) * 100 : 0;
    const rawGross =
      typeof data?.grossSpreadPct === 'number' && Number.isFinite(data.grossSpreadPct)
        ? data.grossSpreadPct
        : fallbackGross;
    const rawNet =
      typeof data?.netSpreadPct === 'number' && Number.isFinite(data.netSpreadPct)
        ? data.netSpreadPct
        : rawGross - 0.2;
    const feeDeduction = Number(Math.max(0, rawGross - rawNet).toFixed(2));
    const netSpread = Math.max(0, rawNet);

    return {
      binancePrice: venues.find((v) => v.name === 'Binance P2P')?.rate,
      bybitPrice: venues.find((v) => v.name === 'Bybit P2P')?.rate,
      elDoradoPrice: venues.find((v) => v.name === 'El Dorado P2P')?.rate,
      bestBuyVenue: bestBuy,
      bestSellVenue: bestSell,
      grossSpreadPct: Number(rawGross.toFixed(2)),
      netSpreadPct: Number(netSpread.toFixed(2)),
      makerTakerDeductionPct: feeDeduction,
      isViable:
        typeof data?.isExecutable === 'boolean'
          ? data.isExecutable
          : netSpread >= 0.5 && bestBuy !== bestSell,
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
