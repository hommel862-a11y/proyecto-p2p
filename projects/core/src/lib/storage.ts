/**
 * Storage port + Web (localStorage) adapter (framework-agnostic).
 * Shared by the Angular web app, Capacitor, and Electron renderers.
 * No Node `fs` required for MVP; the Electron main process stays out of persistence.
 */

export interface StoragePort {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  /** Serialize every stored entry to a JSON string (operation-log backup). */
  exportAll(): string;
  /** Restore every entry from a JSON string produced by {@link exportAll}. */
  importAll(json: string): void;
}

export class WebStorageAdapter implements StoragePort {
  constructor(private readonly backend: Storage = localStorage) {}

  get<T>(key: string): T | null {
    const raw = this.backend.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    this.backend.setItem(key, JSON.stringify(value));
  }

  remove(key: string): void {
    this.backend.removeItem(key);
  }

  exportAll(): string {
    const out: Record<string, string> = {};
    for (let i = 0; i < this.backend.length; i++) {
      const k = this.backend.key(i);
      if (k === null) continue;
      const v = this.backend.getItem(k);
      if (v !== null) out[k] = v;
    }
    return JSON.stringify(out);
  }

  importAll(json: string): void {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      return;
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return;
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === 'string') this.backend.setItem(k, v);
    }
  }
}
