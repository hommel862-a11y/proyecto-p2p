/**
 * Autonomous Repricer Engine Controller for 24/7 VPS Daemon.
 * Coordinates dynamic spread anchoring, safety circuit breakers, rate limiting,
 * and state persistence for automated P2P Market Making.
 */

import {
  computeDynamicSpreadAnchors,
  formatDynamicRepricerTelegramMessage,
  type BinanceP2pMarketDepth,
  type DynamicSpreadRecommendation,
  type RepricerStrategy,
  type VolatilityRegime,
} from '@p2p/core';

export interface RepricerEngineConfig {
  enabled?: boolean;
  strategy?: RepricerStrategy;
  baseMinSpreadPct?: number;
  stepVes?: number;
  breakEvenSellPrice?: number;
  maxBuyPrice?: number;
  targetInventoryUsdt?: number;
  currentInventoryUsdt?: number;
  bankSaturationPct?: number;
  minIntervalBetweenUpdatesMs?: number;
}

export interface RepricerEngineState {
  isActive: boolean;
  strategy: RepricerStrategy;
  baseMinSpreadPct: number;
  breakEvenSellPrice: number;
  maxBuyPrice: number;
  targetInventoryUsdt: number;
  currentInventoryUsdt: number;
  bankSaturationPct: number;
  lastDecision: DynamicSpreadRecommendation | null;
  lastUpdateTimestamp: number;
  totalEvaluations: number;
  totalUpdates: number;
  circuitBreakerTripped: boolean;
  circuitTripReason: string | null;
}

export class RepricerEngine {
  private state: RepricerEngineState;
  private minIntervalBetweenUpdatesMs: number;

  constructor(config: RepricerEngineConfig = {}) {
    this.minIntervalBetweenUpdatesMs = config.minIntervalBetweenUpdatesMs ?? 60_000;
    this.state = {
      isActive: config.enabled ?? false,
      strategy: config.strategy ?? 'TOP_1',
      baseMinSpreadPct: config.baseMinSpreadPct ?? 0.6,
      breakEvenSellPrice: config.breakEvenSellPrice ?? 0,
      maxBuyPrice: config.maxBuyPrice ?? 0,
      targetInventoryUsdt: config.targetInventoryUsdt ?? 2000,
      currentInventoryUsdt: config.currentInventoryUsdt ?? 2000,
      bankSaturationPct: config.bankSaturationPct ?? 0,
      lastDecision: null,
      lastUpdateTimestamp: 0,
      totalEvaluations: 0,
      totalUpdates: 0,
      circuitBreakerTripped: false,
      circuitTripReason: null,
    };
  }

  public getState(): Readonly<RepricerEngineState> {
    return { ...this.state };
  }

  public enable(): void {
    this.state.isActive = true;
    this.state.circuitBreakerTripped = false;
    this.state.circuitTripReason = null;
  }

  public disable(): void {
    this.state.isActive = false;
  }

  public resetCircuitBreaker(): void {
    this.state.circuitBreakerTripped = false;
    this.state.circuitTripReason = null;
  }

  public configure(params: Partial<RepricerEngineConfig>): void {
    if (params.enabled !== undefined) this.state.isActive = params.enabled;
    if (params.strategy !== undefined) this.state.strategy = params.strategy;
    if (params.baseMinSpreadPct !== undefined) this.state.baseMinSpreadPct = params.baseMinSpreadPct;
    if (params.breakEvenSellPrice !== undefined) this.state.breakEvenSellPrice = params.breakEvenSellPrice;
    if (params.maxBuyPrice !== undefined) this.state.maxBuyPrice = params.maxBuyPrice;
    if (params.targetInventoryUsdt !== undefined) this.state.targetInventoryUsdt = params.targetInventoryUsdt;
    if (params.currentInventoryUsdt !== undefined) this.state.currentInventoryUsdt = params.currentInventoryUsdt;
    if (params.bankSaturationPct !== undefined) this.state.bankSaturationPct = params.bankSaturationPct;
  }

  public evaluate(
    marketDepth: BinanceP2pMarketDepth,
    bcvGapPct = 0,
    volatilityRegime: VolatilityRegime = 'LOW',
  ): DynamicSpreadRecommendation {
    this.state.totalEvaluations++;

    const decision = computeDynamicSpreadAnchors({
      marketDepth,
      baseMinSpreadPct: this.state.baseMinSpreadPct,
      strategy: this.state.strategy,
      breakEvenSellPrice: this.state.breakEvenSellPrice,
      maxBuyPrice: this.state.maxBuyPrice > 0 ? this.state.maxBuyPrice : undefined,
      volatilityRegime,
      bcvGapPct,
      currentInventoryUsdt: this.state.currentInventoryUsdt,
      targetInventoryUsdt: this.state.targetInventoryUsdt,
      bankSaturationPct: this.state.bankSaturationPct,
      currentBuyPrice: this.state.lastDecision?.recommendedBuyPrice,
      currentSellPrice: this.state.lastDecision?.recommendedSellPrice,
    });

    this.state.lastDecision = decision;

    // Check for critical safety violation to trip circuit breaker
    if (!decision.isSafe && decision.safetyFlags.includes('BANK_SATURATION_CRITICAL')) {
      this.state.circuitBreakerTripped = true;
      this.state.circuitTripReason = decision.reason;
      this.state.isActive = false;
    }

    if (decision.action === 'UPDATE' && this.state.isActive && !this.state.circuitBreakerTripped) {
      const now = Date.now();
      if (now - this.state.lastUpdateTimestamp >= this.minIntervalBetweenUpdatesMs) {
        this.state.lastUpdateTimestamp = now;
        this.state.totalUpdates++;
      }
    }

    return decision;
  }

  public getTelegramStatusMessage(): string {
    if (!this.state.lastDecision) {
      return (
        `🤖 *REPRECIADOR DINÁMICO 24/7*\n\n` +
        `• *Estado:* ${this.state.isActive ? '🟢 ACTIVO' : '🔴 INACTIVO'}\n` +
        `• *Estrategia:* \`${this.state.strategy}\`\n` +
        `• *Spread Mínimo Base:* \`${this.state.baseMinSpreadPct.toFixed(2)}%\`\n` +
        `• *Evaluaciones:* \`${this.state.totalEvaluations}\`\n\n` +
        `_Aún no se ha realizado ninguna evaluación de mercado en este ciclo\\._`
      );
    }

    return formatDynamicRepricerTelegramMessage(this.state.lastDecision, this.state.isActive);
  }
}
