import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Credential-storage contract for the Gemini API key.
 *
 * The key used to be written to `app_config_kv` as plain text, so anything with
 * filesystem access to the Electron user-data directory could read it. These
 * tests pin the fail-closed behavior: encrypt when the OS keystore is
 * available, never persist when it is not, and never return a legacy plaintext
 * row.
 */

const encryptStringMock = vi.fn((plain: string) => Buffer.from(`enc:${plain}`));
const decryptStringMock = vi.fn((buf: Buffer) => buf.toString().replace(/^enc:/, ''));
const isEncryptionAvailableMock = vi.fn(() => true);

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => isEncryptionAvailableMock(),
    encryptString: (plain: string) => encryptStringMock(plain),
    decryptString: (buf: Buffer) => decryptStringMock(buf),
  },
}));

const SECRET_PATH = '../db/secret-store';
const ORCH_PATH = '../gemini-orchestrator';

describe('credential storage: Gemini API key', () => {
  beforeEach(() => {
    encryptStringMock.mockClear();
    decryptStringMock.mockClear();
    isEncryptionAvailableMock.mockReturnValue(true);
    delete process.env['GEMINI_API_KEY'];
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env['GEMINI_API_KEY'];
  });

  it('NUNCA persiste la API key en texto plano cuando safeStorage está disponible', async () => {
    const { SECRET_SCHEME: scheme } = await import(SECRET_PATH);
    const { P2PDatabaseService } = await import('./database');
    const { GeminiOrchestrator } = await import(ORCH_PATH);

    const db = new P2PDatabaseService(':memory:');
    const orchestrator = new GeminiOrchestrator(db);
    orchestrator.setApiKey('sk-SECRET-123');

    const stored = db.getConfigValue('gemini_api_key');
    expect(stored).toBeDefined();
    expect(stored).not.toContain('sk-SECRET-123');
    expect(db.getConfigValue('gemini_api_key_scheme')).toBe(scheme);
    expect(encryptStringMock).toHaveBeenCalledWith('sk-SECRET-123');
    expect(orchestrator.getEffectiveApiKey()).toBe('sk-SECRET-123');
    db.close();
    // Runs ~1.1s isolated, but exceeds the 5s default when the full Electron
    // suite loads all 18 files concurrently (dynamic imports + real SQLite).
  }, 20_000);

  it('NO persiste la API key en disco cuando el cifrado del SO no está disponible', async () => {
    isEncryptionAvailableMock.mockReturnValue(false);
    const { SECRET_SCHEME_UNAVAILABLE: unavailable } = await import(SECRET_PATH);
    const { P2PDatabaseService } = await import('./database');
    const { GeminiOrchestrator } = await import(ORCH_PATH);

    const db = new P2PDatabaseService(':memory:');
    const orchestrator = new GeminiOrchestrator(db);
    orchestrator.setApiKey('sk-SECRET-456');

    expect(db.getConfigValue('gemini_api_key')).toBeNull();
    expect(db.getConfigValue('gemini_api_key_scheme')).toBe(unavailable);
    // Sigue funcionando en memoria para esta sesión, pero nada queda en disco.
    expect(orchestrator.getEffectiveApiKey()).toBe('sk-SECRET-456');
    db.close();
  });

  it('DESCARTA una fila legacy en texto plano en vez de devolverla', async () => {
    const { P2PDatabaseService } = await import('./database');
    const { GeminiOrchestrator } = await import(ORCH_PATH);

    const db = new P2PDatabaseService(':memory:');
    db.setConfigValue('gemini_api_key', 'sk-LEGACY-PLAINTEXT');
    // Sin `gemini_api_key_scheme`: es una fila de la versión anterior.

    const orchestrator = new GeminiOrchestrator(db);
    expect(orchestrator.getEffectiveApiKey()).toBeUndefined();
    expect(db.getConfigValue('gemini_api_key')).toBeNull();
    db.close();
  });

  it('DESCARTA la credencial si el descifrado falla', async () => {
    const { SECRET_SCHEME: scheme } = await import(SECRET_PATH);
    const { P2PDatabaseService } = await import('./database');
    const { GeminiOrchestrator } = await import(ORCH_PATH);

    const db = new P2PDatabaseService(':memory:');
    db.setConfigValue('gemini_api_key', 'Y2lwaGVydGV4dC1jb3JydXB0ZWQ=');
    db.setConfigValue('gemini_api_key_scheme', scheme);
    decryptStringMock.mockImplementationOnce(() => {
      throw new Error('keystore locked');
    });

    const orchestrator = new GeminiOrchestrator(db);
    expect(orchestrator.getEffectiveApiKey()).toBeUndefined();
    expect(db.getConfigValue('gemini_api_key')).toBeNull();
    db.close();
  });
});