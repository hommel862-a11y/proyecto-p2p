import { describe, expect, it } from 'vitest';
import {
  calculateArbitrageCycle,
  scanArbitrageMatrix,
  resolveMakerFeeRatio,
} from './p2p-radar-spread-engine';
import type { RadarCleanBook } from './p2p-radar-clean-mode';

describe('p2p-radar-spread-engine', () => {
  describe('resolveMakerFeeRatio', () => {
    it('returns preferred 0.20% for VERIFIED tier', () => {
      expect(resolveMakerFeeRatio('VERIFIED')).toBe(0.002);
    });

    it('returns standard 0.35% for UNVERIFIED tier', () => {
      expect(resolveMakerFeeRatio('UNVERIFIED')).toBe(0.0035);
    });

    it('honors custom fee override when provided', () => {
      expect(resolveMakerFeeRatio('VERIFIED', 0.15)).toBe(0.0015);
    });
  });

  describe('calculateArbitrageCycle', () => {
    it('calculates DOBLE_MAKER cycle with exact fees and break-even rates', () => {
      const metrics = calculateArbitrageCycle({
        buyPrice: 98.0,
        sellPrice: 100.0,
        capitalUsdt: 1000,
        mode: 'DOBLE_MAKER',
        userTier: 'VERIFIED', // 0.2% buy, 0.2% sell
        fiatFrictionPct: 0,
        targetNetMarginPct: 0.5,
      });

      // Gross spread: (100 - 98) / 98 = +2.04%
      expect(metrics.grossSpreadPct).toBe(2.04);

      // K = (1 - 0.002) * (1 - 0.002) = 0.998 * 0.998 = 0.996004
      // Net multiplier: (100 / 98) * 0.996004 = 1.01633
      // Net spread: +1.63%
      expect(metrics.netSpreadPct).toBe(1.63);
      expect(metrics.isViable).toBe(true);
      expect(metrics.netProfitUsdt).toBeGreaterThan(16);

      // Break-even sell price: 98 / 0.996004 = 98.3932
      expect(metrics.breakEvenSellPrice).toBe(98.3932);

      // Verify Break-Even mathematically:
      const beMetrics = calculateArbitrageCycle({
        buyPrice: 98.0,
        sellPrice: metrics.breakEvenSellPrice,
        capitalUsdt: 1000,
        mode: 'DOBLE_MAKER',
        userTier: 'VERIFIED',
      });
      expect(Math.abs(beMetrics.netProfitUsdt)).toBeLessThanOrEqual(0.01);
    });

    it('supports MAKER_COMPRA_TAKER_VENTA with zero sell Maker fee', () => {
      const metrics = calculateArbitrageCycle({
        buyPrice: 98.0,
        sellPrice: 100.0,
        capitalUsdt: 1000,
        mode: 'MAKER_COMPRA_TAKER_VENTA',
        userTier: 'UNVERIFIED', // 0.35% buy, 0% sell
        fiatFrictionPct: 0,
      });

      // K = (1 - 0.0035) * (1 - 0) = 0.9965
      // Net multiplier: (100 / 98) * 0.9965 = 1.016836
      expect(metrics.netSpreadPct).toBe(1.68);
      expect(metrics.isViable).toBe(true);
    });

    it('supports TAKER_COMPRA_MAKER_VENTA with zero buy Maker fee', () => {
      const metrics = calculateArbitrageCycle({
        buyPrice: 98.0,
        sellPrice: 100.0,
        capitalUsdt: 1000,
        mode: 'TAKER_COMPRA_MAKER_VENTA',
        userTier: 'UNVERIFIED', // 0% buy, 0.35% sell
        fiatFrictionPct: 0,
      });

      // K = (1 - 0) * (1 - 0.0035) = 0.9965
      expect(metrics.netSpreadPct).toBe(1.68);
    });

    it('applies fiat banking friction (e.g. Pago Móvil 0.3%) correctly', () => {
      const withoutFriction = calculateArbitrageCycle({
        buyPrice: 98.0,
        sellPrice: 100.0,
        capitalUsdt: 1000,
        mode: 'DOBLE_MAKER',
        userTier: 'VERIFIED',
        fiatFrictionPct: 0,
      });

      const withFriction = calculateArbitrageCycle({
        buyPrice: 98.0,
        sellPrice: 100.0,
        capitalUsdt: 1000,
        mode: 'DOBLE_MAKER',
        userTier: 'VERIFIED',
        fiatFrictionPct: 0.3,
      });

      expect(withFriction.netSpreadPct).toBeLessThan(withoutFriction.netSpreadPct);
      expect(withFriction.breakEvenSellPrice).toBeGreaterThan(withoutFriction.breakEvenSellPrice);
      expect(withFriction.fiatFrictionCostFiat).toBeGreaterThan(0);
    });

    it('identifies unviable negative spread cycles', () => {
      const metrics = calculateArbitrageCycle({
        buyPrice: 100.0,
        sellPrice: 99.0,
        capitalUsdt: 1000,
        mode: 'DOBLE_MAKER',
        userTier: 'VERIFIED',
      });

      expect(metrics.grossSpreadPct).toBe(-1.0);
      expect(metrics.netSpreadPct).toBeLessThan(-1.0);
      expect(metrics.isViable).toBe(false);
      expect(metrics.netProfitUsdt).toBeLessThan(0);
    });

    it('calculates target sell price to hit desired net margin', () => {
      const desiredMargin = 0.75; // +0.75%
      const metrics = calculateArbitrageCycle({
        buyPrice: 98.0,
        sellPrice: 100.0,
        capitalUsdt: 1000,
        mode: 'DOBLE_MAKER',
        userTier: 'VERIFIED',
        targetNetMarginPct: desiredMargin,
      });

      // If we sell at targetSellPrice, net spread should be approx 0.75%
      const targetVerify = calculateArbitrageCycle({
        buyPrice: 98.0,
        sellPrice: metrics.targetSellPrice,
        capitalUsdt: 1000,
        mode: 'DOBLE_MAKER',
        userTier: 'VERIFIED',
      });

      expect(targetVerify.netSpreadPct).toBeCloseTo(desiredMargin, 1);
    });
  });

  describe('scanArbitrageMatrix', () => {
    function makeCleanBook(
      payMethod: string,
      side: 'BUY' | 'SELL',
      topPrice: number,
    ): RadarCleanBook {
      return {
        side,
        payMethod,
        userTier: 'VERIFIED',
        cleanOffers: [
          {
            advNo: `ADV-${payMethod}-${side}`,
            advertiserNo: `USR-${payMethod}`,
            nickName: `Trader-${payMethod}`,
            price: topPrice,
            surplusAmount: 1000,
            minSingleTransAmount: 1000,
            maxSingleTransAmount: 50000,
            monthOrderCount: 150,
            monthFinishRate: 98,
            payTimeLimit: 15,
            isMerchant: true,
            isClean: true,
            isOutlier: false,
            verdict: { passed: true, reasons: [] },
          },
        ],
        rejectedOffers: [],
        rawCount: 1,
        cleanCount: 1,
        rejectedCount: 0,
        effectiveTopPrice: topPrice,
        makerFeePct: 0.2,
        takerFeePct: 0.0,
        isHybridEligible: true,
      };
    }

    it('crosses all banks and ranks Top 3 most profitable routes', () => {
      const books = new Map<string, RadarCleanBook>();

      // Banesco
      books.set('Banesco_SELL', makeCleanBook('Banesco', 'SELL', 101.5));
      books.set('Banesco_BUY', makeCleanBook('Banesco', 'BUY', 98.0));

      // Mercantil
      books.set('Mercantil_SELL', makeCleanBook('Mercantil', 'SELL', 100.8));
      books.set('Mercantil_BUY', makeCleanBook('Mercantil', 'BUY', 98.5));

      // BDV
      books.set('SpecificBank_SELL', makeCleanBook('SpecificBank', 'SELL', 100.0));
      books.set('SpecificBank_BUY', makeCleanBook('SpecificBank', 'BUY', 97.5));

      const result = scanArbitrageMatrix(books, {
        capitalUsdt: 1000,
        mode: 'DOBLE_MAKER',
        userTier: 'VERIFIED',
        interbankFrictionPct: 0.3,
        monobankFrictionPct: 0.0,
      });

      expect(result.scannedBanksCount).toBe(3);
      expect(result.scannedPairsCount).toBe(9); // 3x3 combinations
      expect(result.allRoutes.length).toBe(9);
      expect(result.topRoutes.length).toBe(3);
      expect(result.bestRoute).toBeDefined();

      // Best route should be selling on highest rate and buying on lowest rate
      // Highest SELL: Banesco at 101.5. Lowest BUY: SpecificBank at 97.5 or Banesco at 98.0
      expect(result.bestRoute?.rank).toBe(1);
      expect(result.bestRoute?.metrics.isViable).toBe(true);

      // Verify sorting: route 1 net spread >= route 2 net spread
      expect(result.allRoutes[0].metrics.netSpreadPct).toBeGreaterThanOrEqual(
        result.allRoutes[1].metrics.netSpreadPct,
      );
      expect(result.allRoutes[1].metrics.netSpreadPct).toBeGreaterThanOrEqual(
        result.allRoutes[2].metrics.netSpreadPct,
      );
    });
  });
});
