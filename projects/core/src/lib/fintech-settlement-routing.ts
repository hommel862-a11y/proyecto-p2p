/**
 * Pure Mathematical Engine for High-Ticket Remote Payroll & Fintech Settlement.
 * Routes and prices inbound settlement corridors for international remote workers and B2B exporters:
 * Deel, Wise, Payoneer, Stripe, PayPal -> USDT / VES / USD Cash.
 * Zero external dependencies.
 */

import { roundMoney } from './money';

export type FintechPlatform = 'DEEL' | 'WISE' | 'PAYONEER' | 'STRIPE' | 'PAYPAL';
export type PayoutRail = 'USDT_TRC20' | 'VES_PAGO_MOVIL' | 'VES_TRANSFERENCIA' | 'USD_CASH_DELIVERY';

export interface FintechSettlementRequest {
  platform: FintechPlatform;
  grossAmountUsd: number;
  payoutRail: PayoutRail;
  vesRatePerUsd?: number; // e.g. 85.50
  clientTier?: 'STANDARD' | 'RECURRENT_REMOTE' | 'CORPORATE_AGENCY';
  isVerifiedContractor?: boolean;
}

export interface FintechSettlementQuote {
  settlementId: string;
  platform: FintechPlatform;
  payoutRail: PayoutRail;
  grossAmountUsd: number;
  platformIncomingFeeUsd: number;
  deskCommissionPct: number;
  deskCommissionUsd: number;
  netProceedsUsd: number;
  netProceedsVes?: number;
  effectiveExchangeRateVes?: number;
  chargebackRiskTier: 'LOW' | 'MODERATE' | 'HIGH_HOLD_REQUIRED';
  holdHoursRequired: number;
  complianceDossierRequired: boolean;
  formattedClientProposal: string;
  timestamp: string;
}

/** Standard platform inbound friction percentages */
const PLATFORM_INBOUND_FEES: Record<FintechPlatform, number> = {
  DEEL: 0.0,      // Direct ACH / contractor withdrawal has negligible fee
  WISE: 0.005,    // ~0.5% Wise transfer fee
  PAYONEER: 0.01, // ~1.0% Payoneer bank transfer
  STRIPE: 0.029,  // ~2.9% merchant card gateway
  PAYPAL: 0.044,  // ~4.4% high-friction PayPal transfer
};

/**
 * Calculates tiered desk commission based on platform risk and transaction volume.
 */
function resolveDeskFeePct(platform: FintechPlatform, amount: number, tier: string): number {
  let baseFee = 4.5;

  if (amount >= 10000) baseFee = 3.2;
  else if (amount >= 5000) baseFee = 3.8;
  else if (amount >= 2000) baseFee = 4.2;

  // Recurrent client discounts
  if (tier === 'CORPORATE_AGENCY') baseFee -= 0.5;
  else if (tier === 'RECURRENT_REMOTE') baseFee -= 0.3;

  // High-risk platform surcharge
  if (platform === 'PAYPAL') baseFee += 1.5;
  if (platform === 'STRIPE') baseFee += 0.8;

  return Math.max(2.5, roundMoney(baseFee, 2));
}

/**
 * Routes and calculates a formal settlement quote for inbound fintech funds.
 */
export function calculateFintechSettlementQuote(
  req: FintechSettlementRequest,
): FintechSettlementQuote {
  const gross = Math.max(10, req.grossAmountUsd);
  const platformFeePct = PLATFORM_INBOUND_FEES[req.platform];
  const platformFeeUsd = roundMoney(gross * platformFeePct, 2);

  const deskPct = resolveDeskFeePct(req.platform, gross, req.clientTier ?? 'STANDARD');
  const deskCommissionUsd = roundMoney((gross * deskPct) / 100, 2);

  const netProceedsUsd = roundMoney(gross - platformFeeUsd - deskCommissionUsd, 2);

  let netProceedsVes: number | undefined;
  let effectiveRate: number | undefined;

  if (req.payoutRail === 'VES_PAGO_MOVIL' || req.payoutRail === 'VES_TRANSFERENCIA') {
    const rate = req.vesRatePerUsd && req.vesRatePerUsd > 0 ? req.vesRatePerUsd : 85.0;
    netProceedsVes = roundMoney(netProceedsUsd * rate, 2);
    effectiveRate = roundMoney(netProceedsVes / gross, 2);
  }

  // Chargeback & KYC risk classification
  let riskTier: 'LOW' | 'MODERATE' | 'HIGH_HOLD_REQUIRED' = 'LOW';
  let holdHours = 0;
  const complianceDocRequired = gross >= 2000;

  if (req.platform === 'PAYPAL') {
    riskTier = 'HIGH_HOLD_REQUIRED';
    holdHours = 24; // Protect against 24h dispute
  } else if (req.platform === 'STRIPE' && !req.isVerifiedContractor) {
    riskTier = 'MODERATE';
    holdHours = 6;
  } else if (!req.isVerifiedContractor && gross >= 3000) {
    riskTier = 'MODERATE';
    holdHours = 2;
  }

  const proposalText = [
    `💼 *LIQUIDACIÓN NÓMINA / B2B — ${req.platform}*`,
    `▪ Monto Bruto: $${gross.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`,
    `▪ Comisión de Mesa (${deskPct}%): -$${deskCommissionUsd.toFixed(2)} USD`,
    platformFeeUsd > 0 ? `▪ Costo de Pasarela: -$${platformFeeUsd.toFixed(2)} USD` : null,
    `━━━━━━━━━━━━━━━━━━━━`,
    `✅ *NETO A RECIBIR: $${netProceedsUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT*`,
    netProceedsVes ? `💵 *Equivalente en Bs:* Bs ${netProceedsVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : null,
    `🔒 *Vía de Pago:* ${req.payoutRail}`,
    holdHours > 0 ? `⏳ *Ventana de Validación de Fondos:* ${holdHours} horas.` : `⚡ *Liquidación Inmediata:* Sí (Fondos Verificados).`,
    `📄 *Factura de Servicios Digitales:* Incluida para soporte bancario.`,
  ].filter(Boolean).join('\n');

  return {
    settlementId: `SETTLE-${req.platform}-${Date.now().toString(36).toUpperCase()}`,
    platform: req.platform,
    payoutRail: req.payoutRail,
    grossAmountUsd: gross,
    platformIncomingFeeUsd: platformFeeUsd,
    deskCommissionPct: deskPct,
    deskCommissionUsd,
    netProceedsUsd,
    netProceedsVes,
    effectiveExchangeRateVes: effectiveRate,
    chargebackRiskTier: riskTier,
    holdHoursRequired: holdHours,
    complianceDossierRequired: complianceDocRequired,
    formattedClientProposal: proposalText,
    timestamp: new Date().toISOString(),
  };
}
