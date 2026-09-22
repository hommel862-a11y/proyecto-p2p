/**
 * Financial Agent Skills Hub & Function Calling Declarations.
 * Wraps pure deterministic core functions (Triangular Arbitrage, BCV Predictor,
 * Orderbook Microstructure, and Operator Manager) into structured schemas
 * for Gemini Function Calling and multi-agent execution.
 * 0 framework dependencies.
 */

import { calculateTriangularArbitrage, type ExchangeLeg } from './triangular-arbitrage';
import { getBcvMarketIntelligence, calculateBcvGap } from './bcv-intervention-predictor';
import {
  computeMicrostructureSanitizedDepth,
  OrderPersistenceTracker,
} from './orderbook-microstructure';
import type { BinanceOfferSummary } from './binance-p2p';
import {
  evaluateGoldenSpread,
  buildTeamAllocationPlan,
  type OperatorProfile,
} from './operator-manager';
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
import { ZkMarketMesh, generateBlindHash } from './zk-market-mesh';
import { buildDisputeDossier } from './dispute-copilot';
import { simulateTradeImpact } from './trade-impact-simulator';
import {
  computeAvellanedaStoikovQuotes,
  calculateVpinMetric,
  computeOrderSlicingPlan,
  calculateMakerFillProbabilityMarkov,
} from './orderbook-microstructure';
import {
  analyzeFxCorridorEfficiency,
  calculateCrossExchangeBasisSpread,
} from './triangular-arbitrage';
import {
  calculateConvexityAndGammaRisk,
  modelPerpetualFundingArbitrage,
  optimizeCapitalAllocationKelly,
} from './delta-neutral-hedge';
import {
  forecastCentralBankLiquidityDrain,
  monitorFiatFlightAndDollarizationVelocity,
  simulateGameTheoryNashRepricing,
} from './bcv-intervention-predictor';
import {
  optimizeIdleCapitalSimpleEarn,
  evaluateDualInvestmentP2pExit,
  calculateUsdtFdusdYieldArbitrage,
  modelLaunchpoolCapitalParking,
  optimizeLockedVsFlexibleLiquidityLadder,
  calculateEarnYieldVsP2pHurdleRate,
  modelBnbVaultYieldStacking,
  forecastFlexibleEarnTierSaturation,
  calculateAutoInvestDcaSpreadFunnel,
  simulateEarnInstantRedemptionLatency,
} from './binance-earn-vault';
import {
  qualifyDirectLeadAndClose,
  generateSocialTrafficFunnel,
  benchmarkCompetitorMarketIntelligence,
  orchestrateWorkspaceSync,
  executeDesktopRpaReconciliation,
  monitorServiceHealthAndFallback,
  triageIncidentAndEscalate,
  auditSopComplianceEnforcement,
  syncGoogleSheetsLiveLedger,
  forecastCashFlowAndReconciliation,
} from './operations-workflow';
import {
  analyzeHourlyRiskDistribution,
  auditTradingDisciplineAndSpreadCompliance,
  generateForensicDossier,
  type ForensicAuditEvent,
  type ForensicOperationRecord,
} from './audit-analytics';

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
    description:
      'Calcula el spread neto y viabilidad de una ruta de arbitraje triangular de 3 piernas (ej. VES -> USDT -> BTC -> VES). Deduce comisiones y fricción bancaria.',
    parameters: {
      type: 'OBJECT',
      properties: {
        initialAmount: {
          type: 'NUMBER',
          description:
            'Monto inicial a convertir en la primera pierna (ej. 1000 USDT o 80000 VES).',
        },
        initialCurrency: {
          type: 'STRING',
          description: 'Símbolo de la divisa de origen (ej. USDT, VES, COP, USD).',
        },
        legs: {
          type: 'ARRAY',
          description:
            'Arreglo exacto de 3 piernas de intercambio para completar el ciclo triangular.',
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
    description:
      'Evalúa la brecha cambiaria entre la tasa paralela P2P y la tasa oficial BCV, calculando probabilidad de intervención y directiva de tesorería macro.',
    parameters: {
      type: 'OBJECT',
      properties: {
        parallelRate: {
          type: 'NUMBER',
          description: 'Precio actual del dólar o USDT en el mercado paralelo / P2P en VES.',
        },
        bcvRate: {
          type: 'NUMBER',
          description:
            'Precio de referencia oficial publicado por el Banco Central de Venezuela en VES.',
        },
      },
      required: ['parallelRate', 'bcvRate'],
    },
  },
  {
    name: 'inspect_orderbook_liquidity',
    description:
      'Analiza la microestructura del libro de órdenes P2P, filtrando liquidez fantasma, spoofing y órdenes desactualizadas mediante profundidad Johnson sanitizada.',
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
          description:
            'Lado del libro a analizar: BUY (anuncios de compra) o SELL (anuncios de venta).',
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
    description:
      'Verifica si un spread neto cumple con la Regla de Oro institucional (mínimo 0.50% neto) para no quemar cuotas bancarias.',
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
    description:
      'Construye un plan de delegación y asignación de capital institucional para operadores P2P de la mesa de dinero.',
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
          description:
            'Lista de perfiles de operadores activos con sus splits de comisión y metas de ciclos.',
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
    description:
      'Audita la exposición neta en moneda local (VES) y propone órdenes de cobertura sintética (delta-neutral) con derivados spot/perp si se supera el riesgo de devaluación.',
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
    description:
      'Pronostica el índice de volatilidad, dirección del spread y markups recomendados de compra/venta para las próximas 2 horas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        currentSpreadPct: {
          type: 'NUMBER',
          description: 'Spread actual de mercado en porcentaje (ej. 1.20).',
        },
        recentTicks: {
          type: 'ARRAY',
          description:
            'Muestra de precios recientes con timestamp, precio de compra y precio de venta.',
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
    description:
      'Audita identificadores sensibles (cédula, RIF, teléfono, cuenta bancaria) contra la red ZK de inteligencia antifraude usando hashes ciegos con salt.',
    parameters: {
      type: 'OBJECT',
      properties: {
        identifier: {
          type: 'STRING',
          description:
            'Cédula de identidad, RIF, número telefónico o número de cuenta de la contraparte.',
        },
        saltDomain: {
          type: 'STRING',
          description:
            'Dominio de sal opcional para el hash ciego (default estándar p2p-ve-mesh-salt-2026).',
        },
      },
      required: ['identifier'],
    },
  },
  {
    name: 'generate_dispute_dossier',
    description:
      'Construye un expediente formal y arbitral bilingüe (español/inglés) para mediar en disputas P2P de Binance por pagos de terceros o discrepancias.',
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
      required: [
        'orderId',
        'orderAmountFiat',
        'orderAmountCrypto',
        'counterpartyBinanceName',
        'bankPayerName',
        'bankName',
        'bankReference',
      ],
    },
  },
  {
    name: 'simulate_trade_impact',
    description:
      'Simula el llenado real de una orden P2P a través de múltiples niveles del libro: calcula precio VWAP, deslizamiento en bps y probabilidad de llenado según la reputación del comerciante.',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetAmountUsdt: {
          type: 'NUMBER',
          description: 'Volumen objetivo en USDT que se desea comprar o vender.',
        },
        side: {
          type: 'STRING',
          description:
            'Lado de la operación: BUY (comprar cripto con fiat) o SELL (vender cripto por fiat).',
          enum: ['BUY', 'SELL'],
        },
        availableOffers: {
          type: 'ARRAY',
          description:
            'Lista de anuncios del libro P2P con precios, montos disponibles y tasas de finalización.',
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
    description:
      'Divide un bloque institucional grande en micro-lotes TWAP/VWAP para minimizar el impacto de mercado y prevenir front-running.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalAmountUsdt: { type: 'NUMBER', description: 'Volumen institucional total a ejecutar.' },
        executionDurationMinutes: {
          type: 'NUMBER',
          description: 'Duración total de ejecución en minutos.',
        },
        estimatedMarketVolumePerHourUsdt: {
          type: 'NUMBER',
          description: 'Volumen horario estimado del mercado.',
        },
        currentMidPrice: { type: 'NUMBER', description: 'Precio medio actual.' },
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
        queuePositionIndex: { type: 'INTEGER', description: 'Posición en la cola (0 = punta).' },
        queueAheadVolumeUsdt: { type: 'NUMBER', description: 'Volumen por delante en el libro.' },
        recentFillVelocityPerMinuteUsdt: {
          type: 'NUMBER',
          description: 'Velocidad de absorción del mercado en USDT/min.',
        },
        targetHorizonMinutes: {
          type: 'NUMBER',
          description: 'Horizonte temporal evaluado en minutos.',
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
    description:
      'Detecta oportunidades de arbitraje espacial de base entre distintas plataformas P2P (Binance, Bybit, El Dorado).',
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
    description:
      'Modela la pérdida patrimonial acelerada por riesgo de convexidad y efecto Gamma ante saltos devaluatorios no lineales del tipo de cambio.',
    parameters: {
      type: 'OBJECT',
      properties: {
        spotParallelRate: { type: 'NUMBER', description: 'Tasa paralela actual.' },
        vesHoldingAmount: { type: 'NUMBER', description: 'Monto de bolívares en cartera.' },
        expectedDevaluationJumpPct: {
          type: 'NUMBER',
          description: 'Salto devaluatorio proyectado en porcentaje.',
        },
        timeHorizonDays: { type: 'NUMBER', description: 'Días de exposición proyectados.' },
      },
      required: [
        'spotParallelRate',
        'vesHoldingAmount',
        'expectedDevaluationJumpPct',
        'timeHorizonDays',
      ],
    },
  },
  {
    name: 'model_perpetual_funding_arbitrage',
    description:
      'Calcula el rendimiento APY del arbitraje de Funding Rate en derivados perpetuos (Cash-and-Carry) para subsidiar tesorería.',
    parameters: {
      type: 'OBJECT',
      properties: {
        collateralUsdt: { type: 'NUMBER', description: 'Colateral en USDT disponible.' },
        currentFundingRate8hPct: {
          type: 'NUMBER',
          description: 'Tasa de financiamiento por 8h en porcentaje.',
        },
        holdingPeriodDays: {
          type: 'NUMBER',
          description: 'Días estimados de mantenimiento de posición.',
        },
      },
      required: ['collateralUsdt', 'currentFundingRate8hPct', 'holdingPeriodDays'],
    },
  },
  {
    name: 'optimize_capital_allocation_kelly',
    description:
      'Optimiza el tamaño del ticket y distribución por entidad bancaria mediante el Criterio Fraccional de Kelly.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalCapitalUsdt: { type: 'NUMBER', description: 'Capital total de la tesorería en USDT.' },
        winRatePct: {
          type: 'NUMBER',
          description: 'Tasa de acierto histórica en operaciones P2P.',
        },
        averageProfitPerWinUsdt: {
          type: 'NUMBER',
          description: 'Ganancia promedio por trade ganador.',
        },
        averageLossPerLossUsdt: {
          type: 'NUMBER',
          description: 'Pérdida promedio por trade adverso.',
        },
      },
      required: [
        'totalCapitalUsdt',
        'winRatePct',
        'averageProfitPerWinUsdt',
        'averageLossPerLossUsdt',
      ],
    },
  },
  {
    name: 'forecast_central_bank_liquidity_drain',
    description:
      'Modela el impacto macro del drenaje de liquidez interbancaria (recaudación fiscal SENIAT y subastas BCV) sobre la demanda P2P.',
    parameters: {
      type: 'OBJECT',
      properties: {
        dayOfMonth: { type: 'INTEGER', description: 'Día del mes (1 a 31).' },
        dayOfWeek: { type: 'INTEGER', description: 'Día de la semana (0=Dom, 1=Lun).' },
        estimatedSeniatCollectionActive: {
          type: 'BOOLEAN',
          description: 'Indica si hay recaudación especial activa.',
        },
        weeklyBcvInjectionMillionsUsd: {
          type: 'NUMBER',
          description: 'Monto de la inyección semanal del BCV en millones USD.',
        },
      },
      required: [
        'dayOfMonth',
        'dayOfWeek',
        'estimatedSeniatCollectionActive',
        'weeklyBcvInjectionMillionsUsd',
      ],
    },
  },
  {
    name: 'monitor_fiat_flight_and_dollarization_velocity',
    description:
      'Mide la velocidad de repudio de la moneda local (MV=PY) y determina el umbral máximo seguro de tenencia de saldos en VES.',
    parameters: {
      type: 'OBJECT',
      properties: {
        averageVesHoldingMinutes: {
          type: 'NUMBER',
          description: 'Tiempo promedio que los comercios retienen bolívares.',
        },
        merchantUsdtAcceptancePct: {
          type: 'NUMBER',
          description: 'Porcentaje de penetración de USDT.',
        },
        monthlyInflationEstimatePct: {
          type: 'NUMBER',
          description: 'Inflación mensual estimada en porcentaje.',
        },
      },
      required: [
        'averageVesHoldingMinutes',
        'merchantUsdtAcceptancePct',
        'monthlyInflationEstimatePct',
      ],
    },
  },
  {
    name: 'simulate_game_theory_nash_repricing',
    description:
      'Simula el Equilibrio de Nash entre los creadores de mercado líderes para fijar un precio Maker sin desatar guerras de subcotización.',
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
  {
    name: 'optimize_idle_capital_simple_earn',
    description:
      'Modela y optimiza el rendimiento del capital inactivo en Binance Simple Earn Flexible (tasa APR base + bonus por tramos hasta 500 USDT/FDUSD) para evitar costo de oportunidad de inventario detenido.',
    parameters: {
      type: 'OBJECT',
      properties: {
        capitalUsdt: {
          type: 'NUMBER',
          description: 'Monto total en USDT a colocar en Simple Earn.',
        },
        tier1LimitUsdt: {
          type: 'NUMBER',
          description: 'Límite del tramo promocional Tier 1 (default 500 USDT).',
        },
        tier1AprPct: {
          type: 'NUMBER',
          description: 'Tasa APR del Tier 1 en porcentaje (ej. 10.0).',
        },
        tier2AprPct: {
          type: 'NUMBER',
          description: 'Tasa APR base para excedentes en porcentaje (ej. 2.0).',
        },
        holdingDays: { type: 'NUMBER', description: 'Días proyectados de retención.' },
      },
      required: ['capitalUsdt', 'tier1AprPct', 'tier2AprPct'],
    },
  },
  {
    name: 'evaluate_dual_investment_p2p_exit',
    description:
      'Evalúa la estrategia "Sell High" en Binance Dual Investment para fijar salidas con strike price por encima del spot mientras se captura un APR elevado, cubriendo inventario ocioso.',
    parameters: {
      type: 'OBJECT',
      properties: {
        currentSpotPrice: { type: 'NUMBER', description: 'Precio actual spot del criptoactivo.' },
        strikePrice: { type: 'NUMBER', description: 'Precio objetivo de salida (strike price).' },
        durationDays: {
          type: 'NUMBER',
          description: 'Duración del producto estructurado en días.',
        },
        annualizedAprPct: {
          type: 'NUMBER',
          description: 'Tasa APR anualizada del producto (ej. 25.0).',
        },
        investedCapitalUsdt: { type: 'NUMBER', description: 'Capital colocado en el contrato.' },
      },
      required: [
        'currentSpotPrice',
        'strikePrice',
        'durationDays',
        'annualizedAprPct',
        'investedCapitalUsdt',
      ],
    },
  },
  {
    name: 'calculate_usdt_fdusd_yield_arbitrage',
    description:
      'Compara el APR y la paridad de tipos entre USDT y FDUSD en Binance Earn para maximizar el carry de tesorería y determinar breakeven de conversión.',
    parameters: {
      type: 'OBJECT',
      properties: {
        usdtBalance: { type: 'NUMBER', description: 'Saldo en USDT.' },
        fdusdBalance: { type: 'NUMBER', description: 'Saldo en FDUSD.' },
        usdtFlexibleAprPct: { type: 'NUMBER', description: 'APR flexible de USDT en porcentaje.' },
        fdusdFlexibleAprPct: {
          type: 'NUMBER',
          description: 'APR flexible de FDUSD en porcentaje.',
        },
        usdtFdusdMarketRate: {
          type: 'NUMBER',
          description: 'Tasa de cambio de mercado USDT/FDUSD (ej. 1.0001).',
        },
        swapFeePct: {
          type: 'NUMBER',
          description: 'Comisión de swap spot en porcentaje (0 si hay promo).',
        },
        plannedHorizonDays: {
          type: 'NUMBER',
          description: 'Horizonte de inversión planificado en días.',
        },
      },
      required: ['usdtBalance', 'fdusdBalance', 'usdtFlexibleAprPct', 'fdusdFlexibleAprPct'],
    },
  },
  {
    name: 'model_launchpool_capital_parking',
    description:
      'Modela el rendimiento esperado de stakear BNB, FDUSD o USDT en Launchpool durante pausas operativas del P2P para capturar tokens nuevos y proyectar el APY implícito.',
    parameters: {
      type: 'OBJECT',
      properties: {
        capitalUsdt: {
          type: 'NUMBER',
          description: 'Capital a stakear en USDT o valor equivalente.',
        },
        stakedAsset: {
          type: 'STRING',
          enum: ['BNB', 'FDUSD', 'USDT'],
          description: 'Activo a stakear.',
        },
        launchpoolDurationDays: {
          type: 'NUMBER',
          description: 'Duración total del Launchpool en días.',
        },
        totalPoolStaked: {
          type: 'NUMBER',
          description: 'Monto total stakeado en el pool por todos los participantes.',
        },
        dailyRewardPoolTokens: {
          type: 'NUMBER',
          description: 'Tokens distribuidos por día en el pool.',
        },
        estimatedTokenListingPriceUsdt: {
          type: 'NUMBER',
          description: 'Precio estimado de listado del nuevo token.',
        },
        alternativeEarnAprPct: { type: 'NUMBER', description: 'Tasa alternativa en Simple Earn.' },
      },
      required: [
        'capitalUsdt',
        'stakedAsset',
        'launchpoolDurationDays',
        'totalPoolStaked',
        'dailyRewardPoolTokens',
        'estimatedTokenListingPriceUsdt',
      ],
    },
  },
  {
    name: 'optimize_locked_vs_flexible_liquidity_ladder',
    description:
      'Construye una escalera de liquidez dividiendo el capital entre Simple Earn Flexible (D+0 para atender picos de órdenes P2P) y tramos locked para maximizar APR sin estrangular liquidez.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalTreasuryUsdt: { type: 'NUMBER', description: 'Tesorería total en USDT.' },
        dailyP2pVolumeUsdt: {
          type: 'NUMBER',
          description: 'Volumen diario promedio operado en P2P.',
        },
        p2pTurnoverDays: {
          type: 'NUMBER',
          description: 'Días promedio de ciclo de rotación completa.',
        },
        flexibleAprPct: { type: 'NUMBER', description: 'APR del producto flexible.' },
        locked30dAprPct: { type: 'NUMBER', description: 'APR del producto bloqueado a 30 días.' },
        locked60dAprPct: { type: 'NUMBER', description: 'APR del producto bloqueado a 60 días.' },
        safetyBufferPct: {
          type: 'NUMBER',
          description: 'Margen de seguridad porcentual sobre el volumen operativo.',
        },
      },
      required: [
        'totalTreasuryUsdt',
        'dailyP2pVolumeUsdt',
        'p2pTurnoverDays',
        'flexibleAprPct',
        'locked30dAprPct',
        'locked60dAprPct',
      ],
    },
  },
  {
    name: 'calculate_earn_yield_vs_p2p_hurdle_rate',
    description:
      'Calcula la tasa de corte (Hurdle Rate) comparando el rendimiento por hora del spread neto P2P contra el rendimiento pasivo libre de riesgo de Binance Simple Earn.',
    parameters: {
      type: 'OBJECT',
      properties: {
        grossP2pSpreadPct: {
          type: 'NUMBER',
          description: 'Spread bruto observado en el libro P2P.',
        },
        platformFeePct: { type: 'NUMBER', description: 'Comisión del exchange P2P.' },
        bankingRiskPremiumPct: {
          type: 'NUMBER',
          description: 'Prima por fricción bancaria y comisiones de transferencia.',
        },
        fxDevaluationRiskPct: {
          type: 'NUMBER',
          description: 'Riesgo devaluatorio estimado durante el ciclo.',
        },
        averageTradeCycleHours: {
          type: 'NUMBER',
          description: 'Horas promedio que toma completar un ciclo compra-venta.',
        },
        simpleEarnAprPct: {
          type: 'NUMBER',
          description: 'Tasa APR pasiva libre de riesgo en Binance Simple Earn.',
        },
      },
      required: [
        'grossP2pSpreadPct',
        'platformFeePct',
        'bankingRiskPremiumPct',
        'fxDevaluationRiskPct',
        'averageTradeCycleHours',
        'simpleEarnAprPct',
      ],
    },
  },
  {
    name: 'model_bnb_vault_yield_stacking',
    description:
      'Modela la acumulación de recompensas multi-capa en BNB Vault (Launchpool automático, Simple Earn Flexible y airdrops de HODLer).',
    parameters: {
      type: 'OBJECT',
      properties: {
        bnbAmount: { type: 'NUMBER', description: 'Cantidad total de BNB en tenencia.' },
        bnbPriceUsdt: { type: 'NUMBER', description: 'Precio actual del BNB en USDT.' },
        simpleEarnAprPct: {
          type: 'NUMBER',
          description: 'APR base de Simple Earn Flexible para BNB.',
        },
        activeLaunchpoolsCount: {
          type: 'NUMBER',
          description: 'Cantidad de Launchpools activos concurrentes.',
        },
        averageLaunchpoolAprPct: {
          type: 'NUMBER',
          description: 'APR promedio histórico de Launchpool.',
        },
        hodlerAirdropProjectedAprPct: {
          type: 'NUMBER',
          description: 'APR proyectado por airdrops a poseedores.',
        },
      },
      required: [
        'bnbAmount',
        'bnbPriceUsdt',
        'simpleEarnAprPct',
        'activeLaunchpoolsCount',
        'averageLaunchpoolAprPct',
      ],
    },
  },
  {
    name: 'forecast_flexible_earn_tier_saturation',
    description:
      'Predice el punto de saturación y degradación del APR en Simple Earn Flexible cuando el balance supera los tramos subvencionados, recomendando dispersión a subcuentas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalCapitalUsdt: { type: 'NUMBER', description: 'Capital total a colocar.' },
        tier1LimitPerAccountUsdt: {
          type: 'NUMBER',
          description: 'Límite Tier 1 por cuenta (ej. 500 USDT).',
        },
        tier1AprPct: { type: 'NUMBER', description: 'APR promocional Tier 1.' },
        tier2AprPct: { type: 'NUMBER', description: 'APR degradado Tier 2.' },
        availableSubaccountsCount: {
          type: 'NUMBER',
          description: 'Número de subcuentas corporativas disponibles.',
        },
      },
      required: ['totalCapitalUsdt', 'tier1AprPct', 'tier2AprPct'],
    },
  },
  {
    name: 'calculate_auto_invest_dca_spread_funnel',
    description:
      'Diseña un embudo de reinversión automática (Auto-Invest DCA) utilizando las ganancias netas del spread P2P para acumular criptoactivos sin descapitalizar la tesorería operativa.',
    parameters: {
      type: 'OBJECT',
      properties: {
        monthlyP2pNetProfitUsdt: {
          type: 'NUMBER',
          description: 'Beneficio neto mensual generado por la mesa P2P.',
        },
        reinvestmentRatioPct: {
          type: 'NUMBER',
          description: 'Porcentaje de la ganancia a reinvertir (ej. 25%).',
        },
        targetAsset: {
          type: 'STRING',
          enum: ['BTC', 'ETH', 'BNB', 'SOL'],
          description: 'Activo objetivo de acumulación.',
        },
        projectedAnnualAssetGrowthPct: {
          type: 'NUMBER',
          description: 'Crecimiento anual proyectado del activo.',
        },
        executionFrequency: {
          type: 'STRING',
          enum: ['DAILY', 'WEEKLY', 'BIWEEKLY'],
          description: 'Frecuencia de DCA en Auto-Invest.',
        },
      },
      required: [
        'monthlyP2pNetProfitUsdt',
        'reinvestmentRatioPct',
        'targetAsset',
        'executionFrequency',
      ],
    },
  },
  {
    name: 'simulate_earn_instant_redemption_latency',
    description:
      'Simula el impacto temporal y límites de retiro inmediato (Instant Redemption Quota) en Binance Simple Earn para asegurar disponibilidad antes de liberar órdenes P2P.',
    parameters: {
      type: 'OBJECT',
      properties: {
        redemptionAmountUsdt: {
          type: 'NUMBER',
          description: 'Monto que se necesita retirar de Simple Earn.',
        },
        dailyInstantQuotaUsdt: {
          type: 'NUMBER',
          description: 'Límite diario de rescate instantáneo de la cuenta.',
        },
        dailyQuotaConsumedUsdt: {
          type: 'NUMBER',
          description: 'Cuota instantánea ya utilizada en las últimas 24h.',
        },
        averageSlippageOrDelayHours: {
          type: 'NUMBER',
          description: 'Tiempo estimado de demora en caso de standard redemption.',
        },
      },
      required: ['redemptionAmountUsdt'],
    },
  },
  {
    name: 'qualify_direct_lead_and_close',
    description:
      'Califica prospectos comerciales de WhatsApp/Telegram (ticket, frecuencia, verificación KYC y objeciones) y genera la cotización personalizada con margen institucional.',
    parameters: {
      type: 'OBJECT',
      properties: {
        leadChannel: {
          type: 'STRING',
          enum: ['WHATSAPP', 'TELEGRAM', 'INSTAGRAM_DM'],
          description: 'Canal de entrada del prospecto.',
        },
        estimatedWeeklyVolumeUsdt: {
          type: 'NUMBER',
          description: 'Volumen semanal estimado en USDT.',
        },
        paymentMethodPreferred: { type: 'STRING', description: 'Método de pago preferido.' },
        isKycVerified: {
          type: 'BOOLEAN',
          description: 'Si el cliente ya entregó documento de identidad verificado.',
        },
        primaryConcern: {
          type: 'STRING',
          enum: ['PRICE', 'SECURITY', 'SPEED', 'PAYMENT_LIMITS'],
          description: 'Principal objeción o prioridad del cliente.',
        },
        currentParallelRate: {
          type: 'NUMBER',
          description: 'Tasa de cambio paralela spot en VES.',
        },
      },
      required: [
        'leadChannel',
        'estimatedWeeklyVolumeUsdt',
        'paymentMethodPreferred',
        'isKycVerified',
        'primaryConcern',
        'currentParallelRate',
      ],
    },
  },
  {
    name: 'generate_social_traffic_funnel',
    description:
      'Diseña guiones y contenido educativo de arbitraje y resguardo contra la inflación para redes sociales, orientando tráfico orgánico a la mesa P2P.',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetAudience: {
          type: 'STRING',
          enum: ['RETAIL_SAVERS', 'MERCHANT_IMPORTERS', 'P2P_ARBITRAGEURS'],
          description: 'Audiencia objetivo.',
        },
        platform: {
          type: 'STRING',
          enum: ['INSTAGRAM', 'TIKTOK', 'TWITTER_X'],
          description: 'Plataforma social de publicación.',
        },
        currentBcvGapPct: { type: 'NUMBER', description: 'Brecha actual del BCV en porcentaje.' },
        educationalTheme: {
          type: 'STRING',
          enum: ['INFLATION_HEDGE', 'TRIANGULATION_BASICS', 'AVOID_BANK_FREEZES'],
          description: 'Eje temático.',
        },
      },
      required: ['targetAudience', 'platform', 'currentBcvGapPct', 'educationalTheme'],
    },
  },
  {
    name: 'benchmark_competitor_market_intelligence',
    description:
      'Rastrea y compara precios, métodos de pago y calidad de servicio de competidores activos para optimizar el spread y encontrar nichos desatendidos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ourCurrentPrice: { type: 'NUMBER', description: 'Nuestro precio actual en el libro.' },
        targetSide: { type: 'STRING', enum: ['BUY', 'SELL'], description: 'Lado del libro.' },
        ourMinMarginPct: {
          type: 'NUMBER',
          description: 'Margen mínimo tolerado por la regla de oro.',
        },
        competitorOffers: {
          type: 'ARRAY',
          description: 'Lista de ofertas de competidores en el libro.',
          items: { type: 'OBJECT', description: 'Oferta competidora.' },
        },
      },
      required: ['ourCurrentPrice', 'targetSide', 'ourMinMarginPct', 'competitorOffers'],
    },
  },
  {
    name: 'orchestrate_workspace_sync',
    description:
      'Prepara y formatea cargas de eventos e incidencias críticas para sincronización con Notion, ClickUp o Trello mediante webhooks modulares.',
    parameters: {
      type: 'OBJECT',
      properties: {
        entityType: {
          type: 'STRING',
          enum: ['ORDER', 'DISPUTE', 'BANK_INCIDENT', 'SOP_VIOLATION'],
          description: 'Tipo de entidad operativa.',
        },
        referenceId: { type: 'STRING', description: 'Identificador único de la entidad.' },
        urgencyLevel: {
          type: 'STRING',
          enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
          description: 'Nivel de urgencia.',
        },
        operatorAssigned: {
          type: 'STRING',
          description: 'Nombre del operador o agente responsable.',
        },
        summaryText: { type: 'STRING', description: 'Resumen descriptivo del evento.' },
      },
      required: ['entityType', 'referenceId', 'urgencyLevel', 'operatorAssigned', 'summaryText'],
    },
  },
  {
    name: 'execute_desktop_rpa_reconciliation',
    description:
      'Concilia de forma automatizada (RPA) extractos bancarios contra órdenes P2P registradas para detectar discrepancias de montos y depósitos huérfanos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        bankName: { type: 'STRING', description: 'Nombre de la entidad bancaria.' },
        rawBankStatements: {
          type: 'ARRAY',
          description: 'Movimientos bancarios extraídos.',
          items: { type: 'OBJECT', description: 'Línea de extracto bancario.' },
        },
        registeredP2pOrders: {
          type: 'ARRAY',
          description: 'Órdenes P2P registradas en el sistema.',
          items: { type: 'OBJECT', description: 'Orden P2P esperada.' },
        },
      },
      required: ['bankName', 'rawBankStatements', 'registeredP2pOrders'],
    },
  },
  {
    name: 'monitor_service_health_and_fallback',
    description:
      'Supervisa la salud de sockets, base de datos y APIs bancarias, activando fallbacks preventivos si se degradan los parámetros de operación.',
    parameters: {
      type: 'OBJECT',
      properties: {
        webSocketLatencyMs: {
          type: 'NUMBER',
          description: 'Latencia del WebSocket en milisegundos.',
        },
        bankApiUptimePct: {
          type: 'NUMBER',
          description: 'Disponibilidad de APIs bancarias en porcentaje.',
        },
        dbQueryResponseTimeMs: {
          type: 'NUMBER',
          description: 'Tiempo de respuesta de base de datos en ms.',
        },
        unresolvedErrorsCount: {
          type: 'INTEGER',
          description: 'Cantidad de errores no resueltos acumulados.',
        },
      },
      required: [
        'webSocketLatencyMs',
        'bankApiUptimePct',
        'dbQueryResponseTimeMs',
        'unresolvedErrorsCount',
      ],
    },
  },
  {
    name: 'triage_incident_and_escalate',
    description:
      'Clasifica incidencias y crisis operativas (P1 a P4), calcula SLAs de resolución y activa protocolos de aislamiento e intervención humana.',
    parameters: {
      type: 'OBJECT',
      properties: {
        incidentType: {
          type: 'STRING',
          enum: [
            'BANK_ACCOUNT_HOLD',
            'THIRD_PARTY_PAYMENT',
            'PARTIAL_PAYMENT_FRAUD',
            'APP_LATENCY_DELAY',
          ],
          description: 'Naturaleza de la incidencia.',
        },
        amountAtRiskUsdt: { type: 'NUMBER', description: 'Capital total en riesgo en USDT.' },
        orderId: { type: 'STRING', description: 'ID de la orden afectada si aplica.' },
      },
      required: ['incidentType', 'amountAtRiskUsdt'],
    },
  },
  {
    name: 'audit_sop_compliance_enforcement',
    description:
      'Audita el cumplimiento estricto de Protocolos Operativos Estándar (verificación de titular, comprobación en saldo disponible y tiempos de respuesta).',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'ID de la orden a auditar.' },
        accountHolderMatchesDocument: {
          type: 'BOOLEAN',
          description: 'Si el titular bancario coincide con la cuenta verificada.',
        },
        bankBalanceConfirmedInAvailableFunds: {
          type: 'BOOLEAN',
          description: 'Si el dinero está disponible y no retenido/diferido.',
        },
        responseTimeMinutes: {
          type: 'NUMBER',
          description: 'Minutos transcurridos hasta la atención.',
        },
        fundsReleasedBeforeBankVerification: {
          type: 'BOOLEAN',
          description: 'Si los fondos fueron liberados antes de verificar en banco.',
        },
      },
      required: [
        'orderId',
        'accountHolderMatchesDocument',
        'bankBalanceConfirmedInAvailableFunds',
        'responseTimeMinutes',
        'fundsReleasedBeforeBankVerification',
      ],
    },
  },
  {
    name: 'sync_google_sheets_live_ledger',
    description:
      'Formatea registros transaccionales para Google Sheets / Excel con fórmulas dinámicas de margen neto, comisiones y balances en tiempo real.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tradeDate: { type: 'STRING', description: 'Fecha de la operación (YYYY-MM-DD).' },
        orderId: { type: 'STRING', description: 'Número de orden.' },
        counterpartyAlias: { type: 'STRING', description: 'Alias de la contraparte.' },
        tradeType: { type: 'STRING', enum: ['BUY', 'SELL'], description: 'Tipo de operación.' },
        cryptoAmountUsdt: { type: 'NUMBER', description: 'Monto de cripto en USDT.' },
        fiatAmountVes: { type: 'NUMBER', description: 'Monto en bolívares fiat.' },
        exchangeRate: { type: 'NUMBER', description: 'Tasa pactada de cambio.' },
        platformFeeUsdt: { type: 'NUMBER', description: 'Comisión del exchange en USDT.' },
        bankTransferFeeVes: { type: 'NUMBER', description: 'Comisión bancaria en bolívares.' },
      },
      required: [
        'tradeDate',
        'orderId',
        'counterpartyAlias',
        'tradeType',
        'cryptoAmountUsdt',
        'fiatAmountVes',
        'exchangeRate',
        'platformFeeUsdt',
        'bankTransferFeeVes',
      ],
    },
  },
  {
    name: 'forecast_cash_flow_and_reconciliation',
    description:
      'Concilia balances fiat y cripto, detecta descuadres por comisiones bancarias y proyecta días de runway de tesorería para recompras de inventario.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fiatBankBalancesTotalUsdtEquiv: {
          type: 'NUMBER',
          description: 'Balance en bancos equivalente a USDT.',
        },
        cryptoExchangeBalancesUsdt: {
          type: 'NUMBER',
          description: 'Saldo en billeteras de exchange en USDT.',
        },
        pendingUnsettledOrdersUsdt: {
          type: 'NUMBER',
          description: 'Monto en órdenes pendientes de liquidar.',
        },
        dailyProjectedVolumeUsdt: {
          type: 'NUMBER',
          description: 'Volumen diario promedio proyectado.',
        },
        averageOperationalExpensesDailyUsdt: {
          type: 'NUMBER',
          description: 'Gasto operativo diario promedio.',
        },
      },
      required: [
        'fiatBankBalancesTotalUsdtEquiv',
        'cryptoExchangeBalancesUsdt',
        'pendingUnsettledOrdersUsdt',
        'dailyProjectedVolumeUsdt',
        'averageOperationalExpensesDailyUsdt',
      ],
    },
  },
  {
    name: 'audit_and_risk_analytics',
    description:
      'Interroga el registro forense en SQLite para auditar disciplina de trading, cumplimiento de la Regla de Oro (spread neto >= 0.50%), detector de tilt y ventana horaria de mayor riesgo de alertas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        timeframeDays: {
          type: 'NUMBER',
          description: 'Ventana de días hacia atrás a auditar (por defecto 7 días).',
        },
        minSpreadThresholdPct: {
          type: 'NUMBER',
          description:
            'Umbral mínimo de spread neto exigido por la Regla de Oro (por defecto 0.50%).',
        },
        focusArea: {
          type: 'STRING',
          enum: ['ALL', 'RISK_HOURS', 'SPREAD_COMPLIANCE'],
          description: 'Área de enfoque del análisis forense.',
        },
        sampleEvents: {
          type: 'ARRAY',
          description: 'Eventos de auditoría opcionales para análisis directo.',
          items: {
            type: 'OBJECT',
            description: 'Evento con timestamp, severidad y acción.',
          },
        },
        sampleOperations: {
          type: 'ARRAY',
          description: 'Operaciones comerciales opcionales para auditar cumplimiento de spread.',
          items: {
            type: 'OBJECT',
            description: 'Operación con timestamp, netSpreadPct o cryptoAmount.',
          },
        },
      },
      required: ['timeframeDays', 'minSpreadThresholdPct'],
    },
  },
];

/**
 * Deterministic dispatcher: safely maps a tool invocation to its corresponding core domain logic.
 */
export function executeFinancialSkill(
  skillName: string,
  args: Record<string, unknown>,
): FinancialSkillResult {
  const now = Date.now();
  try {
    switch (skillName) {
      case 'scan_triangular_arbitrage': {
        const initialAmount = Number(args['initialAmount']);
        const legs = args['legs'] as [ExchangeLeg, ExchangeLeg, ExchangeLeg];
        if (!initialAmount || !Array.isArray(legs) || legs.length !== 3) {
          return {
            success: false,
            skillName,
            error:
              'scan_triangular_arbitrage requiere initialAmount y un arreglo de 3 piernas (legs).',
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
        const targetVolumeUsdt =
          args['targetVolumeUsdt'] !== undefined ? Number(args['targetVolumeUsdt']) : 1000;
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
            error:
              'build_operator_allocation_plan requiere deskCapitalUsdt, referenceRateVes y lista de operators.',
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
        const maxAllowed = args['maxAllowedFiatDeltaRatio']
          ? Number(args['maxAllowedFiatDeltaRatio'])
          : 0.15;

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
        const estimatedMarketVolumePerHourUsdt = Number(
          args['estimatedMarketVolumePerHourUsdt'] || 50000,
        );
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
        const recentFillVelocityPerMinuteUsdt = Number(
          args['recentFillVelocityPerMinuteUsdt'] || 100,
        );
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

      case 'optimize_idle_capital_simple_earn': {
        const capitalUsdt = Number(args['capitalUsdt'] || 0);
        const tier1LimitUsdt =
          args['tier1LimitUsdt'] !== undefined ? Number(args['tier1LimitUsdt']) : 500;
        const tier1AprPct = Number(args['tier1AprPct'] || 10.0);
        const tier2AprPct = Number(args['tier2AprPct'] || 2.0);
        const holdingDays = args['holdingDays'] !== undefined ? Number(args['holdingDays']) : 30;

        const result = optimizeIdleCapitalSimpleEarn({
          capitalUsdt,
          tier1LimitUsdt,
          tier1AprPct,
          tier2AprPct,
          holdingDays,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'evaluate_dual_investment_p2p_exit': {
        const currentSpotPrice = Number(args['currentSpotPrice'] || 65000);
        const strikePrice = Number(args['strikePrice'] || 68000);
        const durationDays = Number(args['durationDays'] || 7);
        const annualizedAprPct = Number(args['annualizedAprPct'] || 20.0);
        const investedCapitalUsdt = Number(args['investedCapitalUsdt'] || 1000);

        const result = evaluateDualInvestmentP2pExit({
          currentSpotPrice,
          strikePrice,
          durationDays,
          annualizedAprPct,
          investedCapitalUsdt,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'calculate_usdt_fdusd_yield_arbitrage': {
        const usdtBalance = Number(args['usdtBalance'] || 0);
        const fdusdBalance = Number(args['fdusdBalance'] || 0);
        const usdtFlexibleAprPct = Number(args['usdtFlexibleAprPct'] || 2.5);
        const fdusdFlexibleAprPct = Number(args['fdusdFlexibleAprPct'] || 7.0);
        const usdtFdusdMarketRate =
          args['usdtFdusdMarketRate'] !== undefined ? Number(args['usdtFdusdMarketRate']) : 1.0;
        const swapFeePct = args['swapFeePct'] !== undefined ? Number(args['swapFeePct']) : 0;
        const plannedHorizonDays =
          args['plannedHorizonDays'] !== undefined ? Number(args['plannedHorizonDays']) : 30;

        const result = calculateUsdtFdusdYieldArbitrage({
          usdtBalance,
          fdusdBalance,
          usdtFlexibleAprPct,
          fdusdFlexibleAprPct,
          usdtFdusdMarketRate,
          swapFeePct,
          plannedHorizonDays,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'model_launchpool_capital_parking': {
        const capitalUsdt = Number(args['capitalUsdt'] || 0);
        const stakedAsset = (
          args['stakedAsset'] === 'BNB' || args['stakedAsset'] === 'FDUSD'
            ? args['stakedAsset']
            : 'USDT'
        ) as 'BNB' | 'FDUSD' | 'USDT';
        const launchpoolDurationDays = Number(args['launchpoolDurationDays'] || 4);
        const totalPoolStaked = Number(args['totalPoolStaked'] || 100000000);
        const dailyRewardPoolTokens = Number(args['dailyRewardPoolTokens'] || 200000);
        const estimatedTokenListingPriceUsdt = Number(
          args['estimatedTokenListingPriceUsdt'] || 2.0,
        );
        const alternativeEarnAprPct =
          args['alternativeEarnAprPct'] !== undefined ? Number(args['alternativeEarnAprPct']) : 2.5;

        const result = modelLaunchpoolCapitalParking({
          capitalUsdt,
          stakedAsset,
          launchpoolDurationDays,
          totalPoolStaked,
          dailyRewardPoolTokens,
          estimatedTokenListingPriceUsdt,
          alternativeEarnAprPct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'optimize_locked_vs_flexible_liquidity_ladder': {
        const totalTreasuryUsdt = Number(args['totalTreasuryUsdt'] || 0);
        const dailyP2pVolumeUsdt = Number(args['dailyP2pVolumeUsdt'] || 0);
        const p2pTurnoverDays = Number(args['p2pTurnoverDays'] || 1);
        const flexibleAprPct = Number(args['flexibleAprPct'] || 2.5);
        const locked30dAprPct = Number(args['locked30dAprPct'] || 5.0);
        const locked60dAprPct = Number(args['locked60dAprPct'] || 7.5);
        const safetyBufferPct =
          args['safetyBufferPct'] !== undefined ? Number(args['safetyBufferPct']) : 30;

        const result = optimizeLockedVsFlexibleLiquidityLadder({
          totalTreasuryUsdt,
          dailyP2pVolumeUsdt,
          p2pTurnoverDays,
          flexibleAprPct,
          locked30dAprPct,
          locked60dAprPct,
          safetyBufferPct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'calculate_earn_yield_vs_p2p_hurdle_rate': {
        const grossP2pSpreadPct = Number(args['grossP2pSpreadPct'] || 1.5);
        const platformFeePct = Number(args['platformFeePct'] || 0.1);
        const bankingRiskPremiumPct = Number(args['bankingRiskPremiumPct'] || 0.2);
        const fxDevaluationRiskPct = Number(args['fxDevaluationRiskPct'] || 0.3);
        const averageTradeCycleHours = Number(args['averageTradeCycleHours'] || 2);
        const simpleEarnAprPct = Number(args['simpleEarnAprPct'] || 4.0);

        const result = calculateEarnYieldVsP2pHurdleRate({
          grossP2pSpreadPct,
          platformFeePct,
          bankingRiskPremiumPct,
          fxDevaluationRiskPct,
          averageTradeCycleHours,
          simpleEarnAprPct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'model_bnb_vault_yield_stacking': {
        const bnbAmount = Number(args['bnbAmount'] || 0);
        const bnbPriceUsdt = Number(args['bnbPriceUsdt'] || 600);
        const simpleEarnAprPct = Number(args['simpleEarnAprPct'] || 1.5);
        const activeLaunchpoolsCount = Number(args['activeLaunchpoolsCount'] || 1);
        const averageLaunchpoolAprPct = Number(args['averageLaunchpoolAprPct'] || 12.0);
        const hodlerAirdropProjectedAprPct =
          args['hodlerAirdropProjectedAprPct'] !== undefined
            ? Number(args['hodlerAirdropProjectedAprPct'])
            : 3.5;

        const result = modelBnbVaultYieldStacking({
          bnbAmount,
          bnbPriceUsdt,
          simpleEarnAprPct,
          activeLaunchpoolsCount,
          averageLaunchpoolAprPct,
          hodlerAirdropProjectedAprPct,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'forecast_flexible_earn_tier_saturation': {
        const totalCapitalUsdt = Number(args['totalCapitalUsdt'] || 0);
        const tier1LimitPerAccountUsdt =
          args['tier1LimitPerAccountUsdt'] !== undefined
            ? Number(args['tier1LimitPerAccountUsdt'])
            : 500;
        const tier1AprPct = Number(args['tier1AprPct'] || 10.0);
        const tier2AprPct = Number(args['tier2AprPct'] || 2.0);
        const availableSubaccountsCount =
          args['availableSubaccountsCount'] !== undefined
            ? Number(args['availableSubaccountsCount'])
            : 3;

        const result = forecastFlexibleEarnTierSaturation({
          totalCapitalUsdt,
          tier1LimitPerAccountUsdt,
          tier1AprPct,
          tier2AprPct,
          availableSubaccountsCount,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'calculate_auto_invest_dca_spread_funnel': {
        const monthlyP2pNetProfitUsdt = Number(args['monthlyP2pNetProfitUsdt'] || 0);
        const reinvestmentRatioPct = Number(args['reinvestmentRatioPct'] || 25);
        const targetAsset = (args['targetAsset'] || 'BTC') as 'BTC' | 'ETH' | 'BNB' | 'SOL';
        const projectedAnnualAssetGrowthPct =
          args['projectedAnnualAssetGrowthPct'] !== undefined
            ? Number(args['projectedAnnualAssetGrowthPct'])
            : 15;
        const executionFrequency = (args['executionFrequency'] || 'WEEKLY') as
          'DAILY' | 'WEEKLY' | 'BIWEEKLY';

        const result = calculateAutoInvestDcaSpreadFunnel({
          monthlyP2pNetProfitUsdt,
          reinvestmentRatioPct,
          targetAsset,
          projectedAnnualAssetGrowthPct,
          executionFrequency,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'simulate_earn_instant_redemption_latency': {
        const redemptionAmountUsdt = Number(args['redemptionAmountUsdt'] || 0);
        const dailyInstantQuotaUsdt =
          args['dailyInstantQuotaUsdt'] !== undefined
            ? Number(args['dailyInstantQuotaUsdt'])
            : 1000000;
        const dailyQuotaConsumedUsdt =
          args['dailyQuotaConsumedUsdt'] !== undefined ? Number(args['dailyQuotaConsumedUsdt']) : 0;
        const averageSlippageOrDelayHours =
          args['averageSlippageOrDelayHours'] !== undefined
            ? Number(args['averageSlippageOrDelayHours'])
            : 0.1;

        const result = simulateEarnInstantRedemptionLatency({
          redemptionAmountUsdt,
          dailyInstantQuotaUsdt,
          dailyQuotaConsumedUsdt,
          averageSlippageOrDelayHours,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'qualify_direct_lead_and_close': {
        const leadChannel = (args['leadChannel'] || 'WHATSAPP') as
          'WHATSAPP' | 'TELEGRAM' | 'INSTAGRAM_DM';
        const estimatedWeeklyVolumeUsdt = Number(args['estimatedWeeklyVolumeUsdt'] || 1000);
        const paymentMethodPreferred = String(args['paymentMethodPreferred'] || 'Pago Móvil');
        const isKycVerified = Boolean(args['isKycVerified']);
        const primaryConcern = (args['primaryConcern'] || 'PRICE') as
          'PRICE' | 'SECURITY' | 'SPEED' | 'PAYMENT_LIMITS';
        const currentParallelRate = Number(args['currentParallelRate'] || 85.0);

        const result = qualifyDirectLeadAndClose({
          leadChannel,
          estimatedWeeklyVolumeUsdt,
          paymentMethodPreferred,
          isKycVerified,
          primaryConcern,
          currentParallelRate,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'generate_social_traffic_funnel': {
        const targetAudience = (args['targetAudience'] || 'RETAIL_SAVERS') as
          'RETAIL_SAVERS' | 'MERCHANT_IMPORTERS' | 'P2P_ARBITRAGEURS';
        const platform = (args['platform'] || 'INSTAGRAM') as 'INSTAGRAM' | 'TIKTOK' | 'TWITTER_X';
        const currentBcvGapPct = Number(args['currentBcvGapPct'] || 20.0);
        const educationalTheme = (args['educationalTheme'] || 'INFLATION_HEDGE') as
          'INFLATION_HEDGE' | 'TRIANGULATION_BASICS' | 'AVOID_BANK_FREEZES';

        const result = generateSocialTrafficFunnel({
          targetAudience,
          platform,
          currentBcvGapPct,
          educationalTheme,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'benchmark_competitor_market_intelligence': {
        const ourCurrentPrice = Number(args['ourCurrentPrice'] || 85.0);
        const targetSide = (args['targetSide'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
        const ourMinMarginPct = Number(args['ourMinMarginPct'] || 0.8);
        const competitorOffers = (args['competitorOffers'] || []) as any[];

        const result = benchmarkCompetitorMarketIntelligence({
          ourCurrentPrice,
          targetSide,
          ourMinMarginPct,
          competitorOffers,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'orchestrate_workspace_sync': {
        const entityType = (args['entityType'] || 'ORDER') as
          'ORDER' | 'DISPUTE' | 'BANK_INCIDENT' | 'SOP_VIOLATION';
        const referenceId = String(args['referenceId'] || 'REF-AUTO');
        const urgencyLevel = (args['urgencyLevel'] || 'MEDIUM') as
          'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
        const operatorAssigned = String(args['operatorAssigned'] || 'Operador Principal');
        const summaryText = String(args['summaryText'] || 'Evento operativo registrado');
        const metadataPayload = (args['metadataPayload'] || {}) as Record<string, unknown>;

        const result = orchestrateWorkspaceSync({
          entityType,
          referenceId,
          urgencyLevel,
          operatorAssigned,
          summaryText,
          metadataPayload,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'execute_desktop_rpa_reconciliation': {
        const bankName = String(args['bankName'] || 'Banesco');
        const rawBankStatements = (args['rawBankStatements'] || []) as any[];
        const registeredP2pOrders = (args['registeredP2pOrders'] || []) as any[];

        const result = executeDesktopRpaReconciliation({
          bankName,
          rawBankStatements,
          registeredP2pOrders,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'monitor_service_health_and_fallback': {
        const webSocketLatencyMs = Number(args['webSocketLatencyMs'] || 120);
        const bankApiUptimePct = Number(args['bankApiUptimePct'] || 99.5);
        const dbQueryResponseTimeMs = Number(args['dbQueryResponseTimeMs'] || 15);
        const unresolvedErrorsCount = Number(args['unresolvedErrorsCount'] || 0);

        const result = monitorServiceHealthAndFallback({
          webSocketLatencyMs,
          bankApiUptimePct,
          dbQueryResponseTimeMs,
          unresolvedErrorsCount,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'triage_incident_and_escalate': {
        const incidentType = (args['incidentType'] || 'BANK_ACCOUNT_HOLD') as
          | 'BANK_ACCOUNT_HOLD'
          | 'THIRD_PARTY_PAYMENT'
          | 'PARTIAL_PAYMENT_FRAUD'
          | 'APP_LATENCY_DELAY';
        const amountAtRiskUsdt = Number(args['amountAtRiskUsdt'] || 0);
        const orderId = args['orderId'] ? String(args['orderId']) : undefined;
        const counterpartyAlias = args['counterpartyAlias']
          ? String(args['counterpartyAlias'])
          : undefined;

        const result = triageIncidentAndEscalate({
          incidentType,
          amountAtRiskUsdt,
          orderId,
          counterpartyAlias,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'audit_sop_compliance_enforcement': {
        const orderId = String(args['orderId'] || 'ORD-TEST');
        const accountHolderMatchesDocument = Boolean(args['accountHolderMatchesDocument']);
        const bankBalanceConfirmedInAvailableFunds = Boolean(
          args['bankBalanceConfirmedInAvailableFunds'],
        );
        const responseTimeMinutes = Number(args['responseTimeMinutes'] || 5);
        const fundsReleasedBeforeBankVerification = Boolean(
          args['fundsReleasedBeforeBankVerification'],
        );

        const result = auditSopComplianceEnforcement({
          orderId,
          accountHolderMatchesDocument,
          bankBalanceConfirmedInAvailableFunds,
          responseTimeMinutes,
          fundsReleasedBeforeBankVerification,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'sync_google_sheets_live_ledger': {
        const tradeDate = String(args['tradeDate'] || new Date().toISOString().split('T')[0]);
        const orderId = String(args['orderId'] || 'ORD-SHEET');
        const counterpartyAlias = String(args['counterpartyAlias'] || 'Counterparty');
        const tradeType = (args['tradeType'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
        const cryptoAmountUsdt = Number(args['cryptoAmountUsdt'] || 100);
        const fiatAmountVes = Number(args['fiatAmountVes'] || 8500);
        const exchangeRate = Number(args['exchangeRate'] || 85.0);
        const platformFeeUsdt = Number(args['platformFeeUsdt'] || 0.1);
        const bankTransferFeeVes = Number(args['bankTransferFeeVes'] || 0);

        const result = syncGoogleSheetsLiveLedger({
          tradeDate,
          orderId,
          counterpartyAlias,
          tradeType,
          cryptoAmountUsdt,
          fiatAmountVes,
          exchangeRate,
          platformFeeUsdt,
          bankTransferFeeVes,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'forecast_cash_flow_and_reconciliation': {
        const fiatBankBalancesTotalUsdtEquiv = Number(
          args['fiatBankBalancesTotalUsdtEquiv'] || 1000,
        );
        const cryptoExchangeBalancesUsdt = Number(args['cryptoExchangeBalancesUsdt'] || 5000);
        const pendingUnsettledOrdersUsdt = Number(args['pendingUnsettledOrdersUsdt'] || 500);
        const dailyProjectedVolumeUsdt = Number(args['dailyProjectedVolumeUsdt'] || 2500);
        const averageOperationalExpensesDailyUsdt = Number(
          args['averageOperationalExpensesDailyUsdt'] || 30,
        );

        const result = forecastCashFlowAndReconciliation({
          fiatBankBalancesTotalUsdtEquiv,
          cryptoExchangeBalancesUsdt,
          pendingUnsettledOrdersUsdt,
          dailyProjectedVolumeUsdt,
          averageOperationalExpensesDailyUsdt,
        });

        return {
          success: true,
          skillName,
          data: result,
          executedAt: now,
        };
      }

      case 'audit_and_risk_analytics': {
        const timeframeDays = Number(args['timeframeDays'] || 7);
        const minSpreadThresholdPct = Number(args['minSpreadThresholdPct'] || 0.5);
        const focusArea = String(args['focusArea'] || 'ALL');
        const sampleEvents = (args['sampleEvents'] as ForensicAuditEvent[]) || [];
        const sampleOperations = (args['sampleOperations'] as ForensicOperationRecord[]) || [];

        const riskDist = analyzeHourlyRiskDistribution(sampleEvents);
        const discipline = auditTradingDisciplineAndSpreadCompliance(
          sampleOperations,
          minSpreadThresholdPct,
        );
        const dossier = generateForensicDossier(riskDist, discipline);

        return {
          success: true,
          skillName,
          data: {
            timeframeDays,
            focusArea,
            dossier,
          },
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
