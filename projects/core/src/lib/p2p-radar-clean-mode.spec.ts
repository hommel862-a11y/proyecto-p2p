import { describe, expect, it } from 'vitest';
import {
  auditOfferCleanMode,
  detectPriceOutliers,
  buildCleanRadarBook,
  computeExecutableCapitalPrice,
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
      expect(cleanBook.makerFeePct).toBe(0.2);
      expect(cleanBook.takerFeePct).toBe(0.0);
      expect(cleanBook.isHybridEligible).toBe(false);

      const decoy = cleanBook.rejectedOffers.find((o) => o.advNo === 'ADV-DECOY');
      expect(decoy?.isOutlier).toBe(true);
      expect(decoy?.verdict.reasons).toContain('MANIPULACION_DETECTADA');

      const trap = cleanBook.rejectedOffers.find((o) => o.advNo === 'ADV-TRAP');
      expect(trap?.verdict.reasons).toContain('PAY_TIME_EXCEEDED');
    });

    it('sets 0.25% maker fee and enables hybrid routing for UNVERIFIED tier', () => {
      const cleanBook = buildCleanRadarBook(
        [MOCK_BASE_OFFER],
        'SELL',
        'Mercantil',
        'UNVERIFIED',
        DEFAULT_CLEAN_MODE_CONFIG,
      );

      expect(cleanBook.userTier).toBe('UNVERIFIED');
      expect(cleanBook.makerFeePct).toBe(0.25);
      expect(cleanBook.isHybridEligible).toBe(true);
      expect(cleanBook.effectiveTopPrice).toBe(98.5);
    });

    it('rejects NaN / non-finite offers and computes capital-weighted executable prices', () => {
      const nanVerdict = auditOfferCleanMode(
        { ...MOCK_BASE_OFFER, price: Number.NaN, surplusAmount: Number.NaN },
        DEFAULT_CLEAN_MODE_CONFIG,
      );
      expect(nanVerdict.passed).toBe(false);
      expect(nanVerdict.reasons).toContain('LIQUIDITY_TRAP');

      const book = buildCleanRadarBook(
        [
          { ...MOCK_BASE_OFFER, advNo: 'A1', price: 100.0, surplusAmount: 100 },
          { ...MOCK_BASE_OFFER, advNo: 'A2', price: 101.0, surplusAmount: 400 },
        ],
        'SELL',
        'Banesco',
        'VERIFIED',
      );
      const quote = computeExecutableCapitalPrice(book.cleanOffers, 500);
      // (100*100 + 400*101) / 500 = 100.8
      expect(quote.executablePrice).toBe(100.8);
      expect(quote.coveragePct).toBe(100);
    });

    it('rejects unfillable ghost traps (surplusAmount * price < minSingleTransAmount), inverted bounds, and 0 payTimeLimit', () => {
      // surplusAmount=25 passes >=20 USDT, maxSingleTransAmount=30000 passes >=20000,
      // yet 25 * 100 = 2500 Bs < minSingleTransAmount 5000 Bs (unfillable ghost ad!)
      const fiatTrap = auditOfferCleanMode(
        {
          ...MOCK_BASE_OFFER,
          price: 100,
          surplusAmount: 25,
          minSingleTransAmount: 5000,
          maxSingleTransAmount: 30000,
        },
        DEFAULT_CLEAN_MODE_CONFIG,
      );
      expect(fiatTrap.passed).toBe(false);
      expect(fiatTrap.reasons).toContain('LIQUIDITY_TRAP');

      const invertedBounds = auditOfferCleanMode(
        {
          ...MOCK_BASE_OFFER,
          minSingleTransAmount: 60000,
          maxSingleTransAmount: 40000,
        },
        DEFAULT_CLEAN_MODE_CONFIG,
      );
      expect(invertedBounds.passed).toBe(false);
      expect(invertedBounds.reasons).toContain('LIQUIDITY_TRAP');

      const zeroPayTime = auditOfferCleanMode(
        {
          ...MOCK_BASE_OFFER,
          payTimeLimit: 0,
        },
        DEFAULT_CLEAN_MODE_CONFIG,
      );
      expect(zeroPayTime.passed).toBe(false);
      expect(zeroPayTime.reasons).toContain('PAY_TIME_EXCEEDED');
    });

    it('flags consecutive multi-bot outlier chains and respects maxOutlierSurplusUsdt cap', () => {
      const multiBotBook: RawP2POfferInput[] = [
        { ...MOCK_BASE_OFFER, advNo: 'BOT-1', price: 105.0, surplusAmount: 40 },
        { ...MOCK_BASE_OFFER, advNo: 'BOT-2', price: 104.5, surplusAmount: 40 },
        { ...MOCK_BASE_OFFER, advNo: 'REAL-1', price: 98.6, surplusAmount: 800 },
        { ...MOCK_BASE_OFFER, advNo: 'REAL-2', price: 98.5, surplusAmount: 900 },
        { ...MOCK_BASE_OFFER, advNo: 'REAL-3', price: 98.4, surplusAmount: 750 },
      ];
      const outliers = detectPriceOutliers(multiBotBook, 'BUY', 0.8, 120);
      expect(outliers.has('BOT-1')).toBe(true);
      expect(outliers.has('BOT-2')).toBe(true);
      expect(outliers.has('REAL-1')).toBe(false);

      // Legitimate deep top-1 offer (> maxOutlierSurplusUsdt) must not be flagged
      const deepCleanBook = buildCleanRadarBook(
        [
          { ...MOCK_BASE_OFFER, advNo: 'WHALE-1', price: 102.0, surplusAmount: 2500 },
          { ...MOCK_BASE_OFFER, advNo: 'NORM-1', price: 98.5, surplusAmount: 300 },
          { ...MOCK_BASE_OFFER, advNo: 'NORM-2', price: 98.4, surplusAmount: 300 },
        ],
        'BUY',
        'Banesco',
        'UNVERIFIED',
        { ...DEFAULT_CLEAN_MODE_CONFIG, maxOutlierSurplusUsdt: 150 },
      );
      expect(deepCleanBook.cleanOffers.some((o) => o.advNo === 'WHALE-1')).toBe(true);
    });

    it('supports MakerMerchantLevel (STANDARD 0.25%..GOLD 0.125%), merchantWallPct, and taker eligibility badges', () => {
      const mixedBook: RawP2POfferInput[] = [
        {
          ...MOCK_BASE_OFFER,
          advNo: 'MERCH-GOLD',
          price: 98.0,
          isMerchant: true,
          isProMerchant: true,
          buyerRegDaysLimit: 90,
          buyerBtcPositionLimit: 0.05,
        },
        {
          ...MOCK_BASE_OFFER,
          advNo: 'FREE-OPEN-1',
          price: 98.4,
          isMerchant: false,
          userType: 'user',
          buyerRegDaysLimit: 0,
          buyerBtcPositionLimit: 0,
          takerAdditionalKycRequired: false,
        },
      ];

      const stdBook = buildCleanRadarBook(
        mixedBook,
        'BUY',
        'SpecificBank',
        'UNVERIFIED',
        DEFAULT_CLEAN_MODE_CONFIG,
        { merchantLevel: 'STANDARD' },
      );

      expect(stdBook.merchantLevel).toBe('STANDARD');
      expect(stdBook.makerFeePct).toBe(0.25);
      expect(stdBook.merchantWallPct).toBe(50);
      expect(stdBook.openTakerCount).toBe(1);
      expect(stdBook.freeAdvertiserCount).toBe(1);

      const goldBook = buildCleanRadarBook(
        mixedBook,
        'BUY',
        'SpecificBank',
        'VERIFIED',
        DEFAULT_CLEAN_MODE_CONFIG,
        { merchantLevel: 'GOLD', excludeMerchantCompetitors: true, requireOpenTakerEligibility: true },
      );
      expect(goldBook.makerFeePct).toBe(0.125);
      expect(goldBook.cleanOffers.map((o) => o.advNo)).toEqual(['FREE-OPEN-1']);
      expect(goldBook.cleanOffers[0].takerEligibility).toBe('OPEN');
    });
  });
});
