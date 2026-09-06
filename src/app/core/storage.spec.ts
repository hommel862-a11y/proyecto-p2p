import { TestBed } from '@angular/core/testing';
import { describe, it, expect, afterEach } from 'vitest';
import { P2P_STORAGE } from './storage';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
});

describe('P2P_STORAGE defensive factory', () => {
  it('uses the real localStorage when it is available', () => {
    const mockStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: mockStorage,
    });

    const store = TestBed.inject(P2P_STORAGE);
    expect(store).toBe(mockStorage);
  });

  it('degrades to an in-memory Storage when localStorage access throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled');
      },
    });
    const store = TestBed.inject(P2P_STORAGE);
    // must not crash and must behave like a Storage
    store.setItem('k', 'v');
    expect(store.getItem('k')).toBe('v');
    expect(store.length).toBe(1);
    store.removeItem('k');
    expect(store.getItem('k')).toBeNull();
  });
});
