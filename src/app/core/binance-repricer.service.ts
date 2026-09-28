import { Injectable, computed, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import { DecisionJournalService } from './decision-journal.service';
import {
  calculateOrderBookImbalance,
  evaluateRepricer,
  type BinanceP2pMarketDepth,
  type DecisionSide,
  type RecordMarketSnapshotInput,
  type RepricerConfig,
  type RepricerDecision,
  type RepricerStrategy,
} from '@p2p/core';

/**
 * Modos de ejecución REALES del motor de repricing.
 *
 * Solo hay dos verdades posibles, y ninguna depende de lo que el operador
 * seleccione en la interfaz: o existe un publicador de anuncios registrado, o no
 * existe. Ver el registro de publicadores más abajo.
 */
export const REPRICER_EXECUTION_MODES = {
  /** Calcula precios y los registra. No toca ningún anuncio de Binance. */
  READ_ONLY: 'READ_ONLY',
  /** Existe un publicador registrado y el ciclo le delega la escritura. */
  PUBLISHING: 'PUBLISHING',
} as const;

export type RepricerExecutionMode =
  (typeof REPRICER_EXECUTION_MODES)[keyof typeof REPRICER_EXECUTION_MODES];

/**
 * Ciclo contable al que se atribuyen las decisiones mientras el motor todavía no
 * maneja ciclos.
 *
 * NO es un ciclo inventado: es un valor obviamente no-real, para que ninguna fila
 * pueda pasar por verificada contablemente. `decision_cycles` es parte del
 * contrato, pero abrir y cerrar un ciclo exige cifras realizadas que nadie conoce
 * en el momento de decidir, y la capa de outcomes todavía no existe.
 *
 * PUNTO DE INTEGRACIÓN (fase siguiente): cuando exista el seguimiento de ciclos,
 * este archivo debe resolver el ciclo abierto real en vez de esta constante.
 */
export const DECISION_JOURNAL_PENDING_CYCLE_ID = 'PENDING_CYCLE_TRACKING';

/**
 * Antigüedad máxima, en milisegundos, para que la profundidad consultada al
 * decidir siga considerándose vigente.
 *
 * El motor decide sobre el libro que le llega, no sobre el libro que le gustaría
 * tener. Si ese dato tiene más edad que este umbral, la decisión se tomó sobre
 * información vieja, y el journal tiene que poder decirlo después.
 */
export const REPRICER_MARKET_STALE_AFTER_MS = 60_000;

/** Precios que el motor quiere dejar publicados en los anuncios del operador. */
export interface RepricerPublishRequest {
  buyPrice: number;
  sellPrice: number;
  strategy: RepricerStrategy;
}

/**
 * Puerto de escritura contra los anuncios de Binance P2P.
 *
 * NO EXISTE NINGUNA IMPLEMENTACIÓN EN ESTE REPOSITORIO. El único endpoint de
 * Binance del proyecto es `adv/search` (lectura de mercado, en
 * `binance-p2p.service.ts`). La interfaz existe únicamente como punto de
 * extensión honesto.
 */
export interface RepricerAdPublisher {
  /** Devuelve `true` si los anuncios quedaron efectivamente actualizados. */
  publish(request: RepricerPublishRequest): Promise<boolean>;
}

/**
 * Registro de publicadores de anuncios.
 *
 * ESTÁ VACÍO A PROPÓSITO, y por eso el motor jamás puede reportarse "en vivo".
 *
 * Para que este motor reporte `PUBLISHING` de forma legítima habría que:
 *   1. implementar `RepricerAdPublisher` contra la API de merchant de Binance
 *      (credenciales, idempotencia, límites de tasa, dinero real);
 *   2. registrarlo con `registerRepricerPublisher()` durante el arranque;
 *   3. verificar el resultado real de la escritura.
 * Recién entonces las etiquetas de este archivo dicen la verdad, sin que nadie
 * tenga que editarlas: el modo es DERIVADO de la existencia del publicador.
 */
const adPublisher = signal<RepricerAdPublisher | null>(null);

/** Registra el publicador real. Único camino que puede habilitar el modo `PUBLISHING`. */
export function registerRepricerPublisher(publisher: RepricerAdPublisher): void {
  adPublisher.set(publisher);
}

/** Limpia el registro. Exclusivo para tests: el runtime nunca lo llama. */
export function unregisterRepricerPublisher(): void {
  adPublisher.set(null);
}

export interface RepricerLogEntry {
  timestamp: string;
  action: 'UPDATE' | 'KEEP' | 'PAUSE';
  message: string;
  spreadVes: number;
  executionMode: RepricerExecutionMode;
}

@Injectable({ providedIn: 'root' })
export class BinanceRepricerService implements OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly binance = inject(BinanceP2pService);
  private readonly accounts = inject(AccountsService);

  /**
   * Journal de decisiones. Opcional a propósito: si el servicio de journal no
   * está cableado todavía, el motor sigue operando sin auditoría en vez de morir.
   * El trading no se frena porque la persistencia no esté disponible.
   */
  private readonly journal = inject(DecisionJournalService, { optional: true });
  private journalWarningShown = false;

  readonly isActive = signal<boolean>(false);
  readonly strategy = signal<RepricerStrategy>('TOP_1');
  readonly stepVes = signal<number>(0.05);
  readonly minSpreadVes = signal<number>(10.0);
  readonly breakEvenFloor = signal<number>(0);
  readonly maxBuyPrice = signal<number>(0);

  readonly currentBuyAdPrice = signal<number>(0);
  readonly currentSellAdPrice = signal<number>(0);

  readonly lastDecision = signal<RepricerDecision | null>(null);
  readonly logs = signal<RepricerLogEntry[]>([]);
  readonly intervalSeconds = signal<number>(20);

  private loopTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Única fuente de verdad del modo de ejecución. No es un flag: se deriva de si
   * hay un publicador real registrado. Sin publicador, `READ_ONLY` es el único
   * valor alcanzable, y ninguna etiqueta puede afirmar publicación.
   */
  readonly executionMode = computed<RepricerExecutionMode>(() =>
    adPublisher() ? REPRICER_EXECUTION_MODES.PUBLISHING : REPRICER_EXECUTION_MODES.READ_ONLY,
  );

  /**
   * ¿Hay un publicador real registrado? Lo consume la UI para el color del badge,
   * para que ninguna plantilla tenga que comparar el modo a mano.
   */
  readonly isPublishing = computed<boolean>(
    () => this.executionMode() === REPRICER_EXECUTION_MODES.PUBLISHING,
  );

  /** Etiqueta corta del modo real. Es la única fuente de las etiquetas de la UI. */
  readonly executionModeLabel = computed<string>(() =>
    this.executionMode() === REPRICER_EXECUTION_MODES.READ_ONLY
      ? 'SOLO LECTURA — NO PUBLICA'
      : 'PUBLICANDO EN BINANCE',
  );

  /** Frase explicativa: qué hace el motor y qué NO hace. */
  readonly executionModeDetail = computed<string>(() =>
    this.executionMode() === REPRICER_EXECUTION_MODES.READ_ONLY
      ? 'Calcula y registra precios. No publica anuncios: este proyecto no tiene capa de escritura contra la API de merchant de Binance.'
      : 'Publica los precios calculados contra la API de merchant de Binance.',
  );

  /** Prefijo de cada línea de log. Nunca dice "en vivo" por construcción. */
  readonly logPrefix = computed<string>(() =>
    this.executionMode() === REPRICER_EXECUTION_MODES.READ_ONLY
      ? '[SOLO LECTURA] '
      : '[PUBLICANDO] ',
  );

  ngOnDestroy(): void {
    this.stop();
  }

  toggle(): void {
    if (this.isActive()) {
      this.stop();
      this.toast.info('Bot de Repricing pausado.', 'Mesa de Operaciones');
    } else {
      this.start();
      this.toast.success(
        `Bot de Repricing activado (${this.executionModeLabel()}). ${this.executionModeDetail()}`,
        'Mesa de Operaciones',
      );
    }
  }

  start(): void {
    this.stop();
    this.isActive.set(true);
    void this.executeCycle();

    this.loopTimer = setInterval(() => {
      if (this.isActive()) {
        void this.executeCycle();
      }
    }, this.intervalSeconds() * 1000);
  }

  stop(): void {
    this.isActive.set(false);
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  killSwitch(): void {
    this.stop();
    this.addLog(
      'PAUSE',
      '🚨 KILL-SWITCH ACTIVADO: Bot detenido inmediatamente por el operador.',
      0,
    );
    this.toast.error('Bot de Repricing apagado de emergencia (Kill-Switch).', 'Seguridad P2P');
  }

  setStrategy(strat: RepricerStrategy): void {
    this.strategy.set(strat);
    if (this.isActive()) void this.executeCycle();
  }

  async executeCycle(): Promise<RepricerDecision | null> {
    const depth = await this.binance.fetchMarketDepth('USDT', 'VES');
    if (!depth) {
      return null;
    }

    // Check if any daily bank account cupo is breached
    const usages = this.accounts.usages();
    const isLimitExceeded = usages.some((u) => u.isOverLimit);

    const config: RepricerConfig = {
      asset: 'USDT',
      fiat: 'VES',
      strategy: this.strategy(),
      stepVes: this.stepVes(),
      minSpreadVes: this.minSpreadVes(),
      breakEvenSellPrice: this.breakEvenFloor(),
      maxBuyPrice: this.maxBuyPrice(),
    };

    const decision = evaluateRepricer({
      config,
      marketDepth: depth,
      currentBuyAdPrice: this.currentBuyAdPrice() > 0 ? this.currentBuyAdPrice() : undefined,
      currentSellAdPrice: this.currentSellAdPrice() > 0 ? this.currentSellAdPrice() : undefined,
      isDailyLimitExceeded: isLimitExceeded,
    });

    this.lastDecision.set(decision);

    // El journal se escribe ANTES de que el motor actúe sobre el libro: la
    // decisión tiene que existir cuando la publicación ocurra, para que el
    // outcome (éxito o fallo) se pueda colgar de ella. `KEEP` no decide nada —
    // "los precios ya están donde deben" no es una decisión, y contarlo como
    // tal inflaría el número de decisiones auditadas.
    if (decision.action !== 'KEEP') {
      await this.recordInJournal(decision, depth);
    }

    if (decision.action === 'UPDATE') {
      this.currentBuyAdPrice.set(decision.suggestedBuyPrice);
      this.currentSellAdPrice.set(decision.suggestedSellPrice);
      await this.publishOrLog(decision);
    } else if (decision.action === 'PAUSE') {
      this.stop();
      this.addLog(
        'PAUSE',
        `🛑 Bot pausado por regla de seguridad: ${decision.reason}`,
        decision.spreadVes,
      );
      this.toast.error(decision.reason, 'Alerta Repricer P2P');
    } else {
      this.addLog(
        'KEEP',
        'Precios en posición óptima en el libro. Sin cambios.',
        decision.spreadVes,
      );
    }

    return decision;
  }

  /**
   * Persiste la decisión y la evidencia de mercado que la respalda.
   *
   * NUNCA propaga el error: un journal que no puede escribir no puede frenar el
   * trading, pero sí tiene que avisar. Tampoco reintenta —el motor sigue operando
   * y el siguiente ciclo vuelve a intentarlo una sola vez—: el journal no es un
   * requisito de disponibilidad del motor de decisiones.
   */
  private async recordInJournal(
    decision: RepricerDecision,
    depth: BinanceP2pMarketDepth,
  ): Promise<void> {
    const journal = this.journal;
    if (!journal) {
      this.warnJournalNotWired();
      return;
    }

    // El modo se lee del servicio AHORA, en el momento de la decisión. Nunca desde
    // un counter, ni desde un timestamp, ni desde "hubo un publish antes": esa
    // columna separa una decisión modelada de una decisión ejecutada, y mentir
    // ahí arruina el journal entero.
    const executionMode = this.executionMode();

    let snapshotId: number;
    try {
      const snapshot = await journal.appendMarketSnapshot(this.buildSnapshotInput(depth));
      snapshotId = snapshot.id;
    } catch (err) {
      // Sin evidencia de mercado la decisión no es auditable, así que no se
      // escribe: no tiene sentido dejar una fila que no se puede verificar.
      this.reportJournalFailure('appendMarketSnapshot', decision, err);
      return;
    }

    // Una fila por lado: el motor reposiciona DOS anuncios y cada uno se llena (o
    // se rechaza) por separado. La fila de cada lado es la que después recibe su
    // outcome. `observed*` NO se manda: el adapter los copia del snapshot, para
    // que una decisión no pueda contradecir su propia evidencia.
    const sides: readonly { readonly side: DecisionSide; readonly price: number }[] = [
      { side: 'BUY', price: decision.suggestedBuyPrice },
      { side: 'SELL', price: decision.suggestedSellPrice },
    ];

    for (const { side, price } of sides) {
      try {
        await journal.appendDecision({
          cycleId: DECISION_JOURNAL_PENDING_CYCLE_ID,
          snapshotId,
          side,
          decisionPrice: price,
          origin: 'AUTO_ENGINE',
          executionMode,
          action: decision.action,
          modeledSpreadPct: decision.spreadPct,
          reason: decision.reason,
          safetyFlags: decision.safetyFlags,
        });
      } catch (err) {
        this.reportJournalFailure(`appendDecision(${side})`, decision, err);
        return;
      }
    }
  }

  /**
   * Snapshot NORMALIZADO de lo que el motor vio al decidir.
   *
   * No es el JSON crudo de `adv/search`: eso serían ~40 KB por fila y el journal
   * solo necesita los derivados. `obi` se CONSUME de `calculateOrderBookImbalance`
   * —que ya existe y es puro—; no se recalcula ni se reimplementa acá.
   */
  private buildSnapshotInput(depth: BinanceP2pMarketDepth): RecordMarketSnapshotInput {
    const now = Date.now();
    const fetchedAt = Date.parse(depth.updatedAt);
    const age = now - fetchedAt;

    return {
      obi: calculateOrderBookImbalance(depth.buyOffers, depth.sellOffers).obiRatio,
      bidUsd: depth.bestBuyPrice,
      askUsd: depth.bestSellPrice,
      nBids: depth.buyOffers.length,
      nAsks: depth.sellOffers.length,
      // Frescura REAL, no un default: si la marca de tiempo no es confiable —ilegible
      // o en el futuro— el dato se declara viejo antes que limpio.
      stale: !Number.isFinite(age) || age < 0 || age > REPRICER_MARKET_STALE_AFTER_MS,
      fetchedAt: Number.isFinite(age) ? fetchedAt : now,
    };
  }

  /**
   * Un fallo del journal se reporta una vez, con contexto, y el motor sigue.
   * `console.error` deja el rastro completo; el toast evita que el operador
   * publique con plata real sin enterarse de que dejó de auditarse.
   */
  private reportJournalFailure(stage: string, decision: RepricerDecision, err: unknown): void {
    const detail = err instanceof Error ? err.message : String(err);
    const context = `[repricer] No se pudo registrar la decisión ${decision.action}: ${stage} falló (${detail}).`;
    console.error(context, err);
    this.toast.error(context, 'Journal de decisiones');
  }

  /** Avisa UNA vez que las decisiones no se están auditando, sin tapar el log real. */
  private warnJournalNotWired(): void {
    if (this.journalWarningShown) return;
    this.journalWarningShown = true;
    console.warn(
      '[repricer] DecisionJournalService no está cableado: las decisiones se calculan pero no quedan auditadas.',
    );
  }

  /**
   * Escribe los precios si hay un publicador real registrado; si no, deja constancia
   * de que solo se calcularon. El log usa SIEMPRE `logPrefix()`, que ya depende del
   * modo real, así que no puede afirmar publicación cuando no la hubo.
   */
  private async publishOrLog(decision: RepricerDecision): Promise<void> {
    const prefix = this.logPrefix();
    const resumen = `Compra ${decision.suggestedBuyPrice} Bs | Venta ${decision.suggestedSellPrice} Bs (${this.strategy()})`;
    const publisher = adPublisher();

    if (!publisher) {
      this.addLog('UPDATE', `${prefix}Precios optimizados: ${resumen}`, decision.spreadVes);
      return;
    }

    const published = await publisher.publish({
      buyPrice: decision.suggestedBuyPrice,
      sellPrice: decision.suggestedSellPrice,
      strategy: this.strategy(),
    });
    this.addLog(
      'UPDATE',
      published
        ? `${prefix}Precios publicados en Binance: ${resumen}`
        : `${prefix}Publicación rechazada por el publicador: ${resumen}`,
      decision.spreadVes,
    );
  }

  private addLog(action: 'UPDATE' | 'KEEP' | 'PAUSE', message: string, spreadVes: number): void {
    const entry: RepricerLogEntry = {
      timestamp: new Date().toLocaleTimeString('es-VE'),
      action,
      message,
      spreadVes,
      executionMode: this.executionMode(),
    };
    this.logs.update((prev) => [entry, ...prev.slice(0, 19)]);
  }
}
