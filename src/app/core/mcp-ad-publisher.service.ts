import { Injectable, inject, signal } from '@angular/core';
import { McpService } from './mcp.service';
import { ToastService } from './toast.service';
import { DecisionJournalService } from './decision-journal.service';
import {
  registerRepricerPublisher,
  unregisterRepricerPublisher,
  type RepricerAdPublisher,
  type RepricerPublishRequest,
} from './binance-repricer.service';
import type { DecisionSide } from '@p2p/core';

export interface McpPublisherConfig {
  dryRun?: boolean;
  maxDeviationPct?: number;
  buyAdId?: string;
  sellAdId?: string;
  exchange?: 'BINANCE_P2P' | 'BYBIT_P2P';
}

/**
 * `detail` de un intento aceptado SIN confirmación del merchant.
 *
 * Dice las dos cosas: que no hay fill, y que tampoco hubo escritura contra
 * Binance. Un `detail` vacío dejaría al consumidor adivinar si el 0 de
 * `filledAmountUsdt` significa "no llenó" o "no se midió", y `source` por sí
 * solo no alcanza para saber que el precio nunca llegó a un anuncio.
 */
const PUBLISH_ACCEPTED_DETAIL = 'Intento de publicación aceptado; sin fill confirmado.';

/**
 * Forma del recibo que fabrica el simulador de `publish_ad_price`.
 *
 * `SIG-AD-<últimos 6 del adId>-<Date.now()>`. Se genera con el reloj de la
 * máquina que corre el publicador, así que no identifica nada en ningún
 * exchange: no se puede buscar, no se puede contrastar, no es una referencia.
 *
 * Se reconoce por la forma y no por confianza porque el campo es texto libre:
 * un `externalRef` que empezara con esto sería un comprobante falso colgado de
 * una fila de auditoría, que es peor que no tenerlo.
 */
const SYNTHETIC_SIGNATURE_PREFIX = 'SIG-AD-';

/**
 * Respuesta de `publish_ad_price`, tal como la ve este servicio.
 *
 * `merchantConfirmed` y `simulated` son los dos campos que deciden si lo que
 * volvió es una confirmación del exchange o el resultado de un simulador. Se
 * leen porque no hay forma de deducirlo del resto: las dos ramas de
 * `McpService.testTool` devuelven `success: true` con la misma forma.
 */
interface PublishToolResult {
  success?: boolean;
  error?: string;
  simulated?: boolean;
  merchantConfirmed?: boolean;
  status?: string;
  dryRun?: boolean;
  auditTrail?: {
    signature?: string;
    merchantRef?: string | null;
  };
}

/**
 * Una publicación, ya juzgada: qué se hizo y qué se puede afirmar de ella.
 *
 * El punto de este tipo es que `merchantRef` y `merchantConfirmed` no pueden
 * viajar separados. Antes el journal heredaba un `source` fijo y se guardaba una
 * firma que nadie le había pasado: la fila afirmaba una confirmación de Binance
 * que el código de arriba nunca había recibido. Ahora la afirmación se DERIVA de
 * la respuesta, y si no hay evidencia no hay `BINANCE_MERCHANT` que escribir.
 */
interface PublishOutcome {
  /** Referencia verificable del exchange, o `null` si no la hay. */
  readonly merchantRef: string | null;
  /** `true` solo con confirmación explícita Y una referencia real que la respalde. */
  readonly merchantConfirmed: boolean;
  /** Recibo local, para conservarlo como evidencia legible sin adquirir autoridad. */
  readonly localReceipt: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class McpAdPublisherService implements RepricerAdPublisher {
  private readonly mcp = inject(McpService);
  private readonly toast = inject(ToastService);

  /**
   * Journal de resultados. OpcIONAL a propósito, y por la misma razón que en el
   * repricer: si la persistencia no está disponible, publicar no se cae. Un
   * journal que no puede escribir avisa y se aparta; no frena la escritura.
   */
  private readonly journal = inject(DecisionJournalService, { optional: true });
  private journalWarningShown = false;

  readonly isEnabled = signal<boolean>(false);
  readonly isDryRun = signal<boolean>(true);
  readonly maxDeviationPct = signal<number>(3.0);
  readonly buyAdId = signal<string>('BINANCE-BUY-ADV-01');
  readonly sellAdId = signal<string>('BINANCE-SELL-ADV-01');
  readonly exchange = signal<'BINANCE_P2P' | 'BYBIT_P2P'>('BINANCE_P2P');

  readonly lastPublishedSignature = signal<string | null>(null);
  readonly lastPublishTimestamp = signal<string | null>(null);
  readonly lastRejectionError = signal<string | null>(null);

  /**
   * Aciertos acumulados, para la UI.
   *
   * ESTO NO ES EL REGISTRO. Es un contador en memoria que se reinicia con la
   * app, no guarda historia, y —lo importante— no registra los fallos: un
   * rechazo deja el número intacto, así que "12 publicaciones" nunca significa
   * "12 publicaciones correctas". La fuente de verdad son las filas de
   * `decision_outcomes`, que registran cada intento, exitoso o fallido.
   *
   * No lo uses como auditoría: es el número que ya está en pantalla y es más
   * barato de leer que una query, así que la tentación de tomarlo por
   * "publicaciones" es alta. Por eso existe el journal.
   */
  readonly successfulPublishesCount = signal<number>(0);

  private lastBuyPrice: number | null = null;
  private lastSellPrice: number | null = null;

  /**
   * ¿Hay a quién delegarle una escritura de verdad?
   *
   * El modo del repricer es DERIVADO: `executionMode()` vale `PUBLISHING` si y
   * solo si hay un publicador registrado. Eso significa que registrar este
   * servicio es indistinguible, para el motor, de tener escritura real contra
   * la API de merchant de Binance — y no la hay. Por eso el registro se
   * condiciona a las dos condiciones que sí se pueden verificar acá:
   *
   *  1. el operador apagó el dry-run, y
   *  2. hay puente MCP nativo. En build web `McpService.testTool` responde
   *     `simulateMcpTool`, así que "en vivo" sería una simulación con otro
   *     nombre.
   *
   * Sin registro, el motor queda en `READ_ONLY`: sigue decidiendo y sigue
   * journalizando decisiones, pero journaliza `executionMode: 'READ_ONLY'` y no
   * delega ninguna escritura. Es la diferencia entre una decisión modelada y
   * una ejecutada, y esa columna no se negocia.
   *
   * ── Lo que esto NO arregla ────────────────────────────────────────────────
   *
   * Con las dos condiciones satisfechas, `publish_ad_price` sigue siendo una
   * función pura: no abre socket contra Binance. El motor va a reportar
   * `PUBLISHING` y su etiqueta va a decir "Publica los precios calculados contra
   * la API de merchant de Binance", y eso sigue siendo más de lo que ocurre.
   * El journal ya no miente en ningún caso (por eso `source` depende de la
   * evidencia y no del modo), pero la ETIQUETA del modo solo se vuelve verdad
   * cuando exista la capa de escritura real, que vive en
   * `binance-repricer.service.ts`. Está anotado acá porque este es el punto
   * donde la diferencia se ve, no porque sea una nota de changelog.
   */
  private hasRealPublisher(): boolean {
    return !this.isDryRun() && this.mcp.hasNativeTransport();
  }

  /**
   * Enables the MCP Ad Publisher and registers it in the repricer engine.
   * This officially transitions BinanceRepricerService into PUBLISHING mode.
   */
  enablePublishing(config?: McpPublisherConfig): void {
    if (config?.dryRun !== undefined) this.isDryRun.set(config.dryRun);
    if (config?.maxDeviationPct !== undefined) this.maxDeviationPct.set(config.maxDeviationPct);
    if (config?.buyAdId !== undefined) this.buyAdId.set(config.buyAdId);
    if (config?.sellAdId !== undefined) this.sellAdId.set(config.sellAdId);
    if (config?.exchange !== undefined) this.exchange.set(config.exchange);

    this.isEnabled.set(true);

    // Registrar o no es la diferencia entre que el motor diga "PUBLICANDO" y
    // que diga "SOLO LECTURA". El registro se hace solo si hay un publicador
    // real detrás: el simulador no se registra, porque su único efecto sería
    // poner una etiqueta que el operador lee como verdad.
    const registrable = this.hasRealPublisher();
    if (registrable) {
      registerRepricerPublisher(this);
    } else {
      unregisterRepricerPublisher();
    }

    const mode = registrable
      ? 'PRODUCCIÓN EN VIVO'
      : this.isDryRun()
        ? 'SIMULACIÓN (Dry-Run)'
        : 'SIMULACIÓN (sin puente MCP nativo)';
    this.toast.success(
      `Publicador MCP activado en modo ${mode} con guardarraíles anti-fat-finger (${this.maxDeviationPct()}% máx desvío).`,
      'P2P Ad Automaker MCP',
    );
  }

  /**
   * Disables the publisher and restores BinanceRepricerService to READ_ONLY mode.
   */
  disablePublishing(): void {
    this.isEnabled.set(false);
    unregisterRepricerPublisher();
    this.toast.info(
      'Publicador MCP desactivado. Repricer restaurado a modo SOLO LECTURA.',
      'P2P Ad Automaker MCP',
    );
  }

  /**
   * Concrete implementation of RepricerAdPublisher interface.
   * Dispatches price updates through the publish_ad_price MCP tool.
   *
   * Cada intento a un anuncio deja UN outcome en el journal, aceptado o rechazado.
   * Antes de esto solo existía `successfulPublishesCount`, que cuenta aciertos y
   * se queda mudo ante un fallo: con `enablePublishing()` llevando el motor a
   * `PUBLISHING` (escritura real de anuncios en Binance) eso es publicar a
   * ciegas con plata real.
   *
   * Los dos lados se registran por separado porque son dos anuncios y pueden
   * tener destinos distintos: la compra puede aceptarse y la venta rechazarse.
   * Un único outcome por llamada perdería esa distinción.
   */
  async publish(request: RepricerPublishRequest): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    this.lastRejectionError.set(null);

    // Lado que se está intentando ahora. Lo fija el catch para poder atribuirle
    // el fallo: sin esto, una excepción en la venta se registraría —o no— en la
    // decisión equivocada.
    let attemptedSide: DecisionSide | null = null;

    try {
      // 1. Publish BUY ad price through MCP guardrails
      if (request.buyPrice > 0) {
        attemptedSide = 'BUY';
        const buyRes = await this.mcp.testTool('publish_ad_price', {
          adId: this.buyAdId(),
          exchange: this.exchange(),
          side: 'BUY',
          newPrice: request.buyPrice,
          expectedPreviousPrice: this.lastBuyPrice ?? undefined,
          maxPriceDeviationPct: this.maxDeviationPct(),
          dryRun: this.isDryRun(),
          rationale: `Repricing ${request.strategy}: Compra ajustada a ${request.buyPrice} VES`,
        });

        const buyData = buyRes.result as PublishToolResult | null;

        if (!buyRes.success || buyData?.success === false) {
          const err = buyData?.error || buyRes.error || 'Rechazo de seguridad en anuncio de compra';
          this.lastRejectionError.set(err);
          this.toast.error(err, 'Guardarraíl de Publicación MCP');
          await this.recordPublishAttempt({
            side: 'BUY',
            decisionId: request.decisionIds?.['BUY'],
            success: false,
            detail: `Rechazo del publicador MCP: ${err}`,
            outcome: { merchantRef: null, merchantConfirmed: false, localReceipt: null },
          });
          return false;
        }

        // Qué se puede afirmar de esta respuesta. Se calcula UNA vez y se pasa
        // al journal, para que la etiqueta del origen, el `externalRef` y la
        // señal de UI no puedan discrepar entre sí.
        const buyOutcome = this.judgeResponse(buyData);
        if (buyOutcome.merchantConfirmed) {
          this.lastPublishedSignature.set(buyOutcome.merchantRef);
        }
        this.lastBuyPrice = request.buyPrice;
        await this.recordPublishAttempt({
          side: 'BUY',
          decisionId: request.decisionIds?.['BUY'],
          success: true,
          outcome: buyOutcome,
        });
      }

      // 2. Publish SELL ad price through MCP guardrails
      if (request.sellPrice > 0) {
        attemptedSide = 'SELL';
        const sellRes = await this.mcp.testTool('publish_ad_price', {
          adId: this.sellAdId(),
          exchange: this.exchange(),
          side: 'SELL',
          newPrice: request.sellPrice,
          expectedPreviousPrice: this.lastSellPrice ?? undefined,
          maxPriceDeviationPct: this.maxDeviationPct(),
          dryRun: this.isDryRun(),
          rationale: `Repricing ${request.strategy}: Venta ajustada a ${request.sellPrice} VES`,
        });

        const sellData = sellRes.result as PublishToolResult | null;

        if (!sellRes.success || sellData?.success === false) {
          const err = sellData?.error || sellRes.error || 'Rechazo de seguridad en anuncio de venta';
          this.lastRejectionError.set(err);
          this.toast.error(err, 'Guardarraíl de Publicación MCP');
          await this.recordPublishAttempt({
            side: 'SELL',
            decisionId: request.decisionIds?.['SELL'],
            success: false,
            detail: `Rechazo del publicador MCP: ${err}`,
            outcome: { merchantRef: null, merchantConfirmed: false, localReceipt: null },
          });
          return false;
        }

        const sellOutcome = this.judgeResponse(sellData);
        if (sellOutcome.merchantConfirmed) {
          this.lastPublishedSignature.set(sellOutcome.merchantRef);
        }
        this.lastSellPrice = request.sellPrice;
        await this.recordPublishAttempt({
          side: 'SELL',
          decisionId: request.decisionIds?.['SELL'],
          success: true,
          outcome: sellOutcome,
        });
      }

      this.lastPublishTimestamp.set(new Date().toISOString());
      this.successfulPublishesCount.update((c) => c + 1);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastRejectionError.set(msg);
      this.toast.error(`Error de ejecución en MCP Ad Automaker: ${msg}`, 'Error de Publicación');
      // Un throw también es un intento fallido, y es el único rastro que queda:
      // acá no se incrementa el contador, así que sin esta fila el fallo sería
      // invisible. Solo se atribuye al lado que se estaba intentando.
      if (attemptedSide) {
        await this.recordPublishAttempt({
          side: attemptedSide,
          decisionId:
            attemptedSide === 'BUY' ? request.decisionIds?.['BUY'] : request.decisionIds?.['SELL'],
          success: false,
          detail: `Error de ejecución en MCP Ad Automaker: ${msg}`,
          outcome: { merchantRef: null, merchantConfirmed: false, localReceipt: null },
        });
      }
      return false;
    }
  }

  /**
   * Decide qué se puede AFIRMAR de la respuesta de `publish_ad_price`.
   *
   * Acá estaba el bug: el origen y la referencia se escribían fijos, sin mirar
   * lo que volvió la llamada. Con `dryRun` activo (el default) o en build web, la
   * respuesta es de un simulador, y la fila decía igual "Binance confirmó esto,
   * ref SIG-AD-xxxx".
   *
   * Las tres condiciones son necesarias y ninguna alcanza sola:
   *
   *  1. `merchantConfirmed === true` — afirmación explícita de la capa de
   *     escritura. `publish_ad_price` devuelve `false` siempre, porque es una
   *     función pura; hoy esta rama no se recorre en producción, y por eso el
   *     journal no depende de ella para ser honesto.
   *  2. La respuesta no viene marcada como `simulated`. En build web
   *     `simulateMcpTool` devuelve `simulated: true` con `status:
   *     'PUBLISHED_LIVE'` y `dryRun: false`: si el status fuera la evidencia,
   *     el build web mentiría. La marca de simulación le gana al status.
   *  3. Hay una referencia REAL, y no un `SIG-AD-...` fabricado con
   *     `Date.now()`.
   *
   * El recibo local se devuelve igual: se pierde la evidencia si se tira, pero
   * se conserva en el `detail`, que es donde un humano lo lee sin confundirlo
   * con un comprobante del exchange.
   */
  private judgeResponse(data: PublishToolResult | null): PublishOutcome {
    const signature = data?.auditTrail?.signature ?? null;
    const localReceipt = signature;

    // La referencia del exchange, si la capa de escritura la trajo. Se prefiere
    // `merchantRef` explícito; `signature` sirve para una implementación que no
    // lo mande, siempre que no tenga la forma del recibo fabricado.
    const candidate = data?.auditTrail?.merchantRef ?? signature;
    const isSynthetic = candidate === null || candidate.startsWith(SYNTHETIC_SIGNATURE_PREFIX);
    const merchantRef = isSynthetic ? null : candidate;

    const assertedConfirmation =
      data?.merchantConfirmed === true && data?.simulated !== true && !this.isDryRun();

    return {
      merchantRef,
      // La referencia NO es decorativa: sin ella, "Binance confirmó" no
      // señala nada que se pueda auditar, así que no se afirma.
      merchantConfirmed: assertedConfirmation && merchantRef !== null,
      localReceipt,
    };
  }

  /**
   * `detail` del outcome, escrito para que la fila se sostenga sola.
   *
   * Un lector sin el código al lado tiene que poder distinguir "el guardarraíl
   * aceptó el precio" de "el precio quedó publicado en un anuncio de Binance".
   */
  private buildDetail(attempt: { readonly success: boolean; readonly outcome: PublishOutcome }): string {
    if (!attempt.success) {
      return attempt.outcome.localReceipt
        ? `Rechazo del publicador MCP. Recibo local: ${attempt.outcome.localReceipt}`
        : 'Rechazo del publicador MCP.';
    }
    if (attempt.outcome.merchantConfirmed) {
      return `${PUBLISH_ACCEPTED_DETAIL} Confirmado por el merchant de Binance (ref ${attempt.outcome.merchantRef}).`;
    }
    return attempt.outcome.localReceipt
      ? `${PUBLISH_ACCEPTED_DETAIL} Ejecución simulada: no se contactó al merchant de Binance ni se publicó el anuncio. Recibo local (no es referencia del exchange): ${attempt.outcome.localReceipt}.`
      : `${PUBLISH_ACCEPTED_DETAIL} Ejecución simulada: no se contactó al merchant de Binance ni se publicó el anuncio.`;
  }

  /**
   * Escribe UN outcome por intento de publicación.
   *
   * ── Sobre qué significa "resultado" acá ────────────────────────────────────
   *
   * Un publish NO es un trade llenado. Publicar un anuncio a precio X significa
   * "pedí un precio", no "vendi a X". El cierre real del trade llega después, por
   * polling de Binance. Por lo tanto esta fila registra el RESULTADO DEL
   * INTENTO —aceptado o rechazado— y no una operación realizada. Eso fija qué
   * puede y qué no puede ir en los campos:
   *
   *  - `success`        → el intento fue aceptado (`true`) o rechazado (`false`).
   *  - `filledAmountUsdt: 0` → correcto: no hay fill confirmado.
   *  - `filledPrice`, `realizedSpreadPct`, `realizedProfitUsdt` → SE OMITEN, y
   *    el contrato los materializa como `null` ("nadie reportó"). Escribirlos en
   *    `0` produciría un journal que afirma "0% de spread realizado" sobre un
   *    trade que todavía no existe: exactamente la mentira que se corrigió en la
   *    agregación de core, reintroducida por el otro lado. `0` es un spread
   *    realizado plausible, así que un consumidor no puede distinguir "no
   *    llenamos nada" de "no llenamos nada Y el journal inventó un 0%".
   *
   * ── Lo que esta fila cambia en las métricas ────────────────────────────────
   *
   * `getVerificationSummary.verifiedDecisions` cuenta decisiones con al menos un
   * outcome. A partir de este cambio, eso significa "tiene al menos un intento
   * registrado", NO "tiene un trade realizado". Cuando llegue la verificación de
   * fills, la métrica cambiará de significado y habrá que decidir si se separa en
   * dos. Está anotado acá porque este es el punto donde la decisión se crea, no
   * porque sea una nota de changelog.
   *
   * NUNCA propaga el error: un journal que no puede escribir no puede tumbar la
   * publicación. Misma política que el repricer.
   */
  private async recordPublishAttempt(attempt: {
    readonly side: DecisionSide;
    readonly decisionId: number | undefined;
    readonly success: boolean;
    readonly detail?: string;
    readonly outcome: PublishOutcome;
  }): Promise<void> {
    const detail = attempt.detail ?? this.buildDetail(attempt);

    // Sin decisión journalizada no hay a qué colgar el outcome, y
    // `decision_outcomes.decision_id` es una FK dura. Un id inventado no
    // agruparía nada; lo honesto es publicar sin registrar.
    //
    // ── Por qué esto NO puede volver a ser un `return` mudo ────────────────
    //
    // Este return cortaba ANTES de la rama que avisa, y esa era exactamente la
    // parte rota. El motor devuelve `{BUY: id}` aunque `appendDecision('SELL')`
    // falle, así que el SELL sale con `decisionId === undefined`: un anuncio
    // realmente publicado, sin outcome, sin warn y sin toast. El criterio "nada
    // se pierde en silencio" se incumplía justo donde más caro sale.
    //
    // NO se aborta la publicación. Un fallo de auditoría no es motivo para
    // dejar de operar —la decisión ya se tomó y el anuncio ya se tocó—, pero sí
    // es motivo para que quede escrito a qué anuncio corresponde este hueco.
    if (attempt.decisionId === undefined) {
      const adId = attempt.side === 'BUY' ? this.buyAdId() : this.sellAdId();
      console.error(
        `[mcp-ad-publisher] Publicación ${attempt.success ? 'aceptada' : 'rechazada'} SIN REGISTRAR ` +
          `(lado ${attempt.side}, anuncio ${adId}, exchange ${this.exchange()}, dryRun=${this.isDryRun()}). ` +
          `El motor no pudo escribir la decisión padre (appendDecision falló o no hubo correlación), ` +
          `así que no hay decision_id al que colgar el outcome y esta publicación queda sin auditoría. ` +
          `No se frena la publicación a propósito: revisar la escritura de decisiones del repricer.`,
      );
      return;
    }

    const journal = this.journal;
    if (!journal) {
      this.warnJournalNotWired();
      return;
    }

    try {
      await journal.appendOutcome({
        decisionId: attempt.decisionId,
        // El origen se DERIVA de la evidencia de la respuesta, no se fija acá.
        //
        // `LOCAL_SIGNAL` es el valor correcto para todo lo que no venga del
        // merchant de Binance: el resultado lo produjo esta máquina. Y ya existe
        // en el union `OutcomeSource`, así que este fix no agrega nada al
        // contrato de la tabla ni obliga a tocar core, `schema.sql` y el
        // adapter de SQLite a la vez.
        //
        // Antes esto era `'BINANCE_MERCHANT'` fijo, y el journal afirmaba una
        // confirmación del exchange sobre una llamada que nunca salió de la
        // máquina: con dry-run activo (el default) o en cualquier build web, una
        // simulación quedaba etiquetada como si Binance la hubiera confirmado.
        source: attempt.outcome.merchantConfirmed ? 'BINANCE_MERCHANT' : 'LOCAL_SIGNAL',
        success: attempt.success,
        filledAmountUsdt: 0,
        // Solo una referencia real del exchange entra acá. Una firma `SIG-AD-`
        // fabricada con `Date.now()` sería un comprobante falso colgado de una
        // fila de auditoría, que es peor que no tener referencia.
        externalRef: attempt.outcome.merchantRef ?? undefined,
        detail,
        // `filledPrice`, `realizedSpreadPct` y `realizedProfitUsdt` NO se mandan:
        // su ausencia ES el dato. Ver el comentario de arriba antes de "arreglarlo".
      });
    } catch (err: unknown) {
      const errDetail = err instanceof Error ? err.message : String(err);
      console.error(
        `[mcp-ad-publisher] No se pudo registrar el outcome de publicación (lado ${attempt.side}, success=${attempt.success}): ${errDetail}. El anuncio ya se intentó publicar igual.`,
        err,
      );
    }
  }

  /** Avisa UNA vez que los intentos no se están auditando, sin tapar el log real. */
  private warnJournalNotWired(): void {
    if (this.journalWarningShown) return;
    this.journalWarningShown = true;
    console.warn(
      '[mcp-ad-publisher] DecisionJournalService no está cableado: los intentos de publicación no se están auditando.',
    );
  }
}
