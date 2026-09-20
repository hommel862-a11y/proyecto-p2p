import { Injectable, InjectionToken, inject } from '@angular/core';
import { WebStorageAdapter, type StoragePort } from '@p2p/core';
import { MemoryStorage } from './memory-storage';
import { IndexedDbStorageService } from './indexed-db-storage.service';

/**
 * Injectable browser `Storage` backend. Defaults to `localStorage`; shells or tests may
 * override this token (e.g. with an in-memory `Storage`) without touching persistence logic.
 *
 * The factory is defensive: if accessing `globalThis.localStorage` throws (sandboxed web view,
 * `file://` context, disabled storage, jsdom quirks) it degrades to an in-memory
 * {@link MemoryStorage} so the app never crashes on injection. Real `localStorage` is used
 * whenever it is available.
 */
export const P2P_STORAGE = new InjectionToken<Storage>('P2P_STORAGE', {
  factory: () => {
    try {
      if (
        typeof globalThis.localStorage !== 'undefined' &&
        typeof globalThis.localStorage?.getItem === 'function' &&
        typeof globalThis.localStorage?.setItem === 'function'
      ) {
        return globalThis.localStorage;
      }
      return new MemoryStorage();
    } catch {
      return new MemoryStorage();
    }
  },
});

/**
 * App-wide storage singleton. Wraps the framework-agnostic {@link WebStorageAdapter}
 * over the injected {@link P2P_STORAGE} backend and bridges with {@link IndexedDbStorageService}
 * for large-scale, asynchronous IndexedDB persistence with L1 in-memory reads.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly idb = inject(IndexedDbStorageService, { optional: true });
  private readonly adapter: StoragePort = new WebStorageAdapter(inject(P2P_STORAGE));

  get<T>(key: string): T | null {
    if (this.idb) {
      const val = this.idb.get<T>(key);
      if (val !== null && val !== undefined) return val;
    }
    return this.adapter.get<T>(key);
  }

  set<T>(key: string, value: T): void {
    if (this.idb) {
      this.idb.set(key, value);
    }
    this.adapter.set(key, value);
  }

  remove(key: string): void {
    if (this.idb) {
      this.idb.remove(key);
    }
    this.adapter.remove(key);
  }

  /** Serialize the full local store (operation-log backup). */
  exportAll(): string {
    if (this.idb) {
      return this.idb.exportAll();
    }
    return this.adapter.exportAll();
  }

  /** Restore the full local store from a backup produced by {@link exportAll}. */
  importAll(json: string): void {
    if (this.idb) {
      this.idb.importAll(json);
    }
    this.adapter.importAll(json);
  }
}
