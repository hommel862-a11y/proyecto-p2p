import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { BinanceP2pMarketDepth, UnifiedP2pOrder } from '@p2p/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceP2pService } from '../../../core/binance-p2p.service';
import { BybitP2pService, type MarketDataMode } from '../../../core/bybit-p2p.service';
import { ElDoradoService } from '../../../core/eldorado.service';
import { ToastService } from '../../../core/toast.service';
import { CrossExchangeMatrix } from './cross-exchange-matrix.component';

function makeDepth(
  bestBuyPrice: number,
  bestSellPrice: number,
  asset = 'USDT',
  fiat = 'VES',
): BinanceP2pMarketDepth {
  const spreadVes = bestSellPrice - bestBuyPrice;
  const spreadPct = bestBuyPrice > 0 ? (spreadVes / bestBuyPrice) * 100 : 0;
  return {
    asset,
    fiat,
    bestBuyPrice,
    bestSellPrice,
    spreadVes,
    spreadPct,
    buyOffers: [],
    sellOffers: [],
    updatedAt: new Date().toISOString(),
  };
}

describe('CrossExchangeMatrix', () => {
  let fixture: ComponentFixture<CrossExchangeMatrix>;
  let component: CrossExchangeMatrix;
  let marketDepthSig: ReturnType<typeof signal<BinanceP2pMarketDepth | null>>;
  let selectedAssetSig: ReturnType<typeof signal<string>>;
  let selectedFiatSig: ReturnType<typeof signal<string>>;
  let bybitBuySig: ReturnType<typeof signal<number>>;
  let bybitSellSig: ReturnType<typeof signal<number>>;
  let elDoradoBuySig: ReturnType<typeof signal<number>>;
  let elDoradoSellSig: ReturnType<typeof signal<number>>;
  let fetchMarketDepthMock: ReturnType<typeof vi.fn>;
  let bybitRefreshMock: ReturnType<typeof vi.fn>;
  let elDoradoRefreshMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    marketDepthSig = signal<BinanceP2pMarketDepth | null>(null);
    selectedAssetSig = signal<string>('USDT');
    selectedFiatSig = signal<string>('VES');
    bybitBuySig = signal<number>(0);
    bybitSellSig = signal<number>(0);
    elDoradoBuySig = signal<number>(0);
    elDoradoSellSig = signal<number>(0);
    fetchMarketDepthMock = vi.fn().mockResolvedValue(null);
    bybitRefreshMock = vi.fn().mockResolvedValue(undefined);
    elDoradoRefreshMock = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [CrossExchangeMatrix],
      providers: [
        {
          provide: BinanceP2pService,
          useValue: {
            marketDepth: marketDepthSig,
            selectedAsset: selectedAssetSig,
            selectedFiat: selectedFiatSig,
            fetchMarketDepth: fetchMarketDepthMock,
          },
        },
        {
          provide: BybitP2pService,
          useValue: {
            configured: signal(false),
            mode: signal<MarketDataMode>('demo'),
            statusText: signal('Demo'),
            buyPrice: bybitBuySig,
            sellPrice: bybitSellSig,
            bestSellOffer: signal<UnifiedP2pOrder | null>(null),
            bestBuyOffer: signal<UnifiedP2pOrder | null>(null),
            setDemoPrices: vi.fn(),
            saveCredentials: vi.fn(),
            clearCredentials: vi.fn(),
            refresh: bybitRefreshMock,
          },
        },
        {
          provide: ElDoradoService,
          useValue: {
            configured: signal(false),
            mode: signal<MarketDataMode>('demo'),
            statusText: signal('Demo'),
            buyPrice: elDoradoBuySig,
            sellPrice: elDoradoSellSig,
            lastQuoteSell: signal<UnifiedP2pOrder | null>(null),
            lastQuoteBuy: signal<UnifiedP2pOrder | null>(null),
            setDemoPrices: vi.fn(),
            saveCredentials: vi.fn(),
            clearCredentials: vi.fn(),
            refresh: elDoradoRefreshMock,
          },
        },
        {
          provide: ToastService,
          useValue: {
            success: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CrossExchangeMatrix);
    component = fixture.componentInstance;
  });

  it('fails cleanly to 0 (never 810.0 or 815.0) and shows SIN FEED when Binance feed is missing or <= 0', () => {
    fixture.detectChanges();

    expect(component.binanceBuyPrice()).toBe(0);
    expect(component.binanceSellPrice()).toBe(0);
    expect(component.hasBinanceFeed()).toBe(false);
    expect(component.opportunities()).toEqual([]);

    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain('SIN FEED');
    expect(text).not.toContain('EN VIVO (API)');
    expect(text).not.toContain('810.00');
    expect(text).not.toContain('815.00');

    // Negative/zero depth values must also collapse cleanly to 0 without phantom opportunities
    marketDepthSig.set(makeDepth(-5, 0));
    fixture.detectChanges();
    expect(component.binanceBuyPrice()).toBe(0);
    expect(component.binanceSellPrice()).toBe(0);
    expect(component.opportunities()).toEqual([]);
  });

  it('does not generate phantom arbitrage routes from uninitialized 0 exchange prices', () => {
    marketDepthSig.set(makeDepth(78.5, 79.8));
    bybitBuySig.set(0);
    bybitSellSig.set(0);
    elDoradoBuySig.set(0);
    elDoradoSellSig.set(0);
    fixture.detectChanges();

    expect(component.hasBinanceFeed()).toBe(true);
    expect(component.opportunities()).toEqual([]);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('EN VIVO (API)');
  });

  it('reads active asset/fiat dynamically from binanceService signals or depth and forwards them on refreshLiveRates()', () => {
    selectedAssetSig.set('EUR');
    selectedFiatSig.set('COP');
    marketDepthSig.set(makeDepth(4200, 4280, 'EUR', 'COP'));
    bybitBuySig.set(4180);
    bybitSellSig.set(4295);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain('EUR / COP');
    expect(text).toContain('4,200.00 COP');
    expect(text).toContain('4,280.00 COP');

    component.refreshLiveRates();
    expect(fetchMarketDepthMock).toHaveBeenCalledWith('EUR', 'COP', true);
    expect(bybitRefreshMock).toHaveBeenCalledWith('EUR', 'COP');
    expect(elDoradoRefreshMock).toHaveBeenCalledWith('EUR', 'COP');
  });

  it('toggles API credentials section with accessible aria-expanded and renders API Key input', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const toggleBtn = el.querySelector('button[aria-expanded]') as HTMLButtonElement | null;

    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn?.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('input[placeholder="API Key"]')).toBeNull();

    toggleBtn?.click();
    fixture.detectChanges();

    expect(toggleBtn?.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('input[placeholder="API Key"]')).not.toBeNull();
  });

  it('derives active asset/fiat from marketDepth() when selectedAsset/selectedFiat are not exposed and updates network fee labels', () => {
    // Clear optional signal methods to mirror real BinanceP2pService surface
    const binance = TestBed.inject(BinanceP2pService) as unknown as {
      selectedAsset?: unknown;
      selectedFiat?: unknown;
    };
    delete binance.selectedAsset;
    delete binance.selectedFiat;

    marketDepthSig.set(makeDepth(78.2, 79.5, 'USDT', 'VES'));
    component.network.set('TRC20');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('USDT / VES');
    expect(text).toContain('78.20 VES');
    expect(text).toContain('$1.00 TRC20');

    component.refreshLiveRates();
    expect(fetchMarketDepthMock).toHaveBeenCalledWith('USDT', 'VES', true);
  });
});
