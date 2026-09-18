import { Injectable, inject, signal, computed } from '@angular/core';
import {
  predictBcvIntervention,
  evaluateDeltaHedge,
  type TriangularArbitrageResult,
  type ExchangeLeg,
} from '@p2p/core';
import { BinanceP2pService } from './binance-p2p.service';
import { CotizaveService } from './cotizave.service';
import { McpService } from './mcp.service';
import { ToastService } from './toast.service';

export interface BcvInterventionRisk {
  inWindow: boolean;
  intensity: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  probabilityPct: number;
  message: string;
}

export interface DeltaHedgeAdvice {
  needed: boolean;
  shortUsdtAmount: number;
  fiatExposureAmount: number;
  fiatCurrency: string;
  hedgeRatioPct: number;
  reason: string;
}

export interface LiveMarketRatesSnapshot {
  binanceVesBuy: number; // Precio al que compran USDT en P2P
  binanceVesSell: number; // Precio al que venden USDT en P2P
  bcvUsd: number; // Tasa oficial BCV USD
  bcvEur: number; // Tasa oficial BCV EUR
  parallelAvg: number; // Promedio paralelo (CotizaVe / EnParalelo)
  rateGapPct: number; // Brecha oficial vs paralelo %
  copPerUsdt: number; // Tasa Binance P2P COP/USDT
  copPerVes: number; // Cruce derivado COP por VES
  zinliUsdPerUsdt: number; // Venta digital Zinli/Wally
  timestamp: string;
  source: 'MCP_LIVE' | 'CACHE' | 'FALLBACK';
}

export interface McpTacticalReport {
  executionAllowed: boolean;
  primaryRisk: string;
  bcvRisk: BcvInterventionRisk;
  hedgeAdvice: DeltaHedgeAdvice;
  optimalTimingNote: string;
  orderbookLiquidityUsdt: number;
}

@Injectable({ providedIn: 'root' })
export class TriangulationIntelligenceService {
  private readonly binanceP2p = inject(BinanceP2pService);
  private readonly cotizave = inject(CotizaveService);
  private readonly mcp = inject(McpService);
  private readonly toast = inject(ToastService);

  readonly isSyncingMarket = signal<boolean>(false);
  readonly lastSyncTimestamp = signal<string | null>(null);
  readonly mcpCallCount = signal<number>(0);

  readonly liveRates = signal<LiveMarketRatesSnapshot>({
    binanceVesBuy: 82.2,
    binanceVesSell: 82.85,
    bcvUsd: 72.45,
    bcvEur: 78.6,
    parallelAvg: 84.12,
    rateGapPct: 16.11,
    copPerUsdt: 4250,
    copPerVes: 51.3,
    zinliUsdPerUsdt: 0.985,
    timestamp: 'Inicializado',
    source: 'CACHE',
  });

  /**
   * Evaluates the BCV intervention probability and active schedule.
   */
  readonly bcvStatus = computed<BcvInterventionRisk>(() => {
    try {
      const now = new Date();
      const pred = predictBcvIntervention(now);
      const isWindow = pred.phase === 'INTERVENTION_ACTIVE';
      const prob = pred.probabilityPct;

      let intensity: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' = 'LOW';
      if (prob >= 80) intensity = 'EXTREME';
      else if (prob >= 60) intensity = 'HIGH';
      else if (prob >= 40) intensity = 'MEDIUM';

      return {
        inWindow: isWindow,
        intensity,
        probabilityPct: prob,
        message: isWindow
          ? `⚠️ Ventana activa de intervención BCV. ${pred.rationale}`
          : `✅ Fuera de ventana crítica BCV. Próxima fecha esperada: ${pred.nextExpectedIntervention}.`,
      };
    } catch {
      return {
        inWindow: false,
        intensity: 'LOW',
        probabilityPct: 20,
        message: 'Monitoreo BCV operando en régimen normal.',
      };
    }
  });

  /**
   * Evaluates if a given route requires synthetic short hedging to protect fiat capital in transit.
   */
  computeHedgeAdvice(result: TriangularArbitrageResult): DeltaHedgeAdvice {
    const hasVes = result.steps.some((s) => s.fromCurrency === 'VES' || s.toCurrency === 'VES');
    const totalMinutes = result.totalDurationMinutes;

    if (!hasVes || totalMinutes < 35 || result.roiPct < 1.0) {
      return {
        needed: false,
        shortUsdtAmount: 0,
        fiatExposureAmount: 0,
        fiatCurrency: 'VES',
        hedgeRatioPct: 0,
        reason:
          'El tiempo de rotación es inferior al umbral crítico o no involucra moneda de alta devaluación.',
      };
    }

    // Step with VES exposure
    const vesStep = result.steps.find((s) => s.fromCurrency === 'VES' || s.toCurrency === 'VES');
    const vesAmount = vesStep
      ? vesStep.fromCurrency === 'VES'
        ? vesStep.inputAmount
        : vesStep.outputAmount
      : 0;
    const currentRate = vesStep && vesStep.price > 0 ? vesStep.price : 80;

    try {
      const proposal = evaluateDeltaHedge({
        vesBalance: vesAmount,
        usdtBalance: 0,
        currentParallelRate: currentRate,
        openP2pSellOrdersUsdt: 0,
        openP2pBuyOrdersVes: 0,
        vesMaxHoldingTimeMinutes: totalMinutes,
      });

      if (proposal) {
        return {
          needed: true,
          shortUsdtAmount: Math.round(proposal.hedgeAmountUsdt * 100) / 100,
          fiatExposureAmount: Math.round(vesAmount * 100) / 100,
          fiatCurrency: 'VES',
          hedgeRatioPct: 100,
          reason: `Exposición a VES de ${totalMinutes} min. ${proposal.reason}`,
        };
      }

      return {
        needed: false,
        shortUsdtAmount: 0,
        fiatExposureAmount: Math.round(vesAmount * 100) / 100,
        fiatCurrency: 'VES',
        hedgeRatioPct: 0,
        reason: 'Exposición dentro de parámetros aceptables.',
      };
    } catch {
      const fallbackUsdt = currentRate > 0 ? vesAmount / currentRate : 0;
      return {
        needed: true,
        shortUsdtAmount: Math.round(fallbackUsdt * 100) / 100,
        fiatExposureAmount: Math.round(vesAmount * 100) / 100,
        fiatCurrency: 'VES',
        hedgeRatioPct: 100,
        reason: 'Exposición a VES prolongada. Recomendada cobertura 1:1 en futuros.',
      };
    }
  }

  /**
   * Generates a tactical MCP intelligence assessment for the active route.
   */
  generateTacticalReport(result: TriangularArbitrageResult): McpTacticalReport {
    const bcv = this.bcvStatus();
    const hedge = this.computeHedgeAdvice(result);

    const isBlocked =
      result.riskLevel === 'CRITICAL' || (bcv.inWindow && result.totalDurationMinutes > 60);

    let optimalTimingNote = 'Condiciones favorables para rotación de capital inmediata.';
    if (bcv.inWindow) {
      optimalTimingNote =
        'Precaución: El BCV suele inyectar oferta bancaria en esta franja. Reducir montos de tramo 1.';
    } else if (result.roiPct > 2.5) {
      optimalTimingNote =
        'Oportunidad de alto rendimiento detectada: acelerar la ejecución en el tramo con mayor liquidez.';
    }

    // Available liquidity from Binance P2P cache
    const depth = this.binanceP2p.marketDepth();
    const orderbookLiquidityUsdt =
      depth && depth.buyOffers.length > 0
        ? depth.buyOffers.reduce((acc, o) => acc + o.maxVes / Math.max(1, o.price), 0)
        : 15000;

    return {
      executionAllowed: !isBlocked,
      primaryRisk:
        result.riskReasons[0] ?? 'Riesgo operativo estándar dentro de los límites de capital.',
      bcvRisk: bcv,
      hedgeAdvice: hedge,
      optimalTimingNote,
      orderbookLiquidityUsdt: Math.round(orderbookLiquidityUsdt),
    };
  }

  /**
   * Obtiene y consolida las tasas en vivo desde herramientas MCP, adaptadores P2P y monitores oficiales
   */
  async fetchLiveMarketRates(): Promise<LiveMarketRatesSnapshot> {
    this.isSyncingMarket.set(true);

    let binanceVesBuy = 82.2;
    let binanceVesSell = 82.85;
    let bcvUsd = 72.45;
    let bcvEur = 78.6;
    let parallelAvg = 84.12;
    const copPerUsdt = 4250;
    const zinliUsdPerUsdt = 0.985;
    let source: 'MCP_LIVE' | 'CACHE' | 'FALLBACK' = 'FALLBACK';

    try {
      // 1. Herramienta MCP: Libro de órdenes Binance P2P VES
      const p2pRes = await this.mcp.testTool('get_binance_p2p_orderbook', {
        fiat: 'VES',
        asset: 'USDT',
        rows: 5,
      });
      this.mcpCallCount.update((c) => c + 1);

      if (p2pRes.success && p2pRes.result) {
        const data = p2pRes.result as Record<string, unknown>;
        if (typeof data['topBuyPrice'] === 'number' && data['topBuyPrice'] > 0) {
          binanceVesBuy = data['topBuyPrice'];
          source = 'MCP_LIVE';
        }
        if (typeof data['topSellPrice'] === 'number' && data['topSellPrice'] > 0) {
          binanceVesSell = data['topSellPrice'];
          source = 'MCP_LIVE';
        }
      }

      // 2. Herramienta MCP: Tasas Oficiales BCV
      const bcvRes = await this.mcp.testTool('get_bcv_rates', { cacheFallback: true });
      this.mcpCallCount.update((c) => c + 1);
      if (bcvRes.success && bcvRes.result) {
        const data = bcvRes.result as Record<string, unknown>;
        if (typeof data['usd'] === 'number' && data['usd'] > 0) {
          bcvUsd = data['usd'];
          source = 'MCP_LIVE';
        }
        if (typeof data['eur'] === 'number' && data['eur'] > 0) {
          bcvEur = data['eur'];
        }
      }

      // 3. Herramienta MCP: Tasas Paralelas Consolidadas
      const parallelRes = await this.mcp.testTool('get_parallel_rates', {});
      this.mcpCallCount.update((c) => c + 1);
      if (parallelRes.success && parallelRes.result) {
        const data = parallelRes.result as Record<string, unknown>;
        if (typeof data['average'] === 'number' && data['average'] > 0) {
          parallelAvg = data['average'];
          source = 'MCP_LIVE';
        }
      }

      // 4. Fallback/Complemento de BinanceP2pService si tiene datos en vivo en memoria
      const depth = this.binanceP2p.marketDepth();
      if (depth && depth.bestBuyPrice > 0 && depth.bestSellPrice > 0) {
        binanceVesBuy = depth.bestBuyPrice;
        binanceVesSell = depth.bestSellPrice;
        source = 'MCP_LIVE';
      }

      // 5. Fallback/Complemento de CotizaveService si está conectado
      const cotizaveRates = this.cotizave.ratesByMarket();
      if (cotizaveRates['binance']?.mid && cotizaveRates['binance'].mid > 0) {
        binanceVesSell = cotizaveRates['binance'].mid;
      }
      if (cotizaveRates['paralelo']?.mid && cotizaveRates['paralelo'].mid > 0) {
        parallelAvg = cotizaveRates['paralelo'].mid;
      }
      if (cotizaveRates['bcv']?.mid && cotizaveRates['bcv'].mid > 0) {
        bcvUsd = cotizaveRates['bcv'].mid;
      }

      // 6. Cálculo de brecha cambiaria y cruce derivado COP/VES
      const rateGapPct =
        bcvUsd > 0 ? Math.round(((parallelAvg - bcvUsd) / bcvUsd) * 10000) / 100 : 16.11;
      const copPerVes =
        binanceVesSell > 0 ? Math.round((copPerUsdt / binanceVesSell) * 100) / 100 : 51.3;

      const snapshot: LiveMarketRatesSnapshot = {
        binanceVesBuy,
        binanceVesSell,
        bcvUsd,
        bcvEur,
        parallelAvg,
        rateGapPct,
        copPerUsdt,
        copPerVes,
        zinliUsdPerUsdt,
        timestamp: new Date().toLocaleTimeString(),
        source,
      };

      this.liveRates.set(snapshot);
      this.lastSyncTimestamp.set(snapshot.timestamp);
      return snapshot;
    } finally {
      this.isSyncingMarket.set(false);
    }
  }

  /**
   * Aplica las tasas de mercado consolidadas a los tres tramos de una ruta triangular
   */
  applyLiveRatesToLegs(
    legs: [ExchangeLeg, ExchangeLeg, ExchangeLeg],
    rates: LiveMarketRatesSnapshot,
    presetId?: string,
  ): [ExchangeLeg, ExchangeLeg, ExchangeLeg] {
    const l1 = { ...legs[0] };
    const l2 = { ...legs[1] };
    const l3 = { ...legs[2] };

    if (
      presetId === 'route-ves-usdt-cop' ||
      (l1.fromCurrency === 'VES' && l2.toCurrency === 'COP')
    ) {
      // Tramo 1: VES -> USDT (Comprar USDT en P2P con VES: tasa sell/ask)
      l1.price = rates.binanceVesSell;
      // Tramo 2: USDT -> COP (Venta de USDT recibiendo COP)
      l2.price = rates.copPerUsdt;
      // Tramo 3: COP -> VES (Retorno de COP a VES vía mesa o giro directo)
      l3.price = rates.copPerVes;
    } else if (
      presetId === 'route-usdt-usd-ves' ||
      (l1.fromCurrency === 'USDT' && l1.toCurrency === 'USD')
    ) {
      // Tramo 1: USDT -> USD (Zinli / Wally)
      l1.price = rates.zinliUsdPerUsdt;
      // Tramo 2: USD -> VES (Remesa o cambio a paralelo)
      l2.price = rates.parallelAvg;
      // Tramo 3: VES -> USDT (Recompra de USDT con VES en P2P)
      l3.price = rates.binanceVesSell;
    } else {
      // Regla universal según las divisas de cada tramo
      for (const leg of [l1, l2, l3]) {
        if (leg.fromCurrency === 'VES' && leg.toCurrency === 'USDT') {
          leg.price = rates.binanceVesSell;
        } else if (leg.fromCurrency === 'USDT' && leg.toCurrency === 'VES') {
          leg.price = rates.binanceVesBuy;
        } else if (leg.fromCurrency === 'USD' && leg.toCurrency === 'VES') {
          leg.price = rates.parallelAvg;
        } else if (leg.fromCurrency === 'USDT' && leg.toCurrency === 'COP') {
          leg.price = rates.copPerUsdt;
        } else if (leg.fromCurrency === 'COP' && leg.toCurrency === 'VES') {
          leg.price = rates.copPerVes;
        }
      }
    }

    return [l1, l2, l3];
  }

  /**
   * Sincroniza tasas reales de mercado consultando los adaptadores y herramientas MCP
   */
  async syncLiveRates(
    activeLegs: [ExchangeLeg, ExchangeLeg, ExchangeLeg],
    presetId?: string,
  ): Promise<[ExchangeLeg, ExchangeLeg, ExchangeLeg]> {
    try {
      const snapshot = await this.fetchLiveMarketRates();
      const updatedLegs = this.applyLiveRatesToLegs(activeLegs, snapshot, presetId);
      this.toast.success(
        `Tasas de mercado actualizadas vía MCP (VES/USDT: ${snapshot.binanceVesSell.toFixed(2)} · Paralelo: ${snapshot.parallelAvg.toFixed(2)} · BCV: ${snapshot.bcvUsd.toFixed(2)}).`,
        'Sincronización MCP',
      );
      return updatedLegs;
    } catch {
      this.toast.warn(
        'No se pudo conectar a los servicios MCP. Manteniendo últimas cotizaciones.',
        'Advertencia',
      );
      return activeLegs;
    }
  }
}
