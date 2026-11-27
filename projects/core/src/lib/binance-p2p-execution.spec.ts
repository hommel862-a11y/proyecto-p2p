import { describe, it, expect } from 'vitest';
import {
  buildBinanceAdDeepLink,
  buildBinanceAdvertiserDeepLink,
  buildBinanceAdvPostUrl,
  buildBinanceMyAdsUrl,
  canUseMerchantWriteApi,
  deriveKycStatsFromOrderHistory,
  evaluateKycMakerEligibility,
  evaluateTakerPreFlight,
  isAllowedBinanceExecutionUrl,
  resolveBinanceExecutionTarget,
  resolveCanonicalMakerFeePct,
} from './binance-p2p-execution';

const ADV = '11218246497340923904';
const USER = 's8415f1294ebc335a98b50b6b5b7c5dea';

describe('Binance P2P deep links', () => {
  it('builds the official ad checkout link with es-LA default locale', () => {
    expect(buildBinanceAdDeepLink(ADV)).toBe(`https://c2c.binance.com/es-LA/adv?code=${ADV}`);
  });

  it('builds the advertiser profile link', () => {
    expect(buildBinanceAdvertiserDeepLink(USER, 'en')).toBe(
      `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${USER}`,
    );
  });

  it('rejects malformed ids and unsafe locales', () => {
    expect(buildBinanceAdDeepLink('adv-buy-1')).toBeNull();
    expect(buildBinanceAdDeepLink('123"><script>')).toBeNull();
    expect(buildBinanceAdvertiserDeepLink('UNKNOWN')).toBeNull();
    expect(buildBinanceAdvertiserDeepLink('../../evil')).toBeNull();
    expect(buildBinanceAdDeepLink(ADV, '../x')).toBe(`https://c2c.binance.com/es-LA/adv?code=${ADV}`);
  });

  it('builds my-ads and post-ad urls', () => {
    expect(buildBinanceMyAdsUrl()).toBe('https://p2p.binance.com/es-LA/myads');
    expect(buildBinanceAdvPostUrl()).toBe('https://p2p.binance.com/es-LA/advPost');
  });

  it('prefers the ad and falls back to the advertiser profile', () => {
    expect(resolveBinanceExecutionTarget({ advNo: ADV, advertiserNo: USER }).kind).toBe('AD');
    expect(resolveBinanceExecutionTarget({ advNo: 'bad', advertiserNo: USER }).kind).toBe('ADVERTISER');
    expect(
      resolveBinanceExecutionTarget({ advNo: ADV, advertiserNo: USER, preferAdvertiser: true }).kind,
    ).toBe('ADVERTISER');
    expect(resolveBinanceExecutionTarget({}).kind).toBe('NONE');
  });

  it('allows only https binance hosts', () => {
    expect(isAllowedBinanceExecutionUrl(`https://c2c.binance.com/es-LA/adv?code=${ADV}`)).toBe(true);
    expect(isAllowedBinanceExecutionUrl('https://bin.bnbstatic.com/x.js')).toBe(true);
    expect(isAllowedBinanceExecutionUrl('http://p2p.binance.com/')).toBe(false);
    expect(isAllowedBinanceExecutionUrl('https://binance.com.evil.io/')).toBe(false);
    expect(isAllowedBinanceExecutionUrl('https://evilbinance.com/')).toBe(false);
    expect(isAllowedBinanceExecutionUrl('https://user:pw@p2p.binance.com/')).toBe(false);
    expect(isAllowedBinanceExecutionUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('evaluateTakerPreFlight', () => {
  const offer = {
    advNo: ADV,
    advertiserNo: USER,
    price: 800,
    surplusAmount: 1000,
    minVes: 10_000,
    maxVes: 900_000,
  };

  it('returns GO for a healthy ad', () => {
    const r = evaluateTakerPreFlight({ action: 'BUY', offer, expectedPrice: 800, targetUsdt: 500 });
    expect(r.verdict).toBe('GO');
    expect(r.executableVes).toBe(400_000);
    expect(r.executableUsdt).toBe(500);
    expect(r.target.url).toContain(ADV);
  });

  it('blocks adverse slippage for buys and sells', () => {
    const buy = evaluateTakerPreFlight({ action: 'BUY', offer: { ...offer, price: 805 }, expectedPrice: 800 });
    expect(buy.verdict).toBe('BLOCK');
    expect(buy.issues.map((i) => i.code)).toContain('SLIPPAGE_EXCEEDED');
    const sell = evaluateTakerPreFlight({ action: 'SELL', offer: { ...offer, price: 795 }, expectedPrice: 800 });
    expect(sell.verdict).toBe('BLOCK');
    const favorable = evaluateTakerPreFlight({ action: 'SELL', offer: { ...offer, price: 805 }, expectedPrice: 800 });
    expect(favorable.adverseSlippagePct).toBe(0);
    expect(favorable.verdict).toBe('GO');
  });

  it('warns and clips on partial liquidity and max limit', () => {
    const r = evaluateTakerPreFlight({
      action: 'BUY',
      offer: { ...offer, surplusAmount: 100, maxVes: 50_000 },
      targetUsdt: 500,
    });
    expect(r.verdict).toBe('WARN');
    expect(r.issues.map((i) => i.code)).toEqual(['INSUFFICIENT_SURPLUS', 'ABOVE_MAX_LIMIT']);
    expect(r.executableVes).toBe(50_000);
  });

  it('blocks exhausted ads, tickets below minimum and blacklisted counterparties', () => {
    expect(evaluateTakerPreFlight({ action: 'BUY', offer: { ...offer, surplusAmount: 0 } }).verdict).toBe('BLOCK');
    const small = evaluateTakerPreFlight({ action: 'BUY', offer, targetVes: 5_000 });
    expect(small.issues.map((i) => i.code)).toContain('BELOW_MIN_LIMIT');
    const blocked = evaluateTakerPreFlight({ action: 'BUY', offer, counterpartyReputation: 'BLOCKED' });
    expect(blocked.verdict).toBe('BLOCK');
    const suspicious = evaluateTakerPreFlight({ action: 'BUY', offer, counterpartyReputation: 'SUSPICIOUS' });
    expect(suspicious.verdict).toBe('WARN');
  });

  it('enforces taker locks against the operator profile', () => {
    const locked = { ...offer, buyerRegDaysLimit: 180, buyerBtcPositionLimit: 0.05, takerAdditionalKycRequired: true };
    const unknown = evaluateTakerPreFlight({ action: 'BUY', offer: locked });
    expect(unknown.verdict).toBe('WARN');
    const young = evaluateTakerPreFlight({
      action: 'BUY',
      offer: locked,
      operator: { accountAgeDays: 40, btcPosition: 1 },
    });
    expect(young.verdict).toBe('BLOCK');
    expect(young.issues.map((i) => i.code)).toEqual(['REG_DAYS_LOCK', 'EXTRA_KYC_REQUIRED']);
  });

  it('blocks invalid price and missing deep link ids', () => {
    expect(evaluateTakerPreFlight({ action: 'BUY', offer: { ...offer, price: 0 } }).verdict).toBe('BLOCK');
    const noLink = evaluateTakerPreFlight({ action: 'BUY', offer: { price: 800 } });
    expect(noLink.issues.map((i) => i.code)).toContain('NO_DEEP_LINK');
  });
});

describe('KYC-only maker eligibility', () => {
  it('passes all 5 gates', () => {
    const r = evaluateKycMakerEligibility({
      kycVerified: true,
      twoFactorEnabled: true,
      accountAgeDays: 45,
      completedOrders: 25,
      completionRate30dPct: 95,
      uniqueCounterparties: 12,
    });
    expect(r.eligible).toBe(true);
    expect(r.gates).toHaveLength(5);
  });

  it('reports failed and unknown gates', () => {
    const r = evaluateKycMakerEligibility({ accountAgeDays: 10, completedOrders: 30 });
    expect(r.eligible).toBe(false);
    expect(r.failedGates).toEqual(['ACCOUNT_AGE']);
    expect(r.unknownGates).toEqual(['KYC_AND_2FA', 'COMPLETION_RATE_30D', 'UNIQUE_COUNTERPARTIES']);
    expect(evaluateKycMakerEligibility({ accountAgeDays: 40 }).eligible).toBeNull();
  });

  it('derives order stats from C2C history with dedupe and 30d window', () => {
    const now = Date.UTC(2026, 10, 26);
    const day = 86_400_000;
    const stats = deriveKycStatsFromOrderHistory(
      [
        { orderNumber: '1', orderStatus: 'COMPLETED', counterPartNickName: 'Ana', createTime: now - day },
        { orderNumber: '1', orderStatus: 'COMPLETED', counterPartNickName: 'Ana', createTime: now - day },
        { orderNumber: '2', orderStatus: 'COMPLETED', counterPartNickName: 'ana', createTime: now - 2 * day },
        { orderNumber: '3', orderStatus: 'COMPLETED', counterPartNickName: 'Luis', createTime: now - 60 * day },
        { orderNumber: '4', orderStatus: 'CANCELLED', counterPartNickName: 'Pedro', createTime: now - day },
        { orderNumber: '5', orderStatus: 'CANCELLED', counterPartNickName: 'Old', createTime: now - 90 * day },
      ],
      now,
    );
    expect(stats).toEqual({ completedOrders: 3, completionRate30dPct: 66.67, uniqueCounterparties: 2 });
  });
});

describe('canonical maker fees', () => {
  it('maps merchant levels to MAKER_FEE_RATES percentages', () => {
    expect(resolveCanonicalMakerFeePct('STANDARD')).toBe(0.25);
    expect(resolveCanonicalMakerFeePct('BRONZE')).toBe(0.2);
    expect(resolveCanonicalMakerFeePct('SILVER')).toBe(0.175);
    expect(resolveCanonicalMakerFeePct('GOLD')).toBe(0.125);
    expect(resolveCanonicalMakerFeePct(undefined)).toBe(0.25);
    expect(resolveCanonicalMakerFeePct('bogus')).toBe(0.25);
  });

  it('only verified merchants can use the merchant write api', () => {
    expect(canUseMerchantWriteApi('STANDARD')).toBe(false);
    expect(canUseMerchantWriteApi('BRONZE')).toBe(true);
    expect(canUseMerchantWriteApi('GOLD')).toBe(true);
    expect(canUseMerchantWriteApi(null)).toBe(false);
  });
});
