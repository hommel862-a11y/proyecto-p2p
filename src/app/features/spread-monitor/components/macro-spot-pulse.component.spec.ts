import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MacroSpotPulseComponent } from './macro-spot-pulse.component';
import { SpotMarketService } from '../../../core/spot-market.service';
import type { Spot24hTicker } from '@p2p/core';

describe('MacroSpotPulseComponent', () => {
  let component: MacroSpotPulseComponent;
  let spotService: SpotMarketService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MacroSpotPulseComponent],
      providers: [SpotMarketService],
    });

    spotService = TestBed.inject(SpotMarketService);
    const fixture = TestBed.createComponent(MacroSpotPulseComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('inicializa con BTCUSDT como activo seleccionado y streaming activo', () => {
    expect(component.selectedAsset()).toBe('BTCUSDT');
    expect(component.autoRefreshActive()).toBe(true);
  });

  it('permite alternar el streaming automático y cambiar de activo', () => {
    component.toggleAutoRefresh();
    expect(component.autoRefreshActive()).toBe(false);

    component.selectAsset('SOLUSDT');
    expect(component.selectedAsset()).toBe('SOLUSDT');

    component.selectAsset('USDCUSDT');
    expect(component.selectedAsset()).toBe('USDCUSDT');
  });

  it('calcula la ruta SVG de la sparkline a partir de los snapshots de SQLite', () => {
    component.snapshots.set([
      {
        id: 1,
        fetchedAt: 1710000000,
        createdAt: 1710000000,
        obi: 0.1,
        bidUsd: 80,
        askUsd: 81,
        nBids: 5,
        nAsks: 5,
        stale: false,
        btcUsdt: 90000,
        solUsdt: 180,
        usdcUsdt: 1.0,
      },
      {
        id: 2,
        fetchedAt: 1710000060,
        createdAt: 1710000060,
        obi: 0.2,
        bidUsd: 80.5,
        askUsd: 81.5,
        nBids: 6,
        nAsks: 6,
        stale: false,
        btcUsdt: 91000,
        solUsdt: 185,
        usdcUsdt: 0.9999,
      },
    ]);

    component.selectAsset('BTCUSDT');
    const path = component.sparklinePath();
    expect(path).toContain('6.0,58.0');
    expect(path).toContain('354.0,6.0');

    const stats = component.selectedStats();
    expect(stats.min).toBe(90000);
    expect(stats.max).toBe(91000);
    expect(stats.current).toBe(91000);
    expect(stats.count).toBe(2);
  });

  it('sincroniza datos vía Electron bridge si listMarketSnapshots está disponible', async () => {
    const listMarketSnapshotsMock = vi.fn().mockResolvedValue([
      {
        id: 10,
        fetchedAt: 1710000000,
        obi: 0,
        bidUsd: 80,
        askUsd: 81,
        nBids: 5,
        nAsks: 5,
        stale: false,
        btcUsdt: 89000,
      },
    ]);

    vi.stubGlobal('window', {
      electron: {
        db: { listMarketSnapshots: listMarketSnapshotsMock },
      },
    });

    vi.spyOn(spotService, 'fetchCoreBasket').mockResolvedValue(new Map<string, Spot24hTicker>());

    await component.refreshData();

    expect(spotService.fetchCoreBasket).toHaveBeenCalled();
  });

  it('detecta alertas macro de despeg USDC y volatilidad intradía en BTC', () => {
    // Sin alertas con valores normales
    expect(component.macroAlerts()).toHaveLength(0);
    expect(component.hasAlert('USDCUSDT')).toBe(false);

    // Inyectar ticker de USDC con despeg (> 50 bps) y spread alto
    const tickersMap = new Map<string, Spot24hTicker>();
    tickersMap.set('USDCUSDT', {
      symbol: 'USDCUSDT',
      bidPrice: 0.992,
      askPrice: 0.998,
      midPrice: 0.994, // 60 bps de despeg
      spreadPct: 0.06, // 60 bps de spread
      lastPrice: 0.994,
      priceChangePct24h: -0.6,
      highPrice24h: 1.001,
      lowPrice24h: 0.992,
      volumeBase24h: 1000000,
      quoteVolumeUsdt24h: 1000000,
      timestamp: new Date().toISOString(),
    });

    tickersMap.set('BTCUSDT', {
      symbol: 'BTCUSDT',
      bidPrice: 93900,
      askPrice: 94100,
      midPrice: 94000,
      spreadPct: 0.02,
      lastPrice: 94000,
      priceChangePct24h: 6.25, // > 5.0% de volatilidad
      highPrice24h: 95000,
      lowPrice24h: 88000,
      volumeBase24h: 15000,
      quoteVolumeUsdt24h: 1400000000,
      timestamp: new Date().toISOString(),
    });

    spotService.tickers24h.set(tickersMap);

    const alerts = component.macroAlerts();
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(component.hasAlert('USDCUSDT')).toBe(true);
    expect(component.hasAlert('BTCUSDT')).toBe(true);
    expect(component.hasAlert('SOLUSDT')).toBe(false);

    const depeg = alerts.find((a) => a.id === 'usdc-depeg');
    expect(depeg?.severity).toBe('CRITICAL');

    const btcVol = alerts.find((a) => a.id === 'btc-volatility');
    expect(btcVol?.severity).toBe('WARNING');
  });
});
