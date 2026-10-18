import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  OnDestroy,
  signal,
} from '@angular/core';
import {
  computeSpread,
  calculateBreakEven,
  clampMoney as sharedClampMoney,
  buildPortfolioAllocationPlan,
  evaluateGoldenSpread,
  type AmountUnit,
  type SpreadResult,
  type BreakEvenResult,
  type P2PRole,
  type AccountVelocityStatus,
  type PortfolioAllocationPlan,
  type GoldenSpreadCheck,
  type BankCode,
  buildJohnsonMarketQuality,
  DEFAULT_JOHNSON_REQUIREMENTS,
  type JohnsonMarketQuality,
  type JohnsonBankProfit,
  computeHighDemandScan,
  type HighDemandScanResult,
  type MakerMerchantLevel,
  CAPITAL_BRACKETS,
  filterOffersByBracket,
  type BracketId,
  evaluateSnipingOpportunity,
  type SnipedOpportunityAlert,
  type BinanceOfferSummary,
  computeFifoAccounting,
  OPS_KEY,
  type Operation,
} from '@p2p/core';
import { RisksService } from '../../core/rules';
import { StorageService } from '../../core/storage';
import { ToastService } from '../../core/toast.service';
import { FORMAT_PIPES } from '../../core/format';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

import { Router } from '@angular/router';
import { TradeTimerService, type TradePreset } from '../../core/trade-timer.service';
import { DatePipe } from '@angular/common';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { BybitP2pService } from '../../core/bybit-p2p.service';
import { BinanceRepricerService } from '../../core/binance-repricer.service';
import { McpAdPublisherService } from '../../core/mcp-ad-publisher.service';
import { AdComposerService } from '../../core/ad-composer.service';
import { HotkeysService } from '../../core/hotkeys.service';
import { AccountsService } from '../../core/accounts.service';
import { MarketHistoryService } from '../../core/market-history.service';
import { AudioAlertsService } from '../../core/audio-alerts.service';
import { SpreadQualityService } from '../../core/spread-quality.service';
import {
  CotizaveService,
  describeCotizaveProvenance,
  formatCotizaveDataAge,
} from '../../core/cotizave.service';
import { McpService } from '../../core/mcp.service';
import { SpotMarketService } from '../../core/spot-market.service';
import { CrossExchangeMatrix } from './components/cross-exchange-matrix.component';
import { MicrostructureShield } from './components/microstructure-shield.component';
import {
  buildTriangulationRow,
  computeExecutableGaps,
  resolveBybitBook,
  type LiveBookLeg,
  type TriangulationGaps,
  type TriangulationRow,
  type VenueBooks,
} from './executable-gaps';

interface TradingWindow {
  id: string;
  label: string;
  dayRange: string;
  timeWindow: string;
  type: 'BUY' | 'SELL';
  rationale: string;
}

/**
 * C1 — Spread monitor. Thin view over {@link computeSpread}: user-entered prices/amount
 * feed pure core math; the favorable/unfavorable banner comes from the live risk-rules config.
 * Supports USDT/VES and EUR/VES pairs and fires a notification when the verdict flips to Favorable.
 */
@Component({
  selector: 'app-spread-monitor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ...FORMAT_PIPES, CrossExchangeMatrix, MicrostructureShield],
  templateUrl: './spread-monitor.html',
  styleUrl: './spread-monitor.scss',
})
export class SpreadMonitor implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly timer = inject(TradeTimerService);
  private readonly risks = inject(RisksService);
  private readonly storage = inject(StorageService);
  readonly toast = inject(ToastService);
  private readonly hotkeys = inject(HotkeysService);
  readonly binance = inject(BinanceP2pService);
  readonly bybit = inject(BybitP2pService);
  readonly repricer = inject(BinanceRepricerService);
  readonly accountsService = inject(AccountsService);
  readonly marketHistory = inject(MarketHistoryService);
  readonly audioAlerts = inject(AudioAlertsService);
  readonly spreadQuality = inject(SpreadQualityService);
  readonly cotizave = inject(CotizaveService);
  readonly mcp = inject(McpService);
  readonly mcpPublisher = inject(McpAdPublisherService);
  readonly adComposer = inject(AdComposerService);
  readonly spotMarket = inject(SpotMarketService);
  protected readonly Math = Math;

  private mcpSyncTimerId: number | null = null;
  readonly mcpSyncing = signal<boolean>(false);
  readonly mcpLastSynced = signal<Date | null>(null);
  readonly analyticsSubTab = signal<'microstructure' | 'triangulation' | 'treasury'>(
    'microstructure',
  );
  readonly selectedAutofillMargin = signal<number>(1.2);
  readonly mcpConsoleExpanded = signal<boolean>(false);

  toggleMcpConsole(): void {
    this.mcpConsoleExpanded.update((v) => !v);
  }

  toggleMcpPublisher(): void {
    if (this.mcpPublisher.isEnabled()) {
      this.mcpPublisher.disablePublishing();
    } else {
      this.mcpPublisher.enablePublishing({
        dryRun: this.mcpPublisher.isDryRun(),
        maxDeviationPct: this.mcpPublisher.maxDeviationPct(),
        buyAdId: this.mcpPublisher.buyAdId(),
        sellAdId: this.mcpPublisher.sellAdId(),
      });
    }
  }

  async copyDraftClipboard(): Promise<void> {
    const text = this.adComposer.getClipboardSummary();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('Resumen de anuncio copiado al portapapeles.', 'Anuncio P2P');
    } catch {
      this.toast.info('No se pudo acceder al portapapeles.', 'Anuncio P2P');
    }
  }

  /** MCP Tool: detect_usdt_depeg state */
  readonly mcpDepeg = signal<{
    spotUsdtPrice: number | null;
    parityDeviationPct: number | null;
    isDepegged: boolean;
    riskSeverity: string;
    status: string;
    note?: string;
  }>({
    spotUsdtPrice: null,
    parityDeviationPct: null,
    isDepegged: false,
    riskSeverity: 'UNKNOWN',
    status: 'NO_DATA',
    note: 'Feed Binance Spot no sincronizado',
  });

  /** MCP Tool: analyze_orderbook_pressure state */
  readonly mcpPressure = signal<{
    orderbookImbalanceRatio: number;
    dominantSide: string;
    pressureVelocity: string;
    actionableInsight: string;
    marketRegime: string;
  }>({
    orderbookImbalanceRatio: 0.52,
    dominantSide: 'BALANCED',
    pressureVelocity: 'NEUTRAL',
    actionableInsight: 'Libro de órdenes equilibrado.',
    marketRegime: 'BALANCED_LIQUIDITY',
  });

  /** MCP Tool: recommend_competitive_pricing state */
  readonly mcpPricingRecommendation = signal<{
    buySuggested: number;
    sellSuggested: number;
    marginVes: number;
    advice: string;
  } | null>(null);

  /** MCP Tool: calculate_spread formal calculation & Golden Spread badge */
  readonly mcpSpreadVerdict = computed(() => {
    const buy = this.buyPrice();
    const sell = this.sellPrice();
    const drag = this.effectiveFeeDragPct();
    if (buy <= 0 || sell <= 0) return null;
    const unitSpread = sell - buy;
    const totalFeeRate = drag / 100;
    const spread = computeSpread(buy, sell, 100, 'USDT', totalFeeRate);
    const netSpreadPercent = (spread.netGainVes / (buy * 100)) * 100;
    const isGolden = netSpreadPercent >= 0.5;
    return {
      unitSpread: Number(unitSpread.toFixed(4)),
      netGainVes: Number(spread.netGainVes.toFixed(2)),
      netSpreadPercent: Number(netSpreadPercent.toFixed(2)),
      isGoldenSpread: isGolden,
      recommendation: isGolden ? 'VIABLE_INSTITUCIONAL' : 'SPREAD_SUB_OPTIMAL',
    };
  });

  readonly triangulationThresholdVes = signal<number>(2);

  /** Per-account velocity status lookup for the treasury card semáforo chips. */
  readonly velocityByAccount = computed<ReadonlyMap<string, AccountVelocityStatus>>(() => {
    const map = new Map<string, AccountVelocityStatus>();
    for (const v of this.accountsService.accountVelocities()) {
      map.set(v.accountId, v);
    }
    return map;
  });

  /**
   * Veredicto de la pata de Bybit: libro real o motivo por el que no lo hay.
   *
   * Se resuelve desde las OFERTAS (`bestSellOffer`/`bestBuyOffer`) y no desde
   * `buyPrice`/`sellPrice`, que arrancan en 808.5 / 813.0 como constantes de
   * demo. Con los defaults como entrada, una brecha "en vivo" saldría de un
   * número que nadie cotizó. Ver `resolveBybitBook`.
   */
  readonly bybitBook = computed(() =>
    resolveBybitBook({
      mode: this.bybit.mode(),
      bestSellOffer: this.bybit.bestSellOffer(),
      bestBuyOffer: this.bybit.bestBuyOffer(),
      lastFetched: this.bybit.lastFetched(),
    }),
  );

  /**
   * Los dos únicos libros de órdenes de la app, ya traducidos a "pago" /
   * "recibo". Cualquiera de los dos puede faltar, y en ese caso no hay brecha.
   */
  private readonly venueBooks = computed<VenueBooks>(() => {
    const depth = this.binance.marketDepth();
    const binance: LiveBookLeg | null =
      depth && depth.bestBuyPrice > 0 && depth.bestSellPrice > 0
        ? { payPrice: depth.bestBuyPrice, receivePrice: depth.bestSellPrice }
        : null;
    return { binance, bybit: this.bybitBook().leg };
  });

  /** Por qué la fila de Bybit no tiene brecha, cuando no la tiene. Nunca vacía. */
  readonly executableGapReason = computed<string>(() => {
    const bybitReason = this.bybitBook().reason;
    if (this.venueBooks().binance) return bybitReason;
    return (
      'Binance no tiene libro de órdenes en vivo, así que no hay dos puntas que cruzar. ' +
      bybitReason
    );
  });

  /** El libro de Binance, que es la otra pata de toda brecha ejecutable. */
  readonly binanceBook = computed<LiveBookLeg | null>(() => this.venueBooks().binance);

  /**
   * Brecha por mercado. Solo Binance ↔ Bybit puede tener una, y solo con los dos
   * libros reales: el resto de los venues son un `mid` de Cotizave y salen como
   * anclas indicativas, sin número de brecha. El detalle de por qué está en
   * `executable-gaps.ts`.
   *
   * Cada fila lleva `provenance`, `dataAge` y `fetchedAt` porque las tasas vienen
   * de `ratesByMarket()` y ese objeto no dice de dónde salió: la única marca de
   * tiempo que venía por fila era `rate.updated_at`, que es el sello del upstream
   * POR TASA (y viene `undefined` cuando Cotizave lo omite), no la edad del
   * fetch. Son dos cosas distintas: un fetch de hace una hora puede traer tasas
   * "actualizadas" al segundo, y al revés. La edad del fetch es la que decide si
   * la brecha sirve para operar hoy.
   *
   * La tabla ya NO se vacía cuando falta el libro de Binance: las anclas y las
   * tasas de referencia siguen siendo información real aunque no haya con quién
   * cruzarlas.
   */
  readonly triangulationData = computed<TriangulationRow[]>(() => {
    const rates = this.cotizave.ratesByMarket();
    if (Object.keys(rates).length === 0) return [];

    const provenance = this.cotizave.ratesProvenance();
    const fetchedAt = this.cotizave.lastFetched();
    const books = this.venueBooks();
    const gapReason = this.executableGapReason();
    const lineage = {
      provenance,
      fetchedAt,
      dataAge: formatCotizaveDataAge(fetchedAt),
    };

    return Object.entries(rates)
      // `binance` no es un venue a comparar: es el libro contra el que se mide
      // todo lo demás, y se muestra arriba de la tabla con su propia etiqueta.
      .filter(([market]) => market !== 'binance')
      .map(([market, rate]) => buildTriangulationRow(market, rate, books, gapReason, lineage));
  });

  /** Las dos brechas ejecutables del par, o `null` si no se pueden medir. */
  readonly executableGaps = computed<{
    gapForward: TriangulationGaps;
    gapReverse: TriangulationGaps;
  }>(() => computeExecutableGaps(this.venueBooks()));

  /**
   * Linaje del fetch de Cotizave que hay detrás de la tabla de triangulación.
   * Sale de la primera fila porque todas las filas comparten el mismo fetch: el
   * linaje es del dato, no del mercado.
   */
  readonly triangulationLineage = computed(() => {
    const rows = this.triangulationData();
    if (rows.length === 0) return null;
    const { provenance, dataAge } = rows[0];
    return { provenance, dataAge, label: describeCotizaveProvenance(provenance) };
  });

  readonly triangulationAlert = computed(() => {
    const data = this.triangulationData();
    const thr = this.triangulationThresholdVes();
    let best: { market: string; gapVes: number } | null = null;

    for (const row of data) {
      // Segunda red además de los gaps nulos: una ancla de Cotizave o una tasa
      // de referencia no encienden la señal de oportunidad ni aunque un bug
      // futuro les fabricara un número. Solo hay dos libros reales detrás.
      if (row.kind !== 'executable') continue;
      if (row.gapForward.gapVes != null && row.gapForward.gapVes >= thr) {
        if (!best || row.gapForward.gapVes > best.gapVes) {
          best = { market: row.market, gapVes: row.gapForward.gapVes };
        }
      }
      if (row.gapReverse.gapVes != null && row.gapReverse.gapVes >= thr) {
        if (!best || row.gapReverse.gapVes > best.gapVes) {
          best = { market: row.market, gapVes: row.gapReverse.gapVes };
        }
      }
    }

    return { hasAlert: best !== null, best };
  });

  selectBank(bankKey: string): void {
    this.binance.setBankFilter(bankKey);
    void this.binance.fetchMarketDepth(this.pair(), 'VES');
    void this.syncMcpIntelligence();
  }

  private readonly nf = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  /** Active mode: standard arbitrage scanner, break-even & maker ad pricing, repricer bot, cross-exchange, microstructure, or high-demand radar */
  readonly activeMode = signal<
    'spread' | 'breakeven' | 'repricer' | 'cross_exchange' | 'microstructure' | 'high_demand'
  >('spread');

  readonly buyPrice = signal<number>(800);
  readonly sellPrice = signal<number>(820);
  readonly amount = signal<number>(25);
  /** trading pair: USDT/VES or EUR/VES. */
  readonly pair = signal<'USDT' | 'EUR'>('USDT');
  readonly unit = signal<AmountUnit>('USDT');
  /** seller commission as a percentage (0..0.35). */
  readonly commissionPct = signal<number>(0);
  /** favorable-spread threshold (VES per base unit). */
  readonly threshold = signal<number>(15);
  /** role deployed on the buy leg: MAKER pays fee, TAKER is free. */
  readonly buyRole = signal<P2PRole>('TAKER');
  /** role deployed on the sell leg: MAKER pays fee, TAKER is free. */
  readonly sellRole = signal<P2PRole>('TAKER');
  /** minimum net spread (%) required to operate (guard threshold). */
  readonly minSpreadGuardPct = signal<number>(0.6);
  /** Market spread (%) above which the live P2P opportunity alert fires. */
  readonly spreadAlertPct = signal<number>(1.2);

  /** Cooldown (ms) per alert signal key so a toast for the same signal never spams. */
  private readonly alertCooldownMs = 60_000;
  private readonly alertLastAt = new Map<string, number>();
  private prevFavorableKind: 'favorable' | 'unfavorable' | null = null;
  private prevSellBelowBreakEven = false;

  /** Selected merchant level for Maker fee calculation and high demand radar */
  readonly selectedMerchantLevel = signal<MakerMerchantLevel>('STANDARD');

  /** Per-leg Maker fee percentage according to the selected Merchant VIP level. */
  readonly makerFeePerLegPct = computed<number>(() => {
    switch (this.selectedMerchantLevel()) {
      case 'GOLD':
        return 0.125;
      case 'SILVER':
        return 0.175;
      case 'BRONZE':
        return 0.2;
      case 'STANDARD':
      default:
        return 0.25;
    }
  });

  /** Effective fee drag on the spread footprint from MAKER legs according to VIP level. */
  readonly effectiveFeeDragPct = computed<number>(() => {
    const makers = (this.buyRole() === 'MAKER' ? 1 : 0) + (this.sellRole() === 'MAKER' ? 1 : 0);
    return Number((makers * this.makerFeePerLegPct()).toFixed(3));
  });

  /** Unified total friction percentage (manual commissionPct + role-based Maker fee drag). */
  readonly totalEffectiveCommissionPct = computed<number>(() =>
    Number((this.commissionPct() + this.effectiveFeeDragPct()).toFixed(4)),
  );

  /** Clean Mode Anti-Trap filter toggle (purges <92% finish rate, <30 orders, <$20 dust). */
  readonly cleanModeEnabled = signal<boolean>(true);

  /** Capital bracket filter for segmenting the live P2P orderbook. */
  readonly selectedBracket = signal<'ALL' | BracketId>('ALL');

  readonly bracketOptions: readonly { id: 'ALL' | BracketId; label: string; sub: string }[] = [
    { id: 'ALL', label: 'Todo el Libro', sub: 'Sin filtro de tramo' },
    {
      id: 'INFRAMUNDO',
      label: 'Inframundo',
      sub: `${CAPITAL_BRACKETS.INFRAMUNDO.minVes.toLocaleString('es-VE')}–${CAPITAL_BRACKETS.INFRAMUNDO.maxVes.toLocaleString('es-VE')} Bs`,
    },
    {
      id: 'MEDIO',
      label: 'Tramo Medio',
      sub: `${CAPITAL_BRACKETS.MEDIO.minVes.toLocaleString('es-VE')}–${CAPITAL_BRACKETS.MEDIO.maxVes.toLocaleString('es-VE')} Bs`,
    },
    {
      id: 'INSTITUCIONAL',
      label: 'Institucional',
      sub: `${CAPITAL_BRACKETS.INSTITUCIONAL.minVes.toLocaleString('es-VE')}+ Bs`,
    },
  ];

  /** Live filtered orderbook combining Clean Mode Anti-Trap rules and Capital Bracket Scanner. */
  readonly filteredOrderbook = computed(() => {
    const depth = this.binance.marketDepth();
    if (!depth) {
      return {
        buyOffers: [] as BinanceOfferSummary[],
        sellOffers: [] as BinanceOfferSummary[],
        purgedCount: 0,
        effectiveBestBuy: 0,
        effectiveBestSell: 0,
        effectiveSpreadVes: 0,
        effectiveSpreadPct: 0,
        vwapBuy5: 0,
        vwapSell5: 0,
      };
    }

    const rawBuy = depth.buyOffers ?? [];
    const rawSell = depth.sellOffers ?? [];
    const cleanOn = this.cleanModeEnabled();
    const bracket = this.selectedBracket();
    const refRate = depth.bestBuyPrice > 0 ? depth.bestBuyPrice : this.buyPrice() || 800;

    let purgedCount = 0;

    const passCleanMode = (o: BinanceOfferSummary): boolean => {
      if (!cleanOn) return true;
      const name = (o.merchantName ?? '').toLowerCase();
      if (name.includes('promoted') || name.includes('patrocinado')) {
        purgedCount++;
        return false;
      }
      if (o.finishRatePct > 0 && o.finishRatePct < 92) {
        purgedCount++;
        return false;
      }
      if (o.orderCount > 0 && o.orderCount < 30) {
        purgedCount++;
        return false;
      }
      const minCapacityVes = 20 * (o.price > 0 ? o.price : refRate);
      if (o.maxVes > 0 && o.maxVes < minCapacityVes) {
        purgedCount++;
        return false;
      }
      return true;
    };

    let cleanBuys = rawBuy.filter(passCleanMode);
    let cleanSells = rawSell.filter(passCleanMode);

    if (bracket !== 'ALL') {
      const bBuy = filterOffersByBracket(cleanBuys, bracket, { exchangeRateVesPerUsd: refRate });
      const bSell = filterOffersByBracket(cleanSells, bracket, { exchangeRateVesPerUsd: refRate });
      purgedCount += bBuy.purgedDustCount + bBuy.purgedPromotedCount + bSell.purgedDustCount + bSell.purgedPromotedCount;
      cleanBuys = bBuy.offers;
      cleanSells = bSell.offers;
    }

    const top5Buys = cleanBuys.slice(0, 5);
    const top5Sells = cleanSells.slice(0, 5);

    const calcVwap = (list: BinanceOfferSummary[], fallback: number): number => {
      if (list.length === 0) return fallback;
      let weightedSum = 0;
      let totalWeight = 0;
      for (const item of list) {
        const w = item.maxVes > 0 ? item.maxVes : 1;
        weightedSum += item.price * w;
        totalWeight += w;
      }
      return totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(2)) : fallback;
    };

    const effectiveBestBuy = top5Buys[0]?.price ?? depth.bestBuyPrice ?? 0;
    const effectiveBestSell = top5Sells[0]?.price ?? depth.bestSellPrice ?? 0;
    const effectiveSpreadVes =
      effectiveBestBuy > 0 && effectiveBestSell > 0
        ? Number((effectiveBestSell - effectiveBestBuy).toFixed(2))
        : depth.spreadVes;
    const effectiveSpreadPct =
      effectiveBestBuy > 0 && effectiveBestSell > 0
        ? Number((((effectiveBestSell - effectiveBestBuy) / effectiveBestBuy) * 100).toFixed(2))
        : depth.spreadPct;

    return {
      buyOffers: top5Buys,
      sellOffers: top5Sells,
      purgedCount,
      effectiveBestBuy,
      effectiveBestSell,
      effectiveSpreadVes,
      effectiveSpreadPct,
      vwapBuy5: calcVwap(top5Buys, effectiveBestBuy),
      vwapSell5: calcVwap(top5Sells, effectiveBestSell),
    };
  });

  /** Live Orderbook Sniper scanning for fat-finger or distressed liquidity dislocations. */
  readonly snipedAlerts = computed<SnipedOpportunityAlert[]>(() => {
    const depth = this.binance.marketDepth();
    if (!depth) return [];
    const ob = this.filteredOrderbook();
    const fairBuy = ob.vwapBuy5 > 0 ? ob.vwapBuy5 : depth.bestBuyPrice;
    const fairSell = ob.vwapSell5 > 0 ? ob.vwapSell5 : depth.bestSellPrice;
    const alerts: SnipedOpportunityAlert[] = [];

    for (const offer of (depth.buyOffers ?? []).slice(0, 8)) {
      const capUsdt = offer.maxVes > 0 && offer.price > 0 ? offer.maxVes / offer.price : 100;
      const alert = evaluateSnipingOpportunity(
        {
          advId: offer.advNo,
          merchantName: offer.merchantName,
          orderType: 'SELL',
          price: offer.price,
          availableAmountCrypto: capUsdt,
          minLimitFiat: offer.minVes,
          maxLimitFiat: offer.maxVes,
          paymentMethods: offer.payMethods,
        },
        {
          fairMarketPrice: fairBuy,
          minProfitThresholdPct: 0.85,
          maxTakerFeePct: 0,
          minLiquidityFloorUsd: 30,
        },
      );
      if (alert) alerts.push(alert);
    }

    for (const offer of (depth.sellOffers ?? []).slice(0, 8)) {
      const capUsdt = offer.maxVes > 0 && offer.price > 0 ? offer.maxVes / offer.price : 100;
      const alert = evaluateSnipingOpportunity(
        {
          advId: offer.advNo,
          merchantName: offer.merchantName,
          orderType: 'BUY',
          price: offer.price,
          availableAmountCrypto: capUsdt,
          minLimitFiat: offer.minVes,
          maxLimitFiat: offer.maxVes,
          paymentMethods: offer.payMethods,
        },
        {
          fairMarketPrice: fairSell,
          minProfitThresholdPct: 0.85,
          maxTakerFeePct: 0,
          minLiquidityFloorUsd: 30,
        },
      );
      if (alert) alerts.push(alert);
    }

    return alerts.slice(0, 3);
  });

  /** 1-Click Tactical Positioning controls beneath Buy and Sell price inputs. */
  applyTacticalPrice(side: 'BUY' | 'SELL', mode: 'TOP1_BEAT' | 'TOP1_MATCH' | 'VWAP5'): void {
    const ob = this.filteredOrderbook();
    if (side === 'BUY') {
      const base = ob.effectiveBestBuy > 0 ? ob.effectiveBestBuy : this.buyPrice();
      if (base <= 0) return;
      if (mode === 'TOP1_BEAT') {
        const next = Number((base + 0.01).toFixed(2));
        this.buyPrice.set(next);
        this.buyRole.set('MAKER');
        this.toast.success(`Compra posicionada +0.01 Bs sobre Top 1 (${next} Bs · Maker).`, 'Táctica Compra');
      } else if (mode === 'TOP1_MATCH') {
        this.buyPrice.set(Number(base.toFixed(2)));
        this.toast.info(`Compra igualada al Top 1 (${base.toFixed(2)} Bs).`, 'Táctica Compra');
      } else {
        const vwap = ob.vwapBuy5 > 0 ? ob.vwapBuy5 : base;
        this.buyPrice.set(vwap);
        this.toast.info(`Compra ajustada a VWAP Top 5 (${vwap.toFixed(2)} Bs).`, 'VWAP Compra');
      }
    } else {
      const base = ob.effectiveBestSell > 0 ? ob.effectiveBestSell : this.sellPrice();
      if (base <= 0) return;
      if (mode === 'TOP1_BEAT') {
        const next = Number(Math.max(0.01, base - 0.01).toFixed(2));
        this.sellPrice.set(next);
        this.sellRole.set('MAKER');
        this.toast.success(`Venta posicionada -0.01 Bs bajo Top 1 (${next} Bs · Maker).`, 'Táctica Venta');
      } else if (mode === 'TOP1_MATCH') {
        this.sellPrice.set(Number(base.toFixed(2)));
        this.toast.info(`Venta igualada al Top 1 (${base.toFixed(2)} Bs).`, 'Táctica Venta');
      } else {
        const vwap = ob.vwapSell5 > 0 ? ob.vwapSell5 : base;
        this.sellPrice.set(vwap);
        this.toast.info(`Venta ajustada a VWAP Top 5 (${vwap.toFixed(2)} Bs).`, 'VWAP Venta');
      }
    }
  }

  /** Load an offer directly from the interactive L2 orderbook into Buy or Sell price. */
  selectOfferFromBook(side: 'BUY' | 'SELL', price: number, beatByCent = false): void {
    if (price <= 0) return;
    if (side === 'BUY') {
      const target = beatByCent ? Number((price + 0.01).toFixed(2)) : Number(price.toFixed(2));
      this.buyPrice.set(target);
      if (beatByCent) this.buyRole.set('MAKER');
      this.toast.success(
        beatByCent
          ? `Compra fijada en ${target} Bs (+0.01 Bs sobre oferta seleccionada).`
          : `Precio de compra cargado desde el libro: ${target} Bs.`,
        'Libro L2',
      );
    } else {
      const target = beatByCent
        ? Number(Math.max(0.01, price - 0.01).toFixed(2))
        : Number(price.toFixed(2));
      this.sellPrice.set(target);
      if (beatByCent) this.sellRole.set('MAKER');
      this.toast.success(
        beatByCent
          ? `Venta fijada en ${target} Bs (-0.01 Bs bajo oferta seleccionada).`
          : `Precio de venta cargado desde el libro: ${target} Bs.`,
        'Libro L2',
      );
    }
  }

  /** Capture a sniped opportunity directly into the calculator. */
  applySnipedAlert(alert: SnipedOpportunityAlert): void {
    if (alert.orderType === 'SELL') {
      this.buyPrice.set(alert.adPrice);
      this.buyRole.set('TAKER');
      this.toast.success(
        `Snipe de compra cargado a ${alert.adPrice} Bs (${alert.merchantName}).`,
        'Sniper P2P',
      );
    } else {
      this.sellPrice.set(alert.adPrice);
      this.sellRole.set('TAKER');
      this.toast.success(
        `Snipe de venta cargado a ${alert.adPrice} Bs (${alert.merchantName}).`,
        'Sniper P2P',
      );
    }
  }

  /** Quick role combination selector (Taker/Taker, Maker/Taker, Taker/Maker, Doble Maker). */
  setRoleCombination(buy: P2PRole, sell: P2PRole): void {
    this.buyRole.set(buy);
    this.sellRole.set(sell);
  }

  /** SQS evaluated with the selected buy/sell roles (backed by the live engine). */
  readonly marketQuality = computed(() =>
    this.spreadQuality.currentMarketQuality(this.buyRole(), this.sellRole())(),
  );

  /** Johnson Market Depth analysis evaluated directly over the live Binance depth. */
  readonly johnsonQuality = computed<JohnsonMarketQuality | null>(() => {
    const depth = this.binance.marketDepth();
    if (!depth || !depth.bestBuyPrice || !depth.bestSellPrice) return null;
    const banks = [
      'BANESCO',
      'MERCANTIL',
      'BDV',
      'BANCAMIGA',
      'PROVINCIAL',
      'BNC',
      'BANCARIBE',
      'BANPLUS',
    ];
    return buildJohnsonMarketQuality(depth, banks, DEFAULT_JOHNSON_REQUIREMENTS, {
      bankCodes: banks,
      buyRole: this.buyRole(),
      sellRole: this.sellRole(),
      isInterbank: false,
    });
  });

  /** Top 3 most profitable banks according to Johnson net gain calculation. */
  readonly top3JohnsonBanks = computed<readonly JohnsonBankProfit[]>(() => {
    const jq = this.johnsonQuality();
    if (!jq || !jq.bankProfits) return [];
    return jq.bankProfits.slice(0, 3);
  });

  /** Trading guard: operar / alerta / no operar per net spread vs threshold. */
  readonly guardStatus = computed<'ok' | 'warn' | 'noop'>(() => {
    const sqs = this.marketQuality();
    if (!sqs) return 'noop';
    const net = sqs.netSpreadPct;
    if (net >= this.minSpreadGuardPct()) return 'ok';
    if (net > 0) return 'warn';
    return 'noop';
  });

  /** High Demand Market Scan evaluated live from Binance orderbook */
  readonly highDemandScan = computed<HighDemandScanResult>(() => {
    const depth = this.binance.marketDepth();
    const bank = this.binance.selectedBank();
    return computeHighDemandScan(depth, {
      merchantLevel: this.selectedMerchantLevel(),
      bankFilter: bank,
      stepVes: 0.01,
      breakEvenSellPrice: this.breakEvenResult().breakEvenPrice,
    });
  });

  readonly guardText = computed<string>(() => {
    const sqs = this.marketQuality();
    if (!sqs) return 'Sin datos de mercado en vivo.';
    const net = sqs.netSpreadPct;
    const thr = this.minSpreadGuardPct();
    const mode = `${this.buyRole()}/${this.sellRole()}`;
    if (net >= thr) {
      return `Spread ${net.toFixed(2)}% ≥ ${thr.toFixed(2)}% — operar en modo ${mode}`;
    }
    if (net > 0) {
      return `Spread ${net.toFixed(2)}% < umbral ${thr.toFixed(2)}% — margen insuficiente (${mode})`;
    }
    return `Spread ${net.toFixed(2)}% negativo — NO operar en modo ${mode}`;
  });

  /** Fixed reference windows for strategic buying/selling (trading calendar). */
  readonly tradingWindows: readonly TradingWindow[] = [
    {
      id: 'lun-mie-buy',
      label: 'Compra estratégica',
      dayRange: 'Lunes a Miércoles',
      timeWindow: '2:00 PM – 4:00 PM',
      type: 'BUY',
      rationale: 'Oferta alta: precios de compra más bajos del día.',
    },
    {
      id: 'jue-vie-sell',
      label: 'Venta estratégica',
      dayRange: 'Jueves a Viernes',
      timeWindow: '8:00 AM – 10:00 AM',
      type: 'SELL',
      rationale: 'Demanda alta: mejores precios de venta.',
    },
    {
      id: 'jueves-pre-quincena',
      label: 'Jueves pre-quincena',
      dayRange: 'Jueves',
      timeWindow: 'Pre-quincena (15 y 30/31)',
      type: 'SELL',
      rationale: 'Demanda elevada por pago de quincena.',
    },
    {
      id: 'finde-brecha',
      label: 'Fin de semana',
      dayRange: 'Sábado y Domingo',
      timeWindow: 'Todo el día',
      type: 'SELL',
      rationale: 'Brecha 25-32% vs tasa BCV: diferencial abultado.',
    },
  ];

  /** Current clock, refreshed every minute to drive the active-window highlight. */
  readonly now = signal<Date>(new Date());
  private nowTimerId: number | null = null;

  /** Id of the trading window that `now` falls into (Lun/Mié 14-16, Jue/Vie 8-10). */
  readonly activeWindowId = computed<string | null>(() => {
    const d = this.now();
    const day = d.getDay();
    const minutes = d.getHours() * 60 + d.getMinutes();
    const monOrWed = day === 1 || day === 3;
    if (monOrWed && minutes >= 14 * 60 && minutes < 16 * 60) return 'lun-mie-buy';
    const thuOrFri = day === 4 || day === 5;
    if (thuOrFri && minutes >= 8 * 60 && minutes < 10 * 60) return 'jue-vie-sell';
    return null;
  });

  async syncMcpIntelligence(): Promise<void> {
    this.mcpSyncing.set(true);
    try {
      // Feed Binance Spot real: si no hay cotización en vivo no se inventa paridad
      const spotTicker = await this.spotMarket.fetchBookTicker('USDCUSDT');
      if (spotTicker && spotTicker.midPrice > 0) {
        const depegRes = await this.mcp.detectUsdtDepeg({
          spotUsdtPrice: spotTicker.midPrice,
          thresholdPct: 0.2,
        });
        if (depegRes.success && depegRes.result) {
          this.mcpDepeg.set(depegRes.result as ReturnType<typeof this.mcpDepeg>);
        }
      } else {
        this.mcpDepeg.set({
          spotUsdtPrice: null,
          parityDeviationPct: null,
          isDepegged: false,
          riskSeverity: 'UNKNOWN',
          status: 'FEED_UNAVAILABLE',
          note: this.spotMarket.availability().reason || 'Libro Binance Spot no disponible',
        });
      }

      const depth = this.binance.marketDepth();
      const bidDepth =
        depth?.buyOffers?.reduce((sum, o) => sum + o.maxVes / (o.price || 1), 0) || 18000;
      const askDepth =
        depth?.sellOffers?.reduce((sum, o) => sum + o.maxVes / (o.price || 1), 0) || 14000;
      const pressureRes = await this.mcp.analyzeOrderbookPressure({
        fiat: this.pair() === 'EUR' ? 'EUR' : 'VES',
        bidDepthUsdt: bidDepth,
        askDepthUsdt: askDepth,
        includeSpoofCheck: true,
      });
      if (pressureRes.success && pressureRes.result) {
        this.mcpPressure.set(pressureRes.result as ReturnType<typeof this.mcpPressure>);
      }

      const bestBuy = depth?.bestBuyPrice || this.buyPrice();
      const bestSell = depth?.bestSellPrice || this.sellPrice();
      const mid = (bestBuy + bestSell) / 2;
      const buyRec = await this.mcp.recommendCompetitivePricing({
        side: 'BUY',
        strategy: 'TOP_1',
        stepVes: 0.05,
        targetMarginPct: this.selectedAutofillMargin(),
        breakEvenPrice: bestBuy * 0.98,
        currentMarketMid: mid,
      });
      const sellRec = await this.mcp.recommendCompetitivePricing({
        side: 'SELL',
        strategy: 'TOP_1',
        stepVes: 0.05,
        targetMarginPct: this.selectedAutofillMargin(),
        breakEvenPrice: bestBuy * 1.005,
        currentMarketMid: mid,
      });

      if (buyRec.success && sellRec.success) {
        const buyData = buyRec.result as { suggestedPrice?: number } | undefined;
        const sellData = sellRec.result as
          { suggestedPrice?: number; marginVes?: number; advice?: string } | undefined;
        this.mcpPricingRecommendation.set({
          buySuggested: buyData?.suggestedPrice ?? bestBuy,
          sellSuggested: sellData?.suggestedPrice ?? bestSell,
          marginVes: sellData?.marginVes ?? 0,
          advice: sellData?.advice ?? '',
        });
      }
      this.mcpLastSynced.set(new Date());
    } catch {
      // Non-blocking
    } finally {
      this.mcpSyncing.set(false);
    }
  }

  applyMcpPrice(side: 'BUY' | 'SELL'): void {
    const rec = this.mcpPricingRecommendation();
    if (!rec) return;
    if (side === 'BUY') {
      this.buyPrice.set(rec.buySuggested);
      this.toast.success(`Precio de compra actualizado a ${rec.buySuggested} VES vía MCP.`);
    } else {
      this.sellPrice.set(rec.sellSuggested);
      this.toast.success(`Precio de venta actualizado a ${rec.sellSuggested} VES vía MCP.`);
    }
  }

  async applyAutofillMargined(side: 'BUY' | 'SELL', marginPct = 1.2): Promise<void> {
    const depth = this.binance.marketDepth();
    const fallback = depth
      ? (depth.bestBuyPrice + depth.bestSellPrice) / 2
      : (this.buyPrice() + this.sellPrice()) / 2;
    const res = await this.mcp.autofillTradeReference({
      side,
      targetMarginPct: marginPct,
      fallbackRate: fallback,
    });
    if (res.success && res.result) {
      const price = (res.result as { suggestedPrice?: number }).suggestedPrice;
      if (price) {
        if (side === 'BUY') {
          this.buyPrice.set(price);
          this.toast.success(`Autofill Compra MCP: ${price} VES (Margen ${marginPct}%)`);
        } else {
          this.sellPrice.set(price);
          this.toast.success(`Autofill Venta MCP: ${price} VES (Margen ${marginPct}%)`);
        }
      }
    }
  }

  /** Break-Even & Inventory Defense Cockpit parameters */
  readonly beCycleDirection = signal<'SELL_INVENTORY' | 'REPLENISH_BUY'>('SELL_INVENTORY');
  readonly buyFeePct = signal<number>(0);
  readonly sellFeePct = signal<number>(0.25);
  readonly beBankFeePct = signal<number>(0);
  readonly bankFeesVes = signal<number>(0);
  readonly targetRoiPct = signal<number>(1.5);
  readonly beWacExpanded = signal<boolean>(false);
  readonly beWacLots = signal<readonly { id: number; amountUsdt: number; priceVes: number }[]>([
    { id: 1, amountUsdt: 200, priceVes: 800 },
    { id: 2, amountUsdt: 300, priceVes: 806 },
  ]);

  /** Weighted Average Cost (WAC) summary across manual multi-lot entries. */
  readonly beWacSummary = computed(() => {
    const lots = this.beWacLots();
    let totalUsdt = 0;
    let totalVes = 0;
    for (const l of lots) {
      if (l.amountUsdt > 0 && l.priceVes > 0) {
        totalUsdt += l.amountUsdt;
        totalVes += l.amountUsdt * l.priceVes;
      }
    }
    const wacPrice = totalUsdt > 0 ? Number((totalVes / totalUsdt).toFixed(2)) : 0;
    return {
      totalUsdt: Number(totalUsdt.toFixed(2)),
      totalVes: Number(totalVes.toFixed(2)),
      wacPrice,
      validLotsCount: lots.filter((l) => l.amountUsdt > 0 && l.priceVes > 0).length,
    };
  });

  /** Real open inventory from Bitácora evaluated via institutional FIFO accounting. */
  readonly fifoInventorySnapshot = computed(() => {
    try {
      const ops = this.storage.get<Operation[]>(OPS_KEY) ?? [];
      if (!Array.isArray(ops) || ops.length === 0) return null;
      const fifo = computeFifoAccounting(ops);
      if (fifo.openInventoryAmount <= 0 || fifo.openInventoryAvgPriceVes <= 0) return null;
      return {
        openAmountUsdt: Number(fifo.openInventoryAmount.toFixed(2)),
        avgPriceVes: Number(fifo.openInventoryAvgPriceVes.toFixed(2)),
        totalCostVes: Number(fifo.openInventoryCostBasisVes.toFixed(2)),
        openLotsCount: fifo.openLots.length,
      };
    } catch {
      return null;
    }
  });

  /** Synchronize Break-Even buy/sell fees with the selected VIP Merchant level and roles. */
  syncBeFeesFromVipRoles(buy: P2PRole, sell: P2PRole): void {
    this.buyRole.set(buy);
    this.sellRole.set(sell);
    const vipFee = this.makerFeePerLegPct();
    this.buyFeePct.set(buy === 'MAKER' ? vipFee : 0);
    this.sellFeePct.set(sell === 'MAKER' ? vipFee : 0);
    this.toast.info(
      `Tarifas sincronizadas (${buy}/${sell}): Compra ${this.buyFeePct()}% · Venta ${this.sellFeePct()}% (Nivel ${this.selectedMerchantLevel()}).`,
      'Fricción VIP',
    );
  }

  /** Apply Venezuelan banking friction presets (Same Bank, Pago Móvil Interbancario 0.30%, Gateway 0.50%, IGTF 3.00%). */
  applyBankFrictionPreset(preset: 'SAME_BANK' | 'PAGO_MOVIL_INTER' | 'WALLET_GATEWAY' | 'IGTF'): void {
    switch (preset) {
      case 'SAME_BANK':
        this.beBankFeePct.set(0);
        this.bankFeesVes.set(0);
        break;
      case 'PAGO_MOVIL_INTER':
        this.beBankFeePct.set(0.3);
        break;
      case 'WALLET_GATEWAY':
        this.beBankFeePct.set(0.5);
        break;
      case 'IGTF':
        this.beBankFeePct.set(3.0);
        break;
    }
  }

  /** Hydrate Break-Even inputs from real open FIFO inventory in Bitácora. */
  loadFifoInventoryIntoBreakEven(): void {
    const snap = this.fifoInventorySnapshot();
    if (!snap) {
      this.toast.warn('No tenés lotes de inventario abiertos registrados en la Bitácora.', 'Inventario FIFO');
      return;
    }
    this.buyPrice.set(snap.avgPriceVes);
    this.amount.set(snap.openAmountUsdt);
    this.beCycleDirection.set('SELL_INVENTORY');
    this.toast.success(
      `Inventario FIFO cargado: ${snap.openAmountUsdt} ${this.pair()} a costo promedio de ${snap.avgPriceVes} Bs.`,
      'Inventario Sincronizado',
    );
  }

  addWacLot(): void {
    const current = this.beWacLots();
    const nextId = current.length > 0 ? Math.max(...current.map((l) => l.id)) + 1 : 1;
    const refPrice = this.buyPrice() > 0 ? this.buyPrice() : 800;
    this.beWacLots.set([...current, { id: nextId, amountUsdt: 100, priceVes: refPrice }]);
  }

  removeWacLot(id: number): void {
    if (this.beWacLots().length <= 1) return;
    this.beWacLots.set(this.beWacLots().filter((l) => l.id !== id));
  }

  updateWacLot(id: number, field: 'amountUsdt' | 'priceVes', value: number): void {
    const clean = this.clampMoney(value);
    this.beWacLots.set(
      this.beWacLots().map((l) => (l.id === id ? { ...l, [field]: clean } : l)),
    );
  }

  applyWacToBreakEven(): void {
    const sum = this.beWacSummary();
    if (sum.totalUsdt <= 0 || sum.wacPrice <= 0) return;
    this.buyPrice.set(sum.wacPrice);
    this.amount.set(sum.totalUsdt);
    this.beCycleDirection.set('SELL_INVENTORY');
    this.toast.success(
      `Costo promedio ponderado aplicado: ${sum.totalUsdt} ${this.pair()} @ ${sum.wacPrice} Bs.`,
      'Promedio Multi-Lote (WAC)',
    );
  }

  readonly breakEvenResult = computed<BreakEvenResult>(() => {
    const baseVes = this.buyPrice() * this.amount();
    const pctBankFeeVes = baseVes * (this.beBankFeePct() / 100);
    return calculateBreakEven({
      buyPrice: this.buyPrice(),
      amount: this.amount(),
      buyFeeRate: this.buyFeePct() / 100,
      sellFeeRate: this.sellFeePct() / 100,
      fixedBankFeesVes: this.bankFeesVes() + pctBankFeeVes,
      targetRoiPct: this.targetRoiPct(),
    });
  });

  /** Reverse Break-Even Engine (Sold crypto first -> calculating max buyback ceiling to replenish + earn target ROI). */
  readonly reverseBreakEvenResult = computed(() => {
    const refSell = this.sellPrice() > 0 ? this.sellPrice() : this.buyPrice();
    const vol = this.amount();
    const sellFee = this.sellFeePct() / 100;
    const buyFee = this.buyFeePct() / 100;
    const bankPct = this.beBankFeePct() / 100;
    const fixedVes = this.bankFeesVes();
    const targetRoi = this.targetRoiPct() / 100;

    if (refSell <= 0 || vol <= 0) {
      return {
        netProceedsVes: 0,
        breakEvenBuyCeiling: 0,
        targetBuyPrice: 0,
        breakEvenSpread: 0,
        targetSpread: 0,
        projectedNetProfitUsdt: 0,
        projectedNetProfitVes: 0,
        safetyMarginVes: 0,
      };
    }

    const grossProceedsVes = vol * refSell;
    const netProceedsVes = Math.max(
      0,
      grossProceedsVes * (1 - sellFee - bankPct) - fixedVes,
    );
    const buyFrictionMult = 1 + buyFee;
    const breakEvenBuyCeiling = Number((netProceedsVes / (vol * buyFrictionMult)).toFixed(2));
    const targetBuyPrice = Number(
      (netProceedsVes / (vol * (1 + targetRoi) * buyFrictionMult)).toFixed(2),
    );
    const projectedNetProfitUsdt = Number((vol * targetRoi).toFixed(2));
    const projectedNetProfitVes = Number((projectedNetProfitUsdt * refSell).toFixed(2));

    return {
      netProceedsVes: Number(netProceedsVes.toFixed(2)),
      breakEvenBuyCeiling,
      targetBuyPrice,
      breakEvenSpread: Number((refSell - breakEvenBuyCeiling).toFixed(2)),
      targetSpread: Number((refSell - targetBuyPrice).toFixed(2)),
      projectedNetProfitUsdt,
      projectedNetProfitVes,
      safetyMarginVes: Number(Math.max(0, breakEvenBuyCeiling - targetBuyPrice).toFixed(2)),
    };
  });

  /** Projected net profit in USDT/EUR at the Break-Even target price. */
  readonly beNetProfitUsdt = computed<number>(() => {
    if (this.beCycleDirection() === 'REPLENISH_BUY') {
      return this.reverseBreakEvenResult().projectedNetProfitUsdt;
    }
    const be = this.breakEvenResult();
    if (be.targetSellPrice <= 0) return 0;
    return Number((be.projectedNetProfitVes / be.targetSellPrice).toFixed(2));
  });

  /** Live Market Executability Thermometer comparing Break-Even & Target vs Binance L2 Top 1. */
  readonly beMarketVerdict = computed(() => {
    const ob = this.filteredOrderbook();
    const dir = this.beCycleDirection();
    const vol = this.amount();

    if (dir === 'SELL_INVENTORY') {
      const be = this.breakEvenResult();
      const top1Sell = ob.effectiveBestSell;
      const vwapSell = ob.vwapSell5 > 0 ? ob.vwapSell5 : top1Sell;
      if (top1Sell <= 0 || be.breakEvenPrice <= 0 || vol <= 0) {
        return {
          hasMarket: false,
          status: 'NO_MARKET' as const,
          marketRefPrice: 0,
          vwapRefPrice: 0,
          executableTop1Price: 0,
          executableTop1RoiPct: 0,
          executableTop1ProfitVes: 0,
          executableTop1ProfitUsdt: 0,
          gapToTargetVes: 0,
          gapToBreakEvenVes: 0,
          headline: 'Sincronizá el libro de Binance P2P para evaluar ejecutabilidad en vivo',
          guidance: 'Al cargar el libro L2, el sistema comparará tu Piso Break-Even contra el Top 1 real.',
        };
      }

      const executableTop1Price = Number(Math.max(0.01, top1Sell - 0.01).toFixed(2));
      const sellMult = Math.max(0.0001, 1 - this.sellFeePct() / 100);
      const netRevAtTop1 = vol * executableTop1Price * sellMult;
      const executableTop1ProfitVes = Number((netRevAtTop1 - be.totalCostVes).toFixed(2));
      const executableTop1ProfitUsdt = Number((executableTop1ProfitVes / executableTop1Price).toFixed(2));
      const executableTop1RoiPct =
        be.totalCostVes > 0
          ? Number(((executableTop1ProfitVes / be.totalCostVes) * 100).toFixed(2))
          : 0;
      const gapToTargetVes = Number((executableTop1Price - be.targetSellPrice).toFixed(2));
      const gapToBreakEvenVes = Number((executableTop1Price - be.breakEvenPrice).toFixed(2));

      if (executableTop1Price >= be.targetSellPrice) {
        return {
          hasMarket: true,
          status: 'SUPERAVIT_TOP1' as const,
          marketRefPrice: top1Sell,
          vwapRefPrice: vwapSell,
          executableTop1Price,
          executableTop1RoiPct,
          executableTop1ProfitVes,
          executableTop1ProfitUsdt,
          gapToTargetVes,
          gapToBreakEvenVes,
          headline: `🟢 Superávit Inmediato: Top 1 paga +${gapToTargetVes.toFixed(2)} Bs sobre tu meta`,
          guidance: `¡No regales margen cotizando a ${be.targetSellPrice} Bs! Si te posicionás como Líder Top 1 a ${executableTop1Price} Bs (-0.01 Bs), vendés de inmediato con +${executableTop1RoiPct}% ROI (+${executableTop1ProfitUsdt} ${this.pair()}).`,
        };
      }

      if (executableTop1Price > be.breakEvenPrice) {
        return {
          hasMarket: true,
          status: 'PROFITABLE_QUEUE' as const,
          marketRefPrice: top1Sell,
          vwapRefPrice: vwapSell,
          executableTop1Price,
          executableTop1RoiPct,
          executableTop1ProfitVes,
          executableTop1ProfitUsdt,
          gapToTargetVes,
          gapToBreakEvenVes,
          headline: `🟡 Zona Rentable en Cola: Top 1 rinde +${executableTop1RoiPct}% ROI (+${gapToBreakEvenVes.toFixed(2)} Bs sobre Break-Even)`,
          guidance: `Tenés 2 jugadas tácticas: (A) Salir YA en Top 1 a ${executableTop1Price} Bs asegurando +${executableTop1ProfitUsdt} ${this.pair()} (+${executableTop1RoiPct}% ROI), o (B) Publicar en cola a ${be.targetSellPrice} Bs esperando que el libro suba ${Math.abs(gapToTargetVes).toFixed(2)} Bs.`,
        };
      }

      return {
        hasMarket: true,
        status: 'BELOW_BREAKEVEN' as const,
        marketRefPrice: top1Sell,
        vwapRefPrice: vwapSell,
        executableTop1Price,
        executableTop1RoiPct,
        executableTop1ProfitVes,
        executableTop1ProfitUsdt,
        gapToTargetVes,
        gapToBreakEvenVes,
        headline: `🔴 Alerta de Pérdida: Top 1 (${top1Sell} Bs) está ${Math.abs(gapToBreakEvenVes).toFixed(2)} Bs DEBAJO de tu Break-Even`,
        guidance: `PROHIBIDO competir en Top 1 ahora (perderías ${executableTop1ProfitVes} Bs / ${executableTop1RoiPct}%). Anclá tu anuncio de defensa en mínimo ${be.breakEvenPrice} Bs o activá el Cortafuegos del Bot.`,
      };
    } else {
      // REPLENISH_BUY
      const rev = this.reverseBreakEvenResult();
      const top1Buy = ob.effectiveBestBuy;
      const vwapBuy = ob.vwapBuy5 > 0 ? ob.vwapBuy5 : top1Buy;
      if (top1Buy <= 0 || rev.breakEvenBuyCeiling <= 0 || vol <= 0) {
        return {
          hasMarket: false,
          status: 'NO_MARKET' as const,
          marketRefPrice: 0,
          vwapRefPrice: 0,
          executableTop1Price: 0,
          executableTop1RoiPct: 0,
          executableTop1ProfitVes: 0,
          executableTop1ProfitUsdt: 0,
          gapToTargetVes: 0,
          gapToBreakEvenVes: 0,
          headline: 'Sincronizá el libro de Binance P2P para evaluar recompra en vivo',
          guidance: 'El sistema comparará tu Techo Break-Even contra la mejor punta de compra actual.',
        };
      }

      const executableTop1Price = Number((top1Buy + 0.01).toFixed(2));
      const buyFrictionMult = 1 + this.buyFeePct() / 100;
      const usdtBoughtAtTop1 = rev.netProceedsVes / (executableTop1Price * buyFrictionMult);
      const executableTop1ProfitUsdt = Number((usdtBoughtAtTop1 - vol).toFixed(2));
      const executableTop1ProfitVes = Number((executableTop1ProfitUsdt * executableTop1Price).toFixed(2));
      const executableTop1RoiPct = Number(((executableTop1ProfitUsdt / vol) * 100).toFixed(2));
      const gapToTargetVes = Number((rev.targetBuyPrice - executableTop1Price).toFixed(2));
      const gapToBreakEvenVes = Number((rev.breakEvenBuyCeiling - executableTop1Price).toFixed(2));

      if (executableTop1Price <= rev.targetBuyPrice) {
        return {
          hasMarket: true,
          status: 'SUPERAVIT_TOP1' as const,
          marketRefPrice: top1Buy,
          vwapRefPrice: vwapBuy,
          executableTop1Price,
          executableTop1RoiPct,
          executableTop1ProfitVes,
          executableTop1ProfitUsdt,
          gapToTargetVes,
          gapToBreakEvenVes,
          headline: `🟢 Recompra Inmediata: Top 1 (${executableTop1Price} Bs) está ${gapToTargetVes.toFixed(2)} Bs más barato que tu meta`,
          guidance: `Podés recomprar en Top 1 a ${executableTop1Price} Bs (+0.01 Bs) y recuperar tus ${vol} ${this.pair()} más +${executableTop1ProfitUsdt} ${this.pair()} netos (+${executableTop1RoiPct}% ROI).`,
        };
      }

      if (executableTop1Price < rev.breakEvenBuyCeiling) {
        return {
          hasMarket: true,
          status: 'PROFITABLE_QUEUE' as const,
          marketRefPrice: top1Buy,
          vwapRefPrice: vwapBuy,
          executableTop1Price,
          executableTop1RoiPct,
          executableTop1ProfitVes,
          executableTop1ProfitUsdt,
          gapToTargetVes,
          gapToBreakEvenVes,
          headline: `🟡 Recompra Rentable: Top 1 deja +${executableTop1RoiPct}% ROI (${gapToBreakEvenVes.toFixed(2)} Bs bajo tu techo)`,
          guidance: `Si recomprás hoy en Top 1 (${executableTop1Price} Bs) ganás +${executableTop1ProfitUsdt} ${this.pair()}. Para lograr tu meta de ${this.targetRoiPct()}% ROI, anclá tu orden de compra en ${rev.targetBuyPrice} Bs.`,
        };
      }

      return {
        hasMarket: true,
        status: 'BELOW_BREAKEVEN' as const,
        marketRefPrice: top1Buy,
        vwapRefPrice: vwapBuy,
        executableTop1Price,
        executableTop1RoiPct,
        executableTop1ProfitVes,
        executableTop1ProfitUsdt,
        gapToTargetVes,
        gapToBreakEvenVes,
        headline: `🔴 Recompra en Pérdida: Top 1 (${top1Buy} Bs) supera tu Techo Break-Even (${rev.breakEvenBuyCeiling} Bs)`,
        guidance: `NO recompres a precio Top 1 (perderías ${executableTop1ProfitUsdt} ${this.pair()}). Fijá tu orden de compra con techo máximo en ${rev.breakEvenBuyCeiling} Bs.`,
      };
    }
  });

  /** Interactive 5-tier ROI Scenario Ladder for guided decision making. */
  readonly beRoiLadder = computed(() => {
    const tiers = [
      { roi: 0, tag: 'Piso Defensa (BE)' },
      { roi: 0.5, tag: 'Mínimo Golden' },
      { roi: 1.0, tag: 'Rotación Rápida' },
      { roi: 1.5, tag: 'Meta Estándar' },
      { roi: 2.2, tag: 'Alta Rentabilidad' },
    ];
    const dir = this.beCycleDirection();
    const ob = this.filteredOrderbook();
    const baseVes = this.buyPrice() * this.amount();
    const pctBankFeeVes = baseVes * (this.beBankFeePct() / 100);

    return tiers.map((t) => {
      if (dir === 'SELL_INVENTORY') {
        const calc = calculateBreakEven({
          buyPrice: this.buyPrice(),
          amount: this.amount(),
          buyFeeRate: this.buyFeePct() / 100,
          sellFeeRate: this.sellFeePct() / 100,
          fixedBankFeesVes: this.bankFeesVes() + pctBankFeeVes,
          targetRoiPct: t.roi,
        });
        const profitUsdt =
          calc.targetSellPrice > 0
            ? Number((calc.projectedNetProfitVes / calc.targetSellPrice).toFixed(2))
            : 0;
        const isImmediate = ob.effectiveBestSell > 0 && calc.targetSellPrice <= ob.effectiveBestSell;
        return {
          roi: t.roi,
          tag: t.tag,
          priceVes: calc.targetSellPrice,
          spreadVes: calc.targetSpread,
          profitUsdt,
          profitVes: calc.projectedNetProfitVes,
          isImmediate,
          isSelected: Math.abs(this.targetRoiPct() - t.roi) < 0.01,
        };
      } else {
        const rev = this.reverseBreakEvenResult();
        const vol = this.amount();
        const buyFrictionMult = 1 + this.buyFeePct() / 100;
        const priceVes =
          vol > 0 && rev.netProceedsVes > 0
            ? Number((rev.netProceedsVes / (vol * (1 + t.roi / 100) * buyFrictionMult)).toFixed(2))
            : 0;
        const refSell = this.sellPrice() > 0 ? this.sellPrice() : this.buyPrice();
        const spreadVes = Number((refSell - priceVes).toFixed(2));
        const profitUsdt = Number((vol * (t.roi / 100)).toFixed(2));
        const profitVes = Number((profitUsdt * refSell).toFixed(2));
        const isImmediate = ob.effectiveBestBuy > 0 && priceVes >= ob.effectiveBestBuy;
        return {
          roi: t.roi,
          tag: t.tag,
          priceVes,
          spreadVes,
          profitUsdt,
          profitVes,
          isImmediate,
          isSelected: Math.abs(this.targetRoiPct() - t.roi) < 0.01,
        };
      }
    });
  });

  selectRoiLadderStep(roiPct: number, applyToMonitor = false): void {
    this.targetRoiPct.set(roiPct);
    if (applyToMonitor) {
      this.applyTargetSellPrice();
    }
  }

  /** Recommended ad limits (Sebastian Labastidas rule: filter micro-orders to preserve daily banking limits). */
  readonly recommendedMakerLimits = computed(() => {
    const price = this.buyPrice() > 0 ? this.buyPrice() : 800;
    const volCrypto = this.amount() > 0 ? this.amount() : 50;
    const totalVes = price * volCrypto;
    // Minimum ticket threshold: equivalent to at least $30 to protect from 1-5 USD micro-orders
    const minTicketUsd = 30;
    const minTicketVes = Math.round(minTicketUsd * price);
    const maxTicketVes = Math.round(totalVes);

    return {
      minTicketUsd,
      minTicketVes,
      maxTicketVes,
      tip: `Configura tu anuncio con mínimo ${minTicketVes.toLocaleString('es-VE')} Bs (~$30) para evitar que órdenes pequeñas agoten tus 15 transferencias diarias.`,
    };
  });

  /** Manual custom weights overrides for portfolio allocation */
  readonly manualBankAllocationMode = signal<boolean>(false);
  readonly customBanescoPct = signal<number>(40);
  readonly customMercantilPct = signal<number>(35);
  readonly customBdvPct = signal<number>(25);

  /** Institutional Portfolio Allocation Plan ($10,000 multi-bank split: Banesco 40%, Mercantil 35%, BDV 25% or custom). */
  readonly portfolioAllocationPlan = computed<PortfolioAllocationPlan>(() => {
    const capital = this.amount() >= 1000 ? this.amount() : 10000;
    const price = this.buyPrice() > 0 ? this.buyPrice() : 60.0;
    const hour = this.now().getHours();
    const registered = this.accountsService.accounts();

    const customWeights = this.manualBankAllocationMode()
      ? {
          BANESCO: this.customBanescoPct(),
          MERCANTIL: this.customMercantilPct(),
          BDV: this.customBdvPct(),
        }
      : undefined;

    return buildPortfolioAllocationPlan(capital, registered, price, hour, customWeights);
  });

  setManualBankWeight(bank: BankCode, pct: number): void {
    const val = Math.max(0, Math.min(100, pct));
    if (bank === 'BANESCO') this.customBanescoPct.set(val);
    else if (bank === 'MERCANTIL') this.customMercantilPct.set(val);
    else if (bank === 'BDV') this.customBdvPct.set(val);
  }

  resetBankWeightsToDefault(): void {
    this.customBanescoPct.set(40);
    this.customMercantilPct.set(35);
    this.customBdvPct.set(25);
    this.manualBankAllocationMode.set(false);
    this.toast.info(
      'Distribución bancaria restablecida a ponderaciones recomendadas (40/35/25).',
      'Distribución SUDEBAN',
    );
  }

  applyTargetSellPrice(): void {
    if (this.beCycleDirection() === 'REPLENISH_BUY') {
      const targetBuy = this.reverseBreakEvenResult().targetBuyPrice;
      this.buyPrice.set(targetBuy);
      this.activeMode.set('spread');
      this.toast.success(
        `Precio de recompra fijado en ${this.nf.format(targetBuy)} VES/${this.pair()} para +${this.targetRoiPct()}% ROI.`,
        'Recompra Configurada',
      );
      return;
    }
    const target = this.breakEvenResult().targetSellPrice;
    this.sellPrice.set(target);
    this.activeMode.set('spread');
    this.toast.success(
      `Precio de venta fijado en ${this.nf.format(target)} VES/${this.pair()} para ${this.targetRoiPct()}% ROI.`,
      'Anuncio Maker Configurado',
    );
  }

  /** Jump directly to the live executable Top 1 price when it exceeds Break-Even. */
  applyExecutableTop1FromBreakEven(): void {
    const v = this.beMarketVerdict();
    if (!v.hasMarket || v.executableTop1Price <= 0) return;
    if (this.beCycleDirection() === 'SELL_INVENTORY') {
      this.sellPrice.set(v.executableTop1Price);
      this.sellRole.set('MAKER');
      this.activeMode.set('spread');
      this.toast.success(
        `Posicionamiento Top 1 fijado en ${v.executableTop1Price} Bs (ROI real: +${v.executableTop1RoiPct}%).`,
        'Ejecución Top 1',
      );
    } else {
      this.buyPrice.set(v.executableTop1Price);
      this.buyRole.set('MAKER');
      this.activeMode.set('spread');
      this.toast.success(
        `Recompra Top 1 fijada en ${v.executableTop1Price} Bs (ROI real: +${v.executableTop1RoiPct}%).`,
        'Ejecución Top 1',
      );
    }
  }

  /** 1-Click Firewall: Anchor Break-Even floor/ceiling directly into the Repricer Bot and Ad Composer. */
  anchorBreakEvenToBots(): void {
    if (this.beCycleDirection() === 'SELL_INVENTORY') {
      const floor = this.breakEvenResult().breakEvenPrice;
      if (floor <= 0) return;
      this.repricer.breakEvenFloor.set(floor);
      this.adComposer.breakEvenSellPrice.set(floor);
      this.toast.success(
        `Cortafuegos activo: Piso Break-Even (${floor} Bs) anclado en el Bot Repricer y en el Publicador de Anuncios.`,
        'Cortafuegos de Defensa',
      );
    } else {
      const ceiling = this.reverseBreakEvenResult().breakEvenBuyCeiling;
      if (ceiling <= 0) return;
      this.repricer.maxBuyPrice.set(ceiling);
      this.adComposer.maxBuyPrice.set(ceiling);
      this.toast.success(
        `Cortafuegos activo: Techo de Recompra (${ceiling} Bs) anclado en el Bot Repricer y en el Publicador de Anuncios.`,
        'Cortafuegos de Defensa',
      );
    }
  }

  async syncBinancePrices(): Promise<void> {
    const marketDepth = await this.binance.fetchMarketDepth(this.pair(), 'VES');
    if (marketDepth && marketDepth.bestBuyPrice > 0 && marketDepth.bestSellPrice > 0) {
      this.buyPrice.set(marketDepth.bestBuyPrice);
      this.sellPrice.set(marketDepth.bestSellPrice);
      void this.syncMcpIntelligence();

      this.marketHistory.recordSnapshot({
        pair: this.pair(),
        bank: this.binance.selectedBank(),
        bestBuyPrice: marketDepth.bestBuyPrice,
        bestSellPrice: marketDepth.bestSellPrice,
        spreadVes: marketDepth.spreadVes,
        spreadPct: marketDepth.spreadPct,
      });

      this.toast.success(
        `Precios sincronizados con Binance P2P (${this.binance.selectedBank()}): Compra ${marketDepth.bestBuyPrice} Bs / Venta ${marketDepth.bestSellPrice} Bs.`,
        'Mercado en Vivo',
      );
    }
  }

  applyBinancePrices(): void {
    const depth = this.binance.marketDepth();
    const ob = this.filteredOrderbook();
    const bestBuy = ob.effectiveBestBuy > 0 ? ob.effectiveBestBuy : (depth?.bestBuyPrice ?? 0);
    const bestSell = ob.effectiveBestSell > 0 ? ob.effectiveBestSell : (depth?.bestSellPrice ?? 0);
    if (bestBuy > 0 && bestSell > 0) {
      this.buyPrice.set(bestBuy);
      this.sellPrice.set(bestSell);
      this.toast.success(
        `Precios aplicados: Compra ${bestBuy} Bs / Venta ${bestSell} Bs.`,
        'Precios Actualizados',
      );
    } else {
      void this.syncBinancePrices();
    }
  }

  /** Template helper: collapse NaN/empty/negative money entries to 0. */
  clampMoney(v: number): number {
    return sharedClampMoney(v);
  }

  readonly result = computed<SpreadResult | null>(() => {
    try {
      return computeSpread(
        this.buyPrice(),
        this.sellPrice(),
        this.amount(),
        this.unit(),
        this.totalEffectiveCommissionPct() / 100,
      );
    } catch {
      return null;
    }
  });

  readonly error = computed<string | null>(() => {
    try {
      computeSpread(
        this.buyPrice(),
        this.sellPrice(),
        this.amount(),
        this.unit(),
        this.totalEffectiveCommissionPct() / 100,
      );
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  });

  readonly usdtReceived = computed(() => this.result()?.usdtReceived ?? 0);
  readonly vesReceived = computed(() => this.result()?.vesReceived ?? 0);
  readonly unitSpread = computed(() => this.result()?.unitSpread ?? 0);
  readonly gainVes = computed(() => this.result()?.gainVes ?? 0);
  readonly netVesAfterCommission = computed(() => this.result()?.netVesAfterCommission ?? 0);
  readonly netGainVes = computed(() => this.result()?.netGainVes ?? 0);

  /** Base capital invested in VES for the current operation. */
  readonly baseInvestedVes = computed<number>(() => {
    const r = this.result();
    if (!r || this.buyPrice() <= 0) return 0;
    return this.unit() === 'VES' ? this.amount() : this.amount() * this.buyPrice();
  });

  /** Base capital invested in USDT/EUR for the current operation. */
  readonly baseInvestedCrypto = computed<number>(() => {
    const r = this.result();
    if (!r || this.buyPrice() <= 0) return 0;
    return this.unit() === 'VES' ? this.amount() / this.buyPrice() : this.amount();
  });

  /** Net profit converted to USDT/EUR at the execution sell price. */
  readonly netGainUsdt = computed<number>(() => {
    const r = this.result();
    const sell = this.sellPrice();
    if (!r || sell <= 0) return 0;
    return Number((r.netGainVes / sell).toFixed(2));
  });

  /** Net Return on Investment (%) per cycle after all role and platform fees. */
  readonly netRoiPct = computed<number>(() => {
    const r = this.result();
    const base = this.baseInvestedVes();
    if (!r || base <= 0) return 0;
    return Number(((r.netGainVes / base) * 100).toFixed(2));
  });

  /** Live break-even sell price required to cover buy price + total effective commission. */
  readonly liveBreakEvenSellPrice = computed<number>(() => {
    const buy = this.buyPrice();
    if (buy <= 0) return 0;
    const feeRate = this.totalEffectiveCommissionPct() / 100;
    if (feeRate >= 1) return buy;
    return Number((buy / (1 - feeRate)).toFixed(2));
  });

  /** Daily Compound Rotation Matrix (1x, 3x, 5x, 10x cycles per day). */
  readonly cycleProjections = computed(() => {
    const capitalCrypto = this.baseInvestedCrypto();
    const roiPct = this.netRoiPct();
    const sell = this.sellPrice();
    const cyclesList = [1, 3, 5, 10];
    const mult = 1 + roiPct / 100;

    return cyclesList.map((cycles) => {
      if (capitalCrypto <= 0 || sell <= 0 || mult <= 0) {
        return {
          cycles,
          label: `${cycles}x ${cycles === 1 ? 'Ciclo' : 'Ciclos'}`,
          profitUsdt: 0,
          profitVes: 0,
          finalUsdt: 0,
          compoundRoiPct: 0,
        };
      }
      const compoundFactor = Math.pow(mult, cycles);
      const profitUsdt = Number((capitalCrypto * (compoundFactor - 1)).toFixed(2));
      const profitVes = Number((profitUsdt * sell).toFixed(2));
      const finalUsdt = Number((capitalCrypto * compoundFactor).toFixed(2));
      const compoundRoiPct = Number(((compoundFactor - 1) * 100).toFixed(2));
      return {
        cycles,
        label: `${cycles}x ${cycles === 1 ? 'Ciclo' : 'Ciclos'}`,
        profitUsdt,
        profitVes,
        finalUsdt,
        compoundRoiPct,
      };
    });
  });

  /** Net spread percentage evaluated against the Golden Rule (0.50% min). */
  readonly goldenSpread = computed<GoldenSpreadCheck | null>(() => {
    const r = this.result();
    if (!r || this.buyPrice() <= 0) return null;
    const baseInvested = this.baseInvestedVes();
    if (baseInvested <= 0) return null;
    const netPct = (r.netGainVes / baseInvested) * 100;
    return evaluateGoldenSpread(netPct);
  });

  readonly alert = computed<{ kind: 'favorable' | 'unfavorable' | null; message: string }>(() => {
    const r = this.result();
    if (!r) return { kind: null, message: '' };
    const min = this.risks.config().minSpread;
    if (r.unitSpread < min) {
      return {
        kind: 'unfavorable',
        message: `Desfavorable: el spread ${this.nf.format(r.unitSpread)} está por debajo del mínimo ${this.nf.format(min)}`,
      };
    }
    const verdict = this.risks.evaluate({
      currentSpread: r.unitSpread,
      minSpread: min,
      openOps: 0,
      tradeRiskPct: 0,
      dailyLossPct: 0,
      consecutiveErrors: 0,
    });
    if (verdict.decision === 'ALLOW' && r.unitSpread >= this.threshold()) {
      return {
        kind: 'favorable',
        message: `Favorable: el spread ${this.nf.format(r.unitSpread)} ≥ umbral ${this.nf.format(this.threshold())}`,
      };
    }
    return { kind: null, message: '' };
  });

  /** True when a cooldown is still active for `key`. Marks the last fire time. */
  private signalMayFire(key: string): boolean {
    const now = Date.now();
    const last = this.alertLastAt.get(key) ?? 0;
    if (now - last < this.alertCooldownMs) return false;
    this.alertLastAt.set(key, now);
    return true;
  }

  /** Live market spread (%) from the last Binance P2P fetch, or null when no clean data. */
  private readonly marketSpreadPct = computed<number | null>(() => {
    const d = this.binance.marketDepth();
    if (!d || d.bestBuyPrice <= 0 || d.bestSellPrice <= 0) return null;
    return d.spreadPct;
  });

  /** Current market sell price is at/below the maker break-even → selling at a loss. */
  private readonly sellAtOrBelowBreakEven = computed<boolean>(() => {
    const d = this.binance.marketDepth();
    const be = this.breakEvenResult();
    if (!d || d.bestSellPrice <= 0 || be.breakEvenPrice <= 0) return false;
    return d.bestSellPrice <= be.breakEvenPrice;
  });

  constructor() {
    // Alertas ampliadas: spread de mercado, flip de break-even y cupos/velocidad.
    // Deduplicadas por clave con ventana de cooldown para evitar fatiga de alertas.
    effect(() => {
      const kind = this.alert().kind;
      if (
        kind === 'favorable' &&
        this.prevFavorableKind !== 'favorable' &&
        this.signalMayFire('favorable')
      ) {
        this.notify(this.alert().message);
        this.audioAlerts.playOpportunityAlert();
      }
      this.prevFavorableKind = kind;
    });

    effect(() => {
      const spreadPct = this.marketSpreadPct();
      if (
        spreadPct !== null &&
        spreadPct >= this.spreadAlertPct() &&
        this.signalMayFire('spread-threshold')
      ) {
        this.toast.success(
          `Spread de mercado en ${spreadPct}% ≥ umbral ${this.spreadAlertPct()}% — oportunidad de arbitraje amplia.`,
          'Spread Alto',
        );
      }
    });

    effect(() => {
      const actionableMode = this.activeMode() === 'breakeven' || this.activeMode() === 'repricer';
      const below = this.sellAtOrBelowBreakEven();
      if (
        actionableMode &&
        below &&
        !this.prevSellBelowBreakEven &&
        this.signalMayFire('breakeven-flip')
      ) {
        const d = this.binance.marketDepth();
        const be = this.breakEvenResult();
        this.toast.warn(
          `El precio de venta de mercado (${d?.bestSellPrice ?? 0} Bs) está en/por debajo del break-even (${be.breakEvenPrice} Bs) — el anuncio sellaría a pérdida.`,
          'Flip Break-Even',
        );
      }
      this.prevSellBelowBreakEven = below;
    });

    effect(() => {
      for (const v of this.accountsService.accountVelocities()) {
        if (v.usedPct >= 85 && this.signalMayFire(`velocity-${v.accountId}`)) {
          this.toast.warn(
            `${v.bankName}: ${v.todayTransactionCount}/${v.maxDailyTransactions} transferencias (${v.usedPct}% del tope diario).`,
            'Velocidad Bancaria Alta',
          );
        }
      }
      for (const u of this.accountsService.usages()) {
        if (u.consumedLimitPct >= 85 && this.signalMayFire(`limit-${u.account.id}`)) {
          this.toast.warn(
            `${u.account.bankName}: ${u.consumedLimitPct}% del cupo diario consumido (${u.spentTodayVes} Bs).`,
            'Cupo Bancario Casi Agotado',
          );
        }
      }
    });

    // Mantener los precios frescos en vivo (30s) mientras la vista está activa,
    // respetando el par seleccionado y reiniciando si el usuario lo cambia.
    effect(() => {
      const pair = this.pair();
      if (this.activeMode() !== 'repricer') {
        this.binance.startAutoRefresh(30_000, pair);
      } else {
        this.binance.stopAutoRefresh();
      }
    });

    // Cotizave NO se decide en `ngOnInit`: `apiKey` es una señal que el servicio
    // hidrata de forma ASÍNCRONA desde la bóveda de credenciales, así que al
    // correr `ngOnInit` todavía vale `''` aunque el operador tenga la key
    // guardada. Preguntar una vez era una carrera contra la hidratación: se
    // ganaba o se perdía según cuándo llegara el microtask, y perder significaba
    // auto-refresh apagado para toda la sesión —con la cache envejeciendo sin que
    // nadie la vuelva a llenar—. Un `effect` sobre la señal no pierde: cuando la
    // key llega, la dependencia cambia y el auto-refresh arranca solo.
    effect(() => {
      const hasKey = !!this.cotizave.apiKey();
      const repricer = this.activeMode() === 'repricer';
      if (hasKey && !repricer) {
        // 10 min de intervalo contra 15 min de TTL: protege la cuota de Cotizave
        // para no quemar el límite mensual ni provocar HTTP 429 por ráfagas,
        // renovando el dato antes de que expire la caché en vivo.
        this.cotizave.startAutoRefresh(10 * 60_000);
      } else {
        this.cotizave.stopAutoRefresh();
      }
    });

    this.hotkeys.register('SYNC', () => {
      void this.syncBinancePrices();
    });
    this.hotkeys.register('FETCH_MARKET', () => {
      void this.syncBinancePrices();
    });
  }

  getSparklinePoints(): string {
    const points = this.marketHistory.getFilteredPoints(this.binance.selectedBank());
    if (points.length < 2) return '';
    const spreads = points.map((p) => p.spreadVes);
    const min = Math.min(...spreads);
    const max = Math.max(...spreads);
    const range = max - min || 1;
    const width = 280;
    const height = 44;
    return points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * width;
        const y = height - ((p.spreadVes - min) / range) * (height - 10) - 5;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  ngOnInit(): void {
    this.now.set(new Date());
    this.nowTimerId = window.setInterval(() => this.now.set(new Date()), 60_000);
    if (!this.binance.marketDepth()) {
      void this.syncBinancePrices();
    } else {
      void this.syncMcpIntelligence();
    }
    this.mcpSyncTimerId = window.setInterval(() => void this.syncMcpIntelligence(), 30_000);
  }

  ngOnDestroy(): void {
    if (this.nowTimerId !== null) {
      window.clearInterval(this.nowTimerId);
      this.nowTimerId = null;
    }
    if (this.mcpSyncTimerId !== null) {
      window.clearInterval(this.mcpSyncTimerId);
      this.mcpSyncTimerId = null;
    }
    this.cotizave.stopAutoRefresh();
    this.binance.stopAutoRefresh();
  }

  setUnit(value: string): void {
    this.unit.set(value as AmountUnit);
  }

  setPair(value: string): void {
    const p = value === 'EUR' ? 'EUR' : 'USDT';
    this.pair.set(p);
    if (this.unit() !== 'VES') {
      this.unit.set(p as AmountUnit);
    }
  }

  startDirectTrade(type: 'buy' | 'sell'): void {
    const res = this.result();
    if (!res) return;

    const isBuy = type === 'buy';
    const price = isBuy ? this.buyPrice() : this.sellPrice();
    const usdtAmount = res.usdtReceived;
    const vesAmount = isBuy ? res.usdtReceived * price : res.vesReceived;

    const preset: TradePreset = {
      pair: this.pair(),
      type,
      price,
      usdtAmount: Number(usdtAmount.toFixed(6)),
      vesAmount: Number(vesAmount.toFixed(2)),
      merchantNote: `Arbitraje ${this.pair()} (Spread: ${this.nf.format(res.unitSpread)} Bs)`,
    };

    this.timer.start(preset);
    this.toast.info('Cronómetro iniciado. Datos precargados en el registro.', 'Trade Despachado');
    this.router.navigate(['/log']);
  }

  /** Notify the user when a Favorable opportunity appears (native on Android, web Notification on desktop, and in-app toast). */
  private notify(msg: string): void {
    const title = 'P2P Decisor — Spread favorable';
    this.toast.success(msg, 'Oportunidad de Arbitraje');

    try {
      if (Capacitor.isNativePlatform()) {
        const schedule = () =>
          LocalNotifications.schedule({
            notifications: [{ title, body: msg, id: Math.floor(Math.random() * 100000) }],
          }).catch(() => {
            /* ignore notification scheduling failure */
          });
        LocalNotifications.checkPermissions()
          .then((p) => {
            if (p.display === 'granted') schedule();
            else
              LocalNotifications.requestPermissions()
                .then((r) => {
                  if (r.display === 'granted') schedule();
                })
                .catch(() => {
                  /* ignore permission request rejection */
                });
          })
          .catch(() => {
            /* ignore permission check rejection */
          });
        return;
      }
      if (typeof Notification !== 'undefined') {
        const fire = () => new Notification(title, { body: msg });
        if (Notification.permission === 'granted') {
          fire();
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission()
            .then((p) => {
              if (p === 'granted') fire();
            })
            .catch(() => {
              /* ignore notification request rejection */
            });
        }
      }
    } catch {
      /* plataforma sin notificaciones */
    }
  }
}
