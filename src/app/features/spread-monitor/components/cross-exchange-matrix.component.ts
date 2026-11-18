import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DEFAULT_EXCHANGE_FEES,
  findCrossExchangeArbitrage,
  normalizeBinanceOrder,
  normalizeBybitOrder,
  normalizeElDoradoOrder,
  type CrossExchangeArbitrageOpportunity,
  type ExchangeName,
  type TransferNetwork,
  type UnifiedP2pBook,
} from '@p2p/core';
import { BinanceP2pService } from '../../../core/binance-p2p.service';
import { BybitP2pService } from '../../../core/bybit-p2p.service';
import { ElDoradoService } from '../../../core/eldorado.service';
import { ToastService } from '../../../core/toast.service';

type BinancePairSignalSource = BinanceP2pService & {
  readonly selectedAsset?: () => string;
  readonly selectedFiat?: () => string;
};

function resolvePositivePrice(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

@Component({
  selector: 'app-cross-exchange-matrix',
  standalone: true,
  imports: [FormsModule, DecimalPipe, CurrencyPipe],
  templateUrl: './cross-exchange-matrix.component.html',
  styleUrl: './cross-exchange-matrix.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CrossExchangeMatrix {
  private readonly binanceService = inject(BinanceP2pService);
  private readonly toast = inject(ToastService);
  readonly bybit = inject(BybitP2pService);
  readonly elDorado = inject(ElDoradoService);

  readonly capitalUsdt = signal<number>(500);
  readonly network = signal<TransferNetwork>('BEP20');
  readonly minSpreadPct = signal<number>(0.5);
  readonly showApiConfig = signal<boolean>(false);

  readonly activeAsset = computed<string>(() => {
    const svc = this.binanceService as BinancePairSignalSource;
    const fromSignal = typeof svc.selectedAsset === 'function' ? svc.selectedAsset() : '';
    const fromDepth = this.binanceService.marketDepth()?.asset ?? '';
    return (fromSignal || fromDepth || 'USDT').trim().toUpperCase();
  });

  readonly activeFiat = computed<string>(() => {
    const svc = this.binanceService as BinancePairSignalSource;
    const fromSignal = typeof svc.selectedFiat === 'function' ? svc.selectedFiat() : '';
    const fromDepth = this.binanceService.marketDepth()?.fiat ?? '';
    return (fromSignal || fromDepth || 'VES').trim().toUpperCase();
  });

  // Live Binance prices: fail cleanly to 0 when feed is absent or non-positive
  readonly binanceBuyPrice = computed<number>(() =>
    resolvePositivePrice(this.binanceService.marketDepth()?.bestBuyPrice),
  );

  readonly binanceSellPrice = computed<number>(() =>
    resolvePositivePrice(this.binanceService.marketDepth()?.bestSellPrice),
  );

  readonly hasBinanceFeed = computed<boolean>(
    () => this.binanceBuyPrice() > 0 && this.binanceSellPrice() > 0,
  );

  readonly bybitBuyPrice = computed<number>(() => resolvePositivePrice(this.bybit.buyPrice()));
  readonly bybitSellPrice = computed<number>(() => resolvePositivePrice(this.bybit.sellPrice()));
  readonly hasBybitPrices = computed<boolean>(
    () => this.bybitBuyPrice() > 0 && this.bybitSellPrice() > 0,
  );

  readonly elDoradoBuyPrice = computed<number>(() => resolvePositivePrice(this.elDorado.buyPrice()));
  readonly elDoradoSellPrice = computed<number>(() =>
    resolvePositivePrice(this.elDorado.sellPrice()),
  );
  readonly hasElDoradoPrices = computed<boolean>(
    () => this.elDoradoBuyPrice() > 0 && this.elDoradoSellPrice() > 0,
  );

  // Config form state (secrets never read back into the DOM)
  readonly bybitApiKeyInput = signal<string>('');
  readonly bybitApiSecretInput = signal<string>('');
  readonly eldoradoClientIdInput = signal<string>('');
  readonly eldoradoReferralIdInput = signal<string>('');
  readonly eldoradoApiKeyInput = signal<string>('');

  readonly books = computed<Record<ExchangeName, UnifiedP2pBook>>(() => {
    const timestamp = new Date().toISOString();
    const rawCap = this.capitalUsdt();
    const cap = Number.isFinite(rawCap) && rawCap > 0 ? rawCap : 0;
    const asset = this.activeAsset();
    const fiat = this.activeFiat();

    const binanceBuy = this.binanceBuyPrice();
    const binanceSell = this.binanceSellPrice();

    const bybitSellOffer = this.bybit.bestSellOffer();
    const bybitBuyOffer = this.bybit.bestBuyOffer();
    const bybitBuy = this.bybitBuyPrice();
    const bybitSell = this.bybitSellPrice();

    const elDoradoQuoteSell = this.elDorado.lastQuoteSell();
    const elDoradoQuoteBuy = this.elDorado.lastQuoteBuy();
    const elDoradoBuy = this.elDoradoBuyPrice();
    const elDoradoSell = this.elDoradoSellPrice();

    return {
      BINANCE: {
        timestamp,
        fiatCurrency: fiat,
        cryptoCurrency: asset,
        sellOffers:
          cap > 0 && binanceBuy > 0
            ? [
                normalizeBinanceOrder(
                  {
                    price: binanceBuy,
                    maxVes: cap * binanceBuy,
                    merchantName: 'Binance Verified',
                  },
                  'SELL',
                  fiat,
                  asset,
                ),
              ]
            : [],
        buyOffers:
          cap > 0 && binanceSell > 0
            ? [
                normalizeBinanceOrder(
                  {
                    price: binanceSell,
                    maxVes: cap * binanceSell,
                    merchantName: 'Binance Buyer',
                  },
                  'BUY',
                  fiat,
                  asset,
                ),
              ]
            : [],
      },
      BYBIT: {
        timestamp,
        fiatCurrency: fiat,
        cryptoCurrency: asset,
        sellOffers:
          bybitSellOffer && bybitSellOffer.price > 0
            ? [bybitSellOffer]
            : cap > 0 && bybitBuy > 0
              ? [
                  normalizeBybitOrder(
                    {
                      price: bybitBuy,
                      lastQuantity: cap,
                      nickName: 'Bybit Pro',
                      currencyId: fiat,
                      tokenId: asset,
                    },
                    'SELL',
                  ),
                ]
              : [],
        buyOffers:
          bybitBuyOffer && bybitBuyOffer.price > 0
            ? [bybitBuyOffer]
            : cap > 0 && bybitSell > 0
              ? [
                  normalizeBybitOrder(
                    {
                      price: bybitSell,
                      lastQuantity: cap,
                      nickName: 'Bybit Buyer',
                      currencyId: fiat,
                      tokenId: asset,
                    },
                    'BUY',
                  ),
                ]
              : [],
      },
      ELDORADO: {
        timestamp,
        fiatCurrency: fiat,
        cryptoCurrency: asset,
        sellOffers:
          elDoradoQuoteSell && elDoradoQuoteSell.price > 0
            ? [elDoradoQuoteSell]
            : cap > 0 && elDoradoBuy > 0
              ? [
                  normalizeElDoradoOrder(
                    {
                      rate: elDoradoBuy,
                      available_balance: cap,
                      username: 'ElDorado Trader',
                      fiat,
                      crypto: asset,
                    },
                    'SELL',
                  ),
                ]
              : [],
        buyOffers:
          elDoradoQuoteBuy && elDoradoQuoteBuy.price > 0
            ? [elDoradoQuoteBuy]
            : cap > 0 && elDoradoSell > 0
              ? [
                  normalizeElDoradoOrder(
                    {
                      rate: elDoradoSell,
                      available_balance: cap,
                      username: 'ElDorado Buyer',
                      fiat,
                      crypto: asset,
                    },
                    'BUY',
                  ),
                ]
              : [],
      },
    };
  });

  readonly opportunities = computed<CrossExchangeArbitrageOpportunity[]>(() => {
    const cap = this.capitalUsdt();
    if (!Number.isFinite(cap) || cap <= 0) {
      return [];
    }
    return findCrossExchangeArbitrage(this.books(), cap, {
      network: this.network(),
      minNetSpreadPct: this.minSpreadPct(),
    });
  });

  calculateSpreadPct(buyPrice: number, sellPrice: number): number {
    if (
      !Number.isFinite(buyPrice) ||
      !Number.isFinite(sellPrice) ||
      buyPrice <= 0 ||
      sellPrice <= 0
    ) {
      return 0;
    }
    return ((sellPrice - buyPrice) / buyPrice) * 100;
  }

  withdrawalFeeLabel(exchange: ExchangeName): string {
    const net = this.network();
    const fee = DEFAULT_EXCHANGE_FEES[exchange].networkWithdrawalFeeUsdt[net];
    return `0.0% / $${fee.toFixed(2)} ${net}`;
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
    const asset = this.activeAsset();
    const fiat = this.activeFiat();
    void this.binanceService.fetchMarketDepth(asset, fiat, true);
    void this.bybit.refresh(asset, fiat);
    void this.elDorado.refresh(asset, fiat);
    this.toast.success(`Sincronizando puntas ${asset}/${fiat} en Binance, Bybit y El Dorado…`);
  }
}
