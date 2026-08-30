import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { RiskRules } from './risk-rules';
import { RisksService, sanitizeConfig, type RiskConfig } from '../../core/rules';
import { P2P_STORAGE } from '../../core/storage';
import { MemoryStorage } from '../../core/memory-storage';

const DEFAULT: RiskConfig = {
  minSpread: 15,
  maxConcurrentOps: 3,
  maxRiskPerTradePct: 1,
  dailyLossCapPct: 4,
  maxConsecutiveErrors: 3,
  apiStatus: 'ok',
};

describe('RiskRules', () => {
  let fixture: ComponentFixture<RiskRules>;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      imports: [RiskRules],
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
    TestBed.inject(RisksService).save({ ...DEFAULT });
  });

  function create(): ComponentFixture<RiskRules> {
    return TestBed.createComponent(RiskRules);
  }

  it('default config => engine verdict on sample state is ALLOW (ok)', () => {
    const f = create();
    const c = f.componentInstance;
    f.detectChanges();
    expect(c.verdict().decision).toBe('ALLOW');
    expect(c.verdict().reason).toBe('ok');
    expect(f.nativeElement.textContent).toContain('PERMITIR');
  });

  it('min-spread rule => DENY when spread below configured minimum', () => {
    const f = create();
    const c = f.componentInstance;
    c.draft.set({ ...DEFAULT, minSpread: 25 });
    c.save();
    f.detectChanges();
    expect(c.verdict().decision).toBe('DENY');
    expect(c.verdict().reason).toBe('spread below minimum');
  });

  it('daily-loss rule => PAUSE when daily loss exceeds cap', () => {
    const f = create();
    const c = f.componentInstance;
    const verdict = TestBed.inject(RisksService).evaluate({
      currentSpread: 20,
      minSpread: 15,
      openOps: 1,
      tradeRiskPct: 0.5,
      dailyLossPct: 5,
      consecutiveErrors: 0,
    });
    expect(verdict.decision).toBe('PAUSE');
    expect(verdict.reason).toBe('daily loss cap exceeded');
  });

  it('concurrency rule => PAUSE when open ops reach max', () => {
    const f = create();
    const c = f.componentInstance;
    const verdict = TestBed.inject(RisksService).evaluate({
      currentSpread: 20,
      minSpread: 15,
      openOps: 3,
      tradeRiskPct: 0.5,
      dailyLossPct: 1,
      consecutiveErrors: 0,
    });
    expect(verdict.decision).toBe('PAUSE');
    expect(verdict.reason).toBe('max concurrent operations reached');
  });

  it('save() persists config so a fresh instance reads it', () => {
    const f = create();
    const c = f.componentInstance;
    c.draft.set({ ...DEFAULT, minSpread: 25, maxConcurrentOps: 5 });
    c.save();
    const f2 = TestBed.createComponent(RiskRules);
    expect(f2.componentInstance.config().minSpread).toBe(25);
    expect(f2.componentInstance.config().maxConcurrentOps).toBe(5);
  });

  it('save() sanitizes NaN/negative/out-of-range values (no decision-engine poisoning)', () => {
    const f = create();
    const c = f.componentInstance;
    c.draft.set({
      ...DEFAULT,
      minSpread: -5,
      maxConcurrentOps: Number.NaN,
      maxRiskPerTradePct: Number.POSITIVE_INFINITY,
      dailyLossCapPct: -1,
      maxConsecutiveErrors: 0,
    });
    c.save();
    const cfg = TestBed.inject(RisksService).config();
    expect(cfg.minSpread).toBe(0);
    expect(cfg.maxConcurrentOps).toBe(1);
    expect(cfg.maxRiskPerTradePct).toBe(0);
    expect(cfg.dailyLossCapPct).toBe(0);
    expect(cfg.maxConsecutiveErrors).toBe(1);
    // the live verdict stays finite/typed
    expect(c.verdict()).toBeDefined();
  });
});

describe('sanitizeConfig', () => {
  it('clamps non-finite and negative numeric fields to sensible floors', () => {
    const clean = sanitizeConfig({
      minSpread: Number.NaN,
      maxConcurrentOps: Number.NEGATIVE_INFINITY,
      maxRiskPerTradePct: -3,
      dailyLossCapPct: Number.POSITIVE_INFINITY,
      maxConsecutiveErrors: 0,
      apiStatus: 'down',
    });
    expect(clean.minSpread).toBe(0);
    expect(clean.maxConcurrentOps).toBe(1);
    expect(clean.maxRiskPerTradePct).toBe(0);
    expect(clean.dailyLossCapPct).toBe(0);
    expect(clean.maxConsecutiveErrors).toBe(1);
    expect(clean.apiStatus).toBe('down');
  });

  it('passes valid config through unchanged and normalizes apiStatus', () => {
    const clean = sanitizeConfig({ ...DEFAULT });
    expect(clean).toEqual(DEFAULT);
    expect(sanitizeConfig({ ...DEFAULT, apiStatus: 'bogus' as RiskConfig['apiStatus'] }).apiStatus).toBe('ok');
  });

  it('rounds counts to integers', () => {
    const clean = sanitizeConfig({ ...DEFAULT, maxConcurrentOps: 2.7, maxConsecutiveErrors: 3.2 });
    expect(clean.maxConcurrentOps).toBe(3);
    expect(clean.maxConsecutiveErrors).toBe(3);
  });
});
