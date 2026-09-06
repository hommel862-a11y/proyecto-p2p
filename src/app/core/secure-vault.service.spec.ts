import { TestBed } from '@angular/core/testing';
import { SecureVaultService } from './secure-vault.service';
import { StorageService } from './storage';

describe('SecureVaultService', () => {
  let service: SecureVaultService;
  let storage: StorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SecureVaultService);
    storage = TestBed.inject(StorageService);
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['electron'];
  });

  it('should be created and check availability', async () => {
    expect(service).toBeTruthy();
    const available = await service.isAvailable();
    expect(typeof available).toBe('boolean');
  });

  it('should store, retrieve and remove secrets with WebCrypto or in-memory fallback', async () => {
    const key = 'binance_api_key';
    const secret = 'v3ry_s3cr3t_t0k3n_12345';

    await service.storeSecret(key, secret);
    const has = await service.hasSecret(key);
    expect(has).toBe(true);

    const retrieved = await service.getSecret(key);
    expect(retrieved).toBe(secret);

    await service.removeSecret(key);
    const retrievedAfter = await service.getSecret(key);
    expect(retrievedAfter).toBeNull();
  });

  it('should delegate to electron.crypto when available', async () => {
    let encryptedCalled = false;
    let decryptedCalled = false;

    (window as unknown as Record<string, unknown>)['electron'] = {
      crypto: {
        isAvailable: async () => true,
        encrypt: async (text: string) => {
          encryptedCalled = true;
          return `dpapi_enc:${text}`;
        },
        decrypt: async (cipher: string) => {
          decryptedCalled = true;
          return cipher.replace('dpapi_enc:', '');
        },
      },
    };

    const isAvail = await service.isAvailable();
    expect(isAvail).toBe(true);

    await service.storeSecret('api_secret', 'my-secret-value');
    expect(encryptedCalled).toBe(true);

    const result = await service.getSecret('api_secret');
    expect(decryptedCalled).toBe(true);
    expect(result).toBe('my-secret-value');
  });
});
