import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { IncomeCalculator } from './income-calculator';

describe('IncomeCalculator', () => {
  let fixture: ComponentFixture<IncomeCalculator>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [IncomeCalculator] });
  });

  function create(): ComponentFixture<IncomeCalculator> {
    return TestBed.createComponent(IncomeCalculator);
  }

  it('verified: $20/day @ 10% @ 365 days => capital $73,000 (annual $7,300)', () => {
    const f = create();
    const c = f.componentInstance;
    c.targetUsd.set(20);
    c.aprPct.set(10);
    c.daysPerYear.set(365);
    f.detectChanges();
    expect(c.annual()).toBe(7300);
    expect(c.capital()).toBe(73000);
    expect(f.nativeElement.textContent).toContain('73000');
  });

  it('renders the 1/5/20 × 8/10/15% table (365-day basis)', () => {
    const f = create();
    const c = f.componentInstance;
    c.daysPerYear.set(365);
    f.detectChanges();
    const cell = (target: number, band: number) =>
      c.table().find((t) => t.target === target)?.cells[
        c.bands.indexOf(band as (typeof c.bands)[number])
      ];
    expect(cell(20, 10)).toBe(73000);
    expect(cell(1, 8)).toBe(4562.5);
    expect(cell(5, 10)).toBe(18250);
    expect(cell(20, 15)).toBeCloseTo(48666.67, 2);
  });

  it('converts USD capital to Bs using the supplied rate (73,000 @ 800 => 58,400,000)', () => {
    const f = create();
    const c = f.componentInstance;
    c.targetUsd.set(20);
    c.aprPct.set(10);
    c.daysPerYear.set(365);
    c.rate.set(800);
    f.detectChanges();
    expect(c.capitalBs()).toBe(58400000);
  });

  it('guard: zero/negative target => no result', () => {
    const f = create();
    const c = f.componentInstance;
    c.targetUsd.set(0);
    c.aprPct.set(10);
    f.detectChanges();
    expect(c.result()).toBeNull();
    expect(c.capital()).toBe(0);
  });
});
