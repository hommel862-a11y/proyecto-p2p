/**
 * Remittance Corridor & Cross-Border Quotation Engine.
 * Pure domain logic: zero dependencies, framework-agnostic.
 * Models corridors (COP, USD Zelle, EUR SEPA, CLP, BRL, PEN) -> VES (Pago Móvil / Banco),
 * the reverse VES -> PEN corridor, and formats instant copy-ready quotes for
 * WhatsApp / Telegram. Destination currency is corridor-defined, not assumed VES.
 */

import { roundMoney } from './money';

export interface RemittanceCorridorConfig {
  id: string;
  name: string;
  originCurrency: string;
  destCurrency: string;
  originFlag: string;
  destFlag: string;
  defaultBankingFeePct: number; // e.g. 0.4 for Colombia 4x1000 GMF
  defaultBankingFixedFee: number; // e.g. 1.0 for SEPA
  defaultOperatorMarginPct: number; // e.g. 2.5%
  typicalOriginCryptoRate: number; // e.g. 4180 COP/USDT
  /** Reference dest fiat per USDT when dest is not VES (VES is bound to the live P2P book). */
  typicalDestCryptoRate?: number;
  paymentMethod: string;
  destPaymentMethod: string;
}

export const DEFAULT_REMITTANCE_CORRIDORS: RemittanceCorridorConfig[] = [
  {
    id: 'COP_BANCOLOMBIA_TO_VES',
    name: 'Colombia (Bancolombia/Nequi) ➔ Venezuela',
    originCurrency: 'COP',
    destCurrency: 'VES',
    originFlag: '🇨🇴',
    destFlag: '🇻🇪',
    defaultBankingFeePct: 0.4, // 4x1000 GMF
    defaultBankingFixedFee: 0,
    defaultOperatorMarginPct: 2.5,
    typicalOriginCryptoRate: 4190,
    paymentMethod: 'Bancolombia / Nequi',
    destPaymentMethod: 'Pago Móvil / Transferencia',
  },
  {
    id: 'USD_ZELLE_TO_VES',
    name: 'Estados Unidos (Zelle) ➔ Venezuela',
    originCurrency: 'USD',
    destCurrency: 'VES',
    originFlag: '🇺🇸',
    destFlag: '🇻🇪',
    defaultBankingFeePct: 0.0,
    defaultBankingFixedFee: 0,
    defaultOperatorMarginPct: 3.0,
    typicalOriginCryptoRate: 1.0,
    paymentMethod: 'Zelle',
    destPaymentMethod: 'Pago Móvil Interbancario',
  },
  {
    id: 'EUR_SEPA_TO_VES',
    name: 'Europa (SEPA / Revolut) ➔ Venezuela',
    originCurrency: 'EUR',
    destCurrency: 'VES',
    originFlag: '🇪🇺',
    destFlag: '🇻🇪',
    defaultBankingFeePct: 0.0,
    defaultBankingFixedFee: 1.0, // 1 EUR wire friction
    defaultOperatorMarginPct: 3.0,
    typicalOriginCryptoRate: 0.92, // EUR/USDT (1 USDT ~ 0.92 EUR)
    paymentMethod: 'SEPA Instant / Revolut',
    destPaymentMethod: 'Pago Móvil / Banco',
  },
  {
    id: 'CLP_BANCO_TO_VES',
    name: 'Chile (BancoEstado / RUT) ➔ Venezuela',
    originCurrency: 'CLP',
    destCurrency: 'VES',
    originFlag: '🇨🇱',
    destFlag: '🇻🇪',
    defaultBankingFeePct: 0.0,
    defaultBankingFixedFee: 300, // CLP bank transfer fee
    defaultOperatorMarginPct: 3.5,
    typicalOriginCryptoRate: 975, // CLP/USDT
    paymentMethod: 'Transferencia Cuenta RUT / Bancos',
    destPaymentMethod: 'Pago Móvil / Banco',
  },
  {
    id: 'BRL_PIX_TO_VES',
    name: 'Brasil (Pix) ➔ Venezuela',
    originCurrency: 'BRL',
    destCurrency: 'VES',
    originFlag: '🇧🇷',
    destFlag: '🇻🇪',
    defaultBankingFeePct: 0.0,
    defaultBankingFixedFee: 0,
    defaultOperatorMarginPct: 2.5,
    typicalOriginCryptoRate: 5.75, // BRL/USDT
    paymentMethod: 'Pix Instantáneo',
    destPaymentMethod: 'Pago Móvil / Banco',
  },
  {
    id: 'PEN_YAPE_TO_VES',
    name: 'Perú (Yape / Plin / BCP) ➔ Venezuela',
    originCurrency: 'PEN',
    destCurrency: 'VES',
    originFlag: '🇵🇪',
    destFlag: '🇻🇪',
    defaultBankingFeePct: 0.0,
    defaultBankingFixedFee: 0,
    defaultOperatorMarginPct: 3.0,
    typicalOriginCryptoRate: 3.75, // PEN/USDT
    paymentMethod: 'Yape / Plin / BCP',
    destPaymentMethod: 'Pago Móvil / Banco',
  },
  {
    id: 'VES_TO_PEN_YAPE',
    name: 'Venezuela ➔ Perú (Yape / Plin / BCP)',
    originCurrency: 'VES',
    destCurrency: 'PEN',
    originFlag: '🇻🇪',
    destFlag: '🇵🇪',
    defaultBankingFeePct: 0.0,
    defaultBankingFixedFee: 0,
    defaultOperatorMarginPct: 3.0,
    typicalOriginCryptoRate: 98.5, // VES/USDT fallback; UI binds it to the live P2P book
    typicalDestCryptoRate: 3.75, // PEN/USDT
    paymentMethod: 'Pago Móvil / Banco',
    destPaymentMethod: 'Yape / Plin / BCP',
  },
  {
    id: 'VES_TO_USD_ZELLE',
    name: 'Venezuela ➔ Estados Unidos (Zelle)',
    originCurrency: 'VES',
    destCurrency: 'USD',
    originFlag: '🇻🇪',
    destFlag: '🇺🇸',
    defaultBankingFeePct: 0.0,
    defaultBankingFixedFee: 0,
    defaultOperatorMarginPct: 3.0,
    typicalOriginCryptoRate: 98.5, // VES/USDT fallback; UI binds it to the live P2P book
    typicalDestCryptoRate: 1.0, // USD paid per USDT sold for Zelle (adjust for the Zelle discount)
    paymentMethod: 'Pago Móvil / Transferencia',
    destPaymentMethod: 'Zelle',
  },
];

/** Minor-unit precision per currency. COP and CLP have no cents in practice. */
export const CURRENCY_DECIMALS: Readonly<Record<string, number>> = {
  COP: 0,
  CLP: 0,
  VES: 2,
  USD: 2,
  EUR: 2,
  PEN: 2,
  BRL: 2,
};

export function currencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency] ?? 2;
}

/** Rounds up to the currency precision: the client always sends enough. */
function ceilTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.ceil(value * factor - 1e-9) / factor;
}

/** Rounds down to the currency precision: the desk never overpays. */
function floorTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 1e-9) / factor;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Upper bound for desk margin and banking fee percentages. */
export const REMITTANCE_MAX_PCT = 50;

export type RemittanceIssueCode =
  | 'UNKNOWN_CORRIDOR'
  | 'INVALID_AMOUNT'
  | 'INVALID_ORIGIN_RATE'
  | 'INVALID_DEST_RATE'
  | 'MARGIN_OUT_OF_RANGE'
  | 'FEE_OUT_OF_RANGE'
  | 'FEE_EXCEEDS_AMOUNT';

export interface RemittanceIssue {
  code: RemittanceIssueCode;
  message: string;
}

export interface RemittanceQuoteRequest {
  corridorId: string;
  calculationMode: 'BY_SEND_AMOUNT' | 'BY_RECEIVE_AMOUNT';
  amount: number; // Origin fiat if BY_SEND_AMOUNT, destination fiat if BY_RECEIVE_AMOUNT
  originCryptoRate: number; // Units of origin fiat per 1 USDT (e.g. 4200 COP/USDT or 98.50 VES/USDT)
  destCryptoRate: number; // Units of dest fiat per 1 USDT (e.g. 98.50 VES/USDT or 3.75 PEN/USDT)
  operatorMarginPct: number; // Desk markup (e.g. 2.5%)
  bankingFeePct?: number; // e.g. 0.4%
  bankingFixedFee?: number; // e.g. 0
  clientName?: string;
  notes?: string;
}

export interface RemittanceQuoteResult {
  corridorId: string;
  originCurrency: string;
  destCurrency: string;
  originFlag: string;
  destFlag: string;
  paymentMethod: string;
  destPaymentMethod: string;
  calculationMode: 'BY_SEND_AMOUNT' | 'BY_RECEIVE_AMOUNT';
  
  // Amounts
  grossOriginAmount: number;
  bankingFeeTotal: number;
  netOriginAmount: number;
  
  // Crypto intermediate
  cryptoBaseUsdt: number;
  operatorMarginUsdt: number;
  clientPayoutUsdt: number;
  
  // Destination payout
  destPayoutAmount: number;
  operatorProfitDestFiat: number;
  
  // Commercial Rates
  effectiveRate: number; // Destination fiat received per 1 unit of origin fiat (e.g. 0.0232 VES / COP)
  inverseRate: number; // Origin fiat required per 1 unit of destination fiat
  originCryptoRate: number;
  destCryptoRate: number;
  operatorMarginPct: number;
  timestamp: number;

  // Validation
  /** False when any input is unusable; the quote must not be sent to a client. */
  isValid: boolean;
  issues: RemittanceIssue[];
}

/**
 * Calculates net remittance quote with banking friction, intermediate USDT bridge, and operator margin.
 *
 * Rounding is directional and currency-aware: the amount the client must send is
 * rounded UP and the payout is rounded DOWN, so rounding never costs the desk money.
 * Invalid inputs never throw; they are reported in `issues` with `isValid = false`.
 */
export function calculateRemittanceQuote(request: RemittanceQuoteRequest): RemittanceQuoteResult {
  const issues: RemittanceIssue[] = [];
  const knownCorridor = DEFAULT_REMITTANCE_CORRIDORS.find((c) => c.id === request.corridorId);
  if (!knownCorridor) {
    issues.push({ code: 'UNKNOWN_CORRIDOR', message: `Corredor desconocido: ${request.corridorId}` });
  }
  const corridor = knownCorridor ?? DEFAULT_REMITTANCE_CORRIDORS[0];
  const originDecimals = currencyDecimals(corridor.originCurrency);
  const destDecimals = currencyDecimals(corridor.destCurrency);

  if (!isPositiveFinite(request.amount)) {
    issues.push({ code: 'INVALID_AMOUNT', message: 'El monto debe ser mayor que cero.' });
  }
  if (!isPositiveFinite(request.originCryptoRate)) {
    issues.push({
      code: 'INVALID_ORIGIN_RATE',
      message: `Tasa de origen inválida (${corridor.originCurrency}/USDT).`,
    });
  }
  if (!isPositiveFinite(request.destCryptoRate)) {
    issues.push({
      code: 'INVALID_DEST_RATE',
      message: `Tasa de salida inválida (${corridor.destCurrency}/USDT).`,
    });
  }

  const rawMargin = Number.isFinite(request.operatorMarginPct) ? request.operatorMarginPct : 0;
  if (rawMargin < 0 || rawMargin >= REMITTANCE_MAX_PCT) {
    issues.push({
      code: 'MARGIN_OUT_OF_RANGE',
      message: `El margen de la mesa debe estar entre 0% y ${REMITTANCE_MAX_PCT}%.`,
    });
  }
  const rawFeePct = request.bankingFeePct ?? corridor.defaultBankingFeePct;
  const rawFixedFee = request.bankingFixedFee ?? corridor.defaultBankingFixedFee;
  if (
    !Number.isFinite(rawFeePct) || rawFeePct < 0 || rawFeePct >= REMITTANCE_MAX_PCT ||
    !Number.isFinite(rawFixedFee) || rawFixedFee < 0
  ) {
    issues.push({ code: 'FEE_OUT_OF_RANGE', message: 'La fricción bancaria está fuera de rango.' });
  }

  const bankingFeePct = Math.min(Math.max(0, Number.isFinite(rawFeePct) ? rawFeePct : 0), REMITTANCE_MAX_PCT);
  const bankingFixedFee = Math.max(0, Number.isFinite(rawFixedFee) ? rawFixedFee : 0);
  const marginPct = Math.min(Math.max(0, rawMargin), REMITTANCE_MAX_PCT);
  const amount = isPositiveFinite(request.amount) ? request.amount : 0;
  const originRate = isPositiveFinite(request.originCryptoRate) ? request.originCryptoRate : 0;
  const destRate = isPositiveFinite(request.destCryptoRate) ? request.destCryptoRate : 0;
  const ratesUsable = originRate > 0 && destRate > 0;

  let grossOrigin = 0;
  let bankingFee = 0;
  let netOrigin = 0;
  let cryptoBase = 0;
  let operatorUsdt = 0;
  let clientUsdt = 0;
  let destPayout = 0;

  if (request.calculationMode === 'BY_SEND_AMOUNT') {
    grossOrigin = amount;
    bankingFee = roundMoney((grossOrigin * (bankingFeePct / 100)) + bankingFixedFee, originDecimals);
    netOrigin = Math.max(0, grossOrigin - bankingFee);
    if (amount > 0 && bankingFee >= grossOrigin) {
      issues.push({
        code: 'FEE_EXCEEDS_AMOUNT',
        message: 'La comisión bancaria consume todo el monto enviado.',
      });
    }

    if (ratesUsable) {
      cryptoBase = netOrigin / originRate;
      operatorUsdt = cryptoBase * (marginPct / 100);
      clientUsdt = Math.max(0, cryptoBase - operatorUsdt);
      destPayout = floorTo(clientUsdt * destRate, destDecimals);
    }
  } else {
    // Target destination fiat (VES, PEN, USD...)
    destPayout = roundMoney(amount, destDecimals);
    if (ratesUsable) {
      clientUsdt = destPayout / destRate;

      // Reverse operator margin: clientUsdt = cryptoBase * (1 - marginPct/100)
      const marginMultiplier = 1 - (marginPct / 100);
      cryptoBase = clientUsdt / marginMultiplier;
      operatorUsdt = cryptoBase - clientUsdt;

      netOrigin = cryptoBase * originRate;
      // Reverse banking fee: netOrigin = grossOrigin * (1 - bankingFeePct/100) - bankingFixedFee
      const bankMultiplier = 1 - (bankingFeePct / 100);
      grossOrigin = ceilTo((netOrigin + bankingFixedFee) / bankMultiplier, originDecimals);
      bankingFee = roundMoney(grossOrigin - netOrigin, originDecimals);
    }
  }

  const operatorProfitDest = roundMoney(operatorUsdt * destRate, destDecimals);
  const effectiveRate = grossOrigin > 0 ? destPayout / grossOrigin : 0;
  const inverseRate = effectiveRate > 0 ? 1 / effectiveRate : 0;

  return {
    corridorId: corridor.id,
    originCurrency: corridor.originCurrency,
    destCurrency: corridor.destCurrency,
    originFlag: corridor.originFlag,
    destFlag: corridor.destFlag,
    paymentMethod: corridor.paymentMethod,
    destPaymentMethod: corridor.destPaymentMethod,
    calculationMode: request.calculationMode,
    grossOriginAmount: roundMoney(grossOrigin, originDecimals),
    bankingFeeTotal: roundMoney(bankingFee, originDecimals),
    netOriginAmount: roundMoney(netOrigin, originDecimals),
    cryptoBaseUsdt: Number(cryptoBase.toFixed(4)),
    operatorMarginUsdt: Number(operatorUsdt.toFixed(4)),
    clientPayoutUsdt: Number(clientUsdt.toFixed(4)),
    destPayoutAmount: roundMoney(destPayout, destDecimals),
    operatorProfitDestFiat: operatorProfitDest,
    effectiveRate: Number(effectiveRate.toFixed(6)),
    inverseRate: Number(inverseRate.toFixed(4)),
    originCryptoRate: originRate,
    destCryptoRate: destRate,
    operatorMarginPct: marginPct,
    timestamp: Date.now(),
    isValid: issues.length === 0,
    issues,
  };
}

/** Formats an amount with the currency's own precision, es-VE locale. */
export function formatCurrencyAmount(amount: number, currency: string): string {
  const decimals = currencyDecimals(currency);
  return amount.toLocaleString('es-VE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Commercial rate string as clients read it, es-VE locale.
 * VES-origin rates are tiny (1 VES = 0.03 PEN), so they are quoted inverted.
 */
export function formatQuoteRate(quote: RemittanceQuoteResult): string {
  const fmt = (v: number, d: number): string =>
    v.toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (quote.originCurrency === 'VES') {
    return `1 ${quote.destCurrency} = ${fmt(quote.inverseRate, 2)} ${quote.originCurrency}`;
  }
  if (quote.originCurrency === 'COP' || quote.originCurrency === 'CLP') {
    return `1 ${quote.originCurrency} = ${fmt(quote.effectiveRate, 4)} ${quote.destCurrency}`;
  }
  return `1 ${quote.originCurrency} = ${fmt(quote.effectiveRate, 2)} ${quote.destCurrency}`;
}

export interface WhatsAppFormatOptions {
  companyOrDeskName?: string;
  validityMinutes?: number;
  contactNumber?: string;
  includeDisclaimer?: boolean;
  /** Epoch ms the quote was issued; enables a concrete "valid until HH:MM" line. */
  issuedAtMs?: number;
}

/**
 * Formats a clean, high-conversion WhatsApp quote message for clients.
 */
export function formatRemittanceWhatsAppMessage(
  quote: RemittanceQuoteResult,
  options: WhatsAppFormatOptions = {}
): string {
  const deskName = options.companyOrDeskName ? `*${options.companyOrDeskName}*` : 'Mesa P2P';
  const validity = options.validityMinutes ?? 15;

  const originFormatted = `${quote.originFlag} ${formatCurrencyAmount(quote.grossOriginAmount, quote.originCurrency)} ${quote.originCurrency}`;
  const destFormatted = `${quote.destFlag} ${formatCurrencyAmount(quote.destPayoutAmount, quote.destCurrency)} ${quote.destCurrency}`;

  // VES-origin rates are tiny (1 VES = 0.03 PEN); quote them inverted, the way clients read them.
  const effectiveRateStr = formatQuoteRate(quote);

  let msg = `💸 *COTIZACIÓN DE REMESA EXPRESS* 💸\n`;
  msg += `🏢 Atendido por: ${deskName}\n`;
  msg += `────────────────────────────\n`;
  msg += `📍 *Corredor*: ${quote.paymentMethod} ➔ ${quote.destPaymentMethod}\n`;
  msg += `💵 *Monto a enviar*: ${originFormatted}\n`;
  msg += `📊 *Tasa preferencial*: ${effectiveRateStr}\n`;
  msg += `✅ *Recibes neto*: ${destFormatted}\n`;
  msg += `⏱️ *Validez*: ${validity} minutos (por volatilidad del mercado)\n`;
  if (options.issuedAtMs !== undefined && Number.isFinite(options.issuedAtMs)) {
    const until = new Date(options.issuedAtMs + validity * 60_000);
    const hh = String(until.getHours()).padStart(2, '0');
    const mm = String(until.getMinutes()).padStart(2, '0');
    msg += `🕒 *Válida hasta*: ${hh}:${mm}\n`;
  }
  if (options.contactNumber) {
    msg += `📞 *Contacto*: ${options.contactNumber}\n`;
  }
  msg += `────────────────────────────\n`;

  if (options.includeDisclaimer !== false) {
    msg += `🔒 *POLÍTICA DE SEGURIDAD ESTRICTA*:\n`;
    msg += `• Solo aceptamos transferencias del titular de la cuenta bancaria.\n`;
    msg += `• Cero pagos a través de terceros o intermediarios desconocidos.\n`;
  }

  msg += `\n¿Confirmamos los datos bancarios para procesar de inmediato?`;

  return msg;
}

// ─── USD ⇄ VES Dual Converter ──────────────────────────────────────────────

export type UsdVesDirection = 'USD_TO_VES' | 'VES_TO_USD';

/** VES per 1 USD(T) from each reference market. Missing/invalid values are skipped. */
export interface UsdVesReferenceRates {
  /** Official BCV rate. */
  bcv?: number | null;
  /** Cheapest P2P price to BUY USDT with VES (ask). */
  p2pBuy?: number | null;
  /** Best P2P price to SELL USDT for VES (bid). */
  p2pSell?: number | null;
}

export type UsdVesRateSource = 'BCV' | 'P2P' | 'DESK';

export interface UsdVesConversionLine {
  source: UsdVesRateSource;
  label: string;
  /** VES per 1 USD applied on this line. */
  rate: number;
  /** Converted amount in the target currency. */
  result: number;
}

export interface UsdVesConversionResult {
  direction: UsdVesDirection;
  amount: number;
  fromCurrency: 'USD' | 'VES';
  toCurrency: 'USD' | 'VES';
  lines: UsdVesConversionLine[];
  /** P2P mid vs BCV gap in %, null when either side is missing. */
  exchangeGapPct: number | null;
}

/**
 * Converts USD⇄VES against every available reference at once.
 *
 * The P2P line uses the side a person actually executes on:
 * USD→VES sells USDT (bid), VES→USD buys USDT (ask).
 * The DESK line applies the desk margin on top of that executable P2P rate,
 * always against the client: fewer VES per USD paid out, more VES per USD charged.
 */
export function convertUsdVes(
  amount: number,
  direction: UsdVesDirection,
  rates: UsdVesReferenceRates,
  deskMarginPct = 0,
): UsdVesConversionResult {
  const safeAmount = isPositiveFinite(amount) ? amount : 0;
  const bcv = isPositiveFinite(rates.bcv) ? rates.bcv : null;
  const p2pBuy = isPositiveFinite(rates.p2pBuy) ? rates.p2pBuy : null;
  const p2pSell = isPositiveFinite(rates.p2pSell) ? rates.p2pSell : null;
  const margin = Math.min(Math.max(0, Number.isFinite(deskMarginPct) ? deskMarginPct : 0), REMITTANCE_MAX_PCT - 0.01);

  const toVes = direction === 'USD_TO_VES';
  const convert = (rate: number): number =>
    toVes ? floorTo(safeAmount * rate, 2) : floorTo(safeAmount / rate, 2);

  const lines: UsdVesConversionLine[] = [];
  if (bcv) {
    lines.push({ source: 'BCV', label: 'BCV oficial', rate: bcv, result: convert(bcv) });
  }

  const executable = toVes ? p2pSell : p2pBuy;
  if (executable) {
    lines.push({
      source: 'P2P',
      label: toVes ? 'P2P · vender USDT' : 'P2P · comprar USDT',
      rate: executable,
      result: convert(executable),
    });
    const deskRate = toVes ? executable * (1 - margin / 100) : executable / (1 - margin / 100);
    lines.push({
      source: 'DESK',
      label: `Tasa mesa (${margin.toLocaleString('es-VE', { maximumFractionDigits: 2 })}%)`,
      rate: Number(deskRate.toFixed(4)),
      result: convert(deskRate),
    });
  }

  const p2pSides = [p2pBuy, p2pSell].filter((v): v is number => v !== null);
  const p2pMid = p2pSides.length > 0 ? p2pSides.reduce((a, b) => a + b, 0) / p2pSides.length : null;
  const exchangeGapPct = bcv && p2pMid ? roundMoney(((p2pMid - bcv) / bcv) * 100, 2) : null;

  return {
    direction,
    amount: safeAmount,
    fromCurrency: toVes ? 'USD' : 'VES',
    toCurrency: toVes ? 'VES' : 'USD',
    lines,
    exchangeGapPct,
  };
}
