import type {
  WorkspaceScope,
  InboundChannel,
  InboundMediaType,
  InboundSender,
  InboundNormalizedMessage,
  InboundReceiptEvent,
  ArmOutboxEventType,
  ArmOutboxSseEvent,
} from '@p2p/core';

export type {
  InboundChannel,
  InboundMediaType,
  InboundSender,
  InboundNormalizedMessage,
  InboundReceiptEvent,
  ArmOutboxEventType,
  ArmOutboxSseEvent,
};

export interface GatewayConfig {
  port: number;
  metaAppSecret?: string;
  metaVerifyToken?: string;
  apiSecretToken?: string;
  targetScope: WorkspaceScope;
  idempotencyTtlSeconds: number;
}
