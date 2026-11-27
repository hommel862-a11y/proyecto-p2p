import { createHmac } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import type { Duplex } from 'node:stream';
import * as tls from 'node:tls';
import type {
  BinanceMerchantLevelDto,
  BinanceMerchantSapiAction,
  BinanceMerchantSapiRequest,
  BinanceMerchantSapiResult,
} from '../shared/types';
import {
  defaultSecretBackend,
  readDecryptedBinanceVaultCredentials,
  redactSensitiveSecrets,
  type ConfigKvStore,
  type SecretBackend,
} from './binance-vault-config';
import { killswitchState } from './ipc/killswitch-state';

const BINANCE_SAPI_HOST = 'api.binance.com';
const BINANCE_SAPI_PORT = 443;
const SAPI_TIMEOUT_MS = 15_000;

export const BINANCE_MERCHANT_SAPI_ENDPOINTS: Record<BinanceMerchantSapiAction, string> = {
  LIST_ADS: '/sapi/v1/c2c/agent/ads/listWithPagination',
  UPDATE_AD: '/sapi/v1/c2c/ads/update',
  POST_AD: '/sapi/v1/c2c/agent/ads/post',
  UPDATE_STATUS: '/sapi/v1/c2c/ads/updateStatus',
};

const WRITE_ACTIONS = new Set<BinanceMerchantSapiAction>([
  'UPDATE_AD',
  'POST_AD',
  'UPDATE_STATUS',
]);

export function isVerifiedMerchantTier(level: BinanceMerchantLevelDto | string | null): boolean {
  return level === 'BRONZE' || level === 'SILVER' || level === 'GOLD';
}

export interface MerchantSapiFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type MerchantSapiFetchImpl = (
  url: string,
  init: RequestInit,
) => Promise<MerchantSapiFetchResponse>;

export type MerchantSapiProxyPostImpl = (params: {
  proxyUrl: string;
  targetHost: string;
  targetPort: number;
  pathWithQuery: string;
  headers: Record<string, string>;
  bodyJson: string;
  timeoutMs: number;
}) => Promise<{ statusCode: number; bodyText: string }>;

export interface ExecuteMerchantSapiDeps {
  fetchImpl?: MerchantSapiFetchImpl;
  proxyPostImpl?: MerchantSapiProxyPostImpl;
  backend?: SecretBackend;
  nowMs?: () => number;
  isKillswitchActive?: () => boolean;
}

export async function postViaConnectProxy(params: {
  proxyUrl: string;
  targetHost: string;
  targetPort: number;
  pathWithQuery: string;
  headers: Record<string, string>;
  bodyJson: string;
  timeoutMs: number;
  tlsConnectFn?: typeof tls.connect;
}): Promise<{ statusCode: number; bodyText: string }> {
  const parsed = new URL(params.proxyUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('PROXY_TUNNEL_ERROR: Proxy protocol must be http: or https:');
  }
  const proxyPort =
    parsed.port.length > 0 ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  const connectHeaders: Record<string, string> = {
    Host: `${params.targetHost}:${params.targetPort}`,
  };
  if (parsed.username || parsed.password) {
    const creds = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
    connectHeaders['Proxy-Authorization'] = `Basic ${Buffer.from(creds, 'utf8').toString('base64')}`;
  }

  const tlsConnect = params.tlsConnectFn ?? tls.connect;
  const authority = `${params.targetHost}:${params.targetPort}`;

  const tunnelSocket = await new Promise<Duplex>((resolve, reject) => {
    const proxyRequester = parsed.protocol === 'https:' ? https.request : http.request;
    const connectReq = proxyRequester({
      hostname: parsed.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: authority,
      headers: connectHeaders,
      agent: false,
      timeout: params.timeoutMs,
    });

    const onTimeout = () => {
      connectReq.destroy(new Error('PROXY_TUNNEL_ERROR: CONNECT handshake timed out'));
    };

    connectReq.once('timeout', onTimeout);
    connectReq.once('error', (err) => reject(err));
    connectReq.once('connect', (res, socket) => {
      connectReq.removeListener('timeout', onTimeout);
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`PROXY_TUNNEL_ERROR: CONNECT rejected with HTTP ${res.statusCode ?? 0}`));
        return;
      }
      resolve(socket);
    });
    connectReq.end();
  });

  const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
    let settled = false;
    let sock: tls.TLSSocket | null = null;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      tunnelSocket.removeListener('error', fail);
      if (sock && !sock.destroyed) {
        sock.destroy();
      }
      tunnelSocket.destroy();
      reject(err);
    };

    sock = tlsConnect({
      socket: tunnelSocket,
      servername: params.targetHost,
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    });
    const timer = setTimeout(() => {
      sock?.destroy(new Error('PROXY_TUNNEL_ERROR: TLS handshake timed out'));
    }, params.timeoutMs);

    tunnelSocket.once('error', fail);
    sock.once('secureConnect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      tunnelSocket.removeListener('error', fail);
      resolve(sock!);
    });
    sock.once('error', fail);
  });

  let onTunnelErrorPhaseC: ((err: Error) => void) | null = null;
  try {
    return await new Promise<{ statusCode: number; bodyText: string }>((resolve, reject) => {
      let settled = false;
      const failPhaseC = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const req = https.request(
        {
          hostname: params.targetHost,
          port: params.targetPort,
          path: params.pathWithQuery,
          method: 'POST',
          agent: false,
          createConnection: () => tlsSocket,
          headers: {
            ...params.headers,
            'Content-Length': String(Buffer.byteLength(params.bodyJson, 'utf8')),
          },
          timeout: params.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            if (settled) return;
            settled = true;
            resolve({
              statusCode: res.statusCode ?? 0,
              bodyText: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('error', (err) => failPhaseC(err));
        },
      );
      onTunnelErrorPhaseC = (err: Error) => {
        req.destroy(err);
        if (!tlsSocket.destroyed) tlsSocket.destroy();
        failPhaseC(err);
      };
      tunnelSocket.once('error', onTunnelErrorPhaseC);
      req.once('timeout', () => {
        req.destroy(new Error('NETWORK_ERROR: Binance SAPI request via proxy timed out'));
      });
      req.once('error', (err) => failPhaseC(err));
      req.write(params.bodyJson, 'utf8');
      req.end();
    });
  } finally {
    if (onTunnelErrorPhaseC) {
      tunnelSocket.removeListener('error', onTunnelErrorPhaseC);
    }
    if (!tlsSocket.destroyed) {
      tlsSocket.destroy();
    }
    if (!tunnelSocket.destroyed) {
      tunnelSocket.destroy();
    }
  }
}

function sanitizeJsonPayload(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('INVALID_REQUEST: SAPI payload must be a plain JSON object');
  }
  return { ...(raw as Record<string, unknown>) };
}

function extractMerchantRef(
  action: BinanceMerchantSapiAction,
  payload: Record<string, unknown>,
  parsedBody: Record<string, unknown> | null,
  timestamp: string,
): string | undefined {
  if (!WRITE_ACTIONS.has(action)) return undefined;
  const dataObj =
    parsedBody?.['data'] && typeof parsedBody['data'] === 'object'
      ? (parsedBody['data'] as Record<string, unknown>)
      : null;
  const advCandidate =
    dataObj?.['advNo'] ?? parsedBody?.['advNo'] ?? payload['advNo'] ?? payload['adId'];
  const advNo =
    typeof advCandidate === 'string' || typeof advCandidate === 'number'
      ? String(advCandidate).trim()
      : '';
  return advNo ? `BN-C2C-${advNo}-${timestamp}` : `BN-C2C-TX-${timestamp}`;
}

export async function executeBinanceMerchantSapi(
  store: ConfigKvStore,
  req: BinanceMerchantSapiRequest,
  deps: ExecuteMerchantSapiDeps = {},
): Promise<BinanceMerchantSapiResult> {
  const action = req?.action;
  const isValidAction =
    typeof action === 'string' && Object.hasOwn(BINANCE_MERCHANT_SAPI_ENDPOINTS, action);
  const endpoint = isValidAction ? BINANCE_MERCHANT_SAPI_ENDPOINTS[action] : undefined;
  if (!isValidAction || !endpoint) {
    return {
      ok: false,
      action: 'UPDATE_AD',
      endpoint: '',
      code: 'INVALID_REQUEST',
      error: 'Acción SAPI inválida.',
    };
  }

  let bodyPayload: Record<string, unknown>;
  try {
    bodyPayload = sanitizeJsonPayload(req.payload);
  } catch (err) {
    return {
      ok: false,
      action,
      endpoint,
      code: 'INVALID_REQUEST',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 1. Fail-closed kill-switch guard BEFORE touching credentials or sockets (defaults to process singleton)
  const checkKillswitch = deps.isKillswitchActive ?? (() => killswitchState.isTriggered);
  if (WRITE_ACTIONS.has(action) && checkKillswitch()) {
    return {
      ok: false,
      action,
      endpoint,
      code: 'KILLSWITCH_ACTIVE',
      error: 'Killswitch de emergencia activo: se bloquean escrituras en Binance Merchant SAPI.',
    };
  }

  const backend = deps.backend ?? defaultSecretBackend;
  const creds = readDecryptedBinanceVaultCredentials(store, backend);

  // 2. Fail-closed merchant tier guard BEFORE signing or opening sockets
  if (WRITE_ACTIONS.has(action) && !isVerifiedMerchantTier(creds.merchantLevel)) {
    return {
      ok: false,
      action,
      endpoint,
      code: 'MERCHANT_TIER_REQUIRED_FOR_WRITE_SAPI',
      error:
        'Binance C2C Merchant Write SAPI requiere nivel BRONZE, SILVER o GOLD. Las cuentas STANDARD (solo KYC) deben usar el portal web.',
    };
  }

  const apiKey = creds.apiKey;
  const apiSecret = creds.apiSecret;
  if (!apiKey || !apiSecret) {
    return {
      ok: false,
      action,
      endpoint,
      code: 'CREDENTIALS_MISSING',
      error: 'Faltan apiKey/apiSecret de Binance en la bóveda cifrada.',
    };
  }

  const proxySecrets: Array<string | null> = [creds.merchantProxyUrl];
  if (creds.merchantProxyUrl) {
    try {
      const pUrl = new URL(creds.merchantProxyUrl);
      if (pUrl.username || pUrl.password) {
        const user = decodeURIComponent(pUrl.username);
        const pass = decodeURIComponent(pUrl.password);
        const rawCreds = `${user}:${pass}`;
        proxySecrets.push(user, pass, rawCreds, Buffer.from(rawCreds, 'utf8').toString('base64'));
      }
    } catch {
      // ignore malformed URL; already validated on save
    }
  }

  const nowFn = deps.nowMs ?? Date.now;
  const timestamp = String(nowFn());
  const recvWindow = '10000';
  const queryString = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
  const signature = createHmac('sha256', apiSecret).update(queryString).digest('hex');
  const secretsToRedact = [apiKey, apiSecret, signature, ...proxySecrets];
  const pathWithQuery = `${endpoint}?${queryString}&signature=${signature}`;
  const fullUrl = `https://${BINANCE_SAPI_HOST}${pathWithQuery}`;
  const bodyJson = JSON.stringify(bodyPayload);
  const headers: Record<string, string> = {
    'X-MBX-APIKEY': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const viaProxy = Boolean(creds.merchantProxyUrl);

  try {
    let statusCode: number;
    let rawText: string;

    if (creds.merchantProxyUrl) {
      const proxyImpl = deps.proxyPostImpl ?? postViaConnectProxy;
      const res = await proxyImpl({
        proxyUrl: creds.merchantProxyUrl,
        targetHost: BINANCE_SAPI_HOST,
        targetPort: BINANCE_SAPI_PORT,
        pathWithQuery,
        headers,
        bodyJson,
        timeoutMs: SAPI_TIMEOUT_MS,
      });
      statusCode = res.statusCode;
      rawText = res.bodyText;
    } else {
      const fetchImpl = deps.fetchImpl;
      if (!fetchImpl) {
        throw new Error('NETWORK_ERROR: fetch implementation unavailable');
      }
      const res = await fetchImpl(fullUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(SAPI_TIMEOUT_MS),
        headers,
        body: bodyJson,
      });
      statusCode = res.status;
      rawText = await res.text();
    }

    let parsedBody: Record<string, unknown> | null = null;
    try {
      const json = rawText ? (JSON.parse(rawText) as unknown) : null;
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        parsedBody = json as Record<string, unknown>;
      }
    } catch {
      parsedBody = null;
    }

    if (statusCode < 200 || statusCode >= 300) {
      const apiMsg =
        typeof parsedBody?.['msg'] === 'string'
          ? parsedBody['msg']
          : typeof parsedBody?.['message'] === 'string'
            ? parsedBody['message']
            : `HTTP ${statusCode}`;
      return {
        ok: false,
        action,
        endpoint,
        statusCode,
        code: 'HTTP_ERROR',
        viaProxy,
        error: redactSensitiveSecrets(
          `Binance Merchant SAPI HTTP ${statusCode}: ${apiMsg}`,
          secretsToRedact,
        ),
      };
    }

    const binanceCode =
      parsedBody?.['code'] !== undefined && parsedBody['code'] !== null
        ? String(parsedBody['code'])
        : undefined;
    const explicitFailure =
      parsedBody?.['success'] === false ||
      (binanceCode !== undefined && binanceCode !== '000000' && binanceCode !== '0');

    if (explicitFailure) {
      const errMsg =
        typeof parsedBody?.['msg'] === 'string'
          ? parsedBody['msg']
          : typeof parsedBody?.['message'] === 'string'
            ? parsedBody['message']
            : `Binance error code ${binanceCode ?? 'UNKNOWN'}`;
      return {
        ok: false,
        action,
        endpoint,
        statusCode,
        code: binanceCode ? `BINANCE_${binanceCode}` : 'BINANCE_API_ERROR',
        viaProxy,
        data: parsedBody,
        error: redactSensitiveSecrets(errMsg, secretsToRedact),
      };
    }

    const merchantRef = extractMerchantRef(action, bodyPayload, parsedBody, timestamp);
    return {
      ok: true,
      action,
      endpoint,
      statusCode,
      code: binanceCode ?? '000000',
      ...(merchantRef ? { merchantRef } : {}),
      data: parsedBody,
      viaProxy,
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const sanitized = redactSensitiveSecrets(rawMsg, secretsToRedact);
    const code = sanitized.startsWith('PROXY_TUNNEL_ERROR') ? 'PROXY_TUNNEL_ERROR' : 'NETWORK_ERROR';
    return {
      ok: false,
      action,
      endpoint,
      code,
      viaProxy,
      error: sanitized,
    };
  }
}
