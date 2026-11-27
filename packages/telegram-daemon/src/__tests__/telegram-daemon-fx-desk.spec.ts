import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

process.env['TELEGRAM_DAEMON_TEST_IMPORT'] = 'true';

import {
  handleUpdate,
  issueDaemonFxBoughtNonce,
  validateAndConsumeDaemonFxBoughtNonce,
  resetDaemonFxStateForTesting,
} from '../index';

describe('Telegram Daemon — Mesa Cambiaria BCV (/mesa, FX_BOUGHT, FX_EMPTY)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetDaemonFxStateForTesting();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetDaemonFxStateForTesting();
    vi.restoreAllMocks();
  });

  it('issues single-use FX_BOUGHT nonces bound to bankId + orderUsd and blocks replay or tampering', () => {
    const nonce = issueDaemonFxBoughtNonce('BDV', 100);
    expect(nonce).toMatch(/^[a-f0-9]{10,16}$/);

    // Tampered amount or bank must fail without burning valid state for a forged call, or fail closed
    expect(validateAndConsumeDaemonFxBoughtNonce(nonce, 'BDV', 500, `tg:${nonce}:tampered`)).toBe(
      false,
    );
    expect(validateAndConsumeDaemonFxBoughtNonce(nonce, 'BANESCO', 100, `tg:${nonce}:bank`)).toBe(
      false,
    );

    // Exact match succeeds once
    expect(validateAndConsumeDaemonFxBoughtNonce(nonce, 'BDV', 100, `tg:${nonce}`)).toBe(true);

    // Second replay with same nonce fails
    expect(validateAndConsumeDaemonFxBoughtNonce(nonce, 'BDV', 100, `tg:${nonce}`)).toBe(false);

    // Unsigned callback without nonce fails closed
    expect(validateAndConsumeDaemonFxBoughtNonce(undefined, 'BDV', 100, 'tg:unsigned')).toBe(false);
  });

  it('handles /mesa 150000 bdv by dispatching formatted plan + signed FX_BOUGHT inline keyboard', async () => {
    const sentPayloads: Array<Record<string, unknown>> = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('p2p.binance.com')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { tradeType?: string };
        const price = body.tradeType === 'SELL' ? '78.50' : '79.20';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                adv: {
                  advNo: '1',
                  price,
                  surplusAmount: '1500',
                  minSingleTransAmount: '500',
                  maxSingleTransAmount: '200000',
                  tradeMethods: [{ identifier: 'BancoDeVenezuela' }],
                },
                advertiser: {
                  nickName: 'MakerVE',
                  monthOrderCount: 150,
                  monthFinishRate: 0.99,
                  userType: 'merchant',
                },
              },
            ],
          }),
        } as unknown as Response;
      }
      if (url.includes('api.cotizave.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            rates: { bcv: { mid: 64.5, price: 64.5 } },
          }),
        } as unknown as Response;
      }
      if (url.includes('/sendMessage')) {
        sentPayloads.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return { ok: true, status: 200, text: async () => 'OK' } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }) as unknown as typeof fetch;

    await handleUpdate(
      {
        update_id: 9001,
        message: {
          message_id: 501,
          from: { id: 777001 },
          chat: { id: 777001, type: 'private' },
          text: '/mesa 150000 bdv',
        },
      },
      {
        botToken: 'test-bot-token',
        authorizedChatId: '777001',
        cotizaveApiKey: 'cotiza-test-key',
      },
    );

    expect(sentPayloads.length).toBe(1);
    const replyText = String(sentPayloads[0]?.['text'] ?? '');
    expect(replyText).toMatch(/MESA DE CAMBIO|BDV/i);
    const markup = sentPayloads[0]?.['reply_markup'] as
      | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
      | undefined;
    const allButtons = markup?.inline_keyboard?.flat() ?? [];
    const boughtBtn = allButtons.find((b) => b.callback_data?.startsWith('FX_BOUGHT:'));
    expect(boughtBtn?.callback_data ?? '').toMatch(/^FX_BOUGHT:BDV:\d+:[a-f0-9]{10,16}$/);
  });

  it('blocks FX_BOUGHT callbacks from group chats and prevents double-spend replay in private chats', async () => {
    const nonce = issueDaemonFxBoughtNonce('BDV', 100);
    const apiCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('api.cotizave.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ rates: { bcv: { mid: 65.0, price: 65.0 } } }),
        } as unknown as Response;
      }
      apiCalls.push({
        url,
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return { ok: true, status: 200, text: async () => 'OK', json: async () => ({ ok: true }) } as unknown as Response;
    }) as unknown as typeof fetch;

    // 1. Group chat attempt MUST be denied without consuming the private nonce
    await handleUpdate(
      {
        update_id: 9002,
        callback_query: {
          id: 'cb-group-1',
          from: { id: 777001 },
          data: `FX_BOUGHT:BDV:100:${nonce}`,
          message: {
            message_id: 88,
            chat: { id: 777001, type: 'supergroup' },
          },
        },
      },
      {
        botToken: 'test-bot-token',
        authorizedChatId: '777001',
        cotizaveApiKey: 'cotiza-test-key',
      },
    );

    expect(apiCalls.some((c) => c.body['text']?.toString().includes('Asiento 1x Fee'))).toBe(false);

    // 2. Private chat succeeds with 1x fee (100 * 65 = 6500 Bs principal + 16.25 Bs 0.25% fee = 6516.25 Bs)
    apiCalls.length = 0;
    await handleUpdate(
      {
        update_id: 9003,
        callback_query: {
          id: 'cb-priv-1',
          from: { id: 777001 },
          data: `FX_BOUGHT:BDV:100:${nonce}`,
          message: {
            message_id: 89,
            chat: { id: 777001, type: 'private' },
          },
        },
      },
      {
        botToken: 'test-bot-token',
        authorizedChatId: '777001',
        cotizaveApiKey: 'cotiza-test-key',
      },
    );

    expect(apiCalls.some((c) => c.url.includes('/editMessageReplyMarkup'))).toBe(true);
    const confirmMsg = apiCalls.find((c) => c.url.includes('/sendMessage'));
    expect(String(confirmMsg?.body['text'] ?? '')).toContain('6516');

    // 3. Replay of same callback is blocked!
    apiCalls.length = 0;
    await handleUpdate(
      {
        update_id: 9004,
        callback_query: {
          id: 'cb-priv-replay',
          from: { id: 777001 },
          data: `FX_BOUGHT:BDV:100:${nonce}`,
          message: {
            message_id: 89,
            chat: { id: 777001, type: 'private' },
          },
        },
      },
      {
        botToken: 'test-bot-token',
        authorizedChatId: '777001',
        cotizaveApiKey: 'cotiza-test-key',
      },
    );

    const answerCall = apiCalls.find((c) => c.url.includes('/answerCallbackQuery'));
    expect(String(answerCall?.body['text'] ?? '')).toMatch(/procesado|expirado/i);
  });
});
