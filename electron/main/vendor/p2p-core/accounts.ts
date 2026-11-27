/**
 * Pure treasury and bank account liquidity domain logic (framework-agnostic).
 * Computes daily banking transfer limits, balances, and pre-trade recommendations.
 * No network, no Angular.
 */

import { type Operation } from './log';
import { roundMoney } from './money';

export type BankCode =
  | 'BANESCO'
  | 'MERCANTIL'
  | 'BDV'
  | 'BANCAMIGA'
  | 'PROVINCIAL'
  | 'BNC'
  | 'BANCARIBE'
  | 'BANPLUS'
  | 'OTRO';
export type AccountRail = 'PAGO_MOVIL' | 'TRANSFERENCIA' | 'MIXTO';
/**
 * Manual lifecycle state of a bank account. A DISABLED account keeps its
 * configuration (limits, rail, balances) but is never auto-recommended for a trade.
 * An absent value means ACTIVE, which keeps already-stored configurations valid.
 */
export type BankAccountStatus = 'ACTIVE' | 'DISABLED';

export interface BankAccount {
  /** Unique stable ID (UUID). */
  id: string;
  /** Display label (e.g. "Banesco Pago Móvil Principal"). */
  bankName: string;
  /** Normalized bank code. */
  bankCode: BankCode;
  /** Payment rail used for settlements. */
  rail: AccountRail;
  /** Masked reference number or phone (e.g. "0414-***1234" or "0134-***5678"). */
  accountNumberMasked: string;
  /** Daily outbound transfer limit in VES established by the bank. 0 means unlimited. */
  dailyLimitVes: number;
  /** Starting balance in VES at the start of the current cycle. */
  initialBalanceVes: number;
  /** Monthly outbound transfer limit in VES established by the bank. 0 means unlimited. */
  monthlyLimitVes?: number;
  /**
   * Manual lifecycle state. Omitted means ACTIVE (backward compatible with stored configs).
   * DISABLED accounts are paused by the operator (e.g. bank-side freeze) without
   * deleting the configuration, and are excluded from every trade recommendation.
   */
  status?: BankAccountStatus;
  /**
   * Per-account daily transaction cap used by the velocity heuristic. When present it
   * overrides the global default cap (15) for this account, which is useful when a bank
   * enforces a stricter SUDEBAN per-day transaction count.
   */
  maxDailyTransactions?: number;
}

export interface AccountUsage {
  account: BankAccount;
  /** Outbound VES moved today (buying crypto / expenses). */
  spentTodayVes: number;
  /** Inbound VES received today (selling crypto / capital deposits). */
  receivedTodayVes: number;
  /** Current estimated balance in VES. */
  currentBalanceVes: number;
  /** Percentage of the daily limit consumed (0 to 100+). */
  consumedLimitPct: number;
  /** Remaining outbound capacity in VES before hitting the daily bank cap. */
  remainingLimitVes: number;
  /** True when consumed >= 80% and < 100%. */
  isNearLimit: boolean;
  /** True when consumed >= 100%. */
  isOverLimit: boolean;
  /** Outbound VES moved this month (rolling from month start). */
  spentThisMonthVes: number;
  /** Percentage of the monthly limit consumed (0 to 100+). */
  consumedMonthlyLimitPct: number;
  /** True when consumed >= 80% and < 100% of monthly limit. */
  isNearMonthlyLimit: boolean;
  /** True when consumed >= 100% of monthly limit. */
  isOverMonthlyLimit: boolean;
}

export interface TreasurySummary {
  /** Total estimated VES balance across all tracked accounts. */
  totalBalanceVes: number;
  /** Total VES spent across all accounts today. */
  totalSpentTodayVes: number;
  /** Total VES received across all accounts today. */
  totalReceivedTodayVes: number;
  /** Total VES spent across all accounts this month. */
  totalSpentThisMonthVes: number;
  /** Detailed breakdown per account. */
  accountsUsage: AccountUsage[];
  /** Count of accounts near their daily limit (>= 80%). */
  nearLimitCount: number;
  /** Count of accounts exceeding their daily limit (>= 100%). */
  overLimitCount: number;
  /** Count of accounts near their monthly limit (>= 80%). */
  nearMonthlyLimitCount: number;
  /** Count of accounts exceeding their monthly limit (>= 100%). */
  overMonthlyLimitCount: number;
}

const VET_OFFSET_MS = 4 * 3600 * 1000;

/**
 * Returns the canonical `YYYY-MM-DD` calendar date in `America/Caracas` (`UTC-04:00`, no DST).
 * Prevents SUDEBAN daily caps and FX stats from resetting 4 hours early at 20:00 VET (00:00 UTC).
 */
export function getVenezuelaDateKey(date: Date = new Date()): string {
  return new Date(date.getTime() - VET_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Returns the canonical `YYYY-MM` calendar month in `America/Caracas` (`UTC-04:00`).
 */
export function getVenezuelaMonthKey(date: Date = new Date()): string {
  return getVenezuelaDateKey(date).slice(0, 7);
}

/**
 * Normalizes an operation ISO timestamp (or `YYYY-MM-DD` string) into its `America/Caracas` `YYYY-MM-DD` date key.
 */
export function toVenezuelaDateKey(timestamp: string): string {
  if (!timestamp) return '';
  if (timestamp.includes('T')) {
    const parsedMs = Date.parse(timestamp);
    if (Number.isFinite(parsedMs)) {
      return getVenezuelaDateKey(new Date(parsedMs));
    }
  }
  return timestamp.slice(0, 10);
}

/**
 * Parses an `America/Caracas` `YYYY-MM-DD` key into UTC midnight epoch milliseconds for exact day-diff arithmetic.
 */
function parseVetDayUtcMs(isoDateKey: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((isoDateKey ?? '').trim());
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Filter operations belonging to a specific canonical `America/Caracas` (`UTC-04:00`) calendar date.
 */
export function getTodayOperations(
  allOps: readonly Operation[],
  todayDateKey: string = getVenezuelaDateKey(),
): Operation[] {
  return allOps.filter((o) => toVenezuelaDateKey(o.timestamp) === todayDateKey);
}

/**
 * Filter operations belonging to a specific `America/Caracas` (`UTC-04:00`) calendar date.
 */
export function getVenezuelaTodayOperations(
  allOps: readonly Operation[],
  vetDateKey: string = getVenezuelaDateKey(),
): Operation[] {
  return getTodayOperations(allOps, vetDateKey);
}

/**
 * Compute the live daily limit usage and balance for a single bank account,
 * anchored to canonical `America/Caracas` (`UTC-04:00`) calendar boundaries.
 */
export function computeAccountUsage(
  account: BankAccount,
  todayOps: readonly Operation[],
  monthKey: string = getVenezuelaMonthKey(), // 'YYYY-MM'
): AccountUsage {

  let spentTodayVes = 0;
  let receivedTodayVes = 0;
  let spentThisMonthVes = 0;

  for (const op of todayOps) {
    // Only count operations tied to this account or matching the bank name
    const matchesAccount =
      op.bankAccountId === account.id ||
      (!op.bankAccountId &&
        op.merchantNote?.toLowerCase().includes(account.bankName.toLowerCase()));
    if (!matchesAccount) continue;

    if (op.type === 'buy') {
      spentTodayVes += op.vesAmount + op.fees;
      // Monthly: count only current-month buy ops in canonical America/Caracas (UTC-04:00)
      if (toVenezuelaDateKey(op.timestamp).startsWith(monthKey)) {
        spentThisMonthVes += op.vesAmount + op.fees;
      }
    } else {
      receivedTodayVes += op.vesAmount;
    }
  }

  const currentBalanceVes = roundMoney(
    account.initialBalanceVes - spentTodayVes + receivedTodayVes,
    2,
  );
  const dailyLimit = account.dailyLimitVes;

  let dailyConsumedPct = 0;
  let dailyRemainingVes = dailyLimit;

  if (dailyLimit > 0) {
    dailyConsumedPct = Math.round((spentTodayVes / dailyLimit) * 100);
    dailyRemainingVes = Math.max(0, roundMoney(dailyLimit - spentTodayVes, 2));
  }

  const isOverLimitDaily = dailyLimit > 0 && spentTodayVes >= dailyLimit;
  const isNearLimitDaily = dailyLimit > 0 && !isOverLimitDaily && dailyConsumedPct >= 80;

  // ---- Monthly usage ----
  let monthlyConsumedPct = 0;
  let isOverMonthlyLimit = false;
  let isNearMonthlyLimit = false;

  const monthlyLimit = account.monthlyLimitVes ?? 0;
  if (monthlyLimit > 0) {
    monthlyConsumedPct = Math.round((spentThisMonthVes / monthlyLimit) * 100);
    isOverMonthlyLimit = spentThisMonthVes >= monthlyLimit;
    isNearMonthlyLimit = !isOverMonthlyLimit && monthlyConsumedPct >= 80;
  }

  return {
    account,
    spentTodayVes: roundMoney(spentTodayVes, 2),
    receivedTodayVes: roundMoney(receivedTodayVes, 2),
    currentBalanceVes,
    consumedLimitPct: dailyConsumedPct,
    remainingLimitVes: dailyRemainingVes,
    isNearLimit: isNearLimitDaily,
    isOverLimit: isOverLimitDaily,
    spentThisMonthVes,
    consumedMonthlyLimitPct: monthlyConsumedPct,
    isNearMonthlyLimit,
    isOverMonthlyLimit,
  };
}
/**
 * Compute total treasury summary across all configured accounts.
 *
 * `monthKey` is forwarded to `computeAccountUsage` so the whole summary shares one
 * month. Defaulting it here as well as there keeps single-account callers working
 * unchanged, and both defaults read the same wall clock within one tick.
 */
export function computeTreasurySummary(
  accounts: readonly BankAccount[],
  todayOps: readonly Operation[],
  monthKey?: string,
): TreasurySummary {
  const accountsUsage = accounts.map((acc) => computeAccountUsage(acc, todayOps, monthKey));

  let totalBalanceVes = 0;
  let totalSpentTodayVes = 0;
  let totalReceivedTodayVes = 0;
  let totalSpentThisMonthVes = 0;
  let nearLimitCount = 0;
  let overLimitCount = 0;
  let nearMonthlyLimitCount = 0;
  let overMonthlyLimitCount = 0;

  for (const u of accountsUsage) {
    totalBalanceVes += u.currentBalanceVes;
    totalSpentTodayVes += u.spentTodayVes;
    totalReceivedTodayVes += u.receivedTodayVes;
    totalSpentThisMonthVes += u.spentThisMonthVes;

    if (u.isOverLimit) overLimitCount++;
    else if (u.isNearLimit) nearLimitCount++;

    if (u.isOverMonthlyLimit) overMonthlyLimitCount++;
    else if (u.isNearMonthlyLimit) nearMonthlyLimitCount++;
  }

  return {
    totalBalanceVes: roundMoney(totalBalanceVes, 2),
    totalSpentTodayVes: roundMoney(totalSpentTodayVes, 2),
    totalReceivedTodayVes: roundMoney(totalReceivedTodayVes, 2),
    totalSpentThisMonthVes: roundMoney(totalSpentThisMonthVes, 2),
    accountsUsage,
    nearLimitCount,
    overLimitCount,
    nearMonthlyLimitCount,
    overMonthlyLimitCount,
  };
}

/**
 * Institutional multi-day account usage calculator anchored to `America/Caracas` (`UTC-04:00`).
 *
 * Unlike `computeAccountUsage` (which expects pre-filtered `todayOps`), this function accepts
 * the full ledger `allOps` so that:
 * 1. `currentBalanceVes` reflects all historical inflows/outflows (never resets at midnight/20:00 VET),
 * 2. `spentTodayVes` / `receivedTodayVes` count strictly operations on `vetDateKey` (Caracas day),
 * 3. `spentThisMonthVes` sums all operations within the rolling 30-day SUDEBAN window ending at `vetDateKey`.
 */
export function computeCumulativeAccountUsage(
  account: BankAccount,
  allOps: readonly Operation[],
  vetDateKey: string = getVenezuelaDateKey(),
  _vetMonthKey: string = vetDateKey.slice(0, 7),
): AccountUsage {
  let totalSpentAllTimeVes = 0;
  let totalReceivedAllTimeVes = 0;
  let spentTodayVes = 0;
  let receivedTodayVes = 0;
  let spentThisMonthVes = 0;
  const refDayMs = parseVetDayUtcMs(vetDateKey);

  for (const op of allOps) {
    const matchesAccount =
      op.bankAccountId === account.id ||
      (!op.bankAccountId &&
        Boolean(op.merchantNote?.toLowerCase().includes(account.bankName.toLowerCase())));
    if (!matchesAccount) continue;

    const opVetDay = toVenezuelaDateKey(op.timestamp);
    const isToday = opVetDay === vetDateKey;
    const opDayMs = parseVetDayUtcMs(opVetDay);
    const diffDays =
      Number.isFinite(refDayMs) && Number.isFinite(opDayMs)
        ? Math.round((refDayMs - opDayMs) / 86_400_000)
        : -1;
    const isWithinRolling30Days =
      diffDays >= 0 ? diffDays < 30 : opVetDay.startsWith(_vetMonthKey);

    if (op.type === 'buy') {
      const totalOutflow = op.vesAmount + op.fees;
      totalSpentAllTimeVes += totalOutflow;
      if (isToday) {
        spentTodayVes += totalOutflow;
      }
      if (isWithinRolling30Days) {
        spentThisMonthVes += totalOutflow;
      }
    } else {
      totalReceivedAllTimeVes += op.vesAmount;
      if (isToday) {
        receivedTodayVes += op.vesAmount;
      }
    }
  }

  const currentBalanceVes = roundMoney(
    account.initialBalanceVes - totalSpentAllTimeVes + totalReceivedAllTimeVes,
    2,
  );
  const dailyLimit = account.dailyLimitVes;
  let dailyConsumedPct = 0;
  let dailyRemainingVes = dailyLimit;

  if (dailyLimit > 0) {
    dailyConsumedPct = Math.round((spentTodayVes / dailyLimit) * 100);
    dailyRemainingVes = Math.max(0, roundMoney(dailyLimit - spentTodayVes, 2));
  }

  const isOverLimitDaily = dailyLimit > 0 && spentTodayVes >= dailyLimit;
  const isNearLimitDaily = dailyLimit > 0 && !isOverLimitDaily && dailyConsumedPct >= 80;

  let monthlyConsumedPct = 0;
  let isOverMonthlyLimit = false;
  let isNearMonthlyLimit = false;
  const monthlyLimit = account.monthlyLimitVes ?? 0;
  if (monthlyLimit > 0) {
    monthlyConsumedPct = Math.round((spentThisMonthVes / monthlyLimit) * 100);
    isOverMonthlyLimit = spentThisMonthVes >= monthlyLimit;
    isNearMonthlyLimit = !isOverMonthlyLimit && monthlyConsumedPct >= 80;
  }

  return {
    account,
    spentTodayVes: roundMoney(spentTodayVes, 2),
    receivedTodayVes: roundMoney(receivedTodayVes, 2),
    currentBalanceVes,
    consumedLimitPct: dailyConsumedPct,
    remainingLimitVes: dailyRemainingVes,
    isNearLimit: isNearLimitDaily,
    isOverLimit: isOverLimitDaily,
    spentThisMonthVes: roundMoney(spentThisMonthVes, 2),
    consumedMonthlyLimitPct: monthlyConsumedPct,
    isNearMonthlyLimit,
    isOverMonthlyLimit,
  };
}

/**
 * Computes institutional multi-day treasury summary anchored to `America/Caracas` (`UTC-04:00`).
 */
export function computeCumulativeTreasurySummary(
  accounts: readonly BankAccount[],
  allOps: readonly Operation[],
  vetDateKey: string = getVenezuelaDateKey(),
  vetMonthKey: string = vetDateKey.slice(0, 7),
): TreasurySummary {
  const accountsUsage = accounts.map((acc) =>
    computeCumulativeAccountUsage(acc, allOps, vetDateKey, vetMonthKey),
  );

  let totalBalanceVes = 0;
  let totalSpentTodayVes = 0;
  let totalReceivedTodayVes = 0;
  let totalSpentThisMonthVes = 0;
  let nearLimitCount = 0;
  let overLimitCount = 0;
  let nearMonthlyLimitCount = 0;
  let overMonthlyLimitCount = 0;

  for (const u of accountsUsage) {
    totalBalanceVes += u.currentBalanceVes;
    totalSpentTodayVes += u.spentTodayVes;
    totalReceivedTodayVes += u.receivedTodayVes;
    totalSpentThisMonthVes += u.spentThisMonthVes;

    if (u.isOverLimit) overLimitCount++;
    else if (u.isNearLimit) nearLimitCount++;

    if (u.isOverMonthlyLimit) overMonthlyLimitCount++;
    else if (u.isNearMonthlyLimit) nearMonthlyLimitCount++;
  }

  return {
    totalBalanceVes: roundMoney(totalBalanceVes, 2),
    totalSpentTodayVes: roundMoney(totalSpentTodayVes, 2),
    totalReceivedTodayVes: roundMoney(totalReceivedTodayVes, 2),
    totalSpentThisMonthVes: roundMoney(totalSpentThisMonthVes, 2),
    accountsUsage,
    nearLimitCount,
    overLimitCount,
    nearMonthlyLimitCount,
    overMonthlyLimitCount,
  };
}

/**
 * Recommend the best account to execute a buy trade of `requiredVes`.
 * Selects an account that has both enough balance and enough remaining daily limit,
 * prioritizing the account with the most remaining capacity.
 *
 * Accounts with `status === 'DISABLED'` are never recommended. When `targetBankCode`
 * is provided, only accounts of that bank are considered, which avoids paying
 * interbank fees when the counterparty funds from a specific bank. The parameter is
 * optional and trailing, so existing three-argument call sites keep working unchanged.
 *
 * There is deliberately no `monthKey` here. The filter reads daily limit and
 * balance from `computeAccountUsage`, and `todayOps` arrives already filtered by the
 * caller — so a month argument could not change which account is returned. It was
 * added for symmetry, and a test proved it inert. A parameter that cannot alter the
 * output is a published contract that does not exist.
 */
export function recommendAccountForTrade(
  accounts: readonly BankAccount[],
  requiredVes: number,
  todayOps: readonly Operation[],
  targetBankCode?: BankCode,
): BankAccount | null {
  const valid = accounts
    .map((acc) => computeAccountUsage(acc, todayOps))
    .filter((u) => {
      // Skip accounts paused by the operator.
      if (u.account.status === 'DISABLED') return false;
      // Skip accounts from a bank other than the requested one.
      if (targetBankCode && u.account.bankCode !== targetBankCode) return false;
      const hasLimit = u.account.dailyLimitVes === 0 || u.remainingLimitVes >= requiredVes;
      const hasBalance = u.currentBalanceVes >= requiredVes;
      return hasLimit && hasBalance;
    })
    .sort((a, b) => b.remainingLimitVes - a.remainingLimitVes);

  return valid[0]?.account ?? null;
}
