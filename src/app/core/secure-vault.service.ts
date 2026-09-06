import { Injectable, inject } from '@angular/core';
import { StorageService } from './storage';

const VAULT_PREFIX = 'p2p_sec_vault:';
const DB_NAME = 'p2p_vault_db';
const STORE_NAME = 'p2p_keys';
const KEY_NAME = 'p2p_master_enc_key';

@Injectable({ providedIn: 'root' })
export class SecureVaultService {
  private readonly storage = inject(StorageService);
  private memoryFallback = new Map<string, string>();
  private webKey: CryptoKey | null = null;

  private get isElectronAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      !!(window as unknown as { electron?: { crypto?: { isAvailable: () => Promise<boolean> } } })
        ?.electron?.crypto
    );
  }

  async isAvailable(): Promise<boolean> {
    if (this.isElectronAvailable) {
      try {
        const electron = (
          window as unknown as { electron: { crypto: { isAvailable: () => Promise<boolean> } } }
        ).electron;
        return await electron.crypto.isAvailable();
      } catch {
        return false;
      }
    }
    return typeof window !== 'undefined' && !!window.crypto?.subtle;
  }

  async storeSecret(key: string, secret: string): Promise<void> {
    if (!key) throw new Error('Key is required to store secret');

    if (this.isElectronAvailable) {
      try {
        const electron = (
          window as unknown as {
            electron: { crypto: { encrypt: (plain: string) => Promise<string> } };
          }
        ).electron;
        const cipherB64 = await electron.crypto.encrypt(secret);
        this.storage.set(VAULT_PREFIX + key, cipherB64);
        return;
      } catch (err) {
        console.warn('[SecureVault] Electron safeStorage failed, using fallback:', err);
      }
    }

    // WebCrypto fallback
    if (typeof window !== 'undefined' && window.crypto?.subtle) {
      try {
        const masterKey = await this.getOrCreateWebKey();
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(secret);
        const encrypted = await window.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          masterKey,
          encoded,
        );

        const payload = {
          iv: this.bufferToBase64(iv.buffer),
          data: this.bufferToBase64(encrypted),
        };
        this.storage.set(VAULT_PREFIX + key, JSON.stringify(payload));
        return;
      } catch (err) {
        console.warn('[SecureVault] WebCrypto encryption failed, using in-memory store:', err);
      }
    }

    this.memoryFallback.set(key, secret);
  }

  async getSecret(key: string): Promise<string | null> {
    if (!key) return null;

    if (this.isElectronAvailable) {
      const cipherB64 = this.storage.get<string>(VAULT_PREFIX + key);
      if (!cipherB64) return null;
      try {
        const electron = (
          window as unknown as {
            electron: { crypto: { decrypt: (cipher: string) => Promise<string> } };
          }
        ).electron;
        return await electron.crypto.decrypt(cipherB64);
      } catch (err) {
        console.error('[SecureVault] Electron decryption failed:', err);
        return null;
      }
    }

    // WebCrypto fallback
    const rawStored = this.storage.get<string>(VAULT_PREFIX + key);
    if (rawStored && typeof window !== 'undefined' && window.crypto?.subtle) {
      try {
        const parsed = JSON.parse(rawStored) as { iv: string; data: string };
        const masterKey = await this.getOrCreateWebKey();
        const iv = new Uint8Array(this.base64ToBuffer(parsed.iv));
        const data = this.base64ToBuffer(parsed.data);

        const decrypted = await window.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          masterKey,
          data,
        );
        return new TextDecoder().decode(decrypted);
      } catch (err) {
        console.error('[SecureVault] WebCrypto decryption failed:', err);
        return null;
      }
    }

    return this.memoryFallback.get(key) ?? null;
  }

  async hasSecret(key: string): Promise<boolean> {
    if (this.storage.get<unknown>(VAULT_PREFIX + key) !== null) return true;
    return this.memoryFallback.has(key);
  }

  async removeSecret(key: string): Promise<void> {
    this.storage.remove(VAULT_PREFIX + key);
    this.memoryFallback.delete(key);
  }

  private async getOrCreateWebKey(): Promise<CryptoKey> {
    if (this.webKey) return this.webKey;

    try {
      const db = await this.openKeyDatabase();
      const existing = await this.readKeyFromDb(db);
      if (existing) {
        this.webKey = existing;
        return existing;
      }

      const newKey = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // non-exportable
        ['encrypt', 'decrypt'],
      );
      await this.saveKeyToDb(db, newKey);
      this.webKey = newKey;
      return newKey;
    } catch {
      // Fallback if IndexedDB fails: ephemeral session key
      if (!this.webKey) {
        this.webKey = await window.crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        );
      }
      return this.webKey;
    }
  }

  private openKeyDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private readKeyFromDb(db: IDBDatabase): Promise<CryptoKey | undefined> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(KEY_NAME);
      req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private saveKeyToDb(db: IDBDatabase, key: CryptoKey): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(key, KEY_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private bufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToBuffer(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
