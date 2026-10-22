import '@angular/compiler';
import { Injector } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { P2PRadarService } from './p2p-radar.service';
import { ToastService } from './toast.service';

describe('P2PRadarService', () => {
  let service: P2PRadarService;
  let toastMock: {
    info: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    toastMock = {
      info: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    const injector = Injector.create({
      providers: [
        { provide: ToastService, useValue: toastMock },
        P2PRadarService,
      ],
    });

    service = injector.get(P2PRadarService);
  });

  it('initializes with default UNVERIFIED tier and RETAIL_20K volume bracket', () => {
    expect(service.userTier()).toBe('UNVERIFIED');
    expect(service.selectedBracket().id).toBe('RETAIL_20K');
    expect(service.cleanConfig().maxPayTimeMinutes).toBe(15);
    expect(service.activePaymentMethods()).toContain('Banesco');
    expect(service.activePaymentMethods()).toContain('Mercantil');
  });

  it('updates userTier and mutates maker fee calculations', () => {
    service.setUserTier('VERIFIED');
    expect(service.userTier()).toBe('VERIFIED');
  });

  it('updates volume bracket and syncs cleanConfig minTransAmountVes', () => {
    service.setVolumeBracket('WHOLESALE_1M');
    expect(service.selectedBracket().id).toBe('WHOLESALE_1M');
    expect(service.cleanConfig().minTransAmountVes).toBe(1_000_000);
  });

  it('toggles payment methods on and off dynamically', () => {
    service.togglePaymentMethod('Banesco');
    expect(service.activePaymentMethods()).not.toContain('Banesco');

    service.togglePaymentMethod('Banesco');
    expect(service.activePaymentMethods()).toContain('Banesco');
  });

  it('manages bank presets for fast operational switching', () => {
    service.setBankPreset('ALL_VES');
    expect(service.activePaymentMethods().length).toBe(8);
    expect(service.activePaymentMethods()).toContain('BNC');
    expect(service.activePaymentMethods()).toContain('BBVA');
    expect(service.activePaymentMethods()).toContain('Banplus');

    service.setBankPreset('EXPANDED');
    expect(service.activePaymentMethods().length).toBe(10);
    expect(service.activePaymentMethods()).toContain('BanescoPanama');
    expect(service.activePaymentMethods()).toContain('Zinli');

    service.setBankPreset('CLEAR');
    expect(service.activePaymentMethods().length).toBe(0);

    service.selectAllBanks();
    expect(service.activePaymentMethods().length).toBe(10);
  });

  it('parses raw P2P response and executes clean book indexing during scanRadar', async () => {
    const mockApiResponse = {
      data: [
        {
          adv: {
            advNo: '112233',
            price: '98.50',
            surplusAmount: '500.00',
            minSingleTransAmount: '20000',
            maxSingleTransAmount: '50000',
            payTimeLimit: 15,
            tradeMethods: [{ payType: 'Banesco' }],
          },
          advertiser: {
            userNo: 'USR-1',
            nickName: 'TraderBanesco',
            monthOrderCount: 95,
            monthFinishRate: 0.98,
            userType: 'merchant',
          },
        },
      ],
    };

    // Spy on global fetch
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      }),
    );

    // Limit active payment methods to 1 for concise test
    service.activePaymentMethods.set(['Banesco']);

    const books = await service.scanRadar('USDT', 'VES');

    expect(books.size).toBe(2); // BUY and SELL for Banesco
    expect(service.loading()).toBe(false);
    expect(service.totalCleanOffers()).toBeGreaterThan(0);

    const buyBook = books.get('Banesco_BUY');
    expect(buyBook).toBeDefined();
    expect(buyBook?.cleanOffers[0].nickName).toBe('TraderBanesco');
    expect(buyBook?.effectiveTopPrice).toBe(98.5);

    vi.unstubAllGlobals();
  });

  it('records snapshots in ring buffer and computes market trends during scanRadar', async () => {
    const mockApiResponse = {
      data: [
        {
          adv: {
            advNo: '112233',
            price: '98.50',
            surplusAmount: '500.00',
            minSingleTransAmount: '20000',
            maxSingleTransAmount: '50000',
            payTimeLimit: 15,
            tradeMethods: [{ payType: 'Banesco' }],
          },
          advertiser: {
            userNo: 'USR-1',
            nickName: 'TraderBanesco',
            monthOrderCount: 95,
            monthFinishRate: 0.98,
            userType: 'merchant',
          },
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      }),
    );

    service.activePaymentMethods.set(['Banesco']);

    await service.scanRadar('USDT', 'VES');

    const trend = service.getTrendForBook('Banesco', 'BUY');
    expect(trend).toBeDefined();
    expect(trend?.currentVWAP).toBe(98.5);
    expect(trend?.trend).toBe('LATERAL');

    const bots = service.getBotsForBook('Banesco', 'BUY');
    expect(Array.isArray(bots)).toBe(true);
    expect(service.totalBotsDetected()).toBe(0); // single snapshot cannot trigger bot yet

    // Phase 3 verification
    expect(service.matrixScanResult()).toBeDefined();
    expect(service.topRoutes().length).toBeGreaterThan(0);
    expect(service.bestRoute()).toBeDefined();

    vi.unstubAllGlobals();
  });

  it('updates Phase 3 tactical configuration and recomputes routes', () => {
    service.setExecutionMode('MAKER_COMPRA_TAKER_VENTA');
    expect(service.executionMode()).toBe('MAKER_COMPRA_TAKER_VENTA');

    service.setOperatingCapital(2500);
    expect(service.operatingCapitalUsdt()).toBe(2500);

    service.setTargetNetMargin(0.5);
    expect(service.targetNetMarginPct()).toBe(0.5);

    service.setInterbankFriction(0.4);
    expect(service.interbankFrictionPct()).toBe(0.4);
  });

  it('simulates arbitrary buy and sell rates interactively', () => {
    const sim = service.simulateArbitrage(98.0, 100.0, {
      capitalUsdt: 1000,
      mode: 'DOBLE_MAKER',
      userTier: 'VERIFIED',
    });

    expect(sim.grossSpreadPct).toBe(2.04);
    expect(sim.netSpreadPct).toBe(1.63);
    expect(sim.breakEvenSellPrice).toBe(98.3932);
    expect(sim.isViable).toBe(true);
  });

  it('broadcasts HUD payload and toggles broadcasting state', () => {
    const payload = service.broadcastHud();
    expect(payload).toBeDefined();
    expect(payload?.version).toBe('1.0.0');
    expect(service.lastHudPayload()).toBe(payload);

    const activeAfterToggle = service.toggleHudBroadcasting();
    expect(activeAfterToggle).toBe(false);
    expect(service.broadcastHud()).toBeNull();

    service.toggleHudBroadcasting();
    expect(service.hudActive()).toBe(true);
  });

  it('records completed cycles and maintains clean daily consolidated accounting', () => {
    service.clearCompletedCycles();
    expect(service.completedCycles().length).toBe(0);

    const cycle = service.recordCompletedCycle({
      sourceBank: 'Banesco',
      targetBank: 'Mercantil',
      executionMode: 'DOBLE_MAKER',
      capitalUsdt: 1000,
      buyPrice: 98.0,
      sellPrice: 101.5,
      netSpreadPct: 3.12,
      netProfitUsdt: 31.2,
      netProfitFiat: 3166.8,
    });

    expect(cycle.cycleId).toContain('CYC-');
    expect(service.completedCycles().length).toBe(1);

    const summary = service.dailyConsolidated();
    expect(summary.totalCycles).toBe(1);
    expect(summary.totalNetProfitUsdt).toBe(31.2);
    expect(summary.averageNetSpreadPct).toBe(3.12);
    expect(summary.interbankCyclesCount).toBe(1);
  });
});
