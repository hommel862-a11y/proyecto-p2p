/**
 * @file binance-p2p-execution.ts
 * @description Pure execution-bridge domain for Binance P2P:
 *  - Official public deep links (ad checkout, advertiser profile, my ads, post ad).
 *  - Taker pre-flight guard (liquidity, limits, slippage, taker locks, counterparty reputation).
 *  - KYC-only (STANDARD) maker eligibility gates.
 *  - Canonical maker fee resolution by merchant level.
 *
 * Zero UI / Angular / Node dependencies. Binance exposes NO official taker `placeOrder`
 * endpoint for any account tier, so taking an ad is always a human-in-the-loop action:
 * this module only decides WHERE to send the operator and WHETHER it is still safe.
 */

import { MAKER_FEE_RATES, type MakerMerchantLevel } from './market-scanner';

export const BINANCE_P2P_DEFAULT_LOCALE = 'es-LA';

const AD_HOST = 'https://c2c.binance.com';
const P2P_HOST = 'https://p2p.binance.com';

const ADV_NO_PATTERN = /^\d{8,32}$/;
const ADVERTISER_NO_PATTERN = /^[A-Za-z0-9]{8,64}$/;
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

function safeLocale(locale?: string): string {
  return locale && LOCALE_PATTERN.test(locale) ? locale : BINANCE_P2P_DEFAULT_LOCALE;
}

/** Binance ad numbers are numeric strings of ~19-20 digits. */
export function isValidBinanceAdvNo(advNo: unknown): advNo is string {
  return typeof advNo === 'string' && ADV_NO_PATTERN.test(advNo.trim());
}

/** Binance advertiser ids (`userNo`) are opaque alphanumeric strings (e.g. `s8415f12...`). */
export function isValidBinanceAdvertiserNo(advertiserNo: unknown): advertiserNo is string {
  return (
    typeof advertiserNo === 'string' &&
    advertiserNo.trim().toUpperCase() !== 'UNKNOWN' &&
    ADVERTISER_NO_PATTERN.test(advertiserNo.trim())
  );
}

/** Direct link to the ad checkout page (`/adv?code={advNo}`), or null when the id is invalid. */
export function buildBinanceAdDeepLink(advNo: unknown, locale?: string): string | null {
  if (!isValidBinanceAdvNo(advNo)) return null;
  return `${AD_HOST}/${safeLocale(locale)}/adv?code=${encodeURIComponent(advNo.trim())}`;
}

/** Direct link to the advertiser profile with all of its live ads. */
export function buildBinanceAdvertiserDeepLink(advertiserNo: unknown, locale?: string): string | null {
  if (!isValidBinanceAdvertiserNo(advertiserNo)) return null;
  return `${P2P_HOST}/${safeLocale(locale)}/advertiserDetail?advertiserNo=${encodeURIComponent(
    advertiserNo.trim(),
  )}`;
}

/** Operator's own ads list (fast manual repricing for KYC-only accounts). */
export function buildBinanceMyAdsUrl(locale?: string): string {
  return `${P2P_HOST}/${safeLocale(locale)}/myads`;
}

/** New ad form (manual posting for KYC-only accounts). */
export function buildBinanceAdvPostUrl(locale?: string): string {
  return `${P2P_HOST}/${safeLocale(locale)}/advPost`;
}

export type BinanceExecutionTargetKind = 'AD' | 'ADVERTISER' | 'NONE';

export interface BinanceExecutionTarget {
  readonly kind: BinanceExecutionTargetKind;
  readonly url: string | null;
  readonly adUrl: string | null;
  readonly advertiserUrl: string | null;
}

/**
 * Resolves where to send the operator: the exact ad first, the advertiser profile as fallback
 * (e.g. when the ad expired or `preferAdvertiser` is set).
 */
export function resolveBinanceExecutionTarget(input: {
  readonly advNo?: string | null;
  readonly advertiserNo?: string | null;
  readonly locale?: string;
  readonly preferAdvertiser?: boolean;
}): BinanceExecutionTarget {
  const adUrl = buildBinanceAdDeepLink(input.advNo, input.locale);
  const advertiserUrl = buildBinanceAdvertiserDeepLink(input.advertiserNo, input.locale);
  if (input.preferAdvertiser && advertiserUrl) {
    return { kind: 'ADVERTISER', url: advertiserUrl, adUrl, advertiserUrl };
  }
  if (adUrl) return { kind: 'AD', url: adUrl, adUrl, advertiserUrl };
  if (advertiserUrl) return { kind: 'ADVERTISER', url: advertiserUrl, adUrl, advertiserUrl };
  return { kind: 'NONE', url: null, adUrl, advertiserUrl };
}

const ALLOWED_EXECUTION_HOST_SUFFIXES = ['.binance.com', '.bnbstatic.com'] as const;

/** HTTPS-only allowlist for Binance execution surfaces (operator dock, external open). */
export function isAllowedBinanceExecutionUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'binance.com' ||
      ALLOWED_EXECUTION_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Taker pre-flight guard
// ---------------------------------------------------------------------------

/** `BUY` = operator buys USDT from the ad (pays fiat); `SELL` = operator sells USDT into the ad. */
export type TakerAction = 'BUY' | 'SELL';
export type PreFlightVerdict = 'GO' | 'WARN' | 'BLOCK';
export type CounterpartyReputationLevel = 'TRUSTED' | 'VERIFIED' | 'SUSPICIOUS' | 'BLOCKED' | 'UNKNOWN';

export type PreFlightIssueCode =
  | 'INVALID_PRICE'
  | 'AD_EXHAUSTED'
  | 'INSUFFICIENT_SURPLUS'
  | 'BELOW_MIN_LIMIT'
  | 'ABOVE_MAX_LIMIT'
  | 'SLIPPAGE_EXCEEDED'
  | 'REG_DAYS_LOCK'
  | 'BTC_POSITION_LOCK'
  | 'EXTRA_KYC_REQUIRED'
  | 'COUNTERPARTY_BLOCKED'
  | 'COUNTERPARTY_SUSPICIOUS'
  | 'NO_DEEP_LINK';

export interface PreFlightIssue {
  readonly code: PreFlightIssueCode;
  readonly severity: 'WARN' | 'BLOCK';
  readonly message: string;
}

export interface TakerPreFlightOffer {
  readonly advNo?: string;
  readonly advertiserNo?: string;
  readonly price: number;
  readonly surplusAmount?: number;
  readonly minVes?: number;
  readonly maxVes?: number;
  readonly buyerKycLimit?: number | null;
  readonly buyerRegDaysLimit?: number | null;
  readonly buyerBtcPositionLimit?: number | null;
  readonly takerAdditionalKycRequired?: boolean;
}

export interface TakerOperatorProfile {
  readonly accountAgeDays?: number;
  readonly btcPosition?: number;
}

export interface TakerPreFlightInput {
  readonly action: TakerAction;
  readonly offer: TakerPreFlightOffer;
  /** Price the operator saw when deciding (defaults to the offer price: no slippage). */
  readonly expectedPrice?: number;
  readonly targetUsdt?: number;
  readonly targetVes?: number;
  /** Maximum adverse price move tolerated, in percent (default 0.3%). */
  readonly maxSlippagePct?: number;
  readonly operator?: TakerOperatorProfile;
  readonly counterpartyReputation?: CounterpartyReputationLevel;
  readonly locale?: string;
}

export interface TakerPreFlightResult {
  readonly verdict: PreFlightVerdict;
  readonly issues: readonly PreFlightIssue[];
  readonly adverseSlippagePct: number;
  /** Fiat amount the operator can actually execute against this ad. */
  readonly executableVes: number;
  readonly executableUsdt: number;
  readonly target: BinanceExecutionTarget;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export function evaluateTakerPreFlight(input: TakerPreFlightInput): TakerPreFlightResult {
  const issues: PreFlightIssue[] = [];
  const { offer } = input;
  const price = Number(offer.price);
  const maxSlippagePct =
    Number.isFinite(input.maxSlippagePct) && (input.maxSlippagePct as number) >= 0
      ? (input.maxSlippagePct as number)
      : 0.3;

  const counterpartyBlocked = input.counterpartyReputation === 'BLOCKED';
  const target = resolveBinanceExecutionTarget({
    advNo: offer.advNo,
    advertiserNo: offer.advertiserNo,
    locale: input.locale,
  });

  if (!Number.isFinite(price) || price <= 0) {
    issues.push({ code: 'INVALID_PRICE', severity: 'BLOCK', message: 'Precio del anuncio inválido.' });
    return finalize(issues, 0, 0, 0, target);
  }

  if (counterpartyBlocked) {
    issues.push({
      code: 'COUNTERPARTY_BLOCKED',
      severity: 'BLOCK',
      message: 'Contraparte en lista negra del CRM.',
    });
  } else if (input.counterpartyReputation === 'SUSPICIOUS') {
    issues.push({
      code: 'COUNTERPARTY_SUSPICIOUS',
      severity: 'WARN',
      message: 'Contraparte marcada como sospechosa en el CRM.',
    });
  }

  if (target.kind === 'NONE') {
    issues.push({
      code: 'NO_DEEP_LINK',
      severity: 'BLOCK',
      message: 'El anuncio no trae advNo/advertiserNo válidos para abrirlo en Binance.',
    });
  }

  // Adverse slippage: buying, a higher live price hurts; selling, a lower one hurts.
  let adverseSlippagePct = 0;
  const expected = Number(input.expectedPrice);
  if (Number.isFinite(expected) && expected > 0) {
    const move = input.action === 'BUY' ? price - expected : expected - price;
    adverseSlippagePct = round4(Math.max(0, (move / expected) * 100));
    if (adverseSlippagePct > maxSlippagePct) {
      issues.push({
        code: 'SLIPPAGE_EXCEEDED',
        severity: 'BLOCK',
        message: `Deslizamiento adverso ${adverseSlippagePct}% supera el máximo ${maxSlippagePct}%.`,
      });
    }
  }

  // Amount resolution.
  let targetVes = Number(input.targetVes);
  if (!Number.isFinite(targetVes) || targetVes <= 0) {
    const usdt = Number(input.targetUsdt);
    targetVes = Number.isFinite(usdt) && usdt > 0 ? usdt * price : 0;
  }
  let executableVes = targetVes;

  const surplus = offer.surplusAmount;
  if (typeof surplus === 'number' && Number.isFinite(surplus)) {
    if (surplus <= 0) {
      issues.push({ code: 'AD_EXHAUSTED', severity: 'BLOCK', message: 'El anuncio ya no tiene saldo.' });
      executableVes = 0;
    } else if (targetVes > 0 && targetVes / price > surplus) {
      issues.push({
        code: 'INSUFFICIENT_SURPLUS',
        severity: 'WARN',
        message: `Saldo del anuncio (${round2(surplus)} USDT) no cubre el ticket completo.`,
      });
      executableVes = surplus * price;
    }
  }

  const maxVes = Number(offer.maxVes);
  if (targetVes > 0 && Number.isFinite(maxVes) && maxVes > 0 && targetVes > maxVes) {
    issues.push({
      code: 'ABOVE_MAX_LIMIT',
      severity: 'WARN',
      message: `El ticket supera el máximo por orden (${round2(maxVes)} VES).`,
    });
    executableVes = Math.min(executableVes, maxVes);
  }

  const minVes = Number(offer.minVes);
  if (targetVes > 0 && Number.isFinite(minVes) && minVes > 0 && targetVes < minVes) {
    issues.push({
      code: 'BELOW_MIN_LIMIT',
      severity: 'BLOCK',
      message: `El ticket está por debajo del mínimo por orden (${round2(minVes)} VES).`,
    });
    executableVes = 0;
  }

  // Taker locks published by the advertiser.
  const regLock = offer.buyerRegDaysLimit;
  if (typeof regLock === 'number' && regLock > 0) {
    const age = input.operator?.accountAgeDays;
    if (typeof age === 'number' && Number.isFinite(age)) {
      if (age < regLock) {
        issues.push({
          code: 'REG_DAYS_LOCK',
          severity: 'BLOCK',
          message: `Exige cuenta con ${regLock} días de registro (tenés ${age}).`,
        });
      }
    } else {
      issues.push({
        code: 'REG_DAYS_LOCK',
        severity: 'WARN',
        message: `Exige cuenta con ${regLock} días de registro.`,
      });
    }
  }

  const btcLock = offer.buyerBtcPositionLimit;
  if (typeof btcLock === 'number' && btcLock > 0) {
    const position = input.operator?.btcPosition;
    if (typeof position === 'number' && Number.isFinite(position)) {
      if (position < btcLock) {
        issues.push({
          code: 'BTC_POSITION_LOCK',
          severity: 'BLOCK',
          message: `Exige saldo mínimo de ${btcLock} BTC.`,
        });
      }
    } else {
      issues.push({
        code: 'BTC_POSITION_LOCK',
        severity: 'WARN',
        message: `Exige saldo mínimo de ${btcLock} BTC.`,
      });
    }
  }

  if (
    offer.takerAdditionalKycRequired === true ||
    (typeof offer.buyerKycLimit === 'number' && offer.buyerKycLimit > 0)
  ) {
    issues.push({
      code: 'EXTRA_KYC_REQUIRED',
      severity: 'WARN',
      message: 'El anunciante exige verificación KYC adicional.',
    });
  }

  return finalize(issues, adverseSlippagePct, executableVes, price, target);
}

function finalize(
  issues: PreFlightIssue[],
  adverseSlippagePct: number,
  executableVes: number,
  price: number,
  target: BinanceExecutionTarget,
): TakerPreFlightResult {
  const verdict: PreFlightVerdict = issues.some((i) => i.severity === 'BLOCK')
    ? 'BLOCK'
    : issues.length > 0
      ? 'WARN'
      : 'GO';
  const safeVes = Number.isFinite(executableVes) && executableVes > 0 ? round2(executableVes) : 0;
  return {
    verdict,
    issues,
    adverseSlippagePct,
    executableVes: safeVes,
    executableUsdt: price > 0 ? round2(safeVes / price) : 0,
    target,
  };
}

// ---------------------------------------------------------------------------
// KYC-only maker eligibility (Binance non-merchant ad posting gates)
// ---------------------------------------------------------------------------

export type KycMakerGateId =
  | 'KYC_AND_2FA'
  | 'ACCOUNT_AGE'
  | 'COMPLETED_ORDERS'
  | 'COMPLETION_RATE_30D'
  | 'UNIQUE_COUNTERPARTIES';

export interface KycMakerGate {
  readonly id: KycMakerGateId;
  readonly label: string;
  readonly required: number;
  readonly actual: number | null;
  readonly passed: boolean | null;
}

export interface KycMakerStats {
  readonly kycVerified?: boolean;
  readonly twoFactorEnabled?: boolean;
  readonly accountAgeDays?: number;
  readonly completedOrders?: number;
  readonly completionRate30dPct?: number;
  readonly uniqueCounterparties?: number;
}

export interface KycMakerEligibility {
  /** true = all gates passed; false = at least one failed; null = some gates are still unknown. */
  readonly eligible: boolean | null;
  readonly gates: readonly KycMakerGate[];
  readonly failedGates: readonly KycMakerGateId[];
  readonly unknownGates: readonly KycMakerGateId[];
}

export const KYC_MAKER_THRESHOLDS = {
  accountAgeDays: 30,
  completedOrders: 20,
  completionRate30dPct: 80,
  uniqueCounterparties: 10,
} as const;

function numericGate(
  id: KycMakerGateId,
  label: string,
  required: number,
  actual: number | undefined,
): KycMakerGate {
  if (typeof actual !== 'number' || !Number.isFinite(actual)) {
    return { id, label, required, actual: null, passed: null };
  }
  return { id, label, required, actual, passed: actual >= required };
}

/**
 * Evaluates the 5 public gates Binance applies before a non-merchant (KYC-only) account
 * can post P2P ads manually. Verified merchants are not bound by these gates.
 */
export function evaluateKycMakerEligibility(stats: KycMakerStats): KycMakerEligibility {
  const kycKnown = typeof stats.kycVerified === 'boolean' && typeof stats.twoFactorEnabled === 'boolean';
  const gates: KycMakerGate[] = [
    {
      id: 'KYC_AND_2FA',
      label: 'KYC + 2FA activos',
      required: 1,
      actual: kycKnown ? (stats.kycVerified && stats.twoFactorEnabled ? 1 : 0) : null,
      passed: kycKnown ? Boolean(stats.kycVerified && stats.twoFactorEnabled) : null,
    },
    numericGate('ACCOUNT_AGE', 'Antigüedad ≥ 30 días', KYC_MAKER_THRESHOLDS.accountAgeDays, stats.accountAgeDays),
    numericGate(
      'COMPLETED_ORDERS',
      'Órdenes completadas ≥ 20',
      KYC_MAKER_THRESHOLDS.completedOrders,
      stats.completedOrders,
    ),
    numericGate(
      'COMPLETION_RATE_30D',
      'Completación 30d ≥ 80%',
      KYC_MAKER_THRESHOLDS.completionRate30dPct,
      stats.completionRate30dPct,
    ),
    numericGate(
      'UNIQUE_COUNTERPARTIES',
      'Contrapartes únicas ≥ 10',
      KYC_MAKER_THRESHOLDS.uniqueCounterparties,
      stats.uniqueCounterparties,
    ),
  ];
  const failedGates = gates.filter((g) => g.passed === false).map((g) => g.id);
  const unknownGates = gates.filter((g) => g.passed === null).map((g) => g.id);
  const eligible = failedGates.length > 0 ? false : unknownGates.length > 0 ? null : true;
  return { eligible, gates, failedGates, unknownGates };
}

/** Minimal shape of a row from `GET /sapi/v1/c2c/orderMatch/listUserOrderHistory`. */
export interface C2cOrderHistoryRow {
  readonly orderNumber?: string;
  readonly orderStatus?: string;
  readonly counterPartNickName?: string;
  readonly createTime?: number;
}

const CANCELLED_STATUSES = new Set(['CANCELLED', 'CANCELLED_BY_SYSTEM', 'CANCELED']);

/**
 * Derives the order-based KYC maker stats from the operator's C2C order history.
 * Completion rate = completed / (completed + cancelled) within the last 30 days.
 */
export function deriveKycStatsFromOrderHistory(
  orders: readonly C2cOrderHistoryRow[],
  nowMs: number = Date.now(),
): Pick<KycMakerStats, 'completedOrders' | 'completionRate30dPct' | 'uniqueCounterparties'> {
  const windowStart = nowMs - 30 * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const counterparties = new Set<string>();
  let completed = 0;
  let completed30 = 0;
  let cancelled30 = 0;

  for (const order of orders) {
    const id = order.orderNumber ?? '';
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const status = String(order.orderStatus ?? '').toUpperCase();
    const inWindow = typeof order.createTime === 'number' && order.createTime >= windowStart;
    if (status === 'COMPLETED') {
      completed++;
      if (inWindow) completed30++;
      const cp = (order.counterPartNickName ?? '').trim();
      if (cp) counterparties.add(cp.toLowerCase());
    } else if (CANCELLED_STATUSES.has(status) && inWindow) {
      cancelled30++;
    }
  }

  const total30 = completed30 + cancelled30;
  return {
    completedOrders: completed,
    completionRate30dPct: total30 > 0 ? round2((completed30 / total30) * 100) : 0,
    uniqueCounterparties: counterparties.size,
  };
}

// ---------------------------------------------------------------------------
// Canonical maker fees
// ---------------------------------------------------------------------------

/** Canonical maker fee in percent for a merchant level (STANDARD 0.25, BRONZE 0.20, SILVER 0.175, GOLD 0.125). */
export function resolveCanonicalMakerFeePct(level?: MakerMerchantLevel | string | null): number {
  const key = (typeof level === 'string' ? level.toUpperCase() : 'STANDARD') as MakerMerchantLevel;
  const rate = MAKER_FEE_RATES[key] ?? MAKER_FEE_RATES.STANDARD;
  return Math.round(rate * 100000) / 1000;
}

/** True when the merchant level can use the signed C2C Merchant SAPI write endpoints. */
export function canUseMerchantWriteApi(level?: MakerMerchantLevel | string | null): boolean {
  return level === 'BRONZE' || level === 'SILVER' || level === 'GOLD';
}
