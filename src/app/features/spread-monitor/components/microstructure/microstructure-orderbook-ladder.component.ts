import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { MarkovFillProbabilityResult } from '@p2p/core';
import type {
  ApparentVsCleanSpreadTrap,
  EnrichedMicrostructureOffer,
} from '../../../../core/microstructure-engine.service';
import type {
  MicrostructureApplyPriceEvent,
  MicrostructureTakeOfferEvent,
  MicrostructureWhatIfPreview,
} from './microstructure.types';

interface LadderDisplayRow {
  readonly item: EnrichedMicrostructureOffer;
  readonly isPurged: boolean;
  readonly isBelowBreakEven: boolean;
  readonly depthScaleX: number;
  readonly cumulativeUsdt: number;
  readonly showReputationBadge: boolean;
}

const MAX_DISPLAY_LEVELS_PER_SIDE = 10;

@Component({
  selector: 'app-microstructure-orderbook-ladder',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './microstructure-orderbook-ladder.component.html',
  styleUrl: './microstructure-orderbook-ladder.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MicrostructureOrderbookLadderComponent {
  readonly buyOffers = input<readonly EnrichedMicrostructureOffer[]>([]);
  readonly sellOffers = input<readonly EnrichedMicrostructureOffer[]>([]);
  readonly cleanModeEnabled = input<boolean>(true);
  readonly liveBreakEvenSellPrice = input<number>(0);
  readonly markovFill = input<MarkovFillProbabilityResult | null>(null);
  readonly trap = input<ApparentVsCleanSpreadTrap | null>(null);
  readonly selectedSide = input<'BUY' | 'SELL'>('SELL');
  readonly executionLocked = input<boolean>(false);
  readonly whatIfPreview = input<MicrostructureWhatIfPreview | null>(null);

  readonly fixPrice = output<MicrostructureApplyPriceEvent>();
  readonly takeOffer = output<MicrostructureTakeOfferEvent>();
  readonly hoverPreview = output<MicrostructureWhatIfPreview | null>();

  readonly sellRows = computed<readonly LadderDisplayRow[]>(() => {
    const breakEven = this.liveBreakEvenSellPrice();
    const sorted = [...this.sellOffers()]
      .slice(0, MAX_DISPLAY_LEVELS_PER_SIDE)
      .sort((a, b) => b.offer.price - a.offer.price);

    // Cumulative depth builds from the inner edge (closest to spread) outward
    const reverseCumulative: number[] = new Array(sorted.length).fill(0);
    let running = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      running += sorted[i].estimatedUsdt;
      reverseCumulative[i] = running;
    }
    const maxCum = Math.max(1, running);

    return sorted.map((item, idx) => ({
      item,
      isPurged:
        item.spoofCategory === 'SPOOF_BAIT' || item.spoofCategory === 'PHANTOM_LIQUIDITY',
      isBelowBreakEven: breakEven > 0 && item.offer.price < breakEven,
      depthScaleX: Math.max(0.06, Math.min(1, reverseCumulative[idx] / maxCum)),
      cumulativeUsdt: reverseCumulative[idx],
      showReputationBadge:
        item.counterpartyReputation !== 'UNKNOWN' && item.counterpartyReputation !== 'NORMAL',
    }));
  });

  readonly buyRows = computed<readonly LadderDisplayRow[]>(() => {
    const sorted = [...this.buyOffers()]
      .slice(0, MAX_DISPLAY_LEVELS_PER_SIDE)
      .sort((a, b) => b.offer.price - a.offer.price);

    let running = 0;
    const cumulative: number[] = sorted.map((item) => {
      running += item.estimatedUsdt;
      return running;
    });
    const maxCum = Math.max(1, running);

    return sorted.map((item, idx) => ({
      item,
      isPurged:
        item.spoofCategory === 'SPOOF_BAIT' || item.spoofCategory === 'PHANTOM_LIQUIDITY',
      isBelowBreakEven: false,
      depthScaleX: Math.max(0.06, Math.min(1, cumulative[idx] / maxCum)),
      cumulativeUsdt: cumulative[idx],
      showReputationBadge:
        item.counterpartyReputation !== 'UNKNOWN' && item.counterpartyReputation !== 'NORMAL',
    }));
  });

  /** Index inside `sellRows()` immediately before the first below-FIFO row (or at end). */
  readonly fifoLineIndex = computed<number>(() => {
    const breakEven = this.liveBreakEvenSellPrice();
    if (!Number.isFinite(breakEven) || breakEven <= 0) return -1;
    const rows = this.sellRows();
    const firstBelow = rows.findIndex((r) => r.isBelowBreakEven);
    return firstBelow === -1 ? rows.length : firstBelow;
  });

  readonly purgedCountInBook = computed<number>(() => {
    return (
      this.sellRows().filter((r) => r.isPurged).length +
      this.buyRows().filter((r) => r.isPurged).length
    );
  });

  onHoverRow(row: LadderDisplayRow): void {
    const { item } = row;
    const breakEven = this.liveBreakEvenSellPrice();
    const deltaVsBreakEvenVes =
      breakEven > 0 && item.side === 'SELL'
        ? Number((item.offer.price - breakEven).toFixed(2))
        : null;

    const oppositeBest =
      item.side === 'SELL'
        ? (this.trap()?.cleanBuyPrice ?? this.buyRows()[0]?.item.offer.price ?? 0)
        : (this.trap()?.cleanSellPrice ?? this.sellRows().at(-1)?.item.offer.price ?? 0);

    let estimatedSpreadPct: number | null = null;
    if (oppositeBest > 0 && item.offer.price > 0) {
      estimatedSpreadPct =
        item.side === 'SELL'
          ? Number((((item.offer.price - oppositeBest) / oppositeBest) * 100).toFixed(2))
          : Number((((oppositeBest - item.offer.price) / item.offer.price) * 100).toFixed(2));
    }

    this.hoverPreview.emit({
      side: item.side,
      price: item.offer.price,
      estimatedUsdt: item.estimatedUsdt,
      merchantName: item.offer.merchantName,
      deltaVsBreakEvenVes,
      estimatedSpreadPct,
      source: 'DOM_ROW_WHAT_IF',
    });
  }

  onClearHover(): void {
    this.hoverPreview.emit(null);
  }

  onFixRow(row: LadderDisplayRow): void {
    if (this.executionLocked()) return;
    this.fixPrice.emit({
      side: row.item.side,
      price: row.item.offer.price,
      merchantName: row.item.offer.merchantName,
      advNo: row.item.offer.advNo,
      source: 'DOM_LADDER_FIJAR',
    });
  }

  onTakeRow(event: Event, row: LadderDisplayRow, preferAdvertiser = false): void {
    event.stopPropagation();
    this.takeOffer.emit({
      offer: row.item.offer,
      side: row.item.side,
      preferAdvertiser,
    });
  }

  hasAdvertiserId(row: LadderDisplayRow): boolean {
    const id = row.item.offer.advertiserNo;
    return typeof id === 'string' && id.trim().length > 0 && id !== 'UNKNOWN';
  }

  hasTakerLock(row: LadderDisplayRow): boolean {
    const o = row.item.offer;
    return (
      (typeof o.buyerRegDaysLimit === 'number' && o.buyerRegDaysLimit > 0) ||
      (typeof o.buyerBtcPositionLimit === 'number' && o.buyerBtcPositionLimit > 0) ||
      (typeof o.buyerKycLimit === 'number' && o.buyerKycLimit > 0) ||
      o.takerAdditionalKycRequired === true
    );
  }
}
