/**
 * Minimal in-memory `Storage` implementation. Used by tests/shells and as the production
 * fallback backend when a real `localStorage` is unavailable or throws (sandboxed web views,
 * `file://` contexts, disabled storage). Implements the subset of the DOM `Storage` interface
 * used by {@link WebStorageAdapter}.
 */
export class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}
