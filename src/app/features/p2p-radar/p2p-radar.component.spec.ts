import '@angular/compiler';
import { Injector } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { P2PRadarComponent } from './p2p-radar.component';
import { P2PRadarService } from '../../core/p2p-radar.service';
import { AudioAlertsService } from '../../core/audio-alerts.service';
import { ToastService } from '../../core/toast.service';
import type { CleanRadarOffer, ArbitrageRoute } from '@p2p/core';

describe('P2PRadarComponent', () => {
  let component: P2PRadarComponent;
  let radarService: P2PRadarService;
  let audioMock: { playOpportunityAlert: ReturnType<typeof vi.fn> };
  let toastMock: { info: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    audioMock = {
      playOpportunityAlert: vi.fn(),
    };
    toastMock = {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const injector = Injector.create({
      providers: [
        { provide: AudioAlertsService, useValue: audioMock },
        { provide: ToastService, useValue: toastMock },
        P2PRadarService,
        P2PRadarComponent,
      ],
    });

    radarService = injector.get(P2PRadarService);
    component = injector.get(P2PRadarComponent);
  });

  it('initializes with default state and syncs modal settings', () => {
    component.ngOnInit();
    expect(component.cleanModalOpen()).toBe(false);
    expect(component.soundAlertsActive()).toBe(true);
    expect(component.modalMaxPayTime()).toBe(15);
    expect(component.modalMinFinishRate()).toBe(92);
    expect(component.modalMinOrders()).toBe(30);
    expect(component.availableBanks.length).toBe(10);
    expect(component.availableBanks).toContain('BNC');
    expect(component.availableBanks).toContain('Zinli');
    component.ngOnDestroy();
  });

  it('switches bank presets and updates activePreset computed signal', () => {
    component.setBankPreset('TOP_VES');
    expect(component.activePreset()).toBe('TOP_VES');
    expect(component.activeBanks().length).toBe(4);

    component.setBankPreset('ALL_VES');
    expect(component.activePreset()).toBe('ALL_VES');
    expect(component.activeBanks().length).toBe(8);

    component.setBankPreset('EXPANDED');
    expect(component.activePreset()).toBe('EXPANDED');
    expect(component.activeBanks().length).toBe(10);

    component.toggleBank('Zinli');
    expect(component.activePreset()).toBe('CUSTOM');
  });

  it('updates operational controls through component delegates', () => {
    component.setUserTier('VERIFIED');
    expect(radarService.userTier()).toBe('VERIFIED');

    component.setExecutionMode('MAKER_COMPRA_TAKER_VENTA');
    expect(radarService.executionMode()).toBe('MAKER_COMPRA_TAKER_VENTA');

    component.setVolumeBracket('MEDIUM_150K');
    expect(radarService.selectedBracket().id).toBe('MEDIUM_150K');

    component.onCapitalChange(3000);
    expect(radarService.operatingCapitalUsdt()).toBe(3000);

    component.onMarginTargetChange(0.65);
    expect(radarService.targetNetMarginPct()).toBe(0.65);
  });

  it('loads an offer into the interactive simulator', () => {
    const mockOffer: CleanRadarOffer = {
      advNo: '111',
      advertiserNo: 'USR-1',
      nickName: 'TraderTop',
      price: 102.5,
      surplusAmount: 1500,
      minSingleTransAmount: 20000,
      maxSingleTransAmount: 50000,
      monthOrderCount: 120,
      monthFinishRate: 99,
      payTimeLimit: 15,
      isMerchant: true,
      isClean: true,
      isOutlier: false,
      verdict: { passed: true, reasons: [] },
    };

    component.selectOfferForSimulation('Banesco', 'BUY', mockOffer);
    expect(component.simBuyBank()).toBe('Banesco');
    expect(component.simBuyPrice()).toBe(102.5);
    expect(toastMock.info).toHaveBeenCalled();

    component.selectOfferForSimulation('Mercantil', 'SELL', mockOffer);
    expect(component.simSellBank()).toBe('Mercantil');
    expect(component.simSellPrice()).toBe(102.5);
  });

  it('loads a full route into the simulator from ticker', () => {
    const mockRoute: ArbitrageRoute = {
      routeId: 'Banesco_TO_Mercantil',
      sourceBank: 'Banesco',
      targetBank: 'Mercantil',
      isInterbank: true,
      sellPrice: 103.0,
      buyPrice: 99.5,
      executionMode: 'DOBLE_MAKER',
      metrics: {
        grossSpreadPct: 3.52,
        netSpreadPct: 2.81,
        grossProfitUsdt: 35.2,
        netProfitUsdt: 28.1,
        netProfitFiat: 2894.3,
        breakEvenSellPrice: 100.2,
        breakEvenBuyPrice: 102.27,
        targetSellPrice: 100.55,
        targetBuyPrice: 101.91,
        totalFeesUsdt: 7.1,
        fiatFrictionCostFiat: 30.9,
        totalMultiplier: 1.0281,
        isViable: true,
      },
      rank: 1,
    };

    component.loadRouteIntoSimulator(mockRoute);
    expect(component.simSellBank()).toBe('Banesco');
    expect(component.simSellPrice()).toBe(103.0);
    expect(component.simBuyBank()).toBe('Mercantil');
    expect(component.simBuyPrice()).toBe(99.5);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('toggles sound alerts and triggers chimes when active', () => {
    component.toggleSoundAlerts();
    expect(component.soundAlertsActive()).toBe(false);
    expect(toastMock.warn).toHaveBeenCalled();

    component.toggleSoundAlerts();
    expect(component.soundAlertsActive()).toBe(true);
    expect(audioMock.playOpportunityAlert).toHaveBeenCalled();
    expect(toastMock.info).toHaveBeenCalled();
  });

  it('opens clean modal, modifies values, and saves updated config', () => {
    component.openCleanModal();
    expect(component.cleanModalOpen()).toBe(true);

    component.modalMaxPayTime.set(20);
    component.modalMinFinishRate.set(95);
    component.modalMinOrders.set(50);
    component.modalMaxOutlierDevPct.set(1.2);

    component.saveCleanModalSettings();
    expect(component.cleanModalOpen()).toBe(false);
    expect(radarService.cleanConfig().maxPayTimeMinutes).toBe(20);
    expect(radarService.cleanConfig().minMonthFinishRate).toBe(95);
    expect(radarService.cleanConfig().minMonthOrderCount).toBe(50);
    expect(radarService.cleanConfig().outlierDeviationPct).toBe(1.2);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('copies suggested target rate to clipboard', () => {
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: clipboardSpy,
      },
    });

    component.copyRateToClipboard(102.45, 'targetSell');
    expect(clipboardSpy).toHaveBeenCalledWith('102.45');
    expect(component.copiedTarget()).toBe('targetSell');
    expect(toastMock.info).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('records current simulated cycle with valid prices and rejects invalid prices', () => {
    // When prices are 0
    component.simBuyPrice.set(0);
    component.simSellPrice.set(0);
    component.recordCurrentSimulatedCycle();
    expect(toastMock.warn).toHaveBeenCalledWith('Ingresa tasas válidas de compra y venta antes de registrar el ciclo.');

    // When prices are set
    component.simBuyBank.set('Mercantil');
    component.simSellBank.set('Banesco');
    component.simBuyPrice.set(98.5);
    component.simSellPrice.set(102.0);

    component.recordCurrentSimulatedCycle();
    expect(radarService.completedCycles().length).toBe(1);
    const recorded = radarService.completedCycles()[0];
    expect(recorded.sourceBank).toBe('Banesco');
    expect(recorded.targetBank).toBe('Mercantil');
    expect(recorded.buyPrice).toBe(98.5);
    expect(recorded.sellPrice).toBe(102.0);
    expect(radarService.dailyConsolidated().totalCycles).toBe(1);
  });

  it('copies daily summary to clipboard when cycles exist and warns if empty', () => {
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: clipboardSpy,
      },
    });

    // When empty
    component.copyDailySummaryToClipboard();
    expect(toastMock.warn).toHaveBeenCalledWith('No hay ciclos completados registrados el día de hoy.');
    expect(clipboardSpy).not.toHaveBeenCalled();

    // After adding a cycle
    component.simBuyBank.set('Mercantil');
    component.simSellBank.set('Banesco');
    component.simBuyPrice.set(98.5);
    component.simSellPrice.set(102.0);
    component.recordCurrentSimulatedCycle();

    component.copyDailySummaryToClipboard();
    expect(clipboardSpy).toHaveBeenCalled();
    const copiedText = clipboardSpy.mock.calls[0][0];
    expect(copiedText).toContain('RESUMEN DIARIO ARBITRAJE P2P');
    expect(copiedText).toContain('Ciclos Completados: 1');
    expect(toastMock.success).toHaveBeenCalledWith('Resumen diario consolidado copiado al portapapeles.');

    vi.unstubAllGlobals();
  });

  it('toggles HUD bridge via toggleHudBridge()', () => {
    expect(radarService.hudActive()).toBe(true);
    component.toggleHudBridge();
    expect(radarService.hudActive()).toBe(false);
    component.toggleHudBridge();
    expect(radarService.hudActive()).toBe(true);
  });

  it('manages real-time Live Stream auto-refresh intervals cleanly', () => {
    component.setAutoRefresh(15);
    expect(radarService.autoRefreshIntervalSec()).toBe(15);
    expect(radarService.streamCountdownSec()).toBe(15);

    component.setAutoRefresh(0);
    expect(radarService.autoRefreshIntervalSec()).toBe(0);
    expect(radarService.streamCountdownSec()).toBe(0);
  });

  it('switches workspace view modes, density modes, and matrix route filters', () => {
    expect(component.activeViewMode()).toBe('BOOKS');
    component.setViewMode('MATRIX');
    expect(component.activeViewMode()).toBe('MATRIX');

    component.setViewMode('FORENSIC');
    expect(component.activeViewMode()).toBe('FORENSIC');

    expect(component.booksDensityMode()).toBe('COMFORT');
    component.toggleDensityMode();
    expect(component.booksDensityMode()).toBe('COMPACT');

    component.setRouteFilter('INTERBANK');
    expect(component.routeFilterMode()).toBe('INTERBANK');
  });

  it('supports tactical penny-war price nudging, bank swapping, and CRM pipeline dispatch', () => {
    component.simBuyBank.set('Banesco');
    component.simSellBank.set('Mercantil');
    component.simBuyPrice.set(100.0);
    component.simSellPrice.set(103.5);

    component.nudgeSimPrice('BUY', 0.01);
    expect(component.simBuyPrice()).toBe(100.01);

    component.nudgeSimPrice('SELL', -0.05);
    expect(component.simSellPrice()).toBe(103.45);

    component.swapSimulatorBanks();
    expect(component.simBuyBank()).toBe('Mercantil');
    expect(component.simSellBank()).toBe('Banesco');

    component.dispatchSimulatedToCrm();
    expect(toastMock.success).toHaveBeenCalled();
  });
});


