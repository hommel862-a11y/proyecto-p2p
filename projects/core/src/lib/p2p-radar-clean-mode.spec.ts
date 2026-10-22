import { describe, expect, it } from 'vitest';
import {
  auditOfferCleanMode,
  detectPriceOutliers,
  buildCleanRadarBook,
  DEFAULT_CLEAN_MODE_CONFIG,
  type RawP2POfferInput,
  type CleanModeConfig,
} from './p2p-radar-clean-mode';

const MOCK_BASE_OFFER: RawP2POfferInput = {
  advNo: 'ADV-100',
  advertiserNo: 'USER-001',
  nickName: 'TraderPro',
  price: 98.5,
  surplusAmount: 500,
  minSingleTransAmount: 1000,
  maxSingleTransAmount: 49000,
  monthOrderCount: 150,
  monthFinishRate: 98.5,
  payTimeLimit: 15,
  isMerchant: true,
  payMethods: ['Banesco'],
};

describe('p2p-radar-clean-mode', () => {
  describe('auditOfferCleanMode', () => {
    it('approves a compliant advertisement matching all safety thresholds', () => {
      const verdict = auditOfferCleanMode(MOCK_BASE_OFFER, DEFAULT_CLEAN_MODE_CONFIG);
      expect(verdict.passed).toBe(true);
      expect(verdict.reasons).toHaveLength(0);
    });

    it('rejects advertisement exceeding maxPayTimeMinutes (45-min trap ads)', () => {
      const slowOffer: RawP2POfferInput = {
        ...MOCK_BASE_OFFER,
        advNo: 'ADV-TRAP',
        payTimeLimit: 45,
      };
      const verdict = auditOfferCleanMode(slowOffer, DEFAULT_CLEAN_MODE_CONFIG);
      expect(verdict.passed).toBe(false);
      expect(verdict.reasons).toContain('PAY_TIME_EXCEEDED');
    });

    it('rejects low completion rate (< 92%) and low order volume (< 30 orders)', () => {
      const unreliableOffer: RawP2POfferInput = {
        ...MOCK_BASE_OFFER,
        monthFinishRate: 85.0,
        monthOrderCount: 12,
      };
      const verdict = auditOfferCleanMode(unreliableOffer, DEFAULT_CLEAN_MODE_CONFIG);
      expect(verdict.passed).toBe(false);
      expect(verdict.reasons).toContain('LOW_FINISH_RATE');
      expect(verdict.reasons).toContain('LOW_ORDER_COUNT');
    });

    it('rejects liquidity traps with inadequate surplus or low single transaction ceiling', () => {
      const thinOffer: RawP2POfferInput = {
        ...MOCK_BASE_OFFER,
        surplusAmount: 5.0, // Below default 20 USDT
        maxSingleTransAmount: 500, // Below minTransAmountVes
      };
      const verdict = auditOfferCleanMode(thinOffer, DEFAULT_CLEAN_MODE_CONFIG);
      expect(verdict.passed).toBe(false);
      expect(verdict.reasons).toContain('LIQUIDITY_TRAP');
    });

    it('passes all offers unconditionally when clean mode is disabled', () => {
      const disabledConfig: CleanModeConfig = {
        ...DEFAULT_CLEAN_MODE_CONFIG,
        enabled: false,
      };
      const badOffer: RawP2POfferInput = {
        ...MOCK_BASE_OFFER,
        payTimeLimit: 60,
        monthFinishRate: 40,
        surplusAmount: 1,
      };
      const verdict = auditOfferCleanMode(badOffer, disabledConfig);
      expect(verdict.passed).toBe(true);
      expect(verdict.reasons).toHaveLength(0);
    });
  });

  describe('detectPriceOutliers', () => {
    it('returns empty set if fewer than 3 offers exist', () => {
      const smallBook = [MOCK_BASE_OFFER, { ...MOCK_BASE_OFFER, advNo: 'ADV-101', price: 98.6 }];
      const outliers = detectPriceOutliers(smallBook, 'BUY', 0.8);
      expect(outliers.size).toBe(0);
    });

    it('flags top BUY offer if price is artificially inflated (> 0.8% deviation)', () => {
      const offers: RawP2POfferInput[] = [
        { ...MOCK_BASE_OFFER, advNo: 'ADV-OUTLIER', price: 105.0 }, // > 6% above baseline
        { ...MOCK_BASE_OFFER, advNo: 'ADV-NORM-1', price: 98.6 },
        { ...MOCK_BASE_OFFER, advNo: 'ADV-NORM-2', price: 98.5 },
      ];
      const outliers = detectPriceOutliers(offers, 'BUY', 0.8);
      expect(outliers.has('ADV-OUTLIER')).toBe(true);
      expect(outliers.size).toBe(1);
    });

    it('flags top SELL offer if price is artificially dumped below baseline', () => {
      const offers: RawP2POfferInput[] = [
        { ...MOCK_BASE_OFFER, advNo: 'ADV-DUMP', price: 92.0 }, // far below 98.5
        { ...MOCK_BASE_OFFER, advNo: 'ADV-NORM-1', price: 98.4 },
        { ...MOCK_BASE_OFFER, advNo: 'ADV-NORM-2', price: 98.5 },
      ];
      const outliers = detectPriceOutliers(offers, 'SELL', 0.8);
      expect(outliers.has('ADV-DUMP')).toBe(true);
    });
  });

  describe('buildCleanRadarBook', () => {
    it('builds clean book, isolates rejected offers, and determines correct top price for VERIFIED tier', () => {
      const rawOffers: RawP2POfferInput[] = [
        // Outlier decoy
        { ...MOCK_BASE_OFFER, advNo: 'ADV-DECOY', price: 104.0, surplusAmount: 100 },
        // Compliant top offer
        { ...MOCK_BASE_OFFER, advNo: 'ADV-TOP', price: 98.7, surplusAmount: 400 },
        // Compliant second offer
        { ...MOCK_BASE_OFFER, advNo: 'ADV-2', price: 98.5, surplusAmount: 300 },
        // Pay time trap ad (45 min)
        { ...MOCK_BASE_OFFER, advNo: 'ADV-TRAP', price: 98.9, payTimeLimit: 45 },
      ];

      const cleanBook = buildCleanRadarBook(
        rawOffers,
        'BUY',
        'Banesco',
        'VERIFIED',
        DEFAULT_CLEAN_MODE_CONFIG,
      );

      expect(cleanBook.rawCount).toBe(4);
      expect(cleanBook.cleanCount).toBe(2);
      expect(cleanBook.rejectedCount).toBe(2);
      expect(cleanBook.effectiveTopPrice).toBe(98.7);
      expect(cleanBook.makerFeePct).toBe(0.10);
      expect(cleanBook.takerFeePct).toBe(0.0);
      expect(cleanBook.isHybridEligible).toBe(false);

      const decoy = cleanBook.rejectedOffers.find((o) => o.advNo === 'ADV-DECOY');
      expect(decoy?.isOutlier).toBe(true);
      expect(decoy?.verdict.reasons).toContain('MANIPULACION_DETECTADA');

      const trap = cleanBook.rejectedOffers.find((o) => o.advNo === 'ADV-TRAP');
      expect(trap?.verdict.reasons).toContain('PAY_TIME_EXCEEDED');
    });

    it('sets 0.20% maker fee and enables hybrid routing for UNVERIFIED tier', () => {
      const cleanBook = buildCleanRadarBook(
        [MOCK_BASE_OFFER],
        'SELL',
        'Mercantil',
        'UNVERIFIED',
        DEFAULT_CLEAN_MODE_CONFIG,
      );

      expect(cleanBook.userTier).toBe('UNVERIFIED');
      expect(cleanBook.makerFeePct).toBe(0.20);
      expect(cleanBook.isHybridEligible).toBe(true);
      expect(cleanBook.effectiveTopPrice).toBe(98.5);
    });
  });
});
