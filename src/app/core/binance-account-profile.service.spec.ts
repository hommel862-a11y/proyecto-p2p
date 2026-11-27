import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceAccountProfileService } from './binance-account-profile.service';
import { StorageService } from './storage';
import { ToastService } from './toast.service';
import type { BinanceSyncedC2cOrderDto, BinanceVaultStatusDto } from '../../../electron/shared/types';

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // Already initialized in shared test runner
}

describe('BinanceAccountProfileService', () => {
  let storedMap: Map<string, unknown>;
  let toast: { success: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  function installElectronVault(overrides?: Partial<{
    status: BinanceVaultStatusDto;
    orders: BinanceSyncedC2cOrderDto[];
  }>) {
    let status: BinanceVaultStatusDto = overrides?.status ?? {
      hasCredentials: true,
      maskedApiKey: 'Bina••••ABCD',
      merchantLevel: 'STANDARD',
      hasProxyUrl: false,
      redactedProxyHost: null,
      accountAgeDaysOverride: 45,
      hasKycAnd2fa: true,
      secretStorageAvailable: true,
    };
    const vault = {
      getStatus: vi.fn(async () => status),
      saveConfig: vi.fn(async (req: { merchantLevel?: BinanceVaultStatusDto['merchantLevel'] }) => {
        status = { ...status, ...(req.merchantLevel ? { merchantLevel: req.merchantLevel } : {}) };
        return status;
      }),
      clearConfig: vi.fn(async () => {
        status = { ...status, hasCredentials: false, maskedApiKey: null, merchantLevel: 'STANDARD' };
        return status;
      }),
      syncOrders: vi.fn(async () => overrides?.orders ?? []),
    };
    (globalThis as unknown as { window?: unknown }).window = {
      electron: { binanceVault: vault },
    };
    return vault;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    storedMap = new Map<string, unknown>();
    toast = { success: vi.fn(), warn: vi.fn(), error: vi.fn() };
    (globalThis as { window?: unknown }).window = undefined;
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    TestBed.resetTestingModule();
  });

  function createService(): BinanceAccountProfileService {
    TestBed.configureTestingModule({
      providers: [
        BinanceAccountProfileService,
        {
          provide: StorageService,
          useValue: {
            get: <T>(k: string) => (storedMap.get(k) as T) ?? null,
            set: (k: string, v: unknown) => void storedMap.set(k, v),
          },
        },
        { provide: ToastService, useValue: toast },
      ],
    });
    return TestBed.inject(BinanceAccountProfileService);
  }

  it('tracks canonical maker fees across all 4 tiers and gates write API strictly on verified merchants', async () => {
    installElectronVault();
    const svc = createService();
    await svc.refreshStatus();

    expect(svc.merchantLevel()).toBe('STANDARD');
    expect(svc.makerFeePct()).toBe(0.25);
    expect(svc.canWriteMerchantApi()).toBe(false);

    await svc.setMerchantLevel('BRONZE');
    expect(svc.makerFeePct()).toBe(0.2);
    expect(svc.canWriteMerchantApi()).toBe(true);

    await svc.setMerchantLevel('SILVER');
    expect(svc.makerFeePct()).toBe(0.175);

    await svc.setMerchantLevel('GOLD');
    expect(svc.makerFeePct()).toBe(0.125);
    expect(svc.canWriteMerchantApi()).toBe(true);
  });

  it('never writes apiKey, apiSecret, or proxy credentials into StorageService', async () => {
    const vault = installElectronVault();
    const svc = createService();
    await svc.saveConfig({
      apiKey: 'RawKey12345',
      apiSecret: 'TopSecret67890',
      merchantProxyUrl: 'https://user:pass@10.0.0.1:8443',
      merchantLevel: 'SILVER',
    });

    expect(vault.saveConfig).toHaveBeenCalledTimes(1);
    const dumped = JSON.stringify(Array.from(storedMap.entries()));
    expect(dumped).not.toContain('RawKey12345');
    expect(dumped).not.toContain('TopSecret67890');
    expect(dumped).not.toContain('10.0.0.1');
  });

  it('computes the 5 KYC Maker gates from synced C2C orders', async () => {
    const now = Date.now();
    const orders: BinanceSyncedC2cOrderDto[] = Array.from({ length: 22 }, (_, i) => ({
      orderNumber: `ORD-${i}`,
      advNo: '11218246497340923904',
      tradeType: i % 2 === 0 ? 'BUY' : 'SELL',
      asset: 'USDT',
      fiat: 'VES',
      amount: 100,
      totalPrice: 9200,
      unitPrice: 92,
      commission: 0.25,
      orderStatus: 'COMPLETED',
      counterpartyNickname: `Trader-${i % 12}`,
      createTime: now - (i + 1) * 86_400_000,
    }));

    installElectronVault({ orders });
    const svc = createService();
    await svc.refreshStatus();
    await svc.syncC2cOrders();

    const eligibility = svc.kycEligibility();
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.failedGates).toEqual([]);
    expect(eligibility.gates.find((g) => g.id === 'COMPLETED_ORDERS')?.actual).toBe(22);
    expect(eligibility.gates.find((g) => g.id === 'UNIQUE_COUNTERPARTIES')?.actual).toBe(12);
    expect(eligibility.gates.find((g) => g.id === 'COMPLETION_RATE_30D')?.actual).toBe(100);
  });
});
