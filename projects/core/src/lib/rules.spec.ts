import { describe, it, expect } from 'vitest';
import { evaluate, DECISION } from './rules';

describe('evaluate (risk-rules safety barrier)', () => {
  const safe = {
    currentSpread: 20,
    minSpread: 15,
    openOps: 2,
    tradeRiskPct: 0.5,
    dailyLossPct: 1,
    consecutiveErrors: 0,
  };

  it('ALLOW when every condition is within limits', () => {
    const v = evaluate({ ...safe });
    expect(v.decision).toBe(DECISION.ALLOW);
  });

  it('Scenario A: spread below minimum -> DENY', () => {
    const v = evaluate({ ...safe, currentSpread: 10, minSpread: 15 });
    expect(v.decision).toBe(DECISION.DENY);
    expect(v.reason).toMatch(/minimum/i);
  });

  it('Scenario D: risk per trade exceeds 1% -> DENY', () => {
    const v = evaluate({ ...safe, tradeRiskPct: 2, maxRiskPerTradePct: 1 });
    expect(v.decision).toBe(DECISION.DENY);
    expect(v.reason).toMatch(/risk per trade/i);
  });

  it('Scenario B: max concurrent operations reached (default 3) -> PAUSE', () => {
    const v = evaluate({ ...safe, openOps: 3 });
    expect(v.decision).toBe(DECISION.PAUSE);
    expect(v.reason).toMatch(/concurrent/i);
  });

  it('Scenario C: daily loss cap exceeded (default 4%) -> PAUSE', () => {
    const v = evaluate({ ...safe, dailyLossPct: 5 });
    expect(v.decision).toBe(DECISION.PAUSE);
    expect(v.reason).toMatch(/daily loss/i);
  });

  it('Scenario E: API status down -> PAUSE (api-failure)', () => {
    const v = evaluate({ ...safe, apiStatus: 'down' });
    expect(v.decision).toBe(DECISION.PAUSE);
    expect(v.reason).toMatch(/api/i);
  });

  it('pause on consecutive errors (default 3)', () => {
    const v = evaluate({ ...safe, consecutiveErrors: 3 });
    expect(v.decision).toBe(DECISION.PAUSE);
    expect(v.reason).toMatch(/consecutive/i);
  });

  it('applies default maxRiskPerTrade (1%) when unset', () => {
    const v = evaluate({ ...safe, tradeRiskPct: 2 });
    expect(v.decision).toBe(DECISION.DENY);
  });
});
