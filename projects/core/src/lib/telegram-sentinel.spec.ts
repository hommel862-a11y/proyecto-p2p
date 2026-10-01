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
  formatPanelTelegramMessage,
  buildFraudAlertKeyboard,
  buildRepricerControlKeyboard,
  buildRepriceConfirmationKeyboard,
  buildRepriceCallbackData,
  buildPanelKeyboard,
  isPanelCallbackData,
  parseRepriceCallbackData,
  formatJournalAuditLine,
  dispatchTelegramUpdate,
  PANEL_CALLBACKS,
  TelegramInboundUpdate,
  type PanelReport,
} from './telegram-sentinel';
import type { VerificationSummary } from './decision-journal';

// Caracteres reservados de MarkdownV2 que en NUESTROS mensajes solo pueden
// aparecer escapados (fuera de los spans de código): [ ] ( ) ~ > # + - = | { } . !
const NON_STRUCTURAL_RESERVED = /[\][()~>#+=|{}.!-]/;

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

/**
 * Palabras con las que la línea de auditoría NO puede afirmar nada. `verifiedDecisions`
 * cuenta decisiones con al menos un **intento de publicación** registrado, no trades
 * realizados: pedir un precio no es vender a ese precio. Si alguien "abrevia" el rótulo
 * a "Verificado 12/1042" le está diciendo al operador que 12 decisiones están confirmadas
 * contra el mercado, y eso es falso.
 */
const FORBIDDEN_VERIFICATION_CLAIMS = [
  /verificad/i,
  /confirmad/i,
  /trade/i,
  /fill/i,
  /llenad/i,
  /realizad/i,
  /ejecutad/i,
];

/**
 * Resumen de referencia: 1042 decisiones, 12 con al menos un intento de publicación
 * registrado (`12/1042` = 1.2%) y 31 decididas sobre un libro que el propio motor ya
 * marcó como viejo (`31/1042` = 3.0%).
 *
 * Las dos tasas se eligen DISTINTAS a propósito: si un refactor intercambia
 * `verificationRate` por `staleRate`, o las confunde, tiene que notarse. Con las dos
 * al 3.0% un error así pasaría el filtro verde.
 */
const SUMMARY: VerificationSummary = {
  totalDecisions: 1042,
  verifiedDecisions: 12,
  verificationRate: 12 / 1042,
  journaledDecisions: 1042,
  staleDecisions: 31,
  staleRate: 31 / 1042,
  openCycles: 1,
  decisionsAwaitingOutcome: 1030,
};

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

  describe('panel editable (/panel)', () => {
    const PANEL_AUTH = 555000111;

    /**
     * El mismo texto con los escapes de MarkdownV2 quitados, para que las
     * aserciones hablen del valor que ve el operador (`85.90`) y no del
     * formato de cable (`85\.90`). El formato de cable lo cubre
     * `expectParseableMarkdownV2`.
     */
    function plain(markdown: string): string {
      return markdown.replace(/\\/g, '');
    }

    /** Report de referencia. Todo valor ausente viaja como NaN, nunca como 0. */
    const FULL_REPORT: PanelReport = {
      executionModeLabel: 'SOLO LECTURA — NO PUBLICA',
      executionModeDetail:
        'Calcula y registra precios. No publica anuncios: este proyecto no tiene capa de escritura contra la API de merchant de Binance.',
      repricerActive: true,
      repricerBuyPrice: 84.5,
      repricerSellPrice: 85.2,
      market: { bestBuyPrice: 85.0, bestSellPrice: 85.9, spreadPct: 1.06, spreadVes: 0.9 },
      fetchedAt: '12:00:00',
      marketStale: false,
    };

    it('formatea el panel con el modo real, el libro y la frescura', () => {
      const msg = formatPanelTelegramMessage(FULL_REPORT);

      expect(msg).toContain('PANEL DEL TERMINAL');
      expect(msg).toContain('SOLO LECTURA — NO PUBLICA');
      expect(msg).toContain('No publica anuncios');
      expect(msg).toContain('🟢 ACTIVO');
      const visible = plain(msg);
      expect(visible).toContain('84.50');
      expect(visible).toContain('85.20');
      expect(visible).toContain('85.00');
      expect(visible).toContain('85.90');
      expect(visible).toContain('+1.06%');
      expect(visible).toContain('12:00:00');
      expectParseableMarkdownV2(msg);
    });

    it('nunca afirma publicación en vivo', () => {
      const msg = formatPanelTelegramMessage(FULL_REPORT);

      expect(msg).not.toMatch(/en vivo/i);
      expect(msg).not.toMatch(/publicando/i);
    });

    it('declaro el motor detenido sin dejar de mostrar el resto del estado', () => {
      const msg = formatPanelTelegramMessage({ ...FULL_REPORT, repricerActive: false });

      expect(msg).toContain('⏸ DETENIDO');
      expect(plain(msg)).toContain('85.90');
    });

    it('declaro la ausencia de libro en vez de imprimir ceros como precios', () => {
      const msg = formatPanelTelegramMessage({ ...FULL_REPORT, market: null });

      expect(msg).toContain('Libro sin datos');
      // 0.00 sería un precio mentira: tiene que faltar la línea, no mostrar 0.
      expect(plain(msg)).not.toContain('`0.00 Bs`');
      expect(plain(msg)).not.toContain('+0.00%');
      // El resto del panel sigue siendo útil aunque no haya libro.
      expect(msg).toContain('SOLO LECTURA — NO PUBLICA');
      expectParseableMarkdownV2(msg);
    });

    it('imprime n/d cuando el motor todavía no tiene precio definido', () => {
      const msg = formatPanelTelegramMessage({
        ...FULL_REPORT,
        repricerBuyPrice: Number.NaN,
        repricerSellPrice: Number.NaN,
      });

      expect(plain(msg)).toMatch(/compra `n\/d Bs`/);
      expect(plain(msg)).toMatch(/venta `n\/d Bs`/);
      expectParseableMarkdownV2(msg);
    });

    it('marca la lectura de caché como posiblemente desactualizada', () => {
      const msg = formatPanelTelegramMessage({ ...FULL_REPORT, marketStale: true });

      expect(msg).toMatch(/pueden estar desactualizados/i);
      expectParseableMarkdownV2(msg);
    });

    it('es determinista: el mismo report produce el mismo texto', () => {
      // El formateador no puede leer el reloj: el tiempo entra ya formateado.
      expect(formatPanelTelegramMessage(FULL_REPORT)).toBe(
        formatPanelTelegramMessage(FULL_REPORT),
      );
    });

    it('incluye la línea de auditoría con los números del journal', () => {
      const msg = formatPanelTelegramMessage({ ...FULL_REPORT, journalAudit: SUMMARY });

      expect(plain(msg)).toContain('12/1042');
      expect(plain(msg)).toContain('intento de publicación');
      expectParseableMarkdownV2(msg);
    });

    it('no se come la línea cuando el slice no tiene nada publicable', () => {
      // El panel entrega el resumen al formateador siempre que el resumen haya llegado, y
      // un slice de KEEP y PAUSE tiene un resumen perfectamente legible: se registró algo. La
      // línea tiene que sobrevivir al mensaje completo —con su exposición a libro viejo
      // incluida— y no solo al formateador suelto. `undefined` (nunca consultado) es lo
      // único que el panel omite.
      const msg = formatPanelTelegramMessage({
        ...FULL_REPORT,
        journalAudit: {
          ...SUMMARY,
          totalDecisions: 0,
          verifiedDecisions: 0,
          verificationRate: 0,
          journaledDecisions: 7,
          staleDecisions: 3,
          staleRate: 3 / 7,
          decisionsAwaitingOutcome: 0,
        },
      });
      const visible = plain(msg);

      expect(visible).toContain('Auditoría de decisiones');
      expect(visible).toMatch(/`3` sobre libro viejo `42\.9%`/);
      expect(visible).not.toContain('sin decisiones registradas');
      expectParseableMarkdownV2(msg);
    });

    it('declara la auditoría no disponible cuando el journal no respondió', () => {
      const msg = formatPanelTelegramMessage({ ...FULL_REPORT, journalAudit: null });

      expect(plain(msg)).toContain('no disponible');
      // No disponible NO es lo mismo que cero decisiones: se distinguen a propósito.
      expect(plain(msg)).not.toContain('sin decisiones registradas');
      expectParseableMarkdownV2(msg);
    });

    it('omite la línea de auditoría cuando nunca se consultó el journal', () => {
      // Sin resumen no hay nada que afirmar: el panel no inventa un número.
      const msg = formatPanelTelegramMessage(FULL_REPORT);

      expect(plain(msg)).not.toContain('Auditoría de decisiones');
      expectParseableMarkdownV2(msg);
    });

    it('el panel completo no promete trades ejecutados en ninguna de sus líneas', () => {
      const msg = plain(
        formatPanelTelegramMessage({ ...FULL_REPORT, journalAudit: SUMMARY }),
      );

      FORBIDDEN_VERIFICATION_CLAIMS.forEach((claim) => {
        expect(msg, String(claim)).not.toMatch(claim);
      });
    });

    it('construye el teclado del panel con refrescar, pausar y reanudar', () => {
      const kb = buildPanelKeyboard();
      const buttons = kb.inline_keyboard.flat();

      expect(buttons.map((b) => b.callback_data)).toEqual([
        PANEL_CALLBACKS.REFRESH,
        PANEL_CALLBACKS.REPRICER_STOP,
        PANEL_CALLBACKS.REPRICER_START,
      ]);
    });

    it('reconoce solo los callbacks propios del panel', () => {
      expect(isPanelCallbackData(PANEL_CALLBACKS.REFRESH)).toBe(true);
      expect(isPanelCallbackData(PANEL_CALLBACKS.REPRICER_STOP)).toBe(true);
      expect(isPanelCallbackData(PANEL_CALLBACKS.REPRICER_START)).toBe(true);
      // Los callbacks legacy emiten mensajes nuevos: no son del panel.
      expect(isPanelCallbackData('BOT_KILLSWITCH')).toBe(false);
      expect(isPanelCallbackData('REPRICE_CONFIRM:84.5:85.2')).toBe(false);
      expect(isPanelCallbackData('BACKTEST_RUN')).toBe(false);
      expect(isPanelCallbackData(undefined)).toBe(false);
    });

    it('rutea /panel a la acción PANEL para el chat autorizado', () => {
      const res = dispatchTelegramUpdate(
        {
          update_id: 3001,
          message: {
            message_id: 1,
            from: { id: PANEL_AUTH },
            chat: { id: PANEL_AUTH, type: 'private' },
            text: '/panel',
            date: Date.now(),
          },
        },
        PANEL_AUTH,
      );

      expect(res.authorized).toBe(true);
      expect(res.command).toBe('/panel');
      expect(res.action).toBe('PANEL');
      expectParseableMarkdownV2(res.responseMarkdown);
    });

    it('rechaza /panel de un chat no autorizado', () => {
      const res = dispatchTelegramUpdate(
        {
          update_id: 3002,
          message: {
            message_id: 1,
            from: { id: 999 },
            chat: { id: 999, type: 'private' },
            text: '/panel',
            date: Date.now(),
          },
        },
        PANEL_AUTH,
      );

      expect(res.authorized).toBe(false);
      expect(res.action).toBeUndefined();
    });

    it('rutea los botones del panel a PANEL, KILLSWITCH y RESUME', () => {
      const cases: [string, string][] = [
        [PANEL_CALLBACKS.REFRESH, 'PANEL'],
        [PANEL_CALLBACKS.REPRICER_STOP, 'KILLSWITCH'],
        [PANEL_CALLBACKS.REPRICER_START, 'RESUME'],
      ];

      cases.forEach(([data, action]) => {
        const res = dispatchTelegramUpdate(
          {
            update_id: 3003,
            callback_query: {
              id: 'cb-panel',
              from: { id: PANEL_AUTH },
              data,
              // El mensaje del callback ES el panel que hay que re-renderizar.
              message: { message_id: 7, chat: { id: PANEL_AUTH } },
            },
          },
          PANEL_AUTH,
        );

        expect(res.action, data).toBe(action);
        expect(res.authorized, data).toBe(true);
        expectParseableMarkdownV2(res.responseMarkdown);
      });
    });

    it('rechaza un botón del panel lanzado desde un chat no autorizado', () => {
      const res = dispatchTelegramUpdate(
        {
          update_id: 3004,
          callback_query: {
            id: 'cb-intruder',
            from: { id: 999 },
            data: PANEL_CALLBACKS.REPRICER_STOP,
            message: { message_id: 7, chat: { id: 999 } },
          },
        },
        PANEL_AUTH,
      );

      expect(res.authorized).toBe(false);
    });
  });

  describe('línea de auditoría del journal (/panel y /status)', () => {
    /** El texto con los escapes de MarkdownV2 quitados: lo que ve el operador. */
    function plain(markdown: string): string {
      return markdown.replace(/\\/g, '');
    }

    it('imprime los conteos con los números correctos', () => {
      const line = formatJournalAuditLine(SUMMARY);
      const visible = plain(line);

      expect(visible).toContain('Auditoría de decisiones');
      // Una sola aserción con la línea completa y en orden: fija cada tasa a SU
      // rótulo, así que intercambiar `verificationRate` y `staleRate` se nota.
      expect(visible).toMatch(
        /`12\/1042` decisiones con intento de publicación • `1\.2%` decididas sobre libro viejo `3\.0%`/,
      );
      expectParseableMarkdownV2(line);
    });

    it('dice "intento" y nunca promete verificación de trades', () => {
      const visible = plain(formatJournalAuditLine(SUMMARY));

      // El rotulado dice exactamente lo que el número es: un intento registrado.
      expect(visible).toContain('intento de publicación');
      FORBIDDEN_VERIFICATION_CLAIMS.forEach((claim) => {
        expect(visible, String(claim)).not.toMatch(claim);
      });
    });

    it('escapa MarkdownV2 en cada valor interpolado, no solo en el porcentaje', () => {
      // El `.` es un carácter reservado: sin escape, Telegram rechaza el envío entero.
      // Se comprueban los TRES valores dinámicos: el conteo, la tasa de verificación
      // y la tasa de libro viejo.
      const line = formatJournalAuditLine({ ...SUMMARY, verifiedDecisions: 12.5 });

      expect(line).toContain('12\\.5/1042');
      expect(line).toContain('1\\.2%');
      expect(line).toContain('3\\.0%');
      expectParseableMarkdownV2(line);
    });

    it('omite la porción de libro viejo cuando ninguna decisión se tomó sobre uno viejo', () => {
      const line = formatJournalAuditLine({ ...SUMMARY, staleDecisions: 0, staleRate: 0 });
      const visible = plain(line);

      // La tasa de verificación sigue: la que desaparece es solo la de libro viejo.
      expect(visible).toContain('12/1042');
      expect(visible).toContain('1.2%');
      expect(visible).not.toContain('libro viejo');
      expect(visible).not.toContain('0.0%');
      expectParseableMarkdownV2(line);
    });

    it('declara que no hay decisiones registradas cuando el journal está vacío', () => {
      // 0, NaN e Infinity son los tres finales de un resumen vacío o corrupto.
      // Ninguno puede llegar al teléfono como 0/0, NaN o Infinity.
      //
      // El journal vacío se declara con `journaledDecisions` y NO con `totalDecisions`:
      // el segundo está en cero para cualquier slice sin UPDATEs, así que exigirlo
      // para decir "nada registrado" borraría decisiones que sí existen.
      [0, Number.NaN, Number.POSITIVE_INFINITY].forEach((totalDecisions) => {
        const line = formatJournalAuditLine({
          ...SUMMARY,
          totalDecisions,
          verificationRate: Number.NaN,
          journaledDecisions: 0,
          staleDecisions: 0,
          staleRate: Number.NaN,
        });
        const visible = plain(line);
        const label = String(totalDecisions);

        expect(visible, label).toContain('sin decisiones registradas');
        expect(visible, label).not.toMatch(/0\/0/);
        expect(visible, label).not.toMatch(/NaN|Infinity|n\/d/);
        expectParseableMarkdownV2(line);
      });
    });

    it('no inventa un porcentaje ante un resumen corrupto', () => {
      // Hay decisiones tomadas sobre libro viejo pero la tasa no llegó: se dice
      // n/d, que es la verdad, en vez de omitir el dato o inventar 0%.
      const line = formatJournalAuditLine({
        ...SUMMARY,
        verifiedDecisions: Number.NaN,
        staleRate: Number.NaN,
      });
      const visible = plain(line);

      expect(visible).not.toMatch(/NaN|Infinity/);
      expect(visible).toContain('n/d');
      expectParseableMarkdownV2(line);
    });

    it('declara la auditoría no disponible cuando el journal no se pudo leer', () => {
      const line = formatJournalAuditLine(null);
      const visible = plain(line);

      expect(visible).toContain('no disponible');
      expect(visible).not.toMatch(/0\/0|NaN|Infinity/);
      expectParseableMarkdownV2(line);
    });

    it('es determinista: el mismo resumen produce la misma línea', () => {
      expect(formatJournalAuditLine(SUMMARY)).toBe(formatJournalAuditLine(SUMMARY));
    });

    // Un slice con KEEPs y PAUSEs pero ningún UPDATE tiene `journaledDecisions > 0` y
    // `totalDecisions === 0`, porque el denominador de verificación cuenta solo
    // acciones publicables. Son dos poblaciones distintas, y por eso la línea decide
    // "se registró algo" con la primera y "hay algo que medir" con la segunda.
    it('dice cuántas decisiones se registraron cuando ninguna podía publicarse', () => {
      const line = formatJournalAuditLine({
        ...SUMMARY,
        totalDecisions: 0,
        verifiedDecisions: 0,
        verificationRate: 0,
        journaledDecisions: 7,
        staleDecisions: 0,
        staleRate: 0,
        decisionsAwaitingOutcome: 0,
      });
      const visible = plain(line);

      // 7 decisiones SÍ se registraron: eso es lo que se afirma, con el número a la vista
      // y sin el rótulo de una tasa que no existe.
      expect(visible).toContain('`7` decisiones registradas');
      expect(visible).toContain('ninguna con intento de publicación');
      expect(visible).not.toContain('sin decisiones registradas');
      // Sin denominador no hay división: ni fracción ni porcentaje, en vez de un 0.0%
      // inventado. El rótulo de la tasa tampoco aparece, porque no hay tasa.
      expect(visible).not.toMatch(/\d+\/\d+/);
      expect(visible).not.toMatch(/\d+(\.\d+)?%/);
      expect(visible).not.toMatch(/NaN|Infinity|n\/d/);
      expectParseableMarkdownV2(line);
    });

    it('revela la exposición a libro viejo aunque nada de eso sea publicable', () => {
      // El segundo agujero del mismo `return` temprano: la porción de libro viejo quedaba
      // inalcanzable, así que un ciclo que decidió sobre un libro viejo no leSayba NADA al
      // operador. La métrica se calculaba bien y se perdía en el render, que es la clase de
      // defecto que este trabajo existe para eliminar: un número honesto que nadie ve.
      const line = formatJournalAuditLine({
        ...SUMMARY,
        totalDecisions: 0,
        verifiedDecisions: 0,
        verificationRate: 0,
        journaledDecisions: 7,
        staleDecisions: 3,
        staleRate: 3 / 7,
        decisionsAwaitingOutcome: 0,
      });
      const visible = plain(line);

      // 3 sobre 7, con conteo y tasa, y el denominador 7 a la vista para que el operador
      // pueda comprobar la división. La exposición no depende del denominador de
      // verificación: se decide sobre el libro, no sobre si se pudo publicar.
      expect(visible).toMatch(/`3` sobre libro viejo `42\.9%`/);
      expect(visible).toContain('`7` decisiones registradas');
      expect(visible).not.toContain('sin decisiones registradas');
      // El rótulo de la tasa de intentos no aparece: no hay ninguna que mostrar.
      expect(visible).not.toContain('decisiones con intento de publicación');
      expectParseableMarkdownV2(line);
    });
  });

  describe('formatBcvIntelligenceTelegramMessage — brecha no medida', () => {
    function plain(markdown: string): string {
      return markdown.replace(/\\/g, '');
    }

    // La brecha BCV pasa a ser nullable porque una tasa ausente no es una brecha de
    // cero. El mensaje tiene que poder mostrar la ausencia sin mentir: si el
    // formateador sigue esperando `number`, revienta con un TypeError en el path de
    // alerta, que es justo cuando el operador más necesita el mensaje.
    function formatoSinMedicion() {
      return formatBcvIntelligenceTelegramMessage({
        parallelRate: null,
        bcvRate: null,
        gapPct: null,
        gapVes: null,
        zone: 'UNAVAILABLE',
        phase: 'QUIET_ACCUMULATION',
        nextExpectedIntervention: 's/d',
        probabilityPct: 0,
        actionLabel: 'SIN MEDICIÓN — NO OPERAR',
        timingNotice: 'Sin instrucción hasta disponer de ambas tasas',
      });
    }

    it('no revienta cuando la brecha no se midio', () => {
      expect(() => formatoSinMedicion()).not.toThrow();
    });

    it('no imprime 0.00% como si la brecha fuera cero', () => {
      const visible = plain(formatoSinMedicion());

      expect(visible).not.toMatch(/0\.00%/);
      expect(visible).not.toMatch(/0\.00 Bs/);
    });

    it('marca la brecha como no disponible en vez de omitirla', () => {
      const visible = plain(formatoSinMedicion());

      expect(visible).toMatch(/s\/d|no disponible|indeterminada/i);
    });

    it('no pinta la zona desconocida de verde', () => {
      // El icono por defecto del formateador era 🟢, que es el estado más
      // tranquilo del semáforo para un dato que nadie midió.
      const msg = formatoSinMedicion();

      expect(msg).not.toContain('🟢');
    });

    it('sigue mostrando la brecha cuando sí existe', () => {
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

      expect(msg).toContain('18\\.98%');
      expect(msg).toContain('130\\.00 Bs');
    });
  });
});
