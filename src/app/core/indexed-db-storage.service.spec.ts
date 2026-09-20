import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { IndexedDbStorageService } from './indexed-db-storage.service';

describe('IndexedDbStorageService', () => {
  let service: IndexedDbStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [IndexedDbStorageService],
    });
    service = TestBed.inject(IndexedDbStorageService);
  });

  it('stores and retrieves values with synchronous O(1) reads', () => {
    service.set('p2p.test_key', { volume: 5000, active: true });
    const val = service.get<{ volume: number; active: boolean }>('p2p.test_key');
    expect(val).toBeDefined();
    expect(val?.volume).toBe(5000);
    expect(val?.active).toBe(true);
  });

  it('returns null for non-existing keys', () => {
    const val = service.get('p2p.non_existent');
    expect(val).toBeNull();
  });

  it('removes keys from memory cache cleanly', () => {
    service.set('p2p.to_remove', 'hello');
    expect(service.get('p2p.to_remove')).toBe('hello');
    service.remove('p2p.to_remove');
    expect(service.get('p2p.to_remove')).toBeNull();
  });

  it('exports and imports all stored entries via JSON', () => {
    service.set('p2p.item1', 123);
    service.set('p2p.item2', 'abc');

    const exported = service.exportAll();
    expect(exported).toContain('item1');
    expect(exported).toContain('item2');

    const freshService = new IndexedDbStorageService();
    freshService.importAll(exported);
    expect(freshService.get<number>('p2p.item1')).toBe(123);
    expect(freshService.get<string>('p2p.item2')).toBe('abc');
  });
});
