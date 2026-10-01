import { describe, it, expect, beforeEach, vi } from 'vitest';

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

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, params?: unknown) => unknown) => {
      ipcHandlers.set(channel, fn);
    },
    removeHandler: () => {},
  },
  app: { getVersion: () => '0.0.0', getPath: () => '.', isPackaged: false },
  net: { fetch: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
  desktopCapturer: { getSources: async () => [] },
}));

const { registerIpcHandlers } = await import('./handlers');

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
