import 'dotenv/config';
import type { WorkspaceScope } from '@p2p/core';
import type { GatewayConfig } from './types.js';
import { InboundGatewayServer } from './server.js';

export * from './types.js';
export * from './crypto-verify.js';
export * from './dedup-cache.js';
export * from './meta-webhook-parser.js';
export * from './receipt-intake.js';
export * from './meta-outbound-client.js';
export * from './pg-store.js';
export * from './server.js';

const port = Number(process.env.INBOUND_GATEWAY_PORT || process.env.GATEWAY_PORT || 3030);
const targetScope: WorkspaceScope = (process.env.TARGET_SCOPE as WorkspaceScope) === 'FINANCE_360'
  ? 'FINANCE_360'
  : 'P2P_DESK';

const config: GatewayConfig = {
  port,
  metaAppSecret: process.env.META_APP_SECRET,
  metaVerifyToken: process.env.META_VERIFY_TOKEN || 'p2p-verify-secret',
  apiSecretToken: process.env.API_SECRET_TOKEN,
  targetScope,
  idempotencyTtlSeconds: Number(process.env.IDEMPOTENCY_TTL_SECONDS || 3600),
  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
};

export const serverInstance = new InboundGatewayServer(config);

// Only start listening when executed directly
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  serverInstance
    .start()
    .then((listeningPort) => {
      const storageMode = config.databaseUrl ? 'POSTGRES_PGVECTOR' : 'MEMORY_FALLBACK';
      console.log(
        `[P2P-INBOUND-GATEWAY] Running on port ${listeningPort} [Scope: ${config.targetScope}] [Storage: ${storageMode}]`,
      );
      console.log(`[P2P-INBOUND-GATEWAY] Endpoints ready:`);
      console.log(`  - GET  /health`);
      console.log(`  - GET  /api/arm/health/storage`);
      console.log(`  - POST /api/arm/receipts/verify`);
      console.log(`  - GET  /webhook/meta (verification)`);
      console.log(`  - POST /webhook/meta (HMAC webhook intake)`);
      console.log(`  - POST /api/inbound/receipt (Bearer manual/receipt intake)`);
      console.log(`  - GET  /api/events/pending`);
      console.log(`  - GET  /api/events (SSE stream)`);
    })
    .catch((err) => {
      console.error('[P2P-INBOUND-GATEWAY] Startup failure:', err);
      process.exit(1);
    });

  const shutdown = async () => {
    console.log('[P2P-INBOUND-GATEWAY] Shutting down gracefully...');
    await serverInstance.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
