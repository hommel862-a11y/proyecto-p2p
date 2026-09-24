import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelegramWorkerService, type TelegramBotInfo } from './telegram-worker.service';
import { CredentialStoreService } from './credential-store.service';
import { ToastService } from './toast.service';
import { BinanceP2pService } from './binance-p2p.service';
import { BinanceRepricerService } from './binance-repricer.service';
import { AccountsService } from './accounts.service';
import { CotizaveService } from './cotizave.service';
import type { TelegramInboundUpdate } from '@p2p/core';

const TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
const CHAT_ID = 987654321;
const INTRUDER_CHAT_ID = 111222333;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as unknown as Response;
}

/** Routes fetch calls by URL fragment (getMe / getUpdates / sendMessage). */
function fetchRouter(routes: Record<string, unknown>): ReturnType<typeof vi.fn<FetchLike>> {
  const matchers = Object.entries(routes).map(([fragment, payload]) => ({ fragment, payload }));
  return vi.fn<FetchLike>(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = matchers.find((m) => url.includes(m.fragment));
    if (!match) throw new Error(`Unexpected URL in test: ${url}`);
    // Mirror the real Telegram API: error_code doubles as the HTTP status.
    const payload = match.payload as { ok?: boolean; error_code?: number };
    const status = typeof payload?.error_code === 'number' ? payload.error_code : 200;
    const ok = status >= 200 && status < 300;
    return jsonResponse(payload, ok, status);
  });
}

function startMessage(fromId: number, chatId: number, text = '/start'): TelegramInboundUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: fromId, username: 'entretest', first_name: 'EntreTest' },
      chat: { id: chatId, type: 'private' },
      text,
      date: 1_700_000_000,
    },
  };
}

describe('TelegramWorkerService', () => {
  let svc: TelegramWorkerService;
  const toast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  // Private method exercised through a minimal typed cast (no `any`):
  type ProcessIncoming = (
    update: TelegramInboundUpdate,
    token: string,
    authorizedChatId: string,
  ) => Promise<void>;

  function processIncoming(update: TelegramInboundUpdate, token: string, authChat: string) {
    return (svc as unknown as { processIncomingUpdate: ProcessIncoming }).processIncomingUpdate(
      update,
      token,
      authChat,
    );
  }

  beforeEach(async () => {
    toast.success.mockReset();
    toast.info.mockReset();
    toast.error.mockReset();
    toast.warn.mockReset();

    delete (window as unknown as Record<string, unknown>)['electron'];

    TestBed.configureTestingModule({
      providers: [
        {
          provide: CredentialStoreService,
          useValue: {
            getTelegramConfig: vi.fn(async () => null),
            setTelegramConfig: vi.fn(async () => undefined),
          },
        },
        { provide: ToastService, useValue: toast },
        {
          provide: BinanceP2pService,
          useValue: {
            fetchMarketDepth: vi.fn(async () => null),
            marketDepth: vi.fn(() => null),
            lastFetched: vi.fn(() => null),
          },
        },
        {
          provide: BinanceRepricerService,
          useValue: {
            start: vi.fn(),
            stop: vi.fn(),
            isActive: vi.fn(() => false),
          },
        },
        { provide: AccountsService, useValue: { usages: vi.fn(() => []) } },
        {
          provide: CotizaveService,
          useValue: {
            fetchRates: vi.fn(async () => undefined),
            ratesByMarket: vi.fn(() => ({})),
          },
        },
      ],
    });

    svc = TestBed.inject(TelegramWorkerService);
    // hydrateAndStart() runs in the constructor and awaits getTelegramConfig.
    await vi.waitFor(() => expect(svc.config()).toBeDefined());
  });

  afterEach(() => {
    svc?.stopPolling();
    delete (window as unknown as Record<string, unknown>)['electron'];
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  describe('getBotInfo', () => {
    it('returns bot info for a valid token', async () => {
      const fetchMock = fetchRouter({
        getMe: { ok: true, result: { id: 123, username: 'MyBot', first_name: 'My' } },
      });
      vi.stubGlobal('fetch', fetchMock);

      const info: TelegramBotInfo | null = await svc.getBotInfo(`  ${TOKEN}  `);

      expect(info).toEqual({ id: 123, username: 'MyBot', firstName: 'My' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
    });

    it('returns null when the API rejects the token (HTTP error)', async () => {
      const fetchMock = fetchRouter({
        getMe: { ok: false, description: 'Not Found', error_code: 404 },
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(svc.getBotInfo(TOKEN)).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns null when getMe replies ok:false without a result', async () => {
      vi.stubGlobal('fetch', fetchRouter({ getMe: { ok: false } }));
      await expect(svc.getBotInfo(TOKEN)).resolves.toBeNull();
    });

    it('returns null on network failure without throwing', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn<FetchLike>(async () => Promise.reject(new Error('offline'))),
      );
      await expect(svc.getBotInfo(TOKEN)).resolves.toBeNull();
    });

    it('returns null for an empty/whitespace token without hitting the network', async () => {
      const fetchMock = vi.fn<FetchLike>();
      vi.stubGlobal('fetch', fetchMock);
      await expect(svc.getBotInfo('   ')).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('detectChatIdFromUpdates', () => {
    const GET_ME_OK = {
      ok: true,
      result: { id: 123, username: 'MyBot', first_name: 'My' },
    };

    it('rejects an empty token before any network call', async () => {
      const fetchMock = vi.fn<FetchLike>();
      vi.stubGlobal('fetch', fetchMock);

      const result = await svc.detectChatIdFromUpdates('  ');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports an invalid token when getMe fails (before hitting getUpdates)', async () => {
      const fetchMock = fetchRouter({ getMe: { ok: false, error_code: 401 } });
      vi.stubGlobal('fetch', fetchMock);

      const result = await svc.detectChatIdFromUpdates(TOKEN);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token inválido');
      expect(fetchMock).toHaveBeenCalledTimes(1); // only getMe
    });

    it('returns the chat id from a message update', async () => {
      const fetchMock = fetchRouter({
        getMe: GET_ME_OK,
        getUpdates: {
          ok: true,
          result: [
            {
              update_id: 10,
              message: {
                message_id: 1,
                from: { id: CHAT_ID, username: 'entretest', first_name: 'EntreTest' },
                chat: { id: CHAT_ID, type: 'private' },
                text: '/start',
                date: 1_700_000_000,
              },
            },
          ],
        },
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await svc.detectChatIdFromUpdates(TOKEN);

      expect(result.success).toBe(true);
      expect(result.chatId).toBe(String(CHAT_ID));
      expect(result.username).toBe('entretest');
      expect(result.botUsername).toBe('MyBot');
      expect(fetchMock).toHaveBeenCalledTimes(2); // getMe + getUpdates
    });

    it('returns an empty-result failure mentioning /start when no updates exist', async () => {
      const fetchMock = fetchRouter({ getMe: GET_ME_OK, getUpdates: { ok: true, result: [] } });
      vi.stubGlobal('fetch', fetchMock);

      const result = await svc.detectChatIdFromUpdates(TOKEN);

      expect(result.success).toBe(false);
      expect(result.error).toContain('/start');
      expect(result.error).toContain('MyBot');
    });

    it('surfaces an HTTP 409 conflict from getUpdates as a clear error', async () => {
      const fetchMock = fetchRouter({
        getMe: GET_ME_OK,
        getUpdates: {
          ok: false,
          error_code: 409,
          description: 'Conflict: terminated by other getUpdates request',
        },
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await svc.detectChatIdFromUpdates(TOKEN);

      expect(result.success).toBe(false);
      expect(result.error).toContain('409');
    });

    it('wins the detection from the in-memory cache captured by the poll loop', async () => {
      // Simulate the poll loop having captured a /start from the user.
      svc.lastInboundChat.set({
        chatId: String(CHAT_ID),
        username: 'entretest',
        firstName: 'EntreTest',
        receivedAt: new Date(),
      });
      const fetchMock = fetchRouter({ getMe: GET_ME_OK });
      vi.stubGlobal('fetch', fetchMock);

      const result = await svc.detectChatIdFromUpdates(TOKEN);

      expect(result.success).toBe(true);
      expect(result.chatId).toBe(String(CHAT_ID));
      expect(fetchMock).toHaveBeenCalledTimes(1); // only getMe, never getUpdates
    });

    it('never calls getUpdates while long-polling is running (avoids 409)', async () => {
      svc.isPolling.set(true);
      const fetchMock = fetchRouter({ getMe: GET_ME_OK });
      vi.stubGlobal('fetch', fetchMock);

      const result = await svc.detectChatIdFromUpdates(TOKEN);

      expect(result.success).toBe(false);
      expect(result.error).toContain('/start');
      expect(fetchMock).toHaveBeenCalledTimes(1); // getMe only — the poll loop owns getUpdates
    });

    it('returns a network error result instead of throwing on fetch failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn<FetchLike>(async (input: RequestInfo | URL) => {
          if (String(input).includes('/getMe')) return jsonResponse(GET_ME_OK);
          throw new Error('network down');
        }),
      );

      const result = await svc.detectChatIdFromUpdates(TOKEN);

      expect(result.success).toBe(false);
      expect(result.error).toContain('red');
    });
  });

  describe('processIncomingUpdate', () => {
    it('answers /start from the authorized chat with the pairing message', async () => {
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);
      const update = startMessage(CHAT_ID, CHAT_ID);

      await processIncoming(update, TOKEN, String(CHAT_ID));

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        TOKEN,
        CHAT_ID,
        expect.stringContaining('TELEGRAM SENTINEL'),
      );
      const markdown = sendSpy.mock.calls[0][2] as string;
      expect(markdown).toContain(String(CHAT_ID));
      // The sentinel marks /start authorized even for unknown chats; the log records a success.
      const log = svc.recentLogs()[0];
      expect(log.command).toBe('/start');
      expect(log.status).toBe('SUCCESS');
      expect(svc.lastInboundChat()?.chatId).toBe(String(CHAT_ID));
      sendSpy.mockRestore();
    });

    it('answers /start from an unknown chat (pairing) without denying or double-sending', async () => {
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);
      const update = startMessage(INTRUDER_CHAT_ID, INTRUDER_CHAT_ID);

      await processIncoming(update, TOKEN, String(CHAT_ID));

      // Exactly one send: the /start handshake, not the access-denied message too.
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        TOKEN,
        INTRUDER_CHAT_ID,
        expect.stringContaining('TELEGRAM SENTINEL'),
      );
      const markdown = sendSpy.mock.calls[0][2] as string;
      expect(markdown).toContain('Para autorizar este chat');
      expect(markdown).not.toContain('ACCESO DENEGADO');
      const log = svc.recentLogs()[0];
      expect(log.status).toBe('SUCCESS');
      sendSpy.mockRestore();
    });

    it('replies to an unauthorized chat with the access-denied message', async () => {
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);
      const update = startMessage(INTRUDER_CHAT_ID, INTRUDER_CHAT_ID, '/status');

      await processIncoming(update, TOKEN, String(CHAT_ID));

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        TOKEN,
        INTRUDER_CHAT_ID,
        expect.stringContaining('ACCESO DENEGADO'),
      );
      const log = svc.recentLogs()[0];
      expect(log.command).toBe('/status');
      expect(log.status).toBe('DENIED');
      expect(log.action).toBe('DENEGADO');
      sendSpy.mockRestore();
    });

    it('answers a callback_query from the authorized chat using its chat id', async () => {
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);
      const update: TelegramInboundUpdate = {
        update_id: 2,
        callback_query: {
          id: 'cb-1',
          from: { id: CHAT_ID, username: 'entretest' },
          data: 'BOT_STATUS',
          message: { message_id: 5, chat: { id: CHAT_ID } },
        },
      };

      await processIncoming(update, TOKEN, String(CHAT_ID));

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(TOKEN, CHAT_ID, expect.any(String));
      expect(svc.lastInboundChat()?.chatId).toBe(String(CHAT_ID));
      sendSpy.mockRestore();
    });

    it('keeps logging and does not throw when the denied reply fails to send', async () => {
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(false);
      const update = startMessage(INTRUDER_CHAT_ID, INTRUDER_CHAT_ID, '/status');

      await expect(processIncoming(update, TOKEN, String(CHAT_ID))).resolves.toBeUndefined();

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const log = svc.recentLogs()[0];
      expect(log.status).toBe('DENIED');
      sendSpy.mockRestore();
    });
  });

  describe('saveConfig', () => {
    it('reinicia el polling cuando el Chat ID cambia mientras el worker ya está activo', async () => {
      // Estado previo: polling 24/7 corriendo con un Chat ID viejo.
      svc.isPolling.set(true);
      svc.config.set({
        botToken: TOKEN,
        chatId: '999000111',
        alertsEnabled: true,
        pollingEnabled: true,
      });

      const stopSpy = vi.spyOn(svc, 'stopPolling').mockImplementation(() => {});
      const startSpy = vi.spyOn(svc, 'startPolling').mockImplementation(() => {});

      await svc.saveConfig({
        botToken: TOKEN,
        chatId: String(CHAT_ID),
        alertsEnabled: true,
        pollingEnabled: true,
      });

      // El loop activo debe reiniciarse para que pollLoop recapture el
      // nuevo authorizedChatId (el bug anterior no hacía nada aquí).
      expect(stopSpy).toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalled();

      stopSpy.mockRestore();
      startSpy.mockRestore();
    });

    it('mantiene el polling activo sin reiniciarlo cuando el Chat ID no cambia', async () => {
      svc.isPolling.set(true);
      svc.config.set({
        botToken: TOKEN,
        chatId: String(CHAT_ID),
        alertsEnabled: true,
        pollingEnabled: true,
      });

      const stopSpy = vi.spyOn(svc, 'stopPolling').mockImplementation(() => {});
      const startSpy = vi.spyOn(svc, 'startPolling').mockImplementation(() => {});

      await svc.saveConfig({
        botToken: TOKEN,
        chatId: String(CHAT_ID),
        alertsEnabled: false,
        pollingEnabled: true,
      });

      expect(stopSpy).not.toHaveBeenCalled();
      expect(startSpy).not.toHaveBeenCalled();

      stopSpy.mockRestore();
      startSpy.mockRestore();
    });
  });

  describe('sendTelegramMessage', () => {
    it('posts MarkdownV2 to sendMessage and returns true on success', async () => {
      const fetchMock = fetchRouter({ sendMessage: { ok: true, result: { message_id: 1 } } });
      vi.stubGlobal('fetch', fetchMock);

      const ok = await svc.sendTelegramMessage(TOKEN, CHAT_ID, '*Hola*');

      expect(ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['chat_id']).toBe(CHAT_ID);
      expect(body['text']).toBe('*Hola*');
      expect(body['parse_mode']).toBe('MarkdownV2');
    });

    it('returns false on a failed API response (no throw)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn<FetchLike>(async () => jsonResponse({ ok: false }, false, 400)),
      );
      await expect(svc.sendTelegramMessage(TOKEN, CHAT_ID, 'msg')).resolves.toBe(false);
    });

    it('returns false on network failure (no throw)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn<FetchLike>(async () => Promise.reject(new Error('down'))),
      );
      await expect(svc.sendTelegramMessage(TOKEN, CHAT_ID, 'msg')).resolves.toBe(false);
    });
  });
});
