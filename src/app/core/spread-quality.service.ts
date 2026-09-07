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

/**
 * Service that connects real-time Binance P2P market depth and bank treasury usage
 * with the pure domain Spread Quality Score (SQS) engine.
 */
@Injectable({
  providedIn: 'root',
})
export class SpreadQualityService {
  private readonly binance = inject(BinanceP2pService);
  private readonly accounts = inject(AccountsService);

  /** Shared depth/treasury inputs that feed {@link currentMarketQuality}. */
  private readonly marketQualityInputs = computed<SpreadQualityInput | null>(() => {
    const depth = this.binance.marketDepth();
    if (!depth || depth.bestBuyPrice <= 0 || depth.bestSellPrice <= 0) {
      return null;
    }

    // Map selected bank filter to BankCode:
    const bankFilter = this.binance.selectedBank();
    const bankCode: BankCode =
      bankFilter === 'BANESCO' ||
      bankFilter === 'MERCANTIL' ||
      bankFilter === 'BDV' ||
      bankFilter === 'BANCAMIGA' ||
      bankFilter === 'PROVINCIAL'
        ? bankFilter
        : 'BANESCO';

    // Get worst or average limit usage across tracked accounts:
    const treasury = this.accounts.treasurySummary();
    const primaryUsage = treasury.accountsUsage.find((u) => u.account.bankCode === bankCode);
    const accountUsagePct = primaryUsage ? primaryUsage.consumedLimitPct : 20;

    return {
      buyPrice: depth.bestBuyPrice,
      sellPrice: depth.bestSellPrice,
      bankCode,
      accountUsagePct,
      volatility4hPct: 0.45,
    };
  });

  /**
   * Evaluates market quality in real time based on current Binance depth.
   * Accepts optional MAKER/TAKER roles (default TAKER) to reflect what the
   * trader is actually paying; returns a reactive signal.
   */
  currentMarketQuality(
    buyRole: P2PRole = 'TAKER',
    sellRole: P2PRole = 'TAKER',
  ): Signal<SpreadQualityResult | null> {
    return computed(() => {
      const base = this.marketQualityInputs();
      if (!base) return null;
      try {
        return computeSpreadQualityScore({ ...base, buyRole, sellRole });
      } catch {
        return null;
      }
    });
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
  ): SpreadQualityResult | null {
    if (buyPrice <= 0 || sellPrice <= 0) return null;
    try {
      return computeSpreadQualityScore({
        buyPrice,
        sellPrice,
        bankCode,
        accountUsagePct,
        buyRole,
        sellRole,
      });
    } catch {
      return null;
    }
  }
}
