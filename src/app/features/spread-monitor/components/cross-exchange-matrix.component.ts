import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  findCrossExchangeArbitrage,
  normalizeBinanceOrder,
  normalizeBybitOrder,
  normalizeElDoradoOrder,
  type ExchangeName,
  type TransferNetwork,
  type UnifiedP2pBook,
  type CrossExchangeArbitrageOpportunity,
} from '@p2p/core';
import { BinanceP2pService } from '../../../core/binance-p2p.service';
import { BybitP2pService } from '../../../core/bybit-p2p.service';
import { ElDoradoService } from '../../../core/eldorado.service';
import { ToastService } from '../../../core/toast.service';

@Component({
  selector: 'app-cross-exchange-matrix',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe, CurrencyPipe],
  templateUrl: './cross-exchange-matrix.component.html',
  styleUrl: './cross-exchange-matrix.component.scss',
})
export class CrossExchangeMatrix {
  private readonly binanceService = inject(BinanceP2pService);
  private readonly toast = inject(ToastService);
  readonly bybit = inject(BybitP2pService);
  readonly elDorado = inject(ElDoradoService);

  readonly capitalUsdt = signal<number>(500);
  readonly network = signal<TransferNetwork>('BEP20');
  readonly minSpreadPct = signal<number>(0.5);

  // Live prices with fallbacks
  readonly binanceBuyPrice = computed<number>(() => {
    return this.binanceService.marketDepth()?.bestBuyPrice || 810.0;
  });

  readonly binanceSellPrice = computed<number>(() => {
    return this.binanceService.marketDepth()?.bestSellPrice || 815.0;
  });

  readonly bybitBuyPrice = computed<number>(() => this.bybit.buyPrice());
  readonly bybitSellPrice = computed<number>(() => this.bybit.sellPrice());

  readonly elDoradoBuyPrice = computed<number>(() => this.elDorado.buyPrice());
  readonly elDoradoSellPrice = computed<number>(() => this.elDorado.sellPrice());

  // Config form state (secrets never read back into the DOM).
  readonly bybitApiKeyInput = signal<string>('');
  readonly bybitApiSecretInput = signal<string>('');
  readonly eldoradoClientIdInput = signal<string>('');
  readonly eldoradoReferralIdInput = signal<string>('');
  readonly eldoradoApiKeyInput = signal<string>('');

  readonly books = computed<Record<ExchangeName, UnifiedP2pBook>>(() => {
    const timestamp = new Date().toISOString();
    const cap = this.capitalUsdt();

    return {
      BINANCE: {
        timestamp,
        fiatCurrency: 'VES',
        cryptoCurrency: 'USDT',
        sellOffers: [
          normalizeBinanceOrder(
            {
              price: this.binanceBuyPrice(),
              maxVes: cap * this.binanceBuyPrice(),
              merchantName: 'Binance Verified',
            },
            'SELL',
          ),
        ],
        buyOffers: [
          normalizeBinanceOrder(
            {
              price: this.binanceSellPrice(),
              maxVes: cap * this.binanceSellPrice(),
              merchantName: 'Binance Buyer',
            },
            'BUY',
          ),
        ],
      },
      BYBIT: {
        timestamp,
        fiatCurrency: 'VES',
        cryptoCurrency: 'USDT',
        sellOffers: [
          this.bybit.bestSellOffer() ??
            normalizeBybitOrder(
              { price: this.bybitBuyPrice(), lastQuantity: cap, nickName: 'Bybit Pro' },
              'SELL',
            ),
        ],
        buyOffers: [
          this.bybit.bestBuyOffer() ??
            normalizeBybitOrder(
              { price: this.bybitSellPrice(), lastQuantity: cap, nickName: 'Bybit Buyer' },
              'BUY',
            ),
        ],
      },
      ELDORADO: {
        timestamp,
        fiatCurrency: 'VES',
        cryptoCurrency: 'USDT',
        sellOffers: [
          this.elDorado.lastQuoteSell() ??
            normalizeElDoradoOrder(
              {
                rate: this.elDoradoBuyPrice(),
                available_balance: cap,
                username: 'ElDorado Trader',
              },
              'SELL',
            ),
        ],
        buyOffers: [
          this.elDorado.lastQuoteBuy() ??
            normalizeElDoradoOrder(
              {
                rate: this.elDoradoSellPrice(),
                available_balance: cap,
                username: 'ElDorado Buyer',
              },
              'BUY',
            ),
        ],
      },
    };
  });

  readonly opportunities = computed<CrossExchangeArbitrageOpportunity[]>(() => {
    return findCrossExchangeArbitrage(this.books(), this.capitalUsdt(), {
      network: this.network(),
      minNetSpreadPct: this.minSpreadPct(),
    });
  });

  calculateSpreadPct(buyPrice: number, sellPrice: number): number {
    if (buyPrice <= 0) return 0;
    return ((sellPrice - buyPrice) / buyPrice) * 100;
  }

  setBybitBuyPrice(v: number): void {
    this.bybit.setDemoPrices(v, this.bybit.sellPrice());
  }

  setBybitSellPrice(v: number): void {
    this.bybit.setDemoPrices(this.bybit.buyPrice(), v);
  }

  setElDoradoBuyPrice(v: number): void {
    this.elDorado.setDemoPrices(v, this.elDorado.sellPrice());
  }

  setElDoradoSellPrice(v: number): void {
    this.elDorado.setDemoPrices(this.elDorado.buyPrice(), v);
  }

  saveBybitCredentials(): void {
    void this.bybit.saveCredentials(this.bybitApiKeyInput(), this.bybitApiSecretInput());
  }

  clearBybitCredentials(): void {
    this.bybitApiKeyInput.set('');
    this.bybitApiSecretInput.set('');
    void this.bybit.clearCredentials();
  }

  saveElDoradoCredentials(): void {
    void this.elDorado.saveCredentials(
      this.eldoradoClientIdInput(),
      this.eldoradoReferralIdInput(),
      this.eldoradoApiKeyInput(),
    );
  }

  clearElDoradoCredentials(): void {
    this.eldoradoClientIdInput.set('');
    this.eldoradoReferralIdInput.set('');
    this.eldoradoApiKeyInput.set('');
    void this.elDorado.clearCredentials();
  }

  refreshLiveRates(): void {
    void this.binanceService.fetchMarketDepth('USDT', 'VES', true);
    void this.bybit.refresh('USDT', 'VES');
    void this.elDorado.refresh('USDT', 'VES');
    this.toast.success('Sincronizando puntas Binance, Bybit y El Dorado…');
  }
}
