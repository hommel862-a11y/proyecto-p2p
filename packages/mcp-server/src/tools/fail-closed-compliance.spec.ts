import { describe, it, expect } from 'vitest';
import { screenWalletAddressTool } from './screen_wallet_address.js';
import { inspectTxTaintTool } from './inspect_tx_taint.js';
import { checkBankOperationalStatusTool } from './check_bank_operational_status.js';
import { lookupCounterpartyReputationTool } from './lookup_counterparty_reputation.js';
import { compileDisputeDossierTool } from './compile_dispute_dossier.js';
import { verifyInboundTransferTool } from './verify_inbound_transfer.js';
import { evaluateAccountSaturationTool } from './evaluate_account_saturation.js';
import { dispatchOrderInstructionsTool } from './dispatch_order_instructions.js';
import { checkCounterpartyBlacklistTool } from './check_counterparty_blacklist.js';

/**
 * These tests assert the ABSENCE of a fabricated verdict.
 *
 * Every case below previously returned a confident, actionable, sourced-looking
 * answer while having consulted nothing. A regression that restores any of the
 * old values fails here, which is the point: the dangerous behaviour was the
 * default, so the guard has to be explicit.
 */
describe('Fail-closed compliance verdicts', () => {
  describe('screen_wallet_address', () => {
    const screen = (address: string, network: 'TRC20' | 'ERC20' | 'BEP20') =>
      screenWalletAddressTool.execute({ address, network });

    it('never asserts a cleared address without a sanctions feed', () => {
      const res = screen('TYDzsYUEpvnYmQk4zGP9sWWcTEd36GunL', 'TRC20');
      expect(res.sanctionedMatch).toBeNull();
      expect(res.riskScore).toBeNull();
      expect(res.riskLevel).toBeNull();
      expect(res.recommendation).toBeNull();
      expect(res.actionable).toBe(false);
      expect(res.verdict).toBe('UNVERIFIED');
    });

    it('does not flag a plausible address as sanctioned from its text', () => {
      const res = screen('0x71C8fb962464712965329b3F4C1B10FCEf459146', 'ERC20');
      expect(res.sanctionedMatch).toBeNull();
    });

    it('still reports address/network structure as a fact', () => {
      const res = screen('0x71C8fb962464712965329b3F4C1B10FCEf459146', 'TRC20');
      expect(res.structuralFlags).toContain('NETWORK_MISMATCH_EVM_ADDRESS_ON_TRON');
    });

    it('reports a Tron address declared on an EVM network', () => {
      const res = screen('TYDzsYUEpvnYmQk4zGP9sWWcTEd36GunL', 'ERC20');
      expect(res.structuralFlags).toContain('NETWORK_MISMATCH_TRON_ADDRESS_ON_EVM');
    });

    it('degrades a sentinel-looking address without scoring it', () => {
      const res = screen('0x000000000000000000000000000000000000dead', 'ERC20');
      expect(res.structuralFlags).toContain('BURN_OR_NULL_SENTINEL_PATTERN_UNVERIFIED');
      expect(res.riskScore).toBeNull();
      expect(res.sanctionedMatch).toBeNull();
    });

    it('declares which feed it would need to reach a verdict', () => {
      const res = screen('TYDzsYUEpvnYmQk4zGP9sWWcTEd36GunL', 'TRC20');
      expect(res.expectedSource).toMatch(/sanctions feed/i);
      expect(res.verdictReason).toBe('NO_LIVE_SANCTIONS_FEED');
      expect(res.provenance.source).toBeNull();
      expect(res.provenance.observedAt).toBeNull();
    });
  });

  describe('inspect_tx_taint', () => {
    it('never certifies a transaction as clean without forensic evidence', () => {
      const res = inspectTxTaintTool.execute({
        txHash: 'e4d909c290d0fb1ca068ffaddf22cbd0d0c35',
        chain: 'TRON',
      });
      expect(res.isClean).toBeNull();
      expect(res.compliancePass).toBeNull();
      expect(res.taintPercentage).toBeNull();
      expect(res.directHopToMixer).toBeNull();
      expect(res.clusterAttribution).toBeNull();
      expect(res.actionable).toBe(false);
    });

    it('does not treat a hash suffix as a malicious-cluster signal', () => {
      const res = inspectTxTaintTool.execute({
        txHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000',
        chain: 'TRON',
      });
      expect(res.taintPercentage).toBeNull();
      expect(res.directHopToMixer).toBeNull();
    });

    it('returns the same UNVERIFIED verdict for every hash', () => {
      const clean = inspectTxTaintTool.execute({
        txHash: 'e4d909c290d0fb1ca068ffaddf22cbd0d0c35',
        chain: 'TRON',
      });
      const flagged = inspectTxTaintTool.execute({
        txHash: 'deadbeefdeadbeefdeadbeefdeadbeef',
        chain: 'TRON',
      });
      expect(clean.verdictReason).toBe(flagged.verdictReason);
      expect(clean.isClean).toBe(flagged.isClean);
    });
  });

  describe('check_bank_operational_status', () => {
    it('does not report any bank as operational without telemetry', () => {
      const res = checkBankOperationalStatusTool.execute({
        bankCodes: ['0102', '0134', '0105', 'PAGO_MOVIL'],
        includePaymentNetworks: true,
      });
      expect(res.networkStatus).toBeNull();
      expect(res.pauseTradingDirective).toBeNull();
      expect(res.averageSettlementLatencyMinutes).toBeNull();
      expect(res.operationalAdvice).toBeNull();
      expect(res.actionable).toBe(false);
    });

    it('never emits OPERATIONAL or a latency figure', () => {
      const res = checkBankOperationalStatusTool.execute({ includePaymentNetworks: true });
      for (const bank of res.bankDetails) {
        expect(bank.status).toBe('UNVERIFIED_OFFLINE');
        expect(bank.settlementLatencyMinutes).toBeNull();
        expect(bank.recommendedAction).toBe('VERIFY_WITH_BANK_STATEMENT');
      }
    });

    it('covers the default banking panel without inventing per-bank health', () => {
      const res = checkBankOperationalStatusTool.execute({ includePaymentNetworks: true });
      expect(res.bankDetails.length).toBe(6);
      expect(res.bankDetails.some((b) => b.bankCode === '0134')).toBe(true);
      expect(res.bankDetails.some((b) => b.bankCode === 'PAGO_MOVIL')).toBe(true);
    });

    it('does not claim optimal liquidity anywhere in its output', () => {
      const res = checkBankOperationalStatusTool.execute({ includePaymentNetworks: true });
      const serialized = JSON.stringify(res);
      expect(serialized).not.toMatch(/óptima liquidez|acreditación inmediata|OPERATIONAL/);
    });
  });

  describe('lookup_counterparty_reputation', () => {
    it('never grants a trust score without a reputation ledger', () => {
      const res = lookupCounterpartyReputationTool.execute({ documentId: 'V-20123456' });
      expect(res.trustScore).toBeNull();
      expect(res.isBlacklisted).toBeNull();
      expect(res.riskLevel).toBeNull();
      expect(res.recommendation).toBeNull();
      expect(res.blindHash).toBeNull();
      expect(res.actionable).toBe(false);
    });

    it('does not fabricate a chargeback incident from a digit pattern', () => {
      const res = lookupCounterpartyReputationTool.execute({ documentId: 'V-99999000' });
      expect(res.historicalIncidents).toBeNull();
      expect(res.isBlacklisted).toBeNull();
      expect(res.recommendation).not.toBe('ABORT_TRADE_REFUSE_COUNTERPARTY');
    });

    it('never returns a ZK blind hash, so it cannot vary per call', () => {
      const first = lookupCounterpartyReputationTool.execute({ documentId: 'V-20123456' });
      const second = lookupCounterpartyReputationTool.execute({ documentId: 'V-20123456' });
      expect(first.blindHash).toBeNull();
      expect(first.blindHash).toBe(second.blindHash);
    });
  });

  describe('compile_dispute_dossier', () => {
    const dossier = compileDisputeDossierTool.execute({
      orderId: 'ORD-2026-99128',
      disputeReason: 'UNRELEASED_CRYPTO',
      amountUsdt: 850,
      amountVes: 67320,
      counterpartyNick: 'TraderFraudster99',
    });

    it('never emits a cryptographic seal it did not compute', () => {
      expect(dossier.sha256Digest).toBeNull();
      expect(dossier.exportFormat).toBeNull();
      expect(dossier.dossierStatus).toBe('DRAFT_UNVERIFIED');
    });

    it('does not assert a bank confirmation it never received', () => {
      expect(dossier.recommendedAppealStatement).not.toMatch(
        /Se verificó|banco confirma|extracto bancario firmado digitalmente/,
      );
      expect(dossier.recommendedAppealStatement).toMatch(/PENDIENTE/);
    });

    it('does not estimate probability of resolution', () => {
      expect(dossier.resolutionProbabilityPct).toBeNull();
    });

    it('does not mark evidence as verified when nothing was verified', () => {
      expect(dossier.evidenceMetadata.evidenceAttachmentsVerified).toBe(false);
      expect(dossier.evidenceMetadata.bankingProofTimestamp).toBeNull();
      expect(dossier.actionable).toBe(false);
    });

    it('makes no unverified factual claim in any dispute reason', () => {
      for (const reason of [
        'THIRD_PARTY_PAYMENT',
        'UNRELEASED_CRYPTO',
        'FAKE_RECEIPT',
        'INCORRECT_AMOUNT',
      ] as const) {
        const res = compileDisputeDossierTool.execute({
          orderId: 'ORD-1',
          disputeReason: reason,
          amountUsdt: 100,
          amountVes: 1000,
          counterpartyNick: 'x',
        });
        expect(res.recommendedAppealStatement).not.toMatch(
          /violando expresamente|Se verificó|confirma que el número/,
        );
      }
    });
  });

  describe('verify_inbound_transfer', () => {
    const verify = verifyInboundTransferTool.execute({
      referenceNumber: '984721',
      amountVes: 12500.5,
      bankCode: '0102',
      senderCedula: 'V-19876543',
    });

    it('never authorizes releasing crypto without a bank confirmation', () => {
      expect(verify.status).toBeNull();
      expect(verify.recommendation).toBeNull();
      expect(verify.bankResponseCode).toBeNull();
      expect(verify.ledgerReceiptId).toBeNull();
      expect(verify.actionable).toBe(false);
    });

    it('does not claim a bank was contacted or reconciled in 142ms', () => {
      expect(verify.bankContacted).toBe(false);
      expect(verify.reconciledInMs).toBeNull();
    });

    it('does not treat the presence of a cedula as identity verification', () => {
      expect(verify.senderCedulaProvided).toBe(true);
      expect(verify.senderIdentityVerified).toBeNull();
    });

    it('states the blocking instruction explicitly', () => {
      expect(verify.blockingInstruction).toMatch(/NO liberar cripto/);
    });
  });

  describe('evaluate_account_saturation', () => {
    const res = evaluateAccountSaturationTool.execute({
      bankId: 'banesco_01',
      currentDailyVes: 450000,
      dailyLimitVes: 500000,
      hourlyTransactionCount: 9,
      incomingAmountVes: 60000,
    });

    it('keeps the caller-supplied arithmetic, which is correct', () => {
      expect(res.projectedDailyVes).toBe(510000);
      expect(res.saturationPercentage).toBe(102);
      expect(res.remainingQuotaVes).toBe(0);
    });

    it('does not present the caller-supplied limit as a regulatory limit', () => {
      expect(res.limitProvenance).toBe('CALLER_SUPPLIED');
      expect(res.regulatoryLimitVerified).toBe(false);
    });

    it('emits no compliance verdict and no bank-rotation recommendation', () => {
      expect(res.riskLevel).toBeNull();
      expect(res.recommendBankRotation).toBeNull();
      expect(res.reason).toBeNull();
      expect(res.hourlyThreshold).toBeNull();
      expect(res.saturationAlertThreshold).toBeNull();
    });

    it('does not assert a regulatory rotation obligation', () => {
      expect(JSON.stringify(res)).not.toMatch(/SUDEBAN|Rotación bancaria obligatoria/);
    });
  });

  describe('dispatch_order_instructions', () => {
    const res = dispatchOrderInstructionsTool.execute({
      orderId: 'P2P-55182',
      channel: 'TELEGRAM',
      recipientContact: '@TraderVipVzla',
      bankName: 'Banesco',
      accountHolder: 'Inversiones Desk Pro C.A.',
      accountNumberOrPhone: '0414-1234567',
      amountVes: 39500,
    });

    it('does not forge a delivery receipt for a message it never sent', () => {
      expect(res.dispatchStatus).toBe('NOT_SENT_RENDERED_ONLY');
      expect(res.sent).toBe(false);
      expect(res.deliveredAt).toBeNull();
      expect(res.actionId).toBeNull();
    });

    it('still renders the correctly formatted message', () => {
      expect(res.formattedPayloadPreview).toContain('Banesco');
      expect(res.formattedPayloadPreview).toContain('39.500');
      expect(res.formattedPayloadPreview).toContain('ORDEN P2P #P2P-55182');
    });
  });

  describe('check_counterparty_blacklist', () => {
    it('does not clear a counterparty that is absent from a fixture store', () => {
      const res = checkCounterpartyBlacklistTool.execute({ cedula: 'V-00000001' });
      expect(res.isFlagged).toBeNull();
      expect(res.blockDecision).toBeNull();
      expect(res.actionable).toBe(false);
      expect(res.verdict).toBe('UNVERIFIED');
    });

    it('labels a fixture match as a fixture and never as an authoritative flag', () => {
      const res = checkCounterpartyBlacklistTool.execute({ cedula: 'V-28999888' });
      expect(res.isFlagged).toBeNull();
      expect(res.actionable).toBe(false);
      expect(res.provenance.source).toBe('INTERNAL_SAMPLE_FIXTURES');
      expect(res.matchedRecords[0].isSampleFixture).toBe(true);
    });

    it('does not match every record when the cedula has no alphanumerics', () => {
      const res = checkCounterpartyBlacklistTool.execute({ cedula: '---' });
      expect(res.totalMatchesFound).toBe(0);
    });

    it('does not match on a one-digit phone fragment', () => {
      const res = checkCounterpartyBlacklistTool.execute({ phone: '7' });
      expect(res.totalMatchesFound).toBe(0);
    });

    it('warns that the store holds fixtures rather than real reports', () => {
      const res = checkCounterpartyBlacklistTool.execute({ cedula: 'V-28999888' });
      expect(res.actionRequired).toMatch(/fixtures de prueba/);
      expect(JSON.stringify(res)).not.toMatch(/Pedro Fraude|Carlos Estafa|Mula Financiera/);
    });
  });
});