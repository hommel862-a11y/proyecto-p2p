import { Component, signal, computed, inject, effect } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  OrderPersistenceTracker,
  computeMicrostructureSanitizedDepth,
  type SpoofReport,
  type OrderClassification,
} from '@p2p/core';
import { BinanceP2pService } from '../../../core/binance-p2p.service';
import { ToastService } from '../../../core/toast.service';

@Component({
  selector: 'app-microstructure-shield',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './microstructure-shield.component.html',
  styleUrl: './microstructure-shield.component.scss',
})
export class MicrostructureShield {
  private readonly binanceService = inject(BinanceP2pService);
  private readonly toast = inject(ToastService);

  readonly tracker = new OrderPersistenceTracker(15);
  readonly selectedSide = signal<'BUY' | 'SELL'>('SELL');
  readonly targetUsdt = signal<number>(100);

  // Ingest snapshots whenever market depth updates
  constructor() {
    effect(() => {
      const depth = this.binanceService.marketDepth();
      if (depth) {
        const now = Date.now();
        if (depth.buyOffers && depth.buyOffers.length > 0) {
          this.tracker.ingestSnapshot(depth.buyOffers, 'BUY', now);
        }
        if (depth.sellOffers && depth.sellOffers.length > 0) {
          this.tracker.ingestSnapshot(depth.sellOffers, 'SELL', now);
        }
      }
    });
  }

  readonly currentDepth = computed(() => this.binanceService.marketDepth());

  readonly activeOffers = computed(() => {
    const depth = this.currentDepth();
    if (!depth) return [];
    return this.selectedSide() === 'BUY' ? depth.buyOffers : depth.sellOffers;
  });

  readonly spoofReport = computed<SpoofReport>(() => {
    // Depend on activeOffers so re-evaluation happens whenever depth changes
    this.activeOffers();
    return this.tracker.generateSpoofReport();
  });

  readonly sanitizedDepth = computed(() => {
    const offers = this.activeOffers();
    return computeMicrostructureSanitizedDepth(
      offers,
      this.selectedSide(),
      this.targetUsdt(),
      this.tracker,
    );
  });

  readonly classifiedOrders = computed<OrderClassification[]>(() => {
    const report = this.spoofReport();
    const side = this.selectedSide();
    return report.classifiedOrders.filter((o) => o.side === side);
  });

  forceScan(): void {
    void this.binanceService.fetchMarketDepth('USDT', 'VES');
    this.toast.info('Escaneando microestructura del libro de órdenes...');
  }

  getRiskLevel(score: number): { label: string; class: string } {
    if (score >= 70) return { label: 'CRÍTICO / MERCADO MANIPULADO', class: 'badge-danger' };
    if (score >= 40) return { label: 'ALERTA / LIQUIDEZ VOLÁTIL', class: 'badge-warning' };
    if (score >= 20) return { label: 'MODERADO', class: 'badge-accent' };
    return { label: 'LIMPIO / ORGÁNICO', class: 'badge-success' };
  }

  getCategoryBadge(category: string): { label: string; class: string } {
    switch (category) {
      case 'SPOOF_BAIT':
        return { label: 'SPOOF / CEBO', class: 'badge-danger' };
      case 'PHANTOM_LIQUIDITY':
        return { label: 'LIQUIDEZ FANTASMA', class: 'badge-purple' };
      case 'SUSPICIOUS_HIGH_TURNOVER':
        return { label: 'ROTACIÓN SOSPECHOSA', class: 'badge-warning' };
      default:
        return { label: 'ORGÁNICA', class: 'badge-success' };
    }
  }
}
