import { Injectable, computed, inject, signal, OnDestroy } from '@angular/core';
import { ToastService } from './toast.service';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import {
  evaluateRepricer,
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
    this.executionMode() === REPRICER_EXECUTION_MODES.READ_ONLY ? '[SOLO LECTURA] ' : '[PUBLICANDO] ',
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
