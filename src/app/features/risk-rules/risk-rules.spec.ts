import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RiskRules, isValidChatId } from './risk-rules';
import {
  RisksService,
  sanitizeConfig,
  RISK_PROFILES,
  type RiskConfig,
} from '../../core/rules';
import { StorageService } from '../../core/storage';
import { AuditLoggerService } from '../../core/audit-logger.service';
import { TelegramWorkerService } from '../../core/telegram-worker.service';
import { ToastService } from '../../core/toast.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { SpotMarketService } from '../../core/spot-market.service';
import { McpService } from '../../core/mcp.service';
import { AccountsService } from '../../core/accounts.service';
import { CotizaveService } from '../../core/cotizave.service';
import { TriangulationIntelligenceService } from '../../core/triangulation-intelligence.service';
import { Router } from '@angular/router';

const DEFAULT: RiskConfig = {
  minSpread: 15,
  minSpreadPct: 1.2,
  maxConcurrentOps: 3,
  maxRiskPerTradePct: 1,
  dailyLossCapPct: 4,
  maxConsecutiveErrors: 3,
  apiStatus: 'ok',
};

type MockFn = ReturnType<typeof vi.fn>;

describe('RiskRules', () => {
  let injector: Injector;
  let component: RiskRules;
  let risksService: RisksService;
  let toast: { success: MockFn; error: MockFn; warn: MockFn; info: MockFn };
  let worker: {
    getConfig: MockFn;
    getBotInfo: MockFn;
    detectChatIdFromUpdates: MockFn;
    saveConfig: MockFn;
    startPolling: MockFn;
    stopPolling: MockFn;
    isPolling: MockFn;
    recentLogs: MockFn;
  };
  let binance: { fetchMarketDepth: MockFn; marketDepth: MockFn };
  let mcp: {
    evaluateTradeRisk: MockFn;
    calculateDeltaNeutralHedge: MockFn;
    consultZkMarketMesh: MockFn;
    triggerKillswitch: MockFn;
    detectUsdtDepeg: MockFn;
    evaluateAccountSaturation: MockFn;
  };
  let spotMarket: { fetchBookTicker: MockFn };
  let router: { navigate: MockFn };

  beforeEach(() => {
    const storedData: Record<string, unknown> = {};
    const storageMock = {
      get: vi.fn((key: string) => storedData[key] ?? null),
      set: vi.fn((key: string, val: unknown) => {
        storedData[key] = val;
      }),
    };
    const auditMock = { log: vi.fn() };

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
    binance = {
      fetchMarketDepth: vi.fn().mockResolvedValue({
        bestBuyPrice: 100,
        bestSellPrice: 98.5,
        spreadPct: 1.5,
      }),
      marketDepth: vi.fn(() => ({
        bestBuyPrice: 100,
        bestSellPrice: 98.5,
        spreadPct: 1.5,
      })),
    };
    mcp = {
      evaluateTradeRisk: vi.fn().mockResolvedValue({
        success: true,
        result: { verdict: 'ALLOW', reason: 'ok', ruleChecks: [1, 2, 3] },
      }),
      calculateDeltaNeutralHedge: vi.fn().mockResolvedValue({
        success: true,
        result: { shortHedgeUsdt: 62.5, recommendedInstrument: 'USDT-M Perpetual' },
      }),
      consultZkMarketMesh: vi.fn().mockResolvedValue({
        success: true,
        result: { blindHash: '0xabc123', riskScore: 10, recommendation: 'VERIFICADO_LIMPIO' },
      }),
      triggerKillswitch: vi.fn().mockResolvedValue({
        success: true,
        result: { status: 'CIRCUIT_BREAKER_TRIGGERED' },
      }),
      detectUsdtDepeg: vi.fn().mockImplementation(async (args: { spotUsdtPrice: number }) => {
        const isDepegged = args.spotUsdtPrice < 0.998 || args.spotUsdtPrice > 1.002;
        return {
          success: true,
          result: {
            isDepegged,
            isEmergencyActionRequired: args.spotUsdtPrice < 0.99,
            status: isDepegged ? 'DEPEGGED_WARNING' : 'PEGGED_NORMAL',
            parityDeviationPct: Math.round(Math.abs(1 - args.spotUsdtPrice) * 10000) / 100,
            recommendation: 'Paridad auditada',
          },
        };
      }),
      evaluateAccountSaturation: vi.fn().mockResolvedValue({
        success: true,
        result: {
          bankId: 'banesco-pm-1',
          saturationPercentage: 15,
          remainingQuotaVes: 85000,
          riskLevel: 'LOW',
          recommendBankRotation: false,
          reason: 'Operativa normal',
        },
      }),
    };
    spotMarket = { fetchBookTicker: vi.fn() };
    router = { navigate: vi.fn() };

    const accountsMock = {
      accounts: signal([
        {
          id: 'banesco-pm-1',
          bankName: 'Banesco',
          accountNumberMasked: '...1234',
          balance: 2000,
          currency: 'USDT',
          dailyLimitVes: 100000,
        },
        {
          id: 'bdv-1',
          bankName: 'Banco de Venezuela',
          accountNumberMasked: '...5678',
          balance: 210000,
          currency: 'VES',
          dailyLimitVes: 500000,
        },
      ]),
      usages: signal([
        {
          account: { id: 'banesco-pm-1' },
          spentTodayVes: 15000,
        },
      ]),
    };

    const cotizaveMock = {
      ratesByMarket: signal({
        oficial: { mid: 70.0, ask: 70.0, bid: 70.0 },
      }),
    };

    const triangulationMock = {
      bcvIntervention: signal({
        inWindow: false,
        intensity: 'LOW' as const,
        message: 'Monitoreo de calendario BCV activo.',
      }),
    };

    injector = Injector.create({
      providers: [
        { provide: StorageService, useValue: storageMock },
        { provide: AuditLoggerService, useValue: auditMock },
        RisksService,
        { provide: ToastService, useValue: toast },
        { provide: TelegramWorkerService, useValue: worker },
        { provide: BinanceP2pService, useValue: binance },
        { provide: McpService, useValue: mcp },
        { provide: AccountsService, useValue: accountsMock },
        { provide: SpotMarketService, useValue: spotMarket },
        { provide: CotizaveService, useValue: cotizaveMock },
        { provide: TriangulationIntelligenceService, useValue: triangulationMock },
        { provide: Router, useValue: router },
      ],
    });

    risksService = injector.get(RisksService);
    risksService.save({ ...DEFAULT });

    component = runInInjectionContext(injector, () => new RiskRules());
    component.ngOnInit();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('initializes with default config and engine verdict on sample state is ALLOW', () => {
    expect(component.verdict().decision).toBe('ALLOW');
    expect(component.verdict().reason).toBe('ok');
    expect(component.decisionLabel('ALLOW')).toBe('PERMITIR');
    expect(component.activeTab()).toBe('LIVE_SHIELD');
  });

  it('supports 4-tab switching', () => {
    expect(component.activeTab()).toBe('LIVE_SHIELD');
    component.selectTab('BARRIERS');
    expect(component.activeTab()).toBe('BARRIERS');
    component.selectTab('TELEGRAM');
    expect(component.activeTab()).toBe('TELEGRAM');
    component.selectTab('MCP_TOOLS');
    expect(component.activeTab()).toBe('MCP_TOOLS');
  });

  it('min-spread rule => DENY when spread below configured minimum', () => {
    component.draft.set({ ...DEFAULT, minSpread: 25 });
    component.save();
    expect(component.verdict().decision).toBe('DENY');
    expect(component.verdict().reason).toBe('spread below minimum');
  });

  it('killswitch activation forces verdict to PAUSE and down status', async () => {
    component.killswitchReason.set('Emergencia BCV');
    component.killswitchChallenge.set('CONFIRMAR-FREEZE');
    await component.activateKillswitch();

    expect(mcp.triggerKillswitch).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Emergencia BCV' }),
    );
    expect(component.killswitchActive()).toBe(true);
    expect(component.draft().apiStatus).toBe('down');
    expect(component.verdict().decision).toBe('PAUSE');
    expect(component.verdict().reason).toContain('killswitch-engaged');

    // Resetting killswitch restores normal state
    component.resetKillswitch();
    expect(component.killswitchActive()).toBe(false);
    expect(component.draft().apiStatus).toBe('ok');
    expect(component.verdict().decision).toBe('ALLOW');
  });

  it('applies risk profiles correctly (DEFENSIVE_BCV, BALANCED, AGGRESSIVE_SCALPER)', () => {
    component.applyRiskProfile('DEFENSIVE_BCV');
    expect(component.draft().minSpreadPct).toBe(RISK_PROFILES.DEFENSIVE_BCV.config.minSpreadPct);
    expect(component.draft().maxConcurrentOps).toBe(1);
    expect(component.activeProfileId()).toBe('DEFENSIVE_BCV');
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Defensivo BCV'));

    component.applyRiskProfile('AGGRESSIVE_SCALPER');
    expect(component.draft().maxConcurrentOps).toBe(5);
    expect(component.activeProfileId()).toBe('AGGRESSIVE_SCALPER');
  });

  it('computes dynamic treasury exposure from active accounts', () => {
    // 2000 USDT + (210,000 VES / 70 BCV rate = 3000 USDT) = 5000 USDT
    expect(component.totalTreasuryCapitalUsdt()).toBe(5000);
    // At 1% risk per trade: $50
    expect(component.maxRiskPerTradeUsdt()).toBe(50);
    // At 4% daily loss cap: $200 USDT
    expect(component.dailyLossCapUsdt()).toBe(200);
    // In VES: 200 * 70 = 14,000 VES
    expect(component.dailyLossCapVes()).toBe(14000);
  });

  it('save() persists config so a fresh service reads it', () => {
    component.draft.set({ ...DEFAULT, minSpread: 25, maxConcurrentOps: 5 });
    component.save();
    expect(risksService.config().minSpread).toBe(25);
    expect(risksService.config().maxConcurrentOps).toBe(5);
  });

  it('save() sanitizes invalid/out-of-range values', () => {
    component.draft.set({
      ...DEFAULT,
      minSpread: -5,
      maxConcurrentOps: Number.NaN,
      maxRiskPerTradePct: Number.POSITIVE_INFINITY,
      dailyLossCapPct: -1,
      maxConsecutiveErrors: 0,
    });
    component.save();
    const cfg = risksService.config();
    expect(cfg.minSpread).toBe(0);
    expect(cfg.maxConcurrentOps).toBe(1);
    expect(cfg.maxRiskPerTradePct).toBe(0);
    expect(cfg.dailyLossCapPct).toBe(0);
    expect(cfg.maxConsecutiveErrors).toBe(1);
  });

  it('isValidChatId validates standard users and supergroups up to 16 digits', () => {
    expect(isValidChatId('987654321')).toBe(true);
    expect(isValidChatId('-1001234567890')).toBe(true);
    expect(isValidChatId('-1009876543210123')).toBe(true);
    // Rejects invalid strings / phone numbers
    expect(isValidChatId('+584121234567')).toBe(false);
    expect(isValidChatId('chat_room_p2p')).toBe(false);
    expect(isValidChatId('')).toBe(false);
  });

  it('detectChatId() with empty token warns and aborts', async () => {
    component.telegramToken.set('');
    await component.detectChatId();
    expect(toast.warn).toHaveBeenCalledWith(expect.stringContaining('Token'));
    expect(worker.detectChatIdFromUpdates).not.toHaveBeenCalled();
  });

  it('detectChatId() on success updates chatId, saves config, and triggers test alert', async () => {
    component.telegramToken.set('123456789:AAA-bot-token');
    worker.detectChatIdFromUpdates.mockResolvedValue({
      success: true,
      chatId: '987654321',
      firstName: 'Ana',
      botUsername: 'MockBot',
    });
    const saveSpy = vi.spyOn(component, 'saveTelegramConfig');
    const testSpy = vi.spyOn(component, 'sendTestTelegramAlert').mockResolvedValue();

    await component.detectChatId();

    expect(component.telegramChatId()).toBe('987654321');
    expect(component.botUsername()).toBe('MockBot');
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('987654321'),
      'Telegram Conectado',
    );
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(testSpy).toHaveBeenCalledTimes(1);
  });

  it('evaluates USDT depeg risk via detectUsdtDepeg tool and sets result state', async () => {
    component.depegSpotPrice.set(1.0001);
    component.depegThresholdPct.set(0.2);
    await component.evaluateDepegRisk();

    expect(component.mcpDepegResult()).not.toBeNull();
    expect(component.mcpDepegResult()?.isDepegged).toBe(false);
    expect(component.mcpDepegResult()?.status).toBe('PEGGED_NORMAL');
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('Paridad de USDT estable'),
    );

    // Test with severe depeg
    component.depegSpotPrice.set(0.985);
    await component.evaluateDepegRisk();
    expect(component.mcpDepegResult()?.isDepegged).toBe(true);
    expect(component.mcpDepegResult()?.isEmergencyActionRequired).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('ALERTA CRÍTICA: Depeg de USDT severo'),
    );
  });

  it('evaluates bank account saturation via evaluateAccountSaturation tool', async () => {
    component.selectedBankAccountId.set('banesco-pm-1');
    component.incomingTradeVes.set(10000);
    await component.evaluateBankSaturation();

    const res = component.mcpSaturationResult();
    expect(res).not.toBeNull();
    expect(res?.bankId).toBe('banesco-pm-1');
    expect(res?.saturationPercentage).toBeGreaterThanOrEqual(0);
    expect(res?.remainingQuotaVes).toBeDefined();
  });

  it('fetches live spot ticker and updates depegSpotPrice', async () => {
    spotMarket.fetchBookTicker.mockResolvedValue({
      symbol: 'USDCUSDT',
      bidPrice: 0.9998,
      bidQty: 1000,
      askPrice: 1.0002,
      askQty: 1000,
      midPrice: 1.0,
      spreadPct: 0.04,
      timestamp: new Date().toISOString(),
    });

    await component.fetchLiveSpotTickerForDepeg();

    expect(component.depegSpotPrice()).toBe(1.0);
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining('Ticker Spot USDCUSDT recibido'),
    );
  });

  it('navigates to receipts scanner on request', () => {
    component.goToReceiptScanner();
    expect(router.navigate).toHaveBeenCalledWith(['/receipts']);
  });
});

describe('sanitizeConfig', () => {
  it('clamps non-finite and negative numeric fields to sensible floors', () => {
    const clean = sanitizeConfig({
      minSpread: Number.NaN,
      minSpreadPct: -0.5,
      maxConcurrentOps: Number.NEGATIVE_INFINITY,
      maxRiskPerTradePct: -3,
      dailyLossCapPct: Number.POSITIVE_INFINITY,
      maxConsecutiveErrors: 0,
      apiStatus: 'down',
    });
    expect(clean.minSpread).toBe(0);
    expect(clean.minSpreadPct).toBe(0);
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
