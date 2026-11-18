import { computed, inject, Injectable, type Signal } from '@angular/core';
import {
  computeSpreadQualityScore,
  type SpreadQualityResult,
  type SpreadQualityInput,
  type BankCode,
  type P2PRole,
} from '@p2p/core';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import { MarketHistoryService } from './market-history.service';

export const VOLATILITY_SOURCE = {
  MEASURED: 'MEASURED',
  DEFAULT_INSUFFICIENT_HISTORY: 'DEFAULT_INSUFFICIENT_HISTORY',
} as const;

export type VolatilitySource = (typeof VOLATILITY_SOURCE)[keyof typeof VOLATILITY_SOURCE];

export interface LiveSpreadQualityResult extends SpreadQualityResult {
  readonly volatility4hPct: number;
  readonly volatilitySource: VolatilitySource;
  readonly accountUsagePct: number;
  readonly bankCode: BankCode;
  readonly isInterbank: boolean;
}

export interface CustomSpreadOverrides {
  readonly volatility4hPct?: number;
  readonly sourceBank?: BankCode;
  readonly targetBank?: BankCode;
  readonly isInterbank?: boolean;
  readonly capitalUsdt?: number;
}

interface ResolvedBankSelection {
  readonly bankFilter: string;
  readonly bankCode: BankCode;
  readonly isInterbank: boolean;
}

interface MarketQualityEvaluationBase {
  readonly input: SpreadQualityInput;
  readonly volatility4hPct: number;
  readonly volatilitySource: VolatilitySource;
  readonly bankCode: BankCode;
  readonly isInterbank: boolean;
}

const DEFAULT_FALLBACK_VOLATILITY_PCT = 0.4;
const VOLATILITY_WINDOW_MS = 4 * 3600_000;

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

function resolveBankSelection(bankFilter: string): ResolvedBankSelection {
  if (bankFilter === 'PAGO_MOVIL') {
    return { bankFilter, bankCode: 'OTRO', isInterbank: true };
  }
  if (KNOWN_BANK_CODES.has(bankFilter as BankCode)) {
    return { bankFilter, bankCode: bankFilter as BankCode, isInterbank: false };
  }
  return { bankFilter, bankCode: 'BANESCO', isInterbank: false };
}

/**
 * Service that connects real-time Binance P2P market depth, historical volatility,
 * and bank treasury usage with the pure domain Spread Quality Score (SQS) engine.
 */
@Injectable({
  providedIn: 'root',
})
export class SpreadQualityService {
  private readonly binance = inject(BinanceP2pService);
  private readonly accounts = inject(AccountsService);
  private readonly marketHistory = inject(MarketHistoryService, { optional: true });

  private readonly qualitySignalCache = new Map<string, Signal<LiveSpreadQualityResult | null>>();

  readonly measuredVolatility4hPct = computed<number | null>(() => {
    const bankFilter = this.binance.selectedBank();
    return this.marketHistory?.computeWindowVolatilityPct(bankFilter, VOLATILITY_WINDOW_MS) ?? null;
  });

  readonly volatilitySource = computed<VolatilitySource>(() =>
    this.measuredVolatility4hPct() !== null
      ? VOLATILITY_SOURCE.MEASURED
      : VOLATILITY_SOURCE.DEFAULT_INSUFFICIENT_HISTORY,
  );

  readonly volatility4hPct = computed<number>(
    () => this.measuredVolatility4hPct() ?? DEFAULT_FALLBACK_VOLATILITY_PCT,
  );

  /** Shared depth/treasury/volatility inputs that feed {@link currentMarketQuality}. */
  private readonly marketQualityInputs = computed<MarketQualityEvaluationBase | null>(() => {
    const depth = this.binance.marketDepth();
    if (!depth || depth.bestBuyPrice <= 0 || depth.bestSellPrice <= 0) {
      return null;
    }

    const { bankFilter, bankCode, isInterbank } = resolveBankSelection(this.binance.selectedBank());
    const accountsUsage = this.accounts.treasurySummary().accountsUsage;

    const matching =
      bankFilter === 'ALL'
        ? []
        : accountsUsage.filter((u) => u.account.bankCode === bankCode);
    const pool = matching.length > 0 ? matching : accountsUsage;
    const accountUsagePct =
      pool.length > 0
        ? Math.round(
            (pool.reduce((sum, u) => sum + u.consumedLimitPct, 0) / pool.length) * 100,
          ) / 100
        : 0;

    const volPct = this.volatility4hPct();
    const volSource = this.volatilitySource();

    return {
      input: {
        buyPrice: depth.bestBuyPrice,
        sellPrice: depth.bestSellPrice,
        bankCode,
        sourceBank: bankCode,
        targetBank: bankCode,
        isInterbank,
        accountUsagePct,
        volatility4hPct: volPct,
      },
      volatility4hPct: volPct,
      volatilitySource: volSource,
      bankCode,
      isInterbank,
    };
  });

  /**
   * Evaluates market quality in real time based on current Binance depth.
   * Memoized per `(buyRole, sellRole)` key so reactive readers never allocate new `computed()` nodes.
   */
  currentMarketQuality(
    buyRole: P2PRole = 'TAKER',
    sellRole: P2PRole = 'TAKER',
  ): Signal<LiveSpreadQualityResult | null> {
    const cacheKey = `${buyRole}:${sellRole}`;
    const existing = this.qualitySignalCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const qualitySignal = computed<LiveSpreadQualityResult | null>(() => {
      const base = this.marketQualityInputs();
      if (!base) return null;
      try {
        const result = computeSpreadQualityScore({ ...base.input, buyRole, sellRole });
        return {
          ...result,
          volatility4hPct: base.volatility4hPct,
          volatilitySource: base.volatilitySource,
          accountUsagePct: base.input.accountUsagePct ?? 0,
          bankCode: base.bankCode,
          isInterbank: base.isInterbank,
        };
      } catch {
        return null;
      }
    });

    this.qualitySignalCache.set(cacheKey, qualitySignal);
    return qualitySignal;
  }

  /**
   * Helper to compute SQS for arbitrary manual prices and parameters.
   */
  evaluateCustomSpread(
    buyPrice: number,
    sellPrice: number,
    bankCode: BankCode = 'BANESCO',
    accountUsagePct = 20,
    buyRole: P2PRole = 'TAKER',
    sellRole: P2PRole = 'TAKER',
    overrides?: CustomSpreadOverrides,
  ): SpreadQualityResult | null {
    if (buyPrice <= 0 || sellPrice <= 0) return null;
    try {
      return computeSpreadQualityScore({
        buyPrice,
        sellPrice,
        bankCode,
        sourceBank: overrides?.sourceBank ?? bankCode,
        targetBank: overrides?.targetBank ?? bankCode,
        isInterbank: overrides?.isInterbank,
        capitalUsdt: overrides?.capitalUsdt,
        volatility4hPct: overrides?.volatility4hPct,
        accountUsagePct,
        buyRole,
        sellRole,
      });
    } catch {
      return null;
    }
  }
}
