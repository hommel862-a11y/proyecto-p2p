import { describe, it, expect } from 'vitest';
import {
  evaluatePreflightDiscipline,
  type PreflightSessionInput,
} from './preflight-discipline';

describe('Preflight Operator Discipline & Anti-Tilt Engine', () => {
  it('should clear session when all discipline checks pass', () => {
    const input: PreflightSessionInput = {
      bankSaturationPct: 40,
      strictNoThirdPartyAcknowledged: true,
      telegramSentinelActive: true,
      dailyLossLimitUsd: 100,
      mentalState: 'OPTIMAL',
      unresolvedDisputesCount: 0,
    };

    const evaluation = evaluatePreflightDiscipline(input);

    expect(evaluation.status).toBe('CLEARED');
    expect(evaluation.canTrade).toBe(true);
    expect(evaluation.summaryTitle).toContain('SESIÓN AUTORIZADA');
    expect(evaluation.antiTiltCooloffMinutesRequired).toBe(0);
    expect(evaluation.sessionToken).toContain('AUTH-');
  });

  it('should halt session if strict no third party policy is not acknowledged', () => {
    const input: PreflightSessionInput = {
      bankSaturationPct: 20,
      strictNoThirdPartyAcknowledged: false, // Critical failure
      telegramSentinelActive: true,
      dailyLossLimitUsd: 100,
      mentalState: 'OPTIMAL',
      unresolvedDisputesCount: 0,
    };

    const evaluation = evaluatePreflightDiscipline(input);

    expect(evaluation.status).toBe('HALTED_BLOCKED');
    expect(evaluation.canTrade).toBe(false);
    expect(evaluation.recommendedMaxSingleTicketUsdt).toBe(0);
  });

  it('should halt session if bank saturation >= 90% (SUDEBAN freeze risk)', () => {
    const input: PreflightSessionInput = {
      bankSaturationPct: 92,
      strictNoThirdPartyAcknowledged: true,
      telegramSentinelActive: true,
      dailyLossLimitUsd: 100,
      mentalState: 'OPTIMAL',
      unresolvedDisputesCount: 0,
    };

    const evaluation = evaluatePreflightDiscipline(input);

    expect(evaluation.status).toBe('HALTED_BLOCKED');
    expect(evaluation.canTrade).toBe(false);
  });

  it('should require 30 min cooloff if operator is in TILTED_STRESSED mode', () => {
    const input: PreflightSessionInput = {
      bankSaturationPct: 50,
      strictNoThirdPartyAcknowledged: true,
      telegramSentinelActive: true,
      dailyLossLimitUsd: 100,
      mentalState: 'TILTED_STRESSED',
      unresolvedDisputesCount: 0,
    };

    const evaluation = evaluatePreflightDiscipline(input);

    expect(evaluation.status).toBe('HALTED_BLOCKED');
    expect(evaluation.canTrade).toBe(false);
    expect(evaluation.antiTiltCooloffMinutesRequired).toBe(30);
  });

  it('should warn and reduce max ticket if operator is TIRED', () => {
    const input: PreflightSessionInput = {
      bankSaturationPct: 50,
      strictNoThirdPartyAcknowledged: true,
      telegramSentinelActive: false,
      dailyLossLimitUsd: 100,
      mentalState: 'TIRED',
      unresolvedDisputesCount: 0,
    };

    const evaluation = evaluatePreflightDiscipline(input);

    expect(evaluation.status).toBe('WARNING');
    expect(evaluation.canTrade).toBe(true);
    expect(evaluation.recommendedMaxSingleTicketUsdt).toBe(300);
  });
});
