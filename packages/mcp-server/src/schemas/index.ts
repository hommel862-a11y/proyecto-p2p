import { z } from 'zod';

/**
 * Zod schemas for MCP Tool inputs and outputs.
 * Strict validation with descriptive error boundaries.
 */

export const CalculateSpreadInputSchema = z.object({
  buyPrice: z.number().positive('El precio de compra debe ser mayor a 0'),
  sellPrice: z.number().positive('El precio de venta debe ser mayor a 0'),
  makerFeePct: z.number().min(0).default(0),
  takerFeePct: z.number().min(0).default(0),
});
export type CalculateSpreadInput = z.infer<typeof CalculateSpreadInputSchema>;

export const EvaluateTradeRiskInputSchema = z.object({
  tradeAmountUsdt: z.number().positive('El monto a operar debe ser mayor a 0 USDT'),
  fiatCurrency: z.enum(['VES', 'COP', 'USD']).default('VES'),
  counterpartyScore: z.number().min(0).max(100).default(100),
  currentCapitalUsdt: z.number().positive().default(5000),
});
export type EvaluateTradeRiskInput = z.infer<typeof EvaluateTradeRiskInputSchema>;

export const SimulateTradeImpactInputSchema = z.object({
  proposedTradeAmountUsdt: z.number().positive('El monto propuesto debe ser mayor a 0'),
  currentExposureUsdt: z.number().min(0).default(0),
  maxDailyExposureLimitUsdt: z.number().positive().default(2000),
  consecutiveLosses: z.number().min(0).default(0),
});
export type SimulateTradeImpactInput = z.infer<typeof SimulateTradeImpactInputSchema>;

export const ConsultZkMarketMeshInputSchema = z.object({
  rawIdentifier: z.string().min(3, 'Identificador demasiado corto'),
  saltDomain: z.string().optional(),
});
export type ConsultZkMarketMeshInput = z.infer<typeof ConsultZkMarketMeshInputSchema>;

export const ForecastVolatilityWindowInputSchema = z.object({
  parallelRate: z.number().positive(),
  bcvRate: z.number().positive(),
  currentSpreadPct: z.number().default(1.2),
  askDepthUsdt: z.number().min(0).default(5000),
  bidDepthUsdt: z.number().min(0).default(4500),
});
export type ForecastVolatilityWindowInput = z.infer<typeof ForecastVolatilityWindowInputSchema>;

export const CalculateDeltaNeutralHedgeInputSchema = z.object({
  vesBalance: z.number().positive(),
  usdtReferencePrice: z.number().positive(),
  targetHedgePct: z.number().min(10).max(100).default(100),
});
export type CalculateDeltaNeutralHedgeInput = z.infer<typeof CalculateDeltaNeutralHedgeInputSchema>;

export const TriggerKillswitchInputSchema = z.object({
  reason: z.string().min(3, 'Se requiere un motivo detallado'),
  source: z.string().default('MCP_CLIENT'),
  humanConfirm: z.boolean({ message: 'humanConfirm es requerido (Human-in-the-loop)' }),
  confirmToken: z.string().optional(),
});
export type TriggerKillswitchInput = z.infer<typeof TriggerKillswitchInputSchema>;

export const AddOperationEntryInputSchema = z.object({
  side: z.enum(['buy', 'sell']),
  vesAmount: z.number().min(0),
  usdtAmount: z.number().min(0),
  price: z.number().positive(),
  notes: z.string().optional(),
  counterpartyName: z.string().optional(),
  humanConfirm: z.boolean({ message: 'humanConfirm es requerido (Human-in-the-loop)' }),
  confirmToken: z.string().optional(),
});
export type AddOperationEntryInput = z.infer<typeof AddOperationEntryInputSchema>;

// --- Phase 2: Venezuelan Rates & BCV Monitoring ---

export const GetBcvRatesInputSchema = z.object({
  cacheFallback: z.boolean().default(true),
});
export type GetBcvRatesInput = z.infer<typeof GetBcvRatesInputSchema>;

export const GetParallelRatesInputSchema = z.object({
  includeSources: z.array(z.string()).optional(),
});
export type GetParallelRatesInput = z.infer<typeof GetParallelRatesInputSchema>;

export const CalculateRateGapInputSchema = z.object({
  parallelRate: z.number().positive('La tasa paralela debe ser mayor a 0'),
  bcvRate: z.number().positive('La tasa BCV debe ser mayor a 0'),
});
export type CalculateRateGapInput = z.infer<typeof CalculateRateGapInputSchema>;

export const CheckBcvInterventionWindowInputSchema = z.object({
  testTimestamp: z.string().optional(),
});
export type CheckBcvInterventionWindowInput = z.infer<typeof CheckBcvInterventionWindowInputSchema>;

export const AutofillTradeReferenceInputSchema = z.object({
  side: z.enum(['BUY', 'SELL']),
  targetMarginPct: z.number().min(0).max(50).default(1.0),
  fallbackRate: z.number().positive().optional(),
});
export type AutofillTradeReferenceInput = z.infer<typeof AutofillTradeReferenceInputSchema>;

// --- Phase 3: Crypto Market Data & Microstructure (p2p-crypto-market) ---

export const GetBinanceP2POrderbookInputSchema = z.object({
  fiat: z.string().default('VES'),
  asset: z.string().default('USDT'),
  rows: z.number().int().min(1).max(50).default(10),
});
export type GetBinanceP2POrderbookInput = z.infer<typeof GetBinanceP2POrderbookInputSchema>;

export const DetectUsdtDepegInputSchema = z.object({
  spotUsdtPrice: z.number().positive().default(1.000),
  thresholdPct: z.number().positive().max(5.0).default(0.2),
});
export type DetectUsdtDepegInput = z.infer<typeof DetectUsdtDepegInputSchema>;

export const RecommendCompetitivePricingInputSchema = z.object({
  side: z.enum(['BUY', 'SELL']),
  strategy: z.enum(['TOP_1', 'TOP_2', 'TOP_3', 'MATCH']).default('TOP_1'),
  stepVes: z.number().min(0.001).default(0.01),
  targetMarginPct: z.number().min(0.1).max(20.0).default(1.0),
  breakEvenPrice: z.number().positive().optional(),
  currentMarketMid: z.number().positive().optional(),
});
export type RecommendCompetitivePricingInput = z.infer<typeof RecommendCompetitivePricingInputSchema>;

export const AnalyzeOrderbookPressureInputSchema = z.object({
  fiat: z.string().default('VES'),
  bidDepthUsdt: z.number().min(0).default(15000),
  askDepthUsdt: z.number().min(0).default(12000),
  includeSpoofCheck: z.boolean().default(true),
});
export type AnalyzeOrderbookPressureInput = z.infer<typeof AnalyzeOrderbookPressureInputSchema>;

// --- Phase 4: Portfolio Management & Risk Stress Testing (p2p-portfolio-risk) ---

export const StressTestPortfolioInputSchema = z.object({
  usdtCapital: z.number().min(0).default(5000),
  vesCapital: z.number().min(0).default(150000),
  referenceRate: z.number().positive().default(79.5),
  devaluationScenariosPct: z.array(z.number().positive()).optional().default([5, 10, 20]),
  hedgedPct: z.number().min(0).max(100).default(0),
});
export type StressTestPortfolioInput = z.infer<typeof StressTestPortfolioInputSchema>;

export const RebalanceCapitalAllocationInputSchema = z.object({
  totalCapitalUsdt: z.number().positive().default(10000),
  referenceRate: z.number().positive().default(79.5),
  riskMode: z.enum(['CONSERVATIVE', 'AGGRESSIVE', 'BALANCED']).default('BALANCED'),
  hourOfDay: z.number().int().min(0).max(23).optional(),
});
export type RebalanceCapitalAllocationInput = z.infer<typeof RebalanceCapitalAllocationInputSchema>;

export const AuditCounterpartyExposureInputSchema = z.object({
  counterpartyAlias: z.string().optional(),
  historicalTradesCount: z.number().int().min(5).max(500).default(25),
  disputeThresholdPct: z.number().min(1).max(50).default(5.0),
  maxConcentrationPct: z.number().min(5).max(100).default(20.0),
});
export type AuditCounterpartyExposureInput = z.infer<typeof AuditCounterpartyExposureInputSchema>;

export const ProjectCompoundRunwayInputSchema = z.object({
  initialCapitalUsdt: z.number().positive().default(5000),
  netMarginPctPerCycle: z.number().positive().max(10).default(0.8),
  cyclesPerDay: z.number().positive().max(10).default(1.5),
  operationalDays: z.number().int().min(7).max(365).default(60),
  reinvestmentRatePct: z.number().min(0).max(100).default(100),
  monthlyFixedExpensesUsdt: z.number().min(0).default(300),
  dailyBankLimitVes: z.number().positive().optional().default(1500000),
});
export type ProjectCompoundRunwayInput = z.infer<typeof ProjectCompoundRunwayInputSchema>;



