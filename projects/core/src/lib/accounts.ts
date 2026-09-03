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
}

export interface TreasurySummary {
  /** Total estimated VES balance across all tracked accounts. */
  totalBalanceVes: number;
  /** Total VES spent across all accounts today. */
  totalSpentTodayVes: number;
  /** Total VES received across all accounts today. */
  totalReceivedTodayVes: number;
  /** Detailed breakdown per account. */
  accountsUsage: AccountUsage[];
  /** Count of accounts near their limit (>= 80%). */
  nearLimitCount: number;
  /** Count of accounts exceeding their limit (>= 100%). */
  overLimitCount: number;
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
 */
export function computeAccountUsage(
  account: BankAccount,
  todayOps: readonly Operation[],
): AccountUsage {
  let spentTodayVes = 0;
  let receivedTodayVes = 0;

  for (const op of todayOps) {
    // Only count operations explicitly tied to this account or matching the bank name
    if (op.bankAccountId === account.id || (!op.bankAccountId && op.merchantNote?.toLowerCase().includes(account.bankName.toLowerCase()))) {
      if (op.type === 'buy') {
        spentTodayVes += op.vesAmount + op.fees;
      } else {
        receivedTodayVes += op.vesAmount;
      }
    }
  }

  const currentBalanceVes = roundMoney(account.initialBalanceVes - spentTodayVes + receivedTodayVes, 2);
  const limit = account.dailyLimitVes;

  let consumedLimitPct = 0;
  let remainingLimitVes = limit;

  if (limit > 0) {
    consumedLimitPct = Math.round((spentTodayVes / limit) * 100);
    remainingLimitVes = Math.max(0, roundMoney(limit - spentTodayVes, 2));
  }

  const isOverLimit = limit > 0 && spentTodayVes >= limit;
  const isNearLimit = limit > 0 && !isOverLimit && consumedLimitPct >= 80;

  return {
    account,
    spentTodayVes: roundMoney(spentTodayVes, 2),
    receivedTodayVes: roundMoney(receivedTodayVes, 2),
    currentBalanceVes,
    consumedLimitPct,
    remainingLimitVes,
    isNearLimit,
    isOverLimit,
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
  let nearLimitCount = 0;
  let overLimitCount = 0;

  for (const u of accountsUsage) {
    totalBalanceVes += u.currentBalanceVes;
    totalSpentTodayVes += u.spentTodayVes;
    totalReceivedTodayVes += u.receivedTodayVes;
    if (u.isOverLimit) overLimitCount++;
    else if (u.isNearLimit) nearLimitCount++;
  }

  return {
    totalBalanceVes: roundMoney(totalBalanceVes, 2),
    totalSpentTodayVes: roundMoney(totalSpentTodayVes, 2),
    totalReceivedTodayVes: roundMoney(totalReceivedTodayVes, 2),
    accountsUsage,
    nearLimitCount,
    overLimitCount,
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
