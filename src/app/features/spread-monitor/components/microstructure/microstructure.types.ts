import type {
  BinanceOfferSummary,
  BracketId,
  SpoofCategory,
  SpreadQualityFactorKey,
} from '@p2p/core';
import type { OfferTrustStatus } from '../../../../core/microstructure-engine.service';

export const CHART_TABS = {
  DEPTH: 'DEPTH',
  SLIPPAGE: 'SLIPPAGE',
  PULSE: 'PULSE',
} as const;

export type ChartTab = (typeof CHART_TABS)[keyof typeof CHART_TABS];

export const AUDIT_FILTERS = {
  ALL: 'ALL',
  LEGITIMATE: 'LEGITIMATE',
  PURGED: 'PURGED',
  WHALES: 'WHALES',
} as const;

export type AuditFilter = (typeof AUDIT_FILTERS)[keyof typeof AUDIT_FILTERS];

export const TICKET_PRESETS_USDT: readonly number[] = [100, 500, 1000, 2500];

export const BANK_FILTER_OPTIONS: readonly { readonly code: string; readonly label: string }[] = [
  { code: 'ALL', label: 'Todos' },
  { code: 'BANESCO', label: 'Banesco' },
  { code: 'PAGO_MOVIL', label: 'Pago Móvil' },
  { code: 'MERCANTIL', label: 'Mercantil' },
  { code: 'BDV', label: 'BDV' },
  { code: 'PROVINCIAL', label: 'Provincial' },
  { code: 'BANCAMIGA', label: 'Bancamiga' },
  { code: 'BNC', label: 'BNC' },
  { code: 'BANCARIBE', label: 'Bancaribe' },
  { code: 'BANPLUS', label: 'Banplus' },
];

export interface BankQuotaPill {
  readonly code: string;
  readonly label: string;
  readonly quotaPct: number;
  readonly isWarning: boolean;
  readonly isCritical: boolean;
  readonly isActive: boolean;
}

export interface BankSaturationWarning {
  readonly bankCode: string;
  readonly bankLabel: string;
  readonly quotaPct: number;
  readonly recommendedBankCode: string;
  readonly recommendedBankLabel: string;
  readonly recommendedQuotaPct: number;
}

export interface MicrostructureApplyPriceEvent {
  readonly side: 'BUY' | 'SELL';
  readonly price: number;
  readonly merchantName?: string;
  readonly advNo?: string;
  readonly source: string;
}

export interface MicrostructureWhatIfPreview {
  readonly side: 'BUY' | 'SELL';
  readonly price: number;
  readonly estimatedUsdt: number;
  readonly merchantName: string;
  readonly deltaVsBreakEvenVes: number | null;
  readonly estimatedSpreadPct: number | null;
  readonly source: string;
}

export interface MicrostructureTelegramPayload {
  readonly title: string;
  readonly sqsScore: number | null;
  readonly verdictLabel: string;
  readonly cleanSpreadPct: number;
  readonly apparentSpreadPct: number;
  readonly isTrap: boolean;
  readonly trapMessage: string;
  readonly recommendedMode: string;
  readonly makerBuyPrice: number;
  readonly makerSellPrice: number;
  readonly bankFilter: string;
  readonly targetUsdt: number;
  readonly summaryText: string;
}

export interface MicrostructureOperateBracketEvent {
  readonly bracketId: BracketId;
  readonly side: 'BUY' | 'SELL';
  readonly price: number;
}

export interface SlippageBarPoint {
  readonly ticketUsdt: number;
  readonly label: string;
  readonly slippageBps: number;
  readonly isCurrent: boolean;
  readonly barHeightPct: number;
}

export interface SqsFactorItem {
  readonly key: SpreadQualityFactorKey;
  readonly label: string;
  readonly score: number;
  readonly weightLabel: string;
  readonly isWeakest: boolean;
}

export interface AuditRowItem {
  readonly offer: BinanceOfferSummary;
  readonly side: 'BUY' | 'SELL';
  readonly spoofCategory: SpoofCategory;
  readonly lifespanSeconds: number;
  readonly counterpartyReputation: OfferTrustStatus;
  readonly estimatedUsd: number | null;
  readonly isPurged: boolean;
  readonly isWhale: boolean;
}
