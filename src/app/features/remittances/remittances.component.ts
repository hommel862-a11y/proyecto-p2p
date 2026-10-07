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
  type RemittanceCorridorConfig,
  type RemittanceQuoteResult,
} from '@p2p/core';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { ToastService } from '../../core/toast.service';

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
  private readonly toast = inject(ToastService);

  readonly corridors = DEFAULT_REMITTANCE_CORRIDORS;
  readonly selectedCorridorId = signal<string>(DEFAULT_REMITTANCE_CORRIDORS[0].id);
  readonly calculationMode = signal<'BY_SEND_AMOUNT' | 'BY_RECEIVE_AMOUNT'>('BY_SEND_AMOUNT');

  // Input fields
  readonly inputAmount = signal<number>(500000);
  readonly originCryptoRate = signal<number>(DEFAULT_REMITTANCE_CORRIDORS[0].typicalOriginCryptoRate);
  readonly destCryptoRate = signal<number>(98.50);
  readonly operatorMarginPct = signal<number>(2.5);
  readonly bankingFeePct = signal<number>(DEFAULT_REMITTANCE_CORRIDORS[0].defaultBankingFeePct);
  readonly bankingFixedFee = signal<number>(DEFAULT_REMITTANCE_CORRIDORS[0].defaultBankingFixedFee);

  readonly deskName = signal<string>('Mesa P2P Caracas');
  readonly validityMinutes = signal<number>(15);
  readonly copied = signal<boolean>(false);

  constructor() {
    // Bind the live Binance P2P VES rate to whichever side of the corridor is VES.
    // VES payout: desk sells USDT for VES (bid). VES intake: desk buys USDT with VES (ask).
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
  }

  readonly activeCorridor = computed<RemittanceCorridorConfig>(() => {
    return (
      this.corridors.find((c) => c.id === this.selectedCorridorId()) ??
      this.corridors[0]
    );
  });

  /** Which rate input is fed by the live P2P book (the VES side of the corridor). */
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
      // Leaving a non-VES payout corridor: restore the live VES rate (or a sane fallback).
      const live = this.binanceService.marketDepth()?.bestSellPrice ?? 0;
      this.destCryptoRate.set(live > 0 ? live : 98.5);
    }
    this.bankingFeePct.set(corridor.defaultBankingFeePct);
    this.bankingFixedFee.set(corridor.defaultBankingFixedFee);
    this.operatorMarginPct.set(corridor.defaultOperatorMarginPct);

    // In receive mode the amount is in dest currency, otherwise origin currency.
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
        'Remesas Express'
      );
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      this.toast.error('No se pudo copiar automáticamente', 'Error');
    }
  }
}
