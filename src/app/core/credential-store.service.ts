import { Injectable, inject } from '@angular/core';
import { StorageService } from './storage';
import { SecureVaultService } from './secure-vault.service';

const VAULT_TELEGRAM = 'p2p.secure.telegram';
const VAULT_COTIZAVE = 'p2p.secure.cotizave';

const LEGACY_TELEGRAM = 'p2p.telegram_config';
const LEGACY_COTIZAVE = 'p2p.cotizave.apiKey';

export interface TelegramConfigPayload {
  token: string;
  chatId: string;
  alertsEnabled: boolean;
  pollingEnabled?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CredentialStoreService {
  private readonly vault = inject(SecureVaultService);
  private readonly storage = inject(StorageService);
  private static migrationDone = false;

  readonly backend: 'electron' | 'web' = detectBackend();

  private async migrateOnce(): Promise<void> {
    if (CredentialStoreService.migrationDone) return;
    CredentialStoreService.migrationDone = true;

    await this.migrateTelegram();
    await this.migrateCotizave();
  }

  private async migrateTelegram(): Promise<void> {
    const encrypted = await this.vault.hasSecret(VAULT_TELEGRAM);
    if (encrypted) {
      this.removeLegacy(LEGACY_TELEGRAM);
      return;
    }

    const raw = this.storage.get<string>(LEGACY_TELEGRAM);
    if (!raw) return;

    try {
      await this.vault.storeSecret(VAULT_TELEGRAM, raw);
      this.removeLegacy(LEGACY_TELEGRAM);
    } catch {
      // Do not remove the legacy key if encryption failed.
    }
  }

  private async migrateCotizave(): Promise<void> {
    const encrypted = await this.vault.hasSecret(VAULT_COTIZAVE);
    if (encrypted) {
      this.removeLegacy(LEGACY_COTIZAVE);
      return;
    }

    const raw = this.storage.get<string>(LEGACY_COTIZAVE);
    if (!raw || typeof raw !== 'string') return;

    try {
      await this.vault.storeSecret(VAULT_COTIZAVE, raw);
      this.removeLegacy(LEGACY_COTIZAVE);
    } catch {
      // Do not remove the legacy key if encryption failed.
    }
  }

  private removeLegacy(key: string): void {
    this.storage.remove(key);
  }

  async getTelegramConfig(): Promise<TelegramConfigPayload | null> {
    await this.migrateOnce();
    const json = await this.vault.getSecret(VAULT_TELEGRAM);
    if (!json) return null;
    try {
      return JSON.parse(json) as TelegramConfigPayload;
    } catch {
      return null;
    }
  }

  async setTelegramConfig(cfg: TelegramConfigPayload): Promise<void> {
    await this.migrateOnce();
    await this.vault.storeSecret(VAULT_TELEGRAM, JSON.stringify(cfg));
  }

  async getCotizaveApiKey(): Promise<string | null> {
    await this.migrateOnce();
    return this.vault.getSecret(VAULT_COTIZAVE);
  }

  async setCotizaveApiKey(key: string): Promise<void> {
    await this.migrateOnce();
    await this.vault.storeSecret(VAULT_COTIZAVE, key);
  }
}

function detectBackend(): 'electron' | 'web' {
  if (
    typeof window !== 'undefined' &&
    !!(window as unknown as { electron?: { crypto?: unknown } })?.electron?.crypto
  ) {
    return 'electron';
  }
  return 'web';
}
