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

  readonly bybitBuyPrice = signal<number>(808.5);
  readonly bybitSellPrice = signal<number>(813.0);

  readonly elDoradoBuyPrice = signal<number>(805.0);
  readonly elDoradoSellPrice = signal<number>(811.5);

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
          normalizeBybitOrder(
            { price: this.bybitBuyPrice(), lastQuantity: cap, nickName: 'Bybit Pro' },
            'SELL',
          ),
        ],
        buyOffers: [
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
          normalizeElDoradoOrder(
            { rate: this.elDoradoBuyPrice(), available_balance: cap, username: 'ElDorado Trader' },
            'SELL',
          ),
        ],
        buyOffers: [
          normalizeElDoradoOrder(
            { rate: this.elDoradoSellPrice(), available_balance: cap, username: 'ElDorado Buyer' },
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

  refreshLiveRates(): void {
    void this.binanceService.fetchMarketDepth('USDT', 'VES', true);
    this.toast.success('Puntas de Binance P2P sincronizadas en tiempo real.');
  }
}
