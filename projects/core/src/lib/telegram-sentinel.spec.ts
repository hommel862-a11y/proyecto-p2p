import { describe, it, expect } from 'vitest';
import {
  escapeMarkdownV2,
  formatSpreadAlertMessage,
  formatFraudAlertMessage,
  formatReceiptAuditTelegramMessage,
  formatBcvIntelligenceTelegramMessage,
  formatBankLimitsTelegramMessage,
  buildFraudAlertKeyboard,
  buildRepricerControlKeyboard,
  dispatchTelegramUpdate,
  TelegramInboundUpdate,
} from './telegram-sentinel';

describe('TelegramSentinel: Centro de Alertas y Despacho Remoto', () => {
  describe('escapeMarkdownV2 (Seguridad de Caracteres Reservados)', () => {
    it('escapa correctamente caracteres reservados de Telegram MarkdownV2', () => {
      const raw = 'Spread: 2.5% [USDT/VES] (Ref #12345) - Ganancia +15.00$!';
      const escaped = escapeMarkdownV2(raw);
      expect(escaped).toContain('\\[USDT/VES\\]');
      expect(escaped).toContain('\\(Ref \\#12345\\)');
      expect(escaped).toContain('2\\.5%');
      expect(escaped).toContain('\\+15\\.00$\\!');
    });
  });

  describe('Formateadores de Mensajes Institucionales', () => {
    it('genera tarjeta MarkdownV2 para alerta de spread récord', () => {
      const msg = formatSpreadAlertMessage({
        pair: 'USDT/VES',
        buyPrice: 800.5,
        sellPrice: 825.0,
        netSpreadPct: 3.06,
        bank: 'Banesco',
      });

      expect(msg).toContain('ALERTA DE SPREAD');
      expect(msg).toContain('Banesco');
      expect(msg).toContain('USDT/VES');
    });

    it('genera tarjeta MarkdownV2 para alerta crítica de estafa triangular', () => {
      const msg = formatFraudAlertMessage({
        orderId: 'ORD-9912',
        riskLevel: 'CRITICAL',
        score: 75,
        payerName: 'Pedro Ramirez',
        verifiedName: 'Carlos Perez',
        flags: ['THIRD_PARTY_PAYER', 'ID_DOCUMENT_MISMATCH'],
      });

      expect(msg).toContain('ORD\\-9912');
      expect(msg).toContain('CRÍTICO');
      expect(msg).toContain('ESTAFA TRIANGULAR');
      expect(msg).toContain('Carlos Perez');
      expect(msg).toContain('Pedro Ramirez');
    });
  });

  describe('Constructor de Teclados Interactivos (Inline Keyboards)', () => {
    it('construye botones de acción para alerta de fraude', () => {
      const kb = buildFraudAlertKeyboard('ORD-9912');
      expect(kb.inline_keyboard.length).toBeGreaterThan(0);
      const allButtons = kb.inline_keyboard.flat();
      expect(allButtons.some((b) => b.callback_data === 'DISPUTE_ORD-9912')).toBe(true);
      expect(allButtons.some((b) => b.callback_data === 'HOLD_ORD-9912')).toBe(true);
    });

    it('construye botones de control para el bot repricer', () => {
      const kb = buildRepricerControlKeyboard();
      const allButtons = kb.inline_keyboard.flat();
      expect(allButtons.some((b) => b.callback_data === 'BOT_KILLSWITCH')).toBe(true);
      expect(allButtons.some((b) => b.callback_data === 'BOT_RESUME')).toBe(true);
      expect(allButtons.some((b) => b.callback_data === 'BOT_STATUS')).toBe(true);
    });
  });

  describe('dispatchTelegramUpdate (Dispatcher Seguro y Ruteo de Comandos)', () => {
    const AUTH_CHAT_ID = 123456789;

    it('rechaza mensajes de usuarios no autorizados (autenticación estricta)', () => {
      const update: TelegramInboundUpdate = {
        update_id: 1,
        message: {
          message_id: 10,
          from: { id: 999999999, username: 'hacker' },
          chat: { id: 999999999, type: 'private' },
          text: '/killswitch',
          date: Date.now(),
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(false);
      expect(res.responseMarkdown).toContain('NO AUTORIZADO');
    });

    it('ejecuta comando /killswitch de administrador autorizado', () => {
      const update: TelegramInboundUpdate = {
        update_id: 2,
        message: {
          message_id: 11,
          from: { id: AUTH_CHAT_ID, username: 'admin' },
          chat: { id: AUTH_CHAT_ID, type: 'private' },
          text: '/killswitch',
          date: Date.now(),
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(true);
      expect(res.action).toBe('KILLSWITCH');
      expect(res.responseMarkdown).toContain('KILLSWITCH ACTIVADO');
    });

    it('ejecuta comando /status y devuelve estado del terminal', () => {
      const update: TelegramInboundUpdate = {
        update_id: 3,
        message: {
          message_id: 12,
          from: { id: AUTH_CHAT_ID },
          chat: { id: AUTH_CHAT_ID, type: 'private' },
          text: '/status',
          date: Date.now(),
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(true);
      expect(res.action).toBe('STATUS');
    });

    it('procesa callback de botón interactivo de disputa', () => {
      const update: TelegramInboundUpdate = {
        update_id: 4,
        callback_query: {
          id: 'cb-1',
          from: { id: AUTH_CHAT_ID },
          data: 'DISPUTE_ORD-5501',
          message: { message_id: 20, chat: { id: AUTH_CHAT_ID } },
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(true);
      expect(res.action).toBe('DISPUTE_ORDER');
      expect(res.orderId).toBe('ORD-5501');
      expect(res.responseMarkdown).toContain('ORD\\-5501');
    });

    it('procesa foto de comprobante bancario entrante para auditoría forense', () => {
      const update: TelegramInboundUpdate = {
        update_id: 5,
        message: {
          message_id: 15,
          from: { id: AUTH_CHAT_ID },
          chat: { id: AUTH_CHAT_ID, type: 'private' },
          photo: [
            { file_id: 'thumb_id', file_unique_id: 'u1', width: 100, height: 100 },
            { file_id: 'highres_id', file_unique_id: 'u2', width: 800, height: 1200 },
          ],
          date: Date.now(),
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(true);
      expect(res.action).toBe('AUDIT_RECEIPT');
      expect(res.fileId).toBe('highres_id');
      expect(res.responseMarkdown).toContain('COMPROBANTE BANCARIO RECIBIDO');
    });

    it('procesa comandos /bcv y /bancos', () => {
      const updateBcv: TelegramInboundUpdate = {
        update_id: 6,
        message: {
          message_id: 16,
          from: { id: AUTH_CHAT_ID },
          chat: { id: AUTH_CHAT_ID, type: 'private' },
          text: '/bcv',
          date: Date.now(),
        },
      };
      const resBcv = dispatchTelegramUpdate(updateBcv, AUTH_CHAT_ID);
      expect(resBcv.authorized).toBe(true);
      expect(resBcv.action).toBe('BCV');

      const updateBancos: TelegramInboundUpdate = {
        update_id: 7,
        message: {
          message_id: 17,
          from: { id: AUTH_CHAT_ID },
          chat: { id: AUTH_CHAT_ID, type: 'private' },
          text: '/bancos',
          date: Date.now(),
        },
      };
      const resBancos = dispatchTelegramUpdate(updateBancos, AUTH_CHAT_ID);
      expect(resBancos.authorized).toBe(true);
      expect(resBancos.action).toBe('BANCOS');
    });
  });

  describe('Nuevos Formateadores Pro (Auditoría Forense, BCV & Bancos)', () => {
    it('formatea reporte forense instantáneo de comprobante bancario', () => {
      const msg = formatReceiptAuditTelegramMessage({
        receiptNumber: '08927461',
        bank: 'Banesco',
        amountVes: 15420.5,
        extractedName: 'Carlos Alberto Perez Gomez',
        counterpartyName: 'Carlos Perez',
        nameSimilarityPct: 98.5,
        score: 95,
        level: 'SAFE',
        recommendation: 'Liberar Criptoactivo de inmediato',
      });

      expect(msg).toContain('AUDITORÍA FORENSE INSTANTÁNEA');
      expect(msg).toContain('Banesco');
      expect(msg).toContain('08927461');
      expect(msg).toContain('98\\.5%');
      expect(msg).toContain('SAFE');
    });

    it('formatea reporte de macro-inteligencia BCV', () => {
      const msg = formatBcvIntelligenceTelegramMessage({
        parallelRate: 815.0,
        bcvRate: 685.0,
        gapPct: 18.98,
        gapVes: 130.0,
        zone: 'NORMAL',
        phase: 'PRE_INTERVENTION_COMPRESSION',
        nextExpectedIntervention: 'Lunes 09:30 AM VET',
        probabilityPct: 85,
        actionLabel: 'VENDER USDT EN MÁXIMOS',
        timingNotice: 'Antes de las 9:30 AM',
      });

      expect(msg).toContain('INTELIGENCIA CAMBIARIA BCV');
      expect(msg).toContain('815\\.00 Bs');
      expect(msg).toContain('685\\.00 Bs');
      expect(msg).toContain('VENDER USDT EN MÁXIMOS');
    });

    it('formatea estado y límites de cupos bancarios', () => {
      const msg = formatBankLimitsTelegramMessage([
        {
          bankName: 'Banesco',
          spentTodayVes: 250000,
          dailyLimitVes: 300000,
          consumedPct: 83,
          txCount: 12,
          maxTx: 20,
          isOverLimit: false,
        },
      ]);

      expect(msg).toContain('CUPOS BANCARIOS');
      expect(msg).toContain('Banesco');
      expect(msg).toContain('LÍMITE PRÓXIMO');
    });
  });
});
