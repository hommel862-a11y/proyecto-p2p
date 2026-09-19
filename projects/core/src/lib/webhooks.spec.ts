import { describe, it, expect, vi } from 'vitest';
import {
  formatTelegramMessage,
  sendTelegramAlert,
  type TelegramConfig,
  type RuleAlertEvent,
} from './webhooks';

describe('webhooks', () => {
  describe('formatTelegramMessage', () => {
    it('formats risk_deny event with 🚨 ALERTA DE RIESGO emoji/header', () => {
      const event: RuleAlertEvent = {
        type: 'risk_deny',
        title: 'Operación denegada',
        details: 'El spread actual es menor al mínimo requerido',
        value: '-0.5%',
        timestamp: '2026-09-08T12:00:00Z',
      };
      const msg = formatTelegramMessage(event);

      expect(msg).toContain('🚨 <b>ALERTA DE RIESGO</b>');
      expect(msg).toContain('<b>Operación denegada</b>');
      expect(msg).toContain('El spread actual es menor al mínimo requerido');
      expect(msg).toContain('Valor: <code>-0.5%</code>');
      expect(msg).toContain('2026-09-08T12:00:00Z');
    });

    it('formats risk_pause event with 🚨 ALERTA DE RIESGO emoji/header', () => {
      const event: RuleAlertEvent = {
        type: 'risk_pause',
        title: 'Operativa pausada por riesgo',
        details: 'Demasiadas pérdidas seguidas en la última hora',
      };
      const msg = formatTelegramMessage(event);

      expect(msg).toContain('🚨 <b>ALERTA DE RIESGO</b>');
      expect(msg).toContain('<b>Operativa pausada por riesgo</b>');
      expect(msg).toContain('Demasiadas pérdidas seguidas en la última hora');
      expect(msg).not.toContain('Valor:');
    });

    it('formats favorable_spread event with ⚡ OPORTUNIDAD DE SPREAD emoji/header', () => {
      const event: RuleAlertEvent = {
        type: 'favorable_spread',
        title: 'Spread favorable detectado',
        details: 'Spread del 2.5% disponible en Binance P2P',
        value: 2.5,
      };
      const msg = formatTelegramMessage(event);

      expect(msg).toContain('⚡ <b>OPORTUNIDAD DE SPREAD</b>');
      expect(msg).toContain('<b>Spread favorable detectado</b>');
      expect(msg).toContain('Spread del 2.5% disponible en Binance P2P');
      expect(msg).toContain('Valor: <code>2.5</code>');
    });

    it('formats account_limit event with ⚠️ LÍMITE DE CUENTA emoji/header', () => {
      const event: RuleAlertEvent = {
        type: 'account_limit',
        title: 'Límite bancario alcanzado',
        details: 'La cuenta Banesco superó el 90% de su límite diario',
        value: '92%',
      };
      const msg = formatTelegramMessage(event);

      expect(msg).toContain('⚠️ <b>LÍMITE DE CUENTA</b>');
      expect(msg).toContain('<b>Límite bancario alcanzado</b>');
      expect(msg).toContain('Valor: <code>92%</code>');
    });

    it('formats plan_approved event with 🚀 PLAN TÁCTICO APROBADO emoji/header', () => {
      const event: RuleAlertEvent = {
        type: 'plan_approved',
        title: 'Arbitraje Triangular Aprobado',
        details: 'Ejecutando rotación de 1000 USDT con spread 1.85%',
        value: '1000 USDT',
        timestamp: '2026-09-19T12:00:00Z',
      };
      const msg = formatTelegramMessage(event);

      expect(msg).toContain('🚀 <b>PLAN TÁCTICO APROBADO</b>');
      expect(msg).toContain('<b>Arbitraje Triangular Aprobado</b>');
      expect(msg).toContain('Ejecutando rotación de 1000 USDT con spread 1.85%');
      expect(msg).toContain('Valor: <code>1000 USDT</code>');
    });
  });

  describe('sendTelegramAlert', () => {
    const validConfig: TelegramConfig = {
      botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      chatId: '987654321',
      enabled: true,
      alertsOnRisk: true,
      alertsOnFavorable: true,
      alertsOnAccountLimit: true,
    };

    const event: RuleAlertEvent = {
      type: 'risk_deny',
      title: 'Risk Alert',
      details: 'Risk detail',
    };

    it('returns error if disabled', async () => {
      const config = { ...validConfig, enabled: false };
      const res = await sendTelegramAlert(config, event);
      expect(res).toEqual({
        success: false,
        error: 'Telegram no configurado',
      });
    });

    it('returns error if botToken is missing or empty', async () => {
      const config = { ...validConfig, botToken: '' };
      const res = await sendTelegramAlert(config, event);
      expect(res).toEqual({
        success: false,
        error: 'Telegram no configurado',
      });
    });

    it('returns error if chatId is missing or empty', async () => {
      const config = { ...validConfig, chatId: '' };
      const res = await sendTelegramAlert(config, event);
      expect(res).toEqual({
        success: false,
        error: 'Telegram no configurado',
      });
    });

    it('sends POST request to Telegram API and returns messageId on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          result: { message_id: 1001 },
        }),
      });

      const res = await sendTelegramAlert(validConfig, event, mockFetch as any);

      expect(res).toEqual({
        success: true,
        messageId: 1001,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${validConfig.botToken}/sendMessage`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: validConfig.chatId,
            text: formatTelegramMessage(event),
            parse_mode: 'HTML',
          }),
        })
      );
    });

    it('sends plan_approved alert successfully when enabled', async () => {
      const planEvent: RuleAlertEvent = {
        type: 'plan_approved',
        title: 'Plan Aprobado',
        details: 'Arbitraje ejecutado',
      };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          result: { message_id: 2002 },
        }),
      });

      const res = await sendTelegramAlert(validConfig, planEvent, mockFetch as any);
      expect(res).toEqual({
        success: true,
        messageId: 2002,
      });
    });

    it('handles non-ok HTTP status from Telegram API gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          ok: false,
          description: 'Bad Request: chat not found',
        }),
      });

      const res = await sendTelegramAlert(validConfig, event, mockFetch as any);

      expect(res).toEqual({
        success: false,
        error: 'Bad Request: chat not found',
      });
    });

    it('handles JSON parse errors on non-ok status gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const res = await sendTelegramAlert(validConfig, event, mockFetch as any);

      expect(res).toEqual({
        success: false,
        error: 'HTTP 500: Internal Server Error',
      });
    });

    it('handles network errors gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const res = await sendTelegramAlert(validConfig, event, mockFetch as any);

      expect(res).toEqual({
        success: false,
        error: 'Network error',
      });
    });
  });
});
