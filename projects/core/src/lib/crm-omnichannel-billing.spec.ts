import { describe, it, expect } from 'vitest';
import {
  evaluateMeta24hFreeWindow,
  classifyAndDraftAiResponse,
  buildCopyableBankBubbles,
  calculateBillingDocumentTotals,
  formatDocumentForMessaging,
  buildWhatsAppDirectUrl,
  buildGeminiMultimodalOcrPayload,
  parseGeminiOcrResponse,
  type BillingLineItem,
  type CrmBillingDocument,
} from './crm-omnichannel-billing';
import {
  type PipelineDeal,
  type CrmBankAccount,
} from './client-compliance-intelligence';

describe('crm-omnichannel-billing domain engine', () => {
  describe('evaluateMeta24hFreeWindow', () => {
    it('should return FREE_0_USD and open when message was sent 2 hours ago', () => {
      const now = 1_700_000_000_000;
      const twoHoursAgo = now - 2 * 3600 * 1000;

      const result = evaluateMeta24hFreeWindow(twoHoursAgo, now);

      expect(result.isOpen).toBe(true);
      expect(result.costStatus).toBe('FREE_0_USD');
      expect(result.remainingMinutes).toBe(22 * 60);
      expect(result.expiresAtMs).toBe(twoHoursAgo + 86_400_000);
    });

    it('should return TEMPLATE_REQUIRED and closed when 24h window has passed', () => {
      const now = 1_700_000_000_000;
      const twentyFiveHoursAgo = now - 25 * 3600 * 1000;

      const result = evaluateMeta24hFreeWindow(twentyFiveHoursAgo, now);

      expect(result.isOpen).toBe(false);
      expect(result.costStatus).toBe('TEMPLATE_REQUIRED');
      expect(result.remainingMinutes).toBe(0);
    });

    it('should safely handle null, undefined, or invalid timestamps', () => {
      const resultNull = evaluateMeta24hFreeWindow(null);
      expect(resultNull.isOpen).toBe(false);
      expect(resultNull.costStatus).toBe('TEMPLATE_REQUIRED');

      const resultZero = evaluateMeta24hFreeWindow(0);
      expect(resultZero.isOpen).toBe(false);

      const resultNan = evaluateMeta24hFreeWindow(NaN);
      expect(resultNan.isOpen).toBe(false);
    });
  });

  describe('classifyAndDraftAiResponse', () => {
    it('should classify P2P exchange inquiry and suggest deal creation', () => {
      const text = 'Buenas tardes, ¿a qué tasa tienen el USDT para comprar por Pago Móvil?';
      const result = classifyAndDraftAiResponse(text, [], 'P2P_DESK', {
        businessDisplayName: 'CryptoDesk P2P',
      });

      expect(result.targetScope).toBe('P2P_DESK');
      expect(result.detectedIntent).toBe('P2P_EXCHANGE');
      expect(result.recommendedKanbanAction).toBe('CREATE_P2P_DEAL');
      expect(result.suggestedReplyText).toContain('CryptoDesk P2P');
      expect(result.suggestedReplyText).toContain('USDT');
    });

    it('should classify commercial 360 inquiry and suggest quote deal creation', () => {
      const text = 'Hola, requiero un presupuesto por la mano de obra del mantenimiento y repuestos';
      const result = classifyAndDraftAiResponse(text, [], 'P2P_DESK');

      expect(result.targetScope).toBe('FINANCE_360');
      expect(result.detectedIntent).toBe('QUOTE_INVOICE_REQUEST');
      expect(result.recommendedKanbanAction).toBe('CREATE_360_QUOTE_DEAL');
      expect(result.suggestedReplyText).toContain('cotización o factura');
    });

    it('should extract reference ID and detect duplicates when collision exists', () => {
      const existingDeal: PipelineDeal = {
        id: 'DEAL-99',
        scope: 'P2P_DESK',
        title: 'Venta 100 USDT',
        contactId: 'CNT-1',
        contactName: 'Carlos',
        bankAccountId: 'BNK-1',
        bankName: 'Banesco',
        stage: 'STAGE_2_TRANSIT',
        fiatCurrency: 'VES',
        cryptoAmountUsdt: 100,
        appliedRate: 50,
        replacementRate: 50,
        totalFiatAmount: 5000,
        paidFiatAmount: 0,
        netProfitUsdt: 2,
        bankReferenceId: '987654321',
        quoteTtlMinutes: 15,
        quotedAt: Date.now(),
        isRateExpired: false,
        timeline: [],
        createdAt: Date.now(),
        closedAt: null,
      };

      const text = 'Listo amigo, ya te transferí. Aquí está la ref: 987654321';
      const result = classifyAndDraftAiResponse(text, [existingDeal], 'P2P_DESK');

      expect(result.detectedIntent).toBe('PAYMENT_PROOF');
      expect(result.extractedReferenceId).toBe('987654321');
      expect(result.isDuplicateReference).toBe(true);
      expect(result.collidingDealId).toBe('DEAL-99');
      expect(result.recommendedKanbanAction).toBe('NONE');
      expect(result.suggestedReplyText).toContain('asociada a una operación previa');
    });

    it('should suggest attaching reference when reference is fresh and unique', () => {
      const text = 'Ya pagué los bs, comprobante número 11223344';
      const result = classifyAndDraftAiResponse(text, [], 'P2P_DESK');

      expect(result.detectedIntent).toBe('PAYMENT_PROOF');
      expect(result.extractedReferenceId).toBe('11223344');
      expect(result.isDuplicateReference).toBe(false);
      expect(result.recommendedKanbanAction).toBe('ATTACH_PAYMENT_REF');
      expect(result.suggestedReplyText).toContain('Comprobante recibido');
    });
  });

  describe('buildCopyableBankBubbles', () => {
    it('should extract clean document and phone/account numbers without dashes or spaces', () => {
      const bank: CrmBankAccount = {
        id: 'BNK-1',
        scope: 'P2P_DESK',
        bankName: 'Banesco',
        currency: 'VES',
        holderDetailsText: 'Juan Pérez\nV- 25.123.456\nPago Móvil: 0414-1234567\nCuenta: 01340001000012345678',
        currentBalanceFiat: 1000,
        maxDailyCapFiat: 100000,
        feePct: 0.3,
        maxBurstTxPer15Min: 5,
      };

      const result = buildCopyableBankBubbles(bank, 4500.5);

      expect(result.headerBubble).toContain('Banesco (VES) - Juan Pérez');
      expect(result.docIdBubble).toBe('V25123456');
      expect(result.accountOrPhoneBubble).toBe('04141234567');
      expect(result.amountBubble).toBe('4500.50');
      expect(result.bubbles).toEqual([
        result.headerBubble,
        'V25123456',
        '04141234567',
        '4500.50',
      ]);
      expect(result.formattedBlock).toContain('`V25123456`');
      expect(result.formattedBlock).toContain('`04141234567`');
      expect(result.formattedBlock).toContain('`4500.50 VES`');
    });
  });

  describe('calculateBillingDocumentTotals', () => {
    it('should compute subtotal, discount, tax, totalUsdt, and totalFiat precisely', () => {
      const items: BillingLineItem[] = [
        {
          id: '1',
          description: 'Servicio de mantenimiento',
          quantity: 2,
          unitPriceUsdt: 50,
          category: 'LABOR_SERVICE',
        },
        {
          id: '2',
          description: 'Filtro de repuesto',
          quantity: 1,
          unitPriceUsdt: 30,
          category: 'PRODUCT',
        },
      ];

      // Subtotal = 2*50 + 1*30 = 130 USDT
      // Discount = 10 USDT -> 120 USDT
      // Tax = 16% of 120 = 19.2 USDT -> Total = 139.20 USDT
      // Fiat Rate (VES) = 60 -> Total Fiat = 139.20 * 60 = 8352.00 VES
      const totals = calculateBillingDocumentTotals(items, 10, 16, 60);

      expect(totals.subtotalUsdt).toBe(130);
      expect(totals.discountUsdt).toBe(10);
      expect(totals.taxOrFeeUsdt).toBe(19.2);
      expect(totals.totalUsdt).toBe(139.2);
      expect(totals.totalFiat).toBe(8352);
    });

    it('should guard against NaN or negative inputs', () => {
      const totals = calculateBillingDocumentTotals(
        [{ id: '1', description: 'Item', quantity: -5, unitPriceUsdt: NaN, category: 'PRODUCT' }],
        -10,
        -5,
        -1,
      );

      expect(totals.subtotalUsdt).toBe(0);
      expect(totals.discountUsdt).toBe(0);
      expect(totals.taxOrFeeUsdt).toBe(0);
      expect(totals.totalUsdt).toBe(0);
      expect(totals.totalFiat).toBe(0);
    });
  });

  describe('formatDocumentForMessaging', () => {
    it('should format a professional WhatsApp message with items and totals', () => {
      const doc: CrmBillingDocument = {
        id: 'DOC-1',
        docNumber: 'PRE-0001',
        scope: 'FINANCE_360',
        docType: 'PRESUPUESTO_QUOTE',
        contactId: 'CNT-1',
        contactName: 'Empresa Demo C.A.',
        contactDocId: 'J-12345678-0',
        fiatCurrency: 'VES',
        exchangeRate: 50,
        items: [
          {
            id: 'IT-1',
            description: 'Instalación Servidor',
            quantity: 1,
            unitPriceUsdt: 100,
            category: 'LABOR_SERVICE',
          },
        ],
        subtotalUsdt: 100,
        discountUsdt: 0,
        taxOrFeeUsdt: 0,
        totalUsdt: 100,
        totalFiat: 5000,
        paymentInstructionsText: 'Pago Móvil disponible',
        status: 'DRAFT',
        createdAt: 1_700_000_000_000,
      };

      const msg = formatDocumentForMessaging(doc);

      expect(msg).toContain('PRESUPUESTO / COTIZACIÓN');
      expect(msg).toContain('PRE-0001');
      expect(msg).toContain('Empresa Demo C.A.');
      expect(msg).toContain('Instalación Servidor - $100.00 USDT');
      expect(msg).toContain('TOTAL A PAGAR: $100.00 USDT');
      expect(msg).toContain('TOTAL EN VES: 5.000,00 VES');
    });
  });

  describe('buildWhatsAppDirectUrl', () => {
    it('should normalize Venezuela national phone prefix and build valid url', () => {
      const url = buildWhatsAppDirectUrl('0414-1234567', 'Hola qué tal');
      expect(url).toBe('https://wa.me/584141234567?text=Hola%20qu%C3%A9%20tal');
    });

    it('should normalize Colombia phone prefix and build valid url', () => {
      const url = buildWhatsAppDirectUrl('3001234567', 'Cotización');
      expect(url).toBe('https://wa.me/573001234567?text=Cotizaci%C3%B3n');
    });
  });

  describe('buildGeminiMultimodalOcrPayload and parseGeminiOcrResponse', () => {
    it('should build valid Gemini API REST payload', () => {
      const payload = buildGeminiMultimodalOcrPayload('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==') as any;

      expect(payload.contents[0].parts[0].text).toContain('Extract the following structured JSON');
      expect(payload.contents[0].parts[1].inlineData.mimeType).toBe('image/png');
      expect(payload.contents[0].parts[1].inlineData.data).toBe('iVBORw0KGgoAAAANSUhEUg==');
    });

    it('should parse raw JSON and markdown wrapped responses cleanly', () => {
      const rawMarkdown = '```json\n{"bank": "Banesco", "reference": "123456789", "amount": 1500.5, "currency": "VES"}\n```';
      const parsed = parseGeminiOcrResponse(rawMarkdown);

      expect(parsed.bank).toBe('Banesco');
      expect(parsed.reference).toBe('123456789');
      expect(parsed.amount).toBe(1500.5);
      expect(parsed.currency).toBe('VES');
    });

    it('should gracefully handle malformed responses', () => {
      const parsed = parseGeminiOcrResponse('Error: cannot extract receipt data');

      expect(parsed.bank).toBeNull();
      expect(parsed.reference).toBeNull();
      expect(parsed.amount).toBeNull();
      expect(parsed.rawNotes).toBe('Error: cannot extract receipt data');
    });
  });
});
