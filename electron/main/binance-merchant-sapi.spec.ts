import { createHmac } from 'node:crypto';
import * as http from 'node:http';
import { EventEmitter } from 'node:events';
import type * as net from 'node:net';
import type * as tls from 'node:tls';
import { describe, expect, it, vi } from 'vitest';
import {
  executeBinanceMerchantSapi,
  postViaConnectProxy,
} from './binance-merchant-sapi';
import { killswitchState, triggerKillswitch, resetKillswitch } from './ipc/killswitch-state';
import {
  saveBinanceVaultConfig,
  type ConfigKvStore,
  type SecretBackend,
} from './binance-vault-config';

function createMemoryKv(): ConfigKvStore {
  const map = new Map<string, string>();
  return {
    getConfigValue: (k) => map.get(k) ?? null,
    setConfigValue: (k, v) => void map.set(k, v),
    deleteConfigValue: (k) => void map.delete(k),
  };
}

function createFakeSecretBackend(): SecretBackend {
  return {
    isAvailable: () => true,
    encrypt: (plain) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`,
    decrypt: (cipher) => Buffer.from(cipher.slice(4), 'base64').toString('utf8'),
  };
}

describe('binance-merchant-sapi', () => {
  it('blocks STANDARD KYC accounts fail-closed BEFORE signing or opening sockets', async () => {
    const kv = createMemoryKv();
    const backend = createFakeSecretBackend();
    saveBinanceVaultConfig(
      kv,
      { apiKey: 'StandardKey123', apiSecret: 'StandardSecret123', merchantLevel: 'STANDARD' },
      backend,
    );
    const fetchMock = vi.fn();
    const proxyMock = vi.fn();

    const res = await executeBinanceMerchantSapi(
      kv,
      { action: 'UPDATE_AD', payload: { advNo: '11218246497340923904', price: 93.5 } },
      { fetchImpl: fetchMock, proxyPostImpl: proxyMock, backend },
    );

    expect(res.ok).toBe(false);
    expect(res.code).toBe('MERCHANT_TIER_REQUIRED_FOR_WRITE_SAPI');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(proxyMock).not.toHaveBeenCalled();
  });

  it('blocks write operations immediately when emergency killswitch is active', async () => {
    const kv = createMemoryKv();
    const backend = createFakeSecretBackend();
    saveBinanceVaultConfig(
      kv,
      { apiKey: 'GoldKey123', apiSecret: 'GoldSecret123', merchantLevel: 'GOLD' },
      backend,
    );
    const fetchMock = vi.fn();

    const res = await executeBinanceMerchantSapi(
      kv,
      { action: 'POST_AD', payload: { price: 94.1 } },
      { fetchImpl: fetchMock, backend, isKillswitchActive: () => true },
    );

    expect(res.ok).toBe(false);
    expect(res.code).toBe('KILLSWITCH_ACTIVE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs UPDATE_AD with HMAC-SHA256 and returns real Binance confirmation reference', async () => {
    const kv = createMemoryKv();
    const backend = createFakeSecretBackend();
    saveBinanceVaultConfig(
      kv,
      { apiKey: 'MerchantKey9999', apiSecret: 'MerchantSecret8888', merchantLevel: 'SILVER' },
      backend,
    );

    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ code: '000000', success: true, data: { advNo: '11218246497340923904' } }),
      };
    });

    const res = await executeBinanceMerchantSapi(
      kv,
      { action: 'UPDATE_AD', payload: { advNo: '11218246497340923904', price: 92.85 } },
      { fetchImpl: fetchMock, backend, nowMs: () => 1700000010000 },
    );

    expect(res.ok).toBe(true);
    expect(res.merchantRef).toBe('BN-C2C-11218246497340923904-1700000010000');
    expect(capturedHeaders['X-MBX-APIKEY']).toBe('MerchantKey9999');
    const expectedSig = createHmac('sha256', 'MerchantSecret8888')
      .update('timestamp=1700000010000&recvWindow=10000')
      .digest('hex');
    expect(capturedUrl).toContain(`signature=${expectedSig}`);
  });

  it('redacts apiKey, apiSecret, HMAC signature, and proxy password on errors', async () => {
    const kv = createMemoryKv();
    const backend = createFakeSecretBackend();
    saveBinanceVaultConfig(
      kv,
      {
        apiKey: 'LeakyKey1234',
        apiSecret: 'LeakySecret5678',
        merchantLevel: 'BRONZE',
        merchantProxyUrl: 'https://pxuser:pxSecret99@198.51.100.5:8443',
      },
      backend,
    );

    const proxyMock = vi.fn(async () => {
      throw new Error(
        'CONNECT https://pxuser:pxSecret99@198.51.100.5:8443 failed with LeakyKey1234 and signature=deadbeef123456 LeakySecret5678',
      );
    });

    const res = await executeBinanceMerchantSapi(
      kv,
      { action: 'UPDATE_STATUS', payload: { advNos: ['11218246497340923904'], advStatus: 1 } },
      { proxyPostImpl: proxyMock, backend },
    );

    expect(res.ok).toBe(false);
    expect(res.error).not.toContain('pxSecret99');
    expect(res.error).not.toContain('LeakyKey1234');
    expect(res.error).not.toContain('LeakySecret5678');
    expect(res.error).not.toContain('deadbeef123456');
  });

  it('establishes HTTP CONNECT tunnel with Basic auth and TLS 1.2+ certificate pinning', async () => {
    let connectAuthHeader: string | undefined;
    let connectPath = '';
    const openSockets = new Set<net.Socket>();
    const server = http.createServer();
    server.on('connect', (req, clientSocket) => {
      openSockets.add(clientSocket as net.Socket);
      connectPath = req.url ?? '';
      connectAuthHeader = req.headers['proxy-authorization'];
      clientSocket.on('close', () => openSockets.delete(clientSocket as net.Socket));
      clientSocket.on('error', () => clientSocket.destroy());
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as net.AddressInfo;

    const tlsOptsSeen: Array<{ servername?: string; minVersion?: string; rejectUnauthorized?: boolean }> = [];
    const fakeTlsFn = ((opts: tls.ConnectionOptions) => {
      tlsOptsSeen.push({
        servername: opts.servername,
        minVersion: opts.minVersion,
        rejectUnauthorized: opts.rejectUnauthorized,
      });
      const emitter = new EventEmitter() as tls.TLSSocket;
      (emitter as { destroyed: boolean }).destroyed = false;
      (emitter as { destroy: () => tls.TLSSocket }).destroy = () => {
        (emitter as { destroyed: boolean }).destroyed = true;
        opts.socket?.destroy();
        return emitter;
      };
      // Trigger TLS failure cleanly after verifying pin options so we inspect them deterministically
      queueMicrotask(() => emitter.emit('error', new Error('PIN_INSPECTED')));
      return emitter;
    }) as unknown as typeof tls.connect;

    try {
      await expect(
        postViaConnectProxy({
          proxyUrl: `http://ops:secretPass@127.0.0.1:${addr.port}`,
          targetHost: 'api.binance.com',
          targetPort: 443,
          pathWithQuery: '/sapi/v1/c2c/ads/update?timestamp=1&recvWindow=10000&signature=abc',
          headers: { 'X-MBX-APIKEY': 'k', 'Content-Type': 'application/json' },
          bodyJson: '{}',
          timeoutMs: 3000,
          tlsConnectFn: fakeTlsFn,
        }),
      ).rejects.toThrow(/PIN_INSPECTED/);

      expect(connectPath).toBe('api.binance.com:443');
      expect(connectAuthHeader).toBe(
        `Basic ${Buffer.from('ops:secretPass', 'utf8').toString('base64')}`,
      );
      expect(tlsOptsSeen[0]).toEqual({
        servername: 'api.binance.com',
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      });
    } finally {
      for (const s of openSockets) {
        s.destroy();
      }
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects non-200 CONNECT proxy responses with PROXY_TUNNEL_ERROR', async () => {
    const server = http.createServer();
    server.on('connect', (_req, clientSocket) => {
      clientSocket.on('error', () => clientSocket.destroy());
      clientSocket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as net.AddressInfo;

    try {
      await expect(
        postViaConnectProxy({
          proxyUrl: `http://127.0.0.1:${addr.port}`,
          targetHost: 'api.binance.com',
          targetPort: 443,
          pathWithQuery: '/sapi/v1/c2c/ads/update?timestamp=1&recvWindow=10000&signature=abc',
          headers: { 'X-MBX-APIKEY': 'k', 'Content-Type': 'application/json' },
          bodyJson: '{}',
          timeoutMs: 3000,
        }),
      ).rejects.toThrow(/PROXY_TUNNEL_ERROR: CONNECT rejected with HTTP 407/);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects prototype-chain action keys fail-closed before signing or opening sockets', async () => {
    const kv = createMemoryKv();
    const backend = createFakeSecretBackend();
    saveBinanceVaultConfig(
      kv,
      { apiKey: 'GoldKey123', apiSecret: 'GoldSecret123', merchantLevel: 'GOLD' },
      backend,
    );
    const fetchMock = vi.fn();

    const res = await executeBinanceMerchantSapi(
      kv,
      { action: 'toString' as unknown as 'UPDATE_AD' },
      { fetchImpl: fetchMock, backend },
    );

    expect(res.ok).toBe(false);
    expect(res.code).toBe('INVALID_REQUEST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces process killswitch singleton even when deps.isKillswitchActive is omitted', async () => {
    const kv = createMemoryKv();
    const backend = createFakeSecretBackend();
    saveBinanceVaultConfig(
      kv,
      { apiKey: 'GoldKey123', apiSecret: 'GoldSecret123', merchantLevel: 'GOLD' },
      backend,
    );
    const fetchMock = vi.fn();
    triggerKillswitch('Test emergency stop', 'SPEC');
    try {
      expect(killswitchState.isTriggered).toBe(true);
      const res = await executeBinanceMerchantSapi(
        kv,
        { action: 'UPDATE_AD', payload: { advNo: '123', price: 93 } },
        { fetchImpl: fetchMock, backend },
      );
      expect(res.ok).toBe(false);
      expect(res.code).toBe('KILLSWITCH_ACTIVE');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      resetKillswitch();
    }
  });

  it('redacts Base64 proxy Basic token and JSON-quoted headers in errors', async () => {
    const kv = createMemoryKv();
    const backend = createFakeSecretBackend();
    saveBinanceVaultConfig(
      kv,
      {
        apiKey: 'VaultKey9876',
        apiSecret: 'VaultSecret6543',
        merchantLevel: 'GOLD',
        merchantProxyUrl: 'https://pxUser:pxPass99@198.51.100.2:8443',
      },
      backend,
    );
    const b64Token = Buffer.from('pxUser:pxPass99', 'utf8').toString('base64');
    const proxyMock = vi.fn(async () => {
      throw new Error(
        `{"Proxy-Authorization":"Basic ${b64Token}","X-MBX-APIKEY":"VaultKey9876"} pxPass99`,
      );
    });

    const res = await executeBinanceMerchantSapi(
      kv,
      { action: 'UPDATE_AD', payload: { advNo: '123', price: 93 } },
      { proxyPostImpl: proxyMock, backend },
    );

    expect(res.ok).toBe(false);
    expect(res.error).not.toContain(b64Token);
    expect(res.error).not.toContain('pxPass99');
    expect(res.error).not.toContain('VaultKey9876');
  });
});
