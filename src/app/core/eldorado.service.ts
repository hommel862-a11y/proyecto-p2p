import { Injectable, inject, signal } from '@angular/core';
import { ToastService } from './toast.service';
import { CredentialStoreService } from './credential-store.service';
import { normalizeElDoradoOrder, type UnifiedP2pOrder } from '@p2p/core';
import type { MarketDataMode } from './bybit-p2p.service';

export const ELDORADO_SUPPORTED_FIATS = ['USD', 'ARS', 'BRL', 'COP', 'PEN'] as const;

interface RawElDoradoQuote {
  order_id?: string;
  username?: string;
  rate?: number;
  fiat?: string;
  crypto?: string;
  min_limit?: number;
  max_limit?: number;
  available_balance?: number;
  payment_method_name?: string;
  completed_orders?: number;
  completion_percent?: number;
}

interface ElDoradoElectronBridge {
  fetchElDoradoQuote?: (req: {
    clientId: string;
    referralId: string;
    apiKey?: string;
    direction: 'buy' | 'sell';
    asset?: string;
    fiat?: string;
    amount?: number;
    paymentMethod?: string;
  }) => Promise<unknown>;
}

/**
 * Reads El Dorado P2P quotes through the Electron IPC bridge (X-Client-ID /
 * X-Referral-ID headers stay in the main process). El Dorado does not support
 * VES yet (USD, ARS, BRL, COP, PEN only), so unsupported pairs always use demo
 * mode and the component keeps its editable reference values.
 */
@Injectable({ providedIn: 'root' })
export class ElDoradoService {
  private readonly toast = inject(ToastService);
  private readonly credentials = inject(CredentialStoreService);

  readonly configured = signal<boolean>(false);
  readonly mode = signal<MarketDataMode>('demo');
  readonly fiatSupported = signal<boolean>(true);
  readonly statusText = signal<string>(
    'Demo — configura tu cuenta El Dorado (cliente/referido) para cotizar en vivo.',
  );
  readonly loading = signal<boolean>(false);
  readonly lastFetched = signal<Date | null>(null);

  readonly buyPrice = signal<number>(805.0);
  readonly sellPrice = signal<number>(811.5);
  readonly lastQuoteBuy = signal<UnifiedP2pOrder | null>(null);
  readonly lastQuoteSell = signal<UnifiedP2pOrder | null>(null);

  constructor() {
    void this.hydrate();
  }

  private async hydrate(): Promise<void> {
    const creds = await this.credentials.getElDoradoCredentials();
    if (creds?.clientId && creds.referralId) {
      this.configured.set(true);
      this.mode.set('live');
      this.statusText.set('Cuenta El Dorado configurada. Sincroniza para obtener cotizaciones.');
    }
  }

  setDemoPrices(buy: number, sell: number): void {
    if (this.mode() === 'live') return;
    if (buy > 0) this.buyPrice.set(buy);
    if (sell > 0) this.sellPrice.set(sell);
  }

  async saveCredentials(clientId: string, referralId: string, apiKey: string): Promise<void> {
    if (!clientId.trim() || !referralId.trim()) {
      this.toast.error('Client ID y Referral ID de El Dorado son obligatorios.', 'El Dorado');
      return;
    }
    await this.credentials.setElDoradoCredentials({
      clientId: clientId.trim(),
      referralId: referralId.trim(),
      apiKey: apiKey.trim(),
    });
    this.configured.set(true);
    this.mode.set('live');
    this.statusText.set('Credenciales El Dorado guardadas de forma segura.');
    this.toast.success('Credenciales El Dorado guardadas de forma segura.', 'El Dorado');
  }

  async clearCredentials(): Promise<void> {
    await this.credentials.setElDoradoCredentials({ clientId: '', referralId: '', apiKey: '' });
    this.configured.set(false);
    this.mode.set('demo');
    this.statusText.set('Demo — configura tu cuenta El Dorado para cotizar en vivo.');
    this.toast.info('Credenciales El Dorado eliminadas del almacén seguro.', 'El Dorado');
  }

  async refresh(asset = 'USDT', fiat = 'USD'): Promise<void> {
    if (!isElDoradoFiat(fiat)) {
      this.mode.set('demo');
      this.fiatSupported.set(false);
      this.statusText.set(
        `Demo — El Dorado no soporta ${fiat}. Fiats soportados: ${ELDORADO_SUPPORTED_FIATS.join(', ')}.`,
      );
      return;
    }
    this.fiatSupported.set(true);

    const creds = await this.credentials.getElDoradoCredentials();
    if (!creds?.clientId || !creds.referralId) {
      this.mode.set('demo');
      this.statusText.set('Demo — configura tu cuenta El Dorado para cotizar en vivo.');
      return;
    }

    this.loading.set(true);
    try {
      const bridge =
        typeof window !== 'undefined'
          ? (window as unknown as { electron?: ElDoradoElectronBridge })?.electron
          : null;
      if (!bridge?.fetchElDoradoQuote) {
        throw new Error('El Dorado requiere la app de escritorio (Electron).');
      }

      const [buyQ, sellQ] = await Promise.all([
        bridge.fetchElDoradoQuote({
          clientId: creds.clientId,
          referralId: creds.referralId,
          apiKey: creds.apiKey || undefined,
          direction: 'buy',
          asset,
          fiat,
        }),
        bridge.fetchElDoradoQuote({
          clientId: creds.clientId,
          referralId: creds.referralId,
          apiKey: creds.apiKey || undefined,
          direction: 'sell',
          asset,
          fiat,
        }),
      ]);

      const buyQuote = extractElDoradoQuote(buyQ);
      const sellQuote = extractElDoradoQuote(sellQ);
      if (!buyQuote || !sellQuote) {
        throw new Error('El Dorado devolvió una cotización inválida.');
      }

      const buyOrder = normalizeElDoradoOrder(buyQuote, 'BUY');
      const sellOrder = normalizeElDoradoOrder(sellQuote, 'SELL');
      if (buyOrder.price <= 0 || sellOrder.price <= 0) {
        throw new Error('El Dorado devolvió tasas inválidas.');
      }

      this.lastQuoteBuy.set(buyOrder);
      this.lastQuoteSell.set(sellOrder);
      this.buyPrice.set(buyOrder.price);
      this.sellPrice.set(sellOrder.price);
      this.mode.set('live');
      this.statusText.set(`En vivo — El Dorado ${asset}/${fiat}`);
      this.lastFetched.set(new Date());
    } catch (err) {
      const msg = (err as Error).message || 'No se pudo conectar con El Dorado';
      this.mode.set('demo');
      this.statusText.set(`Demo — ${msg}`);
      this.toast.error(msg, 'El Dorado');
    } finally {
      this.loading.set(false);
    }
  }
}

function isElDoradoFiat(fiat: string): boolean {
  return (ELDORADO_SUPPORTED_FIATS as readonly string[]).includes(fiat);
}

function extractElDoradoQuote(data: unknown): RawElDoradoQuote | null {
  const root = (data ?? {}) as Record<string, unknown>;
  const quote = (root['quote'] ?? root['data'] ?? data) as RawElDoradoQuote | undefined;
  return quote ?? null;
}