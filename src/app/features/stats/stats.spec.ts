import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Stats } from './stats';
import { P2P_STORAGE } from '../../core/storage';
import { MemoryStorage } from '../../core/memory-storage';
import { AccountsService } from '../../core/accounts.service';
import { McpService } from '../../core/mcp.service';
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
      providers: [provideRouter([]), { provide: P2P_STORAGE, useValue: mem }],
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

  it('reactively updates totals and FIFO spread audit when AccountsService refreshes the ledger', () => {
    const f = create();
    f.detectChanges();
    expect(f.componentInstance.totals().operations).toBe(0);
    expect(f.componentInstance.spreadDiscipline().assessmentStatus).toBe('NOT_ASSESSED');

    seed([
      op({
        id: 'buy-1',
        type: 'buy',
        timestamp: '2026-07-15T10:00:00Z',
        vesAmount: 8000,
        usdtAmount: 10,
        price: 800,
      }),
      op({
        id: 'sell-1',
        type: 'sell',
        timestamp: '2026-07-15T12:00:00Z',
        vesAmount: 8160,
        usdtAmount: 10,
        price: 816,
      }),
    ]);

    const accounts = TestBed.inject(AccountsService);
    accounts.refreshLedger();
    f.detectChanges();

    expect(f.componentInstance.totals().operations).toBe(2);
    expect(f.componentInstance.fifoSummary().realizedPnlVes).toBeCloseTo(160);
    expect(f.componentInstance.spreadDiscipline().assessmentStatus).toBe('ASSESSED');
    expect(f.componentInstance.spreadDiscipline().complianceRatePct).toBe(100);
  });

  it('applies pairFilter consistently across calendarMonthView and complianceStatement', () => {
    seed([
      op({ id: 'u1', pair: 'USDT', timestamp: '2026-07-15T10:00:00Z', vesAmount: 8000, usdtAmount: 10 }),
      op({ id: 'e1', pair: 'EUR', timestamp: '2026-07-15T12:00:00Z', vesAmount: 9000, usdtAmount: 10 }),
    ]);
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;
    c.calendarYear.set(2026);
    c.calendarMonth.set(7);
    c.setPairFilter('EUR');
    f.detectChanges();

    expect(c.calendarMonthView().totalOperations).toBe(1);
    expect(c.complianceStatement().totalOperations).toBe(1);
    expect(c.complianceStatement().records[0].pair).toBe('EUR');
  });

  it('does not substitute hardcoded 60.0 Bs when no live reference rate is active', () => {
    seed([
      op({ id: 'u1', type: 'buy', timestamp: '2026-07-15T10:00:00Z', vesAmount: 8000, usdtAmount: 10, price: 800 }),
    ]);
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;
    c.calendarYear.set(2026);
    c.calendarMonth.set(7);
    expect(c.liveMarketRate().rate).toBeNull();
    expect(c.calendarMonthView().totalPnlUsdt).toBe(0);
  });

  it('persists complianceMeta and filters complianceStatement by complianceBankAccountId', () => {
    seed([
      op({ id: 'a1', bankAccountId: 'banesco-pm-1', vesAmount: 8000, usdtAmount: 10 }),
      op({ id: 'a2', bankAccountId: 'mercantil-pm-1', vesAmount: 9000, usdtAmount: 11 }),
    ]);

    const f1 = create();
    f1.detectChanges();
    f1.componentInstance.patchComplianceMeta({
      operatorName: 'Desk Cripto C.A.',
      documentId: 'J-99999999-1',
    });
    f1.componentInstance.selectComplianceBankAccount('mercantil-pm-1');
    f1.detectChanges();

    expect(f1.componentInstance.complianceStatement().totalOperations).toBe(1);
    expect(f1.componentInstance.complianceStatement().records[0].id).toBe('a2');

    const f2 = TestBed.createComponent(Stats);
    f2.detectChanges();
    expect(f2.componentInstance.complianceMeta().operatorName).toBe('Desk Cripto C.A.');
    expect(f2.componentInstance.complianceMeta().documentId).toBe('J-99999999-1');
  });

  it('surfaces MCP errors and preserves UNVERIFIED_NO_COUNTERPARTY_LEDGER verdict honestly', async () => {
    const mcp = TestBed.inject(McpService);
    const f = create();
    f.detectChanges();
    const c = f.componentInstance;

    c.stressRefRate.set(0);
    await c.runStressTest();
    expect(c.mcpStressError()).toContain('mayor a 0');

    vi.spyOn(mcp, 'auditCounterpartyExposure').mockResolvedValueOnce({
      success: true,
      result: {
        complianceVerdict: 'UNVERIFIED_NO_COUNTERPARTY_LEDGER',
        uniqueCounterpartiesCount: null,
        unavailableReason: 'NO_COUNTERPARTY_LEDGER',
        actionable: false,
      },
      executionTimeMs: 5,
    });
    await c.runCounterpartyAudit();
    expect(c.mcpAuditError()).toBeNull();
    expect(c.mcpCounterpartyAuditResult()?.complianceVerdict).toBe(
      'UNVERIFIED_NO_COUNTERPARTY_LEDGER',
    );
  });
});
