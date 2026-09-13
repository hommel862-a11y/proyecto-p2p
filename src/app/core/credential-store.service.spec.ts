import { TestBed } from '@angular/core/testing';
import { CredentialStoreService } from './credential-store.service';
import { SecureVaultService } from './secure-vault.service';
import { StorageService, P2P_STORAGE } from './storage';
import { MemoryStorage } from './memory-storage';

describe('CredentialStoreService', () => {
  let mem: MemoryStorage;
  let storage: StorageService;

  beforeEach(() => {
    mem = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: P2P_STORAGE, useValue: mem }],
    });
    storage = TestBed.inject(StorageService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    delete (window as unknown as Record<string, unknown>)['electron'];
    // Reset the once-per-session migration flag between tests.
    (CredentialStoreService as unknown as { migrationDone: boolean }).migrationDone = false;
  });

  function mockElectronCrypto(): {
    encrypt: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
  } {
    const encrypt = vi.fn(async (plain: string) => `dpapi:${btoa(plain)}`);
    const decrypt = vi.fn(async (cipher: string) => atob(cipher.replace('dpapi:', '')));
    (window as unknown as Record<string, unknown>)['electron'] = {
      crypto: {
        isAvailable: async () => true,
        encrypt,
        decrypt,
      },
    };
    return { encrypt, decrypt };
  }

  it('detects the electron backend when the preload bridge is available', () => {
    mockElectronCrypto();
    expect(TestBed.inject(CredentialStoreService).backend).toBe('electron');
  });

  it('detects the web backend when the electron bridge is absent', () => {
    expect(TestBed.inject(CredentialStoreService).backend).toBe('web');
  });

  it('migrates legacy plaintext keys into the encrypted vault and removes them', async () => {
    mockElectronCrypto();
    storage.set('p2p.telegram_config', JSON.stringify({ token: 'tok-123', chatId: '987654321' }));
    storage.set('p2p.cotizave.apiKey', 'cotizave-secret');

    const service = TestBed.inject(CredentialStoreService);

    const telegram = await service.getTelegramConfig();
    expect(telegram).toEqual({ token: 'tok-123', chatId: '987654321' });

    const apiKey = await service.getCotizaveApiKey();
    expect(apiKey).toBe('cotizave-secret');

    // Legacy plaintext keys must have been removed.
    expect(storage.get<string>('p2p.telegram_config')).toBeNull();
    expect(storage.get<string>('p2p.cotizave.apiKey')).toBeNull();

    // The migrated payloads live encrypted (never as plaintext) in the vault.
    const vault = TestBed.inject(SecureVaultService);
    expect(await vault.hasSecret('p2p.secure.telegram')).toBe(true);
    expect(await vault.hasSecret('p2p.secure.cotizave')).toBe(true);

    const vaultedTelegram = mem.getItem('p2p_sec_vault:p2p.secure.telegram');
    const vaultedCotizave = mem.getItem('p2p_sec_vault:p2p.secure.cotizave');
    expect(vaultedTelegram).not.toBeNull();
    expect(vaultedCotizave).not.toBeNull();
    expect(vaultedTelegram).not.toContain('tok-123');
    expect(vaultedCotizave).not.toContain('cotizave-secret');
  });

  it('round-trips encrypt/decrypt through the electron preload bridge when available', async () => {
    const { encrypt, decrypt } = mockElectronCrypto();
    const service = TestBed.inject(CredentialStoreService);

    await service.setTelegramConfig({ token: 'tok', chatId: '123', alertsEnabled: true });
    expect(encrypt).toHaveBeenCalled();

    const back = await service.getTelegramConfig();
    expect(decrypt).toHaveBeenCalled();
    expect(back).toEqual({ token: 'tok', chatId: '123', alertsEnabled: true });
  });

  it('falls back to the web vault when the electron bridge is absent', async () => {
    const service = TestBed.inject(CredentialStoreService);
    expect(service.backend).toBe('web');

    await service.setCotizaveApiKey('web-secret');
    expect(await service.getCotizaveApiKey()).toBe('web-secret');
    // Nothing legacy left behind.
    expect(storage.get<string>('p2p.cotizave.apiKey')).toBeNull();
  });

  it('does not delete the legacy key when the encrypted write fails (fail-closed)', async () => {
    mockElectronCrypto();
    storage.set('p2p.telegram_config', JSON.stringify({ token: 'tok', chatId: '123' }));

    // Sabotage the vault so the migration cannot persist the encrypted payload.
    const vault = TestBed.inject(SecureVaultService);
    vi.spyOn(vault, 'storeSecret').mockRejectedValue(new Error('encryption unavailable'));

    await TestBed.inject(CredentialStoreService).getTelegramConfig();

    // Legacy key must be preserved (fail-closed).
    expect(storage.get<string>('p2p.telegram_config')).not.toBeNull();
  });
});
