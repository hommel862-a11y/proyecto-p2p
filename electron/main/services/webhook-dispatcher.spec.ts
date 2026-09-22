import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookDispatcher, type PlanDispatchSummary } from './webhook-dispatcher';
import type { StrategyPlanCard } from '../../shared/types';

describe('WebhookDispatcher', () => {
  const samplePlan: StrategyPlanCard = {
    id: 'PLAN-TEST-001',
    title: 'Arbitraje Triangular Récord',
    route: 'USDT ➔ VES ➔ EUR ➔ USDT',
    asset: 'USDT',
    fiat: 'VES',
    capitalRequiredUsdt: 1500,
    expectedNetSpreadPct: 2.15,
    expectedProfitUsdt: 32.25,
    riskLevel: 'LOW',
    assignedOperatorName: 'Arbitrage Lead',
    rationale: 'Brecha abierta entre Banesco y Binance P2P.',
    status: 'APPROVED',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['TELEGRAM_BOT_TOKEN'];
    delete process.env['TELEGRAM_CHAT_ID'];
    delete process.env['GSHEETS_WEBHOOK_URL'];
    delete process.env['P2P_WEBHOOK_URL'];
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('reports missing Telegram configuration when botToken/chatId are empty', async () => {
    const dispatcher = new WebhookDispatcher();
    const res = await dispatcher.dispatchTelegramPlanAlert(samplePlan);

    expect(res.sent).toBe(false);
    expect(res.error).toContain('Telegram Sentinel no configurado');
  });

  it('delivers Telegram alert successfully with configured credentials and mock fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: { message_id: 8881 },
      }),
    });

    const dispatcher = new WebhookDispatcher({
      telegram: {
        botToken: 'bot_test_token_123',
        chatId: 'chat_test_id_456',
        enabled: true,
      },
      fetchFn: mockFetch as any,
    });

    const res = await dispatcher.dispatchTelegramPlanAlert(samplePlan);
    expect(res.sent).toBe(true);
    expect(res.messageId).toBe(8881);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botbot_test_token_123/sendMessage');
    expect(JSON.parse(init.body)).toMatchObject({
      chat_id: 'chat_test_id_456',
      parse_mode: 'HTML',
    });
  });

  it('defaults to simulated mode for Google Sheets when no webhook URL is defined', async () => {
    const dispatcher = new WebhookDispatcher();
    const res = await dispatcher.dispatchGoogleSheetsSync(samplePlan);

    expect(res.synced).toBe(true);
    expect(res.mode).toBe('SIMULATED');
    expect(res.updatedRange).toBe("'Ledger Planes P2P'!A2:H2");
  });

  it('syncs to live Google Sheets webhook when URL is configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const dispatcher = new WebhookDispatcher({
      gsheets: {
        webhookUrl: 'https://script.google.com/macros/s/AKfycbx_test/exec',
        sheetName: 'Libro Operativo',
      },
      fetchFn: mockFetch as any,
    });

    const res = await dispatcher.dispatchGoogleSheetsSync(samplePlan);
    expect(res.synced).toBe(true);
    expect(res.mode).toBe('LIVE');
    expect(res.updatedRange).toBe("'Libro Operativo'!A:H");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://script.google.com/macros/s/AKfycbx_test/exec');
    expect(JSON.parse(init.body)).toMatchObject({
      action: 'APPEND_PLAN',
      sheetName: 'Libro Operativo',
    });
  });

  it('dispatches generic webhook with secret header when configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const dispatcher = new WebhookDispatcher({
      genericWebhook: {
        url: 'https://hooks.zapier.com/hooks/catch/123/abc',
        secret: 'p2p-secret-key',
      },
      fetchFn: mockFetch as any,
    });

    const summary = await dispatcher.dispatchPlanExecution(samplePlan);
    expect(summary.genericWebhook?.dispatched).toBe(true);
    expect(summary.genericWebhook?.status).toBe(200);

    const genericCall = mockFetch.mock.calls.find(([u]) => (u as string).includes('zapier'));
    expect(genericCall).toBeDefined();
    expect(genericCall![1].headers['X-P2P-Signature']).toBe('p2p-secret-key');
  });

  it('executes full dispatchPlanExecution pipeline gracefully without throwing on errors', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('telegram')) {
        return Promise.reject(new Error('Telegram network drop'));
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      });
    });

    const dispatcher = new WebhookDispatcher({
      telegram: { botToken: 'tok', chatId: '123' },
      gsheets: { webhookUrl: 'https://script.google.com/exec' },
      fetchFn: mockFetch as any,
    });

    const summary: PlanDispatchSummary = await dispatcher.dispatchPlanExecution(samplePlan);

    expect(summary.planId).toBe(samplePlan.id);
    expect(summary.telegram.sent).toBe(false);
    expect(summary.telegram.error).toContain('Telegram network drop');
    expect(summary.sheets.synced).toBe(true);
    expect(summary.sheets.mode).toBe('LIVE');
  });
});
