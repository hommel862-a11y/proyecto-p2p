import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceOperatorHudComponent } from './binance-operator-hud.component';
import {
  BinanceExecutionBridgeService,
  type ExecutionHudContext,
} from '../../core/binance-execution-bridge.service';
import type { BinanceDockStateDto } from '../../../../electron/shared/types';

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // Already initialized in shared test runner
}

describe('BinanceOperatorHudComponent', () => {
  let activeHudContext: ReturnType<typeof signal<ExecutionHudContext | null>>;
  let dockState: ReturnType<typeof signal<BinanceDockStateDto>>;
  let copyHudAmount: ReturnType<typeof vi.fn>;
  let openMerchantPortal: ReturnType<typeof vi.fn>;
  let sendActiveContextToLog: ReturnType<typeof vi.fn>;
  let openActiveInExternalBrowser: ReturnType<typeof vi.fn>;
  let dismissHud: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    activeHudContext = signal<ExecutionHudContext | null>(null);
    dockState = signal<BinanceDockStateDto>({
      isOpen: false,
      currentUrl: null,
      widthPx: 0,
      mode: null,
    });
    copyHudAmount = vi.fn();
    openMerchantPortal = vi.fn();
    sendActiveContextToLog = vi.fn();
    openActiveInExternalBrowser = vi.fn();
    dismissHud = vi.fn();

    TestBed.configureTestingModule({
      imports: [BinanceOperatorHudComponent],
      providers: [
        {
          provide: BinanceExecutionBridgeService,
          useValue: {
            activeHudContext,
            dockState,
            copyHudAmount,
            openMerchantPortal,
            sendActiveContextToLog,
            openActiveInExternalBrowser,
            dismissHud,
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('stays hidden when neither dock nor context is active', () => {
    const fixture = TestBed.createComponent(BinanceOperatorHudComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.binance-hud-bar')).toBeNull();
  });

  it('renders HUD with copied amount, bank, warnings, and dispatches operator actions', () => {
    dockState.set({
      isOpen: true,
      currentUrl: 'https://c2c.binance.com/es-LA/adv?code=11218246497340923904',
      widthPx: 480,
      mode: 'AD',
    });
    activeHudContext.set({
      url: 'https://c2c.binance.com/es-LA/adv?code=11218246497340923904',
      mode: 'AD',
      action: 'BUY',
      advNo: '11218246497340923904',
      advertiserNo: 's8415f1294ebc335a98b50b6b5b7c5dea',
      merchantName: 'CambioSeguroVE',
      price: 92.5,
      bank: 'Banesco',
      copiedAmount: '25000.00 VES',
      executableVes: 25000,
      executableUsdt: 270.27,
      issues: [
        {
          code: 'REG_DAYS_LOCK',
          severity: 'WARN',
          message: 'Requiere antigüedad mínima',
        },
      ],
      timestamp: Date.now(),
    });

    const fixture = TestBed.createComponent(BinanceOperatorHudComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const aside = el.querySelector('.binance-hud-bar') as HTMLElement;
    expect(aside).not.toBeNull();
    expect(aside.style.right).toBe('494px');
    expect(aside.textContent).toContain('CambioSeguroVE');
    expect(aside.textContent).toContain('Banesco');
    expect(aside.textContent).toContain('⚠️ 1 aviso(s)');

    const buttons = Array.from(el.querySelectorAll('button'));
    buttons.find((b) => b.textContent?.includes('Copiar'))?.click();
    buttons.find((b) => b.textContent?.includes('Mis Anuncios'))?.click();
    buttons.find((b) => b.textContent?.includes('Publicar'))?.click();
    buttons.find((b) => b.textContent?.includes('Bitácora'))?.click();
    buttons.find((b) => b.textContent?.includes('↗'))?.click();
    buttons.find((b) => b.textContent?.includes('✕'))?.click();

    expect(copyHudAmount).toHaveBeenCalledTimes(1);
    expect(openMerchantPortal).toHaveBeenNthCalledWith(1, 'myads');
    expect(openMerchantPortal).toHaveBeenNthCalledWith(2, 'advPost');
    expect(sendActiveContextToLog).toHaveBeenCalledTimes(1);
    expect(openActiveInExternalBrowser).toHaveBeenCalledTimes(1);
    expect(dismissHud).toHaveBeenCalledTimes(1);
  });
});
