import { Injectable, inject, signal } from '@angular/core';
import { ToastService } from './toast.service';
import { CredentialStoreService } from './credential-store.service';
import { normalizeBybitOrder, type UnifiedP2pOrder } from '@p2p/core';

interface RawBybitOrder {
  id?: string;
  userId?: string;
  nickName?: string;
  price?: string | number;
  currencyId?: string;
  tokenId?: string;
  lastQuantity?: string | number;
  minAmount?: string | number;
  maxAmount?: string | number;
  payments?: string[];
  recentOrderNum?: number;
  recentExecuteRate?: number;
}

interface BybitElectronBridge {
  fetchBybitP2p?: (req: {
    apiKey: string;
    apiSecret: string;
    tokenId?: string;
    currencyId?: string;
    side: 0 | 1;
    page?: number;
    size?: number;
  }) => Promise<unknown>;
}

export type MarketDataMode = 'live' | 'demo';

/**
 * Reads Bybit P2P top-of-book through the Electron IPC bridge (HMAC-signed requests
 * stay in the main process; secrets never leave the OS-level encrypted vault).
 * Falls back to editable demo values whenever no credentials are configured,
 * the desktop bridge is unavailable, or the live call fails.
 */
@Injectable({ providedIn: 'root' })
export class BybitP2pService {
  private readonly toast = inject(ToastService);
  private readonly credentials = inject(CredentialStoreService);

  readonly configured = signal<boolean>(false);
  readonly mode = signal<MarketDataMode>('demo');
  readonly statusText = signal<string>(
    'Demo — configura tus credenciales Bybit P2P para cotizar en vivo.',
  );
  readonly loading = signal<boolean>(false);
  readonly lastFetched = signal<Date | null>(null);

  readonly buyPrice = signal<number>(808.5);
  readonly sellPrice = signal<number>(813.0);
  readonly bestSellOffer = signal<UnifiedP2pOrder | null>(null);
  readonly bestBuyOffer = signal<UnifiedP2pOrder | null>(null);

  constructor() {
    void this.hydrate();
  }

  private async hydrate(): Promise<void> {
    const creds = await this.credentials.getBybitCredentials();
    if (creds?.apiKey && creds.apiSecret) {
      this.configured.set(true);
      this.mode.set('live');
      this.statusText.set('Credenciales Bybit configuradas. Sincroniza para obtener puntas en vivo.');
    }
  }

  setDemoPrices(buy: number, sell: number): void {
    if (this.mode() === 'live') return;
    if (buy > 0) this.buyPrice.set(buy);
    if (sell > 0) this.sellPrice.set(sell);
  }

  async saveCredentials(apiKey: string, apiSecret: string): Promise<void> {
    if (!apiKey.trim() || !apiSecret.trim()) {
      this.toast.error('API Key y API Secret de Bybit son obligatorios.', 'Bybit P2P');
      return;
    }
    await this.credentials.setBybitCredentials({
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
    });
    this.configured.set(true);
    this.mode.set('live');
    this.statusText.set('Credenciales Bybit guardadas de forma segura.');
    this.toast.success('Credenciales Bybit guardadas de forma segura.', 'Bybit P2P');
  }

  async clearCredentials(): Promise<void> {
    await this.credentials.setBybitCredentials({ apiKey: '', apiSecret: '' });
    this.configured.set(false);
    this.mode.set('demo');
    this.statusText.set('Demo — configura tus credenciales Bybit P2P para cotizar en vivo.');
    this.toast.info('Credenciales Bybit eliminadas del almacén seguro.', 'Bybit P2P');
  }

  async refresh(asset = 'USDT', fiat = 'VES'): Promise<void> {
    const creds = await this.credentials.getBybitCredentials();
    if (!creds?.apiKey || !creds.apiSecret) {
      this.mode.set('demo');
      this.statusText.set('Demo — configura tus credenciales Bybit P2P para cotizar en vivo.');
      return;
    }

    this.loading.set(true);
    try {
      const bridge =
        typeof window !== 'undefined'
          ? (window as unknown as { electron?: BybitElectronBridge })?.electron
          : null;
      if (!bridge?.fetchBybitP2p) {
        throw new Error('Bybit P2P requiere la app de escritorio (Electron).');
      }

      const [sellSide, buySide] = await Promise.all([
        bridge.fetchBybitP2p({
          apiKey: creds.apiKey,
          apiSecret: creds.apiSecret,
          tokenId: asset,
          currencyId: fiat,
          side: 1,
          page: 1,
          size: 20,
        }),
        bridge.fetchBybitP2p({
          apiKey: creds.apiKey,
          apiSecret: creds.apiSecret,
          tokenId: asset,
          currencyId: fiat,
          side: 0,
          page: 1,
          size: 20,
        }),
      ]);

      const sellItems = extractBybitItems(sellSide);
      const buyItems = extractBybitItems(buySide);
      if (sellItems.length === 0 || buyItems.length === 0) {
        throw new Error('Bybit devolvió un libro de órdenes vacío.');
      }

      const sellOffers = sellItems
        .map((o) => normalizeBybitOrder(o, 'SELL'))
        .filter((o) => o.price > 0)
        .sort((a, b) => a.price - b.price);
      const buyOffers = buyItems
        .map((o) => normalizeBybitOrder(o, 'BUY'))
        .filter((o) => o.price > 0)
        .sort((a, b) => b.price - a.price);

      const bestAsk = sellOffers[0];
      const bestBid = buyOffers[0];
      if (!bestAsk || bestAsk.price <= 0 || !bestBid || bestBid.price <= 0) {
        throw new Error('Bybit devolvió precios inválidos.');
      }

      this.bestSellOffer.set(bestAsk);
      this.bestBuyOffer.set(bestBid);
      this.buyPrice.set(bestAsk.price);
      this.sellPrice.set(bestBid.price);
      this.mode.set('live');
      this.statusText.set(`En vivo — Bybit P2P ${asset}/${fiat}`);
      this.lastFetched.set(new Date());
    } catch (err) {
      const msg = (err as Error).message || 'No se pudo conectar con Bybit P2P';
      this.mode.set('demo');
      this.statusText.set(`Demo — ${msg}`);
      this.toast.error(msg, 'Bybit P2P');
    } finally {
      this.loading.set(false);
    }
  }
}

function extractBybitItems(data: unknown): RawBybitOrder[] {
  const root = (data ?? {}) as { result?: { items?: RawBybitOrder[]; list?: RawBybitOrder[] } };
  return root.result?.items ?? root.result?.list ?? [];
}