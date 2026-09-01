import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { Stats } from './stats';
import { P2P_STORAGE } from '../../core/storage';
import { MemoryStorage } from '../../core/memory-storage';
import type { Operation } from '@p2p/core';

const OPS_KEY = 'p2p.operations';

function op(partial: Partial<Operation>): Operation {
  return {
    id: 'op-1',
    timestamp: '2026-07-15T12:00:00Z',
    type: 'buy',
    pair: 'USDT',
    vesAmount: 8000,
    usdtAmount: 10,
    price: 800,
    merchantNote: 'n',
    notes: '',
    fees: 0,
    errorFree: true,
    ...partial,
  };
}

describe('Stats', () => {
  let fixture: ComponentFixture<Stats>;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      imports: [Stats],
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
  });

  function seed(ops: Operation[]): void {
    mem.setItem(OPS_KEY, JSON.stringify(ops));
  }

  function create(): ComponentFixture<Stats> {
    return TestBed.createComponent(Stats);
  }

  it('renders empty-state note when the ledger has no operations', () => {
    const f = create();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Aún no hay operaciones registradas');
    expect(f.componentInstance.rows().length).toBe(0);
  });

  it('totals aggregate across daily buckets', () => {
    seed([
      op({
        id: 'a',
        type: 'buy',
        timestamp: '2026-07-15T12:00:00Z',
        vesAmount: 8000,
        usdtAmount: 10,
      }),
      op({
        id: 'b',
        type: 'sell',
        timestamp: '2026-07-15T13:00:00Z',
        vesAmount: 8200,
        usdtAmount: 10,
        fees: 5,
      }),
    ]);
    const f = create();
    f.detectChanges();
    const t = f.componentInstance.totals();
    expect(t.operations).toBe(2);
    expect(t.volumeUsdt).toBe(20);
    expect(t.fees).toBe(5);
  });

  it('switch period changes the returned rows source', () => {
    seed([
      op({ id: 'a', timestamp: '2026-01-05T12:00:00Z' }),
      op({ id: 'b', timestamp: '2026-02-10T12:00:00Z' }),
    ]);
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;
    // daily → 2 buckets; month with the same data → 2 buckets; quarter → 1 bucket (Q1)
    expect(c.rows().length).toBe(2);
    c.setPeriod('month');
    f.detectChanges();
    expect(c.rows().length).toBe(2);
    c.setPeriod('quarter');
    f.detectChanges();
    expect(c.rows().length).toBe(1);
    const firstRow = c.rows()[0];
    expect(firstRow?.period).toContain('Q1');
  });

  it('pair filter limits the aggregated rows', () => {
    seed([
      op({ id: 'a', pair: 'USDT', timestamp: '2026-07-15T12:00:00Z' }),
      op({ id: 'b', pair: 'EUR', timestamp: '2026-07-15T13:00:00Z' }),
    ]);
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;
    expect(c.totals().operations).toBe(2);
    c.setPairFilter('EUR');
    f.detectChanges();
    expect(c.totals().operations).toBe(1);
  });

  it('renders PnL with a favorable (verdict) class when positive', () => {
    seed([
      op({
        id: 'a',
        type: 'buy',
        timestamp: '2026-07-15T12:00:00Z',
        vesAmount: 8000,
        usdtAmount: 10,
      }),
      op({
        id: 'b',
        type: 'sell',
        timestamp: '2026-07-15T13:00:00Z',
        vesAmount: 8200,
        usdtAmount: 10,
      }),
    ]);
    const f = create();
    f.detectChanges();
    const el = f.nativeElement.querySelector('.out .verdict');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('200');
  });

  it('tolerates a malformed ledger (non-array) without throwing', () => {
    mem.setItem(OPS_KEY, JSON.stringify('not-an-array'));
    const f = create();
    f.detectChanges();
    expect(f.componentInstance.rows().length).toBe(0);
    expect(f.componentInstance.totals().operations).toBe(0);
  });
});