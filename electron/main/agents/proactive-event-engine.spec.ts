import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProactiveEventEngine, detectUsdtDepegParity } from './proactive-event-engine';
import type { P2PDatabaseService } from '../db/database';

describe('ProactiveEventEngine (Event-Driven Proactive IA)', () => {
  let engine: ProactiveEventEngine;
  let mockDb: any;
  let sentEvents: Array<{ channel: string; payload: any }>;

  beforeEach(() => {
    sentEvents = [];
    mockDb = {
      saveEngramObservation: vi.fn().mockReturnValue(1),
    };
    engine = new ProactiveEventEngine(mockDb as unknown as P2PDatabaseService, (channel, payload) => {
      sentEvents.push({ channel, payload });
    });
  });

  describe('detectUsdtDepegParity', () => {
    it('returns PEGGED when spot price is within ±0.2%', () => {
      const res = detectUsdtDepegParity(1.000, 0.2);
      expect(res.isDepegged).toBe(false);
      expect(res.status).toBe('PEGGED');
    });

    it('returns DEPEG_DISCOUNT and CRITICAL when price drops below 0.990 (-1%)', () => {
      const res = detectUsdtDepegParity(0.985, 0.2);
      expect(res.isDepegged).toBe(true);
      expect(res.status).toBe('DEPEG_DISCOUNT');
      expect(res.riskSeverity).toBe('CRITICAL');
    });

    it('returns DEPEG_PREMIUM when price exceeds 1.002 (+0.2%)', () => {
      const res = detectUsdtDepegParity(1.005, 0.2);
      expect(res.isDepegged).toBe(true);
      expect(res.status).toBe('DEPEG_PREMIUM');
    });
  });

  describe('evaluateBcvMacroEvent', () => {
    it('triggers CRITICAL alert on extreme gap >= 28%', () => {
      // Parallel 90, BCV 65 -> gap ~38%
      const alert = engine.evaluateBcvMacroEvent(90, 65);
      expect(alert).not.toBeNull();
      expect(alert?.severity).toBe('CRITICAL');
      expect(alert?.type).toBe('BCV_GAP_ANOMALY');
      expect(mockDb.saveEngramObservation).toHaveBeenCalledTimes(1);
      expect(sentEvents.length).toBe(1);
      expect(sentEvents[0].channel).toBe('copilot:proactive-event-alert');
    });

    it('debounces repeat alerts within the throttle window', () => {
      const first = engine.evaluateBcvMacroEvent(90, 65);
      const second = engine.evaluateBcvMacroEvent(90, 65);
      expect(first).not.toBeNull();
      expect(second).toBeNull(); // Debounced
      expect(mockDb.saveEngramObservation).toHaveBeenCalledTimes(1);
    });
  });

  describe('evaluateUsdtDepegEvent', () => {
    it('emits CRITICAL alert with autoKillswitch flag on severe depeg', () => {
      const alert = engine.evaluateUsdtDepegEvent(0.980);
      expect(alert).not.toBeNull();
      expect(alert?.type).toBe('USDT_DEPEG_WARNING');
      expect(alert?.severity).toBe('CRITICAL');
      expect(alert?.autoKillswitch).toBe(true);
      expect(mockDb.saveEngramObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          topicKey: 'risk/usdt-depeg',
          status: 'active',
        })
      );
    });

    it('does not emit alert when USDT is pegged normally', () => {
      const alert = engine.evaluateUsdtDepegEvent(1.000);
      expect(alert).toBeNull();
      expect(mockDb.saveEngramObservation).not.toHaveBeenCalled();
    });
  });
});
