import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { loadGatewayEnv, findMonorepoRoot } from './env-loader.js';
import { resolvePgConnectionConfig, formatPgSslHint } from './pg-config.js';
import type { PgClientLike } from './pg-store.js';

export interface MigrationFileDescriptor {
  filename: string;
  fullPath: string;
  sql: string;
  checksum: string;
}

export interface MigrationRunOptions {
  migrationsDir?: string;
  onlyPrefixes?: readonly string[];
}

export interface MigrationRunResult {
  applied: string[];
  adopted: string[];
  skipped: string[];
}

export interface PgPrerequisiteStatus {
  serverVersion: string;
  vectorInstalled: boolean;
  vectorAvailable: boolean;
  rlsActive: boolean;
  pendingMigrations: string[];
}

export function resolveDefaultMigrationsDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findMonorepoRoot(moduleDir);
  return join(repoRoot, 'electron', 'main', 'db', 'migrations');
}

export function listMigrationFiles(
  migrationsDir = resolveDefaultMigrationsDir(),
  onlyPrefixes?: readonly string[],
): MigrationFileDescriptor[] {
  const normalizedPrefixes = (onlyPrefixes ?? [])
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const entries = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+_.*\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .filter((filename) =>
      normalizedPrefixes.length === 0
        ? true
        : normalizedPrefixes.some((prefix) => filename.startsWith(prefix)),
    );

  return entries.map((filename) => {
    const fullPath = join(migrationsDir, filename);
    const sql = readFileSync(fullPath, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    return { filename, fullPath, sql, checksum };
  });
}

async function ensureMigrationsTable(client: PgClientLike): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.arm_schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function fetchAppliedMigrationMap(client: PgClientLike): Promise<Map<string, string>> {
  const res = await client.query(
    'SELECT filename, checksum FROM public.arm_schema_migrations ORDER BY filename ASC',
  );
  const map = new Map<string, string>();
  for (const row of res.rows) {
    if (typeof row['filename'] === 'string') {
      map.set(row['filename'], String(row['checksum'] ?? ''));
    }
  }
  return map;
}

async function isInitialSchemaAlreadyPresent(client: PgClientLike): Promise<boolean> {
  const res = await client.query(`
    SELECT
      (to_regclass('public.workspaces') IS NOT NULL) AS has_workspaces,
      EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_code') AS has_workspace_type
  `);
  const row = res.rows[0];
  return Boolean(row?.['has_workspaces']) && Boolean(row?.['has_workspace_type']);
}

export async function runPgMigrations(
  client: PgClientLike,
  options: MigrationRunOptions = {},
): Promise<MigrationRunResult> {
  const migrations = listMigrationFiles(
    options.migrationsDir ?? resolveDefaultMigrationsDir(),
    options.onlyPrefixes,
  );

  await ensureMigrationsTable(client);
  const appliedMap = await fetchAppliedMigrationMap(client);

  const applied: string[] = [];
  const adopted: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (appliedMap.has(migration.filename)) {
      skipped.push(migration.filename);
      continue;
    }

    if (
      migration.filename.startsWith('001_') &&
      (await isInitialSchemaAlreadyPresent(client))
    ) {
      await client.query(
        `
        INSERT INTO public.arm_schema_migrations (filename, checksum)
        VALUES ($1, $2)
        ON CONFLICT (filename) DO NOTHING
        `,
        [migration.filename, migration.checksum],
      );
      adopted.push(migration.filename);
      continue;
    }

    await client.query(migration.sql);
    await client.query(
      `
      INSERT INTO public.arm_schema_migrations (filename, checksum)
      VALUES ($1, $2)
      ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW()
      `,
      [migration.filename, migration.checksum],
    );
    applied.push(migration.filename);
  }

  return { applied, adopted, skipped };
}

export async function verifyPgStoragePrerequisites(
  client: PgClientLike,
  options: MigrationRunOptions = {},
): Promise<PgPrerequisiteStatus> {
  const statusRes = await client.query(`
    SELECT
      version() AS server_version,
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS vector_installed,
      EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS vector_available,
      COALESCE((
        SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('leads', 'outbox_events', 'payment_receipts', 'bank_rails')
      ), false) AS rls_active
  `);

  const hasMigTableRes = await client.query(
    `SELECT (to_regclass('public.arm_schema_migrations') IS NOT NULL) AS exists`,
  );
  const migTableExists = Boolean(hasMigTableRes.rows[0]?.['exists']);
  const appliedSet = migTableExists
    ? new Set((await fetchAppliedMigrationMap(client)).keys())
    : new Set<string>();

  const files = listMigrationFiles(
    options.migrationsDir ?? resolveDefaultMigrationsDir(),
    options.onlyPrefixes,
  );
  const pendingMigrations = files
    .map((f) => f.filename)
    .filter((name) => !appliedSet.has(name));

  const row = statusRes.rows[0] ?? {};
  return {
    serverVersion: String(row['server_version'] ?? 'unknown'),
    vectorInstalled: Boolean(row['vector_installed']),
    vectorAvailable: Boolean(row['vector_available']),
    rlsActive: Boolean(row['rls_active']),
    pendingMigrations,
  };
}

function parseCliArgs(argv: readonly string[]): {
  help: boolean;
  checkOnly: boolean;
  onlyPrefixes: string[];
} {
  let help = false;
  let checkOnly = false;
  const onlyPrefixes: string[] = [];

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--check' || arg === '--verify') {
      checkOnly = true;
    } else if (arg.startsWith('--only=')) {
      const items = arg.slice('--only='.length).split(',');
      for (const item of items) {
        if (item.trim()) onlyPrefixes.push(item.trim());
      }
    }
  }

  return { help, checkOnly, onlyPrefixes };
}

function sameEntryPath(argPath: string, metaUrl: string): boolean {
  const tryReal = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const a = tryReal(argPath);
  const b = tryReal(fileURLToPath(metaUrl));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function runCli(): Promise<void> {
  const { help, checkOnly, onlyPrefixes } = parseCliArgs(process.argv.slice(2));
  if (help) {
    console.log('Usage: inbound:migrate [--check] [--only=001,002]');
    console.log('  --check       Verify PostgreSQL connection, pgvector, FORCE RLS, and pending SQL files.');
    console.log('  --only=...    Restrict to migrations matching comma-separated filename prefixes.');
    return;
  }

  const { loadedFiles } = loadGatewayEnv();
  const databaseUrl = process.env['DATABASE_URL']?.trim();
  if (!databaseUrl) {
    console.error(
      '[INBOUND-MIGRATE] DATABASE_URL is not set. Configure it in .env or deploy/vps/.env (Direct/Session PostgreSQL URI) before running migrations.',
    );
    if (loadedFiles.length > 0) {
      console.error(`[INBOUND-MIGRATE] Env files checked/loaded: ${loadedFiles.join(', ')}`);
    }
    process.exitCode = 1;
    return;
  }

  const resolved = resolvePgConnectionConfig(databaseUrl);
  for (const warning of resolved.warnings) {
    console.warn(`[INBOUND-MIGRATE] WARNING: ${warning}`);
  }

  const client = new Client({
    connectionString: resolved.connectionString,
    ...(resolved.ssl !== undefined ? { ssl: resolved.ssl } : {}),
  });

  try {
    await client.connect();
    const wrappedClient: PgClientLike = {
      query: (text, values) => client.query(text, values),
      release: () => undefined,
    };

    if (checkOnly) {
      const status = await verifyPgStoragePrerequisites(wrappedClient, { onlyPrefixes });
      console.log('[INBOUND-MIGRATE] PostgreSQL Prerequisites Check:');
      console.log(`  - Server:             ${status.serverVersion}`);
      console.log(`  - pgvector available: ${status.vectorAvailable}`);
      console.log(`  - pgvector installed: ${status.vectorInstalled}`);
      console.log(`  - FORCE RLS active:   ${status.rlsActive}`);
      console.log(
        `  - Pending migrations: ${status.pendingMigrations.length === 0 ? 'none (up to date)' : status.pendingMigrations.join(', ')}`,
      );
      if (status.pendingMigrations.length > 0 || !status.vectorAvailable) {
        process.exitCode = 2;
      }
      return;
    }

    const res = await runPgMigrations(wrappedClient, { onlyPrefixes });
    console.log('[INBOUND-MIGRATE] Migration Summary:');
    console.log(`  - Applied: ${res.applied.length ? res.applied.join(', ') : 'none'}`);
    console.log(`  - Adopted: ${res.adopted.length ? res.adopted.join(', ') : 'none'}`);
    console.log(`  - Skipped: ${res.skipped.length ? res.skipped.join(', ') : 'none'}`);

    const postStatus = await verifyPgStoragePrerequisites(wrappedClient, { onlyPrefixes });
    console.log(
      `[INBOUND-MIGRATE] Verified post-migration: pgvector=${postStatus.vectorInstalled}, rlsActive=${postStatus.rlsActive}`,
    );
  } catch (err: unknown) {
    console.error(`[INBOUND-MIGRATE] Failed: ${formatPgSslHint(err)}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const isDirectEntry =
  process.env['VITEST'] === undefined &&
  typeof process.argv[1] === 'string' &&
  sameEntryPath(process.argv[1], import.meta.url);

if (isDirectEntry) {
  void runCli();
}
