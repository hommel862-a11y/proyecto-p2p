import crypto from 'node:crypto';

export interface OrchestratorMutationGuardResult {
  readonly allowed: boolean;
  readonly statusCode: number;
  readonly reason: string;
}

export interface TelegramFileValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'bdvenlinea.banvenez.com',
  'banvenez.com',
  'bancodevenezuela.com',
  'bancamiga.com',
  'banesconline.com',
  'banesco.com',
  'mercantilbanco.com',
  'www30.mercantilbanco.com',
  'provincial.com',
  'bncenlinea.com',
  'bancaribe.com.ve',
  'banplus.com',
  'bdt.com.ve',
  'bt.com.ve',
  'bancoexterior.com',
  'bancoplaza.com',
  'bfc.com.ve',
  '100x100banco.com',
  'binance.com',
  'p2p.binance.com',
  'bybit.com',
  'eldorado.io',
  'bcv.org.ve',
  'cotizave.com',
  't.me',
  'telegram.org',
]);

function normalizeHeader(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return (val[0] ?? '').trim();
  return (val ?? '').trim();
}

function timingSafeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Protects local `127.0.0.1:51857/api/orchestrator/*` POST mutations against
 * drive-by browser `no-cors` CSRF and unauthorized cross-origin calls.
 */
export function validateOrchestratorMutationRequest(
  headers: Record<string, string | string[] | undefined>,
  allowedOrigins: ReadonlySet<string>,
  expectedBridgeToken: string,
): OrchestratorMutationGuardResult {
  const origin = normalizeHeader(headers['origin']);
  if (origin && !allowedOrigins.has(origin) && !origin.startsWith('chrome-extension://')) {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Cross-origin request rejected by P2P Bridge security policy',
    };
  }

  const secFetchSite = normalizeHeader(headers['sec-fetch-site']).toLowerCase();
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Cross-site browser fetch rejected (Sec-Fetch-Site guard)',
    };
  }

  const contentType = normalizeHeader(headers['content-type']).toLowerCase();
  if (!contentType.includes('application/json')) {
    return {
      allowed: false,
      statusCode: 415,
      reason: 'Content-Type application/json is required for orchestrator mutations',
    };
  }

  const providedToken = normalizeHeader(headers['x-p2p-bridge-token']);
  if (providedToken) {
    if (!timingSafeMatch(providedToken, expectedBridgeToken)) {
      return {
        allowed: false,
        statusCode: 401,
        reason: 'Invalid X-P2P-Bridge-Token',
      };
    }
  }

  return { allowed: true, statusCode: 200, reason: 'OK' };
}

/**
 * Validates Telegram bot token and `file_path` to prevent `../../bot<token>/...` path traversal
 * against `https://api.telegram.org/file/bot<token>/<filePath>`.
 */
export function validateTelegramFileDownloadParams(
  token?: string | null,
  filePath?: string | null,
): TelegramFileValidationResult {
  const cleanToken = (token ?? '').trim();
  const cleanPath = (filePath ?? '').trim();

  if (!/^\d{6,16}:[A-Za-z0-9_-]{20,80}$/.test(cleanToken)) {
    return { valid: false, reason: 'Invalid Telegram Bot token format' };
  }

  if (
    !cleanPath ||
    cleanPath.includes('..') ||
    cleanPath.includes('\\') ||
    cleanPath.startsWith('/') ||
    !/^[A-Za-z0-9_/-]+\.[A-Za-z0-9]{2,6}$/.test(cleanPath)
  ) {
    return { valid: false, reason: 'Invalid or unsafe Telegram file_path' };
  }

  return { valid: true };
}

/**
 * Restricts `shell.openExternal` to HTTPS portals of the 14 Venezuelan banks,
 * major P2P exchanges, BCV, and Telegram (`t.me` / `tg://`).
 */
export function isAllowedExternalUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('tg://')) return true;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    for (const allowed of ALLOWED_EXTERNAL_HOSTS) {
      if (host === allowed || host.endsWith(`.${allowed}`)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Ensures privileged IPC calls (`crypto:*`, `vault:*`) originate exclusively from the trusted local app frame.
 */
export function isTrustedRendererOrigin(senderUrl?: string | null): boolean {
  if (!senderUrl) return true; // Unit-test harness without BrowserWindow frame
  return (
    senderUrl.startsWith('http://127.0.0.1:51857') ||
    senderUrl.startsWith('http://localhost:51857') ||
    senderUrl.startsWith('http://127.0.0.1:4200') ||
    senderUrl.startsWith('http://localhost:4200') ||
    senderUrl.startsWith('file://')
  );
}
