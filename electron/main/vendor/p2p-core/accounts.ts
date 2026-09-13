/**
 * Pure treasury and bank account liquidity domain logic (framework-agnostic).
 * Computes daily banking transfer limits, balances, and pre-trade recommendations.
 * No network, no Angular.
 */

import { type Operation } from './log';
import { roundMoney, clampNonNegative } from './money';

export type BankCode = 'BANESCO' | 'MERCANTIL' | 'BDV' | 'BANCAMIGA' | 'PROVINCIAL' | 'OTRO';
export type AccountRail = 'PAGO_MOVIL' | 'TRANSFERENCIA' | 'MIXTO';

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

/**
 * Filter operations belonging to a specific calendar date (UTC or local prefix YYYY-MM-DD).
 */
export function getTodayOperations(
  allOps: readonly Operation[],
  todayDateKey = new Date().toISOString().slice(0, 10),
): Operation[] {
  return allOps.filter((o) => o.timestamp.startsWith(todayDateKey));
}

/**
 * Compute the live daily limit usage and balance for a single bank account.
 * Expects `todayOps` to contain only today's operations (caller responsibility).
 * Also computes monthly usage when `account.monthlyLimitVes` is set, filtering by current month internally.
 */
export function computeAccountUsage(
  account: BankAccount,
  todayOps: readonly Operation[],
): AccountUsage {
  const monthKey = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  let spentTodayVes = 0;
  let receivedTodayVes = 0;
  let spentThisMonthVes = 0;

  for (const op of todayOps) {
    // Only count operations tied to this account or matching the bank name
    const matchesAccount = op.bankAccountId === account.id || (!op.bankAccountId && op.merchantNote?.toLowerCase().includes(account.bankName.toLowerCase()));
    if (!matchesAccount) continue;

    if (op.type === 'buy') {
      spentTodayVes += op.vesAmount + op.fees;
      // Monthly: count only current-month buy ops
      if (op.timestamp.startsWith(monthKey)) {
        spentThisMonthVes += op.vesAmount + op.fees;
      }
    } else {
      receivedTodayVes += op.vesAmount;
    }
  }

  const currentBalanceVes = roundMoney(account.initialBalanceVes - spentTodayVes + receivedTodayVes, 2);
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
  let monthlyRemainingVes = 0;
  let isOverMonthlyLimit = false;
  let isNearMonthlyLimit = false;

  const monthlyLimit = account.monthlyLimitVes ?? 0;
  if (monthlyLimit > 0) {
    monthlyConsumedPct = Math.round((spentThisMonthVes / monthlyLimit) * 100);
    monthlyRemainingVes = Math.max(0, roundMoney(monthlyLimit - spentThisMonthVes, 2));
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
 */
export function computeTreasurySummary(
  accounts: readonly BankAccount[],
  todayOps: readonly Operation[],
): TreasurySummary {
  const accountsUsage = accounts.map((acc) => computeAccountUsage(acc, todayOps));

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
 */
export function recommendAccountForTrade(
  accounts: readonly BankAccount[],
  requiredVes: number,
  todayOps: readonly Operation[],
): BankAccount | null {
  const valid = accounts
    .map((acc) => computeAccountUsage(acc, todayOps))
    .filter((u) => {
      const hasLimit = u.account.dailyLimitVes === 0 || u.remainingLimitVes >= requiredVes;
      const hasBalance = u.currentBalanceVes >= requiredVes;
      return hasLimit && hasBalance;
    })
    .sort((a, b) => b.remainingLimitVes - a.remainingLimitVes);

  return valid[0]?.account ?? null;
}
