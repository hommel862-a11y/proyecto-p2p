import type {
  ArbitrageCycleMetrics,
  ArbitrageRoute,
  BotDetectionResult,
  CleanRadarOffer,
  ExecutionMode,
  MakerMerchantLevel,
  MarketTrendResult,
  P2PUserTier,
  RadarCleanBook,
  VolumeBracketConfig,
} from '@p2p/core';

export type RadarViewMode = 'BOOKS' | 'MATRIX' | 'FORENSIC';
export type RadarDensityMode = 'COMFORT' | 'COMPACT';
export type MatrixRouteFilter = 'ALL' | 'MONOBANK' | 'INTERBANK' | 'VIABLE';
export type TacticalPriceStrategy = 'TOP1' | 'BEAT_TICK' | 'VWAP' | 'ANTI_BOT';
export type RadarCockpitTab = 'SIMULATOR' | 'FEE_SCHEDULE';

export interface EnrichedOfferRow {
  readonly offer: CleanRadarOffer;
  readonly bot: BotDetectionResult | undefined;
  readonly depthPct: number;
}

export interface BankSudebanHealthView {
  readonly label: string;
  readonly isBlocked: boolean;
  readonly statusClass: 'optimal' | 'warn' | 'blocked';
}

export interface RadarBankViewModel {
  readonly payMethod: string;
  readonly buyBook: RadarCleanBook | undefined;
  readonly sellBook: RadarCleanBook | undefined;
  readonly sellTrend: MarketTrendResult | undefined;
  readonly buyLiquidity: number;
  readonly sellLiquidity: number;
  readonly buyTopOffers: readonly EnrichedOfferRow[];
  readonly sellTopOffers: readonly EnrichedOfferRow[];
  readonly intraSpreadVes: number | null;
  readonly intraSpreadPct: number | null;
  readonly sudebanHealth: BankSudebanHealthView | null;
  readonly buyMerchantWallPct: number;
  readonly sellMerchantWallPct: number;
  readonly freeAdvertisersCount: number;
  readonly openTakerOffersCount: number;
}

export interface RadarBankGroup {
  readonly id: string;
  readonly label: string;
  readonly banks: readonly string[];
}

export interface RadarMerchantLevelOption {
  readonly id: MakerMerchantLevel;
  readonly label: string;
  readonly feePctLabel: string;
  readonly hint: string;
}

export interface RadarBankFeeRow {
  readonly payMethod: string;
  readonly label: string;
  readonly fiat: string;
  readonly interbankFrictionPct: number;
  readonly makerFeePct: number;
  readonly hybridCombinedFeePct: number;
  readonly merchantWallPct: number;
  readonly openTakerCount: number;
  readonly health: BankSudebanHealthView | null;
}

export interface RadarBotReportRow {
  readonly bookKey: string;
  readonly bank: string;
  readonly side: 'BUY' | 'SELL';
  readonly bot: BotDetectionResult;
}

export interface RadarRejectedOfferRow {
  readonly bookKey: string;
  readonly bank: string;
  readonly side: 'BUY' | 'SELL';
  readonly offer: CleanRadarOffer;
}

export interface RadarHeroKpiSummary {
  readonly bestRoute: ArbitrageRoute | null;
  readonly lowestWallBank: {
    readonly payMethod: string;
    readonly label: string;
    readonly wallPct: number;
    readonly freeCount: number;
  } | null;
  readonly hybridEdgeRoute: ArbitrageRoute | null;
  readonly hybridDeltaPct: number;
  readonly cleanOffersTotal: number;
  readonly botsDetectedCount: number;
  readonly rejectedCount: number;
  readonly samplesCount: number;
}

export interface RadarCockpitViewInput {
  readonly merchantLevel: MakerMerchantLevel;
  readonly userTier: P2PUserTier;
  readonly executionMode: ExecutionMode;
  readonly operatingCapitalUsdt: number;
  readonly targetNetMarginPct: number;
  readonly simBuyBank: string;
  readonly simSellBank: string;
  readonly simBuyPrice: number;
  readonly simSellPrice: number;
  readonly metrics: ArbitrageCycleMetrics;
  readonly activeRoute: ArbitrageRoute | null;
  readonly currentMakerFeePct: number;
  readonly volumeBracket: VolumeBracketConfig;
  readonly bankLabels: Record<string, string>;
  readonly dailyCyclesCount: number;
  readonly dailyProfitUsdt: number;
  readonly feeRows: readonly RadarBankFeeRow[];
}
