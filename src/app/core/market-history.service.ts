import { Injectable, OnDestroy, inject, signal, computed } from '@angular/core';
import { StorageService } from './storage';
import {
  addSnapshotToHistory,
  calculateHistoryStats,
  filterHistoryByBank,
  type MarketDataPoint,
  type MarketHistoryStats,
} from '@p2p/core';

const STORAGE_KEY = 'p2p.market-history';
const MAX_SNAPSHOTS = 200;
const PERSIST_DEBOUNCE_MS = 400;
const DEFAULT_VOLATILITY_WINDOW_MS = 4 * 3600_000;

export type RecordMarketSnapshotInput = Omit<MarketDataPoint, 'timestamp'> & {
  readonly timestamp?: string;
};

@Injectable({ providedIn: 'root' })
export class MarketHistoryService implements OnDestroy {
  private readonly storage = inject(StorageService);

  readonly history = signal<MarketDataPoint[]>(this.loadInitial());

  readonly stats = computed<MarketHistoryStats>(() => {
    return calculateHistoryStats(this.history());
  });

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private hasPendingPersist = false;

  ngOnDestroy(): void {
    this.flushPersistence();
  }

  private loadInitial(): MarketDataPoint[] {
    try {
      const stored = this.storage.get<MarketDataPoint[]>(STORAGE_KEY);
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }

  recordSnapshot(point: RecordMarketSnapshotInput): void {
    if (!point || point.spreadVes === undefined || !Number.isFinite(point.spreadVes)) return;

    const fullPoint: MarketDataPoint = {
      pair: point.pair,
      bank: point.bank,
      bestBuyPrice: point.bestBuyPrice,
      bestSellPrice: point.bestSellPrice,
      spreadVes: point.spreadVes,
      spreadPct: point.spreadPct,
      timestamp: point.timestamp ?? new Date().toISOString(),
    };

    const prev = this.history();
    const updated = addSnapshotToHistory(prev, fullPoint, MAX_SNAPSHOTS);
    this.history.set(updated);
    this.schedulePersistence();
  }

  /**
   * Flushes any pending debounced snapshot write to storage immediately.
   */
  flushPersistence(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.hasPendingPersist) return;

    this.hasPendingPersist = false;
    try {
      this.storage.set(STORAGE_KEY, this.history());
    } catch (err) {
      console.warn('[MarketHistoryService] Failed to persist market history:', err);
    }
  }

  /**
   * Computes measured mid-price standard deviation (% of mean) for `bank` inside `windowMs`.
   * Returns `null` when fewer than 2 valid snapshots exist in the requested window.
   */
  computeWindowVolatilityPct(
    bank: string,
    windowMs = DEFAULT_VOLATILITY_WINDOW_MS,
  ): number | null {
    const bankPoints = filterHistoryByBank(this.history(), bank);
    const cutoffMs = Date.now() - Math.max(0, windowMs);

    const midPrices: number[] = [];
    for (const point of bankPoints) {
      const tsMs = Date.parse(point.timestamp);
      if (!Number.isFinite(tsMs) || tsMs < cutoffMs) continue;

      const buyValid = Number.isFinite(point.bestBuyPrice) && point.bestBuyPrice > 0;
      const sellValid = Number.isFinite(point.bestSellPrice) && point.bestSellPrice > 0;
      if (!buyValid && !sellValid) continue;

      const mid =
        buyValid && sellValid
          ? (point.bestBuyPrice + point.bestSellPrice) / 2
          : buyValid
            ? point.bestBuyPrice
            : point.bestSellPrice;
      if (Number.isFinite(mid) && mid > 0) {
        midPrices.push(mid);
      }
    }

    if (midPrices.length < 2) {
      return null;
    }

    const mean = midPrices.reduce((sum, price) => sum + price, 0) / midPrices.length;
    if (mean <= 0) {
      return null;
    }

    const variance =
      midPrices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / midPrices.length;
    const relativeStdDevPct = (Math.sqrt(variance) / mean) * 100;
    return Number(relativeStdDevPct.toFixed(4));
  }

  getFilteredPoints(bank: string): MarketDataPoint[] {
    return filterHistoryByBank(this.history(), bank);
  }

  clearHistory(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.hasPendingPersist = false;
    this.history.set([]);
    this.storage.remove(STORAGE_KEY);
  }

  private schedulePersistence(): void {
    this.hasPendingPersist = true;
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPersistence();
    }, PERSIST_DEBOUNCE_MS);
  }
}
