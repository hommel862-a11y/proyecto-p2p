import { describe, expect, it, vi } from 'vitest';
import {
  BINANCE_KV_KEYS,
  clearBinanceVaultConfig,
  getBinanceVaultStatus,
  redactSensitiveSecrets,
  readDecryptedBinanceVaultCredentials,
  saveBinanceVaultConfig,
  syncBinanceC2cOrdersFromVault,
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

function createFakeSecretBackend(available = true): SecretBackend {
  return {
    isAvailable: () => available,
    encrypt: (plain) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`,
    decrypt: (cipher) => {
      if (!cipher.startsWith('enc:')) throw new Error('bad cipher');
      return Buffer.from(cipher.slice(4), 'base64').toString('utf8');
    },
  };
}

describe('binance-vault-config', () => {
  it('encrypts secrets, validates proxy URLs, and never exposes raw credentials in status', () => {
    const kv = createMemoryKv();
    const backend = createFakeSecretBackend(true);

    const status = saveBinanceVaultConfig(
      kv,
      {
        apiKey: 'BinanceKey1234567890ABCD',
        apiSecret: 'SuperSecretBinanceHMAC999',
        merchantLevel: 'GOLD',
        merchantProxyUrl: 'https://proxyuser:proxypass@198.51.100.10:8443',
        accountAgeDaysOverride: 120,
        hasKycAnd2fa: true,
      },
      backend,
    );

    expect(status).toEqual({
      hasCredentials: true,
      maskedApiKey: 'Bina••••ABCD',
      merchantLevel: 'GOLD',
      hasProxyUrl: true,
      redactedProxyHost: 'https://198.51.100.10:8443',
      accountAgeDaysOverride: 120,
      hasKycAnd2fa: true,
      secretStorageAvailable: true,
    });
    expect(kv.getConfigValue(BINANCE_KV_KEYS.apiSecret)).toMatch(/^enc:/);
    expect(kv.getConfigValue(BINANCE_KV_KEYS.proxyUrl)).toMatch(/^enc:/);
    expect(JSON.stringify(status)).not.toContain('SuperSecretBinanceHMAC999');
    expect(JSON.stringify(status)).not.toContain('proxypass');

    const cleared = clearBinanceVaultConfig(kv, backend);
    expect(cleared.hasCredentials).toBe(false);
    expect(cleared.hasProxyUrl).toBe(false);
    expect(cleared.merchantLevel).toBe('STANDARD');
  });

  it('fails closed when OS secret storage is unavailable', () => {
    const kv = createMemoryKv();
    const unavailable = createFakeSecretBackend(false);

    expect(() =>
      saveBinanceVaultConfig(
        kv,
        { apiKey: 'BinanceKey1234567890ABCD', apiSecret: 'SuperSecret999' },
        unavailable,
      ),
    ).toThrow(/safeStorage/);
    expect(kv.getConfigValue(BINANCE_KV_KEYS.apiKey)).toBeNull();
  });

  it('rejects non-http/https proxy URLs', () => {
    const kv = createMemoryKv();
    const backend = createFakeSecretBackend(true);
    expect(() =>
      saveBinanceVaultConfig(kv, { merchantProxyUrl: 'ftp://evil.example:21' }, backend),
    ).toThrow(/http: or https:/);
  });

  it('syncs BUY and SELL C2C orders from stored secrets and deduplicates by orderNumber', async () => {
    const kv = createMemoryKv();
    const backend = createFakeSecretBackend(true);
    saveBinanceVaultConfig(
      kv,
      { apiKey: 'KeyForSync123456789', apiSecret: 'SecretForSync123456' },
      backend,
    );

    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('tradeType=BUY')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                orderNumber: '2055001',
                advNo: '11218246497340923904',
                tradeType: 'BUY',
                asset: 'USDT',
                fiat: 'VES',
                amount: '100.5',
                totalPrice: '9250',
                unitPrice: '92.04',
                commission: '0.25',
                orderStatus: 'COMPLETED',
                counterPartNickName: 'PagosRapidos',
                counterPartUserNo: 's111aaa',
                createTime: 1700000001000,
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              orderNumber: '2055002',
              advNo: '11218246497340929999',
              tradeType: 'SELL',
              asset: 'USDT',
              fiat: 'VES',
              amount: '50',
              totalPrice: '4700',
              unitPrice: '94',
              commission: '0.12',
              orderStatus: 'COMPLETED',
              counterPartNickName: 'MesaCaracas',
              createTime: 1700000002000,
            },
            {
              orderNumber: '2055001',
              advNo: '11218246497340923904',
              tradeType: 'BUY',
              asset: 'USDT',
              fiat: 'VES',
              amount: '100.5',
              totalPrice: '9250',
              unitPrice: '92.04',
              commission: '0.25',
              orderStatus: 'COMPLETED',
              counterPartNickName: 'PagosRapidos',
              counterPartUserNo: 's111aaa',
              createTime: 1700000001000,
            },
          ],
        }),
      };
    });

    const orders = await syncBinanceC2cOrdersFromVault(kv, undefined, {
      fetchImpl: fetchMock,
      backend,
      nowMs: () => 1700000005000,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('signature=');
    expect(orders).toHaveLength(2);
    expect(orders[0]?.orderNumber).toBe('2055002');
    expect(orders[1]?.counterpartyUserNo).toBe('s111aaa');
    expect(readDecryptedBinanceVaultCredentials(kv, backend).apiKey).toBe('KeyForSync123456789');
  });

  it('redacts embedded proxy credentials, signatures, and secrets from strings', () => {
    const sanitized = redactSensitiveSecrets(
      'connect https://user1:topsecret@proxy.local:8080 failed?signature=abcdef123456&key=MyKey9999',
      ['MyKey9999'],
    );
    expect(sanitized).not.toContain('topsecret');
    expect(sanitized).not.toContain('abcdef123456');
    expect(sanitized).not.toContain('MyKey9999');
    expect(sanitized).toContain('[redacted]@proxy.local:8080');
  });
});
