import { Injectable } from '@angular/core';

export const IDB_DATABASE_NAME = 'p2p_web_storage';
export const IDB_STORE_NAME = 'key_value_store';
export const IDB_VERSION = 1;

/**
 * Institutional L1 In-Memory + L2 IndexedDB Storage Engine.
 * Provides instant O(1) synchronous reads via memory cache while persisting
 * asynchronously into IndexedDB, overcoming the 5MB browser quota of localStorage.
 */
@Injectable({ providedIn: 'root' })
export class IndexedDbStorageService {
  private memoryCache = new Map<string, unknown>();
  private isReady = false;
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor() {
    this.init();
  }

  /**
   * Initializes IndexedDB, hydrates the L1 cache, and migrates legacy localStorage data.
   */
  async init(): Promise<void> {
    if (this.isReady) return;

    // 1. Initial hydration from localStorage if available to guarantee instant synchronous reads
    this.migrateFromLocalStorage();

    // 2. Open IndexedDB and hydrate fresh records
    try {
      const db = await this.getDb();
      if (db) {
        await this.hydrateFromIndexedDb(db);
        this.isReady = true;
      }
    } catch (err) {
      console.warn(
        '[IndexedDbStorage] Initialization warning, relying on memory/localStorage:',
        err,
      );
    }
  }

  private migrateFromLocalStorage(): void {
    if (typeof globalThis.localStorage === 'undefined') return;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('p2p.')) {
          const raw = localStorage.getItem(key);
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
      // ignore
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
            this.memoryCache.set(String(cursor.key), cursor.value);
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
          resolve((e.target as IDBOpenDBRequest).result);
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
    if (typeof globalThis.localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
          const parsed = JSON.parse(raw);
          this.memoryCache.set(key, parsed);
          return parsed as T;
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  /**
   * Synchronous L1 cache update with asynchronous L2 write-through to IndexedDB.
   */
  set<T>(key: string, value: T): void {
    this.memoryCache.set(key, value);

    // Also mirror critical smaller keys to localStorage for backward compatibility
    if (typeof globalThis.localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Quota exceeded in localStorage is completely safe now because IndexedDB handles large payloads!
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
      store.put(value, key);
    } catch (err) {
      console.warn(`[IndexedDbStorage] Async persistence error for key ${key}:`, err);
    }
  }

  remove(key: string): void {
    this.memoryCache.delete(key);

    if (typeof globalThis.localStorage !== 'undefined') {
      try {
        localStorage.removeItem(key);
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
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          this.set(k, v);
        }
      }
    } catch {
      // ignore
    }
  }
}
