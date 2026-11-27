import { Injectable, computed, inject, signal } from '@angular/core';
import {
  canUseMerchantWriteApi,
  deriveKycStatsFromOrderHistory,
  evaluateKycMakerEligibility,
  resolveCanonicalMakerFeePct,
  type KycMakerEligibility,
  type MakerMerchantLevel,
} from '@p2p/core';
import type {
  BinanceMerchantLevelDto,
  BinanceSyncOrdersRequest,
  BinanceSyncedC2cOrderDto,
  BinanceVaultSaveRequest,
  BinanceVaultStatusDto,
} from '../../../electron/shared/types';
import { StorageService } from './storage';
import { ToastService } from './toast.service';

const PROFILE_STORAGE_KEY = 'p2p.binance.accountProfile.v1';

interface StoredNonSecretProfile {
  merchantLevel: BinanceMerchantLevelDto;
  accountAgeDaysOverride: number | null;
  hasKycAnd2fa: boolean;
}

const DEFAULT_STATUS: BinanceVaultStatusDto = {
  hasCredentials: false,
  maskedApiKey: null,
  merchantLevel: 'STANDARD',
  hasProxyUrl: false,
  redactedProxyHost: null,
  accountAgeDaysOverride: null,
  hasKycAnd2fa: true,
  secretStorageAvailable: false,
};

function getElectronVaultBridge() {
  if (typeof window === 'undefined') return undefined;
  return (window as { electron?: { binanceVault?: Window['electron']['binanceVault'] } }).electron
    ?.binanceVault;
}

@Injectable({
  providedIn: 'root',
})
export class BinanceAccountProfileService {
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);

  private readonly _nonSecretProfile = signal<StoredNonSecretProfile>(this.loadStoredProfile());
  readonly vaultStatus = signal<BinanceVaultStatusDto>({
    ...DEFAULT_STATUS,
    merchantLevel: this._nonSecretProfile().merchantLevel,
    accountAgeDaysOverride: this._nonSecretProfile().accountAgeDaysOverride,
    hasKycAnd2fa: this._nonSecretProfile().hasKycAnd2fa,
  });
  readonly syncedOrders = signal<BinanceSyncedC2cOrderDto[]>([]);
  readonly syncing = signal<boolean>(false);
  readonly lastSyncAt = signal<string | null>(null);
  readonly lastSyncError = signal<string | null>(null);

  readonly isDesktopVaultAvailable = computed<boolean>(() => Boolean(getElectronVaultBridge()));

  readonly merchantLevel = computed<MakerMerchantLevel>(
    () => this.vaultStatus().merchantLevel,
  );

  readonly makerFeePct = computed<number>(() =>
    resolveCanonicalMakerFeePct(this.merchantLevel()),
  );

  readonly canWriteMerchantApi = computed<boolean>(
    () => this.vaultStatus().hasCredentials && canUseMerchantWriteApi(this.merchantLevel()),
  );

  readonly kycEligibility = computed<KycMakerEligibility>(() => {
    const orders = this.syncedOrders();
    const status = this.vaultStatus();
    const mapped = orders.map((o) => ({
      orderNumber: o.orderNumber,
      orderStatus: o.orderStatus,
      counterPartNickName: o.counterpartyNickname,
      createTime: o.createTime,
    }));
    const derived =
      orders.length > 0
        ? deriveKycStatsFromOrderHistory(mapped)
        : {
            completedOrders: undefined,
            completionRate30dPct: undefined,
            uniqueCounterparties: undefined,
          };

    let inferredAgeDays = status.accountAgeDaysOverride ?? undefined;
    if (inferredAgeDays === undefined && orders.length > 0) {
      let minCreateTime = Infinity;
      for (const o of orders) {
        if (o.createTime > 0 && o.createTime < minCreateTime) {
          minCreateTime = o.createTime;
        }
      }
      if (Number.isFinite(minCreateTime)) {
        inferredAgeDays = Math.max(0, Math.floor((Date.now() - minCreateTime) / 86_400_000));
      }
    }

    return evaluateKycMakerEligibility({
      kycVerified: status.hasKycAnd2fa,
      twoFactorEnabled: status.hasKycAnd2fa,
      accountAgeDays: inferredAgeDays,
      completedOrders: derived.completedOrders,
      completionRate30dPct: derived.completionRate30dPct,
      uniqueCounterparties: derived.uniqueCounterparties,
    });
  });

  constructor() {
    void this.refreshStatus();
  }

  private loadStoredProfile(): StoredNonSecretProfile {
    const raw = this.storage.get<Partial<StoredNonSecretProfile>>(PROFILE_STORAGE_KEY);
    const level = raw?.merchantLevel;
    const validLevel: BinanceMerchantLevelDto =
      level === 'BRONZE' || level === 'SILVER' || level === 'GOLD' || level === 'STANDARD'
        ? level
        : 'STANDARD';
    const rawAge = raw?.accountAgeDaysOverride;
    const age =
      typeof rawAge === 'number' && Number.isFinite(rawAge) && rawAge >= 0
        ? Math.trunc(rawAge)
        : null;
    const hasKycAnd2fa = typeof raw?.hasKycAnd2fa === 'boolean' ? raw.hasKycAnd2fa : true;
    return {
      merchantLevel: validLevel,
      accountAgeDaysOverride: age,
      hasKycAnd2fa,
    };
  }

  private persistNonSecretProfile(next: StoredNonSecretProfile): void {
    this._nonSecretProfile.set(next);
    this.storage.set(PROFILE_STORAGE_KEY, next);
  }

  async refreshStatus(): Promise<BinanceVaultStatusDto> {
    const bridge = getElectronVaultBridge();
    if (!bridge) {
      const local = this._nonSecretProfile();
      const status: BinanceVaultStatusDto = {
        ...DEFAULT_STATUS,
        merchantLevel: local.merchantLevel,
        accountAgeDaysOverride: local.accountAgeDaysOverride,
        hasKycAnd2fa: local.hasKycAnd2fa,
      };
      this.vaultStatus.set(status);
      return status;
    }

    try {
      const status = await bridge.getStatus();
      this.vaultStatus.set(status);
      this.persistNonSecretProfile({
        merchantLevel: status.merchantLevel,
        accountAgeDaysOverride: status.accountAgeDaysOverride,
        hasKycAnd2fa: status.hasKycAnd2fa,
      });
      return status;
    } catch {
      return this.vaultStatus();
    }
  }

  async setMerchantLevel(level: MakerMerchantLevel): Promise<BinanceVaultStatusDto> {
    return this.saveConfig({ merchantLevel: level });
  }

  async saveConfig(req: BinanceVaultSaveRequest): Promise<BinanceVaultStatusDto> {
    const bridge = getElectronVaultBridge();
    const current = this.vaultStatus();
    const nextNonSecret: StoredNonSecretProfile = {
      merchantLevel: req.merchantLevel ?? current.merchantLevel,
      accountAgeDaysOverride:
        req.accountAgeDaysOverride !== undefined
          ? req.accountAgeDaysOverride
          : current.accountAgeDaysOverride,
      hasKycAnd2fa: req.hasKycAnd2fa ?? current.hasKycAnd2fa,
    };
    this.persistNonSecretProfile(nextNonSecret);

    if (!bridge) {
      if (req.apiKey || req.apiSecret || req.merchantProxyUrl) {
        this.toast.warn(
          'Los secretos de Binance SAPI solo se almacenan en la bóveda cifrada del Escritorio Electron.',
          'Bóveda Binance',
        );
      }
      const webStatus: BinanceVaultStatusDto = {
        ...DEFAULT_STATUS,
        ...nextNonSecret,
      };
      this.vaultStatus.set(webStatus);
      return webStatus;
    }

    const updated = await bridge.saveConfig(req);
    this.vaultStatus.set(updated);
    return updated;
  }

  async clearConfig(): Promise<BinanceVaultStatusDto> {
    this.syncedOrders.set([]);
    this.lastSyncAt.set(null);
    this.lastSyncError.set(null);
    this.persistNonSecretProfile({
      merchantLevel: 'STANDARD',
      accountAgeDaysOverride: null,
      hasKycAnd2fa: true,
    });

    const bridge = getElectronVaultBridge();
    if (!bridge) {
      this.vaultStatus.set({ ...DEFAULT_STATUS });
      return this.vaultStatus();
    }

    const cleared = await bridge.clearConfig();
    this.vaultStatus.set(cleared);
    return cleared;
  }

  async syncC2cOrders(req?: BinanceSyncOrdersRequest): Promise<BinanceSyncedC2cOrderDto[]> {
    const bridge = getElectronVaultBridge();
    if (!bridge) {
      const msg = 'La sincronización SAPI C2C requiere el puente seguro de Electron Desktop.';
      this.lastSyncError.set(msg);
      this.toast.warn(msg, 'Binance SAPI');
      return [];
    }

    this.syncing.set(true);
    this.lastSyncError.set(null);
    try {
      const orders = await bridge.syncOrders(req);
      this.syncedOrders.set(orders);
      this.lastSyncAt.set(new Date().toISOString());
      return orders;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastSyncError.set(msg);
      this.toast.error(`Error sincronizando órdenes Binance SAPI: ${msg}`, 'Binance SAPI');
      return [];
    } finally {
      this.syncing.set(false);
    }
  }
}
