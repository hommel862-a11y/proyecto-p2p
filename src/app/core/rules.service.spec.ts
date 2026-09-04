import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RisksService, sanitizeConfig, type RiskConfig } from './rules';
import { P2P_STORAGE } from './storage';
import { MemoryStorage } from './memory-storage';

describe('RisksService', () => {
  let service: RisksService;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [RisksService, { provide: P2P_STORAGE, useValue: mem }],
    });
    service = TestBed.inject(RisksService);
  });

  it('initializes with default risk config', () => {
    const config = service.config();
    expect(config.minSpread).toBe(15);
    expect(config.maxConcurrentOps).toBe(3);
    expect(config.dailyLossCapPct).toBe(4);
    expect(config.apiStatus).toBe('ok');
  });

  it('sanitizes invalid/negative values upon saving', () => {
    const dirty: RiskConfig = {
      minSpread: -10,
      maxConcurrentOps: 0, // should clamp to 1
      maxRiskPerTradePct: -5,
      dailyLossCapPct: -2,
      maxConsecutiveErrors: -1, // should clamp to 1
      apiStatus: 'invalid' as unknown as 'ok',
    };

    const sanitized = sanitizeConfig(dirty);
    expect(sanitized.minSpread).toBe(0);
    expect(sanitized.maxConcurrentOps).toBe(1);
    expect(sanitized.maxConsecutiveErrors).toBe(1);
    expect(sanitized.apiStatus).toBe('ok');

    service.save(dirty);
    const saved = service.config();
    expect(saved.minSpread).toBe(0);
    expect(saved.maxConcurrentOps).toBe(1);
  });

  it('resets config back to factory defaults', () => {
    service.save({
      minSpread: 30,
      maxConcurrentOps: 10,
      maxRiskPerTradePct: 2,
      dailyLossCapPct: 8,
      maxConsecutiveErrors: 5,
      apiStatus: 'down',
    });

    expect(service.config().minSpread).toBe(30);
    service.reset();
    expect(service.config().minSpread).toBe(15);
    expect(service.config().maxConcurrentOps).toBe(3);
  });

  it('evaluates rule context using the active config and returns a verdict', () => {
    const verdict = service.evaluate({
      currentSpread: 20,
      minSpread: 15,
      openOps: 1,
      tradeRiskPct: 0.5,
      dailyLossPct: 1,
      consecutiveErrors: 0,
      apiStatus: 'ok',
    });

    expect(verdict.decision).toBe('ALLOW');
    expect(verdict.reason).toBe('ok');
  });

  it('triggers DENY when spread is below the configured minimum', () => {
    const verdict = service.evaluate({
      currentSpread: 10, // below 15
      minSpread: 15,
      openOps: 1,
      tradeRiskPct: 0.5,
      dailyLossPct: 1,
      consecutiveErrors: 0,
      apiStatus: 'ok',
    });

    expect(verdict.decision).toBe('DENY');
    expect(verdict.reason).toContain('spread');
  });
});
