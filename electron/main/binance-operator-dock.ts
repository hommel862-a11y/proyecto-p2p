/**
 * Isolated right-side Chromium dock (`WebContentsView`) for human-in-the-loop
 * execution on Binance P2P (`adv?code=...`, `advertiserDetail`, `myads`, `advPost`).
 *
 * Security & anti-bot invariants:
 * - Isolated session partition (`persist:binance-p2p`): keeps Binance login/Passkey separate from the app.
 * - Hardened `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, NO preload.
 * - Zero `executeJavaScript` or DOM injection (100% genuine user interaction).
 * - Strict HTTPS allowlist (`binance.com`, `*.binance.com`, `*.bnbstatic.com`) enforced before load, on navigation, redirects, and popups.
 */
import { BrowserWindow, WebContentsView, type WebPreferences } from 'electron';
import type { BinanceDockMode, BinanceDockOpenRequest, BinanceDockStateDto } from '../shared/types';

export const BINANCE_DOCK_PARTITION = 'persist:binance-p2p';

export const DOCK_WEB_PREFERENCES: WebPreferences = {
  partition: BINANCE_DOCK_PARTITION,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
};

const ALLOWED_HOST_SUFFIXES = ['.binance.com', '.bnbstatic.com'] as const;

export function isAllowedBinanceDockUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 2048) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'binance.com' || ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

export function computeDockWidthPx(contentWidth: number): number {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return 460;
  const maxAllowed = Math.max(360, Math.round(contentWidth * 0.55));
  const preferred = Math.round(contentWidth * 0.38);
  return Math.min(maxAllowed, Math.max(380, Math.min(640, preferred)));
}

export interface DockWebContentsLike {
  loadURL(url: string): Promise<void> | void;
  on(event: string, listener: (...args: any[]) => void): void;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void;
  isDestroyed?: () => boolean;
  close?: () => void;
}

export interface DockViewLike {
  readonly webContents: DockWebContentsLike;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
}

export interface DockWindowLike {
  getContentBounds(): { x: number; y: number; width: number; height: number };
  isDestroyed(): boolean;
  on(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
  readonly contentView: {
    addChildView(view: any): void;
    removeChildView(view: any): void;
  };
  readonly webContents: {
    isDestroyed(): boolean;
    send(channel: string, ...args: unknown[]): void;
  };
}

export class BinanceOperatorDock {
  private view: DockViewLike | null = null;
  private isAttached = false;
  private currentUrl: string | null = null;
  private currentMode: BinanceDockMode | null = null;
  private widthPx = 0;
  private readonly onResizeBound = () => this.syncBounds();
  private readonly onClosedBound = () => this.dispose();

  constructor(
    private readonly getWindow: () => DockWindowLike | null,
    private readonly viewFactory: () => DockViewLike = () =>
      new WebContentsView({ webPreferences: DOCK_WEB_PREFERENCES }) as unknown as DockViewLike,
  ) {}

  getState(): BinanceDockStateDto {
    return {
      isOpen: this.isAttached,
      currentUrl: this.currentUrl,
      widthPx: this.isAttached ? this.widthPx : 0,
      mode: this.isAttached ? this.currentMode : null,
    };
  }

  async open(req: BinanceDockOpenRequest): Promise<BinanceDockStateDto> {
    if (!req || !isAllowedBinanceDockUrl(req.url)) {
      throw new Error('Blocked non-Binance or insecure URL in BinanceOperatorDock');
    }
    const win = this.getWindow();
    if (!win || win.isDestroyed()) {
      return this.getState();
    }

    const view = this.ensureView(win);
    if (!this.isAttached) {
      win.contentView.addChildView(view);
      this.isAttached = true;
    }

    this.currentUrl = req.url;
    this.currentMode = req.mode ?? 'AD';
    this.syncBounds();
    await view.webContents.loadURL(req.url);
    return this.emitState();
  }

  close(): BinanceDockStateDto {
    const win = this.getWindow();
    if (this.view && this.isAttached && win && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(this.view);
      } catch {
        // Ignore teardown race if window is already closing
      }
    }
    this.isAttached = false;
    this.widthPx = 0;
    return this.emitState();
  }

  async toggle(req?: BinanceDockOpenRequest): Promise<BinanceDockStateDto> {
    if (this.isAttached && (!req || req.url === this.currentUrl)) {
      return this.close();
    }
    const targetUrl = req?.url ?? this.currentUrl ?? 'https://p2p.binance.com/es-LA/myads';
    const targetMode = req?.mode ?? this.currentMode ?? 'MY_ADS';
    return this.open({ url: targetUrl, mode: targetMode });
  }

  dispose(): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed() && win.removeListener) {
      win.removeListener('resize', this.onResizeBound);
      win.removeListener('maximize', this.onResizeBound);
      win.removeListener('unmaximize', this.onResizeBound);
      win.removeListener('closed', this.onClosedBound);
    }
    if (this.view && this.isAttached && win && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(this.view);
      } catch {
        // ignore
      }
    }
    try {
      if (this.view && !this.view.webContents.isDestroyed?.()) {
        this.view.webContents.close?.();
      }
    } catch {
      // ignore
    }
    this.view = null;
    this.isAttached = false;
    this.widthPx = 0;
  }

  private ensureView(win: DockWindowLike): DockViewLike {
    if (this.view) return this.view;

    const view = this.viewFactory();
    const wc = view.webContents;

    wc.on('will-navigate', (event: { preventDefault(): void }, url: string) => {
      if (!isAllowedBinanceDockUrl(url)) {
        event.preventDefault();
        return;
      }
      this.currentUrl = url;
      this.emitState();
    });

    wc.on('will-redirect', (event: { preventDefault(): void }, url: string) => {
      if (!isAllowedBinanceDockUrl(url)) {
        event.preventDefault();
      }
    });

    wc.on('did-navigate', (_event: unknown, url: string) => {
      if (isAllowedBinanceDockUrl(url)) {
        this.currentUrl = url;
        this.emitState();
      }
    });

    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedBinanceDockUrl(url)) {
        void wc.loadURL(url);
      }
      return { action: 'deny' };
    });

    win.on('resize', this.onResizeBound);
    win.on('maximize', this.onResizeBound);
    win.on('unmaximize', this.onResizeBound);
    win.on('closed', this.onClosedBound);

    this.view = view;
    return view;
  }

  private syncBounds(): void {
    const win = this.getWindow();
    if (!win || win.isDestroyed() || !this.view || !this.isAttached) return;
    const content = win.getContentBounds();
    const widthPx = computeDockWidthPx(content.width);
    this.widthPx = widthPx;
    this.view.setBounds({
      x: Math.max(0, content.width - widthPx),
      y: 0,
      width: widthPx,
      height: Math.max(100, content.height),
    });
    this.emitState();
  }

  private emitState(): BinanceDockStateDto {
    const state = this.getState();
    const win = this.getWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('p2p:dock-state-changed', state);
    }
    return state;
  }
}

export function createBrowserWindowDock(getWindow: () => BrowserWindow | null): BinanceOperatorDock {
  return new BinanceOperatorDock(() => getWindow() as unknown as DockWindowLike | null);
}
