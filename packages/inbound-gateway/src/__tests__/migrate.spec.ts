import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PgClientLike, PgQueryResult } from '../pg-store.js';
import {
  listMigrationFiles,
  runPgMigrations,
  verifyPgStoragePrerequisites,
} from '../migrate.js';

class MockMigrationClient implements PgClientLike {
  readonly executedSql: string[] = [];
  readonly applied = new Map<string, string>();
  hasExistingWorkspaces = false;
  hasExistingWorkspaceType = false;
  hasVectorExtension = true;
  vectorAvailable = true;
  rlsActive = true;

  async query(text: string, values?: unknown[]): Promise<PgQueryResult> {
    this.executedSql.push(text);
    const trimmed = text.trim();

    if (trimmed.startsWith('CREATE TABLE IF NOT EXISTS public.arm_schema_migrations')) {
      return { rows: [], rowCount: 0 };
    }
    if (trimmed.startsWith('SELECT filename, checksum FROM public.arm_schema_migrations')) {
      return {
        rows: Array.from(this.applied.entries()).map(([filename, checksum]) => ({
          filename,
          checksum,
        })),
        rowCount: this.applied.size,
      };
    }
    if (trimmed.includes("to_regclass('public.workspaces')")) {
      return {
        rows: [
          {
            has_workspaces: this.hasExistingWorkspaces,
            has_workspace_type: this.hasExistingWorkspaceType,
            has_payment_receipts: false,
            has_bank_rails: false,
          },
        ],
        rowCount: 1,
      };
    }
    if (trimmed.startsWith('INSERT INTO public.arm_schema_migrations')) {
      const filename = String(values?.[0] ?? '');
      const checksum = String(values?.[1] ?? '');
      this.applied.set(filename, checksum);
      return { rows: [], rowCount: 1 };
    }
    if (trimmed.includes('pg_available_extensions')) {
      return {
        rows: [
          {
            server_version: 'PostgreSQL 17.2',
            vector_installed: this.hasVectorExtension,
            vector_available: this.vectorAvailable,
            rls_active: this.rlsActive,
          },
        ],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 0 };
  }

  release(): void {
    // noop
  }
}

describe('PostgreSQL Option B migration runner (no Docker / no psql)', () => {
  it('lists numeric SQL migration files in ascending order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2p-mig-'));
    try {
      writeFileSync(join(dir, '002_second.sql'), 'SELECT 2;', 'utf8');
      writeFileSync(join(dir, '001_first.sql'), 'SELECT 1;', 'utf8');
      writeFileSync(join(dir, 'notes.md'), 'ignore me', 'utf8');

      expect(listMigrationFiles(dir).map((f) => f.filename)).toEqual([
        '001_first.sql',
        '002_second.sql',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies pending migrations idempotently and skips already recorded files on second run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2p-mig-run-'));
    try {
      writeFileSync(join(dir, '001_init_arm_schema.sql'), 'CREATE TYPE workspace_code AS ENUM (\'ARM_B2B\');', 'utf8');
      writeFileSync(join(dir, '002_crm_unification_and_hardening.sql'), 'BEGIN;\nCREATE TABLE IF NOT EXISTS demo(id INT);\nCOMMIT;', 'utf8');

      const client = new MockMigrationClient();
      const first = await runPgMigrations(client, { migrationsDir: dir });

      expect(first.applied).toEqual([
        '001_init_arm_schema.sql',
        '002_crm_unification_and_hardening.sql',
      ]);
      expect(first.adopted).toEqual([]);
      expect(first.skipped).toEqual([]);

      const second = await runPgMigrations(client, { migrationsDir: dir });
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual([
        '001_init_arm_schema.sql',
        '002_crm_unification_and_hardening.sql',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adopts 001_init_arm_schema.sql cleanly if workspaces & workspace_code already exist in database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2p-mig-adopt-'));
    try {
      writeFileSync(join(dir, '001_init_arm_schema.sql'), 'CREATE TYPE workspace_code AS ENUM (\'ARM_B2B\');', 'utf8');
      writeFileSync(join(dir, '002_crm_unification_and_hardening.sql'), 'BEGIN;\nCREATE TABLE IF NOT EXISTS bank_rails(id INT);\nCOMMIT;', 'utf8');

      const client = new MockMigrationClient();
      client.hasExistingWorkspaces = true;
      client.hasExistingWorkspaceType = true;

      const res = await runPgMigrations(client, { migrationsDir: dir });
      expect(res.adopted).toEqual(['001_init_arm_schema.sql']);
      expect(res.applied).toEqual(['002_crm_unification_and_hardening.sql']);
      expect(client.executedSql.some((s) => s.includes('CREATE TYPE workspace_code'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports prerequisite health (PG version, pgvector availability, RLS & pending migrations)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2p-mig-check-'));
    try {
      writeFileSync(join(dir, '001_init_arm_schema.sql'), 'SELECT 1;', 'utf8');
      const client = new MockMigrationClient();
      const status = await verifyPgStoragePrerequisites(client, { migrationsDir: dir });

      expect(status.serverVersion).toBe('PostgreSQL 17.2');
      expect(status.vectorInstalled).toBe(true);
      expect(status.vectorAvailable).toBe(true);
      expect(status.rlsActive).toBe(true);
      expect(status.pendingMigrations).toEqual(['001_init_arm_schema.sql']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
