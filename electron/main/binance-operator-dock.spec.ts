import { describe, expect, it, vi } from 'vitest';
import {
  BINANCE_DOCK_PARTITION,
  BinanceOperatorDock,
  DOCK_WEB_PREFERENCES,
  computeDockWidthPx,
  isAllowedBinanceDockUrl,
  type DockViewLike,
  type DockWindowLike,
} from './binance-operator-dock';

function createMockDockHarness() {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  const winListeners = new Map<string, (() => void)[]>();
  let windowOpenHandler: ((details: { url: string }) => { action: 'deny' | 'allow' }) | null = null;
  const loadURL = vi.fn(async () => undefined);
  const setBounds = vi.fn();
  const send = vi.fn();
  const addChildView = vi.fn();
  const removeChildView = vi.fn();

  const view: DockViewLike = {
    setBounds,
    webContents: {
      loadURL,
      on: (event, fn) => {
        listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      },
      setWindowOpenHandler: (fn) => {
        windowOpenHandler = fn;
      },
      isDestroyed: () => false,
      close: vi.fn(),
    },
  };

  const win: DockWindowLike = {
    getContentBounds: () => ({ x: 0, y: 0, width: 1400, height: 900 }),
    isDestroyed: () => false,
    on: (event, fn) => {
      winListeners.set(event, [...(winListeners.get(event) ?? []), fn]);
    },
    contentView: { addChildView, removeChildView },
    webContents: { isDestroyed: () => false, send },
  };

  const dock = new BinanceOperatorDock(() => win, () => view);
  return {
    dock,
    view,
    win,
    loadURL,
    setBounds,
    send,
    addChildView,
    removeChildView,
    emitWc: (event: string, ...args: any[]) => {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    invokeWindowOpen: (url: string) => windowOpenHandler?.({ url }),
  };
}

describe('BinanceOperatorDock (isolated WebContentsView)', () => {
  it('enforces isolated sandboxed webPreferences without preload', () => {
    expect(DOCK_WEB_PREFERENCES).toEqual({
      partition: BINANCE_DOCK_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
    expect(DOCK_WEB_PREFERENCES.preload).toBeUndefined();
  });

  it('strictly allowlists https binance.com and bnbstatic.com hosts', () => {
    expect(isAllowedBinanceDockUrl('https://c2c.binance.com/es-LA/adv?code=11218246497340923904')).toBe(true);
    expect(isAllowedBinanceDockUrl('https://p2p.binance.com/es-LA/myads')).toBe(true);
    expect(isAllowedBinanceDockUrl('https://static.bnbstatic.com/app.js')).toBe(true);
    expect(isAllowedBinanceDockUrl('http://c2c.binance.com/es-LA/adv?code=123')).toBe(false);
    expect(isAllowedBinanceDockUrl('https://binance.com.attacker.io/phish')).toBe(false);
    expect(isAllowedBinanceDockUrl('https://evil.example.com/')).toBe(false);
    expect(isAllowedBinanceDockUrl('https://user:pass@p2p.binance.com/')).toBe(false);
    expect(isAllowedBinanceDockUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects non-Binance urls before touching WebContentsView and attaches right-docked view for valid urls', async () => {
    const h = createMockDockHarness();
    await expect(
      h.dock.open({ url: 'https://evil.example.com/login', mode: 'AD' }),
    ).rejects.toThrow();
    expect(h.addChildView).not.toHaveBeenCalled();

    const state = await h.dock.open({
      url: 'https://c2c.binance.com/es-LA/adv?code=11218246497340923904',
      mode: 'AD',
    });

    const expectedWidth = computeDockWidthPx(1400);
    expect(state).toEqual({
      isOpen: true,
      currentUrl: 'https://c2c.binance.com/es-LA/adv?code=11218246497340923904',
      widthPx: expectedWidth,
      mode: 'AD',
    });
    expect(h.addChildView).toHaveBeenCalledTimes(1);
    expect(h.setBounds).toHaveBeenCalledWith({
      x: 1400 - expectedWidth,
      y: 0,
      width: expectedWidth,
      height: 900,
    });
    expect(h.loadURL).toHaveBeenCalledWith('https://c2c.binance.com/es-LA/adv?code=11218246497340923904');
    expect(h.send).toHaveBeenCalledWith('p2p:dock-state-changed', state);
  });

  it('blocks disallowed navigation, redirects, and popups while redirecting allowlisted popups into dock', async () => {
    const h = createMockDockHarness();
    await h.dock.open({ url: 'https://p2p.binance.com/es-LA/myads', mode: 'MY_ADS' });

    const navEvil = { preventDefault: vi.fn() };
    h.emitWc('will-navigate', navEvil, 'https://phishing-binance.com/');
    expect(navEvil.preventDefault).toHaveBeenCalled();

    const redirEvil = { preventDefault: vi.fn() };
    h.emitWc('will-redirect', redirEvil, 'http://c2c.binance.com/');
    expect(redirEvil.preventDefault).toHaveBeenCalled();

    const popupEvil = h.invokeWindowOpen('https://evil.com/');
    expect(popupEvil).toEqual({ action: 'deny' });
    expect(h.loadURL).toHaveBeenCalledTimes(1);

    const popupBinance = h.invokeWindowOpen('https://p2p.binance.com/es-LA/advPost');
    expect(popupBinance).toEqual({ action: 'deny' });
    expect(h.loadURL).toHaveBeenCalledWith('https://p2p.binance.com/es-LA/advPost');
  });

  it('closes cleanly and detaches child view', async () => {
    const h = createMockDockHarness();
    await h.dock.open({ url: 'https://p2p.binance.com/es-LA/advPost', mode: 'ADV_POST' });
    const closed = h.dock.close();
    expect(closed.isOpen).toBe(false);
    expect(closed.widthPx).toBe(0);
    expect(h.removeChildView).toHaveBeenCalledTimes(1);
  });
});
