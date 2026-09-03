import { describe, it, expect } from 'vitest';
import {
  verifyTitularMatch,
  assessCounterpartyRisk,
  computeCounterpartyMetrics,
  type Counterparty,
} from './counterparty';
import { type Operation } from './log';

describe('Counterparty CRM & Anti-Triangulation Engine', () => {
  const trustedParty: Counterparty = {
    id: 'cp-1',
    alias: 'CriptoVzla_Official',
    realName: 'Juan Carlos Pérez González',
    documentId: 'V-18452123',
    phone: '0414-1234567',
    reputation: 'TRUSTED',
    createdAt: '2026-01-01',
  };

  const blockedParty: Counterparty = {
    id: 'cp-bad',
    alias: 'ScamMerchant',
    realName: 'Carlos Fraudulento',
    documentId: 'V-20111222',
    reputation: 'BLOCKED',
    createdAt: '2026-02-01',
  };

  it('matches valid titular names even with slight variations or missing middle names', () => {
    expect(verifyTitularMatch('Juan Carlos Pérez González', 'Juan Perez')).toBe(true);
    expect(verifyTitularMatch('Juan Carlos Pérez González', 'JUAN CARLOS PEREZ')).toBe(true);
    expect(verifyTitularMatch('María Rodríguez', 'Maria Rodriguez')).toBe(true);
  });

  it('detects third-party titular mismatches (triangulation attempt)', () => {
    // Verified user is Juan Carlos Pérez, but incoming transfer says "Pedro Gomez"
    expect(verifyTitularMatch('Juan Carlos Pérez González', 'Pedro Gómez Martínez')).toBe(false);
  });

  it('flags CRITICAL risk when titular name does not match verified counterparty', () => {
    const assessment = assessCounterpartyRisk(trustedParty, 'Pedro Gómez');
    expect(assessment.isSafe).toBe(false);
    expect(assessment.riskLevel).toBe('CRITICAL');
    expect(assessment.isThirdPartyPayment).toBe(true);
    expect(assessment.warning).toContain('ALERTA DE TRIANGULACIÓN');
  });

  it('passes safe when titular name matches verified counterparty', () => {
    const assessment = assessCounterpartyRisk(trustedParty, 'Juan Carlos Perez');
    expect(assessment.isSafe).toBe(true);
    expect(assessment.riskLevel).toBe('LOW');
    expect(assessment.isThirdPartyPayment).toBe(false);
  });

  it('blocks trades unconditionally if counterparty is in black list (BLOCKED)', () => {
    const assessment = assessCounterpartyRisk(blockedParty);
    expect(assessment.isSafe).toBe(false);
    expect(assessment.riskLevel).toBe('CRITICAL');
    expect(assessment.warning).toContain('OPERACIÓN BLOQUEADA');
  });

  it('computes aggregated trading metrics for a counterparty', () => {
    const ops: Operation[] = [
      {
        id: '1',
        timestamp: '2026-09-01T10:00:00.000Z',
        type: 'buy',
        pair: 'USDT',
        vesAmount: 8000,
        usdtAmount: 10,
        price: 800,
        merchantNote: 'Trade with CriptoVzla_Official',
        fees: 0,
        notes: '',
        errorFree: true,
      },
      {
        id: '2',
        timestamp: '2026-09-02T10:00:00.000Z',
        type: 'sell',
        pair: 'USDT',
        vesAmount: 16400,
        usdtAmount: 20,
        price: 820,
        merchantNote: 'Juan Carlos Perez - Order #882',
        fees: 0,
        notes: '',
        errorFree: true,
      },
      {
        id: '3',
        timestamp: '2026-09-03T10:00:00.000Z',
        type: 'buy',
        pair: 'USDT',
        vesAmount: 5000,
        usdtAmount: 6,
        price: 833,
        merchantNote: 'Unrelated trader',
        fees: 0,
        notes: '',
        errorFree: true,
      },
    ];

    const metrics = computeCounterpartyMetrics(trustedParty, ops);
    expect(metrics.tradeCount).toBe(2);
    expect(metrics.totalVes).toBe(24400);
    expect(metrics.totalUsdt).toBe(30);
    expect(metrics.lastTradeDate).toBe('2026-09-02T10:00:00.000Z');
  });
});
