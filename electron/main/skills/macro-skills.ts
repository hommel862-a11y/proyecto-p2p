/**
 * Macro Intelligence Skills: BCV Interventions, Liquidity Drains, Fiat Flight & Game Theory.
 */

import type { AgentSkillDefinition, FinancialSkillResult } from './types';
import {
  getBcvMarketIntelligence,
  forecastCentralBankLiquidityDrain,
  monitorFiatFlightAndDollarizationVelocity,
  simulateGameTheoryNashRepricing,
} from '../vendor/p2p-core/bcv-intervention-predictor';

export const MACRO_SKILLS_DEFINITIONS: AgentSkillDefinition[] = [
  {
    name: 'predict_bcv_market_intelligence',
    description:
      'Calcula la brecha cambiaria entre dólar BCV oficial y paralelo y evalúa el ciclo semanal de inyección bancaria.',
    parameters: {
      type: 'OBJECT',
      properties: {
        parallelRate: {
          type: 'NUMBER',
          description: 'Tasa promedio de venta en mercado paralelo P2P (VES/USD).',
        },
        bcvRate: {
          type: 'NUMBER',
          description: 'Tasa de cambio oficial publicada por el BCV (VES/USD).',
        },
      },
      required: ['parallelRate', 'bcvRate'],
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
];

export function dispatchMacroSkill(
  skillName: string,
  args: Record<string, unknown>,
  now: number,
): FinancialSkillResult | null {
  switch (skillName) {
    case 'predict_bcv_market_intelligence': {
      const parallel = Number(args['parallelRate']) || 0;
      const bcv = Number(args['bcvRate']) || 0;
      const intel = getBcvMarketIntelligence(parallel, bcv);
      return {
        success: true,
        skillName,
        data: {
          ...intel,
          engine: 'core/lib/bcv-intervention-predictor#getBcvMarketIntelligence',
        },
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
      return null;
  }
}
