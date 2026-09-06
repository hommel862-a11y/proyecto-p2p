import { describe, it, expect } from 'vitest';
import {
  normalizeIdentityDoc,
  parseVesAmount,
  parseBankNotification,
  verifyReconciliation,
  type ExpectedTradePayment,
} from './bank-reconciliation';

describe('Bank Reconciliation & Anti-Triangulation Engine (Core)', () => {
  describe('normalizeIdentityDoc', () => {
    it('normalizes cédulas with spaces, dots, dashes and lowercase', () => {
      expect(normalizeIdentityDoc('v- 14.567.890')).toBe('V14567890');
      expect(normalizeIdentityDoc('14567890')).toBe('V14567890');
      expect(normalizeIdentityDoc('E - 82.111.222')).toBe('E82111222');
      expect(normalizeIdentityDoc('J-12345678-9')).toBe('J123456789');
    });
  });

  describe('parseVesAmount', () => {
    it('handles various Venezuelan and international currency number formats', () => {
      expect(parseVesAmount('Pago de Bs. 1.250,50 realizado')).toBe(1250.5);
      expect(parseVesAmount('Abono por 850,00')).toBe(850.0);
      expect(parseVesAmount('VES 14500.75')).toBe(14500.75);
      expect(parseVesAmount('Monto: 300 Bs')).toBe(300.0);
    });
  });

  describe('parseBankNotification', () => {
    it('correctly parses Mercantil Pago Móvil SMS/Email', () => {
      const msg = 'MERCANTIL: Recibiste un Pago Movil por Bs. 2.450,00 de CI: V-18.450.123 con Ref: 987654. Gracias.';
      const parsed = parseBankNotification(msg);

      expect(parsed.bank).toBe('MERCANTIL');
      expect(parsed.amountVes).toBe(2450.0);
      expect(parsed.reference).toBe('987654');
      expect(parsed.senderId).toBe('V18450123');
      expect(parsed.isParsed).toBe(true);
    });

    it('correctly parses Bancamiga Pago Móvil Notification', () => {
      const msg = 'Bancamiga informa: Abono por Pago Movil Bs. 15.000,00. Cedula: 19888777 Ref: 11223344.';
      const parsed = parseBankNotification(msg);

      expect(parsed.bank).toBe('BANCAMIGA');
      expect(parsed.amountVes).toBe(15000.0);
      expect(parsed.reference).toBe('11223344');
      expect(parsed.senderId).toBe('V19888777');
      expect(parsed.isParsed).toBe(true);
    });

    it('correctly parses Banesco Pago Móvil Notification', () => {
      const msg = 'Banesco te informa: Pago Movil por Bs. 850,50 de V12345678 Ref: 554433.';
      const parsed = parseBankNotification(msg);

      expect(parsed.bank).toBe('BANESCO');
      expect(parsed.amountVes).toBe(850.5);
      expect(parsed.reference).toBe('554433');
      expect(parsed.senderId).toBe('V12345678');
      expect(parsed.isParsed).toBe(true);
    });

    it('correctly parses BBVA Provincial Notification', () => {
      const msg = 'Provincial: Pago Movil recibido por Bs. 4.200,00 CI: V22334455 Ref: 887766.';
      const parsed = parseBankNotification(msg);

      expect(parsed.bank).toBe('PROVINCIAL');
      expect(parsed.amountVes).toBe(4200.0);
      expect(parsed.reference).toBe('887766');
      expect(parsed.senderId).toBe('V22334455');
      expect(parsed.isParsed).toBe(true);
    });
  });

  describe('verifyReconciliation (Anti-Triangulation)', () => {
    const expectedOrder: ExpectedTradePayment = {
      orderId: 'ORD-999',
      expectedAmountVes: 2450.0,
      counterpartyId: 'V-18.450.123',
      counterpartyName: 'Carlos Mendoza',
    };

    it('approves payment when amount and cédula match 100%', () => {
      const notification = parseBankNotification(
        'MERCANTIL: Recibiste un Pago Movil por Bs. 2.450,00 de CI: V18450123 con Ref: 987654.',
      );

      const res = verifyReconciliation(notification, expectedOrder);
      expect(res.status).toBe('VERIFIED_SAFE');
      expect(res.isSafeToRelease).toBe(true);
      expect(res.confidencePct).toBe(100);
      expect(res.message).toContain('VERIFICADO Y SEGURO');
    });

    it('BLOCKS payment and raises TRIANGULATION_ALERT when cédula differs', () => {
      // Third party transfer: someone else paid!
      const notification = parseBankNotification(
        'MERCANTIL: Recibiste un Pago Movil por Bs. 2.450,00 de CI: V29.999.000 con Ref: 987654.',
      );

      const res = verifyReconciliation(notification, expectedOrder);
      expect(res.status).toBe('TRIANGULATION_ALERT');
      expect(res.isSafeToRelease).toBe(false);
      expect(res.message).toContain('ALERTA DE TRIANGULACIÓN');
      expect(res.message).toContain('NO LIBERAR FONDOS');
    });

    it('flags AMOUNT_MISMATCH when paid amount is insufficient or wrong', () => {
      const notification = parseBankNotification(
        'MERCANTIL: Recibiste un Pago Movil por Bs. 2.000,00 de CI: V18450123 con Ref: 987654.',
      );

      const res = verifyReconciliation(notification, expectedOrder);
      expect(res.status).toBe('AMOUNT_MISMATCH');
      expect(res.isSafeToRelease).toBe(false);
      expect(res.amountDifferenceVes).toBe(450.0);
    });
  });
});
