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
