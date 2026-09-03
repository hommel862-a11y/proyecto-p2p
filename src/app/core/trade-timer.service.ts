import { Injectable, computed, inject, signal } from '@angular/core';
import { StorageService } from './storage';

export interface TradePreset {
  pair: 'USDT' | 'EUR';
  type: 'buy' | 'sell';
  price: number;
  vesAmount: number;
  usdtAmount: number;
  merchantNote?: string;
}

export type TimerState = 'idle' | 'running' | 'paused';

const TIMER_STORAGE_KEY = 'p2p.active-trade-timer';

interface StoredTimer {
  startedAt: number;
  accumulatedMs: number;
  state: TimerState;
  preset?: TradePreset | null;
}

@Injectable({ providedIn: 'root' })
export class TradeTimerService {
  private readonly storage = inject(StorageService);

  readonly state = signal<TimerState>('idle');
  readonly elapsedMs = signal<number>(0);
  readonly pendingPreset = signal<TradePreset | null>(null);

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private accumulatedMs = 0;

  constructor() {
    this.restoreFromStorage();
  }

  readonly formattedTime = computed(() => {
    const totalSec = Math.floor(this.elapsedMs() / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    if (hours > 0) {
      return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
  });

  start(preset?: TradePreset): void {
    if (this.state() === 'running') return;

    if (preset) {
      this.pendingPreset.set(preset);
    }

    this.startedAt = Date.now();
    this.state.set('running');
    this.persist();

    this.startInterval();
  }

  pause(): void {
    if (this.state() !== 'running') return;

    this.accumulatedMs += Date.now() - this.startedAt;
    this.elapsedMs.set(this.accumulatedMs);
    this.state.set('paused');
    this.clearInterval();
    this.persist();
  }

  resume(): void {
    if (this.state() !== 'paused') return;

    this.startedAt = Date.now();
    this.state.set('running');
    this.persist();
    this.startInterval();
  }

  stop(): number {
    let finalDuration = this.accumulatedMs;
    if (this.state() === 'running') {
      finalDuration += Date.now() - this.startedAt;
    }

    this.reset();
    return Math.max(0, finalDuration);
  }

  reset(): void {
    this.clearInterval();
    this.state.set('idle');
    this.elapsedMs.set(0);
    this.startedAt = 0;
    this.accumulatedMs = 0;
    this.pendingPreset.set(null);
    this.storage.remove(TIMER_STORAGE_KEY);
  }

  consumePendingPreset(): TradePreset | null {
    const p = this.pendingPreset();
    this.pendingPreset.set(null);
    return p;
  }

  private startInterval(): void {
    this.clearInterval();
    this.intervalId = setInterval(() => {
      const current = this.accumulatedMs + (Date.now() - this.startedAt);
      this.elapsedMs.set(current);
    }, 500);
  }

  private clearInterval(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private persist(): void {
    const data: StoredTimer = {
      startedAt: this.startedAt,
      accumulatedMs: this.accumulatedMs,
      state: this.state(),
      preset: this.pendingPreset(),
    };
    this.storage.set(TIMER_STORAGE_KEY, data);
  }

  private restoreFromStorage(): void {
    const saved = this.storage.get<StoredTimer>(TIMER_STORAGE_KEY);
    if (!saved) return;

    this.accumulatedMs = saved.accumulatedMs;
    this.pendingPreset.set(saved.preset ?? null);

    if (saved.state === 'running') {
      this.startedAt = saved.startedAt;
      this.accumulatedMs += Date.now() - saved.startedAt;
      this.elapsedMs.set(this.accumulatedMs);
      this.state.set('running');
      this.startInterval();
    } else if (saved.state === 'paused') {
      this.elapsedMs.set(saved.accumulatedMs);
      this.state.set('paused');
    }
  }
}
