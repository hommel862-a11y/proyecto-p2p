/**
 * Remittance Corridor & Cross-Border Quotation Engine.
 * Pure domain logic: zero dependencies, framework-agnostic.
 * Models corridors (COP, USD Zelle, EUR SEPA, CLP, BRL) -> VES (Pago Móvil / Banco)
 * and formats instant copy-ready quotes for WhatsApp / Telegram.
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
    originFlag: '🇨🇭',
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
];

export interface RemittanceQuoteRequest {
  corridorId: string;
  calculationMode: 'BY_SEND_AMOUNT' | 'BY_RECEIVE_AMOUNT';
  amount: number; // Origin fiat if BY_SEND_AMOUNT, Destination fiat (VES) if BY_RECEIVE_AMOUNT
  originCryptoRate: number; // Units of origin fiat per 1 USDT (e.g. 4200 COP/USDT or 1 USD/USDT)
  destCryptoRate: number; // Units of dest fiat per 1 USDT (e.g. 98.50 VES/USDT)
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
}

/**
 * Calculates net remittance quote with banking friction, intermediate USDT bridge, and operator margin.
 */
export function calculateRemittanceQuote(request: RemittanceQuoteRequest): RemittanceQuoteResult {
  const corridor =
    DEFAULT_REMITTANCE_CORRIDORS.find((c) => c.id === request.corridorId) ??
    DEFAULT_REMITTANCE_CORRIDORS[0];

  const bankingFeePct = request.bankingFeePct ?? corridor.defaultBankingFeePct;
  const bankingFixedFee = request.bankingFixedFee ?? corridor.defaultBankingFixedFee;
  const marginPct = Math.max(0, request.operatorMarginPct);
  const originRate = Math.max(0.000001, request.originCryptoRate);
  const destRate = Math.max(0.000001, request.destCryptoRate);

  let grossOrigin: number;
  let bankingFee: number;
  let netOrigin: number;
  let cryptoBase: number;
  let operatorUsdt: number;
  let clientUsdt: number;
  let destPayout: number;

  if (request.calculationMode === 'BY_SEND_AMOUNT') {
    grossOrigin = Math.max(0, request.amount);
    bankingFee = roundMoney((grossOrigin * (bankingFeePct / 100)) + bankingFixedFee);
    netOrigin = Math.max(0, grossOrigin - bankingFee);
    
    cryptoBase = netOrigin / originRate;
    operatorUsdt = cryptoBase * (marginPct / 100);
    clientUsdt = Math.max(0, cryptoBase - operatorUsdt);
    destPayout = roundMoney(clientUsdt * destRate);
  } else {
    // Target destination fiat (VES)
    destPayout = Math.max(0, request.amount);
    clientUsdt = destPayout / destRate;
    
    // Reverse operator margin: clientUsdt = cryptoBase * (1 - marginPct/100)
    const marginMultiplier = Math.max(0.01, 1 - (marginPct / 100));
    cryptoBase = clientUsdt / marginMultiplier;
    operatorUsdt = cryptoBase - clientUsdt;
    
    netOrigin = cryptoBase * originRate;
    // Reverse banking fee: netOrigin = grossOrigin * (1 - bankingFeePct/100) - bankingFixedFee
    const bankMultiplier = Math.max(0.01, 1 - (bankingFeePct / 100));
    grossOrigin = roundMoney((netOrigin + bankingFixedFee) / bankMultiplier);
    bankingFee = roundMoney(grossOrigin - netOrigin);
  }

  const operatorProfitDest = roundMoney(operatorUsdt * destRate);
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
    grossOriginAmount: roundMoney(grossOrigin),
    bankingFeeTotal: roundMoney(bankingFee),
    netOriginAmount: roundMoney(netOrigin),
    cryptoBaseUsdt: Number(cryptoBase.toFixed(4)),
    operatorMarginUsdt: Number(operatorUsdt.toFixed(4)),
    clientPayoutUsdt: Number(clientUsdt.toFixed(4)),
    destPayoutAmount: roundMoney(destPayout),
    operatorProfitDestFiat: operatorProfitDest,
    effectiveRate: Number(effectiveRate.toFixed(6)),
    inverseRate: Number(inverseRate.toFixed(4)),
    originCryptoRate: originRate,
    destCryptoRate: destRate,
    operatorMarginPct: marginPct,
    timestamp: Date.now(),
  };
}

export interface WhatsAppFormatOptions {
  companyOrDeskName?: string;
  validityMinutes?: number;
  contactNumber?: string;
  includeDisclaimer?: boolean;
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

  const originFormatted = `${quote.originFlag} ${quote.grossOriginAmount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${quote.originCurrency}`;
  const destFormatted = `${quote.destFlag} ${quote.destPayoutAmount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${quote.destCurrency}`;
  
  const effectiveRateStr =
    quote.originCurrency === 'COP' || quote.originCurrency === 'CLP'
      ? `1 ${quote.originCurrency} = ${quote.effectiveRate.toFixed(4)} ${quote.destCurrency}`
      : `1 ${quote.originCurrency} = ${quote.effectiveRate.toFixed(2)} ${quote.destCurrency}`;

  let msg = `💸 *COTIZACIÓN DE REMESA EXPRESS* 💸\n`;
  msg += `🏢 Atendido por: ${deskName}\n`;
  msg += `────────────────────────────\n`;
  msg += `📍 *Corredor*: ${quote.paymentMethod} ➔ ${quote.destPaymentMethod}\n`;
  msg += `💵 *Monto a enviar*: ${originFormatted}\n`;
  msg += `📊 *Tasa preferencial*: ${effectiveRateStr}\n`;
  msg += `✅ *Recibes neto*: ${destFormatted}\n`;
  msg += `⏱️ *Validez*: ${validity} minutos (por volatilidad del mercado)\n`;
  msg += `────────────────────────────\n`;
  
  if (options.includeDisclaimer !== false) {
    msg += `🔒 *POLÍTICA DE SEGURIDAD ESTRICTA*:\n`;
    msg += `• Solo aceptamos transferencias del titular de la cuenta bancaria.\n`;
    msg += `• Cero pagos a través de terceros o intermediarios desconocidos.\n`;
  }

  msg += `\n¿Confirmamos los datos bancarios para procesar de inmediato?`;

  return msg;
}
