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
  targetScope: WorkspaceScope;
  idempotencyTtlSeconds: number;
  databaseUrl?: string;
}

export interface StorageHealthResponse {
  ok: boolean;
  mode: GatewayStorageMode;
  postgresConnected: boolean;
  latencyMs?: number;
  rlsActive: boolean;
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
  dealId?: string | null;
}
