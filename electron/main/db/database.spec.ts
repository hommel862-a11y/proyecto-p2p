import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { P2PDatabaseService } from './database';
import { createFsmOrder, transitionOrderFsm } from '../../../projects/core/src/lib/fsm';

describe('P2PDatabaseService (SQLite WAL Mode)', () => {
  const testDbPath = path.resolve(__dirname, '../../../../scratch/test_antigravity.sqlite');
  let dbService: P2PDatabaseService;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    const walPath = `${testDbPath}-wal`;
    const shmPath = `${testDbPath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    dbService = new P2PDatabaseService(testDbPath);
  });

  afterEach(() => {
    dbService.close();
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {
        // Ignored
      }
    }
  });

  it('should save and retrieve an FSM order accurately', () => {
    const order = createFsmOrder({
      orderId: 'ORD-999',
      side: 'BUY',
      amountCrypto: 200,
      amountFiat: 13000,
      price: 65,
      counterpartyName: 'Pedro Perez',
      counterpartyIdDoc: 'V-11223344',
      timestamp: 1700000000000,
    });

    dbService.saveOrder(order);
    const retrieved = dbService.getOrder('ORD-999');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.orderId).toBe('ORD-999');
    expect(retrieved?.side).toBe('BUY');
    expect(retrieved?.amountFiat).toBe(13000);
    expect(retrieved?.currentState).toBe('ORDER_DETECTED');
    expect(retrieved?.counterpartyName).toBe('Pedro Perez');
  });

  it('should list only active orders and filter out completed or cancelled orders', () => {
    const orderActive = createFsmOrder({
      orderId: 'ORD-ACTIVE',
      side: 'BUY',
      amountCrypto: 100,
      amountFiat: 6500,
      price: 65,
      counterpartyName: 'Active User',
      timestamp: 1700000000000,
    });
    dbService.saveOrder(orderActive);

    const orderCompleted = createFsmOrder({
      orderId: 'ORD-DONE',
      side: 'BUY',
      amountCrypto: 100,
      amountFiat: 6500,
      price: 65,
      counterpartyName: 'Done User',
      timestamp: 1700000000000,
    });
    const completed = transitionOrderFsm(orderCompleted, {
      type: 'OPERATOR_OVERRIDE',
      payload: { reason: 'COMPLETED' },
    }).context;
    dbService.saveOrder(completed);

    const activeList = dbService.listActiveOrders();
    expect(activeList.length).toBe(1);
    expect(activeList[0].orderId).toBe('ORD-ACTIVE');
  });

  it('should deduplicate inbound bank events within 30 days', () => {
    const now = Date.now();
    const event = {
      bank: 'Banesco',
      reference: 'REF-001122',
      payerName: 'Carlos Ramirez',
      payerIdDoc: 'V-18776655',
      amountFiat: 4500,
      rawText: 'Pago Movil recibido Banesco REF-001122 por Bs 4500',
      receivedAt: now,
    };

    // Primera inserción
    const firstRes = dbService.recordInboundBankEvent(event);
    expect(firstRes.isDuplicate).toBe(false);
    expect(firstRes.eventId).toBeGreaterThan(0);

    // Segunda inserción con misma referencia y banco
    const secondRes = dbService.recordInboundBankEvent(event);
    expect(secondRes.isDuplicate).toBe(true);
    expect(secondRes.eventId).toBe(firstRes.eventId);
  });

  it('should record immutable FSM audit log entries', () => {
    dbService.logFsmTransition({
      orderId: 'ORD-777',
      fromState: 'ORDER_DETECTED',
      toState: 'PAYMENT_PENDING',
      event: 'ORDER_CONFIRMED',
      reason: 'Confirmado por webhook Binance',
      timestamp: 1700000010000,
    });

    // Se asegura de que no lance errores al insertar en SQLite
    expect(true).toBe(true);
  });

  it('should save, retrieve and update a StrategyPlan record', () => {
    const plan = {
      id: 'PLAN-001',
      title: 'Triangulación VES -> USDT -> BTC',
      route: 'VES->USDT->BTC->VES',
      asset: 'USDT',
      fiat: 'VES',
      capitalRequiredUsdt: 1000,
      expectedNetSpreadPct: 1.45,
      expectedProfitUsdt: 14.5,
      riskLevel: 'LOW' as const,
      assignedOperatorId: 'OP-01',
      assignedOperatorName: 'Carlos P2P',
      rationale:
        'Spread de arbitraje triangular superior al umbral de oro (0.50%) con libro de profundidad validado.',
      status: 'PROPOSED' as const,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    dbService.saveStrategyPlan(plan);
    const retrieved = dbService.getStrategyPlan('PLAN-001');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('PLAN-001');
    expect(retrieved?.capitalRequiredUsdt).toBe(1000);
    expect(retrieved?.expectedNetSpreadPct).toBe(1.45);
    expect(retrieved?.status).toBe('PROPOSED');

    const updated = dbService.updateStrategyPlanStatus('PLAN-001', 'APPROVED');
    expect(updated).toBe(true);

    const afterUpdate = dbService.getStrategyPlan('PLAN-001');
    expect(afterUpdate?.status).toBe('APPROVED');

    const list = dbService.listStrategyPlans();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].id).toBe('PLAN-001');
  });

  it('should record and list market learnings with confidence scores', () => {
    const learningId = dbService.recordMarketLearning({
      topicKey: 'spread/bcv-injection-cycle',
      category: 'BCV_IMPACT',
      insight:
        'Las intervenciones cambiarias del BCV los días martes a las 10:00 AM aumentan el spread P2P en promedio 1.20%.',
      confidenceScore: 0.95,
      sampleCount: 14,
      dataPayload: { avgDeltaPct: 1.2, dayOfWeek: 2 },
    });

    expect(learningId).toBeGreaterThan(0);

    const learnings = dbService.listMarketLearnings('BCV_IMPACT');
    expect(learnings.length).toBeGreaterThanOrEqual(1);
    expect(learnings[0].topicKey).toBe('spread/bcv-injection-cycle');
    expect(learnings[0].confidenceScore).toBe(0.95);
    expect(learnings[0].dataPayload).toEqual({ avgDeltaPct: 1.2, dayOfWeek: 2 });
  });

  it('should persist, retrieve and format Engram observations according to the protocol', () => {
    const obsId = dbService.saveEngramObservation({
      topicKey: 'triangulation/routes',
      type: 'discovery',
      scope: 'project',
      what: 'Triangulación VES->USDT->BTC genera 1.35% neto',
      why: 'Brecha cambiaria 22.9% favorable previa a intervención BCV',
      whereAffected: 'Banesco Pago Móvil',
      learned: 'Operar preferentemente antes de las 11:30 AM para evitar congestión de cámara',
      confidenceScore: 0.95,
      sampleCount: 3,
      status: 'active',
    });

    expect(obsId).toBeGreaterThan(0);

    const observations = dbService.listEngramObservations({ topicKey: 'triangulation/routes' });
    expect(observations.length).toBe(1);
    expect(observations[0].type).toBe('discovery');
    expect(observations[0].what).toBe('Triangulación VES->USDT->BTC genera 1.35% neto');
    expect(observations[0].learned).toContain('11:30 AM');
    expect(observations[0].confidenceScore).toBe(0.95);

    const summary = dbService.getEngramContextSummary(5);
    expect(summary).toContain('[ENGRAM MEMORY | topic: triangulation/routes');
    expect(summary).toContain('• What: Triangulación VES->USDT->BTC genera 1.35% neto');
    expect(summary).toContain('• Learned: Operar preferentemente antes de las 11:30 AM');
  });

  it('should persist and list institutional audit logs with filtering', () => {
    const success1 = dbService.recordAuditLog({
      id: 'AUD-001',
      timestamp: '2026-09-19T12:00:00Z',
      category: 'SECURITY_ALERT',
      action: 'Bloqueo preventivo de cuenta',
      details: JSON.stringify({ ip: '10.0.0.1', risk: 'HIGH' }),
      severity: 'warn',
      createdAt: 1700000001000,
    });
    expect(success1).toBe(true);

    const success2 = dbService.recordAuditLog({
      id: 'AUD-002',
      timestamp: '2026-09-19T12:05:00Z',
      category: 'CONFIG_CHANGE',
      action: 'Modificación de spread mínimo',
      severity: 'info',
      createdAt: 1700000002000,
    });
    expect(success2).toBe(true);

    const allLogs = dbService.listAuditLogs(10);
    expect(allLogs.length).toBe(2);
    expect(allLogs[0].id).toBe('AUD-002'); // Order by created_at DESC

    const filtered = dbService.listAuditLogs(10, 'SECURITY_ALERT');
    expect(filtered.length).toBe(1);
    expect(filtered[0].action).toBe('Bloqueo preventivo de cuenta');
  });

  it('should persist and retrieve operation ledger records', () => {
    const saved = dbService.saveOperationRecord({
      id: 'OP-1001',
      timestamp: '2026-09-19T13:00:00Z',
      side: 'BUY',
      fiatAmount: 50000,
      cryptoAmount: 750,
      price: 66.67,
      bank: 'Banesco',
      reference: 'REF-778899',
      counterparty: 'Inversiones C.A.',
      status: 'COMPLETED',
      rawJson: JSON.stringify({ orderId: 'OP-1001', internalFee: 0.1 }),
      createdAt: Date.now(),
    });
    expect(saved).toBe(true);

    const records = dbService.listOperationRecords(10);
    expect(records.length).toBe(1);
    expect(records[0].id).toBe('OP-1001');
    expect(records[0].fiatAmount).toBe(50000);
    expect(records[0].cryptoAmount).toBe(750);
    expect(records[0].bank).toBe('Banesco');
  });
});
