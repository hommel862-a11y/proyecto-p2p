import { describe, it, expect } from 'vitest';
import {
  compileCrmWorkspaceState,
  transitionDealStage,
  checkCounterpartyExposure,
  parseBankSmsClipboard,
  verifyReferenceCollision,
  calculateDirectQuote,
  buildContactWhatsAppReceipt,
  createDailyProfitSettlementForFinance360,
  calculateBankReconciliationAdjustment,
  normalizeBankReference,
  validateAndSanitizeCrmBackupPayload,
  safeHydrateCrmCollection,
  serializeContactsToCsv,
  parseAndValidateContactsCsv,
  serializeBanksToCsv,
  parseAndValidateBanksCsv,
  serializeActivitiesToCsv,
  parseAndValidateActivitiesCsv,
  reconcileCrmCollectionById,
  CRM_STORAGE_KEYS,
  type PipelineDeal,
  type CrmContact,
  type CrmBankAccount,
  type ActivityLogEntry,
  type DailyNetProfitTransferPayload,
} from './client-compliance-intelligence';

describe('Client Compliance & CRM Pipeline Intelligence Engine', () => {
  const mockNow = new Date('2026-10-22T14:30:00Z').getTime();

  const sampleContact: CrmContact = {
    id: 'cli-001',
    scope: 'P2P_DESK',
    name: 'Carlos Mendoza VIP',
    documentId: 'V-19876543',
    phoneOrContact: '+584141234567',
    category: 'VIP_OTC',
    paymentDetailsText: 'Pago Móvil Banesco 04141234567 V19876543',
    creditLimitUsdt: 10000,
    pendingBalanceUsdt: 250,
    maxPendingExposureUsdt: 5000,
    isDebtIndexedToUsdt: true,
    verifiedReferences: ['REF-884920'],
    createdAt: mockNow - 86400000,
  };

  const sampleBank: CrmBankAccount = {
    id: 'bnk-banesco-01',
    scope: 'P2P_DESK',
    bankName: 'Banesco Pago Móvil',
    currency: 'VES',
    holderDetailsText: 'Titular: Inversiones Skalix C.A. RIF J-50001234',
    currentBalanceFiat: 45000,
    maxDailyCapFiat: 100000,
    feePct: 0.3,
    maxBurstTxPer15Min: 5,
  };

  describe('Zero-Seed Policy & Clean State', () => {
    it('initializes completely at 0.00 when all arrays are empty', () => {
      const state = compileCrmWorkspaceState([], [], [], [], 'P2P_DESK', 80, mockNow);

      expect(state.deals).toEqual([]);
      expect(state.contacts).toEqual([]);
      expect(state.bankTelemetry).toEqual([]);
      expect(state.activities).toEqual([]);
      expect(state.kpis.closedNetProfitTodayUsdt).toBe(0);
      expect(state.kpis.closedVolumeTodayUsdt).toBe(0);
      expect(state.kpis.inTransitVolumeUsdt).toBe(0);
      expect(state.kpis.totalReceivablesUsdt).toBe(0);
      expect(state.kpis.totalPayablesUsdt).toBe(0);
      expect(state.kpis.spreadEfficiencyPct).toBe(0);
      expect(state.svgPath).toBe('');
      expect(state.recommendedBankId).toBeNull();
    });

    it('isolates strictly between P2P_DESK and FINANCE_360', () => {
      const dealP2p: PipelineDeal = {
        id: 'deal-p2p-1',
        scope: 'P2P_DESK',
        title: 'Venta USDT Arbitraje',
        contactId: 'cli-001',
        contactName: 'Carlos VIP',
        bankAccountId: 'bnk-banesco-01',
        bankName: 'Banesco',
        stage: 'STAGE_4_CLOSED',
        fiatCurrency: 'VES',
        cryptoAmountUsdt: 1000,
        appliedRate: 85,
        replacementRate: 82,
        totalFiatAmount: 85000,
        paidFiatAmount: 85000,
        netProfitUsdt: 35.29,
        bankReferenceId: 'REF-112233',
        quoteTtlMinutes: 15,
        quotedAt: mockNow - 600000,
        isRateExpired: false,
        timeline: [],
        createdAt: mockNow - 600000,
        closedAt: mockNow - 100000,
      };

      const dealFin360: PipelineDeal = {
        ...dealP2p,
        id: 'deal-fin-1',
        scope: 'FINANCE_360',
        title: 'Pago Proveedor Mercancía',
        netProfitUsdt: 0,
      };

      const stateP2p = compileCrmWorkspaceState([dealP2p, dealFin360], [], [], [], 'P2P_DESK', 82, mockNow);
      expect(stateP2p.deals.length).toBe(1);
      expect(stateP2p.deals[0].id).toBe('deal-p2p-1');
      expect(stateP2p.kpis.closedNetProfitTodayUsdt).toBe(35.29);

      const stateFin = compileCrmWorkspaceState([dealP2p, dealFin360], [], [], [], 'FINANCE_360', 82, mockNow);
      expect(stateFin.deals.length).toBe(1);
      expect(stateFin.deals[0].id).toBe('deal-fin-1');
      expect(stateFin.kpis.closedNetProfitTodayUsdt).toBe(0);
    });
  });

  describe('Bank Shield Capacity Reservation & Burst Protection', () => {
    it('reserves bank capacity when deals are in STAGE_2_TRANSIT or STAGE_3_VERIFY', () => {
      const transitDeal: PipelineDeal = {
        id: 'deal-transit-1',
        scope: 'P2P_DESK',
        title: 'Compra en tránsito',
        contactId: 'cli-001',
        contactName: 'Carlos VIP',
        bankAccountId: 'bnk-banesco-01',
        bankName: 'Banesco',
        stage: 'STAGE_2_TRANSIT',
        fiatCurrency: 'VES',
        cryptoAmountUsdt: 500,
        appliedRate: 80,
        replacementRate: 78,
        totalFiatAmount: 40000,
        paidFiatAmount: 0,
        netProfitUsdt: 12.5,
        bankReferenceId: '',
        quoteTtlMinutes: 15,
        quotedAt: mockNow - 300000,
        isRateExpired: false,
        timeline: [],
        createdAt: mockNow - 300000,
        closedAt: null,
      };

      const state = compileCrmWorkspaceState(
        [transitDeal],
        [sampleContact],
        [sampleBank],
        [],
        'P2P_DESK',
        78,
        mockNow,
      );

      expect(state.kpis.inTransitVolumeUsdt).toBe(500);
      expect(state.kpis.closedVolumeTodayUsdt).toBe(0);

      const telemetry = state.bankTelemetry[0];
      expect(telemetry.dailyInTransitFiat).toBe(40000);
      expect(telemetry.dailyClosedFiat).toBe(0);
      expect(telemetry.dailyTotalUsedFiat).toBe(40000);
      expect(telemetry.dailyUsagePct).toBe(40);
      expect(telemetry.status).toBe('AVAILABLE');
    });

    it('triggers burst cooldown when exceeding maxBurstTxPer15Min', () => {
      const burstDeals: PipelineDeal[] = Array.from({ length: 6 }).map((_, i) => ({
        id: `deal-burst-${i}`,
        scope: 'P2P_DESK',
        title: `Ráfaga ${i}`,
        contactId: 'cli-001',
        contactName: 'Carlos VIP',
        bankAccountId: 'bnk-banesco-01',
        bankName: 'Banesco',
        stage: 'STAGE_2_TRANSIT',
        fiatCurrency: 'VES',
        cryptoAmountUsdt: 50,
        appliedRate: 80,
        replacementRate: 78,
        totalFiatAmount: 4000,
        paidFiatAmount: 0,
        netProfitUsdt: 1,
        bankReferenceId: '',
        quoteTtlMinutes: 15,
        quotedAt: mockNow - (i * 60000),
        isRateExpired: false,
        timeline: [],
        createdAt: mockNow - (i * 60000),
        closedAt: null,
      }));

      const state = compileCrmWorkspaceState(
        burstDeals,
        [sampleContact],
        [sampleBank],
        [],
        'P2P_DESK',
        78,
        mockNow,
      );

      const telemetry = state.bankTelemetry[0];
      expect(telemetry.recent15MinTxCount).toBe(6);
      expect(telemetry.status).toBe('COOLDOWN_BURST');
    });
  });

  describe('Counterparty Exposure & TTL Slippage Protection', () => {
    it('blocks adding a deal when exceeding counterparty pending exposure limit', () => {
      const activeDeals: PipelineDeal[] = [
        {
          id: 'deal-active-1',
          scope: 'P2P_DESK',
          title: 'Orden en curso',
          contactId: 'cli-001',
          contactName: 'Carlos VIP',
          bankAccountId: 'bnk-banesco-01',
          bankName: 'Banesco',
          stage: 'STAGE_2_TRANSIT',
          fiatCurrency: 'VES',
          cryptoAmountUsdt: 4000,
          appliedRate: 80,
          replacementRate: 78,
          totalFiatAmount: 320000,
          paidFiatAmount: 0,
          netProfitUsdt: 100,
          bankReferenceId: '',
          quoteTtlMinutes: 15,
          quotedAt: mockNow,
          isRateExpired: false,
          timeline: [],
          createdAt: mockNow,
          closedAt: null,
        },
      ];

      // Limit is 5000, current exposure is 4000.
      const checkValid = checkCounterpartyExposure(sampleContact, activeDeals, 800);
      expect(checkValid.allowed).toBe(true);

      const checkExcess = checkCounterpartyExposure(sampleContact, activeDeals, 1500);
      expect(checkExcess.allowed).toBe(false);
      expect(checkExcess.currentExposureUsdt).toBe(4000);
      expect(checkExcess.limitUsdt).toBe(5000);
    });

    it('detects rate expiration when quote TTL has elapsed', () => {
      const expiredDeal: PipelineDeal = {
        id: 'deal-quoted-1',
        scope: 'P2P_DESK',
        title: 'Cotización vieja',
        contactId: 'cli-001',
        contactName: 'Carlos VIP',
        bankAccountId: 'bnk-banesco-01',
        bankName: 'Banesco',
        stage: 'STAGE_1_NEW',
        fiatCurrency: 'VES',
        cryptoAmountUsdt: 1000,
        appliedRate: 80,
        replacementRate: 78,
        totalFiatAmount: 80000,
        paidFiatAmount: 0,
        netProfitUsdt: 25,
        bankReferenceId: '',
        quoteTtlMinutes: 15,
        quotedAt: mockNow - (20 * 60 * 1000), // 20 min ago
        isRateExpired: false,
        timeline: [],
        createdAt: mockNow - (20 * 60 * 1000),
        closedAt: null,
      };

      const result = transitionDealStage(expiredDeal, 'STAGE_2_TRANSIT', '', mockNow);
      expect(result.updatedDeal.isRateExpired).toBe(true);
    });

    it('requires reference when transitioning to STAGE_4_CLOSED', () => {
      const deal: PipelineDeal = {
        id: 'deal-to-close',
        scope: 'P2P_DESK',
        title: 'Por cerrar',
        contactId: 'cli-001',
        contactName: 'Carlos VIP',
        bankAccountId: 'bnk-banesco-01',
        bankName: 'Banesco',
        stage: 'STAGE_3_VERIFY',
        fiatCurrency: 'VES',
        cryptoAmountUsdt: 1000,
        appliedRate: 80,
        replacementRate: 78,
        totalFiatAmount: 80000,
        paidFiatAmount: 80000,
        netProfitUsdt: 25,
        bankReferenceId: '',
        quoteTtlMinutes: 15,
        quotedAt: mockNow,
        isRateExpired: false,
        timeline: [],
        createdAt: mockNow,
        closedAt: null,
      };

      const fail = transitionDealStage(deal, 'STAGE_4_CLOSED', '', mockNow);
      expect(fail.success).toBe(false);
      expect(fail.requiresReference).toBe(true);

      const ok = transitionDealStage(deal, 'STAGE_4_CLOSED', 'REF-998877', mockNow);
      expect(ok.success).toBe(true);
      expect(ok.updatedDeal.stage).toBe('STAGE_4_CLOSED');
      expect(ok.updatedDeal.bankReferenceId).toBe('REF-998877');
      expect(ok.updatedDeal.closedAt).toBe(mockNow);
    });
  });

  describe('Anti-Fraud Reference Collision & Clipboard Parser', () => {
    it('detects duplicate reference collision accurately', () => {
      const deals: PipelineDeal[] = [
        {
          id: 'deal-101',
          scope: 'P2P_DESK',
          title: 'Trade existoso',
          contactId: 'cli-001',
          contactName: 'Carlos',
          bankAccountId: 'bnk-1',
          bankName: 'Banesco',
          stage: 'STAGE_4_CLOSED',
          fiatCurrency: 'VES',
          cryptoAmountUsdt: 500,
          appliedRate: 80,
          replacementRate: 78,
          totalFiatAmount: 40000,
          paidFiatAmount: 40000,
          netProfitUsdt: 12.5,
          bankReferenceId: 'BAN-98765432',
          quoteTtlMinutes: 15,
          quotedAt: mockNow,
          isRateExpired: false,
          timeline: [],
          createdAt: mockNow,
          closedAt: mockNow,
        },
      ];

      expect(verifyReferenceCollision(deals, 'ban-98765432').isDuplicate).toBe(true);
      expect(verifyReferenceCollision(deals, 'BAN 9876 5432').isDuplicate).toBe(true);
      expect(verifyReferenceCollision(deals, 'REF-TOTALMENTE-NUEVA').isDuplicate).toBe(false);
      expect(verifyReferenceCollision(deals, 'ban-98765432', 'deal-101').isDuplicate).toBe(false);
    });

    it('parses bank SMS clipboard receipts correctly', () => {
      const sms1 = 'Banesco Pago Movil: Aprobado por Bs. 85.000,00 a Inversiones Skalix. Ref: 45981203';
      const parsed1 = parseBankSmsClipboard(sms1);
      expect(parsed1.detectedBank).toBe('Banesco');
      expect(parsed1.referenceId).toBe('45981203');
      expect(parsed1.amountFiat).toBe(85000);
      expect(parsed1.currency).toBe('VES');

      const sms2 = 'Bancolombia le informa transferencia recibida por $ 1.500.000 Comprobante: 77889900';
      const parsed2 = parseBankSmsClipboard(sms2);
      expect(parsed2.detectedBank).toBe('Bancolombia');
      expect(parsed2.referenceId).toBe('77889900');
      expect(parsed2.amountFiat).toBe(1500000);
      expect(parsed2.currency).toBe('COP');

      const sms3 = 'BANESCO: Pago Movil recibido de Alejandro Magno CI 19888777 por Bs. 82.000,00 Ref: 55443322';
      const parsed3 = parseBankSmsClipboard(sms3);
      expect(parsed3.detectedBank).toBe('Banesco');
      expect(parsed3.referenceId).toBe('55443322');
      expect(parsed3.amountFiat).toBe(82000);
      expect(parsed3.currency).toBe('VES');
    });
  });

  describe('WhatsApp Statement & Finance 360 Bridge', () => {
    it('generates WhatsApp statement without leaking internal operator profit', () => {
      const closedDeal: PipelineDeal = {
        id: 'deal-wa',
        scope: 'P2P_DESK',
        title: 'Venta',
        contactId: sampleContact.id,
        contactName: sampleContact.name,
        bankAccountId: 'bnk-1',
        bankName: 'Banesco',
        stage: 'STAGE_4_CLOSED',
        fiatCurrency: 'VES',
        cryptoAmountUsdt: 1000,
        appliedRate: 85,
        replacementRate: 82,
        totalFiatAmount: 85000,
        paidFiatAmount: 85000,
        netProfitUsdt: 35.29,
        bankReferenceId: 'REF-771122',
        quoteTtlMinutes: 15,
        quotedAt: mockNow,
        isRateExpired: false,
        timeline: [],
        createdAt: mockNow,
        closedAt: mockNow,
      };

      const statement = buildContactWhatsAppReceipt(sampleContact, [closedDeal]);

      expect(statement).toContain('CARLOS MENDOZA VIP');
      expect(statement).toContain('REF-771122');
      expect(statement).toContain('1000.00 USDT @ 85.00');
      expect(statement).not.toContain('35.29'); // Internal profit MUST NOT be leaked
      expect(statement).not.toContain('replacementRate');
      expect(statement).not.toContain('82.00');
    });

    it('creates idempotent daily profit settlement for Finance 360', () => {
      const closedDeals: PipelineDeal[] = [
        {
          id: 'deal-bridge-1',
          scope: 'P2P_DESK',
          title: 'Op 1',
          contactId: 'cli-1',
          contactName: 'Cliente A',
          bankAccountId: 'bnk-1',
          bankName: 'Banesco',
          stage: 'STAGE_4_CLOSED',
          fiatCurrency: 'VES',
          cryptoAmountUsdt: 1000,
          appliedRate: 85,
          replacementRate: 82,
          totalFiatAmount: 85000,
          paidFiatAmount: 85000,
          netProfitUsdt: 35.0,
          bankReferenceId: 'REF-1',
          quoteTtlMinutes: 15,
          quotedAt: new Date('2026-10-22T10:00:00Z').getTime(),
          isRateExpired: false,
          timeline: [],
          createdAt: new Date('2026-10-22T10:00:00Z').getTime(),
          closedAt: new Date('2026-10-22T10:30:00Z').getTime(),
        },
      ];

      const res = createDailyProfitSettlementForFinance360(closedDeals, '2026-10-22', []);
      expect(res.success).toBe(true);
      expect(res.payload?.netProfitUsdt).toBe(35.0);
      expect(res.payload?.settlementId).toBe('SETTLE-2026-10-22');

      const existing: DailyNetProfitTransferPayload[] = [res.payload!];
      const dup = createDailyProfitSettlementForFinance360(closedDeals, '2026-10-22', existing);
      expect(dup.success).toBe(false);
      expect(dup.error).toBe('SETTLEMENT_ALREADY_EXISTS');
    });

    it('calculates bank reconciliation drift correctly', () => {
      const balanced = calculateBankReconciliationAdjustment(50000, 50000);
      expect(balanced.isBalanced).toBe(true);
      expect(balanced.driftFiat).toBe(0);

      const diff = calculateBankReconciliationAdjustment(48500, 50000);
      expect(diff.isBalanced).toBe(false);
      expect(diff.driftFiat).toBe(1500);
      expect(diff.formattedDrift).toBe('+1500.00');
    });

    it('does NOT silently fabricate an exchange rate of 80 when rate is omitted or 0', () => {
      const stateWithZero = compileCrmWorkspaceState([], [], [], [], 'P2P_DESK', 0, mockNow);
      expect(stateWithZero.deals).toEqual([]);
      expect(stateWithZero.kpis.closedNetProfitTodayUsdt).toBe(0);

      // Polymorphic overload with missing rate
      const stateOmitted = compileCrmWorkspaceState([], [], [], 'P2P_DESK');
      expect(stateOmitted.deals).toEqual([]);
      expect(stateOmitted.kpis.closedVolumeTodayUsdt).toBe(0);
    });

    it('handles direct quote edge cases (zero amount, zero rate, fractional fees)', () => {
      const zeroQuote = calculateDirectQuote(0, 80, 82, 0.3);
      expect(zeroQuote.totalFiatToCollect).toBe(0);
      expect(zeroQuote.netProfitUsdt).toBe(0);

      const validQuote = calculateDirectQuote(100, 80, 82, 0.5);
      // grossFiat = 100 * 82 = 8200
      // netFiat = 8200 * (1 - 0.005) = 8159
      // netUsdt = 8159 / 80 = 101.9875 => profit = 1.99 USDT
      expect(validQuote.totalFiatToCollect).toBe(8200);
      expect(validQuote.netProfitUsdt).toBeCloseTo(1.99, 2);
    });

    it('normalizes dirty bank references with punctuation, symbols, and leading/trailing spaces', () => {
      expect(normalizeBankReference('  ref-12345678  ')).toBe('REF12345678');
      expect(normalizeBankReference('#98.765.432-0')).toBe('#98.765.4320');
      expect(normalizeBankReference('REF_88-99  ')).toBe('REF8899');
      expect(normalizeBankReference('')).toBe('');
      expect(normalizeBankReference('   ')).toBe('');
    });

    it('verifies reference collisions across all stages and honors self-exclusion', () => {
      const deals: PipelineDeal[] = [
        {
          id: 'D-101',
          scope: 'P2P_DESK',
          title: 'Trato 1',
          contactId: 'c1',
          contactName: 'Carlos',
          bankAccountId: 'b1',
          bankName: 'Banesco',
          stage: 'STAGE_2_TRANSIT',
          fiatCurrency: 'VES',
          cryptoAmountUsdt: 500,
          appliedRate: 85,
          replacementRate: 83,
          totalFiatAmount: 42500,
          paidFiatAmount: 0,
          netProfitUsdt: 12,
          bankReferenceId: 'REF-778899',
          quoteTtlMinutes: 15,
          quotedAt: mockNow,
          isRateExpired: false,
          timeline: [],
          createdAt: mockNow,
          closedAt: null,
        },
      ];

      // Collision with existing
      const coll = verifyReferenceCollision(deals, 'REF-778899');
      expect(coll.isDuplicate).toBe(true);
      expect(coll.existingDeal?.id).toBe('D-101');

      // Normalized collision (different casing/spacing)
      const collNorm = verifyReferenceCollision(deals, 'ref-778899 ');
      expect(collNorm.isDuplicate).toBe(true);

      // Self exclusion (updating same deal)
      const selfEx = verifyReferenceCollision(deals, 'REF-778899', 'D-101');
      expect(selfEx.isDuplicate).toBe(false);

      // Non-collision
      const freshRef = verifyReferenceCollision(deals, 'REF-999999');
      expect(freshRef.isDuplicate).toBe(false);
    });

    it('validates and sanitizes CRM backup payload, inheriting top-level scope and quarantining scopeless or NaN records', () => {
      // Case 1: Top-level backup scope ('FINANCE_360') is inherited by scopeless records with finite numbers,
      // while records with NaN/Infinity/string numeric fields are strictly quarantined.
      const backupWithTopLevelScope = {
        scope: 'FINANCE_360',
        deals: [
          {
            id: 'valid-deal',
            scope: 'P2P_DESK',
            cryptoAmountUsdt: 100,
            appliedRate: 85,
            totalFiatAmount: 8500,
          },
          {
            id: 'deal-inherits-top-scope',
            // missing scope -> inherits 'FINANCE_360'
            cryptoAmountUsdt: 250,
            appliedRate: 82,
            totalFiatAmount: 20500,
          },
          {
            id: 'corrupted-nan-deal',
            scope: 'P2P_DESK',
            cryptoAmountUsdt: 'not-a-number',
            appliedRate: NaN,
          },
        ],
        contacts: [
          {
            id: 'c-valid-inherited',
            // missing scope -> inherits 'FINANCE_360'
            pendingBalanceUsdt: -50,
          },
          {
            id: 'c-infinity-corrupted',
            scope: 'FINANCE_360',
            pendingBalanceUsdt: Infinity,
          },
        ],
        banks: [
          {
            id: 'b-valid',
            scope: 'P2P_DESK',
            currentBalanceFiat: 15000,
          },
        ],
      };

      const reportTopScope = validateAndSanitizeCrmBackupPayload(backupWithTopLevelScope);
      expect(reportTopScope.valid).toBe(true);
      expect(reportTopScope.sanitizedPayload.deals).toHaveLength(2);
      expect(reportTopScope.sanitizedPayload.deals[0].scope).toBe('P2P_DESK');
      expect(reportTopScope.sanitizedPayload.deals[1].id).toBe('deal-inherits-top-scope');
      expect(reportTopScope.sanitizedPayload.deals[1].scope).toBe('FINANCE_360');
      expect(reportTopScope.sanitizedPayload.contacts).toHaveLength(1);
      expect(reportTopScope.sanitizedPayload.contacts[0].scope).toBe('FINANCE_360');
      expect(reportTopScope.quarantinedCount).toBe(2); // corrupted-nan-deal + c-infinity-corrupted

      // Case 2: No top-level scope and no fallbackScope -> scopeless records are quarantined (zero ghost records)
      const scopelessPayload = {
        deals: [
          { id: 'valid-scoped', scope: 'P2P_DESK', cryptoAmountUsdt: 100, appliedRate: 80, totalFiatAmount: 8000 },
          { id: 'ghost-no-scope', cryptoAmountUsdt: 100, appliedRate: 80, totalFiatAmount: 8000 },
          { id: 'ghost-bad-scope', scope: 'ORPHAN_VAULT', cryptoAmountUsdt: 100 },
        ],
      };
      const reportStrict = validateAndSanitizeCrmBackupPayload(scopelessPayload);
      expect(reportStrict.valid).toBe(true);
      expect(reportStrict.sanitizedPayload.deals).toHaveLength(1);
      expect(reportStrict.sanitizedPayload.deals[0].id).toBe('valid-scoped');
      expect(reportStrict.quarantinedCount).toBe(2);
    });

    it('safeHydrateCrmCollection guards against corrupted non-array storage values and filters out scopeless ghost records', () => {
      expect(safeHydrateCrmCollection(null)).toEqual([]);
      expect(safeHydrateCrmCollection(undefined)).toEqual([]);
      expect(safeHydrateCrmCollection({ corrupted: true })).toEqual([]);
      expect(safeHydrateCrmCollection('string')).toEqual([]);

      // Scoped collections (default requireScope = true) drop primitives and scopeless ghost records
      const mixedRaw = [
        { id: 'd1', scope: 'P2P_DESK' },
        { id: 'd2', scope: 'FINANCE_360' },
        { id: 'ghost-1' },
        { id: 'ghost-2', scope: 'UNKNOWN' },
        null,
        123,
      ];
      expect(safeHydrateCrmCollection(mixedRaw)).toEqual([
        { id: 'd1', scope: 'P2P_DESK' },
        { id: 'd2', scope: 'FINANCE_360' },
      ]);

      // Unscoped collections like settlements pass requireScope = false
      const settlementsRaw = [{ settlementId: 'SETTLE-2026-10-22', netProfitUsdt: 40 }, null];
      expect(safeHydrateCrmCollection(settlementsRaw, false)).toEqual([
        { settlementId: 'SETTLE-2026-10-22', netProfitUsdt: 40 },
      ]);
    });

    it('exports centralized CRM_STORAGE_KEYS matching the p2p.crm.* namespace', () => {
      expect(CRM_STORAGE_KEYS.DEALS).toBe('p2p.crm.deals');
      expect(CRM_STORAGE_KEYS.CONTACTS).toBe('p2p.crm.contacts');
      expect(CRM_STORAGE_KEYS.BANKS).toBe('p2p.crm.banks');
      expect(CRM_STORAGE_KEYS.ACTIVITIES).toBe('p2p.crm.activities');
      expect(CRM_STORAGE_KEYS.SETTLEMENTS).toBe('p2p.crm.settlements');
      expect(CRM_STORAGE_KEYS.ACTIVE_SCOPE).toBe('p2p.crm.active-scope');
    });

    it('serializes and parses RFC-4180 CSV catalogs (Contacts, Banks, Activities) with multi-line quoted fields and NaN quarantine', () => {
      const contactWithNewlines: CrmContact = {
        ...sampleContact,
        paymentDetailsText: 'Titular: Carlos Mendoza, C.A.\nBanesco Pago Móvil "VIP"',
        verifiedReferences: ['REF-100', 'REF-200'],
      };

      const csvContacts = serializeContactsToCsv([contactWithNewlines], 'P2P_DESK');
      const parsedContacts = parseAndValidateContactsCsv(csvContacts);
      expect(parsedContacts.valid).toBe(true);
      expect(parsedContacts.quarantinedCount).toBe(0);
      expect(parsedContacts.records).toHaveLength(1);
      expect(parsedContacts.records[0].paymentDetailsText).toBe(
        'Titular: Carlos Mendoza, C.A.\nBanesco Pago Móvil "VIP"',
      );
      expect(parsedContacts.records[0].verifiedReferences).toEqual(['REF-100', 'REF-200']);

      // Corrupted CSV row with non-finite number or missing scope without fallback is quarantined
      const dirtyBanksCsv = [
        'id,scope,bankName,currency,holderDetailsText,currentBalanceFiat,maxDailyCapFiat,feePct,maxBurstTxPer15Min',
        'bnk-ok,FINANCE_360,Mercantil,VES,"Cuenta Corriente, Rif J-123",25000,100000,0.3,5',
        'bnk-bad-nan,P2P_DESK,Banesco,VES,Titular,NOT_A_NUMBER,100000,0.3,5',
        'bnk-no-scope,INVALID_VAULT,Provincial,VES,Titular,5000,50000,0.3,5',
      ].join('\n');

      const parsedBanks = parseAndValidateBanksCsv(dirtyBanksCsv);
      expect(parsedBanks.valid).toBe(true);
      expect(parsedBanks.records).toHaveLength(1);
      expect(parsedBanks.records[0].id).toBe('bnk-ok');
      expect(parsedBanks.records[0].scope).toBe('FINANCE_360');
      expect(parsedBanks.quarantinedCount).toBe(2);

      // Activities round-trip
      const act: ActivityLogEntry = {
        id: 'act-01',
        scope: 'P2P_DESK',
        timestamp: mockNow,
        type: 'DEAL_CLOSED',
        description: 'Liquidación orden #101, cliente "VIP"',
        amountUsdt: 500,
        referenceId: 'REF-9911',
      };
      const csvAct = serializeActivitiesToCsv([act]);
      const parsedAct = parseAndValidateActivitiesCsv(csvAct);
      expect(parsedAct.valid).toBe(true);
      expect(parsedAct.records).toHaveLength(1);
      expect(parsedAct.records[0].description).toBe('Liquidación orden #101, cliente "VIP"');
      expect(parsedAct.records[0].referenceId).toBe('REF-9911');
    });

    it('reconciles collections with MERGE (upsert preserving both vaults) vs REPLACE', () => {
      const existing: CrmContact[] = [
        { ...sampleContact, id: 'c-p2p', scope: 'P2P_DESK', name: 'Carlos Viejo' },
        { ...sampleContact, id: 'c-360', scope: 'FINANCE_360', name: 'Proveedor 360' },
      ];
      const incoming: CrmContact[] = [
        { ...sampleContact, id: 'c-p2p', scope: 'P2P_DESK', name: 'Carlos Actualizado' },
        { ...sampleContact, id: 'c-new', scope: 'P2P_DESK', name: 'Cliente Nuevo' },
      ];

      const merged = reconcileCrmCollectionById(existing, incoming, 'MERGE', (c) => c.id);
      expect(merged).toHaveLength(3);
      expect(merged.find((c) => c.id === 'c-p2p')?.name).toBe('Carlos Actualizado');
      expect(merged.find((c) => c.id === 'c-360')?.name).toBe('Proveedor 360');
      expect(merged.find((c) => c.id === 'c-new')?.name).toBe('Cliente Nuevo');

      const replaced = reconcileCrmCollectionById(existing, incoming, 'REPLACE', (c) => c.id);
      expect(replaced).toHaveLength(2);
      expect(replaced.find((c) => c.id === 'c-360')).toBeUndefined();
    });
  });
});

