import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Prevent daemon auto-start / process.exit when importing helpers under test
process.env['TELEGRAM_DAEMON_TEST_IMPORT'] = 'true';

import { CloudAiProxyService } from '../ai-proxy';
import {
  isProtectedDaemonEndpoint,
  verifyDaemonBearerAuth,
  parseFinance360TelegramCommand,
  handleFinance360TelegramCommand,
} from '../index';

describe('Telegram Daemon Hardening & Finanzas 360 Routing', () => {
  const originalFetch = globalThis.fetch;
  const savedGeminiKey = process.env['GEMINI_API_KEY'];

  beforeEach(() => {
    delete process.env['GEMINI_API_KEY'];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (savedGeminiKey === undefined) delete process.env['GEMINI_API_KEY'];
    else process.env['GEMINI_API_KEY'] = savedGeminiKey;
    vi.restoreAllMocks();
  });

  describe('CloudAiProxyService Gemini API key security', () => {
    it('sends Gemini API key in x-goog-api-key header instead of URL query string', async () => {
      process.env['GEMINI_API_KEY'] = 'AIza-secret-test-key-12345';
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'OK Seguro' }] } }],
          }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const proxy = new CloudAiProxyService();
      const response = await proxy.ask('Evaluar liquidez 14D', undefined, true);

      expect(response.content).toBe('OK Seguro');
      expect(capturedUrl).not.toContain('key=');
      expect(capturedUrl).not.toContain('AIza-secret-test-key-12345');
      expect(capturedHeaders['x-goog-api-key']).toBe('AIza-secret-test-key-12345');
    });
  });

  describe('Bearer token authentication middleware helpers', () => {
    it('protects /api/sync/* and /api/ai/chat while leaving /health public', () => {
      expect(isProtectedDaemonEndpoint('/api/sync/status')).toBe(true);
      expect(isProtectedDaemonEndpoint('/api/sync/push')).toBe(true);
      expect(isProtectedDaemonEndpoint('/api/sync/pull')).toBe(true);
      expect(isProtectedDaemonEndpoint('/api/ai/chat')).toBe(true);
      expect(isProtectedDaemonEndpoint('/health')).toBe(false);
    });

    it('validates Bearer tokens in constant time and rejects missing or mismatched tokens', () => {
      expect(verifyDaemonBearerAuth('Bearer super-secret-token', 'super-secret-token')).toBe(true);
      expect(verifyDaemonBearerAuth('Bearer wrong-token', 'super-secret-token')).toBe(false);
      expect(verifyDaemonBearerAuth('Basic c2VjcmV0', 'super-secret-token')).toBe(false);
      expect(verifyDaemonBearerAuth(undefined, 'super-secret-token')).toBe(false);
      // Optional when TELEGRAM_DAEMON_AUTH_TOKEN is empty
      expect(verifyDaemonBearerAuth(undefined, '')).toBe(true);
    });
  });

  describe('Finanzas 360 Telegram command parsing & anti-NaN validation', () => {
    it('rejects malformed amounts like #cashea abc or negative values without NaN or crash', () => {
      const badCashea = parseFinance360TelegramCommand('#cashea abc 3 TV');
      expect(badCashea.isF360Command).toBe(true);
      expect(badCashea.valid).toBe(false);
      expect(badCashea.replyMarkdown).not.toContain('NaN');

      const badExpense = parseFinance360TelegramCommand('#gasto -25 USD Gasolina');
      expect(badExpense.isF360Command).toBe(true);
      expect(badExpense.valid).toBe(false);

      const badLevel = parseFinance360TelegramCommand('#cashea 180 9 Nevera');
      expect(badLevel.isF360Command).toBe(true);
      expect(badLevel.valid).toBe(false);
    });

    it('parses #gasto, #ingreso, #cashea (levels 1-6), #resumen, and /360 cleanly', () => {
      const expense = parseFinance360TelegramCommand('#gasto 45.50 USD Compra repuestos pyme');
      expect(expense.valid).toBe(true);
      expect(expense.command).toBe('expense');
      expect(expense.payload).toMatchObject({
        amount: 45.5,
        currency: 'USD',
        scope: 'business',
      });

      const income = parseFinance360TelegramCommand('#ingreso 250 USD Cobro servicio pyme');
      expect(income.valid).toBe(true);
      expect(income.command).toBe('income');
      expect(income.payload).toMatchObject({ amount: 250, currency: 'USD', scope: 'business' });

      const casheaN6 = parseFinance360TelegramCommand('#cashea 300 6 Televisor Samsung');
      expect(casheaN6.valid).toBe(true);
      expect(casheaN6.command).toBe('cashea');
      expect(casheaN6.payload).toMatchObject({ amount: 300, level: 6, product: 'Televisor Samsung' });

      const summary = parseFinance360TelegramCommand('/360');
      expect(summary.valid).toBe(true);
      expect(summary.command).toBe('summary');
    });

    it('forwards valid Finanzas 360 commands when Electron bridge is online and returns honest offline status otherwise', async () => {
      const onlineFetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/orchestrator/status')) {
          return { ok: true, status: 200, json: async () => ({ online: true }) } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ replyText: 'Gasto registrado: $25.00 USD (Gasolina).' }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const forwarded = await handleFinance360TelegramCommand('#gasto 25 USD Gasolina pyme', {
        electronBridgeUrl: 'http://127.0.0.1:51857',
        fetchImpl: onlineFetch,
      });
      expect(forwarded.handled).toBe(true);
      expect(forwarded.forwarded).toBe(true);
      expect(forwarded.replyMarkdown).toContain('25\\.00');

      const offlineFetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;

      const offline = await handleFinance360TelegramCommand('#resumen', {
        electronBridgeUrl: 'http://127.0.0.1:51857',
        fetchImpl: offlineFetch,
      });
      expect(offline.handled).toBe(true);
      expect(offline.forwarded).toBe(false);
      expect(offline.replyMarkdown).toMatch(/Finanzas 360/i);
    });
  });
});
