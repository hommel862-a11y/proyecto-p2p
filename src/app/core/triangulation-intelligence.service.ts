import { Injectable, OnDestroy, inject, signal, computed, type Signal } from '@angular/core';
import {
  predictBcvIntervention,
  evaluateDeltaHedge,
  type TriangularArbitrageResult,
  type ExchangeLeg,
} from '@p2p/core';
import { BinanceP2pService } from './binance-p2p.service';
import { CotizaveService, type CotizaveRatesProvenance } from './cotizave.service';
import { McpService } from './mcp.service';
import { ToastService } from './toast.service';

export interface BcvInterventionRisk {
  inWindow: boolean;
  /**
   * Derived from the calendar phase, NOT from a probability.
   *
   * It used to be `probabilityPct >= 80 ? 'EXTREME' : ...`. With the probability
   * correctly absent, every comparison against `null` is false, so the whole
   * ladder would silently collapse to `'LOW'` — including during an open auction
   * window. That is fail-silent in the dangerous direction, so intensity now
   * reads the phase and never the percentage.
   */
  intensity: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  /**
   * Always null: there is no probabilistic BCV intervention model, so this panel
   * reports the calendar phase and refuses to publish a likelihood.
   */
  probabilityPct: number | null;
  message: string;
}

export interface DeltaHedgeAdvice {
  needed: boolean;
  shortUsdtAmount: number;
  fiatExposureAmount: number;
  fiatCurrency: string;
  hedgeRatioPct: number;
  reason: string;
}

/**
 * Una tasa del snapshot, con su ausencia explícita.
 *
 * `value` es `number | null`, y `null` significa SIEMPRE "no hay dato genuino".
 * Nunca `0`: una tasa de cambio no puede ser 0, así que un 0 acá no es un dato
 * viejo, es un bug. Como el tipo obliga a mirar `status` antes de formatear, el
 * consumidor ya no puede convertir un hueco en un número con `| number`.
 *
 * El motivo de que esto sea una unión y no un `number | null` pelado es que un
 * `null` sin explicación es indistinguible de un bug de cableado, y el operador
 * no puede saber qué herramienta reintentar. `expectedSource` siempre dice de
 * dónde habría salido el número.
 */
export interface LiveRate {
  readonly value: number | null;
  readonly status: 'live' | 'unavailable';
  /** Fuente real del número. Solo cuando `status === 'live'`. */
  readonly source?: string;
  /** De dónde sale o habría salido el número. Se declara siempre. */
  readonly expectedSource: string;
  /** Por qué no hay número. Solo cuando `status === 'unavailable'`. */
  readonly unavailableReason?: string;
}

/** Razón genérica de ausencia: no se consultó ninguna fuente real. */
const RATE_ABSENT = 'SIN_DATO_DE_MERCADO';

const BINANCE_P2P_SOURCE = 'MCP get_binance_p2p_orderbook o BinanceP2pService';
const BCV_USD_SOURCE = 'Cotizave market `oficial` o MCP get_bcv_rates';
const BCV_EUR_SOURCE = 'Cotizave market `eur_reference` o MCP get_bcv_rates';
const PARALLEL_SOURCE = 'Cotizave market `parallel` o MCP get_parallel_rates';
const GAP_SOURCE = 'derivado de bcvUsd y parallelAvg';
const COP_PER_USDT_SOURCE = 'sin fuente: no hay mercado COP/USDT en vivo conectado';
const COP_PER_VES_SOURCE = 'derivado de copPerUsdt y binanceVesSell';
const ZINLI_SOURCE = 'sin fuente: no hay mesa digital en vivo conectada';

/**
 * Envuelve un número que viene de una fuente real. Un valor no finito o no
 * positivo NO se publica: se degrada a ausencia, porque `toNum` del parser y los
 * guards `> 0` de esta clase garantizan que una tasa válida siempre es > 0, y un
 * 0 acá se leería como un tipo de cambio real.
 */
function liveRate(value: number, source: string, expectedSource: string): LiveRate {
  if (!Number.isFinite(value) || value <= 0) {
    return unavailableRate(expectedSource, 'VALOR_NO_PLAUSIBLE');
  }
  return { value, status: 'live', source, expectedSource };
}

/**
 * Igual que `liveRate` pero para un valor DERIVADO, donde el 0 SÍ es un dato
 * legítimo: un paralelo exactamente en la tasa oficial es una brecha MEDIDA de
 * 0.00%, no una ausencia. Aplicar el invariante "> 0" de los niveles a un delta
 * destruiría el único caso en el que se puede afirmar que no hay brecha, que es
 * justamente el que el operador necesita distinguir del "no sé".
 *
 * Lo que nunca es válido en un delta es un NaN o un infinito, y eso es lo único
 * que se degrada a ausencia.
 */
function liveDelta(value: number, source: string, expectedSource: string): LiveRate {
  if (!Number.isFinite(value)) {
    return unavailableRate(expectedSource, 'VALOR_NO_FINITO');
  }
  return { value, status: 'live', source, expectedSource };
}

function unavailableRate(expectedSource: string, reason: string = RATE_ABSENT): LiveRate {
  return { value: null, status: 'unavailable', expectedSource, unavailableReason: reason };
}

/** Presentación de una tasa que nunca disguise la ausencia como un número. */
export function formatLiveRate(rate: LiveRate, digits = 2): string {
  return rate.value === null ? 'no disponible' : rate.value.toFixed(digits);
}

export interface LiveMarketRatesSnapshot {
  binanceVesBuy: LiveRate; // Precio al que compran USDT en P2P
  binanceVesSell: LiveRate; // Precio al que venden USDT en P2P
  bcvUsd: LiveRate; // Tasa oficial BCV USD
  bcvEur: LiveRate; // Tasa oficial BCV EUR
  parallelAvg: LiveRate; // Promedio paralelo (CotizaVe / EnParalelo)
  rateGapPct: LiveRate; // Brecha oficial vs paralelo %
  copPerUsdt: LiveRate; // Tasa Binance P2P COP/USDT
  copPerVes: LiveRate; // Cruce derivado COP por VES
  zinliUsdPerUsdt: LiveRate; // Venta digital Zinli/Wally
  timestamp: string;
  /**
   * De qué reloj es `timestamp`. El snapshot es una MEZCLA: las piernas de
   * Binance vienen por MCP, las de Cotizave del servicio de rates y el resto
   * puede no existir. `provenance` califica la parte de Cotizave, así que un
   * `timestamp` sin calificar se leía como la hora de mercado de TODO el
   * snapshot: el reloj de Cotizave puesto encima de un número de Binance calibra
   * una pierna y deja las otras creyendo que están igual de frescas.
   *
   * - `cotizave`: el reloj es el del fetch de Cotizave; para las piernas de
   *   Binance hay que mirar `source`, no este campo.
   * - `panel`: el reloj es el del tick, porque no hubo dato de Cotizave que fechar.
   */
  timestampSource: 'cotizave' | 'panel';
  /**
   * Procedencia de la parte del snapshot que salió de Cotizave. Va aparte de
   * `source` porque esa marca de CUÁNDO respondió la herramienta no dice si el
   * número se acaba de descargar o se restauró del disco al arrancar.
   * Ausente cuando no se puede afirmar: atribuir una procedencia a una fuente
   * que no intervino, o remapear 'none' a 'live', sería inventar el linaje.
   */
  provenance?: Exclude<CotizaveRatesProvenance, 'none'>;
  /**
   * De dónde salieron las piernas de Binance.
   *
   * `FALLBACK` ya no significa "rellenamos con constantes": significa que no hubo
   * fuente real y las tasas quedan marcadas como `unavailable`. Es el nombre que
   * le corresponde al estado honesto, y su valor ya no descansa en ningún número
   * inventado.
   */
  source: 'MCP_LIVE' | 'CACHE' | 'FALLBACK';
}

export interface McpTacticalReport {
  executionAllowed: boolean;
  primaryRisk: string;
  bcvRisk: BcvInterventionRisk;
  hedgeAdvice: DeltaHedgeAdvice;
  optimalTimingNote: string;
  orderbookLiquidityUsdt: number;
}

/**
 * Cada cuánto se relee el reloj del sistema.
 *
 * Es el techo de desfase del régimen BCV que muestra el panel: si dejás la app
 * abierta y cruzás las 09:00, la ventana puede tardar hasta este intervalo en
 * aparecer. Con 60 s el error máximo es de un minuto sobre una subasta de cuatro
 * horas, y a cambio no dejamos un `setInterval` despertando el proceso cada
 * segundo toda la sesión.
 */
export const VENEZUELA_CLOCK_REFRESH_MS = 60_000;

/**
 * Fuente del reloj, inyectable para que las pruebas puedan fijar la hora.
 *
 * Antes esto era un método que hacía `return new Date()`, lo que resolvía el
 * problema de los tests pero dejaba el producto roto. La injectable hacía el
 * reloj testeable, no el reloj reactivo: un método no es una dependencia de
 * signal, así que el `computed` que lo consume se memorizaba en la primera
 * lectura y jamás se recalculaba.
 *
 * Consecuencia en pantalla: el panel declara en qué régimen está la ventana de
 * intervención del BCV (lunes y jueves, 09:00-13:00 VET). Con la app abierta se
 * cruzaba la frontera de las 09:00 y el panel seguía diciendo "fuera de ventana
 * crítica" con la subasta efectivamente abierta. En el sentido inverso, seguir
 * impartiendo la advertencia de una subasta ya cerrada.
 *
 * Eso es el mismo defecto que el resto del barrido: un estado declarado que el
 * sistema no puede respaldar en el momento en que lo publica. Lo único que lo
 * diferenciaba es que acá laMeasureión era correcta —el calendario del BCV es un
 * horario público— y aun así la afirmación envejecía sin que nadie se enterara.
 *
 * Ahora `now` es un signal y un temporizador lo refresca. El intervalo se limpia
 * en `ngOnDestroy`: un `setInterval` sin limpiar en un servicio
 * `providedIn: 'root'` sobrevive al cierre del inyector y sigue despertando al
 * proceso el resto de la sesión.
 */
@Injectable({ providedIn: 'root' })
export class VenezuelaClock implements OnDestroy {
  private readonly instante = signal<Date>(new Date());

  /**
   * Instante actual. Deliberadamente un `Signal<Date>` y no un método: leerlo
   * dentro de un `computed` es lo que registra la dependencia que permite
   * invalidar el valor cuando el calendario cruza una frontera de fase.
   */
  readonly now: Signal<Date> = this.instante.asReadonly();

  private readonly intervalId: ReturnType<typeof setInterval> =
    setInterval(() => this.instante.set(new Date()), VENEZUELA_CLOCK_REFRESH_MS);

  ngOnDestroy(): void {
    clearInterval(this.intervalId);
  }
}

@Injectable({ providedIn: 'root' })
export class TriangulationIntelligenceService {
  private readonly binanceP2p = inject(BinanceP2pService);
  private readonly cotizave = inject(CotizaveService);
  private readonly mcp = inject(McpService);
  private readonly toast = inject(ToastService);
  private readonly clock = inject(VenezuelaClock);

  readonly isSyncingMarket = signal<boolean>(false);
  readonly lastSyncTimestamp = signal<string | null>(null);
  readonly mcpCallCount = signal<number>(0);

  /**
   * Estado inicial: TODO ausente.
   *
   * Antes arrancaba con 72.45 / 84.12 / 16.11 / 51.3 / 4250 / 0.985, y el panel
   * pintaba una brecha de +16.1% y un BCV de 72.45 VES en pantalla antes de que
   * existiera una sola llamada de red. Eso no era un valor de arranque
   * provisional: era una oportunidad de mercado inexistente declarada como dato.
   * Sin fetch detrás no hay nada que mostrar, y "no disponible" es la única
   * versión honesta.
   */
  readonly liveRates = signal<LiveMarketRatesSnapshot>({
    binanceVesBuy: unavailableRate(BINANCE_P2P_SOURCE, 'SIN_SINCRONIZAR'),
    binanceVesSell: unavailableRate(BINANCE_P2P_SOURCE, 'SIN_SINCRONIZAR'),
    bcvUsd: unavailableRate(BCV_USD_SOURCE, 'SIN_SINCRONIZAR'),
    bcvEur: unavailableRate(BCV_EUR_SOURCE, 'SIN_SINCRONIZAR'),
    parallelAvg: unavailableRate(PARALLEL_SOURCE, 'SIN_SINCRONIZAR'),
    rateGapPct: unavailableRate(GAP_SOURCE, 'SIN_SINCRONIZAR'),
    copPerUsdt: unavailableRate(COP_PER_USDT_SOURCE),
    copPerVes: unavailableRate(COP_PER_VES_SOURCE, 'SIN_SINCRONIZAR'),
    zinliUsdPerUsdt: unavailableRate(ZINLI_SOURCE),
    timestamp: 'Sin sincronizar',
    timestampSource: 'panel',
    source: 'FALLBACK',
  });

  /**
   * Evaluates the BCV intervention probability and active schedule.
   */
  readonly bcvStatus = computed<BcvInterventionRisk>(() => {
    try {
      // Leído como signal: esta llamada es la que registra la dependencia. Si el
      // reloj volviera a ser un método, el `computed` se congelaría en la primera
      // lectura y la ventana del BCV envejecería sin avisar.
      const now = this.clock.now();
      const pred = predictBcvIntervention(now);
      const isWindow = pred.phase === 'INTERVENTION_ACTIVE';

      // Intensity reads the calendar phase. The old version derived it from
      // `probabilityPct`, which is now (correctly) null: every `null >= n` is
      // false, so the ladder collapsed to 'LOW' even with an auction open.
      let intensity: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' = 'LOW';
      if (pred.phase === 'INTERVENTION_ACTIVE') intensity = 'EXTREME';
      else if (pred.phase === 'PRE_INTERVENTION_COMPRESSION') intensity = 'HIGH';
      else if (pred.phase === 'POST_INTERVENTION_REBOUND') intensity = 'MEDIUM';

      return {
        inWindow: isWindow,
        intensity,
        probabilityPct: pred.probabilityPct,
        message: isWindow
          ? `⚠️ Ventana activa de intervención BCV. ${pred.rationale}`
          : `✅ Fuera de ventana crítica BCV. Próxima fecha esperada: ${pred.nextExpectedIntervention}.`,
      };
    } catch {
      // The predictor threw, so we know nothing about the window. Publishing
      // `probabilityPct: 20` and "régimen normal" here claimed a normal regime
      // on the exact path where the system failed to find out.
      return {
        inWindow: false,
        intensity: 'LOW',
        probabilityPct: null,
        message: 'Ventana BCV indeterminada: el predictor no respondió. Sin dato, no hay régimen que declarar.',
      };
    }
  });

  /**
   * Evaluates if a given route requires synthetic short hedging to protect fiat capital in transit.
   */
  computeHedgeAdvice(result: TriangularArbitrageResult): DeltaHedgeAdvice {
    const hasVes = result.steps.some((s) => s.fromCurrency === 'VES' || s.toCurrency === 'VES');
    const totalMinutes = result.totalDurationMinutes;

    if (!hasVes || totalMinutes < 35 || result.roiPct < 1.0) {
      return {
        needed: false,
        shortUsdtAmount: 0,
        fiatExposureAmount: 0,
        fiatCurrency: 'VES',
        hedgeRatioPct: 0,
        reason:
          'El tiempo de rotación es inferior al umbral crítico o no involucra moneda de alta devaluación.',
      };
    }

    // Step with VES exposure
    const vesStep = result.steps.find((s) => s.fromCurrency === 'VES' || s.toCurrency === 'VES');
    const vesAmount = vesStep
      ? vesStep.fromCurrency === 'VES'
        ? vesStep.inputAmount
        : vesStep.outputAmount
      : 0;
    const currentRate = vesStep && vesStep.price > 0 ? vesStep.price : 80;

    try {
      const proposal = evaluateDeltaHedge({
        vesBalance: vesAmount,
        usdtBalance: 0,
        currentParallelRate: currentRate,
        openP2pSellOrdersUsdt: 0,
        openP2pBuyOrdersVes: 0,
        vesMaxHoldingTimeMinutes: totalMinutes,
      });

      if (proposal) {
        return {
          needed: true,
          shortUsdtAmount: Math.round(proposal.hedgeAmountUsdt * 100) / 100,
          fiatExposureAmount: Math.round(vesAmount * 100) / 100,
          fiatCurrency: 'VES',
          hedgeRatioPct: 100,
          reason: `Exposición a VES de ${totalMinutes} min. ${proposal.reason}`,
        };
      }

      return {
        needed: false,
        shortUsdtAmount: 0,
        fiatExposureAmount: Math.round(vesAmount * 100) / 100,
        fiatCurrency: 'VES',
        hedgeRatioPct: 0,
        reason: 'Exposición dentro de parámetros aceptables.',
      };
    } catch {
      const fallbackUsdt = currentRate > 0 ? vesAmount / currentRate : 0;
      return {
        needed: true,
        shortUsdtAmount: Math.round(fallbackUsdt * 100) / 100,
        fiatExposureAmount: Math.round(vesAmount * 100) / 100,
        fiatCurrency: 'VES',
        hedgeRatioPct: 100,
        reason: 'Exposición a VES prolongada. Recomendada cobertura 1:1 en futuros.',
      };
    }
  }

  /**
   * Generates a tactical MCP intelligence assessment for the active route.
   */
  generateTacticalReport(result: TriangularArbitrageResult): McpTacticalReport {
    const bcv = this.bcvStatus();
    const hedge = this.computeHedgeAdvice(result);

    const isBlocked =
      result.riskLevel === 'CRITICAL' || (bcv.inWindow && result.totalDurationMinutes > 60);

    let optimalTimingNote = 'Condiciones favorables para rotación de capital inmediata.';
    if (bcv.inWindow) {
      optimalTimingNote =
        'Precaución: El BCV suele inyectar oferta bancaria en esta franja. Reducir montos de tramo 1.';
    } else if (result.roiPct > 2.5) {
      optimalTimingNote =
        'Oportunidad de alto rendimiento detectada: acelerar la ejecución en el tramo con mayor liquidez.';
    }

    // Available liquidity from Binance P2P cache
    const depth = this.binanceP2p.marketDepth();
    const orderbookLiquidityUsdt =
      depth && depth.buyOffers.length > 0
        ? depth.buyOffers.reduce((acc, o) => acc + o.maxVes / Math.max(1, o.price), 0)
        : 15000;

    return {
      executionAllowed: !isBlocked,
      primaryRisk:
        result.riskReasons[0] ?? 'Riesgo operativo estándar dentro de los límites de capital.',
      bcvRisk: bcv,
      hedgeAdvice: hedge,
      optimalTimingNote,
      orderbookLiquidityUsdt: Math.round(orderbookLiquidityUsdt),
    };
  }

  /**
   * Obtiene y consolida las tasas en vivo desde herramientas MCP, adaptadores P2P y monitores oficiales
   */
  async fetchLiveMarketRates(): Promise<LiveMarketRatesSnapshot> {
    this.isSyncingMarket.set(true);

    // Cada campo arranca AUSENTE y solo se llena si una fuente real lo aporta.
    // Antes arrancaban en constantes (72.45 / 84.12 / 82.2 / 4250) y el paso 6
    // devolvía 16.11 y 51.3 cuando faltaba el dato: una brecha y un cruce con
    // forma de mercado y sin nada detrás. 51.3 era 4250 / 82.85, o sea las mismas
    // constantes de arranque disfrazadas de un cruce derivado.
    let binanceVesBuy = unavailableRate(BINANCE_P2P_SOURCE, 'MCP_SIN_RESPUESTA');
    let binanceVesSell = unavailableRate(BINANCE_P2P_SOURCE, 'MCP_SIN_RESPUESTA');
    let bcvUsd = unavailableRate(BCV_USD_SOURCE, 'MCP_SIN_RESPUESTA');
    let bcvEur = unavailableRate(BCV_EUR_SOURCE, 'MCP_SIN_RESPUESTA');
    let parallelAvg = unavailableRate(PARALLEL_SOURCE, 'MCP_SIN_RESPUESTA');
    // Estas dos no tienen ninguna fuente real detrás en el path de sincronización
    // (no hay mercado COP/USDT ni mesa digital consultada acá). Antes valían 4250
    // y 0.985, y 4250 es la mitad del problema del 51.3: era el numerador del
    // cruce derivado. Se declaran ausentes y `const` a propósito.
    const copPerUsdt = unavailableRate(COP_PER_USDT_SOURCE);
    const zinliUsdPerUsdt = unavailableRate(ZINLI_SOURCE);
    let source: 'MCP_LIVE' | 'CACHE' | 'FALLBACK' = 'FALLBACK';

    try {
      // 1. Herramienta MCP: Libro de órdenes Binance P2P VES
      const p2pRes = await this.mcp.testTool('get_binance_p2p_orderbook', {
        fiat: 'VES',
        asset: 'USDT',
        rows: 5,
      });
      this.mcpCallCount.update((c) => c + 1);

      if (p2pRes.success && p2pRes.result) {
        const data = p2pRes.result as Record<string, unknown>;
        if (typeof data['topBuyPrice'] === 'number' && data['topBuyPrice'] > 0) {
          binanceVesBuy = liveRate(
            data['topBuyPrice'],
            'MCP get_binance_p2p_orderbook',
            BINANCE_P2P_SOURCE,
          );
          source = 'MCP_LIVE';
        }
        if (typeof data['topSellPrice'] === 'number' && data['topSellPrice'] > 0) {
          binanceVesSell = liveRate(
            data['topSellPrice'],
            'MCP get_binance_p2p_orderbook',
            BINANCE_P2P_SOURCE,
          );
          source = 'MCP_LIVE';
        }
      }

      // 2. Herramienta MCP: Tasas Oficiales BCV
      const bcvRes = await this.mcp.testTool('get_bcv_rates', { cacheFallback: true });
      this.mcpCallCount.update((c) => c + 1);
      if (bcvRes.success && bcvRes.result) {
        const data = bcvRes.result as Record<string, unknown>;
        if (typeof data['usd'] === 'number' && data['usd'] > 0) {
          bcvUsd = liveRate(data['usd'], 'MCP get_bcv_rates', BCV_USD_SOURCE);
          source = 'MCP_LIVE';
        }
        if (typeof data['eur'] === 'number' && data['eur'] > 0) {
          bcvEur = liveRate(data['eur'], 'MCP get_bcv_rates', BCV_EUR_SOURCE);
        }
      }

      // 3. Herramienta MCP: Tasas Paralelas Consolidadas
      const parallelRes = await this.mcp.testTool('get_parallel_rates', {});
      this.mcpCallCount.update((c) => c + 1);
      if (parallelRes.success && parallelRes.result) {
        const data = parallelRes.result as Record<string, unknown>;
        if (typeof data['average'] === 'number' && data['average'] > 0) {
          parallelAvg = liveRate(data['average'], 'MCP get_parallel_rates', PARALLEL_SOURCE);
          source = 'MCP_LIVE';
        }
      }

      // 4. Fallback/Complemento de BinanceP2pService si tiene datos en vivo en memoria
      const depth = this.binanceP2p.marketDepth();
      if (depth && depth.bestBuyPrice > 0 && depth.bestSellPrice > 0) {
        binanceVesBuy = liveRate(depth.bestBuyPrice, 'BinanceP2pService', BINANCE_P2P_SOURCE);
        binanceVesSell = liveRate(depth.bestSellPrice, 'BinanceP2pService', BINANCE_P2P_SOURCE);
        source = 'MCP_LIVE';
      }

      // 5. Fallback/Complemento de CotizaveService si está conectado.
      //
      // Las claves tienen que ser las que produce `normalizeMarketKey` en
      // `projects/core/src/lib/cotizave.ts`, que mapea el market `reference` del
      // API a `'oficial'` y deja `parallel` tal cual. Este bloque leía
      // `['paralelo']` y `['bcv']`, dos claves que el parser no puede emitir
      // nunca: ambas lecturas daban `undefined`, el guard las descartaba en
      // silencio, y para BCV y paralelo este "complemento" no había aportado
      // nada en su vida. Con las claves reales, Cotizave sí puede complementar.
      const cotizaveRates = this.cotizave.ratesByMarket();
      let usedCotizave = false;
      const binanceMid = cotizaveRates['binance']?.mid;
      if (binanceMid != null && binanceMid > 0) {
        binanceVesSell = liveRate(binanceMid, 'Cotizave market `binance`', BINANCE_P2P_SOURCE);
        usedCotizave = true;
      }
      const parallelMid = cotizaveRates['parallel']?.mid;
      if (parallelMid != null && parallelMid > 0) {
        parallelAvg = liveRate(parallelMid, 'Cotizave market `parallel`', PARALLEL_SOURCE);
        usedCotizave = true;
      }
      // `reference` es el ancla oficial que el API publica como `oficial`, y su
      // `mid` es el mismo valor que el propio API reporta en
      // `index.components.bcv`.
      const oficialMid = cotizaveRates['oficial']?.mid;
      if (oficialMid != null && oficialMid > 0) {
        bcvUsd = liveRate(oficialMid, 'Cotizave market `oficial`', BCV_USD_SOURCE);
        usedCotizave = true;
      }
      const eurRefMid = cotizaveRates['eur_reference']?.mid;
      if (eurRefMid != null && eurRefMid > 0) {
        bcvEur = liveRate(eurRefMid, 'Cotizave market `eur_reference`', BCV_EUR_SOURCE);
        usedCotizave = true;
      }

      // 6. Cálculo de brecha cambiaria y cruce derivado COP/VES.
      //
      // Un valor derivado sin sus dos insumos NO es un 0 ni un default: es
      // ausencia. Se propaga como tal para que un hueco no se lea como una brecha
      // de 0% (que sí sería una afirmación de mercado).
      const rateGapPct =
        bcvUsd.value !== null && parallelAvg.value !== null && bcvUsd.value > 0
          ? liveDelta(
              Math.round(((parallelAvg.value - bcvUsd.value) / bcvUsd.value) * 10000) / 100,
              'derivado de Cotizave `oficial` y `parallel`',
              GAP_SOURCE,
            )
          : unavailableRate(GAP_SOURCE, 'FALTA_BCV_O_PARALELO');
      const copPerVes =
        copPerUsdt.value !== null && binanceVesSell.value !== null && binanceVesSell.value > 0
          ? liveDelta(
              Math.round((copPerUsdt.value / binanceVesSell.value) * 100) / 100,
              'derivado de copPerUsdt y binanceVesSell',
              COP_PER_VES_SOURCE,
            )
          : unavailableRate(COP_PER_VES_SOURCE, 'FALTA_COP_USDT_O_BINANCE_P2P');

      // El reloj del snapshot es el del DATO, no el del tick. Estampar `new Date()`
      // acá convertía cada restore del disco en un número rec sticker de "recién
      // cotizado", y es justamente el consumidor el que lo lee como timestamp de
      // mercado. Un reloj de Cotizave adelantado (desincronización de máquina) no
      // puede empujar el snapshot al futuro, así que se cae a `now` en ese caso.
      const cotizaveAt = usedCotizave ? this.cotizave.lastFetched() : null;
      const producedAt = cotizaveAt && cotizaveAt.getTime() < Date.now() ? cotizaveAt : new Date();

      const snapshot: LiveMarketRatesSnapshot = {
        binanceVesBuy,
        binanceVesSell,
        bcvUsd,
        bcvEur,
        parallelAvg,
        rateGapPct,
        copPerUsdt,
        copPerVes,
        zinliUsdPerUsdt,
        timestamp: producedAt.toLocaleTimeString(),
        // El reloj se declara siempre, y no como opcional: cuando el snapshot
        // mezcla fuentes, omitir la calificación es exactamente el defecto.
        timestampSource: producedAt === cotizaveAt && cotizaveAt !== null ? 'cotizave' : 'panel',
        ...this.snapshotProvenance(usedCotizave),
        source,
      };

      this.liveRates.set(snapshot);
      this.lastSyncTimestamp.set(snapshot.timestamp);
      return snapshot;
    } finally {
      this.isSyncingMarket.set(false);
    }
  }

  /**
   * Procedencia que se adjunta al snapshot. `none` con rates en pantalla es un
   * estado inconsistente (solo posible si alguien escribe las tasas por fuera
   * del servicio), y la respuesta honesta es no declarar procedencia, no
   * promoting a 'live'.
   */
  private snapshotProvenance(usedCotizave: boolean): Pick<LiveMarketRatesSnapshot, 'provenance'> {
    if (!usedCotizave) return {};
    const provenance = this.cotizave.ratesProvenance();
    return provenance === 'none' ? {} : { provenance };
  }

  /**
   * Aplica las tasas de mercado consolidadas a los tres tramos de una ruta triangular.
   *
   * Un tramo SOLO se reescribe si su tasa tiene dato genuino. `ExchangeLeg.price`
   * es un `number` y no tiene cómo representar "no hay dato": cuando la tasa está
   * ausente se deja el precio declarado del preset y no se lo viste de "en vivo".
   * Es la diferencia entre una suposición explícita del operador y una tasa de
   * mercado que el snapshot nunca tuvo.
   */
  applyLiveRatesToLegs(
    legs: [ExchangeLeg, ExchangeLeg, ExchangeLeg],
    rates: LiveMarketRatesSnapshot,
    presetId?: string,
  ): [ExchangeLeg, ExchangeLeg, ExchangeLeg] {
    const l1 = { ...legs[0] };
    const l2 = { ...legs[1] };
    const l3 = { ...legs[2] };

    /** Asigna el precio solo si la tasa existe; si no, conserva el del tramo. */
    const apply = (leg: ExchangeLeg, rate: LiveRate): void => {
      if (rate.value !== null) leg.price = rate.value;
    };

    if (
      presetId === 'route-ves-usdt-cop' ||
      (l1.fromCurrency === 'VES' && l2.toCurrency === 'COP')
    ) {
      // Tramo 1: VES -> USDT (Comprar USDT en P2P con VES: tasa sell/ask)
      apply(l1, rates.binanceVesSell);
      // Tramo 2: USDT -> COP (Venta de USDT recibiendo COP)
      apply(l2, rates.copPerUsdt);
      // Tramo 3: COP -> VES (Retorno de COP a VES vía mesa o giro directo)
      apply(l3, rates.copPerVes);
    } else if (
      presetId === 'route-usdt-usd-ves' ||
      (l1.fromCurrency === 'USDT' && l1.toCurrency === 'USD')
    ) {
      // Tramo 1: USDT -> USD (Zinli / Wally)
      apply(l1, rates.zinliUsdPerUsdt);
      // Tramo 2: USD -> VES (Remesa o cambio a paralelo)
      apply(l2, rates.parallelAvg);
      // Tramo 3: VES -> USDT (Recompra de USDT con VES en P2P)
      apply(l3, rates.binanceVesSell);
    } else {
      // Regla universal según las divisas de cada tramo
      for (const leg of [l1, l2, l3]) {
        if (leg.fromCurrency === 'VES' && leg.toCurrency === 'USDT') {
          apply(leg, rates.binanceVesSell);
        } else if (leg.fromCurrency === 'USDT' && leg.toCurrency === 'VES') {
          apply(leg, rates.binanceVesBuy);
        } else if (leg.fromCurrency === 'USD' && leg.toCurrency === 'VES') {
          apply(leg, rates.parallelAvg);
        } else if (leg.fromCurrency === 'USDT' && leg.toCurrency === 'COP') {
          apply(leg, rates.copPerUsdt);
        } else if (leg.fromCurrency === 'COP' && leg.toCurrency === 'VES') {
          apply(leg, rates.copPerVes);
        }
      }
    }

    return [l1, l2, l3];
  }

  /**
   * Sincroniza tasas reales de mercado consultando los adaptadores y herramientas MCP
   */
  async syncLiveRates(
    activeLegs: [ExchangeLeg, ExchangeLeg, ExchangeLeg],
    presetId?: string,
  ): Promise<[ExchangeLeg, ExchangeLeg, ExchangeLeg]> {
    try {
      const snapshot = await this.fetchLiveMarketRates();
      const updatedLegs = this.applyLiveRatesToLegs(activeLegs, snapshot, presetId);
      // El toast declara lo que falta: un "éxito" que lista 72.45 y 84.12 cuando
      // no llegó ninguna de las dos tasas es peor que un aviso de dato faltante,
      // porque el operador lee que la sincronización funcionó.
      const faltantes = (['binanceVesSell', 'parallelAvg', 'bcvUsd'] as const)
        .filter((campo) => snapshot[campo].value === null)
        .map((campo) => snapshot[campo].expectedSource);
      this.toast.success(
        `Tasas de mercado actualizadas vía MCP (VES/USDT: ${formatLiveRate(snapshot.binanceVesSell)} · Paralelo: ${formatLiveRate(snapshot.parallelAvg)} · BCV: ${formatLiveRate(snapshot.bcvUsd)}).`,
        'Sincronización MCP',
      );
      if (faltantes.length > 0) {
        this.toast.warn(
          `Sin dato real para ${faltantes.length} de las tasas. No se muestra ningún valor estimado.`,
          'Tasas no disponibles',
        );
      }
      return updatedLegs;
    } catch {
      this.toast.warn(
        'No se pudo conectar a los servicios MCP. Manteniendo últimas cotizaciones.',
        'Advertencia',
      );
      return activeLegs;
    }
  }
}
