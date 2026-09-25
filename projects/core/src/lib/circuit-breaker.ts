/**
 * Circuit Breaker with Exponential Backoff and Full Jitter.
 * Pure, framework-agnostic resilience engine for distributed P2P market data providers.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreakerOpenError extends Error {
  readonly state = 'OPEN' as const;
  constructor(
    message: string = 'Circuit breaker is OPEN. Fast-failing request to protect downstream service.',
  ) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreakerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'CircuitBreakerTimeoutError';
  }
}

export interface CircuitBreakerOptions {
  /** Consecutive failures required to trip the breaker into OPEN (default: 5) */
  failureThreshold?: number;
  /** Consecutive successes in HALF_OPEN required to close the circuit (default: 2) */
  successThreshold?: number;
  /** Cooldown time in ms before transitioning from OPEN to HALF_OPEN (default: 30_000) */
  cooldownPeriodMs?: number;
  /** Maximum duration in ms for a single attempt before timing out (default: 10_000) */
  requestTimeoutMs?: number;
  /** Maximum retry attempts per execution (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 400) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms for exponential backoff (default: 5_000) */
  maxDelayMs?: number;
  /** Whether to add randomized full jitter to prevent thundering herds (default: true) */
  jitter?: boolean;
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalExecutions: number;
  totalSuccesses: number;
  totalFailures: number;
  totalRejections: number;
}

/**
 * Calculates exponential backoff with optional full jitter.
 * delay = min(maxDelay, baseDelay * 2^attempt)
 * with full jitter: Math.random() * delay
 */
export function calculateBackoffWithJitter(
  attempt: number,
  baseDelayMs = 400,
  maxDelayMs = 5000,
  jitter = true,
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  if (!jitter) {
    return exponential;
  }
  return Math.floor(Math.random() * exponential);
}

export class CircuitBreaker {
  readonly options: Required<CircuitBreakerOptions>;

  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalExecutions = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private totalRejections = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      successThreshold: options.successThreshold ?? 2,
      cooldownPeriodMs: options.cooldownPeriodMs ?? 30_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
      maxRetries: options.maxRetries ?? 1,
      baseDelayMs: options.baseDelayMs ?? 400,
      maxDelayMs: options.maxDelayMs ?? 5_000,
      jitter: options.jitter ?? true,
    };
  }

  getState(): CircuitState {
    this.evaluateStateTransitions();
    return this.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    this.evaluateStateTransitions();
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalExecutions: this.totalExecutions,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalRejections: this.totalRejections,
    };
  }

  /**
   * Manually resets the circuit breaker back to initial CLOSED state.
   */
  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  /**
   * Executes an async operation protected by timeout, retries with backoff, and circuit state.
   */
  async execute<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    fallback?: T | (() => Promise<T> | T),
  ): Promise<T> {
    this.totalExecutions++;
    this.evaluateStateTransitions();

    if (this.state === 'OPEN') {
      this.totalRejections++;
      if (fallback !== undefined) {
        return typeof fallback === 'function'
          ? await (fallback as () => Promise<T> | T)()
          : fallback;
      }
      throw new CircuitBreakerOpenError();
    }

    let lastError: unknown = null;
    const maxAttempts = this.state === 'HALF_OPEN' ? 1 : Math.max(1, this.options.maxRetries);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const backoffMs = calculateBackoffWithJitter(
          attempt - 1,
          this.options.baseDelayMs,
          this.options.maxDelayMs,
          this.options.jitter,
        );
        await this.sleep(backoffMs);
      }

      try {
        const result = await this.executeWithTimeout(operation, this.options.requestTimeoutMs);
        this.recordSuccess();
        return result;
      } catch (err) {
        lastError = err;
      }
    }

    this.recordFailure();

    if (fallback !== undefined) {
      return typeof fallback === 'function'
        ? await (fallback as () => Promise<T> | T)()
        : fallback;
    }

    throw lastError;
  }

  private evaluateStateTransitions(): void {
    if (this.state === 'OPEN' && this.lastFailureTime !== null) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.options.cooldownPeriodMs) {
        this.state = 'HALF_OPEN';
        this.consecutiveSuccesses = 0;
      }
    }
  }

  private recordSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.options.successThreshold) {
        this.state = 'CLOSED';
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
      }
    } else {
      this.consecutiveFailures = 0;
    }
  }

  private recordFailure(): void {
    this.totalFailures++;
    this.lastFailureTime = Date.now();
    this.consecutiveFailures++;

    if (this.state === 'HALF_OPEN') {
      // Immediate trip back to OPEN if probe fails in HALF_OPEN
      this.state = 'OPEN';
      this.consecutiveSuccesses = 0;
    } else if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  private async executeWithTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new CircuitBreakerTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      return await Promise.race([operation(controller.signal), timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
