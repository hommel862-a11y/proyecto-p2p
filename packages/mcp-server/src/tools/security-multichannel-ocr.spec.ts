import { describe, it, expect } from 'vitest';
import { checkBankOperationalStatusTool } from './check_bank_operational_status.js';
import { checkCounterpartyBlacklistTool } from './check_counterparty_blacklist.js';
import { registerBlacklistedEntityTool } from './register_blacklisted_entity.js';
import { sendMultichannelAlertTool } from './send_multichannel_alert.js';
import { processRemoteSentinelCommandTool } from './process_remote_sentinel_command.js';
import { auditPaymentProofOcrTool } from './audit_payment_proof_ocr.js';

describe('Compliance, Multichannel & Proof Reader MCP Tools Suite', () => {
  describe('check_bank_operational_status', () => {
    it('evaluates Venezuelan banking status and returns operational latency', () => {
      const res = checkBankOperationalStatusTool.execute({
        bankCodes: ['0102', '0134', '0105', 'PAGO_MOVIL'],
        includePaymentNetworks: true,
      });

      expect(res.networkStatus).toBeDefined();
      expect(res.pauseTradingDirective).toBe(false);
      expect(res.averageSettlementLatencyMinutes).toBeGreaterThan(0);
      expect(res.bankDetails.length).toBe(4);
      expect(res.bankDetails[0].bankCode).toBe('0102');
      expect(res.operationalAdvice).toContain('canales bancarios');
    });

    it('defaults to full local banking panel when no bankCodes are provided', () => {
      const res = checkBankOperationalStatusTool.execute({
        includePaymentNetworks: true,
      });

      expect(res.bankDetails.length).toBe(6);
      expect(res.bankDetails.some((b) => b.bankCode === '0134')).toBe(true);
      expect(res.bankDetails.some((b) => b.bankCode === 'PAGO_MOVIL')).toBe(true);
    });
  });

  describe('check_counterparty_blacklist', () => {
    it('detects reported triangulation scammer by cédula and returns block decision', () => {
      const res = checkCounterpartyBlacklistTool.execute({
        cedula: 'V-28999888',
      });

      expect(res.isFlagged).toBe(true);
      expect(res.riskLevel).toBe('CRITICAL');
      expect(res.decision).toBe('IMMEDIATE_BLOCK_TRANSACTION');
      expect(res.totalMatchesFound).toBe(1);
      expect(res.matchedRecords[0].category).toBe('TRIANGULATION_SCAM');
      expect(res.actionRequired).toContain('ALERTA ROJA');
    });

    it('detects reported third party payer by phone number', () => {
      const res = checkCounterpartyBlacklistTool.execute({
        phone: '0414-1234567',
      });

      expect(res.isFlagged).toBe(true);
      expect(res.decision).toBe('IMMEDIATE_BLOCK_TRANSACTION');
      expect(res.matchedRecords[0].suspectName).toBe('Carlos Estafa');
    });

    it('returns clean decision for legitimate unknown counterparty', () => {
      const res = checkCounterpartyBlacklistTool.execute({
        cedula: 'V-15888777',
        phone: '0412-9998877',
        alias: 'HonestMerchant',
      });

      expect(res.isFlagged).toBe(false);
      expect(res.riskLevel).toBe('CLEAN');
      expect(res.decision).toBe('CLEAN_TO_PROCEED');
      expect(res.totalMatchesFound).toBe(0);
    });
  });

  describe('register_blacklisted_entity', () => {
    it('requires human-in-the-loop challenge token when humanConfirm is false', () => {
      const res = registerBlacklistedEntityTool.execute({
        identifierType: 'CEDULA',
        identifierValue: 'V-30111222',
        fraudCategory: 'TRIANGULATION_SCAM',
        humanConfirm: false,
      });

      expect(res.status).toBe('CHALLENGE_REQUIRED');
      expect(res.challengeToken).toBeDefined();
      expect(res.message).toContain('autorización humana explícita');
    });

    it('registers blacklisted entity successfully when confirmed by human', () => {
      const res = registerBlacklistedEntityTool.execute({
        identifierType: 'ACCOUNT_NUMBER',
        identifierValue: '01050111223344556677',
        counterpartyName: 'Sospechoso Mercantil',
        fraudCategory: 'CHARGEBACK_ATTEMPT',
        riskLevel: 'CRITICAL',
        incidentNotes: 'Desconocimiento fraudulento de pago en taquilla.',
        humanConfirm: true,
      });

      expect(res.status).toBe('REGISTERED_SUCCESSFULLY');
      expect(res.blacklistEntryId).toBeDefined();
      expect(res.identifierValue).toBe('01050111223344556677');
      expect(res.actionSummary).toContain('blindada en la base de datos');
    });
  });

  describe('send_multichannel_alert', () => {
    it('formats and dispatches high-priority alert with interactive buttons', () => {
      const res = sendMultichannelAlertTool.execute({
        channel: 'TELEGRAM',
        priority: 'ALERT',
        title: 'Spread Favorable Detectado',
        messageMarkdown:
          'Spread en Binance P2P a 2.4% con Banesco. Volumen disponible: 1,500 USDT.',
        actionButtons: [
          { label: 'Fijar Alerta', callbackAction: 'LOCK_SPREAD_ALERT' },
          { label: 'Abrir Anuncio Maker', callbackAction: 'OPEN_MAKER_AD' },
        ],
        orderId: 'ORD-SPREAD-992',
      });

      expect(res.deliveryStatus).toBe('DISPATCHED_TO_QUEUE');
      expect(res.channel).toBe('TELEGRAM');
      expect(res.actionButtonsConfigured).toBe(2);
      expect(res.renderedPayloadPreview).toContain('SPREAD FAVORABLE DETECTADO');
      expect(res.renderedPayloadPreview).toContain('[Fijar Alerta]');
    });
  });

  describe('process_remote_sentinel_command', () => {
    it('parses natural language operational instruction and generates Ledger entry', () => {
      const res = processRemoteSentinelCommandTool.execute({
        rawText: 'Registra compra de 500 USDT a 41.50 en Banesco',
        senderId: 'ADMIN_DESK',
        channel: 'TELEGRAM',
        humanConfirm: true,
      });

      expect(res.commandType).toBe('LEDGER_TRANSACTION');
      expect(res.status).toBe('PROCESSED_AND_SETTLED');
      expect(res.ledgerImpact).toBe(true);
      expect(res.transactionDetail?.side).toBe('buy');
      expect(res.transactionDetail?.usdtAmount).toBe(500);
      expect(res.transactionDetail?.ratePrice).toBe(41.5);
      expect(res.transactionDetail?.vesTotal).toBe(20750);
      expect(res.transactionDetail?.bank).toBe('Banesco');
    });

    it('executes emergency /killswitch command remotely', () => {
      const res = processRemoteSentinelCommandTool.execute({
        rawText: '/killswitch',
        channel: 'TELEGRAM',
      });

      expect(res.commandType).toBe('SYSTEM_COMMAND');
      expect(res.action).toBe('TRIGGER_KILLSWITCH');
      expect(res.status).toBe('EXECUTED_SUCCESSFULLY');
    });

    it('returns clarification request on unrecognized phrase', () => {
      const res = processRemoteSentinelCommandTool.execute({
        rawText: 'Hola bot como estas',
        channel: 'TELEGRAM',
      });

      expect(res.commandType).toBe('UNRECOGNIZED_COMMAND');
      expect(res.status).toBe('NEEDS_CLARIFICATION');
    });
  });

  describe('audit_payment_proof_ocr', () => {
    it('verifies exact match for valid Banesco Pago Móvil receipt and confirms safe release', () => {
      const receiptText = `
        Banesco Banco Universal
        Comprobante de Pago Móvil
        Operación Exitosa
        Referencia: 884920
        Monto: 12.500,00 Bs.
        Cédula Pagador: V-20.123.456
        Fecha: 18/09/2026 10:45 AM
      `;

      const res = auditPaymentProofOcrTool.execute({
        ocrRawText: receiptText,
        expectedAmountVes: 12500.0,
        expectedBank: 'BANESCO',
        expectedPayerIdDoc: 'V20123456',
        orderId: 'ORD-P2P-771',
      });

      expect(res.verdict).toBe('MATCH_VERIFIED_SAFE_TO_RELEASE');
      expect(res.isSafeToRelease).toBe(true);
      expect(res.extractedData.reference).toBe('884920');
      expect(res.extractedData.amountVes).toBe(12500);
      expect(res.extractedData.bank).toBe('BANESCO');
      expect(res.actionAdvice).toContain('Seguro para liberar los USDT');
    });

    it('flags amount mismatch when receipt differs from active order', () => {
      const receiptText = `
        Banco de Venezuela
        Pago Móvil BDV
        Ref: 991283
        Monto: 10.000,00 VES
        Cédula: V-19999888
      `;

      const res = auditPaymentProofOcrTool.execute({
        ocrRawText: receiptText,
        expectedAmountVes: 15000.0,
        orderId: 'ORD-P2P-882',
      });

      expect(res.verdict).toBe('AMOUNT_MISMATCH');
      expect(res.isSafeToRelease).toBe(false);
      expect(res.discrepancies.some((d) => d.includes('DISCREPANCIA DE MONTO'))).toBe(true);
      expect(res.actionAdvice).toContain('NO LIBERAR CRIPTO');
    });

    it('flags third party suspicion when payer document does not match verified counterparty', () => {
      const receiptText = `
        Mercantil Banco
        Transferencia Bancaria
        Referencia: 445566
        Monto: 5.000,00 Bs
        Cédula: V-29000111
      `;

      const res = auditPaymentProofOcrTool.execute({
        ocrRawText: receiptText,
        expectedAmountVes: 5000.0,
        expectedPayerIdDoc: 'V-15000999',
        orderId: 'ORD-P2P-993',
      });

      expect(res.verdict).toBe('THIRD_PARTY_SUSPICION');
      expect(res.isSafeToRelease).toBe(false);
      expect(res.discrepancies.some((d) => d.includes('ALERTA TITULARIDAD'))).toBe(true);
    });
  });
});
