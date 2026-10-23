import type {
  WorkspaceScope,
  InboundChannel,
  InboundSender,
  InboundNormalizedMessage,
  InboundReceiptEvent,
} from '@p2p/core';

export type {
  InboundChannel,
  InboundSender,
  InboundNormalizedMessage,
  InboundReceiptEvent,
};

export interface GatewayConfig {
  port: number;
  metaAppSecret?: string;
  metaVerifyToken?: string;
  apiSecretToken?: string;
  targetScope: WorkspaceScope;
  idempotencyTtlSeconds: number;
}
