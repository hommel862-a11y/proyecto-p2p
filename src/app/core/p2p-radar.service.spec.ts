import '@angular/compiler';
import { Injector } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { P2PRadarService } from './p2p-radar.service';
import { ToastService } from './toast.service';
import { StorageService } from './storage';

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

  it('deduplicates concurrent scanRadar calls via single-flight lock and tolerates partial failures via Promise.allSettled', async () => {
    const mockOk = {
      data: [
        {
          adv: {
            advNo: 'OK-1',
            price: '99.00',
            surplusAmount: '500',
            minSingleTransAmount: '1000',
            maxSingleTransAmount: '50000',
            payTimeLimit: 15,
            tradeMethods: [{ payType: 'Banesco' }],
          },
          advertiser: {
            userNo: 'U1',
            nickName: 'OkMerchant',
            monthOrderCount: 100,
            monthFinishRate: 0.99,
            userType: 'merchant',
          },
        },
      ],
    };

    let callIdx = 0;
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('p2p.binance.com')) {
        callIdx++;
        // Fail every even leg so 1 side succeeds and 1 fails (partial failure)
        if (callIdx % 2 === 0) {
          throw new Error('simulated network hiccup');
        }
        return { ok: true, status: 200, json: async () => mockOk };
      }
      throw new Error('offline bridge');
    });
    vi.stubGlobal('fetch', fetchSpy);

    service.activePaymentMethods.set(['Banesco']);
    const [r1, r2] = await Promise.all([
      service.scanRadar('USDT', 'VES'),
      service.scanRadar('USDT', 'VES'),
    ]);

    expect(r1).toBe(r2);
    expect(r1.size).toBe(1); // BUY succeeded while SELL failed -> partial result kept
    expect(service.error()).toContain('Escaneo parcial');
    vi.unstubAllGlobals();
  });

  it('prunes deselected bank books immediately and sanitizes null/NaN numeric setters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              adv: {
                advNo: 'A1',
                price: '100',
                surplusAmount: '500',
                minSingleTransAmount: '1000',
                maxSingleTransAmount: '50000',
                payTimeLimit: 15,
              },
              advertiser: {
                userNo: 'U1',
                nickName: 'Trader',
                monthOrderCount: 90,
                monthFinishRate: 98.5, // Percentage format > 1 normalized safely
                userType: 'merchant',
              },
            },
          ],
        }),
      }),
    );

    service.activePaymentMethods.set(['Banesco', 'Mercantil']);
    await service.scanRadar();
    expect(service.radarBooks().size).toBe(4);

    service.togglePaymentMethod('Mercantil');
    expect(service.radarBooks().has('Mercantil_BUY')).toBe(false);
    expect(service.radarBooks().has('Mercantil_SELL')).toBe(false);
    expect(service.radarBooks().size).toBe(2);

    service.setTargetNetMargin(0.5);
    service.setTargetNetMargin(null as unknown as number);
    service.setOperatingCapital(Number.NaN);
    service.setInterbankFriction(-1);
    expect(service.targetNetMarginPct()).toBe(0.5);
    expect(service.operatingCapitalUsdt()).toBe(1000);
    expect(service.interbankFrictionPct()).toBe(0.3);

    vi.unstubAllGlobals();
  });

  it('resets autoRefreshIntervalSec and countdown when stopAutoRefresh() is called', () => {
    vi.useFakeTimers();
    service.setAutoRefreshInterval(10);
    expect(service.autoRefreshIntervalSec()).toBe(10);
    expect(service.streamCountdownSec()).toBe(10);

    vi.advanceTimersByTime(3000);
    expect(service.streamCountdownSec()).toBe(7);

    service.stopAutoRefresh();
    expect(service.autoRefreshIntervalSec()).toBe(0);
    expect(service.streamCountdownSec()).toBe(0);
    vi.useRealTimers();
  });

  it('maps Binance C2C tradeType to SELL for Banesco_BUY (Maker BUY competitors) and BUY for Banesco_SELL (Maker SELL competitors)', async () => {
    const requestedTradeTypes: string[] = [];

    const makeOffer = (advNo: string, nickName: string, price: string) => ({
      adv: {
        advNo,
        price,
        surplusAmount: '1500.00',
        minSingleTransAmount: '20000',
        maxSingleTransAmount: '150000',
        payTimeLimit: 15,
        tradeMethods: [{ payType: 'Banesco' }],
      },
      advertiser: {
        userNo: `USR-${advNo}`,
        nickName,
        monthOrderCount: 150,
        monthFinishRate: 0.99,
        userType: 'merchant',
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { tradeType?: string };
        if (body.tradeType) {
          requestedTradeTypes.push(body.tradeType);
        }
        // Binance tradeType='SELL' returns Maker BUY competitors (paying ~98.50 Bs for USDT)
        // Binance tradeType='BUY' returns Maker SELL competitors (selling USDT at ~101.20 Bs)
        const data =
          body.tradeType === 'SELL'
            ? [makeOffer('MB1', 'MakerBuyBest', '98.50'), makeOffer('MB2', 'MakerBuy2', '98.20')]
            : [makeOffer('MS1', 'MakerSellBest', '101.20'), makeOffer('MS2', 'MakerSell2', '101.60')];
        return {
          ok: true,
          status: 200,
          json: async () => ({ data }),
        };
      }),
    );

    service.activePaymentMethods.set(['Banesco']);
    const books = await service.scanRadar('USDT', 'VES');

    expect(requestedTradeTypes).toEqual(['SELL', 'BUY']);
    const buyBook = books.get('Banesco_BUY');
    const sellBook = books.get('Banesco_SELL');

    expect(buyBook?.cleanOffers[0].nickName).toBe('MakerBuyBest');
    expect(buyBook?.effectiveTopPrice).toBe(98.5);
    expect(sellBook?.cleanOffers[0].nickName).toBe('MakerSellBest');
    expect(sellBook?.effectiveTopPrice).toBe(101.2);
    expect(service.bestRoute()?.metrics.grossSpreadPct).toBeGreaterThan(2);

    vi.unstubAllGlobals();
  });

  it('supports MakerMerchantLevel (STANDARD 0.25%..GOLD 0.125%), parses taker restrictions & preserves 0 payTimeLimit', async () => {
    service.setMerchantLevel('STANDARD');
    expect(service.merchantLevel()).toBe('STANDARD');
    expect(service.userTier()).toBe('UNVERIFIED');

    const mockApiResponse = {
      data: [
        {
          adv: {
            advNo: 'OPEN-1',
            price: '98.50',
            surplusAmount: '500.00',
            minSingleTransAmount: '20000',
            maxSingleTransAmount: '100000',
            payTimeLimit: 15,
            classify: 'mass',
            buyerKycLimit: 0,
            buyerRegDaysLimit: 0,
            buyerBtcPositionLimit: 0,
            takerAdditionalKycRequired: false,
            tradeMethods: [{ payType: 'Banesco', identifier: 'Banesco' }],
          },
          advertiser: {
            userNo: 'USR-OPEN',
            nickName: 'LibreTrader',
            monthOrderCount: 120,
            monthFinishRate: 0.97,
            userType: 'user',
            userGrade: 1,
            proMerchant: false,
          },
        },
        {
          adv: {
            advNo: 'LOCK-0-PAYTIME',
            price: '98.00',
            surplusAmount: '800.00',
            minSingleTransAmount: '20000',
            maxSingleTransAmount: '200000',
            payTimeLimit: 0,
            buyerRegDaysLimit: 90,
            buyerBtcPositionLimit: 0.05,
            takerAdditionalKycRequired: true,
            tradeMethods: [{ payType: 'Banesco' }],
          },
          advertiser: {
            userNo: 'USR-LOCK',
            nickName: 'OroLocked',
            monthOrderCount: 250,
            monthFinishRate: 0.99,
            userType: 'merchant',
            proMerchant: true,
          },
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockApiResponse,
      }),
    );

    service.activePaymentMethods.set(['Banesco']);
    const books = await service.scanRadar('USDT', 'VES');
    const buyBook = books.get('Banesco_BUY');

    expect(buyBook?.makerFeePct).toBe(0.25);
    expect(buyBook?.cleanOffers[0].advNo).toBe('OPEN-1');
    expect(buyBook?.cleanOffers[0].takerEligibility).toBe('OPEN');
    // Missing/0 payTimeLimit must no longer be coerced to 15 to slip past Clean Mode
    const rejectedZeroPayTime = buyBook?.rejectedOffers.find((o) => o.advNo === 'LOCK-0-PAYTIME');
    expect(rejectedZeroPayTime?.payTimeLimit).toBe(0);
    expect(rejectedZeroPayTime?.takerEligibility).toBe('RESTRICTED');
    expect(rejectedZeroPayTime?.verdict.reasons).toContain('PAY_TIME_EXCEEDED');

    vi.unstubAllGlobals();
  });

  it('uses USD fiat for BanescoPanama/Zinli, surfaces HTTP 429 on desktop bridge, and cleans ringBuffers/vwapHistories on prune', async () => {
    const requestedFiats: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (typeof url === 'string' && url.includes('127.0.0.1:51857')) {
          return { ok: false, status: 429 };
        }
        if (typeof url === 'string' && url.includes('p2p.binance.com')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as { fiat?: string };
          if (body.fiat) requestedFiats.push(body.fiat);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  adv: {
                    advNo: 'Z-1',
                    price: '1.01',
                    surplusAmount: '500',
                    minSingleTransAmount: '10',
                    maxSingleTransAmount: '500',
                    payTimeLimit: 15,
                  },
                  advertiser: {
                    userNo: 'UZ-1',
                    nickName: 'ZinliTrader',
                    monthOrderCount: 80,
                    monthFinishRate: 0.98,
                    userType: 'user',
                  },
                },
              ],
            }),
          };
        }
        throw new Error('offline');
      }),
    );

    service.activePaymentMethods.set(['Zinli']);
    const books = await service.scanRadar('USDT', 'VES');
    expect(requestedFiats).toEqual(['USD', 'USD']);
    expect(books.get('Zinli_BUY')?.cleanCount).toBe(1);

    // Pruning deselected bank must purge ringBuffers & vwapHistories too
    service.togglePaymentMethod('Zinli');
    expect(service.getTrendForBook('Zinli', 'BUY')).toBeUndefined();
    const internalBuffers = (service as unknown as { ringBuffers: Map<string, unknown> }).ringBuffers;
    expect(internalBuffers.has('Zinli_BUY')).toBe(false);

    vi.unstubAllGlobals();
  });

  it('resolves matching CRM bankAccountId when dispatching route, rejects malformed stored cycles, and surfaces 429 from desktop bridge', async () => {
    const store = new Map<string, unknown>();
    store.set('p2p.crm.banks', [
      {
        id: 'CRM-BNK-BDV',
        scope: 'P2P_DESK',
        bankName: 'Banco de Venezuela',
        holderDetails: 'Mesa Principal',
        currency: 'VES',
        currentBalanceFiat: 50000,
        dailyLimitFiat: 500000,
        todayUsedFiat: 0,
        feePct: 0,
        burstLimitCount: 5,
        recentTransfersTimestamps: [],
        status: 'ACTIVE',
      },
    ]);
    store.set('p2p.radar.completed-cycles', [
      { invalid: true },
      {
        cycleId: 'CYC-VALID',
        timestampMs: 1000,
        dateKey: '2026-11-25',
        sourceBank: 'Banesco',
        targetBank: 'Mercantil',
        isInterbank: true,
        executionMode: 'DOBLE_MAKER',
        capitalUsdt: 1000,
        buyPrice: 98,
        sellPrice: 100,
        netSpreadPct: 1.5,
        netProfitUsdt: 15,
        netProfitFiat: 1500,
      },
    ]);

    const storageMock = {
      get: vi.fn((k: string) => store.get(k) ?? null),
      set: vi.fn((k: string, v: unknown) => {
        store.set(k, v);
      }),
    };
    const injectorWithStorage = Injector.create({
      providers: [
        { provide: ToastService, useValue: toastMock },
        { provide: StorageService, useValue: storageMock },
        P2PRadarService,
      ],
    });
    const svc = injectorWithStorage.get(P2PRadarService);

    expect(svc.completedCycles().map((c) => c.cycleId)).toEqual(['CYC-VALID']);

    const deal = svc.dispatchRouteToCrmPipeline({
      sourceBank: 'SpecificBank',
      targetBank: 'Mercantil',
      buyPrice: 98,
      sellPrice: 100,
      capitalUsdt: 500,
      netProfitUsdt: 10,
    });
    expect(deal.bankAccountId).toBe('CRM-BNK-BDV');
    expect(svc.crmDealDispatchTick()).toBeGreaterThan(0);

    // 2. Verify desktop bridge 429 is NOT swallowed as generic CORS error
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('127.0.0.1:51857')) {
          return { ok: false, status: 429 };
        }
        throw new Error('CORS blocked');
      }),
    );
    svc.activePaymentMethods.set(['Banesco']);
    await svc.scanRadar('USDT', 'VES');
    expect(svc.error()).toContain('HTTP 429');

    vi.unstubAllGlobals();
    svc.ngOnDestroy();
  });
});
