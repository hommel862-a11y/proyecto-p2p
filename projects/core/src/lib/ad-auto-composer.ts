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
  targetAssetAmountUsdt?: number;
  customPriceVes?: number;
  makerFeePct?: number;
  templateName?: string;
  customTerms?: string;
  customAutoReply?: string;
  merchantName?: string;
  minCompetitorFinishRatePct?: number;
}

export interface StagedAdDraft {
  side: 'BUY' | 'SELL';
  asset: 'USDT';
  fiat: 'VES';
  price: number;
  priceFormatted: string;
  oppositeBestPrice: number;
  totalAssetAmountUsdt: number;
  minLimitVes: number;
  maxLimitVes: number;
  minLimitUsdt: number;
  maxLimitUsdt: number;
  paymentMethods: string[];
  selectedBank: string;
  selectedAccountCupoRemainingVes: number;
  adTitle: string;
  templateName: string;
  terms: string;
  autoReply: string;
  expectedNetSpreadPct: number;
  netSpreadAfterFeePct: number;
  expectedProfitVesPerCycle: number;
  expectedNetProfitUsdtPerCycle: number;
  makerFeePct: number;
  queueRank: number;
  competitorsAheadCount: number;
  volumeAheadUsdt: number;
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
  validationErrors: string[];
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
 * 4. L2 Orderbook queue rank and volume ahead.
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
    maxAdLimitVes,
    targetAssetAmountUsdt,
    customPriceVes,
    makerFeePct = 0.25,
    templateName,
    customTerms,
    customAutoReply,
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

  // 2. Optimal Price Calculation (Strategy or Custom Locked Price)
  const offersToEvaluate = antiSpoofingPassed ? filteredOffers : rawOffers;
  let targetPrice =
    customPriceVes && customPriceVes > 0
      ? customPriceVes
      : calculatePositionPrice(offersToEvaluate, side, strategy, stepVes);

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

  // 3b. L2 Queue Rank & Ahead Volume Telemetry
  const sortedOffers = [...offersToEvaluate].sort((a, b) =>
    side === 'BUY' ? b.price - a.price : a.price - b.price,
  );
  const offersAhead = sortedOffers.filter((o) =>
    side === 'BUY' ? o.price > targetPrice : o.price < targetPrice,
  );
  const competitorsAheadCount = offersAhead.length;
  const queueRank = competitorsAheadCount + 1;
  const volumeAheadUsdt = roundMoney(
    offersAhead.reduce((acc, o) => {
      const estUsdt = o.price > 0 && o.maxVes > 0 ? o.maxVes / o.price : 0;
      return acc + estUsdt;
    }, 0),
    2,
  );

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

  const bankCapacitySafe = remainingCupo > 0;
  if (!bankCapacitySafe) {
    flags.push('NO_ACTIVE_BANK_CAPACITY');
  }

  // 5. Compute Limits and Asset Amounts (Dynamic Lot + Full Bank Cupo Support)
  let desiredMaxVes = remainingCupo > 0 ? remainingCupo : 10000;
  if (targetAssetAmountUsdt && targetAssetAmountUsdt > 0 && targetPrice > 0) {
    desiredMaxVes = roundMoney(targetAssetAmountUsdt * targetPrice, 2);
  } else if (maxAdLimitVes && maxAdLimitVes > 0) {
    desiredMaxVes = maxAdLimitVes;
  }

  const effectiveMaxVes =
    remainingCupo > 0 ? Math.min(remainingCupo, desiredMaxVes) : desiredMaxVes;
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

  // 7. Projected Margin & Net Spread (Gross + Net After Maker Fee)
  const oppositePrice = side === 'BUY' ? marketDepth.bestSellPrice : marketDepth.bestBuyPrice;
  let spreadPct = 0;
  let netSpreadAfterFeePct = 0;
  let expectedProfitVes = 0;
  let expectedNetProfitUsdt = 0;

  if (targetPrice > 0 && oppositePrice > 0) {
    const spreadVes = side === 'BUY' ? oppositePrice - targetPrice : targetPrice - oppositePrice;
    const baseRef = side === 'BUY' ? targetPrice : oppositePrice;
    spreadPct = roundMoney((spreadVes / baseRef) * 100, 2);
    netSpreadAfterFeePct = roundMoney(spreadPct - makerFeePct * 2, 2);
    expectedProfitVes = roundMoney(spreadVes * totalAssetAmountUsdt, 2);
    expectedNetProfitUsdt = roundMoney(
      totalAssetAmountUsdt * (netSpreadAfterFeePct / 100),
      2,
    );
  }

  const isGoldenSpread = spreadPct >= minSpreadPct;
  const spreadSafe = spreadPct > 0;
  if (!spreadSafe) {
    flags.push('INVERTED_OR_ZERO_SPREAD');
  }

  // 8. Template & Terms Rendering
  const matchingTemplates = BUILT_IN_TEMPLATES.filter((t) => t.type === side);
  const templateObj =
    (templateName ? BUILT_IN_TEMPLATES.find((t) => t.name === templateName) : undefined) ??
    matchingTemplates[0] ??
    BUILT_IN_TEMPLATES[0];

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

  const finalTerms =
    customTerms && customTerms.trim().length > 0 ? customTerms.trim() : rendered.terms;
  const finalAutoReply =
    customAutoReply && customAutoReply.trim().length > 0
      ? customAutoReply.trim()
      : rendered.autoReply;

  const validation = validateAd(rendered.title, finalTerms, finalAutoReply);

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
    oppositeBestPrice: roundMoney(oppositePrice, 2),
    totalAssetAmountUsdt,
    minLimitVes,
    maxLimitVes,
    minLimitUsdt,
    maxLimitUsdt,
    paymentMethods,
    selectedBank: bankName,
    selectedAccountCupoRemainingVes: remainingCupo,
    adTitle: rendered.title,
    templateName: templateObj.name,
    terms: finalTerms,
    autoReply: finalAutoReply,
    expectedNetSpreadPct: spreadPct,
    netSpreadAfterFeePct,
    expectedProfitVesPerCycle: expectedProfitVes,
    expectedNetProfitUsdtPerCycle: expectedNetProfitUsdt,
    makerFeePct,
    queueRank,
    competitorsAheadCount,
    volumeAheadUsdt,
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
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
  };
}
