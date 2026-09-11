import { describe, it, expect } from 'vitest';
import {
  calculateNameSimilarity,
  validateBankReference,
  evaluateFraudRisk,
  FraudShieldAuditResult,
  FraudEvaluationParams,
} from './fraud-shield';
import { BankReceiptRecord } from './receipt-ocr';

describe('FraudShield: Escudo Forense Anti-Fraude & Detección de Estafa Triangular', () => {
  describe('calculateNameSimilarity (Validación Cruzada de Identidad)', () => {
    it('debe reconocer nombres idénticos con score 1.0', () => {
      const res = calculateNameSimilarity('Carlos Alberto Perez Gomez', 'Carlos Alberto Perez Gomez');
      expect(res.isMatch).toBe(true);
      expect(res.score).toBe(1.0);
      expect(res.missingTokens.length).toBe(0);
    });

    it('debe tolerar diferencias de mayúsculas, acentos y orden de apellidos', () => {
      const res = calculateNameSimilarity('PÉREZ GÓMEZ CARLOS', 'Carlos Alberto Perez');
      expect(res.isMatch).toBe(true);
      expect(res.score).toBeGreaterThanOrEqual(0.65);
    });

    it('debe detectar discrepancia total de titular (Tercero no autorizado)', () => {
      const res = calculateNameSimilarity('Maria Eugenia Rodriguez', 'Juan Carlos Perez');
      expect(res.isMatch).toBe(false);
      expect(res.score).toBeLessThan(0.3);
    });

    it('debe ignorar conectores y palabras vacías comunes como DE, DEL, LA, LOS', () => {
      const res = calculateNameSimilarity('Jose De La Trinidad Blanco', 'Jose Blanco');
      expect(res.isMatch).toBe(true);
      expect(res.score).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe('validateBankReference (Integridad de Referencias Bancarias)', () => {
    it('debe validar referencia típica de Banesco (8 dígitos numéricos válidos)', () => {
      const res = validateBankReference('BANESCO', '09283741');
      expect(res.isValid).toBe(true);
      expect(res.bank).toBe('BANESCO');
    });

    it('debe rechazar referencia de Banesco con caracteres alfabéticos o longitud inválida', () => {
      const resLetters = validateBankReference('BANESCO', '0928AB41');
      expect(resLetters.isValid).toBe(false);

      const resShort = validateBankReference('BANESCO', '1234');
      expect(resShort.isValid).toBe(false);
    });

    it('debe rechazar números falsos o patrones triviales (ej. 00000000 o 12345678)', () => {
      const resZeros = validateBankReference('BANESCO', '00000000');
      expect(resZeros.isValid).toBe(false);

      const resSeq = validateBankReference('BDV', '1234567890');
      expect(resSeq.isValid).toBe(false);
    });

    it('debe validar referencia de Banco de Venezuela (10-14 dígitos)', () => {
      const res = validateBankReference('BDV', '0029384716');
      expect(res.isValid).toBe(true);
    });

    it('debe validar referencia de Nequi con prefijo M', () => {
      const res = validateBankReference('NEQUI', 'M9482014');
      expect(res.isValid).toBe(true);
    });
  });

  describe('evaluateFraudRisk (Scoring Forense y Detección de Estafa)', () => {
    const validReceipt: BankReceiptRecord = {
      id: 'rcpt-1',
      reference: '08392018',
      amount: 5400.0,
      currency: 'VES',
      bank: 'BANESCO',
      bankDisplayName: 'Banesco Banco Universal',
      payerName: 'Carlos Alberto Perez',
      payerId: 'V-19823451',
      beneficiaryName: 'Mi Negocio P2P C.A.',
      timestamp: new Date().toISOString(),
      rawText: 'Transferencia Banesco Ref 08392018 Monto 5400,00 Bs Carlos Perez',
      confidenceScore: 0.95,
    };

    it('debe clasificar como SAFE y AUTO_RELEASE_OK cuando todos los datos coinciden', () => {
      const params: FraudEvaluationParams = {
        orderId: 'ORD-1001',
        orderAmount: 5400.0,
        orderCurrency: 'VES',
        advertiserVerifiedName: 'Carlos Perez',
        advertiserIdDocument: 'V-19823451',
        receipt: validReceipt,
      };

      const audit: FraudShieldAuditResult = evaluateFraudRisk(params);
      expect(audit.riskLevel).toBe('SAFE');
      expect(audit.recommendation).toBe('AUTO_RELEASE_OK');
      expect(audit.overallScore).toBeLessThan(20);
      expect(audit.flags).toEqual([]);
    });

    it('debe disparar THIRD_PARTY_PAYER y CRITICAL ante titular completamente diferente (Estafa Triangular)', () => {
      const params: FraudEvaluationParams = {
        orderId: 'ORD-1002',
        orderAmount: 5400.0,
        orderCurrency: 'VES',
        advertiserVerifiedName: 'Carlos Perez',
        receipt: {
          ...validReceipt,
          payerName: 'Pedro Jose Ramirez',
          payerId: 'V-25111222',
        },
      };

      const audit: FraudShieldAuditResult = evaluateFraudRisk(params);
      expect(audit.riskLevel).toBe('CRITICAL');
      expect(audit.recommendation).toBe('LOCK_AND_DISPUTE');
      expect(audit.overallScore).toBeGreaterThanOrEqual(60);
      expect(audit.flags).toContain('THIRD_PARTY_PAYER');
      expect(audit.disputeTemplateText).toContain('TERCEROS NO AUTORIZADOS');
    });

    it('debe detectar discrepancia de monto (AMOUNT_MISMATCH)', () => {
      const params: FraudEvaluationParams = {
        orderId: 'ORD-1003',
        orderAmount: 5400.0,
        orderCurrency: 'VES',
        advertiserVerifiedName: 'Carlos Perez',
        receipt: {
          ...validReceipt,
          amount: 5000.0,
        },
      };

      const audit = evaluateFraudRisk(params);
      expect(audit.flags).toContain('AMOUNT_MISMATCH');
      expect(audit.overallScore).toBeGreaterThanOrEqual(40);
      expect(audit.amountDifference).toBe(400.0);
    });

    it('debe alertar inmediatamente si la referencia o cédula está en la lista negra (BLACKLISTED_ENTITY)', () => {
      const params: FraudEvaluationParams = {
        orderId: 'ORD-1004',
        orderAmount: 5400.0,
        orderCurrency: 'VES',
        advertiserVerifiedName: 'Carlos Perez',
        receipt: validReceipt,
        blacklistedIds: ['V-19823451'],
      };

      const audit = evaluateFraudRisk(params);
      expect(audit.riskLevel).toBe('CRITICAL');
      expect(audit.flags).toContain('BLACKLISTED_ENTITY');
      expect(audit.recommendation).toBe('LOCK_AND_DISPUTE');
    });

    it('debe detectar reutilización rápida de referencia bancaria (RAPID_REPEAT_REFERENCE)', () => {
      const params: FraudEvaluationParams = {
        orderId: 'ORD-1005',
        orderAmount: 5400.0,
        orderCurrency: 'VES',
        advertiserVerifiedName: 'Carlos Perez',
        receipt: validReceipt,
        knownReferences: ['08392018'],
      };

      const audit = evaluateFraudRisk(params);
      expect(audit.flags).toContain('RAPID_REPEAT_REFERENCE');
      expect(audit.recommendation).toBe('LOCK_AND_DISPUTE');
    });

    it('debe generar plantilla de disputa lista para copiar en el chat de Binance', () => {
      const params: FraudEvaluationParams = {
        orderId: 'ORD-1006',
        orderAmount: 5400.0,
        orderCurrency: 'VES',
        advertiserVerifiedName: 'Carlos Perez',
        receipt: {
          ...validReceipt,
          payerName: 'Pedro Ramirez',
        },
      };

      const audit = evaluateFraudRisk(params);
      expect(audit.disputeTemplateText).toBeTruthy();
      expect(audit.disputeTemplateText).toContain('ORD-1006');
      expect(audit.disputeTemplateText).toContain('Carlos Perez');
      expect(audit.disputeTemplateText).toContain('Pedro Ramirez');
    });
  });
});
