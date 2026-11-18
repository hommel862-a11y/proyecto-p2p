import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { OtcWhaleReport, SpoofCategory, SpoofReport } from '@p2p/core';
import type { EnrichedMicrostructureOffer } from '../../../../core/microstructure-engine.service';
import { AUDIT_FILTERS, type AuditFilter, type AuditRowItem } from './microstructure.types';

const WHALE_THRESHOLD_USD = 100_000;

@Component({
  selector: 'app-microstructure-audit-table',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './microstructure-audit-table.component.html',
  styleUrl: './microstructure-audit-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MicrostructureAuditTableComponent {
  readonly enrichedBuyOffers = input<readonly EnrichedMicrostructureOffer[]>([]);
  readonly enrichedSellOffers = input<readonly EnrichedMicrostructureOffer[]>([]);
  readonly selectedSide = input<'BUY' | 'SELL'>('SELL');
  readonly otcWhaleReport = input<OtcWhaleReport | null>(null);
  readonly refRate = input<number>(0);
  readonly spoofReport = input<SpoofReport | null>(null);

  readonly AUDIT_FILTERS = AUDIT_FILTERS;
  readonly isExpanded = signal<boolean>(false);
  readonly activeFilter = signal<AuditFilter>(AUDIT_FILTERS.ALL);

  readonly allRows = computed<readonly AuditRowItem[]>(() => {
    const rate = this.refRate();
    const activeRows =
      this.selectedSide() === 'BUY' ? this.enrichedBuyOffers() : this.enrichedSellOffers();

    return activeRows.map((item) => {
      const estimatedUsd =
        Number.isFinite(rate) && rate > 0 && item.offer.maxVes > 0
          ? Math.round((item.offer.maxVes / rate) * 100) / 100
          : null;
      const isPurged =
        item.spoofCategory === 'SPOOF_BAIT' ||
        item.spoofCategory === 'PHANTOM_LIQUIDITY' ||
        item.spoofCategory === 'SUSPICIOUS_HIGH_TURNOVER';
      const isWhale = estimatedUsd !== null && estimatedUsd >= WHALE_THRESHOLD_USD;

      return {
        offer: item.offer,
        side: item.side,
        spoofCategory: item.spoofCategory,
        lifespanSeconds: item.lifespanSeconds,
        counterpartyReputation: item.counterpartyReputation,
        estimatedUsd,
        isPurged,
        isWhale,
      };
    });
  });

  readonly filteredRows = computed<readonly AuditRowItem[]>(() => {
    const filter = this.activeFilter();
    const rows = this.allRows();

    switch (filter) {
      case AUDIT_FILTERS.LEGITIMATE:
        return rows.filter((r) => r.spoofCategory === 'LEGITIMATE');
      case AUDIT_FILTERS.PURGED:
        return rows.filter((r) => r.isPurged);
      case AUDIT_FILTERS.WHALES:
        return rows.filter((r) => r.isWhale);
      default:
        return rows;
    }
  });

  readonly filterCounts = computed(() => {
    const rows = this.allRows();
    return {
      ALL: rows.length,
      LEGITIMATE: rows.filter((r) => r.spoofCategory === 'LEGITIMATE').length,
      PURGED: rows.filter((r) => r.isPurged).length,
      WHALES: rows.filter((r) => r.isWhale).length,
    };
  });

  toggleExpanded(): void {
    this.isExpanded.update((open) => !open);
  }

  selectFilter(filter: AuditFilter): void {
    this.activeFilter.set(filter);
    this.isExpanded.set(true);
  }

  categoryLabel(category: SpoofCategory): string {
    switch (category) {
      case 'SPOOF_BAIT':
        return 'SPOOF / CEBO';
      case 'PHANTOM_LIQUIDITY':
        return 'FANTASMA';
      case 'SUSPICIOUS_HIGH_TURNOVER':
        return 'SOSPECHOSA';
      default:
        return 'ORGÁNICO';
    }
  }
}
