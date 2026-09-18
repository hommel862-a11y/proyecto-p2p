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
  spotUsdtPrice: z.number().positive().default(1.0),
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
export type RecommendCompetitivePricingInput = z.infer<
  typeof RecommendCompetitivePricingInputSchema
>;

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

// --- Phase 5: Google Workspace Integration (p2p-google-workspace) ---

export const GdriveBackupReceiptInputSchema = z.object({
  tradeId: z.string().min(1, 'tradeId es requerido'),
  counterparty: z.string().default('Contraparte Desconocida'),
  imageData: z.string().min(4, 'imageData (base64 o contenido) es requerido'),
  fileName: z.string().optional(),
  mimeType: z
    .enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
    .default('image/png'),
  folderId: z.string().optional(),
  amountVes: z.number().optional(),
  amountUsdt: z.number().optional(),
  bank: z.string().optional(),
  timestamp: z.string().optional(),
});
export type GdriveBackupReceiptInput = z.infer<typeof GdriveBackupReceiptInputSchema>;

export const GsheetsSyncTradeInputSchema = z.object({
  spreadsheetId: z.string().optional().default('1p2p_Ledger_Master_Spreadsheet'),
  sheetName: z.string().default('Operaciones P2P'),
  trade: z.object({
    id: z.string().min(1),
    timestamp: z.string().optional(),
    side: z.enum(['BUY', 'SELL']),
    bank: z.string().default('Pago Móvil'),
    rate: z.number().positive(),
    vesAmount: z.number().positive(),
    usdtAmount: z.number().positive(),
    grossSpreadPct: z.number().optional().default(0),
    netProfitUsdt: z.number().optional().default(0),
    counterparty: z.string().default('Anónimo'),
    referenceNumber: z.string().optional().default('N/A'),
    status: z.enum(['COMPLETED', 'DISPUTED', 'CANCELLED']).default('COMPLETED'),
  }),
});
export type GsheetsSyncTradeInput = z.infer<typeof GsheetsSyncTradeInputSchema>;

export const GdriveSyncDbBackupInputSchema = z.object({
  backupType: z.enum(['ledger_json', 'sqlite_dump', 'audit_snapshot']).default('ledger_json'),
  dataPayload: z.string().min(2, 'dataPayload no puede estar vacío'),
  folderId: z.string().optional(),
  encrypt: z.boolean().default(false),
});
export type GdriveSyncDbBackupInput = z.infer<typeof GdriveSyncDbBackupInputSchema>;

// ─── Institutional 10 MCP Servers: New High-Impact Schemas ───

export const ScreenWalletAddressInputSchema = z.object({
  address: z.string().min(10, 'Dirección de billetera inválida'),
  network: z.enum(['TRC20', 'ERC20', 'BEP20', 'POLYGON', 'SOL']).default('TRC20'),
  expectedAmountUsdt: z.number().positive().optional(),
});
export type ScreenWalletAddressInput = z.infer<typeof ScreenWalletAddressInputSchema>;

export const InspectTxTaintInputSchema = z.object({
  txHash: z.string().min(16, 'Hash de transacción inválido'),
  chain: z.enum(['TRON', 'ETHEREUM', 'BSC', 'POLYGON']).default('TRON'),
});
export type InspectTxTaintInput = z.infer<typeof InspectTxTaintInputSchema>;

export const FetchCrossExchangeSpreadInputSchema = z.object({
  fiat: z.enum(['VES', 'COP', 'USD']).default('VES'),
  asset: z.enum(['USDT', 'BTC']).default('USDT'),
  paymentMethod: z.string().default('Pago Movil'),
  minMerchantTrades: z.number().min(0).default(50),
});
export type FetchCrossExchangeSpreadInput = z.infer<typeof FetchCrossExchangeSpreadInputSchema>;

export const VerifyInboundTransferInputSchema = z.object({
  referenceNumber: z.string().min(4, 'Número de referencia bancaria requerido'),
  amountVes: z.number().positive('El monto en VES debe ser positivo'),
  bankCode: z.string().default('0102'),
  senderPhone: z.string().optional(),
  senderCedula: z.string().optional(),
});
export type VerifyInboundTransferInput = z.infer<typeof VerifyInboundTransferInputSchema>;

export const CompileDisputeDossierInputSchema = z.object({
  orderId: z.string().min(3, 'Order ID requerido'),
  disputeReason: z.enum(['THIRD_PARTY_PAYMENT', 'UNRELEASED_CRYPTO', 'FAKE_RECEIPT', 'INCORRECT_AMOUNT']),
  bankReference: z.string().optional(),
  amountUsdt: z.number().positive(),
  amountVes: z.number().positive(),
  counterpartyNick: z.string(),
  chatLogSummary: z.string().optional(),
});
export type CompileDisputeDossierInput = z.infer<typeof CompileDisputeDossierInputSchema>;

export const EvaluateAccountSaturationInputSchema = z.object({
  bankId: z.string().min(1, 'bankId requerido'),
  currentDailyVes: z.number().min(0),
  dailyLimitVes: z.number().positive(),
  hourlyTransactionCount: z.number().min(0).default(0),
  incomingAmountVes: z.number().min(0).optional(),
});
export type EvaluateAccountSaturationInput = z.infer<typeof EvaluateAccountSaturationInputSchema>;

export const DispatchOrderInstructionsInputSchema = z.object({
  orderId: z.string().min(3),
  channel: z.enum(['TELEGRAM', 'WHATSAPP', 'BINANCE_CHAT']).default('TELEGRAM'),
  recipientContact: z.string().min(5),
  bankName: z.string(),
  accountHolder: z.string(),
  accountNumberOrPhone: z.string(),
  amountVes: z.number().positive(),
  termsNote: z.string().optional(),
});
export type DispatchOrderInstructionsInput = z.infer<typeof DispatchOrderInstructionsInputSchema>;

export const LookupCounterpartyReputationInputSchema = z.object({
  documentId: z.string().min(4, 'Cédula o RIF requerido'),
  phoneNumber: z.string().optional(),
  bankAccountNumber: z.string().optional(),
});
export type LookupCounterpartyReputationInput = z.infer<typeof LookupCounterpartyReputationInputSchema>;

// ─── Compliance, Multichannel & Proof Reader Schemas ───

export const CheckBankOperationalStatusInputSchema = z.object({
  bankCodes: z.array(z.string()).optional(),
  includePaymentNetworks: z.boolean().default(true),
});
export type CheckBankOperationalStatusInput = z.infer<typeof CheckBankOperationalStatusInputSchema>;

export const CheckCounterpartyBlacklistInputSchema = z.object({
  cedula: z.string().optional(),
  phone: z.string().optional(),
  accountNumber: z.string().optional(),
  alias: z.string().optional(),
});
export type CheckCounterpartyBlacklistInput = z.infer<typeof CheckCounterpartyBlacklistInputSchema>;

export const RegisterBlacklistedEntityInputSchema = z.object({
  identifierType: z.enum(['CEDULA', 'PHONE', 'ACCOUNT_NUMBER', 'BINANCE_ALIAS']),
  identifierValue: z.string().min(3, 'El valor del identificador debe tener al menos 3 caracteres'),
  counterpartyName: z.string().optional(),
  fraudCategory: z.enum(['TRIANGULATION_SCAM', 'THIRD_PARTY_PAYER', 'CHARGEBACK_ATTEMPT', 'IDENTITY_THEFT', 'OTHER']),
  incidentNotes: z.string().optional(),
  riskLevel: z.enum(['CRITICAL', 'HIGH', 'MEDIUM']).default('CRITICAL'),
  humanConfirm: z.boolean({ message: 'humanConfirm es requerido (Human-in-the-loop)' }),
  confirmToken: z.string().optional(),
});
export type RegisterBlacklistedEntityInput = z.infer<typeof RegisterBlacklistedEntityInputSchema>;

export const SendMultichannelAlertInputSchema = z.object({
  channel: z.enum(['TELEGRAM', 'WHATSAPP', 'PUSH', 'ALL']).default('TELEGRAM'),
  priority: z.enum(['INFO', 'ALERT', 'CRITICAL_ACTION']).default('ALERT'),
  title: z.string().min(3),
  messageMarkdown: z.string().min(5),
  actionButtons: z
    .array(
      z.object({
        label: z.string(),
        callbackAction: z.string(),
      }),
    )
    .optional(),
  orderId: z.string().optional(),
});
export type SendMultichannelAlertInput = z.infer<typeof SendMultichannelAlertInputSchema>;

export const ProcessRemoteSentinelCommandInputSchema = z.object({
  rawText: z.string().min(3, 'Comando de texto no puede estar vacío'),
  senderId: z.string().default('ADMIN'),
  channel: z.enum(['TELEGRAM', 'WHATSAPP', 'VOICE_TRANSCRIPTION']).default('TELEGRAM'),
  humanConfirm: z.boolean().default(true),
});
export type ProcessRemoteSentinelCommandInput = z.infer<typeof ProcessRemoteSentinelCommandInputSchema>;

export const AuditPaymentProofOcrInputSchema = z.object({
  ocrRawText: z.string().min(5, 'Texto OCR requerido'),
  expectedAmountVes: z.number().positive('Monto esperado debe ser positivo'),
  expectedBank: z.string().optional(),
  expectedPayerName: z.string().optional(),
  expectedPayerIdDoc: z.string().optional(),
  orderId: z.string().min(2),
});
export type AuditPaymentProofOcrInput = z.infer<typeof AuditPaymentProofOcrInputSchema>;
