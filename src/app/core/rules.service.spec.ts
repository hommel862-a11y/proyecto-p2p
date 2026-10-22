import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RisksService,
  sanitizeConfig,
  RISK_PROFILES,
  type RiskConfig,
} from './rules';
import { StorageService } from './storage';
import { AuditLoggerService } from './audit-logger.service';

describe('RisksService', () => {
  let service: RisksService;
  let storedData: Record<string, unknown>;
  let storageMock: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
  let auditMock: {
    log: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    storedData = {};
    storageMock = {
      get: vi.fn((key: string) => storedData[key] ?? null),
      set: vi.fn((key: string, val: unknown) => {
        storedData[key] = val;
      }),
    };
    auditMock = {
      log: vi.fn(),
    };

    const injector = Injector.create({
      providers: [
        { provide: StorageService, useValue: storageMock },
        { provide: AuditLoggerService, useValue: auditMock },
        RisksService,
      ],
    });
    service = injector.get(RisksService);
  });

  it('initializes with default risk config', () => {
    const config = service.config();
    expect(config.minSpread).toBe(15);
    expect(config.minSpreadPct).toBe(1.2);
    expect(config.maxConcurrentOps).toBe(3);
    expect(config.dailyLossCapPct).toBe(4);
    expect(config.apiStatus).toBe('ok');
  });

  it('sanitizes invalid/negative values upon saving', () => {
    const dirty: RiskConfig = {
      minSpread: -10,
      minSpreadPct: -0.5,
      maxConcurrentOps: 0, // should clamp to 1
      maxRiskPerTradePct: -5,
      dailyLossCapPct: -2,
      maxConsecutiveErrors: -1, // should clamp to 1
      apiStatus: 'invalid' as unknown as 'ok',
    };

    const sanitized = sanitizeConfig(dirty);
    expect(sanitized.minSpread).toBe(0);
    expect(sanitized.minSpreadPct).toBe(0);
    expect(sanitized.maxConcurrentOps).toBe(1);
    expect(sanitized.maxConsecutiveErrors).toBe(1);
    expect(sanitized.apiStatus).toBe('ok');

    service.save(dirty);
    const saved = service.config();
    expect(saved.minSpread).toBe(0);
    expect(saved.maxConcurrentOps).toBe(1);
    expect(auditMock.log).toHaveBeenCalledWith(
      'CONFIG_CHANGE',
      expect.stringContaining('actualizadas'),
      expect.anything(),
      'info',
    );
  });

  it('resets config back to factory defaults', () => {
    service.save({
      minSpread: 30,
      minSpreadPct: 3.0,
      maxConcurrentOps: 10,
      maxRiskPerTradePct: 2,
      dailyLossCapPct: 8,
      maxConsecutiveErrors: 5,
      apiStatus: 'down',
    });

    expect(service.config().minSpread).toBe(30);
    service.reset();
    expect(service.config().minSpread).toBe(15);
    expect(service.config().minSpreadPct).toBe(1.2);
    expect(service.config().maxConcurrentOps).toBe(3);
    expect(auditMock.log).toHaveBeenCalledWith(
      'CONFIG_CHANGE',
      expect.stringContaining('restablecidas'),
      undefined,
      'warn',
    );
  });

  it('applies risk profiles correctly', () => {
    service.applyProfile('DEFENSIVE_BCV');
    expect(service.config().minSpread).toBe(RISK_PROFILES.DEFENSIVE_BCV.config.minSpread);
    expect(service.config().minSpreadPct).toBe(2.5);
    expect(service.config().maxConcurrentOps).toBe(1);
    expect(service.config().dailyLossCapPct).toBe(2.0);

    service.applyProfile('AGGRESSIVE_SCALPER');
    expect(service.config().minSpreadPct).toBe(0.6);
    expect(service.config().maxConcurrentOps).toBe(5);
    expect(service.config().dailyLossCapPct).toBe(6.0);
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
