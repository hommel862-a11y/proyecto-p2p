import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { IncomeCalculator } from './income-calculator';

describe('IncomeCalculator (Smart Multi-Mode)', () => {
  let fixture: ComponentFixture<IncomeCalculator>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [IncomeCalculator] });
  });

  function create(): ComponentFixture<IncomeCalculator> {
    return TestBed.createComponent(IncomeCalculator);
  }

  describe('Mode A: Cycle Arbitrage & Velocity Projections', () => {
    it('computes cycle results and velocity projections', () => {
      const f = create();
      const c = f.componentInstance;
      c.activeMode.set('cycle');
      c.capitalUsdt.set(1000);
      c.buyPrice.set(60);
      c.sellPrice.set(61.2);
      f.detectChanges();

      const res = c.cycleResult();
      expect(res).not.toBeNull();
      expect(res!.capitalVesInvested).toBe(60000);
      expect(res!.roiCyclePct).toBeGreaterThan(0);

      const projections = c.velocityProjections();
      expect(projections.length).toBe(4);
      expect(projections[0].cyclesPerDay).toBe(1);
      expect(projections[3].cyclesPerDay).toBe(10);
      expect(projections[3].dailyGainUsd).toBeCloseTo(projections[0].dailyGainUsd * 10, 1);
    });
  });

  describe('Mode B: Reverse Goal Sizing', () => {
    it('computes required cycles and bank volume to reach target', () => {
      const f = create();
      const c = f.componentInstance;
      c.activeMode.set('reverse');
      c.targetGoalUsd.set(30);
      c.availableCapitalGoal.set(1000);
      c.buyPrice.set(60);
      c.sellPrice.set(61.2);
      f.detectChanges();

      const goal = c.reverseGoalResult();
      expect(goal).not.toBeNull();
      expect(goal!.requiredCycles).toBeGreaterThan(0);
      expect(goal!.isFeasible).toBe(true);
      expect(goal!.totalDailyBankVolumeVes).toBeGreaterThan(0);
    });
  });

  describe('Mode C: Classic Discipline Table', () => {
    it('verified: $20/day @ 10% @ 365 days => capital $73,000 (annual $7,300)', () => {
      const f = create();
      const c = f.componentInstance;
      c.activeMode.set('classic');
      c.targetUsd.set(20);
      c.aprPct.set(10);
      c.daysPerYear.set(365);
      f.detectChanges();
      expect(c.annual()).toBe(7300);
      expect(c.capital()).toBe(73000);
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

    it('clampMoney template helper collapses NaN/negative entries to 0', () => {
      const f = create();
      const c = f.componentInstance;
      expect(c.clampMoney(Number.NaN)).toBe(0);
      expect(c.clampMoney(-10)).toBe(0);
      expect(c.clampMoney(20)).toBe(20);
    });
  });
});
