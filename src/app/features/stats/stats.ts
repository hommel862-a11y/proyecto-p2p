import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StorageService } from '../../core/storage';
import { computeStats, type Operation, type PeriodKind, type PeriodStat } from '@p2p/core';

const OPS_KEY = 'p2p.operations';

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stats.html',
})
export class Stats {
  private readonly storage = inject(StorageService);
  readonly period = signal<PeriodKind>('day');
  readonly pairFilter = signal<'all' | 'USDT' | 'EUR'>('all');

  private readonly summary = computed(() =>
    computeStats(this.storage.get<Operation[]>(OPS_KEY) ?? [], this.pairFilter()),
  );

  readonly rows = computed<PeriodStat[]>(() => {
    const s = this.summary();
    if (this.period() === 'day') return s.daily;
    if (this.period() === 'month') return s.monthly;
    return s.quarterly;
  });

  readonly totals = computed(() => {
    const d = this.summary().daily;
    return {
      operations: d.reduce((a, p) => a + p.operations, 0),
      pnlVes: d.reduce((a, p) => a + p.pnlVes, 0),
      volumeUsdt: d.reduce((a, p) => a + p.volumeUsdt, 0),
      fees: d.reduce((a, p) => a + p.fees, 0),
    };
  });

  setPeriod(p: PeriodKind): void {
    this.period.set(p);
  }

  setPairFilter(p: 'all' | 'USDT' | 'EUR'): void {
    this.pairFilter.set(p);
  }

  readonly fmtVes = (v: number): string => `${v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
  readonly fmtUsd = (v: number): string => `${v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
  readonly fmtNum = (v: number): string => v.toLocaleString('es-VE', { maximumFractionDigits: 2 });
}
