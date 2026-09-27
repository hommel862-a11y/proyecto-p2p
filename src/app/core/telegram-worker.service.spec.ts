import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelegramWorkerService, type TelegramBotInfo } from './telegram-worker.service';
import { CredentialStoreService } from './credential-store.service';
import { ToastService } from './toast.service';
import { BinanceP2pService } from './binance-p2p.service';
import { BinanceRepricerService } from './binance-repricer.service';
import { AccountsService } from './accounts.service';
import { CotizaveService } from './cotizave.service';
import { MarketHistoryService } from './market-history.service';
import type {
  BinanceP2pMarketDepth,
  TelegramInboundUpdate,
  TelegramInlineKeyboardMarkup,
} from '@p2p/core';

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

/** A `/radar`/`/macro` invocation from the authorized chat. */
function commandMessage(text: string, chatId = CHAT_ID): TelegramInboundUpdate {
  return startMessage(chatId, chatId, text);
}

/** A confirmation-button press from the authorized chat. */
function callbackUpdate(data: string, id = 'cb-1', chatId = CHAT_ID): TelegramInboundUpdate {
  return {
    update_id: 2,
    callback_query: {
      id,
      from: { id: chatId, username: 'entretest' },
      data,
      message: { message_id: 7, chat: { id: chatId } },
    },
  };
}

/**
 * Live-shaped Binance P2P depth. Every number here is a real field of
 * `BinanceP2pMarketDepth`, and the two sides are coherent: the bid (what we get
 * selling USDT) sits above the ask (what we pay buying it), which is what makes a
 * gap tradable. The radar rows are derived from it, never invented.
 */
const LIVE_DEPTH: BinanceP2pMarketDepth = {
  asset: 'USDT',
  fiat: 'VES',
  // Cheapest ask and best bid must match the offer lists below.
  bestBuyPrice: 85.0,
  bestSellPrice: 85.9,
  spreadVes: 0.9,
  spreadPct: 1.06,
  // Asks: what the operator pays to acquire USDT.
  sellOffers: [
    {
      advNo: 'a1',
      price: 85.2,
      merchantName: 'MakerUno',
      finishRatePct: 99,
      orderCount: 120,
      minVes: 100,
      maxVes: 20400,
      payMethods: ['Banesco'],
    },
    {
      advNo: 'a2',
      price: 85.0,
      merchantName: 'MakerDos',
      finishRatePct: 98,
      orderCount: 80,
      minVes: 100,
      maxVes: 5000,
      payMethods: ['BancaMiga'],
    },
  ],
  // Bids: what the operator receives disposing of USDT.
  buyOffers: [
    {
      advNo: 'b1',
      price: 85.9,
      merchantName: 'MakerTres',
      finishRatePct: 99,
      orderCount: 200,
      minVes: 100,
      maxVes: 8000,
      payMethods: ['Banesco'],
    },
    {
      advNo: 'b2',
      price: 85.4,
      merchantName: 'MakerCuatro',
      finishRatePct: 97,
      orderCount: 50,
      minVes: 100,
      maxVes: 3000,
      payMethods: ['BancaMiga'],
    },
  ],
  updatedAt: '2026-09-27T12:00:00.000Z',
};

/** Harness summary shaped exactly like the JSON `scripts/backtest.cjs` writes. */
const BACKTEST_SUMMARY = {
  data: { snapshots: 42, operations: 7, sessions: 3 },
  spreadEngine: { pointsEvaluated: 40, aciertoNetoPct: 62.5 },
  triangularEngine: {
    cyclesFound: 2,
    cycles: [
      { cycleId: 'Ciclo #1', simulated: { roiPct: 1.2 }, recorded: { roiPct: 1.1 } },
      { cycleId: 'Ciclo #2', simulated: { roiPct: 2.4 }, recorded: { roiPct: 2.5 } },
    ],
  },
};

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

  /** Mock handles, reassigned on every TestBed setup so tests can steer them. */
  let fetchMarketDepth: ReturnType<typeof vi.fn<() => Promise<BinanceP2pMarketDepth | null>>>;
  let usages: ReturnType<typeof vi.fn<() => unknown[]>>;
  let ratesByMarket: ReturnType<typeof vi.fn<() => Record<string, unknown>>>;
  let buyAdPrice: ReturnType<typeof signal<number>>;
  let sellAdPrice: ReturnType<typeof signal<number>>;
  let marketHistory: ReturnType<typeof vi.fn<() => unknown[]>>;

  beforeEach(async () => {
    toast.success.mockReset();
    toast.info.mockReset();
    toast.error.mockReset();
    toast.warn.mockReset();

    delete (window as unknown as Record<string, unknown>)['electron'];

    fetchMarketDepth = vi.fn(async (): Promise<BinanceP2pMarketDepth | null> => null);
    usages = vi.fn((): unknown[] => []);
    ratesByMarket = vi.fn((): Record<string, unknown> => ({}));
    marketHistory = vi.fn((): unknown[] => []);
    buyAdPrice = signal(0);
    sellAdPrice = signal(0);

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
            fetchMarketDepth,
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
            // Writable, like the real engine: the worker overwrites these on an
            // operator-confirmed reprice.
            currentBuyAdPrice: buyAdPrice,
            currentSellAdPrice: sellAdPrice,
          },
        },
        { provide: AccountsService, useValue: { usages } },
        {
          provide: CotizaveService,
          useValue: {
            fetchRates: vi.fn(async () => undefined),
            ratesByMarket,
          },
        },
        { provide: MarketHistoryService, useValue: { history: marketHistory } },
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

  describe('operational commands V2 (W1 contract)', () => {
    /**
     * New worker internals, reached through a cast so this spec compiles before
     * the implementation exists (the assertions are what must fail first).
     */
    type WorkerV2Api = {
      answerCallbackQuery: (
        token: string,
        callbackQueryId: string | undefined,
        text?: string,
      ) => Promise<boolean>;
      applyForcedReprice: (params: { buyPrice: number; sellPrice: number }) => boolean;
    };

    function internals(): WorkerV2Api {
      return svc as unknown as WorkerV2Api;
    }

    /** `window.electron` bridge stub; the backtest runner only exists on desktop. */
    function stubBacktestBridge(result: unknown) {
      const run = vi.fn(async (_options: unknown) => result);
      (window as unknown as Record<string, unknown>)['electron'] = { backtest: { run } };
      return run;
    }

    function sentText(spy: ReturnType<typeof vi.spyOn>, index = 0): string {
      const call = spy.mock.calls[index] as unknown as [string, string, string];
      return call[2] ?? '';
    }

    /**
     * Same text with MarkdownV2 escapes removed, so assertions can talk about the
     * operator-visible value instead of the wire format (`.` ships as `\.`).
     */
    function sentPlain(spy: ReturnType<typeof vi.spyOn>, index = 0): string {
      return sentText(spy, index).replace(/\\/g, '');
    }

    it('RADAR_SCAN builds rows from the live depth and reports real liquidity', async () => {
      fetchMarketDepth.mockResolvedValue(LIVE_DEPTH);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/radar'), TOKEN, String(CHAT_ID));

      const text = sentPlain(sendSpy);
      expect(text).toContain('RADAR DE GAPS');
      // Banesco: 20400 VES / 85.2 VES-USDT = 239 USDT of real depth.
      expect(text).toContain('239 USDT');
      // Banesco gap = (85.9 - 85.2) / 85.2 = 0.82%
      expect(text).toContain('0.82');
      // BancaMiga: 5000 VES / 85.0 = 59 USDT, gap = (85.4 - 85.0) / 85.0 = 0.47%
      expect(text).toContain('59 USDT');
      expect(text).toContain('0.47');
      // No account declares a cap, so the SUDEBAN default applies.
      expect(text).toContain('Tope TC: `15`');
      expect(svc.recentLogs().some((entry) => entry.action === 'RADAR_SCAN')).toBe(true);
    });

    it('RADAR_SCAN keeps the widest gaps and discloses the banks it dropped', async () => {
      // Twelve banks with a real two-sided gap plus two one-sided banks, so the report
      // has to choose: Telegram rejects messages over 4096 characters, and a full book
      // can produce far more rows than fit.
      const twoSided: BinanceP2pMarketDepth = {
        asset: 'USDT',
        fiat: 'VES',
        bestBuyPrice: 85,
        bestSellPrice: 86.2,
        spreadVes: 1.2,
        spreadPct: 1.41,
        updatedAt: '2026-09-27T12:00:00.000Z',
        sellOffers: Array.from({ length: 12 }, (_, i) => ({
          advNo: `a${i}`,
          price: 85,
          merchantName: `Maker${i}`,
          finishRatePct: 99,
          orderCount: 100,
          minVes: 100,
          maxVes: 8500,
          payMethods: [`Banco${i}`],
        })),
        buyOffers: Array.from({ length: 12 }, (_, i) => ({
          advNo: `b${i}`,
          price: 85 + (i + 1) / 10,
          merchantName: `Maker${i}`,
          finishRatePct: 99,
          orderCount: 100,
          minVes: 100,
          maxVes: 8500,
          payMethods: [`Banco${i}`],
        })),
      };
      fetchMarketDepth.mockResolvedValue(twoSided);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/radar'), TOKEN, String(CHAT_ID));

      const text = sentPlain(sendSpy);
      // The message must stay inside the Telegram limit: at most 8 rows.
      const bankRows = text.split('\n').filter((line) => line.includes('Tope TC:'));
      expect(bankRows.length).toBeLessThanOrEqual(8);
      // The widest gap (Banco11: (86.2 - 85) / 85 = 1.41%) survives the cut.
      expect(text).toContain('Banco11');
      expect(text).toContain('1.41');
      // Truncation is never silent.
      expect(text).toMatch(/quedaron fuera|fuera del reporte/i);
    });

    it('RADAR_SCAN puts banks without a two-sided gap last', async () => {
      const oneSided: BinanceP2pMarketDepth = {
        asset: 'USDT',
        fiat: 'VES',
        bestBuyPrice: 85,
        bestSellPrice: 85.9,
        spreadVes: 0.9,
        spreadPct: 1.06,
        updatedAt: '2026-09-27T12:00:00.000Z',
        // Bancamiga has no bid at all, so its gap cannot be computed.
        sellOffers: [
          {
            advNo: 'a1',
            price: 85.2,
            merchantName: 'MakerUno',
            finishRatePct: 99,
            orderCount: 120,
            minVes: 100,
            maxVes: 20400,
            payMethods: ['Banesco'],
          },
          {
            advNo: 'a2',
            price: 85,
            merchantName: 'MakerDos',
            finishRatePct: 98,
            orderCount: 80,
            minVes: 100,
            maxVes: 5000,
            payMethods: ['Bancamiga'],
          },
        ],
        buyOffers: [
          {
            advNo: 'b1',
            price: 85.9,
            merchantName: 'MakerTres',
            finishRatePct: 99,
            orderCount: 200,
            minVes: 100,
            maxVes: 8000,
            payMethods: ['Banesco'],
          },
        ],
      };
      fetchMarketDepth.mockResolvedValue(oneSided);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/radar'), TOKEN, String(CHAT_ID));

      const text = sentPlain(sendSpy);
      expect(text).toContain('Banesco');
      expect(text).toContain('Bancamiga');
      // Bancamiga has no bid, so its gap is unknown and must render as n/d, and it
      // must not be ranked above the bank that has a real, tradable gap.
      expect(text).toContain('n/d');
      expect(text.indexOf('Banesco')).toBeLessThan(text.indexOf('Bancamiga'));
    });

    it('RADAR_SCAN uses the configured daily transaction cap of the matching account', async () => {
      fetchMarketDepth.mockResolvedValue(LIVE_DEPTH);
      usages.mockReturnValue([
        {
          account: {
            id: 'a1',
            bankName: 'Banesco Transferencia',
            bankCode: 'BANESCO',
            maxDailyTransactions: 2,
          },
        },
      ]);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/radar'), TOKEN, String(CHAT_ID));

      const text = sentText(sendSpy);
      // Banesco drops to the operator's 2-op cap; BancaMiga keeps the default 15.
      expect(text).toContain('Tope TC: `2`');
      expect(text).toContain('Tope TC: `15`');
    });

    it('RADAR_SCAN honors a bank filter', async () => {
      fetchMarketDepth.mockResolvedValue(LIVE_DEPTH);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/radar bancamiga'), TOKEN, String(CHAT_ID));

      const text = sentPlain(sendSpy);
      expect(text).toContain('59 USDT');
      expect(text).not.toContain('239 USDT');
    });

    it('RADAR_SCAN drops banks whose real depth is below the capital floor', async () => {
      fetchMarketDepth.mockResolvedValue(LIVE_DEPTH);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/radar bancamiga 100'), TOKEN, String(CHAT_ID));

      const text = sentText(sendSpy);
      expect(text).not.toContain('59 USDT');
      expect(text).toContain('SIN RESULTADOS');
    });

    it('RADAR_SCAN says so honestly when there is no live depth', async () => {
      fetchMarketDepth.mockResolvedValue(null);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/radar'), TOKEN, String(CHAT_ID));

      const text = sentText(sendSpy);
      expect(text).toContain('SIN RESULTADOS');
      expect(text).toContain('Sin datos en vivo');
    });

    it('REPRICE_REQUEST asks for confirmation and shows the confirm/cancel keyboard', async () => {
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/reprecio 84.5 85.2'), TOKEN, String(CHAT_ID));

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const keyboard = sendSpy.mock.calls[0]?.[3] as TelegramInlineKeyboardMarkup | undefined;
      const dataValues = (keyboard?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
      expect(dataValues).toEqual(
        expect.arrayContaining(['REPRICE_CONFIRM:84.5:85.2', 'REPRICE_CANCEL']),
      );
      // Confirmation must NOT mutate engine state.
      expect(buyAdPrice()).toBe(0);
    });

    it('REPRICE_EXECUTE acknowledges the callback before applying the price', async () => {
      const order: string[] = [];
      vi.spyOn(internals(), 'answerCallbackQuery').mockImplementation(async () => {
        order.push('ack');
        return true;
      });
      vi.spyOn(internals(), 'applyForcedReprice').mockImplementation(() => {
        order.push('apply');
        return true;
      });
      vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(
        callbackUpdate('REPRICE_CONFIRM:84.5:85.2'),
        TOKEN,
        String(CHAT_ID),
      );

      expect(order).toEqual(['ack', 'apply']);
    });

    it('REPRICE_EXECUTE writes the forced price into the repricer engine', async () => {
      vi.spyOn(internals(), 'answerCallbackQuery').mockResolvedValue(true);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(
        callbackUpdate('REPRICE_CONFIRM:84.5:85.2'),
        TOKEN,
        String(CHAT_ID),
      );

      expect(buyAdPrice()).toBe(84.5);
      expect(sellAdPrice()).toBe(85.2);
      expect(sentPlain(sendSpy)).toContain('84.50');
    });

    it('REPRICE_CANCEL discards with a short ack and leaves the engine untouched', async () => {
      const ackSpy = vi.spyOn(internals(), 'answerCallbackQuery').mockResolvedValue(true);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(callbackUpdate('REPRICE_CANCEL'), TOKEN, String(CHAT_ID));

      expect(ackSpy).toHaveBeenCalled();
      expect(buyAdPrice()).toBe(0);
      expect(sentText(sendSpy).toLowerCase()).toContain('cancel');
    });

    it('MACRO reports the BCV gap from real rates and market depth', async () => {
      fetchMarketDepth.mockResolvedValue(LIVE_DEPTH);
      ratesByMarket.mockReturnValue({
        binance: { market: 'binance', type: 'p2p', ask: 84.8, mid: 84.7 },
        bcv: { market: 'bcv', type: 'oficial', ask: 85.15, mid: 85.1 },
      });
      marketHistory.mockReturnValue([
        {
          timestamp: '2026-09-27T11:00:00.000Z',
          pair: 'USDT',
          bank: 'Banesco',
          bestBuyPrice: 85.2,
          bestSellPrice: 85.9,
          spreadVes: 0.7,
          spreadPct: 0.83,
        },
        {
          timestamp: '2026-09-27T12:00:00.000Z',
          pair: 'USDT',
          bank: 'Banesco',
          bestBuyPrice: 85.0,
          bestSellPrice: 85.4,
          spreadVes: 0.4,
          spreadPct: 0.59,
        },
      ]);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/macro'), TOKEN, String(CHAT_ID));

      const text = sentPlain(sendSpy);
      expect(text).toContain('REPORTE MACRO CONSOLIDADO');
      // Mean of the recorded history spreads, 0.83 and 0.59 = 0.71
      expect(text).toContain('`0.71%`');
      // The operator must know which spread they are reading.
      expect(text).toMatch(/historial/i);
      // BCV reference straight from the Cotizave rate.
      expect(text).toContain('`85.10 Bs`');
      // The live book best ask (85.0) is the parallel rate used as reference.
      expect(text).toContain('`85.00 Bs`');
    });

    it('MACRO labels the spread as the live book when there is no history', async () => {
      fetchMarketDepth.mockResolvedValue(LIVE_DEPTH);
      ratesByMarket.mockReturnValue({
        binance: { market: 'binance', type: 'p2p', ask: 84.8, mid: 84.7 },
        bcv: { market: 'bcv', type: 'oficial', ask: 85.15, mid: 85.1 },
      });
      marketHistory.mockReturnValue([]);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/macro'), TOKEN, String(CHAT_ID));

      const text = sentPlain(sendSpy);
      // Falls back to the live book spread, and says so instead of implying history.
      expect(text).toContain('`1.06%`');
      expect(text).toMatch(/libro en vivo/i);
      expect(text).not.toMatch(/promedio.*historial/i);
    });

    it('MACRO says so honestly when the BCV reference rate is unavailable', async () => {
      fetchMarketDepth.mockResolvedValue(LIVE_DEPTH);
      ratesByMarket.mockReturnValue({
        binance: { market: 'binance', type: 'p2p', ask: 84.8, mid: 84.7 },
      });
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/macro'), TOKEN, String(CHAT_ID));

      expect(sentText(sendSpy)).toContain('SIN DATOS EN VIVO');
    });

    it('BACKTEST_REQUEST queues a confirmation and runs nothing yet', async () => {
      const run = stubBacktestBridge({
        ok: true,
        stdout: '',
        stderr: '',
        summary: BACKTEST_SUMMARY,
      });
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(commandMessage('/backtest usdt_ves 1h'), TOKEN, String(CHAT_ID));

      const text = sentPlain(sendSpy);
      expect(text).toContain('BACKTEST');
      expect(text).toContain('usdt_ves');
      expect(text).toContain('1h');
      const keyboard = sendSpy.mock.calls[0]?.[3] as TelegramInlineKeyboardMarkup | undefined;
      expect((keyboard?.inline_keyboard ?? []).flat().map((b) => b.callback_data)).toEqual([
        'BACKTEST_RUN',
      ]);
      expect(run).not.toHaveBeenCalled();
    });

    it('BACKTEST_EXECUTE acks first, never blocks the poll, and reports the harness summary', async () => {
      const run = stubBacktestBridge({
        ok: true,
        stdout: 'report written',
        stderr: '',
        summary: BACKTEST_SUMMARY,
        summaryPath: 'docs/backtesting/backtest-2026-09-27.json',
      });
      const order: string[] = [];
      vi.spyOn(internals(), 'answerCallbackQuery').mockImplementation(async () => {
        order.push('ack');
        return true;
      });
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockImplementation(async () => {
        order.push('send');
        return true;
      });

      // The W1 callback carries no params, so the worker must have remembered the
      // selection from the `/backtest` request.
      await processIncoming(commandMessage('/backtest usdt_ves 1h'), TOKEN, String(CHAT_ID));
      order.length = 0;
      await processIncoming(callbackUpdate('BACKTEST_RUN'), TOKEN, String(CHAT_ID));

      // The ack must land before the queued run, and the handler must return
      // without waiting for the harness.
      expect(order[0]).toBe('ack');
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0]?.[0]).toMatchObject({ pair: 'usdt_ves', timeframe: '1h' });

      await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(3));
      const report = sentPlain(sendSpy, 2);
      expect(report).toContain('BACKTEST HISTÓRICO');
      expect(report).toContain('`7`');
      expect(report).toContain('`62.50%`');
      // The harness computes no drawdown: render it as unavailable, never fake it.
      expect(report).toContain('`n/d%`');
      // The harness takes no pair/timeframe on the CLI: say so instead of implying it did.
      expect(report).toContain('no acepta par ni temporalidad por CLI');
    });

    it('BACKTEST_EXECUTE reports the failure honestly when the harness errors', async () => {
      stubBacktestBridge({ ok: false, stdout: '', stderr: 'boom', error: 'harness failed' });
      vi.spyOn(internals(), 'answerCallbackQuery').mockResolvedValue(true);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(callbackUpdate('BACKTEST_RUN'), TOKEN, String(CHAT_ID));

      await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(2));
      expect(sentText(sendSpy, 1).toLowerCase()).toContain('no disponible');
    });

    it('BACKTEST_EXECUTE explains itself when no desktop bridge exists', async () => {
      delete (window as unknown as Record<string, unknown>)['electron'];
      vi.spyOn(internals(), 'answerCallbackQuery').mockResolvedValue(true);
      const sendSpy = vi.spyOn(svc, 'sendTelegramMessage').mockResolvedValue(true);

      await processIncoming(callbackUpdate('BACKTEST_RUN'), TOKEN, String(CHAT_ID));

      await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(2));
      expect(sentText(sendSpy, 1)).toContain('escritorio');
    });
  });
});
