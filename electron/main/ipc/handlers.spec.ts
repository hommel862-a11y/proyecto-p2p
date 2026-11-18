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

const { registerIpcHandlers, getDbService, fetchBinanceP2pShared } = await import('./handlers');
const {
  clearFinancialSkillMarketData,
  getMarketBook,
  getVolatilityTicks,
  recordVolatilityTick,
} = await import('../skills/market-state');
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

  it('deduplica llamadas concurrentes en vuelo (singleflight) para evitar ráfagas HTTP 429', async () => {
    vi.mocked(net.fetch).mockClear();
    const mockJson = { rates: [{ market: 'reference', mid: 36.5 }] };
    let resolveFetch!: (value: Response) => void;
    vi.mocked(net.fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const p1 = invokeCotizave({ apiKey: 'cz_singleflight_key', endpoint: 'rates' });
    const p2 = invokeCotizave({ apiKey: 'cz_singleflight_key', endpoint: 'rates' });
    const p3 = invokeCotizave({ apiKey: 'cz_singleflight_key', endpoint: 'rates' });

    resolveFetch({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => mockJson,
    } as unknown as Response);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toEqual(mockJson);
    expect(r2).toEqual(mockJson);
    expect(r3).toEqual(mockJson);
    expect(net.fetch).toHaveBeenCalledTimes(1);
  });

  it('normaliza prefijos/comillas al enviar X-API-Key e incluye detalle JSON en errores HTTP 401', async () => {
    vi.mocked(net.fetch).mockClear();
    vi.mocked(net.fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({
        code: 'invalid_api_key',
        message: 'API key is missing, invalid, or revoked.',
      }),
    } as unknown as Response);

    await expect(
      invokeCotizave({ apiKey: '  X-API-Key: "cz_pasted_key" \u200B ', endpoint: 'rates' }),
    ).rejects.toThrow(/Cotizave HTTP Error 401: \[invalid_api_key\]/);

    expect(process.env['COTIZAVE_API_KEY']).toBe('cz_pasted_key');
    const [, init] = vi.mocked(net.fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('cz_pasted_key');
  });
});

describe('fetchBinanceP2pShared — caché seguro, aislamiento por payTypes y ordenamiento', () => {
  beforeEach(() => {
    vi.mocked(net.fetch).mockReset();
    clearFinancialSkillMarketData();
    const ticks = getVolatilityTicks();
    while (ticks.length > 0) ticks.shift();
    recordVolatilityTick(0, 0);
    registerIpcHandlers();
  });

  it('NO escribe respuestas de error o inválidas en binanceIpcCache', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: '000002', message: 'rate error', data: null }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: '000000',
          data: [{ adv: { advNo: '1', price: '89.50', maxSingleTransAmount: '100000' } }],
        }),
      } as unknown as Response);

    await fetchBinanceP2pShared({ asset: 'USDT', fiat: 'VES', tradeType: 'BUY', payTypes: [], rows: 10 });
    const second = (await fetchBinanceP2pShared({
      asset: 'USDT',
      fiat: 'VES',
      tradeType: 'BUY',
      payTypes: [],
      rows: 10,
    })) as { code?: string; data?: unknown[] };

    expect(net.fetch).toHaveBeenCalledTimes(2);
    expect(second.code).toBe('000000');
    expect(second.data).toHaveLength(1);
    expect(getMarketBook()?.bestBuyPrice).toBe(89.5);
  });

  it('NO contamina getMarketBook ni volatilityTicks cuando payTypes tiene filtro bancario', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: '000000',
          data: [{ adv: { advNo: 'b1', price: '95.00', maxSingleTransAmount: '100000' } }],
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: '000000',
          data: [{ adv: { advNo: 's1', price: '97.00', maxSingleTransAmount: '100000' } }],
        }),
      } as unknown as Response);

    await fetchBinanceP2pShared({
      asset: 'USDT',
      fiat: 'VES',
      tradeType: 'BUY',
      payTypes: ['Banesco'],
      rows: 10,
    });
    await fetchBinanceP2pShared({
      asset: 'USDT',
      fiat: 'VES',
      tradeType: 'SELL',
      payTypes: ['Banesco'],
      rows: 10,
    });

    expect(getMarketBook()).toBeNull();
    expect(getVolatilityTicks()).toHaveLength(0);
  });

  it('calcula askUsd/bidUsd usando min/max ordenado (no offers[0] sin ordenar) al persistir snapshot', async () => {
    const db = getDbService();
    const appendSpy = vi.spyOn(db.getDecisionJournal(), 'appendMarketSnapshot');

    vi.mocked(net.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: '000000',
          data: [
            { adv: { advNo: 'b1', price: '91.50', maxSingleTransAmount: '100000' } },
            { adv: { advNo: 'b2', price: '88.20', maxSingleTransAmount: '100000' } },
          ],
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: '000000',
          data: [
            { adv: { advNo: 's1', price: '89.10', maxSingleTransAmount: '100000' } },
            { adv: { advNo: 's2', price: '92.40', maxSingleTransAmount: '100000' } },
          ],
        }),
      } as unknown as Response);

    await fetchBinanceP2pShared({ asset: 'USDT', fiat: 'VES', tradeType: 'BUY', payTypes: [], rows: 10 });
    await fetchBinanceP2pShared({ asset: 'USDT', fiat: 'VES', tradeType: 'SELL', payTypes: [], rows: 10 });

    expect(appendSpy).toHaveBeenCalled();
    const lastCall = appendSpy.mock.calls.at(-1)?.[0];
    expect(lastCall?.askUsd).toBe(88.2);
    expect(lastCall?.bidUsd).toBe(92.4);
  });

  it('soporta cancelación limpia con AbortSignal abortado', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      (fetchBinanceP2pShared as (p: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown>)(
        { asset: 'USDT', fiat: 'VES', tradeType: 'BUY', payTypes: [], rows: 10 },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/abort/i);

    expect(net.fetch).not.toHaveBeenCalled();
  });
});
