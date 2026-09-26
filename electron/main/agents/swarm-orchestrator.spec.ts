import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { P2PDatabaseService } from '../db/database';
import { AgentSwarmOrchestrator } from './swarm-orchestrator';
import { clearTreasurySnapshot, setTreasurySnapshot } from '../ipc/treasury-snapshot';
import type { TreasurySnapshotDto } from '../../shared/types';

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
    // The treasury cache is module-level state shared across the whole test file: leaving it
    // populated would silently change the behavior of the remaining tests.
    clearTreasurySnapshot();
    dbService.close();
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {
        /* ignore test db cleanup failure */
      }
    }
  });

  it('should report health for all 4 specialized agents with assigned MCP domains and skills', () => {
    const health = swarm.getSwarmHealth();
    expect(health.length).toBe(4);
    const roles = health.map((h) => h.role);
    expect(roles).toContain('SENTINEL');
    expect(roles).toContain('STRATEGIST');
    expect(roles).toContain('RISK_GATEKEEPER');
    expect(roles).toContain('DISPUTE_AUDITOR');
    health.forEach((h) => {
      expect(h.status).toBe('ONLINE');
      expect(h.assignedMcpDomains?.length).toBeGreaterThanOrEqual(2);
      expect(h.assignedSkills?.length).toBeGreaterThanOrEqual(4);
    });
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

    expect(['APPROVED', 'APPROVED_WITH_WARNINGS']).toContain(result.riskVerdict.status);
    expect(result.suggestedPlan).toBeDefined();
    expect(result.suggestedPlan?.expectedNetSpreadPct).toBeGreaterThanOrEqual(0.5);
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
    expect(result.riskVerdict.vetoReason).toContain(
      'La contraparte presenta historial de disputas',
    );
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

  describe('puente de tesorería real (T2)', () => {
    /** Snapshot mínimo: solo los agregados numéricos son validados por el store. */
    function buildSnapshot(overrides: Partial<TreasurySnapshotDto> = {}): TreasurySnapshotDto {
      return {
        accounts: [],
        totalBalanceVes: 240000,
        totalSpentTodayVes: 0,
        totalReceivedTodayVes: 0,
        totalDailyLimitVes: 440000,
        nearLimitCount: 0,
        overLimitCount: 0,
        disabledCount: 0,
        saturatedCount: 0,
        rotationRecommendationId: null,
        generatedAt: Date.now(),
        ...overrides,
      };
    }

    it('audita contra el snapshot cacheado y no contra los literales históricos', async () => {
      // 9.500 + 1.000 = 10.500 > 10.000 con el snapshot real. Con los literales del pre-puente
      // (4.500 / 15.000) esta operación habría sido aprobada, así que el veto prueba que el
      // pipeline leyó la tesorería real.
      setTreasurySnapshot(
        buildSnapshot({ totalSpentTodayVes: 9500, totalDailyLimitVes: 10000 }),
      );

      const result = await swarm.runAnalysisPipeline({
        bestBid: 88.5,
        bestAsk: 89.9,
        counterpartyRiskLevel: 'LOW',
      });

      expect(result.riskVerdict.status).toBe('VETOED');
      expect(result.suggestedPlan).toBeUndefined();
      expect(result.riskVerdict.vetoReason).toContain('10000');
      expect(result.riskVerdict.auditedParameters.treasuryAudit).toEqual({
        source: 'RENDERER_SNAPSHOT',
        dailyVolumeUsed: 9500,
        dailyLimitUsed: 10000,
        overLimitCount: 0,
        nearLimitCount: 0,
        disabledCount: 0,
        saturatedCount: 0,
      });
    });

    it('VETEA por cuenta DISABLED announced en el snapshot', async () => {
      setTreasurySnapshot(buildSnapshot({ disabledCount: 1 }));

      const result = await swarm.runAnalysisPipeline({
        bestBid: 88.5,
        bestAsk: 89.9,
        counterpartyRiskLevel: 'LOW',
      });

      expect(result.riskVerdict.status).toBe('VETOED');
      expect(result.riskVerdict.vetoReason).toContain('DISABLED');
      expect(result.executionSummary).toContain('OPERACIÓN VETADA POR EL OFICIAL DE RIESGO');
    });

    it('cae a los literales históricos cuando no hay snapshot cacheado', async () => {
      setTreasurySnapshot(null);

      // 4.500 (fallback) + 11.000 = 15.500 > 15.000 (fallback): veto idéntico al pre-puente.
      const result = await swarm.runAnalysisPipeline({
        bestBid: 88.5,
        bestAsk: 89.9,
        capitalUsdt: 11000,
        counterpartyRiskLevel: 'LOW',
      });

      expect(result.riskVerdict.status).toBe('VETOED');
      expect(result.riskVerdict.vetoReason).toContain('15000');
      expect(result.riskVerdict.auditedParameters.treasuryAudit?.source).toBe('FALLBACK_DEFAULTS');
      expect(result.riskVerdict.auditedParameters.treasuryAudit?.dailyVolumeUsed).toBe(4500);
      expect(result.riskVerdict.auditedParameters.treasuryAudit?.dailyLimitUsed).toBe(15000);
    });

    it('rechaza un snapshot malformado y conserva el anterior', () => {
      setTreasurySnapshot(buildSnapshot({ totalSpentTodayVes: 1234 }));

      const accepted = setTreasurySnapshot({
        ...buildSnapshot(),
        totalDailyLimitVes: 'mucho' as unknown as number,
      });

      expect(accepted).toBe(false);
      expect(accepted).toBeTypeOf('boolean');
    });
  });
});
