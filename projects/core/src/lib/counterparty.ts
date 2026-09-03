/**
 * Pure counterparty CRM and anti-triangulation risk detection domain logic.
 * Protects P2P merchants against 3rd-party payment scams, bank account freezes,
 * and malicious triangulations. Framework-agnostic. No network, no Angular.
 */

import { type Operation } from './log';
import { roundMoney } from './money';

export type CounterpartyReputation =
  | 'TRUSTED'     // Verified KYC, titular match, multiple safe trades
  | 'VERIFIED'    // Document and identity verified once
  | 'NORMAL'      // Standard merchant or user
  | 'SUSPICIOUS'  // Inconsistent payment names or delay history
  | 'BLOCKED';    // Do not trade under any circumstance

export interface Counterparty {
  id: string;
  /** Platform nickname / Binance P2P alias (e.g. "TraderPro_VZLA"). */
  alias: string;
  /** Legal real name of the account holder (e.g. "Juan Carlos Pérez"). */
  realName: string;
  /** National document ID (e.g. "V-18452123"). */
  documentId: string;
  /** Primary contact phone or Pago Móvil number (e.g. "0414-1234567"). */
  phone?: string;
  /** Known registered bank accounts. */
  bankAccounts?: string[];
  /** Merchant risk / trust rating. */
  reputation: CounterpartyReputation;
  /** Merchant notes regarding habits, speed, or compliance details. */
  notes?: string;
  /** Date of first interaction. */
  createdAt: string;
}

export interface AntiTriangulationAssessment {
  isSafe: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  warning?: string;
  /** True if payment comes from an unauthorized third-party titular. */
  isThirdPartyPayment: boolean;
}

/**
 * Normalize names for fuzzy anti-triangulation matching (strips accents, lowercases, trims).
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if the payment account titular matches the verified counterparty real name.
 * Prevents 3rd-party transfer scams (Triangulación) where scammers pay from hacked accounts.
 */
export function verifyTitularMatch(verifiedName: string, paymentPayerName: string): boolean {
  const normVerified = normalizeName(verifiedName);
  const normPayer = normalizeName(paymentPayerName);

  if (!normVerified || !normPayer) return false;
  if (normVerified === normPayer) return true;

  // Split tokens (first name, last name)
  const vTokens = normVerified.split(' ').filter((t) => t.length > 2);
  const pTokens = normPayer.split(' ').filter((t) => t.length > 2);

  // If at least two substantial tokens match (e.g. "Juan Pérez" in "Juan Carlos Pérez"), consider match
  const matches = vTokens.filter((token) => pTokens.includes(token));
  return matches.length >= 2;
}

/**
 * Assess transaction risk against the counterparty profile and the bank transfer sender.
 */
export function assessCounterpartyRisk(
  counterparty: Counterparty | null | undefined,
  bankPayerName?: string,
): AntiTriangulationAssessment {
  if (!counterparty) {
    if (bankPayerName && bankPayerName.trim().length > 0) {
      return {
        isSafe: true,
        riskLevel: 'MEDIUM',
        warning: 'Contraparte no registrada en el CRM. Verificá que el titular bancario coincida con la cédula en plataforma.',
        isThirdPartyPayment: false,
      };
    }
    return { isSafe: true, riskLevel: 'LOW', isThirdPartyPayment: false };
  }

  if (counterparty.reputation === 'BLOCKED') {
    return {
      isSafe: false,
      riskLevel: 'CRITICAL',
      warning: `OPERACIÓN BLOQUEADA: La contraparte "${counterparty.alias}" (${counterparty.realName}) está en la lista negra.`,
      isThirdPartyPayment: false,
    };
  }

  if (counterparty.reputation === 'SUSPICIOUS') {
    return {
      isSafe: false,
      riskLevel: 'HIGH',
      warning: `ATENCIÓN: La contraparte "${counterparty.alias}" está catalogada como SOSPECHOSA. ${counterparty.notes ?? ''}`,
      isThirdPartyPayment: false,
    };
  }

  // Anti-triangulation verification if payer name was supplied
  if (bankPayerName && bankPayerName.trim().length > 0) {
    const isMatch = verifyTitularMatch(counterparty.realName, bankPayerName);
    if (!isMatch) {
      return {
        isSafe: false,
        riskLevel: 'CRITICAL',
        warning: `ALERTA DE TRIANGULACIÓN (Pago de Tercero): El titular bancario transferido ("${bankPayerName}") NO coincide con el nombre verificado ("${counterparty.realName}"). Riesgo inminente de estafa o congelamiento bancario.`,
        isThirdPartyPayment: true,
      };
    }
  }

  return {
    isSafe: true,
    riskLevel: counterparty.reputation === 'TRUSTED' ? 'LOW' : 'LOW',
    isThirdPartyPayment: false,
  };
}

/**
 * Summarize trading volume and history with a given counterparty.
 */
export function computeCounterpartyMetrics(
  counterparty: Counterparty,
  allOps: readonly Operation[],
): { tradeCount: number; totalVes: number; totalUsdt: number; lastTradeDate?: string } {
  const normAlias = normalizeName(counterparty.alias);
  const normReal = normalizeName(counterparty.realName);
  const nameTokens = normReal.split(' ').filter((t) => t.length > 2);

  const matched = allOps.filter((o) => {
    if (o.counterpartyId && o.counterpartyId === counterparty.id) return true;
    if (!o.merchantNote) return false;
    const normNote = normalizeName(o.merchantNote);
    if (normNote.includes(normAlias)) return true;
    const matchedTokens = nameTokens.filter((token) => normNote.includes(token));
    return matchedTokens.length >= 2;
  });

  let totalVes = 0;
  let totalUsdt = 0;
  let lastTradeDate: string | undefined;

  for (const op of matched) {
    totalVes += op.vesAmount;
    totalUsdt += op.usdtAmount;
    if (!lastTradeDate || op.timestamp > lastTradeDate) {
      lastTradeDate = op.timestamp;
    }
  }

  return {
    tradeCount: matched.length,
    totalVes: roundMoney(totalVes, 2),
    totalUsdt: roundMoney(totalUsdt, 2),
    lastTradeDate,
  };
}
