/**
 * Binance Earn Vault & Treasury Optimization Skills: Simple Earn, Dual Investment, Launchpool & Liquidity Ladders.
 */

import type { AgentSkillDefinition, FinancialSkillResult } from './types';
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
} from '../vendor/p2p-core/binance-earn-vault';

export const EARN_SKILLS_DEFINITIONS: AgentSkillDefinition[] = [
  {
    name: 'optimize_idle_capital_simple_earn',
    description: 'Modela y optimiza el rendimiento del capital inactivo en Binance Simple Earn Flexible (tasa APR base + bonus por tramos hasta 500 USDT/FDUSD) para evitar costo de oportunidad de inventario detenido.',
    parameters: {
      type: 'OBJECT',
      properties: {
        capitalUsdt: { type: 'NUMBER', description: 'Monto total en USDT a colocar en Simple Earn.' },
        tier1LimitUsdt: { type: 'NUMBER', description: 'Límite del tramo promocional Tier 1 (default 500 USDT).' },
        tier1AprPct: { type: 'NUMBER', description: 'Tasa APR del Tier 1 en porcentaje (ej. 10.0).' },
        tier2AprPct: { type: 'NUMBER', description: 'Tasa APR base para excedentes en porcentaje (ej. 2.0).' },
        holdingDays: { type: 'NUMBER', description: 'Días proyectados de retención.' },
      },
      required: ['capitalUsdt', 'tier1AprPct', 'tier2AprPct'],
    },
  },
  {
    name: 'evaluate_dual_investment_p2p_exit',
    description: 'Evalúa la estrategia "Sell High" en Binance Dual Investment para fijar salidas con strike price por encima del spot mientras se captura un APR elevado, cubriendo inventario ocioso.',
    parameters: {
      type: 'OBJECT',
      properties: {
        currentSpotPrice: { type: 'NUMBER', description: 'Precio actual spot del criptoactivo.' },
        strikePrice: { type: 'NUMBER', description: 'Precio objetivo de salida (strike price).' },
        durationDays: { type: 'NUMBER', description: 'Duración del producto estructurado en días.' },
        annualizedAprPct: { type: 'NUMBER', description: 'Tasa APR anualizada del producto (ej. 25.0).' },
        investedCapitalUsdt: { type: 'NUMBER', description: 'Capital colocado en el contrato.' },
      },
      required: ['currentSpotPrice', 'strikePrice', 'durationDays', 'annualizedAprPct', 'investedCapitalUsdt'],
    },
  },
  {
    name: 'calculate_usdt_fdusd_yield_arbitrage',
    description: 'Compara el APR y la paridad de tipos entre USDT y FDUSD en Binance Earn para maximizar el carry de tesorería y determinar breakeven de conversión.',
    parameters: {
      type: 'OBJECT',
      properties: {
        usdtBalance: { type: 'NUMBER', description: 'Saldo en USDT.' },
        fdusdBalance: { type: 'NUMBER', description: 'Saldo en FDUSD.' },
        usdtFlexibleAprPct: { type: 'NUMBER', description: 'APR flexible de USDT en porcentaje.' },
        fdusdFlexibleAprPct: { type: 'NUMBER', description: 'APR flexible de FDUSD en porcentaje.' },
        usdtFdusdMarketRate: { type: 'NUMBER', description: 'Tasa de cambio de mercado USDT/FDUSD (ej. 1.0001).' },
        swapFeePct: { type: 'NUMBER', description: 'Comisión de swap spot en porcentaje (0 si hay promo).' },
        plannedHorizonDays: { type: 'NUMBER', description: 'Horizonte de inversión planificado en días.' },
      },
      required: ['usdtBalance', 'fdusdBalance', 'usdtFlexibleAprPct', 'fdusdFlexibleAprPct'],
    },
  },
  {
    name: 'model_launchpool_capital_parking',
    description: 'Modela el rendimiento esperado de stakear BNB, FDUSD o USDT en Launchpool durante pausas operativas del P2P para capturar tokens nuevos y proyectar el APY implícito.',
    parameters: {
      type: 'OBJECT',
      properties: {
        capitalUsdt: { type: 'NUMBER', description: 'Capital a stakear en USDT o valor equivalente.' },
        stakedAsset: { type: 'STRING', enum: ['BNB', 'FDUSD', 'USDT'], description: 'Activo a stakear.' },
        launchpoolDurationDays: { type: 'NUMBER', description: 'Duración total del Launchpool en días.' },
        totalPoolStaked: { type: 'NUMBER', description: 'Monto total stakeado en el pool por todos los participantes.' },
        dailyRewardPoolTokens: { type: 'NUMBER', description: 'Tokens distribuidos por día en el pool.' },
        estimatedTokenListingPriceUsdt: { type: 'NUMBER', description: 'Precio estimado de listado del nuevo token.' },
        alternativeEarnAprPct: { type: 'NUMBER', description: 'Tasa alternativa en Simple Earn.' },
      },
      required: ['capitalUsdt', 'stakedAsset', 'launchpoolDurationDays', 'totalPoolStaked', 'dailyRewardPoolTokens', 'estimatedTokenListingPriceUsdt'],
    },
  },
  {
    name: 'optimize_locked_vs_flexible_liquidity_ladder',
    description: 'Construye una escalera de liquidez dividiendo el capital entre Simple Earn Flexible (D+0 para atender picos de órdenes P2P) y tramos locked para maximizar APR sin estrangular liquidez.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalTreasuryUsdt: { type: 'NUMBER', description: 'Tesorería total en USDT.' },
        dailyP2pVolumeUsdt: { type: 'NUMBER', description: 'Volumen diario promedio operado en P2P.' },
        p2pTurnoverDays: { type: 'NUMBER', description: 'Días promedio de ciclo de rotación completa.' },
        flexibleAprPct: { type: 'NUMBER', description: 'APR del producto flexible.' },
        locked30dAprPct: { type: 'NUMBER', description: 'APR del producto bloqueado a 30 días.' },
        locked60dAprPct: { type: 'NUMBER', description: 'APR del producto bloqueado a 60 días.' },
        safetyBufferPct: { type: 'NUMBER', description: 'Margen de seguridad porcentual sobre el volumen operativo.' },
      },
      required: ['totalTreasuryUsdt', 'dailyP2pVolumeUsdt', 'p2pTurnoverDays', 'flexibleAprPct', 'locked30dAprPct', 'locked60dAprPct'],
    },
  },
  {
    name: 'calculate_earn_yield_vs_p2p_hurdle_rate',
    description: 'Calcula la tasa de corte (Hurdle Rate) comparando el rendimiento por hora del spread neto P2P contra el rendimiento pasivo libre de riesgo de Binance Simple Earn.',
    parameters: {
      type: 'OBJECT',
      properties: {
        grossP2pSpreadPct: { type: 'NUMBER', description: 'Spread bruto observado en el libro P2P.' },
        platformFeePct: { type: 'NUMBER', description: 'Comisión del exchange P2P.' },
        bankingRiskPremiumPct: { type: 'NUMBER', description: 'Prima por fricción bancaria y comisiones de transferencia.' },
        fxDevaluationRiskPct: { type: 'NUMBER', description: 'Riesgo devaluatorio estimado durante el ciclo.' },
        averageTradeCycleHours: { type: 'NUMBER', description: 'Horas promedio que toma completar un ciclo compra-venta.' },
        simpleEarnAprPct: { type: 'NUMBER', description: 'Tasa APR pasiva libre de riesgo en Binance Simple Earn.' },
      },
      required: ['grossP2pSpreadPct', 'platformFeePct', 'bankingRiskPremiumPct', 'fxDevaluationRiskPct', 'averageTradeCycleHours', 'simpleEarnAprPct'],
    },
  },
  {
    name: 'model_bnb_vault_yield_stacking',
    description: 'Modela la acumulación de recompensas multi-capa en BNB Vault (Launchpool automático, Simple Earn Flexible y airdrops de HODLer).',
    parameters: {
      type: 'OBJECT',
      properties: {
        bnbAmount: { type: 'NUMBER', description: 'Cantidad total de BNB en tenencia.' },
        bnbPriceUsdt: { type: 'NUMBER', description: 'Precio actual del BNB en USDT.' },
        simpleEarnAprPct: { type: 'NUMBER', description: 'APR base de Simple Earn Flexible para BNB.' },
        activeLaunchpoolsCount: { type: 'NUMBER', description: 'Cantidad de Launchpools activos concurrentes.' },
        averageLaunchpoolAprPct: { type: 'NUMBER', description: 'APR promedio histórico de Launchpool.' },
        hodlerAirdropProjectedAprPct: { type: 'NUMBER', description: 'APR proyectado por airdrops a poseedores.' },
      },
      required: ['bnbAmount', 'bnbPriceUsdt', 'simpleEarnAprPct', 'activeLaunchpoolsCount', 'averageLaunchpoolAprPct'],
    },
  },
  {
    name: 'forecast_flexible_earn_tier_saturation',
    description: 'Predice el punto de saturación y degradación del APR en Simple Earn Flexible cuando el balance supera los tramos subvencionados, recomendando dispersión a subcuentas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        totalCapitalUsdt: { type: 'NUMBER', description: 'Capital total a colocar.' },
        tier1LimitPerAccountUsdt: { type: 'NUMBER', description: 'Límite Tier 1 por cuenta (ej. 500 USDT).' },
        tier1AprPct: { type: 'NUMBER', description: 'APR promocional Tier 1.' },
        tier2AprPct: { type: 'NUMBER', description: 'APR degradado Tier 2.' },
        availableSubaccountsCount: { type: 'NUMBER', description: 'Número de subcuentas corporativas disponibles.' },
      },
      required: ['totalCapitalUsdt', 'tier1AprPct', 'tier2AprPct'],
    },
  },
  {
    name: 'calculate_auto_invest_dca_spread_funnel',
    description: 'Diseña un embudo de reinversión automática (Auto-Invest DCA) utilizando las ganancias netas del spread P2P para acumular criptoactivos sin descapitalizar la tesorería operativa.',
    parameters: {
      type: 'OBJECT',
      properties: {
        monthlyP2pNetProfitUsdt: { type: 'NUMBER', description: 'Beneficio neto mensual generado por la mesa P2P.' },
        reinvestmentRatioPct: { type: 'NUMBER', description: 'Porcentaje de la ganancia a reinvertir (ej. 25%).' },
        targetAsset: { type: 'STRING', enum: ['BTC', 'ETH', 'BNB', 'SOL'], description: 'Activo objetivo de acumulación.' },
        projectedAnnualAssetGrowthPct: { type: 'NUMBER', description: 'Crecimiento anual proyectado del activo.' },
        executionFrequency: { type: 'STRING', enum: ['DAILY', 'WEEKLY', 'BIWEEKLY'], description: 'Frecuencia de DCA en Auto-Invest.' },
      },
      required: ['monthlyP2pNetProfitUsdt', 'reinvestmentRatioPct', 'targetAsset', 'executionFrequency'],
    },
  },
  {
    name: 'simulate_earn_instant_redemption_latency',
    description: 'Simula el impacto temporal y límites de retiro inmediato (Instant Redemption Quota) en Binance Simple Earn para asegurar disponibilidad antes de liberar órdenes P2P.',
    parameters: {
      type: 'OBJECT',
      properties: {
        redemptionAmountUsdt: { type: 'NUMBER', description: 'Monto que se necesita retirar de Simple Earn.' },
        dailyInstantQuotaUsdt: { type: 'NUMBER', description: 'Límite diario de rescate instantáneo de la cuenta.' },
        dailyQuotaConsumedUsdt: { type: 'NUMBER', description: 'Cuota instantánea ya utilizada en las últimas 24h.' },
        averageSlippageOrDelayHours: { type: 'NUMBER', description: 'Tiempo estimado de demora en caso de standard redemption.' },
      },
      required: ['redemptionAmountUsdt'],
    },
  },
];

export function dispatchEarnSkill(
  skillName: string,
  args: Record<string, unknown>,
  now: number,
): FinancialSkillResult | null {
  switch (skillName) {
    case 'optimize_idle_capital_simple_earn': {
      const capitalUsdt = Number(args['capitalUsdt'] || 0);
      const tier1LimitUsdt = args['tier1LimitUsdt'] !== undefined ? Number(args['tier1LimitUsdt']) : 500;
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
      const usdtFdusdMarketRate = args['usdtFdusdMarketRate'] !== undefined ? Number(args['usdtFdusdMarketRate']) : 1.0;
      const swapFeePct = args['swapFeePct'] !== undefined ? Number(args['swapFeePct']) : 0;
      const plannedHorizonDays = args['plannedHorizonDays'] !== undefined ? Number(args['plannedHorizonDays']) : 30;

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
      const stakedAsset = (args['stakedAsset'] === 'BNB' || args['stakedAsset'] === 'FDUSD' ? args['stakedAsset'] : 'USDT') as 'BNB' | 'FDUSD' | 'USDT';
      const launchpoolDurationDays = Number(args['launchpoolDurationDays'] || 4);
      const totalPoolStaked = Number(args['totalPoolStaked'] || 100000000);
      const dailyRewardPoolTokens = Number(args['dailyRewardPoolTokens'] || 200000);
      const estimatedTokenListingPriceUsdt = Number(args['estimatedTokenListingPriceUsdt'] || 2.0);
      const alternativeEarnAprPct = args['alternativeEarnAprPct'] !== undefined ? Number(args['alternativeEarnAprPct']) : 2.5;

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
      const safetyBufferPct = args['safetyBufferPct'] !== undefined ? Number(args['safetyBufferPct']) : 30;

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
      const hodlerAirdropProjectedAprPct = args['hodlerAirdropProjectedAprPct'] !== undefined ? Number(args['hodlerAirdropProjectedAprPct']) : 3.5;

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
      const tier1LimitPerAccountUsdt = args['tier1LimitPerAccountUsdt'] !== undefined ? Number(args['tier1LimitPerAccountUsdt']) : 500;
      const tier1AprPct = Number(args['tier1AprPct'] || 10.0);
      const tier2AprPct = Number(args['tier2AprPct'] || 2.0);
      const availableSubaccountsCount = args['availableSubaccountsCount'] !== undefined ? Number(args['availableSubaccountsCount']) : 3;

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
      const projectedAnnualAssetGrowthPct = args['projectedAnnualAssetGrowthPct'] !== undefined ? Number(args['projectedAnnualAssetGrowthPct']) : 15;
      const executionFrequency = (args['executionFrequency'] || 'WEEKLY') as 'DAILY' | 'WEEKLY' | 'BIWEEKLY';

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
      const dailyInstantQuotaUsdt = args['dailyInstantQuotaUsdt'] !== undefined ? Number(args['dailyInstantQuotaUsdt']) : 1000000;
      const dailyQuotaConsumedUsdt = args['dailyQuotaConsumedUsdt'] !== undefined ? Number(args['dailyQuotaConsumedUsdt']) : 0;
      const averageSlippageOrDelayHours = args['averageSlippageOrDelayHours'] !== undefined ? Number(args['averageSlippageOrDelayHours']) : 0.1;

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

    default:
      return null;
  }
}
