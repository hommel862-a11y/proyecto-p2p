import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RiskRules } from './risk-rules';
import { RisksService, sanitizeConfig, type RiskConfig } from '../../core/rules';
import { P2P_STORAGE } from '../../core/storage';
import { MemoryStorage } from '../../core/memory-storage';
import { TelegramWorkerService } from '../../core/telegram-worker.service';
import { ToastService } from '../../core/toast.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';

const DEFAULT: RiskConfig = {
  minSpread: 15,
  maxConcurrentOps: 3,
  maxRiskPerTradePct: 1,
  dailyLossCapPct: 4,
  maxConsecutiveErrors: 3,
  apiStatus: 'ok',
};

type MockFn = ReturnType<typeof vi.fn>;

interface ToastMock {
  success: MockFn;
  error: MockFn;
  warn: MockFn;
  info: MockFn;
}

interface WorkerMock {
  getConfig: MockFn;
  getBotInfo: MockFn;
  detectChatIdFromUpdates: MockFn;
  saveConfig: MockFn;
  startPolling: MockFn;
  stopPolling: MockFn;
  isPolling: MockFn;
  recentLogs: MockFn;
}

describe('RiskRules', () => {
  let fixture: ComponentFixture<RiskRules>;
  let mem: MemoryStorage;
  let toast: ToastMock;
  let worker: WorkerMock;
  let binance: { fetchMarketDepth: MockFn };

  beforeEach(() => {
    mem = new MemoryStorage();
    toast = { success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    worker = {
      getConfig: vi.fn().mockResolvedValue({
        botToken: '',
        chatId: '',
        alertsEnabled: true,
        pollingEnabled: false,
      }),
      getBotInfo: vi.fn().mockResolvedValue(null),
      detectChatIdFromUpdates: vi.fn().mockResolvedValue({
        success: false,
        botUsername: 'MockBot',
      }),
      saveConfig: vi.fn().mockResolvedValue(undefined),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      isPolling: vi.fn(() => false),
      recentLogs: vi.fn(() => []),
    };
    binance = { fetchMarketDepth: vi.fn() };
    TestBed.configureTestingModule({
      imports: [RiskRules],
      providers: [
        { provide: P2P_STORAGE, useValue: mem },
        { provide: TelegramWorkerService, useValue: worker as unknown as TelegramWorkerService },
        { provide: ToastService, useValue: toast as unknown as ToastService },
        { provide: BinanceP2pService, useValue: binance as unknown as BinanceP2pService },
      ],
    });
    TestBed.inject(RisksService).save({ ...DEFAULT });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function create(): ComponentFixture<RiskRules> {
    return TestBed.createComponent(RiskRules);
  }

  it('default config => engine verdict on sample state is ALLOW (ok)', () => {
    const f = create();
    const c = f.componentInstance;
    f.detectChanges();
    expect(c.verdict().decision).toBe('ALLOW');
    expect(c.verdict().reason).toBe('ok');
    expect(f.nativeElement.textContent).toContain('PERMITIR');
  });

  it('min-spread rule => DENY when spread below configured minimum', () => {
    const f = create();
    const c = f.componentInstance;
    c.draft.set({ ...DEFAULT, minSpread: 25 });
    c.save();
    f.detectChanges();
    expect(c.verdict().decision).toBe('DENY');
    expect(c.verdict().reason).toBe('spread below minimum');
  });

  it('daily-loss rule => PAUSE when daily loss exceeds cap', () => {
    const f = create();
    const c = f.componentInstance;
    const verdict = TestBed.inject(RisksService).evaluate({
      currentSpread: 20,
      minSpread: 15,
      openOps: 1,
      tradeRiskPct: 0.5,
      dailyLossPct: 5,
      consecutiveErrors: 0,
    });
    expect(verdict.decision).toBe('PAUSE');
    expect(verdict.reason).toBe('daily loss cap exceeded');
  });

  it('concurrency rule => PAUSE when open ops reach max', () => {
    const f = create();
    const c = f.componentInstance;
    const verdict = TestBed.inject(RisksService).evaluate({
      currentSpread: 20,
      minSpread: 15,
      openOps: 3,
      tradeRiskPct: 0.5,
      dailyLossPct: 1,
      consecutiveErrors: 0,
    });
    expect(verdict.decision).toBe('PAUSE');
    expect(verdict.reason).toBe('max concurrent operations reached');
  });

  it('save() persists config so a fresh instance reads it', () => {
    const f = create();
    const c = f.componentInstance;
    c.draft.set({ ...DEFAULT, minSpread: 25, maxConcurrentOps: 5 });
    c.save();
    const f2 = TestBed.createComponent(RiskRules);
    expect(f2.componentInstance.config().minSpread).toBe(25);
    expect(f2.componentInstance.config().maxConcurrentOps).toBe(5);
  });

  it('save() sanitizes NaN/negative/out-of-range values (no decision-engine poisoning)', () => {
    const f = create();
    const c = f.componentInstance;
    c.draft.set({
      ...DEFAULT,
      minSpread: -5,
      maxConcurrentOps: Number.NaN,
      maxRiskPerTradePct: Number.POSITIVE_INFINITY,
      dailyLossCapPct: -1,
      maxConsecutiveErrors: 0,
    });
    c.save();
    const cfg = TestBed.inject(RisksService).config();
    expect(cfg.minSpread).toBe(0);
    expect(cfg.maxConcurrentOps).toBe(1);
    expect(cfg.maxRiskPerTradePct).toBe(0);
    expect(cfg.dailyLossCapPct).toBe(0);
    expect(cfg.maxConsecutiveErrors).toBe(1);
    // the live verdict stays finite/typed
    expect(c.verdict()).toBeDefined();
  });

  it('detectChatId() con token vacío => toast warn y no llama al worker', async () => {
    const c = create().componentInstance;
    c.telegramToken.set('');

    await c.detectChatId();

    expect(toast.warn).toHaveBeenCalledWith(expect.stringContaining('Token'));
    expect(worker.detectChatIdFromUpdates).not.toHaveBeenCalled();
    expect(c.detectingChatId()).toBe(false);
  });

  it('detectChatId() con detección exitosa => setea chatId, guarda config y dispara la prueba', async () => {
    const c = create().componentInstance;
    c.telegramToken.set('123456789:AAA-bot-token');
    worker.detectChatIdFromUpdates.mockResolvedValue({
      success: true,
      chatId: '987654321',
      firstName: 'Ana',
      username: 'ana_p2p',
      botUsername: 'MockBot',
    });
    const saveSpy = vi.spyOn(c, 'saveTelegramConfig');
    const testSpy = vi.spyOn(c, 'sendTestTelegramAlert').mockResolvedValue();

    await c.detectChatId();

    expect(c.telegramChatId()).toBe('987654321');
    expect(c.botUsername()).toBe('MockBot');
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('987654321'),
      'Telegram Conectado',
    );
    // El chatId ya está en la signal ANTES de guardar: la config persistida lo incluye.
    expect(worker.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: '987654321', botToken: '123456789:AAA-bot-token' }),
    );
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(testSpy).toHaveBeenCalledTimes(1);
    expect(c.detectingChatId()).toBe(false);
  });

  it('detectChatId() sin detección => reintenta (1+3) y termina con toast warn con pasos', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const c = create().componentInstance;
    c.telegramToken.set('123456789:AAA-bot-token');
    worker.detectChatIdFromUpdates.mockResolvedValue({ success: false, botUsername: 'MockBot' });

    const pending = c.detectChatId();
    await vi.runAllTimersAsync();
    await pending;

    // 1 intento inicial + 3 reintentos cada 2.5s
    expect(worker.detectChatIdFromUpdates).toHaveBeenCalledTimes(4);
    expect(toast.warn).toHaveBeenCalledWith(
      expect.stringContaining('Abrir Bot'),
      expect.stringContaining('Paso Requerido en Telegram'),
    );
    expect(c.telegramChatId()).toBe('');
    expect(c.botUsername()).toBe('MockBot');
    expect(c.detectingChatId()).toBe(false);
  });

  it('sendTestTelegramAlert() con 400 "chat not found" => toast.error con orientación Abrir Bot / Iniciar', async () => {
    const c = create().componentInstance;
    c.telegramToken.set('123456789:AAA-bot-token');
    c.telegramChatId.set('987654321');
    c.botUsername.set('MockBot');
    binance.fetchMarketDepth.mockResolvedValue({
      bestBuyPrice: 100.5,
      bestSellPrice: 99.25,
      spreadPct: 1.26,
      spreadVes: 1.25,
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, description: 'chat not found' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await c.sendTestTelegramAlert();

    expect(binance.fetchMarketDepth).toHaveBeenCalledWith('USDT', 'VES', true);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('sendMessage'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Abrir Bot'),
      expect.stringContaining('Chat no iniciado'),
    );
    const [message] = toast.error.mock.calls[0] as [string];
    expect(message).toContain('@MockBot');
    expect(message).toContain('Iniciar');
  });
});

describe('sanitizeConfig', () => {
  it('clamps non-finite and negative numeric fields to sensible floors', () => {
    const clean = sanitizeConfig({
      minSpread: Number.NaN,
      maxConcurrentOps: Number.NEGATIVE_INFINITY,
      maxRiskPerTradePct: -3,
      dailyLossCapPct: Number.POSITIVE_INFINITY,
      maxConsecutiveErrors: 0,
      apiStatus: 'down',
    });
    expect(clean.minSpread).toBe(0);
    expect(clean.maxConcurrentOps).toBe(1);
    expect(clean.maxRiskPerTradePct).toBe(0);
    expect(clean.dailyLossCapPct).toBe(0);
    expect(clean.maxConsecutiveErrors).toBe(1);
    expect(clean.apiStatus).toBe('down');
  });

  it('passes valid config through unchanged and normalizes apiStatus', () => {
    const clean = sanitizeConfig({ ...DEFAULT });
    expect(clean).toEqual(DEFAULT);
    expect(
      sanitizeConfig({ ...DEFAULT, apiStatus: 'bogus' as RiskConfig['apiStatus'] }).apiStatus,
    ).toBe('ok');
  });

  it('rounds counts to integers', () => {
    const clean = sanitizeConfig({ ...DEFAULT, maxConcurrentOps: 2.7, maxConsecutiveErrors: 3.2 });
    expect(clean.maxConcurrentOps).toBe(3);
    expect(clean.maxConsecutiveErrors).toBe(3);
  });
});
