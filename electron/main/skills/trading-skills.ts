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
    description:
      'Calcula el spread neto y viabilidad de una ruta de arbitraje triangular de 3 piernas. Deduce comisiones y fricción bancaria.',
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
    description:
      'Simula el llenado real de una orden P2P calculando el precio VWAP y deslizamiento en puntos básicos según la profundidad del libro.',
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
    description:
      'Calcula el precio de reserva y cotizaciones óptimas de compra/venta bajo el modelo cuantitativo de Avellaneda-Stoikov basado en inventario y volatilidad.',
    parameters: {
      type: 'OBJECT',
      properties: {
        midPrice: { type: 'NUMBER', description: 'Precio medio actual del mercado.' },
        currentInventoryUsdt: { type: 'NUMBER', description: 'Inventario actual en USDT.' },
        targetInventoryUsdt: { type: 'NUMBER', description: 'Inventario objetivo en USDT.' },
        volatilityDaily: {
          type: 'NUMBER',
          description: 'Volatilidad diaria estimada en decimal (ej. 0.02 = 2%).',
        },
        timeRemainingFraction: {
          type: 'NUMBER',
          description: 'Fracción de horizonte restante (0 a 1.0).',
        },
      },
      required: ['midPrice', 'currentInventoryUsdt', 'targetInventoryUsdt', 'volatilityDaily'],
    },
  },
  {
    name: 'estimate_adverse_selection_vpin',
    description:
      'Estima la probabilidad de toxicidad de flujo informado mediante la métrica VPIN (Volume-Synchronized Probability of Toxicity) para proteger el spread.',
    parameters: {
      type: 'OBJECT',
      properties: {
        buckets: {
          type: 'ARRAY',
          description:
            'Lista no vacía de buckets de volumen con buyVolume, sellVolume y totalVolume. Falla cerrado si está vacía.',
          items: {
            type: 'OBJECT',
            description: 'Bucket de volumen VPIN.',
            properties: {
              buyVolume: { type: 'NUMBER', description: 'Volumen comprador en el bucket.' },
              sellVolume: { type: 'NUMBER', description: 'Volumen vendedor en el bucket.' },
              totalVolume: { type: 'NUMBER', description: 'Volumen total en el bucket.' },
            },
            required: ['buyVolume', 'sellVolume', 'totalVolume'],
          },
        },
        toxicityThreshold: { type: 'NUMBER', description: 'Umbral de toxicidad (default 0.25).' },
      },
      required: ['buckets'],
    },
  },
  {
    name: 'compute_optimal_order_slicing_twap_vwap',
    description:
      'Divide un bloque institucional grande en micro-lotes TWAP/VWAP para minimizar el impacto de mercado y prevenir front-running. Exige precio medio y volumen horario reales.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalAmountUsdt: { type: 'NUMBER', description: 'Volumen institucional total a ejecutar (> 0).' },
        executionDurationMinutes: {
          type: 'NUMBER',
          description: 'Duración total de ejecución en minutos (> 0).',
        },
        estimatedMarketVolumePerHourUsdt: {
          type: 'NUMBER',
          description: 'Volumen horario real estimado del mercado en USDT (> 0).',
        },
        currentMidPrice: { type: 'NUMBER', description: 'Precio medio actual observado (> 0).' },
        algorithm: {
          type: 'STRING',
          enum: ['TWAP', 'VWAP'],
          description: 'Algoritmo de ponderación temporal.',
        },
      },
      required: [
        'totalAmountUsdt',
        'executionDurationMinutes',
        'estimatedMarketVolumePerHourUsdt',
        'currentMidPrice',
        'algorithm',
      ],
    },
  },
  {
    name: 'calculate_maker_fill_probability_markov',
    description:
      'Calcula la probabilidad estocástica de llenado de una orden Maker y tiempo estimado de espera mediante procesos markovianos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        queuePositionIndex: { type: 'INTEGER', description: 'Posición en la cola (>= 0, 0 = punta).' },
        queueAheadVolumeUsdt: { type: 'NUMBER', description: 'Volumen por delante en el libro (>= 0).' },
        recentFillVelocityPerMinuteUsdt: {
          type: 'NUMBER',
          description: 'Velocidad de absorción del mercado en USDT/min (> 0).',
        },
        targetHorizonMinutes: {
          type: 'NUMBER',
          description: 'Horizonte temporal evaluado en minutos (> 0, default 15).',
        },
      },
      required: ['queuePositionIndex', 'queueAheadVolumeUsdt', 'recentFillVelocityPerMinuteUsdt'],
    },
  },
  {
    name: 'analyze_fx_corridor_efficiency',
    description:
      'Compara y ranquea la eficiencia de múltiples corredores de remesas internacionales (USDT/VES, USDT/COP, etc.) deduciendo fricción bancaria y latencia.',
    parameters: {
      type: 'OBJECT',
      properties: {
        baseAmountUsdt: { type: 'NUMBER', description: 'Monto base a convertir en USDT (> 0).' },
        corridors: {
          type: 'ARRAY',
          description: 'Lista no vacía de corredores con cotizaciones, fricción y tiempos de liquidación.',
          items: {
            type: 'OBJECT',
            description: 'Corredor FX.',
            properties: {
              corridorId: { type: 'STRING', description: 'Identificador del corredor (ej. USDT-VES).' },
              sourceCurrency: { type: 'STRING', description: 'Divisa de origen.' },
              targetCurrency: { type: 'STRING', description: 'Divisa destino.' },
              spotCrossRate: { type: 'NUMBER', description: 'Tasa spot del corredor (> 0).' },
              officialParityRate: { type: 'NUMBER', description: 'Tasa paridad de referencia (> 0).' },
              bankingFrictionPct: { type: 'NUMBER', description: 'Fricción bancaria en %.' },
              transferLatencyMinutes: { type: 'NUMBER', description: 'Latencia estimada en minutos.' },
              makerFeePct: { type: 'NUMBER', description: 'Comisión maker en %.' },
            },
            required: [
              'corridorId',
              'sourceCurrency',
              'targetCurrency',
              'spotCrossRate',
              'officialParityRate',
              'bankingFrictionPct',
              'transferLatencyMinutes',
              'makerFeePct',
            ],
          },
        },
      },
      required: ['baseAmountUsdt', 'corridors'],
    },
  },
  {
    name: 'calculate_cross_exchange_basis_spread',
    description:
      'Detecta oportunidades de arbitraje espacial de base entre al menos dos plataformas P2P (Binance, Bybit, El Dorado) con tasas reales.',
    parameters: {
      type: 'OBJECT',
      properties: {
        capitalUsdt: { type: 'NUMBER', description: 'Capital disponible para arbitraje en USDT (> 0).' },
        platforms: {
          type: 'ARRAY',
          description: 'Lista de al menos 2 puntos de precio por plataforma con bid, ask y comisiones.',
          items: {
            type: 'OBJECT',
            description: 'Precios de plataforma.',
            properties: {
              platformName: { type: 'STRING', description: 'Nombre de la plataforma (ej. Binance P2P).' },
              fiatCurrency: { type: 'STRING', description: 'Moneda fiat (ej. VES).' },
              bestBidPrice: { type: 'NUMBER', description: 'Mejor precio bid (> 0).' },
              bestAskPrice: { type: 'NUMBER', description: 'Mejor precio ask (> 0).' },
              availableDepthUsdt: { type: 'NUMBER', description: 'Profundidad disponible en USDT.' },
              internalTransferFeeUsdt: { type: 'NUMBER', description: 'Costo fijo de transferencia interna.' },
            },
            required: [
              'platformName',
              'fiatCurrency',
              'bestBidPrice',
              'bestAskPrice',
              'availableDepthUsdt',
              'internalTransferFeeUsdt',
            ],
          },
        },
      },
      required: ['capitalUsdt', 'platforms'],
    },
  },
];

function parsePositiveFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseNonNegativeFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function failMissingInput(
  skillName: string,
  field: string,
  error: string,
  expectedSource: string,
  now: number,
): FinancialSkillResult {
  return {
    success: false,
    skillName,
    data: null,
    error,
    unavailableReason: `missing_or_invalid_input:${field}`,
    expectedSource,
    actionable: false,
    executedAt: now,
  };
}

export function dispatchTradingSkill(
  skillName: string,
  args: Record<string, unknown>,
  now: number,
): FinancialSkillResult | null {
  const marketBook = getMarketBook();

  switch (skillName) {
    case 'scan_triangular_arbitrage': {
      const initialAmount = parsePositiveFiniteNumber(args['initialAmount']);
      if (initialAmount === null) {
        return failMissingInput(
          skillName,
          'initialAmount',
          'Se requiere initialAmount numérico positivo y finito para evaluar arbitraje triangular.',
          'Parámetro initialAmount (> 0)',
          now,
        );
      }
      const rawCurrency = args['initialCurrency'];
      const initialCurrency =
        typeof rawCurrency === 'string' && rawCurrency.trim().length > 0
          ? rawCurrency.trim().toUpperCase()
          : '';
      if (!initialCurrency) {
        return failMissingInput(
          skillName,
          'initialCurrency',
          'Se requiere initialCurrency válida (ej. USDT, VES, COP).',
          'Parámetro initialCurrency',
          now,
        );
      }
      const route =
        DEFAULT_TRIANGULAR_PRESETS.find((r) => r.initialCurrency === initialCurrency) ||
        DEFAULT_TRIANGULAR_PRESETS[0];

      const marketBuyVes = marketBook && marketBook.bestBuyPrice > 0 ? marketBook.bestBuyPrice : 0;
      const marketSellVes = marketBook && marketBook.bestSellPrice > 0 ? marketBook.bestSellPrice : 0;

      const overriddenLegs = route.legs.map((leg) => {
        if (!marketBook || (marketBuyVes === 0 && marketSellVes === 0)) return leg;

        // Buying crypto with VES (e.g. VES -> USDT)
        if (leg.fromCurrency === 'VES' && (leg.toCurrency === 'USDT' || leg.toCurrency === 'USDC' || leg.toCurrency === 'USD')) {
          const price = marketBuyVes > 0 ? marketBuyVes : leg.price;
          return { ...leg, price };
        }

        // Selling crypto for VES (e.g. USDT -> VES, USDC -> VES, USD -> VES)
        if ((leg.fromCurrency === 'USDT' || leg.fromCurrency === 'USDC' || leg.fromCurrency === 'USD') && leg.toCurrency === 'VES') {
          const price = marketSellVes > 0 ? marketSellVes : leg.price;
          return { ...leg, price };
        }

        return leg;
      });

      const result = calculateTriangularArbitrage(route.id, route.name, initialAmount, [
        overriddenLegs[0],
        overriddenLegs[1],
        overriddenLegs[2],
      ]);

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
          warning: marketBook
            ? undefined
            : 'Sin libro P2P en caché: se usaron precios de referencia del preset de la ruta.',
        },
        executedAt: now,
      };
    }

    case 'simulate_trade_impact': {
      const targetUsdt = parsePositiveFiniteNumber(args['targetAmountUsdt']);
      if (targetUsdt === null) {
        return failMissingInput(
          skillName,
          'targetAmountUsdt',
          'Se requiere targetAmountUsdt numérico positivo y finito para simular impacto.',
          'Parámetro targetAmountUsdt (> 0)',
          now,
        );
      }
      if (args['side'] !== 'BUY' && args['side'] !== 'SELL') {
        return failMissingInput(
          skillName,
          'side',
          'El parámetro side debe ser "BUY" o "SELL".',
          'Parámetro side (BUY | SELL)',
          now,
        );
      }
      const side = args['side'];
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
          warning:
            offers.length === 0
              ? 'Sin libro P2P en caché: resultado con libro vacío (sin precio inventado).'
              : undefined,
        },
        executedAt: now,
      };
    }

    case 'calculate_optimal_spread_avellaneda': {
      const midPrice = parsePositiveFiniteNumber(args['midPrice']);
      if (midPrice === null) {
        return failMissingInput(
          skillName,
          'midPrice',
          'Falta midPrice positivo observado en el libro; no se sustituye por un valor fijo.',
          'Libro P2P en vivo (bestBuy + bestSell) / 2',
          now,
        );
      }
      const currentInventoryUsdt = parseNonNegativeFiniteNumber(args['currentInventoryUsdt']);
      if (currentInventoryUsdt === null) {
        return failMissingInput(
          skillName,
          'currentInventoryUsdt',
          'Se requiere currentInventoryUsdt numérico no negativo y finito.',
          'Parámetro currentInventoryUsdt (>= 0)',
          now,
        );
      }
      const targetInventoryUsdt = parsePositiveFiniteNumber(args['targetInventoryUsdt']);
      if (targetInventoryUsdt === null) {
        return failMissingInput(
          skillName,
          'targetInventoryUsdt',
          'Se requiere targetInventoryUsdt numérico positivo y finito.',
          'Parámetro targetInventoryUsdt (> 0)',
          now,
        );
      }
      const volatilityDaily = parseNonNegativeFiniteNumber(args['volatilityDaily']);
      if (volatilityDaily === null) {
        return failMissingInput(
          skillName,
          'volatilityDaily',
          'Se requiere volatilityDaily numérica no negativa y finita.',
          'Parámetro volatilityDaily (>= 0)',
          now,
        );
      }
      const timeRemainingFraction =
        args['timeRemainingFraction'] === undefined
          ? 1.0
          : parsePositiveFiniteNumber(args['timeRemainingFraction']);
      if (timeRemainingFraction === null || timeRemainingFraction > 1.0) {
        return failMissingInput(
          skillName,
          'timeRemainingFraction',
          'timeRemainingFraction debe estar en el rango (0, 1.0].',
          'Parámetro timeRemainingFraction',
          now,
        );
      }

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
      const rawBuckets = args['buckets'];
      if (!Array.isArray(rawBuckets) || rawBuckets.length === 0) {
        return failMissingInput(
          skillName,
          'buckets',
          'Se requiere al menos un bucket de volumen real para calcular VPIN; sin buckets el flujo no se estima.',
          'Serie de buckets VPIN con buyVolume, sellVolume y totalVolume',
          now,
        );
      }
      const buckets = rawBuckets as Parameters<typeof calculateVpinMetric>[0]['buckets'];
      const toxicityThreshold =
        args['toxicityThreshold'] === undefined
          ? 0.25
          : parseNonNegativeFiniteNumber(args['toxicityThreshold']);
      if (toxicityThreshold === null) {
        return failMissingInput(
          skillName,
          'toxicityThreshold',
          'toxicityThreshold debe ser un número finito no negativo.',
          'Parámetro toxicityThreshold (>= 0)',
          now,
        );
      }

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
      const totalAmountUsdt = parsePositiveFiniteNumber(args['totalAmountUsdt']);
      const executionDurationMinutes = parsePositiveFiniteNumber(args['executionDurationMinutes']);
      const estimatedMarketVolumePerHourUsdt = parsePositiveFiniteNumber(
        args['estimatedMarketVolumePerHourUsdt'],
      );
      const currentMidPrice = parsePositiveFiniteNumber(args['currentMidPrice']);
      if (
        totalAmountUsdt === null ||
        executionDurationMinutes === null ||
        estimatedMarketVolumePerHourUsdt === null ||
        currentMidPrice === null
      ) {
        return failMissingInput(
          skillName,
          'totalAmountUsdt|executionDurationMinutes|estimatedMarketVolumePerHourUsdt|currentMidPrice',
          'Todos los parámetros de tamaño, duración, volumen horario y precio medio deben ser números positivos finitos.',
          'Profundidad y precio medio medidos en vivo',
          now,
        );
      }
      if (args['algorithm'] !== 'TWAP' && args['algorithm'] !== 'VWAP') {
        return failMissingInput(
          skillName,
          'algorithm',
          'El parámetro algorithm debe ser "TWAP" o "VWAP".',
          'Parámetro algorithm (TWAP | VWAP)',
          now,
        );
      }
      const algorithm = args['algorithm'];

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
      const queuePositionIndex = parseNonNegativeFiniteNumber(args['queuePositionIndex']);
      const queueAheadVolumeUsdt = parseNonNegativeFiniteNumber(args['queueAheadVolumeUsdt']);
      const recentFillVelocityPerMinuteUsdt = parsePositiveFiniteNumber(
        args['recentFillVelocityPerMinuteUsdt'],
      );
      const targetHorizonMinutes =
        args['targetHorizonMinutes'] === undefined
          ? 15
          : parsePositiveFiniteNumber(args['targetHorizonMinutes']);
      if (
        queuePositionIndex === null ||
        !Number.isInteger(queuePositionIndex) ||
        queueAheadVolumeUsdt === null ||
        recentFillVelocityPerMinuteUsdt === null ||
        targetHorizonMinutes === null
      ) {
        return failMissingInput(
          skillName,
          'queuePositionIndex|queueAheadVolumeUsdt|recentFillVelocityPerMinuteUsdt|targetHorizonMinutes',
          'Parámetros inválidos para modelo Markov de llenado Maker.',
          'Posición de cola, volumen por delante y velocidad de absorción observados',
          now,
        );
      }

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
      const baseAmountUsdt = parsePositiveFiniteNumber(args['baseAmountUsdt']);
      const corridors = args['corridors'];
      if (baseAmountUsdt === null || !Array.isArray(corridors) || corridors.length === 0) {
        return failMissingInput(
          skillName,
          'baseAmountUsdt|corridors',
          'Se requiere baseAmountUsdt > 0 y una lista no vacía de corredores FX.',
          'Parámetros baseAmountUsdt y corridors',
          now,
        );
      }

      const result = analyzeFxCorridorEfficiency(
        baseAmountUsdt,
        corridors as Parameters<typeof analyzeFxCorridorEfficiency>[1],
      );

      return {
        success: true,
        skillName,
        data: result,
        executedAt: now,
      };
    }

    case 'calculate_cross_exchange_basis_spread': {
      const capitalUsdt = parsePositiveFiniteNumber(args['capitalUsdt']);
      const rawPlatforms = args['platforms'];
      if (capitalUsdt === null || !Array.isArray(rawPlatforms) || rawPlatforms.length < 2) {
        return failMissingInput(
          skillName,
          'capitalUsdt|platforms',
          'Se requiere capitalUsdt > 0 y al menos 2 plataformas con cotizaciones reales para arbitraje espacial.',
          'Cotizaciones en vivo de >= 2 venues (Binance, Bybit, El Dorado)',
          now,
        );
      }
      const validPlatforms = rawPlatforms.filter((p) => {
        if (!p || typeof p !== 'object') return false;
        const rec = p as Record<string, unknown>;
        return (
          typeof rec['platformName'] === 'string' &&
          rec['platformName'].trim().length > 0 &&
          parsePositiveFiniteNumber(rec['bestBidPrice']) !== null &&
          parsePositiveFiniteNumber(rec['bestAskPrice']) !== null
        );
      });
      if (validPlatforms.length < 2) {
        return failMissingInput(
          skillName,
          'platforms',
          'Se requieren al menos 2 plataformas con bestBidPrice y bestAskPrice positivos finitos.',
          'Cotizaciones válidas de >= 2 venues',
          now,
        );
      }

      const result = calculateCrossExchangeBasisSpread(
        capitalUsdt,
        validPlatforms as Parameters<typeof calculateCrossExchangeBasisSpread>[1],
      );

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
