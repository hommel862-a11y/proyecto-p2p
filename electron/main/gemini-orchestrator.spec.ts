import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { P2PDatabaseService } from './db/database';
import type { StrategyPlanRecord } from './db/database';
import { GeminiOrchestrator } from './gemini-orchestrator';
import type { WebhookDispatcher } from './services/webhook-dispatcher';
import { killswitchState, resetKillswitch, triggerKillswitch } from './ipc/killswitch-state';
import { clearTreasurySnapshot, setTreasurySnapshot } from './ipc/treasury-snapshot';
import type { TreasurySnapshotDto } from '../shared/types';

describe('Gemini Orchestrator End-to-End Operational Lifecycle', () => {
  const testDbPath = path.resolve(__dirname, '../../scratch/test_copilot_ops.sqlite');
  let dbService: P2PDatabaseService;
  let orchestrator: GeminiOrchestrator;
  let originalKey: string | undefined;

  beforeEach(() => {
    resetKillswitch();
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
    resetKillswitch();
    if (originalKey !== undefined) {
      process.env['GEMINI_API_KEY'] = originalKey;
    }
    dbService.close();
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {
        /* ignore test db cleanup */
      }
    }
  });

  it('procesa una solicitud operativa, formula un plan SOP y lo persiste en SQLite', async () => {
    const prompt =
      'Activa el triaje de incidencia para retención de cuenta bancaria y audita el cumplimiento SOP';
    const response = await orchestrator.sendMessage({ prompt });

    // 1. Validar contenido analítico en la respuesta
    expect(response.reply).toContain('Auditoría de Cumplimiento SOP');
    expect(response.reply).toContain('Matriz de Triaje & Escalación');
    expect(response.reply).toContain('Conciliación Contable & Runway');

    // 2. Validar generación del plan táctico
    expect(response.suggestedPlan).toBeDefined();
    const plan = response.suggestedPlan!;
    expect(plan.status).toBe('PROPOSED');
    expect(plan.expectedNetSpreadPct).toBeGreaterThanOrEqual(0.5);
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

  it('interroga el historial forense y diagnostica disciplina de spread y horarios de riesgo', async () => {
    dbService.recordAuditLog({
      id: 'LOG-TEST-1',
      timestamp: '2026-09-19T11:30:00Z',
      category: 'SECURITY_ALERT',
      action: 'PAYMENT_MISMATCH',
      details: 'Discrepancia en comprobante',
      severity: 'error',
      createdAt: Date.now(),
    });
    dbService.saveOperationRecord({
      id: 'OP-TEST-1',
      timestamp: '2026-09-19T10:00:00Z',
      side: 'SELL',
      fiatAmount: 85000,
      cryptoAmount: 1000,
      price: 85.0,
      bank: 'Banesco',
      status: 'COMPLETED',
      rawJson: JSON.stringify({ netSpreadPct: 1.25 }),
      createdAt: Date.now(),
    });

    const prompt =
      '¿En qué horarios tuve más alertas de riesgo esta semana y respeté el spread mínimo?';
    const response = await orchestrator.sendMessage({ prompt });

    expect(response.reply).toContain('Auditoría Forense del Libro Mayor');
    expect(response.reply).toContain('Distribución Horaria de Riesgo & Alertas');
    expect(response.reply).toContain('Disciplina Operativa & Regla de Oro');
    expect(response.suggestedPlan).toBeDefined();
    expect(response.suggestedPlan?.title).toContain('Plan de Mitigación Forense');
    expect(response.suggestedPlan?.expectedNetSpreadPct).toBeGreaterThanOrEqual(0.5);
  });

  /**
   * ODD T3 (C1): plan execution sits behind an execution barrier. The kill-switch and the
   * real treasury projection are module-level singletons shared with the rest of the main
   * process, so every test arms and disarms them explicitly.
   */
  describe('barrera de ejecución: kill-switch y tesorería real', () => {
    const barrierPlanId = 'PLAN-BARRIER-1';
    let guarded: GeminiOrchestrator;
    let dispatchPlanExecution: ReturnType<typeof vi.fn>;

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

    beforeEach(() => {
      resetKillswitch();
      clearTreasurySnapshot();

      // A stub dispatcher makes "no despachó" an assertion instead of an inference.
      dispatchPlanExecution = vi.fn().mockResolvedValue({
        planId: barrierPlanId,
        timestamp: Date.now(),
        telegram: { sent: false },
        sheets: { synced: false, mode: 'SIMULATED' },
      });
      guarded = new GeminiOrchestrator(
        dbService,
        undefined,
        undefined,
        { dispatchPlanExecution } as unknown as WebhookDispatcher,
      );

      const plan: StrategyPlanRecord = {
        id: barrierPlanId,
        title: 'Plan de la barrera de ejecución',
        route: 'BINANCE_P2P -> BANESCO_PM',
        asset: 'USDT',
        fiat: 'VES',
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: 1.4,
        expectedProfitUsdt: 14,
        riskLevel: 'LOW',
        rationale: 'Spread neto por encima de la regla de oro.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      dbService.saveStrategyPlan(plan);
    });

    afterEach(() => {
      resetKillswitch();
      clearTreasurySnapshot();
    });

    it('bloquea la ejecución con el kill-switch activo: no aprueba ni despacha', async () => {
      triggerKillswitch('Prueba de barrera', 'SPEC');

      const result = await guarded.executePlan(barrierPlanId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('kill-switch activo');
      expect(result.dispatchSummary).toBeUndefined();
      expect(dispatchPlanExecution).not.toHaveBeenCalled();
      expect(dbService.getStrategyPlan(barrierPlanId)?.status).toBe('PROPOSED');
      expect(
        dbService
          .listEngramObservations()
          .some((obs) => obs.topicKey.startsWith(`execution/blocked-${barrierPlanId}`)),
      ).toBe(true);
    });

    it('con el kill-switch ACTIVO en el proceso main, sendMessage rechaza la solicitud sin emitir respuesta (F2)', async () => {
      triggerKillswitch('Emergencia de seguridad detectada por centinela', 'SECURITY_SENTINEL');

      await expect(
        guarded.sendMessage({
          prompt: '¿Cuál es la mejor ruta para arbitrar Banesco y Binance P2P hoy?',
        }),
      ).rejects.toThrow(/KILLSWITCH_ACTIVE/);

      // Ni respuesta heurística ni de Gemini se emite, y ningún plan es generado
      const plans = guarded.getPlans(10);
      expect(plans.filter((p) => p.title.includes('Banesco'))).toHaveLength(0);
    });

    it('con el kill-switch ACTIVO y API Key configurada, sendMessage rechaza inmediatamente sin llamadas de red (F2)', async () => {
      guarded.setApiKey('test-dummy-api-key');
      triggerKillswitch('Pánico de mercado', 'MANUAL_OVERRIDE');

      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      try {
        await expect(
          guarded.sendMessage({
            prompt: 'Consulta ejecutiva de tesorería',
          }),
        ).rejects.toThrow(/KILLSWITCH_ACTIVE/);

        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it.each([
      ['over-limit', { overLimitCount: 1 }],
      ['saturada', { saturatedCount: 1 }],
      ['deshabilitada', { disabledCount: 1 }],
    ])(
      'bloquea la ejecución con la tesorería real en estado crítico (%s)',
      async (_label, overrides) => {
        setTreasurySnapshot(buildSnapshot(overrides));

        const result = await guarded.executePlan(barrierPlanId);

        expect(result.success).toBe(false);
        expect(result.error).toContain('tesorería real en estado crítico');
        expect(dispatchPlanExecution).not.toHaveBeenCalled();
        expect(dbService.getStrategyPlan(barrierPlanId)?.status).toBe('PROPOSED');
      },
    );

    it('bloquea la ejecución con una cuenta sobre el límite y otra deshabilitada', async () => {
      setTreasurySnapshot(buildSnapshot({ overLimitCount: 1, disabledCount: 1 }));

      const result = await guarded.executePlan(barrierPlanId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('1 deshabilitada(s)');
      expect(result.error).toContain('1 sobre el límite diario');
    });

    it('ejecuta sin restricciones: kill-switch libre y sin snapshot cacheado', async () => {
      const result = await guarded.executePlan(barrierPlanId);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.riskWarnings).toBeUndefined();
      expect(dispatchPlanExecution).toHaveBeenCalledTimes(1);
      expect(dbService.getStrategyPlan(barrierPlanId)?.status).toBe('APPROVED');
    });

    it('ejecuta con advertencia cuando una cuenta se acerca al límite diario', async () => {
      setTreasurySnapshot(buildSnapshot({ nearLimitCount: 1 }));

      const result = await guarded.executePlan(barrierPlanId);

      expect(result.success).toBe(true);
      expect(result.riskWarnings).toHaveLength(1);
      expect(result.riskWarnings?.[0]).toContain('cerca');
      expect(dispatchPlanExecution).toHaveBeenCalledTimes(1);
      expect(dbService.getStrategyPlan(barrierPlanId)?.status).toBe('APPROVED');
    });

    it('reacciona en caliente: un kill-switch disparado después bloquea el siguiente plan', async () => {
      const first = await guarded.executePlan(barrierPlanId);
      expect(first.success).toBe(true);

      triggerKillswitch('Segundo intento', 'SPEC');
      expect(killswitchState.isTriggered).toBe(true);

      dbService.saveStrategyPlan({
        ...(dbService.getStrategyPlan(barrierPlanId) as StrategyPlanRecord),
        id: 'PLAN-BARRIER-2',
        status: 'PROPOSED',
      });
      const second = await guarded.executePlan('PLAN-BARRIER-2');

      expect(second.success).toBe(false);
      expect(second.error).toContain('Segundo intento');
      expect(dispatchPlanExecution).toHaveBeenCalledTimes(1);
    });
  });

  describe('Bucle Agéntico ReAct Multi-Paso & Conexión de Herramientas Cuantitativas', () => {
    let mockFetch: ReturnType<typeof vi.fn>;
    const originalFetch = global.fetch;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('encadena múltiples herramientas secuencialmente en el bucle ReAct (Pass 1 -> Pass 2 -> Texto)', async () => {
      const apiKey = 'AIzaSyFakeKeyForReActTesting123';
      const reactOrchestrator = new GeminiOrchestrator(dbService, apiKey);

      // Turn 1: Gemini decides to call predict_bcv_market_intelligence
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'predict_bcv_market_intelligence',
                      args: { parallelRate: 85.5, bcvRate: 64.2 },
                    },
                  },
                ],
              },
            },
          ],
        }),
      });

      // Turn 2: Gemini receives the BCV intelligence data and decides to evaluate golden spread
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'evaluate_golden_spread',
                      args: { netSpreadPct: 1.15 },
                    },
                  },
                ],
              },
            },
          ],
        }),
      });

      // Turn 3: Gemini finishes tool calling and returns full analytical synthesis
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Análisis multi-paso completado: la brecha del BCV está bajo control y el spread neto del 1.15% cumple con la regla de oro institucional.',
                  },
                ],
              },
            },
          ],
        }),
      });

      const res = await reactOrchestrator.sendMessage({
        prompt: 'Audita la brecha BCV y el spread proyectado para vender hoy en Banesco.',
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(res.reply).toContain('Análisis multi-paso completado');
      expect(res.skillsExecuted).toEqual([
        'predict_bcv_market_intelligence',
        'evaluate_golden_spread',
      ]);
    });

    it('ejecuta herramientas MCP nativas durante el bucle ReAct cuando no están en el registro local', async () => {
      const apiKey = 'AIzaSyFakeKeyForMcpReAct123';
      const reactOrchestrator = new GeminiOrchestrator(dbService, apiKey);

      // Turn 1: Gemini calls MCP tool scan_synthetic_stable_arbitrage
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'scan_synthetic_stable_arbitrage',
                      args: {
                        initialAmount: 1000,
                        fiatCurrency: 'VES',
                        buyLegPrice: 85.0,
                        sellLegPrice: 86.5,
                        transferOrCashFrictionPct: 0.1,
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
      });

      // Turn 2: Gemini synthesizes response based on MCP tool output
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Oportunidad de arbitraje sintético detectada y validada mediante el servidor MCP.',
                  },
                ],
              },
            },
          ],
        }),
      });

      const res = await reactOrchestrator.sendMessage({
        prompt: 'Escanea arbitraje sintético USDT/VES.',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(res.skillsExecuted).toContain('scan_synthetic_stable_arbitrage');
      expect(res.reply).toContain('arbitraje sintético');
    });

    it('respeta el guardarraíl de MAX_REACT_STEPS (5) y ejecuta la síntesis final si el modelo no frena', async () => {
      const apiKey = 'AIzaSyFakeKeyForInfiniteLoopGuard';
      const reactOrchestrator = new GeminiOrchestrator(dbService, apiKey);

      // Simulate 5 consecutive function calls (max steps)
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: 'evaluate_golden_spread',
                        args: { netSpreadPct: 0.8 },
                      },
                    },
                  ],
                },
              },
            ],
          }),
        });
      }

      // 6th call: synthesis fallback
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Síntesis ejecutiva forzada tras alcanzar el límite seguro de 5 pasos ReAct.',
                  },
                ],
              },
            },
          ],
        }),
      });

      const res = await reactOrchestrator.sendMessage({
        prompt: 'Bucle iterativo infinito simulado',
      });

      // 5 tool steps + 1 synthesis step = 6 calls total
      expect(mockFetch).toHaveBeenCalledTimes(6);
      expect(res.skillsExecuted).toHaveLength(5);
      expect(res.reply).toContain('Síntesis ejecutiva forzada');
    });
  });
});
