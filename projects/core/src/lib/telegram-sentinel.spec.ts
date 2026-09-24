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
  const AUTH_CHAT_ID = 123456789;

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

    it('permite /start a usuarios nuevos para descubrir su Chat ID y vincularlo', () => {
      const update: TelegramInboundUpdate = {
        update_id: 100,
        message: {
          message_id: 1,
          from: { id: 777888999, username: 'nuevo_operador' },
          chat: { id: 777888999, type: 'private' },
          text: '/start',
          date: Date.now(),
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(true);
      expect(res.command).toBe('/start');
      expect(res.action).toBe('STATUS');
      expect(res.responseMarkdown).toContain('777888999');
      expect(res.responseMarkdown).toContain('Para autorizar este chat');
    });

    it('ejecuta /start de usuario ya autorizado confirmando vinculación', () => {
      const update: TelegramInboundUpdate = {
        update_id: 101,
        message: {
          message_id: 2,
          from: { id: AUTH_CHAT_ID, username: 'admin' },
          chat: { id: AUTH_CHAT_ID, type: 'private' },
          text: '/start',
          date: Date.now(),
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(true);
      expect(res.command).toBe('/start');
      expect(res.responseMarkdown).toContain('ya está vinculado a este chat');
    });

    it('informa el Chat ID del intruso en el acceso denegado genérico', () => {
      const update: TelegramInboundUpdate = {
        update_id: 30,
        message: {
          message_id: 130,
          from: { id: 555111222, username: 'intruso' },
          chat: { id: 555111222, type: 'private' },
          text: '/status',
          date: Date.now(),
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(false);
      expect(res.responseMarkdown).toContain('ACCESO DENEGADO');
      expect(res.responseMarkdown).toContain('555111222');
    });

    it('no habilita otros comandos tras un /start de usuario no autorizado', () => {
      const startUpdate: TelegramInboundUpdate = {
        update_id: 31,
        message: {
          message_id: 131,
          from: { id: 555111222, username: 'intruso' },
          chat: { id: 555111222, type: 'private' },
          text: '/start',
          date: Date.now(),
        },
      };

      const startRes = dispatchTelegramUpdate(startUpdate, AUTH_CHAT_ID);
      expect(startRes.authorized).toBe(true);
      expect(startRes.command).toBe('/start');

      const statusUpdate: TelegramInboundUpdate = {
        update_id: 32,
        message: {
          message_id: 132,
          from: { id: 555111222, username: 'intruso' },
          chat: { id: 555111222, type: 'private' },
          text: '/status',
          date: Date.now(),
        },
      };

      const statusRes = dispatchTelegramUpdate(statusUpdate, AUTH_CHAT_ID);
      expect(statusRes.authorized).toBe(false);
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

    it('ejecuta comando /pausar como alias prioritario de killswitch', () => {
      const update: TelegramInboundUpdate = {
        update_id: 25,
        message: {
          message_id: 115,
          from: { id: AUTH_CHAT_ID },
          chat: { id: AUTH_CHAT_ID, type: 'private' },
          text: '/pausar',
          date: Date.now(),
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(true);
      expect(res.action).toBe('KILLSWITCH');
      expect(res.command).toBe('/pausar');
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

  describe('Parseabilidad MarkdownV2 de las respuestas (siempre enviables)', () => {
    // Caracteres reservados de MarkdownV2 que en NUESTROS mensajes solo pueden
    // aparecer escapados (fuera de los spans de código): [ ] ( ) ~ > # + - = | { } . !
    const NON_STRUCTURAL_RESERVED = /[\[\]()~>#+=|{}.!\-]/;

    function expectParseableMarkdownV2(markdown: string): void {
      const tokens = markdown.split('`');
      let violation: string | undefined;
      tokens.forEach((token, idx) => {
        if (idx % 2 !== 0) return; // dentro de un span de código la puntuación es literal
        for (let i = 0; i < token.length; i++) {
          const ch = token[i];
          if (NON_STRUCTURAL_RESERVED.test(ch) && token[i - 1] !== '\\') {
            violation =
              `carácter reservado '${ch}' sin escapar` +
              ` en "...${token.slice(Math.max(0, i - 18), i + 18)}..."`;
            break;
          }
        }
      });
      expect(violation, violation).toBeUndefined();

      // Sanidad estructural básica: delimitadores balanceados, sin backslash
      // colgante y sin saltos de línea dentro de spans de código.
      expect((markdown.match(/`/g) ?? []).length % 2).toBe(0);
      expect((markdown.match(/\*/g) ?? []).length % 2).toBe(0);
      expect(markdown).not.toMatch(/\\$/);
      (markdown.match(/`[^`]*`/g) ?? []).forEach((span) =>
        expect(span).not.toContain('\n'),
      );
    }

    it('la respuesta de /start para un usuario no autorizado es parseable', () => {
      const update: TelegramInboundUpdate = {
        update_id: 200,
        message: {
          message_id: 1,
          from: { id: 777888999, username: 'nuevo_operador' },
          chat: { id: 777888999, type: 'private' },
          text: '/start',
          date: Date.now(),
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(true);
      expect(res.responseMarkdown).toContain('777888999');
      expect(res.responseMarkdown).toContain('Reglas de Riesgo');
      expectParseableMarkdownV2(res.responseMarkdown);
    });

    it('la respuesta de /start para un usuario autorizado es parseable y confirma la vinculación', () => {
      const update: TelegramInboundUpdate = {
        update_id: 201,
        message: {
          message_id: 2,
          from: { id: AUTH_CHAT_ID, username: 'admin' },
          chat: { id: AUTH_CHAT_ID, type: 'private' },
          text: '/start',
          date: Date.now(),
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(true);
      expect(res.responseMarkdown).toContain('ya está vinculado a este chat');
      expectParseableMarkdownV2(res.responseMarkdown);
    });

    it('la respuesta de acceso denegado genérico es parseable e incluye el Chat ID del intruso', () => {
      const update: TelegramInboundUpdate = {
        update_id: 202,
        message: {
          message_id: 3,
          from: { id: 555111222, username: 'intruso' },
          chat: { id: 555111222, type: 'private' },
          text: '/spreads',
          date: Date.now(),
        },
      };

      const res = dispatchTelegramUpdate(update, AUTH_CHAT_ID);
      expect(res.authorized).toBe(false);
      expect(res.responseMarkdown).toContain('ACCESO DENEGADO');
      expect(res.responseMarkdown).toContain('555111222');
      expectParseableMarkdownV2(res.responseMarkdown);
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
