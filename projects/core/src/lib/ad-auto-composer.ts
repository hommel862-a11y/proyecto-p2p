import { roundMoney } from './money.js';
import {
  calculatePositionPrice,
  type RepricerStrategy,
} from './repricer.js';
import {
  type BinanceP2pMarketDepth,
  type BinanceOfferSummary,
} from './binance-p2p.js';
import { BUILT_IN_TEMPLATES, generateAdPreview, validateAd, type AdTemplate } from './ad-templates.js';

export interface BankAccountProfile {
  bankName: string;
  accountNumber?: string;
  dailyLimitVes: number;
  currentVolumeVes: number;
  status: 'ACTIVE' | 'WARNING' | 'FROZEN_TODAY' | 'DISABLED';
  isPagoMovil?: boolean;
}

export interface AdComposerInput {
  side: 'BUY' | 'SELL';
  marketDepth: BinanceP2pMarketDepth;
  strategy?: RepricerStrategy;
  stepVes?: number;
  minSpreadPct?: number;
  breakEvenSellPrice?: number;
  maxBuyPrice?: number;
  activeBankAccounts: BankAccountProfile[];
  preferredBankName?: string;
  minTicketUsdt?: number;
  maxAdLimitVes?: number;
  merchantName?: string;
  minCompetitorFinishRatePct?: number;
}

export interface StagedAdDraft {
  side: 'BUY' | 'SELL';
  asset: 'USDT';
  fiat: 'VES';
  price: number;
  priceFormatted: string;
  totalAssetAmountUsdt: number;
  minLimitVes: number;
  maxLimitVes: number;
  minLimitUsdt: number;
  maxLimitUsdt: number;
  paymentMethods: string[];
  selectedBank: string;
  selectedAccountCupoRemainingVes: number;
  adTitle: string;
  terms: string;
  autoReply: string;
  expectedNetSpreadPct: number;
  expectedProfitVesPerCycle: number;
  isGoldenSpread: boolean;
  guardrails: {
    antiSpoofingPassed: boolean;
    breakEvenSafe: boolean;
    maxBuyCeilingSafe: boolean;
    bankCapacitySafe: boolean;
    spreadSafe: boolean;
    flags: string[];
  };
  stagedTimestamp: string;
  readyToPublish: boolean;
  validationWarnings: string[];
}

/**
 * Filter out low-completion and phantom orders (Anti-Spoofing engine).
 */
export function filterAntiSpoofingOffers(
  offers: readonly BinanceOfferSummary[],
  minFinishRatePct = 90,
): BinanceOfferSummary[] {
  return offers.filter((o) => {
    const rate = o.finishRatePct <= 1 ? o.finishRatePct * 100 : o.finishRatePct;
    const isReputable = rate >= minFinishRatePct;
    const isReasonableLimit = (o.maxVes ?? 10000) >= 1000;
    return isReputable && isReasonableLimit;
  });
}

/**
 * Automatically composes a ready-to-publish P2P ad draft by inspecting:
 * 1. Live market depth (filtered against spoofing).
 * 2. Real bank account capacities (anti-overdraft / SUDEBAN protection).
 * 3. Institutional margins & break-even safety floors.
 */
export function composeAdDraft(input: AdComposerInput): StagedAdDraft {
  const {
    side,
    marketDepth,
    strategy = 'TOP_1',
    stepVes = 0.05,
    minSpreadPct = 0.5,
    breakEvenSellPrice = 0,
    maxBuyPrice = 0,
    activeBankAccounts = [],
    preferredBankName,
    minTicketUsdt = 25,
    maxAdLimitVes = 50000,
    merchantName = 'Operador Verificado',
    minCompetitorFinishRatePct = 90,
  } = input;

  const flags: string[] = [];

  // 1. Anti-Spoofing Orderbook Filtering
  const rawOffers = side === 'BUY' ? marketDepth.buyOffers : marketDepth.sellOffers;
  const filteredOffers = filterAntiSpoofingOffers(rawOffers, minCompetitorFinishRatePct);
  const antiSpoofingPassed = filteredOffers.length > 0;
  if (!antiSpoofingPassed) {
    flags.push('NO_REPUTABLE_COMPETITORS_FOUND');
  }

  // 2. Optimal Price Calculation
  const offersToEvaluate = antiSpoofingPassed ? filteredOffers : rawOffers;
  let targetPrice = calculatePositionPrice(offersToEvaluate, side, strategy, stepVes);

  if (targetPrice <= 0) {
    targetPrice = side === 'BUY' ? marketDepth.bestBuyPrice : marketDepth.bestSellPrice;
  }

  // 3. Safety Guardrails on Price
  let breakEvenSafe = true;
  if (side === 'SELL' && breakEvenSellPrice > 0 && targetPrice < breakEvenSellPrice) {
    targetPrice = breakEvenSellPrice;
    breakEvenSafe = false;
    flags.push('BREAK_EVEN_FLOOR_APPLIED');
  }

  let maxBuyCeilingSafe = true;
  if (side === 'BUY' && maxBuyPrice > 0 && targetPrice > maxBuyPrice) {
    targetPrice = maxBuyPrice;
    maxBuyCeilingSafe = false;
    flags.push('MAX_BUY_CEILING_ENFORCED');
  }

  targetPrice = roundMoney(targetPrice, 2);

  // 4. Bank Account Routing & Capacity Allocation
  const eligibleAccounts = activeBankAccounts.filter(
    (acc) => acc.status === 'ACTIVE' || acc.status === 'WARNING',
  );

  let selectedAccount: BankAccountProfile | null = null;
  if (preferredBankName) {
    selectedAccount =
      eligibleAccounts.find(
        (a) => a.bankName.toLowerCase() === preferredBankName.toLowerCase(),
      ) ?? null;
  }

  if (!selectedAccount && eligibleAccounts.length > 0) {
    // Pick account with highest remaining cupo
    selectedAccount = [...eligibleAccounts].sort((a, b) => {
      const remA = a.dailyLimitVes - a.currentVolumeVes;
      const remB = b.dailyLimitVes - b.currentVolumeVes;
      return remB - remA;
    })[0];
  }

  const remainingCupo = selectedAccount
    ? Math.max(0, selectedAccount.dailyLimitVes - selectedAccount.currentVolumeVes)
    : 0;

  let bankCapacitySafe = remainingCupo > 0;
  if (!bankCapacitySafe) {
    flags.push('NO_ACTIVE_BANK_CAPACITY');
  }

  // 5. Compute Limits and Asset Amounts
  const effectiveMaxVes = Math.min(
    remainingCupo > 0 ? remainingCupo : 10000,
    maxAdLimitVes,
  );
  const maxLimitVes = roundMoney(effectiveMaxVes, 2);

  // Anti-pitufeo minimum ticket
  const calculatedMinTicketVes = roundMoney(minTicketUsdt * targetPrice, 2);
  const minLimitVes = Math.min(
    calculatedMinTicketVes > 0 ? calculatedMinTicketVes : 500,
    roundMoney(maxLimitVes * 0.4, 2),
  );

  const totalAssetAmountUsdt = targetPrice > 0 ? roundMoney(maxLimitVes / targetPrice, 2) : 0;
  const minLimitUsdt = targetPrice > 0 ? roundMoney(minLimitVes / targetPrice, 2) : 0;
  const maxLimitUsdt = totalAssetAmountUsdt;

  // 6. Payment Methods & Banking Config
  const bankName = selectedAccount?.bankName ?? 'Banesco';
  const paymentMethods: string[] = ['Pago Móvil', bankName];
  if (selectedAccount && !selectedAccount.isPagoMovil) {
    paymentMethods.splice(0, 1); // Only Bank Transfer
  }

  // 7. Projected Margin & Net Spread
  const oppositePrice = side === 'BUY' ? marketDepth.bestSellPrice : marketDepth.bestBuyPrice;
  let spreadPct = 0;
  let expectedProfitVes = 0;

  if (targetPrice > 0 && oppositePrice > 0) {
    const spreadVes = side === 'BUY' ? oppositePrice - targetPrice : targetPrice - oppositePrice;
    spreadPct = roundMoney((spreadVes / (side === 'BUY' ? targetPrice : oppositePrice)) * 100, 2);
    expectedProfitVes = roundMoney(spreadVes * totalAssetAmountUsdt, 2);
  }

  const isGoldenSpread = spreadPct >= minSpreadPct;
  const spreadSafe = spreadPct > 0;
  if (!spreadSafe) {
    flags.push('INVERTED_OR_ZERO_SPREAD');
  }

  // 8. Template & Terms Rendering
  const templateObj =
    BUILT_IN_TEMPLATES.find((t) => t.type === side) ?? BUILT_IN_TEMPLATES[0];

  const rendered = generateAdPreview(templateObj as AdTemplate, {
    precio: targetPrice,
    spread: spreadPct,
    limiteMin: minLimitVes,
    limiteMax: maxLimitVes,
    banco: bankName,
    metodoPago: paymentMethods.join(', '),
    usuario: merchantName,
    referencia: 'Pago Móvil / Titular Directo',
  });

  const validation = validateAd(rendered.title, rendered.terms, rendered.autoReply);

  const readyToPublish =
    bankCapacitySafe &&
    spreadSafe &&
    targetPrice > 0 &&
    maxLimitVes >= minLimitVes &&
    validation.errors.length === 0;

  return {
    side,
    asset: 'USDT',
    fiat: 'VES',
    price: targetPrice,
    priceFormatted: `${targetPrice.toFixed(2)} VES`,
    totalAssetAmountUsdt,
    minLimitVes,
    maxLimitVes,
    minLimitUsdt,
    maxLimitUsdt,
    paymentMethods,
    selectedBank: bankName,
    selectedAccountCupoRemainingVes: remainingCupo,
    adTitle: rendered.title,
    terms: rendered.terms,
    autoReply: rendered.autoReply,
    expectedNetSpreadPct: spreadPct,
    expectedProfitVesPerCycle: expectedProfitVes,
    isGoldenSpread,
    guardrails: {
      antiSpoofingPassed,
      breakEvenSafe,
      maxBuyCeilingSafe,
      bankCapacitySafe,
      spreadSafe,
      flags,
    },
    stagedTimestamp: new Date().toISOString(),
    readyToPublish,
    validationWarnings: validation.warnings,
  };
}
