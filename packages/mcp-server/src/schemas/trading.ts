/**
 * Zod 4 Schemas — Tipos de trading P2P para MCP tools.
 * Validación estricta en runtime + tipos TypeScript inferidos.
 */

import { z } from 'zod';

// ─── Enums base ───
export const AssetSchema = z.enum(['USDT', 'BTC', 'ETH', 'USDC', 'BNB']);
export const FiatSchema = z.enum(['VES', 'COP', 'ARS', 'PEN', 'MXN']);
export const SideSchema = z.enum(['BUY', 'SELL']);
export const BankSchema = z.enum([
  'Banesco',
  'Mercantil',
  'Venezuela',
  'BOD',
  'Provincial',
  'BFC',
  'Caroni',
  'Exterior',
  'DelSur',
  'Tesoro',
]);
export const RiskProfileSchema = z.enum(['conservative', 'moderate', 'aggressive']);
export const VerdictSchema = z.enum(['ALLOW', 'DENY', 'PAUSE']);
export const AnomalyTypeSchema = z.enum(['spoofing', 'phantom_liquidity', 'iceberg', 'none']);
export const RegulationScenarioSchema = z.enum([
  'BCV_5_PERCENT',
  'BCV_10_PERCENT',
  'BCV_15_PERCENT',
  'BCV_20_PERCENT',
  'NEW_RESOLUTION',
  'BANK_BLOCKED',
]);
export const RiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const TradeOutcomeResultSchema = z.enum([
  'PROFIT',
  'LOSS',
  'BREAKEVEN',
  'DISPUTE',
  'CANCELLED',
  'PENDING',
]);
export const KillSwitchSourceSchema = z.enum([
  'MANUAL',
  'MCP_TOOL',
  'MCP_AGENT',
  'REVIEW_GATE',
  'BENCH_AGENT',
  'HOTKEY',
  'UI_BUTTON',
  'SYSTEM',
]);
export const RiskViolationSchema = z.enum([
  'EXPOSURE_CAP',
  'DAILY_LOSS_LIMIT',
  'LOSS_STREAK',
  'WIN_RATE_THRESHOLD',
  'POSITION_SIZE',
  'COUNTERPARTY_RISK',
  'BANK_RISK',
  'MARKET_ANOMALY',
  'REGULATION_CHANGE',
  'KILL_SWITCH_ACTIVE',
]);

// ─── Tipos compuestos ───
export const TradeParamsSchema = z.object({
  asset: AssetSchema.default('USDT'),
  fiat: FiatSchema.default('VES'),
  side: SideSchema,
  amount: z.number().positive().max(100_000),
  price: z.number().positive().max(1_000_000),
  bank: BankSchema,
  counterparty: z.string().min(3).max(100).optional(),
  payTypes: z.array(z.string()).optional(),
});

export const RiskLimitsSchema = z.object({
  maxExposure: z.number().positive().default(20_000),
  maxDailyLoss: z.number().positive().default(500),
  maxLossStreak: z.number().int().positive().default(3),
  minWinRate: z.number().min(0).max(1).default(0.6),
  maxPositionSize: z.number().positive().default(5_000),
  maxCounterpartyExposure: z.number().positive().default(10_000),
});

export const RiskStatusSchema = z.object({
  exposure: z.record(z.string(), z.number()).default({ USDT: 0, VES: 0 }),
  dailyPnL: z.number().default(0),
  lossStreak: z.number().int().nonnegative().default(0),
  winRate7d: z.number().min(0).max(1).default(0),
  limits: RiskLimitsSchema,
  status: z.enum(['HEALTHY', 'WARNING', 'BLOCKED']),
  blockedReason: RiskViolationSchema.optional(),
});

export const TradeRiskInputSchema = TradeParamsSchema.extend({
  riskProfile: RiskProfileSchema.default('moderate'),
});

export const TradeRiskVerdictSchema = z.object({
  verdict: VerdictSchema,
  violations: z.array(RiskViolationSchema).default([]),
  recommendedSize: z.number().nonnegative(),
  riskScore: z.number().min(0).max(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const SimulatedTradeImpactSchema = z.object({
  proposedTrade: TradeParamsSchema,
  currentState: RiskStatusSchema,
});

export const SimulatedImpactResultSchema = z.object({
  newExposure: z.record(z.string(), z.number()),
  wouldTrigger: z.array(RiskViolationSchema).default([]),
  maxSafeSize: z.number().nonnegative(),
  aprImpact: z.number(),
  recommendedRebalance: z
    .array(
      z.object({
        action: z.enum(['REDUCE', 'INCREASE', 'SWITCH_BANK', 'HEDGE']),
        details: z.string(),
      }),
    )
    .default([]),
});

export const BankRouteSchema = z.object({
  bank: BankSchema,
  amount: z.number().positive(),
  expectedPrice: z.number().positive(),
  riskScore: z.number().min(0).max(1),
  liquidityScore: z.number().min(0).max(1),
  estimatedFillTimeMs: z.number().positive(),
});

export const OptimizeRoutingInputSchema = z.object({
  amount: z.number().positive(),
  side: SideSchema,
  maxBanks: z.number().int().positive().max(5).default(3),
  riskProfile: RiskProfileSchema.default('conservative'),
  excludedBanks: z.array(BankSchema).default([]),
});

export const CounterpartyProfileSchema = z.object({
  id: z.string(),
  trustScore: z.number().min(0).max(1),
  totalTrades: z.number().int().nonnegative(),
  totalVolume: z.number().nonnegative(),
  avgFillTimeMs: z.number().positive(),
  disputeRate: z.number().min(0).max(1),
  avgDisputeResolutionTimeMs: z.number().positive(),
  banks: z.array(BankSchema),
  flags: z.array(z.string()).default([]),
  negotiationStyle: z.enum(['fast', 'normal', 'slow', 'disputes_frequently']),
  lastTradeAt: z.number().optional(),
});

export const AnomalyDetectionInputSchema = z.object({
  bank: BankSchema,
  asset: AssetSchema.default('USDT'),
  fiat: FiatSchema.default('VES'),
  windowHours: z.number().int().positive().max(168).default(24),
});

export const AnomalyDetectionResultSchema = z.object({
  anomalyScore: z.number().min(0).max(1),
  type: AnomalyTypeSchema,
  evidence: z
    .array(
      z.object({
        timestamp: z.number(),
        pattern: z.string(),
        confidence: z.number().min(0).max(1),
        details: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .default([]),
  recommendation: z.enum(['avoid', 'proceed_with_caution', 'safe']),
});

export const RegulationImpactInputSchema = z.object({
  scenario: RegulationScenarioSchema,
  currentBook: RiskStatusSchema,
});

export const RegulationImpactResultSchema = z.object({
  newExposure: z.record(z.string(), z.number()),
  wouldTrigger: z.array(RiskViolationSchema).default([]),
  recommendedRebalance: z
    .array(
      z.object({
        action: z.enum(['REDUCE', 'INCREASE', 'SWITCH_BANK', 'HEDGE', 'HOLD']),
        details: z.string(),
        priority: z.number().int().positive(),
      }),
    )
    .default([]),
  estimatedPnL: z.number(),
  timeToRecovery: z.number().positive().optional(), // horas
});

export const BankEventSchema = z.object({
  id: z.string(),
  bank: BankSchema,
  timestamp: z.number(),
  amount: z.number(),
  currency: FiatSchema,
  type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'FEE', 'INTEREST']),
  reference: z.string().optional(),
  counterpartyName: z.string().optional(),
  counterpartyId: z.string().optional(),
  status: z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'DISPUTED']),
});

export const ReconciliationResultSchema = z.object({
  matched: z.number().int().nonnegative(),
  unmatched: z.array(BankEventSchema).default([]),
  duplicates: z
    .array(
      z.object({
        eventId: z.string(),
        duplicateId: z.string(),
        similarity: z.number().min(0).max(1),
      }),
    )
    .default([]),
  suggestedActions: z
    .array(
      z.object({
        action: z.enum(['MANUAL_REVIEW', 'AUTO_MATCH', 'REQUEST_RECEIPT', 'ESCALATE']),
        eventId: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
});

export const DisputeEvidencePacketSchema = z.object({
  orderId: z.string(),
  orderData: z.record(z.string(), z.unknown()),
  bankEvents: z.array(BankEventSchema).default([]),
  chatLogs: z
    .array(
      z.object({
        timestamp: z.number(),
        sender: z.string(),
        message: z.string(),
        platform: z.enum(['binance_chat', 'telegram', 'whatsapp', 'email']),
      }),
    )
    .default([]),
  receipts: z
    .array(
      z.object({
        type: z.enum(['bank_transfer', 'binance_receipt', 'screenshot', 'photo']),
        url: z.string().url(),
        hash: z.string(),
        timestamp: z.number(),
      }),
    )
    .default([]),
  fraudScore: z.number().min(0).max(1),
  riskFlags: z.array(z.string()).default([]),
  recommendedAction: z.enum(['OPEN_DISPUTE', 'ESCALATE', 'WAIT', 'CLOSE']),
});

export const FraudReportSchema = z.object({
  score: z.number().min(0).max(1),
  flags: z.array(z.string()).default([]),
  extractedData: z.object({
    amount: z.number().optional(),
    currency: z.string().optional(),
    timestamp: z.number().optional(),
    sender: z.string().optional(),
    receiver: z.string().optional(),
    reference: z.string().optional(),
    bank: z.string().optional(),
  }),
  confidence: z.number().min(0).max(1),
  recommendation: z.enum(['clean', 'review', 'reject']),
});

export const TradingDecisionSchema = z.object({
  userId: z.string().min(1),
  asset: AssetSchema,
  fiat: FiatSchema,
  side: SideSchema,
  amount: z.number().positive(),
  price: z.number().positive(),
  bank: BankSchema,
  counterparty: z.string().optional(),
  reasoning: z.string().min(10),
  riskVerdict: TradeRiskVerdictSchema.optional(),
  aiRecommended: z.boolean().default(false),
  timestamp: z.number().default(() => Date.now()),
  outcome: z.enum(['PROFIT', 'LOSS', 'BREAKEVEN', 'DISPUTE', 'CANCELLED', 'PENDING']).optional(),
});

export const TradeOutcomeSchema = z.object({
  userId: z.string().min(1),
  decisionId: z.string(),
  asset: AssetSchema,
  fiat: FiatSchema,
  actualResult: TradeOutcomeResultSchema,
  expectedResult: TradeOutcomeResultSchema,
  pnl: z.number().optional(),
  fillTimeMs: z.number().positive().optional(),
  dispute: z.boolean().default(false),
  notes: z.string().optional(),
});

export const TraderMemoryQuerySchema = z.object({
  userId: z.string().min(1),
  limit: z.number().int().positive().max(100).default(20),
  sinceDays: z.number().int().positive().max(365).optional(),
  asset: AssetSchema.optional(),
  fiat: FiatSchema.optional(),
});

export const KillSwitchParamsSchema = z.object({
  reason: z.string().min(5).max(500),
  source: KillSwitchSourceSchema.default('MCP_TOOL'),
  timestamp: z.number().default(() => Date.now()),
});

export const KillSwitchStatusSchema = z.object({
  local: z.object({
    isTriggered: z.boolean(),
    timestamp: z.number().optional(),
    reason: z.string().optional(),
    source: z.string().optional(),
  }),
  gentleAi: z.object({
    disabled: z.boolean(),
    scope: z.string().optional(),
  }),
});

// ─── Type exports (TypeScript inference) ───
export type Asset = z.infer<typeof AssetSchema>;
export type Fiat = z.infer<typeof FiatSchema>;
export type Side = z.infer<typeof SideSchema>;
export type Bank = z.infer<typeof BankSchema>;
export type RiskProfile = z.infer<typeof RiskProfileSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type AnomalyType = z.infer<typeof AnomalyTypeSchema>;
export type RegulationScenario = z.infer<typeof RegulationScenarioSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type TradeOutcomeResult = z.infer<typeof TradeOutcomeResultSchema>;
export type KillSwitchSource = z.infer<typeof KillSwitchSourceSchema>;
export type RiskViolation = z.infer<typeof RiskViolationSchema>;

export type TradeParams = z.infer<typeof TradeParamsSchema>;
export type RiskLimits = z.infer<typeof RiskLimitsSchema>;
export type RiskStatus = z.infer<typeof RiskStatusSchema>;
export type TradeRiskInput = z.infer<typeof TradeRiskInputSchema>;
export type TradeRiskVerdict = z.infer<typeof TradeRiskVerdictSchema>;
export type SimulatedTradeImpact = z.infer<typeof SimulatedTradeImpactSchema>;
export type SimulatedImpactResult = z.infer<typeof SimulatedImpactResultSchema>;
export type BankRoute = z.infer<typeof BankRouteSchema>;
export type OptimizeRoutingInput = z.infer<typeof OptimizeRoutingInputSchema>;
export type CounterpartyProfile = z.infer<typeof CounterpartyProfileSchema>;
export type AnomalyDetectionInput = z.infer<typeof AnomalyDetectionInputSchema>;
export type AnomalyDetectionResult = z.infer<typeof AnomalyDetectionResultSchema>;
export type RegulationImpactInput = z.infer<typeof RegulationImpactInputSchema>;
export type RegulationImpactResult = z.infer<typeof RegulationImpactResultSchema>;
export type BankEvent = z.infer<typeof BankEventSchema>;
export type ReconciliationResult = z.infer<typeof ReconciliationResultSchema>;
export type DisputeEvidencePacket = z.infer<typeof DisputeEvidencePacketSchema>;
export type FraudReport = z.infer<typeof FraudReportSchema>;
export type TradingDecision = z.infer<typeof TradingDecisionSchema>;
export type TradeOutcome = z.infer<typeof TradeOutcomeSchema>;
export type TraderMemoryQuery = z.infer<typeof TraderMemoryQuerySchema>;
export type KillSwitchParams = z.infer<typeof KillSwitchParamsSchema>;
export type KillSwitchStatus = z.infer<typeof KillSwitchStatusSchema>;
