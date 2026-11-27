import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceExecutionBridgeService } from './binance-execution-bridge.service';
import { CounterpartyService } from './counterparty.service';
import { StorageService } from './storage';
import { ToastService } from './toast.service';
import { TradeTimerService } from './trade-timer.service';

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // Already initialized in shared test runner
}

const ADV = '11218246497340923904';
const USER = 's8415f1294ebc335a98b50b6b5b7c5dea';

describe('BinanceExecutionBridgeService', () => {
  let service: BinanceExecutionBridgeService;
  let counterparty: CounterpartyService;
  let toast: { success: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let timer: TradeTimerService;
  let dockOpenSpy: ReturnType<typeof vi.fn>;
  let openExternalSpy: ReturnType<typeof vi.fn>;
  let windowOpenSpy: ReturnType<typeof vi.fn>;

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  beforeEach(() => {
    TestBed.resetTestingModule();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    toast = { success: vi.fn(), warn: vi.fn(), error: vi.fn() };
    dockOpenSpy = vi.fn(async (req: { url: string; mode: string }) => ({
      isOpen: true,
      currentUrl: req.url,
      widthPx: 480,
      mode: req.mode,
    }));
    openExternalSpy = vi.fn(async () => ({ opened: true }));
    windowOpenSpy = vi.fn();
    vi.stubGlobal('open', windowOpenSpy);
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        binanceDock: {
          open: dockOpenSpy,
          close: vi.fn(async () => ({ isOpen: false, currentUrl: null, widthPx: 0, mode: null })),
          toggle: vi.fn(),
          getState: vi.fn(),
          openExternal: openExternalSpy,
          onStateChanged: vi.fn(() => () => undefined),
        },
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });

    TestBed.configureTestingModule({
      providers: [
        BinanceExecutionBridgeService,
        CounterpartyService,
        TradeTimerService,
        StorageService,
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
    service = TestBed.inject(BinanceExecutionBridgeService);
    counterparty = TestBed.inject(CounterpartyService);
    timer = TestBed.inject(TradeTimerService);
    timer.reset();
  });

  it('blocks blacklisted counterparty matched by immutable binanceUserNo even after nickname change', async () => {
    counterparty.addCounterparty({
      alias: 'OldAlias',
      binanceUserNo: USER,
      realName: 'Scammer One',
      documentId: 'V-99999999',
      reputation: 'BLOCKED',
    });

    const verdict = await service.executeOfferAction({
      action: 'BUY',
      offer: { advNo: ADV, advertiserNo: USER, merchantName: 'BrandNewNick', price: 800, surplusAmount: 500 },
      targetUsdt: 100,
    });

    expect(verdict.verdict).toBe('BLOCK');
    expect(toast.error).toHaveBeenCalled();
    expect(dockOpenSpy).not.toHaveBeenCalled();
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it('opens official ad deep link in Electron dock, copies VES amount, and arms TradeTimer when requested', async () => {
    const verdict = await service.executeOfferAction({
      action: 'BUY',
      offer: {
        advNo: ADV,
        advertiserNo: USER,
        merchantName: 'CleanMaker',
        price: 800,
        surplusAmount: 1000,
        minVes: 10_000,
        maxVes: 900_000,
      },
      targetUsdt: 250,
      bank: 'Banesco',
      armTradeTimer: true,
    });

    expect(verdict.verdict).toBe('GO');
    expect(dockOpenSpy).toHaveBeenCalledWith({
      url: `https://c2c.binance.com/es-LA/adv?code=${ADV}`,
      mode: 'AD',
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('200000.00');
    expect(service.activeHudContext()?.advNo).toBe(ADV);
    expect(timer.pendingPreset()).toMatchObject({
      advNo: ADV,
      advertiserNo: USER,
      merchantName: 'CleanMaker',
      bank: 'Banesco',
      vesAmount: 200000,
    });
  });

  it('falls back to advertiserDetail when ad surplus is exhausted', async () => {
    const verdict = await service.executeOfferAction({
      action: 'SELL',
      offer: { advNo: ADV, advertiserNo: USER, merchantName: 'FastTrader', price: 805, surplusAmount: 0 },
      targetUsdt: 100,
    });

    expect(verdict.verdict).toBe('BLOCK');
    expect(toast.warn).toHaveBeenCalled();
    expect(dockOpenSpy).toHaveBeenCalledWith({
      url: `https://p2p.binance.com/es-LA/advertiserDetail?advertiserNo=${USER}`,
      mode: 'ADVERTISER',
    });
  });

  it('routes to external browser when preferEmbeddedDock is disabled', async () => {
    service.setPreferEmbeddedDock(false);
    await service.executeOfferAction({
      action: 'BUY',
      offer: { advNo: ADV, advertiserNo: USER, merchantName: 'WebTrader', price: 800, surplusAmount: 500 },
      targetUsdt: 50,
    });
    expect(openExternalSpy).toHaveBeenCalledWith(`https://c2c.binance.com/es-LA/adv?code=${ADV}`);
    expect(dockOpenSpy).not.toHaveBeenCalled();
  });

  it('opens myads / advPost portals with clipboard copy', async () => {
    await service.openMerchantPortal('myads', 'Precio: 805.20');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Precio: 805.20');
    expect(dockOpenSpy).toHaveBeenCalledWith({
      url: 'https://p2p.binance.com/es-LA/myads',
      mode: 'MY_ADS',
    });
  });
});
