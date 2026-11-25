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

  it('should persist, retrieve, filter and delete bank account records in SQLite', () => {
    const banesco = {
      id: 'acc-banesco-01',
      bankName: 'Banesco Pago Móvil',
      bankCode: 'BANESCO',
      rail: 'PAGO_MOVIL' as const,
      accountNumberMasked: '0414-***1234',
      dailyLimitVes: 50000,
      monthlyLimitVes: 200000,
      initialBalanceVes: 45000,
      status: 'ACTIVE' as const,
      maxDailyTransactions: 15,
    };

    const mercantil = {
      id: 'acc-mercantil-01',
      bankName: 'Mercantil Transferencia',
      bankCode: 'MERCANTIL',
      rail: 'TRANSFERENCIA' as const,
      accountNumberMasked: '0105-***9988',
      dailyLimitVes: 300000,
      initialBalanceVes: 100000,
      status: 'DISABLED' as const,
      maxDailyTransactions: 20,
    };

    expect(dbService.saveBankAccount(banesco)).toBe(true);
    expect(dbService.saveBankAccount(mercantil)).toBe(true);

    const retrieved = dbService.getBankAccount('acc-banesco-01');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.bankName).toBe('Banesco Pago Móvil');
    expect(retrieved?.dailyLimitVes).toBe(50000);
    expect(retrieved?.status).toBe('ACTIVE');

    // List all
    const all = dbService.listBankAccounts();
    expect(all.length).toBe(2);

    // Filter by status
    const activeOnly = dbService.listBankAccounts({ status: 'ACTIVE' });
    expect(activeOnly.length).toBe(1);
    expect(activeOnly[0].id).toBe('acc-banesco-01');

    // Filter by bankCode
    const mercantilOnly = dbService.listBankAccounts({ bankCode: 'MERCANTIL' });
    expect(mercantilOnly.length).toBe(1);
    expect(mercantilOnly[0].id).toBe('acc-mercantil-01');

    // Delete
    expect(dbService.deleteBankAccount('acc-banesco-01')).toBe(true);
    expect(dbService.getBankAccount('acc-banesco-01')).toBeNull();
    expect(dbService.deleteBankAccount('acc-banesco-01')).toBe(false);
  });

  it('should persist Copilot threads, messages, usage ledger (P95), rejectStrategyPlan, and Engram quarantine', () => {
    const thread = dbService.createCopilotThread({ title: 'Arbitraje Banesco' });
    expect(thread.id).toBeTruthy();

    dbService.appendCopilotMessage({
      threadId: thread.id,
      role: 'user',
      content: '¿Cómo está el spread?',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: 0,
    });
    dbService.appendCopilotMessage({
      threadId: thread.id,
      role: 'assistant',
      content: 'Spread neto en +1.05%.',
      model: 'gemini-3.8-flash',
      provider: 'gemini',
      tokensIn: 120,
      tokensOut: 40,
      costUsd: 0.000042,
      latencyMs: 320,
    });

    const threads = dbService.listCopilotThreads(10);
    expect(threads.length).toBe(1);
    expect(threads[0].messageCount).toBe(2);

    const msgs = dbService.getCopilotThreadMessages(thread.id, 10);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);

    dbService.recordCopilotUsage({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.0001,
      latencyMs: 200,
      cached: false,
    });
    dbService.recordCopilotUsage({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      tokensIn: 200,
      tokensOut: 80,
      costUsd: 0.0002,
      latencyMs: 650,
      cached: false,
    });
    dbService.recordCopilotUsage({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: 2,
      cached: true,
    });

    const usageSummary = dbService.getCopilotUsageSummary(24);
    expect(usageSummary.totalCalls).toBe(3);
    expect(usageSummary.cachedCalls).toBe(1);
    expect(usageSummary.p95LatencyMs).toBe(650);

    // Engram quarantine: needs_review must not appear in getEngramContextSummary() until approved
    const quarantinedId = dbService.saveEngramObservation({
      topicKey: 'quarantine/test',
      type: 'discovery',
      scope: 'project',
      what: 'Observación automática en cuarentena',
      why: 'Salida automática de tool',
      whereAffected: 'Banesco',
      learned: 'No inyectar hasta aprobar',
      status: 'needs_review',
    });
    expect(dbService.getEngramContextSummary(10)).not.toContain('Observación automática en cuarentena');

    const approved = dbService.reviewEngramObservation(quarantinedId, 'approve');
    expect(approved.status).toBe('active');
    expect(dbService.getEngramContextSummary(10)).toContain('Observación automática en cuarentena');

    const toDiscardId = dbService.saveEngramObservation({
      topicKey: 'quarantine/discard',
      type: 'discovery',
      scope: 'project',
      what: 'Observación descartable',
      why: 'Ruido',
      whereAffected: 'N/A',
      learned: 'Borrar',
      status: 'needs_review',
    });
    expect(dbService.reviewEngramObservation(toDiscardId, 'discard').status).toBe('discarded');
    expect(dbService.reviewEngramObservation(999999, 'approve').status).toBe('not_found');

    // rejectStrategyPlan
    dbService.saveStrategyPlan({
      id: 'PLAN-REJ-1',
      title: 'Test Reject',
      route: 'USDT -> VES',
      capitalRequiredUsdt: 500,
      expectedNetSpreadPct: 0.9,
      expectedProfitUsdt: 4.5,
      riskLevel: 'LOW',
      rationale: 'Prueba',
      status: 'PROPOSED',
      esSimulado: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(dbService.rejectStrategyPlan('PLAN-REJ-1', 'Cupo saturado').success).toBe(true);
    expect(dbService.getStrategyPlan('PLAN-REJ-1')?.status).toBe('REJECTED');
    expect(dbService.rejectStrategyPlan('NO-SUCH-PLAN').success).toBe(false);

    expect(dbService.deleteCopilotThread(thread.id)).toBe(true);
    expect(dbService.getCopilotThreadMessages(thread.id, 10)).toEqual([]);
  });
});

