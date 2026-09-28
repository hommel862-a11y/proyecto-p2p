import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpAdPublisherService } from './mcp-ad-publisher.service';
import { McpService } from './mcp.service';
import { ToastService } from './toast.service';
import { DecisionJournalService } from './decision-journal.service';
import {
  BinanceRepricerService,
  REPRICER_EXECUTION_MODES,
  unregisterRepricerPublisher,
} from './binance-repricer.service';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import {
  InMemoryDecisionJournalRepository,
  type DecisionSide,
  type RecordOutcomeInput,
} from '@p2p/core';

// ---------------------------------------------------------------------------
// Harness del journal
//
// El seam real (`DecisionJournalService`) sobre el adapter de referencia
// (`InMemoryDecisionJournalRepository`), igual que en el spec del repricer: un
// doble permisivo no probaría nada. En particular, el outcome tiene una FK dura
// a una decisión existente, y con un doble que acepta cualquier id el test
// pasaría aunque el publisher mandara una correlación inventada.
// ---------------------------------------------------------------------------

type JournalInvoke = (op: string, payload?: unknown) => Promise<unknown>;

function installJournalBridge(invoke: JournalInvoke): void {
  const host = globalThis as { p2p?: Record<string, unknown> };
  host.p2p = { ...(host.p2p ?? {}), decisionJournal: { invoke } };
}

interface JournalHarness {
  readonly journal: DecisionJournalService;
  readonly repo: InMemoryDecisionJournalRepository;
  /** Los inputs tal como los envió el publisher, para afirmar sobre lo que se pidió. */
  readonly outcomeInputs: RecordOutcomeInput[];
  /** Ops forzadas a fallar, para ejercitar la política de robustez. */
  readonly failOn: Map<string, Error>;
  readonly ops: () => string[];
}

function createJournalHarness(): JournalHarness {
  const repo = new InMemoryDecisionJournalRepository();
  const outcomeInputs: RecordOutcomeInput[] = [];
  const failOn = new Map<string, Error>();
  const calls: string[] = [];

  const invoke: JournalInvoke = async (op, payload) => {
    calls.push(op);
    const failure = failOn.get(op);
    if (failure) throw failure;
    switch (op) {
      case 'appendOutcome': {
        const input = payload as RecordOutcomeInput;
        outcomeInputs.push(input);
        return repo.appendOutcome(input);
      }
      default:
        throw new Error(`decision_journal: unsupported IPC op "${op}"`);
    }
  };

  // El bridge tiene que existir ANTES de construir el servicio: lo resuelve en el
  // inicializador de campo y lanza si no lo encuentra.
  installJournalBridge(invoke);
  return {
    journal: new DecisionJournalService(),
    repo,
    outcomeInputs,
    failOn,
    ops: () => [...calls],
  };
}

describe('McpAdPublisherService', () => {
  let publisherSvc: McpAdPublisherService;
  let repricerSvc: BinanceRepricerService;
  let harness: JournalHarness;

  const mockToast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  const mockMcp = {
    testTool: vi.fn(),
  };

  /**
   * Siembra el ciclo, el snapshot y las decisiones contra el adapter real, y
   * devuelve los ids reales que el publisher tiene que usar para correlacionar.
   */
  async function seedDecisions(
    sides: readonly DecisionSide[],
  ): Promise<Record<DecisionSide, number>> {
    const snapshot = await harness.repo.appendMarketSnapshot({
      obi: 0.12,
      bidUsd: 960,
      askUsd: 985,
      nBids: 1,
      nAsks: 1,
      stale: false,
    });
    const cycle = await harness.repo.openCycle({
      origin: 'AUTO_ENGINE',
      capitalReservedUsdt: 0,
      title: 'Ciclo sembrado',
    });

    const ids = {} as Record<DecisionSide, number>;
    for (const side of sides) {
      const decision = await harness.repo.appendDecision({
        cycleId: cycle.id,
        snapshotId: snapshot.id,
        side,
        decisionPrice: side === 'BUY' ? 960 : 985,
        origin: 'AUTO_ENGINE',
        executionMode: 'PUBLISHING',
        action: 'UPDATE',
        modeledSpreadPct: 2.6,
        reason: 'decisión sembrada',
      });
      ids[side] = decision.id;
    }
    return ids;
  }

  /** Respuesta MCP de éxito, con la firma que el publicador guarda. */
  const mcpAccept = {
    success: true,
    result: { success: true, auditTrail: { signature: 'SIG-AD-OK' } },
  };

  beforeEach(async () => {
    mockToast.success.mockReset();
    mockToast.info.mockReset();
    mockToast.error.mockReset();
    mockMcp.testTool.mockReset();
    unregisterRepricerPublisher();
    harness = createJournalHarness();

    const injector = Injector.create({
      providers: [
        { provide: ToastService, useValue: mockToast },
        { provide: McpService, useValue: mockMcp },
        { provide: BinanceP2pService, useValue: { fetchMarketDepth: vi.fn() } },
        { provide: AccountsService, useValue: { usages: () => [] } },
        { provide: DecisionJournalService, useValue: harness.journal },
        BinanceRepricerService,
        McpAdPublisherService,
      ],
    });

    publisherSvc = injector.get(McpAdPublisherService);
    repricerSvc = injector.get(BinanceRepricerService);
  });

  afterEach(() => {
    publisherSvc.disablePublishing();
    unregisterRepricerPublisher();
    delete (globalThis as { p2p?: unknown }).p2p;
    vi.restoreAllMocks();
  });

  it('initially leaves BinanceRepricerService in READ_ONLY mode', () => {
    expect(publisherSvc.isEnabled()).toBe(false);
    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
  });

  it('activates PUBLISHING mode when enablePublishing is called', () => {
    publisherSvc.enablePublishing({ dryRun: true, maxDeviationPct: 2.5 });

    expect(publisherSvc.isEnabled()).toBe(true);
    expect(publisherSvc.isDryRun()).toBe(true);
    expect(publisherSvc.maxDeviationPct()).toBe(2.5);
    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.PUBLISHING);
    expect(repricerSvc.isPublishing()).toBe(true);
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('restores READ_ONLY mode when disablePublishing is called', () => {
    publisherSvc.enablePublishing();
    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.PUBLISHING);

    publisherSvc.disablePublishing();
    expect(publisherSvc.isEnabled()).toBe(false);
    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
    expect(mockToast.info).toHaveBeenCalled();
  });

  it('dispatches publish requests to MCP publish_ad_price tool and handles success', async () => {
    publisherSvc.enablePublishing({ dryRun: false });
    mockMcp.testTool.mockResolvedValue({
      success: true,
      result: {
        success: true,
        publishedPrice: 78.5,
        auditTrail: { signature: 'SIG-AD-TEST-123' },
      },
    });

    const result = await publisherSvc.publish({
      buyPrice: 78.5,
      sellPrice: 79.5,
      strategy: 'TOP_1',
    });

    expect(result).toBe(true);
    expect(mockMcp.testTool).toHaveBeenCalledTimes(2);
    expect(publisherSvc.lastPublishedSignature()).toBe('SIG-AD-TEST-123');
    expect(publisherSvc.successfulPublishesCount()).toBe(1);
    expect(publisherSvc.lastPublishTimestamp()).not.toBeNull();
  });

  it('aborts and returns false if MCP tool reports guardrail rejection', async () => {
    publisherSvc.enablePublishing();
    mockMcp.testTool.mockResolvedValue({
      success: true,
      result: {
        success: false,
        error: 'DESVÍO PELIGROSO RECHAZADO',
      },
    });

    const result = await publisherSvc.publish({
      buyPrice: 90.0,
      sellPrice: 0,
      strategy: 'TOP_1',
    });

    expect(result).toBe(false);
    expect(publisherSvc.lastRejectionError()).toContain('DESVÍO PELIGROSO RECHAZADO');
    expect(mockToast.error).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Journal de intentos de publicación (F2c)
  //
  // El bug que esto cierra: `successfulPublishesCount` es un counter acumulado.
  // Cuenta los aciertos, no recuerda los fallos, y no dice a qué decisión
  // pertenecen. Con `enablePublishing()` llevando el repricer a modo PUBLISHING
  // (escritura real de anuncios en Binance) eso es publicar a ciegas.
  // -------------------------------------------------------------------------

  describe('journal de intentos de publicación', () => {
    it('un intento aceptado deja un outcome con success true', async () => {
      const ids = await seedDecisions(['BUY', 'SELL']);
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockResolvedValue(mcpAccept);

      const result = await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 985,
        strategy: 'TOP_1',
        decisionIds: ids,
      });

      expect(result).toBe(true);
      expect(harness.outcomeInputs).toHaveLength(2);
      expect(harness.outcomeInputs.every((input) => input.success)).toBe(true);
      // Cada lado se cuelga de SU decisión, no de la última.
      expect(harness.outcomeInputs.map((input) => input.decisionId)).toEqual([
        ids.BUY,
        ids.SELL,
      ]);
      expect(harness.outcomeInputs.every((input) => input.source === 'BINANCE_MERCHANT')).toBe(
        true,
      );

      // Y se relee del puerto, no del doble: lo que quedó realmente almacenado.
      const stored = await harness.repo.listOutcomesByDecision(ids.BUY);
      expect(stored).toHaveLength(1);
      expect(stored[0].success).toBe(true);
      expect(stored[0].source).toBe('BINANCE_MERCHANT');
    });

    it('etiqueta el origen con un valor que el contrato de la tabla acepta', async () => {
      // `MCP_AGENT` NO es un `OutcomeSource`: es un `DecisionOrigin`. El enum de
      // outcomes es LOCAL_SIGNAL | BINANCE_MERCHANT | CSV_IMPORT | MANUAL, y el
      // CHECK de `schema.sql` no acepta nada más, así que un valor nuevo exige
      // tocar core, el schema y el adapter de SQLite a la vez.
      // Lo que el outcome registra es el CANAL del resultado, no quién lo produjo:
      // la autoridad que aceptó o rechazó fue el lado merchant de Binance, y eso
      // es `BINANCE_MERCHANT`. Quién lo produjo ya está en la decisión padre
      // (`origin`), que es a la que el outcome se cuelga siempre.
      const ids = await seedDecisions(['BUY']);
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockResolvedValue(mcpAccept);

      await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 0,
        strategy: 'TOP_1',
        decisionIds: { BUY: ids.BUY },
      });

      const stored = await harness.repo.listOutcomesByDecision(ids.BUY);
      expect(stored[0].source).toBe('BINANCE_MERCHANT');
      // La trazabilidad hasta el agente no se pierde: vive en la decisión.
      const decision = await harness.repo.getDecision(ids.BUY);
      expect(decision?.origin).toBe('AUTO_ENGINE');
    });

    it('un intento rechazado deja un outcome con success false y su error', async () => {
      // Esta es la regresión que da nombre al workstream: antes, un rechazo solo
      // tocaba un counter que no lo registra y una variable de UI.
      const ids = await seedDecisions(['BUY']);
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockResolvedValue({
        success: true,
        result: { success: false, error: 'DESVÍO PELIGROSO RECHAZADO' },
      });

      const result = await publisherSvc.publish({
        buyPrice: 90,
        sellPrice: 0,
        strategy: 'TOP_1',
        decisionIds: { BUY: ids.BUY },
      });

      expect(result).toBe(false);
      // Un rechazo sigue siendo un intento: se escribe igual.
      expect(harness.outcomeInputs).toHaveLength(1);
      expect(harness.outcomeInputs[0].success).toBe(false);
      expect(harness.outcomeInputs[0].decisionId).toBe(ids.BUY);
      expect(String(harness.outcomeInputs[0].detail)).toContain('DESVÍO PELIGROSO RECHAZADO');

      const stored = await harness.repo.listOutcomesByDecision(ids.BUY);
      expect(stored).toHaveLength(1);
      expect(stored[0].success).toBe(false);
    });

    it('un error de ejecución del MCP también queda registrado como fallo', async () => {
      const ids = await seedDecisions(['BUY']);
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockRejectedValue(new Error('timeout del socket MCP'));

      const result = await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 0,
        strategy: 'TOP_1',
        decisionIds: { BUY: ids.BUY },
      });

      expect(result).toBe(false);
      expect(harness.outcomeInputs).toHaveLength(1);
      expect(harness.outcomeInputs[0].success).toBe(false);
      expect(String(harness.outcomeInputs[0].detail)).toContain('timeout del socket MCP');
    });

    it('no reporta spread realizado sin fill confirmado: null y no 0', async () => {
      // Publicar un anuncio a precio X significa "pedí un precio", no "vendi a X".
      // El cierre real del trade llega después, por polling de Binance. Escribir
      // 0 produciría un journal que afirma "0% de spread realizado" sobre un trade
      // que todavía no existe: es la misma mentira que ya se corrigió en la
      // agregación de core, reintroducida por el otro lado.
      const ids = await seedDecisions(['BUY']);
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockResolvedValue(mcpAccept);

      await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 0,
        strategy: 'TOP_1',
        decisionIds: { BUY: ids.BUY },
      });

      const stored = await harness.repo.listOutcomesByDecision(ids.BUY);
      expect(stored).toHaveLength(1);
      const outcome = stored[0];
      expect(outcome.realizedSpreadPct).toBeNull();
      expect(outcome.realizedSpreadPct).not.toBe(0);
      expect(outcome.realizedProfitUsdt).toBeNull();
      expect(outcome.filledPrice).toBeNull();
      expect(outcome.filledAmountUsdt).toBe(0);

      // Y el input ni siquiera llevaba el campo: `null` se escribe omitiéndolo, y
      // un `0` hardcodeado no debe poder colarse por el tipo.
      expect('realizedSpreadPct' in harness.outcomeInputs[0]).toBe(false);
      expect(harness.outcomeInputs[0].realizedSpreadPct).toBeUndefined();
    });

    it('escribe exactamente un outcome por intento, por lado', async () => {
      const ids = await seedDecisions(['BUY', 'SELL']);
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockResolvedValue(mcpAccept);

      await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 985,
        strategy: 'TOP_1',
        decisionIds: ids,
      });

      // Dos anuncios, dos intentos, dos outcomes. Ni tres ni uno.
      expect(harness.ops().filter((op) => op === 'appendOutcome')).toHaveLength(2);
      expect(await harness.repo.listOutcomesByDecision(ids.BUY)).toHaveLength(1);
      expect(await harness.repo.listOutcomesByDecision(ids.SELL)).toHaveLength(1);
    });

    it('un rechazo temprano no inventa un outcome del lado que nunca se intentó', async () => {
      // El SELL ni se pidió: si se contara, el journal mediría una publicación que
      // no ocurrió.
      const ids = await seedDecisions(['BUY', 'SELL']);
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockResolvedValue({
        success: true,
        result: { success: false, error: 'RECHAZADO' },
      });

      const result = await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 985,
        strategy: 'TOP_1',
        decisionIds: ids,
      });

      expect(result).toBe(false);
      expect(harness.outcomeInputs).toHaveLength(1);
      expect(harness.outcomeInputs[0].decisionId).toBe(ids.BUY);
      expect(await harness.repo.listOutcomesByDecision(ids.SELL)).toHaveLength(0);
    });

    it('un fallo del journal no tumba la publicación', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const ids = await seedDecisions(['BUY', 'SELL']);
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockResolvedValue(mcpAccept);
      harness.failOn.set('appendOutcome', new Error('SQLITE_BUSY: database is locked'));

      const result = await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 985,
        strategy: 'TOP_1',
        decisionIds: ids,
      });

      // Misma política que el repricer: el trading no se frena porque la
      // persistencia no esté disponible.
      expect(result).toBe(true);
      expect(publisherSvc.successfulPublishesCount()).toBe(1);
      expect(publisherSvc.lastPublishedSignature()).toBe('SIG-AD-OK');
      // Pero tampoco se pierde en silencio.
      expect(consoleError).toHaveBeenCalled();
      expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/outcome/i);
      expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/SQLITE_BUSY/);
      // Un solo intento por outcome: el fallo no genera un segundo intento.
      expect(harness.outcomeInputs).toHaveLength(0);
    });

    it('sin correlación no inventa outcomes: sin decisión no hay a qué colgarse', async () => {
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockResolvedValue(mcpAccept);

      const result = await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 985,
        strategy: 'TOP_1',
      });

      // Publicar igual, no journalizar nada. `decision_outcomes.decision_id` es
      // una FK dura: un id inventado pasaría el tipo y no agruparía nada.
      expect(result).toBe(true);
      expect(harness.outcomeInputs).toHaveLength(0);
    });

    it('un outcome de intento hace la decisión verificable SIN que exista trade', async () => {
      // Este test fija, en forma ejecutable, el significado de la métrica que
      // este cambio de semántica introduce: `verifiedDecisions` va a contar
      // "tiene al menos un intento registrado", NO "tiene un trade realizado".
      const ids = await seedDecisions(['BUY']);
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockResolvedValue(mcpAccept);

      await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 0,
        strategy: 'TOP_1',
        decisionIds: { BUY: ids.BUY },
      });

      const summary = await harness.repo.getVerificationSummary();
      expect(summary.totalDecisions).toBe(1);
      expect(summary.verifiedDecisions).toBe(1);
      expect(summary.verificationRate).toBe(1);
      expect(summary.decisionsAwaitingOutcome).toBe(0);

      // Y al mismo tiempo el read model sigue diciendo la verdad sobre el dinero:
      // no hay nada realizado.
      const rows = await harness.repo.getDecisionPerformance();
      expect(rows).toHaveLength(1);
      expect(rows[0].fillCount).toBe(1);
      expect(rows[0].realizedSpreadPct).toBeNull();
      expect(rows[0].realizedProfitUsdt).toBeNull();
      expect(rows[0].filledAmountUsdt).toBe(0);
      // El spread modelado sigue siendo un modelo, no una medida.
      expect(rows[0].modeledSpreadPct).toBe(2.6);
    });
  });
});
