import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Doctrine under test: a missing rate is `null` plus a declared absence, never a number.
 *
 * `copilot:trigger-proactive-eval` used to answer `params?.parallelRate ?? 78.5`,
 * `params?.bcvRate ?? 65.5` and `params?.spotUsdt ?? 1.0`. The renderer polls this channel, so an
 * absent measurement silently became a live-looking evaluation: a 19.85% gap and a permanently
 * "pegged" USDT, both indistinguishable from a real reading.
 */

const { ipcHandlers } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (event: unknown, params?: unknown) => unknown>(),
}));

const isEncryptionAvailableMock = vi.fn(() => false);
const encryptStringMock = vi.fn((plain: string) => Buffer.from(`enc:${plain}`));
const decryptStringMock = vi.fn((buf: Buffer) => buf.toString().replace(/^enc:/, ''));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, params?: unknown) => unknown) => {
      ipcHandlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      ipcHandlers.delete(channel);
    },
  },
  app: { getVersion: () => '0.0.0', getPath: () => '.', isPackaged: false },
  net: { fetch: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => isEncryptionAvailableMock(),
    encryptString: (plain: string) => encryptStringMock(plain),
    decryptString: (buf: Buffer) => decryptStringMock(buf),
  },
  desktopCapturer: { getSources: async () => [] },
}));

const { registerIpcHandlers, getDbService } = await import('./handlers');
const { net } = await import('electron');

interface ProactiveEvalResult {
  macroAlert: unknown;
  depegAlert: unknown;
  unavailable?: { measurement: string; reason: string; expectedSource: string }[];
}

function invoke(params?: unknown): Promise<ProactiveEvalResult> {
  const handler = ipcHandlers.get('copilot:trigger-proactive-eval');
  if (!handler) throw new Error('copilot:trigger-proactive-eval no quedó registrado');
  return handler(null, params) as Promise<ProactiveEvalResult>;
}

describe('copilot:trigger-proactive-eval — sin medición no hay número', () => {
  beforeEach(() => {
    registerIpcHandlers();
  });

  it('declara la ausencia de las tres mediciones y no emite alerta', async () => {
    const res = await invoke(undefined);

    expect(res.macroAlert).toBeNull();
    expect(res.depegAlert).toBeNull();
    expect(res.unavailable).toBeDefined();
    // Sorted on the expected side too, so the assertion checks the set rather than the order
    // the handler happens to push them in.
    expect(res.unavailable?.map((u) => u.measurement).sort()).toEqual(
      ['parallelRate', 'bcvRate', 'spotUsdt'].sort(),
    );
  });

  it('cada ausencia nombra la fuente real que la satisfaría', async () => {
    const res = await invoke(undefined);
    const byMeasurement = new Map(res.unavailable?.map((u) => [u.measurement, u]));

    // MCP get_bcv_rates and get_parallel_rates are registered tools in this process.
    expect(byMeasurement.get('bcvRate')?.expectedSource).toMatch(/get_bcv_rates/);
    expect(byMeasurement.get('parallelRate')?.expectedSource).toMatch(/get_parallel_rates/);
    expect(byMeasurement.get('spotUsdt')?.expectedSource).toMatch(/USDTUSD/);
  });

  it('nunca filtra las tasas inventadas 78.5 / 65.5 / 1.0 por el canal', async () => {
    const res = await invoke({});

    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('78.5');
    expect(serialized).not.toContain('65.5');
  });

  it('sigue evaluando de verdad cuando el llamador trae las tres mediciones', async () => {
    // paralel 90 / BCV 60 -> 50% gap, well above the 28% CRITICAL_DISPERSION threshold.
    const res = await invoke({ parallelRate: 90, bcvRate: 60, spotUsdt: 0.98 });

    const macro = res.macroAlert as { type: string; data: Record<string, number> } | null;
    expect(macro?.type).toBe('BCV_GAP_ANOMALY');
    expect(macro?.data.parallelRate).toBe(90);
    expect(macro?.data.bcvRate).toBe(60);
    expect(res.depegAlert).not.toBeNull();
    expect(res.unavailable).toBeUndefined();
  });

  it('no evalúa el despeg contra una paridad que el llamador no envió', async () => {
    // The old `?? 1.0` was indistinguishable from a real spot reading: USDT's peg value, fed to
    // `evaluateUsdtDepegEvent` as if it were a measurement, made that monitor permanently silent
    // while reporting "checked". With no spot sent, the leg must be a declared absence instead.
    const res = await invoke({ parallelRate: 90, bcvRate: 60 });

    expect(res.depegAlert).toBeNull();
    const spot = res.unavailable?.find((u) => u.measurement === 'spotUsdt');
    expect(spot).toBeDefined();
    expect(spot?.expectedSource).toMatch(/USDTUSD/);
    // Only the spot leg is absent. The macro leg's two rates were both sent, so it is
    // evaluated for real — its own cooldown dedup may still suppress the alert, which is why
    // that leg is asserted in the previous test with a fresh gap instead of here.
    const missing = new Set(res.unavailable?.map((u) => u.measurement));
    expect([...missing]).toEqual(['spotUsdt']);
  });
});

describe('p2p:fetch-cotizave — puente COTIZAVE_API_KEY y persistencia segura', () => {
  beforeEach(() => {
    isEncryptionAvailableMock.mockReturnValue(false);
    encryptStringMock.mockClear();
    decryptStringMock.mockClear();
    delete process.env['COTIZAVE_API_KEY'];
    registerIpcHandlers();
  });

  afterEach(() => {
    delete process.env['COTIZAVE_API_KEY'];
  });

  function invokeCotizave(req: unknown): Promise<unknown> {
    const handler = ipcHandlers.get('p2p:fetch-cotizave');
    if (!handler) throw new Error('p2p:fetch-cotizave no quedó registrado');
    return handler(null, req) as Promise<unknown>;
  }

  it('rechaza llamadas sin API key o con clave en blanco', async () => {
    await expect(invokeCotizave(null)).rejects.toThrow(/Cotizave API key is required/);
    await expect(invokeCotizave({ apiKey: '   ', endpoint: 'rates' })).rejects.toThrow(
      /Cotizave API key is required/,
    );
  });

  it('rechaza endpoints distintos a "rates"', async () => {
    await expect(
      invokeCotizave({ apiKey: 'cz_test_key', endpoint: 'historical' }),
    ).rejects.toThrow(/Cotizave endpoint must be "rates"/);
  });

  it('inyecta COTIZAVE_API_KEY en process.env con el valor normalizado (trim)', async () => {
    const mockJson = { rates: [] };
    vi.mocked(net.fetch).mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => mockJson,
    } as unknown as Response);

    const res = await invokeCotizave({ apiKey: '  cz_secret_live_key  ', endpoint: 'rates' });
    expect(res).toEqual(mockJson);
    expect(process.env['COTIZAVE_API_KEY']).toBe('cz_secret_live_key');
  });

  it('persiste la credencial cifrada en SQLite cuando safeStorage está disponible', async () => {
    isEncryptionAvailableMock.mockReturnValue(true);
    const mockJson = { rates: [] };
    vi.mocked(net.fetch).mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => mockJson,
    } as unknown as Response);

    await invokeCotizave({ apiKey: 'cz_secret_persisted', endpoint: 'rates' });

    const db = getDbService();
    expect(db.getConfigValue('cotizave_api_key_scheme')).toBe('safeStorage:v1');
    expect(db.getConfigValue('cotizave_api_key')).not.toContain('cz_secret_persisted');
    expect(encryptStringMock).toHaveBeenCalledWith('cz_secret_persisted');
  });

  it('hidrata COTIZAVE_API_KEY al arrancar registerIpcHandlers si estaba persistida', async () => {
    isEncryptionAvailableMock.mockReturnValue(true);
    const { encryptSecret } = await import('../db/secret-store');
    const db = getDbService();
    db.setConfigValue('cotizave_api_key', encryptSecret('cz_from_disk_123'));
    db.setConfigValue('cotizave_api_key_scheme', 'safeStorage:v1');

    delete process.env['COTIZAVE_API_KEY'];
    registerIpcHandlers();

    expect(process.env['COTIZAVE_API_KEY']).toBe('cz_from_disk_123');
  });
});
