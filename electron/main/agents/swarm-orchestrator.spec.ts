import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { P2PDatabaseService } from '../db/database';
import { AgentSwarmOrchestrator } from './swarm-orchestrator';

describe('Institutional Multi-Agent Swarm Orchestrator', () => {
  const testDbPath = path.resolve(__dirname, '../../../../scratch/test_swarm.sqlite');
  let dbService: P2PDatabaseService;
  let swarm: AgentSwarmOrchestrator;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const walPath = `${testDbPath}-wal`;
    const shmPath = `${testDbPath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    dbService = new P2PDatabaseService(testDbPath);
    swarm = new AgentSwarmOrchestrator(dbService);
  });

  afterEach(() => {
    dbService.close();
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  });

  it('should report health for all 4 specialized agents', () => {
    const health = swarm.getSwarmHealth();
    expect(health.length).toBe(4);
    const roles = health.map((h) => h.role);
    expect(roles).toContain('SENTINEL');
    expect(roles).toContain('STRATEGIST');
    expect(roles).toContain('RISK_GATEKEEPER');
    expect(roles).toContain('DISPUTE_AUDITOR');
    health.forEach((h) => expect(h.status).toBe('ONLINE'));
  });

  it('should approve viable trades, generate plan and record Engram memory', async () => {
    const result = await swarm.runAnalysisPipeline({
      asset: 'USDT',
      fiat: 'VES',
      capitalUsdt: 1000,
      bestBid: 88.5,
      bestAsk: 89.9, // Spread neto > 0.50%
      bcvRate: 72.0,
      parallelRate: 88.5,
      counterpartyRiskLevel: 'LOW',
    });

    expect(result.riskVerdict.status).toBe('APPROVED');
    expect(result.suggestedPlan).toBeDefined();
    expect(result.suggestedPlan?.expectedNetSpreadPct).toBeGreaterThanOrEqual(0.50);
    expect(result.executionSummary).toContain('Enjambre Multi-Agente completó la auditoría');

    // Verify persistence in Engram memory
    const engramMemories = dbService.listEngramObservations();
    expect(engramMemories.length).toBeGreaterThanOrEqual(1);
    expect(engramMemories[0].what).toContain('Swarm aprobó plan');
  });

  it('should exercise UNILATERAL VETO when net spread is below Golden Rule (0.50%)', async () => {
    const result = await swarm.runAnalysisPipeline({
      bestBid: 88.5,
      bestAsk: 88.6, // Spread ínfimo (~0.11%), neto negativo
      counterpartyRiskLevel: 'LOW',
    });

    expect(result.riskVerdict.status).toBe('VETOED');
    expect(result.suggestedPlan).toBeUndefined();
    expect(result.riskVerdict.vetoReason).toContain('regla de oro');
    expect(result.executionSummary).toContain('OPERACIÓN VETADA POR EL OFICIAL DE RIESGO');

    // Verify veto was logged into Engram memory
    const engramMemories = dbService.listEngramObservations();
    expect(engramMemories.length).toBeGreaterThanOrEqual(1);
    expect(engramMemories[0].what).toContain('vetada por riesgo');
    expect(engramMemories[0].type).toBe('decision');
  });

  it('should exercise UNILATERAL VETO when counterparty risk is HIGH', async () => {
    const result = await swarm.runAnalysisPipeline({
      bestBid: 88.5,
      bestAsk: 89.9,
      counterpartyRiskLevel: 'HIGH',
    });

    expect(result.riskVerdict.status).toBe('VETOED');
    expect(result.suggestedPlan).toBeUndefined();
    expect(result.riskVerdict.vetoReason).toContain('La contraparte presenta historial de disputas');
  });

  it('should audit payment receipts and flag amount discrepancies in dispute mode', () => {
    const fraudResult = swarm.auditPaymentProof({
      orderId: 'ORD-TEST-1',
      expectedAmountFiat: 88500,
      receiptAmountFiat: 80000, // Discrepancia intencional
      reference: 'REF-123456',
      bankName: 'Banesco',
    });

    expect(fraudResult.verdict).toBe('SUSPECT_FRAUD');
    expect(fraudResult.fraudScore).toBeGreaterThanOrEqual(70);
    expect(fraudResult.actionableDossierMarkdown).toContain('Discrepancia en monto');

    const cleanResult = swarm.auditPaymentProof({
      orderId: 'ORD-TEST-2',
      expectedAmountFiat: 88500,
      receiptAmountFiat: 88500,
      reference: 'REF-998877',
      bankName: 'Banesco',
    });

    expect(cleanResult.verdict).toBe('PAYMENT_MATCHED');
    expect(cleanResult.fraudScore).toBeLessThan(20);
  });
});
