import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { RouterTestingModule } from '@angular/router/testing';
import { Dashboard } from './dashboard';
import { P2P_STORAGE } from '../../core/storage';
import { MemoryStorage } from '../../core/memory-storage';
import type { Operation } from '@p2p/core';

const OPS_KEY = 'p2p.operations';

function op(partial: Partial<Operation>): Operation {
  return {
    id: 'op-1',
    timestamp: new Date().toISOString(),
    type: 'buy',
    pair: 'USDT',
    vesAmount: 8000,
    usdtAmount: 10,
    price: 800,
    merchantNote: 'Merchant A',
    notes: '',
    fees: 0,
    errorFree: true,
    ...partial,
  };
}

describe('Dashboard', () => {
  let fixture: ComponentFixture<Dashboard>;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      imports: [Dashboard, RouterTestingModule],
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
  });

  function seed(ops: Operation[]): void {
    mem.setItem(OPS_KEY, JSON.stringify(ops));
  }

  function create(): ComponentFixture<Dashboard> {
    return TestBed.createComponent(Dashboard);
  }

  it('renders Control Center panel header', () => {
    const f = create();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Centro de Control');
  });

  it('computes daily progress percentage correctly', () => {
    seed([
      op({
        id: '1',
        type: 'buy',
        vesAmount: 8000,
        usdtAmount: 10,
      }),
      op({
        id: '2',
        type: 'sell',
        vesAmount: 8800,
        usdtAmount: 10,
      }),
    ]);
    const f = create();
    f.detectChanges();
    // Daily target = 20 USD. PnL is ~1 USD -> ~5% progress
    expect(f.componentInstance.dailyProgress()).toBeGreaterThan(0);
  });

  it('renders recent operations list', () => {
    seed([op({ id: 'a', merchantNote: 'Super Merchant' })]);
    const f = create();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Super Merchant');
  });

  it('computes cumulative PnL curve points and toggles between chart tabs', () => {
    seed([
      op({ id: '1', type: 'buy', vesAmount: 8000, usdtAmount: 10 }),
      op({ id: '2', type: 'sell', vesAmount: 8500, usdtAmount: 10 }),
    ]);
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    expect(c.cumulativeChart().points.length).toBeGreaterThan(0);
    expect(c.selectedChartTab()).toBe('cumulative');

    c.selectedChartTab.set('volume');
    f.detectChanges();
    expect(c.selectedChartTab()).toBe('volume');
    expect(f.nativeElement.textContent).toContain('Volumen Diario (USDT)');
  });

  it('computes forensic audit signals and renders forensic card', () => {
    seed([
      op({ id: '1', type: 'buy', vesAmount: 8000, usdtAmount: 10, price: 800 }),
      op({ id: '2', type: 'sell', vesAmount: 8800, usdtAmount: 10, price: 880 }),
    ]);
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    expect(c.forensicDiscipline()).toBeDefined();
    expect(c.forensicDossier()).toBeDefined();
    expect(f.nativeElement.textContent).toContain('Auditoría Forense & Disciplina Operativa');
    expect(f.nativeElement.textContent).toContain('Regla de Oro');
  });
});
