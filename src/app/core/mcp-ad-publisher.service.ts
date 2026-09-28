import { Injectable, inject, signal, computed } from '@angular/core';
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
 * `detail` de un intento aceptado.
 *
 * Dice explícitamente que no hay fill, para que la fila se sostenga sola cuando
 * alguien la lea sin el código al lado. Un `detail` vacío dejaría al consumidor
 * adivinar si el 0 de `filledAmountUsdt` significa "no llenó" o "no se midió".
 */
const PUBLISH_ACCEPTED_DETAIL = 'Intento de publicación aceptado; sin fill confirmado.';

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
    registerRepricerPublisher(this);

    const mode = this.isDryRun() ? 'SIMULACIÓN (Dry-Run)' : 'PRODUCCIÓN EN VIVO';
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

        const buyData = buyRes.result as {
          success?: boolean;
          error?: string;
          auditTrail?: { signature?: string };
        } | null;

        if (!buyRes.success || buyData?.success === false) {
          const err = buyData?.error || buyRes.error || 'Rechazo de seguridad en anuncio de compra';
          this.lastRejectionError.set(err);
          this.toast.error(err, 'Guardarraíl de Publicación MCP');
          await this.recordPublishAttempt({
            side: 'BUY',
            decisionId: request.decisionIds?.['BUY'],
            success: false,
            detail: `Rechazo del publicador MCP: ${err}`,
            externalRef: null,
          });
          return false;
        }

        if (buyData?.auditTrail?.signature) {
          this.lastPublishedSignature.set(buyData.auditTrail.signature);
        }
        this.lastBuyPrice = request.buyPrice;
        await this.recordPublishAttempt({
          side: 'BUY',
          decisionId: request.decisionIds?.['BUY'],
          success: true,
          detail: PUBLISH_ACCEPTED_DETAIL,
          externalRef: buyData?.auditTrail?.signature ?? null,
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

        const sellData = sellRes.result as {
          success?: boolean;
          error?: string;
          auditTrail?: { signature?: string };
        } | null;

        if (!sellRes.success || sellData?.success === false) {
          const err = sellData?.error || sellRes.error || 'Rechazo de seguridad en anuncio de venta';
          this.lastRejectionError.set(err);
          this.toast.error(err, 'Guardarraíl de Publicación MCP');
          await this.recordPublishAttempt({
            side: 'SELL',
            decisionId: request.decisionIds?.['SELL'],
            success: false,
            detail: `Rechazo del publicador MCP: ${err}`,
            externalRef: null,
          });
          return false;
        }

        if (sellData?.auditTrail?.signature) {
          this.lastPublishedSignature.set(sellData.auditTrail.signature);
        }
        this.lastSellPrice = request.sellPrice;
        await this.recordPublishAttempt({
          side: 'SELL',
          decisionId: request.decisionIds?.['SELL'],
          success: true,
          detail: PUBLISH_ACCEPTED_DETAIL,
          externalRef: sellData?.auditTrail?.signature ?? null,
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
          externalRef: null,
        });
      }
      return false;
    }
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
    readonly detail: string;
    readonly externalRef: string | null;
  }): Promise<void> {
    // Sin decisión journalizada no hay a qué colgar el outcome, y
    // `decision_outcomes.decision_id` es una FK dura. Un id inventado no
    // agruparía nada; lo honesto es publicar sin registrar.
    if (attempt.decisionId === undefined) {
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
        source: 'BINANCE_MERCHANT',
        success: attempt.success,
        filledAmountUsdt: 0,
        externalRef: attempt.externalRef ?? undefined,
        detail: attempt.detail,
        // `filledPrice`, `realizedSpreadPct` y `realizedProfitUsdt` NO se mandan:
        // su ausencia ES el dato. Ver el comentario de arriba antes de "arreglarlo".
      });
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(
        `[mcp-ad-publisher] No se pudo registrar el outcome de publicación (lado ${attempt.side}, success=${attempt.success}): ${detail}. El anuncio ya se intentó publicar igual.`,
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
