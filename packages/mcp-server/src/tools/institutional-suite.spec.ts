import { describe, it, expect } from 'vitest';
import {
  screenWalletAddressTool,
  inspectTxTaintTool,
  fetchCrossExchangeSpreadTool,
  verifyInboundTransferTool,
  compileDisputeDossierTool,
  evaluateAccountSaturationTool,
  dispatchOrderInstructionsTool,
  lookupCounterpartyReputationTool,
  auditAndRiskAnalyticsTool,
} from './index.js';

/**
 * The institutional suite.
 *
 * Most assertions below were previously inverted: they asserted that a
 * fabricated clearance was produced. For example, this file required
 * `sanctionedMatch === false` for an address that had never been screened,
 * `trustScore > 80` for a counterparty with no reputation ledger, and
 * `status === 'MATCH_FOUND_VERIFIED'` plus `SAFE_TO_RELEASE_CRYPTO` for a bank
 * reference no bank had ever seen.
 *
 * A test suite that requires a fabrication is not coverage — it is a lock on
 * the fabrication. These now assert the honest unavailable state.
 *
 * Two tools remain behaviourally meaningful and keep real assertions:
 * `fetch_cross_exchange_spread` (per-exchange `source: SIMULATED` vs `LIVE`)
 * and `audit_and_risk_analytics` (pure computation over caller-supplied
 * records).
 */
describe('Institutional 10 MCP Servers Tool Suite', () => {
  describe('screen_wallet_address', () => {
    it('withholds an AML verdict when no sanctions feed is configured', () => {
      const res = screenWalletAddressTool.execute({
        address: 'TYDzsYUEpvnYmQk4zGP9sWWcTEd36GunL',
        network: 'TRC20',
        expectedAmountUsdt: 500,
      });
      expect(res.verdict).toBe('UNVERIFIED');
      expect(res.sanctionedMatch).toBeNull();
      expect(res.actionable).toBe(false);
    });

    it('flags a network mismatch as a structural fact, not a risk score', () => {
      const mismatch = screenWalletAddressTool.execute({
        address: '0x71C8fb962464712965329b3F4C1B10FCEf459146',
        network: 'TRC20',
      });
      expect(mismatch.structuralFlags).toContain('NETWORK_MISMATCH_EVM_ADDRESS_ON_TRON');
      expect(mismatch.riskScore).toBeNull();
    });
  });

  describe('inspect_tx_taint', () => {
    it('withholds the taint and compliance verdict without forensic data', () => {
      const res = inspectTxTaintTool.execute({
        txHash: 'e4d909c290d0fb1ca068ffaddf22cbd0d0c35',
        chain: 'TRON',
      });
      expect(res.taintPercentage).toBeNull();
      expect(res.isClean).toBeNull();
      expect(res.compliancePass).toBeNull();
    });
  });

  describe('fetch_cross_exchange_spread', () => {
    /**
     * This test used to assert `res.exchanges.length >= 4`. Offline, the only way
     * to produce four exchanges was to invent them: three venues were derived
     * from a hardcoded `baseRate` and the fourth was an El Dorado stub. The
     * assertion therefore locked the fabrication in place — it demanded that
     * the tool invent a market.
     *
     * The rule now enforced: a venue that was not read is absent. Any quote that
     * does appear must be LIVE, because there is no other kind of quote left.
     */
    it('invents no venue when no venue can be read', async () => {
      const res = await fetchCrossExchangeSpreadTool.execute({
        fiat: 'VES',
        asset: 'USDT',
        paymentMethod: 'Pago Movil',
        minMerchantTrades: 50,
      });

      for (const quote of res.exchanges) {
        expect(quote.source).toBe('LIVE');
      }

      if (res.exchanges.length === 0) {
        expect(res.rateStatus).toBe('UNAVAILABLE_NO_LIVE_SOURCE');
        expect(res.crossArbitrageOpportunity).toBeNull();
        expect(res.actionable).toBe(false);
      } else {
        // A real reading must never be presented without its origin.
        expect(res.expectedSource).toBeTruthy();
      }
    });
  });

  describe('verify_inbound_transfer', () => {
    it('never reports a match without contacting the clearing network', () => {
      const res = verifyInboundTransferTool.execute({
        referenceNumber: '984721',
        amountVes: 12500.5,
        bankCode: '0102',
        senderCedula: 'V-19876543',
      });
      expect(res.status).toBeNull();
      expect(res.bankResponseCode).toBeNull();
      expect(res.recommendation).toBeNull();
      expect(res.bankContacted).toBe(false);
    });
  });

  describe('compile_dispute_dossier', () => {
    it('produces an unverified draft with no seal and no probability', () => {
      const res = compileDisputeDossierTool.execute({
        orderId: 'ORD-2026-99128',
        disputeReason: 'THIRD_PARTY_PAYMENT',
        amountUsdt: 850,
        amountVes: 67320,
        counterpartyNick: 'TraderFraudster99',
      });
      expect(res.dossierStatus).toBe('DRAFT_UNVERIFIED');
      expect(res.sha256Digest).toBeNull();
      expect(res.resolutionProbabilityPct).toBeNull();
      expect(res.recommendedAppealStatement).toMatch(/PENDIENTE/);
    });
  });

  describe('evaluate_account_saturation', () => {
    it('computes saturation from caller-supplied amounts without a verdict', () => {
      const res = evaluateAccountSaturationTool.execute({
        bankId: 'banesco_01',
        currentDailyVes: 450000,
        dailyLimitVes: 500000,
        hourlyTransactionCount: 9,
        incomingAmountVes: 60000,
      });
      expect(res.saturationPercentage).toBe(102);
      expect(res.remainingQuotaVes).toBe(0);
      expect(res.riskLevel).toBeNull();
      expect(res.recommendBankRotation).toBeNull();
      expect(res.regulatoryLimitVerified).toBe(false);
    });
  });

  describe('dispatch_order_instructions', () => {
    it('renders the message without claiming it was sent', () => {
      const res = dispatchOrderInstructionsTool.execute({
        orderId: 'P2P-55182',
        channel: 'TELEGRAM',
        recipientContact: '@TraderVipVzla',
        bankName: 'Banesco',
        accountHolder: 'Inversiones Desk Pro C.A.',
        accountNumberOrPhone: '0414-1234567',
        amountVes: 39500,
      });
      expect(res.formattedPayloadPreview).toContain('Banesco');
      expect(res.formattedPayloadPreview).toContain('39.500');
      expect(res.sent).toBe(false);
      expect(res.dispatchStatus).toBe('NOT_SENT_RENDERED_ONLY');
    });
  });

  describe('lookup_counterparty_reputation', () => {
    it('withholds trust and blacklist status without a reputation ledger', () => {
      const res = lookupCounterpartyReputationTool.execute({
        documentId: 'V-20123456',
      });
      expect(res.trustScore).toBeNull();
      expect(res.isBlacklisted).toBeNull();
      expect(res.recommendation).toBeNull();
    });
  });

  describe('audit_and_risk_analytics', () => {
    it('scores only the operations actually supplied by the caller', () => {
      const res = auditAndRiskAnalyticsTool.execute({
        timeframeDays: 7,
        minSpreadThresholdPct: 0.5,
        focusArea: 'ALL',
        sampleEvents: [
          { timestamp: '2026-09-19T11:00:00Z', severity: 'error', action: 'RISK_ALERT' },
        ],
        sampleOperations: [
          { timestamp: '2026-09-19T10:00:00Z', netSpreadPct: 1.45, cryptoAmount: 1000 },
        ],
      });
      expect(res.success).toBe(true);
      expect(res.dossier.goldenRuleComplianceScore).toBe(100);
      expect(res.dossier.disciplineAudit.compliantOperationsCount).toBe(1);
    });

    it('does not certify an operator when no records were supplied', () => {
      const res = auditAndRiskAnalyticsTool.execute({
        timeframeDays: 7,
        minSpreadThresholdPct: 0.5,
        focusArea: 'ALL',
        sampleEvents: [],
        sampleOperations: [],
      });
      // No records is not a perfect record. This tool is reachable with an
      // empty ledger from a fresh install, so returning 100/DISCIPLINED here
      // certified a brand-new operator as institutionally disciplined.
      expect(res.dossier.assessmentStatus).toBe('NOT_ASSESSED');
      expect(res.dossier.operatorStanding).toBe('NOT_ASSESSED');
      expect(res.dossier.goldenRuleComplianceScore).toBeNull();
      expect(res.dossier.riskConcentrationScore).toBeNull();
      expect(res.dossier.disciplineAudit.complianceRatePct).toBeNull();
      expect(res.dossier.criticalFindings.join(' ')).not.toContain('Excelente apego');
      expect(res.dossier.preventiveDirectives).toHaveLength(0);
      expect(res.dossier.executiveVerdict).toContain('SIN CALIFICAR');
    });
  });
});