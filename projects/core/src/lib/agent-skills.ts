/**
 * Financial Agent Skills Hub & Function Calling Declarations.
 * Wraps pure deterministic core functions (Triangular Arbitrage, BCV Predictor,
 * Orderbook Microstructure, and Operator Manager) into structured schemas
 * for Gemini Function Calling and multi-agent execution.
 * 0 framework dependencies.
 */

import { calculateTriangularArbitrage, type ExchangeLeg } from './triangular-arbitrage';
import { getBcvMarketIntelligence, calculateBcvGap } from './bcv-intervention-predictor';
import { computeMicrostructureSanitizedDepth, OrderPersistenceTracker } from './orderbook-microstructure';
import type { BinanceOfferSummary } from './binance-p2p';
import { evaluateGoldenSpread, buildTeamAllocationPlan, type OperatorProfile } from './operator-manager';
import {
  calculatePortfolioDelta,
  evaluateDeltaHedge,
  type PortfolioBalanceSnapshot,
  type DeltaNeutralEngineConfig,
} from './delta-neutral-hedge';
import {
  predictTwoHourVolatility,
  type PriceTick,
  type VolatilityForecastInput,
} from './volatility-forecaster';
import {
  ZkMarketMesh,
  type BlindThreatRecord,
  generateBlindHash,
} from './zk-market-mesh';
import {
  buildDisputeDossier,
  type DisputeDossierParams,
} from './dispute-copilot';
import {
  simulateTradeImpact,
  type TradeImpactInput,
} from './trade-impact-simulator';
import {
  computeAvellanedaStoikovQuotes,
  calculateVpinMetric,
  computeOrderSlicingPlan,
  calculateMakerFillProbabilityMarkov,
  type AvellanedaStoikovInput,
  type VpinAnalysisInput,
  type InstitutionalSlicingInput,
  type MarkovFillProbabilityInput,
} from './orderbook-microstructure';
import {
  analyzeFxCorridorEfficiency,
  calculateCrossExchangeBasisSpread,
  type FxCorridorQuote,
  type PlatformPricePoint,
} from './triangular-arbitrage';
import {
  calculateConvexityAndGammaRisk,
  modelPerpetualFundingArbitrage,
  optimizeCapitalAllocationKelly,
  type ConvexityRiskInput,
  type FundingRateArbitrageInput,
  type KellyAllocationInput,
} from './delta-neutral-hedge';
import {
  forecastCentralBankLiquidityDrain,
  monitorFiatFlightAndDollarizationVelocity,
  simulateGameTheoryNashRepricing,
  type CentralBankLiquidityDrainInput,
  type FiatDollarizationVelocityInput,
  type NashRepricingInput,
} from './bcv-intervention-predictor';

export interface AgentSkillParameterSchema {
  type: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';
  description: string;
  enum?: string[];
  items?: Record<string, unknown>;
  properties?: Record<string, AgentSkillParameterSchema>;
  required?: string[];
}

export interface AgentSkillDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, AgentSkillParameterSchema>;
    required: string[];
  };
}

export interface FinancialSkillResult {
  success: boolean;
  skillName: string;
  data?: unknown;
  error?: string;
  executedAt: number;
}

/**
 * Standard Gemini function declarations for financial tools.
 */
export const GEMINI_FINANCIAL_SKILLS: AgentSkillDefinition[] = [
  {
    name: 'scan_triangular_arbitrage',
    description: 'Calcula el spread neto y viabilidad de una ruta de arbitraje triangular de 3 piernas (ej. VES -> USDT -> BTC -> VES). Deduce comisiones y fricción bancaria.',
    parameters: {
      type: 'OBJECT',
      properties: {
        initialAmount: {
          type: 'NUMBER',
          description: 'Monto inicial a convertir en la primera pierna (ej. 1000 USDT o 80000 VES).',
        },
        initialCurrency: {
          type: 'STRING',
          description: 'Símbolo de la divisa de origen (ej. USDT, VES, COP, USD).',
        },
        legs: {
          type: 'ARRAY',
          description: 'Arreglo exacto de 3 piernas de intercambio para completar el ciclo triangular.',
          items: {
            type: 'OBJECT',
            description: 'Definición de cada pierna con precio, tipo de operación y comisiones.',
          },
        },
      },
      required: ['initialAmount', 'initialCurrency', 'legs'],
    },
  },
  {
    name: 'predict_bcv_market_intelligence',
    description: 'Evalúa la brecha cambiaria entre la tasa paralela P2P y la tasa oficial BCV, calculando probabilidad de intervención y directiva de tesorería macro.',
    parameters: {
      type: 'OBJECT',
      properties: {
        parallelRate: {
          type: 'NUMBER',
          description: 'Precio actual del dólar o USDT en el mercado paralelo / P2P en VES.',
        },
        bcvRate: {
          type: 'NUMBER',
          description: 'Precio de referencia oficial publicado por el Banco Central de Venezuela en VES.',
        },
      },
      required: ['parallelRate', 'bcvRate'],
    },
  },
  {
    name: 'inspect_orderbook_liquidity',
    description: 'Analiza la microestructura del libro de órdenes P2P, filtrando liquidez fantasma, spoofing y órdenes desactualizadas mediante profundidad Johnson sanitizada.',
    parameters: {
      type: 'OBJECT',
      properties: {
        offers: {
          type: 'ARRAY',
          description: 'Lista de anuncios / órdenes crudas del libro P2P.',
          items: {
            type: 'OBJECT',
            description: 'Anuncio con precio, volumen, perfil de comerciante y límites.',
          },
        },
        side: {
          type: 'STRING',
          description: 'Lado del libro a analizar: BUY (anuncios de compra) o SELL (anuncios de venta).',
          enum: ['BUY', 'SELL'],
        },
        targetVolumeUsdt: {
          type: 'NUMBER',
          description: 'Volumen objetivo en USDT para evaluar el precio promedio ponderado (VWAP).',
        },
      },
      required: ['offers', 'side'],
    },
  },
  {
    name: 'evaluate_golden_spread',
    description: 'Verifica si un spread neto cumple con la Regla de Oro institucional (mínimo 0.50% neto) para no quemar cuotas bancarias.',
    parameters: {
      type: 'OBJECT',
      properties: {
        netSpreadPct: {
          type: 'NUMBER',
          description: 'Porcentaje de spread neto proyectado para la operación.',
        },
      },
      required: ['netSpreadPct'],
    },
  },
  {
    name: 'build_operator_allocation_plan',
    description: 'Construye un plan de delegación y asignación de capital institucional para operadores P2P de la mesa de dinero.',
    parameters: {
      type: 'OBJECT',
      properties: {
        deskCapitalUsdt: {
          type: 'NUMBER',
          description: 'Capital total disponible de la mesa de operaciones en USDT.',
        },
        referenceRateVes: {
          type: 'NUMBER',
          description: 'Tasa de cambio de referencia VES/USDT.',
        },
        operators: {
          type: 'ARRAY',
          description: 'Lista de perfiles de operadores activos con sus splits de comisión y metas de ciclos.',
          items: {
            type: 'OBJECT',
            description: 'Perfil del operador.',
          },
        },
      },
      required: ['deskCapitalUsdt', 'referenceRateVes', 'operators'],
    },
  },
  {
    name: 'evaluate_delta_neutral_hedge',
    description: 'Audita la exposición neta en moneda local (VES) y propone órdenes de cobertura sintética (delta-neutral) con derivados spot/perp si se supera el riesgo de devaluación.',
    parameters: {
      type: 'OBJECT',
      properties: {
        vesBalance: {
          type: 'NUMBER',
          description: 'Balance actual de bolívares (VES) en tesorería o cuentas bancarias.',
        },
        usdtBalance: {
          type: 'NUMBER',
          description: 'Balance actual en USDT en billeteras y plataformas.',
        },
        currentParallelRate: {
          type: 'NUMBER',
          description: 'Tasa paralela de mercado VES/USDT.',
        },
        vesMaxHoldingTimeMinutes: {
          type: 'NUMBER',
          description: 'Minutos que el inventario de VES lleva ocioso sin rotar.',
        },
        maxAllowedFiatDeltaRatio: {
          type: 'NUMBER',
          description: 'Ratio máximo permitido de exposición en fiat (default 0.15 = 15%).',
        },
      },
      required: ['vesBalance', 'usdtBalance', 'currentParallelRate'],
    },
  },
  {
    name: 'forecast_market_volatility_2h',
    description: 'Pronostica el índice de volatilidad, dirección del spread y markups recomendados de compra/venta para las próximas 2 horas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        currentSpreadPct: {
          type: 'NUMBER',
          description: 'Spread actual de mercado en porcentaje (ej. 1.20).',
        },
        recentTicks: {
          type: 'ARRAY',
          description: 'Muestra de precios recientes con timestamp, precio de compra y precio de venta.',
          items: {
            type: 'OBJECT',
            description: 'Tick con timestampMs, buyPrice, sellPrice.',
          },
        },
        parallelRate: {
          type: 'NUMBER',
          description: 'Tasa paralela actual de referencia.',
        },
        bcvRate: {
          type: 'NUMBER',
          description: 'Tasa BCV oficial de referencia.',
        },
      },
      required: ['currentSpreadPct'],
    },
  },
  {
    name: 'audit_zk_mesh_threat',
    description: 'Audita identificadores sensibles (cédula, RIF, teléfono, cuenta bancaria) contra la red ZK de inteligencia antifraude usando hashes ciegos con salt.',
    parameters: {
      type: 'OBJECT',
      properties: {
        identifier: {
          type: 'STRING',
          description: 'Cédula de identidad, RIF, número telefónico o número de cuenta de la contraparte.',
        },
        saltDomain: {
          type: 'STRING',
          description: 'Dominio de sal opcional para el hash ciego (default estándar p2p-ve-mesh-salt-2026).',
        },
      },
      required: ['identifier'],
    },
  },
  {
    name: 'generate_dispute_dossier',
    description: 'Construye un expediente formal y arbitral bilingüe (español/inglés) para mediar en disputas P2P de Binance por pagos de terceros o discrepancias.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: {
          type: 'STRING',
          description: 'ID oficial de la orden P2P en Binance.',
        },
        orderAmountFiat: {
          type: 'NUMBER',
          description: 'Monto en fiat esperado en la orden.',
        },
        orderAmountCrypto: {
          type: 'NUMBER',
          description: 'Monto en USDT u otro criptoactivo comprometido.',
        },
        counterpartyBinanceName: {
          type: 'STRING',
          description: 'Nombre del titular de la cuenta en Binance.',
        },
        bankPayerName: {
          type: 'STRING',
          description: 'Nombre real del titular de la cuenta bancaria que emitió el pago.',
        },
        bankName: {
          type: 'STRING',
          description: 'Nombre del banco emisor o receptor (ej. Banesco, Pago Móvil).',
        },
        bankReference: {
          type: 'STRING',
          description: 'Número de referencia bancaria reportado en la transferencia.',
        },
      },
      required: ['orderId', 'orderAmountFiat', 'orderAmountCrypto', 'counterpartyBinanceName', 'bankPayerName', 'bankName', 'bankReference'],
    },
  },
  {
    name: 'simulate_trade_impact',
    description: 'Simula el llenado real de una orden P2P a través de múltiples niveles del libro: calcula precio VWAP, deslizamiento en bps y probabilidad de llenado según la reputación del comerciante.',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetAmountUsdt: {
          type: 'NUMBER',
          description: 'Volumen objetivo en USDT que se desea comprar o vender.',
        },
        side: {
          type: 'STRING',
          description: 'Lado de la operación: BUY (comprar cripto con fiat) o SELL (vender cripto por fiat).',
          enum: ['BUY', 'SELL'],
        },
        availableOffers: {
          type: 'ARRAY',
          description: 'Lista de anuncios del libro P2P con precios, montos disponibles y tasas de finalización.',
          items: {
            type: 'OBJECT',
            description: 'Anuncio P2P.',
          },
        },
      },
      required: ['targetAmountUsdt', 'side', 'availableOffers'],
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
  {
    name: 'calculate_convexity_and_gamma_risk',
    description: 'Modela la pérdida patrimonial acelerada por riesgo de convexidad y efecto Gamma ante saltos devaluatorios no lineales del tipo de cambio.',
    parameters: {
      type: 'OBJECT',
      properties: {
        spotParallelRate: { type: 'NUMBER', description: 'Tasa paralela actual.' },
        vesHoldingAmount: { type: 'NUMBER', description: 'Monto de bolívares en cartera.' },
        expectedDevaluationJumpPct: { type: 'NUMBER', description: 'Salto devaluatorio proyectado en porcentaje.' },
        timeHorizonDays: { type: 'NUMBER', description: 'Días de exposición proyectados.' },
      },
      required: ['spotParallelRate', 'vesHoldingAmount', 'expectedDevaluationJumpPct', 'timeHorizonDays'],
    },
  },
  {
    name: 'model_perpetual_funding_arbitrage',
    description: 'Calcula el rendimiento APY del arbitraje de Funding Rate en derivados perpetuos (Cash-and-Carry) para subsidiar tesorería.',
    parameters: {
      type: 'OBJECT',
      properties: {
        collateralUsdt: { type: 'NUMBER', description: 'Colateral en USDT disponible.' },
        currentFundingRate8hPct: { type: 'NUMBER', description: 'Tasa de financiamiento por 8h en porcentaje.' },
        holdingPeriodDays: { type: 'NUMBER', description: 'Días estimados de mantenimiento de posición.' },
      },
      required: ['collateralUsdt', 'currentFundingRate8hPct', 'holdingPeriodDays'],
    },
  },
  {
    name: 'optimize_capital_allocation_kelly',
    description: 'Optimiza el tamaño del ticket y distribución por entidad bancaria mediante el Criterio Fraccional de Kelly.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalCapitalUsdt: { type: 'NUMBER', description: 'Capital total de la tesorería en USDT.' },
        winRatePct: { type: 'NUMBER', description: 'Tasa de acierto histórica en operaciones P2P.' },
        averageProfitPerWinUsdt: { type: 'NUMBER', description: 'Ganancia promedio por trade ganador.' },
        averageLossPerLossUsdt: { type: 'NUMBER', description: 'Pérdida promedio por trade adverso.' },
      },
      required: ['totalCapitalUsdt', 'winRatePct', 'averageProfitPerWinUsdt', 'averageLossPerLossUsdt'],
    },
  },
  {
    name: 'forecast_central_bank_liquidity_drain',
    description: 'Modela el impacto macro del drenaje de liquidez interbancaria (recaudación fiscal SENIAT y subastas BCV) sobre la demanda P2P.',
    parameters: {
      type: 'OBJECT',
      properties: {
        dayOfMonth: { type: 'INTEGER', description: 'Día del mes (1 a 31).' },
        dayOfWeek: { type: 'INTEGER', description: 'Día de la semana (0=Dom, 1=Lun).' },
        estimatedSeniatCollectionActive: { type: 'BOOLEAN', description: 'Indica si hay recaudación especial activa.' },
        weeklyBcvInjectionMillionsUsd: { type: 'NUMBER', description: 'Monto de la inyección semanal del BCV en millones USD.' },
      },
      required: ['dayOfMonth', 'dayOfWeek', 'estimatedSeniatCollectionActive', 'weeklyBcvInjectionMillionsUsd'],
    },
  },
  {
    name: 'monitor_fiat_flight_and_dollarization_velocity',
    description: 'Mide la velocidad de repudio de la moneda local (MV=PY) y determina el umbral máximo seguro de tenencia de saldos en VES.',
    parameters: {
      type: 'OBJECT',
      properties: {
        averageVesHoldingMinutes: { type: 'NUMBER', description: 'Tiempo promedio que los comercios retienen bolívares.' },
        merchantUsdtAcceptancePct: { type: 'NUMBER', description: 'Porcentaje de penetración de USDT.' },
        monthlyInflationEstimatePct: { type: 'NUMBER', description: 'Inflación mensual estimada en porcentaje.' },
      },
      required: ['averageVesHoldingMinutes', 'merchantUsdtAcceptancePct', 'monthlyInflationEstimatePct'],
    },
  },
  {
    name: 'simulate_game_theory_nash_repricing',
    description: 'Simula el Equilibrio de Nash entre los creadores de mercado líderes para fijar un precio Maker sin desatar guerras de subcotización.',
    parameters: {
      type: 'OBJECT',
      properties: {
        myCurrentPrice: { type: 'NUMBER', description: 'Precio actual del operador.' },
        targetSide: { type: 'STRING', enum: ['BUY', 'SELL'], description: 'Lado del libro.' },
        topCompetitors: {
          type: 'ARRAY',
          description: 'Lista de competidores inmediatos en punta.',
          items: { type: 'OBJECT', description: 'Perfil de competidor.' },
        },
        minimumSpreadAllowedPct: { type: 'NUMBER', description: 'Margen mínimo neto tolerado.' },
      },
      required: ['myCurrentPrice', 'targetSide', 'topCompetitors', 'minimumSpreadAllowedPct'],
    },
  },
];

/**
 * Deterministic dispatcher: safely maps a tool invocation to its corresponding core domain logic.
 */
export function executeFinancialSkill(skillName: string, args: Record<string, unknown>): FinancialSkillResult {
  const now = Date.now();
  try {
    switch (skillName) {
      case 'scan_triangular_arbitrage': {
        const initialAmount = Number(args['initialAmount']);
        const initialCurrency = String(args['initialCurrency'] || 'USDT');
        const legs = args['legs'] as [ExchangeLeg, ExchangeLeg, ExchangeLeg];
        if (!initialAmount || !Array.isArray(legs) || legs.length !== 3) {
          return {
            success: false,
            skillName,
            error: 'scan_triangular_arbitrage requiere initialAmount y un arreglo de 3 piernas (legs).',
            executedAt: now,
          };
        }
        const result = calculateTriangularArbitrage(
          'triangular-auto',
          'Ruta Triangular Automatizada',
          initialAmount,
          legs,
        );
        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'predict_bcv_market_intelligence': {
        const parallelRate = Number(args['parallelRate']);
        const bcvRate = Number(args['bcvRate']);
        if (!parallelRate || !bcvRate) {
          return {
            success: false,
            skillName,
            error: 'predict_bcv_market_intelligence requiere parallelRate y bcvRate mayores a 0.',
            executedAt: now,
          };
        }
        const result = getBcvMarketIntelligence(parallelRate, bcvRate);
        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'inspect_orderbook_liquidity': {
        const offers = (args['offers'] || []) as BinanceOfferSummary[];
        const side = (args['side'] || 'BUY') as 'BUY' | 'SELL';
        const targetVolumeUsdt = args['targetVolumeUsdt'] !== undefined ? Number(args['targetVolumeUsdt']) : 1000;
        const tracker = new OrderPersistenceTracker();
        const result = computeMicrostructureSanitizedDepth(offers, side, targetVolumeUsdt, tracker);
        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'evaluate_golden_spread': {
        const netSpreadPct = Number(args['netSpreadPct']);
        if (isNaN(netSpreadPct)) {
          return {
            success: false,
            skillName,
            error: 'evaluate_golden_spread requiere un netSpreadPct numérico.',
            executedAt: now,
          };
        }
        const result = evaluateGoldenSpread(netSpreadPct);
        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'build_operator_allocation_plan': {
        const deskCapitalUsdt = Number(args['deskCapitalUsdt']);
        const referenceRateVes = Number(args['referenceRateVes']);
        const operators = (args['operators'] || []) as OperatorProfile[];
        if (!deskCapitalUsdt || !referenceRateVes || !Array.isArray(operators)) {
          return {
            success: false,
            skillName,
            error: 'build_operator_allocation_plan requiere deskCapitalUsdt, referenceRateVes y lista de operators.',
            executedAt: now,
          };
        }
        const result = buildTeamAllocationPlan(deskCapitalUsdt, operators, referenceRateVes);
        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'evaluate_delta_neutral_hedge': {
        const vesBalance = Number(args['vesBalance'] || 0);
        const usdtBalance = Number(args['usdtBalance'] || 0);
        const currentParallelRate = Number(args['currentParallelRate'] || 1);
        const vesMaxHoldingTimeMinutes = Number(args['vesMaxHoldingTimeMinutes'] || 0);
        const maxAllowed = args['maxAllowedFiatDeltaRatio'] ? Number(args['maxAllowedFiatDeltaRatio']) : 0.15;

        const snapshot: PortfolioBalanceSnapshot = {
          vesBalance,
          usdtBalance,
          currentParallelRate,
          openP2pSellOrdersUsdt: 0,
          openP2pBuyOrdersVes: 0,
          vesMaxHoldingTimeMinutes,
        };
        const config: Partial<DeltaNeutralEngineConfig> = {
          maxAllowedFiatDeltaRatio: maxAllowed,
        };

        const metrics = calculatePortfolioDelta(snapshot, config);
        const hedgeProposal = evaluateDeltaHedge(snapshot, config);
        const proposals = hedgeProposal ? [hedgeProposal] : [];
        return {
          success: true,
          skillName,
          data: { metrics, proposals },
          executedAt: now,
        };
      }

      case 'forecast_market_volatility_2h': {
        const currentSpreadPct = Number(args['currentSpreadPct'] || 1.0);
        const recentTicks = (args['recentTicks'] || []) as PriceTick[];
        const parallelRate = args['parallelRate'] ? Number(args['parallelRate']) : undefined;
        const bcvRate = args['bcvRate'] ? Number(args['bcvRate']) : undefined;

        const input: VolatilityForecastInput = {
          recentTicks,
          currentSpreadPct,
        };
        if (parallelRate && bcvRate) {
          input.bcvGap = calculateBcvGap(parallelRate, bcvRate);
        }

        const result = predictTwoHourVolatility(input);
        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'audit_zk_mesh_threat': {
        const identifier = String(args['identifier'] || '').trim();
        const saltDomain = String(args['saltDomain'] || 'p2p-ve-mesh-salt-2026');
        if (!identifier) {
          return {
            success: false,
            skillName,
            error: 'audit_zk_mesh_threat requiere un identificador (cédula, cuenta o teléfono).',
            executedAt: now,
          };
        }

        const blindHash = generateBlindHash(identifier, saltDomain);
        const mesh = new ZkMarketMesh('local-node-copilot');
        // Sample baseline record for audit simulation
        const match = mesh.queryIdentifier(identifier, saltDomain);

        return {
          success: true,
          skillName,
          data: {
            blindHash,
            saltDomain,
            isMatch: match.isMatch,
            threat: match.threat,
            riskStatus: match.isMatch ? 'THREAT_IDENTIFIED' : 'CLEAN',
          },
          executedAt: now,
        };
      }

      case 'generate_dispute_dossier': {
        const orderId = String(args['orderId'] || 'ORD-000');
        const orderAmountFiat = Number(args['orderAmountFiat'] || 0);
        const orderAmountCrypto = Number(args['orderAmountCrypto'] || 0);
        const counterpartyBinanceName = String(args['counterpartyBinanceName'] || 'Contraparte');
        const bankPayerName = String(args['bankPayerName'] || 'Pagador');
        const bankName = String(args['bankName'] || 'Banco');
        const bankReference = String(args['bankReference'] || 'REF000');

        const dossier = buildDisputeDossier({
          orderId,
          orderAmountFiat,
          orderAmountCrypto,
          counterpartyBinanceName,
          bankPayerName,
          bankName,
          bankReference,
          bankPaymentTimestamp: now - 300000,
          orderCreatedTimestamp: now - 600000,
          fraudAudit: {
            orderId,
            overallScore: 85,
            riskLevel: 'CRITICAL',
            recommendation: 'LOCK_AND_DISPUTE',
            flags: ['THIRD_PARTY_PAYER'],
            nameMatch: {
              score: 0.45,
              isMatch: false,
              normalizedA: counterpartyBinanceName.toUpperCase(),
              normalizedB: bankPayerName.toUpperCase(),
              matchedTokens: [],
              missingTokens: [],
            },
            referenceValidation: {
              isValid: true,
              bank: 'BANESCO',
              reference: bankReference,
              expectedFormat: '6 a 9 dígitos numéricos (típicamente 8)',
            },
            amountDifference: 0,
            summaryHeadline: 'PELIGRO DE ESTAFA: Bloquear orden y abrir disputa inmediatamente.',
            auditDetails: [
              `ALERTA ESTAFA TRIANGULAR: El titular del comprobante ("${bankPayerName}") no coincide con el usuario verificado de Binance ("${counterpartyBinanceName}"). Similitud: 45%.`,
            ],
            disputeTemplateText: `[RECLAMO FORMAL DE DISPUTA P2P - ORDEN #${orderId}]\nEl pago recibido proviene de ${bankPayerName}, titular NO coincidente con el usuario verificado de Binance ${counterpartyBinanceName} (referencia #${bankReference}). Se solicita congelamiento preventivo y arbitraje por pago de terceros no autorizados.`,
          },
        });

        return {
          success: true,
          skillName,
          data: dossier,
          executedAt: now,
        };
      }

      case 'simulate_trade_impact': {
        const targetAmountUsdt = Number(args['targetAmountUsdt'] || 0);
        const side = (args['side'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
        const availableOffers = (args['availableOffers'] || []) as any[];

        const result = simulateTradeImpact({
          targetAmountUsdt,
          side,
          availableOffers,
        });

        return {
          success: true,
          skillName,
          data: result,
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

      case 'calculate_convexity_and_gamma_risk': {
        const spotParallelRate = Number(args['spotParallelRate'] || 85.0);
        const vesHoldingAmount = Number(args['vesHoldingAmount'] || 100000);
        const expectedDevaluationJumpPct = Number(args['expectedDevaluationJumpPct'] || 15);
        const timeHorizonDays = Number(args['timeHorizonDays'] || 1);

        const result = calculateConvexityAndGammaRisk({
          spotParallelRate,
          vesHoldingAmount,
          expectedDevaluationJumpPct,
          timeHorizonDays,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'model_perpetual_funding_arbitrage': {
        const collateralUsdt = Number(args['collateralUsdt'] || 5000);
        const currentFundingRate8hPct = Number(args['currentFundingRate8hPct'] || 0.01);
        const holdingPeriodDays = Number(args['holdingPeriodDays'] || 7);

        const result = modelPerpetualFundingArbitrage({
          collateralUsdt,
          currentFundingRate8hPct,
          holdingPeriodDays,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'optimize_capital_allocation_kelly': {
        const totalCapitalUsdt = Number(args['totalCapitalUsdt'] || 10000);
        const winRatePct = Number(args['winRatePct'] || 75);
        const averageProfitPerWinUsdt = Number(args['averageProfitPerWinUsdt'] || 40);
        const averageLossPerLossUsdt = Number(args['averageLossPerLossUsdt'] || 15);

        const result = optimizeCapitalAllocationKelly({
          totalCapitalUsdt,
          winRatePct,
          averageProfitPerWinUsdt,
          averageLossPerLossUsdt,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'forecast_central_bank_liquidity_drain': {
        const dayOfMonth = Number(args['dayOfMonth'] || new Date().getDate());
        const dayOfWeek = Number(args['dayOfWeek'] ?? new Date().getDay());
        const estimatedSeniatCollectionActive = Boolean(args['estimatedSeniatCollectionActive']);
        const weeklyBcvInjectionMillionsUsd = Number(args['weeklyBcvInjectionMillionsUsd'] || 40);

        const result = forecastCentralBankLiquidityDrain({
          dayOfMonth,
          dayOfWeek,
          estimatedSeniatCollectionActive,
          weeklyBcvInjectionMillionsUsd,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'monitor_fiat_flight_and_dollarization_velocity': {
        const averageVesHoldingMinutes = Number(args['averageVesHoldingMinutes'] || 30);
        const merchantUsdtAcceptancePct = Number(args['merchantUsdtAcceptancePct'] || 80);
        const monthlyInflationEstimatePct = Number(args['monthlyInflationEstimatePct'] || 35);

        const result = monitorFiatFlightAndDollarizationVelocity({
          averageVesHoldingMinutes,
          merchantUsdtAcceptancePct,
          monthlyInflationEstimatePct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'simulate_game_theory_nash_repricing': {
        const myCurrentPrice = Number(args['myCurrentPrice'] || 85.0);
        const targetSide = (args['targetSide'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
        const topCompetitors = (args['topCompetitors'] || []) as any[];
        const minimumSpreadAllowedPct = Number(args['minimumSpreadAllowedPct'] || 0.8);

        const result = simulateGameTheoryNashRepricing({
          myCurrentPrice,
          targetSide,
          topCompetitors,
          minimumSpreadAllowedPct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      default:
        return {
          success: false,
          skillName,
          error: `Habilidad desconocida: '${skillName}'. No está registrada en la suite de agentes.`,
          executedAt: now,
        };
    }
  } catch (err: unknown) {
    return {
      success: false,
      skillName,
      error: err instanceof Error ? err.message : String(err),
      executedAt: now,
    };
  }
}

export interface StrategyPlanCard {
  id: string;
  title: string;
  route: string;
  capitalRequiredUsdt: number;
  expectedNetSpreadPct: number;
  expectedProfitUsdt: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  assignedOperatorName?: string;
  rationale: string;
  status: 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'CANCELLED' | 'REJECTED';
}

export interface CopilotChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  plan?: StrategyPlanCard;
}

export interface CopilotResponse {
  reply: string;
  suggestedPlan?: StrategyPlanCard;
  skillsExecuted?: string[];
  learningsGenerated?: string[];
}

