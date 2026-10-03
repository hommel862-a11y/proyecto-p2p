/**
 * OS-backed encryption for locally persisted credentials.
 *
 * The API key used to be written to `app_config_kv` as plain text, so any
 * process with filesystem access to the Electron user-data directory could read
 * it. `safeStorage` delegates to DPAPI on Windows, the Keychain on macOS and
 * libsecret/kwallet on Linux, which binds the ciphertext to the logged-in user.
 *
 * Every function degrades fail-closed: when the OS keystore is unavailable the
 * caller must not persist the secret at all.
 */
import { safeStorage } from 'electron';

/** Scheme tag persisted alongside the ciphertext so reads can reject plaintext. */
export const SECRET_SCHEME = 'safeStorage:v1';

/** Marks a key as deliberately not persisted because encryption was unavailable. */
export const SECRET_SCHEME_UNAVAILABLE = 'memory-only:v1';

export function isSecretStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  return safeStorage.encryptString(plaintext).toString('base64');
}

export function decryptSecret(encoded: string): string {
  return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
}