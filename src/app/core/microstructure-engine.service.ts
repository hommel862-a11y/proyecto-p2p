import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CAPITAL_BRACKETS,
  OrderPersistenceTracker,
  calculateBcvGap,
  calculateMakerFillProbabilityMarkov,
  calculateOrderBookImbalance,
  calculateVpinMetric,
  computeArbitrageCycle,
  computeAvellanedaStoikovQuotes,
  computeDynamicSpreadAnchors,
  computeMicrostructureSanitizedDepth,
  computeOrderSlicingPlan,
  computeVolumeWeightedPrice,
  detectOtcWhaleBlocks,
  filterOffersByBracket,
  getFullDepthOffers,
  predictBcvIntervention,
  predictTwoHourVolatility,
  roundMoney,
  simulateTradeImpact,
  type ArbitrageCycleResult,
  type AvellanedaStoikovResult,
  type BankCode,
  type BcvGapAnalysis,
  type BcvPredictorWindow,
  type BinanceOfferSummary,
  type BinanceP2pMarketDepth,
  type BracketId,
  type CapitalBracketConfig,
  type DynamicSpreadRecommendation,
  type FilteredBracketResult,
  type InstitutionalSlicingResult,
  type MarkovFillProbabilityResult,
  type OrderBookImbalanceResult,
  type OrderClassification,
  type OtcWhaleReport,
  type P2PRole,
  type PriceTick,
  type SanitizedDepthResult,
  type SpoofCategory,
  type SpoofReport,
  type TradeImpactSimulationResult,
  type VolatilityForecastResult,
  type VolatilityRegime,
  type VpinAnalysisResult,
  type VpinBucket,
} from '@p2p/core';
import { AccountsService } from './accounts.service';
import { BinanceP2pService, type BinanceFreshnessStatus } from './binance-p2p.service';
import { CotizaveService } from './cotizave.service';
import { CounterpartyService } from './counterparty.service';
import { MarketHistoryService } from './market-history.service';
import { SpreadQualityService, type LiveSpreadQualityResult } from './spread-quality.service';

export const FLASH_DIRECTIONS = {
  UP: 'up',
  DOWN: 'down',
  NEW: 'new',
} as const;

export type FlashDirection = (typeof FLASH_DIRECTIONS)[keyof typeof FLASH_DIRECTIONS] | null;

export const OFFER_TRUST_STATUS = {
  TRUSTED: 'TRUSTED',
  VERIFIED: 'VERIFIED',
  BLOCKED: 'BLOCKED',
  SUSPICIOUS: 'SUSPICIOUS',
  NORMAL: 'NORMAL',
  UNKNOWN: 'UNKNOWN',
} as const;

export type OfferTrustStatus = (typeof OFFER_TRUST_STATUS)[keyof typeof OFFER_TRUST_STATUS];

export const TRAP_SEVERITIES = {
  NONE: 'NONE',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type TrapSeverity = (typeof TRAP_SEVERITIES)[keyof typeof TRAP_SEVERITIES];

export const RECOMMENDED_EXECUTION_MODES = {
  MAKER: 'MAKER',
  TAKER: 'TAKER',
  WAIT: 'WAIT',
} as const;

export type RecommendedExecutionMode =
  (typeof RECOMMENDED_EXECUTION_MODES)[keyof typeof RECOMMENDED_EXECUTION_MODES];

export interface OfferTickDelta {
  readonly deltaPrice: number;
  readonly isNew: boolean;
  readonly flashDirection: FlashDirection;
}

export interface EnrichedMicrostructureOffer {
  readonly offer: BinanceOfferSummary;
  readonly side: 'BUY' | 'SELL';
  readonly deltaPrice: number;
  readonly isNew: boolean;
  readonly flashDirection: FlashDirection;
  readonly counterpartyReputation: OfferTrustStatus;
  readonly isTrusted: boolean;
  readonly isVerifiedCounterparty: boolean;
  readonly isBlockedCounterparty: boolean;
  readonly isVerifiedPro: boolean;
  readonly spoofCategory: SpoofCategory;
  readonly lifespanSeconds: number;
  readonly estimatedUsdt: number;
}

export interface HonestVpinReport extends VpinAnalysisResult {
  readonly isProxy: true;
  readonly proxySource: 'BOOK_TIER_SNAPSHOT_PROXY';
  readonly proxyDisclaimer: string;
  readonly bucketCount: number;
}

export interface MicrostructureVolatility2hResult extends VolatilityForecastResult {
  readonly bcvGap: BcvGapAnalysis;
  readonly bcvWindow: BcvPredictorWindow;
}

export interface BracketSummaryItem {
  readonly bracket: CapitalBracketConfig;
  readonly result: FilteredBracketResult;
  readonly oppositeBestPrice: number;
  readonly estimatedGrossSpreadPct: number;
  readonly hasLiquidity: boolean;
}

export interface ApparentVsCleanSpreadTrap {
  readonly apparentBuyPrice: number;
  readonly apparentSellPrice: number;
  readonly apparentSpreadVes: number;
  readonly apparentSpreadPct: number;
  readonly cleanBuyPrice: number;
  readonly cleanSellPrice: number;
  readonly cleanSpreadVes: number;
  readonly cleanSpreadPct: number;
  readonly trapDeltaVes: number;
  readonly trapDeltaPct: number;
  readonly purgedOffersCount: number;
  readonly isTrap: boolean;
  readonly severity: TrapSeverity;
  readonly message: string;
}

export interface MicrostructureDeskPayload {
  readonly side: 'BUY' | 'SELL';
  readonly customPriceVes: number;
  readonly breakEvenSellPrice: number;
  readonly maxBuyPrice: number;
  readonly targetAssetAmountUsdt: number;
  readonly preferredBank: string | null;
  readonly sourceLabel: string;
}

export interface MicrostructureRepricerPayload {
  readonly buyPrice: number;
  readonly sellPrice: number;
  readonly strategy: 'TOP_1';
  readonly breakEvenFloor: number;
  readonly maxBuyPrice: number;
  readonly minSpreadVes: number;
}

export interface MakerVsTakerComparison {
  readonly maker: ArbitrageCycleResult;
  readonly taker: ArbitrageCycleResult;
  readonly makerBuyPrice: number;
  readonly makerSellPrice: number;
  readonly takerBuyPrice: number;
  readonly takerSellPrice: number;
  readonly netAdvantageUsd: number;
  readonly netAdvantagePct: number;
  readonly recommendedMode: RecommendedExecutionMode;
  readonly apparentVsCleanSpreadTrap: ApparentVsCleanSpreadTrap;
  readonly deskPayload: MicrostructureDeskPayload;
  readonly repricerPayload: MicrostructureRepricerPayload;
}

interface IngestedSnapshotState {
  readonly snapshotHash: string;
  readonly pairBankKey: string;
  readonly ingestedAtMs: number;
  readonly tracker: OrderPersistenceTracker;
  readonly buyDeltas: ReadonlyMap<string, OfferTickDelta>;
  readonly sellDeltas: ReadonlyMap<string, OfferTickDelta>;
}

const KNOWN_BANK_CODES = new Set<BankCode>([
  'BANESCO',
  'MERCANTIL',
  'BDV',
  'BANCAMIGA',
  'PROVINCIAL',
  'BNC',
  'BANCARIBE',
  'BANPLUS',
  'OTRO',
]);

const BRACKET_IDS: readonly BracketId[] = ['INFRAMUNDO', 'MEDIO', 'INSTITUCIONAL'];

const EMPTY_SPOOF_REPORT: SpoofReport = {
  timestampMs: 0,
  totalTracked: 0,
  classifiedOrders: [],
  spoofBaitCount: 0,
  phantomLiquidityCount: 0,
  suspiciousCount: 0,
  legitimateCount: 0,
  phantomLiquidityVes: 0,
  manipulationRiskScore: 0,
};

const EMPTY_ARBITRAGE_CYCLE: ArbitrageCycleResult = {
  capitalUsdt: 0,
  capitalVesInvested: 0,
  cryptoGrossProceedsUsdt: 0,
  binanceFeeUsdt: 0,
  netCryptoUsdt: 0,
  grossProceedsVes: 0,
  bankFeesVes: 0,
  netProceedsVes: 0,
  netGainVes: 0,
  netGainUsd: 0,
  roiCyclePct: 0,
  spreadNominalPct: 0,
  effectiveFeeDragPct: 0,
};

function resolveOfferId(offer: BinanceOfferSummary): string {
  return offer.advNo && offer.advNo.trim().length > 0
    ? offer.advNo
    : `${offer.merchantName}:${offer.price}`;
}

function resolveBankCodeAndInterbank(bankFilter: string): {
  bankCode: BankCode;
  isInterbank: boolean;
} {
  if (bankFilter === 'PAGO_MOVIL') {
    return { bankCode: 'OTRO', isInterbank: true };
  }
  if (KNOWN_BANK_CODES.has(bankFilter as BankCode)) {
    return { bankCode: bankFilter as BankCode, isInterbank: false };
  }
  return { bankCode: 'BANESCO', isInterbank: false };
}

function emptyBracketResult(bracketId: BracketId): FilteredBracketResult {
  return {
    bracket: CAPITAL_BRACKETS[bracketId],
    offers: [],
    purgedDustCount: 0,
    purgedPromotedCount: 0,
    bestPrice: 0,
    totalVolumeVes: 0,
  };
}

function mapVolatilityLevelToRegime(
  level: VolatilityForecastResult['level'],
): VolatilityRegime {
  switch (level) {
    case 'EXTREME':
      return 'EXTREME';
    case 'ELEVATED':
      return 'HIGH';
    case 'NORMAL':
      return 'MEDIUM';
    default:
      return 'LOW';
  }
}

function computeReferenceRate(
  depth: BinanceP2pMarketDepth | null,
  buys: readonly BinanceOfferSummary[],
  sells: readonly BinanceOfferSummary[],
): number {
  if (!depth) return 0;
  const buyRef = depth.bestBuyPrice > 0 ? depth.bestBuyPrice : (buys[0]?.price ?? 0);
  const sellRef = depth.bestSellPrice > 0 ? depth.bestSellPrice : (sells[0]?.price ?? 0);
  if (buyRef > 0 && sellRef > 0) {
    return roundMoney((buyRef + sellRef) / 2, 4);
  }
  return buyRef > 0 ? buyRef : sellRef;
}

@Injectable({ providedIn: 'root' })
export class MicrostructureEngineService {
  private readonly binance = inject(BinanceP2pService);
  private readonly counterparty = inject(CounterpartyService);
  private readonly accounts = inject(AccountsService);
  private readonly marketHistory = inject(MarketHistoryService);
  private readonly spreadQuality = inject(SpreadQualityService);
  private readonly cotizave = inject(CotizaveService, { optional: true });

  readonly selectedSide = signal<'BUY' | 'SELL'>('SELL');
  readonly selectedBracket = signal<BracketId | 'ALL'>('ALL');
  readonly targetUsdt = signal<number>(500);
  readonly cleanModeEnabled = signal<boolean>(true);
  readonly verifiedProOnly = signal<boolean>(false);
  readonly liveBreakEvenSellPrice = signal<number>(0);
  readonly currentInventoryUsdt = signal<number>(1000);
  readonly targetInventoryUsdt = signal<number>(1000);
  readonly buyRole = signal<P2PRole>('TAKER');
  readonly sellRole = signal<P2PRole>('TAKER');
  readonly bcvRateVes = signal<number | null>(null);

  private readonly trackers = new Map<string, OrderPersistenceTracker>();
  private readonly previousPriceMaps = new Map<string, Map<string, number>>();
  private lastIngestedFingerprint = '';
  private lastIngestedState: IngestedSnapshotState | null = null;

  private readonly ingestedContext = computed<IngestedSnapshotState | null>(() => {
    const depth = this.binance.marketDepth();
    if (!depth) return null;

    const bankKey = this.binance.selectedBank() || 'ALL';
    const pairBankKey = `${depth.asset}:${depth.fiat}:${bankKey}`;
    const fullBuys = getFullDepthOffers(depth, 'BUY');
    const fullSells = getFullDepthOffers(depth, 'SELL');
    const fetchedMs = this.binance.lastFetched?.()?.getTime() ?? 0;

    const fingerprint = [
      pairBankKey,
      depth.updatedAt,
      String(fetchedMs),
      `B:${fullBuys.map((o) => `${resolveOfferId(o)}@${o.price}:${o.maxVes}`).join(',')}`,
      `S:${fullSells.map((o) => `${resolveOfferId(o)}@${o.price}:${o.maxVes}`).join(',')}`,
    ].join('|');

    if (this.lastIngestedState && this.lastIngestedFingerprint === fingerprint) {
      return this.lastIngestedState;
    }

    const nowMs = Date.now();
    let tracker = this.trackers.get(pairBankKey);
    if (!tracker) {
      tracker = new OrderPersistenceTracker(15);
      this.trackers.set(pairBankKey, tracker);
    }

    const buyDeltas = this.computeAndStoreTickDeltas(`${pairBankKey}:BUY`, fullBuys);
    const sellDeltas = this.computeAndStoreTickDeltas(`${pairBankKey}:SELL`, fullSells);

    tracker.ingestSnapshot(fullBuys, 'BUY', nowMs);
    tracker.ingestSnapshot(fullSells, 'SELL', nowMs);

    const state: IngestedSnapshotState = {
      snapshotHash: fingerprint,
      pairBankKey,
      ingestedAtMs: nowMs,
      tracker,
      buyDeltas,
      sellDeltas,
    };
    this.lastIngestedFingerprint = fingerprint;
    this.lastIngestedState = state;
    return state;
  });

  readonly snapshotHash = computed<string>(() => this.ingestedContext()?.snapshotHash ?? '');

  readonly freshnessStatus = computed<BinanceFreshnessStatus>(() => {
    if (typeof this.binance.freshnessStatus === 'function') {
      return this.binance.freshnessStatus();
    }
    return this.binance.marketDepth() ? 'LIVE' : 'OFFLINE';
  });

  readonly fullBuyOffers = computed<BinanceOfferSummary[]>(() =>
    getFullDepthOffers(this.binance.marketDepth(), 'BUY'),
  );

  readonly fullSellOffers = computed<BinanceOfferSummary[]>(() =>
    getFullDepthOffers(this.binance.marketDepth(), 'SELL'),
  );

  readonly refRate = computed<number>(() =>
    computeReferenceRate(this.binance.marketDepth(), this.fullBuyOffers(), this.fullSellOffers()),
  );

  readonly resolvedBcvRateVes = computed<number | null>(() => {
    const manual = this.bcvRateVes();
    if (manual !== null && Number.isFinite(manual) && manual > 0) {
      return manual;
    }
    const rates = this.cotizave?.ratesByMarket?.();
    const oficial = rates?.['oficial'] ?? rates?.['bcv'];
    const candidate = oficial?.mid ?? oficial?.ask ?? oficial?.bid ?? null;
    return candidate !== null && Number.isFinite(candidate) && candidate > 0 ? candidate : null;
  });

  readonly bankQuotaUsagePct = computed<number>(() => {
    const bankFilter = this.binance.selectedBank();
    const { bankCode } = resolveBankCodeAndInterbank(bankFilter);
    const usages = this.accounts.treasurySummary().accountsUsage;
    if (usages.length === 0) return 0;

    const matching =
      bankFilter === 'ALL' ? [] : usages.filter((u) => u.account.bankCode === bankCode);
    const pool = matching.length > 0 ? matching : usages;
    const avg = pool.reduce((sum, u) => sum + u.consumedLimitPct, 0) / pool.length;
    return roundMoney(avg, 2);
  });

  readonly buySpoofReport = computed<SpoofReport>(() => {
    const ctx = this.ingestedContext();
    if (!ctx) return EMPTY_SPOOF_REPORT;
    return ctx.tracker.generateSpoofReport(ctx.ingestedAtMs, 'BUY');
  });

  readonly sellSpoofReport = computed<SpoofReport>(() => {
    const ctx = this.ingestedContext();
    if (!ctx) return EMPTY_SPOOF_REPORT;
    return ctx.tracker.generateSpoofReport(ctx.ingestedAtMs, 'SELL');
  });

  readonly spoofReport = computed<SpoofReport>(() =>
    this.selectedSide() === 'BUY' ? this.buySpoofReport() : this.sellSpoofReport(),
  );

  readonly enrichedBuyOffers = computed<EnrichedMicrostructureOffer[]>(() =>
    this.buildEnrichedOffers(
      this.fullBuyOffers(),
      'BUY',
      this.ingestedContext()?.buyDeltas,
      this.buySpoofReport(),
    ),
  );

  readonly enrichedSellOffers = computed<EnrichedMicrostructureOffer[]>(() =>
    this.buildEnrichedOffers(
      this.fullSellOffers(),
      'SELL',
      this.ingestedContext()?.sellDeltas,
      this.sellSpoofReport(),
    ),
  );

  readonly activeEnrichedOffers = computed<EnrichedMicrostructureOffer[]>(() => {
    const rows =
      this.selectedSide() === 'BUY' ? this.enrichedBuyOffers() : this.enrichedSellOffers();
    if (!this.verifiedProOnly()) {
      return rows;
    }
    return rows.filter((row) => row.isVerifiedPro && !row.isBlockedCounterparty);
  });

  private readonly filteredBuyOffers = computed<BinanceOfferSummary[]>(() => {
    const rows = this.enrichedBuyOffers();
    if (!this.verifiedProOnly()) {
      return rows.map((r) => r.offer);
    }
    return rows
      .filter((r) => r.isVerifiedPro && !r.isBlockedCounterparty)
      .map((r) => r.offer);
  });

  private readonly filteredSellOffers = computed<BinanceOfferSummary[]>(() => {
    const rows = this.enrichedSellOffers();
    if (!this.verifiedProOnly()) {
      return rows.map((r) => r.offer);
    }
    return rows
      .filter((r) => r.isVerifiedPro && !r.isBlockedCounterparty)
      .map((r) => r.offer);
  });

  private readonly sanitizedBuyDepth = computed<SanitizedDepthResult>(() =>
    this.computeSideSanitizedDepth(this.filteredBuyOffers(), 'BUY'),
  );

  private readonly sanitizedSellDepth = computed<SanitizedDepthResult>(() =>
    this.computeSideSanitizedDepth(this.filteredSellOffers(), 'SELL'),
  );

  readonly sanitizedDepth = computed<SanitizedDepthResult>(() =>
    this.selectedSide() === 'BUY' ? this.sanitizedBuyDepth() : this.sanitizedSellDepth(),
  );

  readonly tradeImpact = computed<TradeImpactSimulationResult>(() => {
    const depth = this.binance.marketDepth();
    const side = this.selectedSide();
    const availableOffers = this.sanitizedDepth().sanitizedOffers;
    return simulateTradeImpact({
      targetAmountUsdt: this.safeTargetUsdt(),
      side,
      availableOffers,
      targetFiatCurrency: depth?.fiat ?? 'VES',
      bankName: this.binance.selectedBank(),
    });
  });

  readonly obiReport = computed<OrderBookImbalanceResult>(() =>
    calculateOrderBookImbalance(this.filteredBuyOffers(), this.filteredSellOffers(), {
      depthLevels: 15,
      minOrderUsdt: 20,
      gapThresholdPct: 0.4,
    }),
  );

  readonly vpinReport = computed<HonestVpinReport>(() => {
    const buys = this.filteredBuyOffers();
    const sells = this.filteredSellOffers();
    const tierCount = Math.max(buys.length, sells.length);
    const buckets: VpinBucket[] = [];

    for (let i = 0; i < tierCount; i++) {
      const b = buys[i];
      const s = sells[i];
      const buyVol = b && b.price > 0 ? roundMoney(b.maxVes / b.price, 2) : 0;
      const sellVol = s && s.price > 0 ? roundMoney(s.maxVes / s.price, 2) : 0;
      const total = roundMoney(buyVol + sellVol, 2);
      if (total > 0) {
        buckets.push({ buyVolume: buyVol, sellVolume: sellVol, totalVolume: total });
      }
    }

    const base = calculateVpinMetric({ buckets, toxicityThreshold: 0.25 });
    return {
      ...base,
      isProxy: true,
      proxySource: 'BOOK_TIER_SNAPSHOT_PROXY',
      proxyDisclaimer:
        'Proxy estructural por tramos L2 del libro (estimación sobre profundidad de anuncios, no cinta de trades ejecutados).',
      bucketCount: buckets.length,
    };
  });

  readonly volatility2h = computed<MicrostructureVolatility2hResult>(() => {
    const depth = this.binance.marketDepth();
    const bankFilter = this.binance.selectedBank();
    const obi = this.obiReport();
    const ref = this.refRate();
    const bcvGap = calculateBcvGap(ref > 0 ? ref : null, this.resolvedBcvRateVes());
    const bcvWindow = predictBcvIntervention(new Date());

    const historyPoints = this.marketHistory.getFilteredPoints(bankFilter);
    const recentTicks: PriceTick[] = [];
    for (const p of historyPoints) {
      const ts = Date.parse(p.timestamp);
      if (!Number.isFinite(ts) || p.bestBuyPrice <= 0 || p.bestSellPrice <= 0) continue;
      recentTicks.push({
        timestampMs: ts,
        buyPrice: p.bestBuyPrice,
        sellPrice: p.bestSellPrice,
      });
    }

    const forecast = predictTwoHourVolatility({
      recentTicks,
      currentSpreadPct: depth ? depth.spreadPct : null,
      bcvGap,
      bcvWindow,
      spoofReport: this.spoofReport(),
      bidDepthUsdt: obi.buyVolumeUsdt,
      askDepthUsdt: obi.sellVolumeUsdt,
    });

    return {
      ...forecast,
      bcvGap,
      bcvWindow,
    };
  });

  readonly avellanedaQuotes = computed<AvellanedaStoikovResult>(() => {
    const midPrice = this.refRate();
    const bankFilter = this.binance.selectedBank();
    const measuredVolPct = this.marketHistory.computeWindowVolatilityPct(
      bankFilter,
      4 * 3600_000,
    );
    const volatilityDaily =
      measuredVolPct !== null ? Math.max(0.002, measuredVolPct / 100) : 0.02;

    return computeAvellanedaStoikovQuotes({
      midPrice,
      currentInventoryUsdt: this.currentInventoryUsdt(),
      targetInventoryUsdt: this.targetInventoryUsdt(),
      volatilityDaily,
    });
  });

  readonly slicingPlan = computed<InstitutionalSlicingResult>(() => {
    const midPrice = this.refRate();
    const obi = this.obiReport();
    const estimatedHourlyVol = obi.totalVolumeUsdt > 0 ? obi.totalVolumeUsdt : 1000;
    return computeOrderSlicingPlan({
      totalAmountUsdt: this.safeTargetUsdt(),
      executionDurationMinutes: 60,
      estimatedMarketVolumePerHourUsdt: estimatedHourlyVol,
      currentMidPrice: midPrice,
      algorithm: obi.totalVolumeUsdt > 0 ? 'VWAP' : 'TWAP',
    });
  });

  readonly markovFill = computed<MarkovFillProbabilityResult>(() => {
    const offers = this.sanitizedDepth().sanitizedOffers;
    if (offers.length === 0) {
      return calculateMakerFillProbabilityMarkov({
        queuePositionIndex: 0,
        queueAheadVolumeUsdt: 0,
        recentFillVelocityPerMinuteUsdt: 10,
      });
    }

    const queuePositionIndex = offers.length > 1 ? 1 : 0;
    const aheadOffer = queuePositionIndex > 0 ? offers[0] : null;
    const queueAheadVolumeUsdt =
      aheadOffer && aheadOffer.price > 0 ? roundMoney(aheadOffer.maxVes / aheadOffer.price, 2) : 0;

    const totalUsdt = offers.reduce(
      (sum, o) => sum + (o.price > 0 ? o.maxVes / o.price : 0),
      0,
    );
    const avgMonthlyOrders =
      offers.reduce((sum, o) => sum + o.orderCount, 0) / Math.max(1, offers.length);
    const estimatedVelocityPerMin = Math.max(
      5,
      roundMoney((totalUsdt / 60) * Math.max(0.5, avgMonthlyOrders / 200), 2),
    );

    return calculateMakerFillProbabilityMarkov({
      queuePositionIndex,
      queueAheadVolumeUsdt,
      recentFillVelocityPerMinuteUsdt: estimatedVelocityPerMin,
    });
  });

  readonly dynamicAnchors = computed<DynamicSpreadRecommendation>(() => {
    const depth = this.binance.marketDepth();
    if (!depth) {
      return computeDynamicSpreadAnchors({
        marketDepth: {
          asset: 'USDT',
          fiat: 'VES',
          bestBuyPrice: 0,
          bestSellPrice: 0,
          spreadVes: 0,
          spreadPct: 0,
          buyOffers: [],
          sellOffers: [],
          updatedAt: '',
        },
        baseMinSpreadPct: 0.6,
        strategy: 'TOP_1',
        breakEvenSellPrice: this.liveBreakEvenSellPrice(),
      });
    }

    const vol2h = this.volatility2h();
    const sanitizedDepthForAnchors: BinanceP2pMarketDepth = {
      ...depth,
      buyOffers: this.sanitizedBuyDepth().sanitizedOffers,
      sellOffers: this.sanitizedSellDepth().sanitizedOffers,
    };

    return computeDynamicSpreadAnchors({
      marketDepth: sanitizedDepthForAnchors,
      baseMinSpreadPct: 0.6,
      strategy: 'TOP_1',
      stepVes: 0.01,
      breakEvenSellPrice: this.liveBreakEvenSellPrice(),
      volatilityRegime: mapVolatilityLevelToRegime(vol2h.level),
      bcvGapPct: vol2h.bcvGap.gapPct ?? 0,
      currentInventoryUsdt: this.currentInventoryUsdt(),
      targetInventoryUsdt: this.targetInventoryUsdt(),
      bankSaturationPct: this.bankQuotaUsagePct(),
    });
  });

  readonly allBracketsSummary = computed<readonly BracketSummaryItem[]>(() => {
    const side = this.selectedSide();
    const rate = this.refRate();
    const activeOffers =
      side === 'BUY' ? this.sanitizedBuyDepth().sanitizedOffers : this.sanitizedSellDepth().sanitizedOffers;
    const oppositeOffers =
      side === 'BUY' ? this.sanitizedSellDepth().sanitizedOffers : this.sanitizedBuyDepth().sanitizedOffers;
    const oppositeSide: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY';

    return BRACKET_IDS.map((bracketId) => {
      if (rate <= 0) {
        return {
          bracket: CAPITAL_BRACKETS[bracketId],
          result: emptyBracketResult(bracketId),
          oppositeBestPrice: 0,
          estimatedGrossSpreadPct: 0,
          hasLiquidity: false,
        };
      }

      const result = filterOffersByBracket(activeOffers, bracketId, {
        exchangeRateVesPerUsd: rate,
        side,
        filterPromoted: true,
      });
      const opposite = filterOffersByBracket(oppositeOffers, bracketId, {
        exchangeRateVesPerUsd: rate,
        side: oppositeSide,
        filterPromoted: true,
      });

      const buyLeg = side === 'BUY' ? result.bestPrice : opposite.bestPrice;
      const sellLeg = side === 'SELL' ? result.bestPrice : opposite.bestPrice;
      const grossPct =
        buyLeg > 0 && sellLeg > 0 ? roundMoney(((sellLeg - buyLeg) / buyLeg) * 100, 2) : 0;

      return {
        bracket: result.bracket,
        result,
        oppositeBestPrice: opposite.bestPrice,
        estimatedGrossSpreadPct: grossPct,
        hasLiquidity: result.offers.length > 0,
      };
    });
  });

  readonly bracketResult = computed<FilteredBracketResult | null>(() => {
    const selected = this.selectedBracket();
    if (selected === 'ALL') return null;
    const match = this.allBracketsSummary().find((item) => item.bracket.id === selected);
    return match?.result ?? emptyBracketResult(selected);
  });

  readonly otcWhaleReport = computed<OtcWhaleReport>(() => {
    const offers =
      this.selectedSide() === 'BUY' ? this.filteredBuyOffers() : this.filteredSellOffers();
    const rate = this.refRate();
    if (rate <= 0 || offers.length === 0) {
      return detectOtcWhaleBlocks([], 1);
    }
    return detectOtcWhaleBlocks(offers, rate, 100_000);
  });

  readonly sqsResult = computed<LiveSpreadQualityResult | null>(() =>
    this.spreadQuality.currentMarketQuality(this.buyRole(), this.sellRole())(),
  );

  readonly makerVsTakerComparison = computed<MakerVsTakerComparison>(() => {
    const depth = this.binance.marketDepth();
    const rawBuys = this.fullBuyOffers();
    const rawSells = this.fullSellOffers();
    const sanBuy = this.sanitizedBuyDepth();
    const sanSell = this.sanitizedSellDepth();
    const anchors = this.dynamicAnchors();
    const side = this.selectedSide();
    const bankFilter = this.binance.selectedBank();
    const { bankCode, isInterbank } = resolveBankCodeAndInterbank(bankFilter);
    const capitalUsdt = this.safeTargetUsdt();

    const apparentBuyPrice = rawBuys[0]?.price ?? depth?.bestBuyPrice ?? 0;
    const apparentSellPrice = rawSells[0]?.price ?? depth?.bestSellPrice ?? 0;
    const cleanBuyPrice = sanBuy.sanitizedPrice > 0 ? sanBuy.sanitizedPrice : apparentBuyPrice;
    const cleanSellPrice = sanSell.sanitizedPrice > 0 ? sanSell.sanitizedPrice : apparentSellPrice;

    const apparentSpreadVes =
      apparentBuyPrice > 0 && apparentSellPrice > 0
        ? roundMoney(apparentSellPrice - apparentBuyPrice, 2)
        : 0;
    const apparentSpreadPct =
      apparentBuyPrice > 0 && apparentSellPrice > 0
        ? roundMoney((apparentSpreadVes / apparentBuyPrice) * 100, 2)
        : 0;

    const cleanSpreadVes =
      cleanBuyPrice > 0 && cleanSellPrice > 0
        ? roundMoney(cleanSellPrice - cleanBuyPrice, 2)
        : 0;
    const cleanSpreadPct =
      cleanBuyPrice > 0 && cleanSellPrice > 0
        ? roundMoney((cleanSpreadVes / cleanBuyPrice) * 100, 2)
        : 0;

    const trapDeltaVes = roundMoney(apparentSpreadVes - cleanSpreadVes, 2);
    const trapDeltaPct = roundMoney(apparentSpreadPct - cleanSpreadPct, 2);
    const purgedOffersCount = sanBuy.purgedSpoofCount + sanSell.purgedSpoofCount;
    const isTrap =
      purgedOffersCount > 0 ||
      trapDeltaPct >= 0.3 ||
      (apparentSpreadPct > 0 && cleanSpreadPct <= 0);

    let severity: TrapSeverity = TRAP_SEVERITIES.NONE;
    if (apparentSpreadPct > 0 && cleanSpreadPct <= 0) {
      severity = TRAP_SEVERITIES.CRITICAL;
    } else if (purgedOffersCount > 0 && trapDeltaPct >= 0.5) {
      severity = TRAP_SEVERITIES.HIGH;
    } else if (isTrap) {
      severity = TRAP_SEVERITIES.MODERATE;
    }

    const trapMessage = isTrap
      ? `Espejismo detectado: spread aparente ${apparentSpreadPct.toFixed(2)}% vs real ejecutable ${cleanSpreadPct.toFixed(2)}% (${purgedOffersCount} ofertas tóxicas depuradas).`
      : 'Libro sin distorsión significativa entre punta aparente y VWAP ejecutable.';

    const makerBuyPrice =
      anchors.recommendedBuyPrice > 0 ? anchors.recommendedBuyPrice : cleanBuyPrice;
    const makerSellPrice =
      anchors.recommendedSellPrice > 0 ? anchors.recommendedSellPrice : cleanSellPrice;

    const makerCycle =
      makerBuyPrice > 0 && makerSellPrice > 0
        ? computeArbitrageCycle({
            capitalUsdt,
            buyPrice: makerBuyPrice,
            sellPrice: makerSellPrice,
            buyRole: 'MAKER',
            sellRole: 'MAKER',
            sourceBank: bankCode,
            targetBank: bankCode,
            isInterbank,
          })
        : EMPTY_ARBITRAGE_CYCLE;

    const takerCycle =
      cleanBuyPrice > 0 && cleanSellPrice > 0
        ? computeArbitrageCycle({
            capitalUsdt,
            buyPrice: cleanBuyPrice,
            sellPrice: cleanSellPrice,
            buyRole: 'TAKER',
            sellRole: 'TAKER',
            sourceBank: bankCode,
            targetBank: bankCode,
            isInterbank,
          })
        : EMPTY_ARBITRAGE_CYCLE;

    const netAdvantageUsd = roundMoney(makerCycle.netGainUsd - takerCycle.netGainUsd, 2);
    const netAdvantagePct = roundMoney(makerCycle.roiCyclePct - takerCycle.roiCyclePct, 2);

    let recommendedMode: RecommendedExecutionMode = RECOMMENDED_EXECUTION_MODES.WAIT;
    if (makerCycle.netGainUsd > 0 || takerCycle.netGainUsd > 0) {
      recommendedMode =
        makerCycle.netGainUsd >= takerCycle.netGainUsd
          ? RECOMMENDED_EXECUTION_MODES.MAKER
          : RECOMMENDED_EXECUTION_MODES.TAKER;
    }

    const customPriceVes = side === 'BUY' ? makerBuyPrice : makerSellPrice;
    const breakEvenFloor =
      this.liveBreakEvenSellPrice() > 0 ? this.liveBreakEvenSellPrice() : makerSellPrice;

    return {
      maker: makerCycle,
      taker: takerCycle,
      makerBuyPrice,
      makerSellPrice,
      takerBuyPrice: cleanBuyPrice,
      takerSellPrice: cleanSellPrice,
      netAdvantageUsd,
      netAdvantagePct,
      recommendedMode,
      apparentVsCleanSpreadTrap: {
        apparentBuyPrice,
        apparentSellPrice,
        apparentSpreadVes,
        apparentSpreadPct,
        cleanBuyPrice,
        cleanSellPrice,
        cleanSpreadVes,
        cleanSpreadPct,
        trapDeltaVes,
        trapDeltaPct,
        purgedOffersCount,
        isTrap,
        severity,
        message: trapMessage,
      },
      deskPayload: {
        side,
        customPriceVes,
        breakEvenSellPrice: breakEvenFloor,
        maxBuyPrice: makerBuyPrice,
        targetAssetAmountUsdt: capitalUsdt,
        preferredBank: bankFilter !== 'ALL' ? bankFilter : null,
        sourceLabel: 'Microestructura L2',
      },
      repricerPayload: {
        buyPrice: makerBuyPrice,
        sellPrice: makerSellPrice,
        strategy: 'TOP_1',
        breakEvenFloor: this.liveBreakEvenSellPrice(),
        maxBuyPrice: makerBuyPrice,
        minSpreadVes: Math.max(0.01, roundMoney(makerSellPrice - makerBuyPrice, 2)),
      },
    };
  });

  private safeTargetUsdt(): number {
    const raw = this.targetUsdt();
    return Number.isFinite(raw) && raw > 0 ? raw : 100;
  }

  private computeSideSanitizedDepth(
    offers: readonly BinanceOfferSummary[],
    side: 'BUY' | 'SELL',
  ): SanitizedDepthResult {
    const ctx = this.ingestedContext();
    const target = this.safeTargetUsdt();
    if (!ctx || !this.cleanModeEnabled()) {
      const rawVwap = computeVolumeWeightedPrice(offers, side, target);
      const report = side === 'BUY' ? this.buySpoofReport() : this.sellSpoofReport();
      return {
        rawOffersCount: offers.length,
        sanitizedOffersCount: offers.length,
        purgedSpoofCount: 0,
        purgedPhantomVolumeVes: 0,
        sanitizedPrice: rawVwap.price,
        fillableUsdt: rawVwap.fillableUsdt,
        sanitizedOffers: [...offers],
        manipulationDetected: report.manipulationRiskScore >= 40,
      };
    }

    return computeMicrostructureSanitizedDepth(
      offers,
      side,
      target,
      ctx.tracker,
      ctx.ingestedAtMs,
    );
  }

  private buildEnrichedOffers(
    offers: readonly BinanceOfferSummary[],
    side: 'BUY' | 'SELL',
    deltas: ReadonlyMap<string, OfferTickDelta> | undefined,
    report: SpoofReport,
  ): EnrichedMicrostructureOffer[] {
    // Read reactive counterparty signal so CRM updates invalidate enriched offers
    void this.counterparty.counterparties();

    const classificationById = new Map<string, OrderClassification>();
    for (const c of report.classifiedOrders) {
      classificationById.set(c.advNo, c);
    }

    return offers.map((offer) => {
      const id = resolveOfferId(offer);
      const delta = deltas?.get(id);
      const cp = this.counterparty.findByQuery(offer.merchantName);
      const reputation: OfferTrustStatus = cp ? cp.reputation : OFFER_TRUST_STATUS.UNKNOWN;
      const isTrusted = reputation === OFFER_TRUST_STATUS.TRUSTED;
      const isVerifiedCounterparty =
        reputation === OFFER_TRUST_STATUS.TRUSTED || reputation === OFFER_TRUST_STATUS.VERIFIED;
      const isBlockedCounterparty = reputation === OFFER_TRUST_STATUS.BLOCKED;
      const isVerifiedPro =
        !isBlockedCounterparty &&
        (isVerifiedCounterparty || (offer.finishRatePct >= 95 && offer.orderCount >= 100));

      const classified = classificationById.get(offer.advNo);
      const estimatedUsdt = offer.price > 0 ? roundMoney(offer.maxVes / offer.price, 2) : 0;

      return {
        offer,
        side,
        deltaPrice: delta?.deltaPrice ?? 0,
        isNew: delta?.isNew ?? false,
        flashDirection: delta?.flashDirection ?? null,
        counterpartyReputation: reputation,
        isTrusted,
        isVerifiedCounterparty,
        isBlockedCounterparty,
        isVerifiedPro,
        spoofCategory: classified?.category ?? 'LEGITIMATE',
        lifespanSeconds: classified?.lifespanSeconds ?? 1,
        estimatedUsdt,
      };
    });
  }

  private computeAndStoreTickDeltas(
    sideKey: string,
    offers: readonly BinanceOfferSummary[],
  ): ReadonlyMap<string, OfferTickDelta> {
    const prevMap = this.previousPriceMaps.get(sideKey);
    const nextPriceMap = new Map<string, number>();
    const deltas = new Map<string, OfferTickDelta>();

    for (const offer of offers) {
      const id = resolveOfferId(offer);
      nextPriceMap.set(id, offer.price);

      if (!prevMap) {
        deltas.set(id, { deltaPrice: 0, isNew: false, flashDirection: null });
        continue;
      }

      const prevPrice = prevMap.get(id);
      if (prevPrice === undefined) {
        deltas.set(id, { deltaPrice: 0, isNew: true, flashDirection: FLASH_DIRECTIONS.NEW });
        continue;
      }

      const diff = roundMoney(offer.price - prevPrice, 2);
      const flashDirection: FlashDirection =
        diff > 0 ? FLASH_DIRECTIONS.UP : diff < 0 ? FLASH_DIRECTIONS.DOWN : null;
      deltas.set(id, { deltaPrice: diff, isNew: false, flashDirection });
    }

    this.previousPriceMaps.set(sideKey, nextPriceMap);
    return deltas;
  }
}
