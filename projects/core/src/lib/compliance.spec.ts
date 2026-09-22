import { describe, it, expect } from 'vitest';
import { generateComplianceStatement, type ComplianceReportMetadata } from './compliance';
import { type Operation } from './log';
import { type BankAccount } from './accounts';
import { type Counterparty } from './counterparty';

describe('Compliance and Justification Statement Engine', () => {
  const metadata: ComplianceReportMetadata = {
    operatorName: 'Inversiones Cripto C.A.',
    documentId: 'J-50123456-7',
    economicActivity: 'Intercambio y corretaje de criptoactivos en plataformas P2P',
    targetBank: 'Banesco Banco Universal',
    targetAccountNumber: '0134-0000-00-0000000000',
  };

  const accounts: BankAccount[] = [
    {
      id: 'acc-1',
      bankName: 'Banesco',
      bankCode: 'BANESCO',
      rail: 'TRANSFERENCIA',
      accountNumberMasked: '0134...0000',
      dailyLimitVes: 1000000,
      initialBalanceVes: 50000,
    },
  ];

  const counterparties: Counterparty[] = [
    {
      id: 'cp-1',
      alias: 'MerchantAlpha',
      realName: 'Carlos Mendoza',
      documentId: 'V-15888999',
      reputation: 'TRUSTED',
      createdAt: '2026-01-01',
    },
  ];

  const ops: Operation[] = [
    {
      id: 'op-1',
      timestamp: '2026-08-15T10:00:00.000Z',
      type: 'buy',
      pair: 'USDT',
      vesAmount: 80000,
      usdtAmount: 100,
      price: 800,
      merchantNote: '',
      fees: 100,
      notes: '',
      errorFree: true,
      bankAccountId: 'acc-1',
      counterpartyId: 'cp-1',
    },
    {
      id: 'op-2',
      timestamp: '2026-08-16T14:00:00.000Z',
      type: 'sell',
      pair: 'USDT',
      vesAmount: 82500,
      usdtAmount: 100,
      price: 825,
      merchantNote: '',
      fees: 0,
      notes: '',
      errorFree: true,
      bankAccountId: 'acc-1',
      counterpartyId: 'cp-1',
    },
  ];

  it('generates accurate audit totals and maps counterparties correctly', () => {
    const statement = generateComplianceStatement(ops, accounts, counterparties, metadata);

    expect(statement.totalOperations).toBe(2);
    // Egresos: 80000 + 100 = 80100
    expect(statement.totalVesEgresos).toBe(80100);
    // Ingresos: 82500
    expect(statement.totalVesIngresos).toBe(82500);
    // Net Margin: 82500 - 80100 = 2400
    expect(statement.netMarginVes).toBe(2400);

    expect(statement.records).toHaveLength(2);
    expect(statement.records[0].type).toBe('COMPRA');
    expect(statement.records[0].counterpartyAlias).toBe('MerchantAlpha');
    expect(statement.records[0].counterpartyRealName).toBe('Carlos Mendoza');
    expect(statement.records[0].counterpartyDocumentId).toBe('V-15888999');
    expect(statement.records[0].bankAccountName).toContain('Banesco');
    expect(statement.records[0].complianceVerdict).toBe('CONFORME');
  });

  it('filters by date range correctly', () => {
    const statement = generateComplianceStatement(ops, accounts, counterparties, metadata, {
      startDate: '2026-08-16',
      endDate: '2026-08-16',
    });

    expect(statement.totalOperations).toBe(1);
    expect(statement.records[0].type).toBe('VENTA');
    expect(statement.totalVesIngresos).toBe(82500);
    expect(statement.totalVesEgresos).toBe(0);
  });
});
