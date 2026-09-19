import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

function installElectronBridge(fetchBybitP2p: (req: { side: 0 | 1 }) => Promise<unknown>): void {
  (window as unknown as Record<string, unknown>)['electron'] = {
    crypto: {
      isAvailable: vi.fn(async () => true),
      encrypt: vi.fn(async (plain: string) => btoa(plain)),
      decrypt: vi.fn(async (cipher: string) => atob(cipher)),
    },
    fetchBybitP2p: vi.fn((req: { side: 0 | 1 }) =>
      fetchBybitP2p(req).then((res) => Promise.resolve(res)),
    ),
  };
}

describe('BybitP2pService', () => {
  let svc: BybitP2pService;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
    svc = TestBed.inject(BybitP2pService);
  });

  afterEach(() => {
    if (typeof window !== 'undefined') {
      delete (window as unknown as Record<string, unknown>)['electron'];
    }
  });

  it('starts in demo mode when no credentials are configured', async () => {
    installElectronBridge(vi.fn() as never);
    await svc.refresh('USDT', 'VES');
    expect(svc.mode()).toBe('demo');
    expect(svc.lastFetched()).toBeNull();
  });

  it('falls back to demo when the desktop bridge is unavailable', async () => {
    installCryptoOnly();
    await svc.saveCredentials('key', 'secret');
    await svc.refresh('USDT', 'VES');
    expect(svc.mode()).toBe('demo');
    expect(svc.statusText()).toContain('Demo');
  });

  it('derives live best ask/bid from the Bybit order book', async () => {
    installElectronBridge(async ({ side }) => {
      if (side === 1) {
        // SELL ads (asks) across two merchants
        return {
          result: {
            items: [
              {
                id: 'a1',
                nickName: 'Merc1',
                price: '810',
                lastQuantity: 12,
                recentOrderNum: 100,
                recentExecuteRate: 99.5,
              },
              {
                id: 'a0',
                nickName: 'Merc2',
                price: '808',
                lastQuantity: 9,
                recentOrderNum: 50,
                recentExecuteRate: 98,
              },
              { id: 'a2', nickName: 'Merc3', price: '0', lastQuantity: 0 },
            ],
          },
        };
      }
      // BUY ads (bids)
      return {
        result: {
          items: [
            { id: 'b1', nickName: 'Buyer1', price: '815', lastQuantity: 20 },
            { id: 'b2', nickName: 'Buyer2', price: '812', lastQuantity: 15 },
          ],
        },
      };
    });

    await svc.saveCredentials('key', 'secret');
    await svc.refresh('USDT', 'VES');

    expect(svc.mode()).toBe('live');
    expect(svc.buyPrice()).toBe(808);
    expect(svc.sellPrice()).toBe(815);
    expect(svc.bestSellOffer()?.merchantName).toBe('Merc2');
    expect(svc.bestBuyOffer()?.merchantName).toBe('Buyer1');
    expect(svc.lastFetched()).not.toBeNull();
  });

  it('keeps editable demo prices until live mode is entered', async () => {
    installElectronBridge(vi.fn() as never);
    svc.setDemoPrices(790, 795);
    expect(svc.buyPrice()).toBe(790);
    expect(svc.sellPrice()).toBe(795);

    const call = vi.fn(async () => ({
      result: { items: [{ id: 'x', price: '800', lastQuantity: 1 }] },
    }));
    installElectronBridge(call as never);
    await svc.saveCredentials('key', 'secret');
    await svc.refresh('USDT', 'VES');

    expect(svc.mode()).toBe('live');
    svc.setDemoPrices(1, 2);
    expect(svc.buyPrice()).toBe(800);
    expect(svc.sellPrice()).toBe(800);
  });

  it('falls back to demo with a status message when the live call fails', async () => {
    installElectronBridge(async () => {
      throw new Error('HTTP 400 — General Advertiser required');
    });

    await svc.saveCredentials('key', 'secret');
    await svc.refresh('USDT', 'VES');

    expect(svc.mode()).toBe('demo');
    expect(svc.statusText()).toContain('General Advertiser');
  });

  it('stores and clears credentials through the encrypted vault', async () => {
    installElectronBridge(vi.fn() as never);
    await svc.saveCredentials('my-key', 'my-secret');
    expect(svc.configured()).toBe(true);

    const payload = mem.getItem('p2p_sec_vault:p2p.secure.bybit');
    expect(payload).not.toBeNull();
    expect(payload as string).not.toContain('my-secret');

    await svc.clearCredentials();
    expect(svc.configured()).toBe(false);
    expect(svc.mode()).toBe('demo');
  });
});
