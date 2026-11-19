import { Injectable, signal } from '@angular/core';

export const IDB_DATABASE_NAME = 'p2p_web_storage';
export const IDB_STORE_NAME = 'key_value_store';
export const IDB_VERSION = 1;

function getSafeLocalStorage(): Storage | null {
  try {
    if (
      typeof globalThis.localStorage !== 'undefined' &&
      typeof globalThis.localStorage?.getItem === 'function' &&
      typeof globalThis.localStorage?.setItem === 'function'
    ) {
      return globalThis.localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

function isQuotaExceededError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const record = err as Record<string, unknown>;
  const name = typeof record['name'] === 'string' ? record['name'] : '';
  const message = typeof record['message'] === 'string' ? record['message'] : '';
  const code = typeof record['code'] === 'number' ? record['code'] : -1;

  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014 ||
    /quota/i.test(message)
  );
}

/**
 * Institutional L1 In-Memory + L2 IndexedDB Storage Engine.
 * Provides instant O(1) synchronous reads via memory cache while persisting
 * asynchronously into IndexedDB, exposing deterministic hydration and quota telemetry.
 */
@Injectable({ providedIn: 'root' })
export class IndexedDbStorageService {
  private readonly memoryCache = new Map<string, unknown>();
  private readonly dirtyKeys = new Set<string>();
  private readonly hydrationListeners = new Set<() => void>();
  private isReady = false;
  private initPromise: Promise<void> | null = null;
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  /** Reactive flag indicating initial localStorage + IndexedDB hydration has completed. */
  readonly hydrated = signal<boolean>(false);

  /** Reactive flag raised whenever a localStorage or IndexedDB write exceeds storage quota. */
  readonly quotaExceeded = signal<boolean>(false);

  constructor() {
    void this.init();
  }

  /** Resolves once initial localStorage + IndexedDB hydration completes. */
  whenReady(): Promise<void> {
    return this.init();
  }

  /**
   * Registers a callback invoked once initial hydration completes (or immediately if already hydrated).
   * Returns an unsubscribe function.
   */
  onHydrated(callback: () => void): () => void {
    if (this.hydrated()) {
      try {
        callback();
      } catch (err: unknown) {
        console.warn('[IndexedDbStorage] onHydrated callback error:', err);
      }
      return () => {
        return;
      };
    }

    this.hydrationListeners.add(callback);
    return () => {
      this.hydrationListeners.delete(callback);
    };
  }

  /**
   * Initializes IndexedDB, hydrates the L1 cache, and migrates legacy localStorage data.
   */
  async init(): Promise<void> {
    if (this.isReady) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // 1. Initial hydration from localStorage if available to guarantee instant synchronous reads
      this.migrateFromLocalStorage();

      // 2. Open IndexedDB and hydrate persisted records
      try {
        const db = await this.getDb();
        if (db) {
          await this.hydrateFromIndexedDb(db);
        }
      } catch (err: unknown) {
        console.warn(
          '[IndexedDbStorage] Initialization warning, relying on memory/localStorage:',
          err,
        );
      } finally {
        this.isReady = true;
        this.dirtyKeys.clear();
        this.hydrated.set(true);
        this.flushHydrationListeners();
      }
    })();

    return this.initPromise;
  }

  private flushHydrationListeners(): void {
    for (const listener of this.hydrationListeners) {
      try {
        listener();
      } catch (err: unknown) {
        console.warn('[IndexedDbStorage] onHydrated listener error:', err);
      }
    }
    this.hydrationListeners.clear();
  }

  private migrateFromLocalStorage(): void {
    const storage = getSafeLocalStorage();
    if (!storage) return;

    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (
          key &&
          !this.dirtyKeys.has(key) &&
          (key.startsWith('p2p.') || key.startsWith('p2p_sec_vault:'))
        ) {
          const raw = storage.getItem(key);
          if (raw !== null) {
            try {
              this.memoryCache.set(key, JSON.parse(raw));
            } catch {
              this.memoryCache.set(key, raw);
            }
          }
        }
      }
    } catch {
      // ignore restricted storage contexts
    }
  }

  private async hydrateFromIndexedDb(db: IDBDatabase): Promise<void> {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.openCursor();

        req.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const key = String(cursor.key);
            if (!this.dirtyKeys.has(key)) {
              this.memoryCache.set(key, cursor.value);
            }
            cursor.continue();
          } else {
            resolve();
          }
        };

        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private getDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;

    if (typeof globalThis.indexedDB === 'undefined') {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      try {
        const req = globalThis.indexedDB.open(IDB_DATABASE_NAME, IDB_VERSION);

        req.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
            db.createObjectStore(IDB_STORE_NAME);
          }
        };

        req.onsuccess = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          db.onversionchange = () => {
            db.close();
            this.dbPromise = null;
          };
          resolve(db);
        };

        req.onblocked = () => {
          console.warn('[IndexedDbStorage] IndexedDB open blocked by another tab or connection.');
          resolve(null);
        };

        req.onerror = () => {
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  /**
   * Synchronous O(1) read from L1 memory cache.
   */
  get<T>(key: string): T | null {
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key) as T;
    }

    // Secondary fallback to localStorage
    const storage = getSafeLocalStorage();
    if (storage) {
      try {
        const raw = storage.getItem(key);
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          this.memoryCache.set(key, parsed);
          return parsed as T;
        }
      } catch {
        // ignore parse or storage access errors
      }
    }

    return null;
  }

  /**
   * Synchronous L1 cache update with asynchronous L2 write-through to IndexedDB.
   * Surfaces QuotaExceededError via the `quotaExceeded` signal instead of swallowing it silently.
   */
  set<T>(key: string, value: T): void {
    if (!this.isReady) {
      this.dirtyKeys.add(key);
    }
    this.memoryCache.set(key, value);

    // Mirror to localStorage for backward compatibility while surfacing quota exhaustion
    const storage = getSafeLocalStorage();
    if (storage) {
      try {
        storage.setItem(key, JSON.stringify(value));
        if (this.quotaExceeded()) {
          this.quotaExceeded.set(false);
        }
      } catch (err: unknown) {
        if (isQuotaExceededError(err)) {
          this.quotaExceeded.set(true);
          console.warn(
            `[IndexedDbStorage] localStorage quota exceeded while mirroring key "${key}". Persisting in IndexedDB.`,
            err,
          );
        } else {
          console.warn(`[IndexedDbStorage] localStorage mirror failed for key "${key}":`, err);
        }
      }
    }

    // Asynchronous L2 persistence in IndexedDB
    void this.persistToIndexedDb(key, value);
  }

  private async persistToIndexedDb(key: string, value: unknown): Promise<void> {
    try {
      const db = await this.getDb();
      if (!db) return;

      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.put(value, key);
      req.onerror = () => {
        if (isQuotaExceededError(req.error)) {
          this.quotaExceeded.set(true);
        }
      };
    } catch (err: unknown) {
      if (isQuotaExceededError(err)) {
        this.quotaExceeded.set(true);
      }
      console.warn(`[IndexedDbStorage] Async persistence error for key ${key}:`, err);
    }
  }

  remove(key: string): void {
    if (!this.isReady) {
      this.dirtyKeys.add(key);
    }
    this.memoryCache.delete(key);

    const storage = getSafeLocalStorage();
    if (storage) {
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    }

    void this.removeFromIndexedDb(key);
  }

  private async removeFromIndexedDb(key: string): Promise<void> {
    try {
      const db = await this.getDb();
      if (!db) return;

      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).delete(key);
    } catch {
      // ignore
    }
  }

  exportAll(): string {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.memoryCache.entries()) {
      out[k] = v;
    }
    return JSON.stringify(out, null, 2);
  }

  importAll(json: string): void {
    try {
      const parsed: unknown = JSON.parse(json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          this.set(k, v);
        }
      }
    } catch {
      // ignore invalid JSON
    }
  }
}
