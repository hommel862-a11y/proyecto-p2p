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
import {
  scanSyntheticStableCurves,
  type StableCrossQuote,
} from './synthetic-stable-arbitrage';
import {
  scanOrderbookSnipingOpportunities,
  type P2pOrderbookAdItem,
} from './orderbook-sniper';
import {
  aggregateDarkPoolOpportunities,
  type MarketVenueQuote,
} from './otc-darkpool-aggregator';
import {
  calculateFintechSettlementQuote,
} from './fintech-settlement-routing';
import {
  calculateDynamicCounterpartyPricing,
  classifyCounterpartyTier,
} from './counterparty-yield-pricing';
import {
  parseCustomerChatMessage,
  generateConciergeReply,
} from './omnichannel-concierge';
import {
  evaluateMacroBcvRegime,
} from './macro-bcv-intelligence';
import {
  calculateTreasuryYieldAllocation,
} from './smart-treasury-yield';
import {
  compileBrowserOperatorTask,
} from './browser-operator-bridge';
import {
  calculateRemittanceQuote,
  formatRemittanceWhatsAppMessage,
} from './remittance-corridor';

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
  /**
   * Set when the skill declined to produce a value because the evidence was
   * missing. `success: false` with `data: null` is not a crash — it is a refusal,
   * and the caller needs to know which source would have satisfied it.
   */
  unavailableReason?: string;
  /** Where the value would have come from had it been available. */
  expectedSource?: string;
  /** `false` whenever this result must not drive an action on its own. */
  actionable?: boolean;
  description?: string;
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
  {
    name: 'scan_synthetic_stable_arbitrage',
    description: 'Escanea curvas de precios entre monedas estables (USDT, USDC, FDUSD, EURC) en spot y libros P2P locales para capturar descalces sintéticos sin riesgo.',
    parameters: {
      type: 'OBJECT',
      properties: {
        quotes: {
          type: 'ARRAY',
          description: 'Lista de cotizaciones de activos estables en spot y P2P.',
          items: { type: 'OBJECT', description: 'Cotización con spotRate, p2pUsdtRateFiat, p2pTargetRateFiat.' },
        },
        minThresholdPct: { type: 'NUMBER', description: 'Umbral mínimo de margen neto requerido (por defecto 0.45%).' },
      },
      required: ['quotes'],
    },
  },
  {
    name: 'audit_distressed_liquidity_sniper',
    description: 'Monitorea el libro de órdenes P2P para detectar anomalías, liquidaciones forzadas y fat-fingers por debajo del precio justo de mercado.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ads: {
          type: 'ARRAY',
          description: 'Anuncios del libro de órdenes con precio, volumen y límites.',
          items: { type: 'OBJECT', description: 'Anuncio P2P.' },
        },
        fairMarketPrice: { type: 'NUMBER', description: 'Precio justo de mercado promedio ponderado en fiat.' },
        minProfitThresholdPct: { type: 'NUMBER', description: 'Umbral mínimo de desvío rentable (por defecto 1.2%).' },
      },
      required: ['ads', 'fairMarketPrice'],
    },
  },
  {
    name: 'query_otc_darkpool_spread',
    description: 'Agrega y compara spreads entre plataformas P2P (Binance, Bybit, El Dorado) y mesas OTC locales de efectivo en dólares (Caracas, Bogotá).',
    parameters: {
      type: 'OBJECT',
      properties: {
        venues: {
          type: 'ARRAY',
          description: 'Cotizaciones de compra y venta por exchange y mesa OTC.',
          items: { type: 'OBJECT', description: 'Cotización de venue con buyRate, sellRate y costos.' },
        },
        capitalUsd: { type: 'NUMBER', description: 'Monto de capital a evaluar en la ruta de arbitraje.' },
      },
      required: ['venues'],
    },
  },
  {
    name: 'route_fintech_payroll_settlement',
    description: 'Calcula rutas y comisiones de liquidación para nóminas remotas y fondos de plataformas internacionales (Deel, Wise, Payoneer, Stripe, PayPal).',
    parameters: {
      type: 'OBJECT',
      properties: {
        platform: { type: 'STRING', enum: ['DEEL', 'WISE', 'PAYONEER', 'STRIPE', 'PAYPAL'], description: 'Plataforma de origen de los fondos.' },
        grossAmountUsd: { type: 'NUMBER', description: 'Monto bruto a liquidar en USD.' },
        payoutRail: { type: 'STRING', enum: ['USDT_TRC20', 'VES_PAGO_MOVIL', 'VES_TRANSFERENCIA', 'USD_CASH_DELIVERY'], description: 'Vía de pago solicitada por el cliente.' },
        vesRatePerUsd: { type: 'NUMBER', description: 'Tasa de cambio de referencia en bolívares.' },
      },
      required: ['platform', 'grossAmountUsd', 'payoutRail'],
    },
  },
  {
    name: 'recommend_counterparty_yield_price',
    description: 'Genera cotizaciones con pricing dinámico ajustando el spread según la velocidad de liberación, volumen y fricción de cada contraparte.',
    parameters: {
      type: 'OBJECT',
      properties: {
        counterpartyId: { type: 'STRING', description: 'Identificador único del cliente o comerciante.' },
        averageReleaseMinutes: { type: 'NUMBER', description: 'Tiempo promedio de liberación en minutos.' },
        completedTradesCount: { type: 'NUMBER', description: 'Cantidad de órdenes finalizadas exitosamente.' },
        disputeCount: { type: 'NUMBER', description: 'Número de disputas previas.' },
        monthlyVolumeUsd: { type: 'NUMBER', description: 'Volumen mensual operado en USD.' },
        baseMarketRate: { type: 'NUMBER', description: 'Tasa base del mercado.' },
        orderType: { type: 'STRING', enum: ['BUY', 'SELL'], description: 'Tipo de operación desde la perspectiva de la mesa.' },
        requestedAmountUsd: { type: 'NUMBER', description: 'Monto solicitado en USD.' },
      },
      required: ['counterpartyId', 'averageReleaseMinutes', 'completedTradesCount', 'baseMarketRate', 'orderType', 'requestedAmountUsd'],
    },
  },
  {
    name: 'process_concierge_inquiry',
    description: 'Parsea consultas en lenguaje natural de WhatsApp/Telegram, calcula cotizaciones en tiempo real y genera la respuesta comercial estructurada.',
    parameters: {
      type: 'OBJECT',
      properties: {
        rawCustomerMessage: { type: 'STRING', description: 'Texto del mensaje enviado por el cliente.' },
        deskRatePerUsd: { type: 'NUMBER', description: 'Tasa de cambio activa de la mesa P2P.' },
        bankName: { type: 'STRING', description: 'Banco receptor activo.' },
        bankAccountDetails: { type: 'STRING', description: 'Coordenadas bancarias oficiales de la mesa.' },
      },
      required: ['rawCustomerMessage', 'deskRatePerUsd', 'bankName', 'bankAccountDetails'],
    },
  },
  {
    name: 'predict_bcv_macro_regime',
    description: 'Evalúa la brecha cambiaria y probabilidad de intervención bancaria del BCV para emitir directivas de exposición en bolívares.',
    parameters: {
      type: 'OBJECT',
      properties: {
        bcvOfficialRate: { type: 'NUMBER', description: 'Tasa oficial publicada por el BCV.' },
        parallelMarketRate: { type: 'NUMBER', description: 'Tasa de mercado paralelo / P2P.' },
        daysSinceLastIntervention: { type: 'NUMBER', description: 'Días transcurridos desde la última venta de divisas del BCV.' },
        currentHourOfDayUtcMinus4: { type: 'NUMBER', description: 'Hora local de Venezuela (0-23).' },
        currentDayOfWeek: { type: 'NUMBER', description: 'Día de la semana (1 = Lunes, 5 = Viernes).' },
      },
      required: ['bcvOfficialRate', 'parallelMarketRate', 'daysSinceLastIntervention', 'currentHourOfDayUtcMinus4', 'currentDayOfWeek'],
    },
  },
  {
    name: 'optimize_treasury_idle_yield',
    description: 'Calcula la asignación óptima de capital ocioso en USDT hacia productos de rendimiento flexible (Binance Simple Earn) en horas de baja actividad.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalUsdtInventory: { type: 'NUMBER', description: 'Saldo total de USDT en tesorería.' },
        currentlyCommittedUsdt: { type: 'NUMBER', description: 'Capital comprometido en anuncios u órdenes activas.' },
        marketVelocity: { type: 'STRING', enum: ['LOW_OFFPEAK', 'NORMAL_FLOW', 'HIGH_SURGE'], description: 'Velocidad actual del mercado.' },
        flexibleApyPct: { type: 'NUMBER', description: 'Rendimiento anual flexible ofrecido por la plataforma (por defecto 10.5%).' },
      },
      required: ['totalUsdtInventory', 'currentlyCommittedUsdt', 'marketVelocity'],
    },
  },
  {
    name: 'compile_browser_operator_task',
    description: 'Genera contratos declarativos de automatización web con Playwright para consultar estados de cuenta y comprobantes en neobancos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        targetSite: { type: 'STRING', enum: ['BANESCO_PANAMA', 'FACEBANK', 'SIMLY', 'MERCANTIL_PANAMA', 'BINANCE_P2P'], description: 'Portal financiero objetivo.' },
        action: { type: 'STRING', enum: ['FETCH_RECENT_TRANSACTIONS', 'DOWNLOAD_ACCOUNT_STATEMENT', 'VERIFY_TRANSFER_REFERENCE', 'CHECK_BALANCE'], description: 'Acción de navegación a ejecutar.' },
        referenceToVerify: { type: 'STRING', description: 'Número de referencia bancaria a verificar (opcional).' },
      },
      required: ['targetSite', 'action'],
    },
  },
  {
    name: 'execute_maker_laddering_plan',
    description: 'Calcula precios óptimos de compra y venta escalonados según el modelo Avellaneda-Stoikov para mantener el liderazgo en el libro P2P.',
    parameters: {
      type: 'OBJECT',
      properties: {
        midPrice: { type: 'NUMBER', description: 'Precio medio del libro P2P.' },
        currentInventoryUsdt: { type: 'NUMBER', description: 'Inventario actual en USDT.' },
        targetInventoryUsdt: { type: 'NUMBER', description: 'Inventario objetivo deseado.' },
      },
      required: ['midPrice', 'currentInventoryUsdt', 'targetInventoryUsdt'],
    },
  },
  {
    name: 'balance_cross_exchange_inventory',
    description: 'Analiza desbalances de liquidez entre cuentas de Binance, Bybit y billeteras on-chain para orquestar transferencias de rebalanceo.',
    parameters: {
      type: 'OBJECT',
      properties: {
        binanceBalanceUsdt: { type: 'NUMBER', description: 'Saldo disponible en Binance.' },
        bybitBalanceUsdt: { type: 'NUMBER', description: 'Saldo disponible en Bybit.' },
        onchainBalanceUsdt: { type: 'NUMBER', description: 'Saldo disponible en billeteras frías/calientes.' },
      },
      required: ['binanceBalanceUsdt', 'bybitBalanceUsdt', 'onchainBalanceUsdt'],
    },
  },
  {
    name: 'enforce_depeg_delta_hedge',
    description: 'Calcula el tamaño de cobertura corta sintética en futuros para proteger el inventario contra devaluaciones o pérdidas de paridad.',
    parameters: {
      type: 'OBJECT',
      properties: {
        inventoryVes: { type: 'NUMBER', description: 'Monto total de bolívares en balance.' },
        currentPrice: { type: 'NUMBER', description: 'Precio de referencia del activo.' },
        hedgeRatioPct: { type: 'NUMBER', description: 'Porcentaje de cobertura deseado (10% a 100%).' },
      },
      required: ['inventoryVes', 'currentPrice'],
    },
  },
  {
    name: 'audit_chargeback_shield',
    description: 'Audita el riesgo de reversión o contracargo de fondos provenientes de plataformas fintech y pasarelas de pago digitales.',
    parameters: {
      type: 'OBJECT',
      properties: {
        platform: { type: 'STRING', enum: ['DEEL', 'WISE', 'PAYONEER', 'STRIPE', 'PAYPAL'], description: 'Plataforma de pago.' },
        amountUsd: { type: 'NUMBER', description: 'Monto de la transacción.' },
        isVerifiedContractor: { type: 'BOOLEAN', description: 'Indica si el cliente presentó contrato y soporte laboral.' },
      },
      required: ['platform', 'amountUsd'],
    },
  },
  {
    name: 'classify_and_price_client_tier',
    description: 'Segmenta a una contraparte en niveles de servicio (VIP, Rápido, Estándar, Fricción) y recomienda el multiplicador de spread correspondiente.',
    parameters: {
      type: 'OBJECT',
      properties: {
        counterpartyId: { type: 'STRING', description: 'Identificador del cliente.' },
        averageReleaseMinutes: { type: 'NUMBER', description: 'Tiempo de liberación en minutos.' },
        completedTradesCount: { type: 'NUMBER', description: 'Total de órdenes completadas.' },
        disputeCount: { type: 'NUMBER', description: 'Disputas registradas.' },
        monthlyVolumeUsd: { type: 'NUMBER', description: 'Volumen mensual en USD.' },
      },
      required: ['counterpartyId', 'averageReleaseMinutes', 'completedTradesCount', 'disputeCount', 'monthlyVolumeUsd'],
    },
  },
  {
    name: 'negotiate_whatsapp_order_intake',
    description: 'Maneja el flujo conversacional de cierre de orden en WhatsApp, validando datos de cuenta y generando la confirmación de operación.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customerMessage: { type: 'STRING', description: 'Mensaje del cliente.' },
        activeRate: { type: 'NUMBER', description: 'Tasa activa de la mesa.' },
        bankName: { type: 'STRING', description: 'Banco a operar.' },
        accountDetails: { type: 'STRING', description: 'Datos bancarios oficiales.' },
      },
      required: ['customerMessage', 'activeRate', 'bankName', 'accountDetails'],
    },
  },
  {
    name: 'bundle_corporate_b2b_dossier',
    description: 'Genera el expediente comercial y facturación mercantil con respaldo de cumplimiento para clientes corporativos de alto ticket.',
    parameters: {
      type: 'OBJECT',
      properties: {
        clientName: { type: 'STRING', description: 'Razón social del cliente corporativo.' },
        taxId: { type: 'STRING', description: 'Identificación fiscal (RIF/EIN/NIT).' },
        amountUsd: { type: 'NUMBER', description: 'Monto de la operación en USD.' },
        serviceCategory: { type: 'STRING', description: 'Concepto del servicio intangible.' },
      },
      required: ['clientName', 'taxId', 'amountUsd', 'serviceCategory'],
    },
  },
  {
    name: 'compile_fast_dispute_evidence',
    description: 'Compila de manera pericial los comprobantes bancarios, registros de chat y marcas temporales ante una apelación en Binance.',
    parameters: {
      type: 'OBJECT',
      properties: {
        orderId: { type: 'STRING', description: 'Número de orden en disputa.' },
        counterpartyName: { type: 'STRING', description: 'Nombre de la contraparte.' },
        disputeReason: { type: 'STRING', description: 'Motivo de la disputa.' },
        claimedAmount: { type: 'NUMBER', description: 'Monto en reclamo.' },
        parallelRate: {
          type: 'NUMBER',
          description:
            'Tasa paralelo en vivo (VES por USDT) usada para convertir el reclamo a crypto. Es la tasa P2P, no la oficial: una disputa se resuelve a la tasa del libro, no a la del BCV.',
        },
      },
      required: ['orderId', 'counterpartyName', 'disputeReason', 'claimedAmount', 'parallelRate'],
    },
  },
  {
    name: 'quote_instant_remittance_corridor',
    description: 'Genera cotizaciones inmediatas para corredores internacionales de remesas (COP, CLP, BRL, Zelle, SEPA a VES) con formato de WhatsApp.',
    parameters: {
      type: 'OBJECT',
      properties: {
        corridorId: { type: 'STRING', enum: ['COP_BANCOLOMBIA_TO_VES', 'USD_ZELLE_TO_VES', 'EUR_SEPA_TO_VES', 'CLP_BANCOESTADO_TO_VES', 'BRL_PIX_TO_VES'], description: 'Corredor de remesas.' },
        sendAmount: { type: 'NUMBER', description: 'Monto enviado en moneda origen.' },
        deskSpreadPct: { type: 'NUMBER', description: 'Margen de la mesa (por defecto 2.5%).' },
        activeRate: {
          type: 'NUMBER',
          description:
            'Tasa de venta vigente de la mesa (VES por USD) con la que se promete el pago. Sin tasa real no hay promesa que hacer.',
        },
      },
      required: ['corridorId', 'sendAmount', 'activeRate'],
    },
  },
  {
    name: 'execute_preemptive_bcv_drain',
    description: 'Emite directivas de vaciado preventivo de bolívares en cuenta antes de la apertura de mesas cambiarias del BCV para evitar desvalorización.',
    parameters: {
      type: 'OBJECT',
      properties: {
        currentVesBalance: { type: 'NUMBER', description: 'Saldo total actual en bolívares en bancos.' },
        bcvInterventionProbabilityPct: { type: 'NUMBER', description: 'Probabilidad de intervención estimada.' },
      },
      required: ['currentVesBalance', 'bcvInterventionProbabilityPct'],
    },
  },
  {
    name: 'evaluate_emergency_killswitch',
    description: 'Evalúa la activación del interruptor de emergencia para pausar anuncios y congelar operaciones ante anomalías críticas de mercado.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Motivo del disparo del interruptor.' },
        anomalySeverity: { type: 'STRING', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], description: 'Severidad del evento.' },
      },
      required: ['reason', 'anomalySeverity'],
    },
  },
];

/**
 * Deterministic dispatcher: safely maps a tool invocation to its corresponding core domain logic.
 */
/**
 * A skill asked for a number that nobody measured.
 *
 * Thrown instead of returning a default, because a default here is not a
 * fallback: it is an assertion about the world made without a source. The
 * dispatcher catch converts it into a refusal with `expectedSource`.
 */
export class MissingEvidenceError extends Error {
  constructor(
    readonly field: string,
    readonly expectedSource: string,
  ) {
    super(`Falta evidencia: '${field}' no fue provisto. Fuente requerida: ${expectedSource}.`);
    this.name = 'MissingEvidenceError';
  }
}

/**
 * Reads a numeric input that must come from a real measurement.
 *
 * Rejects absence AND rejects the old `||` behaviour where a legitimate `0` was
 * silently replaced by the default. Use `policyNumber` for operator thresholds,
 * where a default is a rule the operator chose, not a claim about the world.
 */
function requiredNumber(
  args: Record<string, unknown>,
  keys: string | readonly string[],
  expectedSource: string,
): number {
  const candidates = typeof keys === 'string' ? [keys] : keys;
  for (const key of candidates) {
    const raw = args[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  throw new MissingEvidenceError(candidates[0], expectedSource);
}

/**
 * Reads an operator-chosen threshold, where a default is legitimate policy.
 * Uses `??` so an explicit `0` survives.
 */
function policyNumber(
  args: Record<string, unknown>,
  key: string,
  policyDefault: number,
): number {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === '') return policyDefault;
  const value = Number(raw);
  return Number.isFinite(value) ? value : policyDefault;
}

/**
 * Sources named once, so a refusal always points at the feed that would have
 * satisfied it. A vague `expectedSource` is worse than none: it sends the
 * operator looking in the wrong place.
 */
const SRC_LIVE_PARALLEL_RATE =
  'tasa paralelo u oficial en vivo (MCP get_parallel_rates / get_bcv_rates)';
const SRC_LIVE_P2P_MID = 'punto medio del libro P2P en vivo (API pública de Binance P2P)';
const SRC_LIVE_SPOT_PRICE = 'precio spot en vivo del activo (API pública del exchange)';
const SRC_DESK_SELL_RATE =
  'tasa de venta vigente de la mesa leída por el orquestador (MCP get_parallel_rates)';
const SRC_VENUE_PUBLISHED_RATE =
  'tasa vigente publicada por el venue (API pública de Binance Earn/Launchpool)';
const SRC_COUNTERPARTY_TRACK_RECORD =
  'registro real y verificable del operador (API pública de la plataforma o historial propio auditado)';
const SRC_REAL_BALANCE = 'saldo real de la cuenta (API del exchange / on-chain / tesorería)';
const SRC_LEDGER_ORDER = 'monto real de la orden registrada (ledger de órdenes / Binance P2P)';

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
        const vesBalance = requiredNumber(args, 'vesBalance', SRC_REAL_BALANCE);
        const usdtBalance = requiredNumber(args, 'usdtBalance', SRC_REAL_BALANCE);
        const currentParallelRate = requiredNumber(args, 'currentParallelRate', SRC_LIVE_PARALLEL_RATE);
        const vesMaxHoldingTimeMinutes = policyNumber(args, 'vesMaxHoldingTimeMinutes', 0);
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
        const currentSpreadPct = requiredNumber(
          args,
          'currentSpreadPct',
          'spread de mercado en vivo observado en el libro P2P (API pública de Binance P2P)',
        );
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
        const orderAmountFiat = requiredNumber(args, 'orderAmountFiat', SRC_LEDGER_ORDER);
        const orderAmountCrypto = requiredNumber(args, 'orderAmountCrypto', SRC_LEDGER_ORDER);
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
        const targetAmountUsdt = requiredNumber(
          args,
          'targetAmountUsdt',
          'monto objetivo real de la orden (plan de órdenes del operador)',
        );
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
      const midPrice = requiredNumber(args, 'midPrice', SRC_LIVE_P2P_MID);
        const currentInventoryUsdt = requiredNumber(
          args,
          'currentInventoryUsdt',
          'inventario real de la cuenta (API del exchange / tesorería)',
        );
        const targetInventoryUsdt = requiredNumber(
          args,
          'targetInventoryUsdt',
          'inventario objetivo declarado por la mesa (declaración del operador, no un valor por defecto)',
        );
        const volatilityDaily = requiredNumber(
          args,
          'volatilityDaily',
          'volatilidad diaria medida sobre la serie de precios (klines de la API pública del exchange)',
        );
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
        const toxicityThreshold = policyNumber(args, 'toxicityThreshold', 0.25);

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
        const totalAmountUsdt = requiredNumber(
          args,
          'totalAmountUsdt',
          'monto total real que la orden debe ejecutar (plan de órdenes del operador)',
        );
        const executionDurationMinutes = policyNumber(args, 'executionDurationMinutes', 60);
        const estimatedMarketVolumePerHourUsdt = requiredNumber(
          args,
          'estimatedMarketVolumePerHourUsdt',
          'volumen horario real medido en el libro o en la serie de trades del activo (API pública del exchange)',
        );
        const currentMidPrice = requiredNumber(args, 'currentMidPrice', SRC_LIVE_P2P_MID);
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
        const targetHorizonMinutes = policyNumber(args, 'targetHorizonMinutes', 15);

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
        const baseAmountUsdt = requiredNumber(
          args,
          'baseAmountUsdt',
          'monto base real que el operador intends mover por el corredor (plan de órdenes)',
        );
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
        const capitalUsdt = requiredNumber(
          args,
          'capitalUsdt',
          'capital real que la mesa asigna al arbitrage cross-exchange (tesorería)',
        );
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
        const spotParallelRate = requiredNumber(args, 'spotParallelRate', SRC_LIVE_PARALLEL_RATE);
        const vesHoldingAmount = requiredNumber(
          args,
          'vesHoldingAmount',
          'posición propia en VES (saldo real de la cartera / tesorería)',
        );
        const expectedDevaluationJumpPct = policyNumber(args, 'expectedDevaluationJumpPct', 15);
        const timeHorizonDays = policyNumber(args, 'timeHorizonDays', 1);

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
        const collateralUsdt = requiredNumber(
          args,
          'collateralUsdt',
          'collateral realmente bloqueado en el exchange (API del exchange / on-chain)',
        );
        const currentFundingRate8hPct = requiredNumber(
          args,
          'currentFundingRate8hPct',
          'tasa de funding vigente publicada por el exchange (API pública de futuros)',
        );
        const holdingPeriodDays = policyNumber(args, 'holdingPeriodDays', 7);

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
        const totalCapitalUsdt = requiredNumber(args, 'totalCapitalUsdt', 'saldo real del operador');
        const winRatePct = requiredNumber(args, 'winRatePct', 'historial de operaciones del operador');
        const averageProfitPerWinUsdt = requiredNumber(args, 'averageProfitPerWinUsdt', 'historial de operaciones del operador');
        const averageLossPerLossUsdt = requiredNumber(args, 'averageLossPerLossUsdt', 'historial de operaciones del operador');

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
        const weeklyBcvInjectionMillionsUsd = requiredNumber(
          args,
          'weeklyBcvInjectionMillionsUsd',
          'dato oficial de inyección BCV (no hay modelo de liquidez calibrado)',
        );

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
        const averageVesHoldingMinutes = requiredNumber(args, 'averageVesHoldingMinutes', 'medición observada de tenencia');
        const merchantUsdtAcceptancePct = requiredNumber(args, 'merchantUsdtAcceptancePct', 'medición del mercado paralelo');
        const monthlyInflationEstimatePct = requiredNumber(args, 'monthlyInflationEstimatePct', 'dato macro oficial de inflación');

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
        const myCurrentPrice = requiredNumber(args, 'myCurrentPrice', SRC_LIVE_P2P_MID);
        const targetSide = (args['targetSide'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
        const topCompetitors = (args['topCompetitors'] || []) as any[];
        const minimumSpreadAllowedPct = policyNumber(args, 'minimumSpreadAllowedPct', 0.8);

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
        const capitalUsdt = requiredNumber(args, 'capitalUsdt', SRC_REAL_BALANCE);
        const tier1LimitUsdt =
          args['tier1LimitUsdt'] !== undefined ? Number(args['tier1LimitUsdt']) : 500;
        const tier1AprPct = requiredNumber(args, 'tier1AprPct', SRC_VENUE_PUBLISHED_RATE);
        const tier2AprPct = requiredNumber(args, 'tier2AprPct', SRC_VENUE_PUBLISHED_RATE);
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
        const currentSpotPrice = requiredNumber(args, 'currentSpotPrice', SRC_LIVE_SPOT_PRICE);
        const strikePrice = requiredNumber(
          args,
          'strikePrice',
          'strike contratado en la orden de Dual Investment del exchange (API privada de Binance)',
        );
        const durationDays = policyNumber(args, 'durationDays', 7);
        const annualizedAprPct = requiredNumber(
          args,
          'annualizedAprPct',
          'APR vigente publicado por el exchange para el producto de Dual Investment (términos del producto / API de la cuenta)',
        );
        const investedCapitalUsdt = requiredNumber(
          args,
          'investedCapitalUsdt',
          'capital realmente invertido en la orden de Dual Investment (API de la cuenta)',
        );

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
        const usdtBalance = requiredNumber(args, 'usdtBalance', SRC_REAL_BALANCE);
        const fdusdBalance = requiredNumber(args, 'fdusdBalance', SRC_REAL_BALANCE);
        const usdtFlexibleAprPct = requiredNumber(args, 'usdtFlexibleAprPct', SRC_VENUE_PUBLISHED_RATE);
        const fdusdFlexibleAprPct = requiredNumber(args, 'fdusdFlexibleAprPct', SRC_VENUE_PUBLISHED_RATE);
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
        const capitalUsdt = requiredNumber(args, 'capitalUsdt', SRC_REAL_BALANCE);
        const stakedAsset = (
          args['stakedAsset'] === 'BNB' || args['stakedAsset'] === 'FDUSD'
            ? args['stakedAsset']
            : 'USDT'
        ) as 'BNB' | 'FDUSD' | 'USDT';
        const launchpoolDurationDays = policyNumber(args, 'launchpoolDurationDays', 4);
        const totalPoolStaked = requiredNumber(
          args,
          'totalPoolStaked',
          'total realmente stakeado en el pool, publicado por el venue (API pública de Binance Earn/Launchpool)',
        );
        const dailyRewardPoolTokens = requiredNumber(
          args,
          'dailyRewardPoolTokens',
          'rewards diarios del pool publicados por el venue (API pública de Binance Launchpool)',
        );
        // NOT a measurement: the token has no price until it lists, so there is
        // no feed that could supply this. It stays a declared operator
        // assumption instead of an unsatisfiable evidence requirement.
        const estimatedTokenListingPriceUsdt = policyNumber(
          args,
          'estimatedTokenListingPriceUsdt',
          2.0,
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
        const totalTreasuryUsdt = requiredNumber(args, 'totalTreasuryUsdt', SRC_REAL_BALANCE);
        const dailyP2pVolumeUsdt = requiredNumber(
          args,
          'dailyP2pVolumeUsdt',
          'volumen P2P diario real registrado (ledger de órdenes)',
        );
        const p2pTurnoverDays = policyNumber(args, 'p2pTurnoverDays', 1);
        const flexibleAprPct = requiredNumber(args, 'flexibleAprPct', SRC_VENUE_PUBLISHED_RATE);
        const locked30dAprPct = requiredNumber(args, 'locked30dAprPct', SRC_VENUE_PUBLISHED_RATE);
        const locked60dAprPct = requiredNumber(args, 'locked60dAprPct', SRC_VENUE_PUBLISHED_RATE);
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
        const grossP2pSpreadPct = requiredNumber(
          args,
          'grossP2pSpreadPct',
          'spread bruto real promedio de las órdenes ejecutadas (ledger de órdenes / libro P2P en vivo)',
        );
        const platformFeePct = requiredNumber(
          args,
          'platformFeePct',
          'comisión real de la plataforma vigente para la operación (tarifario de Binance P2P)',
        );
        const bankingRiskPremiumPct = policyNumber(args, 'bankingRiskPremiumPct', 0.2);
        const fxDevaluationRiskPct = policyNumber(args, 'fxDevaluationRiskPct', 0.3);
        const averageTradeCycleHours = requiredNumber(
          args,
          'averageTradeCycleHours',
          'ciclo medio real de una operación P2P completada (historial de órdenes medido)',
        );
        const simpleEarnAprPct = requiredNumber(args, 'simpleEarnAprPct', SRC_VENUE_PUBLISHED_RATE);

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
        const bnbAmount = requiredNumber(args, 'bnbAmount', SRC_REAL_BALANCE);
        const bnbPriceUsdt = requiredNumber(args, 'bnbPriceUsdt', SRC_LIVE_SPOT_PRICE);
        const simpleEarnAprPct = requiredNumber(args, 'simpleEarnAprPct', SRC_VENUE_PUBLISHED_RATE);
        const activeLaunchpoolsCount = requiredNumber(
          args,
          'activeLaunchpoolsCount',
          'conteo real de Launchpools activos publicados por el venue (API pública de Binance Earn)',
        );
        const averageLaunchpoolAprPct = requiredNumber(
          args,
          'averageLaunchpoolAprPct',
          'APR promedio real de los Launchpools activos publicados por el venue (API pública de Binance Earn/Launchpool)',
        );
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
        const totalCapitalUsdt = requiredNumber(args, 'totalCapitalUsdt', SRC_REAL_BALANCE);
        const tier1LimitPerAccountUsdt =
          args['tier1LimitPerAccountUsdt'] !== undefined
            ? Number(args['tier1LimitPerAccountUsdt'])
          : 500;
      const tier1AprPct = requiredNumber(args, 'tier1AprPct', SRC_VENUE_PUBLISHED_RATE);
        const tier2AprPct = requiredNumber(args, 'tier2AprPct', SRC_VENUE_PUBLISHED_RATE);
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
        const monthlyP2pNetProfitUsdt = requiredNumber(
          args,
          'monthlyP2pNetProfitUsdt',
          'utilidad neta P2P real del mes (resultado de órdenes ejecutadas / contabilidad propia)',
        );
        const reinvestmentRatioPct = policyNumber(args, 'reinvestmentRatioPct', 25);
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
        const redemptionAmountUsdt = requiredNumber(
          args,
          'redemptionAmountUsdt',
          'monto real que el operador intends redimir (saldo de la cuenta Earn)',
        );
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
        const estimatedWeeklyVolumeUsdt = requiredNumber(
          args,
          'estimatedWeeklyVolumeUsdt',
          'volumen semanal declarado y verificado por el cliente (registro de operaciones del cliente)',
        );
        const paymentMethodPreferred = String(args['paymentMethodPreferred'] || 'Pago Móvil');
        const isKycVerified = Boolean(args['isKycVerified']);
        const primaryConcern = (args['primaryConcern'] || 'PRICE') as
          'PRICE' | 'SECURITY' | 'SPEED' | 'PAYMENT_LIMITS';
        const currentParallelRate = requiredNumber(args, 'currentParallelRate', SRC_LIVE_PARALLEL_RATE);

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
        const currentBcvGapPct = requiredNumber(
          args,
          'currentBcvGapPct',
          'brecha BCV vs paralelo calculada con tasas en vivo (MCP get_parallel_rates / get_bcv_rates)',
        );
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
        const ourCurrentPrice = requiredNumber(args, 'ourCurrentPrice', SRC_LIVE_P2P_MID);
        const targetSide = (args['targetSide'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
        const ourMinMarginPct = policyNumber(args, 'ourMinMarginPct', 0.8);
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
        const webSocketLatencyMs = requiredNumber(args, 'webSocketLatencyMs', 'latencia medida del websocket');
        const bankApiUptimePct = requiredNumber(args, 'bankApiUptimePct', 'uptime medido de la API bancaria');
        const dbQueryResponseTimeMs = requiredNumber(args, 'dbQueryResponseTimeMs', 'tiempo de respuesta medido de la base de datos');
        const unresolvedErrorsCount = requiredNumber(args, 'unresolvedErrorsCount', 'conteo real de errores sin resolver');

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
        const amountAtRiskUsdt = requiredNumber(
          args,
          'amountAtRiskUsdt',
          'monto real en riesgo según la orden y el movimiento bancario registrado (ledger de órdenes)',
        );
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
        const responseTimeMinutes = requiredNumber(
          args,
          'responseTimeMinutes',
          'tiempo real de respuesta del operador a la orden (timestamps de la orden / chat)',
        );
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
        const cryptoAmountUsdt = requiredNumber(args, 'cryptoAmountUsdt', SRC_LEDGER_ORDER);
        const fiatAmountVes = requiredNumber(args, 'fiatAmountVes', SRC_LEDGER_ORDER);
        const exchangeRate = requiredNumber(args, 'exchangeRate', SRC_LIVE_PARALLEL_RATE);
        const platformFeeUsdt = requiredNumber(
          args,
          'platformFeeUsdt',
          'comisión realmente cobrada por la plataforma en esa operación (extracto de Binance P2P)',
        );
        const bankTransferFeeVes = requiredNumber(
          args,
          'bankTransferFeeVes',
          'comisión bancaria real de esa transferencia (estado de cuenta / recibo)',
        );

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
        const fiatBankBalancesTotalUsdtEquiv = requiredNumber(args, 'fiatBankBalancesTotalUsdtEquiv', SRC_REAL_BALANCE);
        const cryptoExchangeBalancesUsdt = requiredNumber(args, 'cryptoExchangeBalancesUsdt', SRC_REAL_BALANCE);
        const pendingUnsettledOrdersUsdt = requiredNumber(
          args,
          'pendingUnsettledOrdersUsdt',
          'monto real de órdenes pendientes de liquidar (ledger de órdenes abiertas)',
        );
        const dailyProjectedVolumeUsdt = requiredNumber(
          args,
          'dailyProjectedVolumeUsdt',
          'proyección de volumen diario basada en el volumen real registrado (ledger de órdenes)',
        );
        const averageOperationalExpensesDailyUsdt = requiredNumber(
          args,
          'averageOperationalExpensesDailyUsdt',
          'gasto operativo diario real promedio (contabilidad propia / tesorería)',
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
        const timeframeDays = policyNumber(args, 'timeframeDays', 7);
        const minSpreadThresholdPct = policyNumber(args, 'minSpreadThresholdPct', 0.5);
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

      case 'scan_synthetic_stable_arbitrage': {
        const pairs = (args['pairs'] as StableCrossQuote[]) || [];
        const minNetSpreadPct = policyNumber(args, 'minNetSpreadPct', 0.15);
        const opportunities = scanSyntheticStableCurves(pairs, minNetSpreadPct);

        return {
          success: true,
          skillName,
          data: {
            opportunitiesCount: opportunities.length,
            opportunities,
          },
          executedAt: now,
        };
      }

      case 'audit_distressed_liquidity_sniper': {
        const rawAds = (args['ads'] as any[]) || [];
        const fairMarketRate = Number(args['fairMarketRate'] || 0);
        const side = (args['side'] === 'BUY' ? 'BUY' : 'SELL') as 'BUY' | 'SELL';
        const minDislocationPct = policyNumber(args, 'minDislocationPct', 0.8);
        const ads: P2pOrderbookAdItem[] = rawAds.map((a) => ({
          advId: a.advId || a.advNo || 'AD-0',
          merchantName: a.merchantName || a.advertiserName || 'Anonymous',
          orderType: (a.orderType || (a.side === 'BUY' ? 'BUY' : 'SELL')) as 'BUY' | 'SELL',
          price: Number(a.price || 0),
          availableAmountCrypto: Number(a.availableAmountCrypto || a.availableAmountUsdt || 0),
          minLimitFiat: Number(a.minLimitFiat || a.minLimitVes || 0),
          maxLimitFiat: Number(a.maxLimitFiat || a.maxLimitVes || 0),
          paymentMethods: Array.isArray(a.paymentMethods) ? a.paymentMethods : [],
          fiatCurrency: a.fiatCurrency || 'VES',
        }));

        const snipingOpportunities = scanOrderbookSnipingOpportunities(
          ads,
          {
            fairMarketPrice: fairMarketRate,
            minProfitThresholdPct: minDislocationPct,
          },
        );

        return {
          success: true,
          skillName,
          data: {
            fairMarketRate,
            side,
            snipingOpportunitiesCount: snipingOpportunities.length,
            snipingOpportunities,
          },
          executedAt: now,
        };
      }

      case 'query_otc_darkpool_spread': {
        const quotes = (args['quotes'] as MarketVenueQuote[]) || [];
        const volumeUsd = requiredNumber(
          args,
          'volumeUsd',
          'capital que el operador declara disponible para la ruta (saldo real de tesorería)',
        );
        const minNetSpreadPct = policyNumber(args, 'minNetSpreadPct', 1.2);
        const routes = aggregateDarkPoolOpportunities(quotes, {
          capitalUsd: volumeUsd,
          minNetSpreadPct,
        });

        return {
          success: true,
          skillName,
          data: {
            volumeUsd,
            routesCount: routes.length,
            routes,
          },
          executedAt: now,
        };
      }

      case 'route_fintech_payroll_settlement': {
        const platform = (args['platform'] || args['sourcePlatform'] || 'DEEL') as any;
        const grossAmountUsd = requiredNumber(
          args,
          ['grossAmountUsd', 'amountUsd'],
          'monto bruto real de la nómina (invoice de la plataforma de payroll)',
        );
        const payoutRail = (args['payoutRail'] || (String(args['targetDestination']).includes('BANESCO') ? 'VES_TRANSFERENCIA' : 'USDT_TRC20')) as any;
        const vesRatePerUsd = requiredNumber(args, 'vesRatePerUsd', SRC_LIVE_PARALLEL_RATE);
        const clientTier = (args['clientTier'] || 'STANDARD') as any;
        const isVerifiedContractor = Boolean(args['isVerifiedContractor']);

        const settlementQuote = calculateFintechSettlementQuote({
          platform,
          grossAmountUsd,
          payoutRail,
          vesRatePerUsd,
          clientTier,
          isVerifiedContractor,
        });

        return {
          success: true,
          skillName,
          data: settlementQuote,
          executedAt: now,
        };
      }

      case 'recommend_counterparty_yield_price': {
        const counterpartyId = String(args['counterpartyId'] || 'CP-GENERIC');
        const baseMarketRate = requiredNumber(args, ['marketBasePrice', 'baseMarketRate'], SRC_LIVE_P2P_MID);
        const orderType = (args['orderSide'] === 'SELL' || args['orderType'] === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
        const averageReleaseMinutes = requiredNumber(args, 'averageReleaseMinutes', SRC_COUNTERPARTY_TRACK_RECORD);
        const completedTradesCount = requiredNumber(args, 'completedTradesCount', SRC_COUNTERPARTY_TRACK_RECORD);
        const disputeCount = requiredNumber(args, 'disputeCount', SRC_COUNTERPARTY_TRACK_RECORD);
        const monthlyVolumeUsd = requiredNumber(args, 'monthlyVolumeUsd', SRC_COUNTERPARTY_TRACK_RECORD);
        const requestedAmountUsd = requiredNumber(
          args,
          'requestedAmountUsd',
          'monto real solicitado por la contraparte (solicitud del cliente)',
        );

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

        return {
          success: true,
          skillName,
          data: pricing,
          executedAt: now,
        };
      }

      case 'process_concierge_inquiry': {
        const message = String(args['message'] || '');
        const customerPhone = args['customerPhone'] ? String(args['customerPhone']) : undefined;
        const deskRatePerUsd = requiredNumber(args, ['deskSellRate', 'deskRatePerUsd'], SRC_DESK_SELL_RATE);
        const bankName = String(args['bankName'] || 'Banesco');
        const bankAccountDetails = String(args['bankAccountDetails'] || '0134-XXXX-XXXX-XXXX a nombre de Inversiones P2P');

        const parsed = parseCustomerChatMessage(message);
        const responsePayload = generateConciergeReply(parsed, {
          deskRatePerUsd,
          bankName,
          bankAccountDetails,
          quoteValidityMinutes: 15,
        });

        return {
          success: true,
          skillName,
          data: {
            customerPhone,
            ...responsePayload,
          },
          executedAt: now,
        };
      }

      case 'predict_bcv_macro_regime': {
        // Fail closed on the two rates.
        //
        // These used to be `|| 80.0` and `|| 85.0`. An LMC that asked for the macro
        // regime without supplying live rates got a confident verdict built on two
        // invented numbers — and the directive that came back told it to drain
        // bolivars into USDT. Market rates describe the external world, so they
        // are never defaulted.
        const rawBcv = args['bcvOfficialRate'];
        const rawParallel = args['parallelRate'] ?? args['parallelMarketRate'];
        const bcvOfficialRate = Number(rawBcv);
        const parallelMarketRate = Number(rawParallel);
        const hasLiveRates =
          Number.isFinite(bcvOfficialRate) &&
          bcvOfficialRate > 0 &&
          Number.isFinite(parallelMarketRate) &&
          parallelMarketRate > 0;

        const daysSinceLastIntervention = Number(args['daysSinceLastIntervention'] ?? 4);
        const currentHourOfDayUtcMinus4 = Number(args['currentHourVET'] ?? args['currentHourOfDayUtcMinus4'] ?? 10);
        const currentDayOfWeek = Number(args['currentDayOfWeek'] ?? 1); // 1 = Mon
        // No `$50M` fallback: an injection amount nobody supplied stays absent.
        const rawInjection = args['estimatedInterventionAmountUsd'] ?? args['estimatedWeeklyBcvInjectionUsd'];
        const estimatedWeeklyBcvInjectionUsd = Number.isFinite(Number(rawInjection))
          ? Number(rawInjection)
          : undefined;

        if (!hasLiveRates) {
          const missing = !Number.isFinite(bcvOfficialRate) || bcvOfficialRate <= 0
            ? 'bcvOfficialRate'
            : 'parallelMarketRate';
          return {
            success: false,
            skillName,
            executedAt: now,
            unavailableReason: `SIN_TASA_EN_VIVO:${missing}`,
            expectedSource:
              'bcvOfficialRate: get_bcv_rates (feed oficial en vivo) · parallelMarketRate: get_parallel_rates (monitor leído)',
            actionable: false,
            data: null,
            description:
              `No se evalúa el régimen macro: falta ${missing} en vivo. Las tasas de mercado no se inventan, ` +
              'así que este skill no devuelve probabilidad de intervención, score de riesgo ni directivas tácticas.',
          };
        }

        const regimeAssessment = evaluateMacroBcvRegime({
          bcvOfficialRate,
          parallelMarketRate,
          daysSinceLastIntervention,
          currentHourOfDayUtcMinus4,
          currentDayOfWeek,
          estimatedWeeklyBcvInjectionUsd,
        });

        return {
          success: true,
          skillName,
          data: regimeAssessment,
          executedAt: now,
        };
      }

      case 'optimize_treasury_idle_yield': {
        const totalUsdtInventory = requiredNumber(args, ['totalUsdtInventory', 'totalTreasuryUsdt'], 'saldo real de tesorería');
        const currentlyCommittedUsdt = requiredNumber(
          args,
          ['currentlyCommittedUsdt', 'operationalReserveUsdt'],
          'saldo realmente comprometido',
        );
        const marketVelocity = (args['marketVelocity'] || 'LOW_OFFPEAK') as any;
        const flexibleApyPct = requiredNumber(args, ['flexibleApyPct', 'minYieldApyPct'], 'tasa vigente publicada por la plataforma');
        const minimumSafetyBufferUsd = policyNumber(args, 'minimumSafetyBufferUsd', 2500);

        const allocation = calculateTreasuryYieldAllocation({
          totalUsdtInventory,
          currentlyCommittedUsdt,
          marketVelocity,
          flexibleApyPct,
          minimumSafetyBufferUsd,
        });

        return {
          success: true,
          skillName,
          data: allocation,
          executedAt: now,
        };
      }

      case 'compile_browser_operator_task': {
        const targetSite = (args['targetSite'] || 'BANESCO_PANAMA') as any;
        const action = (args['action'] || 'CHECK_BALANCE') as any;
        const referenceToVerify = args['referenceToVerify'] ? String(args['referenceToVerify']) : undefined;
        const expectedAmount = args['expectedAmount'] ? Number(args['expectedAmount']) : undefined;

        const task = compileBrowserOperatorTask({
          targetSite,
          action,
          referenceToVerify,
          expectedAmount,
        });

        return {
          success: true,
          skillName,
          data: task,
          executedAt: now,
        };
      }

      case 'execute_maker_laddering_plan': {
        const midPrice = requiredNumber(args, 'midPrice', SRC_LIVE_P2P_MID);
        const currentInventoryUsdt = requiredNumber(
          args,
          'currentInventoryUsdt',
          'inventario real de la cuenta (API del exchange / tesorería)',
        );
        const targetInventoryUsdt = requiredNumber(
          args,
          'targetInventoryUsdt',
          'inventario objetivo declarado por la mesa (declaración del operador, no un valor por defecto)',
        );

        const quotes = computeAvellanedaStoikovQuotes({
          midPrice,
          currentInventoryUsdt,
          targetInventoryUsdt,
          volatilityDaily: 0.02,
          timeRemainingFraction: 1.0,
        });

        return {
          success: true,
          skillName,
          data: {
            midPrice,
            currentInventoryUsdt,
            targetInventoryUsdt,
            makerQuotes: quotes,
          },
          executedAt: now,
        };
      }

      case 'balance_cross_exchange_inventory': {
        const binanceBalanceUsdt = requiredNumber(args, 'binanceBalanceUsdt', SRC_REAL_BALANCE);
        const bybitBalanceUsdt = requiredNumber(args, 'bybitBalanceUsdt', SRC_REAL_BALANCE);
        const onchainBalanceUsdt = requiredNumber(
          args,
          'onchainBalanceUsdt',
          'saldo real on-chain de la wallet de tesorería (API on-chain)',
        );
        const total = binanceBalanceUsdt + bybitBalanceUsdt + onchainBalanceUsdt;
        const targetPerVenue = total > 0 ? total / 3 : 0;

        const venues = [
          { name: 'BINANCE', current: binanceBalanceUsdt, diff: binanceBalanceUsdt - targetPerVenue },
          { name: 'BYBIT', current: bybitBalanceUsdt, diff: bybitBalanceUsdt - targetPerVenue },
          { name: 'ONCHAIN', current: onchainBalanceUsdt, diff: onchainBalanceUsdt - targetPerVenue },
        ];

        const rebalanceInstructions: string[] = [];
        const surplus = venues.filter((v) => v.diff > 50);
        const deficit = venues.filter((v) => v.diff < -50);

        for (const s of surplus) {
          for (const d of deficit) {
            const transfer = Math.min(s.diff, Math.abs(d.diff));
            if (transfer > 10) {
              rebalanceInstructions.push(`Transferir ${transfer.toFixed(2)} USDT desde ${s.name} hacia ${d.name}`);
            }
          }
        }

        return {
          success: true,
          skillName,
          data: {
            totalInventoryUsdt: total,
            targetPerVenueUsdt: targetPerVenue,
            venues,
            rebalanceNeeded: rebalanceInstructions.length > 0,
            rebalanceInstructions,
          },
          executedAt: now,
        };
      }

      case 'enforce_depeg_delta_hedge': {
        const inventoryVes = requiredNumber(args, 'inventoryVes', SRC_REAL_BALANCE);
        const currentPrice = requiredNumber(args, 'currentPrice', SRC_LIVE_PARALLEL_RATE);
        const hedgeRatioPct = policyNumber(args, 'hedgeRatioPct', 100);

        const inventoryUsd = currentPrice > 0 ? inventoryVes / currentPrice : 0;
        const targetHedgeUsd = inventoryUsd * (hedgeRatioPct / 100);

        return {
          success: true,
          skillName,
          data: {
            inventoryVes,
            currentPrice,
            inventoryEquivalentUsd: Number(inventoryUsd.toFixed(2)),
            hedgeRatioPct,
            recommendedShortFuturesUsd: Number(targetHedgeUsd.toFixed(2)),
            action: targetHedgeUsd > 10 ? 'OPEN_SHORT_PERP_HEDGE' : 'NO_HEDGE_REQUIRED',
            rationale: `Cobertura preventiva del ${hedgeRatioPct}% contra devaluación de bolívares.`,
          },
          executedAt: now,
        };
      }

      case 'audit_chargeback_shield': {
        const platform = String(args['platform'] || 'DEEL').toUpperCase();
        const amountUsd = requiredNumber(
          args,
          'amountUsd',
          'monto real de la operación a evaluar (invoice / payout de la plataforma de payroll)',
        );
        const isVerifiedContractor = Boolean(args['isVerifiedContractor']);

        let riskScore = 15;
        let holdPeriodHours = 0;
        const securityMeasures: string[] = [];

        if (platform === 'PAYPAL' || platform === 'STRIPE') {
          riskScore += 45;
          holdPeriodHours = 48;
          securityMeasures.push('Riesgo alto de contracargo bancario/friendly-fraud. Exigir KYC completo y espera de 48h.');
        } else if (platform === 'WISE') {
          riskScore += 25;
          holdPeriodHours = 12;
          securityMeasures.push('Verificar que la cuenta de origen pertenezca exactamente al mismo titular.');
        } else if (platform === 'DEEL' || platform === 'PAYONEER') {
          riskScore += 10;
          holdPeriodHours = 0;
          securityMeasures.push('Plataforma corporativa de payroll de bajo riesgo de reversión.');
        }

        if (!isVerifiedContractor) {
          riskScore += 30;
          securityMeasures.push('Contratista no verificado: solicitar contrato de servicios o invoice de plataforma.');
        }

        if (amountUsd > 3000) {
          riskScore += 15;
          securityMeasures.push('Ticket superior a $3,000: requiere aprobación de compliance y prueba de fondos.');
        }

        const riskLevel = riskScore >= 60 ? 'HIGH' : riskScore >= 35 ? 'MEDIUM' : 'LOW';

        return {
          success: true,
          skillName,
          data: {
            platform,
            amountUsd,
            isVerifiedContractor,
            riskScore: Math.min(100, riskScore),
            riskLevel,
            recommendedHoldPeriodHours: holdPeriodHours,
            securityMeasures,
            verdict: riskLevel === 'HIGH' ? 'REJECT_OR_ESCROW_48H' : 'APPROVED_FOR_ROUTING',
          },
          executedAt: now,
        };
      }

      case 'classify_and_price_client_tier': {
        const counterpartyId = String(args['counterpartyId'] || 'CP-GENERIC');
        const averageReleaseMinutes = requiredNumber(args, 'averageReleaseMinutes', SRC_COUNTERPARTY_TRACK_RECORD);
        const completedTradesCount = requiredNumber(args, 'completedTradesCount', SRC_COUNTERPARTY_TRACK_RECORD);
        const disputeCount = requiredNumber(args, 'disputeCount', SRC_COUNTERPARTY_TRACK_RECORD);
        const monthlyVolumeUsd = requiredNumber(args, 'monthlyVolumeUsd', SRC_COUNTERPARTY_TRACK_RECORD);

        const tier = classifyCounterpartyTier({
          counterpartyId,
          averageReleaseMinutes,
          completedTradesCount,
          disputeCount,
          monthlyVolumeUsd,
        });

        return {
          success: true,
          skillName,
          data: {
            counterpartyId,
            tier,
          },
          executedAt: now,
        };
      }

      case 'negotiate_whatsapp_order_intake': {
        const customerMessage = String(args['customerMessage'] || '');
        const activeRate = requiredNumber(args, 'activeRate', SRC_DESK_SELL_RATE);
        const bankName = String(args['bankName'] || 'Banesco');
        const accountDetails = String(args['accountDetails'] || '');

        const parsed = parseCustomerChatMessage(customerMessage);
        // The amount is whatever the customer actually wrote. Falling back to a
        // round number produced a quote for a trade the customer never asked
        // for, ready to be copied into WhatsApp.
        const orderAmountUsdt = requiredNumber(
          { detectedAmount: parsed.detectedAmount },
          'detectedAmount',
          'monto declarado por el cliente en su propio mensaje, o el monto confirmado explícitamente por el operador',
        );
        const totalVes = Number((orderAmountUsdt * activeRate).toFixed(2));

        const confirmationMsg = `✅ *COTIZACIÓN CONFIRMADA DE MESA P2P*\n` +
          `• Monto: *${orderAmountUsdt.toFixed(2)} USDT*\n` +
          `• Tasa Acordada: *${activeRate.toFixed(2)} VES/USDT*\n` +
          `• Total a transferir: *${totalVes.toLocaleString('es-VE')} VES*\n` +
          `• Banco Destino: *${bankName}*\n` +
          `• Datos de Cuenta: ${accountDetails}\n\n` +
          `⚠️ _Por favor adjunte el comprobante digital en este chat una vez emitido el pago._`;

        return {
          success: true,
          skillName,
          data: {
            orderAmountUsdt,
            activeRate,
            totalVes,
            bankName,
            parsedIntent: parsed.intent,
            confirmationMessage: confirmationMsg,
          },
          executedAt: now,
        };
      }

      case 'bundle_corporate_b2b_dossier': {
        const clientName = String(args['clientName'] || 'EMPRESA CLIENTE S.A.');
        const taxId = String(args['taxId'] || 'J-00000000-0');
        const amountUsd = requiredNumber(
          args,
          'amountUsd',
          'monto real de la factura (contrato / factura del cliente)',
        );
        const serviceCategory = String(args['serviceCategory'] || 'SERVICIOS_TECNOLOGICOS_CONSULTORIA');

        const invoiceId = `INV-${Date.now().toString(36).toUpperCase()}`;
        const dossier = {
          invoiceId,
          clientName,
          taxId,
          amountUsd,
          serviceCategory,
          status: 'COMPLIANCE_READY',
          generatedTimestamp: new Date().toISOString(),
          fiscalNotes: 'Documentación mercantil de soporte para liquidación bancaria y justificación cambiaria.',
          complianceChecklist: [
            'Verificación KYC corporativo y RIF vigente',
            'Contrato marco de prestación de servicios tecnológicos',
            'Factura digital con desglose de honorarios e IVA exento según ley',
            'Trazabilidad de billetera y liquidación bancaria en cuenta nacional/internacional',
          ],
        };

        return {
          success: true,
          skillName,
          data: dossier,
          executedAt: now,
        };
      }

      case 'compile_fast_dispute_evidence': {
        const orderId = String(args['orderId'] || 'P2P-ORD-000');
        const counterpartyName = String(args['counterpartyName'] || 'Contraparte');
        const disputeReason = String(args['disputeReason'] || 'Tercero no autorizado / Falta de pago');
        const claimedAmount = requiredNumber(
          args,
          'claimedAmount',
          'monto real reclamado (order en disputa / comprobante del operador)',
        );
        const parallelRate = requiredNumber(args, 'parallelRate', SRC_LIVE_PARALLEL_RATE);

        const dossier = buildDisputeDossier({
          orderId,
          orderAmountFiat: claimedAmount,
          orderAmountCrypto: claimedAmount / parallelRate,
          fiatCurrency: 'VES',
          cryptoAsset: 'USDT',
          counterpartyBinanceName: counterpartyName,
          bankPayerName: 'Tercero Desconocido',
          bankName: 'BANESCO',
          bankReference: '99887766',
          bankPaymentTimestamp: Date.now(),
          orderCreatedTimestamp: Date.now() - 600000,
          fraudAudit: {
            orderId,
            overallScore: 85,
            riskLevel: 'CRITICAL',
            nameMatch: {
              score: 0.15,
              isMatch: false,
              normalizedA: counterpartyName,
              normalizedB: 'TERCERO DESCONOCIDO',
              matchedTokens: [],
              missingTokens: ['TERCERO'],
            },
            referenceValidation: {
              isValid: true,
              bank: 'BANESCO',
              reference: '99887766',
              expectedFormat: '8 dígitos',
            },
            amountDifference: 0,
            summaryHeadline: `ALERTA DE SEGURIDAD: ${disputeReason}`,
            auditDetails: [`Motivo: ${disputeReason}`],
            disputeTemplateText: `[RECLAMO FORMAL P2P - ORDEN #${orderId}]\nEstimado soporte de Binance: Se abre disputa formal contra ${counterpartyName}. Motivo: ${disputeReason}.`,
            flags: ['THIRD_PARTY_PAYER'],
            recommendation: 'LOCK_AND_DISPUTE',
          },
        });

        return {
          success: true,
          skillName,
          data: dossier,
          executedAt: now,
        };
      }

      case 'quote_instant_remittance_corridor': {
        const corridorId = String(args['corridorId'] || 'USD_ZELLE_TO_VES');
        const sendAmount = requiredNumber(
          args,
          ['sendAmount', 'amount'],
          'monto real que el cliente quiere enviar (solicitud del cliente / orden creada)',
        );
        const deskSpreadPct = policyNumber(
          args,
          'deskSpreadPct',
          policyNumber(args, 'operatorMarginPct', 2.5),
        );

        const activeRate = requiredNumber(args, 'activeRate', SRC_DESK_SELL_RATE);

        const quote = calculateRemittanceQuote({
          corridorId,
          calculationMode: 'BY_SEND_AMOUNT',
          amount: sendAmount,
          originCryptoRate: 1.0,
          destCryptoRate: activeRate,
          operatorMarginPct: deskSpreadPct,
        });

        const whatsappMessage = formatRemittanceWhatsAppMessage(quote);

        return {
          success: true,
          skillName,
          data: {
            ...quote,
            whatsappFormattedMessage: whatsappMessage,
          },
          executedAt: now,
        };
      }

      case 'execute_preemptive_bcv_drain': {
        const currentVesBalance = requiredNumber(args, 'currentVesBalance', 'saldo real en VES del operador');
        const bcvInterventionProbabilityPct = requiredNumber(
          args,
          'bcvInterventionProbabilityPct',
          'probabilidad de intervención (no hay modelo BCV calibrado en este sistema)',
        );

        const urgency = bcvInterventionProbabilityPct >= 75 ? 'CRITICAL' : bcvInterventionProbabilityPct >= 50 ? 'HIGH' : 'MODERATE';
        const drainRatio = bcvInterventionProbabilityPct >= 75 ? 0.90 : bcvInterventionProbabilityPct >= 50 ? 0.65 : 0.40;
        const targetDrainVes = currentVesBalance * drainRatio;

        return {
          success: true,
          skillName,
          data: {
            currentVesBalance,
            bcvInterventionProbabilityPct,
            probabilityBasis: 'HEURISTIC_UNCALIBRATED',
            isVerifiedIntervention: false,
            urgency,
            recommendedDrainVes: targetDrainVes,
            recommendedAction: `Escenario simulado: si se asignara ${(drainRatio * 100).toFixed(0)}% del saldo a USDT, serían ${targetDrainVes.toLocaleString('es-VE')} VES. La probabilidad provista es una heurística sin calibrar y NO confirma ninguna intervención del BCV ni cierre de mesa.`,
            actionable: false,
            preferredChannels: ['PAGO_MOVIL_INMEDIATO', 'BANESCO_TRANSFERENCIA_DIRECTA'],
          },
          expectedSource: 'probabilidad de intervención (no hay modelo BCV calibrado en este sistema)',
          actionable: false,
          executedAt: now,
        };
      }

      case 'evaluate_emergency_killswitch': {
        const reason = String(args['reason'] || 'Anomalía crítica de mercado');
        const anomalySeverity = (args['anomalySeverity'] || 'HIGH') as any;

        const killswitchActivated = anomalySeverity === 'HIGH' || anomalySeverity === 'CRITICAL';

        return {
          success: true,
          skillName,
          data: {
            killswitchActivated,
            anomalySeverity,
            reason,
            actionsTriggered: killswitchActivated
              ? ['PAUSE_ALL_P2P_ADS', 'CANCEL_OPEN_MAKER_OFFERS', 'FREEZE_AUTOMATED_TRANSFERS', 'SEND_CRITICAL_TELEGRAM_ALERT']
              : ['LOG_WARNING', 'NOTIFY_RISK_MANAGER'],
            unpauseRequirement: 'Revisión manual y confirmación de operador humano antes de reanudar actividad.',
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
    if (err instanceof MissingEvidenceError) {
      return {
        success: false,
        skillName,
        data: null,
        error: err.message,
        unavailableReason: `missing_evidence:${err.field}`,
        expectedSource: err.expectedSource,
        actionable: false,
        executedAt: now,
      };
    }
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
  esSimulado?: boolean;
  isSimulated?: boolean;
}

export interface CopilotChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  plan?: StrategyPlanCard;
  provenance?: ProvenanceMetadata;
}

export type ExecutionProvenance = 'gemini' | 'deterministic' | 'heuristic' | 'simulated';

export type MarketFeedReason = 'LIVE' | 'NO_BOOK' | 'STALE_BOOK' | 'INCOMPLETE_BOOK';

export interface ProvenanceMetadata {
  source: ExecutionProvenance;
  model?: string;
  provenanceId: string;
  timestamp: number;
  fallbackReason?: string;
  liveMarketFeedConnected?: boolean;
  esSimulado?: boolean;
  stepsCount?: number;
  maxSteps?: number;
  apiCallsCount?: number;
  /** Why the feed is or is not live. Makes a stale book distinguishable from a missing one. */
  marketFeedReason?: MarketFeedReason;
  /** Human-readable provenance shown to the operator, e.g. "[sin feed: libro vencido (12 min)]". */
  marketFeedNote?: string;
  /** True when this turn stopped at a turn-level paid-call budget. */
  budgetExhausted?: boolean;
  /** Paid Gemini calls made this turn, as an enforced budget rather than a report. */
  paidCallsThisTurn?: number;
  /** Hard ceiling for paid calls in a single user turn. */
  paidCallsBudget?: number;
}

export interface CopilotResponse {
  reply: string;
  suggestedPlan?: StrategyPlanCard;
  skillsExecuted?: string[];
  learningsGenerated?: string[];
  provenance?: ProvenanceMetadata;
}
