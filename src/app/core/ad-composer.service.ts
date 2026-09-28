import { Injectable, inject, signal, computed } from '@angular/core';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import { McpAdPublisherService } from './mcp-ad-publisher.service';
import { ToastService } from './toast.service';
import {
  composeAdDraft,
  type StagedAdDraft,
  type BankAccountProfile,
  type RepricerStrategy,
} from '@p2p/core';

@Injectable({
  providedIn: 'root',
})
export class AdComposerService {
  private readonly binance = inject(BinanceP2pService);
  private readonly accounts = inject(AccountsService);
  private readonly publisher = inject(McpAdPublisherService);
  private readonly toast = inject(ToastService);

  readonly side = signal<'BUY' | 'SELL'>('BUY');
  readonly strategy = signal<RepricerStrategy>('TOP_1');
  readonly stepVes = signal<number>(0.05);
  readonly minTicketUsdt = signal<number>(25);
  readonly breakEvenSellPrice = signal<number>(0);
  readonly maxBuyPrice = signal<number>(0);
  readonly preferredBank = signal<string | null>(null);

  readonly currentDraft = signal<StagedAdDraft | null>(null);
  readonly isComposing = signal<boolean>(false);
  readonly isPublishing = signal<boolean>(false);
  readonly lastComposedAt = signal<Date | null>(null);

  readonly readyToPublish = computed(() => this.currentDraft()?.readyToPublish ?? false);

  /**
   * Reads live market depth and bank accounts, automatically composing the optimized ad draft.
   */
  async composeDraft(): Promise<StagedAdDraft | null> {
    this.isComposing.set(true);

    try {
      const depth = await this.binance.fetchMarketDepth('USDT', 'VES');
      if (!depth) {
        this.toast.warn(
          'No se pudo obtener la profundidad de Binance P2P. Verificá tu conexión.',
          'Generador de Anuncios',
        );
        return null;
      }

      // Map active accounts and daily limits from AccountsService
      const bankProfiles: BankAccountProfile[] = this.accounts.accounts().map((acc) => {
        const usage = this.accounts.usages().find((u) => u.account.id === acc.id);
        const currentVolumeVes = usage?.spentTodayVes ?? 0;
        const status: 'ACTIVE' | 'WARNING' | 'FROZEN_TODAY' | 'DISABLED' =
          acc.status === 'DISABLED'
            ? 'DISABLED'
            : usage?.isOverLimit
            ? 'FROZEN_TODAY'
            : usage?.isNearLimit
            ? 'WARNING'
            : 'ACTIVE';

        return {
          bankName: acc.bankName,
          accountNumber: acc.accountNumberMasked,
          dailyLimitVes: acc.dailyLimitVes,
          currentVolumeVes,
          status,
          isPagoMovil: acc.rail === 'PAGO_MOVIL' || acc.rail === 'MIXTO',
        };
      });

      const draft = composeAdDraft({
        side: this.side(),
        marketDepth: depth,
        strategy: this.strategy(),
        stepVes: this.stepVes(),
        breakEvenSellPrice: this.breakEvenSellPrice(),
        maxBuyPrice: this.maxBuyPrice(),
        activeBankAccounts: bankProfiles,
        preferredBankName: this.preferredBank() ?? undefined,
        minTicketUsdt: this.minTicketUsdt(),
        merchantName: 'Operador P2P Verificado',
      });

      this.currentDraft.set(draft);
      this.lastComposedAt.set(new Date());

      if (draft.readyToPublish) {
        this.toast.success(
          `Borrador de anuncio ${draft.side} generado a ${draft.priceFormatted} (${draft.selectedBank}). Listo para publicar.`,
          'Generador de Anuncios',
        );
      } else {
        this.toast.warn(
          `Borrador generado con advertencias de seguridad: ${draft.guardrails.flags.join(', ')}`,
          'Generador de Anuncios',
        );
      }

      return draft;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.toast.error(`Error al componer anuncio: ${msg}`, 'Generador de Anuncios');
      return null;
    } finally {
      this.isComposing.set(false);
    }
  }

  /**
   * One-Click Publish: dispatches the staged draft to Binance P2P via McpAdPublisherService.
   */
  async publishStagedDraft(): Promise<boolean> {
    const draft = this.currentDraft();
    if (!draft) {
      this.toast.error('No hay ningún borrador de anuncio generado.', 'Publicación 1-Clic');
      return false;
    }

    if (!draft.readyToPublish) {
      let detailMsg = 'Falla en guardarraíles de seguridad';
      if (draft.guardrails.flags.includes('INVERTED_OR_ZERO_SPREAD')) {
        detailMsg = `Spread negativo (${draft.expectedNetSpreadPct}%). El sistema jamás publicará un anuncio a pérdida.`;
      } else if (draft.guardrails.flags.includes('NO_ACTIVE_BANK_CAPACITY')) {
        detailMsg = 'Tus cuentas bancarias activas alcanzaron el límite diario o no tienen cupo disponible.';
      } else if (draft.guardrails.flags.includes('NO_REPUTABLE_COMPETITORS_FOUND')) {
        detailMsg = 'No hay competidores confiables en el libro (>90% finalización).';
      }
      this.toast.error(`No se puede publicar: ${detailMsg}`, 'Guardarraíl de Publicación');
      return false;
    }

    this.isPublishing.set(true);

    try {
      // Ensure publisher is enabled (defaults to dryRun if not already configured)
      if (!this.publisher.isEnabled()) {
        this.publisher.enablePublishing({
          dryRun: this.publisher.isDryRun(),
          maxDeviationPct: this.publisher.maxDeviationPct(),
        });
      }

      const success = await this.publisher.publish({
        buyPrice: draft.side === 'BUY' ? draft.price : 0,
        sellPrice: draft.side === 'SELL' ? draft.price : 0,
        strategy: this.strategy(),
      });

      if (success) {
        // Auto-copy ad parameters to clipboard for instant pasting
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          try {
            await navigator.clipboard.writeText(this.getClipboardSummary());
          } catch {
            // ignore clipboard errors
          }
        }

        // Open Binance P2P Ad Post in browser
        this.openBinanceAdvPost();

        const modeStr = this.publisher.isDryRun() ? '(Simulación Dry-Run)' : '(En Vivo)';
        this.toast.success(
          `¡Anuncio ${draft.side} preparado a ${draft.priceFormatted} ${modeStr}! Abriendo Binance P2P con datos copiados al portapapeles.`,
          'Publicación 1-Clic',
        );
      }

      return success;
    } finally {
      this.isPublishing.set(false);
    }
  }

  /**
   * Opens Binance P2P advertisement posting page in browser.
   */
  openBinanceAdvPost(): void {
    if (typeof window !== 'undefined') {
      window.open('https://p2p.binance.com/es-LA/advPost', '_blank');
    }
  }

  /**
   * Formats the complete ad draft ready for quick clipboard copying.
   */
  getClipboardSummary(): string {
    const d = this.currentDraft();
    if (!d) return '';
    return [
      `--- ANUNCIO P2P (${d.side} USDT) ---`,
      `Precio: ${d.priceFormatted}`,
      `Límites: ${d.minLimitVes.toLocaleString('es-VE')} VES - ${d.maxLimitVes.toLocaleString('es-VE')} VES`,
      `Monto Total: ${d.totalAssetAmountUsdt.toFixed(2)} USDT`,
      `Métodos: ${d.paymentMethods.join(' / ')} (${d.selectedBank})`,
      `Margen Estimado: +${d.expectedNetSpreadPct}% (+${d.expectedProfitVesPerCycle.toLocaleString('es-VE')} VES)`,
      `\n--- TÉRMINOS Y CONDICIONES ---\n${d.terms}`,
      `\n--- AUTO-REPLY ---\n${d.autoReply}`,
    ].join('\n');
  }
}
