/**
 * Trading Execution & Microstructure Skills: Triangular Arbitrage, Avellaneda-Stoikov, VPIN & Slicing.
 */

import type { AgentSkillDefinition, FinancialSkillResult } from './types';
import {
  calculateTriangularArbitrage,
  DEFAULT_TRIANGULAR_PRESETS,
  analyzeFxCorridorEfficiency,
  calculateCrossExchangeBasisSpread,
} from '../vendor/p2p-core/triangular-arbitrage';
import {
  computeAvellanedaStoikovQuotes,
  calculateVpinMetric,
  computeOrderSlicingPlan,
  calculateMakerFillProbabilityMarkov,
} from '../vendor/p2p-core/orderbook-microstructure';
import { simulateTradeImpact } from '../vendor/p2p-core/trade-impact-simulator';
import { getMarketBook, getSideOffers } from './market-state';

export const TRADING_SKILLS_DEFINITIONS: AgentSkillDefinition[] = [
  {
    name: 'scan_triangular_arbitrage',
    description: 'Calcula el spread neto y viabilidad de una ruta de arbitraje triangular de 3 piernas. Deduce comisiones y fricción bancaria.',
    parameters: {
      type: 'OBJECT',
      properties: {
        initialAmount: {
          type: 'NUMBER',
          description: 'Monto inicial a convertir (ej. 1000 USDT).',
        },
        initialCurrency: {
          type: 'STRING',
          description: 'Símbolo de la divisa de origen (ej. USDT, VES).',
        },
      },
      required: ['initialAmount', 'initialCurrency'],
    },
  },
  {
    name: 'simulate_trade_impact',
    description: 'Simula el llenado real de una orden P2P calculando el precio VWAP y deslizamiento en puntos básicos según la profundidad del libro.',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetAmountUsdt: {
          type: 'NUMBER',
          description: 'Volumen objetivo en USDT.',
        },
        side: {
          type: 'STRING',
          description: 'Lado de la operación (BUY o SELL).',
          enum: ['BUY', 'SELL'],
        },
      },
      required: ['targetAmountUsdt', 'side'],
    },
  },
  {
    name: 'calculate_optimal_spread_avellaneda',
    description: 'Calcula el precio de reserva y cotizaciones óptimas de compra/venta bajo el modelo cuantitativo de Avellaneda-Stoikov basado en inventario y volatilidad.',
    parameters: {
      type: 'OBJECT',
      properties: {
        midPrice: { type: 'NUMBER', description: 'Precio medio actual del mercado.' },
        currentInventoryUsdt: { type: 'NUMBER', description: 'Inventario actual en USDT.' },
        targetInventoryUsdt: { type: 'NUMBER', description: 'Inventario objetivo en USDT.' },
        volatilityDaily: { type: 'NUMBER', description: 'Volatilidad diaria estimada en decimal (ej. 0.02 = 2%).' },
        timeRemainingFraction: { type: 'NUMBER', description: 'Fracción de horizonte restante (0 a 1.0).' },
      },
      required: ['midPrice', 'currentInventoryUsdt', 'targetInventoryUsdt', 'volatilityDaily'],
    },
  },
  {
    name: 'estimate_adverse_selection_vpin',
    description: 'Estima la probabilidad de toxicidad de flujo informado mediante la métrica VPIN (Volume-Synchronized Probability of Toxicity) para proteger el spread.',
    parameters: {
      type: 'OBJECT',
      properties: {
        buckets: {
          type: 'ARRAY',
          description: 'Lista de buckets de volumen con buyVolume, sellVolume y totalVolume.',
          items: { type: 'OBJECT', description: 'Bucket de volumen VPIN.' },
        },
        toxicityThreshold: { type: 'NUMBER', description: 'Umbral de toxicidad (default 0.25).' },
      },
      required: ['buckets'],
    },
  },
  {
    name: 'compute_optimal_order_slicing_twap_vwap',
    description: 'Divide un bloque institucional grande en micro-lotes TWAP/VWAP para minimizar el impacto de mercado y prevenir front-running.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalAmountUsdt: { type: 'NUMBER', description: 'Volumen institucional total a ejecutar.' },
        executionDurationMinutes: { type: 'NUMBER', description: 'Duración total de ejecución en minutos.' },
        estimatedMarketVolumePerHourUsdt: { type: 'NUMBER', description: 'Volumen horario estimado del mercado.' },
        currentMidPrice: { type: 'NUMBER', description: 'Precio medio actual.' },
        algorithm: { type: 'STRING', enum: ['TWAP', 'VWAP'], description: 'Algoritmo de ponderación temporal.' },
      },
      required: ['totalAmountUsdt', 'executionDurationMinutes', 'estimatedMarketVolumePerHourUsdt', 'currentMidPrice', 'algorithm'],
    },
  },
  {
    name: 'calculate_maker_fill_probability_markov',
    description: 'Calcula la probabilidad estocástica de llenado de una orden Maker y tiempo estimado de espera mediante procesos markovianos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        queuePositionIndex: { type: 'INTEGER', description: 'Posición en la cola (0 = punta).' },
        queueAheadVolumeUsdt: { type: 'NUMBER', description: 'Volumen por delante en el libro.' },
        recentFillVelocityPerMinuteUsdt: { type: 'NUMBER', description: 'Velocidad de absorción del mercado en USDT/min.' },
        targetHorizonMinutes: { type: 'NUMBER', description: 'Horizonte temporal evaluado en minutos.' },
      },
      required: ['queuePositionIndex', 'queueAheadVolumeUsdt', 'recentFillVelocityPerMinuteUsdt'],
    },
  },
  {
    name: 'analyze_fx_corridor_efficiency',
    description: 'Compara y ranquea la eficiencia de múltiples corredores de remesas internacionales (USDT/VES, USDT/COP, etc.) deduciendo fricción bancaria y latencia.',
    parameters: {
      type: 'OBJECT',
      properties: {
        baseAmountUsdt: { type: 'NUMBER', description: 'Monto base a convertir en USDT.' },
        corridors: {
          type: 'ARRAY',
          description: 'Lista de corredores con cotizaciones, fricción y tiempos de liquidación.',
          items: { type: 'OBJECT', description: 'Corredor FX.' },
        },
      },
      required: ['baseAmountUsdt', 'corridors'],
    },
  },
  {
    name: 'calculate_cross_exchange_basis_spread',
    description: 'Detecta oportunidades de arbitraje espacial de base entre distintas plataformas P2P (Binance, Bybit, El Dorado).',
    parameters: {
      type: 'OBJECT',
      properties: {
        capitalUsdt: { type: 'NUMBER', description: 'Capital disponible para arbitraje en USDT.' },
        platforms: {
          type: 'ARRAY',
          description: 'Puntos de precio por plataforma con bid, ask y comisiones.',
          items: { type: 'OBJECT', description: 'Precios de plataforma.' },
        },
      },
      required: ['capitalUsdt', 'platforms'],
    },
  },
];

export function dispatchTradingSkill(
  skillName: string,
  args: Record<string, unknown>,
  now: number,
): FinancialSkillResult | null {
  const marketBook = getMarketBook();

  switch (skillName) {
    case 'scan_triangular_arbitrage': {
      const initialAmount = Number(args['initialAmount']) || 1000;
      const initialCurrency = String(args['initialCurrency'] || 'USDT').toUpperCase();
      const route =
        DEFAULT_TRIANGULAR_PRESETS.find((r) => r.initialCurrency === initialCurrency) ||
        DEFAULT_TRIANGULAR_PRESETS[0];

      const overriddenLegs = route.legs.map((leg) => {
        const hasVes = leg.fromCurrency === 'VES' || leg.toCurrency === 'VES';
        const hasUsdt = leg.fromCurrency === 'USDT' || leg.toCurrency === 'USDT';
        if (!hasVes || !hasUsdt || !marketBook) return leg;
        const livePrice = leg.toCurrency === 'USDT' ? marketBook.bestBuyPrice : marketBook.bestSellPrice;
        return livePrice > 0 && livePrice !== leg.price ? { ...leg, price: livePrice } : leg;
      });

      const result = calculateTriangularArbitrage(
        route.id,
        route.name,
        initialAmount,
        [overriddenLegs[0], overriddenLegs[1], overriddenLegs[2]],
      );

      return {
        success: true,
        skillName,
        data: {
          netSpreadPct: result.roiPct,
          profitInitialCurrency: result.netProfit,
          isProfitable: result.isProfitable,
          routeId: result.routeId,
          routeName: result.routeName,
          initialAmount: result.initialAmount,
          finalAmount: result.finalAmount,
          roiPct: result.roiPct,
          totalDurationMinutes: result.totalDurationMinutes,
          riskLevel: result.riskLevel,
          riskReasons: result.riskReasons,
          steps: result.steps,
          breakevenPriceLeg3: result.breakevenPriceLeg3,
          slippageTolerancePct: result.slippageTolerancePct,
          engine: 'core/lib/triangular-arbitrage#calculateTriangularArbitrage',
          liveMarketUsed: Boolean(marketBook),
          warning: marketBook ? undefined : 'Sin libro P2P en caché: se usaron precios de referencia del preset de la ruta.',
        },
        executedAt: now,
      };
    }

    case 'simulate_trade_impact': {
      const targetUsdt = Number(args['targetAmountUsdt']) || 0;
      const side = (args['side'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
      const offers = getSideOffers(side);
      const sim = simulateTradeImpact({
        targetAmountUsdt: targetUsdt,
        side,
        availableOffers: offers,
      });

      return {
        success: true,
        skillName,
        data: {
          ...sim,
          engine: 'core/lib/trade-impact-simulator#simulateTradeImpact',
          marketDataSource: offers.length > 0 ? 'LIVE_BINANCE_P2P_CACHE' : 'EMPTY_BOOK_FALLBACK',
          warning: offers.length === 0 ? 'Sin libro P2P en caché: resultado con libro vacío (sin precio inventado).' : undefined,
        },
        executedAt: now,
      };
    }

    case 'calculate_optimal_spread_avellaneda': {
      const midPrice = Number(args['midPrice'] || 85.0);
      const currentInventoryUsdt = Number(args['currentInventoryUsdt'] || 5000);
      const targetInventoryUsdt = Number(args['targetInventoryUsdt'] || 5000);
      const volatilityDaily = Number(args['volatilityDaily'] || 0.02);
      const timeRemainingFraction = Number(args['timeRemainingFraction'] ?? 1.0);

      const result = computeAvellanedaStoikovQuotes({
        midPrice,
        currentInventoryUsdt,
        targetInventoryUsdt,
        volatilityDaily,
        timeRemainingFraction,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'estimate_adverse_selection_vpin': {
      const buckets = (args['buckets'] || []) as any[];
      const toxicityThreshold = Number(args['toxicityThreshold'] || 0.25);

      const result = calculateVpinMetric({
        buckets,
        toxicityThreshold,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'compute_optimal_order_slicing_twap_vwap': {
      const totalAmountUsdt = Number(args['totalAmountUsdt'] || 5000);
      const executionDurationMinutes = Number(args['executionDurationMinutes'] || 60);
      const estimatedMarketVolumePerHourUsdt = Number(args['estimatedMarketVolumePerHourUsdt'] || 50000);
      const currentMidPrice = Number(args['currentMidPrice'] || 85.0);
      const algorithm = (args['algorithm'] === 'VWAP' ? 'VWAP' : 'TWAP') as 'TWAP' | 'VWAP';

      const result = computeOrderSlicingPlan({
        totalAmountUsdt,
        executionDurationMinutes,
        estimatedMarketVolumePerHourUsdt,
        currentMidPrice,
        algorithm,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'calculate_maker_fill_probability_markov': {
      const queuePositionIndex = Number(args['queuePositionIndex'] || 0);
      const queueAheadVolumeUsdt = Number(args['queueAheadVolumeUsdt'] || 0);
      const recentFillVelocityPerMinuteUsdt = Number(args['recentFillVelocityPerMinuteUsdt'] || 100);
      const targetHorizonMinutes = Number(args['targetHorizonMinutes'] || 15);

      const result = calculateMakerFillProbabilityMarkov({
        queuePositionIndex,
        queueAheadVolumeUsdt,
        recentFillVelocityPerMinuteUsdt,
        targetHorizonMinutes,
      });

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'analyze_fx_corridor_efficiency': {
      const baseAmountUsdt = Number(args['baseAmountUsdt'] || 1000);
      const corridors = (args['corridors'] || []) as any[];

      const result = analyzeFxCorridorEfficiency(baseAmountUsdt, corridors);

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'calculate_cross_exchange_basis_spread': {
      const capitalUsdt = Number(args['capitalUsdt'] || 1000);
      const platforms = (args['platforms'] || []) as any[];

      const result = calculateCrossExchangeBasisSpread(capitalUsdt, platforms);

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    default:
      return null;
  }
}
