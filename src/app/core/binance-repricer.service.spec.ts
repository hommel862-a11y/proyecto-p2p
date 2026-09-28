import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BinanceRepricerService,
  DECISION_JOURNAL_PENDING_CYCLE_ID,
  REPRICER_EXECUTION_MODES,
  REPRICER_MARKET_STALE_AFTER_MS,
  registerRepricerPublisher,
  unregisterRepricerPublisher,
  type RepricerAdPublisher,
} from './binance-repricer.service';
import { ToastService } from './toast.service';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import { DecisionJournalService } from './decision-journal.service';
import {
  calculateOrderBookImbalance,
  type BinanceP2pMarketDepth,
  type MarketSnapshot,
  type RecordDecisionInput,
  type RecordMarketSnapshotInput,
  type RepricerDecision,
  type RepricerDecisionRecord,
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
  updatedAt: '2026-09-27T12:00:00.000Z',
};

/** El mismo libro, pero con una marca de tiempo de ahora: datos frescos. */
function freshDepth(overrides: Partial<BinanceP2pMarketDepth> = {}): BinanceP2pMarketDepth {
  return { ...DEPTH, updatedAt: new Date().toISOString(), ...overrides };
}

function snapshotRecord(input: RecordMarketSnapshotInput, id: number): MarketSnapshot {
  const now = Date.now();
  return {
    id,
    obi: input.obi,
    bidUsd: input.bidUsd,
    askUsd: input.askUsd,
    nBids: input.nBids,
    nAsks: input.nAsks,
    stale: input.stale,
    fetchedAt: input.fetchedAt ?? now,
    createdAt: now,
  };
}

/**
 * Doble del seam del journal. No importa `@p2p/core` de más: existe solo para
 * observar QUÉ se le pide al journal y en qué orden, que es exactamente lo que
 * el motor tiene que garantizar.
 */
class FakeDecisionJournal {
  /** Secuencia real de llamadas: prueba el orden snapshot -> decisión. */
  readonly calls: string[] = [];
  readonly snapshots: RecordMarketSnapshotInput[] = [];
  readonly decisions: RecordDecisionInput[] = [];
  snapshotFailure: Error | null = null;
  decisionFailure: Error | null = null;
  private readonly stored: MarketSnapshot[] = [];
  private nextSnapshotId = 1;

  async appendMarketSnapshot(input: RecordMarketSnapshotInput): Promise<MarketSnapshot> {
    this.calls.push('appendMarketSnapshot');
    if (this.snapshotFailure) throw this.snapshotFailure;
    const record = snapshotRecord(input, this.nextSnapshotId++);
    this.snapshots.push(input);
    this.stored.push(record);
    return record;
  }

  async appendDecision(input: RecordDecisionInput): Promise<RepricerDecisionRecord> {
    this.calls.push('appendDecision');
    if (this.decisionFailure) throw this.decisionFailure;
    this.decisions.push(input);
    const observed = this.stored.find((row) => row.id === input.snapshotId);
    return {
      id: this.decisions.length,
      cycleId: input.cycleId,
      snapshotId: input.snapshotId,
      side: input.side,
      decisionPrice: input.decisionPrice,
      origin: input.origin,
      executionMode: input.executionMode,
      action: input.action,
      modeledSpreadPct: input.modeledSpreadPct,
      reason: input.reason,
      safetyFlags: [...(input.safetyFlags ?? [])],
      observedObi: observed?.obi ?? 0,
      observedBidUsd: observed?.bidUsd ?? 0,
      observedAskUsd: observed?.askUsd ?? 0,
      observedStale: observed?.stale ?? false,
      createdAt: Date.now(),
    };
  }
}

describe('BinanceRepricerService', () => {
  let svc: BinanceRepricerService;
  let journal: FakeDecisionJournal;
  const toast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
  const fetchMarketDepth = vi.fn(async (): Promise<BinanceP2pMarketDepth | null> => DEPTH);

  /** Re-inyecta el motor con el journal actual; `usages` viene del injector. */
  function buildService(usages: () => { isOverLimit: boolean }[] = () => []): void {
    svc = Injector.create({
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: BinanceP2pService, useValue: { fetchMarketDepth } },
        { provide: AccountsService, useValue: { usages } },
        { provide: DecisionJournalService, useValue: journal },
        BinanceRepricerService,
      ],
    }).get(BinanceRepricerService);
  }

  beforeEach(() => {
    toast.success.mockReset();
    toast.info.mockReset();
    toast.error.mockReset();
    toast.warn.mockReset();
    fetchMarketDepth.mockReset();
    fetchMarketDepth.mockResolvedValue(DEPTH);
    unregisterRepricerPublisher();
    journal = new FakeDecisionJournal();
    buildService();
  });

  afterEach(() => {
    svc.stop();
    unregisterRepricerPublisher();
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
      expect(publish).toHaveBeenCalledWith({
        buyPrice: decision?.suggestedBuyPrice,
        sellPrice: decision?.suggestedSellPrice,
        strategy: 'TOP_1',
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
      fetchMarketDepth.mockResolvedValue(null);

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

  describe('journal de decisiones (F2b)', () => {
    it('graba el snapshot ANTES que la decisión y ambas filas lo comparten', async () => {
      await svc.executeCycle();

      // El orden importa: la decisión apunta a evidencia que ya existe.
      expect(journal.calls[0]).toBe('appendMarketSnapshot');
      expect(journal.calls.slice(1)).toEqual(['appendDecision', 'appendDecision']);
      expect(journal.snapshots).toHaveLength(1);
      expect(journal.decisions).toHaveLength(2);
      expect(new Set(journal.decisions.map((d) => d.snapshotId)).size).toBe(1);
    });

    it('persiste un snapshot normalizado, no el JSON crudo de adv/search', async () => {
      await svc.executeCycle();

      // ~40 KB de JSON crudo por fila es inasequible; solo los derivados.
      expect(Object.keys(journal.snapshots[0]).sort()).toEqual(
        ['askUsd', 'bidUsd', 'fetchedAt', 'nAsks', 'nBids', 'obi', 'stale'].sort(),
      );
      const snapshot = journal.snapshots[0];
      expect(snapshot.bidUsd).toBe(DEPTH.bestBuyPrice);
      expect(snapshot.askUsd).toBe(DEPTH.bestSellPrice);
      expect(snapshot.nBids).toBe(DEPTH.buyOffers.length);
      expect(snapshot.nAsks).toBe(DEPTH.sellOffers.length);
    });

    it('propaga el obi que devuelve calculateOrderBookImbalance, sin recalcularlo', async () => {
      await svc.executeCycle();

      const expected = calculateOrderBookImbalance(DEPTH.buyOffers, DEPTH.sellOffers);
      expect(journal.snapshots[0].obi).toBe(expected.obiRatio);
      // Un default 0rationado no serviría: el libro de prueba NO está equilibrado.
      expect(journal.snapshots[0].obi).not.toBe(0);
    });

    it('no marca como viejo un libro recién consultado', async () => {
      fetchMarketDepth.mockResolvedValue(freshDepth());

      await svc.executeCycle();

      expect(journal.snapshots[0].stale).toBe(false);
    });

    it('marca como viejo el libro que el motor decidió usar estando viejo', async () => {
      const oldStamp = new Date(Date.now() - REPRICER_MARKET_STALE_AFTER_MS - 5_000).toISOString();
      fetchMarketDepth.mockResolvedValue(freshDepth({ updatedAt: oldStamp }));

      await svc.executeCycle();

      expect(journal.snapshots[0].stale).toBe(true);
      expect(journal.snapshots[0].fetchedAt).toBe(Date.parse(oldStamp));
    });

    it('trata como viejo un libro cuya marca de tiempo no es confiable', async () => {
      // Ante duda, se declara viejo: un default optimistic hides stale data.
      fetchMarketDepth.mockResolvedValue(freshDepth({ updatedAt: 'no-es-una-fecha' }));
      await svc.executeCycle();
      expect(journal.snapshots[0].stale).toBe(true);

      journal = new FakeDecisionJournal();
      buildService();
      fetchMarketDepth.mockResolvedValue(
        freshDepth({ updatedAt: new Date(Date.now() + 60_000).toISOString() }),
      );
      await svc.executeCycle();
      expect(journal.snapshots[0].stale).toBe(true);
    });

    it('registra una fila por lado con el precio que el motor decidió', async () => {
      const decision = await svc.executeCycle();

      expect(journal.decisions.map((d) => d.side)).toEqual(['BUY', 'SELL']);
      expect(journal.decisions[0].decisionPrice).toBe(decision?.suggestedBuyPrice);
      expect(journal.decisions[1].decisionPrice).toBe(decision?.suggestedSellPrice);
      expect(journal.decisions.every((d) => d.modeledSpreadPct === decision?.spreadPct)).toBe(true);
      expect(journal.decisions.every((d) => d.reason === decision?.reason)).toBe(true);
      expect(journal.decisions.every((d) => d.action === 'UPDATE')).toBe(true);
    });

    it('atribuye la decisión al motor automático, no a un operador humano', async () => {
      await svc.executeCycle();

      expect(journal.decisions.every((d) => d.origin === 'AUTO_ENGINE')).toBe(true);
    });

    it('marca el ciclo como pendiente de tracking en vez de inventar un ciclo', async () => {
      await svc.executeCycle();

      expect(journal.decisions.every((d) => d.cycleId === DECISION_JOURNAL_PENDING_CYCLE_ID)).toBe(
        true,
      );
      expect(DECISION_JOURNAL_PENDING_CYCLE_ID).toMatch(/PENDING/);
    });

    it('no manda los observed*: el adapter los copia del snapshot', async () => {
      await svc.executeCycle();

      for (const input of journal.decisions) {
        // Una decisión no puede contradecir su propia evidencia.
        expect(Object.keys(input)).not.toContain('observedObi');
        expect(Object.keys(input)).not.toContain('observedBidUsd');
        expect(Object.keys(input)).not.toContain('observedAskUsd');
        expect(Object.keys(input)).not.toContain('observedStale');
      }
    });

    it('registra el modo real READ_ONLY cuando no hay publicador', async () => {
      await svc.executeCycle();

      expect(journal.decisions.every((d) => d.executionMode === 'READ_ONLY')).toBe(true);
    });

    it('registra el modo real PUBLISHING cuando hay un publicador registrado', async () => {
      const publish = vi.fn(async (): Promise<boolean> => true);
      registerRepricerPublisher({ publish });

      await svc.executeCycle();

      expect(publish).toHaveBeenCalledTimes(1);
      expect(
        journal.decisions.every((d) => d.executionMode === REPRICER_EXECUTION_MODES.PUBLISHING),
      ).toBe(true);
    });

    it('mantiene PUBLISHING aunque el publicador rechace la escritura', async () => {
      registerRepricerPublisher({ publish: vi.fn(async () => false) });

      await svc.executeCycle();

      // El modo es el del motor al decidir; el rechazo es un outcome (F2c), no un
      // modo distinto. Rebajar el modo acá hides la existencia del publicador.
      expect(journal.decisions.every((d) => d.executionMode === 'PUBLISHING')).toBe(true);
      expect(svc.logs()[0].message).toContain('Publicación rechazada por el publicador');
    });

    it('graba el PAUSE de seguridad como decisión auditable', async () => {
      svc.minSpreadVes.set(10_000);

      const decision = await svc.executeCycle();

      expect(decision?.action).toBe('PAUSE');
      expect(journal.decisions).toHaveLength(2);
      expect(journal.decisions.every((d) => d.action === 'PAUSE')).toBe(true);
      expect(journal.decisions[0].safetyFlags).toContain('SPREAD_BELOW_MINIMUM');
    });

    it('un fallo del journal no tumba el repricer: sigue operando y avisa', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const publish = vi.fn(async (): Promise<boolean> => true);
      registerRepricerPublisher({ publish });
      journal.snapshotFailure = new Error('SQLITE_BUSY: database is locked');

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
      journal.snapshotFailure = new Error('disk full');

      await svc.executeCycle();

      expect(journal.calls).toEqual(['appendMarketSnapshot']);
      expect(journal.decisions).toHaveLength(0);
    });

    it('un fallo al grabar la decisión tampoco tumba al repricer', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      journal.decisionFailure = new Error('FK constraint failed: decision_cycles');

      const decision = await svc.executeCycle();

      expect(decision?.action).toBe('UPDATE');
      expect(svc.logs()[0].message).toMatch(/Precios optimizados/);
      expect(toast.error).toHaveBeenCalled();
    });

    it('no registra nada cuando el libro de mercado no responde', async () => {
      fetchMarketDepth.mockResolvedValue(null);

      await svc.executeCycle();

      expect(journal.calls).toHaveLength(0);
      expect(journal.snapshots).toHaveLength(0);
      expect(journal.decisions).toHaveLength(0);
    });

    it('no registra nada en los ciclos donde el motor no decide (KEEP)', async () => {
      const book = freshDepth();
      fetchMarketDepth.mockResolvedValue(book);

      await svc.executeCycle();
      const afterDecision = journal.decisions.length;
      expect(afterDecision).toBe(2);

      const second = await svc.executeCycle();

      // KEEP no es una decisión: journalizarlo infla el conteo de decisiones.
      expect(second?.action).toBe('KEEP');
      expect(journal.decisions).toHaveLength(afterDecision);
      expect(journal.snapshots).toHaveLength(1);
    });
  });
});
