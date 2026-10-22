import { describe, it, expect } from 'vitest';
import {
  compileLiveDeskState,
  verifyReferenceCollision,
  calculateBankReconciliationAdjustment,
  calculateDirectCommercialQuote,
  buildClientWhatsAppStatement,
  createFinance360ProfitSettlement,
  normalizeBankReference,
  type OperationalBankAccount,
  type RealTimeTradeEntry,
  type CrmContactLedger,
  type DailyNetProfitTransferPayload,
} from './client-compliance-intelligence';

describe('Client Compliance Intelligence & Dual-Ledger Core Engine', () => {
  const mockNow = new Date('2026-10-21T14:30:00Z').getTime();

  describe('Zero-Seed and Clean Data Policy', () => {
    it('initializes cleanly in zero state when trades, banks and contacts are empty', () => {
      const state = compileLiveDeskState([], [], [], 'P2P_DESK', mockNow);

      expect(state.activeScope).toBe('P2P_DESK');
      expect(state.filteredTrades).toEqual([]);
      expect(state.todayTrades).toEqual([]);
      expect(state.kpis.todayNetPnlUsdt).toBe(0);
      expect(state.kpis.todayVolumeUsdt).toBe(0);
      expect(state.kpis.todayFrictionUsdt).toBe(0);
      expect(state.kpis.spreadEfficiencyPct).toBe(0);
      expect(state.kpis.totalTradesCount).toBe(0);
      expect(state.svgPath).toBe('');
      expect(state.svgPoints).toEqual([]);
      expect(state.bankTelemetry).toEqual([]);
      expect(state.recommendedBankId).toBeNull();
      expect(state.contacts).toEqual([]);
    });

    it('produces empty SVG path and no NaN coordinates when no trades occurred today', () => {
      const yesterday = mockNow - 24 * 60 * 60 * 1000;
      const oldTrade: RealTimeTradeEntry = {
        id: 'T-OLD',
        timestamp: yesterday,
        scope: 'P2P_DESK',
        clientId: 'C-1',
        clientName: 'Cliente Viejo',
        clientDocId: 'V-12345',
        bankAccountId: 'B-1',
        bankName: 'Banesco',
        bankReferenceId: 'REF-100',
        fiatCurrency: 'VES',
        fiatAmount: 1000,
        cryptoAmountUsdt: 20,
        appliedRate: 50,
        replacementRate: 48,
        netPnlUsdt: 0.8,
        frictionFiat: 5,
      };

      const state = compileLiveDeskState([oldTrade], [], [], 'P2P_DESK', mockNow);
      expect(state.todayTrades).toHaveLength(0);
      expect(state.svgPath).toBe('');
      expect(state.kpis.todayNetPnlUsdt).toBe(0);
    });
  });

  describe('Strict Dual-Ledger Isolation (P2P_DESK vs FINANCE_360)', () => {
    const p2pBank: OperationalBankAccount = {
      id: 'B-P2P',
      scope: 'P2P_DESK',
      bankName: 'Banesco Pago Móvil P2P',
      currency: 'VES',
      holderDetails: { documentId: 'V-1', phone: '04141', accountNumber: '0134', holderName: 'Operador' },
      currentBalanceFiat: 50000,
      maxDailyCapFiat: 100000,
      feePct: 0.3,
      maxBurstTxPer15Min: 5,
    };

    const fin360Bank: OperationalBankAccount = {
      id: 'B-FIN360',
      scope: 'FINANCE_360',
      bankName: 'Mercantil Cuenta PYME',
      currency: 'VES',
      holderDetails: { documentId: 'J-2', phone: '04122', accountNumber: '0105', holderName: 'Empresa C.A.' },
      currentBalanceFiat: 120000,
      maxDailyCapFiat: 500000,
      feePct: 0,
      maxBurstTxPer15Min: 20,
    };

    const p2pTrade: RealTimeTradeEntry = {
      id: 'T-P2P',
      timestamp: mockNow - 1000 * 60 * 10,
      scope: 'P2P_DESK',
      clientId: 'CLI-P2P',
      clientName: 'Comprador Binance',
      clientDocId: 'V-999',
      bankAccountId: 'B-P2P',
      bankName: 'Banesco',
      bankReferenceId: 'REF-P2P-1',
      fiatCurrency: 'VES',
      fiatAmount: 42000,
      cryptoAmountUsdt: 1000,
      appliedRate: 42,
      replacementRate: 41,
      netPnlUsdt: 23.8,
      frictionFiat: 10,
    };

    const fin360Trade: RealTimeTradeEntry = {
      id: 'T-FIN360',
      timestamp: mockNow - 1000 * 60 * 5,
      scope: 'FINANCE_360',
      clientId: 'CLI-PROV',
      clientName: 'Proveedor Local',
      clientDocId: 'J-888',
      bankAccountId: 'B-FIN360',
      bankName: 'Mercantil',
      bankReferenceId: 'REF-FIN-1',
      fiatCurrency: 'VES',
      fiatAmount: 85000,
      cryptoAmountUsdt: 2000,
      appliedRate: 42.5,
      replacementRate: 42.5,
      netPnlUsdt: 0,
      frictionFiat: 0,
    };

    it('isolates P2P_DESK from FINANCE_360 banks and transactions', () => {
      const p2pState = compileLiveDeskState(
        [p2pTrade, fin360Trade],
        [p2pBank, fin360Bank],
        [],
        'P2P_DESK',
        mockNow,
      );

      expect(p2pState.filteredTrades).toHaveLength(1);
      expect(p2pState.filteredTrades[0].id).toBe('T-P2P');
      expect(p2pState.bankTelemetry).toHaveLength(1);
      expect(p2pState.bankTelemetry[0].bankAccountId).toBe('B-P2P');
      expect(p2pState.kpis.todayNetPnlUsdt).toBe(23.8);
      expect(p2pState.kpis.todayVolumeUsdt).toBe(1000);
    });

    it('isolates FINANCE_360 from P2P_DESK banks and transactions', () => {
      const finState = compileLiveDeskState(
        [p2pTrade, fin360Trade],
        [p2pBank, fin360Bank],
        [],
        'FINANCE_360',
        mockNow,
      );

      expect(finState.filteredTrades).toHaveLength(1);
      expect(finState.filteredTrades[0].id).toBe('T-FIN360');
      expect(finState.bankTelemetry).toHaveLength(1);
      expect(finState.bankTelemetry[0].bankAccountId).toBe('B-FIN360');
      expect(finState.kpis.todayNetPnlUsdt).toBe(0);
      expect(finState.kpis.todayVolumeUsdt).toBe(2000);
    });
  });

  describe('Anti-Fraud Reference Collision Verification', () => {
    const existingTrades: RealTimeTradeEntry[] = [
      {
        id: 'T-1',
        timestamp: mockNow,
        scope: 'P2P_DESK',
        clientId: 'C-1',
        clientName: 'Juan Perez',
        clientDocId: 'V-100',
        bankAccountId: 'B-1',
        bankName: 'Banesco',
        bankReferenceId: 'BAN-884920',
        fiatCurrency: 'VES',
        fiatAmount: 5000,
        cryptoAmountUsdt: 100,
        appliedRate: 50,
        replacementRate: 49,
        netPnlUsdt: 2,
        frictionFiat: 0,
      },
    ];

    it('normalizes references cleanly ignoring spaces and lowercase', () => {
      expect(normalizeBankReference(' ban-884920 ')).toBe('BAN-884920');
      expect(normalizeBankReference('123 456 789')).toBe('123456789');
      expect(normalizeBankReference(null)).toBe('');
    });

    it('detects duplicate reference collision accurately', () => {
      const check = verifyReferenceCollision(existingTrades, ' ban-884920 ');
      expect(check.isDuplicate).toBe(true);
      expect(check.existingEntry?.id).toBe('T-1');
    });

    it('allows clean new unused references', () => {
      const check = verifyReferenceCollision(existingTrades, 'BAN-999999');
      expect(check.isDuplicate).toBe(false);
      expect(check.existingEntry).toBeNull();
    });

    it('safely handles empty or whitespace input without false alarms', () => {
      expect(verifyReferenceCollision(existingTrades, '').isDuplicate).toBe(false);
      expect(verifyReferenceCollision(existingTrades, '   ').isDuplicate).toBe(false);
      expect(verifyReferenceCollision(existingTrades, null).isDuplicate).toBe(false);
    });
  });

  describe('Bank Telemetry, Burst Cooldown and Smart Recommendation', () => {
    const bankA: OperationalBankAccount = {
      id: 'BANK-A',
      scope: 'P2P_DESK',
      bankName: 'Banco A',
      currency: 'VES',
      holderDetails: { documentId: 'V-1', phone: '0414', accountNumber: '001', holderName: 'Titular' },
      currentBalanceFiat: 10000,
      maxDailyCapFiat: 100000,
      feePct: 0.3,
      maxBurstTxPer15Min: 3,
    };

    const bankB: OperationalBankAccount = {
      id: 'BANK-B',
      scope: 'P2P_DESK',
      bankName: 'Banco B',
      currency: 'VES',
      holderDetails: { documentId: 'V-2', phone: '0416', accountNumber: '002', holderName: 'Titular' },
      currentBalanceFiat: 30000,
      maxDailyCapFiat: 100000,
      feePct: 0.3,
      maxBurstTxPer15Min: 10,
    };

    it('triggers COOLDOWN_BURST when 15-minute transactions reach threshold', () => {
      const burstTrades: RealTimeTradeEntry[] = [
        { id: 'T-1', timestamp: mockNow - 1000 * 60 * 2, scope: 'P2P_DESK', clientId: 'C', clientName: 'C', clientDocId: 'D', bankAccountId: 'BANK-A', bankName: 'Banco A', bankReferenceId: 'R1', fiatCurrency: 'VES', fiatAmount: 1000, cryptoAmountUsdt: 20, appliedRate: 50, replacementRate: 49, netPnlUsdt: 0.4, frictionFiat: 0 },
        { id: 'T-2', timestamp: mockNow - 1000 * 60 * 5, scope: 'P2P_DESK', clientId: 'C', clientName: 'C', clientDocId: 'D', bankAccountId: 'BANK-A', bankName: 'Banco A', bankReferenceId: 'R2', fiatCurrency: 'VES', fiatAmount: 1000, cryptoAmountUsdt: 20, appliedRate: 50, replacementRate: 49, netPnlUsdt: 0.4, frictionFiat: 0 },
        { id: 'T-3', timestamp: mockNow - 1000 * 60 * 10, scope: 'P2P_DESK', clientId: 'C', clientName: 'C', clientDocId: 'D', bankAccountId: 'BANK-A', bankName: 'Banco A', bankReferenceId: 'R3', fiatCurrency: 'VES', fiatAmount: 1000, cryptoAmountUsdt: 20, appliedRate: 50, replacementRate: 49, netPnlUsdt: 0.4, frictionFiat: 0 },
      ];

      const state = compileLiveDeskState(burstTrades, [bankA, bankB], [], 'P2P_DESK', mockNow);
      const teleA = state.bankTelemetry.find((b) => b.bankAccountId === 'BANK-A');
      const teleB = state.bankTelemetry.find((b) => b.bankAccountId === 'BANK-B');

      expect(teleA?.recent15MinTxCount).toBe(3);
      expect(teleA?.status).toBe('COOLDOWN_BURST');
      expect(teleB?.status).toBe('AVAILABLE');
      expect(state.recommendedBankId).toBe('BANK-B');
    });

    it('triggers DAILY_CAP_REACHED when daily fiat usage reaches or exceeds limit', () => {
      const capTrade: RealTimeTradeEntry = {
        id: 'T-CAP',
        timestamp: mockNow - 1000 * 60 * 30, // 30 min ago (today)
        scope: 'P2P_DESK',
        clientId: 'C',
        clientName: 'C',
        clientDocId: 'D',
        bankAccountId: 'BANK-A',
        bankName: 'Banco A',
        bankReferenceId: 'R-CAP',
        fiatCurrency: 'VES',
        fiatAmount: 105000, // exceeds 100,000 cap
        cryptoAmountUsdt: 2100,
        appliedRate: 50,
        replacementRate: 49,
        netPnlUsdt: 42,
        frictionFiat: 0,
      };

      const state = compileLiveDeskState([capTrade], [bankA], [], 'P2P_DESK', mockNow);
      const teleA = state.bankTelemetry.find((b) => b.bankAccountId === 'BANK-A');

      expect(teleA?.status).toBe('DAILY_CAP_REACHED');
      expect(teleA?.dailyUsagePct).toBe(105);
      expect(state.recommendedBankId).toBeNull();
    });
  });

  describe('Bank Balance Reconciliation Adjustment', () => {
    it('detects surplus drift when phone balance is higher than system ledger', () => {
      const res = calculateBankReconciliationAdjustment(10000, 10550.5);
      expect(res.driftFiat).toBe(550.5);
      expect(res.isBalanced).toBe(false);
      expect(res.adjustmentType).toBe('SURPLUS');
      expect(res.formattedDrift).toBe('+550.50');
    });

    it('detects deficit drift when phone balance is lower than system ledger', () => {
      const res = calculateBankReconciliationAdjustment(10000, 9850);
      expect(res.driftFiat).toBe(-150);
      expect(res.isBalanced).toBe(false);
      expect(res.adjustmentType).toBe('DEFICIT');
      expect(res.formattedDrift).toBe('-150.00');
    });

    it('detects balanced state when difference is under 1 cent', () => {
      const res = calculateBankReconciliationAdjustment(5000, 5000.004);
      expect(res.isBalanced).toBe(true);
      expect(res.adjustmentType).toBe('BALANCED');
    });
  });

  describe('Direct Commercial Quote Calculator', () => {
    it('calculates total fiat to collect and net profit USDT without jargon', () => {
      // 1000 USDT, Operator replacement at 82.00 VES, Sells to client at 84.50 VES, Bank fee 0.3%
      const quote = calculateDirectCommercialQuote(1000, 82.0, 84.5, 0.3);

      expect(quote.totalFiatToCollect).toBe(84500); // 1000 * 84.5
      // Bank fee: 84500 * 0.003 = 253.5 VES
      // Net fiat: 84500 - 253.5 - (1000 * 82) = 84246.5 - 82000 = 2246.5 VES
      // Profit USDT: 2246.5 / 82 = 27.40 USDT
      expect(quote.netProfitUsdt).toBe(27.4);
      expect(quote.marginPct).toBe(2.75); // (84.5 - 82) / 82 * 100 - 0.3 = 3.05 - 0.3 = 2.75%
      expect(quote.effectiveSpreadFiat).toBe(2.5);
    });

    it('returns zero safely for negative or zero amounts', () => {
      const quote = calculateDirectCommercialQuote(0, 82, 84);
      expect(quote.totalFiatToCollect).toBe(0);
      expect(quote.netProfitUsdt).toBe(0);
      expect(quote.marginPct).toBe(0);
    });
  });

  describe('Client WhatsApp Statement Builder (Zero Profit Leakage)', () => {
    const contact: CrmContactLedger = {
      clientId: 'CLI-01',
      scope: 'P2P_DESK',
      clientName: 'Distribuidora Los Andes',
      clientDocId: 'J-31002991-0',
      category: 'VIP_OTC',
      pendingBalanceUsdt: 150.0,
      pendingBalanceFiat: 12300.0,
      lifetimeVolumeUsdt: 15000.0,
      lifetimeNetPnlUsdt: 420.0,
      verifiedReferences: ['REF-9921', 'REF-9922'],
      lastActivityTimestamp: mockNow,
    };

    const trade: RealTimeTradeEntry = {
      id: 'T-CLI-1',
      timestamp: mockNow,
      scope: 'P2P_DESK',
      clientId: 'CLI-01',
      clientName: 'Distribuidora Los Andes',
      clientDocId: 'J-31002991-0',
      bankAccountId: 'B-1',
      bankName: 'Banesco',
      bankReferenceId: 'REF-9922',
      fiatCurrency: 'VES',
      fiatAmount: 82000,
      cryptoAmountUsdt: 1000,
      appliedRate: 82.0,
      replacementRate: 80.5,
      netPnlUsdt: 18.29,
      frictionFiat: 0,
    };

    it('generates statement WITHOUT leaking internal profit when includeInternalProfit is false', () => {
      const statement = buildClientWhatsAppStatement(contact, [trade], false);

      expect(statement).toContain('Distribuidora Los Andes');
      expect(statement).toContain('J-31002991-0');
      expect(statement).toContain('A FAVOR DEL CLIENTE (+150.00 USDT)');
      expect(statement).toContain('REF-9922');
      expect(statement).not.toContain('Margen Generado');
      expect(statement).not.toContain('80.5'); // replacement rate must NOT leak
      expect(statement).not.toContain('18.29'); // internal PnL must NOT leak
    });

    it('includes internal profit line ONLY when explicitly authorized for internal audit', () => {
      const statement = buildClientWhatsAppStatement(contact, [trade], true);
      expect(statement).toContain('Margen Generado (Auditoría Interna)');
      expect(statement).toContain('+420.00 USDT');
    });
  });

  describe('Finance 360 Daily Net Profit Settlement Bridge', () => {
    const todayTrades: RealTimeTradeEntry[] = [
      {
        id: 'T-1',
        timestamp: mockNow,
        scope: 'P2P_DESK',
        clientId: 'C-1',
        clientName: 'C1',
        clientDocId: 'D1',
        bankAccountId: 'B1',
        bankName: 'B1',
        bankReferenceId: 'R1',
        fiatCurrency: 'VES',
        fiatAmount: 41000,
        cryptoAmountUsdt: 1000,
        appliedRate: 41,
        replacementRate: 40,
        netPnlUsdt: 24.39,
        frictionFiat: 0,
      },
    ];

    it('creates settlement payload successfully when positive profit exists', () => {
      const dateIso = '2026-10-21';
      const res = createFinance360ProfitSettlement(todayTrades, dateIso, []);

      expect(res.success).toBe(true);
      expect(res.payload?.settlementId).toBe('SETTLE-2026-10-21');
      expect(res.payload?.netProfitUsdt).toBe(24.39);
      expect(res.payload?.tradesCount).toBe(1);
    });

    it('enforces idempotency and prevents duplicate transfer for the same date', () => {
      const dateIso = '2026-10-21';
      const existing: DailyNetProfitTransferPayload[] = [
        {
          settlementId: 'SETTLE-2026-10-21',
          dateIso: '2026-10-21',
          netProfitUsdt: 24.39,
          tradesCount: 1,
          timestamp: mockNow - 1000,
        },
      ];

      const res = createFinance360ProfitSettlement(todayTrades, dateIso, existing);
      expect(res.success).toBe(false);
      expect(res.error).toBe('SETTLEMENT_ALREADY_EXISTS');
      expect(res.payload).toBeNull();
    });

    it('rejects settlement when net profit is zero or negative', () => {
      const losingTrade: RealTimeTradeEntry = {
        id: 'T-LOSS',
        timestamp: mockNow,
        scope: 'P2P_DESK',
        clientId: 'C',
        clientName: 'C',
        clientDocId: 'D',
        bankAccountId: 'B',
        bankName: 'B',
        bankReferenceId: 'R',
        fiatCurrency: 'VES',
        fiatAmount: 40000,
        cryptoAmountUsdt: 1000,
        appliedRate: 40,
        replacementRate: 41,
        netPnlUsdt: -24.39,
        frictionFiat: 0,
      };

      const res = createFinance360ProfitSettlement([losingTrade], '2026-10-21', []);
      expect(res.success).toBe(false);
      expect(res.error).toBe('NO_POSITIVE_PROFIT_TO_TRANSFER');
      expect(res.payload).toBeNull();
    });
  });
});
