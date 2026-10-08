import fs from 'node:fs';
import path from 'node:path';
import {
  computeHeatmapMatrix,
  formatHeatmapTelegramMessage,
  type MarketTick,
  type HeatmapMatrix,
} from '@p2p/core';

const DATA_LAKE_FILE = path.resolve(process.cwd(), '.data_lake_ticks.json');
const MAX_IN_MEMORY_TICKS = 50_000;

export class MicrostructureDataLake {
  private ticks: MarketTick[] = [];
  private isLoaded = false;

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (this.isLoaded) return;
    try {
      if (fs.existsSync(DATA_LAKE_FILE)) {
        const raw = fs.readFileSync(DATA_LAKE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.ticks = parsed;
          console.log(`[DataLake] Cargados ${this.ticks.length} ticks históricos de microestructura.`);
        }
      }
    } catch (err) {
      console.warn('[DataLake] Error al leer archivo del data lake:', err);
      this.ticks = [];
    }
    this.isLoaded = true;
  }

  private saveToDisk(): void {
    try {
      // Keep within storage cap
      if (this.ticks.length > MAX_IN_MEMORY_TICKS) {
        this.ticks = this.ticks.slice(-MAX_IN_MEMORY_TICKS);
      }
      fs.writeFileSync(DATA_LAKE_FILE, JSON.stringify(this.ticks), 'utf-8');
    } catch (err) {
      console.error('[DataLake] Error al persistir ticks en disco:', err);
    }
  }

  recordTick(tick: MarketTick): void {
    if (!Number.isFinite(tick.timestamp) || !Number.isFinite(tick.netSpreadPct)) {
      return;
    }
    this.ticks.push(tick);
    // Periodically sync every 10 ticks to reduce disk I/O
    if (this.ticks.length % 10 === 0) {
      this.saveToDisk();
    }
  }

  getTicks(sinceTimestamp?: number): MarketTick[] {
    if (!sinceTimestamp) return [...this.ticks];
    return this.ticks.filter((t) => t.timestamp >= sinceTimestamp);
  }

  getHeatmap(daysBack = 30): HeatmapMatrix {
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    const filtered = this.getTicks(cutoff);
    return computeHeatmapMatrix(filtered);
  }

  getHeatmapTelegramText(daysBack = 30): string {
    const matrix = this.getHeatmap(daysBack);
    return formatHeatmapTelegramMessage(matrix);
  }

  compact(maxDaysToKeep = 30): number {
    const cutoff = Date.now() - maxDaysToKeep * 24 * 60 * 60 * 1000;
    const initialCount = this.ticks.length;
    this.ticks = this.ticks.filter((t) => t.timestamp >= cutoff);
    this.saveToDisk();
    return initialCount - this.ticks.length;
  }

  getStats(): { totalTicks: number; oldestTickDate: string | null; newestTickDate: string | null } {
    if (this.ticks.length === 0) {
      return { totalTicks: 0, oldestTickDate: null, newestTickDate: null };
    }
    const oldest = new Date(this.ticks[0].timestamp).toISOString();
    const newest = new Date(this.ticks[this.ticks.length - 1].timestamp).toISOString();
    return { totalTicks: this.ticks.length, oldestTickDate: oldest, newestTickDate: newest };
  }
}
