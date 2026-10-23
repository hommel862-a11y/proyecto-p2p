import type { WorkspaceScope, ClipboardParseResult } from '@p2p/core';

export type InboundChannel = 'WHATSAPP' | 'INSTAGRAM' | 'GMAIL' | 'MANUAL_WEBHOOK';

export interface InboundSender {
  id: string; // Phone number or IG handle or email
  name?: string;
  channel: InboundChannel;
}

export interface InboundNormalizedMessage {
  eventId: string;
  channel: InboundChannel;
  sender: InboundSender;
  text: string;
  timestamp: number;
  mediaUrl?: string;
  rawPayloadId?: string;
}

export interface InboundReceiptEvent {
  eventId: string;
  channel: InboundChannel;
  sender: InboundSender;
  parsed: ClipboardParseResult;
  scope: WorkspaceScope;
  receivedAt: number;
  rawText: string;
  status: 'PENDING_REVIEW' | 'AUTO_MATCHED' | 'DUPLICATE_FLAGGED';
}

export interface GatewayConfig {
  port: number;
  metaAppSecret?: string;
  metaVerifyToken?: string;
  apiSecretToken?: string;
  targetScope: WorkspaceScope;
  idempotencyTtlSeconds: number;
}
