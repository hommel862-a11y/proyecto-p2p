import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  simulateTradeImpact,
  type AvellanedaStoikovResult,
  type BinanceOfferSummary,
  type BracketId,
  type InstitutionalSlicingResult,
  type MarketDataPoint,
  type OrderBookImbalanceResult,
} from '@p2p/core';
import type { BinanceFreshnessStatus } from '../../../../core/binance-p2p.service';
import type {
  BracketSummaryItem,
  MakerVsTakerComparison,
} from '../../../../core/microstructure-engine.service';
import {
  VOLATILITY_SOURCE,
  type LiveSpreadQualityResult,
} from '../../../../core/spread-quality.service';
import {
  CHART_TABS,
  type ChartTab,
  type MicrostructureOperateBracketEvent,
  type SlippageBarPoint,
  type SqsFactorItem,
} from './microstructure.types';

interface DepthGapRect {
  readonly x: number;
  readonly width: number;
  readonly gapPct: number;
  readonly labelX: number;
}

interface DepthGeometry {
  readonly hasData: boolean;
  readonly minPrice: number;
  readonly maxPrice: number;
  readonly maxUsdt: number;
  readonly bidPoints: string;
  readonly bidAreaPoints: string;
  readonly askPoints: string;
  readonly askAreaPoints: string;
  readonly reservationX: number | null;
  readonly fifoX: number | null;
  readonly gapRects: readonly DepthGapRect[];
}

interface PulseGeometry {
  readonly hasPoints: boolean;
  readonly pathD: string;
  readonly areaD: string;
  readonly minRate: number;
  readonly maxRate: number;
  readonly lastRate: number;
}

const CHART_LEFT = 20;
const CHART_RIGHT = 380;
const CHART_TOP = 24;
const CHART_BOTTOM = 152;
const SLIPPAGE_TICKETS: readonly number[] = [100, 250, 500, 1000, 2500, 5000];

function mapPriceToX(price: number, minP: number, maxP: number): number {
  const span = Math.max(0.01, maxP - minP);
  const ratio = (price - minP) / span;
  const clamped = Math.max(0, Math.min(1, ratio));
  return Number((CHART_LEFT + clamped * (CHART_RIGHT - CHART_LEFT)).toFixed(1));
}

@Component({
  selector: 'app-microstructure-quant-advisor',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './microstructure-quant-advisor.component.html',
  styleUrl: './microstructure-quant-advisor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MicrostructureQuantAdvisorComponent {
  readonly buyOffers = input<readonly BinanceOfferSummary[]>([]);
  readonly sellOffers = input<readonly BinanceOfferSummary[]>([]);
  readonly sanitizedOffers = input<readonly BinanceOfferSummary[]>([]);
  readonly selectedSide = input<'BUY' | 'SELL'>('SELL');
  readonly targetUsdt = input<number>(500);
  readonly refRate = input<number>(0);
  readonly liveBreakEvenSellPrice = input<number>(0);
  readonly avellanedaQuotes = input<AvellanedaStoikovResult | null>(null);
  readonly obiReport = input<OrderBookImbalanceResult | null>(null);
  readonly allBracketsSummary = input<readonly BracketSummaryItem[]>([]);
  readonly selectedBracket = input<BracketId | 'ALL'>('ALL');
  readonly makerVsTakerComparison = input<MakerVsTakerComparison | null>(null);
  readonly sqsResult = input<LiveSpreadQualityResult | null>(null);
  readonly slicingPlan = input<InstitutionalSlicingResult | null>(null);
  readonly historyPoints = input<readonly MarketDataPoint[]>([]);
  readonly freshnessStatus = input<BinanceFreshnessStatus>('LIVE');
  readonly executionLocked = input<boolean>(false);

  readonly operateBracket = output<MicrostructureOperateBracketEvent>();
  readonly applyToDesk = output<void>();
  readonly sendToRepricer = output<void>();
  readonly openAdStudio = output<void>();
  readonly sendTelegramAlert = output<void>();

  readonly CHART_TABS = CHART_TABS;
  readonly activeTab = signal<ChartTab>(CHART_TABS.DEPTH);

  readonly depthGeometry = computed<DepthGeometry>(() => {
    const buys = this.buyOffers()
      .filter((o) => Number.isFinite(o.price) && o.price > 0 && o.maxVes > 0)
      .sort((a, b) => b.price - a.price);
    const sells = this.sellOffers()
      .filter((o) => Number.isFinite(o.price) && o.price > 0 && o.maxVes > 0)
      .sort((a, b) => a.price - b.price);

    if (buys.length === 0 && sells.length === 0) {
      return {
        hasData: false,
        minPrice: 0,
        maxPrice: 0,
        maxUsdt: 0,
        bidPoints: '',
        bidAreaPoints: '',
        askPoints: '',
        askAreaPoints: '',
        reservationX: null,
        fifoX: null,
        gapRects: [],
      };
    }

    const rStar = this.avellanedaQuotes()?.reservationPrice ?? 0;
    const fifo = this.liveBreakEvenSellPrice();

    const allPrices = [
      ...buys.map((o) => o.price),
      ...sells.map((o) => o.price),
      ...(rStar > 0 ? [rStar] : []),
      ...(fifo > 0 ? [fifo] : []),
    ];
    const rawMin = Math.min(...allPrices);
    const rawMax = Math.max(...allPrices);
    const pad = Math.max(0.5, (rawMax - rawMin) * 0.08);
    const minPrice = rawMin - pad;
    const maxPrice = rawMax + pad;

    let bidCum = 0;
    const bidNodes = buys.map((o) => {
      bidCum += o.maxVes / o.price;
      return { price: o.price, cum: bidCum };
    });

    let askCum = 0;
    const askNodes = sells.map((o) => {
      askCum += o.maxVes / o.price;
      return { price: o.price, cum: askCum };
    });

    const maxUsdt = Math.max(1, bidCum, askCum);
    const mapY = (cum: number): number => {
      const ratio = Math.max(0, Math.min(1, cum / maxUsdt));
      return Number((CHART_BOTTOM - ratio * (CHART_BOTTOM - CHART_TOP)).toFixed(1));
    };

    const bidCoords = bidNodes.map((n) => `${mapPriceToX(n.price, minPrice, maxPrice)},${mapY(n.cum)}`);
    const askCoords = askNodes.map((n) => `${mapPriceToX(n.price, minPrice, maxPrice)},${mapY(n.cum)}`);

    const bidPoints = bidCoords.join(' ');
    const bidAreaPoints =
      bidNodes.length > 0
        ? `${mapPriceToX(bidNodes[0].price, minPrice, maxPrice)},${CHART_BOTTOM} ${bidPoints} ${mapPriceToX(bidNodes[bidNodes.length - 1].price, minPrice, maxPrice)},${CHART_BOTTOM}`
        : '';

    const askPoints = askCoords.join(' ');
    const askAreaPoints =
      askNodes.length > 0
        ? `${mapPriceToX(askNodes[0].price, minPrice, maxPrice)},${CHART_BOTTOM} ${askPoints} ${mapPriceToX(askNodes[askNodes.length - 1].price, minPrice, maxPrice)},${CHART_BOTTOM}`
        : '';

    const gaps = this.obiReport()?.gaps ?? [];
    const gapRects: DepthGapRect[] = gaps.slice(0, 4).map((gap) => {
      const x1 = mapPriceToX(gap.fromPrice, minPrice, maxPrice);
      const x2 = mapPriceToX(gap.toPrice, minPrice, maxPrice);
      const left = Math.min(x1, x2);
      const width = Math.max(8, Math.abs(x2 - x1));
      return {
        x: left,
        width,
        gapPct: gap.gapPct,
        labelX: Number((left + width / 2).toFixed(1)),
      };
    });

    return {
      hasData: true,
      minPrice,
      maxPrice,
      maxUsdt,
      bidPoints,
      bidAreaPoints,
      askPoints,
      askAreaPoints,
      reservationX: rStar > 0 ? mapPriceToX(rStar, minPrice, maxPrice) : null,
      fifoX: fifo > 0 ? mapPriceToX(fifo, minPrice, maxPrice) : null,
      gapRects,
    };
  });

  readonly slippageBars = computed<readonly SlippageBarPoint[]>(() => {
    const offers = [...this.sanitizedOffers()];
    const side = this.selectedSide();
    const currentTicket = this.targetUsdt();

    const raw = SLIPPAGE_TICKETS.map((ticket) => {
      const impact = simulateTradeImpact({
        targetAmountUsdt: ticket,
        side,
        availableOffers: offers,
      });
      return {
        ticketUsdt: ticket,
        label: ticket >= 1000 ? `$${ticket / 1000}K` : `$${ticket}`,
        slippageBps: impact.slippageBps,
        isCurrent: Math.abs(currentTicket - ticket) <= ticket * 0.2,
      };
    });

    const maxBps = Math.max(10, ...raw.map((r) => r.slippageBps));
    return raw.map((r) => ({
      ...r,
      barHeightPct: Math.max(8, Math.min(100, Math.round((r.slippageBps / maxBps) * 100))),
    }));
  });

  readonly pulseGeometry = computed<PulseGeometry>(() => {
    const pts = this.historyPoints()
      .filter((p) => p.bestBuyPrice > 0 && p.bestSellPrice > 0)
      .slice(-24);
    if (pts.length < 2) {
      return { hasPoints: false, pathD: '', areaD: '', minRate: 0, maxRate: 0, lastRate: 0 };
    }

    const mids = pts.map((p) => (p.bestBuyPrice + p.bestSellPrice) / 2);
    const minRate = Math.min(...mids);
    const maxRate = Math.max(...mids);
    const span = Math.max(0.01, maxRate - minRate);

    const coords = mids.map((val, i) => {
      const x = Number((CHART_LEFT + (i / (mids.length - 1)) * (CHART_RIGHT - CHART_LEFT)).toFixed(1));
      const y = Number((CHART_BOTTOM - ((val - minRate) / span) * (CHART_BOTTOM - CHART_TOP)).toFixed(1));
      return { x, y };
    });

    const pathD = coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    const areaD = `${pathD} L ${coords[coords.length - 1].x} ${CHART_BOTTOM} L ${coords[0].x} ${CHART_BOTTOM} Z`;

    return {
      hasPoints: true,
      pathD,
      areaD,
      minRate,
      maxRate,
      lastRate: mids[mids.length - 1],
    };
  });

  readonly isPulseMeasured = computed<boolean>(() => {
    return this.sqsResult()?.volatilitySource === VOLATILITY_SOURCE.MEASURED;
  });

  readonly sqsFactors = computed<readonly SqsFactorItem[]>(() => {
    const sqs = this.sqsResult();
    if (!sqs) return [];
    const weakest = sqs.weakestFactor;
    return [
      {
        key: 'netMargin',
        label: 'Margen Neto',
        score: sqs.factors.netMarginScore,
        weightLabel: '35%',
        isWeakest: weakest === 'netMargin',
      },
      {
        key: 'safety',
        label: 'Seguridad Vol',
        score: sqs.factors.safetyScore,
        weightLabel: '25%',
        isWeakest: weakest === 'safety',
      },
      {
        key: 'velocity',
        label: 'Velocidad Banco',
        score: sqs.factors.velocityScore,
        weightLabel: '25%',
        isWeakest: weakest === 'velocity',
      },
      {
        key: 'limitHealth',
        label: 'Salud SUDEBAN',
        score: sqs.factors.limitHealthScore,
        weightLabel: '15%',
        isWeakest: weakest === 'limitHealth',
      },
    ];
  });

  setTab(tab: ChartTab): void {
    this.activeTab.set(tab);
  }

  onTabKeydown(event: KeyboardEvent): void {
    const order: readonly ChartTab[] = [CHART_TABS.DEPTH, CHART_TABS.SLIPPAGE, CHART_TABS.PULSE];
    const currentIdx = order.indexOf(this.activeTab());
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.activeTab.set(order[(currentIdx + 1) % order.length]);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.activeTab.set(order[(currentIdx - 1 + order.length) % order.length]);
    }
  }

  formatBracketUsdtRange(minVes: number, maxVes: number): string {
    const rate = this.refRate();
    if (!Number.isFinite(rate) || rate <= 0) {
      return 'N/D USDT';
    }
    const minUsd = Math.round(minVes / rate);
    const maxUsd = Math.round(maxVes / rate);
    return `~$${minUsd.toLocaleString('en-US')} - $${maxUsd.toLocaleString('en-US')} USDT`;
  }

  bracketKeyNumber(id: BracketId): string {
    if (id === 'INFRAMUNDO') return '1';
    if (id === 'MEDIO') return '2';
    return '3';
  }

  onOperateBracket(item: BracketSummaryItem): void {
    if (this.executionLocked() || !item.hasLiquidity || item.result.bestPrice <= 0) return;
    this.operateBracket.emit({
      bracketId: item.bracket.id,
      side: this.selectedSide(),
      price: item.result.bestPrice,
    });
  }
}
