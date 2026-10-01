/**
 * RED tests for the fabricated-measurement defaults in `evaluate_trade_risk` and
 * `simulate_trade_impact`.
 *
 * Both tools declared invented numbers in their Zod schema, and both turned those
 * numbers into an AUTHORIZATION:
 *
 *   - `counterpartyScore: z.number().default(100)` — 100 is a perfect counterparty.
 *   - `currentCapitalUsdt: z.number().default(5000)` — a fabricated treasury.
 *   - `currentExposureUsdt: z.number().default(0)` — asserts "you hold no exposure".
 *   - `maxDailyExposureLimitUsdt: z.number().default(2000)` — a risk limit the user
 *     never chose.
 *
 * `simulate_trade_impact` then returned `verdict: 'SAFE_TO_EXECUTE'` computed from
 * them. That is the most dangerous shape this whole sweep found: not a wrong number,
 * but a green light to move money, derived from nothing.
 *
 * The pattern to kill is the one already established in `ff1067c`: a default does not
 * merely fall into a calculation, it DEACTIVATES the absence branch, so the code
 * that would have said "I can't tell" never runs. `bidDepthUsdt > 0` was always
 * true, so `depthRatio` was never null. Here `projectedExposure > 2000` is answered
 * with a limit nobody chose, so the guard never fires.
 */

import { describe, it, expect } from 'vitest';
import { evaluateTradeRiskTool } from './tools/evaluate_trade_risk.js';
import { simulateTradeImpactTool } from './tools/simulate_trade_impact.js';
import {
  EvaluateTradeRiskInputSchema,
  SimulateTradeImpactInputSchema,
} from './schemas/index.js';

describe('sin dato antes que dato inventado: evaluate_trade_risk', () => {
  describe('el schema no fabrica contraparte ni capital', () => {
    it('no rellena counterpartyScore con una contraparte perfecta', () => {
      const parsed = EvaluateTradeRiskInputSchema.parse({ tradeAmountUsdt: 500 });

      // Before: `100`. A perfect counterparty score is the single most damaging
      // default in the file: it is what makes `isCounterpartyAcceptable: true`.
      expect(parsed.counterpartyScore).toBeUndefined();
    });

    it('no rellena currentCapitalUsdt con una tesorería inventada', () => {
      const parsed = EvaluateTradeRiskInputSchema.parse({ tradeAmountUsdt: 500 });

      expect(parsed.currentCapitalUsdt).toBeUndefined();
    });

    it('el llamante sí puede seguir supplying ambos valores', () => {
      const parsed = EvaluateTradeRiskInputSchema.parse({
        tradeAmountUsdt: 500,
        counterpartyScore: 95,
        currentCapitalUsdt: 5000,
      });

      expect(parsed.counterpartyScore).toBe(95);
      expect(parsed.currentCapitalUsdt).toBe(5000);
    });
  });

  describe('sin capital ni contraparte no hay veredicto de riesgo', () => {
    it('no emite decision cuando falta el capital', () => {
      const res = evaluateTradeRiskTool.execute({
        tradeAmountUsdt: 2500,
        counterpartyScore: 95,
      } as never);

      // 2500/5000 = 50% of capital, which would be a DENY. Against an invented 5000
      // the tool would assert a risk percentage for a treasury it never saw.
      expect(res.decision).toBe('UNAVAILABLE');
      expect(res.tradeRiskPct).toBeNull();
      expect(res.recommendedSizeUsdt).toBeNull();
      expect(res.actionable).toBe(false);
      expect(res.unavailableReason).toBe('missing_evidence:currentCapital');
    });

    it('no emite decision cuando falta la contraparte', () => {
      const res = evaluateTradeRiskTool.execute({
        tradeAmountUsdt: 500,
        currentCapitalUsdt: 5000,
      } as never);

      // The default was 100, so `isCounterpartyAcceptable` was `>= 70` → true.
      expect(res.decision).toBe('UNAVAILABLE');
      expect(res.isCounterpartyAcceptable).toBeNull();
      expect(res.actionable).toBe(false);
      expect(res.unavailableReason).toBe('missing_evidence:counterpartyScore');
    });

    it('no acepta una contraparte por el simple hecho de no haber mandada una', () => {
      const res = evaluateTradeRiskTool.execute({
        tradeAmountUsdt: 500,
        currentCapitalUsdt: 5000,
      } as never);

      // The assertion is explicit: absence is not acceptance. `false` would at least
      // be a claim about a measurement; `true` is a claim about a counterparty that
      // was never scored.
      expect(res.isCounterpartyAcceptable).not.toBe(true);
    });

    it('las violaciones no inventan una regla que no se pudo evaluar', () => {
      const res = evaluateTradeRiskTool.execute({
        tradeAmountUsdt: 500,
        currentCapitalUsdt: 5000,
      } as never);

      // Before: `[verdict.reason]` on a DENY produced by a fabricated context.
      expect(res.violations).toEqual([]);
    });
  });

  describe('con evidencia completa el veredicto sigue siendo real', () => {
    it('permite un trade con contraparte y capital medidos', () => {
      const res = evaluateTradeRiskTool.execute({
        tradeAmountUsdt: 500,
        currentCapitalUsdt: 5000,
        counterpartyScore: 95,
        fiatCurrency: 'VES',
      });

      // 500/5000 = 10%, under the 20% per-trade limit.
      expect(res.decision).toBe('ALLOW');
      expect(res.tradeRiskPct).toBe(10);
      expect(res.isCounterpartyAcceptable).toBe(true);
      expect(res.actionable).toBe(true);
      expect(res.unavailableReason).toBeNull();
    });

    it('rechaza un trade grande con capital medido', () => {
      const res = evaluateTradeRiskTool.execute({
        tradeAmountUsdt: 2500,
        currentCapitalUsdt: 5000,
        counterpartyScore: 95,
        fiatCurrency: 'VES',
      });

      expect(res.decision).toBe('DENY');
      expect(res.tradeRiskPct).toBe(50);
      expect(res.violations.length).toBeGreaterThan(0);
      expect(res.actionable).toBe(true);
    });
  });

  describe('el contexto del motor no se rellena con constantes', () => {
    it('no inventa spread, operaciones abiertas ni pérdida diaria', () => {
      const res = evaluateTradeRiskTool.execute({
        tradeAmountUsdt: 500,
        currentCapitalUsdt: 5000,
        counterpartyScore: 95,
        fiatCurrency: 'VES',
      });

      // `currentSpread: 1.25`, `minSpread: 0.5`, `openOps: 1`, `dailyLossPct: 0`
      // were hardcoded in the RuleContext. `dailyLossPct: 0` is the same crime as
      // `currentExposureUsdt: 0`: it asserts a clean day on a day never measured.
      expect(res.unmeasuredInputs).toContain('currentSpread');
      expect(res.unmeasuredInputs).toContain('minSpread');
      expect(res.unmeasuredInputs).toContain('openOps');
      expect(res.unmeasuredInputs).toContain('dailyLossPct');
    });

    it('declara las entradas ausentes del motor en vez de omitirlas', () => {
      const res = evaluateTradeRiskTool.execute({
        tradeAmountUsdt: 500,
        currentCapitalUsdt: 5000,
        counterpartyScore: 95,
        fiatCurrency: 'VES',
      });

      expect(Array.isArray(res.unmeasuredInputs)).toBe(true);
      expect(res.unmeasuredInputs.length).toBeGreaterThan(0);
    });
  });
});

describe('sin dato antes que dato inventado: simulate_trade_impact', () => {
  describe('el schema no fabrica exposición ni límite', () => {
    it('no afirma que la exposición actual es cero', () => {
      const parsed = SimulateTradeImpactInputSchema.parse({ proposedTradeAmountUsdt: 1200 });

      expect(parsed.currentExposureUsdt).toBeUndefined();
    });

    it('no inventa un límite diario de exposición', () => {
      const parsed = SimulateTradeImpactInputSchema.parse({ proposedTradeAmountUsdt: 1200 });

      expect(parsed.maxDailyExposureLimitUsdt).toBeUndefined();
    });

    it('el llamante sí puede seguir supplying ambos valores', () => {
      const parsed = SimulateTradeImpactInputSchema.parse({
        proposedTradeAmountUsdt: 1200,
        currentExposureUsdt: 1000,
        maxDailyExposureLimitUsdt: 2000,
      });

      expect(parsed.currentExposureUsdt).toBe(1000);
      expect(parsed.maxDailyExposureLimitUsdt).toBe(2000);
    });
  });

  describe('sin exposición ni límite no se autoriza la orden', () => {
    it('no dice SAFE_TO_EXECUTE cuando falta el límite', () => {
      const res = simulateTradeImpactTool.execute({
        proposedTradeAmountUsdt: 1200,
        currentExposureUsdt: 0,
      } as never);

      // This is the assertion that matters most in the whole sweep. Before:
      // projectedExposure 1200 < invented limit 2000 → 'SAFE_TO_EXECUTE'.
      // A green light to move $1,200 against a risk limit nobody chose.
      expect(res.verdict).toBe('UNAVAILABLE');
      expect(res.actionable).toBe(false);
      expect(res.unavailableReason).toBe('missing_evidence:maxDailyExposureLimit');
    });

    it('no dice SAFE_TO_EXECUTE cuando falta la exposición actual', () => {
      const res = simulateTradeImpactTool.execute({
        proposedTradeAmountUsdt: 1200,
        maxDailyExposureLimitUsdt: 2000,
      } as never);

      expect(res.verdict).toBe('UNAVAILABLE');
      expect(res.unavailableReason).toBe('missing_evidence:currentExposure');
    });

    it('deja la proyección en null cuando no puede proyectarse', () => {
      const res = simulateTradeImpactTool.execute({
        proposedTradeAmountUsdt: 1200,
        maxDailyExposureLimitUsdt: 2000,
      } as never);

      // Projected exposure is arithmetic on an unknown operand. Reporting 1200 would
      // assert the portfolio is empty.
      expect(res.projectedExposureUsdt).toBeNull();
      expect(res.exposureUtilizationPct).toBeNull();
    });

    it('no dispara el límite diario contra un límite inventado', () => {
      const res = simulateTradeImpactTool.execute({
        proposedTradeAmountUsdt: 999999,
        maxDailyExposureLimitUsdt: 2000,
      } as never);

      expect(res.limitExceeded).toBeNull();
      expect(res.wouldTrigger).not.toContain('DAILY_EXPOSURE_LIMIT_EXCEEDED');
    });

    it('no inventa el margen restante seguro', () => {
      const res = simulateTradeImpactTool.execute({
        proposedTradeAmountUsdt: 1200,
        currentExposureUsdt: 1000,
      } as never);

      // `maxSafeRemainingUsdt` is a number you would size an order against.
      expect(res.maxSafeRemainingUsdt).toBeNull();
    });
  });

  describe('con evidencia completa la simulación sigue siendo real', () => {
    it('detecta el exceso de exposición con límite medido', () => {
      const res = simulateTradeImpactTool.execute({
        proposedTradeAmountUsdt: 1200,
        currentExposureUsdt: 1000,
        maxDailyExposureLimitUsdt: 2000,
        consecutiveLosses: 0,
      });

      expect(res.limitExceeded).toBe(true);
      expect(res.projectedExposureUsdt).toBe(2200);
      expect(res.exposureUtilizationPct).toBe(110);
      expect(res.wouldTrigger).toContain('DAILY_EXPOSURE_LIMIT_EXCEEDED');
      expect(res.verdict).toBe('REQUIRES_REDUCTION');
      expect(res.actionable).toBe(true);
    });

    it('autoriza una orden chica dentro del límite medido', () => {
      const res = simulateTradeImpactTool.execute({
        proposedTradeAmountUsdt: 500,
        currentExposureUsdt: 1000,
        maxDailyExposureLimitUsdt: 2000,
        consecutiveLosses: 0,
      });

      expect(res.limitExceeded).toBe(false);
      expect(res.projectedExposureUsdt).toBe(1500);
      expect(res.maxSafeRemainingUsdt).toBe(1000);
      expect(res.verdict).toBe('SAFE_TO_EXECUTE');
      expect(res.actionable).toBe(true);
    });

    it('sigue disparando por pérdidas consecutivas sin límite diario', () => {
      const res = simulateTradeImpactTool.execute({
        proposedTradeAmountUsdt: 100,
        currentExposureUsdt: 0,
        maxDailyExposureLimitUsdt: 2000,
        consecutiveLosses: 3,
      });

      // This trigger is measured from real input, so it survives the absence of the
      // others. Suppressing it would be over-correcting: a known rule about known
      // data still fires.
      expect(res.wouldTrigger).toContain('MAX_CONSECUTIVE_LOSSES_TRIGGERED');
    });
  });
});

/**
 * The blocks above call `execute()` directly with a hand-built object. That is the
 * right unit for the handler, but it has a blind spot the mutation run exposed:
 * bypassing the schema means the handler only ever sees `undefined`, so
 * reintroducing a schema default would leave every handler-level test green.
 *
 * These go through the real path — parse, then execute — because that is the path a
 * caller actually takes, and it is where a resurrected default would land.
 */
describe('sin dato antes que dato inventado: el camino real, parseo y ejecucion', () => {
  it('un default en el schema no alcanza para autorizar un trade', () => {
    // If `maxDailyExposureLimitUsdt` ever regains `.default(2000)`, this parse hands
    // the handler a limit and the handler answers on measured-looking data. The test
    // fails at the parse step first, naming the culprit.
    const parsed = SimulateTradeImpactInputSchema.parse({ proposedTradeAmountUsdt: 1200 });

    expect(parsed.maxDailyExposureLimitUsdt).toBeUndefined();
    expect(parsed.currentExposureUsdt).toBeUndefined();

    const res = simulateTradeImpactTool.execute(parsed);

    expect(res.verdict).toBe('UNAVAILABLE');
    expect(res.actionable).toBe(false);
  });

  it('un default en el schema no alcanza para evaluar riesgo', () => {
    const parsed = EvaluateTradeRiskInputSchema.parse({ tradeAmountUsdt: 500 });

    expect(parsed.counterpartyScore).toBeUndefined();
    expect(parsed.currentCapitalUsdt).toBeUndefined();

    const res = evaluateTradeRiskTool.execute(parsed);

    expect(res.decision).toBe('UNAVAILABLE');
    expect(res.isCounterpartyAcceptable).toBeNull();
  });

  it('con evidencia parseada el veredicto sigue siendo accionable', () => {
    // The counterpart of the two above: fail-closed must not mean dead. A caller that
    // DOES report its position gets a real answer.
    const parsed = SimulateTradeImpactInputSchema.parse({
      proposedTradeAmountUsdt: 500,
      currentExposureUsdt: 1000,
      maxDailyExposureLimitUsdt: 2000,
    });

    const res = simulateTradeImpactTool.execute(parsed);

    expect(res.verdict).toBe('SAFE_TO_EXECUTE');
    expect(res.actionable).toBe(true);
    expect(res.projectedExposureUsdt).toBe(1500);
  });

  it('un riesgo con contraparte y capital parseados se puede permitir', () => {
    const parsed = EvaluateTradeRiskInputSchema.parse({
      tradeAmountUsdt: 500,
      currentCapitalUsdt: 5000,
      counterpartyScore: 95,
    });

    const res = evaluateTradeRiskTool.execute(parsed);

    expect(res.decision).toBe('ALLOW');
    expect(res.actionable).toBe(true);
  });
});
