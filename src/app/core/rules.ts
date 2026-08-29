import { Injectable, inject, signal } from '@angular/core';
import {
  evaluate,
  type Decision,
  type RuleContext,
  type RuleVerdict,
} from '@p2p/core';
import { StorageService } from './storage';

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
 * App-wide risk-rules singleton. Holds the persisted {@link RiskConfig}, merges it into
 * every {@link evaluate} call (so the 6 rules use one config), and exposes a sample state
 * for the config view to demonstrate ALLOW/DENY/PAUSE.
 */
@Injectable({ providedIn: 'root' })
export class RisksService {
  private readonly storage = inject(StorageService);

  readonly config = signal<RiskConfig>(this.load());

  private load(): RiskConfig {
    return this.storage.get<RiskConfig>(STORAGE_KEY) ?? { ...DEFAULT_CONFIG };
  }

  save(cfg: RiskConfig): void {
    this.storage.set(STORAGE_KEY, cfg);
    this.config.set(cfg);
  }

  reset(): void {
    this.save({ ...DEFAULT_CONFIG });
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
