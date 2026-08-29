import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { SpreadMonitor } from './spread-monitor';
import { RisksService } from '../../core/rules';
import { P2P_STORAGE } from '../../core/storage';
import { MemoryStorage } from '../../core/memory-storage';

const DEFAULT_RISK = {
  minSpread: 15,
  maxConcurrentOps: 3,
  maxRiskPerTradePct: 1,
  dailyLossCapPct: 4,
  maxConsecutiveErrors: 3,
  apiStatus: 'ok' as const,
};

describe('SpreadMonitor', () => {
  let fixture: ComponentFixture<SpreadMonitor>;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      imports: [SpreadMonitor],
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
    TestBed.inject(RisksService).save({ ...DEFAULT_RISK });
  });

  function create(): ComponentFixture<SpreadMonitor> {
    return TestBed.createComponent(SpreadMonitor);
  }

  it('Scenario A (verified): buy 800 / sell 820 / 25 USDT => +500 Bs, favorable alert', () => {
    const f = create();
    const c = f.componentInstance;
    c.buyPrice.set(800);
    c.sellPrice.set(820);
    c.amount.set(25);
    c.unit.set('USDT');
    c.commissionPct.set(0);
    c.threshold.set(15);
    f.detectChanges();

    expect(c.usdtReceived()).toBe(25);
    expect(c.vesReceived()).toBe(20500);
    expect(c.unitSpread()).toBe(20);
    expect(c.gainVes()).toBe(500);
    expect(c.netVesAfterCommission()).toBe(20500);
    expect(c.alert().kind).toBe('favorable');
    expect(f.nativeElement.textContent).toContain('500');
    expect(f.nativeElement.textContent).toContain('Favorable');
  });

  it('Scenario D (commission 0.35%): net VES = 20,500 * (1 - 0.0035) = 20,428.25', () => {
    const f = create();
    const c = f.componentInstance;
    c.buyPrice.set(800);
    c.sellPrice.set(820);
    c.amount.set(25);
    c.unit.set('USDT');
    c.commissionPct.set(0.35);
    f.detectChanges();
    expect(c.netVesAfterCommission()).toBe(20428.25);
  });

  it('Scenario B (VES input): VES 20,000 => 25 USDT received, 20,500 VES received', () => {
    const f = create();
    const c = f.componentInstance;
    c.buyPrice.set(800);
    c.sellPrice.set(820);
    c.amount.set(20000);
    c.unit.set('VES');
    f.detectChanges();
    expect(c.usdtReceived()).toBe(25);
    expect(c.vesReceived()).toBe(20500);
  });

  it('unfavorable alert when unit spread < risk-rules minSpread', () => {
    const f = create();
    const c = f.componentInstance;
    TestBed.inject(RisksService).save({ ...DEFAULT_RISK, minSpread: 25 });
    c.buyPrice.set(800);
    c.sellPrice.set(820);
    c.amount.set(25);
    c.unit.set('USDT');
    f.detectChanges();
    expect(c.unitSpread()).toBe(20);
    expect(c.alert().kind).toBe('unfavorable');
    expect(f.nativeElement.textContent).toContain('Unfavorable');
  });

  it('Scenario E (invalid): zero/negative price => error message, no result', () => {
    const f = create();
    const c = f.componentInstance;
    c.buyPrice.set(0);
    c.sellPrice.set(820);
    c.amount.set(25);
    c.unit.set('USDT');
    f.detectChanges();
    expect(c.result()).toBeNull();
    expect(c.error()).not.toBeNull();
    expect(f.nativeElement.textContent).toContain('must be a positive number');
  });
});
