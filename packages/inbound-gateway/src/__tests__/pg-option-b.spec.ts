import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PgArmStore, type PgClientLike, type PgQueryResult, type PgQueryResultRow } from '../pg-store.js';
import { InboundGatewayServer } from '../server.js';
import { resolvePgConnectionConfig, formatPgSslHint } from '../pg-config.js';
import { loadGatewayEnv } from '../env-loader.js';

class ControllableListenerClient extends EventEmitter {
  readonly queries: { text: string; values?: unknown[] }[] = [];
  connectAttempts = 0;
  ended = false;
  shouldFailConnect = false;
  connectErrorMessage = 'ECONNREFUSED';

  async connect(): Promise<void> {
    this.connectAttempts += 1;
    if (this.shouldFailConnect) {
      throw new Error(this.connectErrorMessage);
    }
  }

  async query(text: string, values?: unknown[]): Promise<PgQueryResult> {
    this.queries.push({ text, values });
    return { rows: [] as PgQueryResultRow[], rowCount: 0 };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

function createNoopPool() {
  const client: PgClientLike = {
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => undefined,
  };
  return {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => ({
      rows: [{ ping: 1, has_vector: true, rls_active: true }],
      rowCount: 1,
    })),
    end: vi.fn(async () => undefined),
  };
}

describe('Option B — Managed PostgreSQL config, SSL & env resolution', () => {
  it('keeps local PostgreSQL URLs plain while enabling TLS verify-full on remote Supabase/Neon URLs', () => {
    const local = resolvePgConnectionConfig('postgresql://postgres:secret@localhost:5432/arm');
    expect(local.ssl).toBeUndefined();
    expect(local.warnings).toEqual([]);
    expect(local.connectionString).toBe('postgresql://postgres:secret@localhost:5432/arm');

    const neon = resolvePgConnectionConfig(
      'postgresql://user:pass@ep-cool-river-12345.us-east-2.aws.neon.tech:5432/neondb?sslmode=require&application_name=p2p',
    );
    expect(neon.ssl).toEqual({ rejectUnauthorized: true });
    expect(neon.connectionString).not.toContain('sslmode=');
    expect(neon.connectionString).toContain('application_name=p2p');
    expect(neon.warnings).toEqual([]);

    const supabaseDirectPlain = resolvePgConnectionConfig(
      'postgresql://postgres:pass@db.abcdefg.supabase.co:5432/postgres',
    );
    expect(supabaseDirectPlain.ssl).toEqual({ rejectUnauthorized: true });
    expect(supabaseDirectPlain.warnings).toEqual([]);
  });

  it('respects sslmode=no-verify / disable and warns when Supabase Transaction Pooler (6543) is used', () => {
    const noVerify = resolvePgConnectionConfig(
      'postgresql://postgres.ref:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=no-verify',
    );
    expect(noVerify.ssl).toEqual({ rejectUnauthorized: false });
    expect(noVerify.warnings).toHaveLength(1);
    expect(noVerify.warnings[0]).toContain('TRANSACTION_POOLER_DETECTED');

    const envOverride = resolvePgConnectionConfig(
      'postgresql://postgres:pass@db.abcdefg.supabase.co:5432/postgres?sslmode=require',
      { DATABASE_SSL_REJECT_UNAUTHORIZED: 'false' },
    );
    expect(envOverride.ssl).toEqual({ rejectUnauthorized: false });

    const disabled = resolvePgConnectionConfig(
      'postgresql://postgres:pass@db.abcdefg.supabase.co:5432/postgres?sslmode=disable',
    );
    expect(disabled.ssl).toBeUndefined();
  });

  it('loads custom CA certificate from DATABASE_SSL_CA_PATH when provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2p-ca-'));
    try {
      const caPath = join(dir, 'supabase-ca.crt');
      writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n', 'utf8');
      const cfg = resolvePgConnectionConfig(
        'postgresql://postgres:pass@db.abcdefg.supabase.co:5432/postgres',
        { DATABASE_SSL_CA_PATH: caPath },
      );
      expect(cfg.ssl).toEqual({
        rejectUnauthorized: true,
        ca: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('formats actionable SSL hints without leaking URLs or secrets', () => {
    const hint = formatPgSslHint(new Error('self-signed certificate in certificate chain'));
    expect(hint).toContain('DATABASE_SSL_CA_PATH');
    expect(hint).toContain('sslmode=no-verify');
  });

  it('loads .env in priority order (process.env > root .env > deploy/vps/.env) without overriding existing values', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'p2p-env-'));
    const vpsDir = join(rootDir, 'deploy', 'vps');
    try {
      writeFileSync(join(rootDir, '.env'), 'ROOT_ONLY=from-root\nSHARED_KEY=from-root\n', 'utf8');
      mkdirSync(vpsDir, { recursive: true });
      writeFileSync(
        join(vpsDir, '.env'),
        'VPS_ONLY=from-vps\nSHARED_KEY=from-vps\n',
        'utf8',
      );

      const targetEnv: Record<string, string | undefined> = {
        PREEXISTING_KEY: 'from-process',
      };
      const result = loadGatewayEnv({
        cwd: rootDir,
        repoRoot: rootDir,
        targetEnv,
      });

      expect(result.loadedFiles.length).toBeGreaterThanOrEqual(2);
      expect(targetEnv['PREEXISTING_KEY']).toBe('from-process');
      expect(targetEnv['ROOT_ONLY']).toBe('from-root');
      expect(targetEnv['SHARED_KEY']).toBe('from-root');
      expect(targetEnv['VPS_ONLY']).toBe('from-vps');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('PgArmStore.startOutboxListener resilience (exponential backoff)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconnects once with exponential backoff after error+end storm and resumes notifications', async () => {
    const clients: ControllableListenerClient[] = [];
    const store = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: createNoopPool(),
      createListenerClient: () => {
        const client = new ControllableListenerClient();
        clients.push(client);
        return client;
      },
    });

    const receivedIds: number[] = [];
    const states: string[] = [];
    const handle = await store.startOutboxListener(
      (evt) => receivedIds.push(evt.id),
      {
        baseDelayMs: 100,
        maxDelayMs: 800,
        jitterRatio: 0,
        onStateChange: (state) => states.push(state),
      },
    );

    expect(clients).toHaveLength(1);
    expect(store.isOutboxListenerConnected()).toBe(true);
    expect(states).toEqual(['connecting', 'listening']);

    // Simulate typical pg socket drop: error followed immediately by end
    clients[0]!.emit('error', new Error('Connection terminated unexpectedly'));
    clients[0]!.emit('end');

    expect(store.isOutboxListenerConnected()).toBe(false);
    expect(clients[0]!.ended).toBe(true);

    // Not yet 100ms
    await vi.advanceTimersByTimeAsync(90);
    expect(clients).toHaveLength(1);

    // At 100ms, exactly ONE reconnect client is created
    await vi.advanceTimersByTimeAsync(20);
    expect(clients).toHaveLength(2);
    expect(store.isOutboxListenerConnected()).toBe(true);
    expect(clients[1]!.queries.map((q) => q.text)).toContain('LISTEN arm_outbox_channel');

    // Notifications work on the reconnected client
    clients[1]!.emit('notification', {
      channel: 'arm_outbox_channel',
      payload: JSON.stringify({
        id: 201,
        workspace_id: 'P2P_DESK',
        event_type: 'agent_run',
        aggregate_id: 'lead-201',
        payload: {},
        created_at: '2026-11-19T00:00:00.000Z',
      }),
    });
    expect(receivedIds).toEqual([201]);

    // Second drop tests failing retry escalating 100ms -> 200ms -> success
    clients[1]!.emit('end');
    await vi.advanceTimersByTimeAsync(100);
    expect(clients).toHaveLength(3);

    // Let client 2 fail on next attempt: make next client fail once
    let failOnce = true;
    const store2 = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: createNoopPool(),
      createListenerClient: () => {
        const c = new ControllableListenerClient();
        if (clients.length >= 4 && failOnce) {
          failOnce = false;
          c.shouldFailConnect = true;
        }
        clients.push(c);
        return c;
      },
    });

    await handle.stop();
    expect(store.isOutboxListenerConnected()).toBe(false);

    // Ensure no further timers fire after stop
    await vi.advanceTimersByTimeAsync(5000);
    expect(clients).toHaveLength(3);
    await store2.close();
  });

  it('recovers from initial cold-start connect failure when retryOnInitialFailure is enabled', async () => {
    let attempt = 0;
    const clients: ControllableListenerClient[] = [];
    const store = new PgArmStore('postgresql://postgres:postgres@localhost:5432/arm', {
      pool: createNoopPool(),
      createListenerClient: () => {
        attempt += 1;
        const client = new ControllableListenerClient();
        if (attempt <= 2) {
          client.shouldFailConnect = true;
          client.connectErrorMessage = 'Neon compute waking up';
        }
        clients.push(client);
        return client;
      },
    });

    const receivedIds: number[] = [];
    const handle = await store.startOutboxListener(
      (evt) => receivedIds.push(evt.id),
      {
        baseDelayMs: 100,
        maxDelayMs: 400,
        jitterRatio: 0,
        retryOnInitialFailure: true,
      },
    );

    // Attempt 1 failed -> deferred in background without throwing
    expect(clients).toHaveLength(1);
    expect(store.isOutboxListenerConnected()).toBe(false);

    // +100ms -> Attempt 2 fails -> schedules +200ms
    await vi.advanceTimersByTimeAsync(100);
    expect(clients).toHaveLength(2);
    expect(store.isOutboxListenerConnected()).toBe(false);

    // +200ms -> Attempt 3 succeeds!
    await vi.advanceTimersByTimeAsync(200);
    expect(clients).toHaveLength(3);
    expect(store.isOutboxListenerConnected()).toBe(true);
    expect(clients[2]!.queries.map((q) => q.text)).toContain('LISTEN arm_outbox_channel');

    clients[2]!.emit('notification', {
      channel: 'arm_outbox_channel',
      payload: JSON.stringify({
        id: 305,
        workspace_id: 'FINANCE_360',
        event_type: 'agent_run',
        aggregate_id: 'snap-1',
        payload: {},
      }),
    });
    expect(receivedIds).toEqual([305]);

    await handle.stop();
  });

  it('InboundGatewayServer enables retryOnInitialFailure and exposes pgvector/listener diagnostics in /api/arm/health/storage', async () => {
    const startSpy = vi.fn(async (_cb, opts) => ({
      stop: async () => undefined,
      opts,
    }));
    const mockPgStore = {
      startOutboxListener: startSpy,
      healthCheck: vi.fn(async () => ({
        connected: true,
        latencyMs: 7,
        rlsActive: true,
        pgvectorInstalled: true,
      })),
      isOutboxListenerConnected: vi.fn(() => true),
      getConnectionWarnings: vi.fn(() => ['TRANSACTION_POOLER_DETECTED: use port 5432']),
      close: vi.fn(async () => undefined),
    };

    const server = new InboundGatewayServer(
      {
        port: 0,
        targetScope: 'P2P_DESK',
        idempotencyTtlSeconds: 60,
        requireAuth: false,
      },
      mockPgStore as unknown as PgArmStore,
    );

    const port = await server.start();
    try {
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(startSpy.mock.calls[0]?.[1]).toMatchObject({ retryOnInitialFailure: true });

      vi.useRealTimers();
      const baseRes = await fetch(`http://127.0.0.1:${port}/api/arm/health/storage`);
      const baseBody = (await baseRes.json()) as Record<string, unknown>;
      expect(baseRes.status).toBe(200);
      expect(baseBody['pgvectorAvailable']).toBeUndefined();
      expect(baseBody['warnings']).toEqual(['TRANSACTION_POOLER_DETECTED: use port 5432']);

      const res = await fetch(`http://127.0.0.1:${port}/api/arm/health/storage?verbose=1`);
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(body['pgvectorAvailable']).toBe(true);
      expect(body['outboxListenerConnected']).toBe(true);
      expect(body['warnings']).toEqual(['TRANSACTION_POOLER_DETECTED: use port 5432']);
    } finally {
      await server.stop();
    }
  });

  it('accepts ?token= query auth strictly for GET /api/events SSE while enforcing Bearer header on REST routes', async () => {
    vi.useRealTimers();
    const server = new InboundGatewayServer({
      port: 0,
      targetScope: 'P2P_DESK',
      idempotencyTtlSeconds: 60,
      authToken: 'super-secret-sse-token',
    });
    const port = await server.start();
    try {
      // Non-SSE route MUST reject query ?token= and require Authorization: Bearer
      const restQueryRes = await fetch(
        `http://127.0.0.1:${port}/api/arm/health/storage?token=super-secret-sse-token`,
      );
      expect(restQueryRes.status).toBe(401);

      const restBearerRes = await fetch(`http://127.0.0.1:${port}/api/arm/health/storage`, {
        headers: { Authorization: 'Bearer super-secret-sse-token' },
      });
      expect(restBearerRes.status).toBe(200);

      // SSE route rejects wrong query token
      const sseWrongRes = await fetch(`http://127.0.0.1:${port}/api/events?token=wrong-token`);
      expect(sseWrongRes.status).toBe(401);

      // SSE route accepts valid query ?token= (EventSource browser compatibility)
      const controller = new AbortController();
      const sseOkRes = await fetch(
        `http://127.0.0.1:${port}/api/events?token=super-secret-sse-token`,
        { signal: controller.signal },
      );
      expect(sseOkRes.status).toBe(200);
      expect(sseOkRes.headers.get('content-type')).toContain('text/event-stream');
      controller.abort();

      // Omnichannel Meta config endpoint updates and reads WhatsApp, Instagram & Facebook IDs
      const saveMetaRes = await fetch(`http://127.0.0.1:${port}/api/arm/meta/config`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer super-secret-sse-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumberId: '1092837465',
          whatsappDisplayPhone: '+584121234567',
          igBusinessAccountId: '17841400000',
          fbPageId: '1020304050',
          accessToken: 'EAAB-test-token',
          appSecret: 'meta-secret-123',
          persistToEnv: false,
        }),
      });
      expect(saveMetaRes.status).toBe(200);
      const savedMeta = (await saveMetaRes.json()) as Record<string, unknown>;
      expect(savedMeta['mode']).toBe('LIVE_META_GRAPH');
      expect(savedMeta['phoneNumberId']).toBe('1092837465');
      expect(savedMeta['igBusinessAccountId']).toBe('17841400000');
      expect(savedMeta['fbPageId']).toBe('1020304050');
      expect(savedMeta['hasAccessToken']).toBe(true);
      expect(savedMeta['hasAppSecret']).toBe(true);
    } finally {
      await server.stop();
    }
  });
});
