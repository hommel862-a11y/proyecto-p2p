import { readFileSync } from 'node:fs';

export type PgSslOption = boolean | { rejectUnauthorized: boolean; ca?: string };

export interface ResolvedPgConnectionConfig {
  connectionString: string;
  ssl?: PgSslOption;
  isLocalHost: boolean;
  isTransactionPooler: boolean;
  warnings: string[];
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', 'postgres']);

export function isLocalPostgresHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  if (LOCAL_HOSTNAMES.has(normalized)) return true;
  return normalized.endsWith('.local') || normalized.endsWith('.internal');
}

/**
 * Resolves PostgreSQL TLS + connection string settings for both local Docker/bare-metal
 * and managed Option B providers (Supabase Session Pooler, Neon Direct, etc.).
 */
export function resolvePgConnectionConfig(
  databaseUrl: string,
  env: Record<string, string | undefined> = process.env,
): ResolvedPgConnectionConfig {
  const trimmed = databaseUrl.trim();
  if (!trimmed) {
    throw new Error('DATABASE_URL must be a non-empty PostgreSQL connection string');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  const isLocalHost = isLocalPostgresHost(hostname);
  const warnings: string[] = [];

  const isSupabasePooler6543 = hostname.includes('.pooler.') && parsed.port === '6543';
  const hasPgbouncerFlag = parsed.searchParams.get('pgbouncer')?.toLowerCase() === 'true';
  const isTransactionPooler = isSupabasePooler6543 || hasPgbouncerFlag;
  if (isTransactionPooler) {
    warnings.push(
      'TRANSACTION_POOLER_DETECTED: Transaction pooling (port 6543 / pgbouncer=true) interrupts LISTEN/NOTIFY SSE. Use the Direct or Session Pooler URL on port 5432.',
    );
  }

  const urlSslMode = (parsed.searchParams.get('sslmode') ?? '').trim().toLowerCase();
  const envSslMode = (env['DATABASE_SSL_MODE'] ?? '').trim().toLowerCase();
  const sslMode = urlSslMode || envSslMode;
  const rejectUnauthorizedEnv = (env['DATABASE_SSL_REJECT_UNAUTHORIZED'] ?? '')
    .trim()
    .toLowerCase();
  const caPath = (env['DATABASE_SSL_CA_PATH'] ?? env['PGSSLROOTCERT'] ?? '').trim();

  let ca: string | undefined;
  if (caPath) {
    ca = readFileSync(caPath, 'utf8');
  }

  let ssl: PgSslOption | undefined;
  if (sslMode === 'disable') {
    ssl = undefined;
  } else if (
    sslMode === 'no-verify' ||
    rejectUnauthorizedEnv === 'false' ||
    rejectUnauthorizedEnv === '0'
  ) {
    ssl = { rejectUnauthorized: false, ...(ca ? { ca } : {}) };
  } else if (
    !isLocalHost ||
    sslMode === 'require' ||
    sslMode === 'verify-ca' ||
    sslMode === 'verify-full' ||
    sslMode === 'prefer' ||
    rejectUnauthorizedEnv === 'true' ||
    rejectUnauthorizedEnv === '1' ||
    Boolean(ca)
  ) {
    ssl = { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  }

  let normalizedUrl = trimmed;
  if (urlSslMode && ssl !== undefined) {
    // Strip sslmode so pg-connection-string does not override explicit `ssl` config or emit warnings.
    parsed.searchParams.delete('sslmode');
    normalizedUrl = parsed.toString();
  }

  return {
    connectionString: normalizedUrl,
    ssl,
    isLocalHost,
    isTransactionPooler,
    warnings,
  };
}

/**
 * Maps common PostgreSQL TLS / connection failures to safe operator hints without exposing credentials.
 */
export function formatPgSslHint(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (
    lower.includes('self_signed_cert_in_chain') ||
    lower.includes('self-signed certificate') ||
    lower.includes('unable to verify the first certificate')
  ) {
    return `${message} — Hint: configure DATABASE_SSL_CA_PATH with your provider CA bundle (recommended) or use sslmode=no-verify / DATABASE_SSL_REJECT_UNAUTHORIZED=false for managed pooler chains.`;
  }

  if (lower.includes('no pg_hba.conf entry') || lower.includes('ssl is required')) {
    return `${message} — Hint: ensure TLS is enabled (remove sslmode=disable and verify provider IP allowlist).`;
  }

  if (lower.includes('econnrefused') || lower.includes('timeout')) {
    return `${message} — Hint: check host/port (use port 5432 Direct/Session URL rather than 6543 transaction pooler for LISTEN/NOTIFY).`;
  }

  return message;
}
