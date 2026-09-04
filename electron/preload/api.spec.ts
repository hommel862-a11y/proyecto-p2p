import { describe, it, expect } from 'vitest';
import { createP2PApi, EXPOSED_API_KEYS, ALLOWED_CHANNELS } from './api';

describe('Electron preload bridge (secure IPC)', () => {
  it('exposes only the narrow allow-listed API surface', () => {
    const api = createP2PApi(() => Promise.resolve('1.0.0'));
    expect(Object.keys(api).sort()).toEqual([...EXPOSED_API_KEYS].sort());
    // No raw ipcRenderer / node primitives are ever exposed to the renderer.
    expect(Object.keys(api)).not.toContain('ipcRenderer');
  });

  it('forwards getVersion to the app:get-version channel only', async () => {
    const calls: string[] = [];
    const api = createP2PApi((channel) => {
      calls.push(channel);
      return Promise.resolve('9.9.9');
    });
    const version = await api.getVersion();
    expect(calls).toEqual(['app:get-version']);
    expect(version).toBe('9.9.9');
  });

  it('forwards fetchBinanceP2p to the p2p:fetch-binance channel', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const api = createP2PApi((channel, ...args) => {
      calls.push({ channel, args });
      return Promise.resolve({ data: [] });
    });
    const res = await api.fetchBinanceP2p({ asset: 'USDT', fiat: 'VES', tradeType: 'BUY' });
    expect(calls).toEqual([
      { channel: 'p2p:fetch-binance', args: [{ asset: 'USDT', fiat: 'VES', tradeType: 'BUY' }] },
    ]);
    expect(res).toEqual({ data: [] });
  });

  it('keeps domain math out of IPC (consumed directly from @p2p/core in the web bundle)', () => {
    // No channel carries spread/income/rules payloads — those live in core.
    expect((ALLOWED_CHANNELS as readonly string[]).filter((c) => c.startsWith('core:'))).toHaveLength(0);
  });
});
