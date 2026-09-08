import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OperationLog, buildOperationsCsv, CSV_HEADER } from './operation-log';
import { P2P_STORAGE } from '../../core/storage';
import { MemoryStorage } from '../../core/memory-storage';
import { type Operation } from '@p2p/core';

function op(over: Partial<Operation> = {}): Operation {
  return {
    id: Math.random().toString(36).slice(2),
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'buy',
    pair: 'USDT',
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
      pair: 'USDT',
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
    const json = c.serializeBackup();
    const parsed = c.parseBackup(json);
    expect(parsed.length).toBe(1);
    expect(parsed[0]).toEqual(saved);
  });

  it('parseBackup rejects malformed backups', () => {
    const f = create();
    const c = f.componentInstance;
    expect(() => c.parseBackup('{"foo":1}')).toThrow();
    expect(() => c.parseBackup('not json')).toThrow();
  });

  it('add() appends an operation and persists it', () => {
    const f = create();
    const c = f.componentInstance;
    c.form.set({
      type: 'buy',
      pair: 'USDT',
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

  it('add() never stores NaN/negative money into the ledger', () => {
    const f = create();
    const c = f.componentInstance;
    c.form.set({
      type: 'buy',
      pair: 'USDT',
      vesAmount: Number.NaN,
      usdtAmount: -25,
      price: Number.POSITIVE_INFINITY,
      fees: Number.NEGATIVE_INFINITY,
      merchantNote: '',
      notes: '',
      errorFree: false,
    });
    c.add();
    const saved = c.operations()[0];
    expect(saved.vesAmount).toBe(0);
    expect(saved.usdtAmount).toBe(0);
    expect(saved.price).toBe(0);
    expect(saved.fees).toBe(0);
    // no NaN/Infinity leaks into the summary/PnL
    expect(Number.isFinite(c.summary().pnlVes)).toBe(true);
    expect(Number.isFinite(c.summary().pnlUsdt)).toBe(true);
  });

  it('clampMoney template helper collapses invalid money to 0', () => {
    const f = create();
    const c = f.componentInstance;
    expect(c.clampMoney(Number.NaN)).toBe(0);
    expect(c.clampMoney(-5)).toBe(0);
    expect(c.clampMoney(1200)).toBe(1200);
  });

  it('add() on a throwing storage still updates operations and sets the error signal (does not throw)', () => {
    const throwing: Storage = new MemoryStorage() as Storage;
    vi.spyOn(throwing, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    TestBed.overrideProvider(P2P_STORAGE, { useValue: throwing });
    const f = create();
    const c = f.componentInstance;
    c.form.set({
      type: 'buy',
      pair: 'USDT',
      vesAmount: 1000,
      usdtAmount: 1,
      price: 1000,
      merchantNote: '',
      fees: 0,
      notes: '',
      errorFree: false,
    });
    expect(() => c.add()).not.toThrow();
    expect(c.operations().length).toBe(1);
    expect(c.operations()[0].vesAmount).toBe(1000);
    expect(c.error()).toContain('No se pudo guardar');
    // a success path clears the error again
    c.error.set(null);
    vi.mocked(throwing.setItem).mockRestore();
    c.add();
    expect(c.error()).toBeNull();
  });

  it('addAssign appends a treasury assign operation and persists it through the same ledger', () => {
    const f = create();
    const c = f.componentInstance;
    c.assignDraft.set({ vesAmount: 50000, bankAccountId: 'banesco-pm-1', notes: 'fondo', errorFree: true });
    c.addAssign();
    expect(c.operations().length).toBe(1);
    const saved = c.operations()[0];
    expect(saved.type).toBe('assign');
    expect(saved.vesAmount).toBe(50000);
    expect(saved.bankAccountId).toBe('banesco-pm-1');
    // a fresh component reading the same storage sees it (same ledger key)
    const f2 = TestBed.createComponent(OperationLog);
    expect(f2.componentInstance.operations()).toHaveLength(1);
  });

  it('addAssign rejects invalid input and does not persist', () => {
    const f = create();
    const c = f.componentInstance;
    c.assignDraft.set({ vesAmount: 0, bankAccountId: '', notes: '', errorFree: true });
    c.addAssign();
    expect(c.operations().length).toBe(0);
  });

  describe('pair filter', () => {
    it('setPairFilter narrows visibleOps to the selected pair', () => {
      const f = create();
      const c = f.componentInstance;
      c.operations.set([
        op({ id: 'u1', pair: 'USDT' }),
        op({ id: 'e1', pair: 'EUR' }),
        op({ id: 'u2', pair: 'USDT' }),
      ]);
      expect(c.visibleOps().length).toBe(3);
      c.setPairFilter('EUR');
      expect(c.visibleOps().map((o) => o.id)).toEqual(['e1']);
      c.setPairFilter('USDT');
      expect(c.visibleOps().map((o) => o.id)).toEqual(['u1', 'u2']);
      c.setPairFilter('all');
      expect(c.visibleOps().length).toBe(3);
    });

    it('summary reflects only the filtered subset', () => {
      const f = create();
      const c = f.componentInstance;
      c.operations.set([
        op({ id: 'u1', type: 'buy', pair: 'USDT', vesAmount: 20000, usdtAmount: 25, price: 800 }),
        op({ id: 'e1', type: 'buy', pair: 'EUR', vesAmount: 10000, usdtAmount: 10, price: 1000 }),
      ]);
      c.setPairFilter('EUR');
      expect(c.summary().operations).toBe(1);
      expect(c.summary().pnlVes).toBe(-10000);
      expect(c.summary().exposure).toBe(10);
      c.setPairFilter('all');
      expect(c.summary().operations).toBe(2);
      expect(c.summary().pnlVes).toBe(-30000);
    });

    it('filter control stays visible when the filtered list is empty so the user can switch back', () => {
      const f = create();
      const c = f.componentInstance;
      c.operations.set([op({ id: 'u1', pair: 'USDT' })]);
      f.detectChanges();
      c.setPairFilter('EUR');
      f.detectChanges();
      expect(c.visibleOps().length).toBe(0);
      // 5 selects: Tipo + Par + Contraparte CRM + Cuenta Bancaria in the form grid + the pair filter
      expect(f.nativeElement.querySelectorAll('select')).toHaveLength(5);
      expect(f.nativeElement.textContent).toContain('Aún no hay operaciones registradas.');
    });
  });
});

describe('buildOperationsCsv (CSV ledger export)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OperationLog],
      providers: [{ provide: P2P_STORAGE, useValue: new MemoryStorage() }],
    });
  });

  it('starts with a UTF-8 BOM and emits the es-VE header row', () => {
    const csv = buildOperationsCsv([]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(CSV_HEADER);
    expect(csv.split('\r\n')[0].replace('\uFEFF', '')).toBe(
      'Fecha/Hora;Tipo;Par;Monto VES;Monto USDT;Precio;Comisiones;Sin errores;Comercio;Notas',
    );
  });

  it('serializes a full row with ; delimiters and CRLF endings', () => {
    const csv = buildOperationsCsv([
      {
        id: 'x',
        timestamp: '2026-08-29T10:00:00.000Z',
        type: 'buy',
        pair: 'USDT',
        vesAmount: 20000,
        usdtAmount: 25,
        price: 800,
        merchantNote: 'mercado X',
        fees: 5,
        notes: '',
        errorFree: true,
      },
    ]);
    const body = csv.replace('\uFEFF', '');
    const lines = body.split('\r\n');
    expect(lines).toHaveLength(3); // header + 1 row + trailing empty after final CRLF
    expect(lines[1]).toBe('2026-08-29T10:00:00.000Z;compra;USDT;20000;25;800;5;sí;mercado X;');
  });

  it('quotes fields containing ; or " and doubles embedded quotes', () => {
    const csv = buildOperationsCsv([
      {
        id: 'x',
        timestamp: '2026-08-29T10:00:00.000Z',
        type: 'sell',
        pair: 'EUR',
        vesAmount: 0,
        usdtAmount: 10,
        price: 1000,
        merchantNote: 'Hola; "amigo"',
        fees: 0,
        notes: 'l\u00ednea 1\nl\u00ednea 2',
        errorFree: false,
      },
    ]);
    const body = csv.replace('\uFEFF', '');
    const dataLine = body.split('\r\n')[1];
    expect(dataLine).toContain('"Hola; ""amigo"""');
    expect(dataLine).toContain('"l\u00ednea 1\nl\u00ednea 2"');
    expect(dataLine).toContain('venta;EUR');
    expect(dataLine).toContain(';no;');
  });

  it('export reflects the current pair filter (visibleOps)', () => {
    const f = TestBed.createComponent(OperationLog);
    const c = f.componentInstance;
    c.operations.set([
      op({ id: 'u1', pair: 'USDT', timestamp: 't' }),
      op({ id: 'e1', pair: 'EUR', timestamp: 't' }),
      op({ id: 'u2', pair: 'USDT', timestamp: 't' }),
    ]);
    c.setPairFilter('EUR');
    const csv = buildOperationsCsv(c.visibleOps());
    // EUR rows only — count occurrences of ';EUR;' plus check no USDT rows
    expect((csv.match(/;EUR;/g) ?? []).length).toBe(1);
    expect(csv).not.toContain(';USDT;');
  });
});
