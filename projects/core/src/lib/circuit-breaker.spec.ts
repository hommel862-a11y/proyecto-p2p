import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
  calculateBackoffWithJitter,
} from './circuit-breaker';

describe('CircuitBreaker & Exponential Backoff', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe('calculateBackoffWithJitter', () => {
    it('calculates deterministic exponential delay without jitter', () => {
      expect(calculateBackoffWithJitter(0, 100, 1000, false)).toBe(100);
      expect(calculateBackoffWithJitter(1, 100, 1000, false)).toBe(200);
      expect(calculateBackoffWithJitter(2, 100, 1000, false)).toBe(400);
      expect(calculateBackoffWithJitter(3, 100, 1000, false)).toBe(800);
      expect(calculateBackoffWithJitter(4, 100, 1000, false)).toBe(1000); // capped at maxDelay
    });

    it('adds jitter within [0, exponential] range', () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const val = calculateBackoffWithJitter(attempt, 200, 2000, true);
        const maxExpected = Math.min(2000, 200 * Math.pow(2, attempt));
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(maxExpected);
      }
    });
  });

  describe('State transitions and resilience execution', () => {
    it('executes successfully in CLOSED state', async () => {
      const breaker = new CircuitBreaker({ baseDelayMs: 10 });
      const mockOp = vi.fn().mockResolvedValue('market_data_ok');

      const result = await breaker.execute(mockOp);
      expect(result).toBe('market_data_ok');
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getMetrics().totalSuccesses).toBe(1);
    });

    it('retries on transient failure and recovers if subsequent attempt succeeds', async () => {
      const breaker = new CircuitBreaker({ maxRetries: 3, baseDelayMs: 1 });
      const mockOp = vi
        .fn()
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockResolvedValueOnce('recovered_data');

      const result = await breaker.execute(mockOp);
      expect(result).toBe('recovered_data');
      expect(mockOp).toHaveBeenCalledTimes(2);
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('trips to OPEN state when consecutive failures reach failureThreshold', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        maxRetries: 1,
        baseDelayMs: 1,
      });

      const failingOp = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));

      // Execution 1
      await expect(breaker.execute(failingOp)).rejects.toThrow('Connection reset by peer');
      expect(breaker.getState()).toBe('CLOSED');

      // Execution 2 -> reaches failureThreshold of 2
      await expect(breaker.execute(failingOp)).rejects.toThrow('Connection reset by peer');
      expect(breaker.getState()).toBe('OPEN');
    });

    it('fast-fails immediately without touching network when circuit is OPEN', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        maxRetries: 1,
        cooldownPeriodMs: 60_000,
      });

      const mockOp = vi.fn().mockRejectedValue(new Error('Fatal 500'));
      await expect(breaker.execute(mockOp)).rejects.toThrow('Fatal 500');
      expect(breaker.getState()).toBe('OPEN');

      // Next call should fail immediately with CircuitBreakerOpenError
      const untouchedOp = vi.fn().mockResolvedValue('should_not_run');
      await expect(breaker.execute(untouchedOp)).rejects.toThrow(CircuitBreakerOpenError);
      expect(untouchedOp).not.toHaveBeenCalled();
      expect(breaker.getMetrics().totalRejections).toBe(1);
    });

    it('returns fallback data when circuit is OPEN or when execution fails', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        maxRetries: 1,
        cooldownPeriodMs: 60_000,
      });

      const failingOp = vi.fn().mockRejectedValue(new Error('Network offline'));
      const fallbackValue = { cachedRate: 45.2 };

      // When execution fails, fallback is returned instead of re-throwing
      const res1 = await breaker.execute(failingOp, fallbackValue);
      expect(res1).toEqual(fallbackValue);
      expect(breaker.getState()).toBe('OPEN');

      // When breaker is OPEN, fallback function is evaluated directly
      const fallbackFn = vi.fn().mockReturnValue({ cachedRate: 45.2, isStale: true });
      const res2 = await breaker.execute(failingOp, fallbackFn);
      expect(res2).toEqual({ cachedRate: 45.2, isStale: true });
      expect(fallbackFn).toHaveBeenCalled();
    });

    it('transitions from OPEN to HALF_OPEN after cooldown period and closes on success', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        maxRetries: 1,
        successThreshold: 2,
        cooldownPeriodMs: 50,
      });

      // Trip to OPEN
      await expect(breaker.execute(vi.fn().mockRejectedValue(new Error('Timeout')))).rejects.toThrow();
      expect(breaker.getState()).toBe('OPEN');

      // Wait for cooldown to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(breaker.getState()).toBe('HALF_OPEN');

      // First success in HALF_OPEN (requires 2 to close)
      await breaker.execute(vi.fn().mockResolvedValue('probe_1_ok'));
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Second success in HALF_OPEN -> closes breaker
      await breaker.execute(vi.fn().mockResolvedValue('probe_2_ok'));
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('trips immediately back to OPEN if a probe fails in HALF_OPEN', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        maxRetries: 1,
        cooldownPeriodMs: 30,
      });

      // Trip to OPEN
      await expect(breaker.execute(vi.fn().mockRejectedValue(new Error('Timeout')))).rejects.toThrow();
      expect(breaker.getState()).toBe('OPEN');

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Probe fails in HALF_OPEN -> back to OPEN
      await expect(breaker.execute(vi.fn().mockRejectedValue(new Error('Still down')))).rejects.toThrow(
        'Still down',
      );
      expect(breaker.getState()).toBe('OPEN');
    });

    it('aborts and throws CircuitBreakerTimeoutError when operation exceeds requestTimeoutMs', async () => {
      const breaker = new CircuitBreaker({
        requestTimeoutMs: 30,
        maxRetries: 1,
      });

      const slowOp = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('too_late'), 100)),
      );

      await expect(breaker.execute(slowOp)).rejects.toThrow(CircuitBreakerTimeoutError);
    });

    it('resets to initial CLOSED state on manual reset()', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1 });
      await expect(breaker.execute(vi.fn().mockRejectedValue(new Error('Err')))).rejects.toThrow();
      expect(breaker.getState()).toBe('OPEN');

      breaker.reset();
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getMetrics().consecutiveFailures).toBe(0);
    });
  });
});
