import { Injectable, InjectionToken, inject } from '@angular/core';
import { WebStorageAdapter, type StoragePort } from '@p2p/core';
import { MemoryStorage } from './memory-storage';

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
 * over the injected {@link P2P_STORAGE} backend. Shared by every feature so the
 * operation-log backup and the risk-rules config live in one place.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly adapter: StoragePort = new WebStorageAdapter(inject(P2P_STORAGE));

  get<T>(key: string): T | null {
    return this.adapter.get<T>(key);
  }

  set<T>(key: string, value: T): void {
    this.adapter.set(key, value);
  }

  remove(key: string): void {
    this.adapter.remove(key);
  }

  /** Serialize the full local store (operation-log backup). */
  exportAll(): string {
    return this.adapter.exportAll();
  }

  /** Restore the full local store from a backup produced by {@link exportAll}. */
  importAll(json: string): void {
    this.adapter.importAll(json);
  }
}
