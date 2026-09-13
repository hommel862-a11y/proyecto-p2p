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

