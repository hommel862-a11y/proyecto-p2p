import { describe, it, expect } from 'vitest';
import {
  canonicalJsonStringify,
  computeSha256,
  createChecksummedBackup,
  verifyBackupIntegrity,
  type ChecksummedBackup,
} from './backup-encryption';

describe('backup-encryption', () => {
  it('should deterministically stringify JSON regardless of key order', () => {
    const objA = { b: 2, a: 1, c: { z: 9, y: 8 } };
    const objB = { a: 1, c: { y: 8, z: 9 }, b: 2 };

    const strA = canonicalJsonStringify(objA);
    const strB = canonicalJsonStringify(objB);

    expect(strA).toBe(strB);
    expect(strA).toBe('{"a":1,"b":2,"c":{"y":8,"z":9}}');
  });

  it('should compute consistent SHA-256 hashes', () => {
    const hashEmpty = computeSha256('');
    // Standard SHA-256 for empty string: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hashEmpty).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    const hashTest = computeSha256('hello world');
    // Standard SHA-256 for 'hello world': b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    expect(hashTest).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('should bundle payload and verify integrity successfully', () => {
    const data = {
      operations: [{ id: 'op-1', amount: 500, price: 105.2 }],
      accounts: [{ id: 'acc-1', bank: 'Banesco' }],
    };

    const backup = createChecksummedBackup(data);
    expect(backup.format).toBe('p2p-backup-v2');
    expect(backup.version).toBe(2);
    expect(backup.checksumSha256.length).toBe(64);

    const result = verifyBackupIntegrity(backup);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should detect data tampering or corruptions', () => {
    const data = { count: 10 };
    const backup = createChecksummedBackup(data);

    // Tamper with payload
    const tampered = {
      ...backup,
      payload: { count: 9999 },
    } as ChecksummedBackup<typeof data>;

    const result = verifyBackupIntegrity(tampered);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Fallo de integridad');
  });

  it('should reject invalid backup formats', () => {
    const invalid = { format: 'unknown-v1', payload: {} } as unknown as ChecksummedBackup;
    const result = verifyBackupIntegrity(invalid);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Formato de backup desconocido');
  });
});
