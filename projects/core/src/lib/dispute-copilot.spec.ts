import { describe, it, expect } from 'vitest';
import { buildDisputeDossier, buildDisputeDossierFromFsm } from './dispute-copilot';
import { createFsmOrder, transitionOrderFsm } from './fsm';
import type { FraudShieldAuditResult } from './fraud-shield';

describe('Dispute Copilot & Arbitration Engine', () => {
  const mockFraudAudit: FraudShieldAuditResult = {
    orderId: 'ORD-882211',
    overallScore: 85,
    riskLevel: 'CRITICAL',
    nameMatch: {
      score: 0.15,
      isMatch: false,
      normalizedA: 'JUAN CARLOS PEREZ',
      normalizedB: 'MARIA RODRIGUEZ',
      matchedTokens: [],
      missingTokens: ['MARIA', 'RODRIGUEZ'],
    },
    referenceValidation: {
      isValid: true,
      bank: 'BANESCO',
      reference: '99887766',
      expectedFormat: '8 dígitos',
    },
    amountDifference: 0,
    summaryHeadline: 'Riesgo Crítico por Triangulación',
    auditDetails: ['Pago de tercero detectado'],
    disputeTemplateText: 'Reclamo formal por pago de tercero no titular.',
    flags: ['THIRD_PARTY_PAYER', 'ID_DOCUMENT_MISMATCH'],
    recommendation: 'LOCK_AND_DISPUTE',
  };

  it('should build a comprehensive bilingual dispute dossier', () => {
    const dossier = buildDisputeDossier({
      orderId: 'ORD-882211',
      orderAmountFiat: 8500,
      orderAmountCrypto: 120,
      fiatCurrency: 'VES',
      cryptoAsset: 'USDT',
      counterpartyBinanceName: 'Juan Carlos Perez',
      counterpartyBinanceIdDoc: 'V-19876543',
      bankPayerName: 'Maria Rodriguez',
      bankPayerIdDoc: 'V-24555666',
      bankName: 'Banesco',
      bankReference: '99887766',
      bankPaymentTimestamp: 1700000020000,
      orderCreatedTimestamp: 1700000000000,
      fraudAudit: mockFraudAudit,
    });

    expect(dossier.caseId).toContain('ORD-882211');
    expect(dossier.severity).toBe('CRITICAL');
    expect(dossier.evidenceSummary.nameSimilarityPct).toBe(15);
    expect(dossier.evidenceSummary.actualPayerName).toBe('Maria Rodriguez');
    expect(dossier.evidenceSummary.expectedName).toBe('Juan Carlos Perez');

    // Validación de escritos bilingües
    expect(dossier.appealTextEs).toContain('EXPEDIENTE DE APELACIÓN FORMAL');
    expect(dossier.appealTextEs).toContain('ORD-882211');
    expect(dossier.appealTextEs).toContain('Maria Rodriguez');
    expect(dossier.appealTextEs).toContain('Third-Party Payment Policy');

    expect(dossier.appealTextEn).toContain('FORMAL ARBITRATION APPEAL DOSSIER');
    expect(dossier.appealTextEn).toContain('ORD-882211');
    expect(dossier.appealTextEn).toContain('Maria Rodriguez');
    expect(dossier.appealTextEn).toContain('Third-Party Payment');

    // Validación de respuestas de chat para el operador
    expect(dossier.chatResponses.thirdPartyWarning).toContain('AVISO DE SEGURIDAD P2P');
    expect(dossier.chatResponses.refundInstructions).toContain('INSTRUCCIONES DE REEMBOLSO');
    expect(dossier.chatResponses.appealEscalation).toContain('CASO EN ARBITRAJE');

    // Validación de la línea temporal
    expect(dossier.timeline.length).toBe(4);
    expect(dossier.timeline[0].category).toBe('ORDER');
    expect(dossier.timeline[1].category).toBe('BANK');
    expect(dossier.timeline[2].category).toBe('FORENSIC');
    expect(dossier.timeline[3].category).toBe('ACTION');
  });

  it('should build dispute dossier seamlessly from active FSM Order Context', () => {
    let fsm = createFsmOrder({
      orderId: 'ORD-FSM-77',
      side: 'BUY',
      amountCrypto: 200,
      amountFiat: 14000,
      price: 70,
      counterpartyName: 'Alexander Hamilton',
      counterpartyIdDoc: 'V-12345678',
    });

    // Inyectar evento bancario
    fsm = transitionOrderFsm(fsm, { type: 'ORDER_CONFIRMED' }).context;
    fsm = transitionOrderFsm(fsm, {
      type: 'BANK_PAYMENT_DETECTED',
      payload: {
        bankPayment: {
          bank: 'Mercantil',
          reference: '445566',
          payerName: 'Desconocido Tercero',
          amountFiat: 14000,
          timestamp: Date.now(),
        },
      },
    }).context;

    const dossier = buildDisputeDossierFromFsm(fsm, mockFraudAudit);

    expect(dossier.orderId).toBe('ORD-FSM-77');
    expect(dossier.evidenceSummary.expectedName).toBe('Alexander Hamilton');
    expect(dossier.evidenceSummary.actualPayerName).toBe('Desconocido Tercero');
    expect(dossier.appealTextEs).toContain('Mercantil');
    expect(dossier.appealTextEs).toContain('445566');
  });
});
