import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { P2PDatabaseService } from './db/database';
import type { StrategyPlanRecord } from './db/database';
import { GeminiOrchestrator } from './gemini-orchestrator';
import type { WebhookDispatcher } from './services/webhook-dispatcher';
import { killswitchState, resetKillswitch, triggerKillswitch } from './ipc/killswitch-state';
import { clearTreasurySnapshot, setTreasurySnapshot } from './ipc/treasury-snapshot';
import {
  clearFinancialSkillMarketData,
  getMarketBook,
  seedFinancialSkillMarketData,
} from './skills/market-state';
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

    // 4. La provenance del plan refleja que NO hay feed en vivo en este escenario,
    //    así que la Human-in-the-Loop "PLAY" debe rechazarlo en la puerta de despacho.
    expect(plan.esSimulado).toBe(true);
    const execResult = await orchestrator.executePlan(plan.id);
    expect(execResult.success).toBe(false);
    expect(execResult.error).toMatch(/feed de mercado en vivo/i);
    expect(execResult.dispatchSummary).toBeUndefined();

    // 5. El plan queda en PROPOSED: no se aprueba ni despacha nada
    expect(dbService.getStrategyPlan(plan.id)?.status).toBe('PROPOSED');

    // 6. La memoria persistente registra el bloqueo, no una ejecución
    const engramRecords = dbService.listEngramObservations();
    const blockedObservation = engramRecords.find((r) =>
      r.topicKey.startsWith(`execution/blocked-${plan.id}`),
    );
    expect(blockedObservation).toBeDefined();
    expect(
      engramRecords.find((r) => r.topicKey === `execution/plan-${plan.id}`),
    ).toBeUndefined();
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
        // The shared fixture is provenance-clean so each barrier test exercises its
        // OWN gate. The provenance gate has its own test below.
        esSimulado: false,
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

    it('NUNCA clasifica un plan sin feed en vivo como riesgo LOW', async () => {
      const prompts: Array<[string, RegExp]> = [
        ['Rotación BCV y drenaje fiscal SENIAT', /rotaci|bcv|seniat|macro/i],
        ['Cobertura delta-neutral y funding arbitrage', /hedge|delta|funding|cobertura/i],
        ['Concentración de órdenes y book pressure', /book|orden|order|concentrac/i],
        ['Vuelo de fiat y dollarization', /fiat|dolariz|flight/i],
        ['Market making con inventario post-trade', /market making|avellaneda|inventario/i],
        ['Triaje y escalamiento operativo', /triaje|escalamiento|operativ/i],
      ];

      const seenPlans: string[] = [];
      for (const [prompt, matcher] of prompts) {
        const res = await orchestrator.sendMessage({ prompt });
        const plan = res.suggestedPlan;
        expect(plan, `sin plan para: ${prompt}`).toBeDefined();
        if (plan && matcher.test(plan.title + ' ' + plan.rationale)) {
          seenPlans.push(plan.title);
          expect(plan.esSimulado, plan.title).toBe(true);
          // Sin libro de órdenes no existe base para un riesgo "LOW": fail closed a HIGH.
          expect(plan.riskLevel, plan.title).toBe('HIGH');
        }
      }
      expect(seenPlans.length).toBeGreaterThan(1);
    });

    it('bloquea la ejecución de un plan SIMULADO: no aprueba ni despacha', async () => {
      dbService.saveStrategyPlan({
        id: barrierPlanId,
        title: 'Plan de la barrera de ejecución',
        route: 'BINANCE_P2P -> BANESCO_PM',
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: 1.4,
        expectedProfitUsdt: 14,
        riskLevel: 'LOW',
        rationale: 'Spread neto por encima de la regla de oro.',
        status: 'PROPOSED',
        esSimulado: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const result = await guarded.executePlan(barrierPlanId);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/feed de mercado en vivo/i);
      expect(result.dispatchSummary).toBeUndefined();
      expect(dispatchPlanExecution).not.toHaveBeenCalled();
      expect(dbService.getStrategyPlan(barrierPlanId)?.status).toBe('PROPOSED');
      expect(
        dbService
          .listEngramObservations()
          .some((obs) => obs.topicKey.startsWith(`execution/blocked-${barrierPlanId}`)),
      ).toBe(true);
    });

    it('persiste esSimulado en SQLite y falla cerrado en filas legacy sin la columna', () => {
      // The provenance flag must survive a round-trip, otherwise the dispatch gate
      // can never tell a live plan from a reference-value plan.
      dbService.saveStrategyPlan({
        id: 'plan-sim-001',
        title: 'Plan simulado',
        route: 'BINANCE_P2P -> BANESCO_PM',
        capitalRequiredUsdt: 800,
        expectedNetSpreadPct: 1.1,
        expectedProfitUsdt: 8.8,
        riskLevel: 'LOW',
        rationale: 'Generado con parámetros de referencia.',
        status: 'PROPOSED',
        esSimulado: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      expect(dbService.getStrategyPlan('plan-sim-001')?.esSimulado).toBe(true);

      dbService.saveStrategyPlan({
        id: 'plan-live-001',
        title: 'Plan con feed en vivo',
        route: 'BINANCE_P2P -> BANESCO_PM',
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: 1.4,
        expectedProfitUsdt: 14,
        riskLevel: 'LOW',
        rationale: 'Feed en vivo confirmado.',
        status: 'PROPOSED',
        esSimulado: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const liveRow = dbService.getStrategyPlan('plan-live-001');
      expect(liveRow).not.toBeNull();
      // Sanity on the write path before asserting the mapping.
      expect(liveRow?.esSimulado).toBe(false);

      // Simulating a legacy row (no esSimulated at all) must read back as
      // simulated, never as live.
      dbService.saveStrategyPlan({
        id: 'plan-legacy-001',
        title: 'Plan legado',
        route: 'BINANCE_P2P -> BANESCO_PM',
        capitalRequiredUsdt: 500,
        expectedNetSpreadPct: 0.9,
        expectedProfitUsdt: 4.5,
        riskLevel: 'LOW',
        rationale: 'Fila creada sin el flag de provenance.',
        status: 'PROPOSED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      expect(dbService.getStrategyPlan('plan-legacy-001')?.esSimulado).toBe(true);
    });

    it('despacha un plan marcado esSimulado:false, porque su provenance es live', async () => {
      dbService.saveStrategyPlan({
        id: 'plan-live-dispatch-001',
        title: 'Plan verificado contra el libro real',
        route: 'BINANCE_P2P -> BANESCO_PM',
        capitalRequiredUsdt: 1000,
        expectedNetSpreadPct: 1.4,
        expectedProfitUsdt: 14,
        riskLevel: 'LOW',
        rationale: 'Feed en vivo confirmado.',
        status: 'PROPOSED',
        esSimulado: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const result = await guarded.executePlan('plan-live-dispatch-001');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(dispatchPlanExecution).toHaveBeenCalledTimes(1);
      expect(dbService.getStrategyPlan('plan-live-dispatch-001')?.status).toBe('APPROVED');
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

    it(
      'ejecuta herramientas MCP nativas durante el bucle ReAct cuando no están en el registro local',
      async () => {
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
    }, 20000);

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

    it('dispatches through UniversalAiGateway when activeProvider is openai or deepseek', async () => {
      const openAiKey = 'sk-proj-TestOpenAiKey123';
      const multiOrchestrator = new GeminiOrchestrator(dbService);
      multiOrchestrator.setApiKey(openAiKey, 'openai');
      multiOrchestrator.setActiveProvider('openai', 'gpt-4o');

      // Mock OpenAI-compatible chat completions response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '### 🎯 Diagnóstico Situacional\nMercado en calma. Spread neto 1.15% viable.',
              },
            },
          ],
        }),
      });

      const res = await multiOrchestrator.sendMessage({
        prompt: '¿Cómo ves el spread hoy?',
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(res.reply).toContain('Diagnóstico Situacional');
      expect(res.provenance?.source).toBe('openai');
      expect(res.provenance?.model).toBe('gpt-4o');
    }, 20000);
  });

  describe('Gate 0: provenance honesta y presupuesto de llamadas pagas', () => {
    let mockFetch: ReturnType<typeof vi.fn>;
    const originalFetch = global.fetch;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch as unknown as typeof fetch;
      clearFinancialSkillMarketData();
    });

    afterEach(() => {
      global.fetch = originalFetch;
      clearFinancialSkillMarketData();
    });

    const textReply = (text: string) => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    });

    it('NUNCA declara feed en vivo cuando no hay libro de mercado cargado', async () => {
      const apiKey = 'AIzaSyFakeKeyProvenanceTesting123';
      const orchestrator = new GeminiOrchestrator(dbService, apiKey);
      mockFetch.mockResolvedValue(textReply('Respuesta sin libro de mercado detrás.'));

      const res = await orchestrator.sendMessage({ prompt: '¿Cómo está el mercado?' });

      expect(res.provenance?.liveMarketFeedConnected).toBe(false);
      expect(res.provenance?.esSimulado).toBe(true);
      expect(res.provenance?.marketFeedReason).toBe('NO_BOOK');
      // The old code hardcoded liveMarketFeedConnected: true here.
      expect(res.provenance?.liveMarketFeedConnected).not.toBe(true);
    });

    it('declara feed en vivo sólo con un libro fresco, completo y reciente', async () => {
      const apiKey = 'AIzaSyFakeKeyProvenanceTesting123';
      const orchestrator = new GeminiOrchestrator(dbService, apiKey);

      seedFinancialSkillMarketData({
        buyOffers: [
          {
            asset: 'USDT',
            fiat: 'VES',
            price: 88.35,
            maxVes: 100000,
            minVes: 1000,
            available: 1,
            tradeMethods: [],
            nickname: 'op',
            orderType: 'BUY',
          } as never,
        ],
        sellOffers: [
          {
            asset: 'USDT',
            fiat: 'VES',
            price: 89.55,
            maxVes: 100000,
            minVes: 1000,
            available: 1,
            tradeMethods: [],
            nickname: 'op',
            orderType: 'SELL',
          } as never,
        ],
      });
      mockFetch.mockResolvedValue(textReply('Análisis con libro real.'));

      const res = await orchestrator.sendMessage({ prompt: 'Analizá el spread real.' });

      expect(res.provenance?.liveMarketFeedConnected).toBe(true);
      expect(res.provenance?.esSimulado).toBe(false);
      expect(res.provenance?.marketFeedReason).toBe('LIVE');
    });

    it('un libro VENCIDO no se reporta como mercado en vivo', async () => {
      const apiKey = 'AIzaSyFakeKeyProvenanceTesting123';
      const orchestrator = new GeminiOrchestrator(dbService, apiKey);
      seedFinancialSkillMarketData({
        buyOffers: [{ price: 88.35, maxVes: 100000 } as never],
        sellOffers: [{ price: 89.55, maxVes: 100000 } as never],
      });

      // Age the snapshot past the TTL.
      const book = getMarketBook();
      expect(book).not.toBeNull();
      (book as { updatedAt: number }).updatedAt = Date.now() - 60 * 60 * 1000;

      mockFetch.mockResolvedValue(textReply('Respuesta con libro viejo.'));

      const res = await orchestrator.sendMessage({ prompt: 'Analizá el spread.' });

      expect(res.provenance?.liveMarketFeedConnected).toBe(false);
      expect(res.provenance?.marketFeedReason).toBe('STALE_BOOK');
      expect(res.provenance?.esSimulado).toBe(true);
    });

    it('respeta el presupuesto de llamadas pagas por turno', async () => {
      const apiKey = 'AIzaSyFakeKeyBudgetTesting12345';
      const budgeted = new GeminiOrchestrator(dbService, apiKey, undefined, undefined, 3);
      // Always "ok" so every model in the cascade would otherwise be tried.
      mockFetch.mockResolvedValue(
        Object.assign(textReply('sin herramientas'), { status: 200 }),
      );

      await budgeted.sendMessage({ prompt: 'ping' });

      // Hard ceiling, not a report. The old code had no ceiling at all and
      // could spend models x (MAX_REACT_STEPS + 1) calls on one turn.
      expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('el kill-switch bloquea la transcripción sin gastar una llamada paga', async () => {
      const apiKey = 'AIzaSyFakeKeyKillswitchTesting12';
      const guarded = new GeminiOrchestrator(dbService, apiKey);
      triggerKillswitch('Prueba de transcripción', 'SPEC');

      const result = await guarded.transcribeAudio({
        audioBase64: 'AAAA',
        mimeType: 'audio/webm',
      });

      expect(result.error).toContain('KILLSWITCH_ACTIVE');
      expect(result.text).toBe('');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  /**
   * Doctrine under test: a missing measurement is `null` plus a declared absence, never a number.
   *
   * Three deterministic branches answered `const bcvRate = 72.0;` — an unconditional constant
   * that never read the input, next to a parallel rate that WAS read from the live feed. So the
   * skill ran on an invented official rate and the reply printed it beside a real one. Worse,
   * `macro-skills.ts` coerces an absent rate to 0 and the vendored `calculateBcvGap` answers a
   * non-positive rate with `gapPct: 0, zone: 'NORMAL'` — a "there is no gap" claim built on
   * nothing, which is what the branch actually printed once the parallel feed was offline.
   */
  describe('tasa oficial BCV: la constante 72.0', () => {
    /** Seeds a fresh, complete book so the parallel leg is a real measurement. */
    function seedLiveBook(): void {
      seedFinancialSkillMarketData({
        buyOffers: [{ price: 88.35, maxVes: 100000 } as never],
        sellOffers: [{ price: 89.55, maxVes: 100000 } as never],
      });
    }

    afterEach(() => {
      clearFinancialSkillMarketData();
    });

    it('CASO 2 (macro BCV) reporta la tasa oficial como N/D y nombra la fuente', async () => {
      const res = await orchestrator.sendMessage({
        prompt: '¿Cómo está la brecha cambiaria entre el BCV y el paralelo?',
      });

      // Proves the CASO 2 branch is the one under test.
      expect(res.reply).toContain('política monetaria del BCV');
      expect(res.reply).toContain('**Tasa Oficial BCV**: N/D');
      expect(res.reply).not.toContain('**Tasa Oficial BCV**: 72');
      expect(res.reply).toMatch(/get_bcv_rates/);
    });

    it('CASO 2 no inventa la zona de riesgo de la brecha', async () => {
      const res = await orchestrator.sendMessage({
        prompt: '¿Cómo está la brecha cambiaria entre el BCV y el paralelo?',
      });

      // `bcvData.gap?.riskZone ?? 'ELEVATED'` painted a risk zone on a gap nobody measured.
      expect(res.reply).not.toContain('Zona de Riesgo: **ELEVATED**');
      expect(res.reply).toContain('N/D');
    });

    it('CASO 8 (resumen ejecutivo) reporta ambas tasas como N/D', async () => {
      const res = await orchestrator.sendMessage({ prompt: 'Dame un resumen ejecutivo del enjambre' });

      expect(res.reply).toContain('Resumen Ejecutivo de la Mesa P2P');
      expect(res.reply).toContain('BCV: N/D VES/USD');
      expect(res.reply).not.toContain('BCV: 72.00 VES/USD');
    });

    it('CASO 11 (triangulación) no imprime una brecha de 0.00%', async () => {
      const res = await orchestrator.sendMessage({ prompt: 'arbitraje' });

      // Proves the default branch is the one under test.
      expect(res.reply).toContain('arbitraje triangular institucional');
      // gapPct 0 was the vendored predictor's answer to a coerced zero rate.
      expect(res.reply).toContain('**Brecha Cambiaria BCV**: N/D%');
      expect(res.reply).not.toMatch(/\*\*Brecha Cambiaria BCV\*\*: 0\.00%/);
    });

    it('con libro en vivo la tasa paralela se reporta y la BCV sigue en N/D', async () => {
      seedLiveBook();

      const res = await orchestrator.sendMessage({
        prompt: '¿Cómo está la brecha cambiaria entre el BCV y el paralelo?',
      });

      expect(res.reply).toMatch(/\*\*Tasa Paralela P2P\*\*: 89\.55/);
      expect(res.reply).toContain('**Tasa Oficial BCV**: N/D');
    });
  });
});
