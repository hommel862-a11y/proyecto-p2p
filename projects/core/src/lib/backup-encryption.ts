/**
 * Pure domain logic and cryptographic integrity engine for P2P Backups.
 * Includes deterministic SHA-256 checksumming and PBKDF2 + AES-GCM vault export.
 */

export interface ChecksummedBackup<T = unknown> {
  format: 'p2p-backup-v2';
  version: number;
  createdAt: string;
  checksumSha256: string;
  payload: T;
}

export interface VerificationResult {
  isValid: boolean;
  expectedChecksum: string;
  actualChecksum: string;
  error?: string;
}

export interface EncryptedBackupEnvelope {
  format: 'p2p-encrypted-v1';
  version: number;
  algorithm: 'AES-256-GCM';
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await (globalThis.crypto as Crypto).subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );
  return (globalThis.crypto as Crypto).subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackupAES256(
  password: string,
  payload: string,
): Promise<EncryptedBackupEnvelope> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await (globalThis.crypto as Crypto).subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    encoder.encode(payload),
  );
  return {
    format: 'p2p-encrypted-v1',
    version: 1,
    algorithm: 'AES-256-GCM',
    salt: btoa(String.fromCharCode(...new Uint8Array(salt))),
    iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    createdAt: new Date().toISOString(),
  };
}

export async function decryptBackupAES256(
  password: string,
  envelope: EncryptedBackupEnvelope,
): Promise<string> {
  const salt = Uint8Array.from(atob(envelope.salt), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(envelope.iv), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(envelope.ciphertext), (c) => c.charCodeAt(0));
  const key = await deriveKey(password, salt);
  const decrypted = await (globalThis.crypto as Crypto).subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Deterministic JSON serialization with sorted keys to ensure reproducible hashes.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalJsonStringify(item)).join(',') + ']';
  }

  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`,
  );
  return '{' + entries.join(',') + '}';
}

/**
 * Pure TypeScript SHA-256 implementation (zero external dependencies).
 */
export function computeSha256(message: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const words: number[] = [];
  const messageLength = message.length * 8;

  const K: number[] = [];
  const H: number[] = [];

  let primeCounter = 0;
  const isPrime = (n: number) => {
    for (let factor = 2; factor * factor <= n; factor++) {
      if (n % factor === 0) return false;
    }
    return true;
  };

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (isPrime(candidate)) {
      if (primeCounter < 8) {
        H[primeCounter] = ((mathPow(candidate, 1 / 2) * maxWord) | 0) >>> 0;
      }
      K[primeCounter] = ((mathPow(candidate, 1 / 3) * maxWord) | 0) >>> 0;
      primeCounter++;
    }
  }

  for (let i = 0; i < message.length; i++) {
    const code = message.charCodeAt(i);
    const wordIdx = i >> 2;
    words[wordIdx] = (words[wordIdx] || 0) | ((code & 0xff) << (24 - (i % 4) * 8));
  }

  // Padding
  const appendIdx = message.length >> 2;
  words[appendIdx] = (words[appendIdx] || 0) | (0x80 << (24 - (message.length % 4) * 8));
  const wordsLen = (((message.length + 8) >> 6) + 1) * 16;
  words[wordsLen - 1] = messageLength;

  for (let i = 0; i < wordsLen; i += 16) {
    const w = new Array<number>(64);
    for (let t = 0; t < 16; t++) {
      w[t] = words[i + t] || 0;
    }

    for (let t = 16; t < 64; t++) {
      const s0 = rightRotate(w[t - 15], 7) ^ rightRotate(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rightRotate(w[t - 2], 17) ^ rightRotate(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (((w[t - 16] + s0) | 0) + ((w[t - 7] + s1) | 0)) | 0;
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];

    for (let t = 0; t < 64; t++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = ((((h + S1) | 0) + ch) | 0) + ((K[t] + w[t]) | 0);
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += (H[i] >>> 0).toString(16).padStart(8, '0');
  }
  return hex;
}

/**
 * Creates a checksummed backup bundle with SHA-256 hash.
 */
export function createChecksummedBackup<T>(payload: T): ChecksummedBackup<T> {
  const canonical = canonicalJsonStringify(payload);
  const hash = computeSha256(canonical);

  return {
    format: 'p2p-backup-v2',
    version: 2,
    createdAt: new Date().toISOString(),
    checksumSha256: hash,
    payload,
  };
}

/**
 * Validates the cryptographic integrity of a backup bundle.
 */
export function verifyBackupIntegrity<T>(backup: ChecksummedBackup<T>): VerificationResult {
  if (!backup || backup.format !== 'p2p-backup-v2') {
    return {
      isValid: false,
      expectedChecksum: backup?.checksumSha256 ?? '',
      actualChecksum: '',
      error: 'Formato de backup desconocido o incompatible',
    };
  }

  const canonical = canonicalJsonStringify(backup.payload);
  const actualHash = computeSha256(canonical);

  const isValid = actualHash === backup.checksumSha256;
  return {
    isValid,
    expectedChecksum: backup.checksumSha256,
    actualChecksum: actualHash,
    error: isValid
      ? undefined
      : 'Fallo de integridad: los datos fueron alterados o están corruptos',
  };
}
