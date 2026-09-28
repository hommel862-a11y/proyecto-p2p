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
    // Por defecto hay puente nativo (Electron). Cada test que simula un build
    // web lo apaga explícitamente, para que el caso raro sea visible.
    hasNativeTransport: vi.fn((): boolean => true),
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

  /**
   * Respuesta MCP con CONFIRMACIÓN REAL del merchant.
   *
   * Solo existe en los tests a propósito: en este repositorio no hay capa de
   * escritura contra la API de merchant de Binance, así que ninguna respuesta
   * real trae esto. Es el contrato que el publicador tiene que reconocer para
   * poder journalizar `BINANCE_MERCHANT`: si algún día se implementa la
   * escritura real, este es el shape que tiene que producir.
   *
   * El `signature` NO es `SIG-AD-...`: esa forma es la del recibo fabricado por
   * el simulador, y un `externalRef` de Binance no se parece a eso.
   */
  const mcpMerchantConfirm = {
    success: true,
    result: {
      success: true,
      merchantConfirmed: true,
      status: 'PUBLISHED_LIVE',
      dryRun: false,
      auditTrail: {
        guardrailChecked: true,
        signature: 'BINANCE-MERCHANT-REF-8842',
        merchantRef: 'BINANCE-MERCHANT-REF-8842',
      },
    },
  };

  /**
   * Respuesta MCP de una ejecución SIMULADA — el caso que el bug daba por bueno.
   *
   * Es lo que devuelve hoy `publish_ad_price` (recibo fabricado con
   * `Date.now()`) y también lo que devuelve `simulateMcpTool` en build web
   * (`simulated: true` con la misma firma inventada). Ninguna de las dos cosas
   * salió de la máquina, así que ninguna puede journalizarse como confirmación
   * de Binance.
   */
  const mcpSimulated = {
    success: true,
    result: {
      success: true,
      simulated: true,
      status: 'SIMULATED_SUCCESS',
      dryRun: true,
      auditTrail: { guardrailChecked: true, signature: 'SIG-AD-ADV-01-1700000000000' },
    },
  };

  beforeEach(async () => {
    mockToast.success.mockReset();
    mockToast.info.mockReset();
    mockToast.error.mockReset();
    mockMcp.testTool.mockReset();
    mockMcp.hasNativeTransport.mockReset();
    mockMcp.hasNativeTransport.mockReturnValue(true);
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

  it('NO activa PUBLISHING en dry-run: una simulación no es un publicador real', () => {
    // Este test antes afirmaba lo contrario (`executionMode() === PUBLISHING` con
    // `dryRun: true`). El modo del repricer se DERIVA de que haya un publicador
    // registrado, así que registrar un simulador le hacía decir "PUBLICANDO EN
    // BINANCE" sobre un pipeline que no publica nada. Un número que el operador
    // lee tiene que ser verdad también en la etiqueta del modo.
    publisherSvc.enablePublishing({ dryRun: true, maxDeviationPct: 2.5 });

    expect(publisherSvc.isEnabled()).toBe(true);
    expect(publisherSvc.isDryRun()).toBe(true);
    expect(publisherSvc.maxDeviationPct()).toBe(2.5);
    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
    expect(repricerSvc.isPublishing()).toBe(false);
    expect(repricerSvc.executionModeLabel()).toBe('SOLO LECTURA — NO PUBLICA');
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('activa PUBLISHING solo con dry-run apagado y puente MCP nativo', () => {
    publisherSvc.enablePublishing({ dryRun: false });

    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.PUBLISHING);
    expect(repricerSvc.isPublishing()).toBe(true);
  });

  it('NO activa PUBLISHING en build web aunque el operador apague el dry-run', () => {
    // El otro disparador del bug: en web `McpService.testTool` no sale de la
    // máquina, responde `simulateMcpTool`. Sin puente nativo no hay a quién
    // delegarle una escritura, así que el modo tiene que seguir siendo
    // READ_ONLY aunque `dryRun` esté en false.
    mockMcp.hasNativeTransport.mockReturnValue(false);
    publisherSvc.enablePublishing({ dryRun: false });

    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
    expect(repricerSvc.isPublishing()).toBe(false);
  });

  it('restores READ_ONLY mode when disablePublishing is called', () => {
    publisherSvc.enablePublishing({ dryRun: false });
    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.PUBLISHING);

    publisherSvc.disablePublishing();
    expect(publisherSvc.isEnabled()).toBe(false);
    expect(repricerSvc.executionMode()).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
    expect(mockToast.info).toHaveBeenCalled();
  });

  it('dispatches publish requests to MCP publish_ad_price tool and handles success', async () => {
    publisherSvc.enablePublishing({ dryRun: false });
    mockMcp.testTool.mockResolvedValue(mcpMerchantConfirm);

    const result = await publisherSvc.publish({
      buyPrice: 78.5,
      sellPrice: 79.5,
      strategy: 'TOP_1',
    });

    expect(result).toBe(true);
    expect(mockMcp.testTool).toHaveBeenCalledTimes(2);
    // Solo una referencia REAL del merchant llega a la señal de UI. Antes se
    // publicaba ahí el `SIG-AD-...` fabricado, que en pantalla se leía como un
    // comprobante del exchange.
    expect(publisherSvc.lastPublishedSignature()).toBe('BINANCE-MERCHANT-REF-8842');
    expect(publisherSvc.successfulPublishesCount()).toBe(1);
    expect(publisherSvc.lastPublishTimestamp()).not.toBeNull();
  });

  it('NO expone una firma fabricada como si fuera una publicación real', async () => {
    publisherSvc.enablePublishing({ dryRun: false });
    mockMcp.testTool.mockResolvedValue(mcpSimulated);

    const result = await publisherSvc.publish({
      buyPrice: 78.5,
      sellPrice: 79.5,
      strategy: 'TOP_1',
    });

    expect(result).toBe(true);
    expect(publisherSvc.lastPublishedSignature()).toBeNull();
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
    it('una publicación REAL se journaliza como BINANCE_MERCHANT con su ref real', async () => {
      // La rama honesta: hay confirmación explícita del merchant y una
      // referencia que no es un recibo fabricado. Acá `BINANCE_MERCHANT` es
      // verdad, y el `externalRef` es el identificador con el que se puede ir a
      // buscar la publicación.
      const ids = await seedDecisions(['BUY', 'SELL']);
      publisherSvc.enablePublishing({ dryRun: false });
      mockMcp.testTool.mockResolvedValue(mcpMerchantConfirm);

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
      expect(
        harness.outcomeInputs.every((input) => input.externalRef === 'BINANCE-MERCHANT-REF-8842'),
      ).toBe(true);

      // Y se relee del puerto, no del doble: lo que quedó realmente almacenado.
      const stored = await harness.repo.listOutcomesByDecision(ids.BUY);
      expect(stored).toHaveLength(1);
      expect(stored[0].success).toBe(true);
      expect(stored[0].source).toBe('BINANCE_MERCHANT');
      expect(stored[0].externalRef).toBe('BINANCE-MERCHANT-REF-8842');
    });

    it('una publicación SIMULADA NO se journaliza como BINANCE_MERCHANT', async () => {
      // El bug. Dry-run por default: el publicador llama a `publish_ad_price`,
      // que es una función pura, y la respuesta trae un `SIG-AD-...` fabricado
      // con `Date.now()`. Con `source` hardcodeado, el journal decía "Binance
      // confirmó esto" sobre una llamada que no salió de la máquina.
      const ids = await seedDecisions(['BUY']);
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockResolvedValue(mcpSimulated);

      await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 0,
        strategy: 'TOP_1',
        decisionIds: { BUY: ids.BUY },
      });

      const stored = await harness.repo.listOutcomesByDecision(ids.BUY);
      expect(stored).toHaveLength(1);
      // `LOCAL_SIGNAL`: el resultado lo produjo esta máquina, no el exchange.
      // Es un valor que YA existe en el union de `OutcomeSource`, así que este
      // fix no agregan nada al contrato de la tabla.
      expect(stored[0].source).toBe('LOCAL_SIGNAL');
      expect(stored[0].source).not.toBe('BINANCE_MERCHANT');
    });

    it('en build web NO journaliza como BINANCE_MERCHANT aunque dryRun esté apagado', async () => {
      // El segundo disparador del bug: `dryRun: false` NO implica escritura
      // real. En web `McpService.testTool` responde `simulateMcpTool`, y su
      // resultado viene marcado con `simulated: true` aunque el status diga
      // `PUBLISHED_LIVE`. La evidencia de la respuesta tiene que ganarle al
      // flag que mandó el operador.
      const ids = await seedDecisions(['BUY']);
      mockMcp.hasNativeTransport.mockReturnValue(false);
      publisherSvc.enablePublishing({ dryRun: false });
      mockMcp.testTool.mockResolvedValue({
        success: true,
        result: {
          success: true,
          simulated: true,
          status: 'PUBLISHED_LIVE',
          dryRun: false,
          auditTrail: { signature: 'SIG-AD-ADV-01-1700000000000' },
        },
      });

      await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 0,
        strategy: 'TOP_1',
        decisionIds: { BUY: ids.BUY },
      });

      const stored = await harness.repo.listOutcomesByDecision(ids.BUY);
      expect(stored[0].source).toBe('LOCAL_SIGNAL');
    });

    it('una firma sintética NUNCA se persiste como externalRef', async () => {
      // Defensa en profundidad. Aunque la respuesta afirme `merchantConfirmed`,
      // un `SIG-AD-<adId>-<epoch>` es el formato del recibo que fabrica el
      // simulador: no identifica nada en Binance. Si se guardara, el journal
      // tendría un "referencia de exchange" que al auditarla no lleva a
      // ninguna parte.
      const ids = await seedDecisions(['BUY']);
      publisherSvc.enablePublishing({ dryRun: false });
      mockMcp.testTool.mockResolvedValue({
        success: true,
        result: {
          success: true,
          merchantConfirmed: true,
          status: 'PUBLISHED_LIVE',
          dryRun: false,
          auditTrail: { signature: 'SIG-AD-ADV-01-1700000000000' },
        },
      });

      await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 0,
        strategy: 'TOP_1',
        decisionIds: { BUY: ids.BUY },
      });

      const stored = await harness.repo.listOutcomesByDecision(ids.BUY);
      expect(stored[0].externalRef).toBeNull();
      // Sin una referencia real no hay nada verificable detrás de la afirmación
      // "Binance confirmó", así que el origen tampoco puede ser el merchant.
      expect(stored[0].source).toBe('LOCAL_SIGNAL');
    });

    it('el intento simulado conserva su recibo en el detail, sin vestirse de ref', async () => {
      // No se pierde evidencia: el `SIG-AD-...` se conserva como texto auditable
      // — donde un humano lo lee y entiende que es un recibo local — y no como
      // `externalRef`, que es el campo que un sistema leería como referencia
      // del exchange.
      const ids = await seedDecisions(['BUY']);
      publisherSvc.enablePublishing();
      mockMcp.testTool.mockResolvedValue(mcpSimulated);

      await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 0,
        strategy: 'TOP_1',
        decisionIds: { BUY: ids.BUY },
      });

      const stored = await harness.repo.listOutcomesByDecision(ids.BUY);
      expect(String(stored[0].detail)).toContain('SIG-AD-ADV-01-1700000000000');
      expect(String(stored[0].detail)).toMatch(/simulad|simulaci/i);
    });

    it('etiqueta el origen con un valor que el contrato de la tabla acepta', async () => {
      // `MCP_AGENT` NO es un `OutcomeSource`: es un `DecisionOrigin`. El enum de
      // outcomes es LOCAL_SIGNAL | BINANCE_MERCHANT | CSV_IMPORT | MANUAL, y el
      // CHECK de `schema.sql` no acepta nada más, así que un valor nuevo exige
      // tocar core, el schema y el adapter de SQLite a la vez.
      //
      // El outcome registra el CANAL del resultado, y el canal solo es
      // `BINANCE_MERCHANT` si el merchant confirmó. Este test usa una
      // confirmación real, así que el valor temido igual queda por fuera del
      // contrato — no porque el tipo lo fuerce, sino porque la verdad manda.
      const ids = await seedDecisions(['BUY']);
      publisherSvc.enablePublishing({ dryRun: false });
      mockMcp.testTool.mockResolvedValue(mcpMerchantConfirm);

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
      publisherSvc.enablePublishing({ dryRun: false });
      mockMcp.testTool.mockResolvedValue(mcpMerchantConfirm);

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
      publisherSvc.enablePublishing({ dryRun: false });
      mockMcp.testTool.mockResolvedValue(mcpMerchantConfirm);

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
      publisherSvc.enablePublishing({ dryRun: false });
      mockMcp.testTool.mockResolvedValue(mcpMerchantConfirm);
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
      expect(publisherSvc.lastPublishedSignature()).toBe('BINANCE-MERCHANT-REF-8842');
      // Pero tampoco se pierde en silencio.
      expect(consoleError).toHaveBeenCalled();
      expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/outcome/i);
      expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/SQLITE_BUSY/);
      // Un solo intento por outcome: el fallo no genera un segundo intento.
      expect(harness.outcomeInputs).toHaveLength(0);
    });

    it('sin correlación no inventa outcomes: sin decisión no hay a qué colgarse', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      publisherSvc.enablePublishing({ dryRun: false });
      mockMcp.testTool.mockResolvedValue(mcpMerchantConfirm);

      const result = await publisherSvc.publish({
        buyPrice: 960,
        sellPrice: 985,
        strategy: 'TOP_1',
      });

      // Publicar igual, no journalizar nada. `decision_outcomes.decision_id` es
      // una FK dura: un id inventado pasaría el tipo y no agruparía nada.
      expect(result).toBe(true);
      expect(harness.outcomeInputs).toHaveLength(0);
      // Y NO en silencio: una publicación real sin nada que la registre tiene
      // que dejar rastro, o el criterio "nada se pierde en silencio" se incumple
      // justo en el caso más caro.
      expect(consoleError).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Bug 2: publicación real sin trazabilidad, en silencio absoluto.
    //
    // La cadena: `binance-repricer.service.ts` devuelve `{BUY: id}` aunque
    // `appendDecision('SELL')` falle, así que el SELL sale con
    // `decisionId === undefined`. En `recordPublishAttempt` el guardián
    // `if (attempt.decisionId === undefined) return;` cortaba ANTES de la rama
    // que avisa: cero warn, cero toast, cero outcome, para un anuncio que sí se
    // intentó publicar.
    //
    // Restricción de diseño que NO se rompe: un fallo del journal no puede
    // tumbar la publicación. Por eso la respuesta no es abortar, es hablar.
    // -------------------------------------------------------------------------
    describe('publicación sin decisión correlacionada', () => {
      it('publica igual y ADVIERTE: nada se pierde en silencio', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        publisherSvc.enablePublishing({ dryRun: false });
        mockMcp.testTool.mockResolvedValue(mcpMerchantConfirm);

        // Sin `decisionIds`: es exactamente lo que pasa cuando el motor no
        // logró journalizar la decisión.
        const result = await publisherSvc.publish({
          buyPrice: 960,
          sellPrice: 985,
          strategy: 'TOP_1',
        });

        // La publicación NO se frena. El aviso no es un fallo del publish.
        expect(result).toBe(true);
        expect(mockMcp.testTool).toHaveBeenCalledTimes(2);
        expect(publisherSvc.successfulPublishesCount()).toBe(1);
        expect(harness.outcomeInputs).toHaveLength(0);

        // Pero el intento sin auditar queda anunciado, una vez por lado.
        expect(consoleError).toHaveBeenCalledTimes(2);
      });

      it('el aviso dice qué lado se publicó y que no quedó registrado', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        publisherSvc.enablePublishing({ dryRun: false });
        mockMcp.testTool.mockResolvedValue(mcpMerchantConfirm);

        await publisherSvc.publish({
          buyPrice: 960,
          sellPrice: 0,
          strategy: 'TOP_1',
        });

        const messages = consoleError.mock.calls.map((call) => String(call[0]));
        // Un log que no dice qué anuncio ni de qué lado es inservible: el
        // operador recibe uno de estos cada 20 s y tiene que poder actuar.
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatch(/BUY/);
        expect(messages[0]).toContain('BINANCE-BUY-ADV-01');
        expect(messages[0]).toMatch(/sin (correlaci|registr)/i);
      });

      it('el aviso no confunde "sin journal" con un fallo del journal', async () => {
        // Son dos condiciones distintas y una sola palabra las separa para
        // quien triaje: acá el journal está sano, lo que falta es la decisión
        // padre. Que el texto lo diga evita que se investigue la base de datos
        // cuando el problema es la escritura de la decisión.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        publisherSvc.enablePublishing({ dryRun: false });
        mockMcp.testTool.mockResolvedValue(mcpMerchantConfirm);

        await publisherSvc.publish({
          buyPrice: 960,
          sellPrice: 0,
          strategy: 'TOP_1',
        });

        const message = String(consoleError.mock.calls[0]?.[0]);
        expect(message).toMatch(/appendDecision|decisi/i);
      });
    });

    it('un outcome de intento hace la decisión verificable SIN que exista trade', async () => {
      // Este test fija, en forma ejecutable, el significado de la métrica que
      // este cambio de semántica introduce: `verifiedDecisions` va a contar
      // "tiene al menos un intento registrado", NO "tiene un trade realizado".
      const ids = await seedDecisions(['BUY']);
      publisherSvc.enablePublishing({ dryRun: false });
      mockMcp.testTool.mockResolvedValue(mcpMerchantConfirm);

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
