import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { OperationLog } from './operation-log';
import { P2P_STORAGE } from '../../core/storage';
import { MemoryStorage } from '../../core/memory-storage';
import { type Operation } from '@p2p/core';

function op(over: Partial<Operation> = {}): Operation {
  return {
    id: Math.random().toString(36).slice(2),
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'buy',
    vesAmount: 0,
    usdtAmount: 0,
    price: 0,
    merchantNote: '',
    fees: 0,
    notes: '',
    errorFree: false,
    ...over,
  };
}

describe('OperationLog', () => {
  let fixture: ComponentFixture<OperationLog>;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      imports: [OperationLog],
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
  });

  function create(): ComponentFixture<OperationLog> {
    return TestBed.createComponent(OperationLog);
  }

  it('Scenario B: buy 20,000 VES / 25 USDT @800 then sell 25 USDT @820 => PnL +500 VES', () => {
    const f = create();
    const c = f.componentInstance;
    c.operations.set([
      op({ id: 'a', type: 'buy', vesAmount: 20000, usdtAmount: 25, price: 800 }),
      op({ id: 'b', type: 'sell', usdtAmount: 25, price: 820 }),
    ]);
    f.detectChanges();
    expect(c.summary().pnlVes).toBe(500);
    expect(f.nativeElement.textContent).toContain('500');
  });

  it('zero-error streak updates on error-free tagging', () => {
    const f = create();
    const c = f.componentInstance;
    c.operations.set([op({ errorFree: true }), op({ errorFree: true }), op({ errorFree: false })]);
    expect(c.summary().zeroErrorStreak).toBe(0);
    c.operations.set([op({ errorFree: true }), op({ errorFree: true })]);
    expect(c.summary().zeroErrorStreak).toBe(2);
  });

  it('exposure (net USDT) and capital deployed (net VES) panel values', () => {
    const f = create();
    const c = f.componentInstance;
    c.operations.set([
      op({ id: 'a', type: 'buy', vesAmount: 20000, usdtAmount: 25, price: 800 }),
      op({ id: 'b', type: 'sell', usdtAmount: 25, price: 820 }),
    ]);
    expect(c.summary().exposure).toBe(0);
    expect(c.summary().capitalDeployed).toBe(-500);
  });

  it('export → import is lossless (state identical)', () => {
    const f = create();
    const c = f.componentInstance;
    c.form.set({
      type: 'buy',
      vesAmount: 20000,
      usdtAmount: 25,
      price: 800,
      merchantNote: 'mercado',
      fees: 0,
      notes: '',
      errorFree: true,
    });
    c.add();
    const saved = c.operations()[0];
    const json = c.exportAll();
    mem.clear();
    c.operations.set([]);
    c.importAll(json);
    expect(c.operations().length).toBe(1);
    expect(c.operations()[0]).toEqual(saved);
  });

  it('add() appends an operation and persists it', () => {
    const f = create();
    const c = f.componentInstance;
    c.form.set({
      type: 'buy',
      vesAmount: 20000,
      usdtAmount: 25,
      price: 800,
      merchantNote: 'mercado',
      fees: 0,
      notes: '',
      errorFree: false,
    });
    c.add();
    expect(c.operations().length).toBe(1);
    expect(c.operations()[0].vesAmount).toBe(20000);
    // persisted: a fresh component reading the same storage sees it
    const f2 = TestBed.createComponent(OperationLog);
    expect(f2.componentInstance.operations().length).toBe(1);
  });
});
