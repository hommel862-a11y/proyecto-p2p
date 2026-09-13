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

  it('forwards crypto methods to the allow-listed crypto:* channels', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const api = createP2PApi((channel, ...args) => {
      calls.push({ channel, args });
      if (channel === 'crypto:is-available') return Promise.resolve(true);
      if (channel === 'crypto:encrypt') return Promise.resolve('encrypted_base64');
      if (channel === 'crypto:decrypt') return Promise.resolve('plaintext_secret');
      return Promise.resolve(null);
    });

    const isAvail = await api.crypto.isAvailable();
    const encrypted = await api.crypto.encrypt('my_api_key');
    const decrypted = await api.crypto.decrypt('encrypted_base64');

    expect(isAvail).toBe(true);
    expect(encrypted).toBe('encrypted_base64');
    expect(decrypted).toBe('plaintext_secret');
    expect(calls).toEqual([
      { channel: 'crypto:is-available', args: [] },
      { channel: 'crypto:encrypt', args: ['my_api_key'] },
      { channel: 'crypto:decrypt', args: ['encrypted_base64'] },
    ]);
  });

  it('forwards db and killswitch methods to their respective IPC channels', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const api = createP2PApi((channel, ...args) => {
      calls.push({ channel, args });
      if (channel === 'p2p:db-save-order') return Promise.resolve(true);
      if (channel === 'p2p:killswitch-trigger') return Promise.resolve(true);
      return Promise.resolve(null);
    });

    await api.db.saveOrder({ orderId: 'ORD-1' });
    await api.killswitch.trigger({ reason: 'Emergencia' });

    expect(calls).toEqual([
      { channel: 'p2p:db-save-order', args: [{ orderId: 'ORD-1' }] },
      { channel: 'p2p:killswitch-trigger', args: [{ reason: 'Emergencia' }] },
    ]);
  });

  it('forwards copilot methods to copilot:* IPC channels', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const api = createP2PApi((channel, ...args) => {
      calls.push({ channel, args });
      if (channel === 'copilot:send-message') return Promise.resolve({ reply: 'ok' });
      if (channel === 'copilot:execute-plan') return Promise.resolve({ success: true });
      return Promise.resolve([]);
    });

    await api.copilot.sendMessage({ prompt: 'analizar mercado' });
    await api.copilot.executePlan({ planId: 'PLAN-123' });
    await api.copilot.getWatcherStatus();
    await api.copilot.setWatcherConfig({ enabled: false, minNetSpreadPct: 1.5 });

    expect(calls).toEqual([
      { channel: 'copilot:send-message', args: [{ prompt: 'analizar mercado' }] },
      { channel: 'copilot:execute-plan', args: [{ planId: 'PLAN-123' }] },
      { channel: 'copilot:get-watcher-status', args: [] },
      { channel: 'copilot:set-watcher-config', args: [{ enabled: false, minNetSpreadPct: 1.5 }] },
    ]);
  });

  it('forwards screenPipe methods to p2p:screen-pipe-* channels', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const api = createP2PApi((channel, ...args) => {
      calls.push({ channel, args });
      if (channel === 'p2p:screen-pipe-sources') return Promise.resolve([{ id: 'src-1', name: 'Screen 1' }]);
      if (channel === 'p2p:screen-pipe-capture') return Promise.resolve({ dataUrl: 'data:...', timestampMs: 12345 });
      return Promise.resolve(null);
    });

    const sources = await api.screenPipe.getSources();
    const capture = await api.screenPipe.capture('src-1');

    expect(sources).toEqual([{ id: 'src-1', name: 'Screen 1' }]);
    expect(capture).toEqual({ dataUrl: 'data:...', timestampMs: 12345 });
    expect(calls).toEqual([
      { channel: 'p2p:screen-pipe-sources', args: [] },
      { channel: 'p2p:screen-pipe-capture', args: [{ sourceId: 'src-1' }] },
    ]);
  });

  it('forwards mcp methods to p2p:mcp-* channels', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const api = createP2PApi((channel, ...args) => {
      calls.push({ channel, args });
      if (channel === 'p2p:mcp-status') {
        return Promise.resolve({ servers: [], recentAuditLogs: [], totalCallsServed: 0, activeTransport: 'stdio' });
      }
      if (channel === 'p2p:mcp-test-tool') {
        return Promise.resolve({ success: true, executionTimeMs: 12 });
      }
      return Promise.resolve(null);
    });

    const status = await api.mcp.getStatus();
    const testResult = await api.mcp.testTool('calculate_spread', { buyPrice: 100, sellPrice: 101 });

    expect(status.activeTransport).toBe('stdio');
    expect(testResult.success).toBe(true);
    expect(calls).toEqual([
      { channel: 'p2p:mcp-status', args: [] },
      { channel: 'p2p:mcp-test-tool', args: [{ toolName: 'calculate_spread', args: { buyPrice: 100, sellPrice: 101 } }] },
    ]);
  });

  it('keeps domain math out of IPC (consumed directly from @p2p/core in the web bundle)', () => {
    // No channel carries spread/income/rules payloads — those live in core.
    expect((ALLOWED_CHANNELS as readonly string[]).filter((c) => c.startsWith('core:'))).toHaveLength(0);
  });
});

