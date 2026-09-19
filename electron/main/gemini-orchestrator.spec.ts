import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { P2PDatabaseService } from './db/database';
import { GeminiOrchestrator } from './gemini-orchestrator';

describe('Gemini Orchestrator End-to-End Operational Lifecycle', () => {
  const testDbPath = path.resolve(__dirname, '../../scratch/test_copilot_ops.sqlite');
  let dbService: P2PDatabaseService;
  let orchestrator: GeminiOrchestrator;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY'];

    const dir = path.dirname(testDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const walPath = `${testDbPath}-wal`;
    const shmPath = `${testDbPath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    dbService = new P2PDatabaseService(testDbPath);
    orchestrator = new GeminiOrchestrator(dbService);
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env['GEMINI_API_KEY'] = originalKey;
    }
    dbService.close();
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  });

  it('procesa una solicitud operativa, formula un plan SOP y lo persiste en SQLite', async () => {
    const prompt = 'Activa el triaje de incidencia para retención de cuenta bancaria y audita el cumplimiento SOP';
    const response = await orchestrator.sendMessage({ prompt });

    // 1. Validar contenido analítico en la respuesta
    expect(response.reply).toContain('Auditoría de Cumplimiento SOP');
    expect(response.reply).toContain('Matriz de Triaje & Escalación');
    expect(response.reply).toContain('Conciliación Contable & Runway');

    // 2. Validar generación del plan táctico
    expect(response.suggestedPlan).toBeDefined();
    const plan = response.suggestedPlan!;
    expect(plan.status).toBe('PROPOSED');
    expect(plan.expectedNetSpreadPct).toBeGreaterThanOrEqual(0.50);
    expect(plan.title).toContain('Gobernanza SOP');

    // 3. Validar persistencia en SQLite
    const storedPlan = dbService.getStrategyPlan(plan.id);
    expect(storedPlan).toBeDefined();
    expect(storedPlan?.status).toBe('PROPOSED');

    // 4. Ejecutar el plan (Acción Human-in-the-Loop "PLAY")
    const execResult = await orchestrator.executePlan(plan.id);
    expect(execResult.success).toBe(true);
    expect(execResult.dispatchSummary).toBeDefined();
    expect(execResult.dispatchSummary?.planId).toBe(plan.id);
    expect(execResult.dispatchSummary?.sheets.synced).toBe(true);

    // 5. Validar cambio de estado a APPROVED en SQLite
    const approvedPlan = dbService.getStrategyPlan(plan.id);
    expect(approvedPlan?.status).toBe('APPROVED');

    // 6. Validar registro de observación en la memoria persistente Engram
    const engramRecords = dbService.listEngramObservations();
    expect(engramRecords.length).toBeGreaterThan(0);
    const planObservation = engramRecords.find((r) => r.topicKey === `execution/plan-${plan.id}`);
    expect(planObservation).toBeDefined();
    expect(planObservation?.type).toBe('decision');
    expect(planObservation?.what).toContain(plan.id);
  });

  it('retorna error controlado al intentar ejecutar un plan inexistente', async () => {
    const result = await orchestrator.executePlan('PLAN-INEXISTENTE-999');
    expect(result.success).toBe(false);
    expect(result.error).toContain('no existe');
  });

  it('permite listar planes y observaciones de Engram', async () => {
    await orchestrator.sendMessage({
      prompt: '¿Cómo organizamos la tesorería pasiva y el estacionamiento en Binance Earn?',
    });

    const plans = orchestrator.getPlans(10);
    expect(plans.length).toBeGreaterThanOrEqual(1);

    const learnings = orchestrator.getLearnings(undefined, 10);
    expect(Array.isArray(learnings)).toBe(true);

    const observations = orchestrator.getEngramObservations();
    expect(Array.isArray(observations)).toBe(true);
  });
});
