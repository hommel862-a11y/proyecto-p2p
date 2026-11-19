import type {
  WorkspaceScope,
  ArmWorkspaceId,
  InboundChannel,
  InboundMediaType,
  InboundSender,
  InboundNormalizedMessage,
  InboundReceiptEvent,
  ArmOutboxEventType,
  ArmOutboxSseEvent,
} from '@p2p/core';

export type {
  WorkspaceScope,
  ArmWorkspaceId,
  InboundChannel,
  InboundMediaType,
  InboundSender,
  InboundNormalizedMessage,
  InboundReceiptEvent,
  ArmOutboxEventType,
  ArmOutboxSseEvent,
};

export const GATEWAY_STORAGE_MODES = {
  POSTGRES_PGVECTOR: 'POSTGRES_PGVECTOR',
  MEMORY_FALLBACK: 'MEMORY_FALLBACK',
} as const;

export type GatewayStorageMode =
  (typeof GATEWAY_STORAGE_MODES)[keyof typeof GATEWAY_STORAGE_MODES];

export interface GatewayConfig {
  port: number;
  metaAppSecret?: string;
  metaVerifyToken?: string;
  apiSecretToken?: string;
  authToken?: string;
  requireAuth?: boolean;
  allowedOrigin?: string;
  targetScope: WorkspaceScope;
  idempotencyTtlSeconds: number;
  databaseUrl?: string;
}

export interface F360SnapshotPayload {
  version: number;
  assets: readonly Record<string, unknown>[];
  liabilities: readonly Record<string, unknown>[];
  incomes: readonly Record<string, unknown>[];
  expenses: readonly Record<string, unknown>[];
  ledgerEntries?: readonly Record<string, unknown>[];
  casheaPlans: readonly Record<string, unknown>[];
  providers: readonly Record<string, unknown>[];
  inventory: readonly Record<string, unknown>[];
  quotes: readonly Record<string, unknown>[];
  goals?: readonly Record<string, unknown>[];
  recurringRules?: readonly Record<string, unknown>[];
  casheaProfile?: Record<string, unknown> | null;
  casheaMerchantSales?: readonly Record<string, unknown>[];
  drawerLedger?: readonly Record<string, unknown>[];
  reconciliations?: readonly Record<string, unknown>[];
  businessProfile?: Record<string, unknown> | null;
  lastUpdated: string;
}

export interface F360StoredSnapshot {
  workspaceId: 'FINANCE_360';
  version: number;
  schemaVersion: number;
  checksum: string;
  updatedAt: number;
  snapshot: F360SnapshotPayload;
}

export interface F360SnapshotGetResponse {
  ok: boolean;
  mode: GatewayStorageMode;
  workspaceId: 'FINANCE_360';
  found: boolean;
  data: F360StoredSnapshot | null;
}

export interface F360SnapshotPutResponse {
  ok: boolean;
  mode: GatewayStorageMode;
  workspaceId: 'FINANCE_360';
  version: number;
  checksum: string;
  updatedAt: number;
}

export interface StorageHealthResponse {
  ok: boolean;
  mode: GatewayStorageMode;
  postgresConnected: boolean;
  latencyMs?: number;
  rlsActive: boolean;
  pgvectorAvailable?: boolean;
  outboxListenerConnected?: boolean;
  warnings?: string[];
  error?: string;
}

export interface ReceiptVerifyRequest {
  workspaceId: ArmWorkspaceId;
  bankRailId: string;
  referenceCode: string;
  amountFiat: number;
  currency?: string;
  dealId?: string;
  senderName?: string;
  rawText?: string;
  channel?: string;
}

export interface ReceiptVerifyResponse {
  ok: boolean;
  mode: GatewayStorageMode;
  recorded: boolean;
  collision: boolean;
  workspaceId: ArmWorkspaceId;
  bankRailId: string;
  normalizedReference: string;
  receiptId?: string;
  existingReceiptId?: string;
  existingDealId?: string | null;
  dealId?: string | null;
}
