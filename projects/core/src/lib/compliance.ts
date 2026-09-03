/**
 * Pure compliance and bank funds justification report generation domain logic.
 * Generates audit-ready statements of crypto/fiat transactions for Venezuelan banks
 * and regulatory authorities (origin and destination of funds, counterparty traceability).
 * Framework-agnostic. No network, no Angular.
 */

import { type Operation } from './log';
import { type BankAccount } from './accounts';
import { type Counterparty } from './counterparty';
import { roundMoney } from './money';

export interface ComplianceReportMetadata {
  /** Legal name of the trading operator/entity (e.g. "Juan Carlos Pérez"). */
  operatorName: string;
  /** Legal Tax/ID (e.g. "V-18.452.123" or "J-50123456-7"). */
  documentId: string;
  /** Declared economic activity. */
  economicActivity: string;
  /** Name of the bank requesting the justification (e.g. "Banesco Banco Universal"). */
  targetBank: string;
  /** Account or phone number involved in the audit. */
  targetAccountNumber?: string;
}

export interface ComplianceFilter {
  startDate?: string;
  endDate?: string;
  bankAccountId?: string;
}

export interface ComplianceRecordItem {
  id: string;
  date: string;
  type: 'COMPRA' | 'VENTA';
  pair: string;
  vesAmount: number;
  cryptoAmount: number;
  price: number;
  feesVes: number;
  bankAccountName: string;
  counterpartyAlias: string;
  counterpartyRealName?: string;
  counterpartyDocumentId?: string;
  complianceVerdict: 'CONFORME' | 'OBSERVACIÓN';
}

export interface ComplianceStatement {
  metadata: ComplianceReportMetadata;
  period: {
    from: string;
    to: string;
  };
  totalOperations: number;
  totalVesIngresos: number;    // Venta de cripto (entradas de VES a la cuenta)
  totalVesEgresos: number;     // Compra de cripto (salidas de VES de la cuenta)
  totalCryptoIn: number;       // Cripto comprado
  totalCryptoOut: number;      // Cripto vendido
  netMarginVes: number;
  records: ComplianceRecordItem[];
  generatedAt: string;
}

/**
 * Generate an audit-ready compliance statement.
 */
export function generateComplianceStatement(
  allOps: readonly Operation[],
  accounts: readonly BankAccount[],
  counterparties: readonly Counterparty[],
  metadata: ComplianceReportMetadata,
  filter?: ComplianceFilter,
): ComplianceStatement {
  const accountsMap = new Map<string, BankAccount>(accounts.map((a) => [a.id, a]));
  const cpMap = new Map<string, Counterparty>(counterparties.map((c) => [c.id, c]));

  let filtered = [...allOps];

  if (filter?.startDate) {
    filtered = filtered.filter((o) => o.timestamp.slice(0, 10) >= filter.startDate!);
  }
  if (filter?.endDate) {
    filtered = filtered.filter((o) => o.timestamp.slice(0, 10) <= filter.endDate!);
  }
  if (filter?.bankAccountId) {
    filtered = filtered.filter((o) => o.bankAccountId === filter.bankAccountId);
  }

  // Sort chronological
  filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let totalVesIngresos = 0;
  let totalVesEgresos = 0;
  let totalCryptoIn = 0;
  let totalCryptoOut = 0;

  const records: ComplianceRecordItem[] = [];

  for (const op of filtered) {
    const isBuy = op.type === 'buy';
    if (isBuy) {
      totalVesEgresos += op.vesAmount + op.fees;
      totalCryptoIn += op.usdtAmount;
    } else {
      totalVesIngresos += op.vesAmount;
      totalCryptoOut += op.usdtAmount;
    }

    const acc = op.bankAccountId ? accountsMap.get(op.bankAccountId) : undefined;
    const cp = op.counterpartyId ? cpMap.get(op.counterpartyId) : undefined;

    records.push({
      id: op.id,
      date: op.timestamp.slice(0, 19).replace('T', ' '),
      type: isBuy ? 'COMPRA' : 'VENTA',
      pair: op.pair,
      vesAmount: roundMoney(op.vesAmount, 2),
      cryptoAmount: roundMoney(op.usdtAmount, 4),
      price: roundMoney(op.price, 2),
      feesVes: roundMoney(op.fees, 2),
      bankAccountName: acc ? `${acc.bankName} (${acc.rail})` : 'No asignada',
      counterpartyAlias: cp ? cp.alias : (op.merchantNote || 'Desconocido'),
      counterpartyRealName: cp?.realName,
      counterpartyDocumentId: cp?.documentId,
      complianceVerdict: op.errorFree ? 'CONFORME' : 'OBSERVACIÓN',
    });
  }

  const from = filtered[0]?.timestamp.slice(0, 10) ?? filter?.startDate ?? new Date().toISOString().slice(0, 10);
  const to = filtered[filtered.length - 1]?.timestamp.slice(0, 10) ?? filter?.endDate ?? from;

  return {
    metadata,
    period: { from, to },
    totalOperations: filtered.length,
    totalVesIngresos: roundMoney(totalVesIngresos, 2),
    totalVesEgresos: roundMoney(totalVesEgresos, 2),
    totalCryptoIn: roundMoney(totalCryptoIn, 4),
    totalCryptoOut: roundMoney(totalCryptoOut, 4),
    netMarginVes: roundMoney(totalVesIngresos - totalVesEgresos, 2),
    records,
    generatedAt: new Date().toISOString(),
  };
}
