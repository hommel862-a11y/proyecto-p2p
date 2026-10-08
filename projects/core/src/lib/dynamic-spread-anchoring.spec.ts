import { describe, it, expect } from 'vitest';
import {
  calculateVolatilitySpreadBuffer,
  calculateInventorySkew,
  computeDynamicSpreadAnchors,
  formatDynamicRepricerTelegramMessage,
  type DynamicSpreadInput,
} from './dynamic-spread-anchoring';
import type { BinanceP2pMarketDepth } from './binance-p2p';

describe('Dynamic L2 Spread Anchoring Engine', () => {
  const mockMarketDepth: BinanceP2pMarketDepth = {
    bestBuyPrice: 95.0,
    bestSellPrice: 96.5,
    grossSpreadPct: 1.58,
    totalBuyVolumeUsdt: 15000,
    totalSellVolumeUsdt: 12000,
    buyOffers: [
      {
        advNo: 'buy-1',
        price: 95.0,
        surplusAmount: 500,
        minSingleTransAmount: 100,
        maxSingleTransAmount: 50000,
        tradeType: 'BUY',
        asset: 'USDT',
        fiatUnit: 'VES',
        payMethods: ['Banesco'],
        merchantName: 'TraderPro',
        merchantOrders: 200,
        merchantFinishRate: 99.0,
        isMerchant: true,
      },
    ],
    sellOffers: [
      {
        advNo: 'sell-1',
        price: 96.5,
        surplusAmount: 500,
        minSingleTransAmount: 100,
        maxSingleTransAmount: 50000,
        tradeType: 'SELL',
        asset: 'USDT',
        fiatUnit: 'VES',
        payMethods: ['Banesco'],
        merchantName: 'CryptoKing',
        merchantOrders: 350,
        merchantFinishRate: 98.5,
        isMerchant: true,
      },
    ],
  };

  describe('calculateVolatilitySpreadBuffer', () => {
    it('returns 0 buffer for LOW regime with small BCV gap', () => {
      expect(calculateVolatilitySpreadBuffer('LOW', 5)).toBe(0);
    });

    it('returns 0.25 buffer for MEDIUM regime', () => {
      expect(calculateVolatilitySpreadBuffer('MEDIUM', 5)).toBe(0.25);
    });

    it('adds additional buffer for elevated BCV gap (>= 15% and >= 20%)', () => {
      expect(calculateVolatilitySpreadBuffer('HIGH', 16)).toBe(0.85); // 0.60 + 0.25
      expect(calculateVolatilitySpreadBuffer('EXTREME', 22)).toBe(1.70); // 1.20 + 0.50
    });
  });

  describe('calculateInventorySkew', () => {
    it('returns BALANCED when inventory matches target ratio', () => {
      const res = calculateInventorySkew(1000, 1000);
      expect(res.skew).toBe('BALANCED');
      expect(res.adjustmentPct).toBe(0);
    });

    it('returns HEAVY_CRYPTO when crypto inventory exceeds 125%', () => {
      const res = calculateInventorySkew(1500, 1000); // 1.5 ratio
      expect(res.skew).toBe('HEAVY_CRYPTO');
      expect(res.adjustmentPct).toBeGreaterThan(0);
    });

    it('returns HEAVY_FIAT when crypto inventory is below 75%', () => {
      const res = calculateInventorySkew(500, 1000); // 0.5 ratio
      expect(res.skew).toBe('HEAVY_FIAT');
      expect(res.adjustmentPct).toBeGreaterThan(0);
    });
  });

  describe('computeDynamicSpreadAnchors', () => {
    it('generates optimal UPDATE decision on liquid book with adequate spread', () => {
      const input: DynamicSpreadInput = {
        marketDepth: mockMarketDepth,
        baseMinSpreadPct: 0.60,
        strategy: 'TOP_1',
        breakEvenSellPrice: 94.0,
        volatilityRegime: 'LOW',
        bcvGapPct: 5,
        bankSaturationPct: 20,
      };

      const decision = computeDynamicSpreadAnchors(input);
      expect(decision.action).toBe('UPDATE');
      expect(decision.isSafe).toBe(true);
      expect(decision.recommendedBuyPrice).toBe(95.0);
      expect(decision.recommendedSellPrice).toBe(96.5);
      expect(decision.projectedNetSpreadPct).toBeGreaterThan(0.60);
    });

    it('triggers PAUSE when bank saturation is critical (>= 90%)', () => {
      const input: DynamicSpreadInput = {
        marketDepth: mockMarketDepth,
        baseMinSpreadPct: 0.60,
        strategy: 'TOP_1',
        breakEvenSellPrice: 94.0,
        bankSaturationPct: 92,
      };

      const decision = computeDynamicSpreadAnchors(input);
      expect(decision.action).toBe('PAUSE');
      expect(decision.isSafe).toBe(false);
      expect(decision.safetyFlags).toContain('BANK_SATURATION_CRITICAL');
    });

    it('triggers PAUSE when net spread is below dynamic minimum spread with volatility buffer', () => {
      const tightMarketDepth: BinanceP2pMarketDepth = {
        ...mockMarketDepth,
        bestBuyPrice: 96.2,
        bestSellPrice: 96.5,
        buyOffers: [{ ...mockMarketDepth.buyOffers[0], price: 96.2 }],
        sellOffers: [{ ...mockMarketDepth.sellOffers[0], price: 96.5 }],
      };

      const input: DynamicSpreadInput = {
        marketDepth: tightMarketDepth,
        baseMinSpreadPct: 0.80,
        strategy: 'TOP_1',
        breakEvenSellPrice: 94.0,
        volatilityRegime: 'HIGH', // adds +0.60% buffer -> required 1.40%
      };

      const decision = computeDynamicSpreadAnchors(input);
      expect(decision.action).toBe('PAUSE');
      expect(decision.isSafe).toBe(false);
      expect(decision.safetyFlags).toContain('SPREAD_BELOW_DYNAMIC_MINIMUM');
    });

    it('enforces breakEvenSellPrice hard floor', () => {
      const input: DynamicSpreadInput = {
        marketDepth: mockMarketDepth,
        baseMinSpreadPct: 0.20,
        strategy: 'TOP_1',
        breakEvenSellPrice: 97.0, // higher than current best sell 96.5
      };

      const decision = computeDynamicSpreadAnchors(input);
      expect(decision.safetyFlags).toContain('BREAK_EVEN_VIOLATION');
      expect(decision.recommendedSellPrice).toBe(97.0);
    });

    it('returns KEEP when prices are already aligned', () => {
      const input: DynamicSpreadInput = {
        marketDepth: mockMarketDepth,
        baseMinSpreadPct: 0.60,
        strategy: 'TOP_1',
        breakEvenSellPrice: 94.0,
        currentBuyPrice: 95.0,
        currentSellPrice: 96.5,
      };

      const decision = computeDynamicSpreadAnchors(input);
      expect(decision.action).toBe('KEEP');
      expect(decision.isSafe).toBe(true);
    });
  });

  describe('formatDynamicRepricerTelegramMessage', () => {
    it('formats a clean MarkdownV2 message', () => {
      const input: DynamicSpreadInput = {
        marketDepth: mockMarketDepth,
        baseMinSpreadPct: 0.60,
        strategy: 'TOP_1',
        breakEvenSellPrice: 94.0,
      };
      const decision = computeDynamicSpreadAnchors(input);
      const msg = formatDynamicRepricerTelegramMessage(decision, true);

      expect(msg).toContain('MOTOR DE REPRECIO DINÁMICO 24/7');
      expect(msg).toContain('AUTÓNOMO ACTIVO');
      expect(msg).toContain('95.00');
    });
  });
});
