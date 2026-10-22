import {
  Component,
  signal,
  computed,
  inject,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  DEFAULT_REMITTANCE_CORRIDORS,
  calculateRemittanceQuote,
  formatRemittanceWhatsAppMessage,
  convertUsdVes,
  type RemittanceCorridorConfig,
  type RemittanceQuoteResult,
  type UsdVesDirection,
  type UsdVesConversionResult,
  type UsdVesConversionLine,
} from '@p2p/core';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { CotizaveService } from '../../core/cotizave.service';
import { ToastService } from '../../core/toast.service';

export type RemittanceViewTab = 'USD_VES_DUAL' | 'CORRIDORS';

@Component({
  selector: 'app-remittances',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './remittances.component.html',
  styleUrls: ['./remittances.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RemittancesComponent {
  private readonly binanceService = inject(BinanceP2pService);
  private readonly cotizaveService = inject(CotizaveService, { optional: true });
  private readonly toast = inject(ToastService);

  // ─── Active Tab ─────────────────────────────────────────────────────────────
  readonly activeTab = signal<RemittanceViewTab>('USD_VES_DUAL');

  // ─── USD ⇄ VES Dual Converter State ─────────────────────────────────────────
  readonly usdVesDirection = signal<UsdVesDirection>('USD_TO_VES');
  readonly usdVesAmount = signal<number>(100);
  readonly usdVesDeskMarginPct = signal<number>(2.5);
  readonly usdVesCustomBcvRate = signal<number | null>(null);
  readonly usdVesCustomP2pRate = signal<number | null>(null);
  readonly usdVesCopied = signal<boolean>(false);

  readonly usdQuickAmounts: readonly number[] = [20, 50, 100, 200, 500, 1000];
  readonly vesQuickAmounts: readonly number[] = [1000, 2500, 5000, 10000, 25000, 50000];

  // ─── Multicurrency Corridor Remittances State ───────────────────────────────
  readonly corridors = DEFAULT_REMITTANCE_CORRIDORS;
  readonly selectedCorridorId = signal<string>(DEFAULT_REMITTANCE_CORRIDORS[0].id);
  readonly calculationMode = signal<'BY_SEND_AMOUNT' | 'BY_RECEIVE_AMOUNT'>('BY_SEND_AMOUNT');

  readonly inputAmount = signal<number>(500000);
  readonly originCryptoRate = signal<number>(DEFAULT_REMITTANCE_CORRIDORS[0].typicalOriginCryptoRate);
  readonly destCryptoRate = signal<number>(98.50);
  readonly operatorMarginPct = signal<number>(2.5);
  readonly bankingFeePct = signal<number>(DEFAULT_REMITTANCE_CORRIDORS[0].defaultBankingFeePct);
  readonly bankingFixedFee = signal<number>(DEFAULT_REMITTANCE_CORRIDORS[0].defaultBankingFixedFee);

  readonly deskName = signal<string>('Mesa P2P Caracas');
  readonly contactNumber = signal<string>('');
  readonly validityMinutes = signal<number>(15);
  readonly copied = signal<boolean>(false);

  constructor() {
    // Proactively refresh official BCV rates if stale
    void this.cotizaveService?.refreshIfStale();

    // Bind live Binance P2P VES rate to whichever side of the corridor is VES.
    try {
      effect(() => {
        const depth = this.binanceService.marketDepth();
        const corridor = this.activeCorridor();
        if (!depth) return;
        if (corridor.destCurrency === 'VES' && depth.bestSellPrice > 0) {
          this.destCryptoRate.set(depth.bestSellPrice);
        } else if (corridor.originCurrency === 'VES' && depth.bestBuyPrice > 0) {
          this.originCryptoRate.set(depth.bestBuyPrice);
        }
      });
    } catch {
      // In isolated injector environments without a change detection scheduler, proceed safely
    }
  }

  // ─── Live Market Rates for USD ⇄ VES ───────────────────────────────────────
  readonly liveBcvRate = computed<number>(() => {
    if (!this.cotizaveService) return 70.0;
    const rates = this.cotizaveService.ratesByMarket();
    const oficial = rates['oficial'] ?? rates['bcv'];
    const rate = oficial?.mid ?? oficial?.ask ?? oficial?.bid;
    return typeof rate === 'number' && rate > 0 ? rate : 70.0;
  });

  readonly liveP2pBuyRate = computed<number>(() => {
    const depth = this.binanceService.marketDepth();
    return depth && depth.bestBuyPrice > 0 ? depth.bestBuyPrice : 100.0;
  });

  readonly liveP2pSellRate = computed<number>(() => {
    const depth = this.binanceService.marketDepth();
    return depth && depth.bestSellPrice > 0 ? depth.bestSellPrice : 98.5;
  });

  readonly effectiveBcvRate = computed<number>(() => {
    const custom = this.usdVesCustomBcvRate();
    return typeof custom === 'number' && custom > 0 ? custom : this.liveBcvRate();
  });

  readonly effectiveP2pBuyRate = computed<number>(() => {
    const custom = this.usdVesCustomP2pRate();
    return typeof custom === 'number' && custom > 0 ? custom : this.liveP2pBuyRate();
  });

  readonly effectiveP2pSellRate = computed<number>(() => {
    const custom = this.usdVesCustomP2pRate();
    return typeof custom === 'number' && custom > 0 ? custom : this.liveP2pSellRate();
  });

  // ─── USD ⇄ VES Dual Conversion Result ──────────────────────────────────────
  readonly usdVesConversion = computed<UsdVesConversionResult>(() => {
    return convertUsdVes(
      this.usdVesAmount(),
      this.usdVesDirection(),
      {
        bcv: this.effectiveBcvRate(),
        p2pBuy: this.effectiveP2pBuyRate(),
        p2pSell: this.effectiveP2pSellRate(),
      },
      this.usdVesDeskMarginPct(),
    );
  });

  readonly usdVesDeskLine = computed<UsdVesConversionLine | undefined>(() => {
    return this.usdVesConversion().lines.find((l) => l.source === 'DESK');
  });

  readonly usdVesP2pLine = computed<UsdVesConversionLine | undefined>(() => {
    return this.usdVesConversion().lines.find((l) => l.source === 'P2P');
  });

  readonly usdVesBcvLine = computed<UsdVesConversionLine | undefined>(() => {
    return this.usdVesConversion().lines.find((l) => l.source === 'BCV');
  });

  readonly usdVesWhatsAppMessage = computed<string>(() => {
    const conv = this.usdVesConversion();
    const isUsdToVes = conv.direction === 'USD_TO_VES';
    const deskLine = conv.lines.find((l) => l.source === 'DESK');
    const p2pLine = conv.lines.find((l) => l.source === 'P2P');
    const bcvLine = conv.lines.find((l) => l.source === 'BCV');

    const fmtMoney = (v: number): string =>
      v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const until = new Date(Date.now() + this.validityMinutes() * 60_000);
    const hh = String(until.getHours()).padStart(2, '0');
    const mm = String(until.getMinutes()).padStart(2, '0');

    let msg = `⚡ *COTIZACIÓN EXPRESS USD ⇄ VES* ⚡\n`;
    msg += `🏢 Atendido por: *${this.deskName()}*\n`;
    msg += `────────────────────────────\n`;

    if (isUsdToVes) {
      msg += `💵 *Monto*: $${fmtMoney(conv.amount)} USD\n`;
      if (deskLine) {
        msg += `📊 *Tasa acordada*: 1 USD = ${fmtMoney(deskLine.rate)} VES\n`;
        msg += `✅ *Recibes en Pago Móvil*: Bs ${fmtMoney(deskLine.result)} VES\n`;
      }
    } else {
      msg += `💵 *Monto en bolívares*: Bs ${fmtMoney(conv.amount)} VES\n`;
      if (deskLine) {
        msg += `📊 *Tasa acordada*: 1 USD = ${fmtMoney(deskLine.rate)} VES\n`;
        msg += `✅ *Recibes neto*: $${fmtMoney(deskLine.result)} USD\n`;
      }
    }

    if (bcvLine || p2pLine) {
      msg += `────────────────────────────\n`;
      msg += `📌 *Referencias del mercado*:\n`;
      if (bcvLine) msg += `• Tasa BCV Oficial: ${fmtMoney(bcvLine.rate)} VES\n`;
      if (p2pLine) msg += `• Tasa Binance P2P: ${fmtMoney(p2pLine.rate)} VES\n`;
      if (conv.exchangeGapPct !== null) {
        msg += `• Brecha cambiaria: +${conv.exchangeGapPct.toFixed(2)}%\n`;
      }
    }

    msg += `⏱️ *Validez*: ${this.validityMinutes()} min (hasta las ${hh}:${mm})\n`;
    if (this.contactNumber()) {
      msg += `📞 *Contacto*: ${this.contactNumber()}\n`;
    }
    msg += `────────────────────────────\n`;
    msg += `🔒 Transferencias exclusivas desde la cuenta titular.\n`;
    msg += `¿Confirmas para transferir de inmediato?`;

    return msg;
  });

  toggleUsdVesDirection(): void {
    const next: UsdVesDirection =
      this.usdVesDirection() === 'USD_TO_VES' ? 'VES_TO_USD' : 'USD_TO_VES';
    this.usdVesDirection.set(next);
    // Switch default amount to a realistic magnitude
    if (next === 'USD_TO_VES') {
      this.usdVesAmount.set(100);
    } else {
      this.usdVesAmount.set(5000);
    }
  }

  setUsdVesAmount(val: number): void {
    this.usdVesAmount.set(val);
  }

  async copyUsdVesQuote(): Promise<void> {
    try {
      const text = this.usdVesWhatsAppMessage();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.usdVesCopied.set(true);
      this.toast.success(
        'Cotización USD ⇄ VES copiada. ¡Lista para enviar por WhatsApp!',
        'Cotizador Rápido',
      );
      setTimeout(() => this.usdVesCopied.set(false), 2500);
    } catch {
      this.toast.error('No se pudo copiar automáticamente', 'Error');
    }
  }

  // ─── Multicurrency Corridor Logic ──────────────────────────────────────────
  readonly activeCorridor = computed<RemittanceCorridorConfig>(() => {
    return (
      this.corridors.find((c) => c.id === this.selectedCorridorId()) ??
      this.corridors[0]
    );
  });

  readonly liveRateSide = computed<'origin' | 'dest' | null>(() => {
    const c = this.activeCorridor();
    if (c.destCurrency === 'VES') return 'dest';
    if (c.originCurrency === 'VES') return 'origin';
    return null;
  });

  private static readonly DEFAULT_AMOUNTS: Record<string, number> = {
    COP: 500000,
    USD: 100,
    EUR: 100,
    CLP: 100000,
    PEN: 400,
    VES: 50000,
  };

  selectCorridor(id: string): void {
    const previousDest = this.activeCorridor().destCurrency;
    this.selectedCorridorId.set(id);
    const corridor = this.activeCorridor();
    this.originCryptoRate.set(corridor.typicalOriginCryptoRate);
    if (corridor.typicalDestCryptoRate !== undefined) {
      this.destCryptoRate.set(corridor.typicalDestCryptoRate);
    } else if (previousDest !== 'VES') {
      const live = this.binanceService.marketDepth()?.bestSellPrice ?? 0;
      this.destCryptoRate.set(live > 0 ? live : 98.5);
    }
    this.bankingFeePct.set(corridor.defaultBankingFeePct);
    this.bankingFixedFee.set(corridor.defaultBankingFixedFee);
    this.operatorMarginPct.set(corridor.defaultOperatorMarginPct);

    const amountCurrency =
      this.calculationMode() === 'BY_RECEIVE_AMOUNT' ? corridor.destCurrency : corridor.originCurrency;
    this.inputAmount.set(RemittancesComponent.DEFAULT_AMOUNTS[amountCurrency] ?? 500);
  }

  readonly quote = computed<RemittanceQuoteResult>(() => {
    return calculateRemittanceQuote({
      corridorId: this.selectedCorridorId(),
      calculationMode: this.calculationMode(),
      amount: this.inputAmount(),
      originCryptoRate: this.originCryptoRate(),
      destCryptoRate: this.destCryptoRate(),
      operatorMarginPct: this.operatorMarginPct(),
      bankingFeePct: this.bankingFeePct(),
      bankingFixedFee: this.bankingFixedFee(),
    });
  });

  readonly formattedMessage = computed<string>(() => {
    return formatRemittanceWhatsAppMessage(this.quote(), {
      companyOrDeskName: this.deskName(),
      validityMinutes: this.validityMinutes(),
      contactNumber: this.contactNumber() || undefined,
      issuedAtMs: Date.now(),
    });
  });

  async copyQuoteToClipboard(): Promise<void> {
    try {
      const text = this.formattedMessage();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.copied.set(true);
      this.toast.success(
        'Cotización copiada al portapapeles. ¡Lista para pegar en WhatsApp!',
        'Remesas Express',
      );
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      this.toast.error('No se pudo copiar automáticamente', 'Error');
    }
  }
}
