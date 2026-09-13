/**
 * Financial Agent Skills Hub & Function Calling Declarations.
 * Wraps pure deterministic core functions (Triangular Arbitrage, BCV Predictor,
 * Orderbook Microstructure, and Operator Manager) into structured schemas
 * for Gemini Function Calling and multi-agent execution.
 * 0 framework dependencies.
 */

import { calculateTriangularArbitrage, type ExchangeLeg } from './triangular-arbitrage';
import { getBcvMarketIntelligence } from './bcv-intervention-predictor';
import { computeMicrostructureSanitizedDepth, OrderPersistenceTracker } from './orderbook-microstructure';
import type { BinanceOfferSummary } from './binance-p2p';
import { evaluateGoldenSpread, buildTeamAllocationPlan, type OperatorProfile } from './operator-manager';

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

