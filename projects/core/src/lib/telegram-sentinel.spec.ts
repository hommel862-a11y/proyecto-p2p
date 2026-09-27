import { describe, it, expect } from 'vitest';
import {
  escapeMarkdownV2,
  formatSpreadAlertMessage,
  formatFraudAlertMessage,
  formatReceiptAuditTelegramMessage,
  formatBcvIntelligenceTelegramMessage,
  formatBankLimitsTelegramMessage,
  formatRadarTelegramMessage,
  formatMacroTelegramMessage,
  formatBacktestTelegramMessage,
  formatRepriceTelegramMessage,
  buildFraudAlertKeyboard,
  buildRepricerControlKeyboard,
  buildRepriceConfirmationKeyboard,
  buildRepriceCallbackData,
  parseRepriceCallbackData,
  dispatchTelegramUpdate,
  TelegramInboundUpdate,
} from './telegram-sentinel';

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
  (markdown.match(/`[^`]*`/g) ?? []).forEach((span) => expect(span).not.toContain('\n'));
}

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

  describe('Comandos Operativos V2 (/radar, /reprecio, /macro, /backtest)', () => {
    function message(text: string, updateId = 900): TelegramInboundUpdate {
      return {
        update_id: updateId,
        message: {
          message_id: updateId,
          from: { id: AUTH_CHAT_ID },
          chat: { id: AUTH_CHAT_ID, type: 'private' },
          text,
          date: Date.now(),
        },
      };
    }

    function callback(data: string, fromId = AUTH_CHAT_ID, updateId = 950): TelegramInboundUpdate {
      return {
        update_id: updateId,
        callback_query: {
          id: `cb-${updateId}`,
          from: { id: fromId },
          data,
          message: { message_id: updateId, chat: { id: AUTH_CHAT_ID } },
        },
      };
    }

    describe('/radar', () => {
      it('despacha RADAR_SCAN sin params cuando no recibe argumentos', () => {
        const res = dispatchTelegramUpdate(message('/radar'), AUTH_CHAT_ID);
        expect(res.authorized).toBe(true);
        expect(res.command).toBe('/radar');
        expect(res.action).toBe('RADAR_SCAN');
        expect(res.params).toEqual({});
        expectParseableMarkdownV2(res.responseMarkdown);
      });

      it('despacha RADAR_SCAN con bank y capital cuando recibe ambos argumentos', () => {
        const res = dispatchTelegramUpdate(message('/radar bcv 2000'), AUTH_CHAT_ID);
        expect(res.authorized).toBe(true);
        expect(res.action).toBe('RADAR_SCAN');
        expect(res.params).toEqual({ bank: 'bcv', capital: 2000 });
        expectParseableMarkdownV2(res.responseMarkdown);
      });

      it('interpreta un primer token numérico como capital y no como banco', () => {
        const res = dispatchTelegramUpdate(message('/radar 2000'), AUTH_CHAT_ID);
        expect(res.action).toBe('RADAR_SCAN');
        expect(res.params).toEqual({ capital: 2000 });
      });

      it('devuelve guía de parseo y ninguna acción cuando el capital no es numérico', () => {
        const res = dispatchTelegramUpdate(message('/radar bcv dosmil'), AUTH_CHAT_ID);
        expect(res.authorized).toBe(true);
        expect(res.action).toBeUndefined();
        expect(res.responseMarkdown).toContain('`/radar [banco] [capital]`');
        expectParseableMarkdownV2(res.responseMarkdown);
      });

      it('nunca lanza ante capital no finito y responde con la guía', () => {
        const res = dispatchTelegramUpdate(message('/radar bcv Infinity'), AUTH_CHAT_ID);
        expect(res.action).toBeUndefined();
        expect(res.responseMarkdown).toContain('`/radar [banco] [capital]`');
      });

      it('ignora argumentos extra sin lanzar', () => {
        const res = dispatchTelegramUpdate(message('/radar bcv 2000 3000 extra'), AUTH_CHAT_ID);
        expect(res.action).toBe('RADAR_SCAN');
        expect(res.params).toEqual({ bank: 'bcv', capital: 2000 });
      });
    });

    describe('/reprecio', () => {
      it('despacha REPRICE_REQUEST con los precios parseados y exige confirmación', () => {
        const res = dispatchTelegramUpdate(message('/reprecio 84.5 85.2'), AUTH_CHAT_ID);
        expect(res.authorized).toBe(true);
        expect(res.command).toBe('/reprecio');
        expect(res.action).toBe('REPRICE_REQUEST');
        expect(res.params).toEqual({ buyPrice: 84.5, sellPrice: 85.2 });
        expect(res.responseMarkdown).toContain('CONFIRMACIÓN REQUERIDA');
        expectParseableMarkdownV2(res.responseMarkdown);
      });

      it('no ejecuta nada en core: la acción es siempre REPRICE_REQUEST, no REPRICE_EXECUTE', () => {
        const res = dispatchTelegramUpdate(message('/reprecio 84.5 85.2'), AUTH_CHAT_ID);
        expect(res.action).not.toBe('REPRICE_EXECUTE');
      });

      it('rechaza argumentos faltantes devolviendo la guía de parseo', () => {
        const res = dispatchTelegramUpdate(message('/reprecio 84.5'), AUTH_CHAT_ID);
        expect(res.authorized).toBe(true);
        expect(res.action).toBeUndefined();
        expect(res.responseMarkdown).toContain('`/reprecio <buy> <sell>`');
        expectParseableMarkdownV2(res.responseMarkdown);
      });

      it('rechaza precios no numéricos devolviendo la guía de parseo', () => {
        const res = dispatchTelegramUpdate(message('/reprecio abc def'), AUTH_CHAT_ID);
        expect(res.action).toBeUndefined();
        expect(res.responseMarkdown).toContain('`/reprecio <buy> <sell>`');
      });

      it('rechaza precios no finitos devolviendo la guía de parseo', () => {
        const res = dispatchTelegramUpdate(message('/reprecio Infinity 85.2'), AUTH_CHAT_ID);
        expect(res.action).toBeUndefined();
        expect(res.responseMarkdown).toContain('`/reprecio <buy> <sell>`');
      });
    });

    describe('callbacks de confirmación de reprice', () => {
      it('REPRICE_CONFIRM parsea los precios del callback y despacha REPRICE_EXECUTE', () => {
        const res = dispatchTelegramUpdate(callback('REPRICE_CONFIRM:84.5:85.2'), AUTH_CHAT_ID);
        expect(res.authorized).toBe(true);
        expect(res.action).toBe('REPRICE_EXECUTE');
        expect(res.params).toEqual({ buyPrice: 84.5, sellPrice: 85.2 });
        expectParseableMarkdownV2(res.responseMarkdown);
      });

      it('REPRICE_CANCEL despacha la acción de cancelación sin params', () => {
        const res = dispatchTelegramUpdate(callback('REPRICE_CANCEL'), AUTH_CHAT_ID);
        expect(res.authorized).toBe(true);
        expect(res.action).toBe('REPRICE_CANCEL');
        expect(res.params).toBeUndefined();
        expectParseableMarkdownV2(res.responseMarkdown);
      });

      it('REPRICE_CONFIRM con precios no numéricos no ejecuta y devuelve la guía', () => {
        const res = dispatchTelegramUpdate(callback('REPRICE_CONFIRM:abc:def'), AUTH_CHAT_ID);
        expect(res.authorized).toBe(true);
        expect(res.action).toBeUndefined();
        expect(res.responseMarkdown).toContain('`/reprecio <buy> <sell>`');
        expectParseableMarkdownV2(res.responseMarkdown);
      });

      it('REPRICE_CONFIRM incompleto no ejecuta y devuelve la guía', () => {
        const res = dispatchTelegramUpdate(callback('REPRICE_CONFIRM:84.5'), AUTH_CHAT_ID);
        expect(res.action).toBeUndefined();
        expect(res.responseMarkdown).toContain('`/reprecio <buy> <sell>`');
      });

      it('niega los callbacks de confirmación a un usuario no autorizado', () => {
        const res = dispatchTelegramUpdate(
          callback('REPRICE_CONFIRM:84.5:85.2', 555111222),
          AUTH_CHAT_ID,
        );
        expect(res.authorized).toBe(false);
        expect(res.action).toBeUndefined();
        expect(res.responseMarkdown).toContain('NO AUTORIZADO');
        expectParseableMarkdownV2(res.responseMarkdown);
      });

      it('niega REPRICE_CANCEL y BACKTEST_RUN a un usuario no autorizado', () => {
        const cancel = dispatchTelegramUpdate(callback('REPRICE_CANCEL', 555111222), AUTH_CHAT_ID);
        expect(cancel.authorized).toBe(false);
        expect(cancel.action).toBeUndefined();

        const run = dispatchTelegramUpdate(callback('BACKTEST_RUN', 555111222), AUTH_CHAT_ID);
        expect(run.authorized).toBe(false);
        expect(run.action).toBeUndefined();
      });
    });

    describe('/macro', () => {
      it('despacha MACRO sin params', () => {
        const res = dispatchTelegramUpdate(message('/macro'), AUTH_CHAT_ID);
        expect(res.authorized).toBe(true);
        expect(res.command).toBe('/macro');
        expect(res.action).toBe('MACRO');
        expect(res.params).toBeUndefined();
        expectParseableMarkdownV2(res.responseMarkdown);
      });
    });

    describe('/backtest', () => {
      it('despacha BACKTEST_REQUEST con par y temporalidad', () => {
        const res = dispatchTelegramUpdate(message('/backtest usdt/buy 7d'), AUTH_CHAT_ID);
        expect(res.authorized).toBe(true);
        expect(res.command).toBe('/backtest');
        expect(res.action).toBe('BACKTEST_REQUEST');
        expect(res.params).toEqual({ pair: 'usdt/buy', timeframe: '7d' });
        expectParseableMarkdownV2(res.responseMarkdown);
      });

      it('despacha BACKTEST_REQUEST sin params cuando no recibe argumentos', () => {
        const res = dispatchTelegramUpdate(message('/backtest'), AUTH_CHAT_ID);
        expect(res.action).toBe('BACKTEST_REQUEST');
        expect(res.params).toEqual({});
        expectParseableMarkdownV2(res.responseMarkdown);
      });

      it('acepta solo el par cuando falta la temporalidad', () => {
        const res = dispatchTelegramUpdate(message('/backtest usdt/buy'), AUTH_CHAT_ID);
        expect(res.action).toBe('BACKTEST_REQUEST');
        expect(res.params).toEqual({ pair: 'usdt/buy' });
      });

      it('el callback BACKTEST_RUN despacha BACKTEST_EXECUTE', () => {
        const res = dispatchTelegramUpdate(callback('BACKTEST_RUN'), AUTH_CHAT_ID);
        expect(res.authorized).toBe(true);
        expect(res.action).toBe('BACKTEST_EXECUTE');
        expect(res.params).toBeUndefined();
        expectParseableMarkdownV2(res.responseMarkdown);
      });
    });

    describe('retrocompatibilidad del contrato previo', () => {
      it('no altera la acción de los comandos existentes', () => {
        const expectations: { text: string; action: string }[] = [
          { text: '/status', action: 'STATUS' },
          { text: '/spreads', action: 'SPREADS' },
          { text: '/bcv', action: 'BCV' },
          { text: '/bancos', action: 'BANCOS' },
          { text: '/killswitch', action: 'KILLSWITCH' },
          { text: '/pausar', action: 'KILLSWITCH' },
          { text: '/resume', action: 'RESUME' },
        ];

        expectations.forEach(({ text, action }, index) => {
          const res = dispatchTelegramUpdate(message(text, 1000 + index), AUTH_CHAT_ID);
          expect(res.authorized).toBe(true);
          expect(res.action, text).toBe(action);
          expect(res.command, text).toBe(text);
        });
      });

      it('no altera los callbacks existentes', () => {
        const dispute = dispatchTelegramUpdate(callback('DISPUTE_ORD-5501'), AUTH_CHAT_ID);
        expect(dispute.action).toBe('DISPUTE_ORDER');
        expect(dispute.orderId).toBe('ORD-5501');

        const killswitch = dispatchTelegramUpdate(callback('BOT_KILLSWITCH'), AUTH_CHAT_ID);
        expect(killswitch.action).toBe('KILLSWITCH');

        const resume = dispatchTelegramUpdate(callback('BOT_RESUME'), AUTH_CHAT_ID);
        expect(resume.action).toBe('RESUME');

        const status = dispatchTelegramUpdate(callback('BOT_STATUS'), AUTH_CHAT_ID);
        expect(status.action).toBe('STATUS');
      });

      it('no confunde un comando nuevo con un prefijo de uno existente', () => {
        const res = dispatchTelegramUpdate(message('/radares', 1200), AUTH_CHAT_ID);
        expect(res.action).not.toBe('RADAR_SCAN');
        expect(res.action).not.toBe('STATUS');
      });
    });
  });

  describe('Round-trip del payload de confirmación de reprice', () => {
    it('buildRepriceCallbackData emite el formato REPRICE_CONFIRM:<buy>:<sell>', () => {
      expect(buildRepriceCallbackData(84.5, 85.2)).toBe('REPRICE_CONFIRM:84.5:85.2');
    });

    it('el teclado de confirmación expone REPRICE_CONFIRM y REPRICE_CANCEL', () => {
      const kb = buildRepriceConfirmationKeyboard(84.5, 85.2);
      const buttons = kb.inline_keyboard.flat();
      expect(buttons.some((b) => b.callback_data === 'REPRICE_CONFIRM:84.5:85.2')).toBe(true);
      expect(buttons.some((b) => b.callback_data === 'REPRICE_CANCEL')).toBe(true);
    });

    it('el teclado generado por core se despacha de vuelta a los mismos precios', () => {
      const kb = buildRepriceConfirmationKeyboard(84.5, 85.2);
      const confirmData = kb.inline_keyboard
        .flat()
        .find((b) => b.callback_data?.startsWith('REPRICE_CONFIRM'))?.callback_data;
      expect(confirmData).toBeDefined();

      const res = dispatchTelegramUpdate(
        {
          update_id: 1300,
          callback_query: {
            id: 'cb-roundtrip',
            from: { id: 123456789 },
            data: confirmData,
            message: { message_id: 1300, chat: { id: 123456789 } },
          },
        },
        123456789,
      );

      expect(res.action).toBe('REPRICE_EXECUTE');
      expect(res.params).toEqual({ buyPrice: 84.5, sellPrice: 85.2 });
    });

    it('parseRepriceCallbackData devuelve los precios o undefined si no puede parsear', () => {
      expect(parseRepriceCallbackData('REPRICE_CONFIRM:84.5:85.2')).toEqual({
        buyPrice: 84.5,
        sellPrice: 85.2,
      });
      expect(parseRepriceCallbackData('REPRICE_CONFIRM:abc:def')).toBeUndefined();
      expect(parseRepriceCallbackData('REPRICE_CONFIRM:84.5')).toBeUndefined();
      expect(parseRepriceCallbackData('REPRICE_CANCEL')).toBeUndefined();
      expect(parseRepriceCallbackData('DISPUTE_ORD-1')).toBeUndefined();
    });
  });

  describe('Plantillas Operativas V2 (Radar, Macro, Backtest, Reprice)', () => {
    const RADAR_ROWS = [
      { bank: 'Banesco', price: 815.5, maxTc: 2000, volumeUsdt: 54000, spreadPct: 3.42 },
      { bank: 'Mercantil', price: 812.1, maxTc: 1500, volumeUsdt: 32000, spreadPct: 2.87 },
      { bank: 'BFC (Banesco Foreign)', price: 818.9, maxTc: 800, volumeUsdt: 12400, spreadPct: 1.95 },
    ];

    it('formatea el radar de gaps con el filtro aplicado y el top de brechas', () => {
      const msg = formatRadarTelegramMessage(RADAR_ROWS, { bank: 'bcv', capital: 2000 });

      expect(msg).toContain('RADAR');
      expect(msg).toContain('Banesco');
      expect(msg).toContain('Mercantil');
      expect(msg).toContain('3\\.42%');
      expect(msg).toContain('bcv');
      expect(msg).toContain('2000\\.00');
      expectParseableMarkdownV2(msg);
    });

    it('el radar sin filtro declara los filtros por defecto', () => {
      const msg = formatRadarTelegramMessage(RADAR_ROWS);
      expect(msg).toContain('todos');
      expectParseableMarkdownV2(msg);
    });

    it('el radar sin resultados no rompe el balance de MarkdownV2', () => {
      const msg = formatRadarTelegramMessage([], { bank: 'bcv' });
      expect(msg).toContain('bcv');
      expectParseableMarkdownV2(msg);
    });

    it('el radar no lanza ante métricas no finitas', () => {
      const msg = formatRadarTelegramMessage([
        { bank: 'X', price: Number.NaN, maxTc: Number.NaN, volumeUsdt: Number.NaN, spreadPct: Number.NaN },
      ]);
      expectParseableMarkdownV2(msg);
    });

    it('formatea el reporte macro consolidado', () => {
      const msg = formatMacroTelegramMessage({
        bcvRef: 685,
        parallelRef: 815,
        spreadPct: 18.98,
        volatility2hPct: 2.35,
        forecastNote: 'Ventana de intervencion en 48h',
      });

      expect(msg).toContain('MACRO');
      expect(msg).toContain('685\\.00');
      expect(msg).toContain('815\\.00');
      expect(msg).toContain('18\\.98%');
      expect(msg).toContain('2\\.35%');
      expect(msg).toContain('Ventana de intervencion en 48h');
      expectParseableMarkdownV2(msg);
    });

    it('el reporte macro omite el pronostico cuando no viene informado', () => {
      const withNote = formatMacroTelegramMessage({
        bcvRef: 685,
        parallelRef: 815,
        spreadPct: 18.98,
        volatility2hPct: 2.35,
        forecastNote: '   ',
      });
      expect(withNote).toContain('MACRO');
      expectParseableMarkdownV2(withNote);
    });

    it('formatea el reporte de backtest historico', () => {
      const msg = formatBacktestTelegramMessage({
        pair: 'usdt/buy',
        timeframe: '7d',
        trades: 42,
        winRatePct: 61.9,
        avgReturnPct: 1.84,
        maxDrawdownPct: -4.2,
        netReturnPct: 12.5,
      });

      expect(msg).toContain('BACKTEST');
      expect(msg).toContain('usdt/buy');
      expect(msg).toContain('7d');
      expect(msg).toContain('61\\.90%');
      expect(msg).toContain('\\-4\\.20%');
      expect(msg).toContain('12\\.50%');
      expectParseableMarkdownV2(msg);
    });

    it('el backtest no lanza ante métricas no finitas', () => {
      const msg = formatBacktestTelegramMessage({
        pair: 'usdt/buy',
        timeframe: '7d',
        trades: Number.NaN,
        winRatePct: Number.NaN,
        avgReturnPct: Number.NaN,
        maxDrawdownPct: Number.NaN,
        netReturnPct: Number.NaN,
      });
      expectParseableMarkdownV2(msg);
    });

    it('el prompt de reprice pide confirmación explícita y no afirma ejecución', () => {
      const msg = formatRepriceTelegramMessage({ buyPrice: 84.5, sellPrice: 85.2, confirmed: false });
      expect(msg).toContain('CONFIRMACIÓN REQUERIDA');
      expect(msg).toContain('84\\.50');
      expect(msg).toContain('85\\.20');
      expectParseableMarkdownV2(msg);
    });

    it('el estado confirmado del reprice reporta la ejecución', () => {
      const msg = formatRepriceTelegramMessage({ buyPrice: 84.5, sellPrice: 85.2, confirmed: true });
      expect(msg).not.toContain('CONFIRMACIÓN REQUERIDA');
      expect(msg).toContain('84\\.50');
      expectParseableMarkdownV2(msg);
    });

    it('el reprice con delta negativo escapa el signo correctamente', () => {
      const msg = formatRepriceTelegramMessage({ buyPrice: 85.2, sellPrice: 84.5, confirmed: true });
      expect(msg).toContain('\\-0\\.70');
      expectParseableMarkdownV2(msg);
    });
  });

  describe('Parseabilidad MarkdownV2 de los comandos operativos V2', () => {
    it('todas las respuestas nuevas son parseables en MarkdownV2', () => {
      const AUTH = 123456789;
      const updates: { label: string; update: TelegramInboundUpdate }[] = [
        {
          label: '/radar',
          update: {
            update_id: 2000,
            message: {
              message_id: 1,
              from: { id: AUTH },
              chat: { id: AUTH, type: 'private' },
              text: '/radar',
              date: Date.now(),
            },
          },
        },
        {
          label: '/radar bcv 2000',
          update: {
            update_id: 2001,
            message: {
              message_id: 2,
              from: { id: AUTH },
              chat: { id: AUTH, type: 'private' },
              text: '/radar bcv 2000',
              date: Date.now(),
            },
          },
        },
        {
          label: '/radar bcv dosmil (guía)',
          update: {
            update_id: 2002,
            message: {
              message_id: 3,
              from: { id: AUTH },
              chat: { id: AUTH, type: 'private' },
              text: '/radar bcv dosmil',
              date: Date.now(),
            },
          },
        },
        {
          label: '/reprecio 84.5 85.2',
          update: {
            update_id: 2003,
            message: {
              message_id: 4,
              from: { id: AUTH },
              chat: { id: AUTH, type: 'private' },
              text: '/reprecio 84.5 85.2',
              date: Date.now(),
            },
          },
        },
        {
          label: '/reprecio incompleto (guía)',
          update: {
            update_id: 2004,
            message: {
              message_id: 5,
              from: { id: AUTH },
              chat: { id: AUTH, type: 'private' },
              text: '/reprecio 84.5',
              date: Date.now(),
            },
          },
        },
        {
          label: '/macro',
          update: {
            update_id: 2005,
            message: {
              message_id: 6,
              from: { id: AUTH },
              chat: { id: AUTH, type: 'private' },
              text: '/macro',
              date: Date.now(),
            },
          },
        },
        {
          label: '/backtest usdt/buy 7d',
          update: {
            update_id: 2006,
            message: {
              message_id: 7,
              from: { id: AUTH },
              chat: { id: AUTH, type: 'private' },
              text: '/backtest usdt/buy 7d',
              date: Date.now(),
            },
          },
        },
        {
          label: 'REPRICE_CONFIRM',
          update: {
            update_id: 2007,
            callback_query: {
              id: 'cb-a',
              from: { id: AUTH },
              data: 'REPRICE_CONFIRM:84.5:85.2',
              message: { message_id: 7, chat: { id: AUTH } },
            },
          },
        },
        {
          label: 'REPRICE_CANCEL',
          update: {
            update_id: 2008,
            callback_query: {
              id: 'cb-b',
              from: { id: AUTH },
              data: 'REPRICE_CANCEL',
              message: { message_id: 7, chat: { id: AUTH } },
            },
          },
        },
        {
          label: 'BACKTEST_RUN',
          update: {
            update_id: 2009,
            callback_query: {
              id: 'cb-c',
              from: { id: AUTH },
              data: 'BACKTEST_RUN',
              message: { message_id: 7, chat: { id: AUTH } },
            },
          },
        },
      ];

      updates.forEach(({ label, update }) => {
        const res = dispatchTelegramUpdate(update, AUTH);
        expectParseableMarkdownV2(res.responseMarkdown);
        expect(res.responseMarkdown.length, label).toBeGreaterThan(0);
      });
    });
  });
});
