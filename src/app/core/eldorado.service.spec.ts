import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ElDoradoService } from './eldorado.service';
import { BybitP2pService } from './bybit-p2p.service';
import { P2P_STORAGE } from './storage';
import { MemoryStorage } from './memory-storage';

function installCryptoOnly(): void {
  (window as unknown as Record<string, unknown>)['electron'] = {
    crypto: {
      isAvailable: vi.fn(async () => true),
      encrypt: vi.fn(async (plain: string) => btoa(plain)),
      decrypt: vi.fn(async (cipher: string) => atob(cipher)),
    },
  };
}

function installElDoradoBridge(
  fetchQuote: (req: { direction: 'buy' | 'sell' }) => Promise<unknown>,
): void {
  installCryptoOnly();
  ((
    window as unknown as Record<string, unknown>
  )['electron'] as Record<string, unknown>)['fetchElDoradoQuote'] = vi.fn(
    (req: { direction: 'buy' | 'sell' }) => Promise.resolve(fetchQuote(req)),
  );
}

function quote(rate: number, direction: 'buy' | 'sell') {
  return {
    quote: {
      order_id: direction === 'buy' ? 'buy-quote' : 'sell-quote',
      username: direction === 'buy' ? 'SellerMarket' : 'BuyerMarket',
      rate,
      fiat: 'USD',
      crypto: 'USDT',
      min_limit: 10,
      max_limit: 1000,
      available_balance: 500,
      payment_method_name: 'Zelle',
      completed_orders: 200,
      completion_percent: 99,
    },
  };
}

describe('ElDoradoService', () => {
  let svc: ElDoradoService;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
    // Bybit service is only pulled in for its shared MarketDataMode type — it is
    // providedIn root but never referenced here, so instantiate it to keep DI clean.
    svc = TestBed.inject(ElDoradoService);
    void TestBed.inject(BybitP2pService);
  });

  afterEach(() => {
    if (typeof window !== 'undefined') {
      delete (window as unknown as Record<string, unknown>)['electron'];
    }
  });

  it('rejects unsupported fiats (VES) with demo mode', async () => {
    installCryptoOnly();
    await svc.saveCredentials('client', 'ref', '');
    await svc.refresh('USDT', 'VES');
    expect(svc.mode()).toBe('demo');
    expect(svc.fiatSupported()).toBe(false);
    expect(svc.statusText()).toContain('no soporta');
  });

  it('stays in demo mode when credentials are missing', async () => {
    installElDoradoBridge(async () => quote(1.1, 'buy'));
    await svc.refresh('USDT', 'USD');
    expect(svc.mode()).toBe('demo');
    expect(svc.lastFetched()).toBeNull();
  });

  it('derives live quote rates for a supported fiat', async () => {
    installElDoradoBridge(async ({ direction }) =>
      direction === 'buy' ? quote(4380.5, 'buy') : quote(4412.0, 'sell'),
    );
    await svc.saveCredentials('client', 'ref', 'token');
    await svc.refresh('USDT', 'COP');

    expect(svc.mode()).toBe('live');
    expect(svc.buyPrice()).toBe(4380.5);
    expect(svc.sellPrice()).toBe(4412.0);
    expect(svc.lastQuoteBuy()?.merchantName).toBe('SellerMarket');
    expect(svc.lastQuoteSell()?.merchantName).toBe('BuyerMarket');
  });

  it('falls back to demo when the quote call fails', async () => {
    installElDoradoBridge(async () => {
      throw new Error('El Dorado HTTP Error 401');
    });
    await svc.saveCredentials('client', 'ref', '');
    await svc.refresh('USDT', 'USD');
    expect(svc.mode()).toBe('demo');
    expect(svc.statusText()).toContain('401');
  });

  it('keeps editable demo prices until a live quote arrives', async () => {
    installCryptoOnly();
    svc.setDemoPrices(800, 807);
    expect(svc.buyPrice()).toBe(800);
    expect(svc.sellPrice()).toBe(807);
  });
});