import { describe, it, expect } from 'vitest';
import {
  evaluateGoldenSpread,
  buildTeamAllocationPlan,
  auditOperatorPerformance,
  MINIMUM_VIABLE_NET_SPREAD_PCT,
  type OperatorProfile,
} from './operator-manager';
import { type Operation } from './log';

describe('operator-manager pure domain logic', () => {
  describe('evaluateGoldenSpread', () => {
    it('alerts below 0.50% pause condition', () => {
      const res = evaluateGoldenSpread(0.42);
      expect(res.isViable).toBe(false);
      expect(res.alertLevel).toBe('BELOW_THRESHOLD_PAUSE');
      expect(res.message).toContain('ALERTA');
    });

    it('identifies marginal caution between 0.50% and 0.79%', () => {
      const res = evaluateGoldenSpread(0.65);
      expect(res.isViable).toBe(true);
      expect(res.alertLevel).toBe('MARGINAL_CAUTION');
    });

    it('identifies healthy spread between 0.80% and 1.49%', () => {
      const res = evaluateGoldenSpread(1.15);
      expect(res.isViable).toBe(true);
      expect(res.alertLevel).toBe('HEALTHY');
    });

    it('identifies golden zone for super spread >= 1.50%', () => {
      const res = evaluateGoldenSpread(1.85);
      expect(res.isViable).toBe(true);
      expect(res.alertLevel).toBe('GOLDEN_ZONE');
    });
  });

  describe('buildTeamAllocationPlan', () => {
    const operators: OperatorProfile[] = [
      {
        id: 'op-william',
        name: 'William (Operador Principal)',
        assignedCapitalUsdt: 5000,
        commissionSplitPct: 30, // 30% to operator, 70% to desk owner
        targetDailyCycles: 2,
        active: true,
      },
      {
        id: 'op-junior',
        name: 'Operador Secundario',
        assignedCapitalUsdt: 2000,
        commissionSplitPct: 25,
        targetDailyCycles: 1.5,
        active: true,
      },
    ];

    it('distributes 7000$ capital between operators and calculates profit split', () => {
      const plan = buildTeamAllocationPlan(7000, operators, 60.0, 0.90);
      expect(plan.totalDeskCapitalUsdt).toBe(7000);
      expect(plan.deskOwnerRetainedCapitalUsdt).toBe(0);
      expect(plan.operatorsAllocations).toHaveLength(2);

      const op1 = plan.operatorsAllocations[0];
      expect(op1.allocatedCapitalUsdt).toBe(5000);
      expect(op1.targetDailyProfitUsdt).toBe(90);
      expect(op1.operatorDailyTakeUsdt).toBe(27);
      expect(op1.ownerDailyTakeUsdt).toBe(63);

      expect(plan.totalDailyOwnerProfitUsdt).toBeGreaterThan(63);
      expect(plan.monthlyProjectedDeskProfitUsdt).toBe(Math.round(plan.totalDailyOwnerProfitUsdt * 30 * 100) / 100);
    });

    it('retains capital for desk leader when total capital exceeds operator sum', () => {
      const plan = buildTeamAllocationPlan(10000, operators, 60.0, 0.85);
      expect(plan.deskOwnerRetainedCapitalUsdt).toBe(3000);
      expect(plan.totalDailyOwnerProfitUsdt).toBeGreaterThan(0);
    });
  });

  describe('auditOperatorPerformance', () => {
    const operator: OperatorProfile = {
      id: 'op-1',
      name: 'Operador Test',
      assignedCapitalUsdt: 2000,
      commissionSplitPct: 20,
      targetDailyCycles: 1,
      active: true,
    };

    it('audits inactive operator with 0 operations', () => {
      const audit = auditOperatorPerformance(operator, [], 60.0, 10);
      expect(audit.status).toBe('INACTIVE');
      expect(audit.completedCycles).toBe(0);
      expect(audit.totalOperations).toBe(0);
    });

    it('flags underperforming operator if net spread < 0.50%', () => {
      const ops: Operation[] = [
        {
          id: '1',
          timestamp: '2026-09-01T10:00:00Z',
          type: 'buy',
          pair: 'USDT',
          vesAmount: 120000,
          usdtAmount: 2000,
          price: 60,
          fees: 50,
          merchantNote: '',
          notes: '',
          errorFree: true,
        },
        {
          id: '2',
          timestamp: '2026-09-01T12:00:00Z',
          type: 'sell',
          pair: 'USDT',
          vesAmount: 120400,
          usdtAmount: 2000,
          price: 60.2,
          fees: 50,
          merchantNote: '',
          notes: '',
          errorFree: true,
        },
      ];

      const audit = auditOperatorPerformance(operator, ops, 60.0, 10);
      expect(audit.completedCycles).toBe(1);
      expect(audit.isMeetingSpreadTarget).toBe(false);
      expect(audit.status).toBe('UNDERPERFORMING');
      expect(audit.recommendations[0]).toContain('Regla de Oro');
    });

    it('identifies optimal operator with high spread', () => {
      const ops: Operation[] = [
        {
          id: '1',
          timestamp: '2026-09-01T10:00:00Z',
          type: 'buy',
          pair: 'USDT',
          vesAmount: 120000,
          usdtAmount: 2000,
          price: 60,
          fees: 20,
          merchantNote: '',
          notes: '',
          errorFree: true,
        },
        {
          id: '2',
          timestamp: '2026-09-01T12:00:00Z',
          type: 'sell',
          pair: 'USDT',
          vesAmount: 121800,
          usdtAmount: 2000,
          price: 60.9,
          fees: 20,
          merchantNote: '',
          notes: '',
          errorFree: true,
        },
      ];

      const audit = auditOperatorPerformance(operator, ops, 60.0, 10);
      expect(audit.isMeetingSpreadTarget).toBe(true);
      expect(audit.status).toBe('OPTIMAL');
      expect(audit.operatorShareUsdt).toBeGreaterThan(0);
      expect(audit.deskOwnerShareUsdt).toBeGreaterThan(audit.operatorShareUsdt);
    });
  });
});
