import { Injectable, inject, signal, computed } from '@angular/core';
import { McpService } from './mcp.service';
import { ToastService } from './toast.service';
import {
  registerRepricerPublisher,
  unregisterRepricerPublisher,
  type RepricerAdPublisher,
  type RepricerPublishRequest,
} from './binance-repricer.service';

export interface McpPublisherConfig {
  dryRun?: boolean;
  maxDeviationPct?: number;
  buyAdId?: string;
  sellAdId?: string;
  exchange?: 'BINANCE_P2P' | 'BYBIT_P2P';
}

@Injectable({
  providedIn: 'root',
})
export class McpAdPublisherService implements RepricerAdPublisher {
  private readonly mcp = inject(McpService);
  private readonly toast = inject(ToastService);

  readonly isEnabled = signal<boolean>(false);
  readonly isDryRun = signal<boolean>(true);
  readonly maxDeviationPct = signal<number>(3.0);
  readonly buyAdId = signal<string>('BINANCE-BUY-ADV-01');
  readonly sellAdId = signal<string>('BINANCE-SELL-ADV-01');
  readonly exchange = signal<'BINANCE_P2P' | 'BYBIT_P2P'>('BINANCE_P2P');

  readonly lastPublishedSignature = signal<string | null>(null);
  readonly lastPublishTimestamp = signal<string | null>(null);
  readonly lastRejectionError = signal<string | null>(null);
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
   */
  async publish(request: RepricerPublishRequest): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    this.lastRejectionError.set(null);

    try {
      // 1. Publish BUY ad price through MCP guardrails
      if (request.buyPrice > 0) {
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
          return false;
        }

        if (buyData?.auditTrail?.signature) {
          this.lastPublishedSignature.set(buyData.auditTrail.signature);
        }
        this.lastBuyPrice = request.buyPrice;
      }

      // 2. Publish SELL ad price through MCP guardrails
      if (request.sellPrice > 0) {
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
          return false;
        }

        if (sellData?.auditTrail?.signature) {
          this.lastPublishedSignature.set(sellData.auditTrail.signature);
        }
        this.lastSellPrice = request.sellPrice;
      }

      this.lastPublishTimestamp.set(new Date().toISOString());
      this.successfulPublishesCount.update((c) => c + 1);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastRejectionError.set(msg);
      this.toast.error(`Error de ejecución en MCP Ad Automaker: ${msg}`, 'Error de Publicación');
      return false;
    }
  }
}
