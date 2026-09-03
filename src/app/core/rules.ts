import { Injectable, inject, signal } from '@angular/core';
import {
  clampAtLeast,
  clampNonNegative,
  evaluate,
  type Decision,
  type RuleContext,
  type RuleVerdict,
} from '@p2p/core';
import { StorageService } from './storage';
import { AuditLoggerService } from './audit-logger.service';

/** The six configurable safety-barrier rules (single source of truth). */
export interface RiskConfig {
  /** minimum acceptable unit spread (VES/USDT). Drives spread-monitor alerts. */
  minSpread: number;
  /** max concurrent operations allowed before PAUSE. */
  maxConcurrentOps: number;
  /** max risk per trade as a percentage (e.g. 1 = 1%). */
  maxRiskPerTradePct: number;
  /** daily loss cap as a percentage (e.g. 4 = 4%). */
  dailyLossCapPct: number;
  /** consecutive error-tagged ops that trigger PAUSE. */
  maxConsecutiveErrors: number;
  /** API health stub. Inactive in MVP (no API). */
  apiStatus: 'ok' | 'down';
}

const STORAGE_KEY = 'p2p.risk-config';

const DEFAULT_CONFIG: RiskConfig = {
  minSpread: 15,
  maxConcurrentOps: 3,
  maxRiskPerTradePct: 1,
  dailyLossCapPct: 4,
  maxConsecutiveErrors: 3,
  apiStatus: 'ok',
};

/**
 * Clamp/sanitize a config so it can never poison the decision engine.
 * Non-finite and negative numeric values collapse to sensible floors: counts/thresholds
 * that must be at least 1 (maxConcurrentOps, maxConsecutiveErrors) use `clampAtLeast`,
 * money-ish values collapse to >= 0.
 */
export function sanitizeConfig(cfg: RiskConfig): RiskConfig {
  return {
    ...cfg,
    minSpread: clampNonNegative(cfg.minSpread),
    maxConcurrentOps: Math.round(clampAtLeast(cfg.maxConcurrentOps, 1)),
    maxRiskPerTradePct: clampNonNegative(cfg.maxRiskPerTradePct),
    dailyLossCapPct: clampNonNegative(cfg.dailyLossCapPct),
    maxConsecutiveErrors: Math.round(clampAtLeast(cfg.maxConsecutiveErrors, 1)),
    apiStatus: cfg.apiStatus === 'down' ? 'down' : 'ok',
  };
}

/**
 * App-wide risk-rules singleton. Holds the persisted {@link RiskConfig}, merges it into
 * every {@link evaluate} call (so the 6 rules use one config), and exposes a sample state
 * for the config view to demonstrate ALLOW/DENY/PAUSE.
 */
@Injectable({ providedIn: 'root' })
export class RisksService {
  private readonly storage = inject(StorageService);
  private readonly audit = inject(AuditLoggerService);

  readonly config = signal<RiskConfig>(this.load());

  private load(): RiskConfig {
    return this.storage.get<RiskConfig>(STORAGE_KEY) ?? { ...DEFAULT_CONFIG };
  }

  save(cfg: RiskConfig): void {
    // Sanitize before persisting so NaN/negative/out-of-range config can't corrupt decisions.
    const clean = sanitizeConfig(cfg);
    this.storage.set(STORAGE_KEY, clean);
    this.config.set(clean);
    this.audit.log(
      'CONFIG_CHANGE',
      'Reglas de riesgo actualizadas',
      {
        minSpread: clean.minSpread,
        maxConcurrentOps: clean.maxConcurrentOps,
        maxRiskPerTradePct: clean.maxRiskPerTradePct,
        dailyLossCapPct: clean.dailyLossCapPct,
        maxConsecutiveErrors: clean.maxConsecutiveErrors,
      },
      'info',
    );
  }

  reset(): void {
    this.save({ ...DEFAULT_CONFIG });
    this.audit.log(
      'CONFIG_CHANGE',
      'Reglas de riesgo restablecidas a valores por defecto',
      undefined,
      'warn',
    );
  }

  /** Evaluate the current operating state against the 6 rules using the live config. */
  evaluate(state: RuleContext): RuleVerdict {
    const c = this.config();
    return evaluate({
      ...state,
      minSpread: state.minSpread ?? c.minSpread,
      maxConcurrentOps: c.maxConcurrentOps,
      maxRiskPerTradePct: c.maxRiskPerTradePct,
      dailyLossCapPct: c.dailyLossCapPct,
      maxConsecutiveErrors: c.maxConsecutiveErrors,
      apiStatus: state.apiStatus ?? c.apiStatus,
    });
  }

  /** A demo state used by the config view to show the engine verdict live. */
  sampleState(): RuleContext {
    const c = this.config();
    return {
      currentSpread: 20,
      minSpread: c.minSpread,
      openOps: 1,
      tradeRiskPct: 0.5,
      dailyLossPct: 1,
      consecutiveErrors: 0,
      apiStatus: c.apiStatus,
    };
  }
}

export type { Decision };
