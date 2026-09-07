import { Injectable, inject, signal, computed } from '@angular/core';
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

@Injectable({ providedIn: 'root' })
export class MarketHistoryService {
  private readonly storage = inject(StorageService);

  readonly history = signal<MarketDataPoint[]>(this.loadInitial());

  readonly stats = computed<MarketHistoryStats>(() => {
    return calculateHistoryStats(this.history());
  });

  private loadInitial(): MarketDataPoint[] {
    try {
      const stored = this.storage.get<MarketDataPoint[]>(STORAGE_KEY);
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }

  recordSnapshot(point: Omit<MarketDataPoint, 'timestamp'>): void {
    if (!point || point.spreadVes === undefined) return;

    const fullPoint: MarketDataPoint = {
      ...point,
      timestamp: new Date().toISOString(),
    };

    const updated = addSnapshotToHistory(this.history(), fullPoint, MAX_SNAPSHOTS);
    this.history.set(updated);

    try {
      this.storage.set(STORAGE_KEY, updated);
    } catch (err) {
      console.warn('[MarketHistoryService] Failed to persist market history:', err);
    }
  }

  getFilteredPoints(bank: string): MarketDataPoint[] {
    return filterHistoryByBank(this.history(), bank);
  }

  clearHistory(): void {
    this.history.set([]);
    this.storage.remove(STORAGE_KEY);
  }
}
