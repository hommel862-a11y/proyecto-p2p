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
    // Automatically bind destination crypto rate from Binance P2P depth if available
    effect(() => {
      const depth = this.binanceService.marketDepth();
      if (depth && depth.bestSellPrice > 0) {
        this.destCryptoRate.set(depth.bestSellPrice);
      }
    });
  }

  readonly activeCorridor = computed<RemittanceCorridorConfig>(() => {
    return (
      this.corridors.find((c) => c.id === this.selectedCorridorId()) ??
      this.corridors[0]
    );
  });

  selectCorridor(id: string): void {
    this.selectedCorridorId.set(id);
    const corridor = this.activeCorridor();
    this.originCryptoRate.set(corridor.typicalOriginCryptoRate);
    this.bankingFeePct.set(corridor.defaultBankingFeePct);
    this.bankingFixedFee.set(corridor.defaultBankingFixedFee);
    this.operatorMarginPct.set(corridor.defaultOperatorMarginPct);

    if (corridor.originCurrency === 'COP') {
      this.inputAmount.set(500000);
    } else if (corridor.originCurrency === 'USD') {
      this.inputAmount.set(100);
    } else if (corridor.originCurrency === 'EUR') {
      this.inputAmount.set(100);
    } else if (corridor.originCurrency === 'CLP') {
      this.inputAmount.set(100000);
    } else {
      this.inputAmount.set(500);
    }
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
