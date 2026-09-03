/**
 * Pure break-even and maker ad pricing logic (framework-agnostic).
 * Calculates exact minimum exit price to cover all exchange and bank fees,
 * and computes optimal target sell price for desired net ROI.
 * No network, no Angular.
 */

import { clampNonNegative, roundMoney } from './money';

export interface BreakEvenParams {
  /** Cost basis: buy price in VES per crypto unit (USDT/EUR). */
  buyPrice: number;
  /** Volume of crypto being bought/sold. */
  amount: number;
  /** Platform fee on the buy leg as a fraction (e.g. 0 = 0%, 0.001 = 0.1%). */
  buyFeeRate?: number;
  /** Platform fee on the sell leg as a fraction (e.g. 0.002 = 0.2%). */
  sellFeeRate?: number;
  /** Fixed banking fees in VES (e.g. transfer costs, IGTF, interbank fees). */
  fixedBankFeesVes?: number;
  /** Target net ROI percentage desired (e.g. 1.5 = 1.5% net profit). */
  targetRoiPct?: number;
}

export interface BreakEvenResult {
  /** Total cost invested in VES (capital + buy fees + bank expenses). */
  totalCostVes: number;
  /** Exact minimum sell price (VES/unit) required to achieve net zero profit ($PnL = 0$). */
  breakEvenPrice: number;
  /** Minimum unit spread (VES/unit) required just to break even. */
  breakEvenSpread: number;
  /** Optimal sell price to publish on your ad to achieve the target ROI. */
  targetSellPrice: number;
  /** Unit spread required to achieve target ROI. */
  targetSpread: number;
  /** Projected net profit in VES at the target sell price. */
  projectedNetProfitVes: number;
  /** Safety corridor: difference between target price and break-even price. */
  safetyMarginVes: number;
}

/**
 * Compute break-even price and target ad sell price.
 */
export function calculateBreakEven(params: BreakEvenParams): BreakEvenResult {
  const buyPrice = clampNonNegative(params.buyPrice);
  const amount = clampNonNegative(params.amount);
  const buyFeeRate = Math.min(0.2, clampNonNegative(params.buyFeeRate ?? 0));
  const sellFeeRate = Math.min(0.2, clampNonNegative(params.sellFeeRate ?? 0));
  const fixedBankFees = clampNonNegative(params.fixedBankFeesVes ?? 0);
  const targetRoiPct = clampNonNegative(params.targetRoiPct ?? 0);

  if (amount <= 0 || buyPrice <= 0) {
    return {
      totalCostVes: 0,
      breakEvenPrice: 0,
      breakEvenSpread: 0,
      targetSellPrice: 0,
      targetSpread: 0,
      projectedNetProfitVes: 0,
      safetyMarginVes: 0,
    };
  }

  // Cost basis: acquisition + buy leg commission + bank fees
  const baseVesSpent = amount * buyPrice;
  const buyCommissionVes = baseVesSpent * buyFeeRate;
  const totalCostVes = baseVesSpent + buyCommissionVes + fixedBankFees;

  // Effective multiplier received per unit of crypto sold after sell commission
  const effectiveSellMultiplier = Math.max(0.0001, 1 - sellFeeRate);

  // At break-even: (amount * breakEvenPrice * (1 - sellFeeRate)) - totalCostVes = 0
  const rawBreakEvenPrice = totalCostVes / (amount * effectiveSellMultiplier);
  const breakEvenPrice = roundMoney(rawBreakEvenPrice, 2);
  const breakEvenSpread = roundMoney(breakEvenPrice - buyPrice, 2);

  // Target pricing for desired net ROI
  const targetProfitVes = totalCostVes * (targetRoiPct / 100);
  const totalRevenueNeeded = totalCostVes + targetProfitVes;
  const rawTargetSellPrice = totalRevenueNeeded / (amount * effectiveSellMultiplier);
  const targetSellPrice = roundMoney(rawTargetSellPrice, 2);
  const targetSpread = roundMoney(targetSellPrice - buyPrice, 2);
  const projectedNetProfitVes = roundMoney(targetProfitVes, 2);
  const safetyMarginVes = roundMoney(Math.max(0, targetSellPrice - breakEvenPrice), 2);

  return {
    totalCostVes: roundMoney(totalCostVes, 2),
    breakEvenPrice,
    breakEvenSpread,
    targetSellPrice,
    targetSpread,
    projectedNetProfitVes,
    safetyMarginVes,
  };
}
