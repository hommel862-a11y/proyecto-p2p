import { createHmac } from 'node:crypto';
import type {
  BinanceMerchantLevelDto,
  BinanceSyncOrdersRequest,
  BinanceSyncedC2cOrderDto,
  BinanceVaultSaveRequest,
  BinanceVaultStatusDto,
} from '../shared/types';
import {
  SECRET_SCHEME,
  decryptSecret,
  encryptSecret,
  isSecretStorageAvailable,
} from './db/secret-store';

export const BINANCE_KV_KEYS = {
  apiKey: 'binance_c2c_api_key',
  apiKeyScheme: 'binance_c2c_api_key_scheme',
  apiSecret: 'binance_c2c_api_secret',
  apiSecretScheme: 'binance_c2c_api_secret_scheme',
  merchantLevel: 'binance_c2c_merchant_level',
  proxyUrl: 'binance_c2c_merchant_proxy_url',
  proxyUrlScheme: 'binance_c2c_merchant_proxy_url_scheme',
  accountAgeDaysOverride: 'binance_c2c_account_age_days',
  hasKycAnd2fa: 'binance_c2c_has_kyc_and_2fa',
} as const;

export interface ConfigKvStore {
  getConfigValue(key: string): string | null;
  setConfigValue(key: string, value: string): void;
  deleteConfigValue(key: string): void;
}

export interface SecretBackend {
  isAvailable(): boolean;
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export const defaultSecretBackend: SecretBackend = {
  isAvailable: isSecretStorageAvailable,
  encrypt: encryptSecret,
  decrypt: decryptSecret,
};

export interface DecryptedBinanceVaultCredentials {
  apiKey: string | null;
  apiSecret: string | null;
  merchantLevel: BinanceMerchantLevelDto;
  merchantProxyUrl: string | null;
  accountAgeDaysOverride: number | null;
  hasKycAnd2fa: boolean;
}

const VALID_LEVELS = new Set<BinanceMerchantLevelDto>(['STANDARD', 'BRONZE', 'SILVER', 'GOLD']);

export function normalizeBinanceMerchantLevel(raw: unknown): BinanceMerchantLevelDto {
  if (typeof raw !== 'string') return 'STANDARD';
  const upper = raw.trim().toUpperCase() as BinanceMerchantLevelDto;
  return VALID_LEVELS.has(upper) ? upper : 'STANDARD';
}

export function maskApiKey(apiKey: string | null): string | null {
  if (!apiKey) return null;
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 10) return '••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function validateAndNormalizeProxyUrl(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new Error('Proxy URL must be a string');
  }
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid merchant proxy URL format');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Merchant proxy URL must use http: or https:');
  }
  if (!parsed.hostname) {
    throw new Error('Merchant proxy URL requires a hostname');
  }
  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error('Merchant proxy URL has an invalid port');
    }
  }
  return parsed.toString();
}

export function redactProxyHost(proxyUrl: string | null): string | null {
  if (!proxyUrl) return null;
  try {
    const parsed = new URL(proxyUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '[redacted-proxy]';
  }
}

export function redactSensitiveSecrets(
  text: string,
  secrets: ReadonlyArray<string | null | undefined> = [],
): string {
  let out = text;
  // Strip any inline URL userinfo (user:pass@) and HMAC signatures first
  out = out.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^@\s/]+)@/g, '$1[redacted]@');
  out = out.replace(/([?&]signature=)[a-fA-F0-9]+/g, '$1[redacted]');
  for (const s of secrets) {
    if (typeof s === 'string' && s.trim().length >= 4) {
      out = out.split(s.trim()).join('[redacted]');
    }
  }
  return out;
}

function readEncryptedKv(
  store: ConfigKvStore,
  secretKey: string,
  schemeKey: string,
  backend: SecretBackend,
): string | null {
  const cipher = store.getConfigValue(secretKey);
  const scheme = store.getConfigValue(schemeKey);
  if (!cipher || scheme !== SECRET_SCHEME || !backend.isAvailable()) {
    return null;
  }
  try {
    const plain = backend.decrypt(cipher).trim();
    return plain.length > 0 ? plain : null;
  } catch {
    return null;
  }
}

function writeEncryptedKv(
  store: ConfigKvStore,
  secretKey: string,
  schemeKey: string,
  plaintext: string,
  backend: SecretBackend,
): void {
  if (!backend.isAvailable()) {
    throw new Error(
      'OS secret storage (safeStorage) is unavailable; refusing to persist Binance secrets in plaintext',
    );
  }
  const cipher = backend.encrypt(plaintext);
  store.setConfigValue(secretKey, cipher);
  store.setConfigValue(schemeKey, SECRET_SCHEME);
}

export function readDecryptedBinanceVaultCredentials(
  store: ConfigKvStore,
  backend: SecretBackend = defaultSecretBackend,
): DecryptedBinanceVaultCredentials {
  const apiKey = readEncryptedKv(store, BINANCE_KV_KEYS.apiKey, BINANCE_KV_KEYS.apiKeyScheme, backend);
  const apiSecret = readEncryptedKv(
    store,
    BINANCE_KV_KEYS.apiSecret,
    BINANCE_KV_KEYS.apiSecretScheme,
    backend,
  );
  const merchantProxyUrl = readEncryptedKv(
    store,
    BINANCE_KV_KEYS.proxyUrl,
    BINANCE_KV_KEYS.proxyUrlScheme,
    backend,
  );
  const merchantLevel = normalizeBinanceMerchantLevel(
    store.getConfigValue(BINANCE_KV_KEYS.merchantLevel),
  );
  const rawAge = store.getConfigValue(BINANCE_KV_KEYS.accountAgeDaysOverride);
  const parsedAge = rawAge !== null && rawAge.trim().length > 0 ? Number(rawAge) : NaN;
  const accountAgeDaysOverride =
    Number.isFinite(parsedAge) && parsedAge >= 0 ? Math.trunc(parsedAge) : null;
  const rawKyc = store.getConfigValue(BINANCE_KV_KEYS.hasKycAnd2fa);
  const hasKycAnd2fa = rawKyc === null ? true : rawKyc !== 'false';

  return {
    apiKey,
    apiSecret,
    merchantLevel,
    merchantProxyUrl,
    accountAgeDaysOverride,
    hasKycAnd2fa,
  };
}

export function getBinanceVaultStatus(
  store: ConfigKvStore,
  backend: SecretBackend = defaultSecretBackend,
): BinanceVaultStatusDto {
  const creds = readDecryptedBinanceVaultCredentials(store, backend);
  return {
    hasCredentials: Boolean(creds.apiKey && creds.apiSecret),
    maskedApiKey: maskApiKey(creds.apiKey),
    merchantLevel: creds.merchantLevel,
    hasProxyUrl: Boolean(creds.merchantProxyUrl),
    redactedProxyHost: redactProxyHost(creds.merchantProxyUrl),
    accountAgeDaysOverride: creds.accountAgeDaysOverride,
    hasKycAnd2fa: creds.hasKycAnd2fa,
    secretStorageAvailable: backend.isAvailable(),
  };
}

export function saveBinanceVaultConfig(
  store: ConfigKvStore,
  req: BinanceVaultSaveRequest,
  backend: SecretBackend = defaultSecretBackend,
): BinanceVaultStatusDto {
  if (!req || typeof req !== 'object' || Array.isArray(req)) {
    throw new Error('Invalid Binance vault configuration payload');
  }

  if (typeof req.apiKey === 'string' && req.apiKey.trim().length > 0) {
    writeEncryptedKv(
      store,
      BINANCE_KV_KEYS.apiKey,
      BINANCE_KV_KEYS.apiKeyScheme,
      req.apiKey.trim(),
      backend,
    );
  }

  if (typeof req.apiSecret === 'string' && req.apiSecret.trim().length > 0) {
    writeEncryptedKv(
      store,
      BINANCE_KV_KEYS.apiSecret,
      BINANCE_KV_KEYS.apiSecretScheme,
      req.apiSecret.trim(),
      backend,
    );
  }

  if (req.merchantLevel !== undefined) {
    store.setConfigValue(
      BINANCE_KV_KEYS.merchantLevel,
      normalizeBinanceMerchantLevel(req.merchantLevel),
    );
  }

  if (req.clearProxy) {
    store.deleteConfigValue(BINANCE_KV_KEYS.proxyUrl);
    store.deleteConfigValue(BINANCE_KV_KEYS.proxyUrlScheme);
  } else if (req.merchantProxyUrl !== undefined) {
    if (req.merchantProxyUrl === null || req.merchantProxyUrl.trim().length === 0) {
      store.deleteConfigValue(BINANCE_KV_KEYS.proxyUrl);
      store.deleteConfigValue(BINANCE_KV_KEYS.proxyUrlScheme);
    } else {
      const normalizedProxy = validateAndNormalizeProxyUrl(req.merchantProxyUrl);
      writeEncryptedKv(
        store,
        BINANCE_KV_KEYS.proxyUrl,
        BINANCE_KV_KEYS.proxyUrlScheme,
        normalizedProxy,
        backend,
      );
    }
  }

  if (req.accountAgeDaysOverride !== undefined) {
    if (req.accountAgeDaysOverride === null) {
      store.deleteConfigValue(BINANCE_KV_KEYS.accountAgeDaysOverride);
    } else if (
      typeof req.accountAgeDaysOverride === 'number' &&
      Number.isFinite(req.accountAgeDaysOverride) &&
      req.accountAgeDaysOverride >= 0
    ) {
      store.setConfigValue(
        BINANCE_KV_KEYS.accountAgeDaysOverride,
        String(Math.trunc(req.accountAgeDaysOverride)),
      );
    }
  }

  if (typeof req.hasKycAnd2fa === 'boolean') {
    store.setConfigValue(BINANCE_KV_KEYS.hasKycAnd2fa, req.hasKycAnd2fa ? 'true' : 'false');
  }

  return getBinanceVaultStatus(store, backend);
}

export function clearBinanceVaultConfig(
  store: ConfigKvStore,
  backend: SecretBackend = defaultSecretBackend,
): BinanceVaultStatusDto {
  for (const key of Object.values(BINANCE_KV_KEYS)) {
    store.deleteConfigValue(key);
  }
  return getBinanceVaultStatus(store, backend);
}

function toFiniteNumber(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeSyncedC2cOrders(
  buyData: unknown,
  sellData: unknown,
): BinanceSyncedC2cOrderDto[] {
  const deduped = new Map<string, BinanceSyncedC2cOrderDto>();
  const ingest = (rawList: unknown, fallbackSide: 'BUY' | 'SELL') => {
    const items = Array.isArray(rawList)
      ? rawList
      : rawList && typeof rawList === 'object' && Array.isArray((rawList as { data?: unknown }).data)
        ? (rawList as { data: unknown[] }).data
        : [];
    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const item = rawItem as Record<string, unknown>;
      const orderNumber = String(item['orderNumber'] ?? '').trim();
      if (!orderNumber) continue;
      const sideRaw = String(item['tradeType'] ?? fallbackSide).trim().toUpperCase();
      const tradeType: 'BUY' | 'SELL' = sideRaw === 'SELL' ? 'SELL' : 'BUY';
      const counterpartyNickname = String(
        item['counterPartNickName'] ?? item['counterpartyNickname'] ?? '',
      ).trim();
      const counterpartyUserNoRaw = item['counterPartUserNo'] ?? item['counterpartyUserNo'];
      const counterpartyUserNo =
        typeof counterpartyUserNoRaw === 'string' && counterpartyUserNoRaw.trim().length > 0
          ? counterpartyUserNoRaw.trim()
          : undefined;
      deduped.set(orderNumber, {
        orderNumber,
        advNo: String(item['advNo'] ?? '').trim(),
        tradeType,
        asset: String(item['asset'] ?? 'USDT').trim().toUpperCase(),
        fiat: String(item['fiat'] ?? 'VES').trim().toUpperCase(),
        amount: toFiniteNumber(item['amount']),
        totalPrice: toFiniteNumber(item['totalPrice']),
        unitPrice: toFiniteNumber(item['unitPrice']),
        commission: toFiniteNumber(item['commission'] ?? item['takerCommission']),
        orderStatus: String(item['orderStatus'] ?? '').trim().toUpperCase(),
        counterpartyNickname,
        ...(counterpartyUserNo ? { counterpartyUserNo } : {}),
        createTime: toFiniteNumber(item['createTime']),
      });
    }
  };

  ingest(buyData, 'BUY');
  ingest(sellData, 'SELL');

  return Array.from(deduped.values()).sort((a, b) => b.createTime - a.createTime);
}

export async function syncBinanceC2cOrdersFromVault(
  store: ConfigKvStore,
  req: BinanceSyncOrdersRequest | undefined,
  deps: {
    fetchImpl: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
    backend?: SecretBackend;
    nowMs?: () => number;
  },
): Promise<BinanceSyncedC2cOrderDto[]> {
  const backend = deps.backend ?? defaultSecretBackend;
  const creds = readDecryptedBinanceVaultCredentials(store, backend);
  const apiKey = req?.apiKey?.trim() || creds.apiKey;
  const apiSecret = req?.apiSecret?.trim() || creds.apiSecret;
  if (!apiKey || !apiSecret) {
    throw new Error('Binance API key and secret are required for C2C order sync');
  }

  const rows = Math.min(100, Math.max(10, Math.trunc(req?.rows ?? 100)));
  const nowFn = deps.nowMs ?? Date.now;

  const fetchSide = async (tradeType: 'BUY' | 'SELL') => {
    const timestamp = String(nowFn());
    const recvWindow = '10000';
    const queryString = `tradeType=${tradeType}&page=1&rows=${rows}&recvWindow=${recvWindow}&timestamp=${timestamp}`;
    const signature = createHmac('sha256', apiSecret).update(queryString).digest('hex');
    const url = `https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory?${queryString}&signature=${signature}`;
    try {
      const response = await deps.fetchImpl(url, {
        method: 'GET',
        signal: AbortSignal.timeout(15_000),
        headers: {
          'X-MBX-APIKEY': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`Binance C2C sync HTTP ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      throw new Error(redactSensitiveSecrets(rawMsg, [apiKey, apiSecret]), { cause: err });
    }
  };

  const [buyPayload, sellPayload] = await Promise.all([fetchSide('BUY'), fetchSide('SELL')]);
  return normalizeSyncedC2cOrders(buyPayload, sellPayload);
}
