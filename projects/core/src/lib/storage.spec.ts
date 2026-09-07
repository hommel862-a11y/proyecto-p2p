import { describe, it, expect, beforeEach } from 'vitest';
import { WebStorageAdapter } from './storage';

/** Minimal in-memory {@link Storage} implementation so the test does not depend on the
 *  host environment's localStorage (which varies across jsdom / Capacitor / Electron). */
class MemoryStorage {
  private map = new Map<string, string>();
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

describe('WebStorageAdapter (StoragePort)', () => {
  let store: Storage;
  beforeEach(() => {
    store = new MemoryStorage() as unknown as Storage;
  });

  it('get returns null for a missing key', () => {
    const a = new WebStorageAdapter(store);
    expect(a.get('missing')).toBeNull();
  });

  it('set/get round-trips a typed value', () => {
    const a = new WebStorageAdapter(store);
    a.set('cfg', { minSpread: 15 });
    expect(a.get<{ minSpread: number }>('cfg')).toEqual({ minSpread: 15 });
  });

  it('remove deletes a key', () => {
    const a = new WebStorageAdapter(store);
    a.set('k', 1);
    a.remove('k');
    expect(a.get('k')).toBeNull();
  });

  it('exportAll/importAll is lossless for operation-log records (NFR2)', () => {
    const a = new WebStorageAdapter(store);
    a.set('op1', {
      id: 'op1',
      type: 'buy',
      ves: 20000,
      usdt: 25,
      price: 800,
      ts: '2026-08-29T10:00:00.000Z',
      note: 'merchant X',
      nested: { fee: 0.1 },
    });
    a.set('op2', {
      id: 'op2',
      type: 'sell',
      ves: 20500,
      usdt: 25,
      price: 820,
      ts: '2026-08-29T11:00:00.000Z',
      note: '',
      nested: { fee: 0 },
    });
    a.set('cfg', { minSpread: 15, maxConcurrentOps: 3 });

    const exported = a.exportAll();

    // Simulate a fresh adapter / restored state from the backup.
    const b = new WebStorageAdapter(store);
    b.importAll(exported);

    expect(b.get('op1')).toEqual({
      id: 'op1',
      type: 'buy',
      ves: 20000,
      usdt: 25,
      price: 800,
      ts: '2026-08-29T10:00:00.000Z',
      note: 'merchant X',
      nested: { fee: 0.1 },
    });
    expect(b.get('op2')).toEqual({
      id: 'op2',
      type: 'sell',
      ves: 20500,
      usdt: 25,
      price: 820,
      ts: '2026-08-29T11:00:00.000Z',
      note: '',
      nested: { fee: 0 },
    });
    expect(b.get('cfg')).toEqual({ minSpread: 15, maxConcurrentOps: 3 });
  });

  it('exportAll serializes every stored key', () => {
    const a = new WebStorageAdapter(store);
    a.set('k1', 1);
    a.set('k2', 'two');
    const parsed = JSON.parse(a.exportAll());
    expect(Object.keys(parsed).sort()).toEqual(['k1', 'k2']);
  });
});
