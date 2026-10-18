import { Injectable, inject, signal, computed } from '@angular/core';
import { BinanceP2pService } from './binance-p2p.service';
import { AccountsService } from './accounts.service';
import { McpAdPublisherService } from './mcp-ad-publisher.service';
import { ToastService } from './toast.service';
import {
  composeAdDraft,
  BUILT_IN_TEMPLATES,
  generateAdPreview,
  validateAd,
  roundMoney,
  type AdTemplate,
  type StagedAdDraft,
  type BankAccountProfile,
  type RepricerStrategy,
} from '@p2p/core';

export interface ExternalAdStageParams {
  side: 'BUY' | 'SELL';
  customPriceVes?: number;
  breakEvenSellPrice?: number;
  maxBuyPrice?: number;
  targetAssetAmountUsdt?: number;
  minTicketUsdt?: number;
  preferredBank?: string | null;
  sourceLabel?: string;
}

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
  readonly useCustomPrice = signal<boolean>(false);
  readonly customPriceVes = signal<number>(0);
  readonly stepVes = signal<number>(0.05);
  readonly minTicketUsdt = signal<number>(25);
  /** 0 = Usar 100% del cupo disponible en la cuenta bancaria seleccionada */
  readonly targetAssetAmountUsdt = signal<number>(0);
  readonly makerFeePct = signal<number>(0.25);
  readonly breakEvenSellPrice = signal<number>(0);
  readonly maxBuyPrice = signal<number>(0);
  readonly preferredBank = signal<string | null>(null);
  readonly selectedTemplateName = signal<string>('');
  readonly editableTerms = signal<string>('');
  readonly editableAutoReply = signal<string>('');
  readonly lastExternalSource = signal<string | null>(null);
  readonly copiedFieldKey = signal<string | null>(null);

  readonly currentDraft = signal<StagedAdDraft | null>(null);
  readonly isComposing = signal<boolean>(false);
  readonly isPublishing = signal<boolean>(false);
  readonly lastComposedAt = signal<Date | null>(null);

  readonly availableTemplates = computed(() =>
    BUILT_IN_TEMPLATES.filter((t) => t.type === this.side()),
  );

  readonly activeBankOptions = computed(() =>
    this.accounts
      .usages()
      .filter((u) => u.account.status !== 'DISABLED')
      .map((u) => ({
        bankName: u.account.bankName,
        alias: u.account.accountNumberMasked,
        remainingVes: u.remainingLimitVes,
        dailyLimitVes: u.account.dailyLimitVes,
        isNearLimit: u.isNearLimit,
        isOverLimit: u.isOverLimit,
      })),
  );

  readonly liveValidation = computed(() => {
    const d = this.currentDraft();
    const title = d?.adTitle ?? 'Anuncio P2P USDT';
    const terms = this.editableTerms() || d?.terms || '';
    const reply = this.editableAutoReply() || d?.autoReply || '';
    return validateAd(title, terms, reply);
  });

  readonly mirrorCyclePreview = computed(() => {
    const d = this.currentDraft();
    if (!d || d.price <= 0 || d.oppositeBestPrice <= 0) return null;
    const buyPrice = d.side === 'BUY' ? d.price : d.oppositeBestPrice;
    const sellPrice = d.side === 'SELL' ? d.price : d.oppositeBestPrice;
    const spreadVes = roundMoney(sellPrice - buyPrice, 2);
    const grossSpreadPct = buyPrice > 0 ? roundMoney((spreadVes / buyPrice) * 100, 2) : 0;
    const netSpreadPct = roundMoney(grossSpreadPct - this.makerFeePct() * 2, 2);
    const netProfitUsdt = roundMoney(d.totalAssetAmountUsdt * (netSpreadPct / 100), 2);
    const netProfitVes = roundMoney(netProfitUsdt * sellPrice, 2);
    return {
      buyPrice,
      sellPrice,
      spreadVes,
      grossSpreadPct,
      netSpreadPct,
      netProfitUsdt,
      netProfitVes,
    };
  });

  readonly readyToPublish = computed(() => {
    const d = this.currentDraft();
    if (!d) return false;
    return d.readyToPublish && this.liveValidation().valid;
  });

  setSide(newSide: 'BUY' | 'SELL'): void {
    this.side.set(newSide);
    const matching = BUILT_IN_TEMPLATES.filter((t) => t.type === newSide);
    if (matching.length > 0) {
      this.selectedTemplateName.set(matching[0].name);
    }
  }

  applyTemplate(templateName: string): void {
    this.selectedTemplateName.set(templateName);
    const d = this.currentDraft();
    const tpl = BUILT_IN_TEMPLATES.find((t) => t.name === templateName);
    if (d && tpl) {
      const rendered = generateAdPreview(tpl as AdTemplate, {
        precio: d.price,
        spread: d.expectedNetSpreadPct,
        limiteMin: d.minLimitVes,
        limiteMax: d.maxLimitVes,
        banco: d.selectedBank,
        metodoPago: d.paymentMethods.join(', '),
        usuario: 'Operador P2P Verificado',
        referencia: 'Pago Móvil / Titular Directo',
      });
      this.editableTerms.set(rendered.terms);
      this.editableAutoReply.set(rendered.autoReply);
    }
  }

  /**
   * Hydrates the Ad Studio from external tools (Income Calculator or Break-Even Cockpit)
   * and immediately composes the staged ad draft.
   */
  async stageFromExternal(params: ExternalAdStageParams): Promise<StagedAdDraft | null> {
    this.setSide(params.side);
    if (params.customPriceVes && params.customPriceVes > 0) {
      this.useCustomPrice.set(true);
      this.customPriceVes.set(roundMoney(params.customPriceVes, 2));
    } else {
      this.useCustomPrice.set(false);
    }
    if (params.breakEvenSellPrice !== undefined && params.breakEvenSellPrice > 0) {
      this.breakEvenSellPrice.set(roundMoney(params.breakEvenSellPrice, 2));
    }
    if (params.maxBuyPrice !== undefined && params.maxBuyPrice > 0) {
      this.maxBuyPrice.set(roundMoney(params.maxBuyPrice, 2));
    }
    if (params.targetAssetAmountUsdt !== undefined && params.targetAssetAmountUsdt >= 0) {
      this.targetAssetAmountUsdt.set(roundMoney(params.targetAssetAmountUsdt, 2));
    }
    if (params.minTicketUsdt !== undefined && params.minTicketUsdt > 0) {
      this.minTicketUsdt.set(roundMoney(params.minTicketUsdt, 2));
    }
    if (params.preferredBank !== undefined) {
      this.preferredBank.set(params.preferredBank);
    }
    if (params.sourceLabel) {
      this.lastExternalSource.set(params.sourceLabel);
    }
    return this.composeDraft();
  }

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
          'Estudio de Anuncios P2P',
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
        targetAssetAmountUsdt:
          this.targetAssetAmountUsdt() > 0 ? this.targetAssetAmountUsdt() : undefined,
        customPriceVes:
          this.useCustomPrice() && this.customPriceVes() > 0 ? this.customPriceVes() : undefined,
        makerFeePct: this.makerFeePct(),
        templateName: this.selectedTemplateName() || undefined,
        merchantName: 'Operador P2P Verificado',
      });

      this.currentDraft.set(draft);
      this.selectedTemplateName.set(draft.templateName);
      this.editableTerms.set(draft.terms);
      this.editableAutoReply.set(draft.autoReply);
      this.lastComposedAt.set(new Date());

      if (draft.readyToPublish) {
        this.toast.success(
          `Anuncio ${draft.side} armado a ${draft.priceFormatted} (Puesto #${draft.queueRank} · ${draft.selectedBank}).`,
          'Estudio de Anuncios P2P',
        );
      } else {
        this.toast.warn(
          `Borrador con advertencias de seguridad: ${draft.guardrails.flags.join(', ')}`,
          'Estudio de Anuncios P2P',
        );
      }

      return draft;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.toast.error(`Error al componer anuncio: ${msg}`, 'Estudio de Anuncios P2P');
      return null;
    } finally {
      this.isComposing.set(false);
    }
  }

  /**
   * Surgical 1-Click Copy of any single ad parameter (Price, USDT Amount, Min/Max VES, Terms, Auto-Reply).
   */
  async copyField(key: string, label: string, value: string | number): Promise<void> {
    const strVal = typeof value === 'number' ? value.toFixed(2) : String(value);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(strVal);
        this.copiedFieldKey.set(key);
        setTimeout(() => {
          if (this.copiedFieldKey() === key) {
            this.copiedFieldKey.set(null);
          }
        }, 1800);
        this.toast.info(`${label} copiado al portapapeles.`, 'Copiado Quirúrgico P2P');
      } catch {
        this.toast.error(`No se pudo copiar ${label}.`, 'Portapapeles');
      }
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

    const validation = this.liveValidation();
    if (!validation.valid) {
      this.toast.error(
        `Validación TOS fallida: ${validation.errors.join(' | ')}`,
        'Escudo Anti-Ban Binance',
      );
      return false;
    }

    if (!draft.readyToPublish) {
      let detailMsg = 'Falla en guardarraíles de seguridad';
      if (draft.guardrails.flags.includes('INVERTED_OR_ZERO_SPREAD')) {
        detailMsg = `Spread negativo (${draft.expectedNetSpreadPct}%). El sistema jamás publicará un anuncio a pérdida.`;
      } else if (draft.guardrails.flags.includes('NO_ACTIVE_BANK_CAPACITY')) {
        detailMsg =
          'Tus cuentas bancarias activas alcanzaron el límite diario o no tienen cupo disponible.';
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
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          try {
            await navigator.clipboard.writeText(this.getClipboardSummary());
          } catch {
            // ignore clipboard errors
          }
        }

        this.openBinanceAdvPost();

        const modeStr = this.publisher.isDryRun() ? '(Simulación Dry-Run)' : '(En Vivo)';
        this.toast.success(
          `¡Anuncio ${draft.side} preparado a ${draft.priceFormatted} ${modeStr}! Abriendo Binance P2P con ficha completa copiada.`,
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
    const terms = this.editableTerms() || d.terms;
    const reply = this.editableAutoReply() || d.autoReply;
    return [
      `--- ANUNCIO P2P (${d.side} USDT) ---`,
      `Precio: ${d.priceFormatted} (Puesto #${d.queueRank} en libro)`,
      `Límites: ${d.minLimitVes.toLocaleString('es-VE')} VES - ${d.maxLimitVes.toLocaleString('es-VE')} VES`,
      `Monto Total: ${d.totalAssetAmountUsdt.toFixed(2)} USDT`,
      `Métodos: ${d.paymentMethods.join(' / ')} (${d.selectedBank})`,
      `Margen Bruto: +${d.expectedNetSpreadPct}% | Neto post-comisión: +${d.netSpreadAfterFeePct}% (+$${d.expectedNetProfitUsdtPerCycle.toFixed(2)} USDT)`,
      `\n--- TÉRMINOS Y CONDICIONES ---\n${terms}`,
      `\n--- AUTO-REPLY ---\n${reply}`,
    ].join('\n');
  }
}
