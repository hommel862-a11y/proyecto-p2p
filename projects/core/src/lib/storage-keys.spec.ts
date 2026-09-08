import { describe, it, expect } from 'vitest';
import { OPS_KEY } from './storage-keys';

describe('storage-keys', () => {
  it('exposes the ops ledger key', () => {
    expect(OPS_KEY).toBe('p2p.operations');
  });
});
