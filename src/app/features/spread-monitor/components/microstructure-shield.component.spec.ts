import '@angular/compiler';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountUsage,
  BinanceOfferSummary,
  BinanceP2pMarketDepth,
  Counterparty,
  TreasurySummary,
} from '@p2p/core';
import {
  MicrostructureShield,
  type MicrostructureApplyPriceEvent,
  type MicrostructureTelegramPayload,
  type MicrostructureWhatIfPreview,
} from './microstructure-shield.component';
import { BinanceP2pService, type BinanceFreshnessStatus } from '../../../core/binance-p2p.service';
import { CounterpartyService } from '../../../core/counterparty.service';
import { AccountsService } from '../../../core/accounts.service';
import { MarketHistoryService } from '../../../core/market-history.service';
import { CotizaveService } from '../../../core/cotizave.service';
import { AudioAlertsService } from '../../../core/audio-alerts.service';
import { HotkeysService } from '../../../core/hotkeys.service';
import { ToastService } from '../../../core/toast.service';
import { StorageService } from '../../../core/storage';
import { MemoryStorage } from '../../../core/memory-storage';
import {
  MicrostructureEngineService,
  type MicrostructureDeskPayload,
  type MicrostructureRepricerPayload,
} from '../../../core/microstructure-engine.service';

function makeOffer(
  overrides: Partial<BinanceOfferSummary> & { advNo: string; price: number },
): BinanceOfferSummary {
  return {
    merchantName: `Merchant_${overrides.advNo}`,
    finishRatePct: 98,
    orderCount: 250,
    minVes: 10_000,
    maxVes: 250_000,
    payMethods: ['Banesco'],
    ...overrides,
  };
}

function makeDepth(
  buyOffers: BinanceOfferSummary[],
  sellOffers: BinanceOfferSummary[],
  updatedAt = new Date().toISOString(),
): BinanceP2pMarketDepth {
  const bestBuyPrice = buyOffers[0]?.price ?? 0;
  const bestSellPrice = sellOffers[0]?.price ?? 0;
  const spreadVes =
    bestBuyPrice > 0 && bestSellPrice > 0 ? Number((bestSellPrice - bestBuyPrice).toFixed(2)) : 0;
  const spreadPct = bestBuyPrice > 0 ? Number(((spreadVes / bestBuyPrice) * 100).toFixed(2)) : 0;
  return {
    asset: 'USDT',
    fiat: 'VES',
    bestBuyPrice,
    bestSellPrice,
    spreadVes,
    spreadPct,
    buyOffers: buyOffers.slice(0, 5),
    sellOffers: sellOffers.slice(0, 5),
    fullBuyOffers: buyOffers.slice(0, 20),
    fullSellOffers: sellOffers.slice(0, 20),
    updatedAt,
  };
}

function makeAccountUsage(
  bankCode: 'BANESCO' | 'MERCANTIL' | 'BDV',
  bankName: string,
  consumedLimitPct: number,
  rail: 'PAGO_MOVIL' | 'TRANSFERENCIA' = 'TRANSFERENCIA',
): AccountUsage {
  const dailyLimitVes = 100_000;
  const spentTodayVes = Math.round((dailyLimitVes * consumedLimitPct) / 100);
  return {
    account: {
      id: `${bankCode.toLowerCase()}-${rail.toLowerCase()}`,
      bankName,
      bankCode,
      rail,
      accountNumberMasked: '0134-***1111',
      dailyLimitVes,
      initialBalanceVes: 120_000,
      status: 'ACTIVE',
    },
    spentTodayVes,
    receivedTodayVes: 0,
    currentBalanceVes: 120_000 - spentTodayVes,
    consumedLimitPct,
    remainingLimitVes: Math.max(0, dailyLimitVes - spentTodayVes),
    isNearLimit: consumedLimitPct >= 80 && consumedLimitPct < 100,
    isOverLimit: consumedLimitPct >= 100,
    spentThisMonthVes: spentTodayVes,
    consumedMonthlyLimitPct: consumedLimitPct,
    isNearMonthlyLimit: consumedLimitPct >= 80 && consumedLimitPct < 100,
    isOverMonthlyLimit: consumedLimitPct >= 100,
  };
}

describe('MicrostructureShield (4K Spatial Liquid Glass UI)', () => {
  let depthSig: ReturnType<typeof signal<BinanceP2pMarketDepth | null>>;
  let bankSig: ReturnType<typeof signal<string>>;
  let lastFetchedSig: ReturnType<typeof signal<Date | null>>;
  let freshnessSig: ReturnType<typeof signal<BinanceFreshnessStatus>>;
  let depthAgeMsSig: ReturnType<typeof signal<number | null>>;
  let loadingSig: ReturnType<typeof signal<boolean>>;
  let treasurySummarySig: ReturnType<typeof signal<TreasurySummary>>;
  let counterpartiesSig: ReturnType<typeof signal<Counterparty[]>>;
  let ratesByMarketSig: ReturnType<typeof signal<Record<string, { mid?: number; ask?: number; bid?: number }>>>;
  let isMutedSig: ReturnType<typeof signal<boolean>>;

  let setBankFilterSpy: ReturnType<typeof vi.fn>;
  let fetchMarketDepthSpy: ReturnType<typeof vi.fn>;
  let toggleMuteSpy: ReturnType<typeof vi.fn>;
  let playSudebanWarningToneSpy: ReturnType<typeof vi.fn>;
  let playOpportunityAlertSpy: ReturnType<typeof vi.fn>;
  let playConfirmationToneSpy: ReturnType<typeof vi.fn>;

  let fixture: ComponentFixture<MicrostructureShield>;
  let component: MicrostructureShield;
  let engine: MicrostructureEngineService;
  let marketHistory: MarketHistoryService;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T14:00:00.000Z'));

    depthSig = signal<BinanceP2pMarketDepth | null>(
      makeDepth(
        [
          makeOffer({
            advNo: 'B1',
            price: 850,
            maxVes: 850_000,
            minVes: 50_000,
            merchantName: 'CriptoVzla_VIP',
            finishRatePct: 99,
            orderCount: 400,
          }),
          makeOffer({
            advNo: 'B2',
            price: 852,
            maxVes: 500_000,
            minVes: 10_000,
            merchantName: 'CaracasExchange_Pro',
            finishRatePct: 98,
            orderCount: 250,
          }),
          makeOffer({
            advNo: 'B3',
            price: 854,
            maxVes: 250_000,
            minVes: 5_000,
            merchantName: 'Estafador_Reportado',
            finishRatePct: 92,
            orderCount: 40,
          }),
        ],
        [
          makeOffer({
            advNo: 'S1',
            price: 868,
            maxVes: 868_000,
            minVes: 250_000,
            merchantName: 'CriptoVzla_VIP',
            finishRatePct: 99,
            orderCount: 500,
          }),
          makeOffer({
            advNo: 'S2',
            price: 866,
            maxVes: 500_000,
            minVes: 50_000,
            merchantName: 'CaracasExchange_Pro',
            finishRatePct: 97,
            orderCount: 210,
          }),
          makeOffer({
            advNo: 'S3',
            price: 864,
            maxVes: 300_000,
            minVes: 5_000,
            merchantName: 'SmallUser',
            finishRatePct: 88,
            orderCount: 20,
          }),
        ],
        '2026-11-18T14:00:00.000Z',
      ),
    );
    bankSig = signal<string>('BANESCO');
    lastFetchedSig = signal<Date | null>(new Date('2026-11-18T14:00:00.000Z'));
    freshnessSig = signal<BinanceFreshnessStatus>('LIVE');
    depthAgeMsSig = signal<number | null>(2_000);
    loadingSig = signal<boolean>(false);

    const defaultUsages: AccountUsage[] = [
      makeAccountUsage('BANESCO', 'Banesco Transferencia', 35),
      makeAccountUsage('MERCANTIL', 'Mercantil Transferencia', 22),
      makeAccountUsage('BDV', 'BDV Transferencia', 15),
    ];

    treasurySummarySig = signal<TreasurySummary>({
      totalBalanceVes: 300_000,
      totalSpentTodayVes: 72_000,
      totalReceivedTodayVes: 0,
      totalSpentThisMonthVes: 72_000,
      accountsUsage: defaultUsages,
      nearLimitCount: 0,
      overLimitCount: 0,
      nearMonthlyLimitCount: 0,
      overMonthlyLimitCount: 0,
    });

    counterpartiesSig = signal<Counterparty[]>([
      {
        id: 'cp-trusted',
        alias: 'CriptoVzla_VIP',
        realName: 'Juan Pérez',
        documentId: 'V-18452123',
        reputation: 'TRUSTED',
        createdAt: '2026-01-15',
      },
      {
        id: 'cp-verified',
        alias: 'CaracasExchange_Pro',
        realName: 'María Rodríguez',
        documentId: 'V-21334556',
        reputation: 'VERIFIED',
        createdAt: '2026-02-10',
      },
      {
        id: 'cp-blocked',
        alias: 'Estafador_Reportado',
        realName: 'Carlos Fraude',
        documentId: 'V-19888999',
        reputation: 'BLOCKED',
        createdAt: '2026-02-28',
      },
    ]);

    ratesByMarketSig = signal({});
    isMutedSig = signal<boolean>(false);

    setBankFilterSpy = vi.fn((bank: string) => bankSig.set(bank));
    fetchMarketDepthSpy = vi.fn(async () => depthSig());
    toggleMuteSpy = vi.fn(() => isMutedSig.update((v) => !v));
    playSudebanWarningToneSpy = vi.fn();
    playOpportunityAlertSpy = vi.fn();
    playConfirmationToneSpy = vi.fn();

    const mem = new MemoryStorage();
    const storageStub = {
      get: <T>(key: string): T | null => {
        const raw = mem.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
      },
      set: <T>(key: string, value: T) => mem.setItem(key, JSON.stringify(value)),
      remove: (key: string) => mem.removeItem(key),
    };

    await TestBed.configureTestingModule({
      imports: [MicrostructureShield],
      providers: [
        { provide: StorageService, useValue: storageStub },
        {
          provide: BinanceP2pService,
          useValue: {
            marketDepth: depthSig,
            selectedBank: bankSig,
            lastFetched: lastFetchedSig,
            freshnessStatus: freshnessSig,
            depthAgeMs: depthAgeMsSig,
            loading: loadingSig,
            setBankFilter: setBankFilterSpy,
            fetchMarketDepth: fetchMarketDepthSpy,
          },
        },
        {
          provide: CounterpartyService,
          useValue: {
            counterparties: counterpartiesSig,
            findByQuery: (q: string) =>
              counterpartiesSig().find((c) => c.alias.toLowerCase() === q.trim().toLowerCase()),
          },
        },
        {
          provide: AccountsService,
          useValue: {
            treasurySummary: treasurySummarySig,
            rotationRecommendation: signal(defaultUsages[2].account),
          },
        },
        {
          provide: CotizaveService,
          useValue: {
            ratesByMarket: ratesByMarketSig,
          },
        },
        {
          provide: AudioAlertsService,
          useValue: {
            isMuted: isMutedSig,
            toggleMute: toggleMuteSpy,
            playOpportunityAlert: playOpportunityAlertSpy,
            playKillSwitchAlert: vi.fn(),
            playConfirmationTone: playConfirmationToneSpy,
            playInjectionTone: vi.fn(),
            playSudebanWarningTone: playSudebanWarningToneSpy,
          },
        },
        {
          provide: ToastService,
          useValue: {
            info: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    marketHistory = TestBed.inject(MarketHistoryService);
    engine = TestBed.inject(MicrostructureEngineService);
    fixture = TestBed.createComponent(MicrostructureShield);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    marketHistory?.clearHistory();
    vi.useRealTimers();
  });

  describe('Engine Persistence & Snapshot Lifecycle (S4)', () => {
    it('retains OrderPersistenceTracker state across component destroy and re-mount via MicrostructureEngineService', () => {
      // Snapshot #1 must not create false spoof alerts
      expect(engine.spoofReport().spoofBaitCount).toBe(0);

      // Snapshot #1 includes a huge spoof wall, then disappears after 25s
      depthSig.set(
        makeDepth(
          [makeOffer({ advNo: 'B1', price: 850, maxVes: 250_000 })],
          [
            makeOffer({ advNo: 'SPOOF_WALL', price: 895, maxVes: 600_000, orderCount: 10 }),
            makeOffer({ advNo: 'S1', price: 868, maxVes: 120_000 }),
            makeOffer({ advNo: 'S2', price: 866, maxVes: 120_000 }),
          ],
          '2026-11-18T14:00:05.000Z',
        ),
      );
      fixture.detectChanges();

      vi.advanceTimersByTime(25_000);
      depthSig.set(
        makeDepth(
          [makeOffer({ advNo: 'B1', price: 850, maxVes: 250_000 })],
          [
            makeOffer({ advNo: 'S1', price: 868, maxVes: 120_000 }),
            makeOffer({ advNo: 'S2', price: 866, maxVes: 120_000 }),
          ],
          '2026-11-18T14:00:30.000Z',
        ),
      );
      fixture.detectChanges();

      const preDestroyPurged = engine.sellSpoofReport().phantomLiquidityCount + engine.sellSpoofReport().spoofBaitCount;
      expect(preDestroyPurged).toBeGreaterThan(0);

      // Destroy and re-mount component inside the same injector: tracker state MUST persist
      fixture.destroy();
      fixture = TestBed.createComponent(MicrostructureShield);
      component = fixture.componentInstance;
      fixture.detectChanges();

      expect((component as unknown as { tracker?: unknown }).tracker).toBeUndefined();
      const postMountPurged =
        component.engine.sellSpoofReport().phantomLiquidityCount +
        component.engine.sellSpoofReport().spoofBaitCount;
      expect(postMountPurged).toBe(preDestroyPurged);
    });
  });

  describe('KPI Strip, VPIN Proxy L2 & Honest BCV NO_MODEL (S1, S3)', () => {
    it('renders explicit PROXY L2 badge & disclaimer for VPIN, honest N/D BCV gap when missing, and zero invented BCV probability', () => {
      const el = fixture.nativeElement as HTMLElement;
      const text = el.textContent ?? '';

      expect(text).toContain('PROXY L2');
      expect(text).toContain('no cinta de trades ejecutados');
      expect(text).toContain('N/D');
      expect(text).not.toMatch(/probabilidad\s*:\s*\d+%/i);
      expect(text).not.toContain('95%');
      expect(text).not.toContain('\\$');
    });

    it('renders measured BCV gap when bcvRateVes input is provided while still keeping NO_MODEL', () => {
      fixture.componentRef.setInput('bcvRateVes', 700);
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(engine.volatility2h().bcvGap.actionable).toBe(true);
      expect(engine.volatility2h().bcvWindow.probabilityBasis).toBe('NO_MODEL');
      expect(text).toContain('NO_MODEL');
      expect(text).not.toContain('Brecha BCV: N/D');
    });
  });

  describe('DOM Convergente, FIFO Floor, What-If Hover, Counterparty CRM & Bank Quota (S1, S3)', () => {
    it('renders FIFO breakeven line, highlights sell rows below FIFO cost, and displays CRM reputation badges', () => {
      fixture.componentRef.setInput('liveBreakEvenSellPrice', 866);
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const fifoLine = el.querySelector('[data-testid="fifo-breakeven-line"]');
      expect(fifoLine).toBeTruthy();
      expect(fifoLine?.textContent).toContain('866.00');

      const belowRows = el.querySelectorAll('.dom-row.below-breakeven');
      expect(belowRows.length).toBeGreaterThan(0);
      expect(Array.from(belowRows).some((row) => row.textContent?.includes('864.00'))).toBe(true);

      const ladderText = el.querySelector('app-microstructure-orderbook-ladder')?.textContent ?? '';
      expect(ladderText).toContain('TRUSTED');
      expect(ladderText).toContain('VERIFIED');
      expect(ladderText).toContain('BLOCKED');
    });

    it('emits hoverWhatIf on row hover/focus without overwriting desk, and clears on mouseleave', () => {
      const hoverSpy = vi.fn();
      const deskSpy = vi.fn();
      component.hoverWhatIf.subscribe(hoverSpy);
      component.applyToDesk.subscribe(deskSpy);

      const firstRow = fixture.nativeElement.querySelector('.dom-row') as HTMLElement | null;
      expect(firstRow).toBeTruthy();

      firstRow?.dispatchEvent(new Event('mouseenter'));
      fixture.detectChanges();

      expect(hoverSpy).toHaveBeenCalled();
      const preview = hoverSpy.mock.calls.at(-1)?.[0] as MicrostructureWhatIfPreview | null;
      expect(preview).not.toBeNull();
      expect(preview?.price).toBeGreaterThan(0);
      expect(deskSpy).not.toHaveBeenCalled();

      firstRow?.dispatchEvent(new Event('mouseleave'));
      fixture.detectChanges();
      expect(hoverSpy.mock.calls.at(-1)?.[0]).toBeNull();
    });

    it('displays inline SUDEBAN quota % on bank pills and shows >85% saturation rotation suggestion', () => {
      treasurySummarySig.set({
        totalBalanceVes: 300_000,
        totalSpentTodayVes: 112_000,
        totalReceivedTodayVes: 0,
        totalSpentThisMonthVes: 112_000,
        accountsUsage: [
          makeAccountUsage('BANESCO', 'Banesco Transferencia', 92),
          makeAccountUsage('MERCANTIL', 'Mercantil Transferencia', 24),
          makeAccountUsage('BDV', 'BDV Transferencia', 14),
        ],
        nearLimitCount: 1,
        overLimitCount: 0,
        nearMonthlyLimitCount: 0,
        overMonthlyLimitCount: 0,
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('92%');

      const warningBanner = el.querySelector('[data-testid="sudeban-rotation-warning"]');
      expect(warningBanner).toBeTruthy();
      expect(warningBanner?.textContent).toContain('BDV');

      const rotateBtn = el.querySelector('[data-testid="sudeban-rotate-btn"]') as HTMLButtonElement | null;
      expect(rotateBtn).toBeTruthy();
      rotateBtn?.click();
      fixture.detectChanges();

      expect(setBankFilterSpy).toHaveBeenCalledWith('BDV');
    });
  });

  describe('OTC Whale Notional & Audit Table Hygiene (S2, S3)', () => {
    it('uses real refRate for OTC whale alerts and never renders escaped \\$ literal', () => {
      depthSig.set(
        makeDepth(
          [
            makeOffer({ advNo: 'B1', price: 850, maxVes: 850_000 }),
            makeOffer({ advNo: 'B_NOT_WHALE', price: 851, maxVes: 8_500_000 }),
            makeOffer({ advNo: 'B_REAL_WHALE', price: 852, maxVes: 120_000_000, merchantName: 'Caracas_Whale_OTC' }),
          ],
          [makeOffer({ advNo: 'S1', price: 868, maxVes: 868_000 })],
          '2026-11-18T14:01:00.000Z',
        ),
      );
      engine.selectedSide.set('BUY');
      fixture.detectChanges();

      const html = fixture.nativeElement.innerHTML as string;
      const text = fixture.nativeElement.textContent as string;
      expect(html).not.toContain('\\$');
      expect(text).not.toContain('\\$');
      expect(engine.otcWhaleReport().whaleDetected).toBe(true);
      expect(engine.otcWhaleReport().totalWhaleVolumeUsd).toBeGreaterThan(100_000);
      expect(engine.otcWhaleReport().totalWhaleVolumeUsd).toBeLessThan(200_000);
    });

    it('toggles collapsible Auditoría Forense & Ballenas OTC table and filters by category', () => {
      const el = fixture.nativeElement as HTMLElement;
      const toggleBtn = el.querySelector('[data-testid="audit-collapse-btn"]') as HTMLButtonElement | null;
      expect(toggleBtn).toBeTruthy();
      expect(toggleBtn?.getAttribute('aria-expanded')).toBe('false');

      toggleBtn?.click();
      fixture.detectChanges();
      expect(toggleBtn?.getAttribute('aria-expanded')).toBe('true');
      expect(el.querySelectorAll('app-microstructure-audit-table tbody tr').length).toBeGreaterThan(0);
    });
  });

  describe('Staleness Lock & Action Emitters (S1, S3, S4)', () => {
    it('disables and guards blind 1-click auto-apply buttons when freshnessStatus is STALE or OFFLINE', () => {
      const deskSpy = vi.fn();
      const repricerSpy = vi.fn();
      const adSpy = vi.fn();
      const priceSpy = vi.fn();

      component.applyToDesk.subscribe(deskSpy);
      component.sendToRepricer.subscribe(repricerSpy);
      component.openAdStudio.subscribe(adSpy);
      component.applyPrice.subscribe(priceSpy);

      freshnessSig.set('STALE');
      fixture.detectChanges();

      expect(component.isExecutionLocked()).toBe(true);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="staleness-lock-banner"]')).toBeTruthy();

      const applyDeskBtn = el.querySelector('[data-testid="btn-apply-desk"]') as HTMLButtonElement | null;
      const repricerBtn = el.querySelector('[data-testid="btn-send-repricer"]') as HTMLButtonElement | null;
      const adBtn = el.querySelector('[data-testid="btn-open-ad-studio"]') as HTMLButtonElement | null;
      const fixBtn = el.querySelector('[data-testid="btn-fix-row"]') as HTMLButtonElement | null;

      expect(applyDeskBtn?.disabled).toBe(true);
      expect(repricerBtn?.disabled).toBe(true);
      expect(adBtn?.disabled).toBe(true);
      expect(fixBtn?.disabled).toBe(true);

      component.onApplyToDesk();
      component.onSendToRepricer();
      component.onOpenAdStudio();
      TestBed.inject(HotkeysService).trigger('APPLY_MAKER_OPTIMAL');

      expect(deskSpy).not.toHaveBeenCalled();
      expect(repricerSpy).not.toHaveBeenCalled();
      expect(adSpy).not.toHaveBeenCalled();
      expect(priceSpy).not.toHaveBeenCalled();

      freshnessSig.set('OFFLINE');
      fixture.detectChanges();
      expect(component.isExecutionLocked()).toBe(true);
    });

    it('emits applyToDesk, sendToRepricer, openAdStudio, sendTelegramAlert, applyPrice, and togglePinnedDrawer cleanly when LIVE', () => {
      const deskPayloads: MicrostructureDeskPayload[] = [];
      const repricerPayloads: MicrostructureRepricerPayload[] = [];
      const adPayloads: MicrostructureDeskPayload[] = [];
      const telegramPayloads: MicrostructureTelegramPayload[] = [];
      const pricePayloads: MicrostructureApplyPriceEvent[] = [];
      const drawerSpy = vi.fn();

      component.applyToDesk.subscribe((p) => deskPayloads.push(p));
      component.sendToRepricer.subscribe((p) => repricerPayloads.push(p));
      component.openAdStudio.subscribe((p) => adPayloads.push(p));
      component.sendTelegramAlert.subscribe((p) => telegramPayloads.push(p));
      component.applyPrice.subscribe((p) => pricePayloads.push(p));
      component.togglePinnedDrawer.subscribe(drawerSpy);

      const el = fixture.nativeElement as HTMLElement;
      (el.querySelector('[data-testid="btn-apply-desk"]') as HTMLButtonElement)?.click();
      (el.querySelector('[data-testid="btn-send-repricer"]') as HTMLButtonElement)?.click();
      (el.querySelector('[data-testid="btn-open-ad-studio"]') as HTMLButtonElement)?.click();
      (el.querySelector('[data-testid="btn-send-telegram"]') as HTMLButtonElement)?.click();
      (el.querySelector('[data-testid="btn-fix-row"]') as HTMLButtonElement)?.click();
      (el.querySelector('[data-testid="btn-toggle-drawer"]') as HTMLButtonElement)?.click();
      fixture.detectChanges();

      expect(deskPayloads.length).toBe(1);
      expect(deskPayloads[0].customPriceVes).toBeGreaterThan(0);
      expect(repricerPayloads.length).toBe(1);
      expect(repricerPayloads[0].strategy).toBe('TOP_1');
      expect(adPayloads.length).toBe(1);
      expect(telegramPayloads.length).toBe(1);
      expect(telegramPayloads[0].bankFilter).toBe('BANESCO');
      expect(pricePayloads.length).toBe(1);
      expect(pricePayloads[0].price).toBeGreaterThan(0);
      expect(drawerSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility, Quick Ticket & Multimodal Chart Tabs (S1, S3)', () => {
    it('updates targetUsdt via quick ticket presets and switches multimodal chart tabs accessibly', () => {
      const el = fixture.nativeElement as HTMLElement;
      const ticket1k = el.querySelector('[data-testid="ticket-preset-1000"]') as HTMLButtonElement | null;
      expect(ticket1k).toBeTruthy();
      ticket1k?.click();
      fixture.detectChanges();
      expect(engine.targetUsdt()).toBe(1000);

      const tabs = el.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(3);
      expect(tabs[0].getAttribute('aria-selected')).toBe('true');

      (tabs[1] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(tabs[1].getAttribute('aria-selected')).toBe('true');
      expect(el.querySelector('[data-testid="chart-slippage-view"]')).toBeTruthy();

      (tabs[2] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(tabs[2].getAttribute('aria-selected')).toBe('true');
      expect(el.querySelector('[data-testid="chart-pulse-view"]')).toBeTruthy();
    });

    it('filters DOM ladder with Verificados PRO toggle, handles hotkeys L/1/2/3/M/T, and triggers selective audio only on transitions', () => {
      const deskPayloads: MicrostructureDeskPayload[] = [];
      const pricePayloads: MicrostructureApplyPriceEvent[] = [];
      component.applyToDesk.subscribe((p) => deskPayloads.push(p));
      component.applyPrice.subscribe((p) => pricePayloads.push(p));

      // Initial mount must NOT fire selective audio warnings
      expect(playSudebanWarningToneSpy).not.toHaveBeenCalled();

      // Numeric ticket input updates targetUsdt
      const ticketInput = fixture.nativeElement.querySelector('#micro-ticket-input') as HTMLInputElement;
      ticketInput.value = '1500';
      ticketInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(engine.targetUsdt()).toBe(1500);

      // Verificados PRO toggle excludes BLOCKED ('Estafador_Reportado') and low-rep ('SmallUser')
      const proBtn = Array.from(fixture.nativeElement.querySelectorAll('.toggle-chip')).find((b) =>
        (b as HTMLElement).textContent?.includes('Verificados PRO'),
      ) as HTMLButtonElement;
      proBtn.click();
      fixture.detectChanges();
      const ladderText =
        fixture.nativeElement.querySelector('app-microstructure-orderbook-ladder')?.textContent ?? '';
      expect(ladderText).not.toContain('Estafador_Reportado');
      expect(ladderText).not.toContain('SmallUser');
      expect(ladderText).toContain('CriptoVzla_VIP');

      // Hotkeys L, 1, 2, 3, M, T
      const hotkeys = TestBed.inject(HotkeysService);
      expect(engine.cleanModeEnabled()).toBe(true);
      hotkeys.trigger('TOGGLE_CLEAN_MODE');
      expect(engine.cleanModeEnabled()).toBe(false);
      hotkeys.trigger('BRACKET_1');
      expect(engine.selectedBracket()).toBe('INFRAMUNDO');
      hotkeys.trigger('BRACKET_2');
      expect(engine.selectedBracket()).toBe('MEDIO');
      hotkeys.trigger('BRACKET_3');
      expect(engine.selectedBracket()).toBe('INSTITUCIONAL');

      hotkeys.trigger('APPLY_MAKER_OPTIMAL');
      hotkeys.trigger('APPLY_TAKER_VWAP');
      expect(deskPayloads.length).toBe(2);
      expect(pricePayloads.length).toBe(2);

      // Selective audio fires SUDEBAN tone on transition above 85%
      treasurySummarySig.set({
        ...treasurySummarySig(),
        accountsUsage: [
          makeAccountUsage('BANESCO', 'Banesco Transferencia', 90),
          makeAccountUsage('MERCANTIL', 'Mercantil Transferencia', 20),
        ],
      });
      fixture.detectChanges();
      expect(playSudebanWarningToneSpy).toHaveBeenCalledTimes(1);

      // Mute toggle delegates cleanly to AudioAlertsService
      const audioBtn = Array.from(fixture.nativeElement.querySelectorAll('.toggle-chip')).find((b) =>
        (b as HTMLElement).textContent?.includes('Audio'),
      ) as HTMLButtonElement;
      audioBtn.click();
      expect(toggleMuteSpy).toHaveBeenCalledTimes(1);
    });
  });
});
