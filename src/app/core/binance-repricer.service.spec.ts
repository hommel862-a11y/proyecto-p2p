import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BinanceRepricerService,
  REPRICER_EXECUTION_MODES,
  registerRepricerPublisher,
  unregisterRepricerPublisher,
  type RepricerAdPublisher,
  type RepricerPublishRequest,
} from './binance-repricer.service';
import { ToastService } from './toast.service';
import { BinanceP2pService, type BinanceDepthFetch } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import { DecisionJournalService } from './decision-journal.service';
import {
  calculateOrderBookImbalance,
  InMemoryDecisionJournalRepository,
  type BinanceP2pMarketDepth,
  type DecisionCyclesFilter,
  type DecisionPerformanceFilter,
  type OpenDecisionCycleInput,
  type RecordDecisionInput,
  type RecordMarketSnapshotInput,
  type RepricerDecision,
} from '@p2p/core';

/**
 * Two-sided depth with a wide enough spread to clear the default 10 VES floor,
 * so a cycle actually produces an `UPDATE` decision (the log path under test).
 */
const DEPTH: BinanceP2pMarketDepth = {
  asset: 'USDT',
  fiat: 'VES',
  bestBuyPrice: 960,
  bestSellPrice: 985,
  spreadVes: 25,
  spreadPct: 2.6,
  sellOffers: [
    {
      advNo: 'a1',
      price: 985,
      merchantName: 'VendedorUno',
      finishRatePct: 99,
      orderCount: 300,
      minVes: 100,
      maxVes: 20000,
      payMethods: ['Banesco'],
    },
  ],
  buyOffers: [
    {
      advNo: 'b1',
      price: 960,
      merchantName: 'CompradorUno',
      finishRatePct: 99,
      orderCount: 300,
      minVes: 100,
      maxVes: 20000,
      payMethods: ['Banesco'],
    },
  ],
  // Deliberadamente viejo. `updatedAt` es la hora en que se PARSEÓ la respuesta,
  // no la del exchange: leerlo para medir frescura da ~2 ms siempre. Este fixture
  // no lo usa el motor, y por eso no puede hacer verde un test imposible.
  updatedAt: '2026-09-27T12:00:00.000Z',
};

/** El libro llegó de Binance en esta misma llamada. */
function liveFetch(depth: BinanceP2pMarketDepth = DEPTH): BinanceDepthFetch {
  return { depth, source: 'LIVE', fetchedAt: Date.now() };
}

/**
 * El MISMO libro, servido desde la caché durante una caída de Binance.
 *
 * `fetchedAt` se acaba de fijar a propósito: la frescura no depende de la edad,
 * depende de no haber podido observar el libro otra vez. Un libro de 0 ms
 * servido de la caché NO es un libro fresco.
 */
function cachedFetch(
  depth: BinanceP2pMarketDepth = DEPTH,
  fetchedAt: number = Date.now(),
): BinanceDepthFetch {
  return { depth, source: 'CACHE', fetchedAt };
}

// ---------------------------------------------------------------------------
// Journal harness
//
// NO hay doble del journal. El seam real (`DecisionJournalService`) queda montado
// sobre el adapter de referencia (`InMemoryDecisionJournalRepository`), que es el
// que hace cumplir el contrato: integridad referencial, ids asignados por el
// repositorio y `observed*` copiados del snapshot.
//
// La razón de fondo: un doble que acepta cualquier `cycleId` no prueba nada. El
// bug que motivó este archivo —mandar `PENDING_CYCLE_TRACKING` como si fuera un
// ciclo— pasó la suite verde justamente porque el doble no tenía integridad
// referencial. Un test tiene que poder FALLAR por la misma razón que falla
// producción; eso exige el puerto real, no una imitación suya.
// ---------------------------------------------------------------------------

type JournalOpName =
  | 'appendMarketSnapshot'
  | 'openCycle'
  | 'closeCycle'
  | 'getCycle'
  | 'listCycles'
  | 'appendDecision'
  | 'getDecision'
  | 'listDecisionsByCycle'
  | 'appendOutcome'
  | 'listOutcomesByDecision'
  | 'getDecisionPerformance'
  | 'getVerificationSummary'
  | 'purgeMarketSnapshotsBefore';

interface JournalCall {
  readonly op: JournalOpName;
  readonly payload: unknown;
}

interface JournalHarness {
  /** El seam real del renderer. Se lee por acá, igual que en producción. */
  readonly journal: DecisionJournalService;
  /** El adapter de referencia, para sembrar estado previo (un ciclo ya abierto). */
  readonly repo: InMemoryDecisionJournalRepository;
  /**
   * ESPÍA de transporte, no doble del puerto: registra qué se pidió y en qué
   * orden. La semántica de cada operación es la del adapter real.
   */
  readonly calls: JournalCall[];
  /** Los inputs tal como los envió el motor, para afirmar sobre lo que se pidió. */
  readonly snapshotInputs: RecordMarketSnapshotInput[];
  readonly decisionInputs: RecordDecisionInput[];
  /** Ops forzadas a fallar, para ejercitar la política de robustez. */
  readonly failOn: Map<JournalOpName, Error>;
  readonly ops: () => JournalOpName[];
  /**
   * Deja pasar el tráfico y CONGELA las ops indicadas hasta `release()`.
   *
   * Sin este control, "dos ciclos concurrentes" es una carrera que el
   * planificador puede ganar o perder: el test pasaría en verde por suerte y el
   * bug seguiría vivo. Acá las dos llamadas quedan efectivamente solapadas
   * dentro del journal, que es donde la invariante tiene que valer.
   */
  holdUntilReleased(...ops: JournalOpName[]): void;
  /** Suelta lo retenido por `holdUntilReleased`. */
  release(): void;
}

type JournalInvoke = (op: JournalOpName, payload?: unknown) => Promise<unknown>;

/** Monta el bridge que el preload expone en `globalThis.p2p.decisionJournal`. */
function installJournalBridge(invoke: JournalInvoke): void {
  const host = globalThis as { p2p?: Record<string, unknown> };
  host.p2p = { ...(host.p2p ?? {}), decisionJournal: { invoke } };
}

function createJournalHarness(): JournalHarness {
  const repo = new InMemoryDecisionJournalRepository();
  const calls: JournalCall[] = [];
  const snapshotInputs: RecordMarketSnapshotInput[] = [];
  const decisionInputs: RecordDecisionInput[] = [];
  const failOn = new Map<JournalOpName, Error>();
  let gate: { ops: ReadonlySet<JournalOpName>; wait: Promise<void>; open: () => void } | null = null;

  // El switch replica el de `electron/main/ipc/handlers.ts`, incluido el payload
  // envuelto de `closeCycle`. Si las formas divergieran, el test probaría un
  // transporte que no existe.
  const invoke: JournalInvoke = async (op, payload) => {
    calls.push({ op, payload });
    const failure = failOn.get(op);
    if (failure) throw failure;

    // Se retiene ANTES de tocar el repositorio: si se retuviera después, la
    // segunda llamada ya habría leído el estado que la primera cambió y la
    // carrera ni existiría.
    if (gate && gate.ops.has(op)) await gate.wait;

    switch (op) {
      case 'appendMarketSnapshot': {
        const input = payload as RecordMarketSnapshotInput;
        snapshotInputs.push(input);
        return repo.appendMarketSnapshot(input);
      }
      case 'appendDecision': {
        const input = payload as RecordDecisionInput;
        decisionInputs.push(input);
        return repo.appendDecision(input);
      }
      case 'openCycle':
        return repo.openCycle(payload as OpenDecisionCycleInput);
      case 'listCycles':
        return repo.listCycles(payload as DecisionCyclesFilter | undefined);
      case 'getCycle':
        return repo.getCycle(payload as string);
      case 'getDecision':
        return repo.getDecision(payload as number);
      case 'listDecisionsByCycle':
        return repo.listDecisionsByCycle(payload as string);
      case 'getDecisionPerformance':
        return repo.getDecisionPerformance(payload as DecisionPerformanceFilter | undefined);
      case 'getVerificationSummary':
        return repo.getVerificationSummary(payload as DecisionPerformanceFilter | undefined);
      case 'purgeMarketSnapshotsBefore':
        throw new Error(`decision_journal: unsupported IPC op "${op}"`);
      default:
        throw new Error(`decision_journal: unsupported IPC op "${op}"`);
    }
  };

  // El bridge tiene que existir ANTES de construir el servicio: lo resuelve en el
  // inicializador de campo y lanza si no lo encuentra.
  installJournalBridge(invoke);
  const journal = new DecisionJournalService();

  return {
    journal,
    repo,
    calls,
    snapshotInputs,
    decisionInputs,
    failOn,
    ops: () => calls.map((call) => call.op),
    holdUntilReleased(...ops: JournalOpName[]): void {
      let open!: () => void;
      const wait = new Promise<void>((resolve) => {
        open = resolve;
      });
      gate = { ops: new Set(ops), wait, open };
    },
    release(): void {
      const pending = gate;
      gate = null;
      pending?.open();
    },
  };
}

describe('BinanceRepricerService', () => {
  let svc: BinanceRepricerService;
  let harness: JournalHarness;
  let journal: DecisionJournalService;
  const toast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
  const fetchDepth = vi.fn(async (): Promise<BinanceDepthFetch | null> => liveFetch());

  /** Re-inyecta el motor con el journal actual; `usages` viene del injector. */
  function buildService(usages: () => { isOverLimit: boolean }[] = () => []): void {
    svc = Injector.create({
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: BinanceP2pService, useValue: { fetchMarketDepthWithSource: fetchDepth } },
        { provide: AccountsService, useValue: { usages } },
        { provide: DecisionJournalService, useValue: journal },
        BinanceRepricerService,
      ],
    }).get(BinanceRepricerService);
  }

  /** Journal nuevo (repositorio en blanco, servicio nuevo, sin ciclo cacheado). */
  function rebuildJournal(): void {
    harness = createJournalHarness();
    journal = harness.journal;
    buildService();
  }

  beforeEach(() => {
    toast.success.mockReset();
    toast.info.mockReset();
    toast.error.mockReset();
    toast.warn.mockReset();
    fetchDepth.mockReset();
    fetchDepth.mockResolvedValue(liveFetch());
    unregisterRepricerPublisher();
    rebuildJournal();
  });

  afterEach(() => {
    svc.stop();
    unregisterRepricerPublisher();
    delete (globalThis as { p2p?: unknown }).p2p;
    vi.restoreAllMocks();
  });

  describe('modo de ejecución honesto', () => {
    it('arranca en SOLO LECTURA porque no hay publicador registrado', () => {
      expect(svc.executionMode()).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
    });

    it('no puede reportarse en vivo mientras no exista un publicador real', () => {
      // La garantía central del workstream: sin publicador, ninguna etiqueta
      // derivada puede afirmar publicación.
      expect(svc.executionMode()).not.toBe(REPRICER_EXECUTION_MODES.PUBLISHING);
      expect(svc.isPublishing()).toBe(false);
      expect(svc.executionModeLabel()).toBe('SOLO LECTURA — NO PUBLICA');
      expect(svc.executionModeLabel()).not.toMatch(/en vivo/i);
      expect(svc.logPrefix()).toBe('[SOLO LECTURA] ');
      expect(svc.logPrefix()).not.toMatch(/en vivo/i);
    });

    it('el servicio no expone ninguna forma de declarar el modo a mano', () => {
      const api = svc as unknown as Record<string, unknown>;
      expect(api['setDryRun']).toBeUndefined();
      expect(api['isDryRun']).toBeUndefined();
      // El registro solo expone el puerto de escritura, no un booleano.
      expect(Object.keys(api)).not.toContain('isLive');
      expect(Object.keys(api)).not.toContain('setLive');
    });

    it('el detalle explica que calcula y registra precios pero no publica', () => {
      expect(svc.executionModeDetail()).toMatch(/no publica anuncios/i);
      expect(svc.executionModeDetail()).toMatch(/merchant de Binance/i);
    });

    it('reporta el modo real en el toast de activación, sin prometer "en vivo"', () => {
      svc.toggle();

      const message = String(toast.success.mock.calls[0][0]);
      expect(message).toContain('SOLO LECTURA — NO PUBLICA');
      expect(message).toMatch(/no publica anuncios/i);
      expect(message).not.toMatch(/en vivo/i);
      svc.stop();
    });

    it('el log de un ciclo UPDATE no afirma publicación ni "en vivo"', async () => {
      const decision = await svc.executeCycle();

      expect(decision?.action).toBe('UPDATE');
      const entry = svc.logs()[0];
      expect(entry.executionMode).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
      expect(entry.message.startsWith('[SOLO LECTURA] ')).toBe(true);
      expect(entry.message).toMatch(/Precios optimizados/);
      expect(entry.message).not.toMatch(/publica/i);
      expect(entry.message).not.toMatch(/en vivo/i);
    });

    it('cambia a PUBLICANDO solo al registrar un publicador, sin tocar las etiquetas', async () => {
      const publish = vi.fn(async (): Promise<boolean> => true);
      const publisher: RepricerAdPublisher = { publish };
      registerRepricerPublisher(publisher);

      expect(svc.executionMode()).toBe(REPRICER_EXECUTION_MODES.PUBLISHING);
      expect(svc.isPublishing()).toBe(true);
      expect(svc.executionModeLabel()).toBe('PUBLICANDO EN BINANCE');
      expect(svc.logPrefix()).toBe('[PUBLICANDO] ');

      const decision = await svc.executeCycle();

      // El modo solo puede mentir si el ciclo NO delega al publicador: por eso
      // el sello de "publicando" va atado a la llamada real.
      expect(decision?.action).toBe('UPDATE');
      expect(publish).toHaveBeenCalledTimes(1);
      const open = await journal.listCycles({ status: 'OPEN' });
      const rows = await journal.listDecisionsByCycle(open[0].id);
      expect(publish).toHaveBeenCalledWith({
        buyPrice: decision?.suggestedBuyPrice,
        sellPrice: decision?.suggestedSellPrice,
        strategy: 'TOP_1',
        // La correlación es lo que permite colgarle un outcome a cada lado.
        decisionIds: { BUY: rows[0].id, SELL: rows[1].id },
      });
      expect(svc.logs()[0].message).toContain('Precios publicados en Binance');
    });

    it('deja constancia cuando el publicador rechaza la escritura', async () => {
      registerRepricerPublisher({ publish: vi.fn(async () => false) });

      await svc.executeCycle();

      expect(svc.logs()[0].message).toContain('Publicación rechazada por el publicador');
    });

    it('vuelve a SOLO LECTURA al quitar el publicador', async () => {
      registerRepricerPublisher({ publish: vi.fn(async () => true) });
      expect(svc.executionMode()).toBe(REPRICER_EXECUTION_MODES.PUBLISHING);

      unregisterRepricerPublisher();

      expect(svc.executionMode()).toBe(REPRICER_EXECUTION_MODES.READ_ONLY);
      expect(svc.executionModeLabel()).toBe('SOLO LECTURA — NO PUBLICA');
    });
  });

  describe('funcionalidad existente preservada', () => {
    it('start/stop mueve isActive y el kill-switch corta el ciclo', async () => {
      svc.start();
      expect(svc.isActive()).toBe(true);

      svc.stop();
      expect(svc.isActive()).toBe(false);

      svc.start();
      svc.killSwitch();
      expect(svc.isActive()).toBe(false);
      expect(toast.error).toHaveBeenCalled();
      expect(svc.logs()[0].message).toMatch(/KILL-SWITCH/);
    });

    it('PAUSE por límite bancario diario detiene el bot y registra la razón', async () => {
      // Re-inyecta un service con el cupo excedido: `usages` es del injector.
      buildService(() => [{ isOverLimit: true }]);
      const limited = svc;
      limited.start();

      const decision = await limited.executeCycle();

      expect(decision?.action).toBe('PAUSE');
      expect(limited.isActive()).toBe(false);
      expect(limited.logs()[0].action).toBe('PAUSE');
      expect(limited.logs()[0].message).toMatch(/L[ií]mites bancarios/i);
      limited.stop();
    });

    it('no inventa decisiones cuando el libro de mercado no responde', async () => {
      fetchDepth.mockResolvedValue(null);

      expect(await svc.executeCycle()).toBeNull();
      expect(svc.logs()).toHaveLength(0);
    });

    it('setStrategy recalcula el ciclo con la estrategia elegida', async () => {
      svc.start();
      svc.setStrategy('UNDERCUT');
      await Promise.resolve();

      expect(svc.strategy()).toBe('UNDERCUT');
      const decision: RepricerDecision | null = svc.lastDecision();
      expect(decision).not.toBeNull();
      svc.stop();
    });
  });

  describe('ciclo contable real (F2b)', () => {
    it('el journal rechaza una decisión cuyo ciclo no existe, y por eso hay que resolver uno', async () => {
      // Documenta la razón del diseño. Con un doble permisivo esto pasaba
      // inadvertido: acá la fila NO se escribe y el error dice por qué.
      const snapshot = await journal.appendMarketSnapshot({
        obi: 0,
        bidUsd: 960,
        askUsd: 985,
        nBids: 1,
        nAsks: 1,
        stale: false,
      });

      await expect(
        journal.appendDecision({
          cycleId: 'PENDING_CYCLE_TRACKING',
          snapshotId: snapshot.id,
          side: 'BUY',
          decisionPrice: 1,
          origin: 'AUTO_ENGINE',
          executionMode: 'READ_ONLY',
          action: 'UPDATE',
          modeledSpreadPct: 2.6,
          reason: 'prueba',
        }),
      ).rejects.toThrow(/unknown cycle/);

      expect((await journal.getVerificationSummary()).totalDecisions).toBe(0);
    });

    it('abre un ciclo real y le atribuye la decisión', async () => {
      await svc.executeCycle();

      const open = await journal.listCycles({ status: 'OPEN' });
      expect(open).toHaveLength(1);
      expect(open[0].id).not.toBe('PENDING_CYCLE_TRACKING');
      expect(open[0].status).toBe('OPEN');
      // El ciclo lo abre el motor, no un humano: el origen tiene que decirlo.
      expect(open[0].origin).toBe('AUTO_ENGINE');
      expect(open[0].title).toContain(svc.strategy());
      // El motor no modela capital: 0 es "nada reservado", no una estimación.
      expect(open[0].capitalReservedUsdt).toBe(0);
      // NO lo cierra: las cifras realizadas no existen todavía.
      expect(open[0].closedAt).toBeNull();
      expect(open[0].realizedProfitUsdt).toBeNull();
      expect(open[0].realizedSpreadPct).toBeNull();
    });

    it('resuelve el ciclo antes de escribir, y el snapshot antes que la decisión', async () => {
      await svc.executeCycle();

      // El orden importa: primero existe el ciclo al que colgar la decisión,
      // después la evidencia, y recién entonces la decisión que la cita.
      expect(harness.ops()).toEqual([
        'listCycles',
        'openCycle',
        'appendMarketSnapshot',
        'appendDecision',
        'appendDecision',
      ]);
    });

    it('reutiliza un ciclo que ya está abierto en vez de abrir otro', async () => {
      const preexisting = await harness.repo.openCycle({
        origin: 'OPERATOR',
        capitalReservedUsdt: 500,
        title: 'Sesion del operador',
      });

      await svc.executeCycle();

      // El operador piensa en ciclos: una decisión tiene que caer en el suyo,
      // no en un contenedor nuevo que se abre por decisión del motor.
      const open = await journal.listCycles({ status: 'OPEN' });
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe(preexisting.id);
      expect(harness.ops()).not.toContain('openCycle');
      expect(await journal.listDecisionsByCycle(preexisting.id)).toHaveLength(2);
    });

    it('cachea el ciclo resuelto: la segunda decisión no vuelve a preguntar', async () => {
      await svc.executeCycle();
      harness.calls.length = 0;

      // Los anuncios vuelven a estar fuera de posición, así que el motor decide
      // otra vez en vez de dar KEEP.
      svc.currentBuyAdPrice.set(0);
      svc.currentSellAdPrice.set(0);
      fetchDepth.mockResolvedValue(liveFetch());
      const second = await svc.executeCycle();

      expect(second?.action).toBe('UPDATE');
      // Un lookup por ciclo, no uno por decisión: a 20 s de intervalo, volver a
      // preguntar en cada decisión es tránsito inútil sobre el mismo canal.
      expect(harness.ops()).toEqual([
        'appendMarketSnapshot',
        'appendDecision',
        'appendDecision',
      ]);
      expect((await journal.listCycles({ status: 'OPEN' })).length).toBe(1);
    });

    it('deja la decisión recuperable desde el journal: el round-trip cierra', async () => {
      const decision = await svc.executeCycle();

      const open = await journal.listCycles({ status: 'OPEN' });
      expect(open).toHaveLength(1);

      // Se relee POR ID, como lo haría la capa de outcomes: no se mira un doble
      // que devolvió lo que se le pasó, sino lo que quedó realmente almacenado.
      const rows = await journal.listDecisionsByCycle(open[0].id);
      expect(rows.map((row) => row.side)).toEqual(['BUY', 'SELL']);
      expect(rows[0].cycleId).toBe(open[0].id);
      expect(rows[0].decisionPrice).toBe(decision?.suggestedBuyPrice);
      expect(rows[1].decisionPrice).toBe(decision?.suggestedSellPrice);
      // La evidencia se copió del snapshot: la decisión no la contradice.
      expect(rows[0].observedObi).toBe(
        calculateOrderBookImbalance(DEPTH.buyOffers, DEPTH.sellOffers).obiRatio,
      );
      expect(rows[0].observedBidUsd).toBe(DEPTH.bestBuyPrice);
      expect(rows[0].observedAskUsd).toBe(DEPTH.bestSellPrice);

      // El conteo del read model cuadra, y `openCycles: 1` es VERDAD: existe un
      // ciclo abierto de verdad al que pertenecen esas decisiones.
      const summary = await journal.getVerificationSummary();
      expect(summary.totalDecisions).toBe(2);
      expect(summary.openCycles).toBe(1);
      expect(summary.decisionsAwaitingOutcome).toBe(2);
      expect((await journal.getDecisionPerformance()).length).toBe(2);
    });

    it('agrupa las decisiones de varias corridas bajo el mismo ciclo', async () => {
      await svc.executeCycle();
      svc.currentBuyAdPrice.set(0);
      svc.currentSellAdPrice.set(0);
      fetchDepth.mockResolvedValue(liveFetch());
      await svc.executeCycle();

      const open = await journal.listCycles({ status: 'OPEN' });
      expect(open).toHaveLength(1);
      // Un ciclo agrupa; un ciclo por decisión no agruparía nada.
      expect(await journal.listDecisionsByCycle(open[0].id)).toHaveLength(4);
    });
  });

  describe('journal de decisiones (F2b)', () => {
    it('graba el snapshot ANTES que la decisión y ambas filas lo comparten', async () => {
      await svc.executeCycle();

      // El orden importa: la decisión apunta a evidencia que ya existe.
      const snapshotAt = harness.ops().indexOf('appendMarketSnapshot');
      expect(snapshotAt).toBeGreaterThan(-1);
      expect(harness.ops().lastIndexOf('appendDecision')).toBeGreaterThan(snapshotAt);

      const rows = await journal.getDecisionPerformance();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.decisionId)).size).toBe(2);
      const decisions = await journal.listDecisionsByCycle(rows[0].cycleId);
      expect(new Set(decisions.map((row) => row.snapshotId)).size).toBe(1);
    });

    it('persiste un snapshot normalizado, no el JSON crudo de adv/search', async () => {
      await svc.executeCycle();

      // ~40 KB de JSON crudo por fila es inasequible; solo los derivados.
      expect(Object.keys(harness.snapshotInputs[0]).sort()).toEqual(
        ['askUsd', 'bidUsd', 'fetchedAt', 'nAsks', 'nBids', 'obi', 'stale'].sort(),
      );
      const snapshot = harness.snapshotInputs[0];
      expect(snapshot.bidUsd).toBe(DEPTH.bestBuyPrice);
      expect(snapshot.askUsd).toBe(DEPTH.bestSellPrice);
      expect(snapshot.nBids).toBe(DEPTH.buyOffers.length);
      expect(snapshot.nAsks).toBe(DEPTH.sellOffers.length);
    });

    it('propaga el obi que devuelve calculateOrderBookImbalance, sin recalcularlo', async () => {
      await svc.executeCycle();

      const expected = calculateOrderBookImbalance(DEPTH.buyOffers, DEPTH.sellOffers);
      expect(harness.snapshotInputs[0].obi).toBe(expected.obiRatio);
      // Un default 0rationado no serviría: el libro de prueba NO está equilibrado.
      expect(harness.snapshotInputs[0].obi).not.toBe(0);
      // Y queda en la fila leída, no solo en lo que se envió.
      const rows = await journal.getDecisionPerformance();
      expect(rows[0].observedObi).toBe(expected.obiRatio);
    });

    it('no marca como viejo un libro recién consultado a Binance', async () => {
      fetchDepth.mockResolvedValue(liveFetch());

      await svc.executeCycle();

      expect(harness.snapshotInputs[0].stale).toBe(false);
      const rows = await journal.getDecisionPerformance();
      expect(rows.every((row) => row.observedStale === false)).toBe(true);
    });

    it('marca como viejo el libro que salió de la caché, aunque sea recientísimo', async () => {
      // El bug: la frescura se medía restando la hora en que se PARSEÓ la
      // respuesta, que da ~2 ms siempre. Con un libro servido de la caché hace
      // un segundo, esa resta da 1 s y el panel responde "fresco" sobre un libro
      // que el motor no pudo volver a observar. La honestidad no es la edad: es
      // saber si este libro se vio ahora o se re-servió.
      const fetchedAt = Date.now();
      fetchDepth.mockResolvedValue(cachedFetch(DEPTH, fetchedAt));

      await svc.executeCycle();

      expect(harness.snapshotInputs[0].stale).toBe(true);
      // Y la evidencia conserva CUÁNDO se observó el libro por última vez.
      expect(harness.snapshotInputs[0].fetchedAt).toBe(fetchedAt);
      const rows = await journal.getDecisionPerformance();
      expect(rows.every((row) => row.observedStale === true)).toBe(true);
    });

    it('deja que el panel muestre un porcentaje de libro viejo NO nulo', async () => {
      // La tercera pregunta de auditoría tiene que poder responderse con un
      // número. Si el ratio no puede salir de cero, la pregunta no tiene
      // respuesta y el operador lee "siempre fresco" donde la verdad es otra.
      fetchDepth.mockResolvedValue(liveFetch());
      await svc.executeCycle();

      svc.currentBuyAdPrice.set(0);
      svc.currentSellAdPrice.set(0);
      fetchDepth.mockResolvedValue(cachedFetch());
      await svc.executeCycle();

      const summary = await journal.getVerificationSummary();
      expect(summary.totalDecisions).toBe(4);
      expect(summary.staleDecisions).toBe(2);
      expect(summary.staleRate).toBeCloseTo(0.5, 4);

      const audit = await journal.getSelfAudit();
      expect(audit.staleExposure.decisionsOnStaleMarket).toBe(2);
      expect(audit.staleExposure.staleRate).toBeCloseTo(0.5, 4);
    });

    it('trata como viejo un depth sin marca de tiempo confiable', async () => {
      // Ante duda, se declara viejo: un default optimistic esconde datos viejos.
      fetchDepth.mockResolvedValue({ depth: DEPTH, source: 'LIVE', fetchedAt: Number.NaN });

      await svc.executeCycle();

      expect(harness.snapshotInputs[0].stale).toBe(true);
    });

    it('registra una fila por lado con el precio que el motor decidió', async () => {
      const decision = await svc.executeCycle();

      const open = await journal.listCycles({ status: 'OPEN' });
      const rows = await journal.listDecisionsByCycle(open[0].id);
      expect(rows.map((row) => row.side)).toEqual(['BUY', 'SELL']);
      expect(rows[0].decisionPrice).toBe(decision?.suggestedBuyPrice);
      expect(rows[1].decisionPrice).toBe(decision?.suggestedSellPrice);
      expect(rows.every((row) => row.modeledSpreadPct === decision?.spreadPct)).toBe(true);
      expect(rows.every((row) => row.reason === decision?.reason)).toBe(true);
      expect(rows.every((row) => row.action === 'UPDATE')).toBe(true);
    });

    it('atribuye la decisión al motor automático, no a un operador humano', async () => {
      await svc.executeCycle();

      const open = await journal.listCycles({ status: 'OPEN' });
      const rows = await journal.listDecisionsByCycle(open[0].id);
      expect(rows.every((row) => row.origin === 'AUTO_ENGINE')).toBe(true);
    });

    it('no inventa ids de ciclo: el que manda existe de verdad', async () => {
      await svc.executeCycle();

      // La razón de ser de `cycleId` explícito es que se pueda RESOLVER. Un id
      // inventado destruiría exactamente la propiedad por la que existe la tabla.
      for (const input of harness.decisionInputs) {
        expect(await journal.getCycle(input.cycleId)).not.toBeNull();
      }
    });

    it('no manda los observed*: el adapter los copia del snapshot', async () => {
      await svc.executeCycle();

      for (const input of harness.decisionInputs) {
        // Una decisión no puede contradecir su propia evidencia.
        expect(Object.keys(input)).not.toContain('observedObi');
        expect(Object.keys(input)).not.toContain('observedBidUsd');
        expect(Object.keys(input)).not.toContain('observedAskUsd');
        expect(Object.keys(input)).not.toContain('observedStale');
      }
    });

    it('registra el modo real READ_ONLY cuando no hay publicador', async () => {
      await svc.executeCycle();

      const open = await journal.listCycles({ status: 'OPEN' });
      const rows = await journal.listDecisionsByCycle(open[0].id);
      expect(rows.every((row) => row.executionMode === 'READ_ONLY')).toBe(true);
    });

    it('registra el modo real PUBLISHING cuando hay un publicador registrado', async () => {
      const publish = vi.fn(async (): Promise<boolean> => true);
      registerRepricerPublisher({ publish });

      await svc.executeCycle();

      expect(publish).toHaveBeenCalledTimes(1);
      const open = await journal.listCycles({ status: 'OPEN' });
      const rows = await journal.listDecisionsByCycle(open[0].id);
      expect(rows.every((row) => row.executionMode === REPRICER_EXECUTION_MODES.PUBLISHING)).toBe(
        true,
      );
    });

    it('mantiene PUBLISHING aunque el publicador rechace la escritura', async () => {
      registerRepricerPublisher({ publish: vi.fn(async (): Promise<boolean> => false) });

      await svc.executeCycle();

      // El modo es el del motor al decidir; el rechazo es un outcome (F2c), no un
      // modo distinto. Rebajar el modo acá hides la existencia del publicador.
      const open = await journal.listCycles({ status: 'OPEN' });
      const rows = await journal.listDecisionsByCycle(open[0].id);
      expect(rows.every((row) => row.executionMode === 'PUBLISHING')).toBe(true);
      expect(svc.logs()[0].message).toContain('Publicación rechazada por el publicador');
    });

    it('no graba el PAUSE de seguridad como decisión publicable', async () => {
      // Un PAUSE nunca llega a `publishOrLog`: no hay anuncio que escribir. Si se
      // journaliza igual entra al denominador de "decisiones con intento de
      // publicación" y por construcción no puede tener intento, así que el ratio
      // decae sin que exista un solo fallo real. Ver el bloque "denominador de
      // verificación" para la métrica completa.
      svc.minSpreadVes.set(10_000);

      const decision = await svc.executeCycle();

      expect(decision?.action).toBe('PAUSE');
      expect((await journal.getVerificationSummary()).totalDecisions).toBe(0);
      expect(harness.decisionInputs).toHaveLength(0);
      // El rastro de que el motor decidió pausar NO se pierde: queda en el log
      // del motor, con la regla de seguridad que lo disparó.
      expect(svc.logs()[0].action).toBe('PAUSE');
      expect(svc.logs()[0].message).toMatch(/menor al mínimo requerido/i);
    });

    it('un fallo del journal no tumba el repricer: sigue operando y avisa', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const publish = vi.fn(async (): Promise<boolean> => true);
      registerRepricerPublisher({ publish });
      harness.failOn.set('appendMarketSnapshot', new Error('SQLITE_BUSY: database is locked'));

      const decision = await svc.executeCycle();

      // El trading no se frena porque el journal no pueda escribir.
      expect(decision?.action).toBe('UPDATE');
      expect(svc.lastDecision()?.action).toBe('UPDATE');
      expect(publish).toHaveBeenCalledTimes(1);
      expect(svc.logs()[0].message).toMatch(/Precios publicados en Binance/);
      // Pero tampoco se pierde en silencio.
      expect(consoleError).toHaveBeenCalled();
      expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/UPDATE/);
      expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/SQLITE_BUSY/);
      expect(toast.error).toHaveBeenCalled();
    });

    it('no reintenta el journal en loop ni avanza a la decisión sin evidencia', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      harness.failOn.set('appendMarketSnapshot', new Error('disk full'));

      await svc.executeCycle();

      // Un solo intento por ciclo: ni segundo snapshot, ni decisión a medias.
      expect(harness.ops().filter((op) => op === 'appendMarketSnapshot')).toHaveLength(1);
      expect(harness.decisionInputs).toHaveLength(0);
      expect((await journal.getVerificationSummary()).totalDecisions).toBe(0);
    });

    it('un fallo al grabar la decisión tampoco tumba al repricer', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      harness.failOn.set('appendDecision', new Error('FK constraint failed: decision_cycles'));

      const decision = await svc.executeCycle();

      expect(decision?.action).toBe('UPDATE');
      expect(svc.logs()[0].message).toMatch(/Precios optimizados/);
      expect(toast.error).toHaveBeenCalled();
    });

    it('si no puede resolver el ciclo, avisa una vez, loguea siempre y sigue operando', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const publish = vi.fn(async (): Promise<boolean> => true);
      registerRepricerPublisher({ publish });
      harness.failOn.set('listCycles', new Error('SQLITE_BUSY: database is locked'));

      const first = await svc.executeCycle();

      // El motor sigue operando igual: un journal ilegible no frena el trading.
      expect(first?.action).toBe('UPDATE');
      expect(publish).toHaveBeenCalledTimes(1);
      expect(svc.logs()[0].message).toMatch(/Precios publicados en Binance/);
      expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/ciclo/i);
      expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/SQLITE_BUSY/);

      // Sin ciclo no hay decisión auditable: no se escribe ni una fila. Y tampoco
      // se dejó un snapshot huérfano colgando, porque el ciclo se resuelve antes.
      expect((await journal.getVerificationSummary()).totalDecisions).toBe(0);
      expect(harness.ops()).not.toContain('openCycle');
      expect(harness.snapshotInputs).toHaveLength(0);

      // El aviso al operador es UNA vez...
      expect(toast.error).toHaveBeenCalledTimes(1);

      // ...y el segundo intento no lo repite: el rastro sigue en el log, porque si
      // el ciclo nunca se resuelve el operador tiene que poder ver por qué.
      toast.error.mockClear();
      svc.currentBuyAdPrice.set(0);
      svc.currentSellAdPrice.set(0);
      fetchDepth.mockResolvedValue(liveFetch());
      await svc.executeCycle();

      expect(toast.error).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledTimes(2);
    });

    it('si no puede ABRIR el ciclo, aplica la misma política de robustez', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      harness.failOn.set('openCycle', new Error('disk full'));

      const decision = await svc.executeCycle();

      expect(decision?.action).toBe('UPDATE');
      expect(svc.logs()[0].message).toMatch(/Precios optimizados/);
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/disk full/);
      expect((await journal.getVerificationSummary()).totalDecisions).toBe(0);
    });

    it('no registra nada cuando el libro de mercado no responde', async () => {
      fetchDepth.mockResolvedValue(null);

      await svc.executeCycle();

      expect(harness.calls).toHaveLength(0);
      expect(harness.snapshotInputs).toHaveLength(0);
      expect(harness.decisionInputs).toHaveLength(0);
    });

    it('no registra nada en los ciclos donde el motor no decide (KEEP)', async () => {
      fetchDepth.mockResolvedValue(liveFetch());

      await svc.executeCycle();
      const afterDecision = (await journal.getVerificationSummary()).totalDecisions;
      expect(afterDecision).toBe(2);

      const second = await svc.executeCycle();

      // KEEP no es una decisión: journalizarlo infla el conteo de decisiones.
      expect(second?.action).toBe('KEEP');
      expect((await journal.getVerificationSummary()).totalDecisions).toBe(afterDecision);
      expect(harness.snapshotInputs).toHaveLength(1);
    });
  });

  describe('correlación decisión → publicación (F2c)', () => {
    /** Doble que ACEPTA el request, para poder inspeccionar la correlación. */
    function spyPublisher() {
      return vi.fn(async (_request: RepricerPublishRequest): Promise<boolean> => true);
    }

    it('entrega al publicador el decisionId real de cada lado', async () => {
      const publish = spyPublisher();
      registerRepricerPublisher({ publish });

      const decision = await svc.executeCycle();

      const open = await journal.listCycles({ status: 'OPEN' });
      const rows = await journal.listDecisionsByCycle(open[0].id);
      const sent = publish.mock.calls[0][0] as RepricerPublishRequest;
      expect(sent.decisionIds).toBeDefined();

      // No alcanza con que sea "un id": tiene que ser el de ESE lado. Un mapeo
      // invertido colgaría el outcome de compra del trade de venta y el journal
      // sería internamente consistente pero falso.
      const buyDecision = await journal.getDecision(sent.decisionIds?.['BUY'] ?? -1);
      const sellDecision = await journal.getDecision(sent.decisionIds?.['SELL'] ?? -1);
      expect(buyDecision?.side).toBe('BUY');
      expect(sellDecision?.side).toBe('SELL');
      expect(buyDecision?.decisionPrice).toBe(decision?.suggestedBuyPrice);
      expect(sellDecision?.decisionPrice).toBe(decision?.suggestedSellPrice);
      expect(buyDecision?.id).toBe(rows[0].id);
      expect(sellDecision?.id).toBe(rows[1].id);
    });

    it('no manda correlación inventada si la decisión no se pudo journalar', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const publish = spyPublisher();
      registerRepricerPublisher({ publish });
      harness.failOn.set('appendDecision', new Error('FK constraint failed'));

      const decision = await svc.executeCycle();

      // Sin fila de decisión no hay id real que mandar: `decision_outcomes`
      // tiene una FK dura, así que un id inventado no agruparía nada. La
      // publicación sigue adelante igual.
      expect(decision?.action).toBe('UPDATE');
      expect(publish).toHaveBeenCalledTimes(1);
      const sent = publish.mock.calls[0][0] as RepricerPublishRequest;
      expect(sent.decisionIds).toBeUndefined();
      expect(svc.logs()[0].message).toMatch(/Precios publicados en Binance/);
      expect(consoleError).toHaveBeenCalled();
    });

    it('reutiliza los mismos ids en la segunda corrida, con decisiones nuevas', async () => {
      const publish = spyPublisher();
      registerRepricerPublisher({ publish });
      await svc.executeCycle();

      svc.currentBuyAdPrice.set(0);
      svc.currentSellAdPrice.set(0);
      fetchDepth.mockResolvedValue(liveFetch());
      await svc.executeCycle();

      const first = publish.mock.calls[0][0] as RepricerPublishRequest;
      const second = publish.mock.calls[1][0] as RepricerPublishRequest;

      // Cada intento cuelga de SU decisión: outcomes repetidos sobre la misma
      // fila serían fills parciales, y acá no hubo ningún fill.
      expect(first.decisionIds).toBeDefined();
      expect(second.decisionIds).toBeDefined();
      expect(first.decisionIds?.['BUY']).not.toBe(second.decisionIds?.['BUY']);
      expect(first.decisionIds?.['SELL']).not.toBe(second.decisionIds?.['SELL']);
    });
  });

  // -------------------------------------------------------------------------
  // Bug 4: el denominador de la métrica de verificación
  //
  // El denominador son las decisiones que PUEDEN tener intento de publicación.
  // Journalizar una acción que nunca llega al publicador mete en ese
  // denominador filas que por construcción no pueden tener intento: el ratio
  // decae de forma monótona sin que exista un solo fallo real, y
  // `decisionsAwaitingOutcome` cuenta como backlog algo que nadie forgot.
  // -------------------------------------------------------------------------
  describe('denominador de verificación (PAUSE y las no publicables)', () => {
    /** Todas las acciones que el motor puede terminar journalizando. */
    const journaledActions = (): string[] => harness.decisionInputs.map((input) => input.action);

    it('no journaliza el PAUSE por regla de seguridad (spread insuficiente)', async () => {
      svc.minSpreadVes.set(10_000);

      const decision = await svc.executeCycle();

      expect(decision?.action).toBe('PAUSE');
      expect(journaledActions()).toEqual([]);
    });

    it('no journaliza el PAUSE por límites bancarios agotados', async () => {
      buildService(() => [{ isOverLimit: true }]);

      const decision = await svc.executeCycle();

      expect(decision?.action).toBe('PAUSE');
      expect(journaledActions()).toEqual([]);
    });

    it('no journaliza el PAUSE por profundidad de mercado insuficiente', async () => {
      fetchDepth.mockResolvedValue(
        liveFetch({ ...DEPTH, bestSellPrice: 0, sellOffers: [], spreadVes: 0, spreadPct: 0 }),
      );

      const decision = await svc.executeCycle();

      expect(decision?.action).toBe('PAUSE');
      expect(journaledActions()).toEqual([]);
    });

    it('un PAUSE no infla el denominador ni el backlog de outcomes', async () => {
      const publish = vi.fn(async (): Promise<boolean> => true);
      registerRepricerPublisher({ publish });

      await svc.executeCycle();
      // El harness no registra outcomes —no hay publicador de verdad—, así que
      // la invariante no es un valor absoluto: es que el PAUSE no mueva NINGUNA
      // de las tres cifras. Antes/después es lo que aísla el efecto del PAUSE.
      const afterUpdate = await journal.getVerificationSummary();
      expect(afterUpdate.totalDecisions).toBe(2);

      // El mismo motor, ahora con el spread mínimo imposible de alcanzar.
      svc.minSpreadVes.set(10_000);
      const paused = await svc.executeCycle();

      expect(paused?.action).toBe('PAUSE');
      const afterPause = await journal.getVerificationSummary();
      // Ni el denominador se mueve, ni el ratio decae, ni aparece un backlog
      // fantasma: una decisión sin intento posible no es un fallo de verificación.
      expect(afterPause.totalDecisions).toBe(afterUpdate.totalDecisions);
      expect(afterPause.verificationRate).toBe(afterUpdate.verificationRate);
      expect(afterPause.decisionsAwaitingOutcome).toBe(afterUpdate.decisionsAwaitingOutcome);
      // Y el publicador no se llamó: el PAUSE no publica.
      expect(publish).toHaveBeenCalledTimes(1);
    });

    it('deja constancia de la pausa en el log del motor aunque no la journalice', async () => {
      svc.minSpreadVes.set(10_000);

      await svc.executeCycle();

      const entry = svc.logs()[0];
      expect(entry.action).toBe('PAUSE');
      expect(entry.message).toMatch(/Spread proyectado/);
      // Y el motivo queda en la decisión que el operador puede inspeccionar.
      expect(svc.lastDecision()?.safetyFlags).toContain('SPREAD_BELOW_MINIMUM');
      expect(svc.lastDecision()?.reason).toMatch(/menor al mínimo requerido/i);
    });
  });

  // -------------------------------------------------------------------------
  // Bug 5: `resolveJournalCycle` era check-then-act
  //
  // `start()`, `setStrategy()` y el timer de 20 s llaman a `executeCycle()`
  // con `void`: ninguno espera al anterior. Sin una única resolución en vuelo,
  // un toggle seguido de un cambio de estrategia abre DOS ciclos OPEN y parte
  // las decisiones en dos. Todo lo que el journal calcula queda ambiguo.
  // -------------------------------------------------------------------------
  describe('una sola resolución de ciclo en vuelo', () => {
    /** Deja correr los microtasks pendientes para que ambas llamadas se solapen. */
    function flush(): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('abre EXACTAMENTE un ciclo con dos ciclos concurrentes', async () => {
      harness.holdUntilReleased('listCycles', 'openCycle');

      const first = svc.executeCycle();
      const second = svc.executeCycle();
      await flush();
      harness.release();
      await Promise.all([first, second]);

      const open = await journal.listCycles({ status: 'OPEN' });
      expect(open).toHaveLength(1);
      // Y las dos decisiones van al mismo ciclo, partidas por lado pero no por ciclo.
      expect(await journal.listDecisionsByCycle(open[0].id)).toHaveLength(4);
      expect(harness.ops().filter((op) => op === 'openCycle')).toHaveLength(1);
    });

    it('no abre un segundo ciclo cuando el disparador es el toggle + cambio de estrategia', async () => {
      harness.holdUntilReleased('listCycles', 'openCycle');

      const started = svc.start();
      svc.setStrategy('UNDERCUT');
      await flush();
      harness.release();
      await flush();

      const open = await journal.listCycles({ status: 'OPEN' });
      expect(open).toHaveLength(1);
      expect(harness.ops().filter((op) => op === 'openCycle')).toHaveLength(1);
      svc.stop();
      expect(started).toBeUndefined();
    });

    it('mantiene el ciclo resuelto cuando otro ciclo se abre y se cierra', async () => {
      await svc.executeCycle();
      const resolved = await journal.listCycles({ status: 'OPEN' });
      expect(resolved).toHaveLength(1);

      // Otro actor churna ciclos. El id cacheado sigue siendo válido: no hay
      // razón para invalidarlo, y hacerlo abriría un contenedor nuevo por ruido.
      const other = await harness.repo.openCycle({
        origin: 'OPERATOR',
        capitalReservedUsdt: 100,
        title: 'Ciclo del operador',
      });
      await harness.repo.closeCycle(other.id, {
        status: 'ABANDONED',
        closeReason: 'prueba',
        realizedProfitUsdt: 0,
        realizedSpreadPct: 0,
      });

      harness.calls.length = 0;
      svc.currentBuyAdPrice.set(0);
      svc.currentSellAdPrice.set(0);
      await svc.executeCycle();

      const open = await journal.listCycles({ status: 'OPEN' });
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe(resolved[0].id);
      expect(harness.ops()).not.toContain('openCycle');
      expect(await journal.listDecisionsByCycle(resolved[0].id)).toHaveLength(4);
    });

    it('re-resuelve el ciclo después de que una escritura falle contra un ciclo ya cerrado', async () => {
      await svc.executeCycle();
      const resolved = await journal.listCycles({ status: 'OPEN' });

      // El ciclo se cierra por fuera —el operador lo abandona a mano—. Un id
      // cacheado a un ciclo CLOSED hace que la escritura de decisiones falle
      // para siempre si no se suelta: el motor sigue publicando sin auditarse.
      await harness.repo.closeCycle(resolved[0].id, {
        status: 'ABANDONED',
        closeReason: 'abandonado por el operador',
        realizedProfitUsdt: 0,
        realizedSpreadPct: 0,
      });

      // El ciclo siguiente NO se salva: escribe contra el ciclo muerto, falla, y
      // lo reporta. Perder una fila es mejor que dejar de auditar para siempre,
      // pero el fallo no puede ser silencioso.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      svc.currentBuyAdPrice.set(0);
      svc.currentSellAdPrice.set(0);
      const blind = await svc.executeCycle();

      expect(blind?.action).toBe('UPDATE');
      expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/appendDecision\(BUY\)/);

      // Y el ciclo DESPUÉS de ese fallo vuelve a resolver: se abre uno nuevo y
      // las decisiones se auditan de nuevo. Un fallo transitorio no se vuelve
      // permanente.
      svc.currentBuyAdPrice.set(0);
      svc.currentSellAdPrice.set(0);
      await svc.executeCycle();

      const open = await journal.listCycles({ status: 'OPEN' });
      expect(open).toHaveLength(1);
      expect(open[0].id).not.toBe(resolved[0].id);
      expect(await journal.listDecisionsByCycle(open[0].id)).toHaveLength(2);
    });
  });
});
